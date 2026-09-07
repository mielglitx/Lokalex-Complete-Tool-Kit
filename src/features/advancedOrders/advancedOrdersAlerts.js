// src/features/advancedOrders/advancedOrdersAlerts.js
import { globalState } from '../../store/state.js';
import { showToast, unlockAudioContext } from '../../ui/notifications.js';
import { getLocalTodayStr } from '../../utils/helpers.js';

let alarmInterval = null;
let alarmTimeout = null;
const triggeredAlerts = new Set();

export function playReminderAlarm() {
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
    }, 25000);
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
    const orders = globalState.globalAdvancedOrders || [];
    const banner = document.getElementById('adv-order-banner');
    const badge = document.getElementById('adv-count-badge');

    if (orders.length === 0) {
        if (banner) banner.classList.add('hidden');
        if (badge) badge.classList.add('hidden');
        return;
    }

    const now = new Date();
    let highestUrgencyOrder = null;
    let highestUrgencyLevel = 0; // 1: 30m, 2: 15m, 3: 5m
    let activePendingCount = 0;
    let shouldPlayAlarm = false;

    orders.forEach(ord => {
        const status = (ord.status || 'Pending').toLowerCase();
        if (status === 'catered' || status === 'cancelled') return;

        activePendingCount++;
        if (!ord.timeToReceive) return;

        const dateStr = ord.dateToReceive || getLocalTodayStr();
        const dateParts = dateStr.split('-');
        const timeParts = ord.timeToReceive.split(':');
        if (timeParts.length < 2 || dateParts.length < 3) return;

        const targetDate = new Date(
            parseInt(dateParts[0], 10),
            parseInt(dateParts[1], 10) - 1,
            parseInt(dateParts[2], 10),
            parseInt(timeParts[0], 10),
            parseInt(timeParts[1], 10),
            0, 0
        );

        const diffMins = Math.round((targetDate.getTime() - now.getTime()) / 60000);
        const orderKey = ord.id || ord.key || `${ord.custName}_${dateStr}_${ord.timeToReceive}`;

        if (diffMins >= -20 && diffMins <= 30) {
            if (diffMins <= 5) {
                if (highestUrgencyLevel < 3) {
                    highestUrgencyOrder = ord;
                    highestUrgencyLevel = 3;
                }
                if (!triggeredAlerts.has(`${orderKey}_5m`)) {
                    triggeredAlerts.add(`${orderKey}_5m`);
                    shouldPlayAlarm = true;
                }
            } else if (diffMins <= 15) {
                if (highestUrgencyLevel < 2) {
                    highestUrgencyOrder = ord;
                    highestUrgencyLevel = 2;
                }
                if (!triggeredAlerts.has(`${orderKey}_15m`)) {
                    triggeredAlerts.add(`${orderKey}_15m`);
                    shouldPlayAlarm = true;
                }
            } else if (diffMins <= 30) {
                if (highestUrgencyLevel < 1) {
                    highestUrgencyOrder = ord;
                    highestUrgencyLevel = 1;
                }
                if (!triggeredAlerts.has(`${orderKey}_30m`)) {
                    triggeredAlerts.add(`${orderKey}_30m`);
                    shouldPlayAlarm = true;
                }
            }
        }
    });

    if (badge) {
        if (activePendingCount > 0) {
            badge.innerText = activePendingCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    if (banner) {
        if (highestUrgencyOrder && highestUrgencyLevel > 0) {
            const titleEl = document.getElementById('adv-banner-title');
            const msgEl = document.getElementById('adv-banner-msg');

            if (highestUrgencyLevel === 3) {
                if (titleEl) titleEl.innerText = "🚨 5 MINS WARNING: Scheduled Delivery Due!";
                if (msgEl) msgEl.innerText = `${highestUrgencyOrder.custName} — Delivery scheduled for ${highestUrgencyOrder.dateToReceive || ''} ${highestUrgencyOrder.timeToReceive}`;
                banner.className = "bg-red-600/95 text-white p-3 rounded-2xl border border-red-400 shadow-xl flex items-center justify-between gap-2 cursor-pointer animate-pulse";
            } else if (highestUrgencyLevel === 2) {
                if (titleEl) titleEl.innerText = "⚠️ 15 MINS REMINDER: Upcoming Delivery!";
                if (msgEl) msgEl.innerText = `${highestUrgencyOrder.custName} — Due at ${highestUrgencyOrder.dateToReceive || ''} ${highestUrgencyOrder.timeToReceive}`;
                banner.className = "bg-amber-600/95 text-white p-3 rounded-2xl border border-amber-400 shadow-xl flex items-center justify-between gap-2 cursor-pointer";
            } else if (highestUrgencyLevel === 1) {
                if (titleEl) titleEl.innerText = "🔔 30 MINS NOTICE: Scheduled Delivery Ahead";
                if (msgEl) msgEl.innerText = `${highestUrgencyOrder.custName} — Scheduled at ${highestUrgencyOrder.dateToReceive || ''} ${highestUrgencyOrder.timeToReceive}`;
                banner.className = "bg-blue-600/95 text-white p-3 rounded-2xl border border-blue-400 shadow-xl flex items-center justify-between gap-2 cursor-pointer";
            }

            banner.onclick = () => {
                stopReminderAlarm();
                if (window.openAdvancedOrdersModal) window.openAdvancedOrdersModal();
            };

            banner.classList.remove('hidden');

            if (shouldPlayAlarm) {
                playReminderAlarm();
            }
        } else {
            banner.classList.add('hidden');
        }
    }
}

export function addOrderToPhoneCalendar(arg1, timeToReceive = "", address = "", dateToReceive = "") {
    let custName = arg1;
    let time = timeToReceive;
    let addr = address;
    let date = dateToReceive;

    if (!timeToReceive && globalState.globalAdvancedOrders) {
        const found = globalState.globalAdvancedOrders.find(o => (o.id || o.key) === arg1);
        if (found) {
            custName = found.custName || "Customer";
            time = found.timeToReceive || "";
            addr = found.address || "";
            date = found.dateToReceive || getLocalTodayStr();
        }
    }

    if (!time) return showToast("⚠️ No scheduled time for this order.");

    const timeParts = time.split(':');
    const dateStr = date || getLocalTodayStr();
    const dateParts = dateStr.split('-');

    const eventDate = new Date(
        parseInt(dateParts[0], 10),
        parseInt(dateParts[1], 10) - 1,
        parseInt(dateParts[2], 10),
        parseInt(timeParts[0], 10),
        parseInt(timeParts[1], 10),
        0, 0
    );

    const startTimeIso = eventDate.toISOString().replace(/-|:|\.\d\d\d/g, "");
    const endDate = new Date(eventDate.getTime() + 30 * 60000);
    const endTimeIso = endDate.toISOString().replace(/-|:|\.\d\d\d/g, "");

    const title = encodeURIComponent(`🛵 Lokalex Delivery: ${custName}`);
    const details = encodeURIComponent(`Scheduled Lokalex Order for ${custName} on ${dateStr} at ${time}.`);
    const loc = encodeURIComponent(addr || "");

    window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startTimeIso}/${endTimeIso}&details=${details}&location=${loc}`, '_blank');
}