// src/features/customer/customerStoresMenu.js

/**
 * ============================================================================
 * CUSTOMER STORES & MENU (FACADE BARREL MODULE)
 * ============================================================================
 * 
 * MODULE ARCHITECTURE & RESPONSIBILITIES:
 * 
 * 1. stores/customerStoreHours.js
 *    - Operating hours parser & real-time store open/closed calculator.
 *    - `parseTimeToMinutes`: Handles 12-hour (AM/PM) and 24-hour schedule strings.
 *    - `isStoreCurrentlyOpen`: Dynamically checks if a store is within operating
 *      hours, auto-syncing the state to Firebase if out of sync.
 *    - Houses shared state variables: `storesCache`, `menusCache`, `isPreviewMode`, etc.
 * 
 * 2. stores/customerStoreList.js
 *    - Store directory browsing and modal presentation for customers.
 *    - `openCustomerStoresModal` & `closeCustomerStoresModal`: Toggles the stores modal.
 *    - `renderStoresGrid`: Generates real-time store cards with open/closed status badges.
 *    - `filterCustomerStores`: Real-time query search filtering across store names,
 *      addresses, and menu items.
 * 
 * 3. stores/customerStoreMenuModal.js
 *    - Store menu presentation and interactive item customizer.
 *    - `openCustomerStoreMenu` & `closeCustomerStoreMenuModal`: Store menu lifecycle.
 *    - `renderStoreMenuItems`: Displays category tabs and item cards.
 *    - `openItemCustomizerModal` & `closeItemCustomizerModal`: Configuration workflow.
 *    - `recalculateCustomizerPrice`: Dynamic price calculation for sizes and extras.
 *    - `submitAddCustomizedItemToCart`: Validates store open state and pushes configured
 *      items into the customer cart.
 * ============================================================================
 */

import * as customerStoreHours from './stores/customerStoreHours.js';
import * as customerStoreList from './stores/customerStoreList.js';
import * as customerStoreMenuModal from './stores/customerStoreMenuModal.js';

export * from './stores/customerStoreHours.js';
export * from './stores/customerStoreList.js';
export * from './stores/customerStoreMenuModal.js';

// Global window attachments for backward compatibility with HTML template onclicks
if (typeof window !== 'undefined') {
    const modules = [customerStoreHours, customerStoreList, customerStoreMenuModal];
    modules.forEach(mod => {
        if (mod) {
            Object.keys(mod).forEach(fn => {
                if (typeof mod[fn] === 'function') {
                    window[fn] = mod[fn];
                }
            });
        }
    });
}