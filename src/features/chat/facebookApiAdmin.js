// src/features/chat/facebookApiAdmin.js
/**
 * ============================================================================
 * FACEBOOK MESSENGER API & MULTI-CHANNEL CONTROLLER - FACADE
 * ============================================================================
 * 
 * This file acts as the primary facade/barrel for the Facebook Messenger API &
 * Multi-Channel subsystem. It re-exports all capabilities and preserves existing
 * import signatures and window bindings across the application without breaking any UI.
 * 
 * Submodules:
 * 
 * 1. fbChannels.js:
 *    - Centralized state for public FB channels, active rider sources (Web, Page A, Page B),
 *      persistent storage sync, quick-toggle pill chips, channel name/endpoint lookups,
 *      Page Access Token retrieval, and multi-source modal checklist UI.
 *    - Exports: getActiveRiderSources, isAllSourcesSelected, getAllKnownSourceIds,
 *      isSourceSelected, hasAnyFbSourceSelected, getPublicFbChannelName,
 *      getPublicFbSendEndpoint, getFbPageAccessToken, getActiveRiderFbChannel,
 *      selectRiderFbChannel, toggleRiderSource, selectAllRiderSources,
 *      clearAllRiderSources, listenToPublicFbChannels, renderRiderSourcesUI,
 *      renderFbChannelSelector, openRiderChatSourcesModal, closeRiderChatSourcesModal.
 * 
 * 2. fbAdminCrud.js:
 *    - Admin configuration interface: creating, editing, pausing, and deleting
 *      Facebook Messenger APIs with dedicated names and private webhook links.
 *      Includes real-time subscription to `adminSettings/facebookApis`.
 *    - Exports: hasAdminFbPermission, openAdminFbApiModal, closeAdminFbApiModal,
 *      resetAdminFbApiForm, listenToAdminFbApis, toggleAdminFbLinkVisibility,
 *      renderAdminFbApisList, editAdminFbApi, saveAdminFbApi, deleteAdminFbApi,
 *      toggleAdminFbApiStatus.
 * 
 * 3. fbResolvers.js:
 *    - Direct Meta Graph API integration: resolves real customer PSID names and
 *      profile photos without requiring Advanced Access, resolves missing image
 *      attachments from Graph API, syncs Facebook Page folder statuses (Inbox vs Done vs Spam),
 *      and resolves threaded quote replies.
 *    - Exports: getResolvedFbName, resolveFacebookCustomerName,
 *      autoResolvePendingFacebookThreads, syncAllFacebookCustomerNames,
 *      syncFacebookPageFolderStatus, resolveFacebookMessageAttachment,
 *      resolveFacebookMessageReplyTo.
 * ============================================================================
 */

// Re-export Public Channels & Rider Sources
export {
    cachedPublicChannelsMap,
    cachedAdminApisMap,
    activeRiderSources,
    getActiveRiderSources,
    isAllSourcesSelected,
    getAllKnownSourceIds,
    isSourceSelected,
    hasAnyFbSourceSelected,
    getPublicFbChannelName,
    getPublicFbSendEndpoint,
    getFbPageAccessToken,
    getActiveRiderFbChannel,
    selectRiderFbChannel,
    toggleRiderSource,
    selectAllRiderSources,
    clearAllRiderSources,
    listenToPublicFbChannels,
    renderRiderSourcesUI,
    renderFbChannelSelector,
    openRiderChatSourcesModal,
    closeRiderChatSourcesModal,
    isChannelBarLocked,
    toggleRiderChannelBarLock,
    onChannelBarLockedClick,
    syncChannelBarLockUI
} from './fbAdmin/fbChannels.js';

// Re-export Admin CRUD & Configuration Modals
export {
    hasAdminFbPermission,
    openAdminFbApiModal,
    closeAdminFbApiModal,
    resetAdminFbApiForm,
    listenToAdminFbApis,
    toggleAdminFbLinkVisibility,
    renderAdminFbApisList,
    editAdminFbApi,
    saveAdminFbApi,
    deleteAdminFbApi,
    toggleAdminFbApiStatus
} from './fbAdmin/fbAdminCrud.js';

// Re-export Resolvers & Graph API Synchronization
export {
    fbNameResolutionCache,
    getResolvedFbName,
    resolveFacebookCustomerName,
    autoResolvePendingFacebookThreads,
    syncAllFacebookCustomerNames,
    syncFacebookPageFolderStatus,
    resolveFacebookMessageAttachment,
    resolveFacebookMessageReplyTo
} from './fbAdmin/fbResolvers.js';

import {
    getActiveRiderSources,
    isAllSourcesSelected,
    isSourceSelected,
    hasAnyFbSourceSelected,
    getPublicFbChannelName,
    getPublicFbSendEndpoint,
    getFbPageAccessToken,
    getActiveRiderFbChannel,
    selectRiderFbChannel,
    toggleRiderSource,
    selectAllRiderSources,
    clearAllRiderSources,
    listenToPublicFbChannels,
    renderRiderSourcesUI,
    renderFbChannelSelector,
    openRiderChatSourcesModal,
    closeRiderChatSourcesModal,
    isChannelBarLocked,
    toggleRiderChannelBarLock,
    onChannelBarLockedClick,
    syncChannelBarLockUI
} from './fbAdmin/fbChannels.js';

import {
    openAdminFbApiModal,
    closeAdminFbApiModal,
    resetAdminFbApiForm,
    toggleAdminFbLinkVisibility,
    editAdminFbApi,
    saveAdminFbApi,
    deleteAdminFbApi,
    toggleAdminFbApiStatus
} from './fbAdmin/fbAdminCrud.js';

import {
    getResolvedFbName,
    resolveFacebookCustomerName,
    autoResolvePendingFacebookThreads,
    syncAllFacebookCustomerNames,
    syncFacebookPageFolderStatus,
    resolveFacebookMessageAttachment,
    resolveFacebookMessageReplyTo
} from './fbAdmin/fbResolvers.js';

// ============================================================================
// WINDOW BINDINGS
// ============================================================================
if (typeof window !== 'undefined') {
    window.resolveFacebookMessageAttachment = resolveFacebookMessageAttachment;
    window.resolveFacebookMessageReplyTo = resolveFacebookMessageReplyTo;
    window.openAdminFbApiModal = openAdminFbApiModal;
    window.closeAdminFbApiModal = closeAdminFbApiModal;
    window.saveAdminFbApi = saveAdminFbApi;
    window.resetAdminFbApiForm = resetAdminFbApiForm;
    window.editAdminFbApi = editAdminFbApi;
    window.deleteAdminFbApi = deleteAdminFbApi;
    window.toggleAdminFbApiStatus = toggleAdminFbApiStatus;
    window.toggleAdminFbLinkVisibility = toggleAdminFbLinkVisibility;
    window.syncAllFacebookCustomerNames = syncAllFacebookCustomerNames;
    window.syncFacebookPageFolderStatus = syncFacebookPageFolderStatus;
    window.resolveFacebookCustomerName = resolveFacebookCustomerName;
    window.autoResolvePendingFacebookThreads = autoResolvePendingFacebookThreads;
    window.getResolvedFbName = getResolvedFbName;
    
    // Multi-source live chat selectors
    window.openRiderChatSourcesModal = openRiderChatSourcesModal;
    window.closeRiderChatSourcesModal = closeRiderChatSourcesModal;
    window.toggleRiderSource = toggleRiderSource;
    window.selectAllRiderSources = selectAllRiderSources;
    window.clearAllRiderSources = clearAllRiderSources;
    window.getActiveRiderSources = getActiveRiderSources;
    window.isSourceSelected = isSourceSelected;
    window.isAllSourcesSelected = isAllSourcesSelected;
    window.hasAnyFbSourceSelected = hasAnyFbSourceSelected;
    window.renderRiderSourcesUI = renderRiderSourcesUI;
    window.isChannelBarLocked = isChannelBarLocked;
    window.toggleRiderChannelBarLock = toggleRiderChannelBarLock;
    window.onChannelBarLockedClick = onChannelBarLockedClick;
    window.syncChannelBarLockUI = syncChannelBarLockUI;
    
    // Legacy single channel compatibility
    window.selectRiderFbChannel = selectRiderFbChannel;
    window.renderFbChannelSelector = renderFbChannelSelector;
    window.getActiveRiderFbChannel = getActiveRiderFbChannel;
    window.getPublicFbChannelName = getPublicFbChannelName;
    window.getPublicFbSendEndpoint = getPublicFbSendEndpoint;
    window.getFbPageAccessToken = getFbPageAccessToken;
    window.listenToPublicFbChannels = listenToPublicFbChannels;
}
