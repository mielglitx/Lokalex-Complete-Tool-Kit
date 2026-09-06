// src/features/storeHub/ui/storeMenuUI.js
// MASTER FACADE FOR STORE MENU MANAGEMENT
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