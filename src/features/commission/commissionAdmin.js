// src/features/commission/commissionAdmin.js
import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';
import { isAdmin as checkIsAdmin } from '../roster/rosterUtils.js';
import { 
    defaultCommissionRate, 
    customRiderRates, 
    recurringDiscount, 
    specialDateDiscounts,
    setDefaultCommissionRate,
    setCustomRiderRates,
    setRecurringDiscount,
    saveCommissionSettingsCache 
} from './commissionRates.js';
import { refreshCommissionView } from './commissionUI.js';

export function openAdminCommissionSettingsModal() {
    if (!checkIsAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin can adjust commission settings.");
    }

    const modal = document.getElementById('admin-commission-settings-modal');
    const defaultInput = document.getElementById('admin-default-commission-rate');
    const recurringEnabled = document.getElementById('admin-recurring-discount-enabled');
    const recurringDaySelect = document.getElementById('admin-recurring-discount-day');
    const recurringRateInput = document.getElementById('admin-recurring-discount-rate');

    if (defaultInput) {
        defaultInput.value = defaultCommissionRate;
    }
    if (recurringEnabled) {
        recurringEnabled.checked = !!recurringDiscount.enabled;
    }
    if (recurringDaySelect) {
        recurringDaySelect.value = recurringDiscount.day !== undefined ? recurringDiscount.day : 0;
    }
    if (recurringRateInput) {
        recurringRateInput.value = recurringDiscount.percentage || 5;
    }

    renderAdminRiderCommissionRatesList();
    renderSpecialPromoDatesList();

    if (modal) {
        modal.classList.remove('hidden');
    }
}

export function closeAdminCommissionSettingsModal() {
    const modal = document.getElementById('admin-commission-settings-modal');
    if (modal) modal.classList.add('hidden');
}

export function renderAdminRiderCommissionRatesList() {
    const container = document.getElementById('admin-commission-riders-list');
    if (!container) return;

    if (!db) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-6 text-xs">Database offline.</div>`;
        return;
    }

    db.ref('riders').once('value', (snapshot) => {
        const val = snapshot.val() || {};
        let ridersList = Object.entries(val).map(([id, item]) => ({
            id: id.toString().trim(),
            name: item.riderName || item.name || id,
            userType: (item.userType || item.type || "rider").toLowerCase().trim()
        }));

        (globalState.rosterMembers || []).forEach(m => {
            const mId = (m.telegramId || "").toString().trim();
            const mName = m.riderName || m.name || mId;
            if (mId && !ridersList.some(r => r.id === mId)) {
                ridersList.push({ id: mId, name: mName, userType: (m.userType || "rider").toLowerCase().trim() });
            }
        });

        if (ridersList.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-500 italic py-6 text-xs">No registered riders found.</div>`;
            return;
        }

        ridersList.sort((a, b) => a.name.localeCompare(b.name));

        container.innerHTML = ridersList.map(r => {
            const cleanId = r.id;
            const cleanName = r.name.toLowerCase().trim();
            
            let currentRiderRate = "";
            let isOverridden = false;

            if (customRiderRates[cleanId] !== undefined && customRiderRates[cleanId] !== null && customRiderRates[cleanId] !== "") {
                currentRiderRate = customRiderRates[cleanId];
                isOverridden = true;
            } else if (customRiderRates[cleanName] !== undefined && customRiderRates[cleanName] !== null && customRiderRates[cleanName] !== "") {
                currentRiderRate = customRiderRates[cleanName];
                isOverridden = true;
            }

            const badgeHtml = isOverridden 
                ? `<span class="text-[9px] bg-amber-500/20 text-amber-300 font-bold px-1.5 py-0.5 rounded border border-amber-500/30">Custom Rate</span>`
                : `<span class="text-[9px] bg-gray-800 text-gray-400 font-bold px-1.5 py-0.5 rounded border border-gray-700">Default (${defaultCommissionRate}%)</span>`;

            return `
            <div class="bg-black/40 border border-gray-800/80 p-2.5 rounded-2xl flex items-center justify-between gap-2 shadow text-xs">
                <div class="flex flex-col min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="font-bold text-white truncate">
                            <i class="fa-solid fa-motorcycle text-amber-400 mr-1"></i>${escapeHtml(r.name)}
                        </span>
                        ${badgeHtml}
                    </div>
                    <span class="text-[10px] text-gray-400 font-mono">ID: ${escapeHtml(r.id)}</span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <input type="number" step="0.5" min="0" max="100" 
                        id="rider-comm-rate-${escapeHtml(r.id)}" 
                        placeholder="${defaultCommissionRate}%" 
                        value="${currentRiderRate}" 
                        class="w-16 bg-inputBg text-xs text-center font-bold text-amber-400 rounded-xl p-2 border border-gray-700 outline-none focus:border-amber-500">
                    <span class="text-xs text-gray-400 font-bold">%</span>
                    <button type="button" onclick="window.clearRiderCommissionOverride && window.clearRiderCommissionOverride('${escapeHtml(r.id)}')" class="text-gray-500 hover:text-red-400 p-1 text-xs transition" title="Clear override (Use Default)">
                        <i class="fa-solid fa-rotate-left"></i>
                    </button>
                </div>
            </div>`;
        }).join('');
    });
}

export function clearRiderCommissionOverride(riderId) {
    const input = document.getElementById(`rider-comm-rate-${riderId}`);
    if (input) {
        input.value = "";
        input.focus();
        showToast("🔄 Override cleared. It will use the default rate once saved.");
    }
}

export function renderSpecialPromoDatesList() {
    const container = document.getElementById('admin-special-dates-list');
    if (!container) return;

    const entries = Object.entries(specialDateDiscounts || {});
    if (entries.length === 0) {
        container.innerHTML = `<div class="text-gray-500 italic text-[10px] text-center py-2">Walang active na specific promo dates.</div>`;
        return;
    }

    container.innerHTML = entries.map(([dateKey, discount]) => `
        <div class="flex items-center justify-between bg-black/40 border border-purple-500/30 p-2 rounded-xl text-xs">
            <div class="flex items-center gap-2">
                <i class="fa-solid fa-calendar-day text-purple-400"></i>
                <span class="font-mono text-white font-bold">${escapeHtml(dateKey)}</span>
                <span class="text-[10px] text-purple-300 font-bold bg-purple-500/20 px-2 py-0.5 rounded-lg border border-purple-500/30">-${discount}% Less</span>
            </div>
            <button onclick="window.removeSpecialPromoDate && window.removeSpecialPromoDate('${escapeHtml(dateKey)}')" class="text-red-400 hover:text-red-300 p-1 text-xs transition active:scale-95" title="Remove promo date">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `).join('');
}

export function addSpecialPromoDate() {
    const dateInput = document.getElementById('admin-special-promo-date');
    const discountInput = document.getElementById('admin-special-promo-disc');

    const dateVal = dateInput ? dateInput.value.trim() : "";
    const discVal = discountInput ? parseFloat(discountInput.value) : 0;

    if (!dateVal) return showToast("⚠️ Pumili ng date para sa promo!");
    if (isNaN(discVal) || discVal <= 0 || discVal > 100) return showToast("⚠️ Maglagay ng tamang discount percentage (1 - 100%)!");

    specialDateDiscounts[dateVal] = discVal;

    if (dateInput) dateInput.value = "";
    if (discountInput) discountInput.value = "5";

    renderSpecialPromoDatesList();
    showToast(`🎉 Naidagdag ang promo discount sa ${dateVal} (-${discVal}%)!`);
}

export function removeSpecialPromoDate(dateKey) {
    if (specialDateDiscounts && specialDateDiscounts[dateKey] !== undefined) {
        delete specialDateDiscounts[dateKey];
        renderSpecialPromoDatesList();
        showToast(`🗑️ Tinanggal ang promo sa ${dateKey}.`);
    }
}

export async function saveAdminCommissionSettings() {
    if (!checkIsAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin can adjust commission settings.");
    }

    const defaultInput = document.getElementById('admin-default-commission-rate');
    let newDefaultRate = defaultCommissionRate;
    if (defaultInput && defaultInput.value.trim() !== "") {
        const parsed = parseFloat(defaultInput.value);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
            newDefaultRate = parsed;
        }
    }

    const updatedRiderRates = {};
    const rateInputs = document.querySelectorAll('[id^="rider-comm-rate-"]');

    rateInputs.forEach(input => {
        const riderId = input.id.replace('rider-comm-rate-', '').trim();
        const valStr = input.value.trim();
        if (valStr !== "") {
            const valNum = parseFloat(valStr);
            if (!isNaN(valNum) && valNum >= 0 && valNum <= 100) {
                updatedRiderRates[riderId] = valNum;
            }
        }
    });

    const recurringEnabled = document.getElementById('admin-recurring-discount-enabled')?.checked || false;
    const recurringDay = parseInt(document.getElementById('admin-recurring-discount-day')?.value) || 0;
    const recurringRate = parseFloat(document.getElementById('admin-recurring-discount-rate')?.value) || 0;

    const payload = {
        defaultPercentage: newDefaultRate,
        riderRates: updatedRiderRates,
        recurringDiscount: {
            enabled: recurringEnabled,
            day: recurringDay,
            percentage: recurringRate
        },
        specialDateDiscounts: specialDateDiscounts || {},
        updatedBy: appState.riderName || localStorage.getItem('riderName') || "Admin",
        updatedAt: Date.now()
    };

    try {
        if (db) {
            await db.ref('settings/commission').update(payload);
        }

        setDefaultCommissionRate(newDefaultRate);
        setCustomRiderRates(updatedRiderRates);
        setRecurringDiscount(payload.recurringDiscount);
        saveCommissionSettingsCache();

        closeAdminCommissionSettingsModal();
        showToast(`✅ Na-save ang Commission Settings (${newDefaultRate}% default)!`);
        showSideNotification("COMMISSION UPDATED", `Daily commission overrides and promo settings saved!`, "fa-percent", "text-amber-400", "border-amber-500");
        refreshCommissionView();
    } catch(e) {
        console.error("Firebase save error:", e);
        showToast(`❌ Failed to update: ${e.message || "Permission Denied"}`);
    }
}