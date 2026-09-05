// src/features/wizard.js
import * as wizardCalc from './wizard/wizardCalc.js';
import * as wizardCore from './wizard/wizardCore.js';
import * as wizardTextReceipt from './wizard/wizardTextReceipt.js';
import * as wizardImageReceipt from './wizard/wizardImageReceipt.js';

export * from './wizard/wizardCalc.js';
export * from './wizard/wizardCore.js';
export * from './wizard/wizardTextReceipt.js';
export * from './wizard/wizardImageReceipt.js';

if (typeof window !== 'undefined') {
    const modules = [wizardCalc, wizardCore, wizardTextReceipt, wizardImageReceipt];
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