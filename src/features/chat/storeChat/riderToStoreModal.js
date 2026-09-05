// src/features/chat/storeChat/riderToStoreModal.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { storeChatState, cleanFirebasePathKey, sanitizeForFirebase } from './storeChatState.js';
import { renderReactionsHtml, renderReplyPreviewInsideMessage } from './storeChatFeed.js';

let activeStoreInfo = null;

export function toggleRiderStoreInfoSheet() {
    const drawer = document.getElementById('r2s-store-info-drawer');
    if (!drawer) return;
    drawer.classList.toggle('hidden');
}

export function updateRiderStoreInfoUI(storeData) {
    activeStoreInfo = storeData || {};

    const phoneText = document.getElementById('r2s-info-phone-text');
    const callBtn = document.getElementById('r2s-info-call-btn');
    const mapBtn = document.getElementById('r2s-info-map-btn');
    const addressText = document.getElementById('r2s-info-address-text');

    const contact = (activeStoreInfo.contact || activeStoreInfo.phone || activeStoreInfo.contactNumber || '').toString().trim();
    const address = (activeStoreInfo.address || activeStoreInfo.rate || 'Camiling, Tarlac').trim();
    const lat = activeStoreInfo.lat || activeStoreInfo.latitude;
    const lng = activeStoreInfo.lng || activeStoreInfo.longitude;
    const directMapLink = activeStoreInfo.lat_lon_link || activeStoreInfo.mapLink || activeStoreInfo.mapPinLink;

    // 1. Update Address Display
    if (addressText) {
        addressText.innerText = address || "No address provided";
    }

    // 2. Configure Direct Call Action
    if (callBtn && phoneText) {
        if (contact) {
            phoneText.innerText = contact;
            callBtn.href = `tel:${contact.replace(/[^0-9+]/g, '')}`;
            callBtn.classList.remove('opacity-50', 'pointer-events-none');
            callBtn.onclick = null;
        } else {
            phoneText.innerText = "No Number";
            callBtn.href = "javascript:void(0)";
            callBtn.classList.add('opacity-50', 'pointer-events-none');
        }
    }

    // 3. Configure Google Maps Pin & Directions Action
    if (mapBtn) {
        let mapsUrl = "";
        if (lat && lng) {
            mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
        } else if (directMapLink && directMapLink.startsWith('http')) {
            mapsUrl = directMapLink;
        } else if (address) {
            mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address + ', Camiling, Tarlac')}`;
        }

        if (mapsUrl) {
            mapBtn.href = mapsUrl;
            mapBtn.classList.remove('opacity-50', 'pointer-events-none');
        } else {
            mapBtn.href = "javascript:void(0)";
            mapBtn.classList.add('opacity-50', 'pointer-events-none');
        }
    }
}

export async function openRiderStoreChatPicker() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (!custId) {
        return showToast("⚠️ Open a customer chat thread first.");
    }

    const meta = window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {};
    const latestOrderId = cleanFirebasePathKey(meta.latestOrderId);

    let pickerModal = document.getElementById('rider-store-chat-picker-modal');
    if (!pickerModal) {
        pickerModal = document.createElement('div');
        pickerModal.id = 'rider-store-chat-picker-modal';
        pickerModal.className = 'fixed inset-0 z-[9995] bg-black/85 backdrop-blur-md flex items-center justify-center p-4';
        pickerModal.innerHTML = `
            <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 w-full max-w-sm rounded-3xl p-5 flex flex-col gap-4">
                <div class="flex justify-between items-center border-b border-gray-200 dark:border-gray-800 pb-3">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-xl bg-orange-500/10 text-orange-500 dark:text-orange-400 flex items-center justify-center text-sm font-bold">
                            <i class="fa-solid fa-store"></i>
                        </div>
                        <div>
                            <h3 class="text-sm font-black text-gray-900 dark:text-white">Select Store Hub</h3>
                            <p class="text-[10px] text-gray-500 dark:text-gray-400">Stores involved in this order</p>
                        </div>
                    </div>
                    <button onclick="window.closeRiderStoreChatPicker && window.closeRiderStoreChatPicker()" class="text-gray-400 hover:text-gray-700 dark:hover:text-white p-1 text-sm transition">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div id="rider-store-picker-list" class="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
                    <div class="text-center text-gray-400 dark:text-gray-500 italic py-6 text-xs flex flex-col items-center gap-1.5">
                        <i class="fa-solid fa-spinner fa-spin text-orange-500 text-base"></i>
                        <span>Loading stores for this order...</span>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(pickerModal);
    }

    pickerModal.classList.remove('hidden');
    const listEl = document.getElementById('rider-store-picker-list');
    if (!listEl) return;

    try {
        let storesToDisplay = [];

        if (latestOrderId && db) {
            const orderSnap = await db.ref(`orders/${latestOrderId}`).once('value');
            const orderData = orderSnap.val();
            if (orderData && orderData.stores) {
                storesToDisplay = Object.values(orderData.stores);
            }
        }

        if (storesToDisplay.length === 0 && db) {
            const storesSnap = await db.ref('stores').once('value');
            const allStores = storesSnap.val() || {};
            storesToDisplay = Object.entries(allStores).map(([sId, sData]) => ({
                storeId: cleanFirebasePathKey(sId),
                storeName: sData.storeName || sData.name || "Store",
                storeAddress: sData.address || sData.rate || "Poblacion",
                status: sData.isOpen !== false ? 'open' : 'closed',
                contact: sData.contact || sData.phone || "",
                lat: sData.lat,
                lng: sData.lng
            }));
        }

        if (storesToDisplay.length === 0) {
            listEl.innerHTML = `<div class="text-center text-gray-400 dark:text-gray-500 italic py-6 text-xs">No stores found for this customer.</div>`;
            return;
        }

        listEl.innerHTML = storesToDisplay.map(store => {
            const sId = cleanFirebasePathKey(store.storeId);
            const sName = store.storeName || store.name || 'Store';
            const sAddr = store.storeAddress || store.address || store.rate || 'Poblacion';

            return `
            <div class="bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 rounded-2xl p-3 flex items-center justify-between gap-3 shadow-xs">
                <div class="min-w-0 flex-1">
                    <div class="font-black text-xs text-gray-900 dark:text-white truncate">${escapeHtml(sName)}</div>
                    <div class="text-[10px] text-gray-600 dark:text-gray-400 truncate flex items-center gap-1 mt-0.5 font-medium">
                        <i class="fa-solid fa-location-dot text-red-500 text-[9px]"></i>
                        <span>${escapeHtml(sAddr)}</span>
                    </div>
                </div>
                <button onclick="window.openRiderToStoreChatModal('${latestOrderId || 'ORD_DIRECT'}', '${sId}', '${escapeHtml(sName)}')" class="bg-orange-600 hover:bg-orange-500 text-white font-bold text-[11px] px-3 py-2 rounded-xl transition active:scale-95 flex items-center gap-1.5 shrink-0">
                    <i class="fa-solid fa-comments"></i> Chat
                </button>
            </div>`;
        }).join('');
    } catch(e) {
        listEl.innerHTML = `<div class="text-center text-red-500 italic py-6 text-xs">Failed to load stores.</div>`;
    }
}

export function closeRiderStoreChatPicker() {
    const modal = document.getElementById('rider-store-chat-picker-modal');
    if (modal) modal.classList.add('hidden');
}

export function openRiderToStoreChatModal(orderId, storeId, storeName) {
    closeRiderStoreChatPicker();

    storeChatState.activeRiderStoreChatOrderId = cleanFirebasePathKey(orderId || 'DIRECT');
    storeChatState.activeRiderStoreChatStoreId = cleanFirebasePathKey(storeId);
    storeChatState.activeRiderStoreChatStoreName = storeName || "Store";

    if (db && storeChatState.activeRiderStoreChatOrderId && storeChatState.activeRiderStoreChatStoreId) {
        db.ref(`storeRiderChats/${storeChatState.activeRiderStoreChatOrderId}_${storeChatState.activeRiderStoreChatStoreId}`).update({
            unreadForRider: false
        }).catch(() => {});
    }

    let modal = document.getElementById('rider-store-chat-window-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'rider-store-chat-window-modal';
        modal.className = 'fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4';
        modal.innerHTML = `
            <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 w-full max-w-md h-[85vh] max-h-[600px] rounded-3xl flex flex-col relative overflow-hidden shadow-2xl">
                <!-- MODAL HEADER -->
                <div class="p-3.5 bg-white dark:bg-cardBg border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-9 h-9 rounded-xl bg-orange-500/10 text-orange-500 dark:text-orange-400 border border-orange-500/30 flex items-center justify-center text-sm font-black shrink-0">
                            <i class="fa-solid fa-store"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 id="r2s-chat-store-name" class="font-black text-xs text-gray-900 dark:text-white truncate">Store Chat</h3>
                            <p id="r2s-chat-order-id" class="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate">Direct Store Chat</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <!-- STORE INFO TOGGLE BUTTON -->
                        <button type="button" onclick="window.toggleRiderStoreInfoSheet && window.toggleRiderStoreInfoSheet()" class="p-1.5 px-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 dark:bg-blue-600/20 dark:hover:bg-blue-600/30 dark:text-blue-300 dark:border-blue-500/30 text-xs font-bold transition active:scale-95 flex items-center gap-1" title="Store Info, Contact & Location">
                            <i class="fa-solid fa-circle-info text-[11px]"></i>
                            <span class="text-[10px]">Info</span>
                        </button>
                        
                        <button id="r2s-chat-done-btn" onclick="window.markStoreChatDone && window.markStoreChatDone(window.storeChatState.activeRiderStoreChatOrderId, window.storeChatState.activeRiderStoreChatStoreId)" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] px-2.5 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 shadow-sm" title="Mark Store Order Complete">
                            <i class="fa-solid fa-circle-check"></i> Done
                        </button>
                        <button onclick="window.closeRiderToStoreChatModal && window.closeRiderToStoreChatModal()" class="text-gray-400 hover:text-gray-700 dark:hover:text-white p-1.5 text-sm transition">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>

                <!-- COLLAPSIBLE STORE INFO ACTION DRAWER -->
                <div id="r2s-store-info-drawer" class="hidden bg-gray-50 dark:bg-black/50 border-b border-gray-200 dark:border-gray-800 p-3 flex flex-col gap-2 shrink-0 animate-in slide-in-from-top-2 duration-150">
                    <div class="text-[11px] text-gray-600 dark:text-gray-300 flex items-center gap-1.5 truncate">
                        <i class="fa-solid fa-location-dot text-red-500 text-[10px] shrink-0"></i>
                        <span id="r2s-info-address-text" class="truncate font-medium">Loading store address...</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <!-- CALL STORE BUTTON -->
                        <a id="r2s-info-call-btn" href="tel:" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition active:scale-95 text-[11px] shadow-xs truncate">
                            <i class="fa-solid fa-phone text-xs"></i>
                            <span class="truncate">Call: <strong id="r2s-info-phone-text">--</strong></span>
                        </a>

                        <!-- GOOGLE MAPS PIN & DIRECTIONS BUTTON -->
                        <a id="r2s-info-map-btn" href="#" target="_blank" class="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition active:scale-95 text-[11px] shadow-xs truncate">
                            <i class="fa-solid fa-diamond-turn-right text-xs"></i>
                            <span class="truncate">Directions</span>
                        </a>
                    </div>
                </div>

                <!-- PRESET QUICK MESSAGES TOOLBAR -->
                <div class="bg-gray-50 dark:bg-black/30 border-b border-gray-200 dark:border-gray-800 p-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
                    <button onclick="window.sendRiderToStoreQuickPreset('🛵 Papunta na po ako sa store para kunin ang order.')" class="bg-white dark:bg-cardBg hover:bg-blue-50 dark:hover:bg-blue-600/20 border border-gray-200 dark:border-gray-700 text-blue-600 dark:text-blue-400 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95 shadow-xs">
                        🛵 Papunta na sa store
                    </button>
                    <button onclick="window.sendRiderToStoreQuickPreset('📍 Nandito na po ako sa labas ng store.')" class="bg-white dark:bg-cardBg hover:bg-emerald-50 dark:hover:bg-emerald-600/20 border border-gray-200 dark:border-gray-700 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95 shadow-xs">
                        📍 Nandito na sa labas
                    </button>
                    <button onclick="window.sendRiderToStoreQuickPreset('📦 Nakuha na po ang order, salamat!')" class="bg-white dark:bg-cardBg hover:bg-purple-50 dark:hover:bg-purple-600/20 border border-gray-200 dark:border-gray-700 text-purple-600 dark:text-purple-400 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95 shadow-xs">
                        📦 Nakuha na ang order
                    </button>
                </div>

                <!-- CHAT MESSAGES STREAM -->
                <div id="r2s-chat-messages-container" class="flex-1 min-h-0 p-3.5 overflow-y-auto flex flex-col gap-2.5 bg-gray-50 dark:bg-black/40 text-xs">
                    <div class="text-center text-gray-400 dark:text-gray-500 italic py-8 text-xs">Loading store chat history...</div>
                </div>

                <!-- QUOTED REPLY BAR -->
                <div id="r2s-chat-reply-bar" class="hidden bg-orange-50 dark:bg-orange-950/40 border-t border-orange-200 dark:border-orange-500/40 px-3 py-1.5 flex items-center justify-between gap-2 shrink-0">
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                        <i class="fa-solid fa-reply text-orange-500 text-xs shrink-0"></i>
                        <div class="min-w-0 flex-1 text-[11px] leading-tight">
                            <div id="r2s-reply-sender" class="font-bold text-orange-600 dark:text-orange-400 truncate">Replying to Store</div>
                            <div id="r2s-reply-text" class="text-gray-600 dark:text-gray-300 truncate text-[10px]">Message text...</div>
                        </div>
                    </div>
                    <button type="button" onclick="window.cancelRiderStoreReply()" class="text-gray-400 hover:text-red-500 p-1 text-xs transition active:scale-90">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <!-- INPUT TOOLBAR -->
                <div class="p-3 bg-white dark:bg-cardBg border-t border-gray-200 dark:border-gray-800 flex items-center gap-2 shrink-0">
                    <input type="text" id="r2s-chat-input" placeholder="Type message for merchant..." onkeydown="if(event.key === 'Enter') window.sendRiderToStoreMessage && window.sendRiderToStoreMessage()" class="flex-1 bg-gray-50 dark:bg-black/40 text-xs rounded-xl p-2.5 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-orange-500">
                    <button onclick="window.sendRiderToStoreMessage && window.sendRiderToStoreMessage()" class="p-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl transition active:scale-95 text-xs font-bold shrink-0">
                        <i class="fa-solid fa-paper-plane"></i>
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    const nameEl = document.getElementById('r2s-chat-store-name');
    const orderEl = document.getElementById('r2s-chat-order-id');
    const doneBtn = document.getElementById('r2s-chat-done-btn');
    const drawer = document.getElementById('r2s-store-info-drawer');

    if (drawer) drawer.classList.add('hidden');

    if (nameEl) nameEl.innerText = `🏬 ${storeChatState.activeRiderStoreChatStoreName}`;
    if (orderEl) {
        orderEl.innerText = storeChatState.activeRiderStoreChatOrderId && storeChatState.activeRiderStoreChatOrderId !== 'DIRECT'
            ? `Order #${storeChatState.activeRiderStoreChatOrderId}`
            : `Direct Store Chat`;
    }
    if (doneBtn) {
        if (storeChatState.activeRiderStoreChatOrderId && storeChatState.activeRiderStoreChatOrderId !== 'DIRECT') {
            doneBtn.classList.remove('hidden');
        } else {
            doneBtn.classList.add('hidden');
        }
    }

    // Resolve store metadata from cache or Firebase to populate info drawer
    const cachedMatch = (storeChatState.allStoresListCache || []).find(s => s.storeId === storeChatState.activeRiderStoreChatStoreId);
    if (cachedMatch) {
        updateRiderStoreInfoUI(cachedMatch);
    }

    if (db && storeChatState.activeRiderStoreChatStoreId) {
        db.ref(`stores/${storeChatState.activeRiderStoreChatStoreId}`).once('value', (snap) => {
            const data = snap.val();
            if (data) {
                updateRiderStoreInfoUI({
                    storeId: storeChatState.activeRiderStoreChatStoreId,
                    storeName: data.storeName || data.name || storeChatState.activeRiderStoreChatStoreName,
                    address: data.address || data.rate || "",
                    contact: data.contact || data.phone || data.contactNumber || "",
                    lat: data.lat || data.latitude,
                    lng: data.lng || data.longitude,
                    lat_lon_link: data.lat_lon_link || data.mapLink || data.mapPinLink || ""
                });
            }
        }).catch(() => {});
    }

    cancelRiderStoreReply();
    listenToRiderStoreChat(storeChatState.activeRiderStoreChatOrderId, storeChatState.activeRiderStoreChatStoreId);

    modal.classList.remove('hidden');
}

export function closeRiderToStoreChatModal() {
    const modal = document.getElementById('rider-store-chat-window-modal');
    if (modal) modal.classList.add('hidden');

    if (storeChatState.activeRiderStoreChatListener) {
        storeChatState.activeRiderStoreChatListener.off();
        storeChatState.activeRiderStoreChatListener = null;
    }

    storeChatState.activeRiderStoreChatOrderId = null;
    storeChatState.activeRiderStoreChatStoreId = null;
    storeChatState.activeRiderStoreChatStoreName = null;
    cancelRiderStoreReply();
}

export function listenToRiderStoreChat(orderId, storeId) {
    const container = document.getElementById('r2s-chat-messages-container');
    const cleanOrderId = cleanFirebasePathKey(orderId);
    const cleanStoreId = cleanFirebasePathKey(storeId);

    if (!container || !cleanOrderId || !cleanStoreId || !db) return;

    if (storeChatState.activeRiderStoreChatListener) storeChatState.activeRiderStoreChatListener.off();

    storeChatState.activeRiderStoreChatListener = db.ref(`storeRiderChats/${cleanOrderId}_${cleanStoreId}/messages`);
    storeChatState.activeRiderStoreChatListener.on('value', (snap) => {
        const msgs = snap.val() || {};
        const list = Object.entries(msgs).map(([id, m]) => ({ id, ...m })).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        if (list.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-400 dark:text-gray-500 italic py-8 text-xs">No messages yet. Send a message to the store.</div>`;
            return;
        }

        container.innerHTML = list.map(m => {
            const isRider = m.sender === 'rider' || m.senderType === 'rider';
            const reactionsHtml = renderReactionsHtml(m.reactions, m.id);
            const replyBlockHtml = renderReplyPreviewInsideMessage(m.replyTo);
            const encodedText = encodeURIComponent(m.text || '');
            const encodedSender = encodeURIComponent(m.senderName || (isRider ? 'Rider' : 'Store'));

            return `
            <div id="msg-bubble-${m.id}" class="flex flex-col ${isRider ? 'items-end' : 'items-start'} gap-1">
                <span class="text-[9px] text-gray-500 dark:text-gray-400 font-bold pointer-events-none">${escapeHtml(m.senderName || (isRider ? 'Rider' : 'Store'))}</span>
                <div 
                    onpointerdown="window.handleStoreMsgPointerDown(event, '${m.id}', 'store-rider', '${encodedText}', '${encodedSender}')"
                    onpointermove="window.handleStoreMsgPointerMove(event)"
                    onpointerup="window.handleStoreMsgPointerUp(event, '${m.id}')"
                    onpointercancel="window.handleStoreMsgPointerUp(event, '${m.id}')"
                    oncontextmenu="window.handleStoreMsgContextMenu(event, '${m.id}', 'store-rider', '${encodedText}', '${encodedSender}')"
                    class="max-w-[80%] rounded-2xl px-3 py-2 text-xs ${isRider ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-none border border-gray-200 dark:border-gray-700'} cursor-pointer active:scale-98 transition shadow-xs select-none">
                    ${replyBlockHtml}
                    <div class="pointer-events-none">${escapeHtml(m.text || '')}</div>
                    ${reactionsHtml}
                </div>
            </div>`;
        }).join('');

        container.scrollTop = container.scrollHeight;
    });
}

export async function sendRiderToStoreMessage() {
    const input = document.getElementById('r2s-chat-input');
    const text = input ? input.value.trim() : '';
    if (!text) return;

    await postRiderToStoreMessage(text);
    if (input) input.value = '';
}

export async function sendRiderToStoreQuickPreset(text) {
    if (!text) return;
    await postRiderToStoreMessage(text);
}

export async function postRiderToStoreMessage(text) {
    const orderId = cleanFirebasePathKey(storeChatState.activeRiderStoreChatOrderId);
    const storeId = cleanFirebasePathKey(storeChatState.activeRiderStoreChatStoreId);
    const riderName = appState.riderName || localStorage.getItem('riderName') || "Rider";

    if (!orderId || !storeId || !db) return;

    const payload = {
        sender: 'rider',
        senderType: 'rider',
        senderName: riderName,
        text: text.trim(),
        timestamp: Date.now()
    };

    if (storeChatState.activeRiderStoreReplyTarget) {
        payload.replyTo = {
            id: storeChatState.activeRiderStoreReplyTarget.id,
            sender: storeChatState.activeRiderStoreReplyTarget.sender,
            text: storeChatState.activeRiderStoreReplyTarget.text.substring(0, 120)
        };
    }

    try {
        await db.ref(`storeRiderChats/${orderId}_${storeId}/messages`).push(sanitizeForFirebase(payload));
        await db.ref(`storeRiderChats/${orderId}_${storeId}`).update(sanitizeForFirebase({
            lastMessage: text.trim(),
            lastTimestamp: Date.now(),
            riderName,
            storeName: storeChatState.activeRiderStoreChatStoreName,
            unreadForStore: true
        }));
        cancelRiderStoreReply();
    } catch(e) {
        showToast("❌ Failed to send message to store.");
    }
}

export function setStoreRiderReply(msgId, senderName, text) {
    storeChatState.activeRiderStoreReplyTarget = { id: msgId, sender: senderName, text: text };
    
    const replyBar = document.getElementById('r2s-chat-reply-bar');
    const replySender = document.getElementById('r2s-reply-sender');
    const replyText = document.getElementById('r2s-reply-text');
    const input = document.getElementById('r2s-chat-input');

    if (replyBar && replySender && replyText) {
        replySender.innerText = `Replying to ${senderName || 'Store'}`;
        replyText.innerText = text || 'Attachment';
        replyBar.classList.remove('hidden');
    }

    if (input) input.focus();
}

export function cancelRiderStoreReply() {
    storeChatState.activeRiderStoreReplyTarget = null;
    const replyBar = document.getElementById('r2s-chat-reply-bar');
    if (replyBar) replyBar.classList.add('hidden');
}

if (typeof window !== 'undefined') {
    window.toggleRiderStoreInfoSheet = toggleRiderStoreInfoSheet;
    window.updateRiderStoreInfoUI = updateRiderStoreInfoUI;
    window.openRiderStoreChatPicker = openRiderStoreChatPicker;
    window.closeRiderStoreChatPicker = closeRiderStoreChatPicker;
    window.openRiderToStoreChatModal = openRiderToStoreChatModal;
    window.closeRiderToStoreChatModal = closeRiderToStoreChatModal;
    window.sendRiderToStoreMessage = sendRiderToStoreMessage;
    window.sendRiderToStoreQuickPreset = sendRiderToStoreQuickPreset;
    window.setStoreRiderReply = setStoreRiderReply;
    window.cancelRiderStoreReply = cancelRiderStoreReply;
}