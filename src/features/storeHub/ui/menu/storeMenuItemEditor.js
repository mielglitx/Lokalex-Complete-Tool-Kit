// src/features/storeHub/ui/menu/storeMenuItemEditor.js

/**
 * ============================================================================
 * STORE MENU ITEM EDITOR (FACADE BARREL MODULE)
 * ============================================================================
 * 
 * MODULE ARCHITECTURE & RESPONSIBILITIES:
 * 
 * 1. itemEditorFormState.js
 *    - Manages dynamic form input behaviors and validation indicators.
 *    - `updateBasePriceVoidState`: Automatically locks base price input to 0 when
 *      one or more size variants are defined, updating the visual label indicator.
 *    - `updateAddonsSectionState`: Dynamically hides the add-ons configuration
 *      panel when editing an item that belongs to an add-on category to prevent
 *      recursive add-ons.
 * 
 * 2. itemEditorVariants.js
 *    - Handles rendering and DOM row management for sizes and add-ons.
 *    - `addSizeVariantRow`: Appends interactive size rows (name, standalone price,
 *      and add-on specific override price).
 *    - `addCustomAddonRow` / `addAddonRow`: Appends ad-hoc extras directly to the item.
 *    - `renderAddonGroupsSelection`: Scans registered add-on categories and products,
 *      rendering multi-select groups with "Required" and "Single Choice" rules.
 * 
 * 3. itemEditorLifecycle.js
 *    - Orchestrates modal workflows and persistence.
 *    - `openItemEditorModal` & `closeItemEditorModal`: Populates input fields, categories,
 *      and previews when adding or editing items.
 *    - `editMenuItemModal`: Target lookup helper by item ID.
 *    - `submitSaveStoreItem`: Collects sizes, grouped add-ons, and photo data, then writes
 *      the clean payload to Firebase via `saveMenuItem`.
 * ============================================================================
 */

import * as itemEditorFormState from './itemEditorFormState.js';
import * as itemEditorVariants from './itemEditorVariants.js';
import * as itemEditorLifecycle from './itemEditorLifecycle.js';

export * from './itemEditorFormState.js';
export * from './itemEditorVariants.js';
export * from './itemEditorLifecycle.js';

// Global window attachments for backward compatibility with HTML template onclicks
if (typeof window !== 'undefined') {
    const modules = [itemEditorFormState, itemEditorVariants, itemEditorLifecycle];
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