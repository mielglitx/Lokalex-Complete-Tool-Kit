// src/features/roster/rosterSchedule.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { getLocalTodayStr, isSameDate, escapeHtml } from '../../utils/helpers.js';
import { isAdmin, saveRosterCache } from './rosterUtils.js';

export function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

export function getRiderStorageKey(riderId, riderName) {
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

export async function openAdminTimeInScheduleModal() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const modal = document.getElementById('admin-timein-schedule-modal');
    const masterToggle = document.getElementById('admin-schedule-master-enabled') || 
                         document.getElementById('admin-timein-schedule-master-enabled') ||
                         document.getElementById('admin-timein-schedule-gate-toggle') ||
                         document.getElementById('admin-timein-schedule-enabled');
    const defaultTimeInput = document.getElementById('admin-schedule-default-time') ||
                             document.getElementById('admin-timein-schedule-default-time');

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

    let config = globalState.timeInSchedule;
    if (!config || typeof config !== 'object') {
        try {
            const cached = localStorage.getItem('lokalex_timein_schedule_cache');
            if (cached) config = JSON.parse(cached);
        } catch(e) {}
    }
    config = config || {};

    if (masterToggle) masterToggle.checked = config.enabled !== false;
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

    const masterToggle = document.getElementById('admin-schedule-master-enabled') || 
                         document.getElementById('admin-timein-schedule-master-enabled') ||
                         document.getElementById('admin-timein-schedule-gate-toggle') ||
                         document.getElementById('admin-timein-schedule-enabled');
    const defaultTimeInput = document.getElementById('admin-schedule-default-time') ||
                             document.getElementById('admin-timein-schedule-default-time');

    const enabled = masterToggle ? masterToggle.checked : true;
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