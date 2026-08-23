// src/features/roster/rosterAdminOps.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { API_URL } from '../../config/constants.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal, closeAdminCateringModal } from '../../ui/modals.js';
import { getLocalTodayStr, isSameDate, escapeHtml } from '../../utils/helpers.js';
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
import { getTopQueueTime, updateRosterStatus, updateRosterStatusData, voidSingleCateringCustomer } from './rosterStatus.js';

let pendingAdminTarget = null;

const DAYS_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

function getRiderStorageKey(riderId, riderName) {
    const cleanId = (riderId || "").toString().trim();
    if (cleanId) return cleanId;

    const rosterRec = (globalState.rosterMembers || []).find(m =>
        (m.riderName || m.name || "").toLowerCase().trim() === (riderName || "").toLowerCase().trim()
    );
    if (rosterRec && (rosterRec.telegramId || rosterRec.id)) {
        return (rosterRec.telegramId || rosterRec.id).toString().trim();
    }

    return (riderName || "unknown").toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
}

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
    const penaltySelect = document.getElementById('admin-cater-penalty-select');

    if (idInput) idInput.value = id || "";
    if (nameInputHidden) nameInputHidden.value = name || "";
    if (custInput) custInput.value = "";
    if (penaltySelect) penaltySelect.value = "0";

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
    const penaltySelect = document.getElementById('admin-cater-penalty-select');

    let targetId = idInput ? idInput.value.trim() : "";
    let targetName = nameInputHidden ? nameInputHidden.value.trim() : "";
    const penaltyMins = penaltySelect ? parseInt(penaltySelect.value) || 0 : 0;

    if (!targetId && pendingAdminTarget && pendingAdminTarget.id) {
        targetId = pendingAdminTarget.id;
        targetName = pendingAdminTarget.name;
    }

    const custName = custInput ? custInput.value.trim() : "";

    if (!targetId) return showToast("⚠️ Target rider missing!");
    if (!custName) return showToast("⚠️ Please select or enter customer name!");

    const rosterMembers = globalState.rosterMembers || [];
    const targetRecord = rosterMembers.find(m => (m.telegramId || m.id || "").toString() === targetId.toString());

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

    if (penaltyMins > 0 && db && targetId) {
        await db.ref(`roster/${targetId}`).update({
            pendingPenaltyMinutes: penaltyMins
        });

        const targetInGlobal = (globalState.rosterMembers || []).find(m => (m.telegramId || m.id || "").toString() === targetId.toString());
        if (targetInGlobal) {
            targetInGlobal.pendingPenaltyMinutes = penaltyMins;
        }
        saveRosterCache();
    }

    const penaltyNotice = penaltyMins > 0 ? ` with ${penaltyMins}m cooldown penalty` : '';
    showToast(`⚡ Admin Force Catered ${custName} to ${targetName}${penaltyNotice}`);
    showSideNotification("FORCE CATER", `Assigned ${custName} to ${targetName}${penaltyNotice}`, "fa-user-gear", "text-amber-400", "border-amber-500");
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
            showSideNotification("ORDER VOIDED", `Voided order for ${name} — placed in Queue`, "fa-ban", "text-red-400", "border-red-500");
            await updateRosterStatusData('Available', '', '', topQueueTime, id, name);
            showToast(`🚫 Voided order for ${name}. Placed in Available queue!`);
        });
        return;
    }

    openSlideDeleteModal(`Force Status: ${actionValue}?`, `Force change status of ${name} to [${actionValue}]?`, async () => {
        if (actionValue === 'Available') {
            const currentRoster = globalState.rosterMembers || [];
            const availableRiders = currentRoster.filter(m => m.status === 'Available' && (m.telegramId || m.id || "").toString() !== id.toString());
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

// ADMIN VOID SPECIFIC CATERING CUSTOMER
export async function adminVoidSpecificCustomer(targetId, targetName, custNameToVoid) {
    if (!canManageRoster()) {
        return showToast("⚠️ Unauthorized: Admin or TL access required.");
    }

    if (!targetId || !custNameToVoid) return;

    openSlideDeleteModal(`Void Customer: ${custNameToVoid}?`, `Sigurado ka bang nais i-void si ${custNameToVoid} para kay ${targetName}?`, async () => {
        await voidSingleCateringCustomer(targetId, targetName, custNameToVoid);
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
            const mId = m.telegramId || m.id;
            if (mId) {
                await archiveRiderCateringIfNeeded(m);
                db.ref('roster/' + mId).update({ 
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
// HYBRID RIDER TIME-IN SCHEDULE & PERMANENT EARLY PASS CONTROLS
// ============================================================================
export async function openAdminTimeInScheduleModal() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const modal = document.getElementById('admin-timein-schedule-modal');
    const masterToggle = document.getElementById('admin-schedule-master-enabled');
    const defaultTimeInput = document.getElementById('admin-schedule-default-time');

    if (db) {
        try {
            const ridersSnap = await db.ref('riders').once('value');
            const ridersVal = ridersSnap.val();
            if (ridersVal) {
                Object.entries(ridersVal).forEach(([rId, item]) => {
                    const name = item.riderName || item.name || rId;
                    const cleanId = (item.telegramId || item.id || rId).toString().trim();
                    const existingIdx = (globalState.rosterMembers || []).findIndex(m => 
                        ((m.telegramId || m.id || "").toString().trim() === cleanId) ||
                        ((m.riderName || m.name || "").toLowerCase().trim() === name.toLowerCase().trim())
                    );
                    if (existingIdx !== -1) {
                        globalState.rosterMembers[existingIdx].telegramId = cleanId;
                        globalState.rosterMembers[existingIdx].id = cleanId;
                        globalState.rosterMembers[existingIdx].riderName = name;
                    } else {
                        if (!globalState.rosterMembers) globalState.rosterMembers = [];
                        globalState.rosterMembers.push({
                            telegramId: cleanId,
                            id: cleanId,
                            riderName: name,
                            name: name,
                            userType: item.userType || "rider",
                            status: "End"
                        });
                    }
                });
                saveRosterCache();
            }
        } catch(e) {}
    }

    const config = globalState.timeInSchedule || {};

    if (masterToggle) masterToggle.checked = !!config.enabled;
    if (defaultTimeInput) defaultTimeInput.value = config.defaultTimeIn || "08:00";

    renderAdminTimeInScheduleList();

    if (modal) modal.classList.remove('hidden');
}

export function closeAdminTimeInScheduleModal() {
    const modal = document.getElementById('admin-timein-schedule-modal');
    if (modal) modal.classList.add('hidden');
}

export function renderAdminTimeInScheduleList() {
    const container = document.getElementById('admin-schedule-riders-list');
    if (!container) return;

    const roster = globalState.rosterMembers || [];
    const config = globalState.timeInSchedule || {};
    const defaultTime = config.defaultTimeIn || "08:00";
    const riderSchedules = config.riderSchedules || {};

    if (roster.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-6 text-xs">No registered riders in roster.</div>`;
        return;
    }

    container.innerHTML = roster.map(r => {
        const rId = (r.telegramId || r.id || "").toString().trim();
        const rName = r.riderName || r.name || "Rider";
        const storageKey = getRiderStorageKey(rId, rName);

        const sched = (rId && riderSchedules[rId]) || 
                      riderSchedules[storageKey] || 
                      riderSchedules[rName.toLowerCase().trim()] || 
                      {};

        const customTime = sched.allowedTimeIn || "";
        const isEarlyPassActive = sched.earlyPassGranted === true;

        const idLabel = rId ? `(${escapeHtml(rId)})` : `<span class="text-amber-500 italic font-mono text-[9px]">ID: ${escapeHtml(storageKey)}</span>`;

        return `
        <div class="bg-cardBg border border-gray-200 dark:border-gray-800 p-3 rounded-2xl flex flex-col gap-2 shadow-xs">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 min-w-0">
                    <span class="font-bold text-xs text-gray-900 dark:text-white truncate">
                        <i class="fa-solid fa-motorcycle text-blue-500 mr-1"></i>${escapeHtml(rName)}
                    </span>
                    <span class="text-[9px] text-gray-400 font-mono">${idLabel}</span>
                </div>
                ${isEarlyPassActive 
                    ? `<span class="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[9px] font-black px-2 py-0.5 rounded-full animate-pulse">⚡ EARLY PASS ACTIVE</span>`
                    : `<span class="text-[9px] text-gray-400 font-bold">${customTime ? `Custom (${customTime})` : `Default (${defaultTime})`}</span>`}
            </div>

            <div class="flex items-center justify-between gap-2 pt-1 border-t border-gray-100 dark:border-gray-800">
                <div class="flex items-center gap-1.5 flex-1">
                    <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase shrink-0">Time-In:</label>
                    <input type="time" id="rider-sched-time-${escapeHtml(storageKey)}" value="${customTime}" placeholder="${defaultTime}" class="bg-inputBg text-xs font-mono font-bold rounded-xl p-1.5 px-2 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white flex-1 max-w-[120px]">
                    <button type="button" onclick="document.getElementById('rider-sched-time-${escapeHtml(storageKey)}').value = ''; showToast('Cleared custom schedule for ${escapeHtml(rName)}.');" class="text-gray-400 hover:text-red-400 p-1 text-xs" title="Reset to Default Time">
                        <i class="fa-solid fa-rotate-left"></i>
                    </button>
                </div>

                <div class="flex items-center gap-1 shrink-0">
                    ${isEarlyPassActive 
                        ? `<button type="button" onclick="window.revokeRiderEarlyPass('${escapeHtml(storageKey)}', '${escapeHtml(rName)}')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 dark:bg-red-900/30 dark:hover:bg-red-800 dark:text-red-300 text-[10px] font-bold px-2.5 py-1.5 rounded-xl transition active:scale-95">
                                Revoke Pass
                           </button>`
                        : `<button type="button" onclick="window.grantRiderEarlyPass('${escapeHtml(storageKey)}', '${escapeHtml(rName)}')" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-600/30 dark:hover:bg-emerald-600 dark:text-emerald-300 text-[10px] font-bold px-2.5 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 shadow-xs">
                                <i class="fa-solid fa-bolt text-[9px]"></i> Early Pass
                           </button>`}
                </div>
            </div>
        </div>`;
    }).join('');
}

export async function grantRiderEarlyPass(riderKey, riderName) {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const storageKey = getRiderStorageKey(riderKey, riderName);
    const config = globalState.timeInSchedule || {};
    const riderSchedules = config.riderSchedules || {};

    const existing = riderSchedules[storageKey] || {};
    existing.riderName = riderName || "Rider";
    existing.earlyPassGranted = true;
    existing.passGrantedAt = Date.now();
    existing.passGrantedBy = appState.riderName || "Admin";

    riderSchedules[storageKey] = existing;
    if (riderName) {
        riderSchedules[riderName.toLowerCase().trim()] = existing;
    }

    config.riderSchedules = riderSchedules;
    globalState.timeInSchedule = config;

    try {
        if (db) {
            const payload = sanitizeForFirebase({
                riderName: riderName || "Rider",
                earlyPassGranted: true,
                passGrantedAt: Date.now(),
                passGrantedBy: appState.riderName || "Admin"
            });
            await db.ref(`settings/timeInSchedule/riderSchedules/${storageKey}`).update(payload);
            if (riderName && riderName.toLowerCase().trim() !== storageKey) {
                await db.ref(`settings/timeInSchedule/riderSchedules/${riderName.toLowerCase().trim()}`).update(payload).catch(() => {});
            }
        }

        renderAdminTimeInScheduleList();
        showToast(`⚡ Permanent Early Pass enabled for ${riderName}!`);
        showSideNotification("EARLY PASS ENABLED", `${riderName} can now time-in anytime without schedule limits`, "fa-bolt", "text-emerald-400", "border-emerald-500");
    } catch(e) {
        console.error("Grant early pass error:", e);
        showToast(`❌ Failed to grant early pass: ${e.message || "Database Error"}`);
    }
}

export async function revokeRiderEarlyPass(riderKey, riderName) {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const storageKey = getRiderStorageKey(riderKey, riderName);
    const config = globalState.timeInSchedule || {};
    const riderSchedules = config.riderSchedules || {};

    if (riderSchedules[storageKey]) {
        riderSchedules[storageKey].earlyPassGranted = false;
    }
    if (riderName && riderSchedules[riderName.toLowerCase().trim()]) {
        riderSchedules[riderName.toLowerCase().trim()].earlyPassGranted = false;
    }

    config.riderSchedules = riderSchedules;
    globalState.timeInSchedule = config;

    try {
        if (db) {
            await db.ref(`settings/timeInSchedule/riderSchedules/${storageKey}`).update({
                earlyPassGranted: false
            });
            if (riderName && riderName.toLowerCase().trim() !== storageKey) {
                await db.ref(`settings/timeInSchedule/riderSchedules/${riderName.toLowerCase().trim()}`).update({
                    earlyPassGranted: false
                }).catch(() => {});
            }
        }

        renderAdminTimeInScheduleList();
        showToast(`🚫 Revoked early pass for ${riderName}.`);
        showSideNotification("EARLY PASS REVOKED", `${riderName} must now follow time-in schedule`, "fa-clock", "text-red-400", "border-red-500");
    } catch(e) {
        console.error("Revoke early pass error:", e);
        showToast(`❌ Failed to revoke early pass: ${e.message || "Database Error"}`);
    }
}

export async function saveAdminTimeInScheduleSettings() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const masterToggle = document.getElementById('admin-schedule-master-enabled');
    const defaultTimeInput = document.getElementById('admin-schedule-default-time');

    const enabled = masterToggle ? masterToggle.checked : false;
    const defaultTimeIn = defaultTimeInput?.value ? defaultTimeInput.value.trim() : "08:00";

    const config = globalState.timeInSchedule || {};
    const riderSchedules = config.riderSchedules || {};

    document.querySelectorAll('[id^="rider-sched-time-"]').forEach(input => {
        const key = input.id.replace('rider-sched-time-', '').trim();
        const customTime = input.value.trim();
        
        if (key) {
            if (!riderSchedules[key]) {
                const rosterRec = (globalState.rosterMembers || []).find(m => 
                    ((m.telegramId || m.id || "").toString().trim() === key) ||
                    ((m.riderName || m.name || "").toLowerCase().trim().replace(/[^a-z0-9]/g, '_') === key)
                );
                riderSchedules[key] = {
                    riderName: rosterRec ? (rosterRec.riderName || rosterRec.name || "Rider") : "Rider",
                    earlyPassGranted: false
                };
            }
            riderSchedules[key].allowedTimeIn = customTime || "";
        }
    });

    const payload = sanitizeForFirebase({
        enabled: Boolean(enabled),
        defaultTimeIn: defaultTimeIn || "08:00",
        riderSchedules: riderSchedules || {},
        updatedBy: appState.riderName || "Admin",
        updatedAt: Date.now()
    });

    globalState.timeInSchedule = payload;
    try {
        localStorage.setItem('lokalex_timein_schedule_cache', JSON.stringify(payload));
    } catch(e) {}

    try {
        if (db) {
            await db.ref('settings/timeInSchedule').set(payload);
        }

        closeAdminTimeInScheduleModal();
        showToast(`⚙️ Rider Time-In Schedule saved (${enabled ? 'Active' : 'Disabled'})!`);
        showSideNotification("SCHEDULE SAVED", `Default: ${defaultTimeIn} • Restriction ${enabled ? 'ENABLED' : 'DISABLED'}`, "fa-clock", "text-purple-400", "border-purple-500");
    } catch(e) {
        console.error("Save time-in schedule error:", e);
        showToast(`❌ Failed to save: ${e.message || "Check database permissions"}`);
    }
}

export function listenToTimeInSchedule() {
    if (!db) return;

    try {
        const cached = localStorage.getItem('lokalex_timein_schedule_cache');
        if (cached) globalState.timeInSchedule = JSON.parse(cached);
    } catch(e) {}

    db.ref('settings/timeInSchedule').on('value', (snap) => {
        const data = snap.val();
        if (data) {
            globalState.timeInSchedule = data;
            try {
                localStorage.setItem('lokalex_timein_schedule_cache', JSON.stringify(data));
            } catch(e) {}
        }
    });
}

// ============================================================================
// 1. RIDER DAY-OFF SELECTION CONTROLS (FOR INDIVIDUAL RIDERS)
// ============================================================================
export function openRiderDayOffModal() {
    const modal = document.getElementById('rider-dayoff-modal');
    if (!modal) return;

    renderRiderDayOffPicker();
    modal.classList.remove('hidden');
}

export function closeRiderDayOffModal() {
    const modal = document.getElementById('rider-dayoff-modal');
    if (modal) modal.classList.add('hidden');
}

export function renderRiderDayOffPicker() {
    const displayEl = document.getElementById('rider-current-dayoff-display');
    const badgeEl = document.getElementById('rider-dayoff-changes-badge');
    const container = document.getElementById('rider-dayoff-days-list');
    if (!container) return;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "Rider").trim();
    const myKey = getRiderStorageKey(myId, myName);

    const config = globalState.dayOffSettings || {
        enabled: true,
        maxChangesPerMonth: 2,
        quotas: { "0": 2, "1": 3, "2": 3, "3": 3, "4": 3, "5": 3, "6": 2 }
    };

    const allDayOffs = globalState.riderDayOffs || {};
    const myDayOffRecord = allDayOffs[myId] || allDayOffs[myKey] || allDayOffs[myName.toLowerCase().trim()] || null;

    const currentMonthStr = getLocalTodayStr().substring(0, 7);
    let changesMade = 0;
    if (myDayOffRecord && myDayOffRecord.lastChangedMonth === currentMonthStr) {
        changesMade = myDayOffRecord.changesThisMonth || 0;
    }

    const maxChanges = (config.maxChangesPerMonth !== undefined && config.maxChangesPerMonth !== null) 
        ? parseInt(config.maxChangesPerMonth) 
        : 2;

    const canChange = !config.enabled || (changesMade < maxChanges);

    if (displayEl) {
        if (myDayOffRecord && myDayOffRecord.dayOfWeek !== undefined && myDayOffRecord.dayOfWeek !== null && parseInt(myDayOffRecord.dayOfWeek) >= 0) {
            displayEl.innerText = `Every ${DAYS_NAMES[parseInt(myDayOffRecord.dayOfWeek)]}`;
            displayEl.className = "font-black text-sm text-teal-400 mt-0.5";
        } else {
            displayEl.innerText = "No Day-Off Selected";
            displayEl.className = "font-black text-sm text-gray-400 mt-0.5";
        }
    }

    if (badgeEl) {
        badgeEl.innerHTML = `Changes: <span class="${changesMade >= maxChanges ? 'text-red-400 font-black' : 'text-teal-300 font-black'}">${changesMade}/${maxChanges}</span> this month`;
    }

    // Collect occupants for each day of the week
    const occupantsPerDay = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    const countedRiders = new Set();

    Object.entries(allDayOffs).forEach(([key, rec]) => {
        if (!rec || rec.dayOfWeek === undefined || rec.dayOfWeek === null) return;
        const riderIdKey = (rec.riderId || rec.riderName || key).toString().trim();
        const riderName = rec.riderName || key;

        if (!countedRiders.has(riderIdKey.toLowerCase())) {
            countedRiders.add(riderIdKey.toLowerCase());
            const d = parseInt(rec.dayOfWeek);
            if (!isNaN(d) && d >= 0 && occupantsPerDay[d] !== undefined) {
                occupantsPerDay[d].push({ id: riderIdKey, name: riderName });
            }
        }
    });

    container.innerHTML = DAYS_NAMES.map((dayName, dayIdx) => {
        const isMyCurrent = myDayOffRecord && myDayOffRecord.dayOfWeek !== undefined && myDayOffRecord.dayOfWeek !== null && parseInt(myDayOffRecord.dayOfWeek) === dayIdx;
        const occupants = occupantsPerDay[dayIdx] || [];
        const taken = occupants.length;
        const quota = (config.quotas && config.quotas[dayIdx] !== undefined) ? parseInt(config.quotas[dayIdx]) : 3;
        const isFull = config.enabled && taken >= quota && !isMyCurrent;

        let actionHtml = "";
        if (isMyCurrent) {
            actionHtml = `<span class="bg-teal-500/20 text-teal-300 border border-teal-500/40 text-[10px] font-black px-2.5 py-1 rounded-xl flex items-center gap-1"><i class="fa-solid fa-circle-check"></i> Current Day-Off</span>`;
        } else if (!canChange) {
            actionHtml = `<span class="bg-gray-800 text-gray-400 text-[10px] font-bold px-2.5 py-1 rounded-xl border border-gray-700 select-none">Limit Reached</span>`;
        } else if (isFull) {
            actionHtml = `<span class="bg-red-500/10 text-red-400 border border-red-500/30 text-[10px] font-bold px-2.5 py-1 rounded-xl select-none">Full Slots</span>`;
        } else {
            actionHtml = `
            <button onclick="window.selectRiderDayOff && window.selectRiderDayOff(${dayIdx})" class="bg-teal-600 hover:bg-teal-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-xl transition active:scale-95 shadow flex items-center gap-1">
                Select ${dayName.substring(0,3)}
            </button>`;
        }

        let occupantsHtml = "";
        if (occupants.length > 0) {
            occupantsHtml = `
            <div class="flex flex-wrap items-center gap-1 mt-1">
                ${occupants.map(occ => {
                    const isMe = occ.id.toLowerCase() === myId.toLowerCase() || occ.name.toLowerCase() === myName.toLowerCase();
                    return `<span class="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-lg border ${
                        isMe 
                            ? 'bg-teal-500/20 border-teal-500/40 text-teal-300 font-black' 
                            : 'bg-black/40 border-gray-700/60 text-gray-300'
                    }"><i class="fa-solid fa-user text-[8px] opacity-70"></i> ${escapeHtml(occ.name)}</span>`;
                }).join('')}
            </div>`;
        } else {
            occupantsHtml = `<div class="text-[9px] text-gray-500 italic mt-0.5">Walang naka-schedule na rider.</div>`;
        }

        return `
        <div class="bg-darkBg border ${isMyCurrent ? 'border-teal-500/60 shadow-[0_0_10px_rgba(20,184,166,0.15)]' : 'border-gray-800'} p-2.5 rounded-2xl flex flex-col gap-1.5 transition">
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                    <span class="font-bold text-xs ${isMyCurrent ? 'text-teal-300 font-black' : 'text-white'}">${dayName}</span>
                    <span class="text-[9px] font-mono ${taken >= quota ? 'text-red-400 font-black' : 'text-gray-400 font-bold'}">(${taken}/${quota} occupied)</span>
                </div>
                <div class="shrink-0">
                    ${actionHtml}
                </div>
            </div>
            <div class="border-t border-gray-800/60 pt-1.5">
                <div class="text-[8px] font-bold uppercase tracking-wider text-gray-400">Riders on this day:</div>
                ${occupantsHtml}
            </div>
        </div>`;
    }).join('');
}

export async function selectRiderDayOff(dayIndex) {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "Rider").trim();
    const storageKey = getRiderStorageKey(myId, myName);

    if (!myId && !myName) return showToast("⚠️ Rider profile missing.");

    const config = globalState.dayOffSettings || {
        enabled: true,
        maxChangesPerMonth: 2,
        quotas: { "0": 2, "1": 3, "2": 3, "3": 3, "4": 3, "5": 3, "6": 2 }
    };

    const currentMonthStr = getLocalTodayStr().substring(0, 7);
    const allDayOffs = globalState.riderDayOffs || {};
    const existing = allDayOffs[myId] || allDayOffs[storageKey] || allDayOffs[myName.toLowerCase().trim()] || {};

    if (existing && existing.dayOfWeek !== undefined && existing.dayOfWeek !== null && parseInt(existing.dayOfWeek) === parseInt(dayIndex)) {
        return showToast("⚠️ Ito na ang iyong kasalukuyang Day-Off.");
    }

    let changesMade = 0;
    if (existing && existing.lastChangedMonth === currentMonthStr) {
        changesMade = existing.changesThisMonth || 0;
    }

    const maxChanges = (config.maxChangesPerMonth !== undefined && config.maxChangesPerMonth !== null) 
        ? parseInt(config.maxChangesPerMonth) 
        : 2;

    if (config.enabled && changesMade >= maxChanges) {
        return showToast(`⚠️ Naabot mo na ang limit na ${maxChanges} day-off change(s) para sa buwang ito.`);
    }

    if (config.enabled) {
        const targetQuota = (config.quotas && config.quotas[dayIndex] !== undefined) ? parseInt(config.quotas[dayIndex]) : 3;
        let taken = 0;
        const counted = new Set();
        Object.entries(allDayOffs).forEach(([k, r]) => {
            if (!r || r.dayOfWeek === undefined || r.dayOfWeek === null) return;
            const rKey = r.riderId || r.riderName || k;
            if (rKey !== storageKey && rKey !== myId && !counted.has(rKey)) {
                counted.add(rKey);
                if (parseInt(r.dayOfWeek) === parseInt(dayIndex)) taken++;
            }
        });

        if (taken >= targetQuota) {
            return showToast(`⚠️ Puno na ang slots (${taken}/${targetQuota}) para sa ${DAYS_NAMES[dayIndex]}.`);
        }
    }

    const payload = sanitizeForFirebase({
        riderId: myId || storageKey,
        riderName: myName,
        dayOfWeek: parseInt(dayIndex),
        changesThisMonth: changesMade + 1,
        lastChangedMonth: currentMonthStr,
        assignedBy: "Rider",
        updatedAt: Date.now()
    });

    if (!globalState.riderDayOffs) globalState.riderDayOffs = {};
    globalState.riderDayOffs[storageKey] = payload;
    if (myId) globalState.riderDayOffs[myId] = payload;
    if (myName) globalState.riderDayOffs[myName.toLowerCase().trim()] = payload;

    try {
        if (db) {
            await db.ref(`riderDayoffs/${storageKey}`).set(payload);
            if (myId && myId !== storageKey) {
                await db.ref(`riderDayoffs/${myId}`).set(payload).catch(() => {});
            }
            if (myName && myName.toLowerCase().trim() !== storageKey) {
                await db.ref(`riderDayoffs/${myName.toLowerCase().trim()}`).set(payload).catch(() => {});
            }
        }

        renderRiderDayOffPicker();
        updateRosterUI();
        showToast(`🏖️ Na-set ang Day-Off mo tuwing ${DAYS_NAMES[dayIndex]}!`);
        showSideNotification("DAY-OFF SET", `Your weekly day-off is now set to Every ${DAYS_NAMES[dayIndex]}`, "fa-umbrella-beach", "text-teal-400", "border-teal-500");
    } catch(e) {
        console.error("Save rider day-off error:", e);
        showToast(`❌ Failed to save day-off: ${e.message || "Database permission denied"}`);
    }
}

// ============================================================================
// 2. ADMIN DAY-OFF SETTINGS & QUOTA CONTROLS (FOR ADMINS)
// ============================================================================
export function openAdminDayOffSettingsModal() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const modal = document.getElementById('admin-dayoff-settings-modal');
    const masterToggle = document.getElementById('admin-dayoff-master-enabled');
    const maxChangesInput = document.getElementById('admin-dayoff-max-changes');

    const config = globalState.dayOffSettings || {
        enabled: true,
        maxChangesPerMonth: 2,
        quotas: { "0": 2, "1": 3, "2": 3, "3": 3, "4": 3, "5": 3, "6": 2 }
    };

    if (masterToggle) masterToggle.checked = !!config.enabled;
    if (maxChangesInput) maxChangesInput.value = (config.maxChangesPerMonth !== undefined && config.maxChangesPerMonth !== null) ? config.maxChangesPerMonth : 2;

    for (let d = 0; d <= 6; d++) {
        const qInput = document.getElementById(`admin-quota-day-${d}`);
        if (qInput) {
            qInput.value = (config.quotas && config.quotas[d] !== undefined) ? config.quotas[d] : (d === 0 || d === 6 ? 2 : 3);
        }
    }

    renderAdminDayOffSettingsList();

    if (modal) modal.classList.remove('hidden');
}

export function closeAdminDayOffSettingsModal() {
    const modal = document.getElementById('admin-dayoff-settings-modal');
    if (modal) modal.classList.add('hidden');
}

export function renderAdminDayOffSettingsList() {
    const container = document.getElementById('admin-dayoff-riders-list');
    if (!container) return;

    const roster = globalState.rosterMembers || [];
    const allDayOffs = globalState.riderDayOffs || {};

    if (roster.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-6 text-xs">No registered riders found.</div>`;
        return;
    }

    container.innerHTML = roster.map(r => {
        const rId = (r.telegramId || r.id || "").toString().trim();
        const rName = r.riderName || r.name || "Rider";
        const storageKey = getRiderStorageKey(rId, rName);

        const rec = allDayOffs[rId] || allDayOffs[storageKey] || allDayOffs[rName.toLowerCase().trim()] || {};
        const selectedDay = rec.dayOfWeek !== undefined && rec.dayOfWeek !== null ? parseInt(rec.dayOfWeek) : -1;

        const optionsHtml = `
            <option value="-1" ${selectedDay === -1 ? 'selected' : ''}>-- No Day-Off --</option>
            ${DAYS_NAMES.map((name, idx) => `<option value="${idx}" ${selectedDay === idx ? 'selected' : ''}>Every ${name}</option>`).join('')}
        `;

        return `
        <div class="bg-cardBg border border-gray-200 dark:border-gray-800 p-2.5 rounded-2xl flex items-center justify-between gap-2 shadow-xs">
            <div class="flex items-center gap-1.5 min-w-0">
                <span class="font-bold text-xs text-gray-900 dark:text-white truncate">
                    <i class="fa-solid fa-motorcycle text-teal-400 mr-1"></i>${escapeHtml(rName)}
                </span>
                <span class="text-[9px] text-gray-400 font-mono">(${escapeHtml(rId || storageKey)})</span>
            </div>

            <select onchange="window.adminReassignRiderDayOff && window.adminReassignRiderDayOff('${escapeHtml(storageKey)}', '${escapeHtml(rName)}', this.value)" class="bg-inputBg text-xs font-bold text-teal-300 rounded-xl p-1.5 px-2 border border-gray-300 dark:border-gray-700 outline-none max-w-[150px]">
                ${optionsHtml}
            </select>
        </div>`;
    }).join('');
}

export async function adminReassignRiderDayOff(riderKey, riderName, newDayIndex) {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const storageKey = getRiderStorageKey(riderKey, riderName);
    const dayVal = parseInt(newDayIndex);

    if (!globalState.riderDayOffs) globalState.riderDayOffs = {};

    if (dayVal === -1) {
        delete globalState.riderDayOffs[storageKey];
        if (riderName) delete globalState.riderDayOffs[riderName.toLowerCase().trim()];

        try {
            if (db) {
                await db.ref(`riderDayoffs/${storageKey}`).remove();
                if (riderName && riderName.toLowerCase().trim() !== storageKey) {
                    await db.ref(`riderDayoffs/${riderName.toLowerCase().trim()}`).remove().catch(() => {});
                }
            }
            showToast(`🗑️ Removed day-off for ${riderName}.`);
        } catch(e) {}
    } else {
        const payload = sanitizeForFirebase({
            riderId: storageKey,
            riderName: riderName,
            dayOfWeek: dayVal,
            changesThisMonth: 0,
            lastChangedMonth: getLocalTodayStr().substring(0, 7),
            assignedBy: "Admin",
            updatedAt: Date.now()
        });

        globalState.riderDayOffs[storageKey] = payload;
        if (riderName) globalState.riderDayOffs[riderName.toLowerCase().trim()] = payload;

        try {
            if (db) {
                await db.ref(`riderDayoffs/${storageKey}`).set(payload);
                if (riderName && riderName.toLowerCase().trim() !== storageKey) {
                    await db.ref(`riderDayoffs/${riderName.toLowerCase().trim()}`).set(payload).catch(() => {});
                }
            }
            showToast(`✅ Admin moved ${riderName}'s day-off to Every ${DAYS_NAMES[dayVal]}!`);
            showSideNotification("DAY-OFF REASSIGNED", `Moved ${riderName} to Every ${DAYS_NAMES[dayVal]}`, "fa-sliders", "text-teal-400", "border-teal-500");
        } catch(e) {
            showToast("❌ Failed to reassign day-off.");
        }
    }

    renderAdminDayOffSettingsList();
    updateRosterUI();
}

export async function saveAdminDayOffSettings() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const masterToggle = document.getElementById('admin-dayoff-master-enabled');
    const maxChangesInput = document.getElementById('admin-dayoff-max-changes');

    const enabled = masterToggle ? masterToggle.checked : true;
    const maxChangesPerMonth = maxChangesInput && maxChangesInput.value !== "" ? parseInt(maxChangesInput.value) : 2;

    const quotas = {};
    for (let d = 0; d <= 6; d++) {
        const qInput = document.getElementById(`admin-quota-day-${d}`);
        quotas[d] = qInput && qInput.value !== "" ? parseInt(qInput.value) : 2;
    }

    const payload = sanitizeForFirebase({
        enabled: Boolean(enabled),
        maxChangesPerMonth: Math.max(0, maxChangesPerMonth),
        quotas: quotas,
        updatedBy: appState.riderName || "Admin",
        updatedAt: Date.now()
    });

    globalState.dayOffSettings = payload;
    try {
        localStorage.setItem('lokalex_dayoff_settings_cache', JSON.stringify(payload));
    } catch(e) {}

    try {
        if (db) {
            await db.ref('settings/dayoffs').set(payload);
        }

        closeAdminDayOffSettingsModal();
        showToast(`⚙️ Day-Off Quota settings saved (${enabled ? 'Active' : 'Disabled'})!`);
        showSideNotification("DAY-OFF RULES SAVED", `Max Changes: ${maxChangesPerMonth}/mo • Rules: ${enabled ? 'ENABLED' : 'DISABLED'}`, "fa-umbrella-beach", "text-teal-400", "border-teal-500");
    } catch(e) {
        console.error("Save day-off settings error:", e);
        showToast(`❌ Failed to save: ${e.message || "Database Error"}`);
    }
}

export function listenToDayOffData() {
    if (!db) return;

    try {
        const cachedSettings = localStorage.getItem('lokalex_dayoff_settings_cache');
        if (cachedSettings) globalState.dayOffSettings = JSON.parse(cachedSettings);
    } catch(e) {}

    db.ref('settings/dayoffs').on('value', (snap) => {
        const data = snap.val();
        if (data) {
            globalState.dayOffSettings = data;
            try {
                localStorage.setItem('lokalex_dayoff_settings_cache', JSON.stringify(data));
            } catch(e) {}
        }
    });

    db.ref('riderDayoffs').on('value', (snap) => {
        globalState.riderDayOffs = snap.val() || {};
        updateRosterUI();
    });
}

// ============================================================================
// 3. ADMIN MAXIMUM ACTIVE BOOKINGS LIMIT CONTROLS (AUTO + MANUAL)
// ============================================================================
export function openAdminBookingLimitsModal() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const modal = document.getElementById('admin-booking-limits-modal');
    const autoToggle = document.getElementById('admin-booking-limits-auto-toggle');
    const input = document.getElementById('admin-max-active-bookings');

    const config = globalState.bookingLimits || { autoEnabled: false, maxActiveBookings: 2 };
    
    if (autoToggle) {
        autoToggle.checked = Boolean(config.autoEnabled);
    }
    if (input) {
        input.value = (config.maxActiveBookings !== undefined && config.maxActiveBookings !== null) 
            ? config.maxActiveBookings 
            : 2;
    }

    toggleBookingLimitsModeUI(Boolean(config.autoEnabled));

    if (modal) modal.classList.remove('hidden');
}

export function closeAdminBookingLimitsModal() {
    const modal = document.getElementById('admin-booking-limits-modal');
    if (modal) modal.classList.add('hidden');
}

export function toggleBookingLimitsModeUI(isAuto) {
    const manualSection = document.getElementById('admin-booking-limits-manual-section');
    const autoSection = document.getElementById('admin-booking-limits-auto-section');
    if (manualSection && autoSection) {
        if (isAuto) {
            manualSection.classList.add('opacity-40', 'pointer-events-none');
            autoSection.classList.remove('opacity-40');
        } else {
            manualSection.classList.remove('opacity-40', 'pointer-events-none');
            autoSection.classList.add('opacity-40');
        }
    }
}

export async function saveAdminBookingLimitsSettings() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const autoToggle = document.getElementById('admin-booking-limits-auto-toggle');
    const input = document.getElementById('admin-max-active-bookings');

    const isAuto = autoToggle ? autoToggle.checked : false;
    const val = input ? parseInt(input.value) || 2 : 2;
    const maxVal = Math.max(1, val);

    const payload = sanitizeForFirebase({
        autoEnabled: Boolean(isAuto),
        maxActiveBookings: maxVal,
        updatedBy: appState.riderName || "Admin",
        updatedAt: Date.now()
    });

    globalState.bookingLimits = payload;
    try {
        localStorage.setItem('lokalex_booking_limits_cache', JSON.stringify(payload));
    } catch(e) {}

    try {
        if (db) {
            await db.ref('settings/bookingLimits').set(payload);
        }

        closeAdminBookingLimitsModal();
        if (isAuto) {
            showToast("⚙️ Auto Dynamic Booking Limits ENABLED (Activates when 3+ active riders are on duty)!");
            showSideNotification("AUTO LIMITS ACTIVE", "Scaled by gross income rank when 3+ riders are on duty", "fa-layer-group", "text-rose-400", "border-rose-500");
        } else {
            showToast(`⚙️ Fixed max active bookings per rider set to ${maxVal}!`);
            showSideNotification("BOOKING LIMIT SAVED", `Riders max simultaneous orders: ${maxVal}`, "fa-layer-group", "text-rose-400", "border-rose-500");
        }
    } catch(e) {
        console.error("Save booking limits error:", e);
        showToast("❌ Failed to save booking limits.");
    }
}

export function listenToBookingLimits() {
    if (!db) return;

    try {
        const cached = localStorage.getItem('lokalex_booking_limits_cache');
        if (cached) globalState.bookingLimits = JSON.parse(cached);
    } catch(e) {}

    db.ref('settings/bookingLimits').on('value', (snap) => {
        const data = snap.val();
        if (data) {
            globalState.bookingLimits = data;
            try {
                localStorage.setItem('lokalex_booking_limits_cache', JSON.stringify(data));
            } catch(e) {}
        }
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
    window.saveAdminDayOffSettings = saveAdminDayOffSettings;
    window.adminReassignRiderDayOff = adminReassignRiderDayOff;
    window.renderRiderDayOffPicker = renderRiderDayOffPicker;
    window.renderAdminDayOffSettingsList = renderAdminDayOffSettingsList;

    window.openAdminBookingLimitsModal = openAdminBookingLimitsModal;
    window.closeAdminBookingLimitsModal = closeAdminBookingLimitsModal;
    window.toggleBookingLimitsModeUI = toggleBookingLimitsModeUI;
    window.saveAdminBookingLimitsSettings = saveAdminBookingLimitsSettings;

    listenToTimeInSchedule();
    listenToDayOffData();
    listenToBookingLimits();
}