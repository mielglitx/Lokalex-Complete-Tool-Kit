// src/ui/modals.js
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
    openAvatarPickerModal,
    closeAvatarPickerModal,
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

    window.dismissQueueAlarm = dismissQueueAlarm;
    window.openAvatarPickerModal = openAvatarPickerModal;
    window.closeAvatarPickerModal = closeAvatarPickerModal;
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