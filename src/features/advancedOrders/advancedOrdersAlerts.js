// src/features/advancedOrders/advancedOrdersAlerts.js

/**
 * ============================================================================
 * ADVANCED ORDERS SCHEDULE WATCHDOG & ALERTS ENGINE
 * ============================================================================
 * 
 * Description:
 * Manages real-time urgency monitoring for scheduled delivery orders.
 * - Parses and normalizes scheduled times (12-hour AM/PM and 24-hour formats).
 * - Computes live time deltas (30m, 15m, 5m thresholds) against the system clock.
 * - Drives dynamic countdown alert banners on the rider home dashboard.
 * - Triggers Web Audio API synthesized alarm chimes for immediate notification.
 * - Generates Google Calendar event URLs with complete customer order details.
 * ============================================================================
 */

import { globalState } from '../../store/state.js';
import { showToast, unlockAudioContext } from '../../ui/notifications.js';
import { getLocalTodayStr } from '../../utils/helpers.js';

let alarmInterval = null;
let alarmTimeout = null;
const triggeredAlerts = new Set();

/**
 * Parses arbitrary date and time strings into a valid JavaScript Date object.
 * Handles 12-hour AM/PM, 24-hour military time, dashes, slashes, and ISO dates.
 */
export function parseScheduledDateTime(dateStr, timeStr) {
    if (!timeStr) return null;

    const cleanDate = (dateStr || getLocalTodayStr()).trim();
    const cleanTime = timeStr.trim();

    let year, monthIndex, day;

    // 1. Parse Date Components (YYYY-MM-DD, YYYY/MM/DD, or MM/DD/YYYY)
    if (cleanDate.includes('-')) {
        const parts = cleanDate.split('-');
        if (parts[0].length === 4) {
            year = parseInt(parts[0], 10);
            monthIndex = parseInt(parts[1], 10) - 1;
            day = parseInt(parts[2], 10);
        } else {
            monthIndex = parseInt(parts[0], 10) - 1;
            day = parseInt(parts[1], 10);
            year = parseInt(parts[2], 10);
        }
    } else if (cleanDate.includes('/')) {
        const parts = cleanDate.split('/');
        if (parts[0].length === 4) {
            year = parseInt(parts[0], 10);
            monthIndex = parseInt(parts[1], 10) - 1;
            day = parseInt(parts[2], 10);
        } else {
            monthIndex = parseInt(parts[0], 10) - 1;
            day = parseInt(parts[1], 10);
            year = parseInt(parts[2], 10);
        }
    } else {
        const now = new Date();
        year = now.getFullYear();
        monthIndex = now.getMonth();
        day = now.getDate();
    }

    // 2. Parse Time Components (12-hour AM/PM vs 24-hour)
    const timeMatch = cleanTime.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
    if (!timeMatch) return null;

    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const meridian = timeMatch[3] ? timeMatch[3].toUpperCase() : null;

    if (meridian === 'PM' && hours < 12) hours += 12;
    if (meridian === 'AM' && hours === 12) hours = 0;

    const target = new Date(year, monthIndex, day, hours, minutes, 0, 0);
    return isNaN(target.getTime()) ? null : target;
}

/**
 * Triggers dual-tone Web Audio API chime notifications for upcoming deliveries.
 */
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

/**
 * Urgency Evaluator & Banner Controller
 * Scans all scheduled orders, computes time deltas, and updates the dashboard alert banner.
 */
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
    let highestUrgencyDiffMins = 0;
    let activePendingCount = 0;
    let shouldPlayAlarm = false;

    orders.forEach(ord => {
        const status = (ord.status || 'Pending').toLowerCase();
        if (status === 'catered' || status === 'cancelled') return;

        activePendingCount++;
        if (!ord.timeToReceive) return;

        const targetDate = parseScheduledDateTime(ord.dateToReceive, ord.timeToReceive);
        if (!targetDate) return;

        const diffMins = Math.round((targetDate.getTime() - now.getTime()) / 60000);
        const orderKey = (ord.id || ord.key || `${ord.custName}_${ord.dateToReceive}_${ord.timeToReceive}`).toString();

        // Target window: up to 30 mins before scheduled time and up to 30 mins overdue
        if (diffMins >= -30 && diffMins <= 30) {
            if (diffMins <= 5) {
                if (highestUrgencyLevel < 3) {
                    highestUrgencyOrder = ord;
                    highestUrgencyLevel = 3;
                    highestUrgencyDiffMins = diffMins;
                }
                if (!triggeredAlerts.has(`${orderKey}_5m`)) {
                    triggeredAlerts.add(`${orderKey}_5m`);
                    shouldPlayAlarm = true;
                }
            } else if (diffMins <= 15) {
                if (highestUrgencyLevel < 2) {
                    highestUrgencyOrder = ord;
                    highestUrgencyLevel = 2;
                    highestUrgencyDiffMins = diffMins;
                }
                if (!triggeredAlerts.has(`${orderKey}_15m`)) {
                    triggeredAlerts.add(`${orderKey}_15m`);
                    shouldPlayAlarm = true;
                }
            } else if (diffMins <= 30) {
                if (highestUrgencyLevel < 1) {
                    highestUrgencyOrder = ord;
                    highestUrgencyLevel = 1;
                    highestUrgencyDiffMins = diffMins;
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

            let countdownText = "";
            if (highestUrgencyDiffMins > 0) {
                countdownText = `(Due in ${highestUrgencyDiffMins} min${highestUrgencyDiffMins === 1 ? '' : 's'})`;
            } else if (highestUrgencyDiffMins === 0) {
                countdownText = `(Due right now!)`;
            } else {
                countdownText = `(Overdue by ${Math.abs(highestUrgencyDiffMins)} min${Math.abs(highestUrgencyDiffMins) === 1 ? '' : 's'}!)`;
            }

            const custLabel = highestUrgencyOrder.custName || "Customer";
            const timeLabel = highestUrgencyOrder.timeToReceive || "";

            if (highestUrgencyLevel === 3) {
                if (titleEl) titleEl.innerText = `🚨 5 MINS WARNING: Scheduled Delivery ${countdownText}`;
                if (msgEl) msgEl.innerText = `${custLabel} — Due at ${timeLabel}${highestUrgencyOrder.address ? ` • ${highestUrgencyOrder.address}` : ''}`;
                banner.className = "bg-red-600 text-white p-3 rounded-2xl border border-red-400 shadow-xl flex items-center justify-between gap-2 cursor-pointer animate-pulse select-none";
            } else if (highestUrgencyLevel === 2) {
                if (titleEl) titleEl.innerText = `⚠️ 15 MINS REMINDER: Delivery Upcoming ${countdownText}`;
                if (msgEl) msgEl.innerText = `${custLabel} — Due at ${timeLabel}${highestUrgencyOrder.address ? ` • ${highestUrgencyOrder.address}` : ''}`;
                banner.className = "bg-amber-600 text-white p-3 rounded-2xl border border-amber-400 shadow-xl flex items-center justify-between gap-2 cursor-pointer select-none";
            } else if (highestUrgencyLevel === 1) {
                if (titleEl) titleEl.innerText = `🔔 30 MINS NOTICE: Scheduled Delivery Ahead ${countdownText}`;
                if (msgEl) msgEl.innerText = `${custLabel} — Scheduled for ${timeLabel}${highestUrgencyOrder.address ? ` • ${highestUrgencyOrder.address}` : ''}`;
                banner.className = "bg-blue-600 text-white p-3 rounded-2xl border border-blue-400 shadow-xl flex items-center justify-between gap-2 cursor-pointer select-none";
            }

            banner.onclick = () => {
                stopReminderAlarm();
                if (typeof window.openAdvancedOrdersModal === 'function') {
                    window.openAdvancedOrdersModal();
                }
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

/**
 * Formats a Google Calendar export URL to sync order reminders to device calendar.
 */
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

    const eventDate = parseScheduledDateTime(date, time);
    if (!eventDate) return showToast("⚠️ Invalid scheduled time format.");

    const startTimeIso = eventDate.toISOString().replace(/-|:|\.\d\d\d/g, "");
    const endDate = new Date(eventDate.getTime() + 30 * 60000);
    const endTimeIso = endDate.toISOString().replace(/-|:|\.\d\d\d/g, "");

    const title = encodeURIComponent(`🛵 Lokalex Delivery: ${custName}`);
    const details = encodeURIComponent(`Scheduled Lokalex Order for ${custName} on ${date || getLocalTodayStr()} at ${time}.`);
    const loc = encodeURIComponent(addr || "");

    window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startTimeIso}/${endTimeIso}&details=${details}&location=${loc}`, '_blank');
}