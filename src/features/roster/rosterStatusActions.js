// src/features/roster/rosterStatusActions.js
import { db } from '../../config/firebase.js';
import { appState, globalState, multiCarts, activeCartSlot } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal, closeCateringModal, openRiderPasswordSetupModal } from '../../ui/modals.js';
import { calibrateGPS } from '../auth/index.js';
import { switchView } from '../../ui/router.js';
import { autoStartLiveGpsSession, endLiveGpsSession } from '../liveTracker.js';
import { populateCateringCustomerDropdown } from '../chat/index.js';
import { 
    parseQueueTime, 
    getActiveCateringCustomersWithTimes, 
    hasReceiptForActiveSession, 
    stopLineAlarm, 
    playLineAlarm,
    setLineAlarmConfirmed,
    getRiderTodayGross,
    sortAvailableRidersByGross,
    canManageRoster,
    hasTlPermission,
    saveRosterCache
} from './rosterUtils.js';
import { updateRosterUI } from './rosterUI.js';
import { requestClaimCustomer } from './rosterSwap.js';
import { canRiderTakeMoreBookings, checkRiderTimeInAllowed } from './rosterStatusLimits.js';
import { updateRosterStatus, updateRosterStatusData, clockOutRider } from './rosterStatusCore.js';

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
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    if (availableRiders.length > 0) {
        const first = availableRiders[0];
        const firstId = (first.telegramId || first.id || "").toString().trim();
        const firstName = (first.riderName || first.name || "").toString().trim().toLowerCase();

        const isMe = (myId && firstId && firstId === myId) || (myName && firstName && firstName === myName);
        if (isMe) {
            const modal = document.getElementById('first-line-modal') || document.getElementById('first-in-line-modal');
            if (modal && modal.classList.contains('hidden')) {
                modal.classList.remove('hidden');
                playLineAlarm();
            }
        }
    }
}

export async function voidSingleCateringCustomer(targetId, targetName, custNameToVoid) {
    const rosterMembers = globalState.rosterMembers || [];
    const cleanTargetId = (targetId || "").toString().trim();
    const cleanTargetName = (targetName || "").toString().trim().toLowerCase();

    let targetRecord = rosterMembers.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        if (cleanTargetId && mId && mId === cleanTargetId) return true;
        if (cleanTargetName && mName && mName === cleanTargetName) return true;
        return false;
    });

    const resolvedTargetId = targetRecord ? (targetRecord.telegramId || targetRecord.id || cleanTargetId) : cleanTargetId;
    const resolvedTargetName = targetRecord ? (targetRecord.riderName || targetRecord.name || targetName) : targetName;

    if (!resolvedTargetId && !targetRecord) return;

    let remainingCusts = [];
    let remainingTimes = [];

    if (targetRecord && targetRecord.customerName) {
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
    const cleanCustKey = cleanVoidCust.replace(/[^a-z0-9]/g, '');

    if (targetRecord && targetRecord.forcedCaters) {
        delete targetRecord.forcedCaters[cleanCustKey];
        delete targetRecord.forcedCaters[cleanVoidCust];
        delete targetRecord.forcedCaters[custNameToVoid];

        if (Object.keys(targetRecord.forcedCaters).length === 0) {
            targetRecord.forcedCaters = null;
            targetRecord.isForcedCater = false;
            targetRecord.forcedBy = null;
        }
    }

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
                        forcedBy: null,
                        isForcedCater: false,
                        lastUpdated: Date.now()
                    });
                }
            });
        });

        if (resolvedTargetId && cleanCustKey) {
            db.ref(`roster/${resolvedTargetId}/customerFees/${cleanCustKey}`).remove().catch(() => {});
            db.ref(`roster/${resolvedTargetId}/forcedCaters/${cleanCustKey}`).remove().catch(() => {});
            db.ref(`roster/${resolvedTargetId}/forcedCaters/${cleanVoidCust}`).remove().catch(() => {});
        }
    }

    if (remainingCusts.length > 0) {
        await updateRosterStatusData(
            'Catering', 
            remainingCusts.join(', '), 
            remainingTimes.join(', '), 
            targetRecord ? parseQueueTime(targetRecord.queueTime) : Date.now(), 
            resolvedTargetId, 
            resolvedTargetName,
            [],
            false,
            "",
            { 
                forcedCaters: targetRecord ? targetRecord.forcedCaters : null,
                forcedBy: targetRecord ? targetRecord.forcedBy : null,
                isForcedCater: !!(targetRecord && targetRecord.isForcedCater)
            }
        );
        showToast(`🚫 Voided [${custNameToVoid}]. ${remainingCusts.length} active customer(s) remaining.`);
    } else {
        const topQueueTime = getTopQueueTime();
        if (db && resolvedTargetId) {
            db.ref(`roster/${resolvedTargetId}/forcedCaters`).remove().catch(() => {});
            db.ref(`roster/${resolvedTargetId}`).update({
                forcedBy: null,
                isForcedCater: false
            }).catch(() => {});
        }
        if (targetRecord) {
            targetRecord.forcedCaters = null;
            targetRecord.forcedBy = null;
            targetRecord.isForcedCater = false;
        }
        await updateRosterStatusData(
            'Available', 
            '', 
            '', 
            topQueueTime, 
            resolvedTargetId, 
            resolvedTargetName,
            [],
            false,
            "",
            { 
                forcedCaters: null,
                forcedBy: null,
                isForcedCater: false
            }
        );
        showToast(`🚫 Voided [${custNameToVoid}]. Moved to Available queue!`);
    }
}

export async function triggerStatusWithSlide(targetStatus) {
    const rosterMembers = globalState.rosterMembers || [];
    const currentId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const currentName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    let myRecord = rosterMembers.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        if (currentId && mId && mId === currentId) return true;
        if (currentName && mName && mName === currentName) return true;
        return false;
    });

    const myId = myRecord ? (myRecord.telegramId || myRecord.id || currentId) : currentId;
    const myName = myRecord ? (myRecord.riderName || myRecord.name || appState.riderName || "Rider") : (appState.riderName || "Rider");

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
                        openRiderPasswordSetupModal(myId, myName, () => {
                            triggerStatusWithSlide('Available');
                        });
                        return;
                    }
                } catch(e) {}
            }
        }

        const timeCheck = checkRiderTimeInAllowed(myId, myName);
        if (!timeCheck.allowed) {
            showToast(`🚫 Bawal pa mag-Time In: Ang iyong allowed time-in ay ${timeCheck.allowedTime}. Humingi ng Early Time-In pass sa Admin.`);
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

            if (db && myId) {
                db.ref('roster/' + myId).update({
                    status: 'Cooldown',
                    cooldownUntil: cdUntil,
                    pendingPenaltyMinutes: 0,
                    forcedCaters: null,
                    forcedBy: null,
                    isForcedCater: false,
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
            const coords = await calibrateGPS((acc, count) => {
                showToast(`📡 Calibrating GPS: ±${Math.round(acc)}m (Fix ${count}/4)`);
            });

            if (!coords || !coords.lat || !coords.lon || coords.accuracy > 500) {
                showToast("❌ Bigo ang GPS. Paki-enable ang Location Access bago mag-Time In!");
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

        if (db && myId) {
            db.ref(`roster/${myId}/forcedCaters`).remove().catch(() => {});
            db.ref(`roster/${myId}`).update({
                forcedBy: null,
                isForcedCater: false
            }).catch(() => {});
        }
        if (myRecord) {
            myRecord.forcedCaters = null;
            myRecord.forcedBy = null;
            myRecord.isForcedCater = false;
        }

        await updateRosterStatus('Available', myId, myName, lockedQueueTime);

        if (window.clearAllCartSlots) {
            window.clearAllCartSlots();
        } else if (window.clearCartSlot) {
            window.clearCartSlot();
        }

    } else if (targetStatus === 'End') {
        openSlideDeleteModal(`Sigurado ka bang mag-End Shift?`, async () => {
            dismissQueueAlarm();
            endLiveGpsSession();
            if (db && myId) {
                db.ref(`roster/${myId}/forcedCaters`).remove().catch(() => {});
                db.ref(`roster/${myId}`).update({
                    forcedBy: null,
                    isForcedCater: false
                }).catch(() => {});
            }
            if (myRecord) {
                myRecord.forcedCaters = null;
                myRecord.forcedBy = null;
                myRecord.isForcedCater = false;
            }
            await clockOutRider(myId);
            await updateRosterStatus('End', myId, myName);
        });
    } else {
        openSlideDeleteModal(`Sigurado ka bang mag-iiba ng status sa [${targetStatus}]?`, async () => {
            dismissQueueAlarm();
            if (targetStatus === 'Break') endLiveGpsSession();
            await updateRosterStatus(targetStatus, myId, myName);
        });
    }
}

export async function promptCateringStatus() {
    let rosterMembers = globalState.rosterMembers || [];

    if (db) {
        try {
            const snap = await db.ref('roster').once('value');
            const liveData = snap.val();
            if (liveData) {
                rosterMembers = Object.entries(liveData).map(([id, r]) => ({
                    telegramId: id,
                    id: id,
                    ...r
                }));
                globalState.rosterMembers = rosterMembers;
            }
        } catch (e) {
            console.warn("Failed to fetch live roster for queue check:", e);
        }
    }

    const currentId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const currentName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    const myRecord = rosterMembers.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        if (currentId && mId && mId === currentId) return true;
        if (currentName && mName && mName === currentName) return true;
        return false;
    });

    const myId = myRecord ? (myRecord.telegramId || myRecord.id || currentId) : currentId;
    const myName = myRecord ? (myRecord.riderName || myRecord.name || appState.riderName || "Rider") : (appState.riderName || "Rider");

    if (!myId && !myRecord) return showToast("⚠️ Missing Rider identity.");

    if (myRecord && !canManageRoster()) {
        if (myRecord.status === 'End') return showToast("⚠️ Naka-End Shift ka. Mag-Available muna bago mag-Cater.");
        if (myRecord.status === 'Break') return showToast("⚠️ Naka-Break ka. Mag-Available muna bago mag-Cater.");
        if (myRecord.status === 'Cooldown') return showToast("⚠️ Naka-penalty cooldown ka pa. Maghintay muna matapos.");
    }

    const amIAlreadyCatering = myRecord && myRecord.status === 'Catering';
    const liveAvailableRiders = sortAvailableRidersByGross(rosterMembers.filter(m => m.status === 'Available'));

    if (!canManageRoster() && !amIAlreadyCatering && liveAvailableRiders.length > 0) {
        const firstAvailable = liveAvailableRiders[0];
        const firstId = (firstAvailable?.telegramId || firstAvailable?.id || "").toString().trim();
        if (firstId !== myId) {
            const firstGross = getRiderTodayGross(firstAvailable.riderName || firstAvailable.name, firstAvailable.telegramId || firstAvailable.id);
            const myGross = getRiderTodayGross(myRecord?.riderName || myRecord?.name, myId);
            return showToast(`⚠️ 1st in line: ${firstAvailable.riderName || 'Rider'} (Kita: ₱${firstGross.toFixed(0)}) vs Iyo (₱${myGross.toFixed(0)}). Maghintay sa iyong turn.`);
        }
    }

    const limitCheck = canRiderTakeMoreBookings(myId, myName);
    if (!limitCheck.allowed) {
        const modeLabel = limitCheck.isAuto ? " (Auto Tier based on today's gross income)" : "";
        return showToast(`⚠️ Reached maximum limit of ${limitCheck.maxAllowed} active catering customer(s)${modeLabel}!`);
    }

    if (typeof populateCateringCustomerDropdown === 'function') {
        populateCateringCustomerDropdown();
    }

    const input = document.getElementById('catering-customer-name') || document.getElementById('admin-cater-cust-name');
    if (input) input.value = "";
    const modal = document.getElementById('catering-modal') || document.getElementById('admin-catering-modal');
    if (modal) modal.classList.remove('hidden');
    if (input) input.focus();
}

export async function confirmCateringStatus() {
    const input = document.getElementById('catering-customer-name') || document.getElementById('admin-cater-cust-name');
    const custSelect = document.getElementById('catering-customer-select') || document.getElementById('admin-cater-customer-select');
    const penaltySelect = document.getElementById('catering-penalty-select') || document.getElementById('admin-cater-penalty-select');

    let custName = (input && input.value ? input.value.trim() : "") || (custSelect && custSelect.value ? custSelect.value.trim() : "");
    if (!custName) return showToast("Please enter or select customer name");

    let liveRoster = globalState.rosterMembers || [];
    if (db) {
        try {
            const snap = await db.ref('roster').once('value');
            const val = snap.val();
            if (val) {
                liveRoster = Object.entries(val).map(([id, r]) => ({
                    telegramId: id,
                    id: id,
                    ...r
                }));
                globalState.rosterMembers = liveRoster;
            }
        } catch (e) {
            console.warn("Live roster confirmation check error:", e);
        }
    }

    const currentId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const currentName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim();

    let myRecord = liveRoster.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        if (currentId && mId && mId === currentId) return true;
        if (currentName && mName && mName === currentName.toLowerCase()) return true;
        return false;
    });

    const resolvedId = myRecord ? (myRecord.telegramId || myRecord.id || currentId) : currentId;
    const myName = myRecord ? (myRecord.riderName || myRecord.name || currentName || "Rider") : (currentName || "Rider");

    if (resolvedId && !appState.telegramId) {
        appState.telegramId = resolvedId;
        try { localStorage.setItem('telegramId', resolvedId); } catch(e) {}
    }

    if (myRecord && !canManageRoster()) {
        if (myRecord.status === 'End') {
            closeCateringModal();
            return showToast("⚠️ Naka-End Shift ka. Hindi maaaring mag-Cater.");
        }
        if (myRecord.status === 'Break') {
            closeCateringModal();
            return showToast("⚠️ Naka-Break ka. Hindi maaaring mag-Cater.");
        }
        if (myRecord.status === 'Cooldown') {
            closeCateringModal();
            return showToast("⚠️ Naka-penalty cooldown ka pa.");
        }
    }

    const amIAlreadyCatering = myRecord && myRecord.status === 'Catering';
    const liveAvailableRiders = sortAvailableRidersByGross(liveRoster.filter(m => m.status === 'Available'));
    const isFirstAvailable = liveAvailableRiders.length > 0 && (liveAvailableRiders[0]?.telegramId || liveAvailableRiders[0]?.id || "").toString().trim() === resolvedId;

    const hasPenalty = penaltySelect && parseInt(penaltySelect.value) > 0;
    const isPrivileged = canManageRoster();

    // Legitimate turn: if privileged and legitimately taking turn as #1 in line, it is a regular cater
    const isQueueJump = liveAvailableRiders.length > 0 && !isFirstAvailable && !amIAlreadyCatering;
    const isBypassingAvailability = !myRecord || (myRecord.status !== 'Available' && !amIAlreadyCatering);
    const isForcedByRole = isPrivileged && (isQueueJump || isBypassingAvailability || hasPenalty);

    if (!isPrivileged && !amIAlreadyCatering && liveAvailableRiders.length > 0 && !isFirstAvailable) {
        closeCateringModal();
        const firstAvailable = liveAvailableRiders[0];
        const firstGross = getRiderTodayGross(firstAvailable.riderName || firstAvailable.name, firstAvailable.telegramId || firstAvailable.id);
        showToast(`🚫 Naunahan ka sa pila: Si ${firstAvailable.riderName || 'Rider'} (₱${firstGross.toFixed(0)}) ang 1st in line.`);
        return;
    }

    let existingCustomers = [];
    let existingTimes = [];

    if (myRecord && myRecord.status === 'Catering' && myRecord.customerName) {
        existingCustomers = myRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
        existingTimes = myRecord.startTime ? myRecord.startTime.split(', ').map(t => t.trim()) : [];
    }

    const isAlreadyInList = existingCustomers.some(c => c.toLowerCase() === custName.toLowerCase());

    if (!isAlreadyInList) {
        const limitCheck = canRiderTakeMoreBookings(resolvedId, myName);
        if (!limitCheck.allowed) {
            const modeLabel = limitCheck.isAuto ? " (Auto Income Tier Limit)" : "";
            return showToast(`⚠️ Reached maximum limit of ${limitCheck.maxAllowed} active catering customer(s)${modeLabel}!`);
        }
    }

    closeCateringModal();
    const modalGeneral = document.getElementById('admin-catering-modal');
    if (modalGeneral) modalGeneral.classList.add('hidden');
    dismissQueueAlarm();

    const startTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (!isAlreadyInList) {
        existingCustomers.push(custName);
        existingTimes.push(startTime);
    }

    const cleanCustKey = custName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanCustTrimmed = custName.toLowerCase().trim();

    let forcedCatersMap = {};
    if (myRecord && myRecord.forcedCaters && typeof myRecord.forcedCaters === 'object') {
        forcedCatersMap = { ...myRecord.forcedCaters };
    }

    if (isForcedByRole && resolvedId && cleanCustKey) {
        const forcedPayload = {
            customerName: custName,
            forcedBy: myName,
            isSelfForced: true,
            timestamp: Date.now()
        };

        forcedCatersMap[cleanCustKey] = forcedPayload;
        forcedCatersMap[cleanCustTrimmed] = forcedPayload;

        if (myRecord) {
            myRecord.forcedCaters = forcedCatersMap;
            myRecord.forcedBy = myName;
            myRecord.isForcedCater = true;
        }

        if (db) {
            await db.ref(`roster/${resolvedId}/forcedCaters/${cleanCustKey}`).set(forcedPayload).catch(() => {});
            await db.ref(`roster/${resolvedId}`).update({
                forcedBy: myName,
                isForcedCater: true
            }).catch(() => {});
        }
    } else if (!isForcedByRole && resolvedId && cleanCustKey) {
        delete forcedCatersMap[cleanCustKey];
        delete forcedCatersMap[cleanCustTrimmed];

        if (db) {
            db.ref(`roster/${resolvedId}/forcedCaters/${cleanCustKey}`).remove().catch(() => {});
            db.ref(`roster/${resolvedId}/forcedCaters/${cleanCustTrimmed}`).remove().catch(() => {});
        }
    }

    const hasAnyForcedCaters = Object.keys(forcedCatersMap).length > 0;
    if (!hasAnyForcedCaters && myRecord) {
        myRecord.forcedCaters = null;
        myRecord.forcedBy = null;
        myRecord.isForcedCater = false;
        if (db && resolvedId) {
            db.ref(`roster/${resolvedId}`).update({
                forcedBy: null,
                isForcedCater: false
            }).catch(() => {});
        }
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
                        const updateObj = {
                            folder: 'catering',
                            cateredByRiderId: resolvedId,
                            cateredByRiderName: myName,
                            cateredBy: myName,
                            lastUpdated: Date.now()
                        };
                        if (isForcedByRole) {
                            updateObj.forcedBy = myName;
                            updateObj.isForcedCater = true;
                        } else {
                            updateObj.forcedBy = null;
                            updateObj.isForcedCater = false;
                        }
                        db.ref(`customerChats/${custId}/metadata`).update(updateObj);
                    }
                });
            }
        });
    }

    try { autoStartLiveGpsSession(existingCustomers.join(', ')); } catch(e) {}

    await updateRosterStatusData(
        'Catering', 
        existingCustomers.join(', '), 
        existingTimes.join(', '), 
        myRecord ? parseQueueTime(myRecord.queueTime) : Date.now(),
        resolvedId,
        myName,
        [],
        false,
        "",
        { 
            forcedCaters: hasAnyForcedCaters ? forcedCatersMap : null,
            forcedBy: hasAnyForcedCaters ? (myRecord?.forcedBy || myName) : null,
            isForcedCater: hasAnyForcedCaters
        }
    );

    saveRosterCache();
    updateRosterUI();

    if (isForcedByRole) {
        showToast(`⚡ Force Catered ${custName} (Self)`);
    }
}

export function claimCustomerFromRider(fromRiderId, fromRiderName, custName) {
    const currentId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const currentName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim();

    const myId = currentId || currentName;
    const myName = currentName || "Rider";

    if (!myId) return showToast("⚠️ Rider ID missing.");
    if (fromRiderId.toString().trim() === myId || fromRiderName.toLowerCase().trim() === myName.toLowerCase()) {
        return showToast("⚠️ Iyo na ang customer na ito.");
    }

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