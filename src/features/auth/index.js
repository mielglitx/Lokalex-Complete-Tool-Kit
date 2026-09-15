// src/features/auth/index.js

/**
 * ============================================================================
 * AUTHENTICATION FEATURE BARREL & SESSION COORDINATOR
 * ============================================================================
 * 
 * Central entry point for all authentication, authorization, and location
 * services across Riders, Customers, and Administrators. Re-exports sub-modules,
 * auto-initializes background GPS for active rider sessions, and binds methods
 * to the global window scope for inline HTML event attributes.
 * 
 * Sub-Module Architecture & Functional Breakdown:
 * ----------------------------------------------------------------------------
 * 1. authUtils.js
 *    - Mobile number sanitization, validation, and +63 format conversion.
 *    - Portal and customer login/register tab-switching utilities.
 *    - Password field visibility toggles (plain text / masked).
 *    - Invisible reCAPTCHA verifier initialization for Firebase Phone Auth.
 * 
 * 2. authGps.js
 *    - Device GPS calibration engine with high-accuracy multi-sampling.
 *    - Throttled background GPS tracker publishing updates to Firebase every 25s.
 *    - Map picker launchers for customer chats, registrations, and profile pins.
 * 
 * 3. authAdmin.js
 *    - User restriction checks enforcing blocked states during login attempts.
 *    - Administrative block modal, rider account selector, and list rendering.
 *    - Firebase mutation handlers for adding and removing blocked user entries.
 * 
 * 4. authCustomer.js
 *    - Customer phone-number registration with SMS OTP confirmation.
 *    - Synthetic email/password linking for Firebase Auth account persistence.
 *    - Password recovery flows (SMS OTP verification and email reset links).
 *    - Profile detail editing with OTP verification for mobile number changes.
 *    - Customer session initialization and cross-role credential cleanup.
 * 
 * 5. authRider.js
 *    - Rider ID and password validation against the database with block guards.
 *    - First-time password setup redirection and PWA installation prompt handling.
 *    - GPS calibration and background tracker startup on successful login.
 *    - Complete logout workflow stopping location services and purging storage.
 * ============================================================================
 */

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

// Auto-boot background GPS and GCash cache for persistent rider sessions
if (appState.telegramId) {
    fetchGCashDetails();
    authGps.startBackgroundRosterGpsTracker();
}

// Global window binding for HTML event handlers and backward compatibility
if (typeof window !== 'undefined') {
    const modules = [
        authUtils, 
        authGps, 
        authAdmin, 
        authCustomer, 
        authRider
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