// src/features/roster/rosterStatus.js
import { db } from '../../config/firebase.js';
import { appState, globalState, multiCarts, activeCartSlot } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal, closeCateringModal, openRiderPasswordSetupModal } from '../../ui/modals.js';
import { calibrateGPS } from '../auth/index.js';
import { getLocalTodayStr, escapeHtml, isSameDate } from '../../utils/helpers.js';
import { switchView } from '../../ui/router.js';
import { autoStartLiveGpsSession, endLiveGpsSession } from '../liveTracker.js';
import { populateCateringCustomerDropdown } from '../chat/index.js';
import { 
    parseQueueTime, 
    calculateSplitDuration, 
    parseTimeToMinutes,
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
    sortAvailableRidersByGross,
    isSameDateStr
} from './rosterUtils.js';
import { updateRosterUI } from './rosterUI.js';
import { requestClaimCustomer } from './rosterSwap.js';

// ============================================================================
// AUTO DYNAMIC & MANUAL ACTIVE BOOKING LIMIT CALCULATION
// ============================================================================
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

// ============================================================================
// TIME-IN SCHEDULE & EARLY PASS VALIDATION HELPER
// ============================================================================
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
        const isStartingShift = !myRecord || !myRecord.status || myRecord.status === 'End';
        if (isStartingShift && db && myId) {
            const isSkippedLocal = localStorage.getItem(`lokalex_skip_pass_${myId}`) === 'true';
            if (!isSkippedLocal) {
                try {
                    const passSnap = await db.ref(`riders/${myId}`).once('value');
                    const rVal = passSnap.val() || {};
                    const hasPass = !!(rVal.password || rVal.pass);
                    const dbSkipped = !!rVal.skipPasswordSetup;

                    if (!hasPass && !dbSkipped) {
                        openRiderPasswordSetupModal(myId, appState.riderName, () => {
                            triggerStatusWithSlide('Available');
                        });
                        return;
                    }
                } catch(e) {}
            }
        }

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

        if (isStartingShift) {
            showToast("📡 Kinukuha ang GPS Location bago mag-Time In...");
            showSideNotification("GPS CHECK", "Calibrating GPS pin location...", "fa-location-crosshairs", "text-blue-400", "border-blue-500");

            const coords = await calibrateGPS((acc, count) => {
                showToast(`📡 Calibrating GPS: ±${Math.round(acc)}m (Fix ${count}/4)`);
            });

            if (!coords || !coords.lat || !coords.lon || coords.accuracy > 500) {
                showToast("❌ Bigo ang GPS. Paki-enable ang Location Access bago mag-Time In!");
                showSideNotification("GPS REQUIRED", "Cannot Time-In without GPS location pin", "fa-location-dot", "text-red-400", "border-red-500");
                return;
            }

            appState.lat = coords.lat;
            appState.lon = coords.lon;
            appState.gpsAccuracy = coords.accuracy;
            showToast(`✅ GPS Calibrated: ±${Math.round(coords.accuracy)}m`);
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
        await updateRosterStatus('Available', null, null, lockedQueueTime);

        showSideNotification("RECORDING STATUS", `Marking ${appState.riderName} Available — lineup calculated by gross earnings`, "fa-user-check", "text-green-400", "border-green-500");

        if (window.clearAllCartSlots) {
            window.clearAllCartSlots();
        } else if (window.clearCartSlot) {
            window.clearCartSlot();
        }

    } else if (targetStatus === 'End') {
        openSlideDeleteModal(`Sigurado ka bang mag-End Shift?`, async () => {
            dismissQueueAlarm();
            showSideNotification("CLOCK OUT", `Clocking out ${appState.riderName}...`, "fa-power-off", "text-red-400", "border-red-500");
            endLiveGpsSession();
            await clockOutRider();
            await updateRosterStatus('End');
        });
    } else {
        openSlideDeleteModal(`Sigurado ka bang mag-iiba ng status sa [${targetStatus}]?`, async () => {
            dismissQueueAlarm();
            showSideNotification("RECORDING STATUS", `Setting status to ${targetStatus} for ${appState.riderName}...`, "fa-user-clock", "text-amber-400", "border-amber-500");
            if (targetStatus === 'Break') endLiveGpsSession();
            await updateRosterStatus(targetStatus);
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
    const tId = (targetId || appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const tName = targetName || appState.riderName || "Rider";
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

    await updateRosterStatusData(status, "", "", newQueueTime, tId, tName, [], recordLogin, locationLink);
}

export async function updateRosterStatusData(status, customerName, startTime, queueTime = 0, specificId = null, specificName = null, completedHistory = [], recordLogin = false, locationLink = "") {
    const tId = (specificId || appState.telegramId || "").toString().trim();
    const tName = specificName || appState.riderName || "Rider";

    if (!tId) return;

    const nowTimestamp = Date.now();
    const existingRec = (globalState.rosterMembers || []).find(m => (m.telegramId || m.id || "").toString() === tId);
    const photoUrl = appState.photoUrl || localStorage.getItem('lokalex_photo_url') || localStorage.getItem('riderPhotoUrl') || existingRec?.photoUrl || "";

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
        lng: appState.lon || 0
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
    const tId = (targetId || appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
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
            lastActiveTimestamp: Date.now(),
            lastUpdated: timeStr
        }).catch(() => {});
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