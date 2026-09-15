// src/features/storeHub/index.js

/**
 * ============================================================================
 * STORE HUB FEATURE BARREL MODULE
 * ============================================================================
 * 
 * Central entry point for the Store Hub system. Imports and re-exports all
 * sub-modules, while exposing functions to the global window scope for inline
 * HTML event handling.
 * 
 * Sub-Module Roles:
 * ----------------------------------------------------------------------------
 * 1. storeAdmin.js
 *    - Administrative account provisioning and management.
 *    - Generates store credentials and provisions multi-node Firebase data:
 *      `storeAccounts`, `stores`, `directory/stores`, and `emails`.
 *    - Dispatches welcome/onboarding credentials through the Resend API.
 *    - Manages admin UI modals and handles cascading merchant deletions.
 * 
 * 2. storeAuth.js
 *    - Merchant authentication, session recovery, and lifecycle management.
 *    - Validates merchant credentials against Firebase with timeout race fallbacks.
 *    - Persists active merchant credentials in localStorage and appState.
 *    - Handles session tear-down and logout logic.
 * 
 * 3. storeMenu.js
 *    - Database operations for store catalogs, menus, and profile records.
 *    - Handles CRUD workflows for categories, menu items, sizes, and add-ons.
 *    - Manages stock toggles (in-stock / sold-out) and category ordering.
 *    - Executes profile, logo, and open/close status updates.
 * 
 * 4. storeUI.js
 *    - Hub UI orchestrator and aggregator for UI sub-modules.
 *    - Re-exports UI helpers: state, audio, profile/hours, orders KDS, menu UI, and merchant chat.
 *    - Attaches real-time Firebase listeners (`stores`, `storeMenus`, `storeOrders`, `roster`).
 *    - Coordinates Kitchen Display System (KDS) feeds, kitchen audio alerts, and countdown timers.
 * ============================================================================
 */

import * as storeAdmin from './storeAdmin.js';
import * as storeAuth from './storeAuth.js';
import * as storeMenu from './storeMenu.js';
import * as storeUI from './storeUI.js';

export * from './storeAdmin.js';
export * from './storeAuth.js';
export * from './storeMenu.js';
export * from './storeUI.js';

// Global window binding for HTML event handlers
if (typeof window !== 'undefined') {
    const modules = [storeAdmin, storeAuth, storeMenu, storeUI];
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