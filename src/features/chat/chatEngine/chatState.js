// src/features/chat/chatEngine/chatState.js

export let activeRiderChatCustId = null;
export let activeRiderChatListener = null;
export let activeRiderChatChildListener = null;
export let activeRiderChatChangedListener = null;
export let activeRiderChatMetaListener = null;
export let currentRiderChatMeta = null;
export let activeCustData = null;
export let openSessionTime = 0;

export let activeRiderReplyTarget = null;
export const RIDER_CHAT_BATCH_SIZE = 10; // Initial partial load: only 10 messages for lightning fast loading
export const RIDER_CHAT_OLDER_BATCH_SIZE = 10; // On-demand chunk size when scrolling up
export let oldestRiderMsgTimestamp = null;
export let oldestRiderMsgKey = null;
export let hasMoreRiderMsgs = true;
export let isLoadingRiderHistory = false;
export let isInitialScrollDone = false;
export let lastPaginationRequestTime = 0;
export const loadedRiderMsgsMap = new Map();
export const riderChatMemoryCache = new Map(); // Fast RAM cache: custId -> Array of messages
export const threadDraftsMap = new Map(); // Thread-specific input drafts: custId -> text
export let currentActiveRiderChatCustAvatar = "";

export function setActiveRiderChatCustId(id) {
    activeRiderChatCustId = id;
}

export function setActiveRiderChatListener(l) {
    activeRiderChatListener = l;
}

export function setActiveRiderChatChildListener(l) {
    activeRiderChatChildListener = l;
}

export function setActiveRiderChatChangedListener(l) {
    activeRiderChatChangedListener = l;
}

export function setActiveRiderChatMetaListener(l) {
    activeRiderChatMetaListener = l;
}

export function setCurrentRiderChatMeta(meta) {
    currentRiderChatMeta = meta;
}

export function setOpenSessionTime(t) {
    openSessionTime = t;
}

export function setActiveRiderReplyTarget(target) {
    activeRiderReplyTarget = target;
}

export function setOldestRiderMsgTimestamp(ts) {
    oldestRiderMsgTimestamp = ts;
}

export function setOldestRiderMsgKey(key) {
    oldestRiderMsgKey = key;
}

export function setHasMoreRiderMsgs(val) {
    hasMoreRiderMsgs = val;
}

export function setIsLoadingRiderHistory(val) {
    isLoadingRiderHistory = val;
}

export function setIsInitialScrollDone(val) {
    isInitialScrollDone = val;
}

export function setLastPaginationRequestTime(val) {
    lastPaginationRequestTime = val;
}

export function setCurrentActiveRiderChatCustAvatar(avatar) {
    currentActiveRiderChatCustAvatar = avatar;
}

export function saveCurrentThreadDraft(targetCustId = null) {
    const custId = targetCustId || activeRiderChatCustId;
    if (!custId) return;
    const input = document.getElementById('rider-chat-input') || document.getElementById('rider-cust-chat-input');
    if (input) {
        const val = input.value;
        if (typeof val === 'string' && val.trim().length > 0) {
            threadDraftsMap.set(custId, val);
        } else {
            threadDraftsMap.delete(custId);
        }
    }
}

export function restoreThreadDraft(targetCustId) {
    const input = document.getElementById('rider-chat-input') || document.getElementById('rider-cust-chat-input');
    if (input) {
        const draft = (targetCustId && threadDraftsMap.get(targetCustId)) ? threadDraftsMap.get(targetCustId) : "";
        input.value = draft;
        input.style.height = 'auto';
        if (draft) {
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        }
    }
}

export function handleRiderChatInputDraft(val) {
    if (!activeRiderChatCustId) return;
    if (typeof val === 'string' && val.trim().length > 0) {
        threadDraftsMap.set(activeRiderChatCustId, val);
    } else {
        threadDraftsMap.delete(activeRiderChatCustId);
    }
}

export function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

export function cleanFirebasePathKey(key) {
    return String(key || '').replace(/^#+/, '').replace(/[.#$\[\]\/]/g, '_').trim();
}

export function getActiveRiderChatCustId() {
    return activeRiderChatCustId;
}

export function getCurrentRiderChatMeta() { 
    if (activeRiderChatCustId && typeof window.getCachedCustomerThreadsMap === 'function') {
        const map = window.getCachedCustomerThreadsMap();
        const thread = map ? (map.get(activeRiderChatCustId) || map.get(`fb_${activeRiderChatCustId}`) || (activeRiderChatCustId.startsWith('fb_') ? map.get(activeRiderChatCustId.replace(/^fb_/, '')) : null)) : null;
        if (thread) {
            return { ...thread, ...(currentRiderChatMeta || {}) };
        }
    }
    return currentRiderChatMeta || {}; 
}

export function getLoadedRiderMsgsMap() {
    return loadedRiderMsgsMap;
}

export function getActiveCustData() {
    return activeCustData;
}

export function setActiveCustData(data) {
    activeCustData = data;
}

