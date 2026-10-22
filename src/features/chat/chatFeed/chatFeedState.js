// src/features/chat/chatFeed/chatFeedState.js
import { appState, globalState } from '../../../store/state.js';
import { isCustomerMatch, isRiderMatch } from '../../roster/rosterUtils.js';
import { 
    isSourceSelected, 
    hasAnyFbSourceSelected, 
    getPublicFbChannelName 
} from '../facebookApiAdmin.js';
import { renderStoreChatsInDashboard } from '../riderStoreChat.js';

export let activeRiderChatFilter = 'inbox';
export let cachedCustomerThreadsMap = new Map();
export let isCustomerChatMetaListening = false;
export let rawCustomerChatMetaData = null;
export let isInitialCustomerChatMetaLoad = true;
export const lastKnownMessageStateMap = new Map();
export let currentFeedLimit = 35;
export let feedRenderRafId = null;
export let lastAutoResolveFbTime = Date.now() + 180000;
export let riderChatSearchQuery = '';
export let persistMetaTimeout = null;

export function setActiveRiderChatFilter(filter) {
    activeRiderChatFilter = filter;
}

export function setCachedCustomerThreadsMap(map) {
    cachedCustomerThreadsMap = map;
}

export function setIsCustomerChatMetaListening(val) {
    isCustomerChatMetaListening = val;
}

export function setRawCustomerChatMetaData(data) {
    rawCustomerChatMetaData = data;
}

export function setIsInitialCustomerChatMetaLoad(val) {
    isInitialCustomerChatMetaLoad = val;
}

export function setCurrentFeedLimit(limit) {
    currentFeedLimit = limit;
}

export function setFeedRenderRafId(id) {
    feedRenderRafId = id;
}

export function setLastAutoResolveFbTime(t) {
    lastAutoResolveFbTime = t;
}

export function setRiderChatSearchQuery(query) {
    riderChatSearchQuery = query;
}

export function setPersistMetaTimeout(timeout) {
    persistMetaTimeout = timeout;
}

export function getCachedCustomerThreadsMap() {
    return cachedCustomerThreadsMap;
}

export function getActiveRiderChatFilter() { 
    return activeRiderChatFilter; 
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
    if (typeof window.renderRiderCustomerChatFeed === 'function') {
        window.renderRiderCustomerChatFeed();
    }
}

export function clearRiderChatSearch() {
    riderChatSearchQuery = '';
    const input = document.getElementById('rider-chat-search-input');
    if (input) input.value = '';
    if (typeof window.renderRiderCustomerChatFeed === 'function') {
        window.renderRiderCustomerChatFeed();
    }
}

export function expandRiderChatFeedLimit() {
    currentFeedLimit += 35;
    if (typeof window.renderRiderCustomerChatFeed === 'function') {
        window.renderRiderCustomerChatFeed();
    }
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
        if (typeof window.renderRiderCustomerChatFeed === 'function') {
            window.renderRiderCustomerChatFeed();
        }
        if (typeof window.listenToAllCustomerChatsForRider === 'function') {
            window.listenToAllCustomerChatsForRider();
        }
    }
}

export function getThreadDedupKey(key, meta) {
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

export function isMessengerSource(meta = {}, key = '') {
    return meta?.channel === 'messenger' ||
           (typeof key === 'string' && key.startsWith('fb_')) ||
           Boolean(meta?.apiId || meta?.channelId || meta?.fbApiId);
}

export function isThreadFromSelectedSource(meta, key) {
    if (typeof isSourceSelected !== 'function') return true;
    if (isMessengerSource(meta, key)) {
        const threadFbId = meta?.apiId || meta?.channelId || meta?.fbApiId;
        if (threadFbId) {
            return isSourceSelected(threadFbId);
        }
        return isSourceSelected('messenger') || (typeof hasAnyFbSourceSelected === 'function' && hasAnyFbSourceSelected());
    } else {
        return isSourceSelected('web');
    }
}

export function getSourceBadgeName(meta, key) {
    if (isMessengerSource(meta, key)) {
        const fbApiId = meta?.apiId || meta?.channelId || meta?.fbApiId;
        if (fbApiId && typeof getPublicFbChannelName === 'function') {
            const chName = getPublicFbChannelName(fbApiId);
            if (chName && chName !== 'Facebook') return chName;
        }
        return 'Facebook';
    }
    return 'Web';
}
