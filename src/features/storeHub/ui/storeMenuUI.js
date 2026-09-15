// src/features/storeHub/ui/storeMenuUI.js

/**
 * ============================================================================
 * STORE MENU UI MASTER FACADE & EVENT BINDER
 * ============================================================================
 * 
 * Central entry point for all merchant menu interface operations. Aggregates
 * category navigation, item feeds, photo compression, and modal item editors,
 * exposing all methods to the global `window` scope for HTML event handlers.
 * 
 * Sub-Module Functional Breakdown:
 * ----------------------------------------------------------------------------
 * 1. menu/storeMenuCategories.js (Facade)
 *    - Sub-barrel for category workflows (core, modals, reordering, and preview).
 *    - Manages category tabs, sorting logic, and category configuration modals.
 * 
 * 2. menu/storeMenuItemsFeed.js
 *    - Renders the product card feed categorized by custom sort orders.
 *    - Displays dynamic pricing (base or size delta ranges) and item photos.
 *    - In-line availability toggles for items, individual sizes, and extra add-ons.
 *    - Delete confirmation prompts with modal integration.
 * 
 * 3. menu/storeMenuItemPhoto.js
 *    - Handles item photo selection, client-side Canvas compression (400x400),
 *      and Base64 encoding.
 *    - Manages direct image URL preview updates and image reset workflows.
 * 
 * 4. menu/storeMenuItemEditor.js (Facade)
 *    - Sub-barrel for item create/edit modal forms and business validation.
 *    - Coordinates dynamic form state (base price voiding, add-on suppression),
 *      variant/extra row rendering, and payload compilation for Firebase saves.
 * ============================================================================
 */

import * as categoriesMod from './menu/storeMenuCategories.js';
import * as feedMod from './menu/storeMenuItemsFeed.js';
import * as photoMod from './menu/storeMenuItemPhoto.js';
import * as editorMod from './menu/storeMenuItemEditor.js';

export * from './menu/storeMenuCategories.js';
export * from './menu/storeMenuItemsFeed.js';
export * from './menu/storeMenuItemPhoto.js';
export * from './menu/storeMenuItemEditor.js';

// Global window attachments for HTML event handlers
if (typeof window !== 'undefined') {
    const modules = [categoriesMod, feedMod, photoMod, editorMod];
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