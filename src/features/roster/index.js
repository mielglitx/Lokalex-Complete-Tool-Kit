// src/features/roster/index.js

/**
 * ============================================================================
 * ROSTER FEATURE BARREL & GLOBAL LIFECYCLE ORCHESTRATOR
 * ============================================================================
 * 
 * Central facade for the rider dispatch roster system. Aggregates utilities,
 * lineup presentations, status state machines, admin operations, account
 * provisioning, and peer-to-peer customer order swap mechanics. Automatically
 * binds all exported interfaces to the global `window` object for HTML template
 * compatibility.
 * 
 * Sub-Module Architecture & Responsibilities:
 * ----------------------------------------------------------------------------
 * 1. rosterUtils.js
 *    - Core utility foundation, date/time formatting, and cache persistence.
 *    - Role identification (Admin, TL, Rider) and granular TL privilege guards.
 *    - Financial truth engine: commission aggregation and gross-earnings lineup sorting.
 *    - Catering session archiving and Web Audio first-in-line acoustic alarms.
 * 
 * 2. rosterUI.js (Facade)
 *    - Sub-barrel for roster view components (badges, inspect modal, lineup board, feeds).
 *    - Event orchestration listening to updates for roster, receipts, and logins.
 * 
 * 3. rosterStatus.js (Facade)
 *    - Sub-barrel governing rider status transitions (Available, Catering, Break, End).
 *    - Integrates OCR ticket parsing, booking capacity limits, and clock-out logic.
 * 
 * 4. rosterAdminOps.js / rosterAdmin.js
 *    - Administrative control suite: Force Catering assignments and manual status overrides.
 *    - Lineup queue shifting (Top, Bottom, Up, Down) and global shift termination.
 *    - Cascading void operations across `roster`, `receipts`, and `cateredHistory`.
 *    - Re-exports scheduling, day-off pickers, booking caps, and auto-end shift tasks.
 * 
 * 5. rosterAccounts.js
 *    - Rider account management: account provisioning, user types, and deletions.
 *    - Team Lead (TL) permissions matrix manager for fine-grained supervisory rights.
 * 
 * 6. rosterSwap.js
 *    - Peer-to-peer order handoffs: 1-to-1 customer swaps, direct transfers, and claims.
 *    - Real-time swap negotiation listener with capacity validation checks.
 *    - Atomic multi-node Firebase transaction execution updating roster and chat routing.
 * ============================================================================
 */

import * as rosterUtils from './rosterUtils.js';
import * as rosterUI from './rosterUI.js';
import * as rosterStatus from './rosterStatus.js';
import * as rosterAdminOps from './rosterAdminOps.js';
import * as rosterAccounts from './rosterAccounts.js';
import * as rosterAdmin from './rosterAdmin.js';
import * as rosterSwap from './rosterSwap.js';

export * from './rosterUtils.js';
export * from './rosterUI.js';
export * from './rosterStatus.js';
export * from './rosterAdminOps.js';
export * from './rosterAccounts.js';
export * from './rosterAdmin.js';
export * from './rosterSwap.js';

// Bind all roster functions globally for HTML template event listeners
if (typeof window !== 'undefined') {
    const modules = [
        rosterUtils, 
        rosterUI, 
        rosterStatus, 
        rosterAdminOps, 
        rosterAccounts, 
        rosterAdmin, 
        rosterSwap
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