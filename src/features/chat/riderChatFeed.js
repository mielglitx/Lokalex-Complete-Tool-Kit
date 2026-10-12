// src/features/chat/riderChatFeed.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { escapeHtml } from '../../utils/helpers.js';
import { showToast } from '../../ui/notifications.js';
import { populateCateringCustomerDropdown } from './chatUtils.js';
import { listenToGlobalStoreChats, renderStoreChatsInDashboard } from './riderStoreChat.js';
import { openRiderCustomerChatModal, closeRiderCustomerChatModal } from './riderChat.js';
import { isCustomerMatch, isRiderMatch } from '../roster/rosterUtils.js';
import { 
    getActiveRiderFbChannel, 
    getPublicFbChannelName, 
    isSourceSelected, 
    isAllSourcesSelected, 
    getActiveRiderSources, 
    hasAnyFbSourceSelected,
    autoResolvePendingFacebookThreads,
    getResolvedFbName
} from './facebookApiAdmin.js';
import { 
    initFullBookingListener, 
    sendFullBookingAutoReply, 
    fullBookingState,
    updateFullBookingUI
} from './fullBookingMode.js';
import { playChatChime } from './chatSoundManager.js';

let activeRiderChatFilter = 'inbox';
let cachedCustomerThreadsMap = new Map();
let isCustomerChatMetaListening = false;
let rawCustomerChatMetaData = null;
let isInitialCustomerChatMetaLoad = true;
const lastKnownMessageStateMap = new Map();

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

export function getLoggedInRiderInfo() {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();
    return { myId, myName };
}

export function isMyCustomerThread(t) {
    if (!t) return false;
    const { myId, myName } = getLoggedInRiderInfo();
    if (!myId && !myName) return false;

    const rId = (t.cateredByRiderId || "").toString().trim();
    const rName = (t.cateredByRiderName || "").toString().trim().toLowerCase();

    if (myId && rId && myId === rId) return true;
    if (myName && rName && (myName === rName || isRiderMatch(myName, rName, myId, rId))) return true;

    // Check if the current logged-in rider's active record in the roster has this customer
    const myRecord = (globalState.rosterMembers || []).find(m => 
        (myId && (m.telegramId || m.id || "").toString() === myId) ||
        (myName && (m.riderName || m.name || "").trim().toLowerCase() === myName)
    );
    if (myRecord && myRecord.status === 'Catering') {
        const custName = (t.customerName || '').toLowerCase().trim();
        if (!custName || custName === 'customer' || custName === 'customer name') return false;

        if (myRecord.customerName && custName) {
            const custs = myRecord.customerName.split(/\s*,\s*/).map(c => c.trim().toLowerCase()).filter(c => c !== 'customer' && c !== 'customer name');
            if (custs.some(c => c === custName || isCustomerMatch(c, custName))) {
                return true;
            }
        }
        if (myRecord.forcedCaters && typeof myRecord.forcedCaters === 'object') {
            for (const [fKey, fVal] of Object.entries(myRecord.forcedCaters)) {
                if (fKey === t.custId && fKey !== 'customer') return true;
                const fName = (fVal && typeof fVal === 'object' && fVal.customerName) ? fVal.customerName : fKey;
                const cleanFName = (fName || '').toLowerCase().trim();
                if (cleanFName !== 'customer' && cleanFName !== 'customer name' && custName && isCustomerMatch(fName, custName)) return true;
            }
        }
    }

    return false;
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

    // Dynamic Live Roster Catering Sync:
    // If ANY rider in the live roster is currently Catering this customer,
    // guarantee that the thread's folder is updated to 'catering' and attached to that rider!
    // Auto-clean any ghost "Customer" entries from roster members' active customer list
    (globalState.rosterMembers || []).forEach(m => {
        if (m.customerName && typeof m.customerName === 'string') {
            const rawCusts = m.customerName.split(/\s*,\s*/);
            const filteredCusts = rawCusts.filter(c => {
                const lc = c.trim().toLowerCase();
                return lc && lc !== 'customer' && lc !== 'customer name' && lc !== 'undefined' && lc !== 'null';
            });
            if (filteredCusts.length !== rawCusts.length) {
                const newCustName = filteredCusts.join(', ');
                m.customerName = newCustName;
                if (m.forcedCaters && typeof m.forcedCaters === 'object') {
                    delete m.forcedCaters['customer'];
                    delete m.forcedCaters['customer name'];
                }
                const mId = (m.telegramId || m.id || "").toString().trim();
                if (db && mId) {
                    db.ref(`roster/${mId}/customerName`).set(newCustName).catch(() => {});
                    db.ref(`roster/${mId}/forcedCaters/customer`).remove().catch(() => {});
                }
                if (typeof window.saveRosterCache === 'function') window.saveRosterCache();
            }
        }
    });

    const liveRoster = globalState.rosterMembers || [];
    allThreads.forEach(t => {
        // 1. If thread metadata already has an active catering rider, enforce folder = 'catering'
        const hasExistingCaterer = !!(t.cateredByRiderName || t.cateredByRiderId) && t.status !== 'completed' && t.status !== 'done' && t.status !== 'cancelled';
        if (hasExistingCaterer) {
            t.folder = 'catering';
        }

        // 2. Cross-reference with live roster
        const activeCateringRider = liveRoster.find(m => {
            if (m.status !== 'Catering') return false;
            const tCustName = (t.customerName || '').toLowerCase().trim();
            if (!tCustName || tCustName === 'customer' || tCustName === 'customer name') return false;
            if (m.customerName && tCustName) {
                const custs = m.customerName.split(/\s*,\s*/).map(c => c.trim().toLowerCase()).filter(c => c !== 'customer' && c !== 'customer name');
                if (custs.some(c => c === tCustName || isCustomerMatch(c, t.customerName))) return true;
            }
            if (m.forcedCaters && typeof m.forcedCaters === 'object') {
                for (const [fKey, fVal] of Object.entries(m.forcedCaters)) {
                    if (fKey === t.custId && fKey !== 'customer') return true;
                    const fName = (fVal && typeof fVal === 'object' && fVal.customerName) ? fVal.customerName : fKey;
                    const cleanFName = (fName || '').toLowerCase().trim();
                    if (cleanFName !== 'customer' && cleanFName !== 'customer name' && tCustName && isCustomerMatch(fName, tCustName)) return true;
                }
            }
            return false;
        });
        if (activeCateringRider) {
            t.folder = 'catering';
            t.cateredByRiderId = (activeCateringRider.telegramId || activeCateringRider.id || "").toString().trim();
            t.cateredByRiderName = (activeCateringRider.riderName || activeCateringRider.name || "Rider").toString().trim();
        }
    });

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
        const isCurrentlyCatered = !!(t.cateredByRiderName || t.cateredByRiderId) && t.status !== 'completed' && t.status !== 'done' && t.status !== 'cancelled';
        if (isCurrentlyCatered) {
            t.folder = 'catering';
        }
        const folder = (t.folder || 'inbox').toLowerCase();

        if (activeRiderChatFilter === 'inbox') {
            // Catered customer threads MUST NEVER appear in Inbox!
            if (isCurrentlyCatered || folder === 'catering') return false;
            return folder === 'inbox' && t.status !== 'completed' && t.status !== 'done' && t.status !== 'cancelled';
        }
        if (activeRiderChatFilter === 'catering') {
            if (isCurrentlyCatered) return true;
            return folder === 'catering' && t.status !== 'completed' && t.status !== 'done' && t.status !== 'cancelled';
        }
        if (activeRiderChatFilter === 'followup') {
            if (isCurrentlyCatered) return false;
            return folder === 'followup';
        }
        if (activeRiderChatFilter === 'done') {
            return folder === 'done' || t.status === 'completed' || t.status === 'done';
        }
        return true;
    });

    // In the Catering tab, pin the rider's own customers to the very top!
    filteredThreads.sort((a, b) => {
        if (activeRiderChatFilter === 'catering') {
            const aMine = isMyCustomerThread(a);
            const bMine = isMyCustomerThread(b);
            if (aMine && !bMine) return -1;
            if (!aMine && bMine) return 1;
        }
        return (b.lastUpdated || 0) - (a.lastUpdated || 0);
    });

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

    let cateringBannerHtml = "";
    if (activeRiderChatFilter === 'catering') {
        const myCount = filteredThreads.filter(t => isMyCustomerThread(t)).length;
        const otherCount = filteredThreads.length - myCount;
        cateringBannerHtml = `
        <div class="flex items-center justify-between px-3 py-2 mb-2 bg-gradient-to-r from-amber-50 to-emerald-50 dark:from-amber-950/20 dark:to-emerald-950/30 border border-amber-200 dark:border-emerald-900/40 rounded-2xl text-[11px] shadow-xs">
            <div class="flex items-center gap-1.5 font-bold text-gray-800 dark:text-gray-200">
                <i class="fa-solid fa-motorcycle text-amber-500"></i> Active Deliveries (${filteredThreads.length})
            </div>
            <div class="flex items-center gap-1.5">
                ${myCount > 0 ? `
                    <span class="bg-emerald-600 text-white font-black text-[10px] px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-xs animate-pulse">
                        <i class="fa-solid fa-circle-check text-[9px]"></i> Your Customers: ${myCount}
                    </span>
                ` : `
                    <span class="text-gray-500 dark:text-gray-400 text-[10px] font-medium italic">Your Customers: 0</span>
                `}
                ${otherCount > 0 ? `
                    <span class="bg-amber-600 text-white font-black text-[10px] px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-xs">
                        <i class="fa-solid fa-motorcycle text-[9px]"></i> Other Riders: ${otherCount}
                    </span>
                ` : ''}
            </div>
        </div>`;
    }

    const cardsHtml = filteredThreads.map(t => {
        const timeStr = t.lastUpdated ? new Date(t.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
        const isMine = isMyCustomerThread(t);
        const isCateringTab = activeRiderChatFilter === 'catering';
        const isCurrentlyCatering = isMine && (isCateringTab || t.folder === 'catering' || (t.cateredByRiderName && t.status !== 'completed' && t.status !== 'done'));
        const isOtherRiderCatering = !isMine && (isCateringTab || t.folder === 'catering' || (t.cateredByRiderName && t.status !== 'completed' && t.status !== 'done'));

        let statusBadge = "";
        if (isCurrentlyCatering) {
            statusBadge = `<span class="bg-emerald-600 text-white font-black text-[9px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-xs tracking-wider animate-pulse shrink-0"><i class="fa-solid fa-user-check text-[8px]"></i> MY CUSTOMER</span>`;
        } else if (isOtherRiderCatering) {
            const rName = t.cateredByRiderName || 'Other Rider';
            statusBadge = `<span class="bg-amber-600/90 text-white font-bold text-[9px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-xs tracking-wide shrink-0"><i class="fa-solid fa-motorcycle text-[8px]"></i> ${escapeHtml(rName)}</span>`;
        }

        let channelBadge = "";
        if (t.channel === 'messenger') {
            const channelName = t.apiName || (typeof getPublicFbChannelName === 'function' ? getPublicFbChannelName(t.apiId) : '') || 'FB';
            channelBadge = `<span class="bg-blue-100 text-blue-800 border border-blue-300 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0" title="Source: ${escapeHtml(channelName)}"><i class="fa-brands fa-facebook-messenger text-blue-500"></i> ${escapeHtml(channelName)}</span>`;
        } else {
            channelBadge = `<span class="bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0" title="Source: Lokalex Web App"><i class="fa-solid fa-globe text-emerald-500"></i> Web</span>`;
        }

        const unreadDot = t.isUnread ? `<span class="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shrink-0"></span>` : "";
        
        let cardBorderClass = "border border-gray-200 dark:border-gray-800 bg-white dark:bg-cardBg";
        let avatarBorderClass = "border-blue-500";
        let nameClass = "font-black text-gray-900 dark:text-white text-xs";

        if (isCurrentlyCatering) {
            // Radiant, unmistakable GOLD glowing border ONLY for MY CUSTOMER!
            cardBorderClass = "catering-glow-gold bg-amber-50/80 dark:bg-amber-950/40";
            avatarBorderClass = "border-amber-400";
            nameClass = "font-black text-gray-900 dark:text-white text-xs";
        } else if (isOtherRiderCatering) {
            // Other riders' customers do NOT glow on my side to make a clear distinction
            cardBorderClass = "border border-gray-200 dark:border-gray-800 bg-white dark:bg-cardBg";
            avatarBorderClass = "border-gray-300 dark:border-gray-700";
            nameClass = "font-bold text-gray-800 dark:text-gray-200 text-xs";
        } else if (t.isUnread) {
            cardBorderClass = "border-2 border-blue-500 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-950/30 shadow-md ring-1 ring-blue-400/40";
            avatarBorderClass = "border-blue-500 ring-2 ring-blue-400/50";
            nameClass = "font-black text-blue-600 dark:text-blue-400 text-sm";
        }

        const lastMsgClass = t.isUnread 
            ? "text-xs text-gray-900 dark:text-white font-black" 
            : "text-[11px] text-gray-700 dark:text-gray-300 font-medium";

        const timeClass = isCurrentlyCatering
            ? 'text-amber-700 dark:text-amber-300 font-black'
            : (t.isUnread ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-500 dark:text-gray-400 font-medium');

        return `
        <div onclick="window.openRiderCustomerChatModal('${t.custId}', '${escapeHtml(t.customerName)}', '${escapeHtml(t.avatarUrl)}')" class="${cardBorderClass} hover:bg-gray-50 dark:hover:bg-black/50 p-3 rounded-2xl flex items-center justify-between cursor-pointer transition active:scale-[0.99] shadow-xs">
            <div class="flex items-center gap-3 min-w-0 flex-1">
                <div class="relative shrink-0">
                    <img src="${t.avatarUrl}" class="w-10 h-10 rounded-full object-cover border-2 ${avatarBorderClass}">
                    ${t.isUnread ? '<div class="absolute -top-0.5 -right-0.5 w-3 h-3 bg-blue-500 rounded-full border-2 border-white dark:border-darkBg animate-ping"></div>' : ''}
                </div>
                <div class="min-w-0 flex-1">
                    <!-- Row 1: Prominent Customer Name + Status Badge -->
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="truncate ${nameClass} max-w-[130px] sm:max-w-[220px] font-black">${escapeHtml(t.customerName)}</span>
                        ${statusBadge}
                        ${unreadDot}
                    </div>
                    <!-- Row 2: Channel Badge + Last Message -->
                    <div class="flex items-center gap-1.5 mt-1 min-w-0">
                        ${channelBadge}
                        <span class="${lastMsgClass} truncate flex-1 min-w-0">${escapeHtml(t.lastMessage)}</span>
                    </div>
                </div>
            </div>
            <div class="flex flex-col items-end gap-1 shrink-0 ml-2 self-start mt-0.5">
                <div class="text-[10px] ${timeClass} font-mono">${timeStr}</div>
                <button type="button" 
                    onclick="event.stopPropagation(); window.toggleCustomerChatUnread && window.toggleCustomerChatUnread('${t.custId}')" 
                    class="p-1 rounded-lg text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition active:scale-90 cursor-pointer flex items-center justify-center" 
                    title="${t.isUnread ? 'Mark as read' : 'Mark as unread'}">
                    <i class="fa-${t.isUnread ? 'solid text-blue-500' : 'regular text-gray-400 dark:text-gray-500'} fa-envelope text-[11px]"></i>
                </button>
            </div>
        </div>`;
    }).join('');

    feed.innerHTML = cateringBannerHtml + cardsHtml;

    if (typeof populateCateringCustomerDropdown === 'function') {
        populateCateringCustomerDropdown(rawCustomerChatMetaData);
    }
}

export function listenToAllCustomerChatsForRider() {
    listenToGlobalStoreChats();
    initFullBookingListener();
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

        // Acoustic notification chimes for incoming Inbox & Catering messages
        if (!isInitialCustomerChatMetaLoad && data) {
            let shouldPlayInboxChime = false;
            let shouldPlayCateringChime = false;

            Object.keys(data).forEach(key => {
                const item = data[key] || {};
                const meta = item.metadata || item;
                const curLastMsg = (meta.lastMessage || '').trim();
                const curLastUpdated = meta.lastUpdated || 0;
                const prev = lastKnownMessageStateMap.get(key);

                let isIncomingNew = false;
                if (prev) {
                    const isNewer = curLastUpdated > prev.lastUpdated;
                    const isDifferent = curLastMsg !== prev.lastMessage;
                    if (isNewer && isDifferent) {
                        isIncomingNew = true;
                    }
                } else {
                    // Newly initiated customer thread arriving after initial app load
                    isIncomingNew = true;
                }

                if (isIncomingNew && curLastMsg && curLastMsg.toLowerCase() !== 'no messages yet') {
                    // Check if from customer (not outgoing rider message)
                    const isFromCustomer = !curLastMsg.startsWith('You:') && meta.unreadForRider !== false;
                    if (isFromCustomer) {
                        const isCatered = !!(meta.cateredByRiderName || meta.cateredByRiderId || meta.cateredBy || (meta.folder || '').toLowerCase() === 'catering');
                        if (isCatered) {
                            const isAdmin = (appState.userType || localStorage.getItem('userType') || '').toLowerCase() === 'admin';
                            const isMine = isMyCustomerThread({ custId: key, ...meta });
                            const isUnassigned = !meta.cateredByRiderName && !meta.cateredByRiderId;
                            if (isAdmin || isMine || isUnassigned) {
                                shouldPlayCateringChime = true;
                            }
                        } else if ((meta.folder || 'inbox').toLowerCase() === 'inbox') {
                            shouldPlayInboxChime = true;
                        }
                    }
                }
            });

            if (shouldPlayCateringChime) {
                playChatChime('catering');
            } else if (shouldPlayInboxChime) {
                playChatChime('inbox');
            }
        }

        // Cache last seen timestamps & message contents
        if (data) {
            Object.keys(data).forEach(key => {
                const item = data[key] || {};
                const meta = item.metadata || item;
                lastKnownMessageStateMap.set(key, {
                    lastUpdated: meta.lastUpdated || 0,
                    lastMessage: (meta.lastMessage || '').trim()
                });
            });
        }
        isInitialCustomerChatMetaLoad = false;

        const threadsMap = new Map();

        Object.keys(data).forEach(key => {
            const cleanKey = (key || '').trim().toLowerCase();
            // Automatically purge invalid/ghost customer IDs
            if (!cleanKey || cleanKey === 'customer' || cleanKey === 'customer name' || cleanKey === 'undefined' || cleanKey === 'null') {
                if (db && key) {
                    db.ref(`customerChats/${key}`).remove().catch(() => {});
                    db.ref(`customerChatMeta/${key}`).remove().catch(() => {});
                }
                return;
            }

            const item = data[key] || {};
            const meta = item.metadata || item;
            const rawLastMsg = (meta.lastMessage || '').trim();
            const hasValidLastMsg = rawLastMsg !== '' && rawLastMsg.toLowerCase() !== 'no messages yet';

            // FULL BOOKING MODE AUTO-REPLY HOOK:
            // Immediately dispatches automated full booking reply to incoming messages in Inbox (excludes catering & followup)
            if (fullBookingState && fullBookingState.enabled && hasValidLastMsg) {
                const threadFolder = (meta.folder || 'inbox').toLowerCase();
                if (threadFolder === 'inbox' && !meta.cateredByRiderId && !meta.cateredByRiderName) {
                    if (!rawLastMsg.startsWith('You:')) {
                        sendFullBookingAutoReply(key, meta);
                    }
                }
            }

            let displayName = (meta.customerName || meta.name || "").trim();
            if (key.startsWith('fb_')) {
                const cached = (typeof getResolvedFbName === 'function') ? getResolvedFbName(key) : null;
                if (cached && cached.name && (!displayName || displayName.startsWith('FB Customer ('))) {
                    displayName = cached.name;
                }
            }

            const cleanDisplayName = displayName.toLowerCase();
            const isPlaceholderName = !cleanDisplayName || cleanDisplayName === 'customer' || cleanDisplayName === 'customer name' || cleanDisplayName === 'unknown';

            // 1. Exclude non-existing ghost threads:
            // Must have actual message history, and placeholder "Customer" threads with zero messages are discarded!
            if (!hasValidLastMsg) {
                return;
            }
            if (isPlaceholderName && !hasValidLastMsg) {
                return;
            }

            if (!displayName) displayName = "Customer";
            let displayAvatar = meta.avatarUrl;
            if (key.startsWith('fb_')) {
                const cached = (typeof getResolvedFbName === 'function') ? getResolvedFbName(key) : null;
                if (cached && cached.avatarUrl) displayAvatar = cached.avatarUrl;
            }

            let isUnread = false;
            if (meta.unreadForRider === true) {
                isUnread = true;
            } else if (meta.unreadForRider === false) {
                isUnread = false;
            } else if (rawLastMsg && !rawLastMsg.startsWith('You:')) {
                isUnread = true;
            }

            const hasCateringRider = !!(meta.cateredByRiderName || meta.cateredByRiderId || meta.cateredBy);
            const isCompletedStatus = meta.status === 'completed' || meta.status === 'done' || meta.status === 'cancelled';
            let threadFolder = (meta.folder || 'inbox').toLowerCase();
            if (hasCateringRider && !isCompletedStatus) {
                threadFolder = 'catering';
                // If Firebase has this thread wrongly marked as 'inbox' (e.g. from an incoming webhook patch), auto-heal Firebase!
                if (meta.folder !== 'catering' && db && key) {
                    const healPayload = { folder: 'catering', lastUpdated: meta.lastUpdated || Date.now() };
                    db.ref(`customerChats/${key}/metadata`).update(healPayload).catch(() => {});
                    db.ref(`customerChatMeta/${key}`).update(healPayload).catch(() => {});
                }
            }

            const threadObj = {
                custId: key,
                customerName: displayName,
                avatarUrl: displayAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0084FF&color=fff`,
                lastMessage: rawLastMsg || "No messages yet",
                lastUpdated: meta.lastUpdated || 0,
                folder: threadFolder,
                channel: meta.channel || (key.startsWith('fb_') || key.startsWith('messenger_') ? 'messenger' : 'web'),
                apiId: meta.apiId || meta.channelId || meta.fbApiId || null,
                apiName: meta.apiName || meta.channelName || null,
                cateredByRiderId: meta.cateredByRiderId || null,
                cateredByRiderName: meta.cateredByRiderName || meta.cateredBy || null,
                status: meta.status || 'active',
                isUnread: isUnread,
                hasRealMessages: hasValidLastMsg
            };

            // Cross-reference with live roster so newly incoming threads immediately transition to catering
            const liveRoster = globalState.rosterMembers || [];
            const activeCateringRider = liveRoster.find(m => {
                if (m.status !== 'Catering') return false;
                const tCustName = displayName.toLowerCase().trim();
                if (!tCustName || tCustName === 'customer' || tCustName === 'customer name') return false;
                if (m.customerName && tCustName) {
                    const custs = m.customerName.split(/\s*,\s*/).map(c => c.trim().toLowerCase()).filter(c => c !== 'customer' && c !== 'customer name');
                    if (custs.some(c => c === tCustName || isCustomerMatch(c, displayName))) return true;
                }
                if (m.forcedCaters && typeof m.forcedCaters === 'object') {
                    for (const [fKey, fVal] of Object.entries(m.forcedCaters)) {
                        if (fKey === key && fKey !== 'customer') return true;
                        const fName = (fVal && typeof fVal === 'object' && fVal.customerName) ? fVal.customerName : fKey;
                        const cleanFName = (fName || '').toLowerCase().trim();
                        if (cleanFName !== 'customer' && cleanFName !== 'customer name' && tCustName && isCustomerMatch(fName, tCustName)) return true;
                    }
                }
                return false;
            });
            if (activeCateringRider) {
                threadObj.folder = 'catering';
                threadObj.status = 'active';
                threadObj.cateredByRiderId = (activeCateringRider.telegramId || activeCateringRider.id || "").toString().trim();
                threadObj.cateredByRiderName = (activeCateringRider.riderName || activeCateringRider.name || "Rider").toString().trim();
                if (meta.folder === 'done' && db && key) {
                    const restorePayload = {
                        folder: 'catering',
                        status: 'active',
                        cateredByRiderId: threadObj.cateredByRiderId,
                        cateredByRiderName: threadObj.cateredByRiderName,
                        cateredBy: threadObj.cateredByRiderName,
                        lastUpdated: Date.now()
                    };
                    db.ref(`customerChats/${key}/metadata`).update(restorePayload).catch(() => {});
                    db.ref(`customerChatMeta/${key}`).update(restorePayload).catch(() => {});
                }
            }

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
                        if (existing.folder === 'catering') threadObj.folder = 'catering';
                    }
                    threadsMap.set(dedupKey, threadObj);
                } else {
                    existing.isUnread = existing.isUnread || threadObj.isUnread;
                    if (!existing.cateredByRiderName && threadObj.cateredByRiderName) {
                        existing.cateredByRiderName = threadObj.cateredByRiderName;
                        existing.cateredByRiderId = threadObj.cateredByRiderId;
                        if (threadObj.folder === 'catering') existing.folder = 'catering';
                    }
                }
            } else {
                threadsMap.set(dedupKey, threadObj);
            }
        });

        cachedCustomerThreadsMap = threadsMap;

        const allThreads = Array.from(threadsMap.values());
        
        // Auto-resolve Facebook customer names in the background
        if (typeof autoResolvePendingFacebookThreads === 'function') {
            autoResolvePendingFacebookThreads(allThreads);
        }

        updateInboxUnreadBadge();

        if (activeRiderChatFilter !== 'stores') {
            renderRiderCustomerChatFeed();
        }
    });
}

export function updateInboxUnreadBadge() {
    const inboxBadge = document.getElementById('rider-inbox-unread-badge');
    if (!inboxBadge) return;
    const allThreads = Array.from(cachedCustomerThreadsMap.values());
    const unreadInboxCount = allThreads.filter(t => {
        const folder = (t.folder || 'inbox').toLowerCase();
        const isCatered = !!(t.cateredByRiderName || t.cateredByRiderId);
        return folder === 'inbox' && !isCatered && t.isUnread;
    }).length;
    if (unreadInboxCount > 0) {
        inboxBadge.innerText = unreadInboxCount.toString();
        inboxBadge.classList.remove('hidden');
    } else {
        inboxBadge.classList.add('hidden');
    }
}

export function markCustomerChatAsUnread(targetCustId = null) {
    const custId = targetCustId || (window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null);
    if (!custId) return;

    if (db) {
        const payload = { unreadForRider: true };
        db.ref(`customerChats/${custId}/metadata`).update(payload).catch(() => {});
        db.ref(`customerChatMeta/${custId}`).update(payload).catch(() => {});
    }

    // Optimistically update cached thread
    for (const thread of cachedCustomerThreadsMap.values()) {
        if (thread.custId === custId) {
            thread.isUnread = true;
            break;
        }
    }

    updateInboxUnreadBadge();
    if (activeRiderChatFilter !== 'stores') {
        renderRiderCustomerChatFeed();
    }

    const activeId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (!targetCustId || (activeId && targetCustId === activeId)) {
        if (typeof closeRiderCustomerChatModal === 'function') {
            closeRiderCustomerChatModal();
        } else if (window.closeRiderCustomerChatModal) {
            window.closeRiderCustomerChatModal();
        }
    }

    showToast("✉️ Chat marked as unread");
}

export function markCustomerChatAsRead(targetCustId = null) {
    const custId = targetCustId || (window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null);
    if (!custId) return;

    if (db) {
        const payload = { unreadForRider: false };
        db.ref(`customerChats/${custId}/metadata`).update(payload).catch(() => {});
        db.ref(`customerChatMeta/${custId}`).update(payload).catch(() => {});
    }

    // Optimistically update cached thread
    for (const thread of cachedCustomerThreadsMap.values()) {
        if (thread.custId === custId) {
            thread.isUnread = false;
            break;
        }
    }

    updateInboxUnreadBadge();
    if (activeRiderChatFilter !== 'stores') {
        renderRiderCustomerChatFeed();
    }

    showToast("✓ Chat marked as read");
}

export function toggleCustomerChatUnread(targetCustId) {
    if (!targetCustId) return;
    let isCurrentlyUnread = false;
    for (const thread of cachedCustomerThreadsMap.values()) {
        if (thread.custId === targetCustId) {
            isCurrentlyUnread = !!thread.isUnread;
            break;
        }
    }

    if (isCurrentlyUnread) {
        markCustomerChatAsRead(targetCustId);
    } else {
        markCustomerChatAsUnread(targetCustId);
    }
}

if (typeof window !== 'undefined') {
    window.renderRiderCustomerChatFeed = renderRiderCustomerChatFeed;
    window.isMyCustomerThread = isMyCustomerThread;
    window.markCustomerChatAsUnread = markCustomerChatAsUnread;
    window.markCustomerChatAsRead = markCustomerChatAsRead;
    window.toggleCustomerChatUnread = toggleCustomerChatUnread;
    window.updateInboxUnreadBadge = updateInboxUnreadBadge;
    window.addEventListener('rosterUpdated', () => {
        if (activeRiderChatFilter !== 'stores') {
            renderRiderCustomerChatFeed();
        }
        if (typeof updateFullBookingUI === 'function') {
            updateFullBookingUI();
        }
    });
}