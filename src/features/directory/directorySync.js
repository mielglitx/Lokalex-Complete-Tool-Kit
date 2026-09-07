// src/features/directory/directorySync.js
import { globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { API_URL } from '../../config/constants.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { getLocalTodayStr } from '../../utils/helpers.js';
import { prefetchMediaBatch } from '../../utils/storageEngine.js';
import { saveDirectoryCache, loadDirectoryCache } from './directoryStorage.js';
import { renderDirectoryList } from './directoryUi.js';

/**
 * Silently merges directory and customer collections from Firebase into the local cache.
 */
export async function silentSyncDirectory() {
    if (!db) return;

    try {
        const types = ['customers', 'stores', 'barangays'];
        let updatedRecordsMap = new Map();

        (globalState.records || []).forEach(r => {
            if (r && r.name) {
                const key = `${r.type || 'customers'}_${r.name.toLowerCase().trim()}`;
                updatedRecordsMap.set(key, r);
            }
        });

        for (const type of types) {
            const snap = await db.ref(`directory/${type}`).once('value');
            const fbData = snap.val();
            if (fbData) {
                Object.values(fbData).forEach(item => {
                    const name = (item.name || "").trim();
                    if (name) {
                        const key = `${type}_${name.toLowerCase()}`;
                        updatedRecordsMap.set(key, {
                            name: name,
                            contact: (item.contact || "").trim(),
                            address: (item.address || "").trim(),
                            rate: (item.rate || item.address || "").toString().trim(),
                            lat_lon_link: (item.lat_lon_link || "").trim(),
                            type: item.type || type,
                            recorded_by: item.recorded_by || "Amiel",
                            recorded_at: (item.recorded_at || item.recorded_date || item.date || "").toString().trim()
                        });
                    }
                });
            }
        }

        try {
            const custSnap = await db.ref('customers').once('value');
            const custVal = custSnap.val();
            if (custVal) {
                Object.values(custVal).forEach(c => {
                    const name = (c.name || "").trim();
                    if (name) {
                        const key = `customers_${name.toLowerCase()}`;
                        const existing = updatedRecordsMap.get(key) || {};
                        updatedRecordsMap.set(key, {
                            name: name,
                            contact: (c.phoneNumber || existing.contact || "").trim(),
                            address: (c.address || existing.address || "").trim(),
                            rate: existing.rate || "",
                            lat_lon_link: (c.mapPinLink || existing.lat_lon_link || (c.lat && c.lng ? `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}` : "")).trim(),
                            type: 'customers',
                            recorded_by: existing.recorded_by || "App Registered",
                            recorded_at: existing.recorded_at || getLocalTodayStr(),
                            photoUrl: c.photoUrl || c.avatarUrl || ""
                        });
                    }
                });
            }
        } catch (e) {}

        const finalMerged = Array.from(updatedRecordsMap.values());
        if (finalMerged.length > 0) {
            globalState.records = finalMerged;
            saveDirectoryCache();

            const avatarUrls = finalMerged.map(r => r.photoUrl).filter(Boolean);
            if (avatarUrls.length > 0) prefetchMediaBatch(avatarUrls);

            const currentViewEl = document.querySelector('main > section:not(.hidden)');
            if (currentViewEl && currentViewEl.id === 'view-directory') {
                renderDirectoryList();
            }
        }
    } catch (err) {
        console.warn("Silent directory sync skipped:", err.message);
    }
}

/**
 * Triggers manual dual-source synchronization (GAS API + Firebase) with animated visual feedback.
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

    try {
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

                    return {
                        name: finalName,
                        contact: contact.trim(),
                        address: address.trim(),
                        rate: rateVal.toString().trim(),
                        lat_lon_link: lat_lon_link.trim(),
                        type: item.type || type,
                        recorded_by: item.recorded_by || item.recordedby || "Amiel",
                        recorded_at: recorded_at.toString().trim()
                    };
                }).filter(r => r.name !== "");
            }
        }
    } catch (err) {
        console.warn("Offline/Network error syncing directory, preserving local cache...");
    }

    if (db) {
        try {
            const snap = await db.ref(`directory/${type}`).once('value');
            const fbData = snap.val();
            if (fbData) {
                const fbList = Object.values(fbData).map(item => ({
                    name: (item.name || "").trim(),
                    contact: (item.contact || "").trim(),
                    address: (item.address || "").trim(),
                    rate: (item.rate || item.address || "").toString().trim(),
                    lat_lon_link: (item.lat_lon_link || "").trim(),
                    type: item.type || type,
                    recorded_by: item.recorded_by || "Amiel",
                    recorded_at: (item.recorded_at || item.recorded_date || item.date || "").toString().trim()
                })).filter(r => r.name !== "");

                const recordMap = new Map();
                fetchedRecords.forEach(r => recordMap.set(r.name.toLowerCase(), r));
                fbList.forEach(r => recordMap.set(r.name.toLowerCase(), r));
                fetchedRecords = Array.from(recordMap.values());
            }
        } catch (e) {}
    }

    try {
        if (fetchedRecords.length > 0) {
            const otherTypeRecords = (globalState.records || []).filter(r => r.type !== type);
            globalState.records = [...otherTypeRecords, ...fetchedRecords];
            saveDirectoryCache();

            if (!isSilent) {
                showToast(`✅ ${displayTypeLabel} Directory updated (${fetchedRecords.length} records)!`);
                showSideNotification("SYNC COMPLETE", `${fetchedRecords.length} ${displayTypeLabel} records loaded`, "fa-circle-check", "text-emerald-400", "border-emerald-500");
            }
        } else if (!isSilent) {
            const localCount = (globalState.records || []).filter(r => (r.type || 'customers') === type).length;
            showToast(`📁 Loaded ${localCount} ${displayTypeLabel} records from offline cache.`);
            showSideNotification("OFFLINE CACHE", `${localCount} records loaded from storage`, "fa-box-archive", "text-amber-400", "border-amber-500");
        }

        const currentViewEl = document.querySelector('main > section:not(.hidden)');
        if (currentViewEl && currentViewEl.id === 'view-directory') {
            renderDirectoryList();
        }
    } finally {
        refreshIcons.forEach(icon => icon.classList.remove('fa-spin'));
    }
}