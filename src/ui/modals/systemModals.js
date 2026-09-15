// src/ui/modals/systemModals.js
import { showToast } from '../notifications.js';

let slideDeleteCallback = null;
let isSlideDragValid = false;

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

    isSlideDragValid = false;
    slideDeleteCallback = callback;
    const modal = document.getElementById('slide-delete-modal');
    if (modal) modal.classList.remove('hidden');
}

export function closeSlideDeleteModal() {
    const modal = document.getElementById('slide-delete-modal');
    if (modal) modal.classList.add('hidden');
    slideDeleteCallback = null;
    isSlideDragValid = false;
}

export function onSlideStart(e) {
    const rangeEl = document.getElementById('slide-delete-range');
    if (!rangeEl) return;

    const rect = rangeEl.getBoundingClientRect();
    const clientX = (e.touches && e.touches.length > 0) 
        ? e.touches[0].clientX 
        : (e.clientX !== undefined ? e.clientX : null);

    if (clientX !== null && rect.width > 0) {
        const touchPercent = ((clientX - rect.left) / rect.width) * 100;
        // Rider must initiate touch within the 0% to 12% handle zone
        if (touchPercent <= 12) {
            isSlideDragValid = true;
        } else {
            isSlideDragValid = false;
            rangeEl.value = 0;
            if (e.cancelable) e.preventDefault();
        }
    } else {
        if (parseFloat(rangeEl.value) <= 10) {
            isSlideDragValid = true;
        } else {
            isSlideDragValid = false;
            rangeEl.value = 0;
        }
    }
}

export function onSlideProgress(val) {
    const rangeEl = document.getElementById('slide-delete-range');
    const num = parseFloat(val) || 0;

    // Block progress if the drag did not start within the 0% to 12% origin zone
    if (!isSlideDragValid) {
        if (rangeEl) rangeEl.value = 0;
        return;
    }

    if (num >= 92) {
        if (rangeEl) rangeEl.value = 100;
        isSlideDragValid = false;
        
        if (slideDeleteCallback && typeof slideDeleteCallback === 'function') {
            let cb = slideDeleteCallback;
            closeSlideDeleteModal();
            cb();
        }
    }
}

export function onSlideEnd() {
    const range = document.getElementById('slide-delete-range');
    if (range && parseFloat(range.value) < 92) { 
        range.value = 0; 
    }
    isSlideDragValid = false;
}

// Global window attachments
if (typeof window !== 'undefined') {
    window.dismissQueueAlarm = dismissQueueAlarm;
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
    window.onSlideStart = onSlideStart;
    window.onSlideProgress = onSlideProgress;
    window.onSlideEnd = onSlideEnd;
}