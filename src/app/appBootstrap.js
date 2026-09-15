// src/app/appBootstrap.js
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
import * as profileSettings from '../features/profile/profileSettings.js';

import * as modals from '../ui/modals.js';
import * as router from '../ui/router.js';
import * as helpers from '../utils/helpers.js';
import { 
    unlockAudioContext, 
    startBackgroundAudioPulse, 
    requestWakeLock 
} from '../ui/notifications.js';

import { registerServiceWorker, initFCMNotifications } from './appPush.js';
import { updateNetworkStatus, initBatteryMonitor } from './appMonitors.js';
import { runBackgroundPersistenceSync } from './appSync.js';
import { initRealtimeFirebaseListeners } from './appListeners.js';

export function initGlobalWindowBridge() {
    const allModules = [
        authFeature, cart, chat, roster, directory, commission, 
        advancedOrders, maps, wizard, liveTracker, storeHub, 
        customerStorefront, profileSettings, modals, router, helpers, storageEngine
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

export function bootApp() {
    try {
        registerServiceWorker();
        updateNetworkStatus();
        initBatteryMonitor();

        // 1. Tier 1: Instant Local Cache Hydration
        hydrateInstantLocalStores();

        if (roster && roster.loadRosterCache) roster.loadRosterCache();
        if (roster && roster.updateRosterUI) roster.updateRosterUI();
        if (roster && roster.loadGlobalCateredList) roster.loadGlobalCateredList();
        if (roster && roster.loadGlobalLoginList) roster.loadGlobalLoginList();
        if (commission && commission.loadCommissionSettingsCache) commission.loadCommissionSettingsCache();
        if (directory && directory.loadDirectoryCache) directory.loadDirectoryCache();
        if (cart && cart.loadCartState) cart.loadCartState();

        // 2. Tier 2: Realtime Firebase Event Bus
        initRealtimeFirebaseListeners();

        if (commission && commission.fetchCommissionSettings) commission.fetchCommissionSettings();
        if (directory && directory.silentSyncDirectory) directory.silentSyncDirectory();

        // 3. Tier 3: Silent Background Persistence Daemon
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

        const urlParams = new URLSearchParams(window.location.search);
        
        if (urlParams.has('livegps') || urlParams.has('track') || urlParams.has('mapcalc')) {
            const loginView = document.getElementById('view-login');
            if (loginView) loginView.classList.add('hidden');

            if (urlParams.has('livegps') && liveTracker.checkAndInitLiveGpsPortal) liveTracker.checkAndInitLiveGpsPortal();
            else if (urlParams.has('track') && maps.checkAndInitTrackPortal) maps.checkAndInitTrackPortal();
            else if (urlParams.has('mapcalc') && maps.checkAndInitMapCalcPortal) maps.checkAndInitMapCalcPortal();

            return; 
        }

        // Role-Gated Session Routing
        const activeUserRole = localStorage.getItem('lokalex_active_role');
        const savedCustomerFbId = localStorage.getItem('lokalex_customer_fb_id');
        const savedCustomerName = localStorage.getItem('lokalex_customer_name') || localStorage.getItem('customerName');
        const savedCustomerEmail = localStorage.getItem('lokalex_customer_email') || localStorage.getItem('customerPhone');
        const savedCustomerAvatar = localStorage.getItem('lokalex_customer_avatar') || localStorage.getItem('customerAvatarUrl');

        if (appState.telegramId && (!activeUserRole || activeUserRole === 'rider')) {
            history.replaceState({ view: 'view-home' }, '', '#view-home');
            router.renderViewUI('view-home');
            startBackgroundAudioPulse();
            requestWakeLock();
        } else if (appState.merchantAccountId && appState.merchantStoreId && activeUserRole === 'merchant') {
            history.replaceState({ view: 'view-store-hub' }, '', '#view-store-hub');
            router.renderViewUI('view-store-hub');
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
        } else {
            history.replaceState({ view: 'view-login' }, '', '#view-login');
            router.renderViewUI('view-login');
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
        }
    });
}