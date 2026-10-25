// src/features/roster/rosterAdmin.js

/**
 * ============================================================================
 * ROSTER ADMINISTRATIVE CONTROLS & SETTINGS ORCHESTRATOR
 * ============================================================================
 * 
 * Description:
 * Administrative control suite and modal orchestration for Team Leads and Admins:
 * - Lineup management, force catering, queue shifting, and cascading record voids[cite: 38].
 * - Early Shift Out Penalty controls: 8-hour baseline, per-rider daily duty hours,
 *   and 1-day temporary early out exemptions[cite: 30, 38].
 * - Directory Credit settings modal dialog controller and global listener[cite: 38].
 * - Toggle switch coordinator syncing all admin toolbar buttons in real time[cite: 38].
 * ============================================================================
 */

import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { API_URL } from '../../config/constants.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal, closeAdminCateringModal } from '../../ui/modals.js';
import { isSameDate, escapeHtml, getLocalTodayStr, sanitizeFirebaseKey } from '../../utils/helpers.js';
import { populateCateringCustomerDropdown } from '../chat/index.js';
import { 
    parseQueueTime, 
    isAdmin, 
    canManageRoster, 
    hasTlPermission, 
    canForceCaterTarget, 
    archiveRiderCateringIfNeeded, 
    saveRosterCache 
} from './rosterUtils.js';
import { updateRosterUI } from './rosterUI.js';
import { getTopQueueTime, updateRosterStatus, updateRosterStatusData, voidSingleCateringCustomer, clockOutRider } from './rosterStatus.js';
import { 
    adminForceStatus as opsAdminForceStatus, 
    adminVoidSpecificCustomer as opsAdminVoidSpecificCustomer, 
    submitAdminForceCatering as opsSubmitAdminForceCatering,
    promptVoidCustomer as opsPromptVoidCustomer,
    executeVoidCateredCustomer as opsExecuteVoidCateredCustomer
} from './rosterAdminOps.js';

import {
    openAdminTimeInScheduleModal,
    closeAdminTimeInScheduleModal,
    renderAdminTimeInScheduleList,
    grantRiderEarlyPass,
    revokeRiderEarlyPass,
    saveAdminTimeInScheduleSettings,
    listenToTimeInSchedule
} from './rosterSchedule.js';

import {
    openRiderDayOffModal,
    closeRiderDayOffModal,
    renderRiderDayOffPicker,
    selectRiderDayOff,
    openAdminDayOffSettingsModal,
    closeAdminDayOffSettingsModal,
    renderAdminDayOffSettingsList,
    adminReassignRiderDayOff,
    saveAdminDayOffSettings,
    listenToDayOffData
} from './rosterDayOff.js';

import {
    openAdminBookingLimitsModal,
    closeAdminBookingLimitsModal,
    toggleBookingLimitsModeUI,
    saveAdminBookingLimitsSettings,
    listenToBookingLimits
} from './rosterBookingLimits.js';

import {
    openAdminAutoEndShiftModal,
    closeAdminAutoEndShiftModal,
    saveAdminAutoEndShiftSettings,
    startAutoEndShiftScheduler,
    listenToAutoEndShift,
    checkAndTriggerAutoEndShift,
    executeAutoEndShift
} from './rosterAutoEndShift.js';

import {
    openAdminDirectoryCreditsModal,
    closeAdminDirectoryCreditsModal,
    saveAdminDirectoryCreditsSettings,
    promptAdjustRiderCredits,
    listenToDirectoryCreditsSettings
} from './rosterAccounts.js';

export * from './rosterSchedule.js';
export * from './rosterDayOff.js';
export * from './rosterBookingLimits.js';
export * from './rosterAutoEndShift.js';
export * from './rosterAccounts.js';

let pendingAdminTarget = null;

// ============================================================================
// 1. EARLY SHIFT OUT PENALTY & PER-RIDER DUTY CONTROLS
// ============================================================================

export function openAdminEarlyShiftModal() {
    if (!isAdmin() && !hasTlPermission('canManageEarlyShift')) return showToast("⚠️ Unauthorized: Admin or authorized TL access required.");
    const modal = document.getElementById('admin-early-shift-modal');
    if (!modal) return;

    const config = globalState.earlyShiftPenaltyConfig || {
        enabled: true,
        targetHours: 8,
        penaltyPerMissingHour: 2.5,
        capEnabled: true,
        maxPenaltyPercentage: 10,
        gracePeriodMinutes: 15,
        riderTargets: {},
        exemptions: {}
    };

    const enabledToggle = document.getElementById('admin-early-shift-enabled');
    const targetHoursInput = document.getElementById('admin-early-shift-target-hours');
    const rateInput = document.getElementById('admin-early-shift-rate-input');
    const capToggle = document.getElementById('admin-early-shift-cap-toggle');
    const maxCapInput = document.getElementById('admin-early-shift-max-cap-input');
    const graceInput = document.getElementById('admin-early-shift-grace-input');

    if (enabledToggle) enabledToggle.checked = config.enabled !== false;
    if (targetHoursInput) targetHoursInput.value = config.targetHours || 8;
    if (rateInput) rateInput.value = config.penaltyPerMissingHour || 2.5;
    if (capToggle) capToggle.checked = config.capEnabled !== false;
    if (maxCapInput) maxCapInput.value = config.maxPenaltyPercentage || 10;
    if (graceInput) graceInput.value = config.gracePeriodMinutes !== undefined ? config.gracePeriodMinutes : 15;

    renderAdminEarlyShiftRidersList();
    modal.classList.remove('hidden');
}

export function closeAdminEarlyShiftModal() {
    const modal = document.getElementById('admin-early-shift-modal');
    if (modal) modal.classList.add('hidden');
}

export function renderAdminEarlyShiftRidersList() {
    const container = document.getElementById('admin-early-shift-riders-list');
    if (!container) return;

    const config = globalState.earlyShiftPenaltyConfig || {};
    const riderTargets = config.riderTargets || {};
    const exemptions = config.exemptions || {};
    const todayStr = getLocalTodayStr();

    const roster = globalState.rosterMembers || [];
    if (roster.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-4 text-xs">No active roster members found.</div>`;
        return;
    }

    container.innerHTML = roster.map(r => {
        const rId = (r.telegramId || r.id || "").toString().trim();
        const rName = r.riderName || r.name || `Rider #${rId}`;
        const currentTarget = riderTargets[rId] !== undefined ? riderTargets[rId] : "";
        const isExemptToday = exemptions[rId] && exemptions[rId].date === todayStr;

        const exemptBtnHtml = isExemptToday
            ? `<button type="button" onclick="window.toggleRiderEarlyShiftExemption && window.toggleRiderEarlyShiftExemption('${escapeHtml(rId)}', '${escapeHtml(rName)}', false)" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[9.5px] px-2.5 py-1.5 rounded-xl border border-emerald-400/40 shadow-xs transition active:scale-95 cursor-pointer flex items-center gap-1">
                <i class="fa-solid fa-shield-check"></i> Exempt Today
               </button>`
            : `<button type="button" onclick="window.toggleRiderEarlyShiftExemption && window.toggleRiderEarlyShiftExemption('${escapeHtml(rId)}', '${escapeHtml(rName)}', true)" class="bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white font-bold text-[9.5px] px-2.5 py-1.5 rounded-xl border border-gray-700 transition active:scale-95 cursor-pointer flex items-center gap-1">
                <i class="fa-solid fa-shield"></i> Grant Pass
               </button>`;

        return `
        <div class="bg-black/40 border border-gray-800 p-2.5 rounded-2xl flex items-center justify-between gap-2 shadow-xs text-xs">
            <div class="flex flex-col min-w-0 flex-1">
                <span class="font-bold text-white truncate flex items-center gap-1.5">
                    <i class="fa-solid fa-motorcycle text-red-400"></i> ${escapeHtml(rName)}
                </span>
                <span class="text-[9.5px] text-gray-400 font-mono">ID: ${escapeHtml(rId)}</span>
            </div>

            <div class="flex items-center gap-2 shrink-0">
                <div class="flex items-center gap-1 bg-gray-900 border border-gray-700 rounded-xl px-2 py-1">
                    <input type="number" step="0.5" min="1" max="24" 
                        id="early-shift-target-${escapeHtml(rId)}" 
                        placeholder="${config.targetHours || 8}" 
                        value="${currentTarget}" 
                        class="w-10 bg-transparent text-xs text-center font-bold font-mono text-amber-400 outline-none">
                    <span class="text-[9px] text-gray-400 font-bold">hrs</span>
                </div>
                ${exemptBtnHtml}
            </div>
        </div>`;
    }).join('');
}

export async function toggleRiderEarlyShiftExemption(riderId, riderName, grant) {
    if (!isAdmin() && !hasTlPermission('canManageEarlyShift')) return showToast("⚠️ Unauthorized: Admin or authorized TL access required.");
    if (!riderId) return;

    const todayStr = getLocalTodayStr();
    if (!globalState.earlyShiftPenaltyConfig) globalState.earlyShiftPenaltyConfig = {};
    if (!globalState.earlyShiftPenaltyConfig.exemptions) globalState.earlyShiftPenaltyConfig.exemptions = {};

    if (grant) {
        globalState.earlyShiftPenaltyConfig.exemptions[riderId] = {
            date: todayStr,
            grantedBy: appState.riderName || "Admin",
            grantedAt: Date.now()
        };
        showToast(`🛡️ Early Out Pass GRANTED to ${riderName} for today!`);
        showSideNotification("EARLY OUT PASS", `Temporary pass granted to ${riderName}`, "fa-shield-check", "text-emerald-400", "border-emerald-500");
    } else {
        delete globalState.earlyShiftPenaltyConfig.exemptions[riderId];
        showToast(`Revoked Early Out Pass for ${riderName}.`);
    }

    if (db) {
        await db.ref(`settings/earlyShiftPenalty/exemptions/${riderId}`).set(
            grant ? globalState.earlyShiftPenaltyConfig.exemptions[riderId] : null
        ).catch(() => {});
    }

    localStorage.setItem('lokalex_early_shift_penalty_config', JSON.stringify(globalState.earlyShiftPenaltyConfig));
    renderAdminEarlyShiftRidersList();
}

export async function saveAdminEarlyShiftSettings() {
    if (!isAdmin() && !hasTlPermission('canManageEarlyShift')) return showToast("⚠️ Unauthorized: Admin or authorized TL access required.");

    const enabledToggle = document.getElementById('admin-early-shift-enabled');
    const targetHoursInput = document.getElementById('admin-early-shift-target-hours');
    const rateInput = document.getElementById('admin-early-shift-rate-input');
    const capToggle = document.getElementById('admin-early-shift-cap-toggle');
    const maxCapInput = document.getElementById('admin-early-shift-max-cap-input');
    const graceInput = document.getElementById('admin-early-shift-grace-input');

    const updatedRiderTargets = {};
    const targetInputs = document.querySelectorAll('[id^="early-shift-target-"]');
    targetInputs.forEach(input => {
        const riderId = input.id.replace('early-shift-target-', '').trim();
        const valStr = input.value.trim();
        if (valStr !== "") {
            const valNum = parseFloat(valStr);
            if (!isNaN(valNum) && valNum > 0 && valNum <= 24) {
                updatedRiderTargets[riderId] = valNum;
            }
        }
    });

    const existingExemptions = globalState.earlyShiftPenaltyConfig?.exemptions || {};

    const payload = {
        enabled: enabledToggle ? enabledToggle.checked : true,
        targetHours: targetHoursInput ? Math.max(1, parseFloat(targetHoursInput.value) || 8) : 8,
        penaltyPerMissingHour: rateInput ? Math.max(0.1, parseFloat(rateInput.value) || 2.5) : 2.5,
        capEnabled: capToggle ? capToggle.checked : true,
        maxPenaltyPercentage: maxCapInput ? Math.max(1, parseFloat(maxCapInput.value) || 10) : 10,
        gracePeriodMinutes: graceInput ? Math.max(0, parseInt(graceInput.value, 10) || 15) : 15,
        riderTargets: updatedRiderTargets,
        exemptions: existingExemptions,
        updatedAt: Date.now(),
        updatedBy: appState.riderName || "Admin"
    };

    globalState.earlyShiftPenaltyConfig = payload;
    localStorage.setItem('lokalex_early_shift_penalty_config', JSON.stringify(payload));

    if (db) {
        try {
            await db.ref('settings/earlyShiftPenalty').set(payload);
            showToast("⚙️ Early Shift Out Penalty settings saved!");
            showSideNotification("PENALTY RULES SAVED", `8h check: ${payload.enabled ? 'ACTIVE' : 'DISABLED'}`, "fa-user-clock", "text-red-400", "border-red-500");
        } catch(e) {
            showToast("❌ Failed to save penalty settings to cloud.");
        }
    }

    closeAdminEarlyShiftModal();
}

export function listenToEarlyShiftSettings() {
    if (!db) return;

    try {
        const cached = localStorage.getItem('lokalex_early_shift_penalty_config');
        if (cached) globalState.earlyShiftPenaltyConfig = JSON.parse(cached);
    } catch(e) {}

    db.ref('settings/earlyShiftPenalty').on('value', (snap) => {
        if (snap.exists()) {
            const data = snap.val();
            globalState.earlyShiftPenaltyConfig = data;
            localStorage.setItem('lokalex_early_shift_penalty_config', JSON.stringify(data));
        }
    });
}

// ============================================================================
// 2. ADMIN CONTROLS MASTER SWITCH & DOM SYNC
// ============================================================================

export function toggleAdminControls(enabled) {
    if (!canManageRoster()) {
        globalState.adminControlsEnabled = false;
        const toggle = document.getElementById('admin-controls-toggle');
        if (toggle) toggle.checked = false;
        showToast("⚠️ Unauthorized: Only Admin or authorized Team Lead (TL) can enable Admin Controls.");
        updateRosterUI();
        return;
    }

    globalState.adminControlsEnabled = !!enabled;

    const adminButtonPermissions = {
        'admin-store-hub-btn': 'canManageStoreAccounts',
        'admin-manage-riders-btn': 'canManageRiderAccounts',
        'admin-schedule-settings-btn': 'canManageSchedules',
        'admin-dayoff-settings-btn': 'canManageDayOff',
        'admin-queue-settings-btn': 'canManageQueueSettings',
        'admin-booking-limits-btn': 'canManageBookingLimits',
        'admin-commission-settings-btn': 'canManageCommission',
        'admin-credits-settings-btn': 'canManageCredits',
        'admin-early-shift-btn': 'canManageEarlyShift',
        'admin-auto-endshift-btn': 'canManageAutoEndShift',
        'admin-block-btn': 'canManageBanList',
        'admin-find-riders-btn': null,
        'admin-force-all-btn': 'canEndAllShifts',
        'admin-fb-settings-btn': 'canManageFbApis',
        'admin-fb-settings-roster-btn': 'canManageFbApis',
        'admin-clear-inbox-btn': 'canClearInbox',
        'admin-send-many-btn': 'canManageBroadcast',
        'admin-full-booking-btn': 'canManageFullBooking'
    };

    Object.entries(adminButtonPermissions).forEach(([btnId, permKey]) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            const hasPerm = !permKey || isAdmin() || hasTlPermission(permKey);
            if (enabled && hasPerm) btn.classList.remove('hidden');
            else btn.classList.add('hidden');
        }
    });

    showToast(`Admin Safety Controls: ${enabled ? 'ENABLED' : 'DISABLED'}`);
    updateRosterUI();
}

// ============================================================================
// 3. FORCE CATERING & STATUS OVERRIDES
// ============================================================================

export function openAdminCateringModal(id, name) {
    if (!hasTlPermission('canForceCater')) {
        return showToast("⚠️ Unauthorized: You do not have permission to Force Cater.");
    }

    const rosterMembers = globalState.rosterMembers || [];
    const targetRecord = rosterMembers.find(m => (m.telegramId || m.id || "").toString() === (id || "").toString());
    const targetType = targetRecord ? targetRecord.userType : "";

    if (id && !canForceCaterTarget(targetType, id)) {
        return showToast("⚠️ TL cannot force cater an Admin or another TL.");
    }

    pendingAdminTarget = { id, name };

    const idInput = document.getElementById('admin-cater-target-rider-id');
    const nameInputHidden = document.getElementById('admin-cater-target-rider-name');
    const custInput = document.getElementById('admin-cater-cust-name') || document.getElementById('catering-customer-name');
    const custSelect = document.getElementById('admin-cater-customer-select') || document.getElementById('catering-customer-select');
    const penaltySelect = document.getElementById('admin-cater-penalty-select') || document.getElementById('catering-penalty-select');

    if (idInput) idInput.value = id || "";
    if (nameInputHidden) nameInputHidden.value = name || "";
    if (custInput) custInput.value = "";
    if (penaltySelect) penaltySelect.value = "0";

    if (custSelect) {
        if (typeof populateCateringCustomerDropdown === 'function') {
            populateCateringCustomerDropdown(custSelect.id);
        }
    }

    const modal = document.getElementById('admin-catering-modal') || document.getElementById('catering-modal');
    if (modal) modal.classList.remove('hidden');
    if (custInput) custInput.focus();
}

export async function submitAdminForceCatering() {
    return opsSubmitAdminForceCatering();
}

export async function adminForceStatus(id, name, actionValue) {
    return opsAdminForceStatus(id, name, actionValue);
}

export async function adminVoidSpecificCustomer(targetId, targetName, custNameToVoid) {
    return opsAdminVoidSpecificCustomer(targetId, targetName, custNameToVoid);
}

export function promptVoidCustomer(riderName, customerName, completedDate = "", startTime = "", transactionId = "") {
    return opsPromptVoidCustomer(riderName, customerName, completedDate, startTime, transactionId);
}

export async function executeVoidCateredCustomer(riderName, customerName, completedDate = "", startTime = "", transactionId = "") {
    return opsExecuteVoidCateredCustomer(riderName, customerName, completedDate, startTime, transactionId);
}

export function adminShiftRiderQueue(riderId, moveAction) {
    if (!hasTlPermission('canShiftQueue')) {
        return showToast("⚠️ Unauthorized: You do not have permission to Shift Lineup.");
    }

    const availableRiders = globalState.rosterMembers ? globalState.rosterMembers.filter(m => m.status === 'Available').sort((a,b) => parseQueueTime(a.queueTime) - parseQueueTime(b.queueTime)) : [];
    const idx = availableRiders.findIndex(r => (r.telegramId || r.id || "").toString() === riderId.toString());

    if (idx === -1) return showToast("Rider must be in Available status to shift queue.");

    let targetQueueTime = parseQueueTime(availableRiders[idx].queueTime);
    const rider = availableRiders[idx];

    if (moveAction === 'move_top') {
        targetQueueTime = parseQueueTime(availableRiders[0].queueTime) - 1000;
    } else if (moveAction === 'move_bottom') {
        targetQueueTime = parseQueueTime(availableRiders[availableRiders.length - 1].queueTime) + 1000;
    } else if (moveAction === 'move_up' && idx > 0) {
        targetQueueTime = parseQueueTime(availableRiders[idx - 1].queueTime) - 100;
    } else if (moveAction === 'move_down' && idx < availableRiders.length - 1) {
        targetQueueTime = parseQueueTime(availableRiders[idx + 1].queueTime) + 100;
    } else {
        return showToast("Cannot move further in queue.");
    }

    updateRosterStatusData('Available', "", "", targetQueueTime, rider.telegramId, rider.riderName);
}

export async function forceAllEndShift() {
    if (!hasTlPermission('canEndAllShifts')) {
        return showToast("⚠️ Unauthorized: You do not have permission to Force End Shift for all riders.");
    }

    openSlideDeleteModal("Are you sure you want to force end shift for all riders?", async () => {
        const rosterMembers = globalState.rosterMembers || [];
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const nowTimestamp = Date.now();

        for (const m of rosterMembers) {
            const mId = (m.telegramId || m.id || "").toString().trim();
            if (mId) {
                await archiveRiderCateringIfNeeded(m);
                await clockOutRider(mId);

                if (db) {
                    db.ref('roster/' + mId).update({ 
                        status: 'End', 
                        customerName: "", 
                        startTime: "", 
                        pendingPenaltyMinutes: 0, 
                        cooldownUntil: 0,
                        forcedCaters: null,
                        forcedBy: null,
                        isForcedCater: false,
                        lastUpdated: timeStr,
                        lastActiveTimestamp: nowTimestamp
                    }).catch(() => {});
                }

                m.status = 'End';
                m.customerName = '';
                m.startTime = '';
                m.pendingPenaltyMinutes = 0;
                m.cooldownUntil = 0;
                m.forcedCaters = null;
                m.forcedBy = null;
                m.isForcedCater = false;
                m.lastUpdated = timeStr;
                m.lastActiveTimestamp = nowTimestamp;
            }
        }

        saveRosterCache();
        updateRosterUI();
        window.dispatchEvent(new CustomEvent('rosterUpdated'));
        window.dispatchEvent(new CustomEvent('loginsUpdated'));

        try {
            await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ type: "roster", action: "force_all_end", time: timeStr }) });
        } catch(e) {}
    });
}

listenToTimeInSchedule();
listenToDayOffData();
listenToBookingLimits();
listenToAutoEndShift();
listenToEarlyShiftSettings();
listenToDirectoryCreditsSettings();

if (typeof window !== 'undefined') {
    window.toggleAdminControls = toggleAdminControls;
    window.openAdminCateringModal = openAdminCateringModal;
    window.submitAdminForceCatering = submitAdminForceCatering;
    window.adminForceStatus = adminForceStatus;
    window.adminVoidSpecificCustomer = adminVoidSpecificCustomer;
    window.promptVoidCustomer = promptVoidCustomer;
    window.executeVoidCateredCustomer = executeVoidCateredCustomer;
    window.adminShiftRiderQueue = adminShiftRiderQueue;
    window.forceAllEndShift = forceAllEndShift;

    window.openAdminAutoEndShiftModal = openAdminAutoEndShiftModal;
    window.closeAdminAutoEndShiftModal = closeAdminAutoEndShiftModal;
    window.saveAdminAutoEndShiftSettings = saveAdminAutoEndShiftSettings;
    window.checkAndTriggerAutoEndShift = checkAndTriggerAutoEndShift;
    window.executeAutoEndShift = executeAutoEndShift;
    window.listenToAutoEndShift = listenToAutoEndShift;

    window.openAdminTimeInScheduleModal = openAdminTimeInScheduleModal;
    window.closeAdminTimeInScheduleModal = closeAdminTimeInScheduleModal;
    window.saveAdminTimeInScheduleSettings = saveAdminTimeInScheduleSettings;
    window.grantRiderEarlyPass = grantRiderEarlyPass;
    window.revokeRiderEarlyPass = revokeRiderEarlyPass;
    window.renderAdminTimeInScheduleList = renderAdminTimeInScheduleList;

    window.openRiderDayOffModal = openRiderDayOffModal;
    window.closeRiderDayOffModal = closeRiderDayOffModal;
    window.selectRiderDayOff = selectRiderDayOff;
    window.openAdminDayOffSettingsModal = openAdminDayOffSettingsModal;
    window.closeAdminDayOffSettingsModal = closeAdminDayOffSettingsModal;
    window.renderAdminDayOffSettingsList = renderAdminDayOffSettingsList;
    window.adminReassignRiderDayOff = adminReassignRiderDayOff;
    window.renderRiderDayOffPicker = renderRiderDayOffPicker;

    window.openAdminBookingLimitsModal = openAdminBookingLimitsModal;
    window.closeAdminBookingLimitsModal = closeAdminBookingLimitsModal;
    window.toggleBookingLimitsModeUI = toggleBookingLimitsModeUI;
    window.saveAdminBookingLimitsSettings = saveAdminBookingLimitsSettings;

    window.openAdminEarlyShiftModal = openAdminEarlyShiftModal;
    window.closeAdminEarlyShiftModal = closeAdminEarlyShiftModal;
    window.saveAdminEarlyShiftSettings = saveAdminEarlyShiftSettings;
    window.renderAdminEarlyShiftRidersList = renderAdminEarlyShiftRidersList;
    window.toggleRiderEarlyShiftExemption = toggleRiderEarlyShiftExemption;

    window.openAdminDirectoryCreditsModal = openAdminDirectoryCreditsModal;
    window.closeAdminDirectoryCreditsModal = closeAdminDirectoryCreditsModal;
    window.saveAdminDirectoryCreditsSettings = saveAdminDirectoryCreditsSettings;
    window.promptAdjustRiderCredits = promptAdjustRiderCredits;
}
// REMARKS: ROSTER_ADMIN_CUSTOM_DUTY_HOURS_AND_DAILY_EXEMPTIONS_V1_COMPLETE