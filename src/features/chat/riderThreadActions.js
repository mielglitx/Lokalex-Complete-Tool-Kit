/**
 * ============================================================================
 * RIDER THREAD ACTIONS FACADE / BARREL
 * ============================================================================
 * This module serves as the centralized entry point and facade for rider thread
 * actions, customer linking, quick replies, delivery milestones, and thread lifecycle.
 *
 * SUB-MODULE ARCHITECTURE & RESPONSIBILITIES:
 * ----------------------------------------------------------------------------
 * 1. threadUtils.js:
 *    - cleanFirebasePathKey(): Sanitizes RTDB paths and prevents key injection.
 *    - sanitizeForFirebase(): Strips undefined values for RTDB compliance.
 *    - formatMapPinUrl(): Formats links and GPS coordinates into Google Maps URLs.
 *    - extractCleanSearchName(): Cleans Facebook customer name placeholders.
 *
 * 2. threadCustomerDetails.js:
 *    - Customer details modal view and population.
 *    - Directory linking/unlinking with strict auto-match verification.
 *    - Real-time directory customer search and phone copying.
 *    - Direct registration of unlisted customers to directory from active chat.
 *    - Customer avatar photo upload and RTDB synchronization.
 *
 * 3. threadQuickReplies.js:
 *    - Real-time RTDB listener for shared rider quick replies.
 *    - Quick replies drawer rendering and interactive chips.
 *    - Drag-and-drop & button-based reordering with local cache synchronization.
 *    - Quick reply template creation, editing, and deletion modals.
 *    - Quick reply dispatch to active chat input or immediate send.
 *
 * 4. threadMilestonesPod.js:
 *    - Proof of Delivery (POD) photo capture modal and camera image processing.
 *    - Image compression and upload to cloud storage.
 *    - Order milestone tracking checkpoints (preparing -> picked up -> arrived -> delivered).
 *    - Visual milestone progress indicator highlighting in chat header.
 *
 * 5. threadLifecycle.js:
 *    - Thread completion safeguard modal and receipt verification gate.
 *    - Thread status toggles: Done, Undone (Inbox), Follow-Up (Adv Orders), Applicant.
 *    - Thread cancellation and single-customer catering voiding.
 *    - Catering assignment and automatic cart navigation for active customer.
 *    - Mass inbox cleanup action for admins and team leaders.
 * ============================================================================
 */

// 1. Re-export all sub-modules
export * from './threadActions/threadUtils.js';
export * from './threadActions/threadCustomerDetails.js';
export * from './threadActions/threadQuickReplies.js';
export * from './threadActions/threadMilestonesPod.js';
export * from './threadActions/threadLifecycle.js';

// 2. Import functions for window attachment to support inline HTML onclick handlers
import {
    getDirectoryCustomersList,
    renderCustomerDetailsUI,
    showCustomerDetails,
    confirmDirectoryAutoMatch,
    toggleDirectoryLinkPicker,
    handleDirectorySearchInput,
    clearDirectorySearch,
    renderDirectorySearchResults,
    selectDirectoryCustomerIndex,
    selectAndLinkDirectoryCustomer,
    unlinkCurrentChatDirectory,
    linkChatToDirectoryRecord,
    copyCustomerPhone,
    openNewDirectoryCustomerFromChat,
    closeCustomerDetailsModal,
    handleCustomerPhotoUpload,
    toggleAddLocationForm,
    captureCurrentGpsForNewLocation,
    saveNewCustomerLocation,
    setCustomerPrimaryLocation,
    deleteCustomerLocation
} from './threadActions/threadCustomerDetails.js';

import {
    initSharedQuickRepliesListener,
    renderSharedQuickReplies,
    moveQuickReplyToTop,
    moveQuickReplyOrder,
    handleQuickReplyDragStart,
    handleQuickReplyDragOver,
    handleQuickReplyDrop,
    toggleQuickReplies,
    handleQuickReplyChipClick,
    openPermanentEditFromActionModal,
    confirmSendQuickReply,
    openEditQuickReplyModal,
    backToQuickReplyChoiceView,
    sendEditedQuickReply,
    closeQuickReplyActionModal,
    sendQuickReply,
    promptAddQuickReply,
    promptEditQuickReply,
    closeAddQuickReplyModal,
    submitSaveQuickReply,
    deleteQuickReply
} from './threadActions/threadQuickReplies.js';

import {
    openPodModal,
    closePodModal,
    handlePodImageSelected,
    submitProofOfDelivery,
    setOrderMilestone,
    updateOrderMilestone,
    highlightActiveMilestoneUI
} from './threadActions/threadMilestonesPod.js';

import {
    markThreadUndone,
    openConfirmDoneModal,
    closeConfirmDoneModal,
    confirmAndExecuteDone,
    markThreadDone,
    executeThreadDone,
    toggleThreadApplicant,
    markThreadFollowUp,
    cancelCustomerThread,
    caterCurrentChatCustomer,
    clearAllInboxThreads,
    goToCustomerCartFromChat,
    undoCustomerThread,
    followUpCustomerOrder,
    completeCatering,
    cancelCatering
} from './threadActions/threadLifecycle.js';

// 3. Attach global window handlers for template bindings
if (typeof window !== 'undefined') {
    // Customer Details & Directory
    window.handleCustomerPhotoUpload = handleCustomerPhotoUpload;
    window.goToCustomerCartFromChat = goToCustomerCartFromChat;
    window.showCustomerDetails = showCustomerDetails;
    window.closeCustomerDetailsModal = closeCustomerDetailsModal;
    window.confirmDirectoryAutoMatch = confirmDirectoryAutoMatch;
    window.toggleDirectoryLinkPicker = toggleDirectoryLinkPicker;
    window.handleDirectorySearchInput = handleDirectorySearchInput;
    window.clearDirectorySearch = clearDirectorySearch;
    window.selectAndLinkDirectoryCustomer = selectAndLinkDirectoryCustomer;
    window.selectDirectoryCustomerIndex = selectDirectoryCustomerIndex;
    window.unlinkCurrentChatDirectory = unlinkCurrentChatDirectory;
    window.copyCustomerPhone = copyCustomerPhone;
    window.openNewDirectoryCustomerFromChat = openNewDirectoryCustomerFromChat;
    window.toggleAddLocationForm = toggleAddLocationForm;
    window.captureCurrentGpsForNewLocation = captureCurrentGpsForNewLocation;
    window.saveNewCustomerLocation = saveNewCustomerLocation;
    window.setCustomerPrimaryLocation = setCustomerPrimaryLocation;
    window.deleteCustomerLocation = deleteCustomerLocation;

    // Quick Replies
    window.toggleQuickReplies = toggleQuickReplies;
    window.sendQuickReply = sendQuickReply;
    window.initSharedQuickRepliesListener = initSharedQuickRepliesListener;
    window.renderSharedQuickReplies = renderSharedQuickReplies;
    window.promptAddQuickReply = promptAddQuickReply;
    window.promptEditQuickReply = promptEditQuickReply;
    window.openPermanentEditFromActionModal = openPermanentEditFromActionModal;
    window.closeAddQuickReplyModal = closeAddQuickReplyModal;
    window.handleQuickReplyChipClick = handleQuickReplyChipClick;
    window.confirmSendQuickReply = confirmSendQuickReply;
    window.openEditQuickReplyModal = openEditQuickReplyModal;
    window.backToQuickReplyChoiceView = backToQuickReplyChoiceView;
    window.sendEditedQuickReply = sendEditedQuickReply;
    window.closeQuickReplyActionModal = closeQuickReplyActionModal;
    window.moveQuickReplyToTop = moveQuickReplyToTop;
    window.moveQuickReplyOrder = moveQuickReplyOrder;
    window.handleQuickReplyDragStart = handleQuickReplyDragStart;
    window.handleQuickReplyDragOver = handleQuickReplyDragOver;
    window.handleQuickReplyDrop = handleQuickReplyDrop;
    window.submitSaveQuickReply = submitSaveQuickReply;
    window.deleteQuickReply = deleteQuickReply;

    // Milestones & POD
    window.openPodModal = openPodModal;
    window.closePodModal = closePodModal;
    window.handlePodImageSelected = handlePodImageSelected;
    window.submitProofOfDelivery = submitProofOfDelivery;
    window.setOrderMilestone = setOrderMilestone;
    window.updateOrderMilestone = updateOrderMilestone;
    window.highlightActiveMilestoneUI = highlightActiveMilestoneUI;

    // Lifecycle & Actions
    window.markThreadUndone = markThreadUndone;
    window.markThreadDone = markThreadDone;
    window.openConfirmDoneModal = openConfirmDoneModal;
    window.closeConfirmDoneModal = closeConfirmDoneModal;
    window.confirmAndExecuteDone = confirmAndExecuteDone;
    window.executeThreadDone = executeThreadDone;
    window.markThreadFollowUp = markThreadFollowUp;
    window.toggleThreadApplicant = toggleThreadApplicant;
    window.markThreadApplicant = toggleThreadApplicant;
    window.cancelCustomerThread = cancelCustomerThread;
    window.undoCustomerThread = undoCustomerThread;
    window.followUpCustomerOrder = followUpCustomerOrder;
    window.completeCatering = completeCatering;
    window.cancelCatering = cancelCatering;
    window.caterCurrentChatCustomer = caterCurrentChatCustomer;
    window.clearAllInboxThreads = clearAllInboxThreads;
}