// src/features/roster/rosterStatusCore.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { getLocalTodayStr } from '../../utils/helpers.js';
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

    let recordLogin = false;
    const targetRecord = rosterMembers.find(m => (m.telegramId || m.id || "").toString() === tId);

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
        const availableRiders = rosterMembers.filter(m => m.status === 'Available' && (m.telegramId || m.id || "").toString() !== tId);
        let maxTime = new Date().getTime();
        availableRiders.forEach(r => {
            const t = parseQueueTime(r.queueTime);
            if (t > maxTime) maxTime = t;
        });
        newQueueTime = maxTime + 1000;
    }

    let extraData = {};
    if (status === 'Available' || status === 'End') {
        extraData = { 
            forcedCaters: null,
            forcedBy: null,
            isForcedCater: false
        };
    }

    await updateRosterStatusData(status, "", "", newQueueTime, tId, tName, [], recordLogin, locationLink, extraData);
}

export async function updateRosterStatusData(status, customerName, startTime, queueTime = 0, specificId = null, specificName = null, completedHistory = [], recordLogin = false, locationLink = "", extraData = {}) {
    const tId = (specificId || appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const tName = specificName || appState.riderName || localStorage.getItem('riderName') || "Rider";

    if (!tId) return;

    const nowTimestamp = Date.now();
    const existingRec = (globalState.rosterMembers || []).find(m => (m.telegramId || m.id || "").toString() === tId);
    const photoUrl = appState.photoUrl || localStorage.getItem('lokalex_photo_url') || localStorage.getItem('riderPhotoUrl') || existingRec?.photoUrl || "";

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

    const rosterData = {
        telegramId: tId.toString(),
        id: tId.toString(),
        riderName: tName,
        name: tName,
        photoUrl: photoUrl,
        userType: getUserType(),
        status: status,
        customerName: customerName || "",
        startTime: startTime || "",
        queueTime: (queueTime !== null && queueTime !== undefined && queueTime !== 0) ? queueTime : nowTimestamp,
        lastUpdated: new Date().toLocaleTimeString(),
        lastActiveTimestamp: nowTimestamp,
        lat: appState.lat || 0,
        lng: appState.lon || 0,
        ...extraData,
        forcedCaters: currentForcedCaters,
        forcedBy: currentForcedBy,
        isForcedCater: currentIsForcedCater
    };

    if (!globalState.rosterMembers) globalState.rosterMembers = [];
    const existingIdx = globalState.rosterMembers.findIndex(m => (m.telegramId || m.id || "").toString() === tId);
    if (existingIdx !== -1) {
        globalState.rosterMembers[existingIdx] = {
            ...globalState.rosterMembers[existingIdx],
            ...rosterData,
            forcedCaters: currentForcedCaters,
            forcedBy: currentForcedBy,
            isForcedCater: currentIsForcedCater
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
    }

    if (recordLogin && db) {
        const todayStr = getLocalTodayStr();
        let finalLoginTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        try {
            const loginSnap = await db.ref('logins/' + tId).once('value');
            const existingLogin = loginSnap.val();
            if (existingLogin && isSameDateStr(existingLogin.date, todayStr) && existingLogin.loginTime) {
                finalLoginTime = existingLogin.loginTime;
            }
        } catch(e) {}

        const loginEntry = {
            riderId: tId,
            id: tId,
            riderName: tName,
            loginTime: finalLoginTime,
            clockOutTime: "",
            date: todayStr,
            location: locationLink || ""
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
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const todayStr = getLocalTodayStr();

    if (db && tId) {
        try {
            const loginSnap = await db.ref('logins/' + tId).once('value');
            const existingLogin = loginSnap.val();

            if (existingLogin) {
                await db.ref('logins/' + tId).update({ clockOutTime: timeStr });
            } else {
                const rosterMem = (globalState.rosterMembers || []).find(m => (m.telegramId || m.id || "").toString() === tId);
                const rName = rosterMem ? (rosterMem.riderName || rosterMem.name || "Rider") : (appState.riderName || "Rider");
                await db.ref('logins/' + tId).set({
                    riderId: tId,
                    id: tId,
                    riderName: rName,
                    loginTime: timeStr,
                    clockOutTime: timeStr,
                    date: todayStr,
                    location: ""
                });
            }
        } catch(e) {}

        await db.ref('roster/' + tId).update({ 
            status: 'End',
            forcedCaters: null,
            forcedBy: null,
            isForcedCater: false,
            lastActiveTimestamp: Date.now(),
            lastUpdated: timeStr
        }).catch(() => {});
    }

    if (globalState.rosterMembers) {
        const rMem = globalState.rosterMembers.find(m => (m.telegramId || m.id || "").toString() === tId);
        if (rMem) {
            rMem.status = 'End';
            rMem.forcedCaters = null;
            rMem.forcedBy = null;
            rMem.isForcedCater = false;
        }
    }

    if (globalState.globalLogins) {
        const lIdx = globalState.globalLogins.findIndex(l => (l.riderId || l.id || "").toString() === tId);
        if (lIdx !== -1) {
            globalState.globalLogins[lIdx].clockOutTime = timeStr;
        }
    }
    saveRosterCache();
    window.dispatchEvent(new CustomEvent('loginsUpdated'));
}

//end here
