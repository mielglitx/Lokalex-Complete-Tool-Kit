// src/features/advancedOrders.js

/**
 * ============================================================================
 * ADVANCED ORDERS FEATURE (FACADE BARREL MODULE)
 * ============================================================================
 * 
 * MODULE ARCHITECTURE & RESPONSIBILITIES:
 * 
 * 1. advancedOrders/advancedOrdersAlerts.js
 *    - Web Audio API synthesizer chimes and scheduled delivery urgency watchdog.
 *    - `playReminderAlarm` & `stopReminderAlarm`: Dual-tone oscillating alarm chime.
 *    - `checkScheduledDeliveryAlerts`: Scans pending orders every 15s to display
 *      color-coded countdown warning banners (30m blue, 15m amber, 5m red pulse).
 *    - `addOrderToPhoneCalendar`: Formats Google Calendar export links.
 * 
 * 2. advancedOrders/advancedOrdersRiderModal.js
 *    - Dynamic rider lookup and assignment modal interface.
 *    - `getRidersAvailableOnDate`: Cross-references active roster members, logins,
 *      and completed receipts for the date the order was placed.
 *    - `promptRiderNameInModal`: In-app dropdown prompt modal for selecting riders.
 * 
 * 3. advancedOrders/advancedOrdersActions.js
 *    - Order lifecycle transitions and database mutations.
 *    - `submitNewAdvancedOrder`: Handles creation and updates for scheduled orders.
 *    - `editAdvancedOrder`: Pre-populates the schedule form with order details.
 *    - `takeAdvancedOrder` & `markAdvancedOrderDone`: Assigns catering riders or marks done.
 *    - `changeAdvOrderStatus`: General status changer (Cancel, Restore, Reopen).
 *    - `autoCompleteAdvancedOrdersForRider` & `autoCancelAdvancedOrdersForRider`:
 *      Batch lifecycle terminators called on shift completion or cancellation.
 * 
 * 4. advancedOrders/advancedOrdersUI.js
 *    - User interface views, list rendering, gestures, and deletion controls.
 *    - `switchAdvTab` & `resetAddTabButtonState`: Toggles between List and Add views.
 *    - `renderAdvancedOrdersList`: Builds the bulk toolbar and swipable order cards.
 *    - `attachSwipeGesturesToCards`: Touch and drag listeners for swipe-to-delete.
 *    - `toggleSelectAdvancedOrder` & `toggleSelectAllAdvancedOrders`: Checkbox selection state.
 *    - `promptDeleteSingleAdvancedOrder` & `promptDeleteSelectedAdvancedOrders`:
 *      Single and bulk deletion workflows guarded by slide-to-confirm modal protection.
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

    setInterval(advancedOrdersAlerts.checkScheduledDeliveryAlerts, 15000);
}