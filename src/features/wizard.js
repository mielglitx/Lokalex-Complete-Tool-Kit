// src/features/wizard.js

/**
 * ============================================================================
 * ORDER CHECKOUT & RECEIPT WIZARD BARREL MODULE
 * ============================================================================
 * 
 * Central coordinator for the checkout wizard workflow. Aggregates fee
 * calculations, receipt persistence, clipboard formatting, and Canvas-rendered
 * image receipts, exposing all methods to the global `window` scope for HTML 
 * event attributes.
 * 
 * Sub-Module Functional Architecture:
 * ----------------------------------------------------------------------------
 * 1. wizard/wizardCalc.js
 *    - Real-time pricing calculations, fee algorithms, and client assignment.
 *    - Tiered market fee (₱15/₱500) and handling fee (₱10/₱500) formulas.
 *    - Multi-stop store counter and percentage/amount discount computations.
 *    - GCash electronic transfer surcharge tier calculations.
 * 
 * 2. wizard/wizardCore.js
 *    - Checkout validation (delivery fee checks, sample receipt handling).
 *    - Firebase synchronization across `receipts`, `cateredHistory`, and `roster`.
 *    - Order finalization: locks the active cart slot and writes receipt summaries.
 * 
 * 3. wizard/wizardTextReceipt.js
 *    - Plain-text and Markdown receipt generator with payment info.
 *    - One-click clipboard copy utility for customer chat messaging.
 * 
 * 4. wizard/wizardImageReceipt.js
 *    - 3x Ultra-HD HTML5 Canvas rendering of physical-style thermal receipts.
 *    - Dynamic QR code generation for GCash account scanning with quiet zones.
 *    - Cross-platform image downloads via Web Share API and blob anchors.
 * ============================================================================
 */

import * as wizardCalc from './wizard/wizardCalc.js';
import * as wizardCore from './wizard/wizardCore.js';
import * as wizardTextReceipt from './wizard/wizardTextReceipt.js';
import * as wizardImageReceipt from './wizard/wizardImageReceipt.js';

export * from './wizard/wizardCalc.js';
export * from './wizard/wizardCore.js';
export * from './wizard/wizardTextReceipt.js';
export * from './wizard/wizardImageReceipt.js';

// Global window registration for backward compatibility with inline HTML event handlers
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