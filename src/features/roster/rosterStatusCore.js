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

// ============================================================================
// OFFLINE MUTATION OUTBOX ENGINE FOR ROSTER & LOGIN WRITE RESILIENCE
// ============================================================================
const STATUS_OUTBOX_STORAGE_KEY = 'lokalex_status_mutation_outbox';

export function withTimeout(promise, timeoutMs = 5500, timeoutMessage = 'Server request timed out') {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        })
    ]);
}

export function getOfflineRosterOutbox() {
    try {
        const raw = localStorage.getItem(STATUS_OUTBOX_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) {
        return [];
    }
}

export function saveOfflineRosterOutbox(outbox) {
    try {
        localStorage.setItem(STATUS_OUTBOX_STORAGE_KEY, JSON.stringify(outbox.slice(-60)));
    } catch (_) {}
}

export function queueOfflineRosterMutation(type, targetId, payload, action = 'update') {
    if (!type || !targetId || !payload) return;
    try {
        const outbox = getOfflineRosterOutbox();
        const key = `${type}:${targetId}`;
        const filtered = outbox.filter(item => `${item.type}:${item.targetId}` !== key);
        filtered.push({
            id: `${key}_${Date.now()}`,
            type, // 'roster' | 'logins' | 'shiftHistory'
            targetId: targetId.toString(),
            payload,
            action, // 'update' | 'set'
            queuedAt: Date.now()
        });
        saveOfflineRosterOutbox(filtered);
    } catch (e) {
        console.warn('[queueOfflineRosterMutation] Save failed:', e);
    }
}

let isFlushingOutbox = false;
let fastRetryTimer = null;

export function startFastOutboxRetry() {
    if (fastRetryTimer) return;
    fastRetryTimer = setInterval(async () => {
        const outbox = getOfflineRosterOutbox();
        if (!outbox || outbox.length === 0) {
            clearInterval(fastRetryTimer);
            fastRetryTimer = null;
            if (typeof window.setModernSyncState === 'function') {
                window.setModernSyncState('synced', 'All Synced');
            }
            return;
        }
        if (navigator.onLine) {
            try {
                await flushOfflineRosterOutbox();
                const remaining = getOfflineRosterOutbox();
                if (remaining.length === 0) {
                    clearInterval(fastRetryTimer);
                    fastRetryTimer = null;
                    if (typeof window.setModernSyncState === 'function') {
                        window.setModernSyncState('synced', 'All Synced');
                    }
                    showToast("✅ Outbox synced to cloud database!");
                }
            } catch (_) {}
        }
    }, 4000);
}

export async function flushOfflineRosterOutbox() {
    if (isFlushingOutbox || !navigator.onLine || !db) return;
    const outbox = getOfflineRosterOutbox();
    if (!outbox || outbox.length === 0) return;

    isFlushingOutbox = true;
    const remaining = [];

    for (const item of outbox) {
        try {
            let ref = null;
            if (item.type === 'roster') {
                ref = db.ref(`roster/${item.targetId}`);
            } else if (item.type === 'logins') {
                ref = db.ref(`logins/${item.targetId}`);
            } else if (item.type === 'shiftHistory') {
                ref = db.ref(`shiftHistory/${item.targetId}`);
            }
            if (ref) {
                if (item.action === 'set') {
                    await ref.set(item.payload);
                } else {
                    await ref.update(item.payload);
                }
            }
        } catch (err) {
            console.warn('[flushOfflineRosterOutbox] Item sync failed, retaining in outbox:', item.id, err);
            remaining.push(item);
        }
    }

    saveOfflineRosterOutbox(remaining);
    isFlushingOutbox = false;
}

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
        return await clockOutRider(tId);
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

    return await updateRosterStatusData(status, "", "", newQueueTime, tId, tName, [], recordLogin, locationLink, { ...extraData, ...customExtraData });
}

export async function updateRosterStatusData(status, customerName, startTime, queueTime = 0, specificId = null, specificName = null, completedHistory = [], recordLogin = false, locationLink = "", extraData = {}) {
    let tId = (specificId || appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    let tName = specificName || appState.riderName || localStorage.getItem('riderName') || "Rider";

    if (!tId) return { success: false, error: 'Missing rider ID' };

    // Connection Check: If offline, we commit locally and queue for background sync rather than failing
    const isDeviceOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    if (!globalState.rosterMembers) globalState.rosterMembers = [];
    let existingRec = globalState.rosterMembers.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim();
        return (mId && mId === tId) || isRiderMatch(tName, mName, tId, mId);
    });

    if (existingRec) {
        tId = (existingRec.telegramId || existingRec.id || tId).toString().trim();
        tName = existingRec.riderName || existingRec.name || tName;
    }

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

    const sanitizedRosterData = {};
    for (const [k, v] of Object.entries(rosterData)) {
        if (v !== undefined) {
            sanitizedRosterData[k] = v;
        }
    }

    const todayStr = getLocalTodayStr();
    let loginEntry = null;

    if (recordLogin) {
        let finalLoginTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let finalLoginTimestamp = nowTimestamp;
        let preservedBreakMins = currentTotalBreak;
        let preservedBreakSecs = currentTotalBreakSeconds;
        let accumulatedWorkedMinutes = 0;
        let firstLoginTime = finalLoginTime;
        let firstLoginTimestamp = finalLoginTimestamp;

        // Instant 0ms memory lookup for existing login today (avoids slow network query)
        const existingLogin = (globalState.globalLogins || []).find(l => 
            (l.riderId || l.id || "").toString() === tId && isSameDateStr(l.date, todayStr)
        );

        if (existingLogin && isSameDateStr(existingLogin.date, todayStr)) {
            const exMins = Number(existingLogin.totalBreakMinutes) || 0;
            const exSecs = Number(existingLogin.totalBreakSeconds) || (exMins * 60);
            preservedBreakSecs = Math.max(preservedBreakSecs, exSecs);
            preservedBreakMins = Math.max(preservedBreakMins, exMins, Math.ceil(preservedBreakSecs / 60));

            firstLoginTime = existingLogin.firstLoginTime || existingLogin.loginTime || finalLoginTime;
            firstLoginTimestamp = existingLogin.firstLoginTimestamp || existingLogin.loginTimestamp || finalLoginTimestamp;

            if (existingLogin.clockOutTimestamp || existingLogin.clockOutTime) {
                const prevWorked = Number(existingLogin.workedMinutes) || Number(existingLogin.accumulatedWorkedMinutes) || 0;
                accumulatedWorkedMinutes = prevWorked;
                finalLoginTime = new Date(nowTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                finalLoginTimestamp = nowTimestamp;
            } else {
                if (existingLogin.loginTime) finalLoginTime = existingLogin.loginTime;
                if (existingLogin.loginTimestamp) finalLoginTimestamp = existingLogin.loginTimestamp;
                accumulatedWorkedMinutes = Number(existingLogin.accumulatedWorkedMinutes) || 0;
            }
        }

        loginEntry = {
            riderId: tId,
            id: tId,
            riderName: tName,
            loginTime: finalLoginTime,
            loginTimestamp: finalLoginTimestamp,
            firstLoginTime: firstLoginTime,
            firstLoginTimestamp: firstLoginTimestamp,
            clockOutTime: "",
            clockOutTimestamp: null,
            date: todayStr,
            location: locationLink || "",
            earlyShiftPenaltyPercent: 0,
            deficitHours: 0,
            totalBreakMinutes: preservedBreakMins,
            totalBreakSeconds: preservedBreakSecs,
            accumulatedWorkedMinutes: accumulatedWorkedMinutes,
            workedMinutes: 0
        };
    }

    // ========================================================================
    // 1. INSTANT OPTIMISTIC LOCAL COMMIT (0ms Local Execution & Fluid UI)
    // ========================================================================
    const existingIdx = globalState.rosterMembers.findIndex(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim();
        return (mId && mId === tId) || isRiderMatch(tName, mName, tId, mId);
    });
    if (existingIdx !== -1) {
        globalState.rosterMembers[existingIdx] = {
            ...globalState.rosterMembers[existingIdx],
            ...rosterData
        };
    } else {
        globalState.rosterMembers.push(rosterData);
    }

    if (recordLogin && loginEntry) {
        if (!globalState.globalLogins) globalState.globalLogins = [];
        const exIdx = globalState.globalLogins.findIndex(l => (l.riderId || l.id || "").toString() === tId);
        if (exIdx !== -1) {
            globalState.globalLogins[exIdx] = loginEntry;
        } else {
            globalState.globalLogins.push(loginEntry);
        }
        window.dispatchEvent(new CustomEvent('loginsUpdated'));
    }

    saveRosterCache();
    updateRosterUI();
    window.dispatchEvent(new Event('rosterUpdated'));
    if (typeof window.refreshAllModernViews === 'function') {
        window.refreshAllModernViews();
    }

    // ========================================================================
    // 2. BACKGROUND SERVER HANDSHAKE & RESILIENT OUTBOX RETRY
    // ========================================================================
    if (isDeviceOffline) {
        queueOfflineRosterMutation('roster', tId, sanitizedRosterData, 'set');
        if (recordLogin && loginEntry) {
            queueOfflineRosterMutation('logins', tId, loginEntry, 'set');
            queueOfflineRosterMutation('shiftHistory', `${todayStr}_${tId}`, loginEntry, 'set');
        }
        if (typeof window.setModernSyncState === 'function') {
            window.setModernSyncState('queued', 'Saved (Offline)');
        }
        showToast(recordLogin ? "⏱️ Time-In saved on device! Auto-syncing when online..." : "☁️ Status saved! Auto-syncing...", 3000);
        startFastOutboxRetry();
        return { success: true, status, riderId: tId, queuedOffline: true };
    }

    if (typeof window.setModernSyncState === 'function') {
        window.setModernSyncState('syncing', recordLogin ? 'Syncing Time-In...' : 'Syncing Status...');
    }

    if (db) {
        const rosterRef = db.ref('roster/' + tId);
        // Use direct single-roundtrip .set() since sanitizedRosterData has the full merged record
        const networkTasks = [
            rosterRef.set(sanitizedRosterData)
        ];

        if (recordLogin && loginEntry) {
            networkTasks.push(db.ref('logins/' + tId).set(loginEntry));
            // Shift history audit record saved asynchronously in background so it never slows down the handshake
            db.ref(`shiftHistory/${todayStr}_${tId}`).set(loginEntry).catch(() => {});
        } else {
            networkTasks.push(db.ref(`logins/${tId}`).update({
                totalBreakMinutes: currentTotalBreak,
                totalBreakSeconds: currentTotalBreakSeconds
            }).catch(() => {}));
            db.ref(`shiftHistory/${todayStr}_${tId}`).update({
                totalBreakMinutes: currentTotalBreak,
                totalBreakSeconds: currentTotalBreakSeconds
            }).catch(() => {});
        }

        try {
            // Await cloud commit with 6.5s timeout guard for resilient mobile cellular handshakes
            await withTimeout(Promise.all(networkTasks), 6500, "Connection timeout: Server took too long to confirm status update.");
            if (typeof window.setModernSyncState === 'function') {
                window.setModernSyncState('synced', recordLogin ? 'Time-In Confirmed' : 'Status Confirmed');
            }
        } catch (serverErr) {
            console.warn('[updateRosterStatusData] Server handshake delayed/offline, saving to outbox:', serverErr);
            // Save mutation to outbox as backup
            queueOfflineRosterMutation('roster', tId, sanitizedRosterData, 'set');
            if (recordLogin && loginEntry) {
                queueOfflineRosterMutation('logins', tId, loginEntry, 'set');
                queueOfflineRosterMutation('shiftHistory', `${todayStr}_${tId}`, loginEntry, 'set');
            }
            if (typeof window.setModernSyncState === 'function') {
                window.setModernSyncState('queued', 'Saved (Syncing)');
            }
            showToast(recordLogin ? "⏱️ Time-In saved! Auto-syncing to cloud..." : "☁️ Status saved! Auto-syncing...", 3000);
            startFastOutboxRetry();
        }
    }

    return { success: true, status, riderId: tId };
}

export async function clockOutRider(targetId = null) {
    const tId = (targetId || appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const nowTimestamp = Date.now();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const todayStr = getLocalTodayStr();

    if (!tId) {
        throw new Error('Rider ID not found for clock out.');
    }

    if (!navigator.onLine) {
        throw new Error('Offline: Cannot end shift without internet connection.');
    }

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

    let grossMins = 0;
    let netWorkedMins = 0;
    let totalWorkedToday = 0;

    let shiftClockOutPayload = null;
    let initialClockOutEntry = null;

    if (existingLoginToday) {
        if (existingLoginToday.loginTimestamp) {
            grossMins = Math.max(0, Math.floor((nowTimestamp - existingLoginToday.loginTimestamp) / 60000));
            netWorkedMins = Math.max(0, grossMins - finalBreakMins);
        }
        const prevAccum = Number(existingLoginToday.accumulatedWorkedMinutes) || 0;
        totalWorkedToday = prevAccum + netWorkedMins;

        shiftClockOutPayload = { 
            clockOutTime: timeStr,
            clockOutTimestamp: nowTimestamp,
            totalBreakMinutes: finalBreakMins,
            totalBreakSeconds: finalBreakSecs,
            grossMinutes: grossMins,
            sessionWorkedMinutes: netWorkedMins,
            workedMinutes: totalWorkedToday,
            accumulatedWorkedMinutes: totalWorkedToday,
            date: todayStr
        };
    } else {
        const rName = rMem ? (rMem.riderName || rMem.name || "Rider") : (appState.riderName || "Rider");
        initialClockOutEntry = {
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
            sessionWorkedMinutes: 0,
            workedMinutes: 0,
            accumulatedWorkedMinutes: 0
        };
    }

    const endStatusPayload = { 
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
    };

    // Clean up any lingering catering chats assigned to this rider in memory (zero network table download)
    const chatUpdates = {};
    const threadMap = (typeof window.getCachedCustomerThreadsMap === 'function') ? window.getCachedCustomerThreadsMap() : null;
    const rName = rMem ? (rMem.riderName || rMem.name || "").trim().toLowerCase() : (appState.riderName || "").trim().toLowerCase();

    if (threadMap && threadMap.size > 0) {
        for (const [cId, meta] of threadMap.entries()) {
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
        }
    }

    // ========================================================================
    // 1. INSTANT OPTIMISTIC IN-MEMORY COMMIT (0ms Local Execution & Fluid UI)
    // ========================================================================
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
            loginRec.clockOutTime = timeStr;
            loginRec.clockOutTimestamp = nowTimestamp;
            loginRec.totalBreakMinutes = finalBreakMins;
            loginRec.totalBreakSeconds = finalBreakSecs;
            loginRec.grossMinutes = grossMins;
            loginRec.sessionWorkedMinutes = netWorkedMins;
            loginRec.workedMinutes = totalWorkedToday;
            loginRec.accumulatedWorkedMinutes = totalWorkedToday;
        }
    }

    saveRosterCache();
    updateRosterUI();
    window.dispatchEvent(new CustomEvent('loginsUpdated'));
    window.dispatchEvent(new Event('rosterUpdated'));
    if (typeof window.refreshAllModernViews === 'function') {
        window.refreshAllModernViews();
    }

    // ========================================================================
    // 2. BACKGROUND SERVER SYNC & RESILIENT OUTBOX RETRY
    // ========================================================================
    if (typeof window.setModernSyncState === 'function') {
        window.setModernSyncState('syncing', 'Clocking Out...');
    }

    const isDeviceOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isDeviceOffline) {
        if (shiftClockOutPayload) {
            queueOfflineRosterMutation('logins', tId, shiftClockOutPayload, 'update');
        } else if (initialClockOutEntry) {
            queueOfflineRosterMutation('logins', tId, initialClockOutEntry, 'set');
        }
        queueOfflineRosterMutation('roster', tId, endStatusPayload, 'update');
        if (typeof window.setModernSyncState === 'function') {
            window.setModernSyncState('queued', 'Clock-Out Saved');
        }
        startFastOutboxRetry();
        return { success: true, status: 'End', riderId: tId, queuedOffline: true };
    }

    if (db) {
        const networkTasks = [];
        if (shiftClockOutPayload) {
            networkTasks.push(db.ref('logins/' + tId).update(shiftClockOutPayload));
        } else if (initialClockOutEntry) {
            networkTasks.push(db.ref('logins/' + tId).set(initialClockOutEntry));
        }
        networkTasks.push(db.ref('roster/' + tId).update(endStatusPayload));
        if (Object.keys(chatUpdates).length > 0) {
            networkTasks.push(db.ref().update(chatUpdates));
        }

        try {
            await withTimeout(Promise.all(networkTasks), 6500, 'Server took too long to confirm clock-out.');
            if (typeof window.setModernSyncState === 'function') {
                window.setModernSyncState('synced', 'Clock-Out Confirmed');
            }
        } catch (serverErr) {
            console.warn('[clockOutRider] Server handshake delayed/offline, saving to outbox:', serverErr);
            if (shiftClockOutPayload) {
                queueOfflineRosterMutation('logins', tId, shiftClockOutPayload, 'update');
            } else if (initialClockOutEntry) {
                queueOfflineRosterMutation('logins', tId, initialClockOutEntry, 'set');
            }
            queueOfflineRosterMutation('roster', tId, endStatusPayload, 'update');
            if (typeof window.setModernSyncState === 'function') {
                window.setModernSyncState('queued', 'Saved (Syncing)');
            }
            startFastOutboxRetry();
        }

        // Shift history recorded asynchronously in background
        if (shiftClockOutPayload) {
            db.ref('shiftHistory/' + todayStr + '_' + tId).update(shiftClockOutPayload).catch(() => {});
        }
    }

    return { success: true, status: 'End', riderId: tId };
}

if (typeof window !== 'undefined') {
    window.updateRosterStatus = updateRosterStatus;
    window.updateRosterStatusData = updateRosterStatusData;
    window.clockOutRider = clockOutRider;
    window.flushOfflineRosterOutbox = flushOfflineRosterOutbox;
    window.getOfflineRosterOutbox = getOfflineRosterOutbox;
    window.queueOfflineRosterMutation = queueOfflineRosterMutation;
    window.startFastOutboxRetry = startFastOutboxRetry;

    // Check if there are lingering items from previous session on boot
    const pendingOutbox = getOfflineRosterOutbox();
    if (pendingOutbox && pendingOutbox.length > 0) {
        startFastOutboxRetry();
    }

    // Automatically flush outbox whenever connectivity recovers
    window.addEventListener('online', () => {
        flushOfflineRosterOutbox().catch(() => {});
    });
    window.addEventListener('appResumedFromBackground', () => {
        flushOfflineRosterOutbox().catch(() => {});
    });

    // Periodic safety flush for pending offline outbox items
    setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        if (navigator.onLine) {
            flushOfflineRosterOutbox().catch(() => {});
        }
    }, 30000);
}

// REMARKS: ROSTER_STATUS_CORE_UNCONDITIONAL_IDEMPOTENT_AVAILABLE_V4_COMPLETE