// src/features/advancedOrders.js
import { db } from '../config/firebase.js';
import { appState, globalState } from '../store/state.js';
import { showToast, unlockAudioContext } from '../ui/notifications.js';
import { escapeHtml, getLocalTodayStr } from '../utils/helpers.js';
import { updateRosterStatusData, parseQueueTime } from './roster/index.js';

let alarmInterval = null;
let alarmTimeout = null;
const triggeredAlerts = new Set();

function playReminderAlarm() {
    unlockAudioContext();
    stopReminderAlarm();

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const audioCtx = new AudioContext();

    alarmInterval = setInterval(() => {
        try {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const now = audioCtx.currentTime;

            [659.25, 880].forEach((freq, i) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now + (i * 0.15));

                gain.gain.setValueAtTime(0.3, now + (i * 0.15));
                gain.gain.exponentialRampToValueAtTime(0.001, now + (i * 0.15) + 0.3);

                osc.connect(gain);
                gain.connect(audioCtx.destination);

                osc.start(now + (i * 0.15));
                osc.stop(now + (i * 0.15) + 0.3);
            });
        } catch (e) {}
    }, 1200);

    alarmTimeout = setTimeout(() => {
        stopReminderAlarm();
    }, 30000);
}

export function stopReminderAlarm() {
    if (alarmInterval) {
        clearInterval(alarmInterval);
        alarmInterval = null;
    }
    if (alarmTimeout) {
        clearTimeout(alarmTimeout);
        alarmTimeout = null;
    }
}

export function checkScheduledDeliveryAlerts() {
    if (!globalState.globalAdvancedOrders || globalState.globalAdvancedOrders.length === 0) return;

    const now = new Date();
    let alertOrder = null;
    let urgentLevel = 0;
    let pendingCount = 0;
    let shouldPlayAlarm = false;

    globalState.globalAdvancedOrders.forEach(ord => {
        if (ord.status && ord.status !== 'Pending') return;
        pendingCount++;
        if (!ord.timeToReceive) return;

        const dateStr = ord.dateToReceive || getLocalTodayStr();
        const dateParts = dateStr.split('-');
        const timeParts = ord.timeToReceive.split(':');
        if (timeParts.length < 2 || dateParts.length < 3) return;

        const targetDate = new Date(
            parseInt(dateParts[0]),
            parseInt(dateParts[1]) - 1,
            parseInt(dateParts[2]),
            parseInt(timeParts[0]),
            parseInt(timeParts[1]),
            0, 0
        );

        const diffMins = Math.round((targetDate - now) / 60000);
        const orderKey = `${ord.custName}_${dateStr}_${ord.timeToReceive}`;

        if (diffMins >= -10 && diffMins <= 30) {
            if (diffMins <= 5 && urgentLevel < 3) {
                alertOrder = ord; urgentLevel = 3;
                if (!triggeredAlerts.has(`${orderKey}_5m`)) {
                    triggeredAlerts.add(`${orderKey}_5m`);
                    shouldPlayAlarm = true;
                }
            } else if (diffMins <= 15 && urgentLevel < 2) {
                alertOrder = ord; urgentLevel = 2;
                if (!triggeredAlerts.has(`${orderKey}_15m`)) {
                    triggeredAlerts.add(`${orderKey}_15m`);
                    shouldPlayAlarm = true;
                }
            } else if (diffMins <= 30 && urgentLevel < 1) {
                alertOrder = ord; urgentLevel = 1;
                if (!triggeredAlerts.has(`${orderKey}_30m`)) {
                    triggeredAlerts.add(`${orderKey}_30m`);
                    shouldPlayAlarm = true;
                }
            }
        }
    });

    const badge = document.getElementById('adv-count-badge');
    if (badge) {
        if (pendingCount > 0) {
            badge.innerText = pendingCount; 
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    const banner = document.getElementById('adv-order-banner');
    if (alertOrder && banner) {
        const titleEl = document.getElementById('adv-banner-title');
        const msgEl = document.getElementById('adv-banner-msg');

        if (urgentLevel === 3) {
            if (titleEl) titleEl.innerText = "🚨 URGENT: 5 MINS LEFT FOR SCHEDULED DELIVERY!";
            if (msgEl) msgEl.innerText = `${alertOrder.custName} — ${alertOrder.dateToReceive || ''} ${alertOrder.timeToReceive}`;
        } else if (urgentLevel === 2) {
            if (titleEl) titleEl.innerText = "⚠️ 15 MINS REMAINING FOR SCHEDULED ORDER";
            if (msgEl) msgEl.innerText = `${alertOrder.custName} — Due at ${alertOrder.dateToReceive || ''} ${alertOrder.timeToReceive}`;
        } else {
            if (titleEl) titleEl.innerText = "🔔 30 MINS UPCOMING SCHEDULED DELIVERY";
            if (msgEl) msgEl.innerText = `${alertOrder.custName} — Scheduled at ${alertOrder.dateToReceive || ''} ${alertOrder.timeToReceive}`;
        }
        banner.classList.remove('hidden');

        if (shouldPlayAlarm) {
            playReminderAlarm();
        }
    } else if (banner) {
        banner.classList.add('hidden');
    }
}

export function switchAdvTab(tab) {
    const listBtn = document.getElementById('adv-tab-btn-list');
    const addBtn = document.getElementById('adv-tab-btn-add');
    const listContent = document.getElementById('adv-tab-list-content');
    const addContent = document.getElementById('adv-tab-add-content');

    if (tab === 'list') {
        if (listBtn) listBtn.className = "flex-1 py-1.5 rounded-lg bg-purple-600 text-white transition";
        if (addBtn) addBtn.className = "flex-1 py-1.5 rounded-lg text-gray-400 transition";
        if (listContent) listContent.classList.remove('hidden'); 
        if (addContent) addContent.classList.add('hidden');
        renderAdvancedOrdersList();
    } else {
        if (addBtn) addBtn.className = "flex-1 py-1.5 rounded-lg bg-purple-600 text-white transition";
        if (listBtn) listBtn.className = "flex-1 py-1.5 rounded-lg text-gray-400 transition";
        if (addContent) addContent.classList.remove('hidden'); 
        if (listContent) listContent.classList.add('hidden');

        const dateInput = document.getElementById('adv-receive-date');
        if (dateInput && !dateInput.value) {
            dateInput.value = getLocalTodayStr();
        }
    }
}

export function renderAdvancedOrdersList() {
    const container = document.getElementById('adv-tab-list-content');
    if (!container) return;

    if (!globalState.globalAdvancedOrders || globalState.globalAdvancedOrders.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-8 text-xs">No scheduled advanced orders found.</div>`;
        return;
    }

    container.innerHTML = globalState.globalAdvancedOrders.slice().reverse().map(ord => {
        const status = ord.status || "Pending";
        let statusBadge = ""; let actionBtns = "";

        const displayDate = ord.dateToReceive || getLocalTodayStr();

        if (status === 'Pending') {
            statusBadge = `<span class="bg-amber-500/20 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-500/30">⏳ Pending</span>`;
            actionBtns = `
                <div class="flex gap-1 items-center">
                    <button onclick="addOrderToPhoneCalendar('${escapeHtml(ord.custName)}', '${escapeHtml(ord.timeToReceive)}', '${escapeHtml(ord.address || '')}', '${escapeHtml(displayDate)}')" class="bg-blue-600/30 border border-blue-500/50 text-blue-300 text-[10px] font-bold px-2 py-1 rounded-lg transition active:scale-95"><i class="fa-solid fa-bell"></i> Alarm</button>
                    <button onclick="takeAdvancedOrder('${escapeHtml(ord.custName)}', '${escapeHtml(ord.timeToReceive)}')" class="bg-purple-600 hover:bg-purple-500 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95"><i class="fa-solid fa-motorcycle"></i> Cater Order</button>
                    <button onclick="changeAdvOrderStatus('${escapeHtml(ord.custName)}', '${escapeHtml(ord.timeToReceive)}', 'Cancelled')" class="bg-red-900/40 border border-red-700/50 text-red-400 font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95"><i class="fa-solid fa-ban"></i> Cancel</button>
                </div>`;
        } else if (status === 'Catering') {
            statusBadge = `<span class="bg-orange-500/20 text-orange-400 text-[10px] font-bold px-2 py-0.5 rounded border border-orange-500/30 animate-pulse">🛵 Catering by ${escapeHtml(ord.cateredBy)}</span>`;
            actionBtns = `
                <div class="flex gap-1">
                    <button onclick="changeAdvOrderStatus('${escapeHtml(ord.custName)}', '${escapeHtml(ord.timeToReceive)}', 'Catered')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95"><i class="fa-solid fa-check"></i> Complete</button>
                    <button onclick="changeAdvOrderStatus('${escapeHtml(ord.custName)}', '${escapeHtml(ord.timeToReceive)}', 'Cancelled')" class="bg-red-900/40 border border-red-700/50 text-red-400 font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95"><i class="fa-solid fa-ban"></i> Cancel</button>
                </div>`;
        } else if (status === 'Catered') {
            statusBadge = `<span class="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-500/30"><i class="fa-solid fa-check-double"></i> Catered by ${escapeHtml(ord.cateredBy)}</span>`;
            actionBtns = `<span class="text-[10px] text-gray-400 font-bold">Done</span>`;
        } else if (status === 'Cancelled') {
            statusBadge = `<span class="bg-red-500/20 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded border border-red-500/30"><i class="fa-solid fa-xmark"></i> Cancelled</span>`;
            actionBtns = `<span class="text-[10px] text-gray-500 italic">Order Cancelled</span>`;
        }

        return `
        <div class="bg-cardBg border ${status === 'Pending' ? 'border-purple-500/40' : status === 'Catering' ? 'border-orange-500/50' : 'border-gray-800 opacity-70'} p-3 rounded-xl flex flex-col gap-1.5 text-xs">
            <div class="flex justify-between items-center font-bold">
                <span class="text-purple-300"><i class="fa-solid fa-user"></i> ${escapeHtml(ord.custName)}</span>
                <span class="text-emerald-400 font-mono"><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(displayDate)} <i class="fa-solid fa-clock ml-1"></i> ${escapeHtml(ord.timeToReceive)}</span>
            </div>
            ${ord.receiver ? `<div class="text-[10px] text-gray-400">Receiver: ${escapeHtml(ord.receiver)}</div>` : ''}
            ${ord.address ? `<div class="text-[10px] text-gray-300"><i class="fa-solid fa-location-dot text-red-500"></i> ${escapeHtml(ord.address)}</div>` : ''}
            <div class="flex justify-between items-center mt-1 pt-1.5 border-t border-gray-800">
                ${statusBadge} ${actionBtns}
            </div>
        </div>`;
    }).join('');
}

export async function submitNewAdvancedOrder() {
    const custName = document.getElementById('adv-cust-name').value.trim();
    const receiver = document.getElementById('adv-receiver').value.trim();
    const address = document.getElementById('adv-address').value.trim();
    const contactNum = document.getElementById('adv-contact').value.trim();
    const dateToReceive = document.getElementById('adv-receive-date').value || getLocalTodayStr();
    const timeToReceive = document.getElementById('adv-receive-time').value.trim();

    if (!custName) return showToast("Please enter Customer Name!");
    if (!timeToReceive) return showToast("Please select Scheduled Time!");

    const newOrd = {
        custName: custName,
        timeOrdered: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        receiver: receiver, 
        address: address, 
        contactNum: contactNum,
        dateToReceive: dateToReceive,
        timeToReceive: timeToReceive, 
        status: "Pending", 
        cateredBy: ""
    };

    if (db) db.ref('advancedOrders').push(newOrd);

    document.getElementById('adv-cust-name').value = "";
    document.getElementById('adv-receive-time').value = "";
    document.getElementById('adv-receive-date').value = getLocalTodayStr();
    showToast(`✅ Scheduled order created for ${custName} on ${dateToReceive}!`);
    switchAdvTab('list');
}

export async function takeAdvancedOrder(custName, timeToReceive) {
    stopReminderAlarm();
    const targetOrd = globalState.globalAdvancedOrders.find(o => o.custName === custName && o.timeToReceive === timeToReceive);
    if (targetOrd && targetOrd.status !== 'Pending') return showToast("⚠️ Order was already taken!");

    const myRecord = globalState.rosterMembers ? globalState.rosterMembers.find(m => m.telegramId.toString() === appState.telegramId.toString()) : null;
    if (myRecord && (myRecord.status === 'End' || myRecord.status === 'Break' || myRecord.status === 'Cooldown')) {
        return showToast(`⚠️ You are currently in ${myRecord.status} mode. Please mark as Available first.`);
    }

    if (targetOrd) { targetOrd.status = "Catering"; targetOrd.cateredBy = appState.riderName; }
    changeAdvOrderStatus(custName, timeToReceive, "Catering");

    let existingCusts = (myRecord && myRecord.status === 'Catering' && myRecord.customerName) ? myRecord.customerName.split(', ').map(c=>c.trim()).filter(Boolean) : [];
    let existingTimes = (myRecord && myRecord.status === 'Catering' && myRecord.startTime) ? myRecord.startTime.split(', ').map(t=>t.trim()).filter(Boolean) : [];

    if (!existingCusts.includes(custName)) {
        existingCusts.push(custName);
        const startTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        existingTimes.push(startTime);

        await updateRosterStatusData(
            'Catering', 
            existingCusts.join(', '), 
            existingTimes.join(', '), 
            myRecord ? parseQueueTime(myRecord.queueTime) : 0
        );
    }
}

export async function changeAdvOrderStatus(custName, timeToReceive, newStatus) {
    if (db) {
        db.ref('advancedOrders').once('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                Object.keys(data).forEach(key => {
                    if (data[key].custName === custName && data[key].timeToReceive === timeToReceive) {
                        db.ref('advancedOrders/' + key).update({
                            status: newStatus, cateredBy: (newStatus === 'Pending') ? "" : appState.riderName
                        });
                    }
                });
            }
        });
    }
}

export function autoCompleteAdvancedOrdersForRider(riderName, customerNameStr = "") {
    if (!riderName || !db) return;
    const cleanRider = riderName.toLowerCase().trim();

    db.ref('advancedOrders').once('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        Object.keys(data).forEach(key => {
            const ord = data[key];
            const ordRider = (ord.cateredBy || "").toLowerCase().trim();
            const isCatering = ord.status === 'Catering';

            if (ordRider === cleanRider && isCatering) {
                db.ref(`advancedOrders/${key}`).update({
                    status: 'Catered'
                });
            }
        });
    });
}

export function autoCancelAdvancedOrdersForRider(riderName, customerNameStr = "") {
    if (!riderName || !db) return;
    const cleanRider = riderName.toLowerCase().trim();

    db.ref('advancedOrders').once('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        Object.keys(data).forEach(key => {
            const ord = data[key];
            const ordRider = (ord.cateredBy || "").toLowerCase().trim();
            const isCatering = ord.status === 'Catering';

            if (ordRider === cleanRider && isCatering) {
                db.ref(`advancedOrders/${key}`).update({
                    status: 'Cancelled'
                });
            }
        });
    });
}

export function addOrderToPhoneCalendar(custName, timeToReceive, address, dateToReceive) {
    const timeParts = timeToReceive.split(':');
    const dateStr = dateToReceive || getLocalTodayStr();
    const dateParts = dateStr.split('-');

    const eventDate = new Date(
        parseInt(dateParts[0]),
        parseInt(dateParts[1]) - 1,
        parseInt(dateParts[2]),
        parseInt(timeParts[0]),
        parseInt(timeParts[1]),
        0, 0
    );

    const startTimeIso = eventDate.toISOString().replace(/-|:|\.\d\d\d/g, "");
    const endDate = new Date(eventDate.getTime() + 30 * 60000);
    const endTimeIso = endDate.toISOString().replace(/-|:|\.\d\d\d/g, "");

    const title = encodeURIComponent(`🛵 Lokalex Delivery: ${custName}`);
    const details = encodeURIComponent(`Scheduled Lokalex Order for ${custName} on ${dateStr} at ${timeToReceive}.`);
    const loc = encodeURIComponent(address || "");

    window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startTimeIso}/${endTimeIso}&details=${details}&location=${loc}`, '_blank');
}

if (typeof window !== 'undefined') {
    window.autoCompleteAdvancedOrdersForRider = autoCompleteAdvancedOrdersForRider;
    window.autoCancelAdvancedOrdersForRider = autoCancelAdvancedOrdersForRider;
}