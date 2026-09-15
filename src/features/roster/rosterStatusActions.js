// src/features/roster/rosterStatusActions.js

/**
 * ============================================================================
 * ROSTER STATUS ACTIONS (FACADE BARREL MODULE)
 * ============================================================================
 * 
 * MODULE ARCHITECTURE & RESPONSIBILITIES:
 * 
 * 1. actions/rosterAlarms.js
 *    - Queue alarm monitoring and 1st-in-line rotation alerts.
 *    - `getTopQueueTime`: Computes the timestamp for prioritizing next in line.
 *    - `dismissQueueAlarm`: Mutes and dismisses active queue audio alerts.
 *    - `checkFirstInLineNotification`: Triggers chime/modal when the rider reaches 1st position.
 * 
 * 2. actions/rosterCateringCompletion.js
 *    - Per-customer delivery finalization and administrative order voiding.
 *    - `completeSingleCateringCustomer`: Enforces receipt verification, credits rider fees,
 *      logs to catered history, and transitions rider to Available when all orders finish.
 *    - `voidSingleCateringCustomer`: Cancels customer order, updates chat metadata, and cleans fees.
 *    - `adminVoidSpecificCustomer`: Administrative wrapper with slide-delete modal verification
 *      for Admins and authorized Team Leads.
 * 
 * 3. actions/rosterStatusSlider.js
 *    - Physical slide interaction controller for Rider state transitions.
 *    - `triggerStatusWithSlide`: Handles shift Time-In with GPS calibration, penalty cooldown,
 *      shift ending (clock-out), and breaks while validating active session receipts.
 * 
 * 4. actions/rosterCateringPrompts.js
 *    - Dispatch initiation, rotation turn validation, and booking limits.
 *    - `promptCateringStatus`: Validates line order and limits before opening customer modal.
 *    - `confirmCateringStatus`: Commits customer assignment to Firebase RTDB and starts live tracking.
 * 
 * 5. actions/rosterCustomerClaim.js
 *    - Order transfer and delegation handshake between on-duty riders.
 *    - `claimCustomerFromRider`: Dispatches an interactive transfer request for rider approval.
 * ============================================================================
 */

import * as rosterAlarms from './actions/rosterAlarms.js';
import * as rosterCateringCompletion from './actions/rosterCateringCompletion.js';
import * as rosterStatusSlider from './actions/rosterStatusSlider.js';
import * as rosterCateringPrompts from './actions/rosterCateringPrompts.js';
import * as rosterCustomerClaim from './actions/rosterCustomerClaim.js';

export * from './actions/rosterAlarms.js';
export * from './actions/rosterCateringCompletion.js';
export * from './actions/rosterStatusSlider.js';
export * from './actions/rosterCateringPrompts.js';
export * from './actions/rosterCustomerClaim.js';

// Bind all status action functions globally for backward compatibility with HTML onclicks
if (typeof window !== 'undefined') {
    const modules = [
        rosterAlarms,
        rosterCateringCompletion,
        rosterStatusSlider,
        rosterCateringPrompts,
        rosterCustomerClaim
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