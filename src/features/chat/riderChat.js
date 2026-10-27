// src/features/chat/riderChat.js
/**
 * ============================================================================
 * RIDER CHAT SYSTEM - MODULAR ARCHITECTURE FACADE
 * ============================================================================
 * 
 * This file acts as the primary facade/barrel for the Rider Chat subsystem.
 * It re-exports all capabilities and preserves existing import signatures and
 * window bindings across the application without breaking any UI templates.
 * 
 * Submodules:
 * 
 * 1. chatState.js:
 *    - Centralized reactive state for customer chat threads, active IDs, listeners,
 *      message caches (RAM + IndexedDB), pagination trackers, and input drafts.
 *    - Exports: activeRiderChatCustId, loadedRiderMsgsMap, saveCurrentThreadDraft,
 *      restoreThreadDraft, handleRiderChatInputDraft, getActiveCustData, etc.
 * 
 * 2. chatModalUi.js:
 *    - Full lifecycle for the Customer Chat Modal UI, customer header details,
 *      quick store orders binding, active milestone status bar, catering lock
 *      permission evaluation, switchers between active catered customers,
 *      photo viewer lightbox, and customer renaming.
 *    - Exports: openRiderChatModal, openRiderCustomerChatModal, closeRiderChatModal,
 *      closeRiderCustomerChatModal, viewCurrentCustomerPhoto, syncApplicantUI,
 *      renderRiderCateredSwitcher, switchCateredCustomerChat, promptRenameCustomerChat.
 * 
 * 3. chatListeners.js:
 *    - Real-time Firebase RTDB synchronization for thread messages, pagination with
 *      older message loading, instant Facebook attachment and reply resolution,
 *      instant message bridge between feed and thread, quoted replies, and reactions.
 *    - Exports: listenToRiderChatMessages, reloadRiderChatFromFirebase,
 *      syncIncomingMessageFromMeta, loadOlderRiderMessages, setRiderReply,
 *      cancelRiderReply, toggleRiderMessageReaction.
 * 
 * 4. chatSending.js:
 *    - Outbound message dispatching (text, camera/gallery photos, map coordinates,
 *      documents), multi-channel delivery (Firebase RTDB + direct Meta Graph API +
 *      Cloudflare Worker webhook bridge), delivery status updates, and retries.
 *    - Exports: sendRiderChatMessage, sendRiderToCustomerChat,
 *      sendDirectMenuPhotoToCustomer, forwardRiderReplyToMessenger,
 *      forwardRiderReactionToMessenger, retryRiderChatMessage,
 *      sendChatLocationPin, sendRiderLocation.
 * ============================================================================
 */

import { clearNativeNotification } from '../../ui/notifications.js';
import { 
    setRiderChatFilter, 
    listenToAllCustomerChatsForRider, 
    getActiveRiderChatFilter
} from './riderChatFeed.js';
import { listenToGlobalStoreChats } from './riderStoreChat.js';

// Re-export state management
export {
    activeRiderChatCustId,
    activeCustData,
    loadedRiderMsgsMap,
    riderChatMemoryCache,
    threadDraftsMap,
    saveCurrentThreadDraft,
    restoreThreadDraft,
    handleRiderChatInputDraft,
    getActiveRiderChatCustId,
    getCurrentRiderChatMeta,
    getLoadedRiderMsgsMap,
    getActiveCustData,
    setActiveCustData
} from './chatEngine/chatState.js';

// Re-export Modal UI and Catering Management
export {
    openRiderChatModal,
    viewCurrentCustomerPhoto,
    openRiderCustomerChatModal,
    syncApplicantUI,
    renderRiderCateredSwitcher,
    switchCateredCustomerChat,
    closeRiderChatModal,
    closeRiderCustomerChatModal,
    promptRenameCustomerChat
} from './chatEngine/chatModalUi.js';

// Re-export Real-time Message Listeners and Reactions
export {
    reloadRiderChatFromFirebase,
    listenToRiderChatMessages,
    syncIncomingMessageFromMeta,
    loadOlderRiderMessages,
    setRiderReply,
    cancelRiderReply,
    toggleRiderMessageReaction
} from './chatEngine/chatListeners.js';

// Re-export Message Dispatching and Messenger Bridge
export {
    forwardRiderReactionToMessenger,
    sendRiderChatMessage,
    sendRiderToCustomerChat,
    sendDirectMenuPhotoToCustomer,
    forwardRiderReplyToMessenger,
    retryRiderChatMessage,
    sendChatLocationPin,
    sendRiderLocation
} from './chatEngine/chatSending.js';

// Re-export Video Playback & Video Attachment Features
export {
    openVideoViewerModal,
    closeVideoViewerModal,
    cycleVideoPlaybackSpeed,
    downloadCurrentViewerVideo
} from './videoViewer.js';

export {
    promptVideoAttachmentSource,
    closeVideoPickerModal,
    triggerVideoInput,
    handleChatVideoSelected,
    openVideoPreviewModal,
    closeVideoPreviewModal,
    confirmSendChatVideo
} from './videoSender.js';

// Re-export Customizable Automated Messages
export * from './autoMessageManager.js';

import {
    getActiveRiderChatCustId,
    getCurrentRiderChatMeta,
    getLoadedRiderMsgsMap,
    getActiveCustData,
    setActiveCustData,
    saveCurrentThreadDraft,
    restoreThreadDraft,
    handleRiderChatInputDraft
} from './chatEngine/chatState.js';

import {
    openRiderChatModal,
    viewCurrentCustomerPhoto,
    openRiderCustomerChatModal,
    syncApplicantUI,
    renderRiderCateredSwitcher,
    switchCateredCustomerChat,
    closeRiderChatModal,
    closeRiderCustomerChatModal,
    promptRenameCustomerChat
} from './chatEngine/chatModalUi.js';

import {
    reloadRiderChatFromFirebase,
    listenToRiderChatMessages,
    syncIncomingMessageFromMeta,
    loadOlderRiderMessages,
    setRiderReply,
    cancelRiderReply,
    toggleRiderMessageReaction
} from './chatEngine/chatListeners.js';

import {
    forwardRiderReactionToMessenger,
    sendRiderChatMessage,
    sendRiderToCustomerChat,
    sendDirectMenuPhotoToCustomer,
    forwardRiderReplyToMessenger,
    retryRiderChatMessage,
    sendChatLocationPin,
    sendRiderLocation
} from './chatEngine/chatSending.js';

import {
    startChatPresence,
    stopChatPresence,
    handleChatTyping,
    clearMyTypingStatus,
    startChatTypingListener,
    stopChatTypingListener,
    markChatThreadSeen,
    startThreadSeenListener,
    stopThreadSeenListener,
    initGlobalChatTypingAndPresenceFeedListener
} from './chatEngine/chatPresence.js';

export * from './chatEngine/chatPresence.js';

// ============================================================================
// WINDOW BINDINGS & BACKGROUND LISTENERS
// ============================================================================
if (typeof window !== 'undefined') {
    window.getActiveRiderChatCustId = getActiveRiderChatCustId;
    window.getCurrentRiderChatMeta = getCurrentRiderChatMeta;
    window.getLoadedRiderMsgsMap = getLoadedRiderMsgsMap;
    window.getActiveCustData = getActiveCustData;
    window.setActiveCustData = setActiveCustData;

    window.openRiderChatModal = openRiderChatModal;
    window.openRiderCustomerChatModal = openRiderCustomerChatModal;
    window.viewCurrentCustomerPhoto = viewCurrentCustomerPhoto;
    window.closeRiderChatModal = closeRiderChatModal;
    window.closeRiderCustomerChatModal = closeRiderCustomerChatModal;
    window.promptRenameCustomerChat = promptRenameCustomerChat;
    window.sendRiderChatMessage = sendRiderChatMessage;
    window.sendRiderToCustomerChat = sendRiderToCustomerChat;
    window.sendChatLocationPin = sendChatLocationPin;
    window.sendRiderLocation = sendRiderLocation;
    window.setRiderReply = setRiderReply;
    window.cancelRiderReply = cancelRiderReply;
    window.toggleRiderMessageReaction = toggleRiderMessageReaction;
    window.forwardRiderReplyToMessenger = forwardRiderReplyToMessenger;
    window.sendDirectMenuPhotoToCustomer = sendDirectMenuPhotoToCustomer;
    window.retryRiderChatMessage = retryRiderChatMessage;

    window.getActiveRiderChatFilter = getActiveRiderChatFilter;
    window.setRiderChatFilter = setRiderChatFilter;
    window.listenToAllCustomerChatsForRider = listenToAllCustomerChatsForRider;
    window.listenToRiderChatMessages = listenToRiderChatMessages;
    window.reloadRiderChatFromFirebase = reloadRiderChatFromFirebase;
    window.syncIncomingMessageFromMeta = syncIncomingMessageFromMeta;
    window.loadOlderRiderMessages = loadOlderRiderMessages;
    window.triggerLoadOlderRiderMessages = () => loadOlderRiderMessages(null, getActiveRiderChatCustId());
    window.syncApplicantUI = syncApplicantUI;
    window.saveCurrentThreadDraft = saveCurrentThreadDraft;
    window.restoreThreadDraft = restoreThreadDraft;
    window.handleRiderChatInputDraft = handleRiderChatInputDraft;
    window.renderRiderCateredSwitcher = renderRiderCateredSwitcher;
    window.switchCateredCustomerChat = switchCateredCustomerChat;
    window.handleChatTyping = handleChatTyping;
    window.startChatPresence = startChatPresence;
    window.stopChatPresence = stopChatPresence;
    window.clearMyTypingStatus = clearMyTypingStatus;
    window.startChatTypingListener = startChatTypingListener;
    window.stopChatTypingListener = stopChatTypingListener;
    window.markChatThreadSeen = markChatThreadSeen;
    window.startThreadSeenListener = startThreadSeenListener;
    window.stopThreadSeenListener = stopThreadSeenListener;

    listenToGlobalStoreChats();
    initGlobalChatTypingAndPresenceFeedListener();

    window.addEventListener('rosterUpdated', () => {
        if (getActiveRiderChatCustId()) renderRiderCateredSwitcher();
    });
    window.addEventListener('customerChatsUpdated', () => {
        if (getActiveRiderChatCustId()) renderRiderCateredSwitcher();
    });

    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            const currentCustId = getActiveRiderChatCustId();
            if (!document.hidden && currentCustId) {
                clearNativeNotification('chat_' + currentCustId);
            }
        });

        // Track user typing in real-time for active thread draft
        document.addEventListener('input', (e) => {
            if (e.target && (e.target.id === 'rider-chat-input' || e.target.id === 'rider-cust-chat-input')) {
                const currentCustId = getActiveRiderChatCustId();
                if (currentCustId) {
                    handleRiderChatInputDraft(e.target.value);
                }
            }
        });
    }
}