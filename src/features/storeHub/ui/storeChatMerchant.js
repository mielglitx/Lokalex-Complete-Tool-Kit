// src/features/storeHub/ui/storeChatMerchant.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { 
    storeHubState, 
    cleanFirebasePathKey, 
    sanitizeForFirebase, 
    renderStoreReactionsHtml, 
    renderReplyPreviewInsideMessage 
} from './storeHubState.js';

export function openStoreRiderChatModal(orderId, riderId, riderName) {
    storeHubState.activeChatOrderId = cleanFirebasePathKey(orderId);
    storeHubState.activeChatRiderId = riderId;
    storeHubState.activeChatRiderName = riderName || "Assigned Rider";
    window.activeChatOrderId = storeHubState.activeChatOrderId;
    localStorage.setItem('lokalex_active_store_chat_order_id', storeHubState.activeChatOrderId);

    let modal = document.getElementById('store-rider-chat-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'store-rider-chat-modal';
        modal.className = 'fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4';
        modal.innerHTML = `
            <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 w-full max-w-md h-[85vh] max-h-[600px] rounded-3xl flex flex-col relative overflow-hidden">
                <div class="p-3.5 bg-gray-50 dark:bg-darkBg/95 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-9 h-9 rounded-xl bg-orange-500/10 text-orange-500 dark:text-orange-400 border border-orange-500/30 flex items-center justify-center text-sm font-black shrink-0">
                            <i class="fa-solid fa-motorcycle"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 id="store-chat-rider-name" class="font-bold text-xs text-gray-900 dark:text-white truncate">Rider Chat</h3>
                            <p id="store-chat-order-id" class="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate">Order #ORD_000</p>
                        </div>
                    </div>
                    <button onclick="window.closeStoreRiderChatModal && window.closeStoreRiderChatModal()" class="text-gray-400 hover:text-gray-700 dark:hover:text-white p-2 text-sm transition">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="bg-gray-100 dark:bg-darkBg/70 border-b border-gray-200 dark:border-gray-800 p-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
                    <button onclick="window.sendStoreRiderQuickPreset('⏳ Preparing: We are now preparing your order.')" class="bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-600/30 border border-gray-300 dark:border-gray-700 text-blue-600 dark:text-blue-300 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95">
                        ⏳ Preparing
                    </button>
                    <button onclick="window.sendStoreRiderQuickPreset('✅ Ready for Pickup: Your order is packed and ready!')" class="bg-white dark:bg-gray-800 hover:bg-emerald-50 dark:hover:bg-emerald-600/30 border border-gray-300 dark:border-gray-700 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95">
                        ✅ Ready for Pickup
                    </button>
                    <button onclick="window.sendStoreRiderQuickPreset('⚠️ Item Replacement: An item is unavailable, please check with customer.')" class="bg-white dark:bg-gray-800 hover:bg-amber-50 dark:hover:bg-amber-600/30 border border-gray-300 dark:border-gray-700 text-amber-600 dark:text-amber-300 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95">
                        ⚠️ Item Replacement
                    </button>
                </div>

                <div id="store-rider-chat-messages" class="flex-1 min-h-0 p-3.5 overflow-y-auto flex flex-col gap-2.5 bg-gray-50 dark:bg-black/40 text-xs">
                    <div class="text-center text-gray-400 dark:text-gray-500 italic py-8 text-xs">Loading chat history...</div>
                </div>

                <div id="store-chat-reply-bar" class="hidden bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-500/40 px-3 py-1.5 flex items-center justify-between gap-2 shrink-0">
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                        <i class="fa-solid fa-reply text-orange-500 text-xs shrink-0"></i>
                        <div class="min-w-0 flex-1 text-[11px] leading-tight">
                            <div id="store-reply-sender" class="font-bold text-orange-600 dark:text-orange-400 truncate">Replying to Rider</div>
                            <div id="store-reply-text" class="text-gray-600 dark:text-gray-300 truncate text-[10px]">Message text...</div>
                        </div>
                    </div>
                    <button type="button" onclick="window.cancelStoreReply()" class="text-gray-400 hover:text-red-500 p-1 text-xs transition active:scale-90">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="p-3 bg-white dark:bg-darkBg/95 border-t border-gray-200 dark:border-gray-800 flex items-center gap-2 shrink-0">
                    <input type="text" id="store-rider-chat-input" placeholder="Type message for rider..." onkeydown="if(event.key === 'Enter') window.sendStoreRiderChatMessage && window.sendStoreRiderChatMessage()" class="flex-1 bg-inputBg text-xs rounded-xl p-2.5 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white focus:border-orange-500">
                    <button onclick="window.sendStoreRiderChatMessage && window.sendStoreRiderChatMessage()" class="p-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl transition active:scale-95 text-xs font-bold shrink-0">
                        <i class="fa-solid fa-paper-plane"></i>
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    const nameEl = document.getElementById('store-chat-rider-name');
    const orderEl = document.getElementById('store-chat-order-id');

    if (nameEl) nameEl.innerText = `🛵 ${storeHubState.activeChatRiderName}`;
    if (orderEl) orderEl.innerText = `Order #${storeHubState.activeChatOrderId}`;

    cancelStoreReply();
    listenToStoreRiderChat(storeHubState.activeChatOrderId);

    modal.classList.remove('hidden');
}

export function closeStoreRiderChatModal() {
    const modal = document.getElementById('store-rider-chat-modal');
    if (modal) modal.classList.add('hidden');

    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(storeHubState.activeChatOrderId);

    if (cleanOrderId && storeId && db) {
        db.ref(`storeRiderChats/${cleanOrderId}_${storeId}/messages`).off();
    }

    storeHubState.activeChatOrderId = null;
    storeHubState.activeChatRiderId = null;
    storeHubState.activeChatRiderName = null;
    window.activeChatOrderId = null;
    cancelStoreReply();
}

export function listenToStoreRiderChat(orderId) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(orderId);
    const container = document.getElementById('store-rider-chat-messages');

    if (!container || !storeId || !cleanOrderId || !db) return;

    db.ref(`storeRiderChats/${cleanOrderId}_${storeId}/messages`).on('value', (snap) => {
        const msgs = snap.val() || {};
        const list = Object.entries(msgs).map(([id, m]) => ({ id, ...m })).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        if (list.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-400 dark:text-gray-500 italic py-8 text-xs">No messages yet. Send a quick update to the rider.</div>`;
            return;
        }

        container.innerHTML = list.map(m => {
            const isStore = m.sender === 'store';
            const reactionsHtml = renderStoreReactionsHtml(m.reactions, m.id);
            const replyBlockHtml = renderReplyPreviewInsideMessage(m.replyTo);

            return `
            <div id="msg-bubble-${m.id}" class="flex flex-col ${isStore ? 'items-end' : 'items-start'} gap-1">
                <span class="text-[9px] text-gray-500 dark:text-gray-400 font-bold">${escapeHtml(m.senderName || (isStore ? 'Store' : 'Rider'))}</span>
                <div onclick="window.openMessageActionPopover(event, '${m.id}', 'store-rider', '${encodeURIComponent(m.text || '')}', '${encodeURIComponent(m.senderName || (isStore ? 'Store' : 'Rider'))}')" class="max-w-[80%] rounded-2xl px-3 py-2 text-xs ${isStore ? 'bg-orange-600 text-white rounded-br-none' : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-none border border-gray-200 dark:border-gray-700'} cursor-pointer active:scale-98 transition shadow-xs">
                    ${replyBlockHtml}
                    <div>${escapeHtml(m.text || '')}</div>
                    ${reactionsHtml}
                </div>
            </div>`;
        }).join('');

        container.scrollTop = container.scrollHeight;
    });
}

export function setStoreReply(msgId, senderName, text) {
    storeHubState.activeStoreReplyTarget = { id: msgId, sender: senderName, text: text };
    
    const replyBar = document.getElementById('store-chat-reply-bar');
    const replySender = document.getElementById('store-reply-sender');
    const replyText = document.getElementById('store-reply-text');
    const input = document.getElementById('store-rider-chat-input');

    if (replyBar && replySender && replyText) {
        replySender.innerText = `Replying to ${senderName || 'Rider'}`;
        replyText.innerText = text || 'Attachment';
        replyBar.classList.remove('hidden');
    }

    if (input) input.focus();
}

export function cancelStoreReply() {
    storeHubState.activeStoreReplyTarget = null;
    const replyBar = document.getElementById('store-chat-reply-bar');
    if (replyBar) replyBar.classList.add('hidden');
}

export async function sendStoreRiderChatMessage() {
    const input = document.getElementById('store-rider-chat-input');
    const text = input ? input.value.trim() : '';
    if (!text) return;

    await postStoreRiderMessage(text);
    if (input) input.value = '';
}

export async function sendStoreRiderQuickPreset(text) {
    if (!text) return;
    await postStoreRiderMessage(text);
}

export async function postStoreRiderMessage(text) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id') || storeHubState.currentStoreData?.storeId;
    const storeId = cleanFirebasePathKey(rawStoreId);
    const storeName = appState.merchantStoreName || localStorage.getItem('lokalex_merchant_store_name') || "Store";
    const cleanOrderId = cleanFirebasePathKey(storeHubState.activeChatOrderId || window.activeChatOrderId || localStorage.getItem('lokalex_active_store_chat_order_id'));

    if (!cleanOrderId || !storeId || !db) {
        showToast("⚠️ Missing Order or Store session.");
        return;
    }

    const payload = {
        sender: 'store',
        senderName: storeName,
        text: text.trim(),
        timestamp: Date.now()
    };

    if (storeHubState.activeStoreReplyTarget) {
        payload.replyTo = {
            id: storeHubState.activeStoreReplyTarget.id,
            sender: storeHubState.activeStoreReplyTarget.sender,
            text: storeHubState.activeStoreReplyTarget.text.substring(0, 120)
        };
    }

    try {
        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}/messages`).push(sanitizeForFirebase(payload));
        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}`).update(sanitizeForFirebase({
            lastMessage: text.trim(),
            lastTimestamp: Date.now(),
            storeName,
            unreadForRider: true
        }));
        cancelStoreReply();
    } catch(e) {
        console.error("postStoreRiderMessage error:", e);
        showToast("❌ Failed to send message: " + (e.message || "Unknown error"));
    }
}