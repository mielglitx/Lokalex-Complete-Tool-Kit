// src/features/roster/index.js
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
    const modules = [rosterUtils, rosterUI, rosterStatus, rosterAdminOps, rosterAccounts, rosterAdmin, rosterSwap];
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