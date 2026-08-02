// src/features/roster.js
import { db } from '../config/firebase.js';
import { appState, globalState, multiCarts, activeCartSlot } from '../store/state.js';
import { API_URL, ADMIN_IDS } from '../config/constants.js';
import { showToast, showSideNotification, unlockAudioContext } from '../ui/notifications.js';
import { openSlideDeleteModal, closeCateringModal, closeAdminCateringModal } from '../ui/modals.js';
import { getDeviceLocation } from './auth.js';
import { getLocalTodayStr, isSameDate, escapeHtml } from '../utils/helpers.js';
import { switchView } from '../ui/router.js';
import { autoStartLiveGpsSession, endLiveGpsSession } from './liveTracker.js';

let lineAlarmInterval = null;
let lineAlarmConfirmed = false;
let pendingAdminTarget = null;

// --- FLEXIBLE & ROBUST USER ROLE HELPERS ---
export function getUserType() {
    return (appState.userType || localStorage.getItem('userType') || "").toString().trim().toLowerCase();
}

export function isAdmin() {
    const t = getUserType();
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    return t.includes("admin") || t.includes("owner") || t.includes("manager") || ADMIN_IDS.includes(myId);
}

export function isTL() {
    const t = getUserType();
    return t.includes("tl") || t.includes("lead") || t.includes("leader");
}

export function canManageRoster() {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    return isAdmin() || isTL() || ADMIN_IDS.includes(myId);
}

export function canForceCaterTarget(targetType) {
    if (isAdmin()) return true;
    if (isTL()) {
        const t = (targetType || "").toString().toLowerCase().trim();
        return !t.includes("admin");
    }
    return false;
}

export function parseQueueTime(val) {
    if (!val) return 0;
    const clean = val.toString().replace(/,/g, '').trim();
    return parseFloat(clean) || 0;
}

// --- HELPER: PARSE TIME TO MINUTES ---
function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const clean = timeStr.trim();
    const match = clean.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3] ? match[3].toUpperCase() : null;

    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    return hours * 60 + minutes;
}

// --- HELPER: CALCULATE SPLIT CATERING DURATION ---
export function calculateSplitDuration(startTimeStr, completedTimeStr, customerCount = 1) {
    const startMins = parseTimeToMinutes(startTimeStr);
    const endMins = parseTimeToMinutes(completedTimeStr);

    if (startMins === null || endMins === null) return "";

    let totalMins = endMins - startMins;
    if (totalMins < 0) totalMins += 24 * 60; // Handle midnight crossing

    const count = Math.max(1, customerCount);
    const splitMins = Math.round(totalMins / count);

    const hrs = Math.floor(splitMins / 60);
    const mins = splitMins % 60;

    let durationText = "";
    if (hrs > 0) {
        durationText = `${hrs}h ${mins}m`;
    } else {
        durationText = `${mins}m`;
    }

    if (count > 1) {
        durationText += ` (${totalMins}m ÷ ${count})`;
    }

    return durationText;
}

// --- HELPER: CALCULATE ELAPSED CATERING DURATION (LIVE ROSTER) ---
function getElapsedCateringTime(startTimeStr) {
    if (!startTimeStr) return "";
    
    const firstTime = startTimeStr.split(',')[0].trim();
    if (!firstTime) return "";

    const match = firstTime.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
    if (!match) return ` • ${firstTime}`;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3] ? match[3].toUpperCase() : null;

    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);

    let diffMs = now - start;
    if (diffMs < 0) {
        diffMs += 24 * 60 * 60 * 1000;
    }

    const totalMins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;

    let durationStr = "";
    if (hrs > 0) {
        durationStr = `${hrs}h ${mins}m`;
    } else {
        durationStr = `${mins}m`;
    }

    return ` • ${firstTime} [${durationStr}]`;
}

// --- CATERING SESSION & RECEIPT VALIDATION HELPERS ---
export function getActiveCateringCustomersWithTimes() {
    const myId = (appState.telegramId || "").toString();
    const myRecord = globalState.rosterMembers ? globalState.rosterMembers.find(m => (m.telegramId || "").toString() === myId) : null;
    if (!myRecord || myRecord.status !== 'Catering' || !myRecord.customerName) return [];

    const custs = myRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
    const times = myRecord.startTime ? myRecord.startTime.split(', ').map(t => t.trim()) : [];

    return custs.map((c, idx) => ({
        name: c,
        startTime: times[idx] || times[0] || ""
    }));
}

export function hasReceiptForActiveSession(custName, custStartTime) {
    if (!custName || custName.toLowerCase() === 'sample') return true;
    const rName = (appState.riderName || "").trim().toLowerCase();
    const cName = custName.trim().toLowerCase();
    const sTime = (custStartTime || "").trim();
    const todayStr = getLocalTodayStr();

    const sessionKey = `receipt_done_${rName}_${cName}_${sTime}_${todayStr}`;
    return localStorage.getItem(sessionKey) === 'true';
}

// --- ADMIN SAFETY TOGGLE ---
export function toggleAdminControls(enabled) {
    globalState.adminControlsEnabled = !!enabled;
    showToast(`Admin Safety Controls: ${enabled ? 'ENABLED' : 'DISABLED'}`);
    updateRosterUI();
}

// --- FIRST IN LINE ALARM & SOUND ---
export function checkFirstInLineAlarm(availableRiders) {
    const myId = (appState.telegramId || "").toString();
    const firstRiderId = (availableRiders[0]?.telegramId || "").toString();
    const isFirst = availableRiders.length > 0 && firstRiderId === myId && myId !== "";
    
    const modal = document.getElementById('first-line-modal');
    const goldenBox = document.getElementById('golden-first-line-border');

    if (isFirst) {
        if (goldenBox) goldenBox.classList.remove('hidden');

        if (!lineAlarmConfirmed) {
            if (modal) modal.classList.remove('hidden');
            if (!lineAlarmInterval) {
                lineAlarmInterval = setInterval(playLineBeep, 1200);
            }
        }
    } else {
        lineAlarmConfirmed = false;
        stopLineAlarm();
        if (modal) modal.classList.add('hidden');
        if (goldenBox) goldenBox.classList.add('hidden');
    }
}

export function confirmFirstInLineAlarm() {
    lineAlarmConfirmed = true;
    stopLineAlarm();
    const modal = document.getElementById('first-line-modal');
    if (modal) modal.classList.add('hidden');
    showToast("✅ Confirmed! Alarm stopped.");
}

export function stopLineAlarm() {
    if (lineAlarmInterval) {
        clearInterval(lineAlarmInterval);
        lineAlarmInterval = null;
    }
}

function playLineBeep() {
    try {
        unlockAudioContext();
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const audioCtx = new AudioContext();
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.4);
    } catch(e) {}
}

// --- MAIN ROSTER UI RENDERER & AUTO LIVE GPS TRIGGER ---
export function updateRosterUI() {
    const rosterMembers = globalState.rosterMembers || [];
    const myId = (appState.telegramId || "").toString();

    // Direct DOM sync for checkbox toggle state
    const adminToggle = document.getElementById('admin-controls-toggle');
    if (adminToggle) {
        globalState.adminControlsEnabled = adminToggle.checked;
    }

    const showControls = globalState.adminControlsEnabled && canManageRoster();

    // AUTOMATED LIVE GPS BACKGROUND MONITORING FOR THIS RIDER
    const myRecord = rosterMembers.find(m => (m.telegramId || "").toString() === myId);
    if (myRecord) {
        if (myRecord.status === 'Catering') {
            autoStartLiveGpsSession(myRecord.customerName || "Customer");
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
            nameStr += ` <select onchange="adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-black text-[10px] text-yellow-400 rounded px-1 ml-1 cursor-pointer"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option><option value="VoidActive">🚫 Void Order</option></select>`;

            const forceAllBtn = document.getElementById('admin-force-all-btn');
            if (forceAllBtn) forceAllBtn.classList.remove('hidden');

            nameStr += `
            <div class="inline-flex gap-1 ml-2 text-[10px] align-middle">
                <button onclick="adminShiftRiderQueue('${mId}', 'move_top')" class="bg-blue-600/30 hover:bg-blue-600 text-blue-300 px-1 py-0.5 rounded font-bold" title="Move Top">⬆️</button>
                <button onclick="adminShiftRiderQueue('${mId}', 'move_up')" class="bg-blue-600/30 hover:bg-blue-600 text-blue-300 px-1 py-0.5 rounded font-bold" title="Move Up (+1)">▲</button>
                <button onclick="adminShiftRiderQueue('${mId}', 'move_down')" class="bg-blue-600/30 hover:bg-blue-600 text-blue-300 px-1 py-0.5 rounded font-bold" title="Move Down (-1)">▼</button>
                <button onclick="adminShiftRiderQueue('${mId}', 'move_bottom')" class="bg-blue-600/30 hover:bg-blue-600 text-blue-300 px-1 py-0.5 rounded font-bold" title="Move Bottom">⬇️</button>
            </div>`;
        }

        availHtml.push(`<div class="flex items-center justify-between py-1"><span class="font-bold text-green-400 mr-2">${availCounter++}.</span><span class="flex-1">${nameStr}</span></div>`);
    });

    cateringRiders.forEach(m => {
        const mId = (m.telegramId || "").toString();
        const mName = m.riderName || m.name || "Rider";
        let nameStr = escapeHtml(mName);

        if (m.customerName) {
            const timeDetails = getElapsedCateringTime(m.startTime);
            nameStr += ` <span class="text-orange-300 text-[10px]">(${escapeHtml(m.customerName)}${timeDetails})</span>`;
        }

        const isMyLine = mId === myId;
        if (isMyLine) {
            nameStr += `
            <div class="inline-flex gap-1 ml-2 text-[10px] align-middle">
                <button onclick="copyCustomerTrackingLink('${escapeHtml(m.customerName || 'Customer')}')" class="bg-blue-600/30 hover:bg-blue-600 text-blue-300 px-1.5 py-0.5 rounded font-bold" title="Send Track Link">🔗 Link</button>
                <button onclick="refreshCustomerTrackingLink('${escapeHtml(m.customerName || 'Customer')}')" class="bg-purple-600/30 hover:bg-purple-600 text-purple-300 px-1.5 py-0.5 rounded font-bold" title="Refresh Link"><i class="fa-solid fa-arrows-rotate"></i></button>
                <button onclick="openLiveCustomerMap('${escapeHtml(m.customerName || 'Customer')}')" class="bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 px-1.5 py-0.5 rounded font-bold" title="Open Live Map">🗺️ Map</button>
            </div>`;
        }

        if (showControls) {
            nameStr += ` <select onchange="adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-black text-[10px] text-yellow-400 rounded px-1 ml-1 cursor-pointer"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option><option value="VoidActive">🚫 Void Order</option></select>`;
        }
        busyHtml.push(`<div class="flex items-center justify-between py-1">${nameStr}</div>`);
    });

    breakRiders.forEach(m => {
        const mId = (m.telegramId || "").toString();
        const mName = m.riderName || m.name || "Rider";
        let nameStr = escapeHtml(mName);

        if (showControls) {
            nameStr += ` <select onchange="adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-black text-[10px] text-yellow-400 rounded px-1 ml-1 cursor-pointer"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option><option value="VoidActive">🚫 Void Order</option></select>`;
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
            nameStr += ` <select onchange="adminForceStatus('${mId}', '${escapeHtml(mName)}', this.value)" class="bg-black text-[10px] text-yellow-400 rounded px-1 ml-1 cursor-pointer"><option value="" selected disabled>Force Action</option><option value="Available">Available</option><option value="Catering">Catering</option><option value="Break">Break</option><option value="End">End Shift</option></select>`;
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

// --- STATUS TRIGGER ACTION BUTTONS ---
export async function triggerStatusWithSlide(targetStatus) {
    const rosterMembers = globalState.rosterMembers || [];
    const myId = (appState.telegramId || "").toString();
    const myRecord = rosterMembers.find(m => (m.telegramId || "").toString() === myId);

    if (myRecord && myRecord.status === 'End' && targetStatus !== 'Available') {
        showToast("⚠️ Naka-End Shift ka. Ang Available button lamang ang maaaring pindutin.");
        return;
    }

    if (targetStatus === 'Available') {
        if (myRecord && myRecord.status === 'Cooldown' && myRecord.cooldownUntil && Date.now() < myRecord.cooldownUntil) {
            const remMins = Math.ceil((myRecord.cooldownUntil - Date.now()) / 60000);
            showToast(`⚠️ Naka-penalty cooldown ka pa. Maghintay ng ${remMins} min(s) bago maging Available.`);
            return;
        }

        if (myRecord && myRecord.pendingPenaltyMinutes && myRecord.pendingPenaltyMinutes > 0) {
            const pMins = parseInt(myRecord.pendingPenaltyMinutes) || 10;
            const cdUntil = Date.now() + (pMins * 60000);

            showSideNotification("PENALTY COOLDOWN", `Starting ${pMins} min penalty cooldown for ${appState.riderName}`, "fa-clock", "text-yellow-400", "border-yellow-500");

            db.ref('roster/' + appState.telegramId).update({
                status: 'Cooldown',
                cooldownUntil: cdUntil,
                pendingPenaltyMinutes: 0,
                lastUpdated: new Date().toLocaleTimeString()
            });

            showToast(`⚠️ Penalized! Naka-cooldown ka ng ${pMins} mins. Kusa kang gagawing Available pagkatapos.`);
            return;
        }

        const activeCustList = getActiveCateringCustomersWithTimes();
        if (activeCustList.length > 0) {
            let missingReceiptCust = null;
            for (let item of activeCustList) {
                if (!hasReceiptForActiveSession(item.name, item.startTime)) {
                    missingReceiptCust = item;
                    break;
                }
            }

            if (missingReceiptCust) {
                showToast(`⚠️ Paki-gawaan muna ng resibo si ${missingReceiptCust.name} bago mag-Available!`);
                
                if (multiCarts && activeCartSlot) {
                    multiCarts[activeCartSlot].customerName = missingReceiptCust.name;
                    multiCarts[activeCartSlot].isManual = false;
                    if (window.saveCartState) window.saveCartState();
                }
                switchView('view-cart');
                return;
            }
        }

        showToast("Checking GPS location...");
        const coords = await getDeviceLocation();
        if (!coords || (coords.lat === 0 && coords.lon === 0)) {
            const modal = document.getElementById('gps-alert-modal');
            if (modal) modal.classList.remove('hidden');
            return;
        }

        appState.lat = coords.lat; 
        appState.lon = coords.lon;
        showSideNotification("RECORDING STATUS", `Marking ${appState.riderName} Available — placing at end of line`, "fa-user-check", "text-green-400", "border-green-500");

        endLiveGpsSession();
        await updateRosterStatus('Available');
        
        if (window.clearCartSlot) {
            window.clearCartSlot();
        }

    } else if (targetStatus === 'End') {
        openSlideDeleteModal(`Sigurado ka bang mag-End Shift?`, async () => {
            stopLineAlarm();
            lineAlarmConfirmed = false;
            showSideNotification("CLOCK OUT", `Clocking out ${appState.riderName}...`, "fa-power-off", "text-red-400", "border-red-500");
            endLiveGpsSession();
            await clockOutRider();
            updateRosterStatus('End');
        });
    } else {
        openSlideDeleteModal(`Sigurado ka bang mag-iiba ng status sa [${targetStatus}]?`, () => {
            stopLineAlarm();
            lineAlarmConfirmed = false;
            showSideNotification("RECORDING STATUS", `Setting status to ${targetStatus} for ${appState.riderName}...`, "fa-user-clock", "text-amber-400", "border-amber-500");
            if (targetStatus === 'Break') endLiveGpsSession();
            updateRosterStatus(targetStatus);
        });
    }
}

export function promptCateringStatus() {
    const rosterMembers = globalState.rosterMembers || [];
    const myId = (appState.telegramId || "").toString();
    const myRecord = rosterMembers.find(m => (m.telegramId || "").toString() === myId);

    if (myRecord) {
        if (myRecord.status === 'End') return showToast("⚠️ Naka-End Shift ka. Mag-Available muna bago mag-Cater.");
        if (myRecord.status === 'Break') return showToast("⚠️ Naka-Break ka. Mag-Available muna bago mag-Cater.");
        if (myRecord.status === 'Cooldown') return showToast("⚠️ Naka-penalty cooldown ka pa. Maghintay muna matapos.");
    }

    const amIAlreadyCatering = myRecord && myRecord.status === 'Catering';
    const availableRiders = rosterMembers.filter(m => m.status === 'Available').sort((a, b) => parseQueueTime(a.queueTime) - parseQueueTime(b.queueTime));

    if (!amIAlreadyCatering && availableRiders.length > 0) {
        const firstAvailable = availableRiders[0];
        if ((firstAvailable?.telegramId || "").toString() !== myId) {
            return showToast("⚠️ Hindi ikaw ang nasa unahan ng queue. Maghintay muna sa iyong turn.");
        }
    }

    const input = document.getElementById('catering-customer-name');
    if (input) input.value = "";
    const modal = document.getElementById('catering-modal');
    if (modal) modal.classList.remove('hidden');
    if (input) input.focus();
}

export async function confirmCateringStatus() {
    const input = document.getElementById('catering-customer-name');
    const custName = input ? input.value.trim() : "";
    if (!custName) return showToast("Please enter customer name");

    closeCateringModal();
    stopLineAlarm();
    lineAlarmConfirmed = false;

    const startTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const myId = (appState.telegramId || "").toString();
    const myRecord = globalState.rosterMembers ? globalState.rosterMembers.find(m => (m.telegramId || "").toString() === myId) : null;

    let existingCustomers = [];
    let existingTimes = [];

    if (myRecord && myRecord.status === 'Catering' && myRecord.customerName) {
        existingCustomers = myRecord.customerName.split(', ');
        existingTimes = myRecord.startTime ? myRecord.startTime.split(', ') : [];
    }

    existingCustomers.push(custName);
    existingTimes.push(startTime);

    showSideNotification("RECORDING CATERING", `Moving to Catering — adding customer ${custName} to ${appState.riderName}`, "fa-motorcycle", "text-red-400", "border-red-500");
    
    // Auto-start background Live GPS streaming
    autoStartLiveGpsSession(existingCustomers.join(', '));

    await updateRosterStatusData('Catering', existingCustomers.join(', '), existingTimes.join(', '), myRecord ? parseQueueTime(myRecord.queueTime) : 0);
}

// --- ROSTER DATA PERSISTENCE WITH EVEN TIME-SPLITTING ---
export async function updateRosterStatus(status, targetId = null, targetName = null) {
    const tId = targetId || appState.telegramId;
    const tName = targetName || appState.riderName;
    const rosterMembers = globalState.rosterMembers || [];

    let completedHistory = [];
    let recordLogin = false;

    const targetRecord = rosterMembers.find(m => (m.telegramId || "").toString() === tId.toString());

    // RECORD COMPLETED CATERED HISTORY & EVENLY SPLIT CATERING TIME FOR MULTIPLE CUSTOMERS
    if (status !== 'Catering' && targetRecord && targetRecord.status === 'Catering' && targetRecord.customerName) {
        const custs = targetRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
        const times = targetRecord.startTime ? targetRecord.startTime.split(', ').map(t => t.trim()) : [];
        const custCount = custs.length || 1;
        const completedTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        for (let i = 0; i < custs.length; i++) {
            const cName = custs[i];
            const sTime = times[i] || times[0] || 'N/A';
            const splitDuration = calculateSplitDuration(sTime, completedTimeStr, custCount);

            const hItem = {
                riderName: tName,
                telegramId: tId.toString(),
                customerName: cName,
                startTime: sTime,
                completedTime: completedTimeStr,
                completedDate: getLocalTodayStr(),
                customerCount: custCount,
                duration: splitDuration,
                totalFees: targetRecord.lastReceiptTotalFees || 0,
                fees: targetRecord.lastReceiptFees || null
            };
            completedHistory.push(hItem);
            db.ref('cateredHistory').push(hItem);
        }
    }

    if (status === 'Available') recordLogin = true;

    let locationLink = "";
    if (appState.lat && appState.lon) {
        locationLink = `https://www.google.com/maps/search/?api=1&query=${appState.lat.toFixed(6)},${appState.lon.toFixed(6)}`;
    }

    let newQueueTime = 0;
    if (status === 'Available') {
        const availableRiders = rosterMembers.filter(m => m.status === 'Available' && (m.telegramId || "").toString() !== tId.toString());
        let maxTime = new Date().getTime();
        availableRiders.forEach(r => {
            const t = parseQueueTime(r.queueTime);
            if (t > maxTime) maxTime = t;
        });
        newQueueTime = maxTime + 1000;
    }

    await updateRosterStatusData(status, "", "", newQueueTime, tId, tName, completedHistory, recordLogin, locationLink);
}

export async function updateRosterStatusData(status, customerName, startTime, queueTime = 0, specificId = null, specificName = null, completedHistory = [], recordLogin = false, locationLink = "") {
    const tId = specificId || appState.telegramId;
    const tName = specificName || appState.riderName;

    const rosterData = {
        telegramId: tId.toString(),
        riderName: tName,
        userType: getUserType(),
        status: status,
        customerName: customerName || "",
        startTime: startTime || "",
        queueTime: queueTime || new Date().getTime(),
        lastUpdated: new Date().toLocaleTimeString(),
        lat: appState.lat || 0,
        lng: appState.lon || 0
    };

    db.ref('roster/' + tId).set(rosterData);

    if (recordLogin) {
        const loginEntry = {
            riderName: tName,
            loginTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            clockOutTime: "",
            date: getLocalTodayStr(),
            location: locationLink
        };
        db.ref('logins/' + tId).set(loginEntry);
    }

    const payload = {
        type: "roster",
        telegramId: tId,
        riderName: tName,
        status: status,
        customerName: customerName,
        startTime: startTime,
        queueTime: queueTime,
        completedHistory: completedHistory,
        recordLogin: recordLogin,
        location: locationLink,
        loginTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: getLocalTodayStr()
    };

    try {
        fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
    } catch(e) {}
}

async function clockOutRider() {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    db.ref('logins/' + appState.telegramId).update({ clockOutTime: timeStr });

    const payload = {
        type: "roster", telegramId: appState.telegramId, riderName: appState.riderName,
        status: "End", clockOut: true, clockOutTime: timeStr
    };
    try { fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) }); } catch(e) {}
}

// --- ADMIN / TL CONTROLS ---
export function openAdminCateringModal(id, name) {
    pendingAdminTarget = { id, name };
    const nameInput = document.getElementById('admin-catering-customer-name');
    if (nameInput) nameInput.value = "";

    const radioNone = document.querySelector('input[name="penalty-option"][value="none"]');
    if (radioNone) radioNone.checked = true;

    togglePenaltyInput(false);
    const modal = document.getElementById('admin-catering-modal');
    if (modal) modal.classList.remove('hidden');
    if (nameInput) nameInput.focus();
}

export function togglePenaltyInput(show) {
    const box = document.getElementById('penalty-time-box');
    if (box) {
        if (show) box.classList.remove('hidden');
        else box.classList.add('hidden');
    }
}

export function confirmAdminCatering() {
    const nameInput = document.getElementById('admin-catering-customer-name');
    const custName = nameInput ? nameInput.value.trim() : "";
    if (!custName) return showToast("Please enter customer name");

    const isPenalized = document.querySelector('input[name="penalty-option"]:checked')?.value === 'penalized';
    const penMins = isPenalized ? (parseInt(document.getElementById('penalty-minutes-input')?.value) || 10) : 0;

    const target = pendingAdminTarget;
    closeAdminCateringModal();
    if (!target) return;

    const startTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    showSideNotification("FORCE CATER", `Assigned ${custName} to ${target.name}${penMins > 0 ? ` (${penMins}m penalty)` : ''}`, "fa-user-shield", "text-amber-400", "border-amber-500");

    db.ref('roster/' + target.id).update({
        status: 'Catering',
        customerName: custName,
        startTime: startTime,
        pendingPenaltyMinutes: penMins,
        lastUpdated: new Date().toLocaleTimeString()
    });

    updateRosterStatusData('Catering', custName, startTime, 0, target.id, target.name, [], false);
}

export function adminForceStatus(id, name, actionValue) {
    const rosterMembers = globalState.rosterMembers || [];
    const targetRecord = rosterMembers.find(m => (m.telegramId || "").toString() === id.toString());
    const targetType = targetRecord ? targetRecord.userType : "";

    if (!canForceCaterTarget(targetType)) {
        return showToast("⚠️ TL cannot force cater an Admin or TL.");
    }

    if (actionValue === 'Catering') {
        openAdminCateringModal(id, name);
    } else if (actionValue === 'Break' || actionValue === 'End') {
        openSlideDeleteModal(`Sigurado ka bang i-force [${actionValue === 'End' ? 'End Shift' : 'Break'}] si Rider ${name}?`, () => {
            showSideNotification("ADMIN ACTION", `Force updating ${name} to ${actionValue}...`, "fa-user-shield", "text-amber-400", "border-amber-500");
            updateRosterStatus(actionValue, id, name);
        });
    } else if (actionValue === 'VoidActive') {
        openSlideDeleteModal(`I-void ang kasalukuyang order ni Rider ${name}?`, () => {
            showSideNotification("ORDER VOIDED", `Voiding active customer order for ${name}...`, "fa-ban", "text-red-400", "border-red-500");
            adminVoidActiveCustomer(id, name);
        });
    } else {
        showSideNotification("ADMIN ACTION", `Force updating ${name} to ${actionValue}...`, "fa-user-shield", "text-amber-400", "border-amber-500");
        updateRosterStatus(actionValue, id, name);
    }
}

export async function adminVoidActiveCustomer(riderId, riderName) {
    const availableRiders = globalState.rosterMembers ? globalState.rosterMembers.filter(m => m.status === 'Available').sort((a,b) => parseQueueTime(a.queueTime) - parseQueueTime(b.queueTime)) : [];
    let topQueueTime = new Date().getTime();
    if (availableRiders.length > 0) {
        topQueueTime = parseQueueTime(availableRiders[0].queueTime) - 1000;
    }
    await updateRosterStatusData('Available', "", "", topQueueTime, riderId, riderName, [], false);
}

export function adminShiftRiderQueue(riderId, moveAction) {
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
    openSlideDeleteModal("Sigurado ka bang nais mong i-force end shift ang lahat ng riders?", async () => {
        showSideNotification("FORCE ALL END", "Ending shift for all roster riders...", "fa-power-off", "text-red-400", "border-red-500");
        
        const rosterMembers = globalState.rosterMembers || [];
        rosterMembers.forEach(m => { 
            if (m.telegramId) {
                db.ref('roster/' + m.telegramId).update({ status: 'End', customerName: "", startTime: "", pendingPenaltyMinutes: 0, cooldownUntil: 0 });
            }
        });

        try {
            await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ type: "roster", action: "force_all_end" }) });
        } catch(e) {}
    });
}

// --- GLOBAL CATERED HISTORY LIST DISPLAY WITH DURATION & SPLIT TIME ---
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
        if (canManageRoster()) {
            voidBtn = `<button onclick="promptVoidCustomer('${escapeHtml(h.riderName)}', '${escapeHtml(h.customerName)}', '${escapeHtml(h.completedDate)}')" class="bg-red-900/40 text-red-400 hover:bg-red-800 text-[10px] font-bold px-2 py-1 rounded border border-red-700/50 transition active:scale-95"><i class="fa-solid fa-ban"></i> Void</button>`;
        }

        // Calculate or retrieve catering duration
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

export function promptVoidCustomer(riderName, customerName, completedDate) {
    openSlideDeleteModal(`Sigurado ka bang nais i-void si [${customerName}] ni Rider ${riderName}?`, () => {
        executeVoidCustomer(riderName, customerName, completedDate);
    });
}

export async function executeVoidCustomer(riderName, customerName, completedDate) {
    showSideNotification("CUSTOMER VOIDED", `Voiding customer ${customerName} for ${riderName}...`, "fa-ban", "text-red-400", "border-red-500");
    
    db.ref('cateredHistory').once('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            Object.keys(data).forEach(key => {
                const item = data[key];
                if (item.riderName === riderName && item.customerName === customerName && isSameDate(item.completedDate, completedDate)) {
                    db.ref('cateredHistory/' + key).remove();
                }
            });
        }
    });

    try {
        await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ type: "void_history", riderName, customerName, completedDate }) });
    } catch(e) {}
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

// --- EVENT LISTENERS ---
window.addEventListener('rosterUpdated', updateRosterUI);
window.addEventListener('cateredUpdated', loadGlobalCateredList);
window.addEventListener('loginsUpdated', loadGlobalLoginList);
