// src/features/chat/storeChat/storeToRiderModal.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { storeChatState, cleanFirebasePathKey, sanitizeForFirebase } from './storeChatState.js';
import { renderReactionsHtml, renderReplyPreviewInsideMessage } from './storeChatFeed.js';

export function openStoreToRiderChatModal(orderId, riderId, riderName) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(orderId);

    storeChatState.activeStoreToRiderOrderId = cleanOrderId;

    const modal = document.getElementById('store-rider-chat-modal');
    const nameEl = document.getElementById('store-chat-rider-name');
    const orderEl = document.getElementById('store-chat-order-id');

    if (nameEl) nameEl.innerText = `🛵 ${riderName || 'Rider'}`;
    if (orderEl) orderEl.innerText = `Order #${cleanOrderId}`;

    if (modal) modal.classList.remove('hidden');

    if (db && storeId && cleanOrderId) {
        db.ref(`storeRiderChats/${cleanOrderId}_${storeId}`).update({
            unreadForStore: false
        }).catch(() => {});

        listenToStoreToRiderChat(cleanOrderId, storeId);
    }
}

export function closeStoreRiderChatModal() {
    const modal = document.getElementById('store-rider-chat-modal');
    if (modal) modal.classList.add('hidden');

    if (storeChatState.activeStoreToRiderChatListener) {
        storeChatState.activeStoreToRiderChatListener.off();
        storeChatState.activeStoreToRiderChatListener = null;
    }
    storeChatState.activeStoreToRiderOrderId = null;
}

export function listenToStoreToRiderChat(orderId, storeId) {
    const container = document.getElementById('store-rider-chat-messages');
    if (!container || !db) return;

    if (storeChatState.activeStoreToRiderChatListener) storeChatState.activeStoreToRiderChatListener.off();

    storeChatState.activeStoreToRiderChatListener = db.ref(`storeRiderChats/${orderId}_${storeId}/messages`);
    storeChatState.activeStoreToRiderChatListener.on('value', (snap) => {
        const msgs = snap.val() || {};
        const list = Object.entries(msgs).map(([id, m]) => ({ id, ...m })).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        if (list.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-400 dark:text-gray-500 italic py-8 text-xs">No messages yet. Send a quick update to the rider.</div>`;
            return;
        }

        container.innerHTML = list.map(m => {
            const isStore = m.sender === 'store' || m.senderType === 'store';
            return `
            <div id="msg-bubble-${m.id}" class="flex flex-col ${isStore ? 'items-end' : 'items-start'} gap-1">
                <span class="text-[9px] text-gray-500 dark:text-gray-400 font-bold">${escapeHtml(m.senderName || (isStore ? 'Store' : 'Rider'))}</span>
                <div class="max-w-[80%] rounded-2xl px-3 py-2 text-xs ${isStore ? 'bg-orange-600 text-white rounded-br-none' : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-none border border-gray-200 dark:border-gray-700'} shadow-xs">
                    <div>${escapeHtml(m.text || '')}</div>
                </div>
            </div>`;
        }).join('');

        container.scrollTop = container.scrollHeight;
    });
}

export async function sendStoreRiderChatMessage() {
    const input = document.getElementById('store-rider-chat-input');
    const text = input ? input.value.trim() : '';
    if (!text) return;

    await postStoreToRiderMessage(text);
    if (input) input.value = '';
}

export async function sendStoreRiderQuickPreset(text) {
    if (!text) return;
    await postStoreToRiderMessage(text);
}

export async function postStoreToRiderMessage(text) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const orderId = cleanFirebasePathKey(storeChatState.activeStoreToRiderOrderId);
    const storeName = appState.merchantStoreName || "Store";

    if (!orderId || !storeId || !db) return;

    const payload = {
        sender: 'store',
        senderType: 'store',
        senderName: storeName,
        text: text.trim(),
        timestamp: Date.now()
    };

    try {
        await db.ref(`storeRiderChats/${orderId}_${storeId}/messages`).push(sanitizeForFirebase(payload));
        await db.ref(`storeRiderChats/${orderId}_${storeId}`).update(sanitizeForFirebase({
            lastMessage: text.trim(),
            lastTimestamp: Date.now(),
            unreadForRider: true
        }));
    } catch(e) {
        showToast("❌ Failed to send message to rider.");
    }
}

export async function toggleStoreRiderReaction(msgId, emoji) {
    const orderId = cleanFirebasePathKey(storeChatState.activeRiderStoreChatOrderId || storeChatState.activeStoreToRiderOrderId);
    const rawStoreId = storeChatState.activeRiderStoreChatStoreId || appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const myId = (appState.telegramId || appState.merchantAccountId || appState.merchantUsername || localStorage.getItem('telegramId') || 'user').toString();

    if (!db || !orderId || !storeId || !msgId || !emoji) return;

    try {
        const ref = db.ref(`storeRiderChats/${orderId}_${storeId}/messages/${msgId}/reactions/${emoji}/${myId}`);
        const snap = await ref.once('value');
        if (snap.exists()) {
            await ref.remove();
        } else {
            await ref.set(true);
        }
    } catch(e) {
        console.error("Error toggling store-rider reaction:", e);
    }
}