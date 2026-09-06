// src/features/roster/rosterUI.js
import { appState, globalState } from '../../store/state.js';
import { escapeHtml, isSameDate, getLocalTodayStr, formatTitleCase } from '../../utils/helpers.js';
import { db } from '../../config/firebase.js';
import { 
    loadRosterCache, 
    canManageRoster, 
    isAdmin, 
    getElapsedCateringTime, 
    checkFirstInLineAlarm,
    calculateSplitDuration,
    parseTimeToMinutes,
    getRiderTodayGross,
    sortAvailableRidersByGross,
    getMergedDeduplicatedCommissionList,
    isSameDateStr
} from './rosterUtils.js';
import { syncHeaderUserProfile } from './rosterAvatar.js';
import { autoStartLiveGpsSession, endLiveGpsSession } from '../liveTracker.js';
import { openMapPicker } from '../maps.js';

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function openFindRidersMap() {
    openMapPicker('roster');
}

export async function openRiderInfoModal(riderId, riderName = '') {
    const modal = document.getElementById('rider-info-modal');
    if (!modal) return;

    const myId = (riderId || '').toString().trim();
    const cleanName = (riderName || 'Rider').trim();

    const rosterMembers = globalState.rosterMembers || [];
    const rosterRec = rosterMembers.find(m => (m.telegramId || m.id || '').toString() === myId || (m.riderName || m.name || '').toLowerCase() === cleanName.toLowerCase()) || {};

    const rawDisplayName = rosterRec.riderName || rosterRec.name || cleanName;
    const displayName = formatTitleCase(rawDisplayName);
    const status = rosterRec.status || 'Offline / End';
    const userType = (rosterRec.userType || globalState.userTypesMap?.[myId] || 'rider').toUpperCase();
    
    // Photo
    const photoUrl = rosterRec.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0284c7&color=ffffff&bold=true&size=128`;
    
    // Day off
    const allDayOffs = globalState.riderDayOffs || {};
    const dayOffRec = allDayOffs[myId] || allDayOffs[cleanName.toLowerCase()] || null;
    const dayOffText = (dayOffRec && dayOffRec.dayOfWeek !== undefined && dayOffRec.dayOfWeek !== null)
        ? `Every ${DAYS_SHORT[parseInt(dayOffRec.dayOfWeek)] || 'N/A'}`
        : 'None Assigned';

    // Gross & Deliveries today
    const gross = getRiderTodayGross(displayName, myId);
    const todayStr = getLocalTodayStr();
    const mergedList = getMergedDeduplicatedCommissionList();
    const todayDeliveries = mergedList.filter(item => {
        const itemDate = item.date || item.completedDate;
        const isToday = itemDate && isSameDateStr(itemDate, todayStr);
        const isRider = (item.riderId && item.riderId.toString() === myId) || 
                        (item.riderName && item.riderName.toLowerCase() === rawDisplayName.toLowerCase());
        return isToday && isRider;
    }).length;

    // Contact Number
    let phone = rosterRec.phoneNumber || rosterRec.phone || '';

    // Elements
    const avatarEl = document.getElementById('rider-info-avatar');
    const nameEl = document.getElementById('rider-info-name');
    const roleEl = document.getElementById('rider-info-role');
    const statusEl = document.getElementById('rider-info-status');
    const phoneEl = document.getElementById('rider-info-phone');
    const phoneLink = document.getElementById('rider-info-phone-link');
    const gcashNameEl = document.getElementById('rider-info-gcash-name');
    const gcashNoEl = document.getElementById('rider-info-gcash-no');
    const dayoffEl = document.getElementById('rider-info-dayoff');
    const grossEl = document.getElementById('rider-info-gross');
    const countEl = document.getElementById('rider-info-deliveries');
    const activeCateringEl = document.getElementById('rider-info-active-catering');
    const cateringWrapper = document.getElementById('rider-info-active-catering-wrapper');

    if (avatarEl) avatarEl.src = photoUrl;
    if (nameEl) nameEl.innerText = displayName;
    if (roleEl) roleEl.innerText = userType;
    if (dayoffEl) dayoffEl.innerText = dayOffText;
    if (grossEl) grossEl.innerText = `₱${gross.toFixed(0)}`;
    if (countEl) countEl.innerText = `${todayDeliveries} order(s)`;

    // Status styling
    if (statusEl) {
        statusEl.innerText = status;
        statusEl.className = 'px-2 py-0.5 rounded-full font-bold text-[9px] uppercase border ' + (
            status === 'Available' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' :
            status === 'Catering' ? 'bg-red-500/20 text-red-400 border-red-500/40' :
            status === 'Break' ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' :
            status === 'Cooldown' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40' :
            'bg-gray-700/40 text-gray-300 border-gray-600'
        );
    }

    // Active catering session orders
    if (cateringWrapper && activeCateringEl) {
        if (status === 'Catering' && rosterRec.customerName) {
            cateringWrapper.classList.remove('hidden');
            activeCateringEl.innerText = formatTitleCase(rosterRec.customerName);
        } else {
            cateringWrapper.classList.add('hidden');
        }
    }

    const setPhoneUI = (val) => {
        if (phoneEl) phoneEl.innerText = val || 'Not Set';
        if (phoneLink) {
            if (val) {
                phoneLink.href = `tel:${val}`;
                phoneLink.classList.remove('hidden');
            } else {
                phoneLink.classList.add('hidden');
            }
        }
    };
    setPhoneUI(phone);

    if (gcashNameEl) gcashNameEl.innerText = 'Checking...';
    if (gcashNoEl) gcashNoEl.innerText = 'Checking...';

    modal.classList.remove('hidden');

    // Fetch live phone & GCash from database
    if (db && myId) {
        try {
            const [riderSnap, gcashSnap] = await Promise.all([
                db.ref(`riders/${myId}`).once('value'),
                db.ref(`gcash/${myId}`).once('value')
            ]);

            const rData = riderSnap.val() || {};
            const gData = gcashSnap.val() || {};

            if (rData.phoneNumber || rData.phone) {
                phone = rData.phoneNumber || rData.phone;
                setPhoneUI(phone);
            }
            if (rData.photoUrl && avatarEl) {
                avatarEl.src = rData.photoUrl;
            }

            const gName = gData.gcashName || rData.gcashName ? formatTitleCase(gData.gcashName || rData.gcashName) : 'Not Set';
            const gNo = gData.gcashNo || rData.gcashNo || 'Not Set';

            if (gcashNameEl) gcashNameEl.innerText = gName;
            if (gcashNoEl) gcashNoEl.innerText = gNo;
        } catch (e) {
            if (gcashNameEl) gcashNameEl.innerText = 'Not Set';
            if (gcashNoEl) gcashNoEl.innerText = 'Not Set';
        }
    } else {
        if (gcashNameEl) gcashNameEl.innerText = 'Not Set';
        if (gcashNoEl) gcashNoEl.innerText = 'Not Set';
    }
}

export function closeRiderInfoModal() {
    const modal = document.getElementById('rider-info-modal');
    if (modal) modal.classList.add('hidden');
}

export function updateRosterUI() {
    if (!globalState.rosterMembers || globalState.rosterMembers.length === 0) {
        loadRosterCache();
    }

    // Sync header profile photo & welcome message
    syncHeaderUserProfile();

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

    const myRecord = rosterMembers.find(m => (m.telegramId || m.id || "").toString() === myId);
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

    const getRiderDayOffBadge = (mId, mName) => {
        const cleanName = (mName || "").toLowerCase().trim();
        const rec = allDayOffs[mId] || allDayOffs[cleanName] || null;
        if (!rec || rec.dayOfWeek === undefined || rec.dayOfWeek === null) return "";

        const dIdx = parseInt(rec.dayOfWeek);
        if (isNaN(dIdx)) return "";

        if (dIdx === todayDayOfWeek) {
            return `<span class="text-[9px] font-black text-teal-300 bg-teal-500/20 px-1.5 py-0.5 rounded border border-teal-500/40" title="Day-Off Scheduled Today">🏝️ DAY OFF TODAY</span>`;
        }

        return `<span class="text-[9px] font-bold text-gray-400 bg-gray-800/80 px-1.5 py-0.5 rounded border border-gray-700/50" title="Weekly Day-Off: Every ${DAYS_SHORT[dIdx]}">🏖️ ${DAYS_SHORT[dIdx]}</span>`;
    };

    let availHtml = [], busyHtml = [], brkHtml = [], cdHtml = [];
    let availCounter = 1;

    // 1. Available List
    availableRiders.forEach((m) => {
        const mId = (m.telegramId || m.id || "").toString();
        const mName = formatTitleCase(m.riderName || m.name || "Rider");
        const todayGross = getRiderTodayGross(mName, mId);
        const dayOffBadge = getRiderDayOffBadge(mId, mName);
        
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
                <button type="button" onclick="window.openRiderInfoModal && window.openRiderInfoModal('${mId}', '${escapeHtml(mName)}')" class="font-bold text-gray-900 dark:text-gray-100 hover:text-emerald-500 dark:hover:text-emerald-400 hover:underline transition cursor-pointer text-left" title="View Rider Details">${escapeHtml(mName)}</button>
                ${controlsHtml}
                ${dayOffBadge}
                <span class="text-[10px] font-mono font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30" title="Today's Gross Earnings">₱${todayGross.toFixed(0)}</span>
            </div>
        `);
    });

    // 2. Catering List (With Multi-Customer Support & Force Cater Transparency Badges)
    cateringRiders.forEach(m => {
        const mId = (m.telegramId || m.id || "").toString();
        const mName = formatTitleCase(m.riderName || m.name || "Rider");
        const todayGross = getRiderTodayGross(mName, mId);
        const dayOffBadge = getRiderDayOffBadge(mId, mName);
        let cardHtml = `
        <div class="flex flex-col py-1.5 border-b border-gray-200 dark:border-gray-800/60 last:border-0 gap-1">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-1.5">
                    <button type="button" onclick="window.openRiderInfoModal && window.openRiderInfoModal('${mId}', '${escapeHtml(mName)}')" class="font-black text-xs text-gray-900 dark:text-white hover:text-orange-500 dark:hover:text-orange-400 hover:underline transition cursor-pointer text-left" title="View Rider Details">${escapeHtml(mName)}</button>
                    ${dayOffBadge}
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
                const isMyLine = mId === myId || (appState.riderName && mName.toLowerCase() === appState.riderName.toLowerCase());
                const canSwap = isMyLine || showControls;

                // Inspect active force-cater audit status
                let forcedInfo = null;
                if (m.forcedCaters && typeof m.forcedCaters === 'object') {
                    const cleanK = cName.toLowerCase().replace(/[^a-z0-9]/g, '');
                    forcedInfo = m.forcedCaters[cleanK] || m.forcedCaters[cName.toLowerCase().trim()] || m.forcedCaters[cName];
                    if (!forcedInfo) {
                        const foundEntry = Object.values(m.forcedCaters).find(fc => 
                            fc && fc.customerName && fc.customerName.toLowerCase().trim() === cName.toLowerCase().trim()
                        );
                        if (foundEntry) forcedInfo = foundEntry;
                    }
                }

                const forcedByLabel = forcedInfo ? (typeof forcedInfo === 'object' && forcedInfo.forcedBy ? forcedInfo.forcedBy : 'Admin') : '';
                const forcedBadge = forcedInfo 
                    ? `<span class="inline-flex items-center gap-1 text-[9px] font-black bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/40 px-1.5 py-0.5 rounded shrink-0 shadow-xs" title="Force Catered by ${escapeHtml(forcedByLabel)}"><i class="fa-solid fa-bolt text-[8px] text-amber-500"></i> Force Catered (${escapeHtml(forcedByLabel)})</span>` 
                    : '';

                cardHtml += `
                <div class="flex flex-wrap items-center justify-between gap-1 bg-white dark:bg-cardBg p-2 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xs">
                    <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span class="text-gray-900 dark:text-orange-300 font-black">👤 ${escapeHtml(formattedCustName)} <span class="text-gray-600 dark:text-gray-400 text-[10px] font-normal font-mono">(${timeDetails})</span></span>
                        ${forcedBadge}
                    </div>
                    
                    <div class="flex items-center gap-1 shrink-0">
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

    // 3. Break List
    breakRiders.forEach(m => {
        const mId = (m.telegramId || m.id || "").toString();
        const mName = formatTitleCase(m.riderName || m.name || "Rider");
        const todayGross = getRiderTodayGross(mName, mId);
        const dayOffBadge = getRiderDayOffBadge(mId, mName);
        
        let controlsHtml = "";
        if (showControls) {
            controlsHtml += ` <select onchange="window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-white dark:bg-black text-[10px] text-gray-900 dark:text-yellow-400 border border-gray-300 dark:border-gray-700 rounded px-1 ml-1 cursor-pointer"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option></select>`;
        }

        brkHtml.push(`
            <div class="flex items-center justify-between py-1 text-xs font-bold text-gray-900 dark:text-gray-200">
                <div class="flex items-center gap-1.5">
                    <button type="button" onclick="window.openRiderInfoModal && window.openRiderInfoModal('${mId}', '${escapeHtml(mName)}')" class="hover:text-amber-500 dark:hover:text-amber-400 hover:underline transition cursor-pointer text-left" title="View Rider Details">${escapeHtml(mName)}</button>
                    ${controlsHtml}
                    ${dayOffBadge}
                    <span class="text-[10px] font-mono font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30" title="Today's Gross Earnings">₱${todayGross.toFixed(0)}</span>
                </div>
            </div>
        `);
    });

    // 4. Cooldown List
    cooldownRiders.forEach(m => {
        const mId = (m.telegramId || m.id || "").toString();
        const mName = formatTitleCase(m.riderName || m.name || "Rider");
        const todayGross = getRiderTodayGross(mName, mId);
        const dayOffBadge = getRiderDayOffBadge(mId, mName);

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
                    <button type="button" onclick="window.openRiderInfoModal && window.openRiderInfoModal('${mId}', '${escapeHtml(mName)}')" class="hover:text-yellow-500 dark:hover:text-yellow-400 hover:underline transition cursor-pointer text-left" title="View Rider Details">${escapeHtml(mName)}</button>
                    ${controlsHtml}
                    ${dayOffBadge}
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
            const riderName = formatTitleCase(rec.riderName || key);
            const riderId = rec.riderId || key;
            const uniqueKey = (riderId || riderName).toString().toLowerCase().trim();

            if (!dayOffRiderKeys.has(uniqueKey)) {
                dayOffRiderKeys.add(uniqueKey);
                dayOffHtml.push(`
                    <div class="inline-flex items-center bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-500/30 rounded-xl px-2.5 py-1 text-xs shadow-xs gap-1.5">
                        <button type="button" onclick="window.openRiderInfoModal && window.openRiderInfoModal('${riderId}', '${escapeHtml(riderName)}')" class="text-teal-700 dark:text-teal-300 font-bold flex items-center gap-1 hover:underline cursor-pointer" title="View Rider Details">
                            <i class="fa-solid fa-umbrella-beach text-[10px] text-teal-500"></i> ${escapeHtml(riderName)}
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

// UNIFIED: Sorted Chronologically by Catering Start Time (Earliest to Latest) with Dynamic Split Minutes
export function loadGlobalCateredList() {
    const feed = document.getElementById('catered-customers-feed');
    const badge = document.getElementById('catered-count-badge');
    if (!feed) return;

    if ((!globalState.globalDailyReceipts || globalState.globalDailyReceipts.length === 0) &&
        (!globalState.globalCateredHistory || globalState.globalCateredHistory.length === 0)) {
        loadRosterCache();
    }

    const todayStr = getLocalTodayStr();
    const mergedList = getMergedDeduplicatedCommissionList();

    const todayHistory = mergedList.filter(item => {
        const itemDate = item.date || item.completedDate;
        return itemDate && isSameDateStr(itemDate, todayStr);
    });

    todayHistory.sort((a, b) => {
        const timeA = parseTimeToMinutes(a.startTime || a.cateringStartTime || a.time || "") ?? 9999;
        const timeB = parseTimeToMinutes(b.startTime || b.cateringStartTime || b.time || "") ?? 9999;
        return timeA - timeB;
    });

    if (badge) badge.innerText = `${todayHistory.length} recorded`;

    if (todayHistory.length === 0) {
        feed.innerHTML = `<div class="text-gray-500 dark:text-gray-400 italic text-center py-4 text-xs">No completed catered customers yet today.</div>`;
        return;
    }

    feed.innerHTML = todayHistory.map(h => {
        let voidBtn = "";
        const recordTxId = h.transactionId || h.id || "";
        const cDate = h.date || h.completedDate || todayStr;
        const riderFormatted = formatTitleCase(h.riderName);
        const customerFormatted = formatTitleCase(h.customerName);

        if (isAdmin()) {
            voidBtn = `<button onclick="window.promptAdminDeleteCommissionRecord && window.promptAdminDeleteCommissionRecord('${escapeHtml(h.riderName)}', '${escapeHtml(h.customerName)}', '${escapeHtml(cDate)}', '${escapeHtml(recordTxId)}')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 dark:bg-red-900/40 dark:hover:bg-red-800 dark:text-red-400 dark:border-red-700/50 text-[10px] font-bold px-2 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 shrink-0"><i class="fa-solid fa-ban"></i> Void</button>`;
        }

        const sTime = h.startTime || h.cateringStartTime || h.time || "";
        const cTime = h.completedTime || "";
        const cCount = parseInt(h.customerCount) || 1;
        let durationStr = h.duration || "";

        if ((!durationStr || durationStr === "Just now") && sTime && cTime && sTime !== cTime) {
            durationStr = calculateSplitDuration(sTime, cTime, cCount);
        } else if (durationStr && cCount > 1 && !durationStr.includes('÷')) {
            const startMins = parseTimeToMinutes(sTime);
            const endMins = parseTimeToMinutes(cTime);
            if (startMins !== null && endMins !== null) {
                let totalMins = endMins - startMins;
                if (totalMins < 0) totalMins += 24 * 60;
                const splitMins = Math.round(totalMins / cCount);
                durationStr = `${splitMins}m (${totalMins}m ÷ ${cCount})`;
            }
        }

        let timeRange = sTime ? `🕒 ${escapeHtml(sTime)}` : `🕒 Completed`;
        if (cTime && cTime !== sTime) {
            timeRange += ` → ${escapeHtml(cTime)}`;
        }

        let durationBadge = "";
        if (durationStr) {
            durationBadge = `<span class="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 px-1.5 py-0.5 rounded font-black text-[9px] font-mono tracking-wide">[${escapeHtml(durationStr)}]</span>`;
        }

        return `
        <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 p-2.5 rounded-2xl flex flex-col gap-1.5 shadow-xs">
            <div class="flex items-center justify-between gap-2">
                <div class="font-black text-xs text-gray-900 dark:text-white flex items-center gap-1.5 min-w-0 flex-1">
                    <i class="fa-solid fa-user text-orange-600 dark:text-orange-400 text-[11px] shrink-0"></i> 
                    <span class="truncate">${escapeHtml(customerFormatted)}</span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <span class="text-[10px] text-gray-600 dark:text-gray-400 font-medium">Rider: <span class="text-blue-600 dark:text-blue-400 font-bold">${escapeHtml(riderFormatted)}</span></span>
                    ${voidBtn}
                </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-gray-100 dark:border-gray-800/60 text-[10px] font-mono">
                <span class="text-gray-600 dark:text-gray-400 font-medium">${timeRange}</span>
                ${durationBadge}
            </div>
        </div>`;
    }).join('');
}

export function loadGlobalLoginList() {
    const feed = document.getElementById('login-list-feed');
    const badge = document.getElementById('login-count-badge');
    if (!feed) return;

    if (!globalState.globalLogins || globalState.globalLogins.length === 0) {
        loadRosterCache();
    }

    const todayStr = getLocalTodayStr();
    const todayLogins = globalState.globalLogins ? globalState.globalLogins.filter(l => l && isSameDateStr(l.date, todayStr)) : [];

    if (badge) badge.innerText = `${todayLogins.length} ${todayLogins.length === 1 ? 'login' : 'logins'}`;

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
        const riderFormatted = formatTitleCase(l.riderName || 'Rider');

        return `
        <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 p-2.5 rounded-xl flex justify-between items-center gap-2 shadow-xs">
            <div class="flex flex-col min-w-0 flex-1">
                <span class="font-black text-xs text-gray-900 dark:text-white truncate flex items-center gap-1.5"><i class="fa-solid fa-motorcycle text-blue-600 dark:text-blue-400 text-[10px]"></i> <span>${escapeHtml(riderFormatted)}</span></span>
                ${mapBtn}
            </div>
            <div class="text-[10px] text-gray-800 dark:text-gray-200 font-mono text-right shrink-0 font-medium">
                <span>In: ${escapeHtml(l.loginTime || 'N/A')}</span>
                ${clockOutTxt}
            </div>
        </div>`;
    }).join('');
}

// Global window attachments
if (typeof window !== 'undefined') {
    window.openFindRidersMap = openFindRidersMap;
    window.openRiderInfoModal = openRiderInfoModal;
    window.closeRiderInfoModal = closeRiderInfoModal;
    window.updateRosterUI = updateRosterUI;
    window.loadGlobalCateredList = loadGlobalCateredList;
    window.loadGlobalLoginList = loadGlobalLoginList;

    window.addEventListener('rosterUpdated', updateRosterUI);
    window.addEventListener('cateredUpdated', loadGlobalCateredList);
    window.addEventListener('receiptsUpdated', loadGlobalCateredList);
    window.addEventListener('loginsUpdated', loadGlobalLoginList);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            loadGlobalCateredList();
            loadGlobalLoginList();
        });
    } else {
        loadGlobalCateredList();
        loadGlobalLoginList();
    }
}