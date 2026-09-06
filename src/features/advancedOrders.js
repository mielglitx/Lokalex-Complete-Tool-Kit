// src/features/advancedOrders.js
import { db } from '../config/firebase.js';
import { appState, globalState } from '../store/state.js';
import { showToast, unlockAudioContext } from '../ui/notifications.js';
import { escapeHtml, getLocalTodayStr } from '../utils/helpers.js';

let alarmInterval = null;
let alarmTimeout = null;
const triggeredAlerts = new Set();

// -------------------------------------------------------------
// AUDIO REMINDER CHIME & ALARM
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// MULTI-TIER DELIVERY REMINDER WATCHDOG (30m, 15m, 5m BANNERS)
// -------------------------------------------------------------
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

        // Alert window: From 30 mins before up to 20 mins overdue
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

// -------------------------------------------------------------
// CUSTOM IN-APP MODAL PROMPT (NO BROWSER PROMPT BLOCKING)
// -------------------------------------------------------------
function promptRiderNameInModal({ title, subtitle, defaultValue, confirmBtnText, confirmBtnClass, onConfirm }) {
    let modal = document.getElementById('adv-order-prompt-modal');

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'adv-order-prompt-modal';
        modal.className = 'fixed inset-0 z-[99999] bg-black/80 backdrop-blur-xs flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 w-full max-w-sm rounded-3xl p-5 shadow-2xl flex flex-col gap-3.5 animate-in fade-in zoom-in-95 duration-150">
                <div class="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-2.5">
                    <div>
                        <h3 id="adv-prompt-modal-title" class="text-sm font-black text-gray-900 dark:text-white">Assign Rider</h3>
                        <p id="adv-prompt-modal-sub" class="text-[11px] text-gray-500 dark:text-gray-400">Enter rider name</p>
                    </div>
                    <button type="button" id="adv-prompt-close-x" class="text-gray-400 hover:text-gray-700 dark:hover:text-white p-1 text-sm transition">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div>
                    <label class="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Rider Name *</label>
                    <input type="text" id="adv-prompt-modal-input" placeholder="e.g. John Doe" class="w-full bg-inputBg text-xs rounded-xl p-3 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white font-bold mt-1 focus:border-purple-500">
                </div>
                <div class="flex gap-2 pt-1">
                    <button type="button" id="adv-prompt-btn-cancel" class="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xs transition active:scale-95">Cancel</button>
                    <button type="button" id="adv-prompt-btn-confirm" class="flex-1 py-2.5 rounded-xl text-white font-bold text-xs transition active:scale-95 shadow">Confirm</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const titleEl = document.getElementById('adv-prompt-modal-title');
    const subEl = document.getElementById('adv-prompt-modal-sub');
    const inputEl = document.getElementById('adv-prompt-modal-input');
    const confirmBtn = document.getElementById('adv-prompt-btn-confirm');
    const cancelBtn = document.getElementById('adv-prompt-btn-cancel');
    const closeX = document.getElementById('adv-prompt-close-x');

    if (titleEl) titleEl.innerText = title || "Assign Rider";
    if (subEl) subEl.innerText = subtitle || "Pangalan ng Rider";
    if (inputEl) {
        inputEl.value = defaultValue || "";
        setTimeout(() => { inputEl.focus(); inputEl.select(); }, 100);
    }

    if (confirmBtn) {
        confirmBtn.innerText = confirmBtnText || "Confirm";
        confirmBtn.className = `flex-1 py-2.5 rounded-xl text-white font-bold text-xs transition active:scale-95 shadow ${confirmBtnClass || 'bg-purple-600 hover:bg-purple-500'}`;
    }

    const closeModal = () => {
        modal.classList.add('hidden');
    };

    const handleConfirm = () => {
        const val = inputEl ? inputEl.value.trim() : "";
        closeModal();
        if (onConfirm) onConfirm(val);
    };

    if (cancelBtn) cancelBtn.onclick = closeModal;
    if (closeX) closeX.onclick = closeModal;
    if (confirmBtn) confirmBtn.onclick = handleConfirm;

    if (inputEl) {
        inputEl.onkeydown = (e) => {
            if (e.key === 'Enter') handleConfirm();
            if (e.key === 'Escape') closeModal();
        };
    }

    modal.classList.remove('hidden');
}

// -------------------------------------------------------------
// TAB SWITCHER (LIST vs NEW ORDER)
// -------------------------------------------------------------
export function switchAdvTab(tab) {
    const listBtn = document.getElementById('adv-tab-btn-list');
    const addBtn = document.getElementById('adv-tab-btn-add');
    const listContent = document.getElementById('adv-tab-list-content');
    const addContent = document.getElementById('adv-tab-add-content');

    if (tab === 'list') {
        if (listBtn) listBtn.className = "flex-1 py-1.5 rounded-lg bg-purple-600 text-white font-bold transition shadow";
        if (addBtn) addBtn.className = "flex-1 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-bold transition";
        if (listContent) listContent.classList.remove('hidden'); 
        if (addContent) addContent.classList.add('hidden');
        renderAdvancedOrdersList();
    } else {
        if (addBtn) addBtn.className = "flex-1 py-1.5 rounded-lg bg-purple-600 text-white font-bold transition shadow";
        if (listBtn) listBtn.className = "flex-1 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-bold transition";
        if (addContent) addContent.classList.remove('hidden'); 
        if (listContent) listContent.classList.add('hidden');

        const dateInput = document.getElementById('adv-receive-date');
        if (dateInput && !dateInput.value) {
            dateInput.value = getLocalTodayStr();
        }
    }
}

// -------------------------------------------------------------
// RENDER ADVANCED ORDERS LIST
// -------------------------------------------------------------
export function renderAdvancedOrdersList() {
    const container = document.getElementById('adv-tab-list-content');
    if (!container) return;

    const orders = globalState.globalAdvancedOrders || [];

    if (orders.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-8 text-xs">No scheduled advanced orders found.</div>`;
        return;
    }

    container.innerHTML = orders.slice().reverse().map(ord => {
        const ordId = (ord.id || ord.key || "").toString();
        const status = ord.status || "Pending";
        const displayDate = ord.dateToReceive || getLocalTodayStr();
        const cateredBy = ord.cateredBy || "Unassigned";

        let statusBadge = ""; 
        let actionBtns = "";

        if (status === 'Pending') {
            statusBadge = `<span class="bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-200 dark:border-amber-500/30">⏳ Pending</span>`;
            actionBtns = `
                <div class="flex gap-1 items-center flex-wrap">
                    <button type="button" onclick="window.addOrderToPhoneCalendar && window.addOrderToPhoneCalendar('${escapeHtml(ordId)}')" class="bg-blue-50 hover:bg-blue-100 dark:bg-blue-600/30 dark:hover:bg-blue-600/50 border border-blue-200 dark:border-blue-500/50 text-blue-700 dark:text-blue-300 text-[10px] font-bold px-2 py-1 rounded-lg transition active:scale-95" title="Add to Calendar / Alarm"><i class="fa-solid fa-bell"></i> Alarm</button>
                    <button type="button" onclick="window.takeAdvancedOrder && window.takeAdvancedOrder('${escapeHtml(ordId)}')" class="bg-purple-600 hover:bg-purple-500 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95 shadow"><i class="fa-solid fa-motorcycle"></i> Being Catered</button>
                    <button type="button" onclick="window.markAdvancedOrderDone && window.markAdvancedOrderDone('${escapeHtml(ordId)}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95 shadow"><i class="fa-solid fa-check"></i> Done</button>
                    <button type="button" onclick="window.changeAdvOrderStatus && window.changeAdvOrderStatus('${escapeHtml(ordId)}', 'Cancelled')" class="bg-red-50 hover:bg-red-100 dark:bg-red-900/40 dark:hover:bg-red-900/60 border border-red-200 dark:border-red-700/50 text-red-600 dark:text-red-400 font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95"><i class="fa-solid fa-ban"></i> Cancel</button>
                </div>`;
        } else if (status === 'Catering') {
            statusBadge = `<span class="bg-orange-50 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400 text-[10px] font-bold px-2 py-0.5 rounded border border-orange-200 dark:border-orange-500/30 animate-pulse">🛵 Being Catered: ${escapeHtml(cateredBy)}</span>`;
            actionBtns = `
                <div class="flex gap-1 items-center flex-wrap">
                    <button type="button" onclick="window.takeAdvancedOrder && window.takeAdvancedOrder('${escapeHtml(ordId)}')" class="bg-purple-50 hover:bg-purple-100 dark:bg-purple-600/30 border border-purple-200 dark:border-purple-500/50 text-purple-700 dark:text-purple-300 font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95" title="Reassign Rider"><i class="fa-solid fa-user-pen"></i> Reassign</button>
                    <button type="button" onclick="window.markAdvancedOrderDone && window.markAdvancedOrderDone('${escapeHtml(ordId)}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95 shadow"><i class="fa-solid fa-check"></i> Done</button>
                    <button type="button" onclick="window.changeAdvOrderStatus && window.changeAdvOrderStatus('${escapeHtml(ordId)}', 'Cancelled')" class="bg-red-50 hover:bg-red-100 dark:bg-red-900/40 dark:hover:bg-red-900/60 border border-red-200 dark:border-red-700/50 text-red-600 dark:text-red-400 font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95"><i class="fa-solid fa-ban"></i> Cancel</button>
                </div>`;
        } else if (status === 'Catered') {
            statusBadge = `<span class="bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30"><i class="fa-solid fa-check-double"></i> Done by ${escapeHtml(cateredBy)}</span>`;
            actionBtns = `
                <div class="flex items-center gap-2">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 font-bold">Finished</span>
                    <button type="button" onclick="window.changeAdvOrderStatus && window.changeAdvOrderStatus('${escapeHtml(ordId)}', 'Pending')" class="text-blue-500 hover:text-blue-400 text-[10px] font-bold underline transition">Reopen</button>
                </div>`;
        } else if (status === 'Cancelled') {
            statusBadge = `<span class="bg-red-50 dark:bg-red-500/20 text-red-700 dark:text-red-400 text-[10px] font-bold px-2 py-0.5 rounded border border-red-200 dark:border-red-500/30"><i class="fa-solid fa-xmark"></i> Cancelled</span>`;
            actionBtns = `
                <div class="flex items-center gap-2">
                    <span class="text-[10px] text-gray-400 italic">Cancelled</span>
                    <button type="button" onclick="window.changeAdvOrderStatus && window.changeAdvOrderStatus('${escapeHtml(ordId)}', 'Pending')" class="text-blue-500 hover:text-blue-400 text-[10px] font-bold underline transition">Restore</button>
                </div>`;
        }

        return `
        <div class="bg-white dark:bg-cardBg border ${status === 'Pending' ? 'border-purple-300 dark:border-purple-500/40' : status === 'Catering' ? 'border-orange-300 dark:border-orange-500/50' : 'border-gray-200 dark:border-gray-800'} p-3 rounded-2xl flex flex-col gap-1.5 text-xs shadow-xs">
            <div class="flex justify-between items-center font-bold">
                <span class="text-purple-700 dark:text-purple-300 text-sm font-black flex items-center gap-1.5"><i class="fa-solid fa-user text-[11px]"></i> ${escapeHtml(ord.custName)}</span>
                <span class="text-emerald-700 dark:text-emerald-400 font-mono font-bold"><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(displayDate)} <i class="fa-solid fa-clock ml-1"></i> ${escapeHtml(ord.timeToReceive)}</span>
            </div>
            ${ord.receiver ? `<div class="text-[10px] text-gray-600 dark:text-gray-400 font-medium">Receiver: <span class="text-gray-900 dark:text-gray-200 font-bold">${escapeHtml(ord.receiver)}</span></div>` : ''}
            ${ord.address ? `<div class="text-[10px] text-gray-700 dark:text-gray-300 font-medium flex items-center gap-1"><i class="fa-solid fa-location-dot text-red-500 text-[9px]"></i> ${escapeHtml(ord.address)}</div>` : ''}
            <div class="flex justify-between items-center mt-1 pt-1.5 border-t border-gray-100 dark:border-gray-800">
                ${statusBadge} ${actionBtns}
            </div>
        </div>`;
    }).join('');
}

// -------------------------------------------------------------
// SUBMIT NEW ADVANCED ORDER RECORD
// -------------------------------------------------------------
export async function submitNewAdvancedOrder() {
    const custName = document.getElementById('adv-cust-name')?.value.trim() || '';
    const receiver = document.getElementById('adv-receiver')?.value.trim() || '';
    const address = document.getElementById('adv-address')?.value.trim() || '';
    const contactNum = document.getElementById('adv-contact')?.value.trim() || '';
    const dateToReceive = document.getElementById('adv-receive-date')?.value || getLocalTodayStr();
    const timeToReceive = document.getElementById('adv-receive-time')?.value.trim() || '';

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

    if (db) {
        const pushRef = db.ref('advancedOrders').push();
        newOrd.id = pushRef.key;
        newOrd.key = pushRef.key;
        await pushRef.set(newOrd);
    }

    const nameEl = document.getElementById('adv-cust-name');
    const recEl = document.getElementById('adv-receiver');
    const addrEl = document.getElementById('adv-address');
    const conEl = document.getElementById('adv-contact');
    const timeEl = document.getElementById('adv-receive-time');
    const dateEl = document.getElementById('adv-receive-date');

    if (nameEl) nameEl.value = "";
    if (recEl) recEl.value = "";
    if (addrEl) addrEl.value = "";
    if (conEl) conEl.value = "";
    if (timeEl) timeEl.value = "";
    if (dateEl) dateEl.value = getLocalTodayStr();

    showToast(`✅ Scheduled order created for ${custName} on ${dateToReceive}!`);
    switchAdvTab('list');
}

// -------------------------------------------------------------
// ACTION: BEING CATERED (RECORD LOG ONLY, NO ROSTER MUTATION)
// -------------------------------------------------------------
export function takeAdvancedOrder(orderId) {
    stopReminderAlarm();

    const ord = (globalState.globalAdvancedOrders || []).find(o => (o.id || o.key || "").toString() === (orderId || "").toString());
    if (!ord) return showToast("⚠️ Order record not found.");

    const defaultRider = ord.cateredBy || appState.riderName || localStorage.getItem('riderName') || "";

    promptRiderNameInModal({
        title: "Being Catered",
        subtitle: `Sino ang mag-cacater ng order ni ${ord.custName}?`,
        defaultValue: defaultRider,
        confirmBtnText: "CONFIRM CATERING",
        confirmBtnClass: "bg-purple-600 hover:bg-purple-500",
        onConfirm: async (riderName) => {
            const finalName = riderName || defaultRider || "Rider";

            ord.status = "Catering";
            ord.cateredBy = finalName;

            const targetKey = ord.id || ord.key;
            if (db && targetKey) {
                await db.ref(`advancedOrders/${targetKey}`).update({
                    status: "Catering",
                    cateredBy: finalName,
                    cateringStartedAt: Date.now()
                }).catch(() => {});
            }

            renderAdvancedOrdersList();
            checkScheduledDeliveryAlerts();
            showToast(`🛵 Order ni ${ord.custName} ay kini-cater na ni ${finalName}!`);
        }
    });
}

// -------------------------------------------------------------
// ACTION: MARK DONE (RECORD LOG ONLY, NO ROSTER MUTATION)
// -------------------------------------------------------------
export function markAdvancedOrderDone(orderId) {
    stopReminderAlarm();

    const ord = (globalState.globalAdvancedOrders || []).find(o => (o.id || o.key || "").toString() === (orderId || "").toString());
    if (!ord) return showToast("⚠️ Order record not found.");

    const defaultRider = ord.cateredBy || appState.riderName || localStorage.getItem('riderName') || "";

    promptRiderNameInModal({
        title: "Mark as Done",
        subtitle: `Sino ang nag-cater sa order ni ${ord.custName}?`,
        defaultValue: defaultRider,
        confirmBtnText: "MARK ORDER DONE",
        confirmBtnClass: "bg-emerald-600 hover:bg-emerald-500",
        onConfirm: async (riderName) => {
            const finalName = riderName || defaultRider || "Rider";

            ord.status = "Catered";
            ord.cateredBy = finalName;

            const targetKey = ord.id || ord.key;
            if (db && targetKey) {
                await db.ref(`advancedOrders/${targetKey}`).update({
                    status: "Catered",
                    cateredBy: finalName,
                    completedAt: Date.now()
                }).catch(() => {});
            }

            renderAdvancedOrdersList();
            checkScheduledDeliveryAlerts();
            showToast(`✅ Order ni ${ord.custName} ay minarkahang Done ni ${finalName}!`);
        }
    });
}

// -------------------------------------------------------------
// CHANGE STATUS DIRECTLY (CANCEL / RESTORE / REOPEN)
// -------------------------------------------------------------
export async function changeAdvOrderStatus(orderId, newStatus) {
    const ord = (globalState.globalAdvancedOrders || []).find(o => (o.id || o.key || "").toString() === (orderId || "").toString());
    if (!ord) return;

    ord.status = newStatus;
    if (newStatus === 'Pending') {
        ord.cateredBy = "";
    }

    const targetKey = ord.id || ord.key;
    if (db && targetKey) {
        await db.ref(`advancedOrders/${targetKey}`).update({
            status: newStatus,
            cateredBy: ord.cateredBy || ""
        }).catch(() => {});
    }

    renderAdvancedOrdersList();
    checkScheduledDeliveryAlerts();
    showToast(`Order status updated to ${newStatus}.`);
}

export function autoCompleteAdvancedOrdersForRider(riderName) {
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
                    status: 'Catered',
                    completedAt: Date.now()
                }).catch(() => {});
            }
        });
    });
}

export function autoCancelAdvancedOrdersForRider(riderName) {
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
                }).catch(() => {});
            }
        });
    });
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

// -------------------------------------------------------------
// AUTOMATIC 15-SECOND WATCHDOG TICKER & GLOBAL ATTACHMENTS
// -------------------------------------------------------------
if (typeof window !== 'undefined') {
    window.switchAdvTab = switchAdvTab;
    window.renderAdvancedOrdersList = renderAdvancedOrdersList;
    window.submitNewAdvancedOrder = submitNewAdvancedOrder;
    window.takeAdvancedOrder = takeAdvancedOrder;
    window.markAdvancedOrderDone = markAdvancedOrderDone;
    window.changeAdvOrderStatus = changeAdvOrderStatus;
    window.autoCompleteAdvancedOrdersForRider = autoCompleteAdvancedOrdersForRider;
    window.autoCancelAdvancedOrdersForRider = autoCancelAdvancedOrdersForRider;
    window.addOrderToPhoneCalendar = addOrderToPhoneCalendar;
    window.checkScheduledDeliveryAlerts = checkScheduledDeliveryAlerts;
    window.stopReminderAlarm = stopReminderAlarm;

    setInterval(checkScheduledDeliveryAlerts, 15000);
}