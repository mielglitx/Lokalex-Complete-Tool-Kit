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
    // 1. Prioritize currently active visible view
    const currentView = document.querySelector('main > section:not(.hidden)')?.id;
    if (currentView === 'view-store-hub') return 'merchant';
    if (currentView === 'view-customer-home') return 'customer';
    if (currentView === 'view-home') return 'rider';

    // 2. Check explicit session role token
    const activeRole = localStorage.getItem('lokalex_active_role');
    if (activeRole) return activeRole;

    // 3. Fallback credential detection
    if (appState.telegramId || localStorage.getItem('telegramId')) {
        return 'rider';
    }
    if (appState.merchantAccountId || localStorage.getItem('lokalex_merchant_account_id') || localStorage.getItem('lokalex_merchant_store_id')) {
        return 'merchant';
    }
    return 'customer';
}