// src/features/storeHub/ui/storeOrdersKDS.js

/**
 * ============================================================================
 * STORE ORDERS KDS (KITCHEN DISPLAY SYSTEM) FACADE & EVENT BINDER
 * ============================================================================
 * 
 * Central coordinator and barrel module for kitchen order operations.
 * Aggregates printing utilities, order status actions, item substitutions, and
 * reactive board rendering, binding them to `window` for HTML event handlers.
 * 
 * Sub-Module Functional Breakdown:
 * ----------------------------------------------------------------------------
 * 1. storeOrdersPrint.js
 *    - ESC/POS plaintext formatting for 58mm/80mm thermal receipts.
 *    - Browser print window generation with receipt CSS.
 *    - Direct Web Bluetooth GATT printing pipeline for wireless thermal printers.
 * 
 * 2. storeOrdersActions.js
 *    - Order lifecycle transitions (accept, prep timers, ready for pickup, done).
 *    - Dynamic DOM countdown and overdue timer recalculations.
 *    - Synchronized status and chat milestone updates across Firebase.
 * 
 * 3. storeOrdersSubstitution.js
 *    - Unavailable dish management ("86" workflow).
 *    - Modal interface for alternative dish recommendations and kitchen notes.
 *    - Real-time rider substitution alert dispatching via chat and order nodes.
 * 
 * 4. storeOrdersRender.js
 *    - Kitchen board rendering for active and completed order queues.
 *    - Inbound rider GPS telemetry and arrival ETA estimation.
 *    - Ticket card composition with granular dish options and kitchen action controls.
 * ============================================================================
 */

import * as storeOrdersPrint from './storeOrdersPrint.js';
import * as storeOrdersActions from './storeOrdersActions.js';
import * as storeOrdersSubstitution from './storeOrdersSubstitution.js';
import * as storeOrdersRender from './storeOrdersRender.js';

export * from './storeOrdersPrint.js';
export * from './storeOrdersActions.js';
export * from './storeOrdersSubstitution.js';
export * from './storeOrdersRender.js';

// Global window attachment for backward compatibility with HTML onclicks
if (typeof window !== 'undefined') {
    const modules = [
        storeOrdersPrint, 
        storeOrdersActions, 
        storeOrdersSubstitution, 
        storeOrdersRender
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