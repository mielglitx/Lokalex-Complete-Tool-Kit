// src/features/chat/storeChat/storeChatFeed.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { storeChatState, cleanFirebasePathKey } from './storeChatState.js';

export function renderReactionsHtml(reactions, msgId) {
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

export function renderReplyPreviewInsideMessage(replyTo) {
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

export function listenToGlobalStoreChats() {
    if (!db) return;

    if (!storeChatState.globalStoresListener) {
        storeChatState.globalStoresListener = db.ref('stores');
        storeChatState.globalStoresListener.on('value', (snapshot) => {
            const val = snapshot.val();
            if (val && Object.keys(val).length > 0) {
                storeChatState.allStoresListCache = Object.entries(val).map(([sId, sData]) => ({
                    storeId: cleanFirebasePathKey(sId),
                    storeName: sData.storeName || sData.name || "Store",
                    address: sData.address || sData.rate || "",
                    isOpen: sData.isOpen !== false && sData.status !== 'closed' && sData.status !== 'inactive',
                    logoUrl: sData.logoUrl || sData.photoUrl || sData.imageUrl || "",
                    contact: sData.contact || sData.phone || ""
                }));
            } else {
                storeChatState.allStoresListCache = [];
            }

            if (window.getActiveRiderChatFilter && window.getActiveRiderChatFilter() === 'stores') {
                renderStoreChatsInDashboard();
            }
        });
    }

    if (!storeChatState.globalStoreChatsListener) {
        storeChatState.globalStoreChatsListener = db.ref('storeRiderChats');
        storeChatState.globalStoreChatsListener.on('value', (snapshot) => {
            storeChatState.cachedStoreChatsData = snapshot.val() || {};
            
            let unreadCount = 0;
            Object.entries(storeChatState.cachedStoreChatsData).forEach(([key, val]) => {
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
    const cleanOrderId = cleanFirebasePathKey(orderId || storeChatState.activeRiderStoreChatOrderId);
    const cleanStoreId = cleanFirebasePathKey(storeId || storeChatState.activeRiderStoreChatStoreId);

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
        if (window.closeRiderToStoreChatModal) {
            window.closeRiderToStoreChatModal();
        }
    } catch(e) {
        showToast("❌ Failed to mark store chat as done.");
    }
}

export function filterRiderStoreChats(query) {
    storeChatState.storeSearchQuery = (query || '').toLowerCase().trim();
    renderStoreChatsListOnly();
}

export function clearRiderStoreChatSearch() {
    storeChatState.storeSearchQuery = '';
    const input = document.getElementById('rider-store-chat-search');
    if (input) {
        input.value = '';
        input.focus();
    }
    renderStoreChatsListOnly();
}

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
                    value="${escapeHtml(storeChatState.storeSearchQuery)}"
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

export function renderStoreChatsListOnly() {
    const listContainer = document.getElementById('rider-store-chats-list');
    const badge = document.getElementById('rider-cust-chats-badge');
    if (!listContainer) return;

    const storeMap = new Map();

    // 1. Populate registered stores
    storeChatState.allStoresListCache.forEach(store => {
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

    // 2. Attach existing chat thread metadata strictly to registered stores
    Object.entries(storeChatState.cachedStoreChatsData || {}).forEach(([chatKey, data]) => {
        if (!data) return;

        let targetStoreId = data.storeId ? cleanFirebasePathKey(data.storeId) : null;
        if (!targetStoreId || !storeMap.has(targetStoreId)) {
            const found = storeChatState.allStoresListCache.find(s => chatKey.endsWith(`_${s.storeId}`) || chatKey === s.storeId);
            if (found) {
                targetStoreId = found.storeId;
            }
        }

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

    allMerged.sort((a, b) => {
        const nameA = (a.storeName || "").trim();
        const nameB = (b.storeName || "").trim();
        return nameA.localeCompare(nameB, 'en', { sensitivity: 'base' });
    });

    if (storeChatState.storeSearchQuery) {
        allMerged = allMerged.filter(s => 
            (s.storeName || "").toLowerCase().includes(storeChatState.storeSearchQuery) ||
            (s.address || "").toLowerCase().includes(storeChatState.storeSearchQuery)
        );
    }

    if (badge) {
        badge.innerText = `${allMerged.length} ${allMerged.length === 1 ? 'store' : 'stores'}`;
    }

    if (allMerged.length === 0) {
        listContainer.innerHTML = `
        <div class="text-gray-400 dark:text-gray-500 italic text-center py-8 text-xs flex flex-col items-center gap-1.5">
            <i class="fa-solid fa-store text-xl text-orange-500/60"></i>
            <span>${storeChatState.storeSearchQuery ? `No stores found matching "${escapeHtml(storeChatState.storeSearchQuery)}"` : 'No stores registered yet.'}</span>
            ${storeChatState.storeSearchQuery ? `
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