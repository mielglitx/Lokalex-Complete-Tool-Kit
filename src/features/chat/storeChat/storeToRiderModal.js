// src/features/chat/storeChat/storeToRiderModal.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { storeChatState, cleanFirebasePathKey, sanitizeForFirebase } from './storeChatState.js';

export function getMerchantPortalShareUrl(storeId, orderId = 'DIRECT', custId = '') {
    const origin = window.location.origin;
    const pathname = window.location.pathname;
    let url = `${origin}${pathname}?merchant=${encodeURIComponent(storeId)}&order=${encodeURIComponent(orderId)}`;
    if (custId) url += `&cust=${encodeURIComponent(custId)}`;
    return url;
}

export function checkAndInitMerchantPortal() {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const storeId = params.get('merchant') || params.get('store');
    if (!storeId) return;

    const orderId = params.get('order') || params.get('ticket') || 'DIRECT';
    const custId = params.get('cust') || params.get('customer') || '';

    setTimeout(() => {
        openMerchantPortal(orderId, storeId, custId);
    }, 300);
}

export async function openMerchantPortal(orderId, storeId, custId = '') {
    const cleanStore = cleanFirebasePathKey(storeId);
    const cleanOrder = cleanFirebasePathKey(orderId || 'DIRECT');
    const cleanCust = cleanFirebasePathKey(custId);

    if (!cleanStore) return showToast("⚠️ Store identifier missing.");

    storeChatState.activeMerchantStoreId = cleanStore;
    storeChatState.activeMerchantOrderId = cleanOrder;
    storeChatState.activeMerchantCustId = cleanCust;
    storeChatState.activeMerchantActiveTab = 'rider';

    let storeName = "Store";
    let riderName = "Assigned Rider";
    let custName = "Customer";

    // Resolve store name
    if (db) {
        try {
            const storeSnap = await db.ref(`stores/${cleanStore}`).once('value');
            const sData = storeSnap.val();
            if (sData) storeName = sData.storeName || sData.name || storeName;

            if (cleanOrder && cleanOrder !== 'DIRECT') {
                const orderSnap = await db.ref(`storeOrders/${cleanStore}/${cleanOrder}`).once('value');
                const oData = orderSnap.val();
                if (oData) {
                    if (oData.riderName) riderName = oData.riderName;
                    if (oData.customerName) custName = oData.customerName;
                    if (!storeChatState.activeMerchantCustId && oData.custId) {
                        storeChatState.activeMerchantCustId = cleanFirebasePathKey(oData.custId);
                    }
                }
            }

            if (storeChatState.activeMerchantCustId) {
                const custSnap = await db.ref(`customers/${storeChatState.activeMerchantCustId}`).once('value');
                const cData = custSnap.val();
                if (cData && cData.name) custName = cData.name;
            }
        } catch(e) {}
    }

    storeChatState.activeMerchantStoreName = storeName;
    storeChatState.activeMerchantRiderName = riderName;
    storeChatState.activeMerchantCustName = custName;

    createOrRenderMerchantPortalUI();
    switchMerchantPortalTab('rider');
}

export const openStoreToRiderChatModal = openMerchantPortal;

function createOrRenderMerchantPortalUI() {
    let modal = document.getElementById('merchant-order-portal-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'merchant-order-portal-modal';
        modal.className = 'fixed inset-0 z-[99999] bg-black/90 backdrop-blur-md flex items-center justify-center p-2 sm:p-4';
        modal.innerHTML = `
            <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 w-full max-w-lg h-[92vh] max-h-[700px] rounded-3xl flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
                <!-- TOP HEADER -->
                <div class="p-3.5 bg-white dark:bg-cardBg border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-10 h-10 rounded-2xl bg-orange-500/10 text-orange-500 dark:text-orange-400 border border-orange-500/30 flex items-center justify-center text-base font-black shrink-0">
                            <i class="fa-solid fa-store"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 id="merchant-portal-store-name" class="font-black text-sm text-gray-900 dark:text-white truncate">Merchant Portal</h3>
                            <p id="merchant-portal-order-sub" class="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate">Live Order Communications</p>
                        </div>
                    </div>
                    <button onclick="window.closeMerchantPortal && window.closeMerchantPortal()" class="text-gray-400 hover:text-gray-700 dark:hover:text-white p-2 text-sm transition active:scale-90">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <!-- DUAL CHANNEL TAB SELECTOR -->
                <div class="bg-gray-100 dark:bg-black/40 p-1.5 border-b border-gray-200 dark:border-gray-800/80 flex gap-1.5 shrink-0 text-xs">
                    <button id="merchant-tab-rider-btn" onclick="window.switchMerchantPortalTab('rider')" class="flex-1 py-2 rounded-xl font-bold transition flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-motorcycle"></i>
                        <span id="merchant-tab-rider-label">Rider Chat</span>
                    </button>
                    <button id="merchant-tab-cust-btn" onclick="window.switchMerchantPortalTab('customer')" class="flex-1 py-2 rounded-xl font-bold transition flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-user"></i>
                        <span id="merchant-tab-cust-label">Customer Chat</span>
                    </button>
                </div>

                <!-- PRESET QUICK MESSAGES TOOLBAR -->
                <div id="merchant-quick-presets-bar" class="bg-gray-50 dark:bg-black/30 border-b border-gray-200 dark:border-gray-800 p-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
                    <!-- Dynamic Presets injected based on active tab -->
                </div>

                <!-- MESSAGES STREAM CONTAINER -->
                <div id="merchant-portal-messages-stream" class="flex-1 min-h-0 p-3.5 overflow-y-auto flex flex-col gap-2.5 bg-gray-50 dark:bg-black/50 text-xs">
                    <div class="text-center text-gray-400 italic py-10 text-xs">Loading channel conversation...</div>
                </div>

                <!-- INPUT BAR -->
                <div class="p-3 bg-white dark:bg-cardBg border-t border-gray-200 dark:border-gray-800 flex items-center gap-2 shrink-0">
                    <input type="text" id="merchant-portal-input" placeholder="Type message as Merchant..." onkeydown="if(event.key === 'Enter') window.sendMerchantPortalMessage()" class="flex-1 bg-gray-50 dark:bg-black/40 text-xs rounded-xl p-2.5 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:border-orange-500">
                    <button onclick="window.sendMerchantPortalMessage()" class="p-2.5 px-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl transition active:scale-95 text-xs font-bold shrink-0 shadow-sm flex items-center gap-1">
                        <i class="fa-solid fa-paper-plane"></i>
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    const storeTitleEl = document.getElementById('merchant-portal-store-name');
    const orderSubEl = document.getElementById('merchant-portal-order-sub');

    if (storeTitleEl) storeTitleEl.innerText = storeChatState.activeMerchantStoreName || "Store";
    if (orderSubEl) {
        orderSubEl.innerText = storeChatState.activeMerchantOrderId && storeChatState.activeMerchantOrderId !== 'DIRECT'
            ? `Order #${storeChatState.activeMerchantOrderId}`
            : `Direct Store Portal`;
    }

    modal.classList.remove('hidden');
}

export function switchMerchantPortalTab(tab = 'rider') {
    storeChatState.activeMerchantActiveTab = tab;

    const riderBtn = document.getElementById('merchant-tab-rider-btn');
    const custBtn = document.getElementById('merchant-tab-cust-btn');
    const riderLabel = document.getElementById('merchant-tab-rider-label');
    const custLabel = document.getElementById('merchant-tab-cust-label');
    const presetsBar = document.getElementById('merchant-quick-presets-bar');
    const input = document.getElementById('merchant-portal-input');

    if (riderLabel) riderLabel.innerText = `🛵 Rider (${storeChatState.activeMerchantRiderName || 'Rider'})`;
    if (custLabel) custLabel.innerText = `👤 Customer (${storeChatState.activeMerchantCustName || 'Customer'})`;

    if (tab === 'rider') {
        if (riderBtn) riderBtn.className = "flex-1 py-2 rounded-xl font-black bg-blue-600 text-white shadow-sm transition flex items-center justify-center gap-1.5";
        if (custBtn) custBtn.className = "flex-1 py-2 rounded-xl font-bold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition flex items-center justify-center gap-1.5";
        if (input) input.placeholder = `Message rider ${storeChatState.activeMerchantRiderName || ''}...`;

        if (presetsBar) {
            presetsBar.innerHTML = `
                <button onclick="window.sendMerchantPortalQuickPreset('👨‍🍳 Inihahanda na po ang order.')" class="bg-white dark:bg-cardBg hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-gray-200 dark:border-gray-700 text-blue-600 dark:text-blue-400 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95 shadow-xs">
                    👨‍🍳 Inihahanda na
                </button>
                <button onclick="window.sendMerchantPortalQuickPreset('✅ Ready na po for pickup ang order!')" class="bg-white dark:bg-cardBg hover:bg-emerald-50 dark:hover:bg-emerald-900/30 border border-gray-200 dark:border-gray-700 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95 shadow-xs">
                    ✅ Ready for pickup
                </button>
                <button onclick="window.sendMerchantPortalQuickPreset('📍 Paki-claim po sa cashier counter.')" class="bg-white dark:bg-cardBg hover:bg-purple-50 dark:hover:bg-purple-900/30 border border-gray-200 dark:border-gray-700 text-purple-600 dark:text-purple-400 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95 shadow-xs">
                    📍 Sa cashier counter
                </button>`;
        }

        listenToMerchantRiderStream();
    } else {
        if (custBtn) custBtn.className = "flex-1 py-2 rounded-xl font-black bg-orange-600 text-white shadow-sm transition flex items-center justify-center gap-1.5";
        if (riderBtn) riderBtn.className = "flex-1 py-2 rounded-xl font-bold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition flex items-center justify-center gap-1.5";
        if (input) input.placeholder = `Message customer ${storeChatState.activeMerchantCustName || ''}...`;

        if (presetsBar) {
            presetsBar.innerHTML = `
                <button onclick="window.sendMerchantPortalQuickPreset('👋 Magandang araw po! We are now preparing your order.')" class="bg-white dark:bg-cardBg hover:bg-orange-50 dark:hover:bg-orange-900/30 border border-gray-200 dark:border-gray-700 text-orange-600 dark:text-orange-400 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95 shadow-xs">
                    👋 Inihahanda na
                </button>
                <button onclick="window.sendMerchantPortalQuickPreset('⚠️ Out of stock po ang isang item, ano po ang pwedeng pamalit?')" class="bg-white dark:bg-cardBg hover:bg-red-50 dark:hover:bg-red-900/30 border border-gray-200 dark:border-gray-700 text-red-600 dark:text-red-400 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95 shadow-xs">
                    ⚠️ Out of stock (Palit item)
                </button>
                <button onclick="window.sendMerchantPortalQuickPreset('✅ Nakuha na po ng rider ang order. Papunta na po sa inyo!')" class="bg-white dark:bg-cardBg hover:bg-emerald-50 dark:hover:bg-emerald-900/30 border border-gray-200 dark:border-gray-700 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95 shadow-xs">
                    ✅ Nakuha na ng rider
                </button>`;
        }

        listenToMerchantCustomerStream();
    }
}

function listenToMerchantRiderStream() {
    const container = document.getElementById('merchant-portal-messages-stream');
    const orderId = storeChatState.activeMerchantOrderId;
    const storeId = storeChatState.activeMerchantStoreId;

    if (!container || !orderId || !storeId || !db) return;

    if (storeChatState.activeStoreToRiderChatListener) storeChatState.activeStoreToRiderChatListener.off();

    storeChatState.activeStoreToRiderChatListener = db.ref(`storeRiderChats/${orderId}_${storeId}/messages`);
    storeChatState.activeStoreToRiderChatListener.on('value', (snap) => {
        if (storeChatState.activeMerchantActiveTab !== 'rider') return;

        const msgs = snap.val() || {};
        const list = Object.entries(msgs).map(([id, m]) => ({ id, ...m })).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        if (list.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-400 italic py-10 text-xs">No messages with rider yet. Send an update below.</div>`;
            return;
        }

        container.innerHTML = list.map(m => {
            const isStore = m.sender === 'store' || m.senderType === 'store';
            const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            return `
            <div class="flex flex-col ${isStore ? 'items-end' : 'items-start'} gap-1">
                <span class="text-[9px] text-gray-500 font-bold">${escapeHtml(m.senderName || (isStore ? 'Store (You)' : 'Rider'))} • ${timeStr}</span>
                <div class="max-w-[82%] rounded-2xl px-3 py-2 text-xs ${isStore ? 'bg-orange-600 text-white rounded-br-none' : 'bg-white dark:bg-cardBg text-gray-900 dark:text-gray-100 rounded-bl-none border border-gray-200 dark:border-gray-700'} shadow-xs">
                    <div>${escapeHtml(m.text || '')}</div>
                </div>
            </div>`;
        }).join('');

        container.scrollTop = container.scrollHeight;
    });
}

function listenToMerchantCustomerStream() {
    const container = document.getElementById('merchant-portal-messages-stream');
    const custId = storeChatState.activeMerchantCustId;

    if (!container) return;

    if (!custId || !db) {
        container.innerHTML = `<div class="text-center text-gray-400 italic py-10 text-xs">No active customer thread tied to this ticket.</div>`;
        return;
    }

    if (storeChatState.activeStoreToCustomerChatListener) storeChatState.activeStoreToCustomerChatListener.off();

    storeChatState.activeStoreToCustomerChatListener = db.ref(`customerChats/${custId}/messages`).limitToLast(40);
    storeChatState.activeStoreToCustomerChatListener.on('value', (snap) => {
        if (storeChatState.activeMerchantActiveTab !== 'customer') return;

        const msgs = snap.val() || {};
        const list = Object.entries(msgs).map(([id, m]) => ({ id, ...m })).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        if (list.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-400 italic py-10 text-xs">No customer messages found. Send an update below.</div>`;
            return;
        }

        container.innerHTML = list.map(m => {
            const isStore = m.senderType === 'store' || m.isStore === true;
            const isRider = m.isRider || m.senderType === 'rider';
            const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

            let bubbleColor = "bg-white dark:bg-cardBg text-gray-900 dark:text-gray-100 rounded-bl-none border border-gray-200 dark:border-gray-700";
            if (isStore) {
                bubbleColor = "bg-orange-600 text-white rounded-br-none";
            } else if (isRider) {
                bubbleColor = "bg-blue-600 text-white rounded-bl-none";
            }

            return `
            <div class="flex flex-col ${isStore ? 'items-end' : 'items-start'} gap-1">
                <span class="text-[9px] text-gray-500 font-bold">${escapeHtml(m.sender || (isStore ? 'Store (You)' : isRider ? 'Rider' : 'Customer'))} • ${timeStr}</span>
                <div class="max-w-[82%] rounded-2xl px-3 py-2 text-xs ${bubbleColor} shadow-xs">
                    ${m.imageUrl ? `<img src="${m.imageUrl}" class="w-48 rounded-lg mb-1 border border-black/20">` : ''}
                    <div>${escapeHtml(m.text || '')}</div>
                </div>
            </div>`;
        }).join('');

        container.scrollTop = container.scrollHeight;
    });
}

export async function sendMerchantPortalMessage() {
    const input = document.getElementById('merchant-portal-input');
    const text = input ? input.value.trim() : '';
    if (!text) return;

    await postMerchantPortalMessage(text);
    if (input) input.value = '';
}

export async function sendMerchantPortalQuickPreset(presetText) {
    if (!presetText) return;
    await postMerchantPortalMessage(presetText);
}

export async function postMerchantPortalMessage(text) {
    const storeId = storeChatState.activeMerchantStoreId;
    const orderId = storeChatState.activeMerchantOrderId;
    const custId = storeChatState.activeMerchantCustId;
    const storeName = storeChatState.activeMerchantStoreName || "Store";
    const now = Date.now();

    if (!db || !storeId) return;

    if (storeChatState.activeMerchantActiveTab === 'rider') {
        // Send to Rider Channel
        const payload = {
            sender: 'store',
            senderType: 'store',
            senderName: storeName,
            text: text.trim(),
            timestamp: now
        };

        try {
            await db.ref(`storeRiderChats/${orderId}_${storeId}/messages`).push(sanitizeForFirebase(payload));
            await db.ref(`storeRiderChats/${orderId}_${storeId}`).update(sanitizeForFirebase({
                lastMessage: text.trim(),
                lastTimestamp: now,
                unreadForRider: true
            }));
        } catch(e) {
            showToast("❌ Failed to send message to rider.");
        }
    } else {
        // Send to Customer Channel
        if (!custId) return showToast("⚠️ No customer thread linked to this order.");

        const payload = {
            sender: `🏬 ${storeName}`,
            senderType: 'store',
            isStore: true,
            text: text.trim(),
            timestamp: now,
            status: 'sent'
        };

        try {
            await db.ref(`customerChats/${custId}/messages`).push(sanitizeForFirebase(payload));
            await db.ref(`customerChats/${custId}/metadata`).update(sanitizeForFirebase({
                lastMessage: `${storeName}: ${text.trim()}`,
                lastUpdated: now,
                unreadForRider: false
            }));
        } catch(e) {
            showToast("❌ Failed to send message to customer.");
        }
    }
}

export function closeMerchantPortal() {
    const modal = document.getElementById('merchant-order-portal-modal');
    if (modal) modal.classList.add('hidden');

    if (storeChatState.activeStoreToRiderChatListener) {
        storeChatState.activeStoreToRiderChatListener.off();
        storeChatState.activeStoreToRiderChatListener = null;
    }
    if (storeChatState.activeStoreToCustomerChatListener) {
        storeChatState.activeStoreToCustomerChatListener.off();
        storeChatState.activeStoreToCustomerChatListener = null;
    }

    storeChatState.activeMerchantStoreId = null;
    storeChatState.activeMerchantOrderId = null;
    storeChatState.activeMerchantCustId = null;
}

export const closeStoreRiderChatModal = closeMerchantPortal;

// Auto-initialize portal if opened via URL param
if (typeof window !== 'undefined') {
    window.openMerchantPortal = openMerchantPortal;
    window.openStoreToRiderChatModal = openStoreToRiderChatModal;
    window.closeMerchantPortal = closeMerchantPortal;
    window.closeStoreRiderChatModal = closeStoreRiderChatModal;
    window.switchMerchantPortalTab = switchMerchantPortalTab;
    window.sendMerchantPortalMessage = sendMerchantPortalMessage;
    window.sendMerchantPortalQuickPreset = sendMerchantPortalQuickPreset;
    window.getMerchantPortalShareUrl = getMerchantPortalShareUrl;
    window.checkAndInitMerchantPortal = checkAndInitMerchantPortal;

    checkAndInitMerchantPortal();
}