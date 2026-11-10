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

let searchInputDebounceTimer = null;

export function handleRiderChatSearchInput(val) {
    riderChatSearchQuery = (val || '').trim();
    currentFeedLimit = 50;
    if (searchInputDebounceTimer) clearTimeout(searchInputDebounceTimer);
    searchInputDebounceTimer = setTimeout(() => {
        searchInputDebounceTimer = null;
        if (typeof window.renderRiderCustomerChatFeed === 'function') {
            window.renderRiderCustomerChatFeed();
        }
    }, 140);
}

export function clearRiderChatSearch() {
    if (searchInputDebounceTimer) {
        clearTimeout(searchInputDebounceTimer);
        searchInputDebounceTimer = null;
    }
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

export function getThreadDedupKey(key, meta = {}) {
    // 1. Facebook Messenger threads represent unique 1-on-1 conversations by Meta PSID.
    // Normalize any numeric PSIDs or fb_ / messenger_ keys to the canonical 'fb_${psid}'
    if (typeof key === 'string') {
        const cleanKey = key.trim();
        if (cleanKey.startsWith('fb_') || cleanKey.startsWith('messenger_')) {
            const rawPsid = cleanKey.replace(/^(fb_|messenger_)+/, '');
            return `fb_${rawPsid}`;
        }
        if (/^\d{12,}$/.test(cleanKey)) {
            return `fb_${cleanKey}`;
        }
    }
    if (meta && (meta.channel === 'messenger' || meta.apiId || meta.fbApiId)) {
        const rawPsid = String(meta.psid || meta.fbPsid || key || '').replace(/^(fb_|messenger_)+/, '').trim();
        if (rawPsid && /^\d+$/.test(rawPsid)) {
            return `fb_${rawPsid}`;
        }
    }

    // 2. For non-FB web threads, dedup by verified phone number if available
    const rawPhone = meta.phoneNumber || meta.phone || meta.customerPhone || 
                     (typeof key === 'string' && (key.startsWith('+63') || key.startsWith('09') || key.startsWith('63')) ? key : '');
    const cleanPhone = String(rawPhone).replace(/\D/g, '');
    if (cleanPhone.length >= 10) {
        return `phone_${cleanPhone.slice(-10)}`;
    }

    // 3. Fallback: normalize key, stripping extraneous id_ prefixes
    const cleanId = String(key || '').trim().replace(/^id_/, '');
    return `id_${cleanId}`;
}

export function getLoggedInRiderInfo() {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();
    return { myId, myName };
}

export function getThreadCustomerCandidates(tOrMeta = {}, fallbackName = '', custId = '') {
    const candidates = new Set();
    const add = (val) => {
        if (!val || typeof val !== 'string') return;
        const clean = val.trim().toLowerCase();
        if (clean && clean !== 'customer' && clean !== 'customer name' && clean !== 'null' && clean !== 'undefined' && !clean.startsWith('fb customer (')) {
            candidates.add(clean);
        }
    };

    add(fallbackName);
    add(tOrMeta?.customerName);
    add(tOrMeta?.name);
    add(tOrMeta?.originalCustomerName);
    add(tOrMeta?.facebookName);
    add(tOrMeta?.linkedDirectoryName);
    add(tOrMeta?.linkedDirectoryKey);
    const id = custId || tOrMeta?.custId || tOrMeta?.id || tOrMeta?.key || '';
    if (id) {
        if (id.startsWith('cust_')) {
            add(id.replace(/^cust_/, '').replace(/_/g, ' '));
        } else if (id.startsWith('fb_') || id.startsWith('messenger_') || /^\d{10,}$/.test(id)) {
            if (typeof window !== 'undefined' && typeof window.getResolvedFbName === 'function') {
                const fb = window.getResolvedFbName(id);
                if (fb && fb.name) add(fb.name);
            }
        }
    }
    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
        const thisId = custId || tOrMeta?.custId || tOrMeta?.id || tOrMeta?.key || '';
        if (thisId && window.activeRiderChatCustId && String(thisId) === String(window.activeRiderChatCustId)) {
            const activeChatName = document.getElementById('rider-chat-cust-name')?.innerText;
            if (activeChatName) add(activeChatName);
        }
    }
    return candidates;
}

export function isMyCustomerThread(t, cachedAuth = null) {
    if (!t) return false;
    const { myId, myName } = cachedAuth || getLoggedInRiderInfo();
    if (!myId && !myName) return false;

    // 1. Live roster active catering takes ABSOLUTE precedence!
    // If a rider is actively catering this customer on the live roster, that assignment is authoritative.
    const activeCaterer = getActiveRosterCaterer(t.customerName, t.custId, t);
    if (activeCaterer) {
        const aId = (activeCaterer.telegramId || activeCaterer.id || "").toString().trim();
        const aName = (activeCaterer.riderName || activeCaterer.name || "").toString().trim().toLowerCase();
        if (myId && aId && myId === aId) return true;
        if (myName && aName && (myName === aName || isRiderMatch(myName, aName, myId, aId))) return true;
        // This customer is actively catered by ANOTHER rider on the roster (e.g. force-assigned to Allan/Marlon).
        // It is strictly THEIR customer, NEVER mine!
        return false;
    }

    const rId = (t.cateredByRiderId || "").toString().trim();
    const rName = (t.cateredByRiderName || "").toString().trim().toLowerCase();
    const rCateredBy = (t.cateredBy || "").toString().trim().toLowerCase();

    // If metadata explicitly indicates another rider is catering, it does NOT belong to me
    const isOtherRider = (rId && myId && rId !== myId) || 
                         (rName && myName && rName !== myName && !isRiderMatch(myName, rName, myId, rId));
    if (isOtherRider) {
        return false;
    }

    if (myId && rId && myId === rId) return true;
    if (myName && rName && (myName === rName || isRiderMatch(myName, rName, myId, rId))) return true;
    if (myName && rCateredBy && (myName === rCateredBy || isRiderMatch(myName, rCateredBy, myId, rId))) return true;

    // Check if the current logged-in rider's active record in the roster has this customer
    const myRecord = (globalState.rosterMembers || []).find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").trim().toLowerCase();
        if (myId && mId && mId === myId) return true;
        if (myName && mName && (mName === myName || isRiderMatch(myName, mName, myId, mId))) return true;
        return false;
    });
    if (myRecord && myRecord.status === 'Catering') {
        const candidateNames = getThreadCustomerCandidates(t, t.customerName, t.custId);
        if (candidateNames.size === 0) return false;

        if (myRecord.customerName) {
            const custs = myRecord.customerName.split(/\s*,\s*/).map(c => c.trim().toLowerCase()).filter(c => c !== 'customer' && c !== 'customer name');
            for (const c of custs) {
                for (const candidate of candidateNames) {
                    if (c === candidate || isCustomerMatch(c, candidate)) return true;
                }
            }
        }
        if (myRecord.forcedCaters && typeof myRecord.forcedCaters === 'object') {
            for (const [fKey, fVal] of Object.entries(myRecord.forcedCaters)) {
                if (fKey === t.custId && fKey !== 'customer') return true;
                const fName = (fVal && typeof fVal === 'object' && fVal.customerName) ? fVal.customerName : fKey;
                const cleanFName = (fName || '').toLowerCase().trim();
                if (cleanFName !== 'customer' && cleanFName !== 'customer name') {
                    for (const candidate of candidateNames) {
                        if (cleanFName === candidate || isCustomerMatch(fName, candidate)) return true;
                    }
                }
            }
        }
    }

    return false;
}

export function getActiveRosterCaterer(custName, custId, meta = {}) {
    // Only respect recent explicit completion / cancellation (within 15s) to allow instant roster-driven completion.
    // Old completed/done flags from past orders must NEVER prevent a new active catering assignment!
    const completedAt = Number(meta?.completedAt) || 0;
    const isRecentCompletion = completedAt > 0 && (Date.now() - completedAt < 15000);
    if (isRecentCompletion && (meta?.folder === 'done' || meta?.status === 'completed' || meta?.status === 'cancelled')) {
        return null;
    }

    const liveRoster = globalState.rosterMembers || [];
    if (!liveRoster || liveRoster.length === 0) return null;

    const candidateNames = getThreadCustomerCandidates(meta, custName, custId);

    // 1. Direct match by candidate customer names or forcedCaters in live roster
    if (candidateNames.size > 0) {
        const matched = liveRoster.find(m => {
            if (m.status !== 'Catering') return false;

            // Check comma-separated customerName field
            if (m.customerName) {
                const custs = m.customerName.split(/\s*,\s*/).map(c => c.trim().toLowerCase()).filter(c => c && c !== 'customer' && c !== 'customer name');
                for (const c of custs) {
                    for (const candidate of candidateNames) {
                        if (c === candidate || isCustomerMatch(c, candidate)) return true;
                    }
                }
            }

            // Check forcedCaters map
            if (m.forcedCaters && typeof m.forcedCaters === 'object') {
                for (const [fKey, fVal] of Object.entries(m.forcedCaters)) {
                    if (custId && fKey === custId && fKey !== 'customer') return true;
                    const fName = (fVal && typeof fVal === 'object' && fVal.customerName) ? fVal.customerName : fKey;
                    const cleanFName = (fName || '').toLowerCase().trim();
                    if (cleanFName && cleanFName !== 'customer' && cleanFName !== 'customer name') {
                        for (const candidate of candidateNames) {
                            if (cleanFName === candidate || isCustomerMatch(fName, candidate)) return true;
                        }
                    }
                }
            }

            return false;
        });

        if (matched) return matched;
    }

    // 2. Fallback: If thread has active catering fields (cateredByRiderId or cateredByRiderName)
    // AND that assigned rider is currently 'Catering' on the roster
    const threadFolder = (meta?.folder || '').toLowerCase();
    const isExplicitCateringFolder = threadFolder === 'catering';
    const isInboxOrDone = !isExplicitCateringFolder && (threadFolder === 'inbox' || (isRecentCompletion && (threadFolder === 'done' || meta?.status === 'completed' || meta?.status === 'done')));

    if ((isExplicitCateringFolder || meta?.cateredByRiderId || meta?.cateredByRiderName) && !isInboxOrDone) {
        const metaRiderId = (meta?.cateredByRiderId || "").toString().trim();
        const metaRiderName = (meta?.cateredByRiderName || meta?.cateredBy || "").toString().trim().toLowerCase();

        if (metaRiderId || metaRiderName) {
            const member = liveRoster.find(m => {
                if (m.status !== 'Catering') return false;
                const mId = (m.telegramId || m.id || "").toString().trim();
                const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
                const riderMatches = (metaRiderId && mId && metaRiderId === mId) ||
                                     (metaRiderName && mName && (metaRiderName === mName || isRiderMatch(mName, metaRiderName)));
                if (!riderMatches) return false;

                // Guard: Verify rider is actually catering this customer or has them in currentCustomerId/forcedCaters
                if (custId && m.currentCustomerId === custId) return true;
                if (candidateNames.size > 0 && m.customerName) {
                    const custs = m.customerName.split(/\s*,\s*/).map(c => c.trim().toLowerCase());
                    for (const c of custs) {
                        for (const cand of candidateNames) {
                            if (c === cand || isCustomerMatch(c, cand)) return true;
                        }
                    }
                }
                return true;
            });
            if (member) return member;
        }
    }

    return null;
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

