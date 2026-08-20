// src/features/roster/rosterStatus.js
import { db } from '../../config/firebase.js';
import { appState, globalState, multiCarts, activeCartSlot } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal, closeCateringModal } from '../../ui/modals.js';
import { calibrateGPS } from '../auth/index.js';
import { getLocalTodayStr, escapeHtml } from '../../utils/helpers.js';
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
    saveRosterCache,
    setLineAlarmConfirmed
} from './rosterUtils.js';
import { updateRosterUI } from './rosterUI.js';
import { requestClaimCustomer } from './rosterSwap.js';

// CALCULATE QUEUE TIME TO PLACE RIDER AT #1 SPOT IN AVAILABLE QUEUE
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

// DISMISS QUEUE ALARM & MODAL
export function dismissQueueAlarm() {
    setLineAlarmConfirmed(true);
    stopLineAlarm();
    const modal = document.getElementById('first-line-modal') || document.getElementById('first-in-line-modal');
    if (modal) modal.classList.add('hidden');
}

// CHECK IF RIDER IS FIRST IN LINE & SHOW MODAL / PLAY ALARM
export function checkFirstInLineNotification() {
    const rosterMembers = globalState.rosterMembers || [];
    const availableRiders = rosterMembers
        .filter(m => m.status === 'Available')
        .sort((a, b) => parseQueueTime(a.queueTime) - parseQueueTime(b.queueTime));

    const myId = (appState.telegramId || "").toString();

    if (myId && availableRiders.length > 0 && (availableRiders[0].telegramId || "").toString() === myId) {
        const modal = document.getElementById('first-line-modal') || document.getElementById('first-in-line-modal');
        if (modal && modal.classList.contains('hidden')) {
            modal.classList.remove('hidden');
            playLineAlarm();
        }
    }
}

// STATUS SLIDER HANDLER
export async function triggerStatusWithSlide(targetStatus) {
    const rosterMembers = globalState.rosterMembers || [];
    const myId = (appState.telegramId || "").toString();
    const myRecord = rosterMembers.find(m => (m.telegramId || "").toString() === myId);

    if (myRecord && myRecord.status === 'End' && targetStatus !== 'Available') {
        showToast("⚠️ Naka-End Shift ka. Ang Available button lamang ang maaaring pindutin.");
        return;
    }

    if (targetStatus === 'Available') {
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

        // STRICT RECEIPT CHECK BEFORE ALLOWING AVAILABLE
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
                showToast(`⚠️ Paki-gawaan muna ng resibo si ${missingReceiptCust.name} bago mag-Available!`);
                
                if (multiCarts && activeCartSlot) {
                    multiCarts[activeCartSlot].customerName = missingReceiptCust.name;
                    multiCarts[activeCartSlot].isManual = false;
                    if (window.saveCartState) window.saveCartState();
                }
                switchView('view-cart');
                return;
            }
        }

        // 1. INSTANT QUEUE LOCKING
        const currentRoster = globalState.rosterMembers || [];
        const availableRiders = currentRoster.filter(m => m.status === 'Available' && (m.telegramId || "").toString() !== myId);
        let maxTime = new Date().getTime();
        availableRiders.forEach(r => {
            const t = parseQueueTime(r.queueTime);
            if (t > maxTime) maxTime = t;
        });
        const lockedQueueTime = maxTime + 1000;

        // 2. INSTANT STATUS & UI UPDATE
        endLiveGpsSession();
        dismissQueueAlarm();
        updateRosterStatus('Available', null, null, lockedQueueTime);

        showSideNotification("RECORDING STATUS", `Marking ${appState.riderName} Available — queue position secured`, "fa-user-check", "text-green-400", "border-green-500");

        if (window.clearAllCartSlots) {
            window.clearAllCartSlots();
        } else if (window.clearCartSlot) {
            window.clearCartSlot();
        }

        // 3. BACKGROUND GPS CALIBRATION
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
    const myRecord = rosterMembers.find(m => (m.telegramId || "").toString() === myId);

    if (myRecord) {
        if (myRecord.status === 'End') return showToast("⚠️ Naka-End Shift ka. Mag-Available muna bago mag-Cater.");
        if (myRecord.status === 'Break') return showToast("⚠️ Naka-Break ka. Mag-Available muna bago mag-Cater.");
        if (myRecord.status === 'Cooldown') return showToast("⚠️ Naka-penalty cooldown ka pa. Maghintay muna matapos.");
    }

    const amIAlreadyCatering = myRecord && myRecord.status === 'Catering';
    const availableRiders = rosterMembers.filter(m => m.status === 'Available').sort((a, b) => parseQueueTime(a.queueTime) - parseQueueTime(b.queueTime));

    if (!amIAlreadyCatering && availableRiders.length > 0) {
        const firstAvailable = availableRiders[0];
        if ((firstAvailable?.telegramId || "").toString() !== myId) {
            return showToast("⚠️ Hindi ikaw ang nasa unahan ng queue. Maghintay muna sa iyong turn.");
        }
    }

    if (myRecord && myRecord.customerName) {
        const activeCusts = myRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
        if (activeCusts.length >= 4) {
            return showToast("⚠️ Reached maximum limit of 4 active catering customers!");
        }
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
    const myRecord = globalState.rosterMembers ? globalState.rosterMembers.find(m => (m.telegramId || "").toString() === myId) : null;

    let existingCustomers = [];
    let existingTimes = [];

    if (myRecord && myRecord.status === 'Catering' && myRecord.customerName) {
        existingCustomers = myRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
        existingTimes = myRecord.startTime ? myRecord.startTime.split(', ').map(t => t.trim()) : [];
    }

    if (existingCustomers.length >= 4 && !existingCustomers.some(c => c.toLowerCase() === custName.toLowerCase())) {
        return showToast("⚠️ Reached maximum limit of 4 active catering customers!");
    }

    closeCateringModal();
    dismissQueueAlarm();

    const startTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (!existingCustomers.some(c => c.toLowerCase() === custName.toLowerCase())) {
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

    let completedHistory = [];
    let recordLogin = false;

    const targetRecord = rosterMembers.find(m => (m.telegramId || "").toString() === tId.toString());

    if (status === 'Available' && targetRecord && targetRecord.status === 'Catering' && targetRecord.customerName) {
        const custs = targetRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
        if (db && custs.length > 0) {
            db.ref('customerChats').once('value', (snapshot) => {
                const chats = snapshot.val();
                if (chats) {
                    Object.keys(chats).forEach(custId => {
                        const chatMeta = chats[custId]?.metadata || chats[custId] || {};
                        const chatCustName = (chatMeta.customerName || chatMeta.name || "").trim().toLowerCase();
                        
                        if (chatCustName && custs.some(c => c.toLowerCase() === chatCustName)) {
                            db.ref(`customerChats/${custId}/metadata`).update({
                                folder: 'done',
                                cateredByRiderId: null,
                                cateredByRiderName: null,
                                cateredBy: null,
                                lastUpdated: Date.now()
                            });
                        }
                    });
                }
            });
        }
    }

    if (status !== 'Catering' && targetRecord && targetRecord.status === 'Catering' && targetRecord.customerName) {
        const custs = targetRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
        const times = targetRecord.startTime ? targetRecord.startTime.split(', ').map(t => t.trim()) : [];
        const custCount = custs.length || 1;
        const completedTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        for (let i = 0; i < custs.length; i++) {
            const cName = custs[i];
            const cleanCustKey = cName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const sTime = times[i] || times[0] || 'N/A';
            const splitDuration = calculateSplitDuration(sTime, completedTimeStr, custCount);

            const custFeeObj = (targetRecord.customerFees && cleanCustKey && targetRecord.customerFees[cleanCustKey]) 
                ? targetRecord.customerFees[cleanCustKey] 
                : null;

            const finalFees = custFeeObj ? custFeeObj.totalFees : (targetRecord.lastReceiptTotalFees || 0);
            const finalFeeDetails = custFeeObj ? custFeeObj.fees : (targetRecord.lastReceiptFees || null);

            const hItem = {
                riderName: tName,
                telegramId: tId.toString(),
                customerName: cName,
                startTime: sTime,
                completedTime: completedTimeStr,
                completedDate: getLocalTodayStr(),
                customerCount: custCount,
                duration: splitDuration,
                totalFees: finalFees,
                fees: finalFeeDetails
            };
            completedHistory.push(hItem);
            if (db) db.ref('cateredHistory').push(hItem);
        }
    }

    if (status === 'Available') recordLogin = true;

    let locationLink = "";
    if (appState.lat && appState.lon) {
        locationLink = `https://www.google.com/maps/search/?api=1&query=${appState.lat.toFixed(6)},${appState.lon.toFixed(6)}`;
    }

    let newQueueTime = precalculatedQueueTime !== null ? precalculatedQueueTime : 0;
    if (status === 'Available' && precalculatedQueueTime === null) {
        const availableRiders = rosterMembers.filter(m => m.status === 'Available' && (m.telegramId || "").toString() !== tId.toString());
        let maxTime = new Date().getTime();
        availableRiders.forEach(r => {
            const t = parseQueueTime(r.queueTime);
            if (t > maxTime) maxTime = t;
        });
        newQueueTime = maxTime + 1000;
    }

    await updateRosterStatusData(status, "", "", newQueueTime, tId, tName, completedHistory, recordLogin, locationLink);
}

export async function updateRosterStatusData(status, customerName, startTime, queueTime = 0, specificId = null, specificName = null, completedHistory = [], recordLogin = false, locationLink = "") {
    const tId = specificId || appState.telegramId;
    const tName = specificName || appState.riderName;

    if (!tId) return;

    const nowTimestamp = Date.now();
    const rosterData = {
        telegramId: tId.toString(),
        riderName: tName,
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
    const existingIdx = globalState.rosterMembers.findIndex(m => (m.telegramId || "").toString() === tId.toString());
    if (existingIdx !== -1) {
        globalState.rosterMembers[existingIdx] = rosterData;
    } else {
        globalState.rosterMembers.push(rosterData);
    }

    saveRosterCache();
    updateRosterUI();

    if (db) {
        const rosterRef = db.ref('roster/' + tId);
        await rosterRef.set(rosterData);

        rosterRef.onDisconnect().update({
            lastActiveTimestamp: firebase.database.ServerValue.TIMESTAMP
        }).catch(() => {});
    }

    if (recordLogin && db) {
        const loginEntry = {
            riderName: tName,
            loginTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            clockOutTime: "",
            date: getLocalTodayStr(),
            location: locationLink
        };
        db.ref('logins/' + tId).set(loginEntry);
    }
}

export async function clockOutRider() {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (db && appState.telegramId) {
        db.ref('logins/' + appState.telegramId).update({ clockOutTime: timeStr });
        db.ref('roster/' + appState.telegramId).update({ lastActiveTimestamp: Date.now() });
    }
}