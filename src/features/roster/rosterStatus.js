// src/features/roster/rosterStatus.js
import { db } from '../../config/firebase.js';
import { appState, globalState, multiCarts, activeCartSlot } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal, closeCateringModal } from '../../ui/modals.js';
import { calibrateGPS } from '../auth/index.js';
import { getLocalTodayStr, escapeHtml, isSameDate } from '../../utils/helpers.js';
import { switchView } from '../../ui/router.js';
import { autoStartLiveGpsSession, endLiveGpsSession } from '../liveTracker.js';
import { populateCateringCustomerDropdown } from '../chat/index.js';
import { 
    parseQueueTime, 
    calculateSplitDuration, 
    getActiveCateringCustomersWithTimes, 
    hasReceiptForActiveSession, 
    stopLineAlarm, 
    playLineAlarm,
    getUserType,
    isAdmin,
    saveRosterCache,
    setLineAlarmConfirmed,
    archiveRiderCateringIfNeeded,
    getRiderTodayGross,
    sortAvailableRidersByGross
} from './rosterUtils.js';
import { updateRosterUI } from './rosterUI.js';
import { requestClaimCustomer } from './rosterSwap.js';

// ============================================================================
// AUTO DYNAMIC & MANUAL ACTIVE BOOKING LIMIT CALCULATION
// ============================================================================
export function calculateAutoBookingLimit(targetId = null, targetName = null) {
    const myId = (targetId || appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (targetName || appState.riderName || localStorage.getItem('riderName') || "").trim().toLowerCase();

    // Only active duty riders (Available, Catering, Break, Cooldown) are evaluated
    const rosterMembers = (globalState.rosterMembers || []).filter(m => m && m.status !== 'End');
    
    // Auto tiering requires at least 3 active riders on roster; fallback to fixed limit otherwise
    if (rosterMembers.length < 3) {
        const fallback = globalState.bookingLimits?.maxActiveBookings;
        return (fallback !== undefined && fallback !== null) ? parseInt(fallback) : 2;
    }

    // Map each rider with today's gross income and sort ascending (lowest first, highest last)[cite: 31]
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

    // Tier 1 threshold: Lowest 33% gross income
    const lowCutIdx = Math.max(0, Math.ceil(total / 3) - 1);
    const lowCutGross = ridersWithGross[lowCutIdx].gross;

    // Tier 3 threshold: Top 33% gross income
    const highCutIdx = Math.min(total - 1, Math.floor((2 * total) / 3));
    const highCutGross = ridersWithGross[highCutIdx].gross;

    // Lowest earners: Up to 4 active bookings
    if (myGross <= lowCutGross) {
        return 4;
    }
    // Top earners: Up to 1 active booking
    if (myGross >= highCutGross && highCutGross > lowCutGross) {
        return 1;
    }
    // Mid earners: Up to 2 active bookings
    return 2;
}

export function getMaxActiveBookingsLimit(targetId = null, targetName = null) {
    const limitConfig = globalState.bookingLimits || {};
    const activeRosterCount = (globalState.rosterMembers || []).filter(m => m && m.status !== 'End').length;

    // Auto Dynamic Limit activates ONLY when 3 or more riders are on duty
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

// ============================================================================
// TIME-IN SCHEDULE & PERMANENT EARLY PASS VALIDATION HELPER
// ============================================================================
export function checkRiderTimeInAllowed(targetId = null, targetName = null) {
    const myId = (targetId || appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (targetName || appState.riderName || localStorage.getItem('riderName') || "").toString().trim();
    const myNameKey = myName.toLowerCase().replace(/[^a-z0-9]/g, '_');

    if (isAdmin()) return { allowed: true, reason: 'admin' };

    const config = globalState.timeInSchedule || {};
    if (!config.enabled) return { allowed: true, reason: 'disabled' };

    const riderSchedules = config.riderSchedules || {};
    const riderSched = (myId && riderSchedules[myId]) || 
                       (myName && riderSchedules[myName.toLowerCase()]) || 
                       (myNameKey && riderSchedules[myNameKey]) || 
                       null;

    if (riderSched && riderSched.earlyPassGranted === true) {
        return { allowed: true, earlyPass: true };
    }

    const allowedTimeStr = (riderSched && riderSched.allowedTimeIn) ? riderSched.allowedTimeIn : (config.defaultTimeIn || "08:00");
    const [schedH, schedM] = allowedTimeStr.split(':').map(Number);
    const schedTotalMins = (schedH * 60) + (schedM || 0);

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

export function getTopQueueTime() {
    const rosterMembers = globalState.rosterMembers || [];
    const availableRiders = rosterMembers
        .filter(m => m.status === 'Available')
        .map(m => parseQueueTime(m.queueTime))
        .filter(t => t > 0);

    if (availableRiders.length > 0) {
        const minTime = Math.min(...availableRiders);
        return minTime - 1000;
    }
    return Date.now() - 1000;
}

export function dismissQueueAlarm() {
    setLineAlarmConfirmed(true);
    stopLineAlarm();
    const modal = document.getElementById('first-line-modal') || document.getElementById('first-in-line-modal');
    if (modal) modal.classList.add('hidden');
}

export function checkFirstInLineNotification() {
    const rosterMembers = globalState.rosterMembers || [];
    const availableRiders = sortAvailableRidersByGross(rosterMembers.filter(m => m.status === 'Available'));
    const myId = (appState.telegramId || "").toString();

    if (myId && availableRiders.length > 0 && (availableRiders[0].telegramId || "").toString() === myId) {
        const modal = document.getElementById('first-line-modal') || document.getElementById('first-in-line-modal');
        if (modal && modal.classList.contains('hidden')) {
            modal.classList.remove('hidden');
            playLineAlarm();
        }
    }
}

export async function voidSingleCateringCustomer(targetId, targetName, custNameToVoid) {
    const rosterMembers = globalState.rosterMembers || [];
    const targetRecord = rosterMembers.find(m => (m.telegramId || m.id || "").toString().trim() === targetId.toString().trim());
    if (!targetRecord) return;

    let remainingCusts = [];
    let remainingTimes = [];

    if (targetRecord.customerName) {
        const custs = targetRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
        const times = targetRecord.startTime ? targetRecord.startTime.split(', ').map(t => t.trim()) : [];

        custs.forEach((c, idx) => {
            if (c.toLowerCase().trim() !== custNameToVoid.toLowerCase().trim()) {
                remainingCusts.push(c);
                remainingTimes.push(times[idx] || times[0] || "");
            }
        });
    }

    const cleanVoidCust = custNameToVoid.toLowerCase().trim();
    if (db) {
        db.ref('customerChats').once('value', (snapshot) => {
            const chats = snapshot.val() || {};
            Object.keys(chats).forEach(custId => {
                const meta = chats[custId]?.metadata || chats[custId] || {};
                const chatCustName = (meta.customerName || meta.name || "").toLowerCase().trim();
                if (chatCustName && chatCustName === cleanVoidCust) {
                    db.ref(`customerChats/${custId}/metadata`).update({
                        folder: 'done',
                        status: 'cancelled',
                        cateredByRiderId: null,
                        cateredByRiderName: null,
                        cateredBy: null,
                        lastUpdated: Date.now()
                    });
                }
            });
        });

        const cleanCustKey = cleanVoidCust.replace(/[^a-z0-9]/g, '');
        if (cleanCustKey) {
            db.ref(`roster/${targetId}/customerFees/${cleanCustKey}`).remove().catch(() => {});
        }
    }

    if (remainingCusts.length > 0) {
        await updateRosterStatusData('Catering', remainingCusts.join(', '), remainingTimes.join(', '), parseQueueTime(targetRecord.queueTime), targetId, targetName);
        showToast(`🚫 Voided [${custNameToVoid}]. ${remainingCusts.length} active customer(s) remaining.`);
        showSideNotification("CUSTOMER VOIDED", `Removed ${custNameToVoid}. ${remainingCusts.length} remaining`, "fa-ban", "text-amber-400", "border-amber-500");
    } else {
        const topQueueTime = getTopQueueTime();
        await updateRosterStatusData('Available', '', '', topQueueTime, targetId, targetName);
        showToast(`🚫 Voided [${custNameToVoid}]. Moved to Available queue!`);
        showSideNotification("ALL VOIDED", `Placed in Available queue`, "fa-user-check", "text-emerald-400", "border-emerald-500");
    }
}

export async function triggerStatusWithSlide(targetStatus) {
    const rosterMembers = globalState.rosterMembers || [];
    const myId = (appState.telegramId || "").toString();
    const myRecord = rosterMembers.find(m => (m.telegramId || m.id || "").toString() === myId);

    if (myRecord && myRecord.status === 'End' && targetStatus !== 'Available') {
        showToast("⚠️ Naka-End Shift ka. Ang Available button lamang ang maaaring pindutin.");
        return;
    }

    if (targetStatus === 'Available') {
        const timeCheck = checkRiderTimeInAllowed(appState.telegramId, appState.riderName);
        if (!timeCheck.allowed) {
            showToast(`🚫 Bawal pa mag-Time In: Ang iyong allowed time-in ay ${timeCheck.allowedTime}. Humingi ng Early Time-In pass sa Admin.`);
            showSideNotification("TIME-IN RESTRICTED", `Allowed at ${timeCheck.allowedTime}. Need Admin Early Pass.`, "fa-clock", "text-red-400", "border-red-500");
            return;
        }

        if (myRecord && myRecord.status === 'Cooldown' && myRecord.cooldownUntil && Date.now() < myRecord.cooldownUntil) {
            const remMins = Math.ceil((myRecord.cooldownUntil - Date.now()) / 60000);
            showToast(`⚠️ Naka-penalty cooldown ka pa. Maghintay ng ${remMins} min(s) bago maging Available.`);
            return;
        }

        if (myRecord && myRecord.pendingPenaltyMinutes && myRecord.pendingPenaltyMinutes > 0) {
            const pMins = parseInt(myRecord.pendingPenaltyMinutes) || 10;
            const cdUntil = Date.now() + (pMins * 60000);

            showSideNotification("PENALTY COOLDOWN", `Starting ${pMins} min penalty cooldown for ${appState.riderName}`, "fa-clock", "text-yellow-400", "border-yellow-500");

            if (db && appState.telegramId) {
                db.ref('roster/' + appState.telegramId).update({
                    status: 'Cooldown',
                    cooldownUntil: cdUntil,
                    pendingPenaltyMinutes: 0,
                    lastUpdated: new Date().toLocaleTimeString(),
                    lastActiveTimestamp: Date.now()
                });
            }

            showToast(`⚠️ Penalized! Naka-cooldown ka ng ${pMins} mins. Kusa kang gagawing Available pagkatapos.`);
            return;
        }

        const activeCustList = getActiveCateringCustomersWithTimes();
        if (activeCustList.length > 0) {
            let missingReceiptCust = null;
            for (let item of activeCustList) {
                if (!hasReceiptForActiveSession(item.name, item.startTime)) {
                    missingReceiptCust = item;
                    break;
                }
            }

            if (missingReceiptCust) {
                showToast(`⚠️ Paki-gawaan muna ng resibo si ${missingReceiptCust.name} (o i-void kung cancel) bago mag-Available!`);
                
                if (multiCarts && activeCartSlot) {
                    multiCarts[activeCartSlot].customerName = missingReceiptCust.name;
                    multiCarts[activeCartSlot].isManual = false;
                    if (window.saveCartState) window.saveCartState();
                }
                switchView('view-cart');
                return;
            }
        }

        const currentRoster = globalState.rosterMembers || [];
        const availableRiders = currentRoster.filter(m => m.status === 'Available' && (m.telegramId || m.id || "").toString() !== myId);
        let maxTime = new Date().getTime();
        availableRiders.forEach(r => {
            const t = parseQueueTime(r.queueTime);
            if (t > maxTime) maxTime = t;
        });
        const lockedQueueTime = maxTime + 1000;

        endLiveGpsSession();
        dismissQueueAlarm();
        updateRosterStatus('Available', null, null, lockedQueueTime);

        showSideNotification("RECORDING STATUS", `Marking ${appState.riderName} Available — lineup calculated by gross earnings`, "fa-user-check", "text-green-400", "border-green-500");

        if (window.clearAllCartSlots) {
            window.clearAllCartSlots();
        } else if (window.clearCartSlot) {
            window.clearCartSlot();
        }

        showToast("📡 Calibrating GPS location in background...");
        calibrateGPS((accuracy) => {
            showToast(`📡 Calibrating GPS: ±${Math.round(accuracy)}m`);
        }).then((coords) => {
            if (coords) {
                appState.lat = coords.lat || appState.lat || 0;
                appState.lon = coords.lon || appState.lon || 0;
                showToast(`✅ GPS Calibrated: ±${Math.round(coords.accuracy)}m`);

                if (db && appState.telegramId) {
                    db.ref('roster/' + appState.telegramId).update({
                        lat: appState.lat,
                        lng: appState.lon,
                        accuracy: coords.accuracy,
                        lastActiveTimestamp: Date.now()
                    }).catch(() => {});
                }
            }
        });

    } else if (targetStatus === 'End') {
        openSlideDeleteModal(`Sigurado ka bang mag-End Shift?`, async () => {
            dismissQueueAlarm();
            showSideNotification("CLOCK OUT", `Clocking out ${appState.riderName}...`, "fa-power-off", "text-red-400", "border-red-500");
            endLiveGpsSession();
            await clockOutRider();
            updateRosterStatus('End');
        });
    } else {
        openSlideDeleteModal(`Sigurado ka bang mag-iiba ng status sa [${targetStatus}]?`, () => {
            dismissQueueAlarm();
            showSideNotification("RECORDING STATUS", `Setting status to ${targetStatus} for ${appState.riderName}...`, "fa-user-clock", "text-amber-400", "border-amber-500");
            if (targetStatus === 'Break') endLiveGpsSession();
            updateRosterStatus(targetStatus);
        });
    }
}

export function promptCateringStatus() {
    const rosterMembers = globalState.rosterMembers || [];
    const myId = (appState.telegramId || "").toString();
    const myRecord = rosterMembers.find(m => (m.telegramId || m.id || "").toString() === myId);

    if (myRecord) {
        if (myRecord.status === 'End') return showToast("⚠️ Naka-End Shift ka. Mag-Available muna bago mag-Cater.");
        if (myRecord.status === 'Break') return showToast("⚠️ Naka-Break ka. Mag-Available muna bago mag-Cater.");
        if (myRecord.status === 'Cooldown') return showToast("⚠️ Naka-penalty cooldown ka pa. Maghintay muna matapos.");
    }

    const amIAlreadyCatering = myRecord && myRecord.status === 'Catering';
    const availableRiders = sortAvailableRidersByGross(rosterMembers.filter(m => m.status === 'Available'));

    if (!amIAlreadyCatering && availableRiders.length > 0) {
        const firstAvailable = availableRiders[0];
        if ((firstAvailable?.telegramId || firstAvailable?.id || "").toString() !== myId) {
            const firstGross = getRiderTodayGross(firstAvailable.riderName || firstAvailable.name, firstAvailable.telegramId || firstAvailable.id);
            const myGross = getRiderTodayGross(myRecord?.riderName || myRecord?.name, myId);
            return showToast(`⚠️ 1st in line: ${firstAvailable.riderName || 'Rider'} (Kita: ₱${firstGross.toFixed(0)}) vs Iyo (₱${myGross.toFixed(0)}). Maghintay sa iyong turn.`);
        }
    }

    // ENFORCE ACTIVE BOOKING LIMIT (MANUAL OR AUTO DYNAMIC TIER)
    const limitCheck = canRiderTakeMoreBookings(myId, appState.riderName);
    if (!limitCheck.allowed) {
        const modeLabel = limitCheck.isAuto ? " (Auto Tier based on today's gross income)" : "";
        return showToast(`⚠️ Reached maximum limit of ${limitCheck.maxAllowed} active catering customer(s)${modeLabel}!`);
    }

    if (typeof populateCateringCustomerDropdown === 'function') {
        populateCateringCustomerDropdown();
    }

    const input = document.getElementById('catering-customer-name');
    if (input) input.value = "";
    const modal = document.getElementById('catering-modal');
    if (modal) modal.classList.remove('hidden');
    if (input) input.focus();
}

export async function confirmCateringStatus() {
    const input = document.getElementById('catering-customer-name');
    const custName = input ? input.value.trim() : "";
    if (!custName) return showToast("Please enter customer name");

    const myId = (appState.telegramId || "").toString();
    const myName = appState.riderName || localStorage.getItem('riderName') || "Rider";
    const myRecord = globalState.rosterMembers ? globalState.rosterMembers.find(m => (m.telegramId || m.id || "").toString() === myId) : null;

    let existingCustomers = [];
    let existingTimes = [];

    if (myRecord && myRecord.status === 'Catering' && myRecord.customerName) {
        existingCustomers = myRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
        existingTimes = myRecord.startTime ? myRecord.startTime.split(', ').map(t => t.trim()) : [];
    }

    const isAlreadyInList = existingCustomers.some(c => c.toLowerCase() === custName.toLowerCase());

    // ENFORCE ACTIVE BOOKING LIMIT
    if (!isAlreadyInList) {
        const limitCheck = canRiderTakeMoreBookings(myId, myName);
        if (!limitCheck.allowed) {
            const modeLabel = limitCheck.isAuto ? " (Auto Income Tier Limit)" : "";
            return showToast(`⚠️ Reached maximum limit of ${limitCheck.maxAllowed} active catering customer(s)${modeLabel}!`);
        }
    }

    closeCateringModal();
    dismissQueueAlarm();

    const startTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (!isAlreadyInList) {
        existingCustomers.push(custName);
        existingTimes.push(startTime);
    }

    if (db && custName) {
        const cleanSearchName = custName.toLowerCase().trim();
        db.ref('customerChats').once('value', (snapshot) => {
            const chats = snapshot.val();
            if (chats) {
                Object.keys(chats).forEach(custId => {
                    const meta = chats[custId]?.metadata || chats[custId] || {};
                    const chatCustName = (meta.customerName || meta.name || "").toLowerCase().trim();
                    if (chatCustName && chatCustName === cleanSearchName) {
                        db.ref(`customerChats/${custId}/metadata`).update({
                            folder: 'catering',
                            cateredByRiderId: myId,
                            cateredByRiderName: myName,
                            cateredBy: myName,
                            lastUpdated: Date.now()
                        });
                    }
                });
            }
        });
    }

    showSideNotification("RECORDING CATERING", `Moving to Catering — adding customer ${custName} to ${appState.riderName}`, "fa-motorcycle", "text-red-400", "border-red-500");
    
    try { autoStartLiveGpsSession(existingCustomers.join(', ')); } catch(e) {}

    await updateRosterStatusData('Catering', existingCustomers.join(', '), existingTimes.join(', '), myRecord ? parseQueueTime(myRecord.queueTime) : 0);
}

export function claimCustomerFromRider(fromRiderId, fromRiderName, custName) {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "Rider").trim();

    if (!myId) return showToast("⚠️ Rider ID missing.");
    if (fromRiderId.toString().trim() === myId) return showToast("⚠️ Iyo na ang customer na ito.");

    const limitCheck = canRiderTakeMoreBookings(myId, myName);
    if (!limitCheck.allowed) {
        const modeLabel = limitCheck.isAuto ? " (Auto Income Tier)" : "";
        return showToast(`⚠️ Hindi mo ma-claim: Naabot mo na ang limit na ${limitCheck.maxAllowed} active booking(s)${modeLabel}.`);
    }

    openSlideDeleteModal(
        `Request Customer: ${custName}?`,
        `Hihingin mo ba si ${custName} mula kay ${fromRiderName}?\nMagpapadala ng request para sa kanyang pag-apruba.`,
        () => {
            requestClaimCustomer(fromRiderId, fromRiderName, custName);
        }
    );
}

export async function updateRosterStatus(status, targetId = null, targetName = null, precalculatedQueueTime = null) {
    const tId = targetId || appState.telegramId;
    const tName = targetName || appState.riderName;
    const rosterMembers = globalState.rosterMembers || [];

    let recordLogin = false;
    const targetRecord = rosterMembers.find(m => (m.telegramId || m.id || "").toString() === tId.toString());

    if (status !== 'Catering' && targetRecord) {
        await archiveRiderCateringIfNeeded(targetRecord);
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
        const availableRiders = rosterMembers.filter(m => m.status === 'Available' && (m.telegramId || m.id || "").toString() !== tId.toString());
        let maxTime = new Date().getTime();
        availableRiders.forEach(r => {
            const t = parseQueueTime(r.queueTime);
            if (t > maxTime) maxTime = t;
        });
        newQueueTime = maxTime + 1000;
    }

    await updateRosterStatusData(status, "", "", newQueueTime, tId, tName, [], recordLogin, locationLink);
}

export async function updateRosterStatusData(status, customerName, startTime, queueTime = 0, specificId = null, specificName = null, completedHistory = [], recordLogin = false, locationLink = "") {
    const tId = specificId || appState.telegramId;
    const tName = specificName || appState.riderName;

    if (!tId) return;

    const nowTimestamp = Date.now();
    const rosterData = {
        telegramId: tId.toString(),
        id: tId.toString(),
        riderName: tName,
        name: tName,
        userType: getUserType(),
        status: status,
        customerName: customerName || "",
        startTime: startTime || "",
        queueTime: (queueTime !== null && queueTime !== undefined && queueTime !== 0) ? queueTime : nowTimestamp,
        lastUpdated: new Date().toLocaleTimeString(),
        lastActiveTimestamp: nowTimestamp,
        lat: appState.lat || 0,
        lng: appState.lon || 0
    };

    if (!globalState.rosterMembers) globalState.rosterMembers = [];
    const existingIdx = globalState.rosterMembers.findIndex(m => (m.telegramId || m.id || "").toString() === tId.toString());
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
    }

    if (recordLogin && db) {
        const todayStr = getLocalTodayStr();
        let finalLoginTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        try {
            const loginSnap = await db.ref('logins/' + tId).once('value');
            const existingLogin = loginSnap.val();
            if (existingLogin && isSameDate(existingLogin.date, todayStr) && existingLogin.loginTime && !existingLogin.clockOutTime) {
                finalLoginTime = existingLogin.loginTime;
            }
        } catch(e) {}

        const loginEntry = {
            riderName: tName,
            loginTime: finalLoginTime,
            clockOutTime: "",
            date: todayStr,
            location: locationLink
        };
        await db.ref('logins/' + tId).set(loginEntry);
    }
}

export async function clockOutRider() {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (db && appState.telegramId) {
        await db.ref('logins/' + appState.telegramId).update({ clockOutTime: timeStr });
        await db.ref('roster/' + appState.telegramId).update({ lastActiveTimestamp: Date.now() });
    }
}