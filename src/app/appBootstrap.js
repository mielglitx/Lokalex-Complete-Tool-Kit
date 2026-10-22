// src/app/appBootstrap.js

/**
 * ============================================================================
 * APPLICATION BOOTSTRAP, GLOBAL BRIDGE & ROUTING COORDINATOR
 * ============================================================================
 * 
 * Description:
 * Coordinates app startup lifecycle, Tier-1/2/3 sync hydration, and route gating:
 * - Dedicated Customer Menu Catalog Integration: Imports and mounts the standalone
 *   `customerMenuCatalog` module, routing deep-linked customers directly to the
 *   catalog view without triggering rider login screens.
 * - Global Window Function Bridge: Mounts module APIs to `window` for HTML onclick bindings.
 * - Tier-1 Instant Local Storage Cache Hydration (IDB & LocalStorage).
 * - Tier-2 Realtime Firebase Listeners and background sync watchdog daemons.
 * - Dynamic portal parameter handler (?track, ?mapcalc, ?livegps).
 * ============================================================================
 */

import { appState } from '../store/state.js';
import * as storageEngine from '../utils/storageEngine.js';

import * as authFeature from '../features/auth/index.js';
import * as cart from '../features/cart.js';
import * as chat from '../features/chat/index.js';
import * as roster from '../features/roster/index.js';
import * as directory from '../features/directory.js';
import * as commission from '../features/commission/index.js';
import * as advancedOrders from '../features/advancedOrders.js';
import * as maps from '../features/maps.js';
import * as wizard from '../features/wizard.js';
import * as liveTracker from '../features/liveTracker.js';
import * as storeHub from '../features/storeHub/index.js';
import * as customerStorefront from '../features/customer/customerStorefront.js';
import * as customerMenuCatalog from '../features/customer/customerMenuCatalog.js';
import * as profileSettings from '../features/profile/profileSettings.js';

import * as modals from '../ui/modals.js';
import * as router from '../ui/router.js';
import * as helpers from '../utils/helpers.js';
import { 
    unlockAudioContext, 
    startBackgroundAudioPulse, 
    requestWakeLock,
    showToast 
} from '../ui/notifications.js';

import { registerServiceWorker, initFCMNotifications } from './appPush.js';
import { updateNetworkStatus, initBatteryMonitor } from './appMonitors.js';
import { runBackgroundPersistenceSync } from './appSync.js';
import { initRealtimeFirebaseListeners } from './appListeners.js';
import { 
    syncRiderSession, 
    isBatteryOptimizationIgnored, 
    requestBatteryOptimizationExemption 
} from '../native/nativeBridge.js';
import { db, primaryDb } from '../config/firebase.js';

export function initGlobalWindowBridge() {
    window.db = db;
    window.primaryDb = primaryDb;

    const allModules = [
        authFeature, cart, chat, roster, directory, commission, 
        advancedOrders, maps, wizard, liveTracker, storeHub, 
        customerStorefront, customerMenuCatalog, profileSettings, 
        modals, router, helpers, storageEngine
    ];

    allModules.forEach(mod => {
        if (mod) {
            Object.keys(mod).forEach(funcName => {
                if (typeof mod[funcName] === 'function') {
                    window[funcName] = mod[funcName];
                }
            });
        }
    });

    window.unlockAudioContext = unlockAudioContext;
}

export function showAutoLoginSplash(accountName, role) {
    try {
        const loginSection = document.getElementById('unified-login-section');
        const splash = document.getElementById('auto-login-splash');
        const titleEl = document.getElementById('auto-login-title');
        const pillEl = document.getElementById('auto-login-account-name');

        if (loginSection) loginSection.classList.add('hidden');
        if (splash) splash.classList.remove('hidden');

        if (titleEl && accountName) {
            titleEl.textContent = `Welcome back, ${accountName}!`;
        }
        if (pillEl && role) {
            pillEl.textContent = `${role}: ${accountName || 'Active Session'}`;
        }
    } catch (_) {}
}

export function hideAutoLoginSplash() {
    try {
        const loginSection = document.getElementById('unified-login-section');
        const splash = document.getElementById('auto-login-splash');
        if (splash) splash.classList.add('hidden');
        if (loginSection) loginSection.classList.remove('hidden');
    } catch (_) {}
}

if (typeof window !== 'undefined') {
    window.showAutoLoginSplash = showAutoLoginSplash;
    window.hideAutoLoginSplash = hideAutoLoginSplash;
    window.cancelAutoLogin = function() {
        hideAutoLoginSplash();
        localStorage.removeItem('telegramId');
        localStorage.removeItem('riderId');
        localStorage.removeItem('riderName');
        localStorage.removeItem('lokalex_customer_fb_id');
        localStorage.removeItem('lokalex_customer_name');
        localStorage.removeItem('lokalex_active_role');
        localStorage.removeItem('lokalex_merchant_account_id');
        localStorage.removeItem('lokalex_merchant_store_id');
        syncRiderSession('', '');
        showToast("ℹ️ Auto-login cancelled. Pwede ka nang mag-login gamit ang ibang account.");
    };
}

export async function hydrateInstantLocalStores() {
    try {
        const cachedStores = await storageEngine.idbGet('stores', 'all_stores');
        if (cachedStores && Object.keys(cachedStores).length > 0) {
            if (customerStorefront.setStoresCache) {
                customerStorefront.setStoresCache(cachedStores);
            }
        }

        const cachedMenus = await storageEngine.idbGet('menus', 'all_menus');
        if (cachedMenus && Object.keys(cachedMenus).length > 0) {
            if (customerStorefront.setMenusCache) {
                customerStorefront.setMenusCache(cachedMenus);
            }
        }
    } catch (_) {}
}

export async function bootApp() {
    try {
        registerServiceWorker();
        updateNetworkStatus();
        initBatteryMonitor();

        const urlParams = new URLSearchParams(window.location.search);
        
        // Deep-link portal parameter handling
        if (urlParams.has('livegps') || urlParams.has('track') || urlParams.has('mapcalc')) {
            const loginView = document.getElementById('view-login');
            if (loginView) loginView.classList.add('hidden');

            if (urlParams.has('livegps') && liveTracker.checkAndInitLiveGpsPortal) liveTracker.checkAndInitLiveGpsPortal();
            else if (urlParams.has('track') && maps.checkAndInitTrackPortal) maps.checkAndInitTrackPortal();
            else if (urlParams.has('mapcalc') && maps.checkAndInitMapCalcPortal) maps.checkAndInitMapCalcPortal();

            return; 
        }

        // Public Customer Menu Route Bypass (Zero-login deep-link resolver)
        const currentHash = (window.location.hash || '').replace(/^#/, '').trim();
        const isCustomerMenusRoute = currentHash === 'view-customer-menus' || urlParams.has('menus') || urlParams.get('view') === 'customer-menus';

        if (isCustomerMenusRoute) {
            history.replaceState({ view: 'view-customer-menus' }, '', '#view-customer-menus');
            router.renderViewUI('view-customer-menus');
            if (customerMenuCatalog && customerMenuCatalog.loadCustomerMenuCatalog) {
                customerMenuCatalog.loadCustomerMenuCatalog();
            }
            return;
        }

        // ====================================================================
        // FAST-PATH: INSTANT ZERO-LATENCY SESSION RESTORATION (0ms LAUNCH)
        // ====================================================================
        const activeUserRole = localStorage.getItem('lokalex_active_role');
        const savedCustomerFbId = localStorage.getItem('lokalex_customer_fb_id');
        const savedCustomerName = localStorage.getItem('lokalex_customer_name') || localStorage.getItem('customerName');
        const savedCustomerEmail = localStorage.getItem('lokalex_customer_email') || localStorage.getItem('customerPhone');
        const savedCustomerAvatar = localStorage.getItem('lokalex_customer_avatar') || localStorage.getItem('customerAvatarUrl');

        const savedRiderId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
        const savedRiderName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim();
        const savedMerchAccId = localStorage.getItem('lokalex_merchant_account_id') || appState.merchantAccountId;
        const savedMerchStoreId = localStorage.getItem('lokalex_merchant_store_id') || appState.merchantStoreId;

        if ((savedRiderId || savedRiderName) && (!activeUserRole || activeUserRole === 'rider')) {
            if (!appState.telegramId && savedRiderId) appState.telegramId = savedRiderId;
            if (!appState.riderName && savedRiderName) appState.riderName = savedRiderName;
            localStorage.setItem('telegramId', appState.telegramId || savedRiderId);
            localStorage.setItem('riderName', appState.riderName || savedRiderName);
            localStorage.setItem('lokalex_active_role', 'rider');

            // Instantly render Home view with zero network latency
            history.replaceState({ view: 'view-home' }, '', '#view-home');
            router.renderViewUI('view-home');
            startBackgroundAudioPulse();
            requestWakeLock();
            syncRiderSession(appState.telegramId || savedRiderId, appState.riderName || savedRiderName);

            // Asynchronous non-blocking account validity check
            if (savedRiderId && db) {
                db.ref(`riders/${savedRiderId}`).once('value').then(riderSnap => {
                    if (!riderSnap.exists()) {
                        console.warn(`Rider ${savedRiderId} deleted from database; clearing session.`);
                        if (typeof document !== 'undefined' && document.documentElement) {
                            document.documentElement.classList.remove('instant-session-home');
                        }
                        hideAutoLoginSplash();
                        localStorage.clear();
                        syncRiderSession('', '');
                        history.replaceState({ view: 'view-login' }, '', '#view-login');
                        router.renderViewUI('view-login');
                        showToast("⚠️ Ang iyong account ay tinanggal na o hindi na umiiral.");
                    }
                }).catch(() => {});
            }

            try {
                if (!isBatteryOptimizationIgnored()) {
                    setTimeout(() => {
                        requestBatteryOptimizationExemption();
                    }, 2500);
                }
            } catch (_) {}
        } else if (savedMerchAccId && savedMerchStoreId && activeUserRole === 'merchant') {
            appState.merchantAccountId = savedMerchAccId;
            appState.merchantStoreId = savedMerchStoreId;
            history.replaceState({ view: 'view-store-hub' }, '', '#view-store-hub');
            router.renderViewUI('view-store-hub');

            // Asynchronous non-blocking check
            if (db) {
                db.ref(`storeAccounts/${savedMerchAccId}`).once('value').then(merchSnap => {
                    if (!merchSnap.exists()) {
                        if (typeof document !== 'undefined' && document.documentElement) {
                            document.documentElement.classList.remove('instant-session-merchant');
                        }
                        hideAutoLoginSplash();
                        localStorage.clear();
                        history.replaceState({ view: 'view-login' }, '', '#view-login');
                        router.renderViewUI('view-login');
                        showToast("⚠️ Ang iyong Store Merchant account ay tinanggal na.");
                    }
                }).catch(() => {});
            }
        } else if (savedCustomerFbId && activeUserRole === 'customer') {
            appState.customerFacebookId = savedCustomerFbId;
            appState.customerName = savedCustomerName || "Customer";

            const avatarImg = document.getElementById('cust-landing-avatar');
            const nameEl = document.getElementById('cust-landing-name');
            const emailEl = document.getElementById('cust-landing-email');

            if (avatarImg && savedCustomerAvatar) avatarImg.src = savedCustomerAvatar;
            if (nameEl) nameEl.innerText = savedCustomerName || "Customer Account";
            if (emailEl) emailEl.innerText = savedCustomerEmail || "Phone Verified";

            if (chat && chat.listenToCustomerRiderChat) {
                chat.listenToCustomerRiderChat();
            }

            if (customerStorefront && customerStorefront.initCustomerStorefront) {
                customerStorefront.initCustomerStorefront();
            }

            history.replaceState({ view: 'view-customer-home' }, '', '#view-customer-home');
            router.renderViewUI('view-customer-home');

            // Asynchronous non-blocking check
            if (db) {
                db.ref(`customers/${savedCustomerFbId}`).once('value').then(custSnap => {
                    if (!custSnap.exists()) {
                        if (typeof document !== 'undefined' && document.documentElement) {
                            document.documentElement.classList.remove('instant-session-customer');
                        }
                        hideAutoLoginSplash();
                        localStorage.clear();
                        history.replaceState({ view: 'view-login' }, '', '#view-login');
                        router.renderViewUI('view-login');
                        showToast("⚠️ Ang iyong Customer account ay tinanggal na.");
                    }
                }).catch(() => {});
            }
        } else {
            hideAutoLoginSplash();
            history.replaceState({ view: 'view-login' }, '', '#view-login');
            router.renderViewUI('view-login');
        }

        // ====================================================================
        // PARALLEL DATA HYDRATION & LISTENERS (RUNS WHILE DASHBOARD IS VISIBLE)
        // ====================================================================
        hydrateInstantLocalStores();

        if (roster && roster.loadRosterCache) roster.loadRosterCache();
        if (roster && roster.updateRosterUI) roster.updateRosterUI();
        if (roster && roster.loadGlobalCateredList) roster.loadGlobalCateredList();
        if (roster && roster.loadGlobalLoginList) roster.loadGlobalLoginList();
        if (commission && commission.loadCommissionSettingsCache) commission.loadCommissionSettingsCache();
        if (directory && directory.loadDirectoryCache) directory.loadDirectoryCache();
        if (cart && cart.loadCartState) cart.loadCartState();

        initRealtimeFirebaseListeners();

        if (commission && commission.fetchCommissionSettings) commission.fetchCommissionSettings();
        if (directory && directory.silentSyncDirectory) directory.silentSyncDirectory();

        setTimeout(() => {
            runBackgroundPersistenceSync();
        }, 1200);

        if (roster && roster.startAutoEndShiftScheduler) {
            roster.startAutoEndShiftScheduler();
        } else {
            setInterval(() => {
                if (roster && roster.checkAndTriggerAutoEndShift) {
                    roster.checkAndTriggerAutoEndShift();
                }
            }, 10000);
        }
    } catch (err) {
        console.error("Booting Error caught:", err);
    }
}

export function initAppLifecycleEvents() {
    window.addEventListener('loginSuccess', () => {
        if (commission && commission.fetchCommissionSettings) {
            commission.fetchCommissionSettings();
        }

        const currentRiderId = appState.telegramId || localStorage.getItem('telegramId') || '';
        const currentRiderName = appState.riderName || localStorage.getItem('riderName') || '';
        if (currentRiderId || currentRiderName) {
            syncRiderSession(currentRiderId, currentRiderName);
            try {
                if (!isBatteryOptimizationIgnored()) {
                    setTimeout(() => {
                        requestBatteryOptimizationExemption();
                    }, 2500);
                }
            } catch (_) {}
        }

        if (navigator.serviceWorker?.controller) {
            navigator.serviceWorker.ready.then(reg => initFCMNotifications(reg));
        }

        startBackgroundAudioPulse();
        requestWakeLock();
        initRealtimeFirebaseListeners();
        runBackgroundPersistenceSync();
    });

    window.addEventListener('viewChanged', (e) => {
        if (e.detail === 'view-customer-home') {
            if (chat && chat.listenToCustomerRiderChat) {
                chat.listenToCustomerRiderChat();
            }
            if (customerStorefront && customerStorefront.initCustomerStorefront) {
                customerStorefront.initCustomerStorefront();
            }
        } else if (e.detail === 'view-customer-menus') {
            if (customerMenuCatalog && customerMenuCatalog.loadCustomerMenuCatalog) {
                customerMenuCatalog.loadCustomerMenuCatalog();
            }
        }
    });

    window.addEventListener('hashchange', () => {
        const hash = (window.location.hash || '').replace(/^#/, '').trim();
        if (hash === 'view-customer-menus') {
            router.renderViewUI('view-customer-menus');
            if (customerMenuCatalog && customerMenuCatalog.loadCustomerMenuCatalog) {
                customerMenuCatalog.loadCustomerMenuCatalog();
            }
        }
    });
}

// REMARKS: APP_BOOTSTRAP_MODULAR_CUSTOMER_CATALOG_V3_COMPLETE