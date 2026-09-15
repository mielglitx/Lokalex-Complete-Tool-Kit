// src/features/roster/rosterStatusLimits.js
import { appState, globalState } from '../../store/state.js';
import { parseTimeToMinutes, getRiderTodayGross, isAdmin } from './rosterUtils.js';

export function calculateAutoBookingLimit(targetId = null, targetName = null) {
    const myId = (targetId || appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (targetName || appState.riderName || localStorage.getItem('riderName') || "").trim().toLowerCase();

    const rosterMembers = (globalState.rosterMembers || []).filter(m => m && m.status !== 'End');
    
    if (rosterMembers.length < 3) {
        const fallback = globalState.bookingLimits?.maxActiveBookings;
        return (fallback !== undefined && fallback !== null) ? parseInt(fallback) : 2;
    }

    const ridersWithGross = rosterMembers.map(m => {
        const rId = (m.telegramId || m.id || "").toString().trim();
        const rName = (m.riderName || m.name || "").trim();
        return {
            id: rId,
            name: rName.toLowerCase(),
            gross: getRiderTodayGross(rName, rId)
        };
    }).sort((a, b) => a.gross - b.gross);

    const total = ridersWithGross.length;
    const myIdx = ridersWithGross.findIndex(r => (myId && r.id === myId) || (myName && r.name === myName));
    if (myIdx === -1) return 2;

    const myGross = ridersWithGross[myIdx].gross;

    const lowCutIdx = Math.max(0, Math.ceil(total / 3) - 1);
    const lowCutGross = ridersWithGross[lowCutIdx].gross;

    const highCutIdx = Math.min(total - 1, Math.floor((2 * total) / 3));
    const highCutGross = ridersWithGross[highCutIdx].gross;

    if (myGross <= lowCutGross) {
        return 4;
    }
    if (myGross >= highCutGross && highCutGross > lowCutGross) {
        return 1;
    }
    return 2;
}

export function getMaxActiveBookingsLimit(targetId = null, targetName = null) {
    const limitConfig = globalState.bookingLimits || {};
    const activeRosterCount = (globalState.rosterMembers || []).filter(m => m && m.status !== 'End').length;

    if (limitConfig.autoEnabled && activeRosterCount >= 3) {
        return calculateAutoBookingLimit(targetId, targetName);
    }
    return (limitConfig.maxActiveBookings !== undefined && limitConfig.maxActiveBookings !== null) 
        ? parseInt(limitConfig.maxActiveBookings) 
        : 2;
}

export function canRiderTakeMoreBookings(targetId = null, targetName = null) {
    if (isAdmin()) return { allowed: true, currentCount: 0, maxAllowed: 999, isAuto: false };

    const myId = (targetId || appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (targetName || appState.riderName || localStorage.getItem('riderName') || "").trim().toLowerCase();
    
    const rosterMembers = globalState.rosterMembers || [];
    const record = rosterMembers.find(m => 
        (m.telegramId || m.id || "").toString().trim() === myId ||
        (m.riderName || m.name || "").toLowerCase().trim() === myName
    );

    let activeCount = 0;
    if (record && record.status === 'Catering' && record.customerName) {
        activeCount = record.customerName.split(', ').map(c => c.trim()).filter(Boolean).length;
    }

    const activeRosterCount = rosterMembers.filter(m => m && m.status !== 'End').length;
    const maxAllowed = getMaxActiveBookingsLimit(myId, myName);
    const isAuto = Boolean(globalState.bookingLimits?.autoEnabled) && activeRosterCount >= 3;

    if (activeCount >= maxAllowed) {
        return {
            allowed: false,
            currentCount: activeCount,
            maxAllowed: maxAllowed,
            isAuto
        };
    }

    return {
        allowed: true,
        currentCount: activeCount,
        maxAllowed: maxAllowed,
        isAuto
    };
}

export function checkRiderTimeInAllowed(targetId = null, targetName = null) {
    const myId = (targetId || appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (targetName || appState.riderName || localStorage.getItem('riderName') || "").toString().trim();
    const myNameKey = myName.toLowerCase().replace(/[^a-z0-9]/g, '_');

    const rosterRec = (globalState.rosterMembers || []).find(m => 
        ((m.telegramId || m.id || "").toString().trim() === myId) ||
        ((m.riderName || m.name || "").toLowerCase().trim() === myName.toLowerCase().trim())
    );
    const explicitRole = (rosterRec?.userType || globalState.userTypesMap?.[myId] || globalState.userTypesMap?.[myName.toLowerCase()] || appState.userType || "").toLowerCase().trim();
    const isTrueAdmin = ['admin', 'owner', 'manager', 'superadmin', 'administrator'].includes(explicitRole);

    if (isTrueAdmin) {
        return { allowed: true, reason: 'admin' };
    }

    let config = globalState.timeInSchedule;
    if (!config || typeof config !== 'object') {
        try {
            const cached = localStorage.getItem('lokalex_timein_schedule_cache');
            if (cached) config = JSON.parse(cached);
        } catch(e) {}
    }

    if (!config || config.enabled !== true) return { allowed: true, reason: 'disabled' };

    const riderSchedules = config.riderSchedules || {};
    
    let riderSched = (myId && riderSchedules[myId]) || 
                     (myName && riderSchedules[myName.toLowerCase()]) || 
                     (myNameKey && riderSchedules[myNameKey]) || 
                     null;

    if (!riderSched) {
        const foundKey = Object.keys(riderSchedules).find(k => {
            const item = riderSchedules[k];
            if (!item) return false;
            const rName = (item.riderName || item.name || k || "").toString().toLowerCase().trim();
            const rId = (item.riderId || item.telegramId || item.id || k || "").toString().trim();
            return (myId && rId === myId) || (myName && rName === myName.toLowerCase());
        });
        if (foundKey) riderSched = riderSchedules[foundKey];
    }

    if (riderSched && riderSched.earlyPassGranted === true) {
        return { allowed: true, earlyPass: true };
    }

    const allowedTimeStr = (riderSched && riderSched.allowedTimeIn) ? riderSched.allowedTimeIn : (config.defaultTimeIn || "08:00");
    const schedTotalMins = parseTimeToMinutes(allowedTimeStr);

    if (schedTotalMins === null) {
        return { allowed: true, allowedTime: allowedTimeStr };
    }

    const now = new Date();
    const currentTotalMins = (now.getHours() * 60) + now.getMinutes();

    if (currentTotalMins < schedTotalMins) {
        return {
            allowed: false,
            allowedTime: allowedTimeStr,
            currentTotalMins,
            schedTotalMins
        };
    }

    return { allowed: true, allowedTime: allowedTimeStr };
}