// src/features/roster/rosterUI.js

/**
 * ============================================================================
 * ROSTER UI MANAGEMENT (FACADE BARREL MODULE)
 * ============================================================================
 * 
 * MODULE ARCHITECTURE & RESPONSIBILITIES:
 * 
 * 1. ui/rosterBadge.js
 *    - Universal badge renderer for forced catering orders.
 *    - `getForcedCaterBadgeHtml`: Scans customer records for forced catering
 *      audit entries and renders scoped indicators (Self vs. Admin/TL assigned).
 * 
 * 2. ui/rosterRiderModal.js
 *    - Detailed profile inspector modal for individual riders.
 *    - `openRiderInfoModal` & `closeRiderInfoModal`: Displays live duty status,
 *      role privileges, daily gross earnings, active catering orders, contact
 *      numbers, and live GCash details fetched from Firebase.
 * 
 * 3. ui/rosterLineupView.js
 *    - Main roster board renderer and status lineup controller.
 *    - `openFindRidersMap`: Opens the geospatial rider search map.
 *    - `updateRosterUI`: Renders the Available lineup (sorted by gross earnings),
 *      Catering cards with multi-customer order actions (Link, Map, Swap, Get, Void),
 *      Break cards, Cooldown countdowns, and scheduled Day-Off badges.
 * 
 * 4. ui/rosterFeeds.js
 *    - Global daily activity audit logs and timeline feeds.
 *    - `loadGlobalCateredList`: Renders chronological completed deliveries with
 *      dynamic split duration calculations and admin void actions.
 *    - `loadGlobalLoginList`: Renders daily rider shift time-ins, clock-outs,
 *      and GPS location verification pins.
 * ============================================================================
 */

import * as rosterBadge from './ui/rosterBadge.js';
import * as rosterRiderModal from './ui/rosterRiderModal.js';
import * as rosterLineupView from './ui/rosterLineupView.js';
import * as rosterFeeds from './ui/rosterFeeds.js';

export * from './ui/rosterBadge.js';
export * from './ui/rosterRiderModal.js';
export * from './ui/rosterLineupView.js';
export * from './ui/rosterFeeds.js';

// Global window attachments for backward compatibility with HTML template onclicks
if (typeof window !== 'undefined') {
    const modules = [rosterBadge, rosterRiderModal, rosterLineupView, rosterFeeds];
    modules.forEach(mod => {
        if (mod) {
            Object.keys(mod).forEach(fn => {
                if (typeof mod[fn] === 'function') {
                    window[fn] = mod[fn];
                }
            });
        }
    });

    window.addEventListener('rosterUpdated', rosterLineupView.updateRosterUI);
    window.addEventListener('cateredUpdated', rosterFeeds.loadGlobalCateredList);
    window.addEventListener('receiptsUpdated', rosterFeeds.loadGlobalCateredList);
    window.addEventListener('loginsUpdated', rosterFeeds.loadGlobalLoginList);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            rosterFeeds.loadGlobalCateredList();
            rosterFeeds.loadGlobalLoginList();
        });
    } else {
        rosterFeeds.loadGlobalCateredList();
        rosterFeeds.loadGlobalLoginList();
    }
}