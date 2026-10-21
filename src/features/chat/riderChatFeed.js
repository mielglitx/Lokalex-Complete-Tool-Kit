// src/features/chat/riderChatFeed.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { escapeHtml } from '../../utils/helpers.js';
import { showToast, showNativeNotification, clearNativeNotification } from '../../ui/notifications.js';
import { populateCateringCustomerDropdown, formatChatDateParts } from './chatUtils.js';
import { listenToGlobalStoreChats, renderStoreChatsInDashboard } from './riderStoreChat.js';
import { openRiderCustomerChatModal, closeRiderCustomerChatModal, getActiveRiderChatCustId } from './riderChat.js';
import { isCustomerMatch, isRiderMatch, isAdmin, canManageRoster, hasTlPermission } from '../roster/rosterUtils.js';
import { 
    getActiveRiderFbChannel, 
    getPublicFbChannelName, 
    isSourceSelected, 
    isAllSourcesSelected, 
    getActiveRiderSources, 
    hasAnyFbSourceSelected,
    autoResolvePendingFacebookThreads,
    syncFacebookPageFolderStatus,
    getResolvedFbName
} from './facebookApiAdmin.js';
import { 
    initFullBookingListener, 
    sendFullBookingAutoReply, 
    fullBookingState,
    updateFullBookingUI,
    hasAvailableRiderOnRoster
} from './fullBookingMode.js';
import { playChatChime } from './chatSoundManager.js';

let activeRiderChatFilter = 'inbox';
let cachedCustomerThreadsMap = new Map();
let isCustomerChatMetaListening = false;
let rawCustomerChatMetaData = null;
let isInitialCustomerChatMetaLoad = true;
const lastKnownMessageStateMap = new Map();
let currentFeedLimit = 35;
let feedRenderRafId = null;
let lastAutoResolveFbTime = Date.now() + 180000;
let riderChatSearchQuery = '';

export function toggleRiderChatSearch() {
    const input = document.getElementById('rider-chat-search-input');
    if (input) {
        input.focus();
        input.select();
    }
}

export function handleRiderChatSearchInput(val) {
    riderChatSearchQuery = (val || '').trim();
    currentFeedLimit = 50;
    renderRiderCustomerChatFeed();
}

export function clearRiderChatSearch() {
    riderChatSearchQuery = '';
    const input = document.getElementById('rider-chat-search-input');
    if (input) input.value = '';
    renderRiderCustomerChatFeed();
}

export function expandRiderChatFeedLimit() {
    currentFeedLimit += 35;
    renderRiderCustomerChatFeed();
}
if (typeof window !== 'undefined') {
    window.expandRiderChatFeedLimit = expandRiderChatFeedLimit;
    window.toggleRiderChatSearch = toggleRiderChatSearch;
    window.handleRiderChatSearchInput = handleRiderChatSearchInput;
    window.clearRiderChatSearch = clearRiderChatSearch;
}

export function getCachedCustomerThreadsMap() {
    return cachedCustomerThreadsMap;
}

export function getActiveInboxCustomerThreads() {
    const list = [];
    if (cachedCustomerThreadsMap && cachedCustomerThreadsMap.size > 0) {
        for (const thread of cachedCustomerThreadsMap.values()) {
            const folder = (thread.folder || 'inbox').toLowerCase();
            const isCatered = !!(thread.cateredByRiderName || thread.cateredByRiderId || thread.cateredBy);
            const isDone = thread.status === 'completed' || thread.status === 'done' || thread.status === 'cancelled';
            const name = (thread.customerName || '').trim();
            const isPlaceholder = !name || name.toLowerCase() === 'customer' || name.toLowerCase() === 'customer name' || name.toLowerCase() === 'unknown';
            
            if (folder === 'inbox' && !isCatered && !isDone && !isPlaceholder) {
                list.push(thread);
            }
        }
    }
    return list;
}

export function getActiveRiderChatFilter() { 
    return activeRiderChatFilter; 
}

export function setRiderChatFilter(filterMode) {
    if (riderChatSearchQuery) {
        riderChatSearchQuery = '';
        const input = document.getElementById('rider-chat-search-input');
        if (input) input.value = '';
    }

    activeRiderChatFilter = filterMode;

    const tabs = [
        { id: 'inbox', minW: 'min-w-[55px]' },
        { id: 'catering', minW: 'min-w-[55px]' },
        { id: 'stores', minW: 'min-w-[65px]' },
        { id: 'applicant', minW: 'min-w-[65px]' },
        { id: 'followup', minW: 'min-w-[65px]' },
        { id: 'done', minW: 'min-w-[45px]' }
    ];

    tabs.forEach(t => {
        const btn = document.getElementById(`rider-chat-tab-${t.id}`) || (t.alias ? document.getElementById(`rider-chat-tab-${t.alias}`) : null);
        if (btn) {
            const isCurrent = (t.id === filterMode) || (t.alias && t.alias === filterMode);
            if (isCurrent) {
                btn.className = `flex-1 ${t.minW} py-1 rounded-lg bg-blue-600 text-white font-bold text-[10px] transition shadow-sm flex items-center justify-center gap-1 cursor-pointer`;
            } else {
                btn.className = `flex-1 ${t.minW} py-1 rounded-lg text-gray-600 dark:text-gray-400 font-bold text-[10px] hover:text-gray-900 dark:hover:text-white transition flex items-center justify-center gap-1 cursor-pointer`;
            }
        }
    });

    currentFeedLimit = 35;

    const feed = document.getElementById('rider-cust-chats-feed');
    if (feed) feed.scrollTop = 0;

    if (filterMode === 'stores') {
        renderStoreChatsInDashboard();
    } else {
        renderRiderCustomerChatFeed();
        listenToAllCustomerChatsForRider();
    }
}

function getThreadDedupKey(key, meta) {
    // 1. Facebook Messenger threads represent unique 1-on-1 conversations by Meta PSID.
    // They must NEVER be collapsed into each other!
    if (typeof key === 'string' && (key.startsWith('fb_') || key.startsWith('messenger_'))) {
        return key.startsWith('fb_') ? key : `fb_${key}`;
    }

    // 2. For non-FB web threads, dedup by verified phone number if available
    const rawPhone = meta.phoneNumber || meta.phone || 
                     (typeof key === 'string' && (key.startsWith('+63') || key.startsWith('09') || key.startsWith('63')) ? key : '');
    const cleanPhone = String(rawPhone).replace(/\D/g, '');
    if (cleanPhone.length >= 10) {
        return `phone_${cleanPhone.slice(-10)}`;
    }

    return `id_${key}`;
}

export function getLoggedInRiderInfo() {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();
    return { myId, myName };
}

export function isMyCustomerThread(t, cachedAuth = null) {
    if (!t) return false;
    const { myId, myName } = cachedAuth || getLoggedInRiderInfo();
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
        let custName = (t.customerName || '').toLowerCase().trim();
        if (!custName || custName === 'customer' || custName === 'customer name') {
            if (t.custId && t.custId.startsWith('cust_')) {
                custName = t.custId.replace(/^cust_/, '').replace(/_/g, ' ').trim().toLowerCase();
            }
        }
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

export function getActiveRosterCaterer(custName, custId, meta = {}) {
    if (meta?.status === 'cancelled' || meta?.status === 'completed' || meta?.folder === 'done') {
        return null;
    }

    const liveRoster = globalState.rosterMembers || [];
    if (!liveRoster || liveRoster.length === 0) return null;

    let tCustName = (custName || meta?.customerName || meta?.name || '').toLowerCase().trim();
    if (!tCustName || tCustName === 'customer' || tCustName === 'customer name') {
        if (custId && custId.startsWith('cust_')) {
            tCustName = custId.replace(/^cust_/, '').replace(/_/g, ' ').trim().toLowerCase();
        }
    }
    if (!tCustName || tCustName === 'customer' || tCustName === 'customer name') return null;

    return liveRoster.find(m => {
        if (m.status !== 'Catering') return false;

        // 1. Check comma-separated customerName field
        if (m.customerName) {
            const custs = m.customerName.split(/\s*,\s*/).map(c => c.trim().toLowerCase()).filter(c => c && c !== 'customer' && c !== 'customer name');
            if (custs.some(c => c === tCustName || isCustomerMatch(c, tCustName))) return true;
        }

        // 2. Check forcedCaters map
        if (m.forcedCaters && typeof m.forcedCaters === 'object') {
            for (const [fKey, fVal] of Object.entries(m.forcedCaters)) {
                if (custId && fKey === custId && fKey !== 'customer') return true;
                const fName = (fVal && typeof fVal === 'object' && fVal.customerName) ? fVal.customerName : fKey;
                const cleanFName = (fName || '').toLowerCase().trim();
                if (cleanFName && cleanFName !== 'customer' && cleanFName !== 'customer name' && (cleanFName === tCustName || isCustomerMatch(fName, tCustName))) {
                    return true;
                }
            }
        }

        return false;
    });
}

export function renderRiderCustomerChatFeed() {
    if (feedRenderRafId) cancelAnimationFrame(feedRenderRafId);
    feedRenderRafId = requestAnimationFrame(() => {
        feedRenderRafId = null;
        executeRenderRiderCustomerChatFeed();
    });
}

function executeRenderRiderCustomerChatFeed() {
    if (activeRiderChatFilter === 'stores') return;

    // Mobile Optimization: If rider is currently viewing/typing in a customer chat modal,
    // do not rebuild the underlying feed DOM (prevents keyboard lag & frame drops).
    const chatModal = document.getElementById('rider-chat-modal') || document.getElementById('rider-customer-chat-modal');
    if (chatModal && !chatModal.classList.contains('hidden')) {
        updateInboxUnreadBadge();
        updateDoneUnreadBadge();
        return;
    }

    const feed = document.getElementById('rider-cust-chats-feed');
    const badge = document.getElementById('rider-cust-chats-badge');
    if (!feed) return;

    const isUserAdmin = (typeof isAdmin === 'function' && isAdmin()) ||
                        (typeof canManageRoster === 'function' && canManageRoster()) ||
                        (typeof window.isAdmin === 'function' && window.isAdmin()) ||
                        Boolean(globalState.adminControlsEnabled);

    const canClear = isUserAdmin || (typeof hasTlPermission === 'function' && hasTlPermission('canClearInbox'));
    const canBroadcast = isUserAdmin || (typeof hasTlPermission === 'function' && hasTlPermission('canManageBroadcast'));

    const clearInboxBtn = document.getElementById('admin-clear-inbox-btn');
    if (clearInboxBtn) {
        if (canClear) clearInboxBtn.classList.remove('hidden');
        else clearInboxBtn.classList.add('hidden');
    }

    const sendManyBtn = document.getElementById('admin-send-many-btn');
    if (sendManyBtn) {
        if (canBroadcast) sendManyBtn.classList.remove('hidden');
        else sendManyBtn.classList.add('hidden');
    }

    window._currentlyOpenSwipeCard = null;

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

    const loggedInAuth = getLoggedInRiderInfo();
    const liveRoster = globalState.rosterMembers || [];
    const cateringRoster = liveRoster.filter(m => m.status === 'Catering');

    // High performance O(1) hash maps for instantaneous catering caterer lookups
    const catererByCustId = new Map();
    const catererByName = new Map();

    cateringRoster.forEach(m => {
        if (m.forcedCaters && typeof m.forcedCaters === 'object') {
            for (const [fKey, fVal] of Object.entries(m.forcedCaters)) {
                if (fKey && fKey !== 'customer') catererByCustId.set(fKey, m);
                const fName = (fVal && typeof fVal === 'object' && fVal.customerName) ? fVal.customerName : fKey;
                const clean = (fName || '').toLowerCase().trim();
                if (clean && clean !== 'customer' && clean !== 'customer name') {
                    catererByName.set(clean, m);
                }
            }
        }
        if (m.customerName && typeof m.customerName === 'string') {
            const custs = m.customerName.split(/\s*,\s*/).map(c => c.trim().toLowerCase()).filter(c => c && c !== 'customer' && c !== 'customer name');
            custs.forEach(c => catererByName.set(c, m));
        }
    });

    const getFastCaterer = (custName, custId) => {
        if (custId && catererByCustId.has(custId)) return catererByCustId.get(custId);
        const cleanName = (custName || '').toLowerCase().trim();
        if (cleanName && catererByName.has(cleanName)) return catererByName.get(cleanName);
        if (custId && custId.startsWith('cust_')) {
            const extracted = custId.replace(/^cust_/, '').replace(/_/g, ' ').trim().toLowerCase();
            if (extracted && catererByName.has(extracted)) return catererByName.get(extracted);
        }
        if (cleanName && cleanName !== 'customer' && cleanName !== 'customer name') {
            for (const [cName, m] of catererByName.entries()) {
                if (cName === cleanName || isCustomerMatch(cName, cleanName)) {
                    return m;
                }
            }
        }
        return null;
    };

    allThreads.forEach(t => {
        // High priority 1: If a rider is actively catering this customer on the live roster, prioritize catering!
        const liveActiveCaterer = getFastCaterer(t.customerName, t.custId);
        if (liveActiveCaterer) {
            t.folder = 'catering';
            t.status = 'active';
            t.cateredByRiderId = (liveActiveCaterer.telegramId || liveActiveCaterer.id || "").toString().trim();
            t.cateredByRiderName = (liveActiveCaterer.riderName || liveActiveCaterer.name || "Rider").toString().trim();
            t.cateredBy = t.cateredByRiderName;
            return;
        }

        // High priority 2: Applicant & Follow-up thread statuses take absolute precedence over done and inbox
        if (t.isApplicant === true || t.folder === 'applicant') {
            t.folder = 'applicant';
            t.isApplicant = true;
            t.status = 'active';
            t.cateredByRiderId = null;
            t.cateredByRiderName = null;
            t.cateredBy = null;
            return;
        }

        if (t.folder === 'followup') {
            t.folder = 'followup';
            t.isApplicant = false;
            t.status = 'active';
            t.cateredByRiderId = null;
            t.cateredByRiderName = null;
            t.cateredBy = null;
            return;
        }

        const isDone = (t.status === 'completed' || t.status === 'done' || t.status === 'cancelled' || t.folder === 'done');
        const completedAt = Number(t.completedAt) || 0;
        const lastMsgTime = Number(t.lastUpdated) || Number(t.timestamp) || 0;
        const isNewMessageAfterDone = isDone && completedAt > 0 && lastMsgTime > (completedAt + 3000) && t.unreadForRider === true && t.lastMessage && !t.lastMessage.startsWith('You:');

        if (isDone && !isNewMessageAfterDone) {
            t.folder = 'done';
            t.status = (t.status === 'cancelled') ? 'cancelled' : 'completed';
            t.isUnread = false;
            t.unreadForRider = false;
            t.cateredByRiderId = null;
            t.cateredByRiderName = null;
            t.cateredBy = null;
            return;
        }

        if (isNewMessageAfterDone) {
            t.status = 'active';
            const activeCaterer = getFastCaterer(t.customerName, t.custId);
            if (activeCaterer) {
                t.folder = 'catering';
                t.cateredByRiderId = (activeCaterer.telegramId || activeCaterer.id || "").toString().trim();
                t.cateredByRiderName = (activeCaterer.riderName || activeCaterer.name || "Rider").toString().trim();
                t.cateredBy = t.cateredByRiderName;
            } else {
                t.folder = 'inbox';
                t.cateredByRiderId = null;
                t.cateredByRiderName = null;
                t.cateredBy = null;
            }
            return;
        }

        const isCompleted = t.status === 'completed' || t.status === 'done' || t.status === 'cancelled';
        if (isCompleted) {
            t.folder = 'done';
            t.isUnread = false;
            t.unreadForRider = false;
            t.cateredByRiderId = null;
            t.cateredByRiderName = null;
            t.cateredBy = null;
            return;
        }

        const activeCaterer = getFastCaterer(t.customerName, t.custId);

        if (activeCaterer) {
            t.folder = 'catering';
            t.status = 'active';
            t.cateredByRiderId = (activeCaterer.telegramId || activeCaterer.id || "").toString().trim();
            t.cateredByRiderName = (activeCaterer.riderName || activeCaterer.name || "Rider").toString().trim();
            t.cateredBy = t.cateredByRiderName;
        } else if (liveRoster.length > 0) {
            const hadStaleCaterer = !!(t.cateredByRiderName || t.cateredByRiderId);
            const wasInCatering = (t.folder || '').toLowerCase() === 'catering';

            if (hadStaleCaterer || wasInCatering) {
                t.cateredByRiderId = null;
                t.cateredByRiderName = null;
                t.cateredBy = null;
                if (wasInCatering) {
                    const isFinished = t.status === 'completed' || t.status === 'done' || t.status === 'cancelled' || t.completedAt;
                    t.folder = isFinished ? 'done' : (t.isApplicant ? 'applicant' : 'inbox');
                }
            }
        }
    });

    const isAllSources = (typeof isAllSourcesSelected === 'function') ? isAllSourcesSelected() : true;
    const isSearching = Boolean(riderChatSearchQuery && riderChatSearchQuery.trim().length > 0);
    const searchQ = riderChatSearchQuery.trim().toLowerCase();
    const searchDigits = searchQ.replace(/\D/g, '');

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

        // Determine effective folder for this thread
        const liveActiveCaterer = getFastCaterer(t.customerName, t.custId);
        const isCurrentlyCatered = Boolean(liveActiveCaterer) || (Boolean(t.cateredByRiderName || t.cateredByRiderId) && t.status !== 'completed' && t.status !== 'cancelled');
        if (isCurrentlyCatered) {
            t.folder = 'catering';
            t.status = 'active';
            if (liveActiveCaterer) {
                t.cateredByRiderId = (liveActiveCaterer.telegramId || liveActiveCaterer.id || "").toString().trim();
                t.cateredByRiderName = (liveActiveCaterer.riderName || liveActiveCaterer.name || "Rider").toString().trim();
                t.cateredBy = t.cateredByRiderName;
            }
        }
        const folder = (t.folder || 'inbox').toLowerCase();

        // IF SEARCHING: SEARCH ACROSS ALL FOLDERS!
        if (isSearching) {
            const name = (t.customerName || t.name || '').toLowerCase();
            const msg = (t.lastMessage || '').toLowerCase();
            const cid = (t.custId || '').toLowerCase();
            const caterer = (t.cateredByRiderName || t.cateredBy || '').toLowerCase();
            const phone = (t.phoneNumber || t.phone || t.contact || '').replace(/\D/g, '');

            const matchName = name.includes(searchQ);
            const matchMsg = msg.includes(searchQ);
            const matchCid = cid.includes(searchQ);
            const matchCaterer = caterer.includes(searchQ);
            const matchPhone = searchDigits.length >= 3 && phone.includes(searchDigits);

            return matchName || matchMsg || matchCid || matchCaterer || matchPhone;
        }

        // 2. Normal Mode: Filter by active tab folder
        if (activeRiderChatFilter === 'inbox') {
            // Catered customer threads MUST NEVER appear in Inbox!
            if (isCurrentlyCatered || folder === 'catering') return false;
            // Completed / Done / Cancelled threads MUST NEVER appear in Inbox!
            if (folder === 'done' || t.status === 'completed' || t.status === 'done' || t.status === 'cancelled') return false;
            // Spam / Other threads from Facebook MUST NEVER appear in Inbox!
            if (folder === 'spam' || folder === 'other' || t.status === 'spam' || t.fbFolder === 'spam' || t.fbFolder === 'other') return false;
            // Applicant threads appear in Applicant tab!
            if (folder === 'applicant' || folder === 'followup' || t.isApplicant) return false;

            // Exclude placeholder 'Customer' threads with outgoing-only messages
            const cleanName = (t.customerName || '').toLowerCase().trim();
            const isPlaceholder = !cleanName || cleanName === 'customer' || cleanName === 'customer name' || cleanName === 'unknown';
            if (isPlaceholder && t.lastMessage && t.lastMessage.startsWith('You:')) return false;

            return folder === 'inbox';
        }
        if (activeRiderChatFilter === 'catering') {
            if (isCurrentlyCatered) return true;
            return folder === 'catering' && t.status !== 'completed' && t.status !== 'done' && t.status !== 'cancelled';
        }
        if (activeRiderChatFilter === 'applicant') {
            if (isCurrentlyCatered) return false;
            return folder === 'applicant' || t.isApplicant === true;
        }
        if (activeRiderChatFilter === 'followup') {
            if (isCurrentlyCatered) return false;
            return folder === 'followup' && !t.isApplicant;
        }
        if (activeRiderChatFilter === 'done') {
            // Catered customer threads MUST NEVER appear in Done!
            if (isCurrentlyCatered || folder === 'catering') return false;
            return folder === 'done' || t.status === 'completed' || t.status === 'done';
        }
        return true;
    });

    // In the Catering tab, pin the rider's own customers to the very top (O(N) precompute avoids O(N log N) regexes)
    if (!isSearching && activeRiderChatFilter === 'catering') {
        for (let i = 0; i < filteredThreads.length; i++) {
            filteredThreads[i]._isMine = isMyCustomerThread(filteredThreads[i], loggedInAuth);
        }
        filteredThreads.sort((a, b) => {
            if (a._isMine && !b._isMine) return -1;
            if (!a._isMine && b._isMine) return 1;
            return (b.lastUpdated || 0) - (a.lastUpdated || 0);
        });
    } else {
        filteredThreads.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    }

    updateInboxUnreadBadge();
    updateDoneUnreadBadge();

    if (badge) {
        if (isSearching) {
            badge.innerText = `${filteredThreads.length} found`;
        } else {
            badge.innerText = `${filteredThreads.length} ${filteredThreads.length === 1 ? 'thread' : 'threads'}`;
        }
    }

    if (filteredThreads.length === 0) {
        if (isSearching) {
            feed.innerHTML = `
            <div class="flex flex-col items-center justify-center p-6 text-center gap-2">
                <div class="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-500 flex items-center justify-center text-sm shadow-inner">
                    <i class="fa-solid fa-magnifying-glass"></i>
                </div>
                <div class="text-gray-700 dark:text-gray-200 text-xs font-bold">No customer threads found matching "${escapeHtml(riderChatSearchQuery)}" across all folders.</div>
                <div class="text-gray-400 dark:text-gray-500 text-[10px]">Try searching by customer name, phone number digits, or message text.</div>
                <button onclick="window.clearRiderChatSearch && window.clearRiderChatSearch()" class="mt-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-3 py-1 rounded-lg transition active:scale-95 shadow-xs cursor-pointer">
                    Clear Search
                </button>
            </div>`;
            return;
        }

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

    let searchBannerHtml = "";
    if (isSearching) {
        searchBannerHtml = `
        <div class="flex items-center justify-between px-3 py-2 mb-2 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 rounded-2xl text-[11px] shadow-xs">
            <div class="flex items-center gap-1.5 font-bold text-blue-800 dark:text-blue-300 truncate">
                <i class="fa-solid fa-magnifying-glass text-blue-500 shrink-0"></i>
                <span class="truncate">Search in All Folders: <span class="font-black italic">"${escapeHtml(riderChatSearchQuery)}"</span></span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <span class="bg-blue-600 text-white font-black text-[10px] px-2 py-0.5 rounded-full shadow-xs">
                    ${filteredThreads.length} match${filteredThreads.length === 1 ? '' : 'es'}
                </span>
                <button type="button" onclick="window.clearRiderChatSearch && window.clearRiderChatSearch()" class="text-blue-600 hover:text-blue-800 dark:text-blue-400 font-bold text-[10px] underline cursor-pointer">
                    Clear
                </button>
            </div>
        </div>`;
    }

    let cateringBannerHtml = "";
    if (!isSearching && activeRiderChatFilter === 'catering') {
        const myCount = filteredThreads.filter(t => isMyCustomerThread(t, loggedInAuth)).length;
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

    const displayThreads = filteredThreads.slice(0, currentFeedLimit);
    let showMoreHtml = '';
    if (filteredThreads.length > currentFeedLimit) {
        const remaining = filteredThreads.length - currentFeedLimit;
        showMoreHtml = `
        <div class="flex justify-center my-3">
            <button type="button" onclick="window.expandRiderChatFeedLimit && window.expandRiderChatFeedLimit()" class="px-4 py-2 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/50 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-400 font-bold text-xs rounded-xl transition cursor-pointer border border-blue-200 dark:border-blue-800 shadow-2xs flex items-center gap-1.5 active:scale-95">
                <i class="fa-solid fa-angles-down text-[10px]"></i>
                <span>Show more threads (+${remaining})</span>
            </button>
        </div>`;
    }

    const cardsHtml = displayThreads.map(t => {
        const { dateStr, timeStr } = formatChatDateParts(t.lastUpdated);
        const isMine = isMyCustomerThread(t, loggedInAuth);
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

        let applicantBadge = "";
        if (t.isApplicant || t.folder === 'applicant') {
            applicantBadge = `<span class="bg-purple-100 text-purple-800 border border-purple-300 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700/50 text-[9px] font-black px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0" title="Rider Applicant"><i class="fa-solid fa-user-tie text-purple-600 dark:text-purple-400"></i> APPLICANT</span>`;
        } else if (t.folder === 'followup') {
            applicantBadge = `<span class="bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700/50 text-[9px] font-black px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0" title="Customer Follow-Up"><i class="fa-solid fa-bookmark text-amber-600 dark:text-amber-400"></i> FOLLOW UP</span>`;
        }

        let channelBadge = "";
        if (t.channel === 'messenger' || isMessengerSource(t, t.custId)) {
            const channelName = t.apiName || (typeof getPublicFbChannelName === 'function' ? getPublicFbChannelName(t.apiId) : '') || 'Camiling FB';
            channelBadge = `<span class="bg-blue-100 text-blue-800 border border-blue-300 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0" title="Source: ${escapeHtml(channelName)}"><i class="fa-brands fa-facebook-messenger text-blue-500"></i> ${escapeHtml(channelName)}</span>`;
        } else {
            channelBadge = `<span class="bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0" title="Source: Lokalex Web App"><i class="fa-solid fa-globe text-emerald-500"></i> Web</span>`;
        }

        let folderBadge = "";
        if (isSearching) {
            const f = (t.folder || 'inbox').toLowerCase();
            if (isCurrentlyCatering || f === 'catering') {
                folderBadge = `<span class="bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"><i class="fa-solid fa-motorcycle text-[8px]"></i> Catering</span>`;
            } else if (f === 'applicant' || t.isApplicant) {
                folderBadge = `<span class="bg-purple-100 text-purple-800 border border-purple-300 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"><i class="fa-solid fa-user-tie text-[8px]"></i> Applicant</span>`;
            } else if (f === 'followup') {
                folderBadge = `<span class="bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"><i class="fa-solid fa-bookmark text-[8px]"></i> Follow Up</span>`;
            } else if (f === 'done' || t.status === 'completed' || t.status === 'done') {
                folderBadge = `<span class="bg-gray-100 text-gray-800 border border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"><i class="fa-solid fa-circle-check text-[8px]"></i> Done</span>`;
            } else {
                folderBadge = `<span class="bg-blue-100 text-blue-800 border border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"><i class="fa-solid fa-inbox text-[8px]"></i> Inbox</span>`;
            }
        }

        const unreadDot = t.isUnread ? `<span class="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shrink-0"></span>` : "";
        
        let cardBorderClass = "border border-gray-200 dark:border-gray-800 bg-white dark:bg-cardBg";
        let avatarBorderClass = "border-blue-500";
        let nameClass = "font-black text-gray-900 dark:text-white text-xs";

        if (isCurrentlyCatering) {
            // Radiant, unmistakable GOLD glowing border ONLY for MY CUSTOMER!
            cardBorderClass = "catering-glow-gold bg-[#FFFBEB] dark:bg-[#261608]";
            avatarBorderClass = "border-amber-400";
            nameClass = "font-black text-gray-900 dark:text-white text-xs";
        } else if (isOtherRiderCatering) {
            // Other riders' customers do NOT glow on my side to make a clear distinction
            cardBorderClass = "border border-gray-200 dark:border-gray-800 bg-white dark:bg-cardBg";
            avatarBorderClass = "border-gray-300 dark:border-gray-700";
            nameClass = "font-bold text-gray-800 dark:text-gray-200 text-xs";
        } else if (t.isUnread) {
            cardBorderClass = "border-2 border-blue-500 dark:border-blue-400 bg-[#EFF6FF] dark:bg-[#0F172A] shadow-md ring-1 ring-blue-400/40";
            avatarBorderClass = "border-blue-500 ring-2 ring-blue-400/50";
            nameClass = "font-black text-blue-600 dark:text-blue-400 text-sm";
        }

        const lastMsgClass = t.isUnread 
            ? "text-xs text-gray-900 dark:text-white font-black" 
            : "text-[11px] text-gray-700 dark:text-gray-300 font-medium";

        const timeClass = isCurrentlyCatering
            ? 'text-amber-700 dark:text-amber-300 font-black'
            : (t.isUnread ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-500 dark:text-gray-400 font-medium');

        const isDoneView = activeRiderChatFilter === 'done';

        return `
        <div class="thread-swipe-wrapper shrink-0 w-full relative overflow-hidden rounded-2xl my-1 group select-none shadow-xs bg-gray-100 dark:bg-gray-800/60" 
            data-cust-id="${escapeHtml(t.custId)}" 
            data-customer-name="${escapeHtml(t.customerName)}" 
            data-avatar-url="${escapeHtml(t.avatarUrl)}">
            
            <!-- Background Actions Left: Reveal on Slide Right (Cater, Unread, Done/Inbox) -->
            <div id="thread-actions-left-${escapeHtml(t.custId)}" 
                class="absolute inset-y-0 left-0 flex items-stretch justify-start z-0 opacity-0 pointer-events-none transition-opacity duration-150 overflow-hidden rounded-2xl">
                <button type="button" 
                    onclick="event.stopPropagation(); window.handleThreadSwipeCater && window.handleThreadSwipeCater(this)" 
                    class="w-[62px] bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-black flex flex-col items-center justify-center gap-1 transition active:scale-95 cursor-pointer shadow-sm select-none" 
                    title="Cater Customer">
                    <i class="fa-solid fa-motorcycle text-sm"></i>
                    <span class="text-[9px] tracking-tight uppercase font-extrabold">Cater</span>
                </button>
                <button type="button" 
                    onclick="event.stopPropagation(); window.handleThreadSwipeUnread && window.handleThreadSwipeUnread(this)" 
                    class="w-[62px] bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-black flex flex-col items-center justify-center gap-1 transition active:scale-95 cursor-pointer shadow-sm select-none" 
                    title="${t.isUnread ? 'Mark Read' : 'Mark Unread'}">
                    <i class="fa-solid fa-${t.isUnread ? 'envelope-open' : 'envelope'} text-sm"></i>
                    <span class="text-[9px] tracking-tight uppercase font-extrabold">${t.isUnread ? 'Read' : 'Unread'}</span>
                </button>
                <button type="button" 
                    onclick="event.stopPropagation(); window.handleThreadSwipeDone && window.handleThreadSwipeDone(this)" 
                    class="w-[62px] ${isDoneView ? 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700' : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700'} text-white font-black flex flex-col items-center justify-center gap-1 transition active:scale-95 cursor-pointer shadow-sm select-none" 
                    title="${isDoneView ? 'Move to Inbox' : 'Move to Done'}">
                    <i class="fa-solid fa-${isDoneView ? 'inbox' : 'check'} text-sm"></i>
                    <span class="text-[9px] tracking-tight uppercase font-extrabold">${isDoneView ? 'Inbox' : 'Done'}</span>
                </button>
            </div>

            <!-- Background Actions Right: Reveal on Slide Left (Cater, Unread, Done/Inbox) -->
            <div id="thread-actions-right-${escapeHtml(t.custId)}" 
                class="absolute inset-y-0 right-0 flex items-stretch justify-end z-0 opacity-0 pointer-events-none transition-opacity duration-150 overflow-hidden rounded-2xl">
                <button type="button" 
                    onclick="event.stopPropagation(); window.handleThreadSwipeCater && window.handleThreadSwipeCater(this)" 
                    class="w-[62px] bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-black flex flex-col items-center justify-center gap-1 transition active:scale-95 cursor-pointer shadow-sm select-none" 
                    title="Cater Customer">
                    <i class="fa-solid fa-motorcycle text-sm"></i>
                    <span class="text-[9px] tracking-tight uppercase font-extrabold">Cater</span>
                </button>
                <button type="button" 
                    onclick="event.stopPropagation(); window.handleThreadSwipeUnread && window.handleThreadSwipeUnread(this)" 
                    class="w-[62px] bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white font-black flex flex-col items-center justify-center gap-1 transition active:scale-95 cursor-pointer shadow-sm select-none" 
                    title="${t.isUnread ? 'Mark Read' : 'Mark Unread'}">
                    <i class="fa-solid fa-${t.isUnread ? 'envelope-open' : 'envelope'} text-sm"></i>
                    <span class="text-[9px] tracking-tight uppercase font-extrabold">${t.isUnread ? 'Read' : 'Unread'}</span>
                </button>
                <button type="button" 
                    onclick="event.stopPropagation(); window.handleThreadSwipeDone && window.handleThreadSwipeDone(this)" 
                    class="w-[62px] ${isDoneView ? 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700' : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700'} text-white font-black flex flex-col items-center justify-center gap-1 transition active:scale-95 cursor-pointer shadow-sm select-none" 
                    title="${isDoneView ? 'Move to Inbox' : 'Move to Done'}">
                    <i class="fa-solid fa-${isDoneView ? 'inbox' : 'check'} text-sm"></i>
                    <span class="text-[9px] tracking-tight uppercase font-extrabold">${isDoneView ? 'Inbox' : 'Done'}</span>
                </button>
            </div>

            <!-- Foreground Thread Card -->
            <div id="thread-card-fg-${escapeHtml(t.custId)}" 
                data-cust-id="${escapeHtml(t.custId)}"
                data-customer-name="${escapeHtml(t.customerName)}"
                data-avatar-url="${escapeHtml(t.avatarUrl)}"
                style="touch-action: pan-y;"
                onpointerdown="window.handleThreadPointerDown && window.handleThreadPointerDown(event, this)"
                onpointermove="window.handleThreadPointerMove && window.handleThreadPointerMove(event, this)"
                onpointerup="window.handleThreadPointerUp && window.handleThreadPointerUp(event, this)"
                onpointercancel="window.handleThreadPointerCancel && window.handleThreadPointerCancel(event, this)"
                onclick="window.handleThreadCardClick && window.handleThreadCardClick(event, this)" 
                class="w-full relative z-10 ${cardBorderClass} hover:bg-gray-50 dark:hover:bg-slate-800 p-3 rounded-2xl flex items-center justify-between cursor-pointer transition-transform duration-200 ease-out select-none">
                <div class="flex items-center gap-3 min-w-0 flex-1">
                    <div class="relative shrink-0">
                        <img src="${escapeHtml(t.avatarUrl)}" loading="lazy" decoding="async" class="w-10 h-10 rounded-full object-cover border-2 ${avatarBorderClass}">
                        ${t.isUnread ? '<div class="absolute -top-0.5 -right-0.5 w-3 h-3 bg-blue-500 rounded-full border-2 border-white dark:border-darkBg animate-ping"></div>' : ''}
                    </div>
                    <div class="min-w-0 flex-1">
                        <!-- Row 1: Prominent Customer Name + Applicant Badge + Status Badge -->
                        <div class="flex items-center gap-1.5 min-w-0">
                            <span class="truncate ${nameClass} max-w-[130px] sm:max-w-[220px] font-black">${escapeHtml(t.customerName)}</span>
                            ${applicantBadge}
                            ${statusBadge}
                            ${unreadDot}
                        </div>
                        <!-- Row 2: Channel Badge + Folder Badge (if searching) + Last Message -->
                        <div class="flex items-center gap-1.5 mt-1 min-w-0">
                            ${channelBadge}
                            ${folderBadge}
                            <span class="${lastMsgClass} truncate flex-1 min-w-0">${escapeHtml(t.lastMessage)}</span>
                        </div>
                    </div>
                </div>
                <div class="flex flex-col items-end shrink-0 ml-2 self-center text-right">
                    ${dateStr ? `<span class="text-[9px] text-gray-500 dark:text-gray-400 font-bold tracking-tight whitespace-nowrap leading-none mb-1">${dateStr}</span>` : ''}
                    <span class="text-[10px] ${timeClass} font-mono leading-none">${timeStr}</span>
                </div>
            </div>
        </div>`;
    }).join('');

    feed.innerHTML = searchBannerHtml + cateringBannerHtml + cardsHtml + showMoreHtml;

    updateInboxUnreadBadge();
    updateDoneUnreadBadge();
}

export function isMessengerSource(meta = {}, key = '') {
    if (meta?.channel === 'messenger') return true;
    if (key && (key.startsWith('fb_') || key.startsWith('messenger_'))) return true;
    const apiId = meta?.apiId || meta?.channelId || meta?.fbApiId || '';
    if (apiId && (apiId.startsWith('fb_') || apiId.includes('fb'))) return true;
    const apiName = (meta?.apiName || meta?.channelName || '').toLowerCase();
    if (apiName.includes('fb') || apiName.includes('facebook') || apiName.includes('messenger')) return true;
    return false;
}

export function isThreadFromSelectedSource(meta, key) {
    if (typeof isAllSourcesSelected === 'function' && isAllSourcesSelected()) return true;
    const isMessenger = isMessengerSource(meta, key);
    if (isMessenger) {
        const threadFbId = meta.apiId || meta.channelId || meta.fbApiId;
        if (threadFbId) {
            return typeof isSourceSelected === 'function' ? isSourceSelected(threadFbId) : true;
        } else {
            return typeof isSourceSelected === 'function' ? (isSourceSelected('messenger') || hasAnyFbSourceSelected()) : true;
        }
    } else {
        return typeof isSourceSelected === 'function' ? isSourceSelected('web') : true;
    }
}

export function getSourceBadgeName(meta, key) {
    const isMessenger = isMessengerSource(meta, key);
    if (isMessenger) {
        const threadFbId = meta.apiId || meta.channelId || meta.fbApiId;
        if (threadFbId && typeof getPublicFbChannelName === 'function') {
            const name = getPublicFbChannelName(threadFbId);
            if (name) return name;
        }
        return meta.apiName || meta.channelName || 'Facebook';
    }
    return 'Web App';
}

let persistMetaTimeout = null;
function schedulePersistMetaCache(data) {
    if (persistMetaTimeout) clearTimeout(persistMetaTimeout);
    persistMetaTimeout = setTimeout(() => {
        try {
            localStorage.setItem('lokalex_cached_customer_chat_meta', JSON.stringify(data));
        } catch (_) {}
    }, 2500);
}

function processCustomerChatMetaData(data, isFromCache = false) {
    if (!data || typeof data !== 'object') return;
    rawCustomerChatMetaData = data;
    if (!isFromCache) {
        schedulePersistMetaCache(data);
    }
    const inboxBadge = document.getElementById('rider-inbox-unread-badge');
    const doneBadge = document.getElementById('rider-done-unread-badge');

    if (Object.keys(data).length === 0) {
        cachedCustomerThreadsMap.clear();
        if (inboxBadge) inboxBadge.classList.add('hidden');
        if (doneBadge) doneBadge.classList.add('hidden');
        if (activeRiderChatFilter !== 'stores') {
            renderRiderCustomerChatFeed();
        }
        return;
    }

    // Acoustic notification chimes & Native Notification Bar alerts for incoming messages
    const newlyArrivedThreadKeys = new Set();
    if (!isInitialCustomerChatMetaLoad && !isFromCache && data) {
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
                // Newly initiated customer thread arriving after initial app load:
                // Only treat as genuine incoming if message was received within the last 3 minutes!
                const isFresh = curLastUpdated && (Date.now() - curLastUpdated < 3 * 60 * 1000);
                if (isFresh) {
                    isIncomingNew = true;
                }
            }

            // Exclude spam or other folders from audio chime and newlyArrivedThreadKeys
            const curFolder = (meta.folder || 'inbox').toLowerCase();
            const isSpam = curFolder === 'spam' || curFolder === 'other' || meta.status === 'spam' || meta.fbFolder === 'spam' || meta.fbFolder === 'other';
            if (isSpam) {
                return;
            }

            if (isIncomingNew && curLastMsg && curLastMsg.toLowerCase() !== 'no messages yet') {
                // Check if from customer (not outgoing rider message)
                const isFromCustomer = !curLastMsg.startsWith('You:') && meta.unreadForRider !== false;
                if (isFromCustomer) {
                    newlyArrivedThreadKeys.add(key);
                    // Check if thread belongs to currently selected chat sources
                    if (!isThreadFromSelectedSource(meta, key)) {
                        return;
                    }

                    const isCatered = !!(meta.cateredByRiderName || meta.cateredByRiderId || meta.cateredBy || (meta.folder || '').toLowerCase() === 'catering');
                    let isEligible = false;

                    if (isCatered) {
                        const isMine = isMyCustomerThread({ custId: key, ...meta });
                        if (isMine) {
                            shouldPlayCateringChime = true;
                            isEligible = true;
                        }
                    } else if ((meta.folder || 'inbox').toLowerCase() === 'inbox' || (meta.folder || '').toLowerCase() === 'done') {
                        shouldPlayInboxChime = true;
                        isEligible = true;
                    }

                    if (isEligible) {
                        // Check if the chat modal for this customer is currently open and visible
                        const activeId = (typeof getActiveRiderChatCustId === 'function' ? getActiveRiderChatCustId() : null) || (typeof window !== 'undefined' ? window.activeRiderChatCustId : null);
                        const isChatOpenAndVisible = (activeId === key) && !document.hidden;

                        if (!isChatOpenAndVisible) {
                            let displayName = (meta.customerName || meta.name || "").trim();
                            if (key.startsWith('fb_') && typeof getResolvedFbName === 'function') {
                                const cached = getResolvedFbName(key);
                                if (cached && cached.name && (!displayName || displayName.startsWith('FB Customer ('))) {
                                    displayName = cached.name;
                                }
                            }
                            if (!displayName || displayName.toLowerCase() === 'customer' || displayName.toLowerCase() === 'customer name' || displayName.toLowerCase() === 'unknown') {
                                if (key.startsWith('cust_')) {
                                    const raw = key.replace(/^cust_/, '').replace(/_/g, ' ').trim();
                                    if (raw) {
                                        displayName = raw.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                                    }
                                }
                            }
                            if (!displayName) displayName = "Customer";

                            const sourceBadge = getSourceBadgeName(meta, key);
                            const notifTitle = `${displayName} • ${sourceBadge}`;

                            let notifBody = curLastMsg;
                            if (notifBody.includes('[Facebook image]') || notifBody.includes('[Facebook attachment]')) {
                                notifBody = "📷 Sent a photo";
                            } else if (notifBody.includes('[Location]') || notifBody.includes('📍')) {
                                notifBody = "📍 Sent a location pin";
                            }

                            showNativeNotification(notifTitle, notifBody, 'chat_' + key, key);
                        }
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
    if (!isFromCache) {
        isInitialCustomerChatMetaLoad = false;
    }

    const threadsMap = new Map();

    Object.keys(data).forEach(key => {
        const cleanKey = (key || '').trim().toLowerCase();
        // Automatically purge invalid/ghost customer IDs
        if (!cleanKey || cleanKey === 'customer' || cleanKey === 'customer name' || cleanKey === 'undefined' || cleanKey === 'null') {
            if (db && key && !isFromCache) {
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
        // Dispatches automated full booking reply ONLY to genuine NEW incoming customer messages in Inbox
        // AND ONLY when ALL riders are unavailable (if an available rider is on roster, skip auto-reply!)
        if (!isInitialCustomerChatMetaLoad && !isFromCache && fullBookingState && fullBookingState.enabled && !hasAvailableRiderOnRoster() && hasValidLastMsg) {
            if (newlyArrivedThreadKeys.has(key)) {
                const threadFolder = (meta.folder || 'inbox').toLowerCase();
                const isSpam = threadFolder === 'spam' || threadFolder === 'other' || meta.status === 'spam' || meta.fbFolder === 'spam' || meta.fbFolder === 'other';
                const isCatered = Boolean(
                    meta.cateredByRiderId ||
                    meta.cateredByRiderName ||
                    meta.cateredBy ||
                    threadFolder === 'catering' ||
                    threadFolder === 'done' ||
                    threadFolder === 'applicant' ||
                    threadFolder === 'followup' ||
                    meta.isApplicant ||
                    meta.status === 'completed' ||
                    meta.status === 'done' ||
                    meta.status === 'cancelled'
                );
                if (threadFolder === 'inbox' && !isCatered && !isSpam) {
                    if (!rawLastMsg.startsWith('You:') && meta.unreadForRider !== false) {
                        sendFullBookingAutoReply(key, meta);
                    }
                }
            }
        }

        let displayName = (meta.customerName || meta.name || "").trim();
        if (key.startsWith('fb_')) {
            const cached = (typeof getResolvedFbName === 'function') ? getResolvedFbName(key) : null;
            if (cached && cached.name && (!displayName || displayName.startsWith('FB Customer (') || displayName === 'Customer')) {
                displayName = cached.name;
            }
        }

        // Auto-extract customer name from key (e.g. cust_christian -> 'Christian')
        const currentCleanName = displayName.toLowerCase();
        if (!displayName || currentCleanName === 'customer' || currentCleanName === 'customer name' || currentCleanName === 'unknown') {
            if (key.startsWith('cust_')) {
                const rawExtracted = key.replace(/^cust_/, '').replace(/_/g, ' ').trim();
                if (rawExtracted) {
                    displayName = rawExtracted.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                }
            }
            // Check live roster forcedCaters for a mapped name
            if (!displayName || displayName.toLowerCase() === 'customer' || displayName.toLowerCase() === 'customer name') {
                const liveRoster = globalState.rosterMembers || [];
                for (const m of liveRoster) {
                    if (m.forcedCaters && typeof m.forcedCaters === 'object') {
                        for (const [fcKey, fcVal] of Object.entries(m.forcedCaters)) {
                            if (fcKey === key) {
                                const fcName = (fcVal && typeof fcVal === 'object' && fcVal.customerName) ? fcVal.customerName : fcVal;
                                if (fcName && typeof fcName === 'string' && fcName.toLowerCase() !== 'customer') {
                                    displayName = fcName.trim();
                                    break;
                                }
                            }
                        }
                    }
                    if (displayName && displayName.toLowerCase() !== 'customer') break;
                }
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

        // If this is a non-FB thread (e.g. cust_... or name), check if a real fb_ thread exists for this customer
        if (!key.startsWith('fb_') && !key.startsWith('messenger_')) {
            const hasRealFbThread = Object.keys(data).some(otherKey => {
                if (!otherKey.startsWith('fb_') && !otherKey.startsWith('messenger_')) return false;
                const otherMeta = (data[otherKey]?.metadata || data[otherKey] || {});
                const otherName = (otherMeta.customerName || otherMeta.name || '').trim();
                return otherName && isCustomerMatch(otherName, displayName);
            });
            if (hasRealFbThread) {
                // Real Facebook Messenger thread already exists! Suppress the duplicate orphaned card
                return;
            }
        }

        if (!displayName) displayName = "Customer";
        let displayAvatar = meta.avatarUrl;
        if (key.startsWith('fb_')) {
            const cached = (typeof getResolvedFbName === 'function') ? getResolvedFbName(key) : null;
            if (cached && cached.avatarUrl) displayAvatar = cached.avatarUrl;
        }

        const isApplicant = Boolean(meta.isApplicant === true || (meta.folder || '').toLowerCase() === 'applicant');
        const isFollowUp = Boolean(!isApplicant && (meta.folder || '').toLowerCase() === 'followup');
        const isAlreadyDone = (meta.status === 'completed' || meta.status === 'done' || meta.status === 'cancelled' || (meta.folder || '').toLowerCase() === 'done');
        const completedAt = Number(meta.completedAt) || 0;
        const lastMsgTime = Number(meta.lastUpdated) || Number(meta.timestamp) || 0;
        const isNewMessageAfterDone = isAlreadyDone && completedAt > 0 && lastMsgTime > (completedAt + 3000) && meta.unreadForRider === true && rawLastMsg && !rawLastMsg.startsWith('You:');

        let isUnread = false;
        if (rawLastMsg && rawLastMsg.startsWith('You:')) {
            // Outgoing rider messages can NEVER be unread
            isUnread = false;
        } else if (isAlreadyDone && !isNewMessageAfterDone && !isApplicant && !isFollowUp) {
            // Completed threads do not show unread badge for old messages
            isUnread = false;
        } else if (meta.unreadForRider === true) {
            isUnread = true;
        } else if (meta.unreadForRider === false) {
            isUnread = false;
        } else if (!isAlreadyDone && rawLastMsg && rawLastMsg.toLowerCase() !== 'no messages yet') {
            isUnread = true;
        }

        let isCompletedStatus = isAlreadyDone && !isNewMessageAfterDone && !isApplicant && !isFollowUp;
        let threadFolder = (meta.folder || 'inbox').toLowerCase();
        if (isApplicant) {
            threadFolder = 'applicant';
        } else if (isFollowUp) {
            threadFolder = 'followup';
        } else if (isCompletedStatus) {
            threadFolder = 'done';
        }

        // Validate catering against live roster: ACTIVE ROSTER CATERING ALWAYS TAKES PRECEDENCE!
        const activeCaterer = getActiveRosterCaterer(displayName, key, meta);
        const isExplicitlyDoneOrCancelled = !activeCaterer && (isCompletedStatus || meta.status === 'cancelled' || meta.status === 'completed' || meta.folder === 'done');

        if (activeCaterer) {
            isCompletedStatus = false;
            threadFolder = 'catering';
            meta.status = 'active';
            meta.cateredByRiderId = (activeCaterer.telegramId || activeCaterer.id || "").toString().trim();
            meta.cateredByRiderName = (activeCaterer.riderName || activeCaterer.name || "Rider").toString().trim();
            meta.cateredBy = meta.cateredByRiderName;
        } else if (isNewMessageAfterDone) {
            // Customer sent a new message! Automatically reactivate thread back to Inbox (or Catering if catered)
            meta.status = 'active';
            threadFolder = activeCaterer ? 'catering' : (isApplicant ? 'applicant' : 'inbox');
            meta.cateredByRiderId = activeCaterer ? (activeCaterer.telegramId || activeCaterer.id || "").toString().trim() : null;
            meta.cateredByRiderName = activeCaterer ? (activeCaterer.riderName || activeCaterer.name || "Rider").toString().trim() : null;
            meta.cateredBy = meta.cateredByRiderName;
        } else if (isCompletedStatus) {
            threadFolder = 'done';
            meta.cateredByRiderId = null;
            meta.cateredByRiderName = null;
            meta.cateredBy = null;
        } else if (globalState.rosterMembers && globalState.rosterMembers.length > 0) {
            // Roster is loaded and NO rider is actively catering this customer!
            const hadStaleCaterer = !!(meta.cateredByRiderName || meta.cateredByRiderId || meta.cateredBy);
            const wasInCatering = threadFolder === 'catering';

            if (hadStaleCaterer || wasInCatering) {
                meta.cateredByRiderId = null;
                meta.cateredByRiderName = null;
                meta.cateredBy = null;
                const isFinished = isCompletedStatus || meta.completedAt || meta.status === 'completed' || meta.status === 'done' || meta.status === 'cancelled';
                if (wasInCatering) {
                    threadFolder = isFinished ? 'done' : (isApplicant ? 'applicant' : (isFollowUp ? 'followup' : 'inbox'));
                }
            }
        }

        const threadObj = {
            custId: key,
            customerName: displayName,
            avatarUrl: displayAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0084FF&color=fff`,
            lastMessage: rawLastMsg || "No messages yet",
            lastUpdated: meta.lastUpdated || 0,
            completedAt: meta.completedAt || (isCompletedStatus ? (Number(meta.lastUpdated) || Date.now()) : null),
            folder: isApplicant ? 'applicant' : (isFollowUp ? 'followup' : threadFolder),
            isApplicant: isApplicant,
            channel: isMessengerSource(meta, key) ? 'messenger' : (meta.channel || 'web'),
            apiId: meta.apiId || meta.channelId || meta.fbApiId || (isMessengerSource(meta, key) ? 'fb_api_1791648211091' : null),
            apiName: meta.apiName || meta.channelName || (isMessengerSource(meta, key) ? 'Camiling FB' : null),
            cateredByRiderId: isCompletedStatus ? null : (meta.cateredByRiderId || null),
            cateredByRiderName: isCompletedStatus ? null : (meta.cateredByRiderName || meta.cateredBy || null),
            status: isApplicant ? 'active' : (meta.status || (isCompletedStatus ? 'completed' : 'active')),
            isUnread: isUnread,
            unreadForRider: meta.unreadForRider === true && !isCompletedStatus,
            hasRealMessages: hasValidLastMsg
        };

        // Cross-reference with live roster so newly incoming threads immediately transition to catering
        {
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
                threadObj.isApplicant = threadObj.isApplicant || existing.isApplicant;
                if (threadObj.isApplicant && threadObj.folder !== 'catering') {
                    threadObj.folder = 'applicant';
                }
                if (!threadObj.cateredByRiderName && existing.cateredByRiderName && threadObj.folder !== 'done') {
                    threadObj.cateredByRiderName = existing.cateredByRiderName;
                    threadObj.cateredByRiderId = existing.cateredByRiderId;
                    if (existing.folder === 'catering') threadObj.folder = 'catering';
                }
                threadsMap.set(dedupKey, threadObj);
            } else {
                existing.isUnread = existing.isUnread || threadObj.isUnread;
                existing.isApplicant = existing.isApplicant || threadObj.isApplicant;
                if (existing.isApplicant && existing.folder !== 'catering') {
                    existing.folder = 'applicant';
                }
                if (!existing.cateredByRiderName && threadObj.cateredByRiderName && existing.folder !== 'done') {
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
    
    // Auto-resolve Facebook customer names & Page folders in the background (throttled to at most once per 3 minutes)
    if (!isFromCache) {
        const now = Date.now();
        if (now - lastAutoResolveFbTime > 180000) {
            lastAutoResolveFbTime = now;
            if (typeof syncFacebookPageFolderStatus === 'function') {
                syncFacebookPageFolderStatus(false).catch(() => {});
            }
            if (typeof autoResolvePendingFacebookThreads === 'function') {
                autoResolvePendingFacebookThreads(allThreads);
            }
        }
    }

    updateInboxUnreadBadge();
    updateDoneUnreadBadge();

    if (activeRiderChatFilter !== 'stores') {
        renderRiderCustomerChatFeed();
    }

    // Instant thread sync bridge: If a customer thread is currently open and received a new message, sync it now!
    if (!isFromCache && typeof window !== 'undefined' && window.activeRiderChatCustId && typeof window.syncIncomingMessageFromMeta === 'function') {
        const activeCustId = window.activeRiderChatCustId;
        const matchingThread = allThreads.find(t => t.custId === activeCustId || t.id === activeCustId || isCustomerMatch(t.custId, activeCustId));
        if (matchingThread) {
            window.syncIncomingMessageFromMeta(activeCustId, matchingThread);
        }
    }
}

export function listenToAllCustomerChatsForRider() {
    listenToGlobalStoreChats();
    initFullBookingListener();

    // 1. INSTANT LOCAL DISK CACHE (0ms - Facebook & Web customer threads load instantly on screen!)
    try {
        const cached = localStorage.getItem('lokalex_cached_customer_chat_meta');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                processCustomerChatMetaData(parsed, true);
            }
        }
    } catch (_) {}

    // 2. FAST PARALLEL DIRECT REST FETCH (<150ms guaranteed on mobile cellular networks)
    const directRestUrl = `https://lokalexoptimized-rtdb-default-rtdb.asia-southeast1.firebasedatabase.app/customerChatMeta.json?t=${Date.now()}`;
    fetch(directRestUrl, { cache: 'no-store' })
        .then(res => res.json())
        .then(data => {
            if (data && typeof data === 'object') {
                processCustomerChatMetaData(data, false);
            }
        })
        .catch(err => {
            console.warn('[CustomerChatMeta] Direct REST fast-fetch fallback:', err);
        });

    if (!db || isCustomerChatMetaListening) return;
    isCustomerChatMetaListening = true;

    // 3. REALTIME WEBSOCKET LISTENER FOR INCOMING LIVE MESSAGES
    let metaRafId = null;
    db.ref('customerChatMeta').on('value', (snapshot) => {
        const data = snapshot.val();
        if (metaRafId) cancelAnimationFrame(metaRafId);
        metaRafId = requestAnimationFrame(() => {
            metaRafId = null;
            processCustomerChatMetaData(data, false);
        });
    }, (error) => {
        console.error("Firebase customerChatMeta listener error:", error);
    });
}

export function updateInboxUnreadBadge() {
    const inboxBadge = document.getElementById('rider-inbox-unread-badge');
    if (!inboxBadge) return;

    const isAllSources = (typeof isAllSourcesSelected === 'function') ? isAllSourcesSelected() : true;
    const allThreads = Array.from(cachedCustomerThreadsMap.values());

    const unreadInboxCount = allThreads.filter(t => {
        // 1. Must be marked unread
        if (!t.isUnread) return false;

        // 2. Outgoing rider messages can NEVER be unread
        if (t.lastMessage && t.lastMessage.startsWith('You:')) return false;

        // 3. Exclude completed / done / cancelled threads
        const isDone = t.status === 'completed' || t.status === 'done' || t.status === 'cancelled';
        if (isDone) return false;

        // 4. Must be in inbox folder and not catered
        const folder = (t.folder || 'inbox').toLowerCase();
        const isCatered = !!(t.cateredByRiderName || t.cateredByRiderId || t.cateredBy);
        if (folder !== 'inbox' || isCatered) return false;

        // 5. Must match active chat sources filter
        if (typeof isSourceSelected === 'function' && !isAllSources) {
            if (t.channel === 'messenger') {
                const threadFbId = t.apiId || t.channelId || t.fbApiId;
                if (threadFbId) {
                    if (!isSourceSelected(threadFbId)) return false;
                } else {
                    if (!isSourceSelected('messenger') && !hasAnyFbSourceSelected()) return false;
                }
            } else {
                if (!isSourceSelected('web')) return false;
            }
        }

        // 6. Exclude placeholder names without real messages
        const name = (t.customerName || '').trim().toLowerCase();
        if (!name || name === 'customer' || name === 'customer name' || name === 'unknown') return false;

        return true;
    }).length;

    if (unreadInboxCount > 0) {
        inboxBadge.innerText = unreadInboxCount.toString();
        inboxBadge.classList.remove('hidden');
    } else {
        inboxBadge.classList.add('hidden');
    }
}

export function updateDoneUnreadBadge() {
    const doneBadge = document.getElementById('rider-done-unread-badge');
    if (!doneBadge) return;

    const isAllSources = (typeof isAllSourcesSelected === 'function') ? isAllSourcesSelected() : true;
    const allThreads = Array.from(cachedCustomerThreadsMap.values());

    const unreadDoneCount = allThreads.filter(t => {
        // 1. Must be marked unread
        if (!t.isUnread) return false;

        // 2. Outgoing rider messages can NEVER be unread
        if (t.lastMessage && t.lastMessage.startsWith('You:')) return false;

        // 3. Must be in done folder or marked completed/done
        const folder = (t.folder || '').toLowerCase();
        const isDone = folder === 'done' || t.status === 'completed' || t.status === 'done' || t.status === 'cancelled';
        if (!isDone) return false;

        // 4. Must match active chat sources filter
        if (typeof isSourceSelected === 'function' && !isAllSources) {
            if (t.channel === 'messenger') {
                const threadFbId = t.apiId || t.channelId || t.fbApiId;
                if (threadFbId) {
                    if (!isSourceSelected(threadFbId)) return false;
                } else {
                    if (!isSourceSelected('messenger') && !hasAnyFbSourceSelected()) return false;
                }
            } else {
                if (!isSourceSelected('web')) return false;
            }
        }

        // 5. Exclude placeholder names without real messages
        const name = (t.customerName || '').trim().toLowerCase();
        if (!name || name === 'customer' || name === 'customer name' || name === 'unknown') return false;

        return true;
    }).length;

    if (unreadDoneCount > 0) {
        doneBadge.innerText = unreadDoneCount.toString();
        doneBadge.classList.remove('hidden');
    } else {
        doneBadge.classList.add('hidden');
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
    updateDoneUnreadBadge();
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
    updateDoneUnreadBadge();
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

// ============================================================================
// SWIPE TO REVEAL ACTIONS (CATER, UNREAD, DONE / INBOX)
// Supports sliding LEFT or RIGHT!
// ============================================================================
export function snapOpenSwipeCard(cardEl, direction = 'left') {
    if (!cardEl) return;
    const custId = cardEl.getAttribute('data-cust-id');
    const rightTray = document.getElementById(`thread-actions-right-${custId}`);
    const leftTray = document.getElementById(`thread-actions-left-${custId}`);

    cardEl.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
    if (direction === 'left') {
        cardEl.style.transform = 'translateX(-186px)';
        cardEl._isOpen = 'left';
        cardEl._currentX = -186;
        if (rightTray) {
            rightTray.style.opacity = '1';
            rightTray.style.pointerEvents = 'auto';
        }
        if (leftTray) {
            leftTray.style.opacity = '0';
            leftTray.style.pointerEvents = 'none';
        }
    } else {
        cardEl.style.transform = 'translateX(186px)';
        cardEl._isOpen = 'right';
        cardEl._currentX = 186;
        if (leftTray) {
            leftTray.style.opacity = '1';
            leftTray.style.pointerEvents = 'auto';
        }
        if (rightTray) {
            rightTray.style.opacity = '0';
            rightTray.style.pointerEvents = 'none';
        }
    }
    window._currentlyOpenSwipeCard = cardEl;
}

export function resetSwipeCard(cardEl) {
    if (!cardEl) return;
    const custId = cardEl.getAttribute('data-cust-id');
    const rightTray = document.getElementById(`thread-actions-right-${custId}`);
    const leftTray = document.getElementById(`thread-actions-left-${custId}`);

    cardEl.style.transition = 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
    cardEl.style.transform = 'translateX(0px)';
    cardEl._isOpen = false;
    cardEl._currentX = 0;

    if (rightTray) {
        rightTray.style.opacity = '0';
        rightTray.style.pointerEvents = 'none';
    }
    if (leftTray) {
        leftTray.style.opacity = '0';
        leftTray.style.pointerEvents = 'none';
    }

    if (window._currentlyOpenSwipeCard === cardEl) {
        window._currentlyOpenSwipeCard = null;
    }
}

export function handleThreadPointerDown(e, cardEl) {
    if (!cardEl) return;
    if (e.target && e.target.closest('button, a, input, select')) return;

    cardEl._pointerId = e.pointerId;
    cardEl._startX = e.clientX;
    cardEl._startY = e.clientY;
    cardEl._currentX = cardEl._isOpen === 'left' ? -186 : (cardEl._isOpen === 'right' ? 186 : 0);
    cardEl._isSwiping = false;
    cardEl._hasMoved = false;

    if (window._currentlyOpenSwipeCard && window._currentlyOpenSwipeCard !== cardEl) {
        resetSwipeCard(window._currentlyOpenSwipeCard);
    }
}

export function handleThreadPointerMove(e, cardEl) {
    if (!cardEl || cardEl._pointerId === undefined || cardEl._pointerId !== e.pointerId) return;
    const deltaX = e.clientX - cardEl._startX;
    const deltaY = e.clientY - cardEl._startY;

    if (!cardEl._isSwiping) {
        // Vertical scroll intent dominates; cancel swipe tracking
        if (Math.abs(deltaY) > 8 && Math.abs(deltaY) >= Math.abs(deltaX)) {
            try {
                if (cardEl.hasPointerCapture && cardEl.hasPointerCapture(e.pointerId)) {
                    cardEl.releasePointerCapture(e.pointerId);
                }
            } catch (err) {}
            cardEl._pointerId = undefined;
            return;
        }

        // Horizontal swipe intent dominates
        if (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY)) {
            cardEl._isSwiping = true;
            try {
                cardEl.setPointerCapture(e.pointerId);
            } catch (err) {}
        }
    }

    if (cardEl._isSwiping) {
        if (e.cancelable) {
            e.preventDefault();
        }
        cardEl._hasMoved = true;
        let newX = (cardEl._currentX || 0) + deltaX;
        if (newX > 210) newX = 210;
        if (newX < -210) newX = -210;

        cardEl.style.transition = 'none';
        cardEl.style.transform = `translateX(${newX}px)`;

        const custId = cardEl.getAttribute('data-cust-id');
        const rightTray = document.getElementById(`thread-actions-right-${custId}`);
        const leftTray = document.getElementById(`thread-actions-left-${custId}`);

        if (newX < 0) {
            if (rightTray) {
                rightTray.style.opacity = Math.min(1, Math.abs(newX) / 60).toString();
                rightTray.style.pointerEvents = 'auto';
            }
            if (leftTray) {
                leftTray.style.opacity = '0';
                leftTray.style.pointerEvents = 'none';
            }
        } else if (newX > 0) {
            if (leftTray) {
                leftTray.style.opacity = Math.min(1, Math.abs(newX) / 60).toString();
                leftTray.style.pointerEvents = 'auto';
            }
            if (rightTray) {
                rightTray.style.opacity = '0';
                rightTray.style.pointerEvents = 'none';
            }
        } else {
            if (rightTray) {
                rightTray.style.opacity = '0';
                rightTray.style.pointerEvents = 'none';
            }
            if (leftTray) {
                leftTray.style.opacity = '0';
                leftTray.style.pointerEvents = 'none';
            }
        }
    }
}

export function handleThreadPointerUp(e, cardEl) {
    if (!cardEl) return;
    if (cardEl._pointerId !== undefined && e.pointerId === cardEl._pointerId) {
        try {
            if (cardEl.hasPointerCapture && cardEl.hasPointerCapture(e.pointerId)) {
                cardEl.releasePointerCapture(e.pointerId);
            }
        } catch (err) {}
        cardEl._pointerId = undefined;
    }

    if (!cardEl._isSwiping) {
        return;
    }

    cardEl._justSwiped = true;
    setTimeout(() => {
        cardEl._justSwiped = false;
    }, 250);

    const deltaX = e.clientX - cardEl._startX;

    if (cardEl._isOpen === 'left') {
        if (deltaX > 45) {
            resetSwipeCard(cardEl);
        } else {
            snapOpenSwipeCard(cardEl, 'left');
        }
    } else if (cardEl._isOpen === 'right') {
        if (deltaX < -45) {
            resetSwipeCard(cardEl);
        } else {
            snapOpenSwipeCard(cardEl, 'right');
        }
    } else {
        if (deltaX < -45) {
            snapOpenSwipeCard(cardEl, 'left');
        } else if (deltaX > 45) {
            snapOpenSwipeCard(cardEl, 'right');
        } else {
            resetSwipeCard(cardEl);
        }
    }
}

export function handleThreadPointerCancel(e, cardEl) {
    if (!cardEl) return;
    if (cardEl._pointerId !== undefined) {
        try {
            if (cardEl.hasPointerCapture && cardEl.hasPointerCapture(e.pointerId)) {
                cardEl.releasePointerCapture(e.pointerId);
            }
        } catch (err) {}
        cardEl._pointerId = undefined;
    }
    if (cardEl._isSwiping) {
        resetSwipeCard(cardEl);
    }
}

export function handleThreadTouchStart(e, cardEl) {
    if (!cardEl || !e.touches || e.touches.length === 0) return;
    const touch = e.touches[0];
    handleThreadPointerDown({
        pointerId: 1,
        clientX: touch.clientX,
        clientY: touch.clientY,
        target: e.target
    }, cardEl);
}

export function handleThreadTouchMove(e, cardEl) {
    if (!cardEl || !e.touches || e.touches.length === 0) return;
    const touch = e.touches[0];
    handleThreadPointerMove({
        pointerId: 1,
        clientX: touch.clientX,
        clientY: touch.clientY,
        cancelable: e.cancelable,
        preventDefault: () => { if (e.cancelable) e.preventDefault(); }
    }, cardEl);
}

export function handleThreadTouchEnd(e, cardEl) {
    if (!cardEl) return;
    const touch = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : { clientX: cardEl._startX || 0 };
    handleThreadPointerUp({
        pointerId: 1,
        clientX: touch.clientX
    }, cardEl);
}

export function handleThreadCardClick(event, cardElOrCustId, custName, avatarUrl) {
    let target = event?.currentTarget;
    let effectiveCustId = custName ? cardElOrCustId : null;
    let effectiveName = custName;
    let effectiveAvatar = avatarUrl;

    if (cardElOrCustId && typeof cardElOrCustId === 'object' && cardElOrCustId.getAttribute) {
        target = cardElOrCustId;
    }

    if (target) {
        if (target._justSwiped) {
            return;
        }
        if (target._isOpen) {
            resetSwipeCard(target);
            return;
        }
        effectiveCustId = target.getAttribute('data-cust-id') || target.dataset.custId || effectiveCustId;
        effectiveName = target.getAttribute('data-customer-name') || target.dataset.customerName || effectiveName;
        effectiveAvatar = target.getAttribute('data-avatar-url') || target.dataset.avatarUrl || effectiveAvatar;
    }

    if (window.openRiderCustomerChatModal && effectiveCustId) {
        window.openRiderCustomerChatModal(effectiveCustId, effectiveName, effectiveAvatar);
    }
}

export function handleThreadSwipeCater(btnOrCustId, optionalName) {
    let custId = btnOrCustId;
    let custName = optionalName;
    if (btnOrCustId && typeof btnOrCustId === 'object' && btnOrCustId.closest) {
        const wrapper = btnOrCustId.closest('.thread-swipe-wrapper');
        custId = wrapper?.getAttribute('data-cust-id') || wrapper?.dataset.custId;
        custName = wrapper?.getAttribute('data-customer-name') || wrapper?.dataset.customerName;
    }
    const fg = document.getElementById(`thread-card-fg-${custId}`);
    if (fg) resetSwipeCard(fg);

    const activeRole = localStorage.getItem('lokalex_active_role');
    const currentId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const currentName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim();

    const isAdminUser = typeof window.isAdmin === 'function' ? window.isAdmin() : (typeof isAdmin === 'function' ? isAdmin() : false);
    const canManage = typeof window.canManageRoster === 'function' ? window.canManageRoster() : (typeof canManageRoster === 'function' ? canManageRoster() : false);

    if ((!currentId || !currentName || activeRole !== 'rider') && !isAdminUser && !canManage) {
        showToast("⚠️ Hindi ka naka-login bilang rider. Mag-login muna bago mag-cater.");
        if (typeof window.switchView === 'function') window.switchView('view-login');
        else if (typeof window.renderViewUI === 'function') window.renderViewUI('view-login');
        return;
    }

    const liveRoster = globalState.rosterMembers || [];
    const myRecord = liveRoster.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        return (currentId && mId === currentId) || (currentName && mName === currentName.toLowerCase());
    });

    if (!isAdminUser && !canManage) {
        if (!myRecord || myRecord.status === 'End' || !myRecord.status) {
            return showToast("⚠️ Naka-End Shift ka. Pindutin muna ang Available sa roster bago mag-cater.");
        }
    }

    if (window.confirmCateringStatus && custId) {
        window.confirmCateringStatus(custName || 'Customer', custId);
    }
}

export function handleThreadSwipeUnread(btnOrCustId) {
    let custId = btnOrCustId;
    if (btnOrCustId && typeof btnOrCustId === 'object' && btnOrCustId.closest) {
        const wrapper = btnOrCustId.closest('.thread-swipe-wrapper');
        custId = wrapper?.getAttribute('data-cust-id') || wrapper?.dataset.custId;
    }
    const fg = document.getElementById(`thread-card-fg-${custId}`);
    if (fg) resetSwipeCard(fg);
    if (custId) {
        toggleCustomerChatUnread(custId);
    }
}

export function reopenThreadToInbox(custId) {
    if (!custId) return;
    if (db) {
        const payload = {
            folder: 'inbox',
            status: 'open'
        };
        db.ref(`customerChats/${custId}/metadata`).update(payload).catch(() => {});
        db.ref(`customerChatMeta/${custId}`).update(payload).catch(() => {});
    }
    for (const thread of cachedCustomerThreadsMap.values()) {
        if (thread.custId === custId) {
            thread.folder = 'inbox';
            break;
        }
    }
    updateInboxUnreadBadge();
    updateDoneUnreadBadge();
    renderRiderCustomerChatFeed();
    showToast("📥 Chat moved back to Inbox");
}

export function handleThreadSwipeDone(btnOrCustId) {
    let custId = btnOrCustId;
    let customerName = "";
    if (btnOrCustId && typeof btnOrCustId === 'object' && btnOrCustId.closest) {
        const wrapper = btnOrCustId.closest('.thread-swipe-wrapper');
        custId = wrapper?.getAttribute('data-cust-id') || wrapper?.dataset.custId;
        customerName = wrapper?.getAttribute('data-customer-name') || wrapper?.dataset.customerName || "";
        if (!customerName && wrapper) {
            const nameEl = wrapper.querySelector('.font-black');
            if (nameEl) customerName = (nameEl.innerText || nameEl.textContent || '').trim();
        }
    }
    const fg = document.getElementById(`thread-card-fg-${custId}`);
    if (fg) resetSwipeCard(fg);
    if (!custId) return;

    if (activeRiderChatFilter === 'done') {
        reopenThreadToInbox(custId);
    } else {
        if (window.markThreadDone) {
            window.markThreadDone(custId, customerName);
        }
    }
}

// Global outside-click listener to close any open swipe card
if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', (e) => {
        if (window._currentlyOpenSwipeCard) {
            const wrapper = window._currentlyOpenSwipeCard.closest('.thread-swipe-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                resetSwipeCard(window._currentlyOpenSwipeCard);
            }
        }
    }, { passive: true });
}

if (typeof window !== 'undefined') {
    window.getCachedCustomerThreadsMap = getCachedCustomerThreadsMap;
    window.getActiveInboxCustomerThreads = getActiveInboxCustomerThreads;
    window.renderRiderCustomerChatFeed = renderRiderCustomerChatFeed;
    window.isMyCustomerThread = isMyCustomerThread;
    window.markCustomerChatAsUnread = markCustomerChatAsUnread;
    window.markCustomerChatAsRead = markCustomerChatAsRead;
    window.toggleCustomerChatUnread = toggleCustomerChatUnread;
    window.updateInboxUnreadBadge = updateInboxUnreadBadge;
    window.updateDoneUnreadBadge = updateDoneUnreadBadge;
    window.isThreadFromSelectedSource = isThreadFromSelectedSource;
    window.getSourceBadgeName = getSourceBadgeName;

    window.snapOpenSwipeCard = snapOpenSwipeCard;
    window.resetSwipeCard = resetSwipeCard;
    window.handleThreadPointerDown = handleThreadPointerDown;
    window.handleThreadPointerMove = handleThreadPointerMove;
    window.handleThreadPointerUp = handleThreadPointerUp;
    window.handleThreadPointerCancel = handleThreadPointerCancel;
    window.handleThreadTouchStart = handleThreadTouchStart;
    window.handleThreadTouchMove = handleThreadTouchMove;
    window.handleThreadTouchEnd = handleThreadTouchEnd;
    window.handleThreadCardClick = handleThreadCardClick;
    window.handleThreadSwipeCater = handleThreadSwipeCater;
    window.handleThreadSwipeUnread = handleThreadSwipeUnread;
    window.handleThreadSwipeDone = handleThreadSwipeDone;
    window.reopenThreadToInbox = reopenThreadToInbox;

    window.addEventListener('rosterUpdated', () => {
        if (activeRiderChatFilter !== 'stores') {
            renderRiderCustomerChatFeed();
        }
        if (typeof updateFullBookingUI === 'function') {
            updateFullBookingUI();
        }
    });
}