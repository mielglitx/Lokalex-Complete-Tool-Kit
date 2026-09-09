// src/features/profile/profileSettings.js

/**
 * ============================================================================
 * PROFILE SETTINGS FEATURE BARREL & EVENT BINDER
 * ============================================================================
 * 
 * Central facade module for account and profile management. Coordinates
 * role-based profile modals, avatar compression, SMS OTP verification,
 * database updates, and universal session logouts across Customers, Merchants,
 * and Riders. Exposes interfaces to the global `window` object for inline HTML
 * event attributes.
 * 
 * Sub-Module Functional Breakdown:
 * ----------------------------------------------------------------------------
 * 1. profileState.js
 *    - In-memory state tracking (`profileState`) for active forms and OTP status.
 *    - Role resolver (`getActiveSessionRole`) determining customer, merchant, or rider.
 * 
 * 2. profileUI.js
 *    - Dynamic modal form population fetching live records from Firebase.
 *    - Role-specific UI adaptation, password visibility toggles, and GPS map pinning.
 * 
 * 3. profileOtp.js
 *    - Mobile number mutation monitoring and input formatting.
 *    - Firebase Phone Authentication with reCAPTCHA verification and 6-digit SMS confirmation.
 * 
 * 4. profileAvatar.js
 *    - Canvas-based image resizing and compression (256x256 max, 85% JPEG quality).
 *    - Fallback initials avatar generator via UI-Avatars API.
 * 
 * 5. profileSave.js
 *    - Multi-role profile persistence across Firebase (`customers`, `stores`, `riders`, `roster`).
 *    - Universal logout purging role tokens, stopping GPS tracking, and resetting runtime state.
 * ============================================================================
 */

import * as profileState from './profileState.js';
import * as profileUI from './profileUI.js';
import * as profileOtp from './profileOtp.js';
import * as profileAvatar from './profileAvatar.js';
import * as profileSave from './profileSave.js';

export * from './profileState.js';
export * from './profileUI.js';
export * from './profileOtp.js';
export * from './profileAvatar.js';
export * from './profileSave.js';

// Global window attachments for inline template handlers
if (typeof window !== 'undefined') {
    const modules = [profileState, profileUI, profileOtp, profileAvatar, profileSave];
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