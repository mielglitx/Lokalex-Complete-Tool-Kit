// src/features/storeHub/ui/menu/storeMenuCategories.js

/**
 * ============================================================================
 * STORE MENU CATEGORIES FACADE & EVENT BINDER
 * ============================================================================
 * 
 * Central barrel module aggregating all category-related subsystems.
 * Exposes core sorting, modal CRUD operations, interactive reordering, and
 * customer menu previews to the global window scope for inline HTML handlers.
 * 
 * Sub-Module Functional Breakdown:
 * ----------------------------------------------------------------------------
 * 1. categoryCore.js
 *    - Category data sorting (orderIndex fallback to createdAt).
 *    - Horizontal category pill navigation rendering and active filtering.
 *    - Item modal dropdown synchronization and quick-add prompts.
 * 
 * 2. categoryModal.js
 *    - Add/Edit category modal lifecycle and form validation.
 *    - Add-on rule configuration ("Required", "Single Choice").
 *    - Deletion confirmation modals with cascade fallbacks to "General".
 * 
 * 3. categoryReorder.js
 *    - Drag-and-drop category arrangement (supporting touch and mouse).
 *    - FLIP reorder animations and manual up/down index shifting.
 *    - Automated sorting presets (Alphabetical, Newest first).
 *    - Batch orderIndex synchronization with Firebase.
 * 
 * 4. categoryPreview.js
 *    - Real-time customer storefront simulation using merchant state.
 *    - Read-only customer view modal mounting with order placement disabled.
 * ============================================================================
 */

import * as categoryCore from './categoryCore.js';
import * as categoryModal from './categoryModal.js';
import * as categoryReorder from './categoryReorder.js';
import * as categoryPreview from './categoryPreview.js';

export * from './categoryCore.js';
export * from './categoryModal.js';
export * from './categoryReorder.js';
export * from './categoryPreview.js';

// Global window attachment for HTML onclick/onchange attributes
if (typeof window !== 'undefined') {
    const modules = [categoryCore, categoryModal, categoryReorder, categoryPreview];
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