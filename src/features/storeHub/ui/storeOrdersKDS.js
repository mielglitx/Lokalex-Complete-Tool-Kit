// src/features/storeHub/ui/storeOrdersKDS.js
import * as storeOrdersPrint from './storeOrdersPrint.js';
import * as storeOrdersActions from './storeOrdersActions.js';
import * as storeOrdersSubstitution from './storeOrdersSubstitution.js';
import * as storeOrdersRender from './storeOrdersRender.js';

export * from './storeOrdersPrint.js';
export * from './storeOrdersActions.js';
export * from './storeOrdersSubstitution.js';
export * from './storeOrdersRender.js';

// Global window attachment for backward compatibility with HTML onclicks
if (typeof window !== 'undefined') {
    const modules = [
        storeOrdersPrint, 
        storeOrdersActions, 
        storeOrdersSubstitution, 
        storeOrdersRender
    ];
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