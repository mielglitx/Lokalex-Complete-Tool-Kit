// src/features/chat/riderChatFeed.js
/**
 * ============================================================================
 * RIDER CHAT FEED SYSTEM - MODULAR ARCHITECTURE FACADE
 * ============================================================================
 * 
 * This file acts as the primary facade/barrel for the Rider Chat Feed subsystem.
 * It re-exports all capabilities and preserves existing import signatures and
 * window bindings across the application without breaking any UI templates.
 * 
 * Submodules:
 * 
 * 1. chatFeedState.js:
 *    - Centralized reactive state for customer thread feed filtering, active
 *      folder filters ('inbox', 'catering', 'stores', 'applicant', 'followup', 'done'),
 *      thread deduplication, multi-source channel checking (Messenger vs Web),
 *      feed search queries, pagination limiters, and cached thread maps.
 *    - Exports: activeRiderChatFilter, getActiveRiderChatFilter, setRiderChatFilter,
 *      getCachedCustomerThreadsMap, getActiveInboxCustomerThreads, toggleRiderChatSearch,
 *      handleRiderChatSearchInput, clearRiderChatSearch, expandRiderChatFeedLimit,
 *      getLoggedInRiderInfo, isMyCustomerThread, getActiveRosterCaterer,
 *      isMessengerSource, isThreadFromSelectedSource, getSourceBadgeName.
 * 
 * 2. chatFeedListener.js:
 *    - Real-time Firebase RTDB `customerChatMeta` synchronization, fast REST
 *      pre-fetch (<150ms), persistent local disk cache, acoustic notification chimes,
 *      native notification bar alerts for new messages, unread badge counters,
 *      full-booking mode automated response triggers, and read/unread status toggles.
 *    - Exports: listenToAllCustomerChatsForRider, processCustomerChatMetaData,
 *      schedulePersistMetaCache, updateInboxUnreadBadge, updateDoneUnreadBadge,
 *      markCustomerChatAsUnread, markCustomerChatAsRead, toggleCustomerChatUnread.
 * 
 * 3. chatFeedRender.js:
 *    - Feed cards list rendering with source/applicant/catering status badges,
 *      gold glowing catering indicators for rider's own customers, swipe-to-reveal
 *      interactive gestures (swipe left / swipe right for Cater, Unread, Done/Inbox),
 *      touch/pointer tracking with vertical scroll locking, and card click dispatchers.
 *    - Exports: renderRiderCustomerChatFeed, snapOpenSwipeCard, resetSwipeCard,
 *      handleThreadPointerDown, handleThreadPointerMove, handleThreadPointerUp,
 *      handleThreadPointerCancel, handleThreadTouchStart, handleThreadTouchMove,
 *      handleThreadTouchEnd, handleThreadCardClick, handleThreadSwipeCater,
 *      handleThreadSwipeUnread, reopenThreadToInbox, handleThreadSwipeDone.
 * ============================================================================
 */

import { updateFullBookingUI } from './fullBookingMode.js';

// Re-export state & helper utilities
export {
    activeRiderChatFilter,
    cachedCustomerThreadsMap,
    currentFeedLimit,
    riderChatSearchQuery,
    getActiveRiderChatFilter,
    setRiderChatFilter,
    getCachedCustomerThreadsMap,
    getActiveInboxCustomerThreads,
    toggleRiderChatSearch,
    handleRiderChatSearchInput,
    clearRiderChatSearch,
    expandRiderChatFeedLimit,
    getThreadDedupKey,
    getLoggedInRiderInfo,
    isMyCustomerThread,
    getActiveRosterCaterer,
    isMessengerSource,
    isThreadFromSelectedSource,
    getSourceBadgeName
} from './chatFeed/chatFeedState.js';

// Re-export listeners & unread badge managers
export {
    listenToAllCustomerChatsForRider,
    processCustomerChatMetaData,
    schedulePersistMetaCache,
    updateAllChatFolderBadges,
    updateInboxUnreadBadge,
    updateDoneUnreadBadge,
    markCustomerChatAsUnread,
    markCustomerChatAsRead,
    toggleCustomerChatUnread,
    forceRefreshLiveChatsFeed
} from './chatFeed/chatFeedListener.js';

// Re-export feed rendering & swipe gestures
export {
    renderRiderCustomerChatFeed,
    snapOpenSwipeCard,
    resetSwipeCard,
    handleThreadPointerDown,
    handleThreadPointerMove,
    handleThreadPointerUp,
    handleThreadPointerCancel,
    handleThreadTouchStart,
    handleThreadTouchMove,
    handleThreadTouchEnd,
    handleThreadCardClick,
    handleThreadSwipeCater,
    handleThreadSwipeUnread,
    reopenThreadToInbox,
    handleThreadSwipeDone
} from './chatFeed/chatFeedRender.js';

import {
    getActiveRiderChatFilter,
    setRiderChatFilter,
    getCachedCustomerThreadsMap,
    getActiveInboxCustomerThreads,
    toggleRiderChatSearch,
    handleRiderChatSearchInput,
    clearRiderChatSearch,
    expandRiderChatFeedLimit,
    isMyCustomerThread,
    isThreadFromSelectedSource,
    getSourceBadgeName
} from './chatFeed/chatFeedState.js';

import {
    listenToAllCustomerChatsForRider,
    updateAllChatFolderBadges,
    updateInboxUnreadBadge,
    updateDoneUnreadBadge,
    markCustomerChatAsUnread,
    markCustomerChatAsRead,
    toggleCustomerChatUnread,
    forceRefreshLiveChatsFeed
} from './chatFeed/chatFeedListener.js';

import {
    renderRiderCustomerChatFeed,
    snapOpenSwipeCard,
    resetSwipeCard,
    handleThreadPointerDown,
    handleThreadPointerMove,
    handleThreadPointerUp,
    handleThreadPointerCancel,
    handleThreadTouchStart,
    handleThreadTouchMove,
    handleThreadTouchEnd,
    handleThreadCardClick,
    handleThreadSwipeCater,
    handleThreadSwipeUnread,
    reopenThreadToInbox,
    handleThreadSwipeDone
} from './chatFeed/chatFeedRender.js';

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

// ============================================================================
// WINDOW BINDINGS & BACKGROUND LISTENERS
// ============================================================================
if (typeof window !== 'undefined') {
    window.getCachedCustomerThreadsMap = getCachedCustomerThreadsMap;
    window.getActiveInboxCustomerThreads = getActiveInboxCustomerThreads;
    window.renderRiderCustomerChatFeed = renderRiderCustomerChatFeed;
    window.isMyCustomerThread = isMyCustomerThread;
    window.markCustomerChatAsUnread = markCustomerChatAsUnread;
    window.markCustomerChatAsRead = markCustomerChatAsRead;
    window.toggleCustomerChatUnread = toggleCustomerChatUnread;
    window.forceRefreshLiveChatsFeed = forceRefreshLiveChatsFeed;
    window.updateAllChatFolderBadges = updateAllChatFolderBadges;
    window.updateInboxUnreadBadge = updateInboxUnreadBadge;
    window.updateDoneUnreadBadge = updateDoneUnreadBadge;
    window.isThreadFromSelectedSource = isThreadFromSelectedSource;
    window.getSourceBadgeName = getSourceBadgeName;

    window.getActiveRiderChatFilter = getActiveRiderChatFilter;
    window.setRiderChatFilter = setRiderChatFilter;
    window.listenToAllCustomerChatsForRider = listenToAllCustomerChatsForRider;
    window.toggleRiderChatSearch = toggleRiderChatSearch;
    window.handleRiderChatSearchInput = handleRiderChatSearchInput;
    window.clearRiderChatSearch = clearRiderChatSearch;
    window.expandRiderChatFeedLimit = expandRiderChatFeedLimit;

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
        if (getActiveRiderChatFilter() !== 'stores') {
            renderRiderCustomerChatFeed();
        }
        if (typeof updateFullBookingUI === 'function') {
            updateFullBookingUI();
        }
    });
}