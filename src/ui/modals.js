// src/ui/modals.js

/**
 * ============================================================================
 * MODAL DIALOGS BARREL & GLOBAL EVENT COORDINATOR
 * ============================================================================
 * 
 * Central facade module aggregating modal interfaces, security dialogs, and 
 * confirmation barriers across the application. Re-exports all controllers for
 * ES module bundlers and binds handlers to `window` for HTML attribute compatibility.
 * 
 * Sub-Module Functional Breakdown:
 * ----------------------------------------------------------------------------
 * 1. modals/riderPasswordModal.js
 *    - Rider account security, password configuration, and SMS OTP verification.
 *    - Integrates Firebase Auth phone sign-in, reCAPTCHA verifiers, and skip flows.
 * 
 * 2. modals/gcashModal.js
 *    - GCash account management, screenshot QR scanning, and vector generation.
 *    - Multi-pass QR parser (BarcodeDetector + jsQR fallback, mobile ROI crops).
 *    - Database synchronization across Firebase `gcash/` nodes and backend APIs.
 * 
 * 3. modals/mapCalcModal.js
 *    - Customer distance pin calculation link generator and management board.
 *    - Live status tracking ("Awaiting Pin" vs "Pin Saved") and link copy helpers.
 *    - Route visualization directly into Google Maps navigation.
 * 
 * 4. modals/systemModals.js
 *    - Shared app utility dialogs: queue alarm dismissals, sample receipt alerts,
 *      GPS requirement modals, bulk text entry, and admin catering popups.
 *    - Slide-to-confirm safety barrier with strict 0-12% touch origin validation.
 * 
 * 5. rosterAvatar.js & rosterUI.js (Features Re-export)
 *    - Rider profile inspection sheets, avatar selection modals, and file uploads.
 * ============================================================================
 */

import {
    openRiderPasswordSetupModal,
    closeRiderPasswordSetupModal,
    toggleRiderPassVisibility,
    sendRiderSetupOTP,
    verifyRiderSetupOTP,
    handleSaveRiderPassword,
    handleSkipRiderPasswordSetup
} from './modals/riderPasswordModal.js';

import {
    fetchGCashDetails,
    openGCashModal,
    closeGCashModal,
    saveGCashDetails,
    executeSaveGCashDetails
} from './modals/gcashModal.js';

import {
    formatMapCalcDate,
    openMapCalcBoardModal,
    closeMapCalcBoardModal,
    promptMapCalcCustomerName,
    closeMapCalcNameModal,
    startMapCalcForCustomer,
    fetchAndRenderMapCalculations,
    copyMapCalcLink,
    viewMapCalcRoute,
    deleteMapCalculation
} from './modals/mapCalcModal.js';

import {
    dismissQueueAlarm,
    openSampleReceiptModal,
    closeSampleReceiptModal,
    openAdvancedOrdersModal,
    closeAdvancedOrdersModal,
    showGpsRequiredModal,
    closeGpsModal,
    closeCateringModal,
    closeAdminCateringModal,
    openPasswordModal,
    closePasswordModal,
    showBulkAddModal,
    closeBulkModal,
    closeEditItemModal,
    openSlideDeleteModal,
    closeSlideDeleteModal,
    onSlideProgress,
    onSlideEnd
} from './modals/systemModals.js';

import {
    openAvatarPickerModal,
    closeAvatarPickerModal,
    handleAvatarFileUpload,
    saveSelectedAvatar,
    saveRiderProfileSettings,
    syncHeaderUserProfile
} from '../features/roster/rosterAvatar.js';

import {
    openRiderInfoModal,
    closeRiderInfoModal
} from '../features/roster/rosterUI.js';

// Re-export named members for static ES Module bundlers
export {
    openRiderPasswordSetupModal,
    closeRiderPasswordSetupModal,
    toggleRiderPassVisibility,
    sendRiderSetupOTP,
    verifyRiderSetupOTP,
    handleSaveRiderPassword,
    handleSkipRiderPasswordSetup,
    fetchGCashDetails,
    openGCashModal,
    closeGCashModal,
    saveGCashDetails,
    executeSaveGCashDetails,
    formatMapCalcDate,
    openMapCalcBoardModal,
    closeMapCalcBoardModal,
    promptMapCalcCustomerName,
    closeMapCalcNameModal,
    startMapCalcForCustomer,
    fetchAndRenderMapCalculations,
    copyMapCalcLink,
    viewMapCalcRoute,
    deleteMapCalculation,
    dismissQueueAlarm,
    openAvatarPickerModal,
    closeAvatarPickerModal,
    openRiderInfoModal,
    closeRiderInfoModal,
    handleAvatarFileUpload,
    saveSelectedAvatar,
    saveRiderProfileSettings,
    syncHeaderUserProfile,
    openSampleReceiptModal,
    closeSampleReceiptModal,
    openAdvancedOrdersModal,
    closeAdvancedOrdersModal,
    showGpsRequiredModal,
    closeGpsModal,
    closeCateringModal,
    closeAdminCateringModal,
    openPasswordModal,
    closePasswordModal,
    showBulkAddModal,
    closeBulkModal,
    closeEditItemModal,
    openSlideDeleteModal,
    closeSlideDeleteModal,
    onSlideProgress,
    onSlideEnd
};

// ============================================================================
// GLOBAL WINDOW ATTACHMENTS (Ensures HTML onclick event compatibility)
// ============================================================================
if (typeof window !== 'undefined') {
    window.openRiderPasswordSetupModal = openRiderPasswordSetupModal;
    window.closeRiderPasswordSetupModal = closeRiderPasswordSetupModal;
    window.toggleRiderPassVisibility = toggleRiderPassVisibility;
    window.sendRiderSetupOTP = sendRiderSetupOTP;
    window.verifyRiderSetupOTP = verifyRiderSetupOTP;
    window.handleSaveRiderPassword = handleSaveRiderPassword;
    window.handleSkipRiderPasswordSetup = handleSkipRiderPasswordSetup;

    window.fetchGCashDetails = fetchGCashDetails;
    window.openGCashModal = openGCashModal;
    window.closeGCashModal = closeGCashModal;
    window.saveGCashDetails = saveGCashDetails;
    window.executeSaveGCashDetails = executeSaveGCashDetails;

    window.formatMapCalcDate = formatMapCalcDate;
    window.openMapCalcBoardModal = openMapCalcBoardModal;
    window.closeMapCalcBoardModal = closeMapCalcBoardModal;
    window.promptMapCalcCustomerName = promptMapCalcCustomerName;
    window.closeMapCalcNameModal = closeMapCalcNameModal;
    window.startMapCalcForCustomer = startMapCalcForCustomer;
    window.fetchAndRenderMapCalculations = fetchAndRenderMapCalculations;
    window.copyMapCalcLink = copyMapCalcLink;
    window.viewMapCalcRoute = viewMapCalcRoute;
    window.deleteMapCalculation = deleteMapCalculation;

    window.openAvatarPickerModal = openAvatarPickerModal;
    window.closeAvatarPickerModal = closeAvatarPickerModal;
    window.openRiderInfoModal = openRiderInfoModal;
    window.closeRiderInfoModal = closeRiderInfoModal;
    window.handleAvatarFileUpload = handleAvatarFileUpload;
    window.saveSelectedAvatar = saveSelectedAvatar;
    window.saveRiderProfileSettings = saveRiderProfileSettings;
    window.syncHeaderUserProfile = syncHeaderUserProfile;

    window.dismissQueueAlarm = dismissQueueAlarm;
    window.openSampleReceiptModal = openSampleReceiptModal;
    window.closeSampleReceiptModal = closeSampleReceiptModal;
    window.openAdvancedOrdersModal = openAdvancedOrdersModal;
    window.closeAdvancedOrdersModal = closeAdvancedOrdersModal;
    window.showGpsRequiredModal = showGpsRequiredModal;
    window.closeGpsModal = closeGpsModal;
    window.closeCateringModal = closeCateringModal;
    window.closeAdminCateringModal = closeAdminCateringModal;
    window.openPasswordModal = openPasswordModal;
    window.closePasswordModal = closePasswordModal;
    window.showBulkAddModal = showBulkAddModal;
    window.closeBulkModal = closeBulkModal;
    window.closeEditItemModal = closeEditItemModal;
    window.openSlideDeleteModal = openSlideDeleteModal;
    window.closeSlideDeleteModal = closeSlideDeleteModal;
    window.onSlideProgress = onSlideProgress;
    window.onSlideEnd = onSlideEnd;
}