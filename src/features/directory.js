// src/features/directory.js
import { appState, globalState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { API_URL } from '../config/constants.js';
import { showToast, showSideNotification } from '../ui/notifications.js';
import { switchView } from '../ui/router.js';
import { openPasswordModal } from '../ui/modals.js';
import { calibrateGPS } from './auth.js';
import { escapeHtml } from '../utils/helpers.js';

let editingRecord = null;
let mapInstance = null;
let selectedMapLat = 0;
let selectedMapLng = 0;

export function openDirectory(type) {
    globalState.currentType = type;
    switchView('view-directory');
    
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) {
        if (type === 'customers') headerTitle.innerText = "Customer Directory";
        else if (type === 'stores') headerTitle.innerText = "Store Directory";
        else headerTitle.innerText = "Rates & Barangays";
    }
    
    renderDirectoryList();
}

export function filterDirectoryRecords() {
    renderDirectoryList();
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
            (r.contact || '').toLowerCase().includes(searchVal)
        );
    }

    if (records.length === 0) {
        listEl.innerHTML = `<div class="text-center text-gray-500 italic py-16 text-xs">No records found. Click + to add.</div>`;
        return;
    }

    records.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    listEl.innerHTML = records.map(r => {
        let mapBtn = '';
        if (r.lat_lon_link) {
            mapBtn = `<a href="${escapeHtml(r.lat_lon_link)}" target="_blank" class="text-xs text-blue-400 font-bold underline flex items-center gap-1 mt-1"><i class="fa-solid fa-map-location-dot"></i> View Location</a>`;
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
        if (addressInput) addressInput.value = record.address || "";
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

export async function submitForm() {
    const nameInput = document.getElementById('form-name');
    const contactInput = document.getElementById('form-contact');
    const addressInput = document.getElementById('form-address');
    const latlonInput = document.getElementById('form-latlon');

    const name = nameInput ? nameInput.value.trim() : "";
    const contact = contactInput ? contactInput.value.trim() : "";
    const address = addressInput ? addressInput.value.trim() : "";
    const lat_lon_link = latlonInput ? latlonInput.value.trim() : "";

    if (!name) return showToast("⚠️ Name / Store Name is required!");

    const recordData = {
        name, contact, address, lat_lon_link,
        type: globalState.currentType,
        recorded_by: appState.riderName || "Amiel",
        originalName: editingRecord ? editingRecord.name : name
    };

    if (editingRecord) {
        const idx = globalState.records.findIndex(r => r.name === editingRecord.name);
        if (idx !== -1) globalState.records[idx] = recordData;
    } else {
        if (!globalState.records) globalState.records = [];
        globalState.records.push(recordData);
    }

    showSideNotification("SAVING RECORD", `Saving ${name} to ${globalState.currentType}...`, "fa-floppy-disk", "text-emerald-400", "border-emerald-500");

    try {
        fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({
                type: globalState.currentType,
                action: editingRecord ? 'edit' : 'add',
                data: recordData
            })
        });
    } catch(e) {}

    openDirectory(globalState.currentType);
    showToast(`✅ Record ${editingRecord ? 'updated' : 'saved'} successfully!`);
}

// OPEN MAP PICKER WITH AUTO GPS CALIBRATION FOR STORE/CUSTOMER CREATION
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
        selectedMapLat = 15.6886; // Default fallback coordinates
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
    window.filterDirectoryRecords = filterDirectoryRecords;
    window.openForm = openForm;
    window.editDirectoryRecord = editDirectoryRecord;
    window.promptDeleteDirectoryRecord = promptDeleteDirectoryRecord;
    window.submitForm = submitForm;
    window.openMapPicker = openMapPicker;
    window.confirmGoogleMapPin = confirmGoogleMapPin;
}
