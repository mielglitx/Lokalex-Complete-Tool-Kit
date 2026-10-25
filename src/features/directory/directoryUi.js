/**
 * ============================================================================
 * DIRECTORY UI FACADE / BARREL
 * ============================================================================
 * Centralized facade and public interface for directory list rendering,
 * peer-to-peer credits, dual-tier routing, and restaurant menu photo galleries.
 *
 * SUB-MODULE ARCHITECTURE & RESPONSIBILITIES:
 * ----------------------------------------------------------------------------
 * 1. directoryCredits.js:
 *    - updateRosterCreditsDisplay(): Renders credit count badge and pill styling.
 *    - showCreditsInfoToast(): Displays credit rules, balances, and earn rates.
 *    - initRiderCreditsListener(): Live RTDB listener for rider credit balances.
 *    - openShareCreditsModal(), closeShareCreditsModal(): Credit transfer popup.
 *    - confirmTransferCredits(): Atomic peer-to-peer credit transfer via RTDB.
 *
 * 2. directoryRouting.js:
 *    - populateDestinationDropdown(): Populates serviced destinations per hub.
 *    - detectAndSetGpsDestination(): GPS nearest-municipality auto-select.
 *    - handleOriginHubChange(), handleDestinationChange(): Filters list by route.
 *    - copyBarangayRate(): Copies standardized fee breakdown with guide link.
 *
 * 3. directoryGalleries.js:
 *    - initStoreMenuGalleriesListener(): Real-time menu page count metadata sync.
 *    - openStoreMenuGalleryModal(), closeStoreMenuGalleryModal(): Menu modal.
 *    - openMenuCameraScanner(): High-resolution in-app document camera scanner.
 *    - handleMenuPhotoUpload(): Canvas-compressed multi-photo batch upload.
 *    - downloadCompleteMenuToPhone(): Sequential device photo download.
 *    - sendSingleMenuPageToCustomer(), sendSelectedMenuPagesToCustomer(): Chat dispatch.
 *    - openMenuCustomerRecipientPicker(): Recipient picker for sending menu pages.
 *    - openStoreMenuPickerFromChat(): Direct menu browser inside active chat modal.
 *    - openGalleryLightbox(), closeGalleryLightbox(): Fullscreen image lightbox.
 *
 * 4. directoryListRender.js:
 *    - renderDirectoryList(): Core directory list builder (Customers, Stores, Rates).
 *    - setupAlphabetScrubber(): A-Z vertical scrubber with elastic touch distortion.
 *    - minimizeDirectorySearch(), expandDirectorySearch(): Sticky floating search.
 *    - promptViewCustomerLocation(), confirmAndOpenCustomerLocation(): Map unlock gate.
 *    - openDirectory(), filterDirectoryRecords(), clearDirectorySearch(): Navigation.
 * ============================================================================
 */

// 1. Re-export all sub-modules
export * from './ui/directoryCredits.js';
export * from './ui/directoryRouting.js';
export * from './ui/directoryGalleries.js';
export * from './ui/directoryListRender.js';

// 2. Import functions for window attachment to support inline HTML onclick handlers
import {
    updateRosterCreditsDisplay,
    showCreditsInfoToast,
    initRiderCreditsListener,
    openShareCreditsModal,
    closeShareCreditsModal,
    setTransferCreditAmount,
    confirmTransferCredits
} from './ui/directoryCredits.js';

import {
    populateDestinationDropdown,
    detectAndSetGpsDestination,
    handleOriginHubChange,
    handleDestinationChange,
    copyBarangayRate,
    openFareRatePickerFromChat,
    closeFareRatePickerFromChat,
    filterChatFareRatePicker,
    renderChatFareRatePicker,
    quickSendFareRateToActiveChat,
    insertFareRateToChatInput,
    formatFareRateMessage
} from './ui/directoryRouting.js';

import {
    initStoreMenuGalleriesListener,
    openStoreMenuGalleryModal,
    closeStoreMenuGalleryModal,
    handleOpenMenuGalleryClick,
    handleMenuPhotoUpload,
    downloadCompleteMenuToPhone,
    deleteMenuGalleryPage,
    openMenuCameraScanner,
    closeMenuCameraScanner,
    toggleMenuCameraTorch,
    flipMenuCameraFacing,
    takeMenuCameraSnapshot,
    retakeMenuCameraSnapshot,
    confirmAndUploadMenuSnapshot,
    setMenuCameraZoomLevel,
    toggleMenuCameraOrientation,
    handleNativeMenuCameraCapture,
    openGalleryLightbox,
    closeGalleryLightbox,
    handleMenuPageCheckToggle,
    updateMenuSelectionBar,
    toggleSelectAllMenuPages,
    clearMenuPageSelections,
    sendSingleMenuPageToCustomer,
    sendSelectedMenuPagesToCustomer,
    sendAllMenuPagesToCustomer,
    dispatchMenuPagesToSend,
    executeSendMenuPages,
    openMenuCustomerRecipientPicker,
    closeMenuCustomerRecipientPicker,
    filterMenuCustomerRecipients,
    handleSelectMenuCustomerRecipient,
    openStoreMenuPickerFromChat,
    closeStoreMenuPickerFromChat,
    filterChatStoreMenuPicker,
    handleSelectStoreFromChatPicker,
    handleChatStoreMenuQuickSendClick,
    handleChatStoreMenuViewClick,
    quickSendStoreMenuToActiveChat,
    askMenuSendConfirmation,
    closeMenuSendConfirmModal,
    showMenuSentConfirmationModal,
    closeMenuSentConfirmationModal
} from './ui/directoryGalleries.js';

import {
    getSectionLetter,
    minimizeDirectorySearch,
    restoreDirectorySearch,
    expandDirectorySearch,
    syncAndFilterFloatingSearch,
    initDirectoryScrollListener,
    handleViewCustomerLocationClick,
    promptViewCustomerLocation,
    closeCustomerLocationConfirmModal,
    confirmAndOpenCustomerLocation,
    openDirectory,
    filterDirectoryRecords,
    clearDirectorySearch,
    handleEditDirectoryRecordClick,
    handleDeleteDirectoryRecordClick,
    renderDirectoryList,
    setupAlphabetScrubber
} from './ui/directoryListRender.js';

// 3. Attach global window handlers for template bindings
if (typeof window !== 'undefined') {
    // Credits
    window.updateRosterCreditsDisplay = updateRosterCreditsDisplay;
    window.showCreditsInfoToast = showCreditsInfoToast;
    window.initRiderCreditsListener = initRiderCreditsListener;
    window.openShareCreditsModal = openShareCreditsModal;
    window.closeShareCreditsModal = closeShareCreditsModal;
    window.setTransferCreditAmount = setTransferCreditAmount;
    window.confirmTransferCredits = confirmTransferCredits;

    // Routing
    window.handleOriginHubChange = handleOriginHubChange;
    window.handleDestinationChange = handleDestinationChange;
    window.populateDestinationDropdown = populateDestinationDropdown;
    window.copyBarangayRate = copyBarangayRate;

    // Location & Records
    window.handleViewCustomerLocationClick = handleViewCustomerLocationClick;
    window.handleEditDirectoryRecordClick = handleEditDirectoryRecordClick;
    window.handleDeleteDirectoryRecordClick = handleDeleteDirectoryRecordClick;
    window.promptViewCustomerLocation = promptViewCustomerLocation;
    window.closeCustomerLocationConfirmModal = closeCustomerLocationConfirmModal;
    window.confirmAndOpenCustomerLocation = confirmAndOpenCustomerLocation;

    // Menu Galleries & Scanner
    window.initStoreMenuGalleriesListener = initStoreMenuGalleriesListener;
    window.handleOpenMenuGalleryClick = handleOpenMenuGalleryClick;
    window.openStoreMenuGalleryModal = openStoreMenuGalleryModal;
    window.closeStoreMenuGalleryModal = closeStoreMenuGalleryModal;
    window.handleMenuPhotoUpload = handleMenuPhotoUpload;
    window.downloadCompleteMenuToPhone = downloadCompleteMenuToPhone;
    window.deleteMenuGalleryPage = deleteMenuGalleryPage;
    window.openMenuCameraScanner = openMenuCameraScanner;
    window.closeMenuCameraScanner = closeMenuCameraScanner;
    window.toggleMenuCameraTorch = toggleMenuCameraTorch;
    window.flipMenuCameraFacing = flipMenuCameraFacing;
    window.takeMenuCameraSnapshot = takeMenuCameraSnapshot;
    window.retakeMenuCameraSnapshot = retakeMenuCameraSnapshot;
    window.confirmAndUploadMenuSnapshot = confirmAndUploadMenuSnapshot;
    window.setMenuCameraZoomLevel = setMenuCameraZoomLevel;
    window.toggleMenuCameraOrientation = toggleMenuCameraOrientation;
    window.handleNativeMenuCameraCapture = handleNativeMenuCameraCapture;
    window.openGalleryLightbox = openGalleryLightbox;
    window.closeGalleryLightbox = closeGalleryLightbox;

    // Menu Selection, Customer Dispatch & Chat Picker
    window.handleMenuPageCheckToggle = handleMenuPageCheckToggle;
    window.updateMenuSelectionBar = updateMenuSelectionBar;
    window.toggleSelectAllMenuPages = toggleSelectAllMenuPages;
    window.clearMenuPageSelections = clearMenuPageSelections;
    window.sendSingleMenuPageToCustomer = sendSingleMenuPageToCustomer;
    window.sendSelectedMenuPagesToCustomer = sendSelectedMenuPagesToCustomer;
    window.sendAllMenuPagesToCustomer = sendAllMenuPagesToCustomer;
    window.dispatchMenuPagesToSend = dispatchMenuPagesToSend;
    window.executeSendMenuPages = executeSendMenuPages;
    window.openMenuCustomerRecipientPicker = openMenuCustomerRecipientPicker;
    window.closeMenuCustomerRecipientPicker = closeMenuCustomerRecipientPicker;
    window.filterMenuCustomerRecipients = filterMenuCustomerRecipients;
    window.handleSelectMenuCustomerRecipient = handleSelectMenuCustomerRecipient;
    window.openStoreMenuPickerFromChat = openStoreMenuPickerFromChat;
    window.closeStoreMenuPickerFromChat = closeStoreMenuPickerFromChat;
    window.filterChatStoreMenuPicker = filterChatStoreMenuPicker;
    window.handleSelectStoreFromChatPicker = handleSelectStoreFromChatPicker;
    window.handleChatStoreMenuQuickSendClick = handleChatStoreMenuQuickSendClick;
    window.handleChatStoreMenuViewClick = handleChatStoreMenuViewClick;
    window.quickSendStoreMenuToActiveChat = quickSendStoreMenuToActiveChat;
    window.askMenuSendConfirmation = askMenuSendConfirmation;
    window.closeMenuSendConfirmModal = closeMenuSendConfirmModal;
    window.showMenuSentConfirmationModal = showMenuSentConfirmationModal;
    window.closeMenuSentConfirmationModal = closeMenuSentConfirmationModal;

    // Chat Fare Rate Picker
    window.openFareRatePickerFromChat = openFareRatePickerFromChat;
    window.closeFareRatePickerFromChat = closeFareRatePickerFromChat;
    window.filterChatFareRatePicker = filterChatFareRatePicker;
    window.renderChatFareRatePicker = renderChatFareRatePicker;
    window.quickSendFareRateToActiveChat = quickSendFareRateToActiveChat;
    window.insertFareRateToChatInput = insertFareRateToChatInput;
    window.formatFareRateMessage = formatFareRateMessage;

    // Navigation & List UI
    window.minimizeDirectorySearch = minimizeDirectorySearch;
    window.restoreDirectorySearch = restoreDirectorySearch;
    window.expandDirectorySearch = expandDirectorySearch;
    window.syncAndFilterFloatingSearch = syncAndFilterFloatingSearch;
    window.openDirectory = openDirectory;
    window.filterDirectoryRecords = filterDirectoryRecords;
    window.clearDirectorySearch = clearDirectorySearch;
    window.renderDirectoryList = renderDirectoryList;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            updateRosterCreditsDisplay();
            initRiderCreditsListener();
            initStoreMenuGalleriesListener();
        });
    } else {
        updateRosterCreditsDisplay();
        initRiderCreditsListener();
        initStoreMenuGalleriesListener();
    }
}