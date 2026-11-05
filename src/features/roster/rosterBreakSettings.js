// src/features/roster/rosterBreakSettings.js

/**
 * ============================================================================
 * ROSTER BREAK PERIOD SETTINGS & RIDER BREAK SELECTION ENGINE
 * ============================================================================
 * 
 * Manages admin-configurable break durations, daily break allowance limits,
 * remaining time rollover within the same day, auto-exit upon break expiry,
 * and admin unlimited break override.
 * 
 * Core Policies:
 * 1. Available Break Time: Tracked per day (default 60m daily allowance).
 *    Leftover break time carries over for subsequent breaks on the same day.
 * 2. Daily Exhaustion: Once a rider consumes all available break time for the
 *    day, they cannot take any more breaks and cannot remain in break mode.
 * 3. Daily Refresh: Consumed break time resets to 0 each new day.
 * 4. Admin Override: Admin users (or admin force-break on a rider) have access
 *    to an "Unlimited Break" option with no time limits.
 * 5. Duty Time Policy: Break time is strictly excluded from total shift duty.
 * ============================================================================
 */

import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { escapeHtml, getLocalTodayStr } from '../../utils/helpers.js';
import { isAdmin, hasTlPermission, getActiveCateringCustomersWithTimes, getElapsedBreakMinutes, getElapsedBreakTime } from './rosterUtils.js';
import { updateRosterStatus } from './rosterStatusCore.js';
import { updateRosterUI } from './rosterUI.js';

export const DEFAULT_BREAK_PERIODS = [
    { id: 'bp_15', label: 'Quick Break', duration: 15, icon: 'fa-mug-hot' },
    { id: 'bp_30', label: 'Meal Break', duration: 30, icon: 'fa-utensils' },
    { id: 'bp_45', label: 'Lunch / Dinner', duration: 45, icon: 'fa-burger' },
    { id: 'bp_60', label: 'Full / Long Break', duration: 60, icon: 'fa-bed' }
];

export const DEFAULT_BREAK_SETTINGS = {
    dailyAllowanceMinutes: 60,
    periods: DEFAULT_BREAK_PERIODS
};

let editingBreakPeriods = null;

export function getIconForDuration(duration) {
    const d = parseInt(duration, 10) || 15;
    if (d <= 15) return 'fa-mug-hot';
    if (d <= 30) return 'fa-utensils';
    if (d <= 45) return 'fa-burger';
    return 'fa-bed';
}

export function normalizeBreakPeriods(raw) {
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_BREAK_PERIODS));
    let arr = [];
    if (Array.isArray(raw)) {
        arr = raw.filter(Boolean);
    } else if (typeof raw === 'object') {
        arr = Object.values(raw).filter(Boolean);
    }
    const sanitized = arr.map((item, idx) => {
        const duration = Math.max(1, parseInt(item.duration, 10) || 15);
        const label = String(item.label || `${duration}m Break`).trim();
        const id = String(item.id || `bp_${duration}_${idx}`).trim();
        const icon = String(item.icon || getIconForDuration(duration)).trim();
        return { id, label, duration, icon };
    }).sort((a, b) => a.duration - b.duration);

    return sanitized.length > 0 ? sanitized : JSON.parse(JSON.stringify(DEFAULT_BREAK_PERIODS));
}

export function normalizeBreakSettings(raw) {
    let dailyAllowanceMinutes = 60;
    let rawPeriods = [];

    if (!raw) {
        return {
            dailyAllowanceMinutes: 60,
            periods: JSON.parse(JSON.stringify(DEFAULT_BREAK_PERIODS))
        };
    }

    if (Array.isArray(raw)) {
        rawPeriods = raw;
    } else if (typeof raw === 'object') {
        if (raw.dailyAllowanceMinutes !== undefined) {
            dailyAllowanceMinutes = Math.max(5, parseInt(raw.dailyAllowanceMinutes, 10) || 60);
        }
        if (raw.periods) {
            rawPeriods = Array.isArray(raw.periods) ? raw.periods : Object.values(raw.periods);
        } else {
            rawPeriods = Object.values(raw);
        }
    }

    const periods = normalizeBreakPeriods(rawPeriods);
    return {
        dailyAllowanceMinutes,
        periods
    };
}

export function getBreakSettings() {
    if (globalState.breakSettings && globalState.breakSettings.periods && globalState.breakSettings.periods.length > 0) {
        return globalState.breakSettings;
    }

    try {
        const cached = localStorage.getItem('lokalex_break_settings');
        if (cached) {
            const parsed = JSON.parse(cached);
            const normalized = normalizeBreakSettings(parsed);
            globalState.breakSettings = normalized;
            globalState.breakPeriods = normalized.periods;
            return normalized;
        }
    } catch(e) {}

    globalState.breakSettings = JSON.parse(JSON.stringify(DEFAULT_BREAK_SETTINGS));
    globalState.breakPeriods = globalState.breakSettings.periods;
    return globalState.breakSettings;
}

export function getBreakDailyAllowance() {
    const settings = getBreakSettings();
    return settings.dailyAllowanceMinutes || 60;
}

export function getBreakPeriods() {
    const settings = getBreakSettings();
    return settings.periods || DEFAULT_BREAK_PERIODS;
}

export function listenToBreakSettings() {
    if (!db) return;

    try {
        const cached = localStorage.getItem('lokalex_break_settings') || localStorage.getItem('lokalex_break_periods');
        if (cached) {
            const parsed = JSON.parse(cached);
            const normalized = normalizeBreakSettings(parsed);
            globalState.breakSettings = normalized;
            globalState.breakPeriods = normalized.periods;
        }
    } catch(e) {}

    db.ref('settings/breakPeriods').on('value', (snap) => {
        if (snap.exists()) {
            const data = snap.val();
            const normalized = normalizeBreakSettings(data);
            globalState.breakSettings = normalized;
            globalState.breakPeriods = normalized.periods;
            try {
                localStorage.setItem('lokalex_break_settings', JSON.stringify(normalized));
                localStorage.setItem('lokalex_break_periods', JSON.stringify(normalized.periods));
            } catch(e) {}
        } else {
            globalState.breakSettings = JSON.parse(JSON.stringify(DEFAULT_BREAK_SETTINGS));
            globalState.breakPeriods = globalState.breakSettings.periods;
        }
        window.dispatchEvent(new CustomEvent('breakPeriodsUpdated', { detail: globalState.breakSettings }));
    });
}

// ============================================================================
// BREAK USAGE & DAILY ALLOWANCE COMPUTATION
// ============================================================================

export function getRiderBreakUsageToday(riderId = null) {
    const tId = (riderId || appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const todayStr = getLocalTodayStr();
    const rosterMembers = globalState.rosterMembers || [];
    const rMem = rosterMembers.find(m => (m.telegramId || m.id || "").toString().trim() === tId);
    const loginRec = (globalState.globalLogins || []).find(
        l => (l.riderId || l.id || "").toString().trim() === tId && l.date === todayStr
    );

    const totalAllowance = getBreakDailyAllowance();

    if (!rMem && !loginRec) {
        return {
            usedMinutes: 0,
            remainingMinutes: totalAllowance,
            totalAllowance,
            isUnlimited: false,
            isOverLimit: false,
            breakDate: todayStr
        };
    }

    const isUnlimited = !!(rMem && rMem.isUnlimitedBreak);

    let usedSeconds = 0;
    // Break time refreshes each new day: only count break time recorded today
    if (rMem && rMem.breakDate === todayStr) {
        const recSecs = Number(rMem.totalBreakSeconds) || 0;
        const recMins = Number(rMem.totalBreakMinutes) || 0;
        usedSeconds = Math.max(recSecs, recMins * 60);
    }
    if (loginRec) {
        const loginSecs = Number(loginRec.totalBreakSeconds) || 0;
        const loginMins = Number(loginRec.totalBreakMinutes) || 0;
        usedSeconds = Math.max(usedSeconds, loginSecs, loginMins * 60);
    }

    // If currently on Break, add ongoing break session seconds
    if (rMem && rMem.status === 'Break' && rMem.breakTimestamp) {
        const activeSecs = Math.max(1, Math.ceil((Date.now() - rMem.breakTimestamp) / 1000));
        usedSeconds += activeSecs;
    }

    const usedMinutes = Math.ceil(usedSeconds / 60);
    const remainingMinutes = isUnlimited ? Infinity : Math.max(0, totalAllowance - usedMinutes);
    const isOverLimit = !isUnlimited && remainingMinutes <= 0;

    return {
        usedMinutes,
        usedSeconds,
        remainingMinutes,
        totalAllowance,
        isUnlimited,
        isOverLimit,
        breakDate: todayStr
    };
}

// ============================================================================
// ADMIN BREAK SETTINGS MODAL
// ============================================================================

export function openAdminBreakSettingsModal() {
    if (!isAdmin() && !hasTlPermission('canManageBreakSettings')) {
        return showToast("⚠️ Unauthorized: Admin or authorized TL access required.");
    }

    const modal = document.getElementById('admin-break-settings-modal');
    if (!modal) return;

    const settings = getBreakSettings();
    editingBreakPeriods = JSON.parse(JSON.stringify(settings.periods || DEFAULT_BREAK_PERIODS));

    const allowanceInput = document.getElementById('admin-daily-break-allowance');
    if (allowanceInput) {
        allowanceInput.value = settings.dailyAllowanceMinutes || 60;
    }

    renderAdminBreakPeriodsList();

    const durInput = document.getElementById('admin-new-break-duration');
    const labelInput = document.getElementById('admin-new-break-label');
    if (durInput) durInput.value = "";
    if (labelInput) labelInput.value = "";

    modal.classList.remove('hidden');
}

export function closeAdminBreakSettingsModal() {
    const modal = document.getElementById('admin-break-settings-modal');
    if (modal) modal.classList.add('hidden');
    editingBreakPeriods = null;
}

export function renderAdminBreakPeriodsList() {
    const listEl = document.getElementById('admin-break-periods-list');
    const countEl = document.getElementById('admin-break-count');
    if (!listEl) return;

    const list = editingBreakPeriods || getBreakPeriods();
    if (countEl) countEl.innerText = list.length.toString();

    if (list.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-gray-500 italic text-center py-4">No break periods configured. Click "Reset Defaults".</p>`;
        return;
    }

    listEl.innerHTML = list.map((item) => `
        <div class="bg-cardBg border border-gray-800 p-2.5 rounded-2xl flex items-center justify-between gap-2 shadow-xs transition hover:border-amber-500/40">
            <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center text-xs font-bold border border-amber-500/20 shrink-0">
                    <i class="fa-solid ${item.icon || getIconForDuration(item.duration)}"></i>
                </div>
                <div class="min-w-0">
                    <div class="text-xs font-bold text-white truncate flex items-center gap-1.5">
                        <span>${escapeHtml(item.label)}</span>
                        <span class="text-[9px] font-mono font-black text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 rounded-md">${item.duration}m</span>
                    </div>
                    <div class="text-[10px] text-gray-400 font-mono mt-0.5">
                        Duration: ${item.duration} minute${item.duration === 1 ? '' : 's'}
                    </div>
                </div>
            </div>
            <button type="button" onclick="window.removeAdminBreakPeriod && window.removeAdminBreakPeriod('${item.id}')" class="w-7 h-7 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 flex items-center justify-center transition active:scale-95 cursor-pointer shrink-0" title="Delete break option">
                <i class="fa-solid fa-trash-can text-[10px]"></i>
            </button>
        </div>
    `).join('');
}

export function addAdminBreakPeriod() {
    if (!editingBreakPeriods) editingBreakPeriods = JSON.parse(JSON.stringify(getBreakPeriods()));

    const durInput = document.getElementById('admin-new-break-duration');
    const labelInput = document.getElementById('admin-new-break-label');

    const duration = durInput ? parseInt(durInput.value, 10) : 0;
    if (isNaN(duration) || duration <= 0 || duration > 300) {
        return showToast("⚠️ Please enter a valid break duration between 1 and 300 minutes.");
    }

    let label = labelInput ? labelInput.value.trim() : "";
    if (!label) {
        label = `${duration}m Break`;
    }

    const id = `bp_${duration}_${Date.now()}`;
    const icon = getIconForDuration(duration);

    editingBreakPeriods.push({ id, label, duration, icon });
    editingBreakPeriods.sort((a, b) => a.duration - b.duration);

    renderAdminBreakPeriodsList();

    if (durInput) durInput.value = "";
    if (labelInput) labelInput.value = "";

    showToast(`➕ Added "${label}" (${duration}m) to break options.`);
}

export function removeAdminBreakPeriod(periodId) {
    if (!editingBreakPeriods) editingBreakPeriods = JSON.parse(JSON.stringify(getBreakPeriods()));

    if (editingBreakPeriods.length <= 1) {
        return showToast("⚠️ At least one break period option must remain available.");
    }

    editingBreakPeriods = editingBreakPeriods.filter(p => p.id !== periodId);
    renderAdminBreakPeriodsList();
    showToast("🗑️ Break option removed.");
}

export function resetAdminBreakPeriodsToDefault() {
    editingBreakPeriods = JSON.parse(JSON.stringify(DEFAULT_BREAK_PERIODS));
    const allowanceInput = document.getElementById('admin-daily-break-allowance');
    if (allowanceInput) allowanceInput.value = "60";
    renderAdminBreakPeriodsList();
    showToast("Restored default break period options (60m daily allowance).");
}

export async function saveAdminBreakSettings() {
    if (!isAdmin() && !hasTlPermission('canManageBreakSettings')) {
        return showToast("⚠️ Unauthorized: Admin access required.");
    }

    if (!editingBreakPeriods || editingBreakPeriods.length === 0) {
        return showToast("⚠️ Please configure at least one break period option.");
    }

    const allowanceInput = document.getElementById('admin-daily-break-allowance');
    const allowanceMins = allowanceInput ? Math.max(5, parseInt(allowanceInput.value, 10) || 60) : 60;

    const payload = {
        dailyAllowanceMinutes: allowanceMins,
        periods: normalizeBreakPeriods(editingBreakPeriods)
    };

    globalState.breakSettings = payload;
    globalState.breakPeriods = payload.periods;

    try {
        localStorage.setItem('lokalex_break_settings', JSON.stringify(payload));
        localStorage.setItem('lokalex_break_periods', JSON.stringify(payload.periods));
    } catch(e) {}

    if (db) {
        try {
            await db.ref('settings/breakPeriods').set(payload);
            showToast(`⚙️ Break settings saved (${allowanceMins}m daily allowance, ${payload.periods.length} choices)!`);
            showSideNotification("BREAK RULES SAVED", `Daily allowance: ${allowanceMins}m • Options: ${payload.periods.length}`, "fa-mug-hot", "text-amber-400", "border-amber-500");
        } catch(e) {
            console.error("Failed to save break settings:", e);
            showToast("❌ Failed to save break settings to cloud.");
        }
    }

    closeAdminBreakSettingsModal();
    updateRosterUI();
}

// ============================================================================
// RIDER BREAK PERIOD SELECTION MODAL
// ============================================================================

export function openRiderBreakModal(targetRiderId = null, targetRiderName = null) {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const isTargetingOther = targetRiderId && targetRiderId.toString().trim() !== myId;
    const tId = isTargetingOther ? targetRiderId.toString().trim() : myId;
    const tName = isTargetingOther ? targetRiderName : (appState.riderName || "Rider");

    const rosterMembers = globalState.rosterMembers || [];
    const targetRecord = rosterMembers.find(m => (m.telegramId || m.id || "").toString().trim() === tId);

    if (targetRecord && targetRecord.status === 'End') {
        return showToast(`⚠️ ${isTargetingOther ? tName + ' is' : 'You are'} on End Shift. Only the Available button can be clicked.`);
    }

    if (targetRecord && targetRecord.status === 'Break') {
        return showToast(`ℹ️ ${isTargetingOther ? tName + ' is' : 'You are'} already on Break. Click Available to resume duty.`);
    }

    if (!isTargetingOther) {
        const activeCustList = getActiveCateringCustomersWithTimes();
        if (activeCustList.length > 0) {
            return showToast("⚠️ You have active catering deliveries. Please complete or release them before taking a break.");
        }
    }

    const userIsAdmin = isAdmin() || hasTlPermission('canForceStatus');
    const usage = getRiderBreakUsageToday(tId);

    // If non-admin has exhausted their daily break allowance:
    if (!userIsAdmin && usage.remainingMinutes <= 0) {
        return showToast(`⚠️ Daily break limit reached! You have used all ${usage.totalAllowance}m of your break time for today. Break time refreshes tomorrow.`);
    }

    const modal = document.getElementById('rider-break-period-modal');
    if (!modal) return;

    renderRiderBreakPeriodChoices(targetRiderId, targetRiderName);
    modal.classList.remove('hidden');
}

export function closeRiderBreakModal() {
    const modal = document.getElementById('rider-break-period-modal');
    if (modal) modal.classList.add('hidden');
}

export function renderRiderBreakPeriodChoices(targetRiderId = null, targetRiderName = null) {
    const listEl = document.getElementById('rider-break-period-list');
    const titleEl = document.getElementById('rider-break-modal-title');
    const subtitleEl = document.getElementById('rider-break-modal-subtitle');
    const statsEl = document.getElementById('rider-break-modal-stats');
    if (!listEl) return;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const isTargetingOther = targetRiderId && targetRiderId.toString().trim() !== myId;
    const rId = isTargetingOther ? targetRiderId.toString().trim() : myId;
    const rName = isTargetingOther ? targetRiderName : (appState.riderName || "Rider");

    const userIsAdmin = isAdmin() || hasTlPermission('canForceStatus');
    const usage = getRiderBreakUsageToday(rId);
    const periods = getBreakPeriods();
    const now = Date.now();

    if (titleEl) {
        titleEl.innerText = isTargetingOther ? `Force Break: ${rName}` : `Take a Break`;
    }

    if (subtitleEl) {
        subtitleEl.innerText = isTargetingOther ? `Admin override break for ${rName}` : `Select break duration`;
    }

    if (statsEl) {
        if (userIsAdmin && isTargetingOther) {
            statsEl.innerHTML = `
                <div class="bg-amber-950/20 border border-amber-500/30 p-2.5 rounded-2xl flex items-center justify-between text-xs">
                    <span class="text-gray-300">Target Rider: <strong class="text-white">${escapeHtml(rName)}</strong></span>
                    <span class="text-amber-400 font-mono font-bold">Remaining Today: ${usage.remainingMinutes}m / ${usage.totalAllowance}m</span>
                </div>`;
        } else if (usage.isUnlimited) {
            statsEl.innerHTML = `
                <div class="bg-purple-950/20 border border-purple-500/30 p-2.5 rounded-2xl flex items-center justify-between text-xs font-bold text-purple-400">
                    <span class="flex items-center gap-1.5"><i class="fa-solid fa-infinity"></i> Unlimited Break Active</span>
                    <span class="text-[10px] font-mono">No time cap</span>
                </div>`;
        } else {
            const perc = Math.min(100, Math.round((usage.usedMinutes / usage.totalAllowance) * 100));
            statsEl.innerHTML = `
                <div class="bg-darkBg border border-gray-800 p-2.5 rounded-2xl flex flex-col gap-1.5">
                    <div class="flex justify-between items-center text-[10px] font-bold">
                        <span class="text-gray-400">Today's Break Allowance: <strong class="text-white">${usage.totalAllowance}m</strong></span>
                        <span class="${usage.remainingMinutes <= 0 ? 'text-red-400 font-black' : 'text-amber-400 font-mono font-bold'}">Remaining: ${usage.remainingMinutes}m</span>
                    </div>
                    <div class="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                        <div class="h-full ${usage.remainingMinutes <= 0 ? 'bg-red-500' : 'bg-amber-500'}" style="width: ${perc}%"></div>
                    </div>
                    <div class="flex justify-between text-[9px] text-gray-400 font-mono">
                        <span>Used today: ${usage.usedMinutes}m</span>
                        <span>Leftover time is saved for next break</span>
                    </div>
                </div>`;
        }
    }

    let cardsHtml = "";

    // 1. ADMIN UNLIMITED BREAK OPTION:
    // Visible if caller is Admin or TL with force permission (whether for themselves or targeting another rider)
    if (userIsAdmin) {
        cardsHtml += `
            <button type="button" onclick="window.confirmRiderBreakChoice && window.confirmRiderBreakChoice('unlimited', true, '${rId}', '${escapeHtml(rName)}')" class="w-full bg-purple-950/30 hover:bg-purple-900/40 border border-purple-500/50 hover:border-purple-400 p-3 rounded-2xl flex items-center justify-between text-left transition group active:scale-[0.98] cursor-pointer shadow-xs">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-300 flex items-center justify-center text-sm font-bold border border-purple-500/40 group-hover:scale-110 transition shrink-0">
                        <i class="fa-solid fa-infinity"></i>
                    </div>
                    <div>
                        <div class="font-bold text-xs text-purple-300 flex items-center gap-2">
                            <span>♾️ Unlimited Break</span>
                            <span class="text-[9px] font-mono font-black text-purple-300 bg-purple-500/25 border border-purple-500/50 px-1.5 py-0.2 rounded-md">Admin Option</span>
                        </div>
                        <div class="text-[10px] text-purple-400/80 mt-0.5 flex items-center gap-1 font-mono">
                            <i class="fa-regular fa-clock text-[9px]"></i> No duration limit • Not deducted from daily quota
                        </div>
                    </div>
                </div>
                <div class="text-purple-400 group-hover:translate-x-1 transition text-xs font-bold shrink-0">
                    <i class="fa-solid fa-chevron-right"></i>
                </div>
            </button>
        `;
    }

    // 2. If rider has 0 remaining break time and is not admin:
    if (!userIsAdmin && usage.remainingMinutes <= 0) {
        listEl.innerHTML = `
            ${cardsHtml}
            <div class="p-4 rounded-2xl bg-red-950/30 border border-red-500/30 text-center flex flex-col items-center gap-2">
                <div class="w-10 h-10 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center text-lg">
                    <i class="fa-solid fa-ban"></i>
                </div>
                <div class="text-xs font-bold text-white">Daily Break Time Limit Reached</div>
                <p class="text-[10px] text-gray-300 max-w-xs leading-relaxed">
                    You have used all <strong>${usage.totalAllowance} minutes</strong> of your available break time for today. Break time refreshes automatically tomorrow.
                </p>
            </div>
        `;
        return;
    }

    // 3. Render standard options:
    const remaining = usage.remainingMinutes;
    let hasExactRemainingOption = false;

    const periodCards = periods.map(period => {
        const isAllowed = userIsAdmin || period.duration <= remaining;
        const returnTimestamp = now + (period.duration * 60000);
        const returnTimeStr = new Date(returnTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const icon = period.icon || getIconForDuration(period.duration);

        if (period.duration === remaining) hasExactRemainingOption = true;

        if (!isAllowed) {
            return `
                <div class="w-full bg-darkBg opacity-50 border border-gray-800 p-2.5 rounded-2xl flex items-center justify-between text-left cursor-not-allowed">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-xl bg-gray-800 text-gray-500 flex items-center justify-center text-sm font-bold shrink-0">
                            <i class="fa-solid ${icon}"></i>
                        </div>
                        <div>
                            <div class="font-bold text-xs text-gray-500 flex items-center gap-2">
                                <span>${escapeHtml(period.label)}</span>
                                <span class="text-[9px] font-mono text-gray-600 bg-gray-800 px-1.5 py-0.2 rounded-md">${period.duration} mins</span>
                            </div>
                            <div class="text-[10px] text-red-400/80 mt-0.5">
                                Exceeds remaining break allowance (${remaining}m left)
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <button type="button" onclick="window.confirmRiderBreakChoice && window.confirmRiderBreakChoice('${period.id}', false, '${rId}', '${escapeHtml(rName)}')" class="w-full bg-darkBg hover:bg-amber-500/10 border border-gray-200 dark:border-gray-800 hover:border-amber-500/60 p-3 rounded-2xl flex items-center justify-between text-left transition group active:scale-[0.98] cursor-pointer">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-500 dark:text-amber-400 flex items-center justify-center text-sm font-bold border border-amber-500/20 group-hover:scale-110 transition shrink-0">
                        <i class="fa-solid ${icon}"></i>
                    </div>
                    <div>
                        <div class="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-2">
                            <span>${escapeHtml(period.label)}</span>
                            <span class="text-[9px] font-mono font-black text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 px-1.5 py-0.2 rounded-md">${period.duration} mins</span>
                        </div>
                        <div class="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1 font-mono">
                            <i class="fa-regular fa-clock text-[9px]"></i> Back at ${returnTimeStr}
                        </div>
                    </div>
                </div>
                <div class="text-amber-500 group-hover:translate-x-1 transition text-xs font-bold shrink-0">
                    <i class="fa-solid fa-chevron-right"></i>
                </div>
            </button>
        `;
    }).join('');

    cardsHtml += periodCards;

    // 4. Custom option for using exactly all remaining minutes if not already in list:
    if (!userIsAdmin && remaining > 0 && !hasExactRemainingOption && remaining < usage.totalAllowance) {
        const returnTimestamp = now + (remaining * 60000);
        const returnTimeStr = new Date(returnTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        cardsHtml += `
            <button type="button" onclick="window.confirmRiderBreakChoice && window.confirmRiderBreakChoice('remaining_all', false, '${rId}', '${escapeHtml(rName)}')" class="w-full bg-amber-950/20 hover:bg-amber-900/30 border border-amber-500/40 hover:border-amber-500 p-3 rounded-2xl flex items-center justify-between text-left transition group active:scale-[0.98] cursor-pointer">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center text-sm font-bold border border-amber-500/30 group-hover:scale-110 transition shrink-0">
                        <i class="fa-solid fa-hourglass-half"></i>
                    </div>
                    <div>
                        <div class="font-bold text-xs text-amber-400 flex items-center gap-2">
                            <span>Use All Remaining Break Time</span>
                            <span class="text-[9px] font-mono font-black text-amber-300 bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.2 rounded-md">${remaining} mins</span>
                        </div>
                        <div class="text-[10px] text-amber-300/80 mt-0.5 flex items-center gap-1 font-mono">
                            <i class="fa-regular fa-clock text-[9px]"></i> Back at ${returnTimeStr}
                        </div>
                    </div>
                </div>
                <div class="text-amber-400 group-hover:translate-x-1 transition text-xs font-bold shrink-0">
                    <i class="fa-solid fa-chevron-right"></i>
                </div>
            </button>
        `;
    }

    listEl.innerHTML = cardsHtml;
}

export async function confirmRiderBreakChoice(periodId, isUnlimited = false, targetRiderId = null, targetRiderName = null) {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const isTargetingOther = targetRiderId && targetRiderId.toString().trim() !== myId;
    const tId = isTargetingOther ? targetRiderId.toString().trim() : myId;
    const tName = isTargetingOther ? targetRiderName : (appState.riderName || localStorage.getItem('riderName') || 'Rider');
    const todayStr = getLocalTodayStr();
    const userIsAdmin = isAdmin() || hasTlPermission('canForceStatus');

    closeRiderBreakModal();
    if (typeof window.dismissQueueAlarm === 'function') {
        window.dismissQueueAlarm();
    }

    const now = Date.now();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isUnlimited) {
        await updateRosterStatus('Break', tId, tName, null, false, {
            breakTimestamp: now,
            breakStartTime: timeStr,
            breakDurationMinutes: null,
            breakDurationLabel: 'Unlimited Break',
            breakTargetTimestamp: null,
            isUnlimitedBreak: true,
            breakDate: todayStr
        });

        showToast(`♾️ Unlimited Break started for ${tName}!`);
        showSideNotification("BREAK STARTED", `${tName} placed on Unlimited Break`, "fa-infinity", "text-purple-400", "border-purple-500");
        return;
    }

    const usage = getRiderBreakUsageToday(tId);
    let chosenDuration = 15;
    let chosenLabel = "Quick Break";

    if (periodId === 'remaining_all') {
        chosenDuration = usage.remainingMinutes;
        chosenLabel = `Remaining Break (${chosenDuration}m)`;
    } else {
        const periods = getBreakPeriods();
        const found = periods.find(p => p.id === periodId);
        if (found) {
            chosenDuration = found.duration;
            chosenLabel = found.label;
        }
    }

    // Cap duration to remaining break time for non-admins
    if (!userIsAdmin && chosenDuration > usage.remainingMinutes) {
        chosenDuration = usage.remainingMinutes;
        chosenLabel = `Remaining Break (${chosenDuration}m)`;
    }

    if (chosenDuration <= 0) {
        return showToast("⚠️ No remaining break time available for today.");
    }

    const targetTimestamp = now + (chosenDuration * 60000);
    const targetTimeStr = new Date(targetTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    await updateRosterStatus('Break', tId, tName, null, false, {
        breakTimestamp: now,
        breakStartTime: timeStr,
        breakDurationMinutes: chosenDuration,
        breakDurationLabel: chosenLabel,
        breakTargetTimestamp: targetTimestamp,
        isUnlimitedBreak: false,
        breakDate: todayStr
    });

    showToast(`☕ Break started: ${chosenLabel} (${chosenDuration} mins). Back at ${targetTimeStr}!`);
    showSideNotification("BREAK STARTED", `${tName}: ${chosenLabel} - Back at ${targetTimeStr}`, "fa-mug-hot", "text-amber-400", "border-amber-500");
}

// ============================================================================
// AUTOMATIC BREAK MONITOR & EXPIRY ENFORCEMENT
// ============================================================================

export function checkAndExpireRiderBreaks() {
    const rosterMembers = globalState.rosterMembers || [];
    const breakRiders = rosterMembers.filter(m => m.status === 'Break');
    if (breakRiders.length === 0) return;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();

    breakRiders.forEach(rider => {
        const rId = (rider.telegramId || rider.id || "").toString().trim();
        const rName = rider.riderName || rider.name || "Rider";
        const isUnlimited = !!rider.isUnlimitedBreak;

        if (isUnlimited) return; // Unlimited break has no timeout

        const elapsedMins = getElapsedBreakMinutes(rider);
        const plannedMins = rider.breakDurationMinutes ? parseInt(rider.breakDurationMinutes, 10) : null;

        // If rider has used all available break time, they cannot remain in break mode!
        if (plannedMins && elapsedMins >= plannedMins) {
            console.log(`[Break Monitor] Rider ${rName} (${rId}) reached planned break duration (${elapsedMins}m / ${plannedMins}m). Auto-returning to Available.`);
            
            updateRosterStatus('Available', rId, rName);

            if (rId === myId) {
                showToast("⏰ Break Time Finished! You have reached your break limit and were moved back to Available.");
                showSideNotification("BREAK FINISHED", "Your break has concluded. You are back in line.", "fa-clock", "text-amber-400", "border-amber-500");
            }
        }
    });
}

listenToBreakSettings();

if (typeof window !== 'undefined') {
    window.openAdminBreakSettingsModal = openAdminBreakSettingsModal;
    window.closeAdminBreakSettingsModal = closeAdminBreakSettingsModal;
    window.renderAdminBreakPeriodsList = renderAdminBreakPeriodsList;
    window.addAdminBreakPeriod = addAdminBreakPeriod;
    window.removeAdminBreakPeriod = removeAdminBreakPeriod;
    window.resetAdminBreakPeriodsToDefault = resetAdminBreakPeriodsToDefault;
    window.saveAdminBreakSettings = saveAdminBreakSettings;
    window.openRiderBreakModal = openRiderBreakModal;
    window.closeRiderBreakModal = closeRiderBreakModal;
    window.renderRiderBreakPeriodChoices = renderRiderBreakPeriodChoices;
    window.confirmRiderBreakChoice = confirmRiderBreakChoice;
    window.getRiderBreakUsageToday = getRiderBreakUsageToday;
    window.checkAndExpireRiderBreaks = checkAndExpireRiderBreaks;
}
