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
    input.disabled = false;
    document.getElementById('manual-client-toggle').checked = true;
    input.focus();
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
    document.getElementById('modal-pass').value = ''; 
    document.getElementById('modal-pass').focus();
}

export function closePasswordModal() { 
    document.getElementById('password-modal').classList.add('hidden'); 
}

export function showBulkAddModal() { 
    document.getElementById('bulk-modal').classList.remove('hidden'); 
    document.getElementById('bulk-input').value = ""; 
    document.getElementById('bulk-input').focus(); 
}

export function closeBulkModal() { 
    document.getElementById('bulk-modal').classList.add('hidden'); 
}

export function closeEditItemModal() { 
    document.getElementById('edit-item-modal').classList.add('hidden'); 
}

// Universal Slide-To-Confirm Logic
export function openSlideDeleteModal(title, callback) {
    document.getElementById('slide-delete-title').innerText = title;
    document.getElementById('slide-delete-range').value = 0;
    slideDeleteCallback = callback;
    document.getElementById('slide-delete-modal').classList.remove('hidden');
}

export function closeSlideDeleteModal() {
    document.getElementById('slide-delete-modal').classList.add('hidden');
    slideDeleteCallback = null;
}

export function onSlideProgress(val) {
    if (val >= 90) {
        document.getElementById('slide-delete-range').value = 100;
        if (slideDeleteCallback) {
            let cb = slideDeleteCallback;
            closeSlideDeleteModal();
            cb();
        }
    }
}

export function onSlideEnd() {
    const range = document.getElementById('slide-delete-range');
    if (range.value < 90) { range.value = 0; }
}