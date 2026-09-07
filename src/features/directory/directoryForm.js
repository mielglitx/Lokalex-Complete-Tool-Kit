// src/features/directory/directoryForm.js
import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { API_URL } from '../../config/constants.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { switchView, goBack } from '../../ui/router.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { calibrateGPS } from '../auth/index.js';
import { getLocalTodayStr } from '../../utils/helpers.js';
import { checkAdminAccess } from './directoryPermissions.js';
import { saveDirectoryCache } from './directoryStorage.js';
import { renderDirectoryList, openDirectory } from './directoryUi.js';

let editingRecord = null;

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
    if (!checkAdminAccess()) {
        return showToast("⚠️ Admin access required to delete directory records.");
    }

    openSlideDeleteModal(
        `Delete Directory Record?`,
        `Sigurado ka bang nais mong burahin ang record na [${name}]?`,
        () => executeDeleteDirectoryRecord(name)
    );
}

export function executeDeleteDirectoryRecord(name) {
    const type = globalState.currentType || 'customers';
    
    if (globalState.records) {
        globalState.records = globalState.records.filter(r => !(r.name === name && r.type === type));
    }

    saveDirectoryCache();
    renderDirectoryList();
    showToast(`🗑️ Deleted record: ${name}`);

    if (db) {
        const cleanKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        db.ref(`directory/${type}/${cleanKey}`).remove().catch(() => {});
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
        }).catch(() => {});
    } catch (e) {}
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

    showToast("📡 Calibrating GPS location...");
    const coords = await calibrateGPS((acc) => {
        showToast(`📡 Checking GPS signal: ±${Math.round(acc)}m`);
    });

    if (!coords || (coords.lat === 0 && coords.lon === 0) || coords.accuracy > 50) {
        const gpsModal = document.getElementById('gps-alert-modal');
        if (gpsModal) gpsModal.classList.remove('hidden');
        showToast(`⚠️ Cannot save record: Bad GPS signal (±${Math.round(coords ? coords.accuracy : 999)}m)! Move to an open area.`);
        return;
    }

    const type = globalState.currentType || 'customers';
    const isEdit = !!editingRecord;
    const currentDate = getLocalTodayStr();

    const recordData = {
        name, contact, address, rate: address, lat_lon_link,
        type: type,
        recorded_by: editingRecord ? (editingRecord.recorded_by || appState.riderName || "Amiel") : (appState.riderName || "Amiel"),
        recorded_at: editingRecord ? (editingRecord.recorded_at || currentDate) : currentDate,
        originalName: editingRecord ? editingRecord.name : name
    };

    if (editingRecord) {
        const idx = globalState.records.findIndex(r => r.name === editingRecord.name && r.type === type);
        if (idx !== -1) globalState.records[idx] = recordData;
    } else {
        if (!globalState.records) globalState.records = [];
        globalState.records.push(recordData);
    }

    saveDirectoryCache();
    editingRecord = null;

    showToast(`✅ Record ${isEdit ? 'updated' : 'saved'} successfully!`);

    if (window.history.state && window.history.state.view === 'view-form') {
        goBack();
    } else {
        openDirectory(type);
    }

    if (db) {
        const cleanKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        db.ref(`directory/${type}/${cleanKey}`).set(recordData).catch(() => {});
    }

    showSideNotification("SAVING RECORD", `Syncing ${name} to ${type}...`, "fa-floppy-disk", "text-emerald-400", "border-emerald-500");

    try {
        fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({
                type: type,
                action: isEdit ? 'edit' : 'add',
                data: recordData
            })
        }).catch(() => {});
    } catch (e) {}
}