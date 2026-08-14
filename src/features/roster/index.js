// src/features/roster/index.js
import * as rosterUtils from './rosterUtils.js';
import * as rosterUI from './rosterUI.js';
import * as rosterActions from './rosterActions.js';
import * as rosterAdmin from './rosterAdmin.js';
import * as rosterSwap from './rosterSwap.js';

export * from './rosterUtils.js';
export * from './rosterUI.js';
export * from './rosterActions.js';
export * from './rosterAdmin.js';
export * from './rosterSwap.js';

// Bind all roster functions globally for HTML template event listeners
if (typeof window !== 'undefined') {
    const modules = [rosterUtils, rosterUI, rosterActions, rosterAdmin, rosterSwap];
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