// src/features/roster/rosterStatusCore.js

/**
 * ============================================================================
 * ROSTER STATUS CORE ENGINE & ATTENDANCE LIFECYCLE
 * ============================================================================
 * 
 * Description:
 * Core state machine governing rider status mutations across the Lokalex platform:
 * - Queue Preservation: Completely protects on-duty riders from losing their
 *   first-in-line position or restarting their cooldown when tapping "Available".
 * - Scoped Role Integrity: Passes `(tId, tName)` to `getUserType()` to prevent
 *   admin sessions from overriding rider roles with "admin".
 * - Direct updates and local/remote synchronization to Firebase Realtime Database.
 * - Manages shift login generation, shift clock-outs, and delivery archiving.
 * ============================================================================
 */

import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { getLocalTodayStr } from '../../utils/helpers.js';
import { showToast } from '../../ui/notifications.js';
import { 
    parseQueueTime, 
    getUserType, 
    saveRosterCache, 
    archiveRiderCateringIfNeeded, 
    isSameDateStr 
} from './rosterUtils.js';
import { updateRosterUI } from './rosterUI.js';

export async function updateRosterStatus(status, targetId = null, targetName = null, precalculatedQueueTime = null) {
    const tId = (targetId || appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const tName = targetName || appState.riderName || localStorage.getItem('riderName') || "Rider";
    const rosterMembers = globalState.rosterMembers || [];

    const targetRecord = rosterMembers.find(m => (m.telegramId || m.id || "").toString() === tId);

    // IDEMPOTENCY GUARD: Do not reset queue time or restart cooldown if already Available
    if (status === 'Available' && targetRecord && targetRecord.status === 'Available') {
        showToast("ℹ️ Nakapila ka na (Already Available in line).");
        return;
    }

    let recordLogin = false;

    if (status !== 'Catering' && targetRecord) {
        await archiveRiderCateringIfNeeded(targetRecord);
    }

    if (status === 'End') {
        await clockOutRider(tId);
    }

    const isStartingShift = !targetRecord || !targetRecord.status || targetRecord.status === 'End';
    if (status === 'Available' && isStartingShift) {
        recordLogin = true;
    }

    let locationLink = "";
    if (appState.lat && appState.lon) {
        locationLink = `https://www.google.com/maps/search/?api=1&query=${appState.lat.toFixed(6)},${appState.lon.toFixed(6)}`;
    }

    let newQueueTime = precalculatedQueueTime !== null ? precalculatedQueueTime : 0;
    if (status === 'Available' && precalculatedQueueTime === null) {
        if (targetRecord && targetRecord.status === 'Available' && targetRecord.queueTime) {
            newQueueTime = parseQueueTime(targetRecord.queueTime);
        } else {
            const availableRiders = rosterMembers.filter(m => m.status === 'Available' && (m.telegramId || m.id || "").toString() !== tId);
            let maxTime = new Date().getTime();
            availableRiders.forEach(r => {
                const t = parseQueueTime(r.queueTime);
                if (t > maxTime) maxTime = t;
            });
            newQueueTime = maxTime + 1000;
        }
    }

    const nowTimestamp = Date.now();
    let accumulatedBreakMins = targetRecord?.totalBreakMinutes || 0;

    if (targetRecord && targetRecord.status === 'Break' && targetRecord.breakTimestamp) {
        const finishedBreakSession = Math.max(0, Math.floor((nowTimestamp - targetRecord.breakTimestamp) / 60000));
        accumulatedBreakMins += finishedBreakSession;
    }

    let extraData = {};
    if (status === 'Available') {
        const isAlreadyAvailable = targetRecord && targetRecord.status === 'Available';
        const preservedAvailableTs = isAlreadyAvailable 
            ? (targetRecord.availableTimestamp || targetRecord.queueTime || nowTimestamp)
            : nowTimestamp;

        extraData = { 
            forcedCaters: null,
            forcedBy: null,
            isForcedCater: false,
            breakTimestamp: null,
            breakStartTime: null,
            availableTimestamp: preservedAvailableTs,
            totalBreakMinutes: isStartingShift ? 0 : accumulatedBreakMins
        };
        if (isStartingShift) {
            extraData.commissionSurcharge = 0;
            extraData.earlyShiftDeficitHours = 0;
        }
    } else if (status === 'End') {
        extraData = { 
            forcedCaters: null,
            forcedBy: null,
            isForcedCater: false,
            breakTimestamp: null,
            breakStartTime: null,
            availableTimestamp: null,
            totalBreakMinutes: accumulatedBreakMins
        };
    } else if (status === 'Catering') {
        extraData = {
            breakTimestamp: null,
            breakStartTime: null,
            availableTimestamp: null,
            totalBreakMinutes: accumulatedBreakMins
        };
    } else if (status === 'Break') {
        extraData = {
            availableTimestamp: null,
            totalBreakMinutes: accumulatedBreakMins
        };
    }

    await updateRosterStatusData(status, "", "", newQueueTime, tId, tName, [], recordLogin, locationLink, extraData);
}

export async function updateRosterStatusData(status, customerName, startTime, queueTime = 0, specificId = null, specificName = null, completedHistory = [], recordLogin = false, locationLink = "", extraData = {}) {
    const tId = (specificId || appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const tName = specificName || appState.riderName || localStorage.getItem('riderName') || "Rider";

    if (!tId) return;

    const nowTimestamp = Date.now();
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const isMe = !specificId || specificId.toString().trim() === myId;
    const photoUrl = isMe 
        ? (appState.photoUrl || localStorage.getItem('lokalex_photo_url') || localStorage.getItem('riderPhotoUrl') || existingRec?.photoUrl || "")
        : (existingRec?.photoUrl || "");

    const isResetStatus = status === 'Available' || status === 'End';

    let currentForcedCaters = null;
    if (extraData.forcedCaters !== undefined) {
        currentForcedCaters = extraData.forcedCaters;
    } else if (!isResetStatus && existingRec?.forcedCaters) {
        currentForcedCaters = existingRec.forcedCaters;
    }

    let currentForcedBy = null;
    if (extraData.forcedBy !== undefined) {
        currentForcedBy = extraData.forcedBy;
    } else if (!isResetStatus && existingRec?.forcedBy) {
        currentForcedBy = existingRec.forcedBy;
    }

    let currentIsForcedCater = false;
    if (extraData.isForcedCater !== undefined) {
        currentIsForcedCater = !!extraData.isForcedCater;
    } else if (!isResetStatus && existingRec?.isForcedCater) {
        currentIsForcedCater = !!existingRec.isForcedCater;
    }

    let currentBreakTimestamp = null;
    let currentBreakStartTime = null;

    if (status === 'Break') {
        if (extraData.breakTimestamp !== undefined) {
            currentBreakTimestamp = extraData.breakTimestamp;
        } else if (existingRec && existingRec.status === 'Break' && existingRec.breakTimestamp) {
            currentBreakTimestamp = existingRec.breakTimestamp;
        } else {
            currentBreakTimestamp = nowTimestamp;
        }

        if (extraData.breakStartTime !== undefined) {
            currentBreakStartTime = extraData.breakStartTime;
        } else if (existingRec && existingRec.status === 'Break' && existingRec.breakStartTime) {
            currentBreakStartTime = existingRec.breakStartTime;
        } else {
            currentBreakStartTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }

    const currentTotalBreak = extraData.totalBreakMinutes !== undefined 
        ? extraData.totalBreakMinutes 
        : (existingRec?.totalBreakMinutes || 0);

    let currentAvailableTimestamp = null;
    if (status === 'Available') {
        if (extraData.availableTimestamp !== undefined) {
            currentAvailableTimestamp = extraData.availableTimestamp;
        } else if (existingRec && existingRec.status === 'Available') {
            currentAvailableTimestamp = existingRec.availableTimestamp || existingRec.queueTime || nowTimestamp;
        } else {
            currentAvailableTimestamp = nowTimestamp;
        }
    }

    let finalQueueTime = (queueTime !== null && queueTime !== undefined && queueTime !== 0) ? queueTime : nowTimestamp;
    if (status === 'Available' && (!queueTime || queueTime === 0) && existingRec && existingRec.status === 'Available' && existingRec.queueTime) {
        finalQueueTime = parseQueueTime(existingRec.queueTime);
    }

    const resolvedUserType = getUserType(tId, tName);

    const rosterData = {
        telegramId: tId.toString(),
        id: tId.toString(),
        riderName: tName,
        name: tName,
        photoUrl: photoUrl,
        userType: resolvedUserType,
        status: status,
        customerName: customerName || "",
        startTime: startTime || "",
        queueTime: finalQueueTime,
        availableTimestamp: currentAvailableTimestamp,
        lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        lastActiveTimestamp: nowTimestamp,
        lat: appState.lat || 0,
        lng: appState.lon || 0,
        ...extraData,
        forcedCaters: currentForcedCaters,
        forcedBy: currentForcedBy,
        isForcedCater: currentIsForcedCater,
        breakTimestamp: currentBreakTimestamp,
        breakStartTime: currentBreakStartTime,
        totalBreakMinutes: currentTotalBreak
    };

    if (!globalState.rosterMembers) globalState.rosterMembers = [];
    const existingIdx = globalState.rosterMembers.findIndex(m => (m.telegramId || m.id || "").toString() === tId);
    if (existingIdx !== -1) {
        globalState.rosterMembers[existingIdx] = {
            ...globalState.rosterMembers[existingIdx],
            ...rosterData
        };
    } else {
        globalState.rosterMembers.push(rosterData);
    }

    saveRosterCache();
    updateRosterUI();

    if (db) {
        const rosterRef = db.ref('roster/' + tId);
        await rosterRef.update(rosterData);

        rosterRef.onDisconnect().update({
            lastActiveTimestamp: firebase.database.ServerValue.TIMESTAMP
        }).catch(() => {});

        db.ref(`logins/${tId}`).update({
            totalBreakMinutes: currentTotalBreak
        }).catch(() => {});
    }

    if (recordLogin && db) {
        const todayStr = getLocalTodayStr();
        let finalLoginTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let finalLoginTimestamp = nowTimestamp;

        try {
            const loginSnap = await db.ref('logins/' + tId).once('value');
            const existingLogin = loginSnap.val();
            if (existingLogin && isSameDateStr(existingLogin.date, todayStr) && existingLogin.loginTime) {
                finalLoginTime = existingLogin.loginTime;
                if (existingLogin.loginTimestamp) {
                    finalLoginTimestamp = existingLogin.loginTimestamp;
                }
            }
        } catch(e) {}

        const loginEntry = {
            riderId: tId,
            id: tId,
            riderName: tName,
            loginTime: finalLoginTime,
            loginTimestamp: finalLoginTimestamp,
            clockOutTime: "",
            clockOutTimestamp: null,
            date: todayStr,
            location: locationLink || "",
            earlyShiftPenaltyPercent: 0,
            deficitHours: 0,
            totalBreakMinutes: 0
        };
        await db.ref('logins/' + tId).set(loginEntry);

        if (!globalState.globalLogins) globalState.globalLogins = [];
        const exIdx = globalState.globalLogins.findIndex(l => (l.riderId || l.id || "").toString() === tId);
        if (exIdx !== -1) {
            globalState.globalLogins[exIdx] = loginEntry;
        } else {
            globalState.globalLogins.push(loginEntry);
        }
        saveRosterCache();
        window.dispatchEvent(new CustomEvent('loginsUpdated'));
    }
}

export async function clockOutRider(targetId = null) {
    const tId = (targetId || appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const nowTimestamp = Date.now();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const todayStr = getLocalTodayStr();

    let finalBreakMins = 0;
    const rMem = (globalState.rosterMembers || []).find(m => (m.telegramId || m.id || "").toString() === tId);
    if (rMem) {
        finalBreakMins = rMem.totalBreakMinutes || 0;
        if (rMem.status === 'Break' && rMem.breakTimestamp) {
            const activeBreak = Math.max(0, Math.floor((nowTimestamp - rMem.breakTimestamp) / 60000));
            finalBreakMins += activeBreak;
        }
    }

    if (db && tId) {
        try {
            const loginSnap = await db.ref('logins/' + tId).once('value');
            const existingLogin = loginSnap.val();

            if (existingLogin) {
                await db.ref('logins/' + tId).update({ 
                    clockOutTime: timeStr,
                    clockOutTimestamp: nowTimestamp,
                    totalBreakMinutes: finalBreakMins
                });
            } else {
                const rName = rMem ? (rMem.riderName || rMem.name || "Rider") : (appState.riderName || "Rider");
                await db.ref('logins/' + tId).set({
                    riderId: tId,
                    id: tId,
                    riderName: rName,
                    loginTime: timeStr,
                    loginTimestamp: nowTimestamp,
                    clockOutTime: timeStr,
                    clockOutTimestamp: nowTimestamp,
                    date: todayStr,
                    location: "",
                    totalBreakMinutes: finalBreakMins
                });
            }
        } catch(e) {}

        await db.ref('roster/' + tId).update({ 
            status: 'End',
            forcedCaters: null,
            forcedBy: null,
            isForcedCater: false,
            breakTimestamp: null,
            breakStartTime: null,
            availableTimestamp: null,
            totalBreakMinutes: finalBreakMins,
            lastActiveTimestamp: nowTimestamp,
            lastUpdated: timeStr
        }).catch(() => {});
    }

    if (rMem) {
        rMem.status = 'End';
        rMem.forcedCaters = null;
        rMem.forcedBy = null;
        rMem.isForcedCater = false;
        rMem.breakTimestamp = null;
        rMem.breakStartTime = null;
        rMem.availableTimestamp = null;
        rMem.totalBreakMinutes = finalBreakMins;
    }

    if (globalState.globalLogins) {
        const lIdx = globalState.globalLogins.findIndex(l => (l.riderId || l.id || "").toString() === tId);
        if (lIdx !== -1) {
            globalState.globalLogins[lIdx].clockOutTime = timeStr;
            globalState.globalLogins[lIdx].clockOutTimestamp = nowTimestamp;
            globalState.globalLogins[lIdx].totalBreakMinutes = finalBreakMins;
        }
    }
    saveRosterCache();
    window.dispatchEvent(new CustomEvent('loginsUpdated'));
}

// REMARKS: ROSTER_STATUS_CORE_UNCONDITIONAL_IDEMPOTENT_AVAILABLE_V4_COMPLETE