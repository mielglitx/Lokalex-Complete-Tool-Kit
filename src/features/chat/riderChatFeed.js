// src/features/chat/riderChatFeed.js
import { db } from '../../config/firebase.js';
import { escapeHtml } from '../../utils/helpers.js';
import { populateCateringCustomerDropdown } from './chatUtils.js';
import { listenToGlobalStoreChats, renderStoreChatsInDashboard } from './riderStoreChat.js';
import { openRiderCustomerChatModal } from './riderChat.js';
import { 
    getActiveRiderFbChannel, 
    getPublicFbChannelName, 
    isSourceSelected, 
    isAllSourcesSelected, 
    getActiveRiderSources, 
    hasAnyFbSourceSelected 
} from './facebookApiAdmin.js';

let activeRiderChatFilter = 'inbox';
let cachedCustomerThreadsMap = new Map();
let isCustomerChatMetaListening = false;
let rawCustomerChatMetaData = null;

export function getActiveRiderChatFilter() { 
    return activeRiderChatFilter; 
}

export function setRiderChatFilter(filterMode) {
    activeRiderChatFilter = filterMode;

    const tabs = [
        { id: 'inbox', minW: 'min-w-[55px]' },
        { id: 'catering', minW: 'min-w-[55px]' },
        { id: 'stores', minW: 'min-w-[65px]' },
        { id: 'followup', minW: 'min-w-[60px]' },
        { id: 'done', minW: 'min-w-[45px]' }
    ];

    tabs.forEach(t => {
        const btn = document.getElementById(`rider-chat-tab-${t.id}`);
        if (btn) {
            const isCurrent = t.id === filterMode;
            if (isCurrent) {
                btn.className = `flex-1 ${t.minW} py-1 rounded-lg bg-blue-600 text-white font-bold text-[10px] transition shadow-sm flex items-center justify-center gap-1 cursor-pointer`;
            } else {
                btn.className = `flex-1 ${t.minW} py-1 rounded-lg text-gray-600 dark:text-gray-400 font-bold text-[10px] hover:text-gray-900 dark:hover:text-white transition flex items-center justify-center gap-1 cursor-pointer`;
            }
        }
    });

    if (filterMode === 'stores') {
        renderStoreChatsInDashboard();
    } else {
        renderRiderCustomerChatFeed();
        listenToAllCustomerChatsForRider();
    }
}

function getThreadDedupKey(key, meta) {
    const rawPhone = meta.phoneNumber || meta.phone || meta.customerPhone || 
                     (typeof key === 'string' && (key.startsWith('+63') || key.startsWith('09') || key.startsWith('63')) ? key : '');
    const cleanPhone = String(rawPhone).replace(/\D/g, '');
    if (cleanPhone.length >= 10) {
        return `phone_${cleanPhone.slice(-10)}`;
    }

    const cleanName = (meta.customerName || meta.name || '').trim().toLowerCase();
    const nameParts = cleanName.split(/\s+/).filter(Boolean);
    // Only dedup by name if there are at least two distinct name parts to avoid collapsing unrelated single names
    if (nameParts.length >= 2 && !cleanName.includes('customer') && !cleanName.includes('unknown')) {
        return `name_${cleanName}`;
    }

    return `id_${key}`;
}

export function renderRiderCustomerChatFeed() {
    if (activeRiderChatFilter === 'stores') return;

    const feed = document.getElementById('rider-cust-chats-feed');
    const badge = document.getElementById('rider-cust-chats-badge');
    if (!feed) return;

    // Immediately remove lingering store search elements if present
    const storeSearch = document.getElementById('rider-store-search-container');
    if (storeSearch) {
        storeSearch.remove();
    }

    const allThreads = Array.from(cachedCustomerThreadsMap.values());

    if (allThreads.length === 0) {
        feed.innerHTML = `<div class="text-gray-500 dark:text-gray-400 italic text-center py-4 text-xs">No active customer messages yet.</div>`;
        if (badge) badge.innerText = "0 threads";
        return;
    }

    const isAllSources = (typeof isAllSourcesSelected === 'function') ? isAllSourcesSelected() : true;

    let filteredThreads = allThreads.filter(t => {
        // 1. Filter by chosen chat sources (Multi-Source support)
        if (typeof isSourceSelected === 'function' && !isAllSources) {
            if (t.channel === 'messenger') {
                const threadFbId = t.apiId || t.channelId || t.fbApiId;
                if (threadFbId) {
                    if (!isSourceSelected(threadFbId)) return false;
                } else {
                    if (!isSourceSelected('messenger') && !hasAnyFbSourceSelected()) return false;
                }
            } else {
                // Web customer thread
                if (!isSourceSelected('web')) return false;
            }
        }

        // 2. Filter by active tab folder
        if (activeRiderChatFilter === 'inbox') return (!t.folder || t.folder === 'inbox') && !t.cateredByRiderName;
        if (activeRiderChatFilter === 'catering') return t.folder === 'catering' || !!t.cateredByRiderName;
        if (activeRiderChatFilter === 'followup') return t.folder === 'followup';
        if (activeRiderChatFilter === 'done') return t.folder === 'done';
        return true;
    });

    filteredThreads.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));

    if (badge) {
        badge.innerText = `${filteredThreads.length} ${filteredThreads.length === 1 ? 'thread' : 'threads'}`;
    }

    if (filteredThreads.length === 0) {
        if (typeof getActiveRiderSources === 'function' && !isAllSources) {
            const activeSources = getActiveRiderSources().filter(s => s !== 'all');
            if (activeSources.length === 0) {
                feed.innerHTML = `
                <div class="flex flex-col items-center justify-center p-4 text-center gap-2">
                    <div class="text-gray-400 dark:text-gray-500 text-xs italic">No chat sources currently selected.</div>
                    <button onclick="window.selectAllRiderSources && window.selectAllRiderSources()" class="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-3 py-1 rounded-lg transition active:scale-95 shadow-xs cursor-pointer">
                        <i class="fa-solid fa-rotate-left mr-1"></i> Show All Sources
                    </button>
                </div>`;
                return;
            }
        }
        const channelLabel = !isAllSources ? ` in selected sources` : '';
        feed.innerHTML = `<div class="text-gray-500 dark:text-gray-400 italic text-center py-4 text-xs">No ${escapeHtml(activeRiderChatFilter)} threads found${channelLabel}.</div>`;
        return;
    }

    feed.innerHTML = filteredThreads.map(t => {
        const timeStr = t.lastUpdated ? new Date(t.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
        const statusBadge = t.cateredByRiderName 
            ? `<span class="bg-orange-100 text-orange-800 border border-orange-300 dark:bg-orange-500/20 dark:text-orange-400 dark:border-orange-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"><i class="fa-solid fa-motorcycle"></i> ${escapeHtml(t.cateredByRiderName)}</span>`
            : "";

        let channelBadge = "";
        if (t.channel === 'messenger') {
            const channelName = t.apiName || (typeof getPublicFbChannelName === 'function' ? getPublicFbChannelName(t.apiId) : '') || 'FB';
            channelBadge = `<span class="bg-blue-100 text-blue-800 border border-blue-300 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0" title="Source: ${escapeHtml(channelName)}"><i class="fa-brands fa-facebook-messenger text-blue-500"></i> ${escapeHtml(channelName)}</span>`;
        } else {
            channelBadge = `<span class="bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0" title="Source: Lokalex Web App"><i class="fa-solid fa-globe text-emerald-500"></i> Web</span>`;
        }

        const unreadDot = t.isUnread ? `<span class="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shrink-0"></span>` : "";
        const cardBorderClass = t.isUnread 
            ? "border-2 border-blue-500 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-950/30 shadow-md ring-1 ring-blue-400/40" 
            : "border border-gray-200 dark:border-gray-800 bg-white dark:bg-cardBg";
        const nameClass = t.isUnread
            ? "font-black text-blue-600 dark:text-blue-400 text-sm"
            : "font-black text-gray-900 dark:text-white text-xs";
        const lastMsgClass = t.isUnread 
            ? "text-xs text-gray-900 dark:text-white font-black" 
            : "text-[11px] text-gray-700 dark:text-gray-300 font-medium";

        return `
        <div onclick="window.openRiderCustomerChatModal('${t.custId}', '${escapeHtml(t.customerName)}', '${escapeHtml(t.avatarUrl)}')" class="${cardBorderClass} hover:bg-gray-50 dark:hover:bg-black/50 p-3 rounded-2xl flex items-center justify-between cursor-pointer transition active:scale-[0.99] shadow-xs">
            <div class="flex items-center gap-3 min-w-0 flex-1">
                <div class="relative shrink-0">
                    <img src="${t.avatarUrl}" class="w-10 h-10 rounded-full object-cover border-2 ${t.isUnread ? 'border-blue-500 ring-2 ring-blue-400/50' : 'border-blue-500'}">
                    ${t.isUnread ? '<div class="absolute -top-0.5 -right-0.5 w-3 h-3 bg-blue-500 rounded-full border-2 border-white dark:border-darkBg animate-ping"></div>' : ''}
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 truncate">
                        <span class="truncate ${nameClass}">${escapeHtml(t.customerName)}</span>
                        ${channelBadge}
                        ${unreadDot}
                        ${statusBadge}
                    </div>
                    <div class="${lastMsgClass} truncate mt-0.5">${escapeHtml(t.lastMessage)}</div>
                </div>
            </div>
            <div class="text-[10px] ${t.isUnread ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-500 dark:text-gray-400 font-medium'} font-mono shrink-0 ml-2">${timeStr}</div>
        </div>`;
    }).join('');

    if (typeof populateCateringCustomerDropdown === 'function') {
        populateCateringCustomerDropdown(rawCustomerChatMetaData);
    }
}

export function listenToAllCustomerChatsForRider() {
    listenToGlobalStoreChats();
    if (!db || isCustomerChatMetaListening) return;
    isCustomerChatMetaListening = true;

    db.ref('customerChatMeta').on('value', (snapshot) => {
        let data = snapshot.val();
        rawCustomerChatMetaData = data;
        const inboxBadge = document.getElementById('rider-inbox-unread-badge');

        if (!data || Object.keys(data).length === 0) {
            cachedCustomerThreadsMap.clear();
            if (inboxBadge) inboxBadge.classList.add('hidden');
            if (activeRiderChatFilter !== 'stores') {
                renderRiderCustomerChatFeed();
            }
            return;
        }

        const threadsMap = new Map();

        Object.keys(data).forEach(key => {
            const item = data[key] || {};
            const meta = item.metadata || item;
            const rawLastMsg = (meta.lastMessage || '').trim();
            const hasValidLastMsg = rawLastMsg !== '' && rawLastMsg.toLowerCase() !== 'no messages yet';

            // 1. Exclude ghost threads that contain zero conversation history
            if (!hasValidLastMsg && !meta.lastUpdated) {
                return;
            }

            let isUnread = false;
            if (meta.unreadForRider === true) {
                isUnread = true;
            } else if (meta.unreadForRider === false) {
                isUnread = false;
            } else if (rawLastMsg && !rawLastMsg.startsWith('You:')) {
                isUnread = true;
            }

            const threadObj = {
                custId: key,
                customerName: meta.customerName || meta.name || "Customer",
                avatarUrl: meta.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(meta.customerName || meta.name || "Customer")}&background=0084FF&color=fff`,
                lastMessage: rawLastMsg || "No messages yet",
                lastUpdated: meta.lastUpdated || 0,
                folder: meta.folder || 'inbox',
                channel: meta.channel || (key.startsWith('fb_') || key.startsWith('messenger_') ? 'messenger' : 'web'),
                apiId: meta.apiId || meta.channelId || meta.fbApiId || null,
                apiName: meta.apiName || meta.channelName || null,
                cateredByRiderId: meta.cateredByRiderId || null,
                cateredByRiderName: meta.cateredByRiderName || meta.cateredBy || null,
                status: meta.status || 'active',
                isUnread: isUnread,
                hasRealMessages: hasValidLastMsg
            };

            const dedupKey = getThreadDedupKey(key, meta);

            // 2. Deduplicate matching customer accounts: keep active thread with real messages and latest update
            if (threadsMap.has(dedupKey)) {
                const existing = threadsMap.get(dedupKey);
                const currentScore = (threadObj.hasRealMessages ? 10000000000000 : 0) + (threadObj.lastUpdated || 0);
                const existingScore = (existing.hasRealMessages ? 10000000000000 : 0) + (existing.lastUpdated || 0);

                if (currentScore > existingScore) {
                    threadObj.isUnread = threadObj.isUnread || existing.isUnread;
                    if (!threadObj.cateredByRiderName && existing.cateredByRiderName) {
                        threadObj.cateredByRiderName = existing.cateredByRiderName;
                        threadObj.cateredByRiderId = existing.cateredByRiderId;
                    }
                    threadsMap.set(dedupKey, threadObj);
                } else {
                    existing.isUnread = existing.isUnread || threadObj.isUnread;
                    if (!existing.cateredByRiderName && threadObj.cateredByRiderName) {
                        existing.cateredByRiderName = threadObj.cateredByRiderName;
                        existing.cateredByRiderId = threadObj.cateredByRiderId;
                    }
                }
            } else {
                threadsMap.set(dedupKey, threadObj);
            }
        });

        cachedCustomerThreadsMap = threadsMap;

        const allThreads = Array.from(threadsMap.values());
        const unreadInboxCount = allThreads.filter(t => (!t.folder || t.folder === 'inbox') && !t.cateredByRiderName && t.isUnread).length;
        if (inboxBadge) {
            if (unreadInboxCount > 0) {
                inboxBadge.innerText = unreadInboxCount.toString();
                inboxBadge.classList.remove('hidden');
            } else {
                inboxBadge.classList.add('hidden');
            }
        }

        if (activeRiderChatFilter !== 'stores') {
            renderRiderCustomerChatFeed();
        }
    });
}