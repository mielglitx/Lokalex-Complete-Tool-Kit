// src/features/auth/index.js
import { appState } from '../../store/state.js';
import { fetchGCashDetails } from '../../ui/modals.js';

import * as authUtils from './authUtils.js';
import * as authGps from './authGps.js';
import * as authAdmin from './authAdmin.js';
import * as authCustomer from './authCustomer.js';
import * as authRider from './authRider.js';

export * from './authUtils.js';
export * from './authGps.js';
export * from './authAdmin.js';
export * from './authCustomer.js';
export * from './authRider.js';

if (appState.telegramId) {
    fetchGCashDetails();
    authGps.startBackgroundRosterGpsTracker();
}

// Global window binding for HTML event handlers and backward compatibility
if (typeof window !== 'undefined') {
    const modules = [authUtils, authGps, authAdmin, authCustomer, authRider];
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