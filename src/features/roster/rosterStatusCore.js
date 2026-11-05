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
    isSameDateStr,
    isRiderMatch 
} from './rosterUtils.js';
import { updateRosterUI } from './rosterUI.js';

export async function updateRosterStatus(status, targetId = null, targetName = null, precalculatedQueueTime = null, skipArchive = false, customExtraData = {}) {
    const tId = (targetId || appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const tName = targetName || appState.riderName || localStorage.getItem('riderName') || "Rider";
    const rosterMembers = globalState.rosterMembers || [];

    const targetRecord = rosterMembers.find(m => (m.telegramId || m.id || "").toString() === tId);

    // IDEMPOTENCY GUARD: Do not reset queue time or restart cooldown if already Available
    if (status === 'Available' && targetRecord && targetRecord.status === 'Available') {
        showToast("ℹ️ You are already in queue (Already Available in line).");
        return;
    }

    let recordLogin = false;

    if (status !== 'Catering' && targetRecord && !skipArchive) {
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
    const todayStr = getLocalTodayStr();
    let accumulatedBreakSeconds = 0;
    if (targetRecord && isSameDateStr(targetRecord.breakDate, todayStr)) {
        const recSecs = Number(targetRecord.totalBreakSeconds) || 0;
        const recMins = Number(targetRecord.totalBreakMinutes) || 0;
        accumulatedBreakSeconds = Math.max(recSecs, recMins * 60);
    }
    const existingLoginToday = (globalState.globalLogins || []).find(
        l => (l.riderId || l.id || "").toString() === tId && isSameDateStr(l.date, todayStr)
    );
    if (existingLoginToday) {
        const loginSecs = Number(existingLoginToday.totalBreakSeconds) || 0;
        const loginMins = Number(existingLoginToday.totalBreakMinutes) || 0;
        accumulatedBreakSeconds = Math.max(accumulatedBreakSeconds, loginSecs, loginMins * 60);
    }

    if (targetRecord && targetRecord.status === 'Break' && targetRecord.breakTimestamp) {
        const finishedBreakSecs = Math.max(1, Math.ceil((nowTimestamp - targetRecord.breakTimestamp) / 1000));
        accumulatedBreakSeconds += finishedBreakSecs;
    }
    const accumulatedBreakMins = Math.ceil(accumulatedBreakSeconds / 60);

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
            customerFees: null,
            lastReceiptFees: null,
            lastReceiptTotalFees: 0,
            breakTimestamp: null,
            breakStartTime: null,
            breakDurationMinutes: null,
            breakDurationLabel: null,
            breakTargetTimestamp: null,
            isUnlimitedBreak: false,
            breakDate: todayStr,
            availableTimestamp: preservedAvailableTs,
            totalBreakMinutes: accumulatedBreakMins,
            totalBreakSeconds: accumulatedBreakSeconds
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
            customerFees: null,
            lastReceiptFees: null,
            lastReceiptTotalFees: 0,
            breakTimestamp: null,
            breakStartTime: null,
            breakDurationMinutes: null,
            breakDurationLabel: null,
            breakTargetTimestamp: null,
            isUnlimitedBreak: false,
            breakDate: todayStr,
            availableTimestamp: null,
            totalBreakMinutes: accumulatedBreakMins,
            totalBreakSeconds: accumulatedBreakSeconds
        };
    } else if (status === 'Catering') {
        extraData = {
            breakTimestamp: null,
            breakStartTime: null,
            breakDurationMinutes: null,
            breakDurationLabel: null,
            breakTargetTimestamp: null,
            isUnlimitedBreak: false,
            breakDate: todayStr,
            availableTimestamp: null,
            totalBreakMinutes: accumulatedBreakMins,
            totalBreakSeconds: accumulatedBreakSeconds
        };
    } else if (status === 'Break') {
        extraData = {
            availableTimestamp: null,
            breakDate: todayStr,
            isUnlimitedBreak: !!customExtraData.isUnlimitedBreak,
            totalBreakMinutes: accumulatedBreakMins,
            totalBreakSeconds: accumulatedBreakSeconds,
            ...customExtraData
        };
    }

    await updateRosterStatusData(status, "", "", newQueueTime, tId, tName, [], recordLogin, locationLink, { ...extraData, ...customExtraData });
}

export async function updateRosterStatusData(status, customerName, startTime, queueTime = 0, specificId = null, specificName = null, completedHistory = [], recordLogin = false, locationLink = "", extraData = {}) {
    const tId = (specificId || appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const tName = specificName || appState.riderName || localStorage.getItem('riderName') || "Rider";

    if (!tId) return;

    if (!globalState.rosterMembers) globalState.rosterMembers = [];
    const existingRec = globalState.rosterMembers.find(m => (m.telegramId || m.id || "").toString() === tId);

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

    let currentCustomerFees = null;
    if (extraData.customerFees !== undefined) {
        currentCustomerFees = extraData.customerFees;
    } else if (!isResetStatus && existingRec?.customerFees) {
        currentCustomerFees = existingRec.customerFees;
    }

    let currentLastReceiptFees = null;
    let currentLastReceiptTotalFees = 0;
    if (extraData.lastReceiptFees !== undefined) {
        currentLastReceiptFees = extraData.lastReceiptFees;
    } else if (!isResetStatus && existingRec?.lastReceiptFees) {
        currentLastReceiptFees = existingRec.lastReceiptFees;
    }
    if (extraData.lastReceiptTotalFees !== undefined) {
        currentLastReceiptTotalFees = extraData.lastReceiptTotalFees;
    } else if (!isResetStatus && existingRec?.lastReceiptTotalFees) {
        currentLastReceiptTotalFees = existingRec.lastReceiptTotalFees;
    }

    let currentBreakTimestamp = null;
    let currentBreakStartTime = null;
    let currentBreakDurationMinutes = null;
    let currentBreakDurationLabel = null;
    let currentBreakTargetTimestamp = null;

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

        if (extraData.breakDurationMinutes !== undefined) {
            currentBreakDurationMinutes = extraData.breakDurationMinutes;
        } else if (existingRec && existingRec.status === 'Break' && existingRec.breakDurationMinutes) {
            currentBreakDurationMinutes = existingRec.breakDurationMinutes;
        }

        if (extraData.breakDurationLabel !== undefined) {
            currentBreakDurationLabel = extraData.breakDurationLabel;
        } else if (existingRec && existingRec.status === 'Break' && existingRec.breakDurationLabel) {
            currentBreakDurationLabel = existingRec.breakDurationLabel;
        }

        if (extraData.breakTargetTimestamp !== undefined) {
            currentBreakTargetTimestamp = extraData.breakTargetTimestamp;
        } else if (existingRec && existingRec.status === 'Break' && existingRec.breakTargetTimestamp) {
            currentBreakTargetTimestamp = existingRec.breakTargetTimestamp;
        }
    }

    let currentIsUnlimitedBreak = false;
    let currentBreakDate = extraData.breakDate || existingRec?.breakDate || getLocalTodayStr();
    if (status === 'Break') {
        if (extraData.isUnlimitedBreak !== undefined) {
            currentIsUnlimitedBreak = !!extraData.isUnlimitedBreak;
        } else if (existingRec && existingRec.status === 'Break') {
            currentIsUnlimitedBreak = !!existingRec.isUnlimitedBreak;
        }
    }

    const currentTotalBreak = extraData.totalBreakMinutes !== undefined 
        ? extraData.totalBreakMinutes 
        : (existingRec?.totalBreakMinutes || 0);
    const currentTotalBreakSeconds = extraData.totalBreakSeconds !== undefined
        ? extraData.totalBreakSeconds
        : (existingRec?.totalBreakSeconds !== undefined ? existingRec.totalBreakSeconds : currentTotalBreak * 60);

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
        photoUrl: photoUrl || "",
        userType: resolvedUserType || "rider",
        status: status,
        customerName: customerName || "",
        startTime: startTime || "",
        queueTime: finalQueueTime,
        availableTimestamp: currentAvailableTimestamp,
        lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        lastActiveTimestamp: nowTimestamp,
        ...extraData,
        forcedCaters: currentForcedCaters,
        forcedBy: currentForcedBy,
        isForcedCater: currentIsForcedCater,
        customerFees: currentCustomerFees,
        lastReceiptFees: currentLastReceiptFees,
        lastReceiptTotalFees: currentLastReceiptTotalFees,
        breakTimestamp: currentBreakTimestamp,
        breakStartTime: currentBreakStartTime,
        breakDurationMinutes: currentBreakDurationMinutes,
        breakDurationLabel: currentBreakDurationLabel,
        breakTargetTimestamp: currentBreakTargetTimestamp,
        isUnlimitedBreak: currentIsUnlimitedBreak,
        breakDate: currentBreakDate,
        totalBreakMinutes: currentTotalBreak,
        totalBreakSeconds: currentTotalBreakSeconds
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
        
        // Sanitize object so no undefined property ever reaches Firebase RTDB
        const sanitizedRosterData = {};
        for (const [k, v] of Object.entries(rosterData)) {
            if (v !== undefined) {
                sanitizedRosterData[k] = v;
            }
        }

        await rosterRef.update(sanitizedRosterData);

        const fb = window.firebase || (typeof firebase !== 'undefined' ? firebase : null);
        if (typeof rosterRef?.onDisconnect === 'function') {
            try {
                rosterRef.onDisconnect().update({
                    lastActiveTimestamp: fb?.database?.ServerValue?.TIMESTAMP || Date.now()
                }).catch(() => {});
            } catch (_) {}
        }

        db.ref(`logins/${tId}`).update({
            totalBreakMinutes: currentTotalBreak,
            totalBreakSeconds: currentTotalBreakSeconds
        }).catch(() => {});
        const todayStr = getLocalTodayStr();
        db.ref(`shiftHistory/${todayStr}_${tId}`).update({
            totalBreakMinutes: currentTotalBreak,
            totalBreakSeconds: currentTotalBreakSeconds
        }).catch(() => {});
    }

    if (recordLogin && db) {
        const todayStr = getLocalTodayStr();
        let finalLoginTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let finalLoginTimestamp = nowTimestamp;
        let preservedBreakMins = currentTotalBreak;
        let preservedBreakSecs = currentTotalBreakSeconds;

        try {
            const loginSnap = await db.ref('logins/' + tId).once('value');
            const existingLogin = loginSnap.val();
            if (existingLogin && isSameDateStr(existingLogin.date, todayStr)) {
                if (existingLogin.loginTime) {
                    finalLoginTime = existingLogin.loginTime;
                }
                if (existingLogin.loginTimestamp) {
                    finalLoginTimestamp = existingLogin.loginTimestamp;
                }
                const exMins = Number(existingLogin.totalBreakMinutes) || 0;
                const exSecs = Number(existingLogin.totalBreakSeconds) || (exMins * 60);
                preservedBreakSecs = Math.max(preservedBreakSecs, exSecs);
                preservedBreakMins = Math.max(preservedBreakMins, exMins, Math.ceil(preservedBreakSecs / 60));
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
            totalBreakMinutes: preservedBreakMins,
            totalBreakSeconds: preservedBreakSecs
        };
        await db.ref('logins/' + tId).set(loginEntry);
        db.ref('shiftHistory/' + todayStr + '_' + tId).set(loginEntry).catch(() => {});

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

    let finalBreakSecs = 0;
    const rMem = (globalState.rosterMembers || []).find(m => (m.telegramId || m.id || "").toString() === tId);
    if (rMem) {
        if (isSameDateStr(rMem.breakDate, todayStr)) {
            const recSecs = Number(rMem.totalBreakSeconds) || 0;
            const recMins = Number(rMem.totalBreakMinutes) || 0;
            finalBreakSecs = Math.max(recSecs, recMins * 60);
        }
        if (rMem.status === 'Break' && rMem.breakTimestamp) {
            const activeBreakSecs = Math.max(1, Math.ceil((nowTimestamp - rMem.breakTimestamp) / 1000));
            finalBreakSecs += activeBreakSecs;
        }
    }
    const existingLoginToday = (globalState.globalLogins || []).find(
        l => (l.riderId || l.id || "").toString() === tId && isSameDateStr(l.date, todayStr)
    );
    if (existingLoginToday) {
        const loginSecs = Number(existingLoginToday.totalBreakSeconds) || 0;
        const loginMins = Number(existingLoginToday.totalBreakMinutes) || 0;
        finalBreakSecs = Math.max(finalBreakSecs, loginSecs, loginMins * 60);
    }
    const finalBreakMins = Math.ceil(finalBreakSecs / 60);

    if (db && tId) {
        let grossMins = 0;
        let netWorkedMins = 0;
        try {
            const loginSnap = await db.ref('logins/' + tId).once('value');
            const existingLogin = loginSnap.val();

            if (existingLogin) {
                if (existingLogin.loginTimestamp) {
                    grossMins = Math.max(0, Math.floor((nowTimestamp - existingLogin.loginTimestamp) / 60000));
                    netWorkedMins = Math.max(0, grossMins - finalBreakMins);
                }
                const shiftClockOutPayload = { 
                    clockOutTime: timeStr,
                    clockOutTimestamp: nowTimestamp,
                    totalBreakMinutes: finalBreakMins,
                    totalBreakSeconds: finalBreakSecs,
                    grossMinutes: grossMins,
                    workedMinutes: netWorkedMins,
                    date: todayStr
                };
                await db.ref('logins/' + tId).update(shiftClockOutPayload);
                db.ref('shiftHistory/' + todayStr + '_' + tId).update(shiftClockOutPayload).catch(() => {});
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
                    totalBreakMinutes: finalBreakMins,
                    totalBreakSeconds: finalBreakSecs,
                    grossMinutes: 0,
                    workedMinutes: 0
                });
            }
        } catch(e) {}

        await db.ref('roster/' + tId).update({ 
            status: 'End',
            customerName: '',
            forcedCaters: null,
            forcedBy: null,
            isForcedCater: false,
            breakTimestamp: null,
            breakStartTime: null,
            breakDurationMinutes: null,
            breakDurationLabel: null,
            breakTargetTimestamp: null,
            isUnlimitedBreak: false,
            breakDate: todayStr,
            availableTimestamp: null,
            totalBreakMinutes: finalBreakMins,
            totalBreakSeconds: finalBreakSecs,
            lastActiveTimestamp: nowTimestamp,
            lastUpdated: timeStr
        }).catch(() => {});

        // Clean up any lingering catering chats assigned to this rider so they return to inbox/done
        try {
            const rName = rMem ? (rMem.riderName || rMem.name || "").trim().toLowerCase() : (appState.riderName || "").trim().toLowerCase();
            const snap = await db.ref('customerChatMeta').once('value');
            const chats = snap.val() || {};
            const chatUpdates = {};
            Object.entries(chats).forEach(([cId, meta]) => {
                const cRiderId = (meta.cateredByRiderId || '').toString();
                const cRiderName = (meta.cateredByRiderName || meta.cateredBy || '').trim().toLowerCase();
                if ((tId && cRiderId === tId) || (rName && (cRiderName === rName || isRiderMatch(cRiderName, rName)))) {
                    const isDone = (meta.status === 'completed' || meta.status === 'done' || meta.status === 'cancelled');
                    const targetFolder = isDone ? 'done' : (meta.isApplicant ? 'applicant' : 'inbox');
                    chatUpdates[`customerChatMeta/${cId}/cateredByRiderId`] = null;
                    chatUpdates[`customerChatMeta/${cId}/cateredByRiderName`] = null;
                    chatUpdates[`customerChatMeta/${cId}/cateredBy`] = null;
                    chatUpdates[`customerChatMeta/${cId}/folder`] = targetFolder;
                    chatUpdates[`customerChats/${cId}/metadata/cateredByRiderId`] = null;
                    chatUpdates[`customerChats/${cId}/metadata/cateredByRiderName`] = null;
                    chatUpdates[`customerChats/${cId}/metadata/cateredBy`] = null;
                    chatUpdates[`customerChats/${cId}/metadata/folder`] = targetFolder;
                }
            });
            if (Object.keys(chatUpdates).length > 0) {
                await db.ref().update(chatUpdates);
            }
        } catch (_) {}
    }

    if (rMem) {
        rMem.status = 'End';
        rMem.customerName = '';
        rMem.forcedCaters = null;
        rMem.forcedBy = null;
        rMem.isForcedCater = false;
        rMem.breakTimestamp = null;
        rMem.breakStartTime = null;
        rMem.breakDurationMinutes = null;
        rMem.breakDurationLabel = null;
        rMem.breakTargetTimestamp = null;
        rMem.isUnlimitedBreak = false;
        rMem.breakDate = todayStr;
        rMem.availableTimestamp = null;
        rMem.totalBreakMinutes = finalBreakMins;
        rMem.totalBreakSeconds = finalBreakSecs;
    }

    if (globalState.globalLogins) {
        const lIdx = globalState.globalLogins.findIndex(l => (l.riderId || l.id || "").toString() === tId);
        if (lIdx !== -1) {
            const loginRec = globalState.globalLogins[lIdx];
            let gross = 0;
            if (loginRec.loginTimestamp) {
                gross = Math.max(0, Math.floor((nowTimestamp - loginRec.loginTimestamp) / 60000));
            }
            loginRec.clockOutTime = timeStr;
            loginRec.clockOutTimestamp = nowTimestamp;
            loginRec.totalBreakMinutes = finalBreakMins;
            loginRec.totalBreakSeconds = finalBreakSecs;
            loginRec.grossMinutes = gross;
            loginRec.workedMinutes = Math.max(0, gross - finalBreakMins);
        }
    }
    saveRosterCache();
    window.dispatchEvent(new CustomEvent('loginsUpdated'));
}

// REMARKS: ROSTER_STATUS_CORE_UNCONDITIONAL_IDEMPOTENT_AVAILABLE_V4_COMPLETE