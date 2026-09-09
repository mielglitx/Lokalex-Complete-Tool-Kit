// src/features/roster/ui/rosterLineupView.js
import { appState, globalState } from '../../../store/state.js';
import { escapeHtml, formatTitleCase } from '../../../utils/helpers.js';
import { 
    loadRosterCache, 
    canManageRoster, 
    isAdmin, 
    getElapsedCateringTime, 
    checkFirstInLineAlarm,
    getRiderTodayGross,
    sortAvailableRidersByGross
} from '../rosterUtils.js';
import { syncHeaderUserProfile } from '../rosterAvatar.js';
import { autoStartLiveGpsSession, endLiveGpsSession } from '../../liveTracker.js';
import { openMapPicker } from '../../maps.js';
import { getForcedCaterBadgeHtml } from './rosterBadge.js';
import { loadGlobalCateredList } from './rosterFeeds.js';

export function openFindRidersMap() {
    openMapPicker('roster');
}

export function formatRiderShortName(name) {
    if (!name) return "Rider";
    const clean = String(name).trim();
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length === 0) return "Rider";
    if (words.length === 1) return formatTitleCase(words[0]);

    const firstName = formatTitleCase(words[0]);
    const lastWord = words.slice(1).reverse().find(w => /[a-zA-Z]/.test(w));
    if (!lastWord) return firstName;

    const cleanedLast = lastWord.replace(/[^a-zA-Z]/g, '');
    if (!cleanedLast) return firstName;

    const lastInitial = cleanedLast[0].toUpperCase();
    return `${firstName} ${lastInitial}.`;
}

export function updateRosterUI() {
    if (!globalState.rosterMembers || globalState.rosterMembers.length === 0) {
        loadRosterCache();
    }

    syncHeaderUserProfile();

    const rosterMembers = globalState.rosterMembers || [];
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();
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

    const riderDayOffBtn = document.getElementById('btn-rider-dayoff');
    if (riderDayOffBtn) {
        riderDayOffBtn.classList.remove('hidden');
    }

    const storeHubBtn = document.getElementById('admin-store-hub-btn');
    if (storeHubBtn) {
        if (showControls && isAdmin()) storeHubBtn.classList.remove('hidden');
        else storeHubBtn.classList.add('hidden');
    }

    const manageRidersBtn = document.getElementById('admin-manage-riders-btn');
    if (manageRidersBtn) {
        if (showControls && isAdmin()) manageRidersBtn.classList.remove('hidden');
        else manageRidersBtn.classList.add('hidden');
    }

    const scheduleSettingsBtn = document.getElementById('admin-schedule-settings-btn');
    if (scheduleSettingsBtn) {
        if (showControls && isAdmin()) scheduleSettingsBtn.classList.remove('hidden');
        else scheduleSettingsBtn.classList.add('hidden');
    }

    const dayOffSettingsBtn = document.getElementById('admin-dayoff-settings-btn');
    if (dayOffSettingsBtn) {
        if (showControls && isAdmin()) dayOffSettingsBtn.classList.remove('hidden');
        else dayOffSettingsBtn.classList.add('hidden');
    }

    const bookingLimitsBtn = document.getElementById('admin-booking-limits-btn');
    if (bookingLimitsBtn) {
        if (showControls && isAdmin()) bookingLimitsBtn.classList.remove('hidden');
        else bookingLimitsBtn.classList.add('hidden');
    }

    const commissionSettingsBtn = document.getElementById('admin-commission-settings-btn');
    if (commissionSettingsBtn) {
        if (showControls && isAdmin()) commissionSettingsBtn.classList.remove('hidden');
        else commissionSettingsBtn.classList.add('hidden');
    }

    const autoEndShiftBtn = document.getElementById('admin-auto-endshift-btn');
    if (autoEndShiftBtn) {
        if (showControls && isAdmin()) autoEndShiftBtn.classList.remove('hidden');
        else autoEndShiftBtn.classList.add('hidden');
    }

    const blockBtn = document.getElementById('admin-block-btn');
    if (blockBtn) {
        if (showControls && isAdmin()) blockBtn.classList.remove('hidden');
        else blockBtn.classList.add('hidden');
    }

    const findRidersBtn = document.getElementById('admin-find-riders-btn');
    if (findRidersBtn) {
        if (showControls) findRidersBtn.classList.remove('hidden');
        else findRidersBtn.classList.add('hidden');
    }

    const forceAllBtn = document.getElementById('admin-force-all-btn');
    if (forceAllBtn) {
        if (showControls) forceAllBtn.classList.remove('hidden');
        else forceAllBtn.classList.add('hidden');
    }

    const myRecord = rosterMembers.find(m => {
        const rId = (m.telegramId || m.id || "").toString().trim();
        const rName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        return (myId && rId === myId) || (myName && rName === myName);
    });

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

    const availableRiders = sortAvailableRidersByGross(rosterMembers.filter(m => m.status === 'Available'));

    checkFirstInLineAlarm(availableRiders);

    const cateringRiders = rosterMembers.filter(m => m.status === 'Catering');
    const breakRiders = rosterMembers.filter(m => m.status === 'Break');
    const cooldownRiders = rosterMembers.filter(m => m.status === 'Cooldown');

    const allDayOffs = globalState.riderDayOffs || {};
    const todayDayOfWeek = new Date().getDay();

    let availHtml = [], busyHtml = [], brkHtml = [], cdHtml = [];
    let availCounter = 1;

    // 1. Available List
    availableRiders.forEach((m) => {
        const mId = (m.telegramId || m.id || "").toString();
        const rawName = m.riderName || m.name || "Rider";
        const mName = formatTitleCase(rawName);
        const shortName = formatRiderShortName(rawName);
        const todayGross = getRiderTodayGross(rawName, mId);
        
        let controlsHtml = "";
        if (showControls) {
            controlsHtml += ` <select onchange="window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-white dark:bg-black text-[10px] text-gray-900 dark:text-yellow-400 border border-gray-300 dark:border-gray-700 rounded px-1 ml-1 cursor-pointer"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option></select>`;

            controlsHtml += `
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
                <button type="button" onclick="window.openRiderInfoModal && window.openRiderInfoModal('${mId}', '${escapeHtml(mName)}')" class="font-bold text-gray-900 dark:text-gray-100 hover:text-emerald-500 dark:hover:text-emerald-400 hover:underline transition cursor-pointer text-left" title="View Rider Details">${escapeHtml(shortName)}</button>
                ${controlsHtml}
                <span class="text-[10px] font-mono font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30" title="Today's Gross Earnings">₱${todayGross.toFixed(0)}</span>
            </div>
        `);
    });

    // 2. Catering List (With Multi-Customer Support & Per-Customer Done Actions)
    cateringRiders.forEach(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const rawName = m.riderName || m.name || "Rider";
        const mName = formatTitleCase(rawName);
        const shortName = formatRiderShortName(rawName);
        const todayGross = getRiderTodayGross(rawName, mId);

        const isMyLine = (myId && mId === myId) || (myName && (mName.toLowerCase() === myName || rawName.toLowerCase() === myName));
        const canComplete = isMyLine || showControls;
        const canSwap = isMyLine || showControls;

        let cardHtml = `
        <div class="flex flex-col py-1.5 border-b border-gray-200 dark:border-gray-800/60 last:border-0 gap-1">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5">
                    <button type="button" onclick="window.openRiderInfoModal && window.openRiderInfoModal('${mId}', '${escapeHtml(mName)}')" class="font-black text-xs text-gray-900 dark:text-white hover:text-orange-500 dark:hover:text-orange-400 hover:underline transition cursor-pointer text-left" title="View Rider Details">${escapeHtml(shortName)}</button>
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
                const formattedCustName = formatTitleCase(cName);
                const cTime = times[idx] || times[0] || '';
                const timeDetails = getElapsedCateringTime(cTime);
                const forcedBadge = getForcedCaterBadgeHtml(m, cName, mName);

                cardHtml += `
                <div class="flex flex-wrap items-center justify-between gap-1 bg-white dark:bg-cardBg p-2 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xs">
                    <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span class="text-gray-900 dark:text-orange-300 font-black">👤 ${escapeHtml(formattedCustName)} <span class="text-gray-600 dark:text-gray-400 text-[10px] font-normal font-mono">(${timeDetails})</span></span>
                        ${forcedBadge}
                    </div>
                    
                    <div class="flex items-center gap-1 shrink-0">
                        ${canComplete ? `
                            <button type="button" onclick="window.completeSingleCateringCustomer && window.completeSingleCateringCustomer('${mId}', '${escapeHtml(mName)}', '${escapeHtml(cName)}')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-0.5 rounded text-[10px] font-black transition active:scale-95 shadow-xs flex items-center gap-1 cursor-pointer" title="Mark this customer delivery as completed">
                                <i class="fa-solid fa-check"></i> Done
                            </button>
                        ` : ''}

                        ${isMyLine ? `
                            <button type="button" onclick="window.copyCustomerTrackingLink && window.copyCustomerTrackingLink('${escapeHtml(cName)}')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-600/30 dark:hover:bg-blue-600 dark:text-blue-300 dark:border-transparent px-1.5 py-0.5 rounded text-[10px] font-bold transition active:scale-95" title="Send Track Link">🔗 Link</button>
                            <button type="button" onclick="window.openLiveCustomerMap && window.openLiveCustomerMap('${escapeHtml(cName)}')" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-600/30 dark:hover:bg-emerald-600 dark:text-emerald-300 dark:border-transparent px-1.5 py-0.5 rounded text-[10px] font-bold transition active:scale-95" title="Open Live Map">🗺️ Map</button>
                        ` : ''}

                        ${canSwap ? `
                            <button type="button" onclick="window.openSwapCustomerModal && window.openSwapCustomerModal('${mId}', '${escapeHtml(mName)}', '${escapeHtml(cName)}')" class="bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 dark:bg-purple-600/30 dark:hover:bg-purple-600 dark:text-purple-300 dark:border-transparent px-1.5 py-0.5 rounded text-[10px] font-bold transition active:scale-95" title="Swap customer with another rider">
                                🔀 Swap
                            </button>
                        ` : ''}

                        ${!isMyLine ? `
                            <button type="button" onclick="window.claimCustomerFromRider && window.claimCustomerFromRider('${mId}', '${escapeHtml(mName)}', '${escapeHtml(cName)}')" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-600/30 dark:hover:bg-emerald-600 dark:text-emerald-300 dark:border-emerald-500/40 px-1.5 py-0.5 rounded text-[10px] font-bold transition active:scale-95" title="Request to get this customer">
                                📥 Get
                            </button>
                        ` : ''}

                        ${showControls ? `
                            <button type="button" onclick="window.adminVoidSpecificCustomer && window.adminVoidSpecificCustomer('${mId}', '${escapeHtml(mName)}', '${escapeHtml(cName)}')" class="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/40 dark:hover:bg-red-800 dark:text-red-300 dark:border-red-700/50 px-1.5 py-0.5 rounded text-[10px] font-bold transition active:scale-95" title="Void specific customer">
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

    // 3. Break List
    breakRiders.forEach(m => {
        const mId = (m.telegramId || m.id || "").toString();
        const rawName = m.riderName || m.name || "Rider";
        const mName = formatTitleCase(rawName);
        const shortName = formatRiderShortName(rawName);
        const todayGross = getRiderTodayGross(rawName, mId);
        
        let controlsHtml = "";
        if (showControls) {
            controlsHtml += ` <select onchange="window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-white dark:bg-black text-[10px] text-gray-900 dark:text-yellow-400 border border-gray-300 dark:border-gray-700 rounded px-1 ml-1 cursor-pointer"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option></select>`;
        }

        brkHtml.push(`
            <div class="flex items-center justify-between py-1 text-xs font-bold text-gray-900 dark:text-gray-200">
                <div class="flex items-center gap-1.5">
                    <button type="button" onclick="window.openRiderInfoModal && window.openRiderInfoModal('${mId}', '${escapeHtml(mName)}')" class="hover:text-amber-500 dark:hover:text-amber-400 hover:underline transition cursor-pointer text-left" title="View Rider Details">${escapeHtml(shortName)}</button>
                    ${controlsHtml}
                    <span class="text-[10px] font-mono font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30" title="Today's Gross Earnings">₱${todayGross.toFixed(0)}</span>
                </div>
            </div>
        `);
    });

    // 4. Cooldown List
    cooldownRiders.forEach(m => {
        const mId = (m.telegramId || m.id || "").toString();
        const rawName = m.riderName || m.name || "Rider";
        const mName = formatTitleCase(rawName);
        const shortName = formatRiderShortName(rawName);
        const todayGross = getRiderTodayGross(rawName, mId);

        let remSecs = m.cooldownUntil ? Math.max(0, Math.ceil((m.cooldownUntil - Date.now()) / 1000)) : 0;
        let mins = String(Math.floor(remSecs / 60)).padStart(2, '0');
        let secs = String(remSecs % 60).padStart(2, '0');

        let controlsHtml = ` <span class="text-amber-700 dark:text-yellow-400 font-mono text-[10px] font-bold">(${mins}:${secs} remaining)</span>`;

        if (showControls) {
            controlsHtml += ` <select onchange="window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-white dark:bg-black text-[10px] text-gray-900 dark:text-yellow-400 border border-gray-300 dark:border-gray-700 rounded px-1 ml-1 cursor-pointer"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option></select>`;
        }

        cdHtml.push(`
            <div class="flex items-center justify-between py-1 text-xs font-bold text-gray-900 dark:text-gray-200">
                <div class="flex items-center gap-1.5">
                    <button type="button" onclick="window.openRiderInfoModal && window.openRiderInfoModal('${mId}', '${escapeHtml(mName)}')" class="hover:text-yellow-500 dark:hover:text-yellow-400 hover:underline transition cursor-pointer text-left" title="View Rider Details">${escapeHtml(shortName)}</button>
                    ${controlsHtml}
                    <span class="text-[10px] font-mono font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30" title="Today's Gross Earnings">₱${todayGross.toFixed(0)}</span>
                </div>
            </div>
        `);
    });

    let dayOffHtml = [];
    const dayOffRiderKeys = new Set();

    Object.entries(allDayOffs).forEach(([key, rec]) => {
        if (!rec || rec.dayOfWeek === undefined || rec.dayOfWeek === null) return;
        if (parseInt(rec.dayOfWeek) === todayDayOfWeek) {
            const rawRiderName = rec.riderName || key;
            const riderName = formatTitleCase(rawRiderName);
            const shortName = formatRiderShortName(rawRiderName);
            const riderId = rec.riderId || key;
            const uniqueKey = (riderId || riderName).toString().toLowerCase().trim();

            if (!dayOffRiderKeys.has(uniqueKey)) {
                dayOffRiderKeys.add(uniqueKey);
                dayOffHtml.push(`
                    <div class="inline-flex items-center bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-500/30 rounded-xl px-2.5 py-1 text-xs shadow-xs gap-1.5">
                        <button type="button" onclick="window.openRiderInfoModal && window.openRiderInfoModal('${riderId}', '${escapeHtml(riderName)}')" class="text-teal-700 dark:text-teal-300 font-bold flex items-center gap-1 hover:underline cursor-pointer" title="View Rider Details">
                            <i class="fa-solid fa-umbrella-beach text-[10px] text-teal-500"></i> ${escapeHtml(shortName)}
                        </button>
                        <span class="text-[9px] font-mono font-black text-teal-800 dark:text-teal-200 bg-teal-100 dark:bg-teal-500/20 px-1.5 py-0.5 rounded border border-teal-300 dark:border-teal-500/40">Today</span>
                    </div>
                `);
            }
        }
    });

    const elAvail = document.getElementById('home-roster-avail');
    const elBusy = document.getElementById('home-roster-busy');
    const elBreak = document.getElementById('home-roster-break');
    const elCooldown = document.getElementById('home-roster-cooldown');
    const elDayoff = document.getElementById('home-roster-dayoff');

    if (elAvail) elAvail.innerHTML = availHtml.length ? availHtml.join('') : '(Walang naka-duty)';
    if (elBusy) elBusy.innerHTML = busyHtml.length ? busyHtml.join('') : '(Walang bumibiyahe)';
    if (elBreak) elBreak.innerHTML = brkHtml.length ? brkHtml.join('') : '(Walang naka-break)';
    if (elCooldown) elCooldown.innerHTML = cdHtml.length ? cdHtml.join('') : '(Walang naka-cooldown)';
    if (elDayoff) elDayoff.innerHTML = dayOffHtml.length ? dayOffHtml.join('') : '(Walang naka-day off)';

    loadGlobalCateredList();
}

if (typeof window !== 'undefined') {
    window.updateRosterUI = updateRosterUI;
    window.openFindRidersMap = openFindRidersMap;
    window.formatRiderShortName = formatRiderShortName;

    window.addEventListener('receiptsUpdated', () => updateRosterUI());
    window.addEventListener('cateredUpdated', () => updateRosterUI());
    window.addEventListener('rosterUpdated', () => updateRosterUI());
    window.addEventListener('loginsUpdated', () => updateRosterUI());
}