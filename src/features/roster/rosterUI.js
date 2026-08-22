// src/features/roster/rosterUI.js
import { appState, globalState } from '../../store/state.js';
import { escapeHtml, isSameDate, getLocalTodayStr } from '../../utils/helpers.js';
import { 
    loadRosterCache, 
    canManageRoster, 
    isAdmin,
    parseQueueTime, 
    getElapsedCateringTime, 
    checkFirstInLineAlarm,
    calculateSplitDuration,
    getRiderTodayGross,
    sortAvailableRidersByGross
} from './rosterUtils.js';
import { autoStartLiveGpsSession, endLiveGpsSession } from '../liveTracker.js';
import { openMapPicker } from '../maps.js';

export function openFindRidersMap() {
    openMapPicker('roster');
}

export function updateRosterUI() {
    if (!globalState.rosterMembers || globalState.rosterMembers.length === 0) {
        loadRosterCache();
    }

    const rosterMembers = globalState.rosterMembers || [];
    const myId = (appState.telegramId || "").toString();
    const canManage = canManageRoster();

    if (!canManage) {
        globalState.adminControlsEnabled = false;
        const adminToggle = document.getElementById('admin-controls-toggle');
        if (adminToggle) adminToggle.checked = false;
    } else {
        const adminToggle = document.getElementById('admin-controls-toggle');
        if (adminToggle) {
            globalState.adminControlsEnabled = adminToggle.checked;
        }
    }

    const showControls = globalState.adminControlsEnabled && canManage;

    const adminToggleWrapper = document.getElementById('admin-toggle-wrapper');
    if (adminToggleWrapper) {
        if (canManage) adminToggleWrapper.classList.remove('hidden');
        else adminToggleWrapper.classList.add('hidden');
    }

    const findRidersBtn = document.getElementById('admin-find-riders-btn');
    if (findRidersBtn) {
        if (canManage) findRidersBtn.classList.remove('hidden');
        else findRidersBtn.classList.add('hidden');
    }

    const storeHubBtn = document.getElementById('admin-store-hub-btn');
    if (storeHubBtn) {
        if (isAdmin()) storeHubBtn.classList.remove('hidden');
        else storeHubBtn.classList.add('hidden');
    }

    const manageRidersBtn = document.getElementById('admin-manage-riders-btn');
    if (manageRidersBtn) {
        if (isAdmin()) manageRidersBtn.classList.remove('hidden');
        else manageRidersBtn.classList.add('hidden');
    }

    const commissionSettingsBtn = document.getElementById('admin-commission-settings-btn');
    if (commissionSettingsBtn) {
        if (isAdmin()) commissionSettingsBtn.classList.remove('hidden');
        else commissionSettingsBtn.classList.add('hidden');
    }

    const autoEndShiftBtn = document.getElementById('admin-auto-endshift-btn');
    if (autoEndShiftBtn) {
        if (isAdmin()) autoEndShiftBtn.classList.remove('hidden');
        else autoEndShiftBtn.classList.add('hidden');
    }

    const blockBtn = document.getElementById('admin-block-btn');
    if (blockBtn) {
        if (isAdmin()) blockBtn.classList.remove('hidden');
        else blockBtn.classList.add('hidden');
    }

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

    // SORT BY LOWEST GROSS INCOME FIRST
    const availableRiders = sortAvailableRidersByGross(rosterMembers.filter(m => m.status === 'Available'));

    checkFirstInLineAlarm(availableRiders);

    const cateringRiders = rosterMembers.filter(m => m.status === 'Catering');
    const breakRiders = rosterMembers.filter(m => m.status === 'Break');
    const cooldownRiders = rosterMembers.filter(m => m.status === 'Cooldown');

    let availHtml = [], busyHtml = [], brkHtml = [], cdHtml = [];
    let availCounter = 1;

    // 1. AVAILABLE QUEUE RIDERS (LOWEST TO HIGHEST GROSS INCOME DISPLAY)
    availableRiders.forEach((m) => {
        const mId = (m.telegramId || "").toString();
        const mName = m.riderName || m.name || "Rider";
        const todayGross = getRiderTodayGross(mName, mId);
        let nameStr = escapeHtml(mName);

        if (showControls) {
            nameStr += ` <select onchange="window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-white dark:bg-black text-[10px] text-gray-900 dark:text-yellow-400 border border-gray-300 dark:border-gray-700 rounded px-1 ml-1 cursor-pointer"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option></select>`;

            nameStr += `
            <div class="inline-flex gap-1 ml-1.5 text-[10px] align-middle">
                <button onclick="window.adminShiftRiderQueue && window.adminShiftRiderQueue('${mId}', 'move_top')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-600/30 dark:hover:bg-blue-600 dark:text-blue-300 dark:border-transparent px-1 py-0.5 rounded font-bold transition active:scale-95" title="Move Top">⬆️</button>
                <button onclick="window.adminShiftRiderQueue && window.adminShiftRiderQueue('${mId}', 'move_up')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-600/30 dark:hover:bg-blue-600 dark:text-blue-300 dark:border-transparent px-1 py-0.5 rounded font-bold transition active:scale-95" title="Move Up (+1)">▲</button>
                <button onclick="window.adminShiftRiderQueue && window.adminShiftRiderQueue('${mId}', 'move_down')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-600/30 dark:hover:bg-blue-600 dark:text-blue-300 dark:border-transparent px-1 py-0.5 rounded font-bold transition active:scale-95" title="Move Down (-1)">▼</button>
                <button onclick="window.adminShiftRiderQueue && window.adminShiftRiderQueue('${mId}', 'move_bottom')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-600/30 dark:hover:bg-blue-600 dark:text-blue-300 dark:border-transparent px-1 py-0.5 rounded font-bold transition active:scale-95" title="Move Bottom">⬇️</button>
            </div>`;
        }

        availHtml.push(`
            <div class="inline-flex items-center bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-700/60 rounded-xl px-2.5 py-1 text-xs shadow-xs transition hover:border-emerald-500 gap-1.5">
                <span class="font-black text-emerald-600 dark:text-green-400">${availCounter++}.</span>
                <span class="font-bold text-gray-900 dark:text-gray-100 flex items-center">${nameStr}</span>
                <span class="text-[10px] font-mono font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30" title="Today's Gross Earnings">₱${todayGross.toFixed(0)}</span>
            </div>
        `);
    });

    // 2. CATERING RIDERS (WITH GROSS INCOME BADGE)
    cateringRiders.forEach(m => {
        const mId = (m.telegramId || "").toString();
        const mName = m.riderName || m.name || "Rider";
        const todayGross = getRiderTodayGross(mName, mId);
        let cardHtml = `
        <div class="flex flex-col py-1.5 border-b border-gray-200 dark:border-gray-800/60 last:border-0 gap-1">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5">
                    <span class="font-black text-xs text-gray-900 dark:text-white">${escapeHtml(mName)}</span>
                    <span class="text-[10px] font-mono font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30" title="Today's Gross Earnings">₱${todayGross.toFixed(0)}</span>
                </div>`;

        if (showControls) {
            cardHtml += ` <select onchange="window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-white dark:bg-black text-[10px] text-gray-900 dark:text-yellow-400 border border-gray-300 dark:border-gray-700 rounded px-1 ml-1 cursor-pointer shrink-0"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option><option value="VoidActive">🚫 Void All Orders</option></select>`;
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
                <div class="flex flex-wrap items-center justify-between gap-1 bg-white dark:bg-cardBg p-2 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xs">
                    <span class="text-gray-900 dark:text-orange-300 font-black">👤 ${escapeHtml(cName)} <span class="text-gray-600 dark:text-gray-400 text-[10px] font-normal font-mono">(${timeDetails})</span></span>
                    
                    <div class="flex items-center gap-1">
                        ${isMyLine ? `
                            <button onclick="window.copyCustomerTrackingLink && window.copyCustomerTrackingLink('${escapeHtml(cName)}')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-600/30 dark:hover:bg-blue-600 dark:text-blue-300 dark:border-transparent px-1.5 py-0.5 rounded text-[10px] font-bold transition active:scale-95" title="Send Track Link">🔗 Link</button>
                            <button onclick="window.openLiveCustomerMap && window.openLiveCustomerMap('${escapeHtml(cName)}')" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-600/30 dark:hover:bg-emerald-600 dark:text-emerald-300 dark:border-transparent px-1.5 py-0.5 rounded text-[10px] font-bold transition active:scale-95" title="Open Live Map">🗺️ Map</button>
                        ` : ''}

                        ${canSwap ? `
                            <button onclick="window.openSwapCustomerModal && window.openSwapCustomerModal('${mId}', '${escapeHtml(mName)}', '${escapeHtml(cName)}')" class="bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 dark:bg-purple-600/30 dark:hover:bg-purple-600 dark:text-purple-300 dark:border-transparent px-1.5 py-0.5 rounded text-[10px] font-bold transition active:scale-95" title="Swap customer with another rider">
                                🔀 Swap
                            </button>
                        ` : ''}

                        ${!isMyLine ? `
                            <button onclick="window.claimCustomerFromRider && window.claimCustomerFromRider('${mId}', '${escapeHtml(mName)}', '${escapeHtml(cName)}')" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-600/30 dark:hover:bg-emerald-600 dark:text-emerald-300 dark:border-emerald-500/40 px-1.5 py-0.5 rounded text-[10px] font-bold transition active:scale-95" title="Request to get this customer">
                                📥 Get
                            </button>
                        ` : ''}

                        ${showControls ? `
                            <button onclick="window.adminVoidSpecificCustomer && window.adminVoidSpecificCustomer('${mId}', '${escapeHtml(mName)}', '${escapeHtml(cName)}')" class="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/40 dark:hover:bg-red-800 dark:text-red-300 dark:border-red-700/50 px-1.5 py-0.5 rounded text-[10px] font-bold transition active:scale-95" title="Void specific customer">
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

    // 3. BREAK RIDERS (WITH GROSS INCOME BADGE)
    breakRiders.forEach(m => {
        const mId = (m.telegramId || "").toString();
        const mName = m.riderName || m.name || "Rider";
        const todayGross = getRiderTodayGross(mName, mId);
        let nameStr = escapeHtml(mName);

        if (showControls) {
            nameStr += ` <select onchange="window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-white dark:bg-black text-[10px] text-gray-900 dark:text-yellow-400 border border-gray-300 dark:border-gray-700 rounded px-1 ml-1 cursor-pointer"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option></select>`;
        }

        brkHtml.push(`
            <div class="flex items-center justify-between py-1 text-xs font-bold text-gray-900 dark:text-gray-200">
                <div class="flex items-center gap-1.5">
                    <span>${nameStr}</span>
                    <span class="text-[10px] font-mono font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30" title="Today's Gross Earnings">₱${todayGross.toFixed(0)}</span>
                </div>
            </div>
        `);
    });

    // 4. COOLDOWN RIDERS (WITH GROSS INCOME BADGE)
    cooldownRiders.forEach(m => {
        const mId = (m.telegramId || "").toString();
        const mName = m.riderName || m.name || "Rider";
        const todayGross = getRiderTodayGross(mName, mId);
        let nameStr = escapeHtml(mName);

        let remSecs = m.cooldownUntil ? Math.max(0, Math.ceil((m.cooldownUntil - Date.now()) / 1000)) : 0;
        let mins = String(Math.floor(remSecs / 60)).padStart(2, '0');
        let secs = String(remSecs % 60).padStart(2, '0');

        nameStr += ` <span class="text-amber-700 dark:text-yellow-400 font-mono text-[10px] font-bold">(${mins}:${secs} remaining)</span>`;

        if (showControls) {
            nameStr += ` <select onchange="window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-white dark:bg-black text-[10px] text-gray-900 dark:text-yellow-400 border border-gray-300 dark:border-gray-700 rounded px-1 ml-1 cursor-pointer"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option></select>`;
        }

        cdHtml.push(`
            <div class="flex items-center justify-between py-1 text-xs font-bold text-gray-900 dark:text-gray-200">
                <div class="flex items-center gap-1.5">
                    <span>${nameStr}</span>
                    <span class="text-[10px] font-mono font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30" title="Today's Gross Earnings">₱${todayGross.toFixed(0)}</span>
                </div>
            </div>
        `);
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
        feed.innerHTML = `<div class="text-gray-500 dark:text-gray-400 italic text-center py-4 text-xs">No completed catered customers yet today.</div>`;
        return;
    }

    feed.innerHTML = todayHistory.slice().reverse().map(h => {
        let voidBtn = "";
        if (isAdmin()) {
            voidBtn = `<button onclick="window.promptVoidCustomer && window.promptVoidCustomer('${escapeHtml(h.riderName)}', '${escapeHtml(h.customerName)}', '${escapeHtml(h.completedDate)}')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 dark:bg-red-900/40 dark:hover:bg-red-800 dark:text-red-400 dark:border-red-700/50 text-[10px] font-bold px-2 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 shrink-0"><i class="fa-solid fa-ban"></i> Void</button>`;
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
            timeInfo += ` <span class="text-emerald-600 dark:text-emerald-400 font-bold">[${escapeHtml(durationStr)}]</span>`;
        }

        return `
        <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 p-2.5 rounded-xl flex justify-between items-center gap-2 shadow-xs">
            <div class="min-w-0 flex-1">
                <div class="font-black text-xs text-gray-900 dark:text-white truncate flex items-center gap-1.5"><i class="fa-solid fa-user text-orange-600 dark:text-orange-400 text-[10px]"></i> <span>${escapeHtml(h.customerName)}</span></div>
                <div class="text-[10px] text-gray-600 dark:text-gray-400 mt-0.5 font-medium">Rider: <span class="text-blue-600 dark:text-blue-400 font-bold">${escapeHtml(h.riderName)}</span></div>
            </div>
            <div class="flex items-center gap-2.5 shrink-0">
                <div class="text-[10px] text-gray-800 dark:text-gray-200 font-mono text-right font-medium">
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
        feed.innerHTML = `<div class="text-gray-500 dark:text-gray-400 italic text-center py-2 text-xs">No logins recorded yet today.</div>`;
        return;
    }

    feed.innerHTML = todayLogins.slice().reverse().map(l => {
        let mapBtn = "";
        if (l.location) {
            mapBtn = `<a href="${escapeHtml(l.location)}" target="_blank" class="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold underline flex items-center gap-1 mt-0.5 active:opacity-60"><i class="fa-solid fa-location-dot text-red-500 text-[9px]"></i> View Pin Location</a>`;
        }
        const clockOutTxt = l.clockOutTime ? `<span class="text-red-600 dark:text-red-400 font-bold ml-1">(Out: ${escapeHtml(l.clockOutTime)})</span>` : '';
        return `
        <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 p-2.5 rounded-xl flex justify-between items-center gap-2 shadow-xs">
            <div class="flex flex-col min-w-0 flex-1">
                <span class="font-black text-xs text-gray-900 dark:text-white truncate flex items-center gap-1.5"><i class="fa-solid fa-motorcycle text-blue-600 dark:text-blue-400 text-[10px]"></i> <span>${escapeHtml(l.riderName)}</span></span>
                ${mapBtn}
            </div>
            <div class="text-[10px] text-gray-800 dark:text-gray-200 font-mono text-right shrink-0 font-medium">
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