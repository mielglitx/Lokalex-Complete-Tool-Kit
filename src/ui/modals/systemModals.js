// src/ui/modals/systemModals.js
import { showToast, clearNativeNotification } from '../notifications.js';

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
    if (typeof window.stopReminderAlarm === 'function') window.stopReminderAlarm();
    if (typeof clearNativeNotification === 'function') clearNativeNotification('adv_orders');
    if (typeof window.renderAdvancedOrdersList === 'function') window.renderAdvancedOrdersList();
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

export function closeEditCateringCustomerModal() {
    const modal = document.getElementById('admin-edit-catering-customer-modal');
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
    let subtitle = 'I-type ang "confirm" upang kumpirmahin.';
    let callback = null;

    if (typeof arg2 === 'function') {
        callback = arg2;
    } else if (typeof arg2 === 'string') {
        subtitle = arg2;
        if (typeof arg3 === 'function') {
            callback = arg3;
        }
    }

    if (subtitle && (subtitle.includes('slider') || subtitle.includes('I-drag') || subtitle.includes('i-drag') || subtitle.includes('slide') || subtitle.includes('Slide'))) {
        subtitle = subtitle
            .replace(/I-drag pakanan ang slider para kumpirmahin\.?/gi, 'I-type ang "confirm" upang kumpirmahin.')
            .replace(/I-drag pakanan ang slider upang alisin ang/gi, 'I-type ang "confirm" upang alisin ang')
            .replace(/I-drag pakanan ang slider/gi, 'I-type ang "confirm"')
            .replace(/I-slide pakanan ang slider/gi, 'I-type ang "confirm"');
    }

    const titleEl = document.getElementById('slide-delete-title');
    const subEl = document.getElementById('slide-delete-sub');
    const inputEl = document.getElementById('confirm-type-input');
    const btnEl = document.getElementById('confirm-type-submit-btn');
    const indicatorEl = document.getElementById('confirm-type-match-indicator');
    const hintEl = document.getElementById('confirm-type-status-hint');
    const rangeEl = document.getElementById('slide-delete-range');

    if (titleEl) titleEl.innerText = title || "Confirm Action";
    if (subEl) subEl.innerText = subtitle;
    if (rangeEl) rangeEl.value = 0;

    if (inputEl) {
        inputEl.value = "";
        inputEl.classList.remove('border-emerald-500', 'ring-2', 'ring-emerald-500/30', 'border-red-500');
    }
    if (indicatorEl) indicatorEl.classList.add('hidden');
    if (hintEl) hintEl.innerHTML = 'Required';
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.className = "flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-gray-700/60 border border-gray-600/40 opacity-50 cursor-not-allowed transition active:scale-95 flex items-center justify-center gap-1.5 shadow-sm";
    }

    isSlideDragValid = false;
    slideDeleteCallback = callback;
    const modal = document.getElementById('slide-delete-modal');
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            if (inputEl) inputEl.focus();
        }, 120);
    }
}

export function closeSlideDeleteModal() {
    const modal = document.getElementById('slide-delete-modal');
    if (modal) modal.classList.add('hidden');
    const inputEl = document.getElementById('confirm-type-input');
    if (inputEl) inputEl.value = "";
    slideDeleteCallback = null;
    isSlideDragValid = false;
}

export function handleConfirmTypeInput(val = "") {
    const inputEl = document.getElementById('confirm-type-input');
    const btnEl = document.getElementById('confirm-type-submit-btn');
    const indicatorEl = document.getElementById('confirm-type-match-indicator');
    const hintEl = document.getElementById('confirm-type-status-hint');
    const rangeEl = document.getElementById('slide-delete-range');

    const clean = (val || "").trim().toLowerCase();
    const isMatched = clean === 'confirm';

    if (isMatched) {
        if (rangeEl) rangeEl.value = 100;
        if (indicatorEl) indicatorEl.classList.remove('hidden');
        if (hintEl) hintEl.innerHTML = '<span class="text-emerald-400 font-bold">Ready</span>';
        if (inputEl) {
            inputEl.classList.add('border-emerald-500', 'ring-2', 'ring-emerald-500/30');
            inputEl.classList.remove('border-red-500');
        }
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.className = "flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-red-600 hover:bg-red-500 border border-red-500/60 cursor-pointer shadow-lg shadow-red-600/40 ring-2 ring-red-400/50 opacity-100 transition active:scale-95 flex items-center justify-center gap-1.5";
        }
    } else {
        if (rangeEl) rangeEl.value = 0;
        if (indicatorEl) indicatorEl.classList.add('hidden');
        if (hintEl) hintEl.innerHTML = 'Required';
        if (inputEl) {
            inputEl.classList.remove('border-emerald-500', 'ring-2', 'ring-emerald-500/30');
        }
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.className = "flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-gray-700/60 border border-gray-600/40 opacity-50 cursor-not-allowed transition active:scale-95 flex items-center justify-center gap-1.5 shadow-sm";
        }
    }
}

export function submitConfirmTypeModal() {
    const inputEl = document.getElementById('confirm-type-input');
    const clean = (inputEl?.value || "").trim().toLowerCase();

    if (clean !== 'confirm') {
        if (inputEl) {
            inputEl.focus();
            inputEl.classList.add('border-red-500', 'ring-2', 'ring-red-500/40');
            setTimeout(() => {
                inputEl.classList.remove('ring-2', 'ring-red-500/40');
            }, 600);
        }
        return;
    }

    if (slideDeleteCallback && typeof slideDeleteCallback === 'function') {
        const cb = slideDeleteCallback;
        closeSlideDeleteModal();
        try {
            cb();
        } catch (err) {
            console.error("Confirm action execution error:", err);
        }
    } else {
        closeSlideDeleteModal();
    }
}

// Aliases for modern naming
export const openTypeConfirmModal = openSlideDeleteModal;
export const closeTypeConfirmModal = closeSlideDeleteModal;

// Backward-compatibility stubs for range slider callers
export function onSlideStart() {}
export function onSlideProgress(val) {
    if (parseFloat(val) >= 88) {
        submitConfirmTypeModal();
    }
}
export function onSlideEnd() {}

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
    window.closeEditCateringCustomerModal = closeEditCateringCustomerModal;
    window.openPasswordModal = openPasswordModal;
    window.closePasswordModal = closePasswordModal;
    window.showBulkAddModal = showBulkAddModal;
    window.closeBulkModal = closeBulkModal;
    window.closeEditItemModal = closeEditItemModal;
    window.openSlideDeleteModal = openSlideDeleteModal;
    window.closeSlideDeleteModal = closeSlideDeleteModal;
    window.openTypeConfirmModal = openTypeConfirmModal;
    window.closeTypeConfirmModal = closeTypeConfirmModal;
    window.handleConfirmTypeInput = handleConfirmTypeInput;
    window.submitConfirmTypeModal = submitConfirmTypeModal;
    window.onSlideStart = onSlideStart;
    window.onSlideProgress = onSlideProgress;
    window.onSlideEnd = onSlideEnd;
}