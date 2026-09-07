// src/app/appSync.js
import { appState, globalState } from '../store/state.js';
import { db } from '../config/firebase.js';
import * as storageEngine from '../utils/storageEngine.js';
import * as customerStorefront from '../features/customer/customerStorefront.js';
import * as roster from '../features/roster/index.js';
import * as chat from '../features/chat/index.js';
import * as directory from '../features/directory.js';
import * as commission from '../features/commission/index.js';
import * as authFeature from '../features/auth/index.js';
import { updateNetworkStatus } from './appMonitors.js';

let isReconnecting = false;
let lastHeartbeatTime = Date.now();
let backgroundSyncInProgress = false;

export async function runBackgroundPersistenceSync() {
    if (!db || backgroundSyncInProgress) return;
    backgroundSyncInProgress = true;

    try {
        const mediaUrlsToPrefetch = [];

        // 1. Stores Collection
        const storesSnap = await db.ref('stores').once('value');
        const storesData = storesSnap.val();
        if (storesData && Object.keys(storesData).length > 0) {
            await storageEngine.idbSet('stores', 'all_stores', storesData);
            if (customerStorefront.setStoresCache) customerStorefront.setStoresCache(storesData);
            
            Object.values(storesData).forEach(s => {
                if (s.photoUrl) mediaUrlsToPrefetch.push(s.photoUrl);
                if (s.logoUrl) mediaUrlsToPrefetch.push(s.logoUrl);
                if (s.imageUrl) mediaUrlsToPrefetch.push(s.imageUrl);
            });
        }

        // 2. Store Menus
        const menusSnap = await db.ref('storeMenus').once('value');
        const menusData = menusSnap.val();
        if (menusData && Object.keys(menusData).length > 0) {
            await storageEngine.idbSet('menus', 'all_menus', menusData);
            if (customerStorefront.setMenusCache) customerStorefront.setMenusCache(menusData);

            Object.values(menusData).forEach(storeMenu => {
                if (storeMenu && typeof storeMenu === 'object') {
                    Object.values(storeMenu).forEach(item => {
                        if (item && item.imageUrl) mediaUrlsToPrefetch.push(item.imageUrl);
                    });
                }
            });
        }

        // 3. Customer Directory & Profiles
        const custSnap = await db.ref('customers').limitToLast(300).once('value');
        const custData = custSnap.val();
        if (custData && Object.keys(custData).length > 0) {
            await storageEngine.idbSet('customers', 'all_customers', custData);
            Object.values(custData).forEach(c => {
                if (c.avatarUrl) mediaUrlsToPrefetch.push(c.avatarUrl);
                if (c.photoUrl) mediaUrlsToPrefetch.push(c.photoUrl);
            });
        }

        // 4. Active Chat Threads & Recent History
        const chatsSnap = await db.ref('customerChats').limitToLast(60).once('value');
        const chatsData = chatsSnap.val();
        if (chatsData && Object.keys(chatsData).length > 0) {
            await storageEngine.idbSet('chats', 'recent_chats', chatsData);
            Object.values(chatsData).forEach(thread => {
                if (thread.metadata?.avatarUrl) mediaUrlsToPrefetch.push(thread.metadata.avatarUrl);
            });
        }

        // 5. Binary Media Prefetch into CacheStorage
        if (mediaUrlsToPrefetch.length > 0) {
            storageEngine.prefetchMediaBatch(mediaUrlsToPrefetch);
        }
    } catch (err) {
        console.warn('Background sync note:', err.message || err);
    } finally {
        backgroundSyncInProgress = false;
    }
}

export function forceReconnectFirebase() {
    if (isReconnecting) return;
    isReconnecting = true;
    updateNetworkStatus('connecting');

    if (db) {
        try {
            db.goOffline();
            setTimeout(() => {
                db.goOnline();
                isReconnecting = false;
                updateNetworkStatus(true);

                db.ref('roster').once('value', (snapshot) => {
                    const val = snapshot.val();
                    if (val) {
                        globalState.rosterMembers = Object.entries(val).map(([key, item]) => ({
                            ...item,
                            telegramId: (item.telegramId || item.id || key).toString().trim(),
                            id: (item.telegramId || item.id || key).toString().trim()
                        }));
                    } else {
                        globalState.rosterMembers = [];
                    }

                    if (roster && roster.saveRosterCache) roster.saveRosterCache();
                    if (roster && roster.updateRosterUI) roster.updateRosterUI();
                    if (roster && roster.loadGlobalCateredList) roster.loadGlobalCateredList();
                });

                if (chat && chat.listenToAllCustomerChatsForRider) {
                    chat.listenToAllCustomerChatsForRider();
                }

                if (chat && chat.listenToFirebaseChat) {
                    chat.listenToFirebaseChat();
                }

                if (directory && directory.silentSyncDirectory) {
                    directory.silentSyncDirectory();
                }

                if (commission && commission.fetchCommissionSettings) {
                    commission.fetchCommissionSettings();
                }

                if (customerStorefront && customerStorefront.initCustomerStorefront) {
                    customerStorefront.initCustomerStorefront();
                }

                if (appState.telegramId && authFeature.startBackgroundRosterGpsTracker) {
                    authFeature.startBackgroundRosterGpsTracker();
                }

                if (roster && roster.checkAndTriggerAutoEndShift) {
                    roster.checkAndTriggerAutoEndShift();
                }

                runBackgroundPersistenceSync();
            }, 150);
        } catch (e) {
            isReconnecting = false;
            updateNetworkStatus(false);
        }
    } else {
        isReconnecting = false;
        updateNetworkStatus(false);
    }
}

export function initSyncWatchdog() {
    window.addEventListener('online', () => {
        forceReconnectFirebase();
    });

    window.addEventListener('offline', () => {
        updateNetworkStatus(false);
    });

    function handleAppVisibilityChange() {
        if (document.visibilityState === 'visible') {
            forceReconnectFirebase();
        } else {
            updateNetworkStatus('connecting');
        }
    }

    document.addEventListener('visibilitychange', handleAppVisibilityChange);
    window.addEventListener('pageshow', handleAppVisibilityChange);
    window.addEventListener('focus', handleAppVisibilityChange);
    window.addEventListener('resume', handleAppVisibilityChange);

    // Timer drift watchdog
    setInterval(() => {
        const now = Date.now();
        const drift = now - lastHeartbeatTime;
        lastHeartbeatTime = now;

        if (drift > 10000 && document.visibilityState === 'visible') {
            forceReconnectFirebase();
        }
    }, 4000);
}