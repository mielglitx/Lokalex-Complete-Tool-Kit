// src/features/roster/rosterDayOff.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { getLocalTodayStr, escapeHtml } from '../../utils/helpers.js';
import { isAdmin } from './rosterUtils.js';
import { updateRosterUI } from './rosterUI.js';
import { getRiderStorageKey, sanitizeForFirebase } from './rosterSchedule.js';

const DAYS_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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