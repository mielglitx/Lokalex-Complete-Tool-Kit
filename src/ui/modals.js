// src/ui/modals.js

let slideDeleteCallback = null;

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