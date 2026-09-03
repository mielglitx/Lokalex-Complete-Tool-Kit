// src/features/roster/rosterStatus.js
import * as rosterCaterOcr from './rosterCaterOcr.js';
import * as rosterStatusLimits from './rosterStatusLimits.js';
import * as rosterStatusCore from './rosterStatusCore.js';
import * as rosterStatusActions from './rosterStatusActions.js';

export * from './rosterCaterOcr.js';
export * from './rosterStatusLimits.js';
export * from './rosterStatusCore.js';
export * from './rosterStatusActions.js';

// Global window attachments for backward compatibility with HTML onclicks and system callers
if (typeof window !== 'undefined') {
    const modules = [rosterCaterOcr, rosterStatusLimits, rosterStatusCore, rosterStatusActions];
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