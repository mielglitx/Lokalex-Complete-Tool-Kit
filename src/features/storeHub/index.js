// src/features/storeHub/index.js
import * as storeAdmin from './storeAdmin.js';
import * as storeAuth from './storeAuth.js';
import * as storeMenu from './storeMenu.js';
import * as storeUI from './storeUI.js';

export * from './storeAdmin.js';
export * from './storeAuth.js';
export * from './storeMenu.js';
export * from './storeUI.js';

// Global window binding for HTML event handlers
if (typeof window !== 'undefined') {
    const modules = [storeAdmin, storeAuth, storeMenu, storeUI];
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