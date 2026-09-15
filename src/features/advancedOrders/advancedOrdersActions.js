// src/features/advancedOrders/advancedOrdersActions.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { getLocalTodayStr } from '../../utils/helpers.js';
import { 
    stopReminderAlarm, 
    checkScheduledDeliveryAlerts 
} from './advancedOrdersAlerts.js';
import { 
    getRidersAvailableOnDate, 
    promptRiderNameInModal 
} from './advancedOrdersRiderModal.js';
import { 
    renderAdvancedOrdersList, 
    switchAdvTab, 
    resetAddTabButtonState 
} from './advancedOrdersUI.js';

export let editingAdvancedOrderId = null;

export function setEditingAdvancedOrderId(val) {
    editingAdvancedOrderId = val;
}

export function editAdvancedOrder(orderId) {
    const orders = globalState.globalAdvancedOrders || [];
    const ord = orders.find(o => (o.id || o.key || "").toString() === (orderId || "").toString());
    if (!ord) return showToast("⚠️ Order record not found.");

    setEditingAdvancedOrderId(ord.id || ord.key || orderId);

    switchAdvTab('add');

    const nameEl = document.getElementById('adv-cust-name');
    const recEl = document.getElementById('adv-receiver');
    const addrEl = document.getElementById('adv-address');
    const conEl = document.getElementById('adv-contact');
    const timeEl = document.getElementById('adv-receive-time');
    const dateEl = document.getElementById('adv-receive-date');

    if (nameEl) nameEl.value = ord.custName || "";
    if (recEl) recEl.value = ord.receiver || "";
    if (addrEl) addrEl.value = ord.address || "";
    if (conEl) conEl.value = ord.contactNum || "";
    if (dateEl) dateEl.value = ord.dateToReceive || getLocalTodayStr();
    if (timeEl) timeEl.value = ord.timeToReceive || "";

    const addBtn = document.getElementById('adv-tab-btn-add');
    if (addBtn) {
        addBtn.innerHTML = '<i class="fa-solid fa-pen-to-square mr-1"></i> Edit Order';
    }

    const submitBtn = document.getElementById('adv-submit-btn') || 
                      document.querySelector('#adv-tab-add-content button[onclick*="submitNewAdvancedOrder"]') ||
                      document.querySelector('#adv-tab-add-content button.bg-purple-600') ||
                      document.querySelector('#adv-tab-add-content button');

    if (submitBtn) {
        if (!submitBtn.getAttribute('data-original-html')) {
            submitBtn.setAttribute('data-original-html', submitBtn.innerHTML);
        }
        submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-1"></i> Update Scheduled Order';
        submitBtn.classList.remove('bg-purple-600', 'hover:bg-purple-500');
        submitBtn.classList.add('bg-amber-600', 'hover:bg-amber-500');
    }

    showToast(`✏️ Editing scheduled order for ${ord.custName}`);
}

export async function submitNewAdvancedOrder() {
    const custName = document.getElementById('adv-cust-name')?.value.trim() || '';
    const receiver = document.getElementById('adv-receiver')?.value.trim() || '';
    const address = document.getElementById('adv-address')?.value.trim() || '';
    const contactNum = document.getElementById('adv-contact')?.value.trim() || '';
    const dateToReceive = document.getElementById('adv-receive-date')?.value || getLocalTodayStr();
    const timeToReceive = document.getElementById('adv-receive-time')?.value.trim() || '';

    if (!custName) return showToast("Please enter Customer Name!");
    if (!timeToReceive) return showToast("Please select Scheduled Time!");

    if (editingAdvancedOrderId && db) {
        const updatePayload = {
            custName: custName,
            receiver: receiver,
            address: address,
            contactNum: contactNum,
            dateToReceive: dateToReceive,
            timeToReceive: timeToReceive,
            updatedAt: Date.now()
        };

        await db.ref(`advancedOrders/${editingAdvancedOrderId}`).update(updatePayload).catch(() => {});

        const localOrd = (globalState.globalAdvancedOrders || []).find(o => (o.id || o.key || "").toString() === editingAdvancedOrderId.toString());
        if (localOrd) {
            Object.assign(localOrd, updatePayload);
        }

        showToast(`✅ Scheduled order updated for ${custName}!`);
        setEditingAdvancedOrderId(null);
    } else {
        const currentDateStr = getLocalTodayStr();
        const newOrd = {
            custName: custName,
            timeOrdered: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            dateOrdered: currentDateStr,
            createdAt: Date.now(),
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

        showToast(`✅ Scheduled order created for ${custName} on ${dateToReceive}!`);
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

    resetAddTabButtonState();
    switchAdvTab('list');
}

export function takeAdvancedOrder(orderId) {
    stopReminderAlarm();

    const ord = (globalState.globalAdvancedOrders || []).find(o => (o.id || o.key || "").toString() === (orderId || "").toString());
    if (!ord) return showToast("⚠️ Order record not found.");

    const defaultRider = ord.cateredBy || appState.riderName || localStorage.getItem('riderName') || "";
    const availableRiders = getRidersAvailableOnDate(ord);

    promptRiderNameInModal({
        title: "Being Catered",
        subtitle: `Sino ang mag-cacater ng order ni ${ord.custName}?`,
        defaultValue: defaultRider,
        riderList: availableRiders,
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

export function markAdvancedOrderDone(orderId) {
    stopReminderAlarm();

    const ord = (globalState.globalAdvancedOrders || []).find(o => (o.id || o.key || "").toString() === (orderId || "").toString());
    if (!ord) return showToast("⚠️ Order record not found.");

    const defaultRider = ord.cateredBy || appState.riderName || localStorage.getItem('riderName') || "";
    const availableRiders = getRidersAvailableOnDate(ord);

    promptRiderNameInModal({
        title: "Mark as Done",
        subtitle: `Sino ang nag-cater sa order ni ${ord.custName}?`,
        defaultValue: defaultRider,
        riderList: availableRiders,
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