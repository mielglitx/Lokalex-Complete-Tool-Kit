// src/features/chat/storeChat/storeChatState.js

export function cleanFirebasePathKey(key) {
    return String(key || '').replace(/^#+/, '').replace(/[.#$\[\]\/]/g, '_').trim();
}

export function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

export const storeChatState = {
    activeRiderStoreChatOrderId: null,
    activeRiderStoreChatStoreId: null,
    activeRiderStoreChatStoreName: null,
    activeRiderStoreChatListener: null,
    globalStoreChatsListener: null,
    globalStoresListener: null,
    cachedStoreChatsData: {},
    allStoresListCache: [],
    activeRiderStoreReplyTarget: null,
    storeSearchQuery: "",
    activeStoreToRiderOrderId: null,
    activeStoreToRiderChatListener: null,
    longPressTimer: null,
    startX: 0,
    startY: 0
};

export const tapTrackerMap = new Map();

// Local cache hydration
try {
    const rawLocalStores = localStorage.getItem('lokalex_cached_stores_v1');
    if (rawLocalStores) {
        const parsed = JSON.parse(rawLocalStores);
        if (parsed && typeof parsed === 'object') {
            storeChatState.allStoresListCache = Object.entries(parsed).map(([sId, sData]) => ({
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