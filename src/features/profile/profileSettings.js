// src/features/profile/profileSettings.js
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