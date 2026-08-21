// src/features/chat/riderChat.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { escapeHtml } from '../../utils/helpers.js';
import { toggleBodyScroll, populateCateringCustomerDropdown } from './chatUtils.js';
import { openMapPicker } from '../maps.js';
import { listenToGlobalStoreChats, renderStoreChatsInDashboard } from './riderStoreChat.js';
import { highlightActiveMilestoneUI } from './riderThreadActions.js';

let activeRiderChatCustId = null;
let activeRiderChatListener = null;
let activeRiderChatMetaListener = null;
let currentRiderChatMeta = null;
let activeRiderChatFilter = 'inbox';
let activeCustData = null;

let activeRiderReplyTarget = null;
const MAPS_API_KEY = "AIzaSyBVAwn0UnyHJ926oHeK0k789ncADMzmX80";

const RIDER_CHAT_BATCH_SIZE = 25;
let oldestRiderMsgTimestamp = null;
let hasMoreRiderMsgs = true;
let isLoadingRiderHistory = false;
let loadedRiderMsgsMap = new Map();

function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

function cleanFirebasePathKey(key) {
    return String(key || '').replace(/^#+/, '').replace(/[.#$\[\]\/]/g, '_').trim();
}

export function getActiveRiderChatCustId() { return activeRiderChatCustId; }
export function getCurrentRiderChatMeta() { return currentRiderChatMeta; }
export function getActiveRiderChatFilter() { return activeRiderChatFilter; }
export function getActiveCustData() { return activeCustData; }
export function setActiveCustData(data) { activeCustData = data; }

function renderRiderMessageStatusIndicator(msg) {
    const sentTime = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
    const seenTime = msg.seenAt ? new Date(msg.seenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
    
    let iconHtml = '<i class="fa-regular fa-clock text-blue-200" title="Sending..."></i>';
    let titleAttr = `Sent ${sentTime}`;

    if (msg.status === 'sent') {
        iconHtml = '<i class="fa-solid fa-check text-blue-200" title="Sent"></i>';
    } else if (msg.status === 'delivered') {
        iconHtml = '<i class="fa-solid fa-check-double text-blue-200" title="Delivered"></i>';
        titleAttr += ` • Delivered`;
    } else if (msg.status === 'seen') {
        iconHtml = '<i class="fa-solid fa-check-double text-cyan-200" title="Seen"></i>';
        titleAttr += ` • Seen at ${seenTime}`;
    }

    return `<span class="inline-flex items-center gap-1 ml-1 cursor-help" title="${titleAttr}">
        ${iconHtml}
        ${msg.status === 'seen' && seenTime ? `<span class="text-[8px] text-cyan-200 opacity-90 font-mono">Seen ${seenTime}</span>` : ''}
    </span>`;
}

function renderReactionsHtml(reactions, msgId) {
    if (!reactions || typeof reactions !== 'object') return '';
    const reactionEntries = Object.entries(reactions);
    if (reactionEntries.length === 0) return '';

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || 'rider').toString();

    const badges = reactionEntries.map(([emoji, usersMap]) => {
        if (!usersMap || typeof usersMap !== 'object') return '';
        const count = Object.keys(usersMap).length;
        if (count === 0) return '';
        const hasReacted = myId && usersMap[myId];

        return `
        <button onclick="event.stopPropagation(); window.toggleRiderMessageReaction('${msgId}', '${emoji}')" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] ${hasReacted ? 'bg-blue-600/30 border border-blue-400 text-white' : 'bg-gray-100 dark:bg-black/60 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'} transition active:scale-90">
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

function showRiderInChatToast(container, senderName, previewText) {
    let toast = document.getElementById('rider-inchat-newmsg-toast');
    const parent = container.parentElement;

    if (parent && !parent.classList.contains('relative')) {
        parent.classList.add('relative');
    }

    if (!toast && parent) {
        toast = document.createElement('div');
        toast.id = 'rider-inchat-newmsg-toast';
        toast.className = 'absolute bottom-14 left-4 right-4 bg-blue-600 text-white text-xs py-2 px-3 rounded-xl border border-blue-400 flex items-center justify-between cursor-pointer z-30 transition-all duration-200';
        parent.appendChild(toast);
    }

    if (toast) {
        toast.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                <i class="fa-solid fa-circle-down text-blue-200 text-sm shrink-0 animate-bounce"></i>
                <span class="truncate font-medium"><strong>${escapeHtml(senderName)}:</strong> ${escapeHtml(previewText)}</span>
            </div>
            <span class="text-[10px] bg-blue-800/80 px-2 py-0.5 rounded-md font-bold uppercase shrink-0">View ↓</span>
        `;

        toast.onclick = () => {
            container.scrollTop = container.scrollHeight;
            toast.classList.add('hidden');
        };

        toast.classList.remove('hidden');
    }
}

function hideRiderInChatToast() {
    const toast = document.getElementById('rider-inchat-newmsg-toast');
    if (toast) toast.classList.add('hidden');
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
            <div onclick="openRiderCustomerChatModal('${t.custId}', '${escapeHtml(t.customerName)}', '${escapeHtml(t.avatarUrl)}')" class="${cardBorderClass} hover:bg-gray-50 dark:hover:bg-black/50 p-3 rounded-2xl flex items-center justify-between cursor-pointer transition active:scale-[0.99] shadow-xs">
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

export function openRiderChatModal(custId, custName) {
    openRiderCustomerChatModal(custId, custName);
}

export function openRiderCustomerChatModal(custId, custName, avatarUrl) {
    activeRiderChatCustId = custId;

    if (db && custId) {
        db.ref(`customerChats/${custId}/metadata`).update({
            unreadForRider: false
        }).catch(() => {});
    }

    const modal = document.getElementById('rider-customer-chat-modal') || document.getElementById('rider-chat-modal');
    const nameEl = document.getElementById('rider-chat-cust-name');
    const avatarEl = document.getElementById('rider-chat-cust-avatar') || document.getElementById('rider-chat-avatar');

    const resolvedAvatar = avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName || "Customer")}&background=0084FF&color=fff`;

    if (nameEl) nameEl.innerText = custName || "Customer";
    if (avatarEl) {
        if (avatarEl.tagName === 'IMG') {
            avatarEl.src = resolvedAvatar;
        } else {
            avatarEl.innerText = (custName || "CU").split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        }
    }

    if (modal) {
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
    }

    cancelRiderReply();

    if (activeRiderChatListener) activeRiderChatListener.off();
    if (activeRiderChatMetaListener) activeRiderChatMetaListener.off();

    if (db && custId) {
        db.ref(`customers/${custId}`).once('value', (snap) => {
            activeCustData = snap.val() || {};
        });

        activeRiderChatMetaListener = db.ref(`customerChats/${custId}/metadata`);
        activeRiderChatMetaListener.on('value', (snapshot) => {
            currentRiderChatMeta = snapshot.val() || {};
            evaluateRiderChatLockPermissions();
            bindRiderToActiveStoreOrders(currentRiderChatMeta);
            syncMilestoneBarUI(currentRiderChatMeta);
        });

        listenToRiderChatMessages(custId);
    }
}

function syncMilestoneBarUI(meta) {
    const bar = document.getElementById('rider-chat-milestone-bar');
    const orderId = meta?.latestOrderId;

    if (!bar) return;

    if (orderId && db) {
        bar.classList.remove('hidden');
        db.ref(`orders/${cleanFirebasePathKey(orderId)}/status`).once('value', (snap) => {
            const currentStatus = snap.val() || 'placed';
            highlightActiveMilestoneUI(currentStatus);
        });
    } else {
        bar.classList.add('hidden');
    }
}

function bindRiderToActiveStoreOrders(meta) {
    if (!meta || !db) return;
    const latestOrderId = cleanFirebasePathKey(meta.latestOrderId);
    const storeIds = meta.orderedStoreIds || [];
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = appState.riderName || localStorage.getItem('riderName') || "Assigned Rider";

    if (latestOrderId && storeIds.length > 0 && myName) {
        storeIds.forEach(sId => {
            const cleanSId = cleanFirebasePathKey(sId);
            db.ref(`storeOrders/${cleanSId}/${latestOrderId}`).update({
                riderId: myId,
                riderName: myName
            }).catch(() => {});
        });
    }
}

export function listenToRiderChatMessages(custId) {
    if (!db || !custId) return;

    const container = document.getElementById('rider-cust-chat-messages') || document.getElementById('rider-chat-messages-container');
    if (!container) return;

    oldestRiderMsgTimestamp = null;
    hasMoreRiderMsgs = true;
    isLoadingRiderHistory = false;
    loadedRiderMsgsMap.clear();

    setupRiderScrollPagination(container, custId);

    activeRiderChatListener = db.ref(`customerChats/${custId}/messages`).orderByChild('timestamp').limitToLast(RIDER_CHAT_BATCH_SIZE);

    activeRiderChatListener.on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            container.innerHTML = `<div class="text-center text-gray-500 dark:text-gray-400 italic py-10 text-xs">No messages yet.</div>`;
            return;
        }

        const isInitialLoad = loadedRiderMsgsMap.size === 0;
        let newCustMsg = null;

        Object.entries(data).forEach(([key, msg]) => {
            const isNew = !loadedRiderMsgsMap.has(key);
            loadedRiderMsgsMap.set(key, { id: key, ...msg });

            if (isNew && !isInitialLoad && !msg.isRider) {
                newCustMsg = msg;
            }

            if (!msg.isRider && msg.status !== 'seen') {
                db.ref(`customerChats/${custId}/messages/${key}`).update({
                    status: 'seen',
                    seenAt: Date.now()
                });
            }
        });

        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;

        renderRiderMessages(container, isInitialLoad);

        if (newCustMsg && !isInitialLoad) {
            const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";
            if (!isNearBottom) {
                const preview = newCustMsg.text || (newCustMsg.imageUrl ? "📷 Photo" : "📍 Location");
                showRiderInChatToast(container, newCustMsg.sender || custName, preview);
            } else {
                hideRiderInChatToast();
                requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
            }
        }
    });
}

function setupRiderScrollPagination(container, custId) {
    container.onscroll = () => {
        if (container.scrollTop < 50 && !isLoadingRiderHistory && hasMoreRiderMsgs && oldestRiderMsgTimestamp) {
            loadOlderRiderMessages(container, custId);
        }

        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
        if (isNearBottom) {
            hideRiderInChatToast();
        }
    };
}

async function loadOlderRiderMessages(container, custId) {
    if (isLoadingRiderHistory || !hasMoreRiderMsgs || !oldestRiderMsgTimestamp) return;

    isLoadingRiderHistory = true;
    showRiderTopSpinner(container);

    const oldScrollHeight = container.scrollHeight;

    try {
        const snap = await db.ref(`customerChats/${custId}/messages`)
            .orderByChild('timestamp')
            .endAt(oldestRiderMsgTimestamp - 1)
            .limitToLast(20)
            .once('value');

        const data = snap.val();
        hideRiderTopSpinner();

        if (!data || Object.keys(data).length === 0) {
            hasMoreRiderMsgs = false;
            isLoadingRiderHistory = false;
            renderRiderMessages(container, false, oldScrollHeight);
            return;
        }

        const entries = Object.entries(data);
        if (entries.length < 20) {
            hasMoreRiderMsgs = false;
        }

        entries.forEach(([key, msg]) => {
            loadedRiderMsgsMap.set(key, { id: key, ...msg });
        });

        renderRiderMessages(container, false, oldScrollHeight);
    } catch (e) {
        console.error("Error loading older rider chat messages:", e);
        hideRiderTopSpinner();
    } finally {
        isLoadingRiderHistory = false;
    }
}

function showRiderTopSpinner(container) {
    let spinner = document.getElementById('rider-chat-history-spinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'rider-chat-history-spinner';
        spinner.className = 'flex items-center justify-center py-2 text-blue-600 dark:text-blue-400 text-xs gap-2 font-bold shrink-0';
        spinner.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading older messages...`;
    }
    if (container.firstChild) {
        container.insertBefore(spinner, container.firstChild);
    } else {
        container.appendChild(spinner);
    }
}

function hideRiderTopSpinner() {
    const spinner = document.getElementById('rider-chat-history-spinner');
    if (spinner) spinner.remove();
}

function renderRiderMessages(container, isInitialLoad = false, oldScrollHeight = 0) {
    const msgs = Array.from(loadedRiderMsgsMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    if (msgs.length > 0) {
        oldestRiderMsgTimestamp = msgs[0].timestamp || null;
    }

    const riderName = appState.riderName || "Rider";
    const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";
    const custAvatar = activeCustData?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=0084FF&color=fff`;
    const riderAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(riderName)}&background=3B82F6&color=fff`;

    const messagesHtml = msgs.map(m => {
        const isRider = !!m.isRider || m.senderType === 'rider';
        const alignClass = isRider 
            ? "self-end bg-blue-600 text-white rounded-tr-none" 
            : "self-start bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-200 rounded-tl-none";
        const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";

        const senderName = m.sender || (isRider ? riderName : custName);
        const senderAvatar = isRider ? riderAvatar : custAvatar;
        const statusIndicator = isRider ? renderRiderMessageStatusIndicator(m) : '';
        const replyBlockHtml = renderReplyPreviewInsideMessage(m.replyTo);
        const reactionsHtml = renderReactionsHtml(m.reactions, m.id);

        const imgHtml = m.imageUrl || (m.type === 'image' ? m.text : null);
        const imageMarkup = imgHtml ? `<img src="${imgHtml}" onclick="event.stopPropagation(); window.openImageViewerModal && window.openImageViewerModal('${escapeHtml(imgHtml)}', 'rider')" class="w-52 max-w-full rounded-xl mt-1.5 border border-gray-200 dark:border-gray-700 cursor-pointer hover:opacity-90 transition">` : '';
        
        let locationHtml = "";
        let lat = null;
        let lng = null;

        if (m.locationCoords && m.locationCoords.lat && m.locationCoords.lng) {
            lat = m.locationCoords.lat;
            lng = m.locationCoords.lng;
        } else if (m.type === 'location' && m.text) {
            const match = m.text.match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (match) {
                lat = match[1];
                lng = match[2];
            }
        }

        if (lat && lng) {
            const mapUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
            const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&size=400x200&maptype=roadmap&markers=color:red%7C${lat},${lng}&key=${MAPS_API_KEY}`;

            locationHtml = `
            <div class="mt-1.5 flex flex-col gap-1 rounded-xl overflow-hidden border border-emerald-500/40 bg-gray-50 dark:bg-black/40 p-1">
                <a href="${mapUrl}" target="_blank" onclick="event.stopPropagation()" class="block relative group overflow-hidden rounded-lg">
                    <img src="${staticMapUrl}" alt="Map Location Preview" class="w-full h-32 object-cover rounded-lg group-hover:scale-105 transition-transform duration-200">
                    <div class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <span class="bg-black/80 text-white text-[10px] font-bold px-2 py-1 rounded-md"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open in Maps</span>
                    </div>
                </a>
                <a href="${mapUrl}" target="_blank" onclick="event.stopPropagation()" class="bg-emerald-600/20 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 font-bold px-2.5 py-1.5 rounded-lg text-[11px] flex items-center justify-center gap-1.5 active:scale-95 transition">
                    <i class="fa-solid fa-map-location-dot text-red-400"></i> View Shared Location
                </a>
            </div>`;
        }

        return `
        <div id="msg-bubble-${m.id}" class="flex items-start gap-1.5 ${isRider ? 'flex-row-reverse' : 'flex-row'} my-0.5">
            <img src="${senderAvatar}" class="w-6 h-6 rounded-full object-cover border border-blue-400/40 shrink-0 mt-1">
            <div onclick="window.openMessageActionPopover(event, '${m.id}', 'rider-cust', '${encodeURIComponent(m.text || '')}', '${encodeURIComponent(senderName)}')" class="max-w-[85%] p-2.5 rounded-2xl flex flex-col gap-0.5 text-xs ${alignClass} cursor-pointer transition active:scale-[0.98] select-text shadow-xs">
                <div class="text-[9px] ${isRider ? 'text-blue-100' : 'text-blue-600 dark:text-blue-400'} font-bold flex justify-between gap-3">
                    <span>${escapeHtml(senderName)}</span>
                    <div class="flex items-center gap-1 opacity-80 font-mono">
                        <span>${timeStr}</span>
                        ${statusIndicator}
                    </div>
                </div>
                ${replyBlockHtml}
                ${(m.text && !imgHtml && !locationHtml) ? `<div class="leading-relaxed whitespace-pre-wrap font-sans break-words">${escapeHtml(m.text)}</div>` : ''}
                ${imageMarkup}
                ${locationHtml}
                ${reactionsHtml}
            </div>
        </div>`;
    }).join('');

    let topHeader = '';
    if (!hasMoreRiderMsgs) {
        topHeader = `<div class="text-center text-gray-500 dark:text-gray-400 text-[10px] py-1.5 italic shrink-0">Beginning of message history</div>`;
    }

    container.innerHTML = topHeader + messagesHtml;

    if (isInitialLoad) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 80);
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 250);
        });
    } else if (oldScrollHeight > 0) {
        const newScrollHeight = container.scrollHeight;
        container.scrollTop = newScrollHeight - oldScrollHeight;
    }
}

export function setRiderReply(msgId, senderName, text) {
    activeRiderReplyTarget = { id: msgId, sender: senderName, text: text };
    
    let replyBar = document.getElementById('rider-chat-reply-bar');
    if (!replyBar) {
        const inputContainer = document.getElementById('rider-chat-input-container') || (document.getElementById('rider-cust-chat-input') || document.getElementById('rider-chat-input'))?.parentElement;
        if (inputContainer && inputContainer.parentElement) {
            replyBar = document.createElement('div');
            replyBar.id = 'rider-chat-reply-bar';
            replyBar.className = 'bg-blue-50/90 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-500/40 px-3 py-1.5 rounded-xl flex items-center justify-between gap-2 mb-1.5 text-xs';
            inputContainer.parentElement.insertBefore(replyBar, inputContainer);
        }
    }

    if (replyBar) {
        replyBar.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <i class="fa-solid fa-reply text-blue-500 text-xs shrink-0"></i>
                <div class="min-w-0 flex-1 text-[11px] leading-tight">
                    <div class="font-bold text-blue-600 dark:text-blue-300 truncate">Replying to ${escapeHtml(senderName || 'User')}</div>
                    <div class="text-gray-600 dark:text-gray-300 truncate text-[10px]">${escapeHtml(text || '📷 Attachment / Location')}</div>
                </div>
            </div>
            <button type="button" onclick="window.cancelRiderReply()" class="text-gray-400 hover:text-red-500 p-1 text-xs transition active:scale-90" title="Cancel Reply">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;
        replyBar.classList.remove('hidden');
    }

    const input = document.getElementById('rider-cust-chat-input') || document.getElementById('rider-chat-input');
    if (input) input.focus();
}

export function cancelRiderReply() {
    activeRiderReplyTarget = null;
    const replyBar = document.getElementById('rider-chat-reply-bar');
    if (replyBar) replyBar.classList.add('hidden');
}

export async function toggleRiderMessageReaction(msgId, emoji) {
    if (!db || !activeRiderChatCustId || !msgId || !emoji) return;
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || 'rider').toString();

    try {
        const ref = db.ref(`customerChats/${activeRiderChatCustId}/messages/${msgId}/reactions/${emoji}/${myId}`);
        const snap = await ref.once('value');
        if (snap.exists()) {
            await ref.remove();
        } else {
            await ref.set(true);
        }
    } catch(e) {
        console.error("Error toggling rider reaction:", e);
    }
}

function evaluateRiderChatLockPermissions() {
    const lockBanner = document.getElementById('rider-chat-lock-banner');
    const inputEl = document.getElementById('rider-cust-chat-input') || document.getElementById('rider-chat-input');
    const sendBtn = document.getElementById('rider-cust-send-btn');
    const actionToolbar = document.getElementById('rider-chat-action-toolbar');

    if (!currentRiderChatMeta) return;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    const cateredRiderId = (currentRiderChatMeta.cateredByRiderId || "").toString().trim();
    const cateredRiderName = (currentRiderChatMeta.cateredByRiderName || currentRiderChatMeta.cateredBy || "").toString().trim().toLowerCase();

    const isCateringRider = (cateredRiderId && cateredRiderId === myId) || (cateredRiderName && cateredRiderName === myName);
    
    const isAdmin = typeof window.isAdmin === 'function' ? window.isAdmin() : false;
    const canManage = typeof window.canManageRoster === 'function' ? window.canManageRoster() : false;
    const adminControlsActive = globalState.adminControlsEnabled && (isAdmin || canManage);

    const isLocked = (cateredRiderId || cateredRiderName) && !isCateringRider && !adminControlsActive;

    if (isLocked) {
        if (lockBanner) {
            lockBanner.classList.remove('hidden');
            lockBanner.innerHTML = `🔒 Being catered by <strong>${escapeHtml(currentRiderChatMeta.cateredByRiderName || currentRiderChatMeta.cateredBy)}</strong>. View only mode.`;
        }
        if (inputEl) inputEl.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        if (actionToolbar) actionToolbar.classList.add('opacity-50', 'pointer-events-none');
    } else {
        if (lockBanner) {
            if (isCateringRider) {
                lockBanner.classList.remove('hidden');
                lockBanner.innerHTML = `🛵 You are currently catering this customer.`;
            } else if (adminControlsActive && (cateredRiderId || cateredRiderName)) {
                lockBanner.classList.remove('hidden');
                lockBanner.innerHTML = `⚡ Admin Controls Enabled — Replying as Admin (Catered by ${escapeHtml(currentRiderChatMeta.cateredByRiderName || currentRiderChatMeta.cateredBy)}).`;
            } else {
                lockBanner.classList.add('hidden');
            }
        }
        if (inputEl) inputEl.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        if (actionToolbar) actionToolbar.classList.remove('opacity-50', 'pointer-events-none');
    }
}

export function closeRiderChatModal() {
    closeRiderCustomerChatModal();
}

export function closeRiderCustomerChatModal() {
    const modal = document.getElementById('rider-customer-chat-modal') || document.getElementById('rider-chat-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }

    if (activeRiderChatListener) {
        activeRiderChatListener.off();
        activeRiderChatListener = null;
    }
    if (activeRiderChatMetaListener) {
        activeRiderChatMetaListener.off();
        activeRiderChatMetaListener = null;
    }
    activeRiderChatCustId = null;
    currentRiderChatMeta = null;

    oldestRiderMsgTimestamp = null;
    hasMoreRiderMsgs = true;
    isLoadingRiderHistory = false;
    loadedRiderMsgsMap.clear();
    cancelRiderReply();
}

export function sendRiderChatMessage(content = null, type = 'text') {
    sendRiderToCustomerChat(content, type === 'image' ? content : null);
}

export function sendRiderToCustomerChat(customText = "", customImageUrl = null, customLocationCoords = null) {
    const input = document.getElementById('rider-cust-chat-input') || document.getElementById('rider-chat-input');
    const text = customText || (input ? input.value.trim() : "");

    if ((!text && !customImageUrl && !customLocationCoords) || !activeRiderChatCustId) return;

    const riderName = appState.riderName || "Lokalex Rider";
    const now = Date.now();

    const newMsg = {
        sender: riderName,
        senderType: 'rider',
        text: text,
        timestamp: now,
        isRider: true,
        status: 'sent',
        deliveredAt: null,
        seenAt: null
    };

    if (activeRiderReplyTarget) {
        newMsg.replyTo = {
            id: activeRiderReplyTarget.id,
            sender: activeRiderReplyTarget.sender,
            text: activeRiderReplyTarget.text.substring(0, 120)
        };
    }

    if (customImageUrl) {
        newMsg.imageUrl = customImageUrl;
        newMsg.type = 'image';
    }
    if (customLocationCoords) {
        newMsg.locationCoords = customLocationCoords;
        newMsg.type = 'location';
    }

    if (db) {
        db.ref(`customerChats/${activeRiderChatCustId}/messages`).push(sanitizeForFirebase(newMsg));
        db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update(sanitizeForFirebase({
            lastMessage: `You: ${text || (customImageUrl ? "📷 Photo" : "📍 Location")}`,
            lastUpdated: now,
            unreadForRider: false
        }));
    }

    if (input && !customText) input.value = "";
    cancelRiderReply();

    hideRiderInChatToast();

    const container = document.getElementById('rider-cust-chat-messages') || document.getElementById('rider-chat-messages-container');
    if (container) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
        });
    }
}

export function sendChatLocationPin() {
    sendRiderLocation();
}

export function sendRiderLocation() {
    openMapPicker('rider-chat');
}

if (typeof window !== 'undefined') {
    window.getActiveRiderChatCustId = getActiveRiderChatCustId;
    window.getCurrentRiderChatMeta = getCurrentRiderChatMeta;
    window.getActiveRiderChatFilter = getActiveRiderChatFilter;
    window.getActiveCustData = getActiveCustData;
    window.setActiveCustData = setActiveCustData;

    window.setRiderChatFilter = setRiderChatFilter;
    window.listenToAllCustomerChatsForRider = listenToAllCustomerChatsForRider;
    window.openRiderChatModal = openRiderChatModal;
    window.openRiderCustomerChatModal = openRiderCustomerChatModal;
    window.closeRiderChatModal = closeRiderChatModal;
    window.closeRiderCustomerChatModal = closeRiderCustomerChatModal;
    window.sendRiderChatMessage = sendRiderChatMessage;
    window.sendRiderToCustomerChat = sendRiderToCustomerChat;
    window.sendChatLocationPin = sendChatLocationPin;
    window.sendRiderLocation = sendRiderLocation;
    window.setRiderReply = setRiderReply;
    window.cancelRiderReply = cancelRiderReply;
    window.toggleRiderMessageReaction = toggleRiderMessageReaction;

    listenToGlobalStoreChats();
}