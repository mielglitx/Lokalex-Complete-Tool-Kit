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
    let subtitle = 'Type "confirm" to confirm.';
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
            .replace(/I-drag pakanan ang slider para kumpirmahin\.?/gi, 'Type "confirm" to confirm.')
            .replace(/I-drag pakanan ang slider upang alisin ang/gi, 'Type "confirm" to remove')
            .replace(/I-drag pakanan ang slider/gi, 'Type "confirm"')
            .replace(/I-slide pakanan ang slider/gi, 'Type "confirm"');
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
            const res = cb();
            if (res && typeof res.then === 'function') {
                res.catch(err => {
                    console.error("Confirm async action execution error:", err);
                    showToast("❌ Failed: " + (err.message || err));
                });
            }
        } catch (err) {
            console.error("Confirm action execution error:", err);
            showToast("❌ Failed: " + (err.message || err));
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

// ============================================================================
// UNIVERSAL CUSTOM PROMPT MODAL (WEBVIEW & ANDROID COMPATIBLE)
// ============================================================================
let customPromptResolve = null;

export function closeCustomPromptModal(result = null) {
    const modal = document.getElementById('app-custom-prompt-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    if (customPromptResolve) {
        const resolve = customPromptResolve;
        customPromptResolve = null;
        resolve(result);
    }
}

export function showCustomPrompt({
    title = 'Input Required',
    subtitle = '',
    defaultValue = '',
    placeholder = 'Enter value...',
    confirmText = 'Save',
    cancelText = 'Cancel',
    inputType = 'text',
    icon = 'fa-pen-to-square',
    options = []
} = {}) {
    return new Promise((resolve) => {
        customPromptResolve = resolve;

        let modal = document.getElementById('app-custom-prompt-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'app-custom-prompt-modal';
            modal.className = 'hidden fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999999] flex items-center justify-center p-4 transition-all';
            modal.style.zIndex = '9999999';
            modal.innerHTML = `
                <div class="w-full max-w-sm bg-white dark:bg-[#121c22] border border-gray-200 dark:border-gray-700/60 rounded-3xl p-5 shadow-2xl flex flex-col gap-4 text-center animate-in fade-in zoom-in-95 duration-150">
                    <div class="flex flex-col items-center gap-1.5">
                        <div id="custom-prompt-icon-wrapper" class="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-500 dark:text-amber-400 flex items-center justify-center text-lg">
                            <i id="custom-prompt-icon" class="fa-solid fa-clock"></i>
                        </div>
                        <h3 id="custom-prompt-title" class="font-bold text-base text-gray-900 dark:text-white tracking-tight"></h3>
                        <p id="custom-prompt-subtitle" class="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-line leading-relaxed"></p>
                    </div>

                    <div id="custom-prompt-options" class="hidden flex flex-col gap-1.5 max-h-48 overflow-y-auto text-left py-1 pr-1"></div>

                    <div class="flex flex-col gap-1 text-left">
                        <input id="custom-prompt-input" type="text" autocomplete="off" autocorrect="off" spellcheck="false" class="w-full bg-gray-50 dark:bg-[#18232a] text-gray-900 dark:text-white font-bold text-sm px-3.5 py-3 rounded-2xl border border-gray-300 dark:border-gray-700 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition placeholder:text-gray-400 dark:placeholder:text-gray-600">
                    </div>

                    <div class="flex items-center gap-2 pt-1">
                        <button type="button" id="custom-prompt-cancel-btn" class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 transition active:scale-95 cursor-pointer">
                            Cancel
                        </button>
                        <button type="button" id="custom-prompt-confirm-btn" class="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 shadow-md shadow-amber-600/20 transition active:scale-95 cursor-pointer">
                            Confirm
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            modal.addEventListener('pointerdown', (e) => {
                if (e.target === modal) {
                    closeCustomPromptModal(null);
                }
            });
        }

        const titleEl = document.getElementById('custom-prompt-title');
        const subtitleEl = document.getElementById('custom-prompt-subtitle');
        const iconEl = document.getElementById('custom-prompt-icon');
        const inputEl = document.getElementById('custom-prompt-input');
        const confirmBtn = document.getElementById('custom-prompt-confirm-btn');
        const cancelBtn = document.getElementById('custom-prompt-cancel-btn');
        const optionsEl = document.getElementById('custom-prompt-options');

        if (titleEl) titleEl.innerText = title;
        if (subtitleEl) {
            subtitleEl.innerText = subtitle;
            subtitleEl.classList.toggle('hidden', !subtitle);
        }
        if (iconEl) {
            iconEl.className = `fa-solid ${icon || 'fa-pen-to-square'}`;
        }
        if (confirmBtn) confirmBtn.innerText = confirmText || 'Confirm';
        if (cancelBtn) cancelBtn.innerText = cancelText || 'Cancel';

        if (inputEl) {
            inputEl.type = inputType || 'text';
            inputEl.value = defaultValue || '';
            inputEl.placeholder = placeholder || '';
        }

        if (optionsEl) {
            if (Array.isArray(options) && options.length > 0) {
                optionsEl.innerHTML = options.map(opt => {
                    const optVal = typeof opt === 'object' ? opt.value : opt;
                    const optLabel = typeof opt === 'object' ? opt.label : opt;
                    const optSub = typeof opt === 'object' ? (opt.sub || '') : '';
                    return `
                        <button type="button" class="custom-prompt-opt-btn w-full p-2.5 rounded-xl bg-gray-100 dark:bg-gray-800/80 hover:bg-amber-500/15 border border-gray-200 dark:border-gray-700/60 hover:border-amber-500/50 flex items-center justify-between text-left transition active:scale-[0.98] cursor-pointer" data-val="${optVal}">
                            <div class="flex flex-col">
                                <span class="font-bold text-xs text-gray-900 dark:text-white">${optLabel}</span>
                                ${optSub ? `<span class="text-[10px] text-gray-500 font-mono">${optSub}</span>` : ''}
                            </div>
                            <i class="fa-solid fa-chevron-right text-[10px] text-amber-500"></i>
                        </button>
                    `;
                }).join('');
                optionsEl.classList.remove('hidden');

                optionsEl.querySelectorAll('.custom-prompt-opt-btn').forEach(btn => {
                    btn.onclick = () => {
                        const val = btn.getAttribute('data-val');
                        if (inputEl) inputEl.value = val;
                        closeCustomPromptModal(val);
                    };
                });
            } else {
                optionsEl.innerHTML = '';
                optionsEl.classList.add('hidden');
            }
        }

        const handleConfirm = () => {
            const val = inputEl ? inputEl.value.trim() : '';
            closeCustomPromptModal(val);
        };

        const handleCancel = () => {
            closeCustomPromptModal(null);
        };

        if (confirmBtn) confirmBtn.onclick = handleConfirm;
        if (cancelBtn) cancelBtn.onclick = handleCancel;

        if (inputEl) {
            inputEl.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirm();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    handleCancel();
                }
            };
        }

        modal.classList.remove('hidden');
        if (inputEl) {
            setTimeout(() => {
                inputEl.focus();
                inputEl.select();
            }, 60);
        }
    });
}

// Universal WebView polyfill for window.prompt to prevent "prompt() is not supported" fatal crashes
if (typeof window !== 'undefined') {
    const origPrompt = window.prompt;
    window.prompt = function(msg, def) {
        console.warn('[window.prompt polyfill] Synchronous prompt() intercepted:', msg);
        try {
            if (origPrompt) {
                return origPrompt.call(window, msg, def);
            }
        } catch (_) {}
        showCustomPrompt({
            title: "Input Required",
            subtitle: msg,
            defaultValue: def || ""
        }).catch(() => {});
        return def || "";
    };
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
    window.showCustomPrompt = showCustomPrompt;
    window.closeCustomPromptModal = closeCustomPromptModal;
}