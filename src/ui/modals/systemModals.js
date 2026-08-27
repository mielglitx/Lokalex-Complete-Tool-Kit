// src/ui/modals/systemModals.js
import { showToast } from '../notifications.js';

let slideDeleteCallback = null;

export function dismissQueueAlarm() {
    const modal = document.getElementById('first-in-line-modal') || document.getElementById('first-line-modal');
    if (modal) modal.classList.add('hidden');
    
    if (window.setLineAlarmConfirmed && typeof window.setLineAlarmConfirmed === 'function') {
        window.setLineAlarmConfirmed(true);
    }
    if (window.stopLineAlarm && typeof window.stopLineAlarm === 'function') {
        window.stopLineAlarm();
    }
}

export function openSampleReceiptModal() {
    const modal = document.getElementById('sample-receipt-modal');
    if (modal) modal.classList.remove('hidden');
}

export function closeSampleReceiptModal() {
    const modal = document.getElementById('sample-receipt-modal');
    if (modal) modal.classList.add('hidden');
    const input = document.getElementById('rcpt-name');
    if (input) {
        input.disabled = false;
        input.focus();
    }
    const manualToggle = document.getElementById('manual-client-toggle');
    if (manualToggle) manualToggle.checked = true;
}

export function openAdvancedOrdersModal() {
    const modal = document.getElementById('adv-orders-modal');
    if (modal) modal.classList.remove('hidden');
}

export function closeAdvancedOrdersModal() {
    const modal = document.getElementById('adv-orders-modal');
    if (modal) modal.classList.add('hidden');
}

export function showGpsRequiredModal() {
    const modal = document.getElementById('gps-alert-modal');
    if (modal) modal.classList.remove('hidden');
}

export function closeGpsModal() {
    const modal = document.getElementById('gps-alert-modal');
    if (modal) modal.classList.add('hidden');
}

export function closeCateringModal() {
    const modal = document.getElementById('catering-modal');
    if (modal) modal.classList.add('hidden');
}

export function closeAdminCateringModal() {
    const modal = document.getElementById('admin-catering-modal');
    if (modal) modal.classList.add('hidden');
}

export function openPasswordModal() {
    const modal = document.getElementById('password-modal');
    if (modal) modal.classList.remove('hidden');
    const passInput = document.getElementById('modal-pass');
    if (passInput) {
        passInput.value = ''; 
        passInput.focus();
    }
}

export function closePasswordModal() { 
    const modal = document.getElementById('password-modal');
    if (modal) modal.classList.add('hidden'); 
}

export function showBulkAddModal() { 
    const modal = document.getElementById('bulk-modal');
    if (modal) modal.classList.remove('hidden'); 
    const input = document.getElementById('bulk-input');
    if (input) {
        input.value = ""; 
        input.focus(); 
    }
}

export function closeBulkModal() { 
    const modal = document.getElementById('bulk-modal');
    if (modal) modal.classList.add('hidden'); 
}

export function closeEditItemModal() { 
    const modal = document.getElementById('edit-item-modal');
    if (modal) modal.classList.add('hidden'); 
}

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