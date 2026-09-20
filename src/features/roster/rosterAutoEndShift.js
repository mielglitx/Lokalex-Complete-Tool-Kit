// src/features/roster/rosterAutoEndShift.js

/**
 * ============================================================================
 * ROSTER AUTO END SHIFT & OVERNIGHT CATCH-UP SCHEDULER
 * ============================================================================
 * 
 * Description:
 * Automated shift termination and overnight cleanup controller for the Lokalex roster:
 * - Real-time Scheduled Execution: Triggers auto end-shift for all active riders
 *   at the designated daily cutoff time (e.g., 23:00 or 03:00).
 * - Overnight Catch-Up & Stale Shift Sweeper: Solves the static-hosting limitation
 *   where devices are closed during the scheduled cutoff. Automatically detects
 *   and clocks out lingering riders from prior dates the moment any user launches
 *   the application the following morning.
 * - Distributed Firebase Transactions: Prevents duplicate execution across
 *   multiple devices simultaneously launching the application.
 * - Attendance & History Archiving: Clocks out attendance login records and
 *   safely archives lingering catering orders.
 * ============================================================================
 */

import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { API_URL } from '../../config/constants.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { getLocalTodayStr, isSameDate } from '../../utils/helpers.js';
import { parseTimeToMinutes, isAdmin, archiveRiderCateringIfNeeded, saveRosterCache } from './rosterUtils.js';
import { updateRosterUI } from './rosterUI.js';
import { sanitizeForFirebase } from './rosterSchedule.js';

let autoEndShiftTimer = null;

export function openAdminAutoEndShiftModal() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");
    const modal = document.getElementById('admin-auto-endshift-modal');
    if (!modal) return;

    const data = globalState.autoEndShift || {};
    const enabledToggle = document.getElementById('auto-endshift-enabled');
    const timeInput = document.getElementById('auto-endshift-time');
    const statusDesc = document.getElementById('auto-endshift-status-desc');

    if (enabledToggle) enabledToggle.checked = !!data.enabled;
    if (timeInput) timeInput.value = data.time || "03:00";
    if (statusDesc) {
        statusDesc.innerText = data.enabled 
            ? `Active: Scheduled daily at ${data.time || '03:00'}`
            : "Disabled: No auto end shift will occur.";
    }

    modal.classList.remove('hidden');
}

export function closeAdminAutoEndShiftModal() {
    const modal = document.getElementById('admin-auto-endshift-modal');
    if (modal) modal.classList.add('hidden');
}

export async function saveAdminAutoEndShiftSettings() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");
    const enabledToggle = document.getElementById('auto-endshift-enabled');
    const timeInput = document.getElementById('auto-endshift-time');

    const isEnabled = enabledToggle ? enabledToggle.checked : false;
    let setTime = timeInput ? timeInput.value.trim() : "03:00";
    if (!setTime) setTime = "03:00";

    const payload = sanitizeForFirebase({
        enabled: Boolean(isEnabled),
        time: setTime,
        lastTriggeredSlot: "", // Cleared so updated schedule can trigger immediately
        lastTriggeredDate: "",
        updatedBy: appState.riderName || "Admin",
        updatedAt: Date.now()
    });

    globalState.autoEndShift = payload;
    try {
        localStorage.setItem('lokalex_auto_endshift_cache', JSON.stringify(payload));
    } catch(e) {}

    try {
        if (db) {
            await db.ref('settings/autoEndShift').set(payload);
        }

        closeAdminAutoEndShiftModal();
        showToast(`⚙️ Auto End Shift ${isEnabled ? `set to ${setTime}` : 'Disabled'}!`);
        showSideNotification("SETTINGS SAVED", `Auto End Shift: ${isEnabled ? setTime : 'DISABLED'}`, "fa-clock", "text-purple-400", "border-purple-500");
        checkAndTriggerAutoEndShift();
    } catch(e) {
        showToast("❌ Failed to update auto end shift settings.");
    }
}

export function startAutoEndShiftScheduler() {
    if (autoEndShiftTimer) clearInterval(autoEndShiftTimer);
    autoEndShiftTimer = setInterval(() => {
        checkAndTriggerAutoEndShift();
    }, 15000); // 15-second heartbeat
    checkAndTriggerAutoEndShift();
}

export function listenToAutoEndShift() {
    if (!db) return;

    try {
        const cached = localStorage.getItem('lokalex_auto_endshift_cache');
        if (cached) globalState.autoEndShift = JSON.parse(cached);
    } catch(e) {}

    db.ref('settings/autoEndShift').on('value', (snap) => {
        const data = snap.val();
        if (data) {
            globalState.autoEndShift = data;
            try {
                localStorage.setItem('lokalex_auto_endshift_cache', JSON.stringify(data));
            } catch(e) {}
            checkAndTriggerAutoEndShift();
        }
    });

    startAutoEndShiftScheduler();
}

/**
 * Sweeps and clocks out any riders whose active shifts originated on a prior calendar day.
 * Solves the overnight app closure issue when no users are active at midnight/scheduled cutoff.
 */
export async function sweepStaleShiftsFromPriorDays() {
    if (!db) return;
    const todayStr = getLocalTodayStr();

    try {
        const rosterSnap = await db.ref('roster').once('value');
        const dbRoster = rosterSnap.val() || {};
        let sweptCount = 0;
        const timeStr = "11:59 PM"; // End of previous day cutoff marker
        const nowTimestamp = Date.now();

        for (const riderId of Object.keys(dbRoster)) {
            const rider = dbRoster[riderId];
            if (!rider || rider.status === 'End') continue;

            // Determine date of current active shift
            let shiftDate = "";
            if (rider.lastActiveTimestamp) {
                const shiftD = new Date(rider.lastActiveTimestamp);
                const y = shiftD.getFullYear();
                const m = String(shiftD.getMonth() + 1).padStart(2, '0');
                const d = String(shiftD.getDate()).padStart(2, '0');
                shiftDate = `${y}-${m}-${d}`;
            }

            // If active shift is from yesterday or older, force end shift retroactively
            if (shiftDate && shiftDate !== todayStr) {
                sweptCount++;
                await archiveRiderCateringIfNeeded(rider);

                await db.ref(`roster/${riderId}`).update({
                    status: 'End',
                    customerName: '',
                    startTime: '',
                    pendingPenaltyMinutes: 0,
                    cooldownUntil: 0,
                    forcedCaters: null,
                    forcedBy: null,
                    isForcedCater: false,
                    lastUpdated: timeStr,
                    lastActiveTimestamp: nowTimestamp
                }).catch(() => {});

                // Close login attendance for the stale day
                try {
                    const loginSnap = await db.ref(`logins/${riderId}`).once('value');
                    const loginData = loginSnap.val();
                    if (loginData && loginData.date === shiftDate && !loginData.clockOutTime) {
                        await db.ref(`logins/${riderId}`).update({ clockOutTime: timeStr });
                    }
                } catch(e) {}

                // Update local memory
                const localMember = (globalState.rosterMembers || []).find(m => (m.telegramId || m.id || "").toString() === riderId.toString());
                if (localMember) {
                    localMember.status = 'End';
                    localMember.customerName = '';
                    localMember.startTime = '';
                    localMember.pendingPenaltyMinutes = 0;
                    localMember.cooldownUntil = 0;
                    localMember.forcedCaters = null;
                    localMember.forcedBy = null;
                    localMember.isForcedCater = false;
                }
            }
        }

        if (sweptCount > 0) {
            saveRosterCache();
            updateRosterUI();
            window.dispatchEvent(new CustomEvent('rosterUpdated'));
            showSideNotification("STALE SHIFTS CLEARED", `${sweptCount} overnight rider shift(s) automatically ended`, "fa-clock-rotate-left", "text-amber-400", "border-amber-500");
        }
    } catch(err) {
        console.warn("Prior day stale shift sweep notice:", err);
    }
}

export async function checkAndTriggerAutoEndShift() {
    if (!db) return;

    // 1. Always sweep stale shifts originating from previous calendar days
    await sweepStaleShiftsFromPriorDays();

    // 2. Evaluate current day scheduled auto-end shift
    try {
        const config = globalState.autoEndShift;
        if (!config || !config.enabled || !config.time) return;

        const todayStr = getLocalTodayStr();
        const currentSlotKey = `${todayStr}_${config.time}`;

        if (config.lastTriggeredSlot === currentSlotKey) return;

        const targetMins = parseTimeToMinutes(config.time);
        if (targetMins === null) return;

        const now = new Date();
        const currentTotalMins = (now.getHours() * 60) + now.getMinutes();

        // Check if current time has crossed the scheduled cutoff time today
        if (currentTotalMins >= targetMins) {
            let committed = false;
            await db.ref('settings/autoEndShift').transaction((current) => {
                if (!current || !current.enabled) return;
                if (current.lastTriggeredSlot === currentSlotKey) return;
                current.lastTriggeredSlot = currentSlotKey;
                current.lastTriggeredDate = todayStr;
                committed = true;
                return current;
            });

            if (committed) {
                if (!globalState.autoEndShift) globalState.autoEndShift = {};
                globalState.autoEndShift.lastTriggeredSlot = currentSlotKey;
                globalState.autoEndShift.lastTriggeredDate = todayStr;
                try {
                    localStorage.setItem('lokalex_auto_endshift_cache', JSON.stringify(globalState.autoEndShift));
                } catch(e) {}

                await executeAutoEndShift();
            }
        }
    } catch(e) {
        console.error("Auto end shift evaluation error:", e);
    }
}

export async function executeAutoEndShift() {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const nowTimestamp = Date.now();

    showSideNotification("AUTO END SHIFT", "System auto end shift triggered for all active riders", "fa-power-off", "text-red-400", "border-red-500");

    try {
        if (db) {
            const rosterSnap = await db.ref('roster').once('value');
            const dbRoster = rosterSnap.val() || {};

            for (const riderId of Object.keys(dbRoster)) {
                const m = dbRoster[riderId];
                if (m && m.status !== 'End') {
                    await archiveRiderCateringIfNeeded(m);
                    await db.ref('roster/' + riderId).update({
                        status: 'End',
                        customerName: '',
                        startTime: '',
                        pendingPenaltyMinutes: 0,
                        cooldownUntil: 0,
                        forcedCaters: null,
                        forcedBy: null,
                        isForcedCater: false,
                        lastUpdated: timeStr,
                        lastActiveTimestamp: nowTimestamp
                    }).catch(() => {});

                    await db.ref('logins/' + riderId).update({
                        clockOutTime: timeStr
                    }).catch(() => {});
                }
            }
        }

        const rosterMembers = globalState.rosterMembers || [];
        rosterMembers.forEach(m => {
            if (m && m.status !== 'End') {
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
        });

        saveRosterCache();
        updateRosterUI();
        window.dispatchEvent(new CustomEvent('rosterUpdated'));
        window.dispatchEvent(new CustomEvent('loginsUpdated'));

        try {
            await fetch(API_URL, {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify({ type: "roster", action: "auto_end_shift", time: timeStr })
            });
        } catch(e) {}
    } catch(err) {
        console.error("Execute auto end shift error:", err);
    }
}