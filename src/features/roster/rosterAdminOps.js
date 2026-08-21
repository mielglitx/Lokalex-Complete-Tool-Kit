// src/features/roster/rosterAdminOps.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { API_URL } from '../../config/constants.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal, closeAdminCateringModal } from '../../ui/modals.js';
import { getLocalTodayStr, isSameDate } from '../../utils/helpers.js';
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
import { getTopQueueTime, updateRosterStatus, updateRosterStatusData } from './rosterStatus.js';

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
            await updateRosterStatus('Available', id, name, maxTime + 1000);
        } else {
            await updateRosterStatus(actionValue, id, name);
        }
        showToast(`⚡ Force updated ${name} to ${actionValue}`);
    });
}

// ADMIN VOID ACTIVE CATERING CUSTOMER
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

// ADMIN VOID COMPLETED CATERED RECORD
export function promptVoidCustomer(riderName, customerName, completedDate = "", startTime = "") {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    openSlideDeleteModal(
        `Void Catered Record?`,
        `Sigurado ka bang nais mong burahin ang record ni [${customerName}] na inihatid ni ${riderName}?`,
        async () => {
            await executeVoidCateredCustomer(riderName, customerName, completedDate, startTime);
        }
    );
}

export async function executeVoidCateredCustomer(riderName, customerName, completedDate = "", startTime = "") {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    try {
        if (db) {
            const snap = await db.ref('cateredHistory').once('value');
            const data = snap.val() || {};
            
            let targetKey = null;
            const entries = Object.entries(data);

            for (let i = entries.length - 1; i >= 0; i--) {
                const [k, v] = entries[i];
                const rMatch = (v.riderName || "").trim().toLowerCase() === (riderName || "").trim().toLowerCase();
                const cMatch = (v.customerName || "").trim().toLowerCase() === (customerName || "").trim().toLowerCase();
                const dMatch = !completedDate || isSameDate(v.completedDate, completedDate);
                const sMatch = !startTime || (v.startTime || "").trim() === startTime.trim();

                if (rMatch && cMatch && dMatch && sMatch) {
                    targetKey = k;
                    break;
                }
            }

            if (!targetKey) {
                for (let i = entries.length - 1; i >= 0; i--) {
                    const [k, v] = entries[i];
                    const rMatch = (v.riderName || "").trim().toLowerCase() === (riderName || "").trim().toLowerCase();
                    const cMatch = (v.customerName || "").trim().toLowerCase() === (customerName || "").trim().toLowerCase();
                    const dMatch = !completedDate || isSameDate(v.completedDate, completedDate);

                    if (rMatch && cMatch && dMatch) {
                        targetKey = k;
                        break;
                    }
                }
            }

            if (targetKey) {
                await db.ref(`cateredHistory/${targetKey}`).remove();
            }
        }

        if (globalState.globalCateredHistory) {
            const idx = globalState.globalCateredHistory.findIndex(h => 
                (h.riderName || "").trim().toLowerCase() === (riderName || "").trim().toLowerCase() &&
                (h.customerName || "").trim().toLowerCase() === (customerName || "").trim().toLowerCase() &&
                (!completedDate || isSameDate(h.completedDate, completedDate))
            );
            if (idx !== -1) {
                globalState.globalCateredHistory.splice(idx, 1);
            }
        }

        saveRosterCache();
        if (typeof window.loadGlobalCateredList === 'function') {
            window.loadGlobalCateredList();
        }

        showToast(`🗑️ Voided catered record for ${customerName}.`);
        showSideNotification("RECORD VOIDED", `Voided catered entry for ${customerName}`, "fa-trash", "text-red-400", "border-red-500");
    } catch(e) {
        console.error("Void catered record error:", e);
        showToast("❌ Failed to void catered customer record.");
    }
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
        for (const m of rosterMembers) {
            if (m.telegramId) {
                await archiveRiderCateringIfNeeded(m);
                db.ref('roster/' + m.telegramId).update({ 
                    status: 'End', 
                    customerName: "", 
                    startTime: "", 
                    pendingPenaltyMinutes: 0, 
                    cooldownUntil: 0,
                    lastActiveTimestamp: Date.now()
                });
            }
        }

        try {
            await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ type: "roster", action: "force_all_end" }) });
        } catch(e) {}
    });
}

// ============================================================================
// ADMIN AUTO END SHIFT CONFIGURATION & SCHEDULER
// ============================================================================
export function openAdminAutoEndShiftModal() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");
    const modal = document.getElementById('admin-auto-endshift-modal');
    if (!modal) return;

    if (db) {
        db.ref('settings/autoEndShift').once('value', (snap) => {
            const data = snap.val() || {};
            const enabledToggle = document.getElementById('auto-endshift-enabled');
            const timeInput = document.getElementById('auto-endshift-time');
            const statusDesc = document.getElementById('auto-endshift-status-desc');

            if (enabledToggle) enabledToggle.checked = !!data.enabled;
            if (timeInput) timeInput.value = data.time || "03:00";
            if (statusDesc) {
                statusDesc.innerText = data.enabled 
                    ? `Active: Scheduled daily at ${data.time || '03:00'}`
                    : "Disabled: No auto end shift will occur.";
            }
        });
    }
    modal.classList.remove('hidden');
}

export function closeAdminAutoEndShiftModal() {
    const modal = document.getElementById('admin-auto-endshift-modal');
    if (modal) modal.classList.add('hidden');
}

export async function saveAdminAutoEndShiftSettings() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");
    const enabledToggle = document.getElementById('auto-endshift-enabled');
    const timeInput = document.getElementById('auto-endshift-time');

    const isEnabled = enabledToggle ? enabledToggle.checked : false;
    let setTime = timeInput ? timeInput.value.trim() : "03:00";
    if (!setTime) setTime = "03:00";

    const payload = {
        enabled: isEnabled,
        time: setTime,
        updatedBy: appState.riderName || "Admin",
        updatedAt: Date.now()
    };

    try {
        if (db) {
            await db.ref('settings/autoEndShift').update(payload);
        }

        closeAdminAutoEndShiftModal();
        showToast(`⚙️ Auto End Shift ${isEnabled ? `set to ${setTime}` : 'Disabled'}!`);
        showSideNotification("SETTINGS SAVED", `Auto End Shift: ${isEnabled ? setTime : 'DISABLED'}`, "fa-clock", "text-purple-400", "border-purple-500");
    } catch(e) {
        showToast("❌ Failed to update auto end shift settings.");
    }
}

export async function checkAndTriggerAutoEndShift() {
    if (!db) return;
    try {
        const snap = await db.ref('settings/autoEndShift').once('value');
        const config = snap.val();
        if (!config || !config.enabled || !config.time) return;

        const todayStr = getLocalTodayStr();
        if (config.lastTriggeredDate === todayStr) return;

        const now = new Date();
        const [targetHour, targetMinute] = config.time.split(':').map(Number);
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();

        const currentTotalMins = currentHour * 60 + currentMinute;
        const targetTotalMins = targetHour * 60 + targetMinute;

        if (currentTotalMins >= targetTotalMins) {
            const updateRes = await db.ref('settings/autoEndShift').transaction((current) => {
                if (!current || !current.enabled || current.lastTriggeredDate === todayStr) {
                    return;
                }
                current.lastTriggeredDate = todayStr;
                return current;
            });

            if (updateRes.committed) {
                await executeAutoEndShift();
            }
        }
    } catch(e) {
        console.error("Auto end shift evaluation error:", e);
    }
}

export async function executeAutoEndShift() {
    showSideNotification("AUTO END SHIFT", "System auto end shift triggered for all active riders", "fa-power-off", "text-red-400", "border-red-500");
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (db) {
        const rosterSnap = await db.ref('roster').once('value');
        const roster = rosterSnap.val() || {};

        const updates = {};
        const loginUpdates = {};

        for (const riderId of Object.keys(roster)) {
            const m = roster[riderId];
            if (m && m.status !== 'End') {
                await archiveRiderCateringIfNeeded(m);
                updates[`roster/${riderId}/status`] = 'End';
                updates[`roster/${riderId}/customerName`] = '';
                updates[`roster/${riderId}/startTime`] = '';
                updates[`roster/${riderId}/pendingPenaltyMinutes`] = 0;
                updates[`roster/${riderId}/cooldownUntil`] = 0;
                updates[`roster/${riderId}/lastUpdated`] = timeStr;
                updates[`roster/${riderId}/lastActiveTimestamp`] = Date.now();

                loginUpdates[`logins/${riderId}/clockOutTime`] = timeStr;
            }
        }

        if (Object.keys(updates).length > 0) {
            await db.ref().update({ ...updates, ...loginUpdates });
        }
    }

    try {
        await fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({ type: "roster", action: "auto_end_shift", time: timeStr })
        });
    } catch(e) {}
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
}