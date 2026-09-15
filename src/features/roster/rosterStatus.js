// src/features/roster/rosterStatus.js

/**
 * ============================================================================
 * ROSTER STATUS & LIFECYCLE BARREL MODULE
 * ============================================================================
 * 
 * Central coordinator for rider status lifecycles, booking validation, and
 * dispatch automation. Aggregates OCR extraction, dynamic booking constraints,
 * Firebase state persistence, and interactive action handlers.
 * 
 * Sub-Module Functional Breakdown:
 * ----------------------------------------------------------------------------
 * 1. rosterCaterOcr.js
 *    - Tesseract OCR integration (English & Japanese) for chat screenshots.
 *    - Automatic image contrast stretching, dark/light theme compensation, and ROI header cropping.
 *    - Smart text parsing and noise-word filtering to extract customer names.
 * 
 * 2. rosterStatusLimits.js
 *    - Dynamic earnings-based booking limits (tiered 1 to 4 active orders).
 *    - Capacity limit checks before taking or receiving order assignments.
 *    - Scheduled time-in verification with early pass exceptions.
 * 
 * 3. rosterStatusCore.js
 *    - Firebase mutation layer for rider roster records (`roster/`).
 *    - Queue position recalculation and bottom-of-line indexing.
 *    - Shift time-in / clock-out persistence (`logins/`) and onDisconnect hooks.
 * 
 * 4. rosterStatusActions.js (Facade)
 *    - Sub-barrel for user-driven interactions and workflow transitions.
 *    - Aggregates status slider gestures, catering prompts, delivery completion,
 *      queue audio alarms, and customer claim negotiations.
 * ============================================================================
 */

import * as rosterCaterOcr from './rosterCaterOcr.js';
import * as rosterStatusLimits from './rosterStatusLimits.js';
import * as rosterStatusCore from './rosterStatusCore.js';
import * as rosterStatusActions from './rosterStatusActions.js';

export * from './rosterCaterOcr.js';
export * from './rosterStatusLimits.js';
export * from './rosterStatusCore.js';
export * from './rosterStatusActions.js';

// Global window attachments for HTML event handlers and system callers
if (typeof window !== 'undefined') {
    const modules = [
        rosterCaterOcr, 
        rosterStatusLimits, 
        rosterStatusCore, 
        rosterStatusActions
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