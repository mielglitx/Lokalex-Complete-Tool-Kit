// src/features/advancedOrders/advancedOrdersRiderModal.js
import { appState, globalState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml, getLocalTodayStr } from '../../utils/helpers.js';

export function getRidersAvailableOnDate(order) {
    const orderDate = order?.dateOrdered || 
                      (order?.createdAt ? new Date(order.createdAt).toISOString().split('T')[0] : null) || 
                      order?.dateToReceive || 
                      getLocalTodayStr();
    const todayStr = getLocalTodayStr();
    const riderMap = new Map();

    const registerRider = (rawName) => {
        if (!rawName || typeof rawName !== 'string') return;
        const clean = rawName.trim();
        if (!clean || clean.toLowerCase() === 'unassigned') return;
        const key = clean.toLowerCase();
        if (!riderMap.has(key)) {
            riderMap.set(key, clean);
        }
    };

    // 1. Current roster members marked as 'Available'
    (globalState.rosterMembers || []).forEach(m => {
        const name = m.riderName || m.name;
        if (name && m.status === 'Available') {
            registerRider(name);
        }
    });

    // 2. Active roster members if order was created today
    if (orderDate === todayStr) {
        (globalState.rosterMembers || []).forEach(m => {
            const name = m.riderName || m.name;
            if (name && m.status && m.status !== 'End') {
                registerRider(name);
            }
        });
    }

    // 3. Riders who logged in on the creation date
    (globalState.globalLogins || []).forEach(l => {
        if (l && l.date === orderDate && l.riderName) {
            registerRider(l.riderName);
        }
    });

    // 4. Riders who catered or completed receipts on that date
    (globalState.globalCateredHistory || []).forEach(h => {
        const hDate = h.date || h.completedDate;
        if (hDate === orderDate && h.riderName) {
            registerRider(h.riderName);
        }
    });

    (globalState.globalDailyReceipts || []).forEach(r => {
        const rDate = r.date || r.completedDate;
        if (rDate === orderDate && r.riderName) {
            registerRider(r.riderName);
        }
    });

    // 5. Current active session rider
    if (appState.riderName) {
        registerRider(appState.riderName);
    }

    // 6. Currently assigned rider on the order
    if (order?.cateredBy) {
        registerRider(order.cateredBy);
    }

    // 7. General fallback: all known roster members
    if (riderMap.size === 0) {
        (globalState.rosterMembers || []).forEach(m => {
            const name = m.riderName || m.name;
            if (name) registerRider(name);
        });
    }

    return Array.from(riderMap.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function promptRiderNameInModal({ title, subtitle, defaultValue, riderList = [], confirmBtnText, confirmBtnClass, onConfirm }) {
    let modal = document.getElementById('adv-order-prompt-modal');

    if (modal) {
        modal.remove();
    }

    modal = document.createElement('div');
    modal.id = 'adv-order-prompt-modal';
    modal.className = 'fixed inset-0 z-[99999] bg-black/80 backdrop-blur-xs flex items-center justify-center p-4';

    const safeRiders = Array.isArray(riderList) ? [...riderList] : [];
    if (defaultValue && !safeRiders.some(r => r.toLowerCase() === defaultValue.toLowerCase())) {
        safeRiders.unshift(defaultValue);
    }

    const optionsHtml = safeRiders.length > 0 
        ? safeRiders.map(r => `<option value="${escapeHtml(r)}"${r.toLowerCase() === (defaultValue || '').toLowerCase() ? ' selected' : ''}>${escapeHtml(r)}</option>`).join('')
        : `<option value="" disabled selected>No available riders found</option>`;

    modal.innerHTML = `
        <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 w-full max-w-sm rounded-3xl p-5 shadow-2xl flex flex-col gap-3.5 animate-in fade-in zoom-in-95 duration-150">
            <div class="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-2.5">
                <div>
                    <h3 id="adv-prompt-modal-title" class="text-sm font-black text-gray-900 dark:text-white">${escapeHtml(title || "Assign Rider")}</h3>
                    <p id="adv-prompt-modal-sub" class="text-[11px] text-gray-500 dark:text-gray-400">${escapeHtml(subtitle || "Pangalan ng Rider")}</p>
                </div>
                <button type="button" id="adv-prompt-close-x" class="text-gray-400 hover:text-gray-700 dark:hover:text-white p-1 text-sm transition">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div>
                <label class="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Rider Name *</label>
                <div class="relative mt-1">
                    <select id="adv-prompt-modal-select" class="w-full bg-inputBg text-xs rounded-xl p-3 pr-8 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white font-bold appearance-none cursor-pointer focus:border-purple-500">
                        ${optionsHtml}
                    </select>
                    <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-400">
                        <i class="fa-solid fa-chevron-down text-xs"></i>
                    </div>
                </div>
            </div>
            <div class="flex gap-2 pt-1">
                <button type="button" id="adv-prompt-btn-cancel" class="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xs transition active:scale-95">Cancel</button>
                <button type="button" id="adv-prompt-btn-confirm" class="flex-1 py-2.5 rounded-xl text-white font-bold text-xs transition active:scale-95 shadow ${confirmBtnClass || 'bg-purple-600 hover:bg-purple-500'}">${escapeHtml(confirmBtnText || "Confirm")}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const selectEl = document.getElementById('adv-prompt-modal-select');
    const confirmBtn = document.getElementById('adv-prompt-btn-confirm');
    const cancelBtn = document.getElementById('adv-prompt-btn-cancel');
    const closeX = document.getElementById('adv-prompt-close-x');

    if (selectEl && defaultValue) {
        selectEl.value = defaultValue;
    }

    const closeModal = () => {
        modal.classList.add('hidden');
        modal.remove();
    };

    const handleConfirm = () => {
        const val = selectEl ? selectEl.value.trim() : "";
        if (!val) {
            return showToast("⚠️ Paki-pili ang Rider!");
        }
        closeModal();
        if (onConfirm) onConfirm(val);
    };

    if (cancelBtn) cancelBtn.onclick = closeModal;
    if (closeX) closeX.onclick = closeModal;
    if (confirmBtn) confirmBtn.onclick = handleConfirm;

    modal.classList.remove('hidden');
    if (selectEl) selectEl.focus();
}