// src/features/cart.js

/**
 * ============================================================================
 * MULTI-CART FEATURE BARREL & LIFECYCLE ORCHESTRATOR
 * ============================================================================
 * 
 * Central entry point for the Multi-Slot Cart system (Slots 1-4). Aggregates
 * state persistence, touch gestures, change calculation, view rendering, and
 * item operational workflows. Automatically initializes saved cart state and
 * binds functions to the global `window` scope for HTML event attributes.
 * 
 * Sub-Module Functional Architecture:
 * ----------------------------------------------------------------------------
 * 1. cart/cartState.js
 *    - Core multi-slot cart data model (slots 1 to 4) and active slot tracking.
 *    - State persistence (`localStorage` sync) for items, lock states, and txIds.
 *    - Dynamic client assignment derived from catering roster records.
 * 
 * 2. cart/cartGestures.js
 *    - Touch swipe-to-delete gesture physics on mobile cart cards.
 *    - Drag delta resistance transforms, red border cue threshold, and release triggers.
 * 
 * 3. cart/cartSukli.js
 *    - Change (sukli) calculator modal for Cash-on-Delivery (COD) orders.
 *    - Real-time tendered cash calculation, shortage warnings, and quick-pay presets.
 * 
 * 4. cart/cartUI.js
 *    - Slot tab switches (Carts 1-4) and catering client dropdown rendering.
 *    - Dual-view rendering: Finalized locked order summary (COD/GCash breakdowns
 *      with slide-to-unlock) vs. Interactive item checklist with progress bar.
 * 
 * 5. cart/cartOperations.js
 *    - Item mutations: category toggle (Store/Market), Paid, Bought, and N/A states.
 *    - Modals for editing names, setting prices, and regex-based bulk text pasting.
 *    - Pre-checkout validation rules before transitioning into the checkout wizard.
 * ============================================================================
 */

import * as cartStateMod from './cart/cartState.js';
import * as cartGesturesMod from './cart/cartGestures.js';
import * as cartSukliMod from './cart/cartSukli.js';
import * as cartUIMod from './cart/cartUI.js';
import * as cartOperationsMod from './cart/cartOperations.js';

export * from './cart/cartState.js';
export * from './cart/cartGestures.js';
export * from './cart/cartSukli.js';
export * from './cart/cartUI.js';
export * from './cart/cartOperations.js';

// Restore cart slots and lock statuses from localStorage
cartStateMod.loadCartState();

// Initial DOM mount for cart tabs and active items list
setTimeout(() => {
    cartUIMod.renderCartTabs();
    cartUIMod.renderCartItems();
}, 50);

// Global window registration for backward compatibility with inline HTML onclick attributes
if (typeof window !== 'undefined') {
    const modules = [
        cartStateMod,
        cartGesturesMod,
        cartSukliMod,
        cartUIMod,
        cartOperationsMod
    ];

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

// Reactive listeners to sync catering customer assignments when roster data updates
window.addEventListener('rosterUpdated', cartUIMod.renderCartCustomerSelector);
window.addEventListener('cateredUpdated', cartUIMod.renderCartCustomerSelector);