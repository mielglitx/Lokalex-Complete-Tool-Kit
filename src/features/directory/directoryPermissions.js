// src/features/directory/directoryPermissions.js
import { appState } from '../../store/state.js';
import { ADMIN_IDS } from '../../config/constants.js';
import { isRiderAdmin } from '../commission/index.js';

/**
 * Validates whether the active session has administrative privileges.
 * Checks userType roles, hardcoded ADMIN_IDS, or rider commission admin status.
 */
export function checkAdminAccess() {
    const uType = (appState.userType || localStorage.getItem('userType') || "").toString().trim().toLowerCase();
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim();

    if (uType.includes("admin") || uType.includes("owner") || uType.includes("manager") || ADMIN_IDS.includes(myId)) {
        return true;
    }

    if (typeof isRiderAdmin === 'function') {
        return isRiderAdmin(myName, myId);
    }

    return false;
}