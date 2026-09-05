// src/features/profile/profileState.js
import { appState } from '../../store/state.js';

export const profileState = {
    activeRole: 'customer', // 'customer' | 'merchant' | 'rider'
    originalPhoneNumber: '',
    isPhoneModified: false,
    isPhoneOtpVerified: false,
    phoneConfirmationResult: null,
    currentAvatarUrl: ''
};

export function getActiveSessionRole() {
    if (appState.telegramId || localStorage.getItem('telegramId')) {
        return 'rider';
    }
    if (appState.merchantAccountId || localStorage.getItem('lokalex_merchant_account_id')) {
        return 'merchant';
    }
    return 'customer';
}