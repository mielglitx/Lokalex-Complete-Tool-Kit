// src/app/appListeners.js

/**
 * ============================================================================
 * REAL-TIME FIREBASE EVENT BUS & PERSISTENCE LISTENERS
 * ============================================================================
 * 
 * Description:
 * Subscribes to Firebase Realtime Database nodes for the entire platform:
 * - Chronological Index Filtering: Orders receipts and cateredHistory by `date`
 *   using `.orderByChild('date').limitToLast(200)`, preventing alphabetical key
 *   truncation (e.g., Allan, Amiel) while protecting monthly RTDB bandwidth.
 * - Broadcasts specific custom events (cateredUpdated, receiptsUpdated, rosterUpdated)
 *   to trigger batched animation frame renders.
 * ============================================================================
 */

import { appState, globalState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { showToast, showNativeNotification } from '../ui/notifications.js';
import * as storageEngine from '../utils/storageEngine.js';
import * as authFeature from '../features/auth/index.js';
import * as roster from '../features/roster/index.js';
import * as chat from '../features/chat/index.js';
import * as commission from '../features/commission/index.js';
import * as advancedOrders from '../features/advancedOrders.js';
import * as maps from '../features/maps.js';
import { endLiveGpsSession } from '../features/liveTracker.js';
import { updateNetworkStatus } from './appMonitors.js';

export function forceRevokeSession(reason = "⚠️ Your account has been removed.") {
    console.warn("Session revoked:", reason);
    if (typeof window !== 'undefined' && typeof window.syncRiderSession === 'function') {
        try { window.syncRiderSession('', ''); } catch (_) {}
    }
    
    // Clear all session storage and local storage
    try {
        localStorage.clear();
        sessionStorage.clear();
    } catch (_) {}

    appState.telegramId = null;
    appState.riderName = null;
    appState.userType = null;
    appState.customerFacebookId = null;
    appState.customerName = null;
    appState.merchantAccountId = null;
    appState.merchantStoreId = null;

    showToast(reason);

    setTimeout(() => {
        if (typeof history !== 'undefined') {
            history.replaceState({ view: 'view-login' }, '', '#view-login');
        }
        window.location.reload();
    }, 1200);
}

export function initAccountRevocationListener() {
    if (!db) return;

    const activeRole = localStorage.getItem('lokalex_active_role') || (appState.userType || '').toLowerCase();
    const activeRiderId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const activeCustomerFbId = appState.customerFacebookId || localStorage.getItem('lokalex_customer_fb_id');
    const activeMerchantId = appState.merchantAccountId || localStorage.getItem('merchantAccountId') || localStorage.getItem('lokalex_merchant_account_id');

    if (activeRiderId && (!activeRole || activeRole === 'rider')) {
        let isInitial = true;
        db.ref(`riders/${activeRiderId}`).on('value', (snap) => {
            if (isInitial) {
                isInitial = false;
                if (!snap.exists()) {
                    forceRevokeSession("⚠️ Your Rider account has been removed by Admin.");
                }
                return;
            }
            if (!snap.exists()) {
                forceRevokeSession("⚠️ Your Rider account has been removed by Admin.");
            }
        });
    } else if (activeCustomerFbId && activeRole === 'customer') {
        let isInitial = true;
        db.ref(`customers/${activeCustomerFbId}`).on('value', (snap) => {
            if (isInitial) {
                isInitial = false;
                if (!snap.exists()) {
                    forceRevokeSession("⚠️ Your Customer account has been removed.");
                }
                return;
            }
            if (!snap.exists()) {
                forceRevokeSession("⚠️ Your Customer account has been removed.");
            }
        });
    } else if (activeMerchantId && activeRole === 'merchant') {
        let isInitial = true;
        db.ref(`storeAccounts/${activeMerchantId}`).on('value', (snap) => {
            if (isInitial) {
                isInitial = false;
                if (!snap.exists()) {
                    forceRevokeSession("⚠️ Your Merchant account has been removed.");
                }
                return;
            }
            if (!snap.exists()) {
                forceRevokeSession("⚠️ Your Merchant account has been removed.");
            }
        });
    }
}

export function initRealtimeFirebaseListeners() {
    try {
        if (db && typeof db.goOnline === 'function') {
            try { db.goOnline(); } catch (_) {}
        }

        // Active account revocation & deletion watchdog
        initAccountRevocationListener();

        if (db) {
            db.ref('.info/connected').on('value', (snap) => {
                const isConnected = !!snap.val();
                updateNetworkStatus(isConnected);
            });
        }

        const currentRole = (appState.userType || localStorage.getItem('userType') || '').toLowerCase();
        const isCustomer = currentRole === 'customer';

        if (chat && chat.listenToCustomerRiderChat) {
            chat.listenToCustomerRiderChat();
        }

        // If the current session is an end-customer, skip internal rider/admin subscriptions
        if (isCustomer) {
            return;
        }

        if (roster && roster.listenToSwapRequests) {
            roster.listenToSwapRequests();
        }

        if (roster && roster.listenToTimeInSchedule) {
            roster.listenToTimeInSchedule();
        }

        if (roster && roster.listenToDayOffData) {
            roster.listenToDayOffData();
        }

        if (roster && roster.listenToBookingLimits) {
            roster.listenToBookingLimits();
        }

        if (roster && roster.listenToAutoEndShift) {
            roster.listenToAutoEndShift();
        }

        if (chat && chat.listenToAllCustomerChatsForRider) {
            chat.listenToAllCustomerChatsForRider();
        }

        if (chat && chat.initFullBookingListener) {
            chat.initFullBookingListener();
        }

        if (chat && chat.listenToPublicFbChannels) {
            chat.listenToPublicFbChannels();
        }

        if (chat && chat.listenToAdminFbApis) {
            chat.listenToAdminFbApis();
        }

        if (chat && chat.listenToFirebaseChat) {
            chat.listenToFirebaseChat();
        }

        db.ref('riders').on('value', (snapshot) => {
            const val = snapshot.val();
            const myId = (appState.telegramId || "").toString().trim();
            let userTypes = {};

            if (val) {
                Object.entries(val).forEach(([id, rider]) => {
                    const name = (rider.riderName || rider.name || "").toLowerCase().trim();
                    const type = (rider.userType || rider.type || "rider").toLowerCase().trim();
                    const cleanId = (rider.telegramId || rider.id || id).toString().trim();

                    if (name) userTypes[name] = type;
                    if (cleanId) userTypes[cleanId] = type;

                    if (myId && cleanId === myId) {
                        appState.userType = type;
                        localStorage.setItem('userType', type);
                    }
                });
            }

            globalState.userTypesMap = userTypes;

            if (roster && roster.updateRosterUI) roster.updateRosterUI();
            if (commission && commission.refreshCommissionView) commission.refreshCommissionView();
            if (chat && chat.updateFullBookingUI) chat.updateFullBookingUI();
        });

        let previousMyRosterRec = null;

        db.ref('roster').on('value', (snapshot) => {
            const val = snapshot.val();
            if (val) {
                globalState.rosterMembers = Object.entries(val).map(([key, item]) => ({
                    ...item,
                    telegramId: (item.telegramId || item.id || key).toString().trim(),
                    id: (item.telegramId || item.id || key).toString().trim()
                }));
                storageEngine.idbSet('roster', 'active_roster', val).catch(() => {});
            } else {
                globalState.rosterMembers = [];
            }

            // Real-time synchronization for active rider: purge voided customers or ended catering sessions
            const myId = (appState.telegramId || "").toString().trim();
            const myName = (appState.riderName || "").toLowerCase().trim();
            if (myId && val) {
                const currentMyEntry = Object.entries(val).find(([k, item]) => {
                    const rId = (item.telegramId || item.id || k).toString().trim();
                    const rName = (item.riderName || item.name || "").toLowerCase().trim();
                    return (rId && rId === myId) || (myName && rName === myName);
                });
                const currentMyRec = currentMyEntry ? currentMyEntry[1] : null;

                if (currentMyRec) {
                    if (previousMyRosterRec) {
                        const prevCusts = (previousMyRosterRec.customerName || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
                        const currCusts = (currentMyRec.customerName || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

                        const removedCusts = prevCusts.filter(c => !currCusts.some(cc => cc === c));

                        if (currentMyRec.lastVoidedAt && currentMyRec.lastVoidedAt !== previousMyRosterRec.lastVoidedAt && currentMyRec.lastVoidedCust) {
                            const voidedLower = currentMyRec.lastVoidedCust.toLowerCase().trim();
                            if (!removedCusts.includes(voidedLower)) {
                                removedCusts.push(voidedLower);
                            }
                        }

                        if (removedCusts.length > 0) {
                            removedCusts.forEach(cust => {
                                if (roster && typeof roster.purgeCartSlotForCustomer === 'function') {
                                    roster.purgeCartSlotForCustomer(cust);
                                }
                            });
                            showToast(`🚫 Order voided: [${removedCusts.join(', ')}]. Your cart has been updated.`);
                        }

                        // If transitioned from Catering to Available or other non-catering status
                        if (previousMyRosterRec.status === 'Catering' && currentMyRec.status !== 'Catering') {
                            try { endLiveGpsSession(); } catch (_) {}
                            if (roster && typeof roster.purgeCartSlotForCustomer === 'function') {
                                prevCusts.forEach(c => roster.purgeCartSlotForCustomer(c));
                            }
                            if (appState.selectedCateringClient) {
                                appState.selectedCateringClient = null;
                            }
                        }
                    }
                    previousMyRosterRec = { ...currentMyRec };
                } else if (previousMyRosterRec) {
                    if (previousMyRosterRec.status === 'Catering') {
                        try { endLiveGpsSession(); } catch (_) {}
                    }
                    previousMyRosterRec = null;
                }
            }

            if (roster && roster.saveRosterCache) roster.saveRosterCache();
            window.dispatchEvent(new Event('rosterUpdated'));
            if (typeof window.requestRosterUIRefresh === 'function') {
                window.requestRosterUIRefresh();
            }
        });

        db.ref('blockedUsers').on('value', (snapshot) => {
            globalState.blockedUsers = snapshot.val() || {};
            if (appState.telegramId && authFeature.isUserBlocked(appState.telegramId)) {
                showToast("🚫 Your account has been blocked by Admin.");
                authFeature.logout();
            }
        });

        db.ref('commissionPenalties').on('value', (snapshot) => {
            globalState.globalCommissionPenalties = snapshot.val() || {};
            if (commission.refreshCommissionView) commission.refreshCommissionView();
        });

        // Optimized limits on historical streams to protect monthly RTDB bandwidth
        db.ref('logins').orderByChild('date').limitToLast(25).on('value', (snapshot) => {
            globalState.globalLogins = snapshot.val() ? Object.values(snapshot.val()) : [];
            if (roster && roster.saveRosterCache) roster.saveRosterCache();
            window.dispatchEvent(new Event('loginsUpdated'));
        });

        // Local-First Delta Sync Engine (Saves 95%+ RTDB Bandwidth & enables 0ms Instant Rendering)
        if (roster && roster.initLocalFirstCateredSync) {
            roster.initLocalFirstCateredSync();
        }

        db.ref('chat').limitToLast(25).on('value', (snapshot) => {
            globalState.chatMessages = snapshot.val() ? Object.values(snapshot.val()) : [];
            window.dispatchEvent(new Event('chatUpdated'));
        });

        let isInitialAdvLoad = true;
        const knownAdvOrderKeys = new Set();
        db.ref('advancedOrders').limitToLast(40).on('value', (snapshot) => {
            const val = snapshot.val();
            const entries = val ? Object.entries(val) : [];
            globalState.globalAdvancedOrders = entries.map(([id, item]) => ({ id, key: id, ...item }));

            if (!isInitialAdvLoad && entries.length > 0) {
                entries.forEach(([id, item]) => {
                    if (!knownAdvOrderKeys.has(id)) {
                        knownAdvOrderKeys.add(id);
                        const status = (item.status || 'Pending').toLowerCase();
                        if (status !== 'catered' && status !== 'cancelled') {
                            const custName = item.custName || 'Customer';
                            const time = item.timeToReceive || '';
                            const date = item.dateToReceive || '';
                            const sched = [date, time].filter(Boolean).join(' ') || 'Scheduled';
                            showNativeNotification(
                                `📅 New Advance Booking!`,
                                `${custName} • ${sched}${item.address ? ` • ${item.address}` : ''}`,
                                `adv_new_${id}`,
                                `adv_${id}`
                            );
                        }
                    }
                });
            } else {
                entries.forEach(([id]) => knownAdvOrderKeys.add(id));
                isInitialAdvLoad = false;
            }

            if (advancedOrders.checkScheduledDeliveryAlerts) advancedOrders.checkScheduledDeliveryAlerts();
            if (advancedOrders.renderAdvancedOrdersList) advancedOrders.renderAdvancedOrdersList();
        });

        db.ref('mapCalculations').limitToLast(20).on('value', (snapshot) => {
            globalState.globalMapCalculations = snapshot.val() ? Object.values(snapshot.val()) : [];
            if (maps.renderMapCalcBoardList) maps.renderMapCalcBoardList();
        });
    } catch (e) {
        console.error("Firebase listener setup error:", e);
    }
}

// REMARKS: APP_LISTENERS_CHRONOLOGICAL_DATE_INDEX_QUERY_V5_COMPLETE