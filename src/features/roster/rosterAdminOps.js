// src/features/roster/rosterAdminOps.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { API_URL } from '../../config/constants.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal, closeAdminCateringModal } from '../../ui/modals.js';
import { isSameDate, escapeHtml } from '../../utils/helpers.js';
import { populateCateringCustomerDropdown } from '../chat/index.js';
import { 
    loadRosterCache,
    parseQueueTime, 
    isAdmin, 
    canManageRoster,
    hasTlPermission,
    canForceCaterTarget,
    archiveRiderCateringIfNeeded,
    saveRosterCache,
    isRiderMatch,
    isCustomerMatch,
    isSameDateStr
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

export function toggleAdminControls(enabled) {
    if (!canManageRoster()) {
        globalState.adminControlsEnabled = false;
        const toggle = document.getElementById('admin-controls-toggle');
        if (toggle) toggle.checked = false;
        showToast("⚠️ Unauthorized: Only Admin or authorized Team Lead (TL) can enable Admin Controls.");
        updateRosterUI();
        return;
    }

    globalState.adminControlsEnabled = !!enabled;
    showToast(`Admin Safety Controls: ${enabled ? 'ENABLED' : 'DISABLED'}`);
    updateRosterUI();
}

export function openAdminCateringModal(id, name) {
    if (!globalState.rosterMembers || globalState.rosterMembers.length === 0) {
        loadRosterCache();
    }

    if (!hasTlPermission('canForceCater')) {
        return showToast("⚠️ Unauthorized: You do not have permission to Force Cater.");
    }

    const rosterMembers = globalState.rosterMembers || [];
    const targetRecord = rosterMembers.find(m => (m.telegramId || m.id || "").toString() === (id || "").toString());
    const targetType = targetRecord ? targetRecord.userType : "";

    if (id && !canForceCaterTarget(targetType, id)) {
        return showToast("⚠️ TL cannot force cater an Admin or another TL.");
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
        try {
            if (typeof populateCateringCustomerDropdown === 'function') {
                populateCateringCustomerDropdown(custSelect.id);
            }
        } catch (err) {
            console.warn("Dropdown population error in admin modal:", err);
        }
    }

    const modal = document.getElementById('admin-catering-modal') || document.getElementById('catering-modal');
    if (modal) modal.classList.remove('hidden');
    if (custInput) custInput.focus();
}

export async function submitAdminForceCatering() {
    if (!hasTlPermission('canForceCater')) {
        return showToast("⚠️ Unauthorized: You do not have permission to Force Cater.");
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

    if (!globalState.rosterMembers || globalState.rosterMembers.length === 0) {
        loadRosterCache();
    }
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

    const targetType = targetRecord ? targetRecord.userType : "";
    if (!canForceCaterTarget(targetType, targetId)) {
        return showToast("⚠️ TL cannot force cater an Admin or another TL.");
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

    const isSelfForced = adminName.toLowerCase().trim() === targetName.toLowerCase().trim();

    let forcedCatersMap = targetRecord.forcedCaters ? { ...targetRecord.forcedCaters } : {};
    const forcedPayload = {
        customerName: custName,
        forcedBy: adminName,
        isSelfForced: isSelfForced,
        timestamp: Date.now()
    };
    forcedCatersMap[cleanCustKey] = forcedPayload;
    targetRecord.forcedCaters = forcedCatersMap;
    targetRecord.forcedBy = adminName;
    targetRecord.isForcedCater = true;

    if (db && targetId && cleanCustKey) {
        db.ref(`roster/${targetId}/forcedCaters/${cleanCustKey}`).set(forcedPayload).catch(() => {});
        db.ref(`roster/${targetId}`).update({
            forcedBy: adminName,
            isForcedCater: true
        }).catch(() => {});
    }

    if (db && custName) {
        const cleanSearchName = custName.trim();
        db.ref('customerChats')
            .orderByChild('metadata/customerName')
            .equalTo(cleanSearchName)
            .once('value', (snapshot) => {
                const chats = snapshot.val();
                if (chats) {
                    Object.keys(chats).forEach(custId => {
                        db.ref(`customerChats/${custId}/metadata`).update({
                            folder: 'catering',
                            cateredByRiderId: targetId,
                            cateredByRiderName: targetName,
                            cateredBy: targetName,
                            forcedBy: adminName,
                            isForcedCater: true,
                            lastUpdated: Date.now()
                        }).catch(() => {});
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
        { 
            forcedCaters: forcedCatersMap,
            forcedBy: adminName,
            isForcedCater: true
        }
    );

    if (penaltyMins > 0 && db && targetId) {
        db.ref(`roster/${targetId}`).update({
            pendingPenaltyMinutes: penaltyMins
        }).catch(() => {});

        if (targetRecord) {
            targetRecord.pendingPenaltyMinutes = penaltyMins;
        }
    }

    saveRosterCache();
    updateRosterUI();

    const notifyLabel = isSelfForced ? `${targetName} (Self)` : targetName;
    showToast(`⚡ Force Catered ${custName} to ${notifyLabel}`);
    showSideNotification("FORCE CATER", `Assigned ${custName} to ${notifyLabel}`, "fa-user-gear", "text-amber-400", "border-amber-500");
}

export async function adminForceStatus(id, name, actionValue) {
    if (actionValue === 'Catering') {
        if (!hasTlPermission('canForceCater')) {
            return showToast("⚠️ Unauthorized: You do not have permission to Force Cater.");
        }
        openAdminCateringModal(id, name);
        return;
    }

    if (!hasTlPermission('canForceStatus')) {
        return showToast("⚠️ Unauthorized: You do not have permission to Force Status.");
    }

    if (!globalState.rosterMembers || globalState.rosterMembers.length === 0) {
        loadRosterCache();
    }
    const rosterMembers = globalState.rosterMembers || [];
    const targetRecord = rosterMembers.find(m => (m.telegramId || m.id || "").toString() === id.toString());
    const targetType = targetRecord ? targetRecord.userType : "";

    if (!canForceCaterTarget(targetType, id)) {
        return showToast("⚠️ TL cannot modify status of an Admin or another TL.");
    }

    if (actionValue === 'VoidActive') {
        if (!hasTlPermission('canVoidCustomer')) {
            return showToast("⚠️ Unauthorized: You do not have permission to Void Active Orders.");
        }
        openSlideDeleteModal(`Void Order for ${name}?`, `Sigurado ka bang nais i-void ang active order ni ${name}? Malilipat sya sa #1 SPOT ng Available queue.`, async () => {
            const rawCusts = targetRecord?.customerName ? targetRecord.customerName.split(/\s*,\s*/).map(c => c.trim()).filter(Boolean) : [];
            if (rawCusts.length > 0) {
                for (const c of rawCusts) {
                    await voidSingleCateringCustomer(id, name, c);
                }
            } else {
                const topQueueTime = getTopQueueTime();
                if (db) {
                    db.ref(`roster/${id}/forcedCaters`).remove().catch(() => {});
                    db.ref(`roster/${id}/customerFees`).remove().catch(() => {});
                }
                if (targetRecord) {
                    targetRecord.forcedCaters = null;
                    targetRecord.customerFees = null;
                }
                await updateRosterStatusData('Available', '', '', topQueueTime, id, name, [], false, "", { forcedCaters: null });
                showToast(`🚫 Voided order for ${name}. Placed in Available queue!`);
            }
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

export async function adminVoidSpecificCustomer(targetId, targetName, custNameToVoid) {
    if (!hasTlPermission('canVoidCustomer')) {
        return showToast("⚠️ Unauthorized: You do not have permission to Void Active Customers.");
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

export function openEditCateringCustomerModal(riderId, riderName, currentCustomerName) {
    if (!canManageRoster() && !hasTlPermission('canForceCater') && !isAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin or authorized TL can edit customer names.");
    }

    const modal = document.getElementById('admin-edit-catering-customer-modal');
    if (!modal) return;

    const idInput = document.getElementById('edit-cater-rider-id');
    const nameInput = document.getElementById('edit-cater-rider-name');
    const oldNameInput = document.getElementById('edit-cater-old-cust-name');
    const displayEl = document.getElementById('edit-cater-rider-display');
    const newNameInput = document.getElementById('edit-cater-new-cust-name');

    if (idInput) idInput.value = riderId || "";
    if (nameInput) nameInput.value = riderName || "";
    if (oldNameInput) oldNameInput.value = currentCustomerName || "";
    if (displayEl) displayEl.innerText = `${riderName || 'Rider'} (ID: ${riderId || 'N/A'})`;
    if (newNameInput) {
        newNameInput.value = currentCustomerName || "";
    }

    modal.classList.remove('hidden');
    setTimeout(() => {
        if (newNameInput) {
            newNameInput.focus();
            newNameInput.select();
        }
    }, 100);
}

export function closeEditCateringCustomerModal() {
    const modal = document.getElementById('admin-edit-catering-customer-modal');
    if (modal) modal.classList.add('hidden');
}

export async function submitEditCateringCustomerName() {
    if (!canManageRoster() && !hasTlPermission('canForceCater') && !isAdmin()) {
        return showToast("⚠️ Unauthorized: Admin or TL permission required.");
    }

    const riderId = document.getElementById('edit-cater-rider-id')?.value || "";
    const riderName = document.getElementById('edit-cater-rider-name')?.value || "";
    const oldName = (document.getElementById('edit-cater-old-cust-name')?.value || "").trim();
    const newName = (document.getElementById('edit-cater-new-cust-name')?.value || "").trim();

    if (!newName) {
        return showToast("⚠️ Paki-lagay ang bagong pangalan ng customer.");
    }

    if (oldName.toLowerCase() === newName.toLowerCase()) {
        closeEditCateringCustomerModal();
        return showToast("ℹ️ Walang pagbabago sa pangalan.");
    }

    await executeEditCateringCustomerName(riderId, riderName, oldName, newName);
}

export async function executeEditCateringCustomerName(riderId, riderName, oldName, newName) {
    const cleanId = (riderId || "").toString().trim();
    const cleanName = (riderName || "").trim();

    const roster = globalState.rosterMembers || [];
    const targetRecord = roster.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").trim().toLowerCase();
        return (cleanId && mId === cleanId) || (cleanName && mName === cleanName.toLowerCase());
    });

    if (!targetRecord || targetRecord.status !== 'Catering') {
        closeEditCateringCustomerModal();
        return showToast("⚠️ Hindi na aktibong nag-ke-cater ang rider na ito.");
    }

    const currentCusts = (targetRecord.customerName || "").split(', ').map(c => c.trim()).filter(Boolean);
    const matchIdx = currentCusts.findIndex(c => c.toLowerCase() === oldName.toLowerCase());

    if (matchIdx !== -1) {
        currentCusts[matchIdx] = newName;
    } else {
        currentCusts.push(newName);
    }

    const updatedCustomerNames = currentCusts.join(', ');
    const resolvedTargetId = (targetRecord.telegramId || targetRecord.id || cleanId).toString().trim();
    const resolvedTargetName = targetRecord.riderName || targetRecord.name || cleanName;

    const cleanOldKey = oldName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanNewKey = newName.toLowerCase().replace(/[^a-z0-9]/g, '');

    const atomicUpdates = {};
    atomicUpdates[`roster/${resolvedTargetId}/customerName`] = updatedCustomerNames;
    atomicUpdates[`roster/${resolvedTargetId}/lastUpdated`] = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Migrate in-memory & cloud fees and forced caters
    if (cleanOldKey && cleanNewKey && cleanOldKey !== cleanNewKey) {
        if (targetRecord.customerFees && targetRecord.customerFees[cleanOldKey]) {
            const feeVal = targetRecord.customerFees[cleanOldKey];
            feeVal.customerName = newName;
            targetRecord.customerFees[cleanNewKey] = feeVal;
            delete targetRecord.customerFees[cleanOldKey];
            atomicUpdates[`roster/${resolvedTargetId}/customerFees/${cleanNewKey}`] = feeVal;
            atomicUpdates[`roster/${resolvedTargetId}/customerFees/${cleanOldKey}`] = null;
        }

        if (targetRecord.forcedCaters && (targetRecord.forcedCaters[cleanOldKey] || targetRecord.forcedCaters[oldName])) {
            const fcVal = targetRecord.forcedCaters[cleanOldKey] || targetRecord.forcedCaters[oldName];
            fcVal.customerName = newName;
            targetRecord.forcedCaters[cleanNewKey] = fcVal;
            delete targetRecord.forcedCaters[cleanOldKey];
            delete targetRecord.forcedCaters[oldName];
            atomicUpdates[`roster/${resolvedTargetId}/forcedCaters/${cleanNewKey}`] = fcVal;
            atomicUpdates[`roster/${resolvedTargetId}/forcedCaters/${cleanOldKey}`] = null;
        }
    }

    // Sync active customer chat and metadata
    if (db) {
        try {
            const chatsSnap = await db.ref('customerChats').once('value');
            if (chatsSnap.exists()) {
                const allChats = chatsSnap.val() || {};
                Object.keys(allChats).forEach(custId => {
                    const meta = allChats[custId]?.metadata || allChats[custId] || {};
                    const chatCustName = (meta.customerName || meta.name || "").trim().toLowerCase();
                    if (chatCustName === oldName.toLowerCase()) {
                        atomicUpdates[`customerChats/${custId}/metadata/customerName`] = newName;
                        atomicUpdates[`customerChats/${custId}/metadata/name`] = newName;
                        atomicUpdates[`customerChats/${custId}/metadata/lastUpdated`] = Date.now();
                        atomicUpdates[`customerChatMeta/${custId}/customerName`] = newName;
                        atomicUpdates[`customerChatMeta/${custId}/name`] = newName;
                        atomicUpdates[`customerChatMeta/${custId}/lastUpdated`] = Date.now();
                        atomicUpdates[`customers/${custId}/name`] = newName;
                    }
                });
            }
        } catch(e) {
            console.warn('[executeEditCateringCustomerName] chat sync warning:', e);
        }
    }

    if (db && Object.keys(atomicUpdates).length > 0) {
        try {
            await db.ref().update(atomicUpdates);
        } catch(err) {
            console.error('[executeEditCateringCustomerName] update error:', err);
            return showToast("❌ Nabigo ang pag-update sa database: " + (err.message || "Error"));
        }
    }

    targetRecord.customerName = updatedCustomerNames;

    // If current logged-in device is this rider, update appState.selectedCateringClient
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").trim().toLowerCase();
    if (resolvedTargetId === myId || (resolvedTargetName && resolvedTargetName.toLowerCase() === myName)) {
        if (appState.selectedCateringClient && appState.selectedCateringClient.toLowerCase() === oldName.toLowerCase()) {
            appState.selectedCateringClient = newName;
        }
    }

    saveRosterCache();
    window.dispatchEvent(new CustomEvent('rosterUpdated'));
    updateRosterUI();

    closeEditCateringCustomerModal();
    showToast(`✅ Na-update ang customer name ni ${resolvedTargetName} sa [${newName}]!`);
    showSideNotification("CUSTOMER RENAMED", `${oldName} ➔ ${newName} (${resolvedTargetName})`, "fa-pen-to-square", "text-amber-400", "border-amber-500");
}

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
            const deletePromises = [];

            if (transactionId) {
                deletePromises.push(db.ref(`cateredHistory/${transactionId}`).remove());
                deletePromises.push(db.ref(`receipts/${transactionId}`).remove());

                // Also query records saved under push keys with matching transactionId
                db.ref('receipts').orderByChild('transactionId').equalTo(transactionId).once('value', (snap) => {
                    snap.forEach(child => child.ref.remove());
                });
                db.ref('cateredHistory').orderByChild('transactionId').equalTo(transactionId).once('value', (snap) => {
                    snap.forEach(child => child.ref.remove());
                });
            }

            if (completedDate) {
                const snap = await db.ref('cateredHistory').orderByChild('completedDate').equalTo(completedDate).once('value');
                const data = snap.val() || {};
                Object.entries(data).forEach(([key, v]) => {
                    const rMatch = isRiderMatch(cleanRider, v.riderName);
                    const cMatch = isCustomerMatch(v.customerName, cleanCust) || (v.customerName || "").trim().toLowerCase() === cleanCust;
                    const sMatch = !startTime || (v.startTime || "").trim() === startTime.trim();
                    if (rMatch && cMatch && sMatch) {
                        deletePromises.push(db.ref(`cateredHistory/${key}`).remove());
                    }
                });

                // Also check cateredHistory with 'date' field instead of 'completedDate'
                const snapDate = await db.ref('cateredHistory').orderByChild('date').equalTo(completedDate).once('value');
                const dataDate = snapDate.val() || {};
                Object.entries(dataDate).forEach(([key, v]) => {
                    const rMatch = isRiderMatch(cleanRider, v.riderName);
                    const cMatch = isCustomerMatch(v.customerName, cleanCust) || (v.customerName || "").trim().toLowerCase() === cleanCust;
                    const sMatch = !startTime || (v.startTime || "").trim() === startTime.trim();
                    if (rMatch && cMatch && sMatch) {
                        deletePromises.push(db.ref(`cateredHistory/${key}`).remove());
                    }
                });

                const rcptSnap = await db.ref('receipts').orderByChild('date').equalTo(completedDate).once('value');
                const rcptData = rcptSnap.val() || {};
                Object.entries(rcptData).forEach(([key, r]) => {
                    const rMatch = isRiderMatch(cleanRider, r.riderName);
                    const cMatch = isCustomerMatch(r.customerName, cleanCust) || (r.customerName || "").trim().toLowerCase() === cleanCust;
                    if (rMatch && cMatch) {
                        deletePromises.push(db.ref(`receipts/${key}`).remove());
                    }
                });
            }

            const targetRoster = (globalState.rosterMembers || []).find(m => isRiderMatch(cleanRider, m.riderName || m.name));
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
                const match = isRiderMatch(cleanRider, h.riderName) &&
                              isCustomerMatch(h.customerName, cleanCust) &&
                              (!completedDate || isSameDateStr(h.completedDate || h.date, completedDate));
                return !(txMatch || match);
            });
        }

        if (globalState.globalDailyReceipts) {
            globalState.globalDailyReceipts = globalState.globalDailyReceipts.filter(r => {
                const txMatch = transactionId && (r.transactionId === transactionId || r.id === transactionId);
                const match = isRiderMatch(cleanRider, r.riderName) &&
                              isCustomerMatch(r.customerName, cleanCust) &&
                              (!completedDate || isSameDateStr(r.date || r.completedDate, completedDate));
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
    if (!hasTlPermission('canShiftQueue')) {
        return showToast("⚠️ Unauthorized: You do not have permission to Shift Lineup.");
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
    if (!hasTlPermission('canEndAllShifts')) {
        return showToast("⚠️ Unauthorized: You do not have permission to Force End Shift for all riders.");
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
                        forcedBy: null,
                        isForcedCater: false,
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
                m.forcedBy = null;
                m.isForcedCater = false;
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
    window.openEditCateringCustomerModal = openEditCateringCustomerModal;
    window.closeEditCateringCustomerModal = closeEditCateringCustomerModal;
    window.submitEditCateringCustomerName = submitEditCateringCustomerName;
    window.executeEditCateringCustomerName = executeEditCateringCustomerName;
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