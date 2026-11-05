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

const BG_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const LAST_BG_SYNC_KEY = 'lokalex_last_bg_sync_timestamp';

export async function runBackgroundPersistenceSync(force = false) {
    if (!db || backgroundSyncInProgress) return;

    if (!force) {
        try {
            const lastSync = parseInt(localStorage.getItem(LAST_BG_SYNC_KEY) || '0', 10);
            if (Date.now() - lastSync < BG_SYNC_INTERVAL_MS) {
                return;
            }
        } catch (_) {}
    }

    backgroundSyncInProgress = true;

    try {
        // 1. Stores Collection (Lightweight metadata)
        const storesSnap = await db.ref('stores').once('value');
        const storesData = storesSnap.val();
        if (storesData && Object.keys(storesData).length > 0) {
            await storageEngine.idbSet('stores', 'all_stores', storesData);
            if (customerStorefront.setStoresCache) customerStorefront.setStoresCache(storesData);
        }

        // 2. Store Menus
        const menusSnap = await db.ref('storeMenus').once('value');
        const menusData = menusSnap.val();
        if (menusData && Object.keys(menusData).length > 0) {
            await storageEngine.idbSet('menus', 'all_menus', menusData);
            if (customerStorefront.setMenusCache) customerStorefront.setMenusCache(menusData);
        }

        // 3. Customer Directory & Profiles
        const custSnap = await db.ref('customers').limitToLast(150).once('value');
        const custData = custSnap.val();
        if (custData && Object.keys(custData).length > 0) {
            await storageEngine.idbSet('customers', 'all_customers', custData);
        }

        // 4. Lightweight Chat Metadata only (no full chat message history!)
        const chatsSnap = await db.ref('customerChatMeta').limitToLast(40).once('value');
        const chatsData = chatsSnap.val();
        if (chatsData && Object.keys(chatsData).length > 0) {
            await storageEngine.idbSet('chats', 'recent_chat_meta', chatsData);
        }

        // Images are loaded on demand when rendered on screen (not prefetched in background)
        try {
            localStorage.setItem(LAST_BG_SYNC_KEY, Date.now().toString());
        } catch (_) {}
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
            // Reconnect Firebase without tearing down existing client socket prematurely
            db.goOnline();
            isReconnecting = false;
            updateNetworkStatus(true);

            // Re-verify essential roster & chat states once network recovers
            if (chat && chat.listenToAllCustomerChatsForRider) {
                chat.listenToAllCustomerChatsForRider();
            }

            if (chat && chat.listenToFirebaseChat) {
                chat.listenToFirebaseChat();
            }

            if (roster && roster.checkAndTriggerAutoEndShift) {
                roster.checkAndTriggerAutoEndShift();
            }
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
    // Physical network online/offline events
    window.addEventListener('online', () => {
        updateNetworkStatus('connecting');
        forceReconnectFirebase();
    });

    window.addEventListener('offline', () => {
        updateNetworkStatus(false);
    });

    let lastResumeSyncTime = 0;
    let isLifecycleResyncing = false;
    let wasDocumentHidden = false;

    async function triggerLifecycleResync(isForced = false) {
        const isVisible = typeof document !== 'undefined' ? (document.visibilityState === 'visible' && !document.hidden) : true;
        updateNetworkStatus(navigator.onLine);

        if (!isVisible && !isForced) {
            return;
        }

        if (isLifecycleResyncing) {
            return;
        }

        const now = Date.now();
        if (!isForced && (now - lastResumeSyncTime < 10000)) {
            return;
        }
        lastResumeSyncTime = now;
        isLifecycleResyncing = true;

        try {
            if (db && navigator.onLine) {
                try {
                    db.goOnline();
                } catch (_) {}
            }

            // Silent resync of roster rotation lineup and catering states
            if (typeof window !== 'undefined' && typeof window.forceRefreshRosterList === 'function') {
                try {
                    await window.forceRefreshRosterList(null, true);
                } catch (err) {
                    console.warn('[SyncWatchdog] Roster refresh note:', err);
                }
            }

            // Silent resync of live chat feed (inbox, catering, done, badges)
            if (typeof window !== 'undefined' && typeof window.forceRefreshLiveChatsFeed === 'function') {
                try {
                    await window.forceRefreshLiveChatsFeed(null, true);
                } catch (err) {
                    console.warn('[SyncWatchdog] Live chat feed refresh note:', err);
                }
            }

            // If an active customer chat thread is currently open, refresh messages immediately
            if (typeof window !== 'undefined') {
                const activeCustId = typeof window.getActiveRiderChatCustId === 'function' ? window.getActiveRiderChatCustId() : null;
                if (activeCustId) {
                    if (typeof window.reloadRiderChatFromFirebase === 'function') {
                        try {
                            await window.reloadRiderChatFromFirebase(activeCustId);
                        } catch (err) {
                            console.warn('[SyncWatchdog] Active chat reload note:', err);
                        }
                    }
                    if (typeof window.renderRiderCateredSwitcher === 'function') {
                        try {
                            window.renderRiderCateredSwitcher();
                        } catch (_) {}
                    }
                }
            }
        } finally {
            isLifecycleResyncing = false;
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (typeof document !== 'undefined' && document.hidden) {
            wasDocumentHidden = true;
            return;
        }
        if (wasDocumentHidden) {
            wasDocumentHidden = false;
            triggerLifecycleResync(true);
        }
    });

    window.addEventListener('appResumedFromBackground', () => {
        wasDocumentHidden = false;
        triggerLifecycleResync(true);
    });

    window.addEventListener('appPausedToBackground', () => {
        wasDocumentHidden = true;
    });

    // Continuous worker heartbeat tick: updates timestamp without triggering heavy network queries
    window.addEventListener('lokalexHeartbeatTick', () => {
        lastHeartbeatTime = Date.now();
    });

    // Deep sleep drift watchdog: Reconnect immediately if time drifted/jumped while out of focus
    setInterval(() => {
        const now = Date.now();
        const drift = now - lastHeartbeatTime;
        lastHeartbeatTime = now;

        if (drift > 20000 && navigator.onLine) {
            triggerLifecycleResync(true);
        }
    }, 10000);
}