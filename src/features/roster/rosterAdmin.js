// src/features/roster/rosterUI.js
import { appState, globalState } from '../../store/state.js';
import { escapeHtml, isSameDate, getLocalTodayStr } from '../../utils/helpers.js';
import { 
    loadRosterCache, 
    canManageRoster, 
    parseQueueTime, 
    getElapsedCateringTime, 
    checkFirstInLineAlarm,
    calculateSplitDuration,
    isAdmin 
} from './rosterUtils.js';
import { autoStartLiveGpsSession, endLiveGpsSession } from '../liveTracker.js';
import { openMapPicker } from '../maps.js';

// FIND RIDERS MAP WIDGET LAUNCHER
export function openFindRidersMap() {
    openMapPicker('roster');
}

export function updateRosterUI() {
    if (!globalState.rosterMembers || globalState.rosterMembers.length === 0) {
        loadRosterCache();
    }

    const rosterMembers = globalState.rosterMembers || [];
    const myId = (appState.telegramId || "").toString();

    const adminToggle = document.getElementById('admin-controls-toggle');
    if (adminToggle) {
        globalState.adminControlsEnabled = adminToggle.checked;
    }

    const showControls = globalState.adminControlsEnabled && canManageRoster();

    const forceAllBtn = document.getElementById('admin-force-all-btn');
    if (forceAllBtn) {
        if (showControls) forceAllBtn.classList.remove('hidden');
        else forceAllBtn.classList.add('hidden');
    }

    const myRecord = rosterMembers.find(m => (m.telegramId || "").toString() === myId);
    if (myRecord) {
        if (myRecord.status === 'Catering') {
            try { autoStartLiveGpsSession(myRecord.customerName || "Customer"); } catch(e) {}
        } else {
            if (localStorage.getItem('lokalex_active_live_session')) {
                endLiveGpsSession();
            }
        }
    }

    const adminToggleWrapper = document.getElementById('admin-toggle-wrapper');
    if (adminToggleWrapper) {
        if (canManageRoster()) adminToggleWrapper.classList.remove('hidden');
        else adminToggleWrapper.classList.add('hidden');
    }

    const findRidersBtn = document.getElementById('admin-find-riders-btn');
    if (findRidersBtn) {
        if (canManageRoster()) findRidersBtn.classList.remove('hidden');
        else findRidersBtn.classList.add('hidden');
    }

    const isEnded = myRecord && myRecord.status === 'End';
    const isOnBreak = myRecord && myRecord.status === 'Break';

    const btnCater = document.getElementById('btn-status-cater');
    const btnBreak = document.getElementById('btn-status-break');

    if (btnCater) {
        btnCater.disabled = isEnded || isOnBreak;
        btnCater.style.opacity = (isEnded || isOnBreak) ? '0.3' : '1';
    }
    if (btnBreak) {
        btnBreak.disabled = isEnded;
        btnBreak.style.opacity = isEnded ? '0.3' : '1';
    }

    const availableRiders = rosterMembers
        .filter(m => m.status === 'Available')
        .sort((a, b) => parseQueueTime(a.queueTime) - parseQueueTime(b.queueTime));

    checkFirstInLineAlarm(availableRiders);

    const cateringRiders = rosterMembers.filter(m => m.status === 'Catering');
    const breakRiders = rosterMembers.filter(m => m.status === 'Break');
    const cooldownRiders = rosterMembers.filter(m => m.status === 'Cooldown');

    let availHtml = [], busyHtml = [], brkHtml = [], cdHtml = [];
    let availCounter = 1;

    availableRiders.forEach((m) => {
        const mId = (m.telegramId || "").toString();
        const mName = m.riderName || m.name || "Rider";
        let nameStr = escapeHtml(mName);

        if (showControls) {
            // VOID ORDER IS EXCLUDED FROM AVAILABLE QUEUE DROPDOWN
            nameStr += ` <select onchange="window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-black text-[10px] text-yellow-400 rounded px-1 ml-1 cursor-pointer"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option></select>`;

            nameStr += `
            <div class="inline-flex gap-1 ml-2 text-[10px] align-middle">
                <button onclick="window.adminShiftRiderQueue && window.adminShiftRiderQueue('${mId}', 'move_top')" class="bg-blue-600/30 hover:bg-blue-600 text-blue-300 px-1 py-0.5 rounded font-bold" title="Move Top">⬆️</button>
                <button onclick="window.adminShiftRiderQueue && window.adminShiftRiderQueue('${mId}', 'move_up')" class="bg-blue-600/30 hover:bg-blue-600 text-blue-300 px-1 py-0.5 rounded font-bold" title="Move Up (+1)">▲</button>
                <button onclick="window.adminShiftRiderQueue && window.adminShiftRiderQueue('${mId}', 'move_down')" class="bg-blue-600/30 hover:bg-blue-600 text-blue-300 px-1 py-0.5 rounded font-bold" title="Move Down (-1)">▼</button>
                <button onclick="window.adminShiftRiderQueue && window.adminShiftRiderQueue('${mId}', 'move_bottom')" class="bg-blue-600/30 hover:bg-blue-600 text-blue-300 px-1 py-0.5 rounded font-bold" title="Move Bottom">⬇️</button>
            </div>`;
        }

        availHtml.push(`<div class="flex items-center justify-between py-1"><span class="font-bold text-green-400 mr-2">${availCounter++}.</span><span class="flex-1">${nameStr}</span></div>`);
    });

    cateringRiders.forEach(m => {
        const mId = (m.telegramId || "").toString();
        const mName = m.riderName || m.name || "Rider";
        let cardHtml = `<div class="flex flex-col py-1.5 border-b border-gray-800/60 last:border-0 gap-1"><div class="flex items-center justify-between"><span class="font-bold text-white">${escapeHtml(mName)}</span>`;

        if (showControls) {
            cardHtml += ` <select onchange="window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-black text-[10px] text-yellow-400 rounded px-1 ml-1 cursor-pointer shrink-0"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option><option value="VoidActive">🚫 Void All Orders</option></select>`;
        }
        cardHtml += `</div>`;

        if (m.customerName) {
            const custs = m.customerName.split(', ').map(c => c.trim()).filter(Boolean);
            const times = m.startTime ? m.startTime.split(', ').map(t => t.trim()) : [];

            cardHtml += `<div class="flex flex-col gap-1 pl-2 text-[11px]">`;
            custs.forEach((cName, idx) => {
                const cTime = times[idx] || times[0] || '';
                const timeDetails = getElapsedCateringTime(cTime);
                const isMyLine = mId === myId || (appState.riderName && mName.toLowerCase() === appState.riderName.toLowerCase());

                const canSwap = isMyLine || showControls;

                cardHtml += `
                <div class="flex flex-wrap items-center justify-between gap-1 bg-black/30 p-1.5 rounded-lg border border-gray-800">
                    <span class="text-orange-300 font-medium">👤 ${escapeHtml(cName)} <span class="text-gray-400 text-[10px]">${timeDetails}</span></span>
                    
                    <div class="flex items-center gap-1">
                        ${isMyLine ? `
                            <button onclick="window.copyCustomerTrackingLink && window.copyCustomerTrackingLink('${escapeHtml(cName)}')" class="bg-blue-600/30 hover:bg-blue-600 text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-bold" title="Send Track Link">🔗 Link</button>
                            <button onclick="window.openLiveCustomerMap && window.openLiveCustomerMap('${escapeHtml(cName)}')" class="bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 px-1.5 py-0.5 rounded text-[10px] font-bold" title="Open Live Map">🗺️ Map</button>
                        ` : ''}

                        ${canSwap ? `
                            <button onclick="window.openSwapCustomerModal && window.openSwapCustomerModal('${mId}', '${escapeHtml(mName)}', '${escapeHtml(cName)}')" class="bg-purple-600/30 hover:bg-purple-600 text-purple-300 px-1.5 py-0.5 rounded text-[10px] font-bold transition active:scale-95" title="Swap customer with another rider">
                                🔀 Swap
                            </button>
                        ` : ''}

                        ${!isMyLine ? `
                            <button onclick="window.claimCustomerFromRider && window.claimCustomerFromRider('${mId}', '${escapeHtml(mName)}', '${escapeHtml(cName)}')" class="bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded text-[10px] font-bold transition active:scale-95" title="Get this customer for yourself">
                                📥 Get
                            </button>
                        ` : ''}

                        ${showControls ? `
                            <button onclick="window.adminVoidSpecificCustomer && window.adminVoidSpecificCustomer('${mId}', '${escapeHtml(mName)}', '${escapeHtml(cName)}')" class="bg-red-900/40 hover:bg-red-800 text-red-300 border border-red-700/50 px-1.5 py-0.5 rounded text-[10px] font-bold transition active:scale-95" title="Void specific customer">
                                🚫 Void
                            </button>
                        ` : ''}
                    </div>
                </div>`;
            });
            cardHtml += `</div>`;
        }

        cardHtml += `</div>`;
        busyHtml.push(cardHtml);
    });

    breakRiders.forEach(m => {
        const mId = (m.telegramId || "").toString();
        const mName = m.riderName || m.name || "Rider";
        let nameStr = escapeHtml(mName);

        if (showControls) {
            nameStr += ` <select onchange="window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-black text-[10px] text-yellow-400 rounded px-1 ml-1 cursor-pointer"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option><option value="VoidActive">🚫 Void Order</option></select>`;
        }
        brkHtml.push(`<div class="flex items-center justify-between py-1">${nameStr}</div>`);
    });

    cooldownRiders.forEach(m => {
        const mId = (m.telegramId || "").toString();
        const mName = m.riderName || m.name || "Rider";
        let nameStr = escapeHtml(mName);

        let remSecs = m.cooldownUntil ? Math.max(0, Math.ceil((m.cooldownUntil - Date.now()) / 1000)) : 0;
        let mins = String(Math.floor(remSecs / 60)).padStart(2, '0');
        let secs = String(remSecs % 60).padStart(2, '0');

        nameStr += ` <span class="text-yellow-400 font-mono text-[10px]">(${mins}:${secs} remaining)</span>`;

        if (showControls) {
            nameStr += ` <select onchange="window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-black text-[10px] text-yellow-400 rounded px-1 ml-1 cursor-pointer"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option></select>`;
        }
        cdHtml.push(`<div class="flex items-center justify-between py-1">${nameStr}</div>`);
    });

    const elAvail = document.getElementById('home-roster-avail');
    const elBusy = document.getElementById('home-roster-busy');
    const elBreak = document.getElementById('home-roster-break');
    const elCooldown = document.getElementById('home-roster-cooldown');

    if (elAvail) elAvail.innerHTML = availHtml.length ? availHtml.join('') : '(Walang naka-duty)';
    if (elBusy) elBusy.innerHTML = busyHtml.length ? busyHtml.join('') : '(Walang bumibiyahe)';
    if (elBreak) elBreak.innerHTML = brkHtml.length ? brkHtml.join('') : '(Walang naka-break)';
    if (elCooldown) elCooldown.innerHTML = cdHtml.length ? cdHtml.join('') : '(Walang naka-cooldown)';
}

export function loadGlobalCateredList() {
    const feed = document.getElementById('catered-customers-feed');
    const badge = document.getElementById('catered-count-badge');
    if (!feed) return;

    const todayStr = getLocalTodayStr();
    const todayHistory = globalState.globalCateredHistory ? globalState.globalCateredHistory.filter(h => isSameDate(h.completedDate, todayStr)) : [];

    if (badge) badge.innerText = `${todayHistory.length} recorded`;

    if (todayHistory.length === 0) {
        feed.innerHTML = `<div class="text-gray-500 italic text-center py-4">No completed catered customers yet today.</div>`;
        return;
    }

    feed.innerHTML = todayHistory.slice().reverse().map(h => {
        let voidBtn = "";
        if (isAdmin()) {
            voidBtn = `<button onclick="window.promptVoidCustomer && window.promptVoidCustomer('${escapeHtml(h.riderName)}', '${escapeHtml(h.customerName)}', '${escapeHtml(h.completedDate)}')" class="bg-red-900/40 text-red-400 hover:bg-red-800 text-[10px] font-bold px-2 py-1 rounded border border-red-700/50 transition active:scale-95"><i class="fa-solid fa-ban"></i> Void</button>`;
        }

        let durationStr = h.duration || "";
        if (!durationStr && h.startTime && h.completedTime) {
            durationStr = calculateSplitDuration(h.startTime, h.completedTime, h.customerCount || 1);
        }

        let timeInfo = `Started: ${escapeHtml(h.startTime)}`;
        if (h.completedTime) {
            timeInfo += ` → ${escapeHtml(h.completedTime)}`;
        }
        if (durationStr) {
            timeInfo += ` <span class="text-emerald-400 font-bold">[${escapeHtml(durationStr)}]</span>`;
        }

        return `
        <div class="bg-gray-800/40 border border-gray-700/60 p-2.5 rounded-lg flex justify-between items-center">
            <div>
                <div class="font-bold text-orange-400"><i class="fa-solid fa-user"></i> ${escapeHtml(h.customerName)}</div>
                <div class="text-[10px] text-gray-400">Rider: <span class="text-blue-400">${escapeHtml(h.riderName)}</span></div>
            </div>
            <div class="flex items-center gap-3">
                <div class="text-[10px] text-gray-400 font-mono text-right">
                    ${timeInfo}
                </div>
                ${voidBtn}
            </div>
        </div>`;
    }).join('');
}

export function loadGlobalLoginList() {
    const feed = document.getElementById('login-list-feed');
    const badge = document.getElementById('login-count-badge');
    if (!feed) return;

    const todayStr = getLocalTodayStr();
    const todayLogins = globalState.globalLogins ? globalState.globalLogins.filter(l => isSameDate(l.date, todayStr)) : [];

    if (badge) badge.innerText = `${todayLogins.length} logins`;

    if (todayLogins.length === 0) {
        feed.innerHTML = `<div class="text-gray-500 italic text-center py-2">No logins recorded yet today.</div>`;
        return;
    }

    feed.innerHTML = todayLogins.slice().reverse().map(l => {
        let mapBtn = "";
        if (l.location) {
            mapBtn = `<a href="${escapeHtml(l.location)}" target="_blank" class="text-[10px] text-emerald-400 font-bold underline flex items-center gap-1 mt-0.5 active:opacity-60"><i class="fa-solid fa-location-dot text-red-500"></i> View Pin Location</a>`;
        }
        const clockOutTxt = l.clockOutTime ? `<span class="text-red-400 ml-1">(Out: ${escapeHtml(l.clockOutTime)})</span>` : '';
        return `
        <div class="bg-gray-800/30 border border-gray-700/40 p-2 rounded-lg flex justify-between items-center">
            <div class="flex flex-col">
                <span class="font-bold text-blue-400"><i class="fa-solid fa-motorcycle"></i> ${escapeHtml(l.riderName)}</span>
                ${mapBtn}
            </div>
            <div class="text-[10px] text-gray-400 font-mono text-right">
                <span>In: ${escapeHtml(l.loginTime)}</span>
                ${clockOutTxt}
            </div>
        </div>`;
    }).join('');
}

if (typeof window !== 'undefined') {
    window.openFindRidersMap = openFindRidersMap;
    window.updateRosterUI = updateRosterUI;
    window.loadGlobalCateredList = loadGlobalCateredList;
    window.loadGlobalLoginList = loadGlobalLoginList;

    window.addEventListener('rosterUpdated', updateRosterUI);
    window.addEventListener('cateredUpdated', loadGlobalCateredList);
    window.addEventListener('loginsUpdated', loadGlobalLoginList);
}