// src/features/roster/rosterActions.js
import { db } from '../../config/firebase.js';
import { appState, globalState, multiCarts, activeCartSlot } from '../../store/state.js';
import { API_URL } from '../../config/constants.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal, closeCateringModal, closeAdminCateringModal } from '../../ui/modals.js';
import { calibrateGPS } from '../auth.js';
import { getLocalTodayStr, isSameDate, escapeHtml } from '../../utils/helpers.js';
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
    canManageRoster,
    canForceCaterTarget,
    saveRosterCache,
    setLineAlarmConfirmed,
    loadRosterCache
} from './rosterUtils.js';
import { updateRosterUI } from './rosterUI.js';

let pendingAdminTarget = null;
let editingRiderTarget = null;

// TOGGLE ADMIN CONTROLS SWITCH WITH STRICT PERMISSION CHECK
export function toggleAdminControls(enabled) {
    if (!canManageRoster()) {
        globalState.adminControlsEnabled = false;
        const toggle = document.getElementById('admin-controls-toggle');
        if (toggle) toggle.checked = false;
        showToast("⚠️ Unauthorized: Only Admin or Team Lead (TL) can enable Admin Controls.");
        updateRosterUI();
        return;
    }

    globalState.adminControlsEnabled = !!enabled;
    showToast(`Admin Safety Controls: ${enabled ? 'ENABLED' : 'DISABLED'}`);
    updateRosterUI();
}

// HELPER: CALCULATE QUEUE TIME TO PLACE RIDER AT #1 SPOT IN AVAILABLE QUEUE
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
                    lastUpdated: new Date().toLocaleTimeString()
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
                        accuracy: coords.accuracy
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

    // AUTOMATICALLY MOVE MATCHING CUSTOMER THREAD TO 'CATERING' FOLDER IN FIREBASE
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

// OPEN ADMIN FORCE CATERING MODAL
export function openAdminCateringModal(id, name) {
    if (!canManageRoster()) {
        return showToast("⚠️ Unauthorized: Admin or TL access required.");
    }

    pendingAdminTarget = { id, name };

    const idInput = document.getElementById('admin-cater-target-rider-id');
    const nameInputHidden = document.getElementById('admin-cater-target-rider-name');
    const custInput = document.getElementById('admin-cater-cust-name');
    const custSelect = document.getElementById('admin-cater-customer-select');

    if (idInput) idInput.value = id || "";
    if (nameInputHidden) nameInputHidden.value = name || "";
    if (custInput) custInput.value = "";

    if (custSelect) {
        if (typeof populateCateringCustomerDropdown === 'function') {
            populateCateringCustomerDropdown('admin-cater-customer-select');
        }
    }

    const modal = document.getElementById('admin-catering-modal');
    if (modal) modal.classList.remove('hidden');
    if (custInput) custInput.focus();
}

export async function submitAdminForceCatering() {
    if (!canManageRoster()) {
        return showToast("⚠️ Unauthorized: Admin or TL access required.");
    }

    const idInput = document.getElementById('admin-cater-target-rider-id');
    const nameInputHidden = document.getElementById('admin-cater-target-rider-name');
    const custInput = document.getElementById('admin-cater-cust-name');

    let targetId = idInput ? idInput.value.trim() : "";
    let targetName = nameInputHidden ? nameInputHidden.value.trim() : "";

    if (!targetId && pendingAdminTarget && pendingAdminTarget.id) {
        targetId = pendingAdminTarget.id;
        targetName = pendingAdminTarget.name;
    }

    const custName = custInput ? custInput.value.trim() : "";

    if (!targetId) return showToast("⚠️ Target rider missing!");
    if (!custName) return showToast("⚠️ Please select or enter customer name!");

    const rosterMembers = globalState.rosterMembers || [];
    const targetRecord = rosterMembers.find(m => (m.telegramId || "").toString() === targetId.toString());

    let existingCustomers = [];
    let existingTimes = [];

    if (targetRecord && targetRecord.status === 'Catering' && targetRecord.customerName) {
        existingCustomers = targetRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
        existingTimes = targetRecord.startTime ? targetRecord.startTime.split(', ').map(t => t.trim()) : [];
    }

    const startTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (!existingCustomers.some(c => c.toLowerCase() === custName.toLowerCase())) {
        existingCustomers.push(custName);
        existingTimes.push(startTime);
    }

    closeAdminCateringModal();

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
                            cateredByRiderId: targetId,
                            cateredByRiderName: targetName,
                            cateredBy: targetName,
                            lastUpdated: Date.now()
                        });
                    }
                });
            }
        });
    }

    await updateRosterStatusData(
        'Catering', 
        existingCustomers.join(', '), 
        existingTimes.join(', '), 
        targetRecord ? parseQueueTime(targetRecord.queueTime) : Date.now(),
        targetId,
        targetName
    );

    showToast(`⚡ Admin Force Catered ${custName} to ${targetName}`);
    showSideNotification("FORCE CATER", `Assigned ${custName} to ${targetName}`, "fa-user-gear", "text-amber-400", "border-amber-500");
}

// GET / CLAIM CUSTOMER FROM ANOTHER RIDER
export async function claimCustomerFromRider(fromRiderId, fromRiderName, custName) {
    const myId = (appState.telegramId || "").toString();
    const myName = appState.riderName || localStorage.getItem('riderName') || "Rider";

    if (!myId) return showToast("⚠️ Telegram ID missing.");
    if (fromRiderId.toString() === myId.toString()) return showToast("⚠️ Iyo na ang customer na ito.");

    openSlideDeleteModal(`Get Customer: ${custName}?`, `Kukunin mo ba si ${custName} mula kay ${fromRiderName}?`, async () => {
        const rosterMembers = globalState.rosterMembers || [];
        const fromRecord = rosterMembers.find(m => (m.telegramId || "").toString() === fromRiderId.toString());
        const myRecord = rosterMembers.find(m => (m.telegramId || "").toString() === myId);

        if (fromRecord && fromRecord.customerName) {
            let fromCusts = fromRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
            let fromTimes = fromRecord.startTime ? fromRecord.startTime.split(', ').map(t => t.trim()) : [];
            
            let newCusts = [];
            let newTimes = [];
            fromCusts.forEach((c, idx) => {
                if (c.toLowerCase() !== custName.toLowerCase()) {
                    newCusts.push(c);
                    newTimes.push(fromTimes[idx] || fromTimes[0] || "");
                }
            });

            if (newCusts.length > 0) {
                await updateRosterStatusData('Catering', newCusts.join(', '), newTimes.join(', '), parseQueueTime(fromRecord.queueTime), fromRiderId, fromRiderName);
            } else {
                const topQueueTime = getTopQueueTime();
                await updateRosterStatusData('Available', '', '', topQueueTime, fromRiderId, fromRiderName);
            }
        }

        let myCusts = [];
        let myTimes = [];
        if (myRecord && myRecord.status === 'Catering' && myRecord.customerName) {
            myCusts = myRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
            myTimes = myRecord.startTime ? myRecord.startTime.split(', ').map(t => t.trim()) : [];
        }

        const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (!myCusts.some(c => c.toLowerCase() === custName.toLowerCase())) {
            myCusts.push(custName);
            myTimes.push(nowTime);
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

        await updateRosterStatusData('Catering', myCusts.join(', '), myTimes.join(', '), myRecord ? parseQueueTime(myRecord.queueTime) : Date.now(), myId, myName);

        showToast(`📥 Na-transfer na si ${custName} sa iyo mula kay ${fromRiderName}!`);
        showSideNotification("CUSTOMER CLAIMED", `Claimed ${custName} from ${fromRiderName}`, "fa-hand-holding-hand", "text-emerald-400", "border-emerald-500");
    });
}

// ADMIN FORCE STATUS
export async function adminForceStatus(id, name, actionValue) {
    if (!canManageRoster()) {
        return showToast("⚠️ Unauthorized: Admin or TL access required.");
    }

    const rosterMembers = globalState.rosterMembers || [];
    const targetRecord = rosterMembers.find(m => (m.telegramId || "").toString() === id.toString());
    const targetType = targetRecord ? targetRecord.userType : "";

    if (!canForceCaterTarget(targetType)) {
        return showToast("⚠️ TL cannot force cater an Admin or TL.");
    }

    if (actionValue === 'Catering') {
        openAdminCateringModal(id, name);
        return;
    }

    if (actionValue === 'VoidActive') {
        openSlideDeleteModal(`Void Order for ${name}?`, `Sigurado ka bang nais i-void ang active order ni ${name}? Malilipat sya sa #1 SPOT ng Available queue.`, async () => {
            const topQueueTime = getTopQueueTime();
            showSideNotification("ORDER VOIDED", `Voided order for ${name} — placed at #1 in Queue`, "fa-ban", "text-red-400", "border-red-500");
            await updateRosterStatusData('Available', '', '', topQueueTime, id, name);
            showToast(`🚫 Voided order for ${name}. Placed at #1 in Available queue!`);
        });
        return;
    }

    openSlideDeleteModal(`Force Status: ${actionValue}?`, `Force change status of ${name} to [${actionValue}]?`, async () => {
        if (actionValue === 'Available') {
            const currentRoster = globalState.rosterMembers || [];
            const availableRiders = currentRoster.filter(m => m.status === 'Available' && (m.telegramId || "").toString() !== id.toString());
            let maxTime = Date.now();
            availableRiders.forEach(r => {
                const t = parseQueueTime(r.queueTime);
                if (t > maxTime) maxTime = t;
            });
            await updateRosterStatusData('Available', '', '', maxTime + 1000, id, name);
        } else {
            await updateRosterStatusData(actionValue, '', '', Date.now(), id, name);
        }
        showToast(`⚡ Force updated ${name} to ${actionValue}`);
    });
}

// ADMIN VOID SPECIFIC CUSTOMER
export async function adminVoidSpecificCustomer(targetId, targetName, custNameToVoid) {
    if (!canManageRoster()) {
        return showToast("⚠️ Unauthorized: Admin or TL access required.");
    }

    if (!targetId || !custNameToVoid) return;

    openSlideDeleteModal(`Void Customer: ${custNameToVoid}?`, `Sigurado ka bang nais i-void si ${custNameToVoid} para kay ${targetName}?`, async () => {
        const rosterMembers = globalState.rosterMembers || [];
        const targetRecord = rosterMembers.find(m => (m.telegramId || "").toString() === targetId.toString());

        if (!targetRecord) return;

        let remainingCusts = [];
        let remainingTimes = [];

        if (targetRecord.customerName) {
            const custs = targetRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
            const times = targetRecord.startTime ? targetRecord.startTime.split(', ').map(t => t.trim()) : [];

            custs.forEach((c, idx) => {
                if (c.toLowerCase() !== custNameToVoid.toLowerCase()) {
                    remainingCusts.push(c);
                    remainingTimes.push(times[idx] || times[0] || "");
                }
            });
        }

        if (remainingCusts.length > 0) {
            await updateRosterStatusData('Catering', remainingCusts.join(', '), remainingTimes.join(', '), parseQueueTime(targetRecord.queueTime), targetId, targetName);
            showToast(`🚫 Voided ${custNameToVoid} for ${targetName}.`);
        } else {
            const topQueueTime = getTopQueueTime();
            await updateRosterStatusData('Available', '', '', topQueueTime, targetId, targetName);
            showToast(`🚫 Voided ${custNameToVoid}. ${targetName} moved to #1 spot in Available queue!`);
        }
    });
}

export function adminShiftRiderQueue(riderId, moveAction) {
    if (!canManageRoster()) {
        return showToast("⚠️ Unauthorized: Admin or TL access required.");
    }

    const availableRiders = globalState.rosterMembers ? globalState.rosterMembers.filter(m => m.status === 'Available').sort((a,b) => parseQueueTime(a.queueTime) - parseQueueTime(b.queueTime)) : [];
    const idx = availableRiders.findIndex(r => (r.telegramId || "").toString() === riderId.toString());

    if (idx === -1) return showToast("Rider must be in Available status to shift queue.");

    let targetQueueTime = parseQueueTime(availableRiders[idx].queueTime);
    const rider = availableRiders[idx];

    if (moveAction === 'move_top') {
        targetQueueTime = parseQueueTime(availableRiders[0].queueTime) - 1000;
    } else if (moveAction === 'move_bottom') {
        targetQueueTime = parseQueueTime(availableRiders[availableRiders.length - 1].queueTime) + 1000;
    } else if (moveAction === 'move_up' && idx > 0) {
        targetQueueTime = parseQueueTime(availableRiders[idx - 1].queueTime) - 100;
    } else if (moveAction === 'move_down' && idx < availableRiders.length - 1) {
        targetQueueTime = parseQueueTime(availableRiders[idx + 1].queueTime) + 100;
    } else {
        return showToast("Cannot move further in queue.");
    }

    showSideNotification("LINEUP SHIFTED", `Adjusted lineup position for ${rider.riderName}`, "fa-arrow-up-1-9", "text-blue-400", "border-blue-500");
    updateRosterStatusData('Available', "", "", targetQueueTime, rider.telegramId, rider.riderName);
}

export async function forceAllEndShift() {
    if (!canManageRoster()) {
        return showToast("⚠️ Unauthorized: Admin or TL access required.");
    }

    openSlideDeleteModal("Sigurado ka bang nais mong i-force end shift ang lahat ng riders?", async () => {
        showSideNotification("FORCE ALL END", "Ending shift for all roster riders...", "fa-power-off", "text-red-400", "border-red-500");
        
        const rosterMembers = globalState.rosterMembers || [];
        rosterMembers.forEach(m => { 
            if (m.telegramId) {
                db.ref('roster/' + m.telegramId).update({ status: 'End', customerName: "", startTime: "", pendingPenaltyMinutes: 0, cooldownUntil: 0 });
            }
        });

        try {
            await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ type: "roster", action: "force_all_end" }) });
        } catch(e) {}
    });
}

// ============================================================================
// ADMIN RIDER ACCOUNT MANAGEMENT & USER TYPE UPDATER (ADMIN ONLY)
// ============================================================================
export function openAdminManageRidersModal() {
    if (!isAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin accounts can manage riders.");
    }

    const modal = document.getElementById('admin-manage-riders-modal');
    if (modal) {
        modal.classList.remove('hidden');
        renderAdminRidersList();
    }
}

export function closeAdminManageRidersModal() {
    const modal = document.getElementById('admin-manage-riders-modal');
    if (modal) modal.classList.add('hidden');
}

export function renderAdminRidersList() {
    const container = document.getElementById('admin-riders-list-container');
    if (!container) return;

    if (!db) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-8 text-xs">Database offline.</div>`;
        return;
    }

    db.ref('riders').once('value', (snapshot) => {
        const val = snapshot.val();
        let ridersList = [];

        if (val) {
            ridersList = Object.entries(val).map(([id, item]) => ({
                id: id,
                name: item.riderName || item.name || id,
                userType: (item.userType || item.type || "rider").toLowerCase().trim()
            }));
        }

        (globalState.rosterMembers || []).forEach(m => {
            const mId = (m.telegramId || "").toString().trim();
            const mName = m.riderName || m.name || mId;
            const mType = (m.userType || "rider").toLowerCase().trim();

            if (mId && !ridersList.some(r => r.id.toString() === mId)) {
                ridersList.push({ id: mId, name: mName, userType: mType });
            }
        });

        if (ridersList.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-500 italic py-8 text-xs">No registered riders found. Click "+ Add Rider" to create one.</div>`;
            return;
        }

        ridersList.sort((a, b) => a.name.localeCompare(b.name));

        container.innerHTML = ridersList.map(r => {
            const currentType = r.userType || 'rider';
            let typeBadgeClass = "text-gray-400 bg-gray-800 border-gray-700";
            if (currentType === 'admin') typeBadgeClass = "text-amber-300 bg-amber-500/10 border-amber-500/30";
            else if (currentType === 'tl') typeBadgeClass = "text-blue-300 bg-blue-500/10 border-blue-500/30";

            return `
            <div class="bg-black/30 border border-gray-800 p-3 rounded-2xl flex items-center justify-between gap-2 shadow text-xs">
                <div class="flex flex-col min-w-0 flex-1">
                    <span class="font-bold text-white truncate flex items-center gap-1.5">
                        <i class="fa-solid fa-id-badge text-blue-400"></i> ${escapeHtml(r.name)}
                    </span>
                    <span class="text-[10px] text-gray-400 font-mono">ID: ${escapeHtml(r.id)}</span>
                </div>

                <div class="flex items-center gap-1.5 shrink-0">
                    <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-lg border ${typeBadgeClass}">
                        ${escapeHtml(currentType)}
                    </span>

                    <button onclick="window.openEditRiderModal && window.openEditRiderModal('${r.id}')" class="bg-gray-800 hover:bg-gray-700 text-blue-400 p-2 rounded-xl text-xs transition active:scale-95" title="Edit Rider Details">
                        <i class="fa-solid fa-pen"></i>
                    </button>

                    <button onclick="window.promptDeleteRiderAccount && window.promptDeleteRiderAccount('${r.id}', '${escapeHtml(r.name)}')" class="bg-gray-800 hover:bg-gray-700 text-red-400 p-2 rounded-xl text-xs transition active:scale-95" title="Delete Rider Account">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>`;
        }).join('');
    });
}

export function promptDeleteRiderAccount(riderId, riderName) {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    openSlideDeleteModal(
        `Delete Rider Account?`,
        `Sigurado ka bang nais mong burahin ang account ni [${riderName}] (ID: ${riderId})?`,
        () => {
            executeDeleteRiderAccount(riderId, riderName);
        }
    );
}

export async function executeDeleteRiderAccount(riderId, riderName) {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    try {
        if (db) {
            // Remove from both riders and roster nodes
            await db.ref(`riders/${riderId}`).remove();
            await db.ref(`roster/${riderId}`).remove();
        }

        // Clean in-memory roster state & user types map
        if (globalState.rosterMembers) {
            globalState.rosterMembers = globalState.rosterMembers.filter(m => (m.telegramId || "").toString().trim() !== riderId.toString().trim());
        }

        if (globalState.userTypesMap) {
            delete globalState.userTypesMap[riderId];
            delete globalState.userTypesMap[(riderName || "").toLowerCase()];
        }

        saveRosterCache();
        showToast(`🗑️ Deleted rider account for ${riderName}`);
        renderAdminRidersList();
        updateRosterUI();
    } catch(e) {
        showToast("❌ Failed to delete rider account.");
    }
}

export async function quickChangeRiderUserType(riderId, newUserType) {
    if (!isAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin can change account types.");
    }

    if (!riderId || !newUserType) return;

    try {
        if (db) {
            await db.ref(`riders/${riderId}`).update({
                userType: newUserType,
                updatedAt: Date.now()
            });

            await db.ref(`roster/${riderId}`).update({
                userType: newUserType
            }).catch(() => {});
        }

        if (!globalState.userTypesMap) globalState.userTypesMap = {};
        globalState.userTypesMap[riderId] = newUserType;

        showToast(`✅ Account type for ID [${riderId}] updated to ${newUserType.toUpperCase()}`);
        renderAdminRidersList();
        updateRosterUI();
    } catch(e) {
        showToast("❌ Failed to update rider account type.");
    }
}

export function openAddRiderModal() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    editingRiderTarget = null;
    const modal = document.getElementById('admin-edit-rider-modal');
    const titleEl = document.getElementById('admin-edit-rider-title');
    const idInput = document.getElementById('edit-rider-id-input');
    const nameInput = document.getElementById('edit-rider-name-input');
    const typeSelect = document.getElementById('edit-rider-usertype-select');

    if (titleEl) titleEl.innerText = "Add New Rider Account";
    if (idInput) {
        idInput.value = "";
        idInput.disabled = false;
    }
    if (nameInput) nameInput.value = "";
    if (typeSelect) typeSelect.value = "rider";

    if (modal) modal.classList.remove('hidden');
}

export async function openEditRiderModal(riderId) {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    editingRiderTarget = riderId;
    const modal = document.getElementById('admin-edit-rider-modal');
    const titleEl = document.getElementById('admin-edit-rider-title');
    const idInput = document.getElementById('edit-rider-id-input');
    const nameInput = document.getElementById('edit-rider-name-input');
    const typeSelect = document.getElementById('edit-rider-usertype-select');

    if (titleEl) titleEl.innerText = `Edit Rider Account (${riderId})`;
    if (idInput) {
        idInput.value = riderId;
        idInput.disabled = true;
    }

    try {
        let existingData = null;
        if (db) {
            const snap = await db.ref(`riders/${riderId}`).once('value');
            existingData = snap.val();
        }

        if (!existingData) {
            const rMem = (globalState.rosterMembers || []).find(m => (m.telegramId || "").toString() === riderId.toString());
            if (rMem) {
                existingData = { riderName: rMem.riderName || rMem.name, userType: rMem.userType };
            }
        }

        if (nameInput) nameInput.value = existingData ? (existingData.riderName || existingData.name || "") : "";
        if (typeSelect) typeSelect.value = existingData ? (existingData.userType || existingData.type || "rider").toLowerCase() : "rider";

        if (modal) modal.classList.remove('hidden');
    } catch(e) {
        showToast("⚠️ Failed to load rider details.");
    }
}

export function closeAdminEditRiderModal() {
    const modal = document.getElementById('admin-edit-rider-modal');
    if (modal) modal.classList.add('hidden');
    editingRiderTarget = null;
}

export function generateRandomRiderId() {
    const idInput = document.getElementById('edit-rider-id-input');
    if (idInput && !idInput.disabled) {
        const randomId = Math.floor(10000000 + Math.random() * 90000000).toString();
        idInput.value = randomId;
        showToast("🎲 Random Rider ID generated!");
    } else if (idInput && idInput.disabled) {
        showToast("⚠️ Cannot generate ID for an existing account.");
    }
}

export async function submitSaveRiderAccount() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const idInput = document.getElementById('edit-rider-id-input');
    const nameInput = document.getElementById('edit-rider-name-input');
    const typeSelect = document.getElementById('edit-rider-usertype-select');

    const riderId = idInput ? idInput.value.trim() : "";
    const riderName = nameInput ? nameInput.value.trim() : "";
    const userType = typeSelect ? typeSelect.value : "rider";

    if (!riderId) return showToast("⚠️ Please enter Rider ID.");
    if (!riderName) return showToast("⚠️ Please enter Rider Name.");

    try {
        const payload = {
            telegramId: riderId,
            name: riderName,
            riderName: riderName,
            userType: userType,
            updatedAt: Date.now()
        };

        if (db) {
            await db.ref(`riders/${riderId}`).set(payload);

            await db.ref(`roster/${riderId}`).update({
                riderName: riderName,
                userType: userType
            }).catch(() => {});
        }

        if (!globalState.userTypesMap) globalState.userTypesMap = {};
        globalState.userTypesMap[riderId] = userType;
        globalState.userTypesMap[riderName.toLowerCase()] = userType;

        closeAdminEditRiderModal();
        showToast(`✅ Saved rider account for ${riderName} (${userType.toUpperCase()})`);
        renderAdminRidersList();
        updateRosterUI();
    } catch(e) {
        showToast("❌ Error saving rider account.");
    }
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
                                cateredBy: null
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

    const rosterData = {
        telegramId: tId.toString(),
        riderName: tName,
        userType: getUserType(),
        status: status,
        customerName: customerName || "",
        startTime: startTime || "",
        queueTime: (queueTime !== null && queueTime !== undefined && queueTime !== 0) ? queueTime : Date.now(),
        lastUpdated: new Date().toLocaleTimeString(),
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
        db.ref('roster/' + tId).set(rosterData);
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
    }
}

if (typeof window !== 'undefined') {
    window.toggleAdminControls = toggleAdminControls;
    window.triggerStatusWithSlide = triggerStatusWithSlide;
    window.promptCateringStatus = promptCateringStatus;
    window.confirmCateringStatus = confirmCateringStatus;
    window.openAdminCateringModal = openAdminCateringModal;
    window.submitAdminForceCatering = submitAdminForceCatering;
    window.claimCustomerFromRider = claimCustomerFromRider;
    window.adminForceStatus = adminForceStatus;
    window.adminVoidSpecificCustomer = adminVoidSpecificCustomer;
    window.adminShiftRiderQueue = adminShiftRiderQueue;
    window.forceAllEndShift = forceAllEndShift;
    window.dismissQueueAlarm = dismissQueueAlarm;
    window.checkFirstInLineNotification = checkFirstInLineNotification;
    window.updateRosterStatus = updateRosterStatus;
    window.updateRosterStatusData = updateRosterStatusData;
    window.clockOutRider = clockOutRider;
    window.openAdminManageRidersModal = openAdminManageRidersModal;
    window.closeAdminManageRidersModal = closeAdminManageRidersModal;
    window.quickChangeRiderUserType = quickChangeRiderUserType;
    window.openAddRiderModal = openAddRiderModal;
    window.openEditRiderModal = openEditRiderModal;
    window.closeAdminEditRiderModal = closeAdminEditRiderModal;
    window.submitSaveRiderAccount = submitSaveRiderAccount;
    window.generateRandomRiderId = generateRandomRiderId;
    window.promptDeleteRiderAccount = promptDeleteRiderAccount;
    window.executeDeleteRiderAccount = executeDeleteRiderAccount;
}