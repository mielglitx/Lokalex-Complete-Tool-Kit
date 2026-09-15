// src/features/storeHub/ui/menu/categoryPreview.js
import { appState } from '../../../../store/state.js';
import { showToast } from '../../../../ui/notifications.js';
import { storeHubState, cleanFirebasePathKey } from '../storeHubState.js';
import { 
    openCustomerStoreMenu, 
    menusCache, 
    storesCache, 
    setCustomerStorePreviewMode 
} from '../../../customer/customerStoresMenu.js';

export function previewStorefrontMenu() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);

    if (!storeId) {
        return showToast("⚠️ Store session not found. Please log in again.");
    }

    const currentStore = storeHubState.currentStoreData || {};
    const storeName = currentStore.storeName || appState.merchantStoreName || localStorage.getItem('lokalex_merchant_store_name') || "Store Menu";
    const address = currentStore.address || "Poblacion Area";
    const logoUrl = currentStore.logoUrl || "";
    const isOpen = currentStore.isOpen !== false;

    if (typeof storesCache !== 'undefined') {
        storesCache[storeId] = {
            storeName,
            address,
            logoUrl,
            isOpen
        };
    }

    if (typeof menusCache !== 'undefined') {
        menusCache[storeId] = JSON.parse(JSON.stringify(storeHubState.currentMenuData || { categories: {}, items: {} }));
    }

    setCustomerStorePreviewMode(true);

    const storeModal = document.getElementById('cust-store-menu-modal');
    if (storeModal && storeModal.parentElement !== document.body) {
        document.body.appendChild(storeModal);
    }

    const custModal = document.getElementById('cust-item-customizer-modal');
    if (custModal && custModal.parentElement !== document.body) {
        document.body.appendChild(custModal);
    }

    if (!storeModal) {
        return showToast("⚠️ Customer store menu modal not found in DOM.");
    }

    openCustomerStoreMenu(storeId);
    showToast("👀 Previewing customer storefront menu (Ordering disabled)");
}