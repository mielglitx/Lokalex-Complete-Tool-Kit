// src/features/chat/riderChatFeed.js
import { db } from '../../config/firebase.js';
import { escapeHtml } from '../../utils/helpers.js';
import { populateCateringCustomerDropdown } from './chatUtils.js';
import { listenToGlobalStoreChats, renderStoreChatsInDashboard } from './riderStoreChat.js';
import { openRiderCustomerChatModal } from './riderChat.js';

let activeRiderChatFilter = 'inbox';

export function getActiveRiderChatFilter() { 
    return activeRiderChatFilter; 
}

export function setRiderChatFilter(filterMode) {
    activeRiderChatFilter = filterMode;

    ['inbox', 'catering', 'stores', 'followup', 'done'].forEach(f => {
        const btn = document.getElementById(`rider-chat-tab-${f}`);
        if (btn) {
            const isCurrent = f === filterMode;
            if (isCurrent) {
                btn.className = "flex-1 min-w-[50px] py-1 rounded-lg bg-blue-600 text-white font-bold text-[10px] transition shadow-sm flex items-center justify-center gap-1";
            } else {
                btn.className = "flex-1 min-w-[50px] py-1 rounded-lg text-gray-600 dark:text-gray-400 font-bold text-[10px] hover:text-gray-900 dark:hover:text-white transition flex items-center justify-center gap-1";
            }
        }
    });

    if (filterMode === 'stores') {
        renderStoreChatsInDashboard();
    } else {
        listenToAllCustomerChatsForRider();
    }
}

export function listenToAllCustomerChatsForRider() {
    listenToGlobalStoreChats();
    if (!db) return;

    db.ref('customerChats').on('value', (snapshot) => {
        const data = snapshot.val();
        const feed = document.getElementById('rider-cust-chats-feed');
        const badge = document.getElementById('rider-cust-chats-badge');
        const inboxBadge = document.getElementById('rider-inbox-unread-badge');

        if (!data) {
            if (inboxBadge) inboxBadge.classList.add('hidden');
            if (feed && activeRiderChatFilter !== 'stores') {
                feed.innerHTML = `<div class="text-gray-500 dark:text-gray-400 italic text-center py-4 text-xs">No active customer messages yet.</div>`;
            }
            if (badge && activeRiderChatFilter !== 'stores') badge.innerText = "0 threads";
            return;
        }

        let allThreads = Object.keys(data).map(key => {
            const item = data[key];
            const meta = item.metadata || {};
            const msgs = item.messages ? Object.values(item.messages) : [];
            let isUnread = false;

            if (meta.unreadForRider === true) {
                isUnread = true;
            } else if (meta.unreadForRider === false) {
                isUnread = false;
            } else if (msgs.length > 0) {
                const lastMsg = msgs[msgs.length - 1];
                isUnread = !lastMsg.isRider && lastMsg.senderType !== 'rider' && lastMsg.status !== 'seen';
            } else if (meta.lastMessage && !meta.lastMessage.startsWith('You:')) {
                isUnread = true;
            }

            return {
                custId: key,
                customerName: meta.customerName || "Customer",
                avatarUrl: meta.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(meta.customerName || "Customer")}&background=0084FF&color=fff`,
                lastMessage: meta.lastMessage || "No messages yet",
                lastUpdated: meta.lastUpdated || 0,
                folder: meta.folder || 'inbox',
                cateredByRiderId: meta.cateredByRiderId || null,
                cateredByRiderName: meta.cateredByRiderName || meta.cateredBy || null,
                status: meta.status || 'active',
                isUnread: isUnread
            };
        });

        const unreadInboxCount = allThreads.filter(t => (!t.folder || t.folder === 'inbox') && !t.cateredByRiderName && t.isUnread).length;
        if (inboxBadge) {
            if (unreadInboxCount > 0) {
                inboxBadge.innerText = unreadInboxCount.toString();
                inboxBadge.classList.remove('hidden');
            } else {
                inboxBadge.classList.add('hidden');
            }
        }

        if (activeRiderChatFilter === 'stores') {
            renderStoreChatsInDashboard();
            return;
        }

        if (!feed) return;

        let filteredThreads = allThreads.filter(t => {
            if (activeRiderChatFilter === 'inbox') return (!t.folder || t.folder === 'inbox') && !t.cateredByRiderName;
            if (activeRiderChatFilter === 'catering') return t.folder === 'catering' || !!t.cateredByRiderName;
            if (activeRiderChatFilter === 'followup') return t.folder === 'followup';
            if (activeRiderChatFilter === 'done') return t.folder === 'done';
            return true;
        });

        filteredThreads.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));

        if (badge) badge.innerText = `${filteredThreads.length} ${filteredThreads.length === 1 ? 'thread' : 'threads'}`;

        if (filteredThreads.length === 0) {
            feed.innerHTML = `<div class="text-gray-500 dark:text-gray-400 italic text-center py-4 text-xs">No ${activeRiderChatFilter} threads found.</div>`;
            return;
        }

        feed.innerHTML = filteredThreads.map(t => {
            const timeStr = t.lastUpdated ? new Date(t.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
            const statusBadge = t.cateredByRiderName 
                ? `<span class="bg-orange-100 text-orange-800 border border-orange-300 dark:bg-orange-500/20 dark:text-orange-400 dark:border-orange-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"><i class="fa-solid fa-motorcycle"></i> ${escapeHtml(t.cateredByRiderName)}</span>`
                : "";

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
            populateCateringCustomerDropdown();
        }
    });
}