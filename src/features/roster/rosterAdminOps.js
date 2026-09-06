// src/features/roster/rosterAdminOps.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { API_URL } from '../../config/constants.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal, closeAdminCateringModal } from '../../ui/modals.js';
import { isSameDate, escapeHtml } from '../../utils/helpers.js';
import { populateCateringCustomerDropdown } from '../chat/index.js';
import { 
    parseQueueTime, 
    isAdmin, 
    canManageRoster, 
    canForceCaterTarget,
    archiveRiderCateringIfNeeded,
    saveRosterCache 
} from './rosterUtils.js';
import { updateRosterUI } from './rosterUI.js';
import { getTopQueueTime, updateRosterStatus, updateRosterStatusData, voidSingleCateringCustomer, clockOutRider } from './rosterStatus.js';

import {
    openAdminTimeInScheduleModal,
    closeAdminTimeInScheduleModal,
    renderAdminTimeInScheduleList,
    grantRiderEarlyPass,
    revokeRiderEarlyPass,
    saveAdminTimeInScheduleSettings,
    listenToTimeInSchedule,
    getRiderStorageKey,
    sanitizeForFirebase
} from './rosterSchedule.js';

import {
    openRiderDayOffModal,
    closeRiderDayOffModal,
    renderRiderDayOffPicker,
    selectRiderDayOff,
    openAdminDayOffSettingsModal,
    closeAdminDayOffSettingsModal,
    renderAdminDayOffSettingsList,
    adminReassignRiderDayOff,
    saveAdminDayOffSettings,
    listenToDayOffData
} from './rosterDayOff.js';

import {
    openAdminBookingLimitsModal,
    closeAdminBookingLimitsModal,
    toggleBookingLimitsModeUI,
    saveAdminBookingLimitsSettings,
    listenToBookingLimits
} from './rosterBookingLimits.js';

import {
    openAdminAutoEndShiftModal,
    closeAdminAutoEndShiftModal,
    saveAdminAutoEndShiftSettings,
    startAutoEndShiftScheduler,
    listenToAutoEndShift,
    checkAndTriggerAutoEndShift,
    executeAutoEndShift
} from './rosterAutoEndShift.js';

export * from './rosterSchedule.js';
export * from './rosterDayOff.js';
export * from './rosterBookingLimits.js';
export * from './rosterAutoEndShift.js';

let pendingAdminTarget = null;

// TOGGLE ADMIN CONTROLS SWITCH
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

// OPEN ADMIN FORCE CATERING MODAL
export function openAdminCateringModal(id, name) {
    if (!canManageRoster()) {
        return showToast("⚠️ Unauthorized: Admin or TL access required.");
    }

    pendingAdminTarget = { id, name };

    const idInput = document.getElementById('admin-cater-target-rider-id');
    const nameInputHidden = document.getElementById('admin-cater-target-rider-name');
    const custInput = document.getElementById('admin-cater-cust-name') || document.getElementById('catering-customer-name');
    const custSelect = document.getElementById('admin-cater-customer-select') || document.getElementById('catering-customer-select');
    const penaltySelect = document.getElementById('admin-cater-penalty-select') || document.getElementById('catering-penalty-select');

    if (idInput) idInput.value = id || "";
    if (nameInputHidden) nameInputHidden.value = name || "";
    if (custInput) custInput.value = "";
    if (penaltySelect) penaltySelect.value = "0";

    if (custSelect) {
        if (typeof populateCateringCustomerDropdown === 'function') {
            populateCateringCustomerDropdown(custSelect.id);
        }
    }

    const modal = document.getElementById('admin-catering-modal') || document.getElementById('catering-modal');
    if (modal) modal.classList.remove('hidden');
    if (custInput) custInput.focus();
}

export async function submitAdminForceCatering() {
    if (!canManageRoster()) {
        return showToast("⚠️ Unauthorized: Admin or TL access required.");
    }

    const idInput = document.getElementById('admin-cater-target-rider-id');
    const nameInputHidden = document.getElementById('admin-cater-target-rider-name');
    const custInput = document.getElementById('admin-cater-cust-name') || document.getElementById('catering-customer-name');
    const custSelect = document.getElementById('admin-cater-customer-select') || document.getElementById('catering-customer-select');
    const penaltySelect = document.getElementById('admin-cater-penalty-select') || document.getElementById('catering-penalty-select');

    let targetId = (idInput ? idInput.value.trim() : "") || (pendingAdminTarget ? pendingAdminTarget.id : "");
    let targetName = (nameInputHidden ? nameInputHidden.value.trim() : "") || (pendingAdminTarget ? pendingAdminTarget.name : "");
    const penaltyMins = penaltySelect ? parseInt(penaltySelect.value) || 0 : 0;

    if (!targetId) {
        targetId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
        targetName = appState.riderName || localStorage.getItem('riderName') || "Rider";
    }

    let custName = (custInput ? custInput.value.trim() : "") || (custSelect ? custSelect.value.trim() : "");

    if (!targetId) return showToast("⚠️ Target rider missing!");
    if (!custName) return showToast("⚠️ Please select or enter customer name!");

    const adminName = appState.riderName || localStorage.getItem('riderName') || "Admin/TL";
    const cleanCustKey = custName.toLowerCase().replace(/[^a-z0-9]/g, '');

    const rosterMembers = globalState.rosterMembers || [];
    let targetRecord = rosterMembers.find(m => 
        (m.telegramId && m.telegramId.toString() === targetId.toString()) ||
        (m.id && m.id.toString() === targetId.toString()) ||
        (m.riderName && targetName && m.riderName.toLowerCase() === targetName.toLowerCase()) ||
        (m.name && targetName && m.name.toLowerCase() === targetName.toLowerCase())
    );

    if (targetRecord) {
        targetId = (targetRecord.telegramId || targetRecord.id || targetId).toString();
        targetName = targetRecord.riderName || targetRecord.name || targetName;
    } else {
        targetRecord = {
            telegramId: targetId,
            id: targetId,
            riderName: targetName,
            name: targetName,
            status: 'Catering',
            forcedCaters: {}
        };
        rosterMembers.push(targetRecord);
    }

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
    const modalGeneral = document.getElementById('catering-modal');
    if (modalGeneral) modalGeneral.classList.add('hidden');

    let forcedCatersMap = targetRecord.forcedCaters ? { ...targetRecord.forcedCaters } : {};
    const forcedPayload = {
        customerName: custName,
        forcedBy: adminName,
        timestamp: Date.now()
    };
    forcedCatersMap[cleanCustKey] = forcedPayload;
    targetRecord.forcedCaters = forcedCatersMap;

    if (db && targetId && cleanCustKey) {
        await db.ref(`roster/${targetId}/forcedCaters/${cleanCustKey}`).set(forcedPayload).catch(() => {});
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
                            cateredByRiderId: targetId,
                            cateredByRiderName: targetName,
                            cateredBy: targetName,
                            forcedBy: adminName,
                            isForcedCater: true,
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
        targetName,
        [],
        false,
        "",
        { forcedCaters: forcedCatersMap }
    );

    if (penaltyMins > 0 && db && targetId) {
        await db.ref(`roster/${targetId}`).update({
            pendingPenaltyMinutes: penaltyMins
        });

        if (targetRecord) {
            targetRecord.pendingPenaltyMinutes = penaltyMins;
        }
    }

    saveRosterCache();
    updateRosterUI();
}

// ADMIN FORCE STATUS
export async function adminForceStatus(id, name, actionValue) {
    if (!canManageRoster()) {
        return showToast("⚠️ Unauthorized: Admin or TL access required.");
    }

    const rosterMembers = globalState.rosterMembers || [];
    const targetRecord = rosterMembers.find(m => (m.telegramId || m.id || "").toString() === id.toString());
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
            if (db) {
                db.ref(`roster/${id}/forcedCaters`).remove().catch(() => {});
            }
            if (targetRecord) {
                targetRecord.forcedCaters = null;
            }
            await updateRosterStatusData('Available', '', '', topQueueTime, id, name, [], false, "", { forcedCaters: null });
            showToast(`🚫 Voided order for ${name}. Placed in Available queue!`);
        });
        return;
    }

    openSlideDeleteModal(`Force Status: ${actionValue}?`, `Force change status of ${name} to [${actionValue}]?`, async () => {
        if (actionValue === 'Available') {
            if (db) {
                db.ref(`roster/${id}/forcedCaters`).remove().catch(() => {});
            }
            if (targetRecord) {
                targetRecord.forcedCaters = null;
            }
            const currentRoster = globalState.rosterMembers || [];
            const availableRiders = currentRoster.filter(m => m.status === 'Available' && (m.telegramId || "").toString() !== id.toString());
            let maxTime = Date.now();
            availableRiders.forEach(r => {
                const t = parseQueueTime(r.queueTime);
                if (t > maxTime) maxTime = t;
            });
            await updateRosterStatusData('Available', '', '', maxTime + 1000, id, name, [], false, "", { forcedCaters: null });
        } else if (actionValue === 'End') {
            if (db) {
                db.ref(`roster/${id}/forcedCaters`).remove().catch(() => {});
            }
            if (targetRecord) {
                targetRecord.forcedCaters = null;
            }
            await clockOutRider(id);
            await updateRosterStatus('End', id, name);
        } else {
            await updateRosterStatus(actionValue, id, name);
        }
        showToast(`⚡ Force updated ${name} to ${actionValue}`);
    });
}

// ADMIN VOID SPECIFIC CATERING CUSTOMER
export async function adminVoidSpecificCustomer(targetId, targetName, custNameToVoid) {
    if (!canManageRoster()) {
        return showToast("⚠️ Unauthorized: Admin or TL access required.");
    }

    if (!targetId || !custNameToVoid) return;

    openSlideDeleteModal(`Void Customer: ${custNameToVoid}?`, `Sigurado ka bang nais i-void si ${custNameToVoid} para kay ${targetName}?`, async () => {
        const cleanCustKey = custNameToVoid.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (db && cleanCustKey) {
            db.ref(`roster/${targetId}/forcedCaters/${cleanCustKey}`).remove().catch(() => {});
        }
        const targetRecord = (globalState.rosterMembers || []).find(m => (m.telegramId || m.id || "").toString() === targetId.toString());
        if (targetRecord && targetRecord.forcedCaters) {
            delete targetRecord.forcedCaters[cleanCustKey];
            if (Object.keys(targetRecord.forcedCaters).length === 0) {
                targetRecord.forcedCaters = null;
            }
        }
        await voidSingleCateringCustomer(targetId, targetName, custNameToVoid);
    });
}

// ADMIN VOID COMPLETED CATERED RECORD & DUAL LOGGING REMOVAL
export function promptVoidCustomer(riderName, customerName, completedDate = "", startTime = "", transactionId = "") {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    openSlideDeleteModal(
        `Void Catered Record?`,
        `Sigurado ka bang nais mong burahin ang record ni [${customerName}] na inihatid ni ${riderName}?`,
        async () => {
            await executeVoidCateredCustomer(riderName, customerName, completedDate, startTime, transactionId);
        }
    );
}

export async function executeVoidCateredCustomer(riderName, customerName, completedDate = "", startTime = "", transactionId = "") {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const cleanRider = (riderName || "").trim().toLowerCase();
    const cleanCust = (customerName || "").trim().toLowerCase();
    const cleanCustKey = cleanCust.replace(/[^a-z0-9]/g, '');

    try {
        if (db) {
            if (transactionId) {
                await db.ref(`cateredHistory/${transactionId}`).remove().catch(() => {});
                await db.ref(`receipts/${transactionId}`).remove().catch(() => {});
            }

            const snap = await db.ref('cateredHistory').once('value');
            const data = snap.val() || {};
            const deletePromises = [];

            Object.entries(data).forEach(([key, v]) => {
                const rMatch = (v.riderName || "").trim().toLowerCase() === cleanRider;
                const cMatch = (v.customerName || "").trim().toLowerCase() === cleanCust;
                const dMatch = !completedDate || isSameDate(v.completedDate || v.date, completedDate);
                const sMatch = !startTime || (v.startTime || "").trim() === startTime.trim();
                const txMatch = transactionId && (v.transactionId === transactionId || v.id === transactionId || key === transactionId);

                if (txMatch || (rMatch && cMatch && (dMatch || sMatch))) {
                    deletePromises.push(db.ref(`cateredHistory/${key}`).remove());
                }
            });

            const rcptSnap = await db.ref('receipts').once('value');
            const rcptData = rcptSnap.val() || {};
            Object.entries(rcptData).forEach(([key, r]) => {
                const rMatch = (r.riderName || "").trim().toLowerCase() === cleanRider;
                const cMatch = (r.customerName || "").trim().toLowerCase() === cleanCust;
                const dMatch = !completedDate || isSameDate(r.date || r.completedDate, completedDate);
                const txMatch = transactionId && (r.transactionId === transactionId || key === transactionId);

                if (txMatch || (rMatch && cMatch && dMatch)) {
                    deletePromises.push(db.ref(`receipts/${key}`).remove());
                }
            });

            const targetRoster = (globalState.rosterMembers || []).find(m => (m.riderName || m.name || "").trim().toLowerCase() === cleanRider);
            if (targetRoster && (targetRoster.telegramId || targetRoster.id) && cleanCustKey) {
                const tId = targetRoster.telegramId || targetRoster.id;
                deletePromises.push(db.ref(`roster/${tId}/customerFees/${cleanCustKey}`).remove());
                deletePromises.push(db.ref(`roster/${tId}/forcedCaters/${cleanCustKey}`).remove());
            }

            await Promise.all(deletePromises);
        }

        if (globalState.globalCateredHistory) {
            globalState.globalCateredHistory = globalState.globalCateredHistory.filter(h => {
                const txMatch = transactionId && (h.transactionId === transactionId || h.id === transactionId);
                const match = (h.riderName || "").trim().toLowerCase() === cleanRider &&
                              (h.customerName || "").trim().toLowerCase() === cleanCust &&
                              (!completedDate || isSameDate(h.completedDate || h.date, completedDate));
                return !(txMatch || match);
            });
        }

        if (globalState.globalDailyReceipts) {
            globalState.globalDailyReceipts = globalState.globalDailyReceipts.filter(r => {
                const txMatch = transactionId && (r.transactionId === transactionId || r.id === transactionId);
                const match = (r.riderName || "").trim().toLowerCase() === cleanRider &&
                              (r.customerName || "").trim().toLowerCase() === cleanCust &&
                              (!completedDate || isSameDate(r.date || r.completedDate, completedDate));
                return !(txMatch || match);
            });
        }

        saveRosterCache();
        if (typeof window.loadGlobalCateredList === 'function') {
            window.loadGlobalCateredList();
        }
        if (typeof window.updateRosterUI === 'function') {
            window.updateRosterUI();
        }
        if (typeof window.refreshCommissionView === 'function') {
            window.refreshCommissionView();
        }

        showToast(`🗑️ Voided catered record for ${customerName}.`);
    } catch(e) {
        console.error("Void catered record error:", e);
        showToast("❌ Failed to void catered customer record.");
    }
}

export function adminShiftRiderQueue(riderId, moveAction) {
    if (!canManageRoster()) {
        return showToast("⚠️ Unauthorized: Admin access required.");
    }

    const availableRiders = globalState.rosterMembers ? globalState.rosterMembers.filter(m => m.status === 'Available').sort((a,b) => parseQueueTime(a.queueTime) - parseQueueTime(b.queueTime)) : [];
    const idx = availableRiders.findIndex(r => (r.telegramId || r.id || "").toString() === riderId.toString());

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

    updateRosterStatusData('Available', "", "", targetQueueTime, rider.telegramId, rider.riderName);
}

export async function forceAllEndShift() {
    if (!canManageRoster()) {
        return showToast("⚠️ Unauthorized: Admin access required.");
    }

    openSlideDeleteModal("Sigurado ka bang nais mong i-force end shift ang lahat ng riders?", async () => {
        const rosterMembers = globalState.rosterMembers || [];
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const nowTimestamp = Date.now();

        for (const m of rosterMembers) {
            const mId = (m.telegramId || m.id || "").toString().trim();
            if (mId) {
                await archiveRiderCateringIfNeeded(m);
                await clockOutRider(mId);

                if (db) {
                    db.ref('roster/' + mId).update({ 
                        status: 'End', 
                        customerName: "", 
                        startTime: "", 
                        pendingPenaltyMinutes: 0, 
                        cooldownUntil: 0,
                        forcedCaters: null,
                        lastUpdated: timeStr,
                        lastActiveTimestamp: nowTimestamp
                    }).catch(() => {});
                }

                m.status = 'End';
                m.customerName = '';
                m.startTime = '';
                m.pendingPenaltyMinutes = 0;
                m.cooldownUntil = 0;
                m.forcedCaters = null;
                m.lastUpdated = timeStr;
                m.lastActiveTimestamp = nowTimestamp;
            }
        }

        saveRosterCache();
        updateRosterUI();
        window.dispatchEvent(new CustomEvent('rosterUpdated'));
        window.dispatchEvent(new CustomEvent('loginsUpdated'));

        try {
            await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ type: "roster", action: "force_all_end", time: timeStr }) });
        } catch(e) {}
    });
}

if (typeof window !== 'undefined') {
    window.toggleAdminControls = toggleAdminControls;
    window.openAdminCateringModal = openAdminCateringModal;
    window.submitAdminForceCatering = submitAdminForceCatering;
    window.adminForceStatus = adminForceStatus;
    window.adminVoidSpecificCustomer = adminVoidSpecificCustomer;
    window.promptVoidCustomer = promptVoidCustomer;
    window.executeVoidCateredCustomer = executeVoidCateredCustomer;
    window.adminShiftRiderQueue = adminShiftRiderQueue;
    window.forceAllEndShift = forceAllEndShift;

    window.openAdminAutoEndShiftModal = openAdminAutoEndShiftModal;
    window.closeAdminAutoEndShiftModal = closeAdminAutoEndShiftModal;
    window.saveAdminAutoEndShiftSettings = saveAdminAutoEndShiftSettings;
    window.checkAndTriggerAutoEndShift = checkAndTriggerAutoEndShift;
    window.executeAutoEndShift = executeAutoEndShift;
    window.listenToAutoEndShift = listenToAutoEndShift;

    window.openAdminTimeInScheduleModal = openAdminTimeInScheduleModal;
    window.closeAdminTimeInScheduleModal = closeAdminTimeInScheduleModal;
    window.saveAdminTimeInScheduleSettings = saveAdminTimeInScheduleSettings;
    window.grantRiderEarlyPass = grantRiderEarlyPass;
    window.revokeRiderEarlyPass = revokeRiderEarlyPass;
    window.renderAdminTimeInScheduleList = renderAdminTimeInScheduleList;

    window.openRiderDayOffModal = openRiderDayOffModal;
    window.closeRiderDayOffModal = closeRiderDayOffModal;
    window.selectRiderDayOff = selectRiderDayOff;
    window.openAdminDayOffSettingsModal = openAdminDayOffSettingsModal;
    window.closeAdminDayOffSettingsModal = closeAdminDayOffSettingsModal;
    window.renderAdminDayOffSettingsList = renderAdminDayOffSettingsList;
    window.adminReassignRiderDayOff = adminReassignRiderDayOff;
    window.renderRiderDayOffPicker = renderRiderDayOffPicker;

    window.openAdminBookingLimitsModal = openAdminBookingLimitsModal;
    window.closeAdminBookingLimitsModal = closeAdminBookingLimitsModal;
    window.toggleBookingLimitsModeUI = toggleBookingLimitsModeUI;
    window.saveAdminBookingLimitsSettings = saveAdminBookingLimitsSettings;

    listenToTimeInSchedule();
    listenToDayOffData();
    listenToBookingLimits();
    listenToAutoEndShift();
}