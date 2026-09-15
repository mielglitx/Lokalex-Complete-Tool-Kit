// src/features/commission/index.js

/**
 * ============================================================================
 * COMMISSION SYSTEM FEATURE BARREL & COORDINATOR
 * ============================================================================
 * 
 * Central facade for rider commission calculations, financial ledgers,
 * administrative overrides, and settlement reporting. Re-exports all sub-modules
 * and binds methods to the global `window` object for HTML template interaction.
 * 
 * Sub-Module Functional Breakdown:
 * ----------------------------------------------------------------------------
 * 1. commissionRates.js
 *    - Commission calculation engine resolving net percentages per rider/date.
 *    - Admin commission exemption logic (0% company, 100% rider earnings).
 *    - Dynamic rate computation combining custom overrides, penalties, and promos.
 *    - Cache persistence and real-time listeners for Firebase settings.
 * 
 * 2. commissionUI.js
 *    - Commission dashboard views, mode toggles (Earned vs. Company Dues).
 *    - Time period aggregation (Daily, Weekly, Monthly) and rider accordions.
 *    - Settlement verification (PAID / UNPAID status) and clipboard report export.
 *    - Multi-rider administrative filtering and dashboard initialization.
 * 
 * 3. commissionAdmin.js
 *    - Admin modal configurations for global base rates and weekly recurring promos.
 *    - Per-rider commission rate override management and reset actions.
 *    - Calendar promo date scheduler (holiday discounts).
 *    - Firebase synchronization for `settings/commission`.
 * 
 * 4. commissionRecords.js
 *    - Punitive commission additions (+X% date penalties) and removals.
 *    - Manual commission record creation for off-system delivery orders.
 *    - Isolated, single-ID deletion of order records from receipts and history.
 *    - Inline gross fee adjustments for individual customer delivery entries.
 * ============================================================================
 */

import * as commissionRates from './commissionRates.js';
import * as commissionUI from './commissionUI.js';
import * as commissionAdmin from './commissionAdmin.js';
import * as commissionRecords from './commissionRecords.js';

export * from './commissionRates.js';
export * from './commissionUI.js';
export * from './commissionAdmin.js';
export * from './commissionRecords.js';

// Global window binding for HTML event handlers and backward compatibility
if (typeof window !== 'undefined') {
    const modules = [
        commissionRates, 
        commissionUI, 
        commissionAdmin, 
        commissionRecords
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

    // Re-render commission ledger view whenever receipts or catering records change
    window.addEventListener('receiptsUpdated', commissionUI.refreshCommissionView);
    window.addEventListener('cateredUpdated', commissionUI.refreshCommissionView);
}