// src/features/advancedOrders.js
import { appState, globalState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { showToast } from '../ui/notifications.js';
import { escapeHtml, getLocalTodayStr } from '../utils/helpers.js';

let activeAdvTab = 'list';

export function openAdvancedOrdersModal() {
    const modal = document.getElementById('adv-orders-modal');
    if (modal) modal.classList.remove('hidden');
    switchAdvTab('list');
    loadAdvancedOrders();
}

export function closeAdvancedOrdersModal() {
    const modal = document.getElementById('adv-orders-modal');
    if (modal) modal.classList.add('hidden');
}

export function switchAdvTab(tab) {
    activeAdvTab = tab;
    const btnList = document.getElementById('adv-tab-btn-list');
    const btnAdd = document.getElementById('adv-tab-btn-add');
    const contentList = document.getElementById('adv-tab-list-content');
    const contentAdd = document.getElementById('adv-tab-add-content');

    if (tab === 'list') {
        if (btnList) btnList.className = "flex-1 py-1.5 rounded-lg bg-purple-600 text-white transition font-bold";
        if (btnAdd) btnAdd.className = "flex-1 py-1.5 rounded-lg text-gray-400 hover:text-white transition font-bold";
        if (contentList) contentList.classList.remove('hidden');
        if (contentAdd) contentAdd.classList.add('hidden');
        loadAdvancedOrders();
    } else {
        if (btnAdd) btnAdd.className = "flex-1 py-1.5 rounded-lg bg-purple-600 text-white transition font-bold";
        if (btnList) btnList.className = "flex-1 py-1.5 rounded-lg text-gray-400 hover:text-white transition font-bold";
        if (contentAdd) contentAdd.classList.remove('hidden');
        if (contentList) contentList.classList.add('hidden');
    }
}

export function loadAdvancedOrders() {
    const container = document.getElementById('adv-tab-list-content');
    if (!container) return;

    db.ref('advancedOrders').once('value').then(snapshot => {
        const data = snapshot.val();
        if (!data) {
            container.innerHTML = `<div class="text-center text-gray-500 italic py-8 text-xs">Walang naka-schedule na advanced orders.</div>`;
            updateAdvBadgeCount(0);
            checkScheduledOrdersAlert([]);
            return;
        }

        const ordersList = [];
        for (let key in data) {
            ordersList.push({ id: key, ...data[key] });
        }

        const activeOrders = ordersList.filter(o => !o.status || o.status === 'pending' || o.status === 'catered');
        updateAdvBadgeCount(activeOrders.length);
        checkScheduledOrdersAlert(activeOrders);

        if (activeOrders.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-500 italic py-8 text-xs">Walang active advanced orders.</div>`;
            return;
        }

        container.innerHTML = activeOrders.map(order => {
            const isCatered = order.status === 'catered';
            const customerName = order.custName || order.customerName || "Customer";

            return `
                <div class="bg-darkBg p-3 rounded-xl border border-gray-800 flex flex-col gap-2 text-xs shadow-sm">
                    <div class="flex justify-between items-start border-b border-gray-800 pb-1.5">
                        <div>
                            <span class="font-bold text-purple-300 text-sm"><i class="fa-solid fa-user"></i> ${escapeHtml(customerName)}</span>
                            ${order.receiver ? `<div class="text-[10px] text-gray-400">Receiver: ${escapeHtml(order.receiver)}</div>` : ''}
                        </div>
                        <span class="bg-purple-950/60 text-purple-300 border border-purple-800/60 text-[10px] font-bold px-2 py-0.5 rounded-md">
                            <i class="fa-solid fa-clock"></i> ${escapeHtml(order.receiveTime || "Anytime")}
                        </span>
                    </div>

                    ${order.address ? `<div class="text-[11px] text-gray-300"><i class="fa-solid fa-location-dot text-red-400 mr-1"></i> ${escapeHtml(order.address)}</div>` : ''}
                    ${order.contact ? `<div class="text-[11px] text-gray-400"><i class="fa-solid fa-phone text-emerald-400 mr-1"></i> ${escapeHtml(order.contact)}</div>` : ''}

                    <div class="flex justify-between items-center pt-1.5 border-t border-gray-800/60 mt-1">
                        ${isCatered ? `
                            <span class="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                                <i class="fa-solid fa-check-circle"></i> Catered by ${escapeHtml(order.cateredByRiderName || "Rider")}
                            </span>
                        ` : `
                            <button onclick="caterAdvancedOrder('${order.id}', '${escapeHtml(customerName)}')" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 rounded-lg text-xs transition active:scale-95 flex items-center justify-center gap-1.5 shadow">
                                <i class="fa-solid fa-motorcycle"></i> CATER THIS ORDER NOW
                            </button>
                        `}
                    </div>
                </div>
            `;
        }).join('');
    });
}

function updateAdvBadgeCount(count) {
    const badge = document.getElementById('adv-count-badge');
    if (badge) {
        if (count > 0) {
            badge.innerText = count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

function checkScheduledOrdersAlert(activeOrders) {
    const banner = document.getElementById('adv-order-banner');
    const msgEl = document.getElementById('adv-banner-msg');
    if (!banner || !msgEl) return;

    const pendingOrders = activeOrders.filter(o => o.status === 'pending');
    if (pendingOrders.length > 0) {
        msgEl.innerText = `May ${pendingOrders.length} active scheduled order(s) na kailangang i-deliver!`;
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }
}

export function submitNewAdvancedOrder() {
    const custName = document.getElementById('adv-cust-name')?.value.trim();
    const receiver = document.getElementById('adv-receiver')?.value.trim();
    const address = document.getElementById('adv-address')?.value.trim();
    const contact = document.getElementById('adv-contact')?.value.trim();
    const receiveTime = document.getElementById('adv-receive-time')?.value;

    if (!custName) {
        showToast("⚠️ Paki-lagay ang Customer Name!");
        return;
    }

    const newOrder = {
        customerName: custName,
        custName: custName,
        receiver: receiver || "",
        address: address || "",
        contact: contact || "",
        receiveTime: receiveTime || "",
        status: "pending",
        createdAt: Date.now(),
        date: getLocalTodayStr()
    };

    db.ref('advancedOrders').push(newOrder).then(() => {
        showToast("✅ Advanced Order Scheduled!");
        if (document.getElementById('adv-cust-name')) document.getElementById('adv-cust-name').value = "";
        if (document.getElementById('adv-receiver')) document.getElementById('adv-receiver').value = "";
        if (document.getElementById('adv-address')) document.getElementById('adv-address').value = "";
        if (document.getElementById('adv-contact')) document.getElementById('adv-contact').value = "";
        if (document.getElementById('adv-receive-time')) document.getElementById('adv-receive-time').value = "";
        switchAdvTab('list');
    });
}

// ============================================================================
// CATER ADVANCED ORDER (SAFE DE-DUPLICATION & CUSTOMER ATTACHMENT)
// ============================================================================
export function caterAdvancedOrder(orderId, customerName) {
    const myId = (appState.telegramId || "").toString().trim();
    const myName = appState.riderName || "Rider";

    if (!myId) {
        showToast("⚠️ Paki-login muna bago mag-cater ng order!");
        return;
    }

    // 1. Mark Order as Catered in Database
    db.ref(`advancedOrders/${orderId}`).update({
        status: 'catered',
        cateredByRiderId: myId,
        cateredByRiderName: myName,
        cateredAt: Date.now()
    });

    // 2. Fetch active roster to safely move rider from Available -> Catering without duplicates
    db.ref('roster').once('value').then(snapshot => {
        const rosterData = snapshot.val() || {};
        let targetKey = null;
        let currentCustNames = [];

        for (let key in rosterData) {
            const rec = rosterData[key];
            const recId = (rec.telegramId || "").toString().trim();
            const recName = (rec.name || "").trim().toLowerCase();

            if ((myId && recId === myId) || (myName && recName === myName.toLowerCase())) {
                if (!targetKey) {
                    targetKey = key;
                } else {
                    // Remove duplicate database keys if found
                    db.ref(`roster/${key}`).remove();
                }
                if (rec.customerName && (rec.status || "").toLowerCase() === 'catering') {
                    const existing = rec.customerName.split(',').map(s => s.trim()).filter(Boolean);
                    existing.forEach(n => {
                        if (!currentCustNames.includes(n)) currentCustNames.push(n);
                    });
                }
            }
        }

        if (!currentCustNames.includes(customerName)) {
            currentCustNames.push(customerName);
        }
        const combinedCustomerName = currentCustNames.join(', ');

        const updatedPayload = {
            telegramId: myId,
            name: myName,
            status: 'Catering',
            customerName: combinedCustomerName,
            timestamp: Date.now()
        };

        if (targetKey) {
            db.ref(`roster/${targetKey}`).set(updatedPayload);
        } else {
            db.ref('roster').push(updatedPayload);
        }

        closeAdvancedOrdersModal();
        showToast(`🛵 Catering Advanced Order for ${customerName}!`);
    });
}

window.openAdvancedOrdersModal = openAdvancedOrdersModal;
window.closeAdvancedOrdersModal = closeAdvancedOrdersModal;
window.switchAdvTab = switchAdvTab;
window.submitNewAdvancedOrder = submitNewAdvancedOrder;
window.caterAdvancedOrder = caterAdvancedOrder;