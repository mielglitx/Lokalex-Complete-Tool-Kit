// src/features/chat/riderStoreChat.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';

let activeRiderStoreChatOrderId = null;
let activeRiderStoreChatStoreId = null;
let activeRiderStoreChatStoreName = null;
let activeRiderStoreChatListener = null;
let globalStoreChatsListener = null;
let globalStoresListener = null;
let cachedStoreChatsData = {};
let allStoresListCache = [];
let activeRiderStoreReplyTarget = null;
let storeSearchQuery = "";

let activeStoreToRiderOrderId = null;
let activeStoreToRiderChatListener = null;

// LONG-PRESS & MULTI-TAP ANIMATION STATE FOR STORE CHAT
let longPressTimer = null;
let startX = 0;
let startY = 0;
const tapTrackerMap = new Map();

const FUN_ANIMATIONS = [
    [
        { transform: 'scale(1, 1)' },
        { transform: 'scale(1.22, 0.78)' },
        { transform: 'scale(0.82, 1.18)' },
        { transform: 'scale(1.08, 0.94)' },
        { transform: 'scale(1, 1)' }
    ],
    [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(-14deg)' },
        { transform: 'rotate(12deg)' },
        { transform: 'rotate(-8deg)' },
        { transform: 'rotate(4deg)' },
        { transform: 'rotate(0deg)' }
    ],
    [
        { transform: 'scale(1)' },
        { transform: 'scale(1.28)' },
        { transform: 'scale(0.92)' },
        { transform: 'scale(1.06)' },
        { transform: 'scale(1)' }
    ],
    [
        { transform: 'translate(0, 0)' },
        { transform: 'translate(-8px, 2px) rotate(-3deg)' },
        { transform: 'translate(8px, -2px) rotate(3deg)' },
        { transform: 'translate(-5px, -1px) rotate(-1deg)' },
        { transform: 'translate(5px, 1px) rotate(1deg)' },
        { transform: 'translate(0, 0)' }
    ],
    [
        { transform: 'scale(1)' },
        { transform: 'scale(1.18)' },
        { transform: 'scale(0.96)' },
        { transform: 'scale(1.12)' },
        { transform: 'scale(1)' }
    ]
];

const FUN_EMOJIS = ['⚡', '🔥', '✨', '🎉', '🚀', '💖', '💥', '⭐'];

function triggerRandomBubbleFun(bubbleEl) {
    if (!bubbleEl) return;

    const randomKeyframes = FUN_ANIMATIONS[Math.floor(Math.random() * FUN_ANIMATIONS.length)];
    bubbleEl.animate(randomKeyframes, {
        duration: 400,
        easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
    });

    const particle = document.createElement('span');
    particle.className = 'pointer-events-none absolute text-sm select-none z-30';
    particle.innerText = FUN_EMOJIS[Math.floor(Math.random() * FUN_EMOJIS.length)];

    const rect = bubbleEl.getBoundingClientRect();
    particle.style.left = `${(rect.width / 2) + (Math.random() * 30 - 15)}px`;
    particle.style.top = `0px`;

    if (!bubbleEl.style.position || bubbleEl.style.position === 'static') {
        bubbleEl.style.position = 'relative';
    }

    bubbleEl.appendChild(particle);

    particle.animate([
        { transform: 'translateY(0) scale(0.6)', opacity: 1 },
        { transform: `translateY(-40px) translateX(${Math.random() * 30 - 15}px) scale(1.3)`, opacity: 0 }
    ], {
        duration: 650,
        easing: 'ease-out'
    }).onfinish = () => particle.remove();
}

export function handleStoreMsgPointerDown(e, msgId, chatType, text, sender) {
    if (e.button && e.button !== 0) return;
    if (e.target && e.target.closest('a, button, img')) return;

    startX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
    startY = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);

    clearTimeout(longPressTimer);

    longPressTimer = setTimeout(() => {
        if (navigator.vibrate) {
            try { navigator.vibrate(40); } catch (_) {}
        }
        if (window.openMessageActionPopover) {
            window.openMessageActionPopover(e, msgId, chatType, text, sender);
        }
        longPressTimer = null;
    }, 450);
}

export function handleStoreMsgPointerMove(e) {
    if (!longPressTimer) return;
    const currentX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
    const currentY = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);

    if (Math.abs(currentX - startX) > 10 || Math.abs(currentY - startY) > 10) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

export function handleStoreMsgPointerUp(e, msgId) {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;

        const now = Date.now();
        const prev = tapTrackerMap.get(msgId) || { count: 0, lastTime: 0 };
        const isRapid = (now - prev.lastTime) < 450;

        const newCount = isRapid ? prev.count + 1 : 1;
        tapTrackerMap.set(msgId, { count: newCount, lastTime: now });

        if (newCount >= 2) {
            const bubbleEl = e?.currentTarget || document.getElementById(`msg-bubble-${msgId}`)?.querySelector('.select-none');
            triggerRandomBubbleFun(bubbleEl);
        }
    }
}

export function handleStoreMsgContextMenu(e, msgId, chatType, text, sender) {
    e.preventDefault();
    e.stopPropagation();
    if (window.openMessageActionPopover) {
        window.openMessageActionPopover(e, msgId, chatType, text, sender);
    }
}

function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

function cleanFirebasePathKey(key) {
    return String(key || '').replace(/^#+/, '').replace(/[.#$\[\]\/]/g, '_').trim();
}

// INITIAL LOCAL CACHE HYDRATION
try {
    const rawLocalStores = localStorage.getItem('lokalex_cached_stores_v1');
    if (rawLocalStores) {
        const parsed = JSON.parse(rawLocalStores);
        if (parsed && typeof parsed === 'object') {
            allStoresListCache = Object.entries(parsed).map(([sId, sData]) => ({
                storeId: cleanFirebasePathKey(sId),
                storeName: sData.storeName || sData.name || "Store",
                address: sData.address || sData.rate || "",
                isOpen: sData.isOpen !== false && sData.status !== 'closed' && sData.status !== 'inactive',
                logoUrl: sData.logoUrl || sData.photoUrl || sData.imageUrl || "",
                contact: sData.contact || sData.phone || ""
            }));
        }
    }
} catch(e) {}

function renderReactionsHtml(reactions, msgId) {
    if (!reactions || typeof reactions !== 'object') return '';
    const reactionEntries = Object.entries(reactions);
    if (reactionEntries.length === 0) return '';

    const myId = (appState.telegramId || appState.merchantAccountId || appState.merchantUsername || localStorage.getItem('telegramId') || 'user').toString();

    const badges = reactionEntries.map(([emoji, usersMap]) => {
        if (!usersMap || typeof usersMap !== 'object') return '';
        const count = Object.keys(usersMap).length;
        if (count === 0) return '';
        const hasReacted = myId && usersMap[myId];

        return `
        <button onclick="event.stopPropagation(); window.toggleStoreRiderReaction('${msgId}', '${emoji}')" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] ${hasReacted ? 'bg-blue-600/30 border border-blue-400 text-white' : 'bg-gray-100 dark:bg-black/60 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'} transition active:scale-90">
            <span>${emoji}</span>
            <span class="font-bold text-[9px]">${count}</span>
        </button>`;
    }).join('');

    return badges ? `<div class="flex flex-wrap gap-1 mt-1">${badges}</div>` : '';
}

function renderReplyPreviewInsideMessage(replyTo) {
    if (!replyTo || !replyTo.text) return '';
    const clickHandler = replyTo.id ? `event.stopPropagation(); window.scrollToBubble('${replyTo.id}')` : '';
    return `
    <div ${clickHandler ? `onclick="${clickHandler}"` : ''} class="bg-black/10 dark:bg-black/40 border-l-2 border-amber-400 px-2 py-1 rounded-r-lg mb-1.5 text-[10px] opacity-90 truncate max-w-full cursor-pointer hover:opacity-100 transition">
        <div class="font-bold text-amber-600 dark:text-amber-300 truncate flex items-center gap-1">
            <i class="fa-solid fa-reply text-[8px]"></i>
            <span>${escapeHtml(replyTo.sender || 'Reply')}</span>
        </div>
        <div class="text-gray-700 dark:text-gray-200 truncate">${escapeHtml(replyTo.text)}</div>
    </div>`;
}

// REALTIME LISTENER FOR REGISTERED STORES AND STORE CHATS
export function listenToGlobalStoreChats() {
    if (!db) return;

    if (!globalStoresListener) {
        globalStoresListener = db.ref('stores');
        globalStoresListener.on('value', (snapshot) => {
            const val = snapshot.val();
            if (val && Object.keys(val).length > 0) {
                allStoresListCache = Object.entries(val).map(([sId, sData]) => ({
                    storeId: cleanFirebasePathKey(sId),
                    storeName: sData.storeName || sData.name || "Store",
                    address: sData.address || sData.rate || "",
                    isOpen: sData.isOpen !== false && sData.status !== 'closed' && sData.status !== 'inactive',
                    logoUrl: sData.logoUrl || sData.photoUrl || sData.imageUrl || "",
                    contact: sData.contact || sData.phone || ""
                }));
            } else {
                allStoresListCache = [];
            }

            if (window.getActiveRiderChatFilter && window.getActiveRiderChatFilter() === 'stores') {
                renderStoreChatsInDashboard();
            }
        });
    }

    if (!globalStoreChatsListener) {
        globalStoreChatsListener = db.ref('storeRiderChats');
        globalStoreChatsListener.on('value', (snapshot) => {
            cachedStoreChatsData = snapshot.val() || {};
            
            let unreadCount = 0;
            Object.entries(cachedStoreChatsData).forEach(([key, val]) => {
                if (val && val.unreadForRider && !val.isDone && val.status !== 'done') {
                    unreadCount++;
                }
            });

            const storeBadge = document.getElementById('rider-store-unread-badge');
            if (storeBadge) {
                if (unreadCount > 0) {
                    storeBadge.innerText = unreadCount;
                    storeBadge.classList.remove('hidden');
                } else {
                    storeBadge.classList.add('hidden');
                }
            }

            if (window.getActiveRiderChatFilter && window.getActiveRiderChatFilter() === 'stores') {
                renderStoreChatsInDashboard();
            }
        });
    }
}

export async function markStoreChatDone(orderId, storeId) {
    const cleanOrderId = cleanFirebasePathKey(orderId || activeRiderStoreChatOrderId);
    const cleanStoreId = cleanFirebasePathKey(storeId || activeRiderStoreChatStoreId);

    if (!cleanOrderId || !cleanStoreId || !db) return;

    try {
        await db.ref(`storeRiderChats/${cleanOrderId}_${cleanStoreId}`).update({
            status: 'done',
            isDone: true,
            unreadForRider: false,
            doneAt: Date.now()
        });

        await db.ref(`storeOrders/${cleanStoreId}/${cleanOrderId}`).update({
            status: 'picked_up',
            updatedAt: Date.now()
        }).catch(() => {});

        showToast("✅ Store order marked as Done!");
        closeRiderToStoreChatModal();
    } catch(e) {
        showToast("❌ Failed to mark store chat as done.");
    }
}

export function filterRiderStoreChats(query) {
    storeSearchQuery = (query || '').toLowerCase().trim();
    renderStoreChatsListOnly();
}

export function clearRiderStoreChatSearch() {
    storeSearchQuery = '';
    const input = document.getElementById('rider-store-chat-search');
    if (input) {
        input.value = '';
        input.focus();
    }
    renderStoreChatsListOnly();
}

// RENDER ALL STORES WITH SEARCH BAR AND ALPHABETICAL SORTING
export function renderStoreChatsInDashboard() {
    const feed = document.getElementById('rider-cust-chats-feed');
    if (!feed) return;

    const existingContainer = document.getElementById('rider-store-search-container');
    if (!existingContainer) {
        feed.innerHTML = `
        <div id="rider-store-search-container" class="flex flex-col gap-2 w-full">
            <div class="relative shrink-0">
                <i class="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-gray-400 text-xs"></i>
                <input type="text" id="rider-store-chat-search" 
                    value="${escapeHtml(storeSearchQuery)}"
                    oninput="window.filterRiderStoreChats && window.filterRiderStoreChats(this.value)" 
                    placeholder="Search store name or location..." 
                    class="w-full bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 focus:border-orange-500 rounded-xl pl-8 pr-8 py-2 text-xs text-gray-900 dark:text-white outline-none transition shadow-xs">
                <button type="button" onclick="window.clearRiderStoreChatSearch && window.clearRiderStoreChatSearch()" class="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600 dark:hover:text-white text-xs">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div id="rider-store-chats-list" class="flex flex-col gap-1.5"></div>
        </div>`;
    }

    renderStoreChatsListOnly();
}

function renderStoreChatsListOnly() {
    const listContainer = document.getElementById('rider-store-chats-list');
    const badge = document.getElementById('rider-cust-chats-badge');
    if (!listContainer) return;

    const storeMap = new Map();

    // 1. BASE: Only populate registered stores from the stores database
    allStoresListCache.forEach(store => {
        storeMap.set(store.storeId, {
            storeId: store.storeId,
            storeName: store.storeName || "Store",
            address: store.address || "",
            isOpen: store.isOpen !== false,
            logoUrl: store.logoUrl || "",
            orderId: 'DIRECT',
            lastMessage: "Tap to chat with store",
            lastTimestamp: 0,
            unread: false
        });
    });

    // 2. OVERLAY: Attach chat thread metadata ONLY to existing registered stores
    Object.entries(cachedStoreChatsData || {}).forEach(([chatKey, data]) => {
        if (!data) return;

        // Match chat to registered store by ID or chat key suffix
        let targetStoreId = data.storeId ? cleanFirebasePathKey(data.storeId) : null;
        if (!targetStoreId || !storeMap.has(targetStoreId)) {
            const found = allStoresListCache.find(s => chatKey.endsWith(`_${s.storeId}`) || chatKey === s.storeId);
            if (found) {
                targetStoreId = found.storeId;
            }
        }

        // If the chat belongs to a non-existent or deleted store, ignore it
        if (!targetStoreId || !storeMap.has(targetStoreId)) {
            return;
        }

        const existing = storeMap.get(targetStoreId);
        const isThreadUnread = !!data.unreadForRider;
        const threadTime = data.lastTimestamp || 0;
        const threadMsg = data.lastMessage || "Order Conversation";
        const orderId = data.orderId || (chatKey.includes(`_${targetStoreId}`) ? chatKey.replace(`_${targetStoreId}`, '') : 'DIRECT');

        if (threadTime >= existing.lastTimestamp) {
            existing.orderId = orderId;
            existing.lastMessage = threadMsg;
            existing.lastTimestamp = threadTime;
            existing.unread = isThreadUnread;
        }
    });

    let allMerged = Array.from(storeMap.values());

    // 3. Sort alphabetically by name
    allMerged.sort((a, b) => {
        const nameA = (a.storeName || "").trim();
        const nameB = (b.storeName || "").trim();
        return nameA.localeCompare(nameB, 'en', { sensitivity: 'base' });
    });

    // 4. Apply search filter
    if (storeSearchQuery) {
        allMerged = allMerged.filter(s => 
            (s.storeName || "").toLowerCase().includes(storeSearchQuery) ||
            (s.address || "").toLowerCase().includes(storeSearchQuery)
        );
    }

    if (badge) {
        badge.innerText = `${allMerged.length} ${allMerged.length === 1 ? 'store' : 'stores'}`;
    }

    if (allMerged.length === 0) {
        listContainer.innerHTML = `
        <div class="text-gray-400 dark:text-gray-500 italic text-center py-8 text-xs flex flex-col items-center gap-1.5">
            <i class="fa-solid fa-store text-xl text-orange-500/60"></i>
            <span>${storeSearchQuery ? `No stores found matching "${escapeHtml(storeSearchQuery)}"` : 'No stores registered yet.'}</span>
            ${storeSearchQuery ? `
                <button type="button" onclick="window.clearRiderStoreChatSearch && window.clearRiderStoreChatSearch()" class="text-blue-500 font-bold underline text-[11px] mt-1">
                    Clear Search
                </button>
            ` : ''}
        </div>`;
        return;
    }

    listContainer.innerHTML = allMerged.map(s => {
        const timeStr = s.lastTimestamp ? new Date(s.lastTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
        const unreadDot = s.unread ? `<span class="bg-orange-600 text-white text-[8px] font-black px-1.5 py-0.2 rounded-full animate-pulse shrink-0">NEW</span>` : "";

        const openStatusBadge = s.isOpen ? `
            <span class="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> OPEN
            </span>
        ` : `
            <span class="bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30 text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                <span class="w-1.5 h-1.5 rounded-full bg-red-500"></span> CLOSED
            </span>
        `;

        const logoHtml = s.logoUrl 
            ? `<img src="${s.logoUrl}" class="w-9 h-9 rounded-xl object-cover border border-gray-200 dark:border-gray-800 shrink-0">`
            : `<div class="w-9 h-9 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/30 flex items-center justify-center text-sm font-black shrink-0">
                    <i class="fa-solid fa-store"></i>
               </div>`;

        return `
        <div onclick="window.openRiderToStoreChatModal('${escapeHtml(s.orderId)}', '${escapeHtml(s.storeId)}', '${escapeHtml(s.storeName)}')" class="bg-white dark:bg-cardBg hover:bg-gray-50 dark:hover:bg-black/50 border ${s.unread ? 'border-2 border-orange-500 dark:border-orange-400' : 'border-gray-200 dark:border-gray-800'} p-2.5 rounded-2xl flex items-center justify-between cursor-pointer transition active:scale-[0.99] shadow-xs">
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
                ${logoHtml}
                <div class="min-w-0 flex-1">
                    <div class="font-black text-gray-900 dark:text-white text-xs truncate flex items-center gap-1.5">
                        <span class="truncate">${escapeHtml(s.storeName)}</span>
                        ${openStatusBadge}
                        ${unreadDot}
                    </div>
                    <div class="text-[11px] ${s.unread ? 'text-orange-600 dark:text-orange-400 font-bold' : 'text-gray-500 dark:text-gray-400 font-medium'} truncate mt-0.5">${escapeHtml(s.lastMessage)}</div>
                    ${s.address ? `<div class="text-[10px] text-gray-400 truncate flex items-center gap-1 mt-0.5"><i class="fa-solid fa-location-dot text-[8px] text-red-500"></i> ${escapeHtml(s.address)}</div>` : ''}
                </div>
            </div>

            <div class="flex items-center gap-2 shrink-0 ml-2">
                ${timeStr ? `<div class="text-[9px] text-gray-400 font-mono font-medium">${timeStr}</div>` : ''}
                <div class="bg-orange-50 hover:bg-orange-100 text-orange-600 border border-orange-200 dark:bg-orange-600/20 dark:hover:bg-orange-600/30 dark:text-orange-300 dark:border-orange-500/40 text-[10px] font-bold px-2.5 py-1.5 rounded-xl transition flex items-center gap-1 shrink-0 shadow-xs">
                    <i class="fa-solid fa-comments text-[10px]"></i> Chat
                </div>
            </div>
        </div>`;
    }).join('');
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
                status: sData.isOpen !== false ? 'open' : 'closed'
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

    activeRiderStoreChatOrderId = cleanFirebasePathKey(orderId || 'DIRECT');
    activeRiderStoreChatStoreId = cleanFirebasePathKey(storeId);
    activeRiderStoreChatStoreName = storeName || "Store";

    if (db && activeRiderStoreChatOrderId && activeRiderStoreChatStoreId) {
        db.ref(`storeRiderChats/${activeRiderStoreChatOrderId}_${activeRiderStoreChatStoreId}`).update({
            unreadForRider: false
        }).catch(() => {});
    }

    let modal = document.getElementById('rider-store-chat-window-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'rider-store-chat-window-modal';
        modal.className = 'fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4';
        modal.innerHTML = `
            <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 w-full max-w-md h-[85vh] max-h-[600px] rounded-3xl flex flex-col relative overflow-hidden">
                <div class="p-3.5 bg-gray-50 dark:bg-darkBg/95 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-9 h-9 rounded-xl bg-orange-500/10 text-orange-500 dark:text-orange-400 border border-orange-500/30 flex items-center justify-center text-sm font-black shrink-0">
                            <i class="fa-solid fa-store"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 id="r2s-chat-store-name" class="font-bold text-xs text-gray-900 dark:text-white truncate">Store Chat</h3>
                            <p id="r2s-chat-order-id" class="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate">Direct Store Chat</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <button id="r2s-chat-done-btn" onclick="window.markStoreChatDone && window.markStoreChatDone(activeRiderStoreChatOrderId, activeRiderStoreChatStoreId)" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 shadow-sm" title="Mark Store Order Complete">
                            <i class="fa-solid fa-circle-check"></i> Done
                        </button>
                        <button onclick="window.closeRiderToStoreChatModal && window.closeRiderToStoreChatModal()" class="text-gray-400 hover:text-gray-700 dark:hover:text-white p-1.5 text-sm transition">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>

                <div class="bg-gray-100 dark:bg-darkBg/70 border-b border-gray-200 dark:border-gray-800 p-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
                    <button onclick="window.sendRiderToStoreQuickPreset('🛵 Papunta na po ako sa store para kunin ang order.')" class="bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-600/30 border border-gray-300 dark:border-gray-700 text-blue-600 dark:text-blue-300 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95">
                        🛵 Papunta na sa store
                    </button>
                    <button onclick="window.sendRiderToStoreQuickPreset('📍 Nandito na po ako sa labas ng store.')" class="bg-white dark:bg-gray-800 hover:bg-emerald-50 dark:hover:bg-emerald-600/30 border border-gray-300 dark:border-gray-700 text-emerald-600 dark:text-emerald-300 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95">
                        📍 Nandito na sa labas
                    </button>
                    <button onclick="window.sendRiderToStoreQuickPreset('📦 Nakuha na po ang order, salamat!')" class="bg-white dark:bg-gray-800 hover:bg-purple-50 dark:hover:bg-purple-600/30 border border-gray-300 dark:border-gray-700 text-purple-600 dark:text-purple-300 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95">
                        📦 Nakuha na ang order
                    </button>
                </div>

                <div id="r2s-chat-messages-container" class="flex-1 min-h-0 p-3.5 overflow-y-auto flex flex-col gap-2.5 bg-gray-50 dark:bg-black/40 text-xs">
                    <div class="text-center text-gray-400 dark:text-gray-500 italic py-8 text-xs">Loading store chat history...</div>
                </div>

                <!-- QUOTED REPLY BAR FOR RIDER TO STORE CHAT -->
                <div id="r2s-chat-reply-bar" class="hidden bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-500/40 px-3 py-1.5 flex items-center justify-between gap-2 shrink-0">
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

                <div class="p-3 bg-white dark:bg-darkBg/95 border-t border-gray-200 dark:border-gray-800 flex items-center gap-2 shrink-0">
                    <input type="text" id="r2s-chat-input" placeholder="Type message for merchant..." onkeydown="if(event.key === 'Enter') window.sendRiderToStoreMessage && window.sendRiderToStoreMessage()" class="flex-1 bg-inputBg text-xs rounded-xl p-2.5 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white focus:border-orange-500">
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

    if (nameEl) nameEl.innerText = `🏬 ${activeRiderStoreChatStoreName}`;
    if (orderEl) {
        orderEl.innerText = activeRiderStoreChatOrderId && activeRiderStoreChatOrderId !== 'DIRECT'
            ? `Order #${activeRiderStoreChatOrderId}`
            : `Direct Store Chat`;
    }
    if (doneBtn) {
        if (activeRiderStoreChatOrderId && activeRiderStoreChatOrderId !== 'DIRECT') {
            doneBtn.classList.remove('hidden');
        } else {
            doneBtn.classList.add('hidden');
        }
    }

    cancelRiderStoreReply();
    listenToRiderStoreChat(activeRiderStoreChatOrderId, activeRiderStoreChatStoreId);

    modal.classList.remove('hidden');
}

export function closeRiderToStoreChatModal() {
    const modal = document.getElementById('rider-store-chat-window-modal');
    if (modal) modal.classList.add('hidden');

    if (activeRiderStoreChatListener) {
        activeRiderStoreChatListener.off();
        activeRiderStoreChatListener = null;
    }

    activeRiderStoreChatOrderId = null;
    activeRiderStoreChatStoreId = null;
    activeRiderStoreChatStoreName = null;
    cancelRiderStoreReply();
}

function listenToRiderStoreChat(orderId, storeId) {
    const container = document.getElementById('r2s-chat-messages-container');
    const cleanOrderId = cleanFirebasePathKey(orderId);
    const cleanStoreId = cleanFirebasePathKey(storeId);

    if (!container || !cleanOrderId || !cleanStoreId || !db) return;

    if (activeRiderStoreChatListener) activeRiderStoreChatListener.off();

    activeRiderStoreChatListener = db.ref(`storeRiderChats/${cleanOrderId}_${cleanStoreId}/messages`);
    activeRiderStoreChatListener.on('value', (snap) => {
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

async function postRiderToStoreMessage(text) {
    const orderId = cleanFirebasePathKey(activeRiderStoreChatOrderId);
    const storeId = cleanFirebasePathKey(activeRiderStoreChatStoreId);
    const riderName = appState.riderName || localStorage.getItem('riderName') || "Rider";

    if (!orderId || !storeId || !db) return;

    const payload = {
        sender: 'rider',
        senderType: 'rider',
        senderName: riderName,
        text: text.trim(),
        timestamp: Date.now()
    };

    if (activeRiderStoreReplyTarget) {
        payload.replyTo = {
            id: activeRiderStoreReplyTarget.id,
            sender: activeRiderStoreReplyTarget.sender,
            text: activeRiderStoreReplyTarget.text.substring(0, 120)
        };
    }

    try {
        await db.ref(`storeRiderChats/${orderId}_${storeId}/messages`).push(sanitizeForFirebase(payload));
        await db.ref(`storeRiderChats/${orderId}_${storeId}`).update(sanitizeForFirebase({
            lastMessage: text.trim(),
            lastTimestamp: Date.now(),
            riderName,
            storeName: activeRiderStoreChatStoreName,
            unreadForStore: true
        }));
        cancelRiderStoreReply();
    } catch(e) {
        showToast("❌ Failed to send message to store.");
    }
}

// -------------------------------------------------------------
// MERCHANT SIDE: STORE TO RIDER CHAT MODAL
// -------------------------------------------------------------
export function openStoreToRiderChatModal(orderId, riderId, riderName) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(orderId);

    activeStoreToRiderOrderId = cleanOrderId;

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

    if (activeStoreToRiderChatListener) {
        activeStoreToRiderChatListener.off();
        activeStoreToRiderChatListener = null;
    }
    activeStoreToRiderOrderId = null;
}

function listenToStoreToRiderChat(orderId, storeId) {
    const container = document.getElementById('store-rider-chat-messages');
    if (!container || !db) return;

    if (activeStoreToRiderChatListener) activeStoreToRiderChatListener.off();

    activeStoreToRiderChatListener = db.ref(`storeRiderChats/${orderId}_${storeId}/messages`);
    activeStoreToRiderChatListener.on('value', (snap) => {
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

async function postStoreToRiderMessage(text) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const orderId = cleanFirebasePathKey(activeStoreToRiderOrderId);
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
    const orderId = cleanFirebasePathKey(activeRiderStoreChatOrderId || activeStoreToRiderOrderId);
    const rawStoreId = activeRiderStoreChatStoreId || appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
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

export function setStoreRiderReply(msgId, senderName, text) {
    activeRiderStoreReplyTarget = { id: msgId, sender: senderName, text: text };
    
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
    activeRiderStoreReplyTarget = null;
    const replyBar = document.getElementById('r2s-chat-reply-bar');
    if (replyBar) replyBar.classList.add('hidden');
}

if (typeof window !== 'undefined') {
    window.handleStoreMsgPointerDown = handleStoreMsgPointerDown;
    window.handleStoreMsgPointerMove = handleStoreMsgPointerMove;
    window.handleStoreMsgPointerUp = handleStoreMsgPointerUp;
    window.handleStoreMsgContextMenu = handleStoreMsgContextMenu;

    window.listenToGlobalStoreChats = listenToGlobalStoreChats;
    window.markStoreChatDone = markStoreChatDone;
    window.renderStoreChatsInDashboard = renderStoreChatsInDashboard;
    window.filterRiderStoreChats = filterRiderStoreChats;
    window.clearRiderStoreChatSearch = clearRiderStoreChatSearch;
    window.openRiderStoreChatPicker = openRiderStoreChatPicker;
    window.closeRiderStoreChatPicker = closeRiderStoreChatPicker;
    window.openRiderToStoreChatModal = openRiderToStoreChatModal;
    window.closeRiderToStoreChatModal = closeRiderToStoreChatModal;
    window.sendRiderToStoreMessage = sendRiderToStoreMessage;
    window.sendRiderToStoreQuickPreset = sendRiderToStoreQuickPreset;
    window.openStoreToRiderChatModal = openStoreToRiderChatModal;
    window.closeStoreRiderChatModal = closeStoreRiderChatModal;
    window.sendStoreRiderChatMessage = sendStoreRiderChatMessage;
    window.sendStoreRiderQuickPreset = sendStoreRiderQuickPreset;
    window.toggleStoreRiderReaction = toggleStoreRiderReaction;
    window.setStoreRiderReply = setStoreRiderReply;
    window.cancelRiderStoreReply = cancelRiderStoreReply;
}