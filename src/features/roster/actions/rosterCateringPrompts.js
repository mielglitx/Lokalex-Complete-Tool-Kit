// src/features/roster/actions/rosterCateringPrompts.js
import { db } from '../../../config/firebase.js';
import { appState, globalState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { closeCateringModal } from '../../../ui/modals.js';
import { autoStartLiveGpsSession } from '../../liveTracker.js';
import { populateCateringCustomerDropdown } from '../../chat/index.js';
import { 
    parseQueueTime, 
    getRiderTodayGross, 
    sortAvailableRidersByGross, 
    canManageRoster, 
    saveRosterCache 
} from '../rosterUtils.js';
import { updateRosterUI } from '../rosterUI.js';
import { canRiderTakeMoreBookings } from '../rosterStatusLimits.js';
import { updateRosterStatusData } from '../rosterStatusCore.js';
import { dismissQueueAlarm } from './rosterAlarms.js';

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