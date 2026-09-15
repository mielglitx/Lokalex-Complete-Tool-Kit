// src/features/storeHub/ui/storeOrdersActions.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { showToast, showSideNotification } from '../../../ui/notifications.js';
import { 
    storeHubState, 
    cleanFirebasePathKey, 
    sanitizeForFirebase 
} from './storeHubState.js';
import { 
    stopRepeatingKitchenAlarm 
} from './storeAudio.js';

export function updateLiveCountdownTimers() {
    const timerElements = document.querySelectorAll('[id^="prep-timer-"]');
    const now = Date.now();

    timerElements.forEach(el => {
        const prepUntil = parseInt(el.getAttribute('data-prep-until') || 0);
        if (!prepUntil || prepUntil <= 0) return;

        const diffMs = prepUntil - now;
        if (diffMs > 0) {
            const totalSecs = Math.floor(diffMs / 1000);
            const mins = Math.floor(totalSecs / 60);
            const secs = totalSecs % 60;
            const formattedTime = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
            el.innerHTML = `<i class="fa-solid fa-stopwatch animate-pulse"></i> <span>Prep: ${formattedTime}</span>`;
            el.className = "flex items-center gap-1.5 text-xs font-mono font-black text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 rounded-xl border border-blue-200 dark:border-blue-500/30";
        } else {
            const overdueSecs = Math.floor(Math.abs(diffMs) / 1000);
            const mins = Math.floor(overdueSecs / 60);
            const secs = overdueSecs % 60;
            const formattedTime = `+${mins}:${secs < 10 ? '0' : ''}${secs}`;
            el.innerHTML = `<i class="fa-solid fa-triangle-exclamation animate-bounce text-red-500"></i> <span class="text-red-600 dark:text-red-400">Overdue: ${formattedTime}</span>`;
            el.className = "flex items-center gap-1.5 text-xs font-mono font-black text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-3 py-2 rounded-xl border border-red-300 dark:border-red-500/40 animate-pulse";
        }
    });
}

export async function acceptStoreOrderWithPrepTime(orderId, prepMinutes) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(orderId);

    if (!storeId || !cleanOrderId || !db) return;

    storeHubState.acknowledgedOrders.add(cleanOrderId);
    stopRepeatingKitchenAlarm();

    const now = Date.now();
    const prepUntil = now + (parseInt(prepMinutes) * 60000);

    try {
        await db.ref(`storeOrders/${storeId}/${cleanOrderId}`).update({
            status: 'preparing',
            prepMinutes: parseInt(prepMinutes),
            prepUntil: prepUntil,
            acceptedAt: now,
            updatedAt: now
        });

        await db.ref(`orders/${cleanOrderId}`).update({
            status: 'preparing',
            prepUntil: prepUntil,
            [`milestones/preparing`]: {
                timestamp: now,
                updatedBy: 'Merchant Kitchen',
                prepMinutes: parseInt(prepMinutes)
            }
        }).catch(() => {});

        const storeName = appState.merchantStoreName || "Store";
        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}/messages`).push(sanitizeForFirebase({
            sender: 'store',
            senderType: 'store',
            senderName: storeName,
            text: `⏳ Order accepted! Kitchen is preparing the order (~${prepMinutes} mins estimated).`,
            timestamp: now
        })).catch(() => {});

        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}`).update(sanitizeForFirebase({
            lastMessage: `⏳ Preparing (~${prepMinutes}m)`,
            lastTimestamp: now,
            unreadForRider: true
        })).catch(() => {});

        showToast(`🍳 Order accepted! Prep timer set to ${prepMinutes} mins.`);
        showSideNotification("ORDER ACCEPTED", `Kitchen set to ${prepMinutes}m prep for #${cleanOrderId}`, "fa-kitchen-set", "text-blue-400", "border-blue-500");
    } catch(e) {
        showToast("❌ Failed to accept order.");
    }
}

export function promptCustomPrepTime(orderId) {
    const customTime = prompt("Enter preparation time in minutes (e.g. 20):", "20");
    const parsed = parseInt(customTime);
    if (!isNaN(parsed) && parsed > 0) {
        acceptStoreOrderWithPrepTime(orderId, parsed);
    }
}

export async function markStoreOrderReadyForPickup(orderId) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(orderId);

    if (!storeId || !cleanOrderId || !db) return;

    const now = Date.now();

    try {
        await db.ref(`storeOrders/${storeId}/${cleanOrderId}`).update({
            status: 'ready',
            readyAt: now,
            updatedAt: now
        });

        await db.ref(`orders/${cleanOrderId}`).update({
            status: 'ready_for_pickup',
            [`milestones/ready_for_pickup`]: {
                timestamp: now,
                updatedBy: 'Merchant Kitchen'
            }
        }).catch(() => {});

        const storeName = appState.merchantStoreName || "Store";
        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}/messages`).push(sanitizeForFirebase({
            sender: 'store',
            senderType: 'store',
            senderName: storeName,
            text: `✅ Order is packed and READY for pickup!`,
            timestamp: now
        })).catch(() => {});

        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}`).update(sanitizeForFirebase({
            lastMessage: `✅ READY FOR PICKUP!`,
            lastTimestamp: now,
            unreadForRider: true
        })).catch(() => {});

        showToast("✅ Order marked Ready for Pickup! Rider notified.");
        showSideNotification("READY FOR PICKUP", `Order #${cleanOrderId} is ready!`, "fa-check-double", "text-emerald-400", "border-emerald-500");
    } catch(e) {
        showToast("❌ Failed to mark order ready.");
    }
}

export async function updateStoreOrderStatus(orderId, newStatus) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(orderId);

    if (!storeId || !cleanOrderId || !db) return;

    try {
        const updatePayload = {
            status: newStatus,
            updatedAt: Date.now()
        };

        if (newStatus === 'done' || newStatus === 'picked_up' || newStatus === 'completed') {
            updatePayload.isDone = true;
        }

        await db.ref(`storeOrders/${storeId}/${cleanOrderId}`).update(updatePayload);

        await db.ref(`orders/${cleanOrderId}/stores/${storeId}`).update({
            status: newStatus,
            updatedAt: Date.now()
        }).catch(() => {});

        showToast(`✅ Order marked as ${newStatus.toUpperCase()}`);
    } catch(e) {
        showToast("❌ Failed to update order status.");
    }
}