// src/features/advancedOrders.js

/**
 * ============================================================================
 * ADVANCED ORDERS FEATURE (FACADE BARREL MODULE)
 * ============================================================================
 * 
 * Description:
 * Central facade coordinator for advance order workflows:
 * 1. advancedOrdersAlerts.js
 *    - Web Audio API alarms, canonical time parsing, and live countdown banners.
 * 2. advancedOrdersRiderModal.js
 *    - Dynamic rider availability resolver and interactive catering modal.
 * 3. advancedOrdersActions.js
 *    - Scheduled order lifecycle transitions (Take, Done, Cancel, Auto-Complete).
 * 4. advancedOrdersUI.js
 *    - List rendering, tab switching, and touch/mouse swipe-to-delete cards.
 * 
 * Update Note:
 * - Added immediate synchronous invocation of checkScheduledDeliveryAlerts on boot.
 * - Bound advancedOrdersUpdated custom events to trigger instant alert re-checks.
 * ============================================================================
 */

import * as advancedOrdersAlerts from './advancedOrders/advancedOrdersAlerts.js';
import * as advancedOrdersRiderModal from './advancedOrders/advancedOrdersRiderModal.js';
import * as advancedOrdersActions from './advancedOrders/advancedOrdersActions.js';
import * as advancedOrdersUI from './advancedOrders/advancedOrdersUI.js';

export * from './advancedOrders/advancedOrdersAlerts.js';
export * from './advancedOrders/advancedOrdersRiderModal.js';
export * from './advancedOrders/advancedOrdersActions.js';
export * from './advancedOrders/advancedOrdersUI.js';

// Global window attachments for backward compatibility with HTML template onclicks
if (typeof window !== 'undefined') {
    const modules = [
        advancedOrdersAlerts,
        advancedOrdersRiderModal,
        advancedOrdersActions,
        advancedOrdersUI
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

    // Run immediately upon evaluation to prevent startup delay
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            advancedOrdersAlerts.checkScheduledDeliveryAlerts();
        });
    } else {
        advancedOrdersAlerts.checkScheduledDeliveryAlerts();
    }

    // Set recurring 15-second watchdog timer
    setInterval(advancedOrdersAlerts.checkScheduledDeliveryAlerts, 15000);

    // Re-check alerts immediately whenever orders change or synchronize
    window.addEventListener('advancedOrdersUpdated', () => {
        advancedOrdersAlerts.checkScheduledDeliveryAlerts();
    });
}