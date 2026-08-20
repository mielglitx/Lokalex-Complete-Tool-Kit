// src/features/commission/index.js
import * as commissionRates from './commissionRates.js';
import * as commissionUI from './commissionUI.js';
import * as commissionAdmin from './commissionAdmin.js';
import * as commissionRecords from './commissionRecords.js';

export * from './commissionRates.js';
export * from './commissionUI.js';
export * from './commissionAdmin.js';
export * from './commissionRecords.js';

// Global window binding for HTML event handlers and backward compatibility
if (typeof window !== 'undefined') {
    const modules = [commissionRates, commissionUI, commissionAdmin, commissionRecords];
    modules.forEach(mod => {
        if (mod) {
            Object.keys(mod).forEach(fn => {
                if (typeof mod[fn] === 'function') {
                    window[fn] = mod[fn];
                }
            });
        }
    });

    window.addEventListener('receiptsUpdated', commissionUI.refreshCommissionView);
    window.addEventListener('cateredUpdated', commissionUI.refreshCommissionView);
}