// src/features/roster/rosterAdminOps.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { API_URL } from '../../config/constants.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal, closeAdminCateringModal } from '../../ui/modals.js';
import { isSameDate, escapeHtml, sanitizeFirebaseKey } from '../../utils/helpers.js';
import { populateCateringCustomerDropdown } from '../chat/index.js';
import { 
    loadRosterCache,
    parseQueueTime, 
    isAdmin, 
    isTL,
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
import { purgeCartSlotForCustomer } from './actions/rosterCateringCompletion.js';

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
    const cleanCustKey = sanitizeFirebaseKey(custName);

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
        purgeCartSlotForCustomer(custName);
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

    // Concurrently update customerChats in background without blocking status change
    if (db && custName) {
        const cleanSearchName = custName.trim().toLowerCase();
        const selectedCustId = custSelect && custSelect.value.trim().toLowerCase() === cleanSearchName
            ? (custSelect.selectedOptions?.[0]?.dataset?.custId || null)
            : null;

        const updateObj = {
            folder: 'catering',
            status: 'active',
            cateredByRiderId: targetId,
            cateredByRiderName: targetName,
            cateredBy: targetName,
            forcedBy: adminName,
            isForcedCater: true,
            lastUpdated: Date.now()
        };

        if (selectedCustId) {
            db.ref(`customerChats/${selectedCustId}/metadata`).update(updateObj).catch(() => {});
            db.ref(`customerChatMeta/${selectedCustId}`).update(updateObj).catch(() => {});
        } else {
            db.ref('customerChatMeta').once('value').then((snapshot) => {
                const chats = snapshot.val() || {};
                Object.keys(chats).forEach(custId => {
                    const meta = chats[custId]?.metadata || chats[custId] || {};
                    // Never reopen or hijack completed, voided, or done chats
                    if (meta.folder === 'done' || meta.status === 'completed' || meta.status === 'voided') return;

                    const chatCustName = (meta.customerName || meta.name || "").trim().toLowerCase();
                    const resolvedFb = typeof window.getResolvedFbName === 'function' ? window.getResolvedFbName(custId) : null;
                    const fbName = (resolvedFb?.name || "").trim().toLowerCase();

                    if (chatCustName === cleanSearchName || fbName === cleanSearchName || isCustomerMatch(chatCustName, cleanSearchName) || (fbName && isCustomerMatch(fbName, cleanSearchName))) {
                        db.ref(`customerChats/${custId}/metadata`).update(updateObj).catch(() => {});
                        db.ref(`customerChatMeta/${custId}`).update(updateObj).catch(() => {});
                    }
                });
            }).catch(() => {});
        }
    }

    const forceExtraData = { 
        forcedCaters: forcedCatersMap,
        forcedBy: adminName,
        isForcedCater: true
    };
    if (penaltyMins > 0) {
        forceExtraData.pendingPenaltyMinutes = penaltyMins;
        if (targetRecord) {
            targetRecord.pendingPenaltyMinutes = penaltyMins;
        }
    }

    // Atomic Roster Update: Write status, customers, and forced metadata in one single mutation!
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
        forceExtraData
    );

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
        const hasAdminPower = isAdmin() || canManageRoster() || Boolean(globalState.adminControlsEnabled) || (typeof localStorage !== 'undefined' && localStorage.getItem('adminControlsEnabled') === 'true');
        const hasTlVoidPower = hasTlPermission('canVoidCustomer') || hasTlPermission('canVoid') || hasTlPermission('canForceCater');

        if (!hasAdminPower && !hasTlVoidPower) {
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
                if (targetRecord) {
                    targetRecord.forcedCaters = null;
                    targetRecord.forcedBy = null;
                    targetRecord.isForcedCater = false;
                    targetRecord.customerFees = null;
                    targetRecord.lastReceiptFees = null;
                    targetRecord.lastReceiptTotalFees = 0;
                }
                await updateRosterStatusData('Available', '', '', topQueueTime, id, name, [], false, "", { 
                    forcedCaters: null,
                    forcedBy: null,
                    isForcedCater: false,
                    customerFees: null,
                    lastReceiptFees: null,
                    lastReceiptTotalFees: 0
                });
                showToast(`🚫 Voided order for ${name}. Placed in Available queue!`);
            }
        });
        return;
    }

    openSlideDeleteModal(`Force Status: ${actionValue}?`, `Force change status of ${name} to [${actionValue}]?`, async () => {
        if (actionValue === 'Available') {
            if (targetRecord) {
                targetRecord.forcedCaters = null;
                targetRecord.forcedBy = null;
                targetRecord.isForcedCater = false;
                targetRecord.customerFees = null;
                targetRecord.lastReceiptFees = null;
                targetRecord.lastReceiptTotalFees = 0;
            }
            const currentRoster = globalState.rosterMembers || [];
            const availableRiders = currentRoster.filter(m => m.status === 'Available' && (m.telegramId || "").toString() !== id.toString());
            let maxTime = Date.now();
            availableRiders.forEach(r => {
                const t = parseQueueTime(r.queueTime);
                if (t > maxTime) maxTime = t;
            });
            await updateRosterStatusData('Available', '', '', maxTime + 1000, id, name, [], false, "", { 
                forcedCaters: null,
                forcedBy: null,
                isForcedCater: false,
                customerFees: null,
                lastReceiptFees: null,
                lastReceiptTotalFees: 0
            });
        } else if (actionValue === 'End') {
            if (targetRecord) {
                targetRecord.forcedCaters = null;
                targetRecord.forcedBy = null;
                targetRecord.isForcedCater = false;
                targetRecord.customerFees = null;
                targetRecord.lastReceiptFees = null;
                targetRecord.lastReceiptTotalFees = 0;
            }
            await clockOutRider(id);
            await updateRosterStatus('End', id, name, null, true);
        } else {
            await updateRosterStatus(actionValue, id, name, null, true);
        }
        showToast(`⚡ Force updated ${name} to ${actionValue}`);
    });
}

export async function adminVoidSpecificCustomer(targetId, targetName, custNameToVoid) {
    const hasAdminPower = isAdmin() || canManageRoster() || Boolean(globalState.adminControlsEnabled) || (typeof localStorage !== 'undefined' && localStorage.getItem('adminControlsEnabled') === 'true');
    const hasTlVoidPower = hasTlPermission('canVoidCustomer') || hasTlPermission('canVoid') || hasTlPermission('canForceCater');

    if (!hasAdminPower && !hasTlVoidPower) {
        return showToast("⚠️ Unauthorized: You do not have permission to Void Active Customers.");
    }

    if (!custNameToVoid) return showToast("⚠️ Missing customer name to void.");

    openSlideDeleteModal(`Void Customer: ${custNameToVoid}?`, `Sigurado ka bang nais i-void si ${custNameToVoid} para kay ${targetName || 'Rider'}?`, async () => {
        await voidSingleCateringCustomer(targetId, targetName, custNameToVoid);
    });
}

export function openEditCateringCustomerModal(riderId, riderName, currentCustomerName) {
    const isUserAdmin = (typeof isAdmin === 'function' && isAdmin()) ||
                        (typeof canManageRoster === 'function' && canManageRoster()) ||
                        (typeof window.isAdmin === 'function' && window.isAdmin()) ||
                        (typeof isTL === 'function' && isTL()) ||
                        (typeof hasTlPermission === 'function' && hasTlPermission('canForceCater')) ||
                        Boolean(globalState.adminControlsEnabled);
    if (!isUserAdmin) {
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
    const isUserAdmin = (typeof isAdmin === 'function' && isAdmin()) ||
                        (typeof canManageRoster === 'function' && canManageRoster()) ||
                        (typeof window.isAdmin === 'function' && window.isAdmin()) ||
                        (typeof isTL === 'function' && isTL()) ||
                        (typeof hasTlPermission === 'function' && hasTlPermission('canForceCater')) ||
                        Boolean(globalState.adminControlsEnabled);
    if (!isUserAdmin) {
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
    const cleanId = (riderId || "").toString().trim().toLowerCase();
    const cleanName = (riderName || "").trim().toLowerCase();

    const roster = globalState.rosterMembers || [];
    const targetRecord = roster.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim().toLowerCase();
        const mName = (m.riderName || m.name || "").trim().toLowerCase();
        return (cleanId && mId === cleanId) || (cleanName && mName === cleanName);
    });

    if (!targetRecord || (targetRecord.status || '').toLowerCase() !== 'catering') {
        closeEditCateringCustomerModal();
        return showToast("⚠️ Hindi na aktibong nag-ke-cater ang rider na ito.");
    }

    let currentCusts = (targetRecord.customerName || "").split(/\s*,\s*/).map(c => c.trim()).filter(Boolean);
    let matchIdx = currentCusts.findIndex(c => c.toLowerCase() === oldName.toLowerCase() || (typeof isCustomerMatch === 'function' && isCustomerMatch(c, oldName)));

    if (matchIdx !== -1) {
        currentCusts[matchIdx] = newName;
    } else if (currentCusts.length <= 1) {
        currentCusts = [newName];
    } else {
        currentCusts.push(newName);
    }

    const updatedCustomerNames = currentCusts.join(', ');
    const resolvedTargetId = (targetRecord.telegramId || targetRecord.id || riderId || cleanId).toString().trim();
    const resolvedTargetName = targetRecord.riderName || targetRecord.name || riderName || cleanName;

    const atomicUpdates = {};
    atomicUpdates[`roster/${resolvedTargetId}/customerName`] = updatedCustomerNames;
    atomicUpdates[`roster/${resolvedTargetId}/lastUpdated`] = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (targetRecord.telegramId && targetRecord.id && String(targetRecord.telegramId) !== String(targetRecord.id)) {
        atomicUpdates[`roster/${targetRecord.id}/customerName`] = updatedCustomerNames;
        atomicUpdates[`roster/${targetRecord.id}/lastUpdated`] = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const matchingCustIds = new Set();

    // 1. Migrate forcedCaters & collect exact matching custIds
    if (targetRecord.forcedCaters && typeof targetRecord.forcedCaters === 'object') {
        for (const [fcKey, fcVal] of Object.entries(targetRecord.forcedCaters)) {
            const fcName = (fcVal && typeof fcVal === 'object' && fcVal.customerName) ? fcVal.customerName : (typeof fcVal === 'string' ? fcVal : fcKey);
            if (fcName.toLowerCase() === oldName.toLowerCase() || (typeof isCustomerMatch === 'function' && isCustomerMatch(fcName, oldName))) {
                matchingCustIds.add(fcKey);
                if (typeof fcVal === 'object' && fcVal !== null) {
                    fcVal.customerName = newName;
                    atomicUpdates[`roster/${resolvedTargetId}/forcedCaters/${fcKey}/customerName`] = newName;
                } else {
                    atomicUpdates[`roster/${resolvedTargetId}/forcedCaters/${fcKey}`] = newName;
                }
            }
        }
    }

    // 2. Migrate customerFees
    if (targetRecord.customerFees && typeof targetRecord.customerFees === 'object') {
        for (const [feeKey, feeVal] of Object.entries(targetRecord.customerFees)) {
            const fName = (feeVal && typeof feeVal === 'object' && feeVal.customerName) ? feeVal.customerName : feeKey;
            if (fName.toLowerCase() === oldName.toLowerCase() || (typeof isCustomerMatch === 'function' && isCustomerMatch(fName, oldName))) {
                if (typeof feeVal === 'object' && feeVal !== null) {
                    feeVal.customerName = newName;
                    atomicUpdates[`roster/${resolvedTargetId}/customerFees/${feeKey}/customerName`] = newName;
                }
                const cleanOldFeeKey = sanitizeFirebaseKey(oldName);
                const cleanNewFeeKey = sanitizeFirebaseKey(newName);
                if (cleanOldFeeKey && cleanNewFeeKey && cleanOldFeeKey !== cleanNewFeeKey && targetRecord.customerFees[cleanOldFeeKey]) {
                    const movedFee = targetRecord.customerFees[cleanOldFeeKey];
                    targetRecord.customerFees[cleanNewFeeKey] = movedFee;
                    delete targetRecord.customerFees[cleanOldFeeKey];
                    atomicUpdates[`roster/${resolvedTargetId}/customerFees/${cleanNewFeeKey}`] = movedFee;
                    atomicUpdates[`roster/${resolvedTargetId}/customerFees/${cleanOldFeeKey}`] = null;
                }
            }
        }
    }

    // 3. Scan cachedCustomerThreadsMap in memory for matching thread(s)
    if (typeof window.getCachedCustomerThreadsMap === 'function') {
        const threadMap = window.getCachedCustomerThreadsMap();
        if (threadMap && threadMap.size > 0) {
            for (const [tId, t] of threadMap.entries()) {
                const tName = (t.customerName || t.name || "").trim().toLowerCase();
                if (tName === oldName.toLowerCase() || (typeof isCustomerMatch === 'function' && isCustomerMatch(tName, oldName))) {
                    const realKey = (t.custId || t.id || tId || "").toString().replace(/^id_/, '').replace(/^fb_fb_/, 'fb_');
                    if (realKey) matchingCustIds.add(realKey);
                }
            }
        }
    }

    // 4. Scan lightweight customerChatMeta snapshot directly in Firebase (NO heavy customerChats tree download!)
    if (db) {
        try {
            const metaSnap = await db.ref('customerChatMeta').once('value');
            if (metaSnap.exists()) {
                const allMeta = metaSnap.val() || {};
                Object.keys(allMeta).forEach(custId => {
                    const m = allMeta[custId]?.metadata || allMeta[custId] || {};
                    const chatCustName = (m.customerName || m.name || "").trim().toLowerCase();
                    if (chatCustName === oldName.toLowerCase() || (typeof isCustomerMatch === 'function' && isCustomerMatch(chatCustName, oldName))) {
                        matchingCustIds.add(custId);
                    }
                });
            }
        } catch(e) {
            console.warn('[executeEditCateringCustomerName] chat meta sync warning:', e);
        }
    }

    // 5. Update metadata, avatar, and local cache for all matching customer IDs
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(newName)}&background=0084FF&color=fff`;
    matchingCustIds.forEach(custId => {
        atomicUpdates[`customerChats/${custId}/metadata/customerName`] = newName;
        atomicUpdates[`customerChats/${custId}/metadata/name`] = newName;
        atomicUpdates[`customerChats/${custId}/metadata/avatarUrl`] = avatar;
        atomicUpdates[`customerChats/${custId}/metadata/lastUpdated`] = Date.now();
        atomicUpdates[`customerChatMeta/${custId}/customerName`] = newName;
        atomicUpdates[`customerChatMeta/${custId}/name`] = newName;
        atomicUpdates[`customerChatMeta/${custId}/avatarUrl`] = avatar;
        atomicUpdates[`customerChatMeta/${custId}/lastUpdated`] = Date.now();
        atomicUpdates[`customers/${custId}/name`] = newName;
        atomicUpdates[`customers/${custId}/customerName`] = newName;

        // If Facebook thread, update local FB name cache so it doesn't get reverted!
        if (custId.startsWith('fb_')) {
            try {
                const rawCache = localStorage.getItem('fb_name_cache_v2');
                const cache = rawCache ? JSON.parse(rawCache) : {};
                cache[custId] = { name: newName, avatarUrl: avatar, timestamp: Date.now() };
                localStorage.setItem('fb_name_cache_v2', JSON.stringify(cache));
            } catch (_) {}
        }

        // Update in-memory thread map
        if (typeof window.getCachedCustomerThreadsMap === 'function') {
            const threadMap = window.getCachedCustomerThreadsMap();
            if (threadMap && threadMap.has(custId)) {
                const t = threadMap.get(custId);
                t.customerName = newName;
                t.name = newName;
                t.avatarUrl = avatar;
            }
        }

        // If chat modal for this customer is open, update UI immediately
        const activeCustId = (typeof window.getActiveRiderChatCustId === 'function') ? window.getActiveRiderChatCustId() : null;
        if (activeCustId === custId) {
            const nameEl = document.getElementById('rider-chat-cust-name');
            if (nameEl) nameEl.innerText = newName;
            const avatarEl = document.getElementById('rider-chat-avatar') || document.getElementById('rider-chat-cust-avatar');
            if (avatarEl) {
                if (avatarEl.tagName === 'IMG') avatarEl.src = avatar;
                else avatarEl.innerHTML = `<img src="${avatar}" class="w-full h-full rounded-full object-cover">`;
            }
            if (typeof window.getCurrentRiderChatMeta === 'function') {
                const meta = window.getCurrentRiderChatMeta();
                if (meta) {
                    meta.customerName = newName;
                    meta.avatarUrl = avatar;
                }
            }
        }
    });

    // 6. Update active orders matching old customer name
    if (db) {
        try {
            const ordersSnap = await db.ref('orders').orderByChild('status').equalTo('placed').once('value');
            if (ordersSnap.exists()) {
                const orders = ordersSnap.val() || {};
                Object.keys(orders).forEach(orderId => {
                    const ord = orders[orderId];
                    if (ord && ord.customerName && (ord.customerName.toLowerCase() === oldName.toLowerCase() || (typeof isCustomerMatch === 'function' && isCustomerMatch(ord.customerName, oldName)))) {
                        atomicUpdates[`orders/${orderId}/customerName`] = newName;
                    }
                });
            }
        } catch (_) {}
    }

    // 7. Update Cart slot customer name if present in localStorage
    try {
        for (let i = 1; i <= 5; i++) {
            const slotKey = `cart_customer_slot_${i}`;
            const val = localStorage.getItem(slotKey);
            if (val && (val.toLowerCase() === oldName.toLowerCase() || (typeof isCustomerMatch === 'function' && isCustomerMatch(val, oldName)))) {
                localStorage.setItem(slotKey, newName);
            }
        }
        const generalCust = localStorage.getItem('cart_customer_name');
        if (generalCust && (generalCust.toLowerCase() === oldName.toLowerCase() || (typeof isCustomerMatch === 'function' && isCustomerMatch(generalCust, oldName)))) {
            localStorage.setItem('cart_customer_name', newName);
        }
    } catch (_) {}

    // 8. Execute batch updates to Firebase RTDB
    if (db && Object.keys(atomicUpdates).length > 0) {
        try {
            await db.ref().update(atomicUpdates);
        } catch(err) {
            console.error('[executeEditCateringCustomerName] update error:', err);
            for (const [path, val] of Object.entries(atomicUpdates)) {
                db.ref(path).set(val).catch(() => {});
            }
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

    if (typeof window.renderRiderCustomerChatFeed === 'function') {
        window.renderRiderCustomerChatFeed();
    }
    if (typeof window.evaluateRiderChatLockPermissions === 'function') {
        window.evaluateRiderChatLockPermissions();
    }

    closeEditCateringCustomerModal();
    showToast(`✅ Na-update ang customer name ni ${resolvedTargetName} sa [${newName}]!`);
    showSideNotification("CUSTOMER RENAMED", `${oldName} ➔ ${newName} (${resolvedTargetName})`, "fa-pen-to-square", "text-amber-400", "border-amber-500");
}

export function promptVoidCustomer(riderName, customerName, completedDate = "", startTime = "", transactionId = "") {
    if (!isAdmin() && !hasTlPermission('canVoidCustomer')) return showToast("⚠️ Unauthorized: Admin or authorized TL access required.");

    openSlideDeleteModal(
        `Void Catered Record?`,
        `Sigurado ka bang nais mong burahin ang record ni [${customerName}] na inihatid ni ${riderName}?`,
        async () => {
            await executeVoidCateredCustomer(riderName, customerName, completedDate, startTime, transactionId);
        }
    );
}

export async function executeVoidCateredCustomer(riderName, customerName, completedDate = "", startTime = "", transactionId = "") {
    if (!isAdmin() && !hasTlPermission('canVoidCustomer')) return showToast("⚠️ Unauthorized: Admin or authorized TL access required.");

    const cleanRider = (riderName || "").trim().toLowerCase();
    const cleanCust = (customerName || "").trim().toLowerCase();
    const cleanCustKey = sanitizeFirebaseKey(cleanCust);

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
                        customerFees: null,
                        lastReceiptFees: null,
                        lastReceiptTotalFees: 0,
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
                m.customerFees = null;
                m.lastReceiptFees = null;
                m.lastReceiptTotalFees = 0;
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