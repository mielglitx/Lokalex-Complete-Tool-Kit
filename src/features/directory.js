// src/features/directory.js
import { appState, globalState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { API_URL } from '../config/constants.js';
import { showToast, showSideNotification } from '../ui/notifications.js';
import { switchView } from '../ui/router.js';
import { openPasswordModal, closePasswordModal } from '../ui/modals.js';
import { calibrateGPS } from './auth.js';
import { escapeHtml, copyText } from '../utils/helpers.js';

let editingRecord = null;
let mapInstance = null;
let selectedMapLat = 0;
let selectedMapLng = 0;

export async function openDirectory(type) {
    globalState.currentType = type || 'customers';
    switchView('view-directory');
    
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) {
        if (type === 'customers') headerTitle.innerText = "Customer Directory";
        else if (type === 'stores') headerTitle.innerText = "Store Directory";
        else headerTitle.innerText = "Rates & Barangays";
    }

    renderDirectoryList();

    const existingCount = (globalState.records || []).filter(r => (r.type || 'customers') === globalState.currentType).length;
    if (existingCount === 0) {
        await syncData();
    }
}

export async function syncData() {
    const type = globalState.currentType || 'customers';
    const listEl = document.getElementById('record-list');
    
    if (listEl) {
        listEl.innerHTML = `
        <div class="text-center text-blue-400 font-bold py-16 text-xs flex flex-col items-center justify-center gap-2">
            <i class="fa-solid fa-rotate fa-spin text-2xl"></i>
            <span>Syncing ${type.toUpperCase()} records from Google Sheets...</span>
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

                    const finalName = (type === 'barangays' ? barangayName : (item.name || item.customer_name || item.store_name || barangayName)).trim();

                    return {
                        name: finalName,
                        contact: contact.trim(),
                        address: address.trim(),
                        rate: rateVal.toString().trim(),
                        lat_lon_link: lat_lon_link.trim(),
                        type: item.type || type,
                        recorded_by: item.recorded_by || item.recordedby || "Amiel"
                    };
                }).filter(r => r.name !== "");
            }
        }
    } catch (err) {
        console.warn("Could not sync directory from Google Sheets API, checking Firebase...", err);
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
                    recorded_by: item.recorded_by || "Amiel"
                })).filter(r => r.name !== "");

                const recordMap = new Map();
                fetchedRecords.forEach(r => recordMap.set(r.name.toLowerCase(), r));
                fbList.forEach(r => recordMap.set(r.name.toLowerCase(), r));
                fetchedRecords = Array.from(recordMap.values());
            }
        } catch(e) {}
    }

    const otherTypeRecords = (globalState.records || []).filter(r => r.type !== type);
    globalState.records = [...otherTypeRecords, ...fetchedRecords];

    showToast(`✅ Synced ${fetchedRecords.length} ${type} records!`);
    renderDirectoryList();
}

export function filterDirectoryRecords() {
    renderDirectoryList();
}

// COPY BARANGAY RATE WITH CUSTOMER FEE TEMPLATE & CLEAN SPACING
export function copyBarangayRate(barangayName, rawRate) {
    let rateNum = parseFloat((rawRate || "").replace(/[^0-9.]/g, ''));
    let amountStr = !isNaN(rateNum) ? rateNum.toFixed(0) : (rawRate || '0').replace(/[^0-9.]/g, '');

    const formattedMessage = `The delivery fee at ${barangayName} starts at ₱${amountStr}\n\n(Note: Other fees may apply for additional stores or extra services!)\n\nWould you like to see our fee guidelines po?`;

    copyText(formattedMessage);
    showToast(`📋 Copied rate message for ${barangayName}!`);
}

export function renderDirectoryList() {
    const listEl = document.getElementById('record-list');
    const searchVal = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
    if (!listEl) return;

    let records = globalState.records ? globalState.records.filter(r => (r.type || 'customers') === globalState.currentType) : [];

    if (searchVal) {
        records = records.filter(r => 
            (r.name || '').toLowerCase().includes(searchVal) ||
            (r.address || '').toLowerCase().includes(searchVal) ||
            (r.rate || '').toLowerCase().includes(searchVal) ||
            (r.contact || '').toLowerCase().includes(searchVal)
        );
    }

    if (records.length === 0) {
        listEl.innerHTML = `<div class="text-center text-gray-500 italic py-16 text-xs">No records found. Click + to add or tap 🔄 to refresh.</div>`;
        return;
    }

    records.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const isBarangay = globalState.currentType === 'barangays';

    listEl.innerHTML = records.map(r => {
        let mapBtn = '';
        if (r.lat_lon_link) {
            mapBtn = `<a href="${escapeHtml(r.lat_lon_link)}" target="_blank" class="text-xs text-blue-400 font-bold underline flex items-center gap-1 mt-1"><i class="fa-solid fa-map-location-dot"></i> View Location</a>`;
        }

        if (isBarangay) {
            let rateNum = parseFloat((r.rate || r.address || "").replace(/[^0-9.]/g, ''));
            let displayRate = !isNaN(rateNum) ? `₱${rateNum.toFixed(2)}` : (r.rate || r.address || '₱0.00');

            return `
            <div class="bg-cardBg border border-gray-800 p-3.5 rounded-xl flex justify-between items-center gap-2 shadow-sm">
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-sm text-white truncate"><i class="fa-solid fa-map-location-dot text-emerald-400 mr-1.5"></i> ${escapeHtml(r.name)}</div>
                    <div class="text-xs font-mono text-emerald-400 font-bold mt-1">Delivery Rate: ${escapeHtml(displayRate)}</div>
                </div>
                <div class="flex gap-1.5 shrink-0">
                    <button onclick="copyBarangayRate('${escapeHtml(r.name)}', '${escapeHtml(displayRate)}')" class="bg-blue-600/30 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/50 px-2.5 py-1.5 rounded-lg text-xs font-bold transition active:scale-90 flex items-center gap-1" title="Copy Rate Message">
                        <i class="fa-solid fa-copy"></i> Copy
                    </button>
                    <button onclick="editDirectoryRecord('${escapeHtml(r.name)}')" class="bg-gray-800 hover:bg-gray-700 text-amber-400 p-2 rounded-lg text-xs transition active:scale-90" title="Edit">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button onclick="promptDeleteDirectoryRecord('${escapeHtml(r.name)}')" class="bg-gray-800 hover:bg-gray-700 text-red-400 p-2 rounded-lg text-xs transition active:scale-90" title="Delete">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>`;
        }

        return `
        <div class="bg-cardBg border border-gray-800 p-3.5 rounded-xl flex justify-between items-start gap-2 shadow-sm">
            <div class="flex-1 min-w-0">
                <div class="font-bold text-sm text-white truncate">${escapeHtml(r.name)}</div>
                ${r.contact ? `<div class="text-xs text-gray-400 mt-0.5"><i class="fa-solid fa-phone text-[10px]"></i> ${escapeHtml(r.contact)}</div>` : ''}
                ${r.address ? `<div class="text-xs text-gray-400 mt-0.5"><i class="fa-solid fa-location-dot text-[10px]"></i> ${escapeHtml(r.address)}</div>` : ''}
                ${mapBtn}
            </div>
            <div class="flex gap-1 shrink-0">
                <button onclick="editDirectoryRecord('${escapeHtml(r.name)}')" class="bg-gray-800 hover:bg-gray-700 text-amber-400 p-2 rounded-lg text-xs transition active:scale-90" title="Edit">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button onclick="promptDeleteDirectoryRecord('${escapeHtml(r.name)}')" class="bg-gray-800 hover:bg-gray-700 text-red-400 p-2 rounded-lg text-xs transition active:scale-90" title="Delete">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

export function openForm(record = null) {
    editingRecord = record;
    switchView('view-form');

    const warningEl = document.getElementById('edit-warning');
    const warningText = document.getElementById('warning-text');
    const submitBtn = document.getElementById('form-submit-btn');

    const nameInput = document.getElementById('form-name');
    const contactInput = document.getElementById('form-contact');
    const addressInput = document.getElementById('form-address');
    const latlonInput = document.getElementById('form-latlon');

    if (record) {
        if (warningEl) warningEl.classList.remove('hidden');
        if (warningText) warningText.innerText = `Editing record: ${record.name}`;
        if (submitBtn) submitBtn.innerText = "UPDATE RECORD";

        if (nameInput) nameInput.value = record.name || "";
        if (contactInput) contactInput.value = record.contact || "";
        if (addressInput) addressInput.value = record.address || record.rate || "";
        if (latlonInput) latlonInput.value = record.lat_lon_link || "";
    } else {
        if (warningEl) warningEl.classList.add('hidden');
        if (submitBtn) submitBtn.innerText = "SAVE RECORD";

        if (nameInput) nameInput.value = "";
        if (contactInput) contactInput.value = "";
        if (addressInput) addressInput.value = "";
        if (latlonInput) latlonInput.value = "";
    }
}

export function editDirectoryRecord(name) {
    const record = globalState.records?.find(r => r.name === name);
    if (record) openForm(record);
}

export function promptDeleteDirectoryRecord(name) {
    appState.pendingDeleteName = name;
    openPasswordModal();
}

export function verifyPassword() {
    const passInput = document.getElementById('modal-pass');
    const pass = passInput ? passInput.value.trim() : "";

    if (pass === "1234" || pass === "lokalex2026" || pass === "admin") {
        closePasswordModal();
        if (appState.pendingDeleteName) {
            executeDeleteDirectoryRecord(appState.pendingDeleteName);
            appState.pendingDeleteName = null;
        }
    } else {
        showToast("⚠️ Incorrect Password!");
    }
}

export function executeDeleteDirectoryRecord(name) {
    const type = globalState.currentType || 'customers';
    
    if (globalState.records) {
        globalState.records = globalState.records.filter(r => !(r.name === name && r.type === type));
    }

    if (db) {
        const cleanKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        db.ref(`directory/${type}/${cleanKey}`).remove();
    }

    try {
        fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({
                type: type,
                action: 'delete',
                data: { name: name }
            })
        });
    } catch(e) {}

    showToast(`🗑️ Deleted record: ${name}`);
    renderDirectoryList();
}

export async function submitForm() {
    const nameInput = document.getElementById('form-name');
    const contactInput = document.getElementById('form-contact');
    const addressInput = document.getElementById('form-address');
    const latlonInput = document.getElementById('form-latlon');

    const name = nameInput ? nameInput.value.trim() : "";
    const contact = contactInput ? contactInput.value.trim() : "";
    const address = addressInput ? addressInput.value.trim() : "";
    const lat_lon_link = latlonInput ? latlonInput.value.trim() : "";

    if (!name) return showToast("⚠️ Name / Store Name / Barangay is required!");

    const type = globalState.currentType || 'customers';

    const recordData = {
        name, contact, address, rate: address, lat_lon_link,
        type: type,
        recorded_by: appState.riderName || "Amiel",
        originalName: editingRecord ? editingRecord.name : name
    };

    if (editingRecord) {
        const idx = globalState.records.findIndex(r => r.name === editingRecord.name && r.type === type);
        if (idx !== -1) globalState.records[idx] = recordData;
    } else {
        if (!globalState.records) globalState.records = [];
        globalState.records.push(recordData);
    }

    if (db) {
        const cleanKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        db.ref(`directory/${type}/${cleanKey}`).set(recordData);
    }

    showSideNotification("SAVING RECORD", `Saving ${name} to ${type}...`, "fa-floppy-disk", "text-emerald-400", "border-emerald-500");

    try {
        fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({
                type: type,
                action: editingRecord ? 'edit' : 'add',
                data: recordData
            })
        });
    } catch(e) {}

    openDirectory(type);
    showToast(`✅ Record ${editingRecord ? 'updated' : 'saved'} successfully!`);
}

export async function openMapPicker() {
    switchView('view-map');

    showToast("📡 Calibrating GPS for map pin...");
    const coords = await calibrateGPS((acc) => {
        showToast(`📡 Calibrating Map GPS: ±${Math.round(acc)}m`);
    });

    if (coords.lat !== 0 && coords.lon !== 0) {
        selectedMapLat = coords.lat;
        selectedMapLng = coords.lon;
        showToast(`✅ Map GPS Calibrated: ±${Math.round(coords.accuracy)}m`);
    } else {
        selectedMapLat = 15.6886;
        selectedMapLng = 120.4131;
    }

    initGoogleMap(selectedMapLat, selectedMapLng);
}

function initGoogleMap(lat, lng) {
    const container = document.getElementById('google-map-container');
    if (!container || !window.google || !window.google.maps) return;

    const latLng = new google.maps.LatLng(lat, lng);
    mapInstance = new google.maps.Map(container, {
        center: latLng,
        zoom: 17,
        mapTypeId: 'hybrid',
        disableDefaultUI: false,
        zoomControl: true
    });

    mapInstance.addListener('center_changed', () => {
        const center = mapInstance.getCenter();
        selectedMapLat = center.lat();
        selectedMapLng = center.lng();
    });
}

export function confirmGoogleMapPin() {
    const latlonInput = document.getElementById('form-latlon');
    if (latlonInput && selectedMapLat && selectedMapLng) {
        latlonInput.value = `https://www.google.com/maps/search/?api=1&query=${selectedMapLat.toFixed(6)},${selectedMapLng.toFixed(6)}`;
    }
    switchView('view-form');
    showToast("📍 Map Pin location confirmed!");
}

if (typeof window !== 'undefined') {
    window.openDirectory = openDirectory;
    window.syncData = syncData;
    window.filterDirectoryRecords = filterDirectoryRecords;
    window.openForm = openForm;
    window.editDirectoryRecord = editDirectoryRecord;
    window.promptDeleteDirectoryRecord = promptDeleteDirectoryRecord;
    window.executeDeleteDirectoryRecord = executeDeleteDirectoryRecord;
    window.verifyPassword = verifyPassword;
    window.submitForm = submitForm;
    window.openMapPicker = openMapPicker;
    window.confirmGoogleMapPin = confirmGoogleMapPin;
    window.copyBarangayRate = copyBarangayRate;
}
