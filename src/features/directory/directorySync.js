// src/features/directory/directorySync.js

/**
 * ============================================================================
 * DIRECTORY DATA SYNCHRONIZATION & CLOUD SEEDING ENGINE
 * ============================================================================
 * 
 * Description:
 * Manages background and on-demand synchronization across Google Apps Script,
 * Firebase Realtime Database, and LocalStorage/IndexedDB:
 * - Non-Destructive Ingestion: Preserves all geographic routing fields
 *   (`originMunicipality`, `municipality`, `barangay`, `compositeKey`, `region`,
 *   and `nationality`), preventing multi-municipality rates from being expunged.
 * - Composite Key Deduplication: Uses unique composite keys
 *   (`origin_destination_barangay`) to prevent same-name barangays in different
 *   towns from overwriting each other.
 * - Dual-Source Ingestion: Merges GAS API and Firebase Realtime Database without
 *   dropping cloud rate updates.
 * - Auto-Seeding: Automatically populates Firebase `directory/barangays` with
 *   complete composite keys if the cloud node is empty.
 * ============================================================================
 */

import { globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { API_URL, BARANGAY_DATA } from '../../config/constants.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { getLocalTodayStr } from '../../utils/helpers.js';
import { prefetchMediaBatch } from '../../utils/storageEngine.js';
import { saveDirectoryCache, loadDirectoryCache } from './directoryStorage.js';
import { renderDirectoryList, populateDestinationDropdown } from './directoryUi.js';

const SYNC_TTL_KEY = 'lokalex_dir_last_sync_timestamp';
const SYNC_TTL_MS = 6 * 60 * 60 * 1000; // 6 Hours cache window

/**
 * Automatically seeds default barangays to Firebase if the cloud node is empty,
 * ensuring all initial records have complete geographic routing metadata.
 */
export async function seedBarangaysToFirebase() {
    if (!db || !BARANGAY_DATA || BARANGAY_DATA.length === 0) return;
    try {
        const snap = await db.ref('directory/barangays').once('value');
        if (!snap.exists() || Object.keys(snap.val() || {}).length === 0) {
            console.info("📡 Seeding default Barangay Rates to Firebase...");
            const updates = {};
            BARANGAY_DATA.forEach(b => {
                const cleanKey = b.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                const compositeKey = `camiling_camiling_${cleanKey}`;
                updates[`directory/barangays/${compositeKey}`] = {
                    name: b.name,
                    barangay: b.name,
                    originMunicipality: "Camiling",
                    municipality: "Camiling",
                    compositeKey: compositeKey,
                    nationality: "Philippines",
                    region: "Region III (Central Luzon)",
                    contact: "",
                    address: `₱${b.fee.toFixed(2)}`,
                    rate: `₱${b.fee.toFixed(2)}`,
                    lat_lon_link: "",
                    type: 'barangays',
                    recorded_by: "System",
                    recorded_at: getLocalTodayStr()
                };
            });
            await db.ref().update(updates);
            console.info("✅ Barangay Rates successfully seeded to Firebase with composite keys.");
        }
    } catch(err) {
        console.warn("Notice: Could not auto-seed barangays to Firebase:", err.message);
    }
}

/**
 * Silently syncs directory data if local cache is stale, preserving all
 * multi-municipality routing fields.
 */
export async function silentSyncDirectory() {
    if (!db) return;

    const lastSync = parseInt(localStorage.getItem(SYNC_TTL_KEY) || "0", 10);
    const now = Date.now();
    const hasLocalRecords = Array.isArray(globalState.records) && globalState.records.length > 5;

    if (hasLocalRecords && (now - lastSync < SYNC_TTL_MS)) {
        return;
    }

    try {
        const types = ['customers', 'stores', 'barangays'];
        let updatedRecordsMap = new Map();

        (globalState.records || []).forEach(r => {
            if (r && r.name) {
                const isBrgy = (r.type || 'customers') === 'barangays';
                const compKey = r.compositeKey || (isBrgy
                    ? `${(r.originMunicipality || 'camiling').toLowerCase().replace(/[^a-z0-9]/g, '')}_${(r.municipality || 'camiling').toLowerCase().replace(/[^a-z0-9]/g, '')}_${r.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`
                    : `${r.type || 'customers'}_${r.name.toLowerCase().trim()}`);
                const mapKey = `${r.type || 'customers'}_${compKey}`;
                updatedRecordsMap.set(mapKey, r);
            }
        });

        for (const type of types) {
            let snap = await db.ref(`directory/${type}`).once('value');
            let fbData = snap.val();

            // Check root path if directory/${type} is empty
            if (!fbData && type !== 'barangays') {
                snap = await db.ref(type).once('value');
                fbData = snap.val();
            }

            if (fbData) {
                Object.entries(fbData).forEach(([fbKey, item]) => {
                    if (!item) return;
                    const name = (item.name || item.storeName || item.customerName || item.barangay || "").trim();
                    if (name) {
                        const isBrgy = (item.type || type) === 'barangays';
                        const originMun = (item.originMunicipality || "Camiling").trim();
                        const destMun = (item.municipality || "Camiling").trim();
                        const compKey = item.compositeKey || (isBrgy
                            ? `${originMun.toLowerCase().replace(/[^a-z0-9]/g, '')}_${destMun.toLowerCase().replace(/[^a-z0-9]/g, '')}_${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`
                            : fbKey || `${type}_${name.toLowerCase()}`);
                        const mapKey = `${type}_${compKey}`;

                        updatedRecordsMap.set(mapKey, {
                            ...item,
                            name: name,
                            barangay: item.barangay || name,
                            originMunicipality: originMun,
                            municipality: destMun,
                            nationality: item.nationality || "Philippines",
                            region: item.region || "Region III (Central Luzon)",
                            compositeKey: compKey,
                            contact: (item.contact || item.phone || item.mobile || "").trim(),
                            address: (item.address || item.location || item.rate || "").trim(),
                            rate: (item.rate || item.address || "").toString().trim(),
                            lat_lon_link: (item.lat_lon_link || item.mapLink || "").trim(),
                            type: item.type || type,
                            recorded_by: item.recorded_by || "System",
                            recorded_at: (item.recorded_at || item.recorded_date || item.date || "").toString().trim()
                        });
                    }
                });
            }
        }

        const finalMerged = Array.from(updatedRecordsMap.values());
        if (finalMerged.length > 0) {
            globalState.records = finalMerged;
            saveDirectoryCache();
            localStorage.setItem(SYNC_TTL_KEY, now.toString());

            const avatarUrls = finalMerged.map(r => r.photoUrl).filter(Boolean);
            if (avatarUrls.length > 0) prefetchMediaBatch(avatarUrls);

            const currentViewEl = document.querySelector('main > section:not(.hidden)');
            if (currentViewEl && currentViewEl.id === 'view-directory') {
                if (globalState.currentType === 'barangays') {
                    populateDestinationDropdown();
                }
                renderDirectoryList();
            }
        }
    } catch (err) {
        console.warn("Silent directory sync notice:", err.message);
    }
}

/**
 * Triggers manual dual-source synchronization (GAS API + Firebase Realtime Database).
 * Fully retains origin and destination municipalities across all records.
 */
export async function syncData(isSilent = false) {
    const type = globalState.currentType || 'customers';
    const listEl = document.getElementById('record-list');
    
    const refreshIcons = document.querySelectorAll('#view-directory .fa-rotate, #view-directory .fa-arrows-rotate, button[onclick*="syncData"] i');
    refreshIcons.forEach(icon => icon.classList.add('fa-spin'));

    const displayTypeLabel = type === 'stores' ? 'Store' : (type === 'customers' ? 'Customer' : 'Barangay Rates');

    if (!isSilent) {
        showToast(`🔄 Syncing latest ${displayTypeLabel} records...`);
        showSideNotification("SYNCING DIRECTORY", `Fetching latest ${displayTypeLabel} data...`, "fa-rotate", "text-blue-400", "border-blue-500");
    }

    loadDirectoryCache();
    const hasExistingLocal = (globalState.records || []).some(r => (r.type || 'customers') === type);

    if (!isSilent && !hasExistingLocal && listEl) {
        listEl.innerHTML = `
        <div class="text-center text-blue-600 dark:text-blue-400 font-bold py-16 text-xs flex flex-col items-center justify-center gap-2">
            <i class="fa-solid fa-rotate fa-spin text-2xl"></i>
            <span>Syncing ${displayTypeLabel.toUpperCase()} records...</span>
        </div>`;
    }

    let fetchedRecords = [];
    let gasFetchFailed = false;

    // 1. ATTEMPT GOOGLE APPS SCRIPT / SHEETS SYNC
    try {
        if (API_URL && API_URL.startsWith('http')) {
            const res = await fetch(`${API_URL}?type=${type}`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    fetchedRecords = data.map(item => {
                        const barangayName = item.barangay || item.barangay_name || item.name || item.title || "";
                        const rateVal = item.rate || item.delivery_rate || item.fee || item.price || item.amount || item.address || item.general_address || "";
                        const contact = item.contact || item.contact_number || item.phone || item.mobile || "";
                        const address = item.address || item.general_address || item.location || "";
                        const lat_lon_link = item.lat_lon_link || item.lat_lon || item.coordinates || item.map || item.map_link || "";
                        const recorded_at = item.recorded_at || item.recorded_date || item.date_added || item.date || "";

                        const finalName = (type === 'barangays' ? barangayName : (item.name || item.customer_name || item.store_name || barangayName)).trim();
                        const originMun = (item.originMunicipality || item.origin || "Camiling").trim();
                        const destMun = (item.municipality || item.destination || "Camiling").trim();
                        const isBrgy = type === 'barangays';
                        const compKey = item.compositeKey || (isBrgy
                            ? `${originMun.toLowerCase().replace(/[^a-z0-9]/g, '')}_${destMun.toLowerCase().replace(/[^a-z0-9]/g, '')}_${finalName.toLowerCase().replace(/[^a-z0-9]/g, '')}`
                            : `${type}_${finalName.toLowerCase()}`);

                        return {
                            ...item,
                            name: finalName,
                            barangay: item.barangay || finalName,
                            originMunicipality: originMun,
                            municipality: destMun,
                            nationality: item.nationality || "Philippines",
                            region: item.region || "Region III (Central Luzon)",
                            compositeKey: compKey,
                            contact: contact.trim(),
                            address: address.trim(),
                            rate: rateVal.toString().trim(),
                            lat_lon_link: lat_lon_link.trim(),
                            type: item.type || type,
                            recorded_by: item.recorded_by || item.recordedby || "System",
                            recorded_at: recorded_at.toString().trim()
                        };
                    }).filter(r => r.name !== "");
                }
            } else {
                gasFetchFailed = true;
                console.warn(`GAS API returned HTTP status ${res.status}`);
            }
        }
    } catch (err) {
        gasFetchFailed = true;
        console.warn("GAS API sync notice (CORS/Network):", err.message);
    }

    // 2. ATTEMPT FIREBASE REALTIME DATABASE SYNC
    if (db) {
        try {
            let snap = await db.ref(`directory/${type}`).once('value');
            let fbData = snap.val();

            if (!fbData && type === 'barangays') {
                await seedBarangaysToFirebase();
                snap = await db.ref('directory/barangays').once('value');
                fbData = snap.val();
            }

            if (!fbData && type !== 'barangays') {
                snap = await db.ref(type).once('value');
                fbData = snap.val();
            }

            if (fbData) {
                const fbList = Object.entries(fbData).map(([fbKey, item]) => {
                    if (!item) return null;
                    const name = (item.name || item.storeName || item.customerName || item.barangay || "").trim();
                    const isBrgy = (item.type || type) === 'barangays';
                    const originMun = (item.originMunicipality || "Camiling").trim();
                    const destMun = (item.municipality || "Camiling").trim();
                    const compKey = item.compositeKey || (isBrgy
                        ? `${originMun.toLowerCase().replace(/[^a-z0-9]/g, '')}_${destMun.toLowerCase().replace(/[^a-z0-9]/g, '')}_${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`
                        : fbKey || `${type}_${name.toLowerCase()}`);

                    return {
                        ...item,
                        name: name,
                        barangay: item.barangay || name,
                        originMunicipality: originMun,
                        municipality: destMun,
                        nationality: item.nationality || "Philippines",
                        region: item.region || "Region III (Central Luzon)",
                        compositeKey: compKey,
                        contact: (item.contact || item.phone || item.mobile || "").trim(),
                        address: (item.address || item.location || item.rate || "").trim(),
                        rate: (item.rate || item.address || "").toString().trim(),
                        lat_lon_link: (item.lat_lon_link || item.mapLink || "").trim(),
                        type: item.type || type,
                        recorded_by: item.recorded_by || "System",
                        recorded_at: (item.recorded_at || item.recorded_date || item.date || "").toString().trim()
                    };
                }).filter(r => r && r.name !== "");

                // Index by composite key so multi-municipality rates remain completely intact
                const recordMap = new Map();
                fetchedRecords.forEach(r => {
                    const k = (r.type === 'barangays')
                        ? (r.compositeKey || `${(r.originMunicipality || 'camiling').toLowerCase()}_${(r.municipality || 'camiling').toLowerCase()}_${r.name.toLowerCase()}`)
                        : `${r.type}_${r.name.toLowerCase()}`;
                    recordMap.set(k, r);
                });

                // Authoritative Firebase records supplement and override GAS data
                fbList.forEach(r => {
                    const k = (r.type === 'barangays')
                        ? (r.compositeKey || `${(r.originMunicipality || 'camiling').toLowerCase()}_${(r.municipality || 'camiling').toLowerCase()}_${r.name.toLowerCase()}`)
                        : `${r.type}_${r.name.toLowerCase()}`;
                    recordMap.set(k, r);
                });

                fetchedRecords = Array.from(recordMap.values());
            }
        } catch (dbErr) {
            console.error("Firebase directory read error:", dbErr);
            if (!isSilent) {
                showToast(`⚠️ Firebase Read Notice: ${dbErr.message || "Permission issue"}`);
            }
        }
    }

    // 3. PERSIST AND HYDRATE STATE
    try {
        if (fetchedRecords.length > 0) {
            const otherTypeRecords = (globalState.records || []).filter(r => r.type !== type);
            globalState.records = [...otherTypeRecords, ...fetchedRecords];
            saveDirectoryCache();
            localStorage.setItem(SYNC_TTL_KEY, Date.now().toString());

            if (!isSilent) {
                showToast(`✅ ${displayTypeLabel} Directory updated (${fetchedRecords.length} records)!`);
                showSideNotification("SYNC COMPLETE", `${fetchedRecords.length} ${displayTypeLabel} records loaded`, "fa-circle-check", "text-emerald-400", "border-emerald-500");
            }
        } else if (!isSilent) {
            const localCount = (globalState.records || []).filter(r => (r.type || 'customers') === type).length;
            const sourceNote = gasFetchFailed ? " (Sheets API unreachable, using cache)" : "";
            showToast(`📁 Loaded ${localCount} ${displayTypeLabel} records from offline cache${sourceNote}.`);
            showSideNotification("OFFLINE CACHE", `${localCount} records loaded from storage`, "fa-box-archive", "text-amber-400", "border-amber-500");
        }

        const currentViewEl = document.querySelector('main > section:not(.hidden)');
        if (currentViewEl && currentViewEl.id === 'view-directory') {
            if (type === 'barangays') {
                populateDestinationDropdown();
            }
            renderDirectoryList();
        }
    } finally {
        refreshIcons.forEach(icon => icon.classList.remove('fa-spin'));
    }
}

// Seed initial barangay rates if Firebase cloud node is empty
seedBarangaysToFirebase();

// REMARKS: DIRECTORY_SYNC_NON_DESTRUCTIVE_COMPOSITE_KEYING_V2_COMPLETE