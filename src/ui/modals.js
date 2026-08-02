// src/ui/modals.js
import { appState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { API_URL } from '../config/constants.js';
import { showToast } from './notifications.js';

let slideDeleteCallback = null;

// GCASH REGISTRATION MODAL LOGIC WITH SLIDE CONFIRMATION
export function openGCashModal() {
    const modal = document.getElementById('gcash-modal');
    if (modal) {
        const nameInput = document.getElementById('gcash-name-input');
        const noInput = document.getElementById('gcash-no-input');
        
        if (nameInput) nameInput.value = appState.gcashName || localStorage.getItem('lokalex_gcash_name') || "";
        if (noInput) noInput.value = appState.gcashNo || localStorage.getItem('lokalex_gcash_no') || "";
        
        modal.classList.remove('hidden');
    }
}

export function closeGCashModal() {
    const modal = document.getElementById('gcash-modal');
    if (modal) modal.classList.add('hidden');
}

export function saveGCashDetails() {
    const nameInput = document.getElementById('gcash-name-input');
    const noInput = document.getElementById('gcash-no-input');
    
    const gName = nameInput ? nameInput.value.trim() : "";
    const gNo = noInput ? noInput.value.trim() : "";

    if (!gName || !gNo) {
        showToast("⚠️ Paki-kumpleto ang GCash Name at Number!");
        return;
    }

    // SLIDE CONFIRMATION BARRIER BEFORE SAVING GCASH DETAILS
    openSlideDeleteModal(
        "Confirm GCash Details?",
        `I-drag pakanan para kumpirmahin ang pag-update ng iyong GCash details:\n👤 Name: ${gName}\n📱 Number: ${gNo}`,
        () => {
            executeSaveGCashDetails(gName, gNo);
        }
    );
}

export function executeSaveGCashDetails(gName, gNo) {
    appState.gcashName = gName;
    appState.gcashNo = gNo;

    // Save locally for offline accessibility
    localStorage.setItem('lokalex_gcash_name', gName);
    localStorage.setItem('lokalex_gcash_no', gNo);

    // Save to Firebase
    if (db && appState.telegramId) {
        db.ref('gcash/' + appState.telegramId).set({
            riderName: appState.riderName,
            telegramId: appState.telegramId,
            gcashName: gName,
            gcashNo: gNo,
            updatedAt: Date.now()
        });
    }

    // Save to Google Sheets
    try {
        fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({
                type: "gcash",
                telegramId: appState.telegramId,
                riderName: appState.riderName,
                gcashName: gName,
                gcashNo: gNo
            })
        });
    } catch(e) {}

    closeGCashModal();
    showToast("✅ Na-save na ang iyong GCash Details!");
}

export function openMapCalcBoardModal() {
    document.getElementById('mapcalc-board-modal').classList.remove('hidden');
}

export function closeMapCalcBoardModal() {
    document.getElementById('mapcalc-board-modal').classList.add('hidden');
}

export function promptMapCalcCustomerName() {
    document.getElementById('mapcalc-cust-name-input').value = "";
    document.getElementById('mapcalc-name-modal').classList.remove('hidden');
    document.getElementById('mapcalc-cust-name-input').focus();
}

export function closeMapCalcNameModal() {
    document.getElementById('mapcalc-name-modal').classList.add('hidden');
}

export function openSampleReceiptModal() {
    document.getElementById('sample-receipt-modal').classList.remove('hidden');
}

export function closeSampleReceiptModal() {
    document.getElementById('sample-receipt-modal').classList.add('hidden');
    const input = document.getElementById('rcpt-name');
    if (input) {
        input.disabled = false;
        input.focus();
    }
    const manualToggle = document.getElementById('manual-client-toggle');
    if (manualToggle) manualToggle.checked = true;
}

export function openAdvancedOrdersModal() {
    document.getElementById('adv-orders-modal').classList.remove('hidden');
}

export function closeAdvancedOrdersModal() {
    document.getElementById('adv-orders-modal').classList.add('hidden');
}

export function showGpsRequiredModal() {
    document.getElementById('gps-alert-modal').classList.remove('hidden');
}

export function closeGpsModal() {
    document.getElementById('gps-alert-modal').classList.add('hidden');
}

export function closeCateringModal() {
    document.getElementById('catering-modal').classList.add('hidden');
}

export function closeAdminCateringModal() {
    document.getElementById('admin-catering-modal').classList.add('hidden');
}

export function openPasswordModal() {
    document.getElementById('password-modal').classList.remove('hidden');
    const passInput = document.getElementById('modal-pass');
    if (passInput) {
        passInput.value = ''; 
        passInput.focus();
    }
}

export function closePasswordModal() { 
    document.getElementById('password-modal').classList.add('hidden'); 
}

export function showBulkAddModal() { 
    document.getElementById('bulk-modal').classList.remove('hidden'); 
    const input = document.getElementById('bulk-input');
    if (input) {
        input.value = ""; 
        input.focus(); 
    }
}

export function closeBulkModal() { 
    document.getElementById('bulk-modal').classList.add('hidden'); 
}

export function closeEditItemModal() { 
    document.getElementById('edit-item-modal').classList.add('hidden'); 
}

// Universal Slide-To-Confirm Logic (Overloaded to support 2 or 3 parameters)
export function openSlideDeleteModal(title, arg2, arg3) {
    let subtitle = "I-drag pakanan ang slider para kumpirmahin.";
    let callback = null;

    if (typeof arg2 === 'function') {
        callback = arg2;
    } else if (typeof arg2 === 'string') {
        subtitle = arg2;
        if (typeof arg3 === 'function') {
            callback = arg3;
        }
    }

    const titleEl = document.getElementById('slide-delete-title');
    const subEl = document.getElementById('slide-delete-sub');
    const rangeEl = document.getElementById('slide-delete-range');

    if (titleEl) titleEl.innerText = title;
    if (subEl) subEl.innerText = subtitle;
    if (rangeEl) rangeEl.value = 0;

    slideDeleteCallback = callback;
    const modal = document.getElementById('slide-delete-modal');
    if (modal) modal.classList.remove('hidden');
}

export function closeSlideDeleteModal() {
    const modal = document.getElementById('slide-delete-modal');
    if (modal) modal.classList.add('hidden');
    slideDeleteCallback = null;
}

export function onSlideProgress(val) {
    if (val >= 90) {
        const rangeEl = document.getElementById('slide-delete-range');
        if (rangeEl) rangeEl.value = 100;
        
        if (slideDeleteCallback && typeof slideDeleteCallback === 'function') {
            let cb = slideDeleteCallback;
            closeSlideDeleteModal();
            cb();
        }
    }
}

export function onSlideEnd() {
    const range = document.getElementById('slide-delete-range');
    if (range && range.value < 90) { 
        range.value = 0; 
    }
}

// EXPLICIT WINDOW BINDINGS FOR INLINE HTML TRIGGERS
if (typeof window !== 'undefined') {
    window.openGCashModal = openGCashModal;
    window.closeGCashModal = closeGCashModal;
    window.saveGCashDetails = saveGCashDetails;
    window.executeSaveGCashDetails = executeSaveGCashDetails;
    window.openMapCalcBoardModal = openMapCalcBoardModal;
    window.closeMapCalcBoardModal = closeMapCalcBoardModal;
    window.promptMapCalcCustomerName = promptMapCalcCustomerName;
    window.closeMapCalcNameModal = closeMapCalcNameModal;
    window.openSampleReceiptModal = openSampleReceiptModal;
    window.closeSampleReceiptModal = closeSampleReceiptModal;
    window.openAdvancedOrdersModal = openAdvancedOrdersModal;
    window.closeAdvancedOrdersModal = closeAdvancedOrdersModal;
    window.showGpsRequiredModal = showGpsRequiredModal;
    window.closeGpsModal = closeGpsModal;
    window.closeCateringModal = closeCateringModal;
    window.closeAdminCateringModal = closeAdminCateringModal;
    window.openPasswordModal = openPasswordModal;
    window.closePasswordModal = closePasswordModal;
    window.showBulkAddModal = showBulkAddModal;
    window.closeBulkModal = closeBulkModal;
    window.closeEditItemModal = closeEditItemModal;
    window.openSlideDeleteModal = openSlideDeleteModal;
    window.closeSlideDeleteModal = closeSlideDeleteModal;
    window.onSlideProgress = onSlideProgress;
    window.onSlideEnd = onSlideEnd;
}