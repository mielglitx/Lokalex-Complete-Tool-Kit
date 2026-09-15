// src/features/chat/customerChat/custChatState.js

export const MAPS_API_KEY = "AIzaSyBVAwn0UnyHJ926oHeK0k789ncADMzmX80";
export const CUST_CHAT_BATCH_SIZE = 25;

export const custChatState = {
    oldestCustMsgTimestamp: null,
    hasMoreCustMsgs: true,
    isLoadingCustHistory: false,
    loadedCustMsgsMap: new Map(),
    custChatListener: null,
    activeCustReplyTarget: null,
    longPressTimer: null,
    startX: 0,
    startY: 0
};

export const tapTrackerMap = new Map();

export function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}