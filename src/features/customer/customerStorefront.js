// src/features/customer/customerStorefront.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';

import {
    savedAddressesCache,
    selectedAddressId,
    setSavedAddressesCache,
    openAddressBookModal,
    closeAddressBookModal,
    setAddressLabelPreset,
    openAddressMapPicker,
    renderSavedAddressesList,
    selectAddressForCheckout,
    updateCheckoutSelectedAddressUI,
    submitSaveNewAddress,
    setDefaultAddress,
    deleteSavedAddress,
    updateAddressCountBadge
} from './customerAddress.js';

import {
    checkoutPaymentMode,
    stagedCustomerAvatarData,
    cleanFirebasePathKey,
    compressAvatarImageFile,
    renderCustomerHeaderProfile,
    openEditCustomerProfileModal,
    closeEditCustomerProfileModal,
    updateCustomerAvatarModalPreview,
    handleCustomerAvatarFileSelected,
    onCustomerAvatarUrlInput,
    clearCustomerAvatar,
    submitSaveCustomerProfile,
    setCheckoutPaymentMode
} from './customerProfile.js';

import {
    storesCache,
    menusCache,
    activeViewingStoreId,
    activeViewingCategoryId,
    activeCustomizingItem,
    customizerQty,
    setStoresCache,
    setMenusCache,
    openCustomerStoresModal,
    closeCustomerStoresModal,
    renderStoresGrid,
    filterCustomerStores,
    openCustomerStoreMenu,
    closeCustomerStoreMenuModal,
    renderStoreMenuItems,
    selectCustomerMenuCategory,
    openItemCustomizerModal,
    closeItemCustomizerModal,
    adjustCustomizerQty,
    recalculateCustomizerPrice,
    submitAddCustomizedItemToCart
} from './customerStoresMenu.js';

import {
    getCustomerCart,
    saveCustomerCart,
    updateFloatingCartBadge,
    openCustomerCartModal,
    closeCustomerCartModal,
    updateCustomerCartItemQty,
    promptDeleteCartItem,
    removeCustomerCartItem,
    updateCartCalculations,
    sendMultiStoreOrderToRiders,
    listenToActiveCustomerOrderStatus,
    renderCustomerMilestoneCard,
    initCustomerLiveEmbedMap,
    resolveSubstitution,
    areItemsMatching,
    sanitizeForFirebase
} from './customerOrders.js';

export * from './customerAddress.js';
export * from './customerProfile.js';
export * from './customerStoresMenu.js';
export * from './customerOrders.js';

export function initCustomerStorefront() {
    renderCustomerHeaderProfile();
    updateAddressCountBadge();

    if (Object.keys(storesCache).length > 0) {
        renderStoresGrid();
    }

    if (!db) {
        renderStoresGrid();
        return;
    }

    db.ref('stores').once('value', (snap) => {
        const data = snap.val();
        if (data && Object.keys(data).length > 0) {
            setStoresCache(data);
            try { localStorage.setItem('lokalex_cached_stores_v1', JSON.stringify(data)); } catch(e){}
            renderStoresGrid();
        } else {
            db.ref('directory/stores').once('value', (dirSnap) => {
                const dirData = dirSnap.val();
                if (dirData && Object.keys(dirData).length > 0) {
                    setStoresCache(dirData);
                    try { localStorage.setItem('lokalex_cached_stores_v1', JSON.stringify(dirData)); } catch(e){}
                }
                renderStoresGrid();
            }).catch(() => {
                renderStoresGrid();
            });
        }
    }).catch(() => {
        renderStoresGrid();
    });

    db.ref('stores').on('value', (snap) => {
        const data = snap.val();
        if (data && Object.keys(data).length > 0) {
            setStoresCache(data);
            try { localStorage.setItem('lokalex_cached_stores_v1', JSON.stringify(data)); } catch(e){}
            renderStoresGrid();
        }
    });

    db.ref('storeMenus').on('value', (snap) => {
        const data = snap.val() || {};
        setMenusCache(data);
        try { localStorage.setItem('lokalex_cached_menus_v1', JSON.stringify(data)); } catch(e){}
        if (activeViewingStoreId) {
            renderStoreMenuItems(activeViewingStoreId);
        }
        renderStoresGrid();
    });

    let custId = localStorage.getItem('lokalex_customer_fb_id') || localStorage.getItem('customerId') || appState.customerFacebookId || appState.customerId;
    if (!custId) {
        custId = `CUST_${Date.now().toString(36).toUpperCase()}`;
        localStorage.setItem('lokalex_customer_fb_id', custId);
        appState.customerFacebookId = custId;
    }

    if (custId) {
        const cleanCustId = cleanFirebasePathKey(custId);
        db.ref(`customers/${cleanCustId}`).on('value', (snap) => {
            const data = snap.val() || {};
            if (data.name) {
                localStorage.setItem('customerName', data.name);
                localStorage.setItem('lokalex_customer_name', data.name);
            }
            if (data.phoneNumber) {
                localStorage.setItem('customerPhone', data.phoneNumber);
                localStorage.setItem('lokalex_customer_email', data.phoneNumber);
            }
            if (data.avatarUrl) {
                localStorage.setItem('customerAvatarUrl', data.avatarUrl);
                localStorage.setItem('lokalex_customer_avatar', data.avatarUrl);
            }
            if (data.savedAddresses) {
                setSavedAddressesCache(data.savedAddresses);
                renderSavedAddressesList();
                updateCheckoutSelectedAddressUI();
            }
            renderCustomerHeaderProfile();
        });

        listenToActiveCustomerOrderStatus(cleanCustId);
    }

    updateFloatingCartBadge();
}

// Global window bindings for HTML event handlers
if (typeof window !== 'undefined') {
    window.initCustomerStorefront = initCustomerStorefront;
    window.renderCustomerHeaderProfile = renderCustomerHeaderProfile;
    window.openEditCustomerProfileModal = openEditCustomerProfileModal;
    window.closeEditCustomerProfileModal = closeEditCustomerProfileModal;
    window.updateCustomerAvatarModalPreview = updateCustomerAvatarModalPreview;
    window.handleCustomerAvatarFileSelected = handleCustomerAvatarFileSelected;
    window.onCustomerAvatarUrlInput = onCustomerAvatarUrlInput;
    window.clearCustomerAvatar = clearCustomerAvatar;
    window.submitSaveCustomerProfile = submitSaveCustomerProfile;

    window.openCustomerStoresModal = openCustomerStoresModal;
    window.closeCustomerStoresModal = closeCustomerStoresModal;
    window.renderStoresGrid = renderStoresGrid;
    window.filterCustomerStores = filterCustomerStores;
    window.openCustomerStoreMenu = openCustomerStoreMenu;
    window.closeCustomerStoreMenuModal = closeCustomerStoreMenuModal;
    window.selectCustomerMenuCategory = selectCustomerMenuCategory;
    window.openItemCustomizerModal = openItemCustomizerModal;
    window.closeItemCustomizerModal = closeItemCustomizerModal;
    window.adjustCustomizerQty = adjustCustomizerQty;
    window.recalculateCustomizerPrice = recalculateCustomizerPrice;
    window.submitAddCustomizedItemToCart = submitAddCustomizedItemToCart;

    window.openCustomerCartModal = openCustomerCartModal;
    window.closeCustomerCartModal = closeCustomerCartModal;
    window.updateCustomerCartItemQty = updateCustomerCartItemQty;
    window.promptDeleteCartItem = promptDeleteCartItem;
    window.removeCustomerCartItem = removeCustomerCartItem;
    window.sendMultiStoreOrderToRiders = sendMultiStoreOrderToRiders;
    window.listenToActiveCustomerOrderStatus = listenToActiveCustomerOrderStatus;

    window.openAddressBookModal = openAddressBookModal;
    window.closeAddressBookModal = closeAddressBookModal;
    window.setAddressLabelPreset = setAddressLabelPreset;
    window.openAddressMapPicker = openAddressMapPicker;
    window.selectAddressForCheckout = selectAddressForCheckout;
    window.submitSaveNewAddress = submitSaveNewAddress;
    window.setDefaultAddress = setDefaultAddress;
    window.deleteSavedAddress = deleteSavedAddress;
    window.setCheckoutPaymentMode = setCheckoutPaymentMode;
    window.resolveSubstitution = resolveSubstitution;

    window.addEventListener('viewChanged', (e) => {
        if (e.detail === 'view-customer-home') {
            initCustomerStorefront();
        }
    });

    const currentView = document.getElementById('view-customer-home');
    if (currentView && !currentView.classList.contains('hidden')) {
        initCustomerStorefront();
    }
}