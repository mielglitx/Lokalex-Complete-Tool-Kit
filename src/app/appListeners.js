// src/app/appListeners.js
import { appState, globalState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { showToast } from '../ui/notifications.js';
import * as storageEngine from '../utils/storageEngine.js';
import * as authFeature from '../features/auth/index.js';
import * as roster from '../features/roster/index.js';
import * as chat from '../features/chat/index.js';
import * as commission from '../features/commission/index.js';
import * as advancedOrders from '../features/advancedOrders.js';
import * as maps from '../features/maps.js';
import { updateNetworkStatus } from './appMonitors.js';

export function initRealtimeFirebaseListeners() {
    try {
        if (db) {
            db.ref('.info/connected').on('value', (snap) => {
                const isConnected = !!snap.val();
                updateNetworkStatus(isConnected);
            });
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

        if (chat && chat.listenToCustomerRiderChat) {
            chat.listenToCustomerRiderChat();
        }

        if (chat && chat.listenToAllCustomerChatsForRider) {
            chat.listenToAllCustomerChatsForRider();
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
        });

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

            if (roster && roster.saveRosterCache) roster.saveRosterCache();
            window.dispatchEvent(new Event('rosterUpdated'));
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

        db.ref('logins').limitToLast(100).on('value', (snapshot) => {
            globalState.globalLogins = snapshot.val() ? Object.values(snapshot.val()) : [];
            if (roster && roster.saveRosterCache) roster.saveRosterCache();
            window.dispatchEvent(new Event('loginsUpdated'));
        });

        db.ref('cateredHistory').limitToLast(100).on('value', (snapshot) => {
            globalState.globalCateredHistory = snapshot.val() ? Object.values(snapshot.val()) : [];
            if (roster && roster.saveRosterCache) roster.saveRosterCache();
            window.dispatchEvent(new Event('cateredUpdated'));
        });

        db.ref('receipts').limitToLast(100).on('value', (snapshot) => {
            globalState.globalDailyReceipts = snapshot.val() ? Object.values(snapshot.val()) : [];
            window.dispatchEvent(new Event('receiptsUpdated'));
        });

        db.ref('chat').limitToLast(50).on('value', (snapshot) => {
            globalState.chatMessages = snapshot.val() ? Object.values(snapshot.val()) : [];
            window.dispatchEvent(new Event('chatUpdated'));
        });

        db.ref('advancedOrders').on('value', (snapshot) => {
            const val = snapshot.val();
            globalState.globalAdvancedOrders = val 
                ? Object.entries(val).map(([id, item]) => ({ id, key: id, ...item })) 
                : [];
            if (advancedOrders.checkScheduledDeliveryAlerts) advancedOrders.checkScheduledDeliveryAlerts();
            if (advancedOrders.renderAdvancedOrdersList) advancedOrders.renderAdvancedOrdersList();
        });

        db.ref('mapCalculations').limitToLast(50).on('value', (snapshot) => {
            globalState.globalMapCalculations = snapshot.val() ? Object.values(snapshot.val()) : [];
            if (maps.renderMapCalcBoardList) maps.renderMapCalcBoardList();
        });
    } catch (e) {
        console.error("Firebase listener setup error:", e);
    }
}