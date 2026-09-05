// src/main.js
import { appState, globalState } from './store/state.js';
import { db, auth as firebaseAuth, messaging } from './config/firebase.js';

import * as authFeature from './features/auth/index.js';
import * as cart from './features/cart.js';
import * as chat from './features/chat/index.js';
import * as roster from './features/roster/index.js';
import * as directory from './features/directory.js';
import * as commission from './features/commission/index.js';
import * as advancedOrders from './features/advancedOrders.js';
import * as maps from './features/maps.js';
import * as wizard from './features/wizard.js';
import * as liveTracker from './features/liveTracker.js';
import * as storeHub from './features/storeHub/index.js';
import * as customerStorefront from './features/customer/customerStorefront.js';
import * as profileSettings from './features/profile/profileSettings.js';
import * as storageEngine from './utils/storageEngine.js';

import * as modals from './ui/modals.js';
import * as router from './ui/router.js';
import * as helpers from './utils/helpers.js';
import { 
    unlockAudioContext, 
    showToast, 
    showSideNotification, 
    notifyUser, 
    startBackgroundAudioPulse, 
    requestWakeLock 
} from './ui/notifications.js';

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

let isReconnecting = false;
let lastHeartbeatTime = Date.now();
let backgroundSyncInProgress = false;

// SERVICE WORKER REGISTRATION & FCM PUSH NOTIFICATIONS
export function registerServiceWorker() {
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('/sw.js').then((reg) => {
            initFCMNotifications(reg);

            reg.onupdatefound = () => {
                const installingWorker = reg.installing;
                if (installingWorker) {
                    installingWorker.onstatechange = () => {
                        if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('⚡ Lokalex App updated in background.');
                        }
                    };
                }
            };
        }).catch((err) => {
            console.warn('SW registration warning:', err);
        });
    }
}

export async function initFCMNotifications(registration) {
    if (!('Notification' in window) || !messaging) return;

    try {
        let permission = Notification.permission;
        if (permission === 'default') {
            permission = await Notification.requestPermission();
        }

        if (permission === 'granted') {
            const currentToken = await messaging.getToken({
                serviceWorkerRegistration: registration
            });

            if (currentToken) {
                syncDeviceFcmToken(currentToken);
            }

            messaging.onMessage((payload) => {
                const title = payload.notification?.title || payload.data?.title || 'Lokalex Alert';
                const body = payload.notification?.body || payload.data?.body || 'New notification received.';
                
                notifyUser(title, body, {
                    icon: 'fa-bell',
                    textColor: 'text-amber-400',
                    borderColor: 'border-amber-500'
                });

                if (typeof window.playLineAlarm === 'function') {
                    window.playLineAlarm();
                }
            });
        }
    } catch(err) {
        console.warn('FCM setup warning:', err);
    }
}

export function syncDeviceFcmToken(token) {
    if (!db || !token) return;

    const myRiderId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const myCustId = (appState.customerFacebookId || localStorage.getItem('lokalex_customer_fb_id') || '').toString().trim();

    if (myRiderId) {
        db.ref(`riders/${myRiderId}/fcmToken`).set(token).catch(() => {});
        db.ref(`roster/${myRiderId}/fcmToken`).set(token).catch(() => {});
    }
    if (myCustId) {
        db.ref(`customers/${myCustId}/fcmToken`).set(token).catch(() => {});
    }
}

// COLOR-COORDINATED NETWORK INDICATOR: GREEN = ONLINE, RED = OFFLINE, FLASHING ORANGE = CONNECTING
export function updateNetworkStatus(forcedState = null) {
    const container = document.getElementById('network-status-pill');
    if (!container) return;

    let status = 'online';

    if (forcedState === 'connecting') {
        status = 'connecting';
    } else if (forcedState === true) {
        status = 'online';
    } else if (forcedState === false) {
        status = navigator.onLine ? 'connecting' : 'offline';
    } else {
        if (!navigator.onLine) {
            status = 'offline';
        } else if (document.visibilityState !== 'visible') {
            status = 'connecting';
        } else {
            status = 'online';
        }
    }

    if (status === 'online') {
        container.className = "flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/40 shadow-xs transition-all duration-300 shrink-0";
        container.title = "Network: Online";
        container.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>`;
    } else if (status === 'connecting') {
        container.className = "flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/10 border border-amber-500/40 animate-pulse shadow-xs transition-all duration-300 shrink-0";
        container.title = "Network: Connecting...";
        container.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.8)]"></span>`;
    } else {
        container.className = "flex items-center justify-center w-7 h-7 rounded-full bg-red-500/10 border border-red-500/40 shadow-xs transition-all duration-300 shrink-0";
        container.title = "Network: Offline";
        container.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span>`;
    }
}

// REAL-TIME BATTERY STATUS MONITOR
export function initBatteryMonitor() {
    if (!('getBattery' in navigator)) return;

    navigator.getBattery().then((battery) => {
        function renderBatteryState() {
            const level = Math.round(battery.level * 100);
            const isCharging = battery.charging;

            const targets = [
                {
                    pill: document.getElementById('header-battery-pill'),
                    icon: document.getElementById('header-battery-icon'),
                    text: document.getElementById('header-battery-text')
                },
                {
                    pill: document.getElementById('header-cust-battery-pill'),
                    icon: document.getElementById('header-cust-battery-icon'),
                    text: document.getElementById('header-cust-battery-text')
                }
            ];

            targets.forEach(({ pill, icon, text }) => {
                if (!pill || !icon || !text) return;

                pill.classList.remove('hidden');
                text.innerText = `${level}%`;

                if (isCharging) {
                    icon.className = "fa-solid fa-bolt text-amber-400 animate-pulse text-[11px]";
                    pill.className = "flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 px-2 py-1 rounded-xl text-[10px] font-mono font-bold text-amber-600 dark:text-amber-300 transition-all select-none shrink-0";
                } else if (level <= 20) {
                    icon.className = "fa-solid fa-battery-quarter text-red-500 text-[11px]";
                    pill.className = "flex items-center gap-1 bg-red-500/10 border border-red-500/30 px-2 py-1 rounded-xl text-[10px] font-mono font-bold text-red-600 dark:text-red-400 transition-all select-none shrink-0";
                } else {
                    let batIcon = "fa-battery-full";
                    if (level <= 40) batIcon = "fa-battery-quarter";
                    else if (level <= 70) batIcon = "fa-battery-half";
                    else if (level <= 90) batIcon = "fa-battery-three-quarters";

                    icon.className = `fa-solid ${batIcon} text-emerald-500 text-[11px]`;
                    pill.className = "flex items-center gap-1 bg-gray-100 dark:bg-black/40 border border-gray-300 dark:border-gray-700/60 px-2 py-1 rounded-xl text-[10px] font-mono font-bold text-gray-700 dark:text-gray-300 transition-all select-none shrink-0";
                }
            });
        }

        renderBatteryState();
        battery.addEventListener('levelchange', renderBatteryState);
        battery.addEventListener('chargingchange', renderBatteryState);
    }).catch(() => {});
}

// FULL BACKGROUND PERSISTENCE & DELTA SYNC ENGINE (TIER 2 & 3)
export async function runBackgroundPersistenceSync() {
    if (!db || backgroundSyncInProgress) return;
    backgroundSyncInProgress = true;

    try {
        const mediaUrlsToPrefetch = [];

        // 1. SYNC STORES COLLECTION
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

        // 2. SYNC STORE MENUS
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

        // 3. SYNC CUSTOMER DIRECTORY & PROFILES
        const custSnap = await db.ref('customers').limitToLast(300).once('value');
        const custData = custSnap.val();
        if (custData && Object.keys(custData).length > 0) {
            await storageEngine.idbSet('customers', 'all_customers', custData);
            Object.values(custData).forEach(c => {
                if (c.avatarUrl) mediaUrlsToPrefetch.push(c.avatarUrl);
                if (c.photoUrl) mediaUrlsToPrefetch.push(c.photoUrl);
            });
        }

        // 4. SYNC ACTIVE CHAT THREADS & RECENT HISTORY
        const chatsSnap = await db.ref('customerChats').limitToLast(60).once('value');
        const chatsData = chatsSnap.val();
        if (chatsData && Object.keys(chatsData).length > 0) {
            await storageEngine.idbSet('chats', 'recent_chats', chatsData);
            Object.values(chatsData).forEach(thread => {
                if (thread.metadata?.avatarUrl) mediaUrlsToPrefetch.push(thread.metadata.avatarUrl);
            });
        }

        // 5. ASYNC PREFETCH BINARY MEDIA INTO CACHESTORAGE (AVATARS & PHOTOS)
        if (mediaUrlsToPrefetch.length > 0) {
            storageEngine.prefetchMediaBatch(mediaUrlsToPrefetch);
        }
    } catch (err) {
        console.warn('Background sync note:', err.message || err);
    } finally {
        backgroundSyncInProgress = false;
    }
}

// FORCE RECONNECT FIREBASE WEBSOCKET ON APP RESUME
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

// TIMER DRIFT WATCHDOG
setInterval(() => {
    const now = Date.now();
    const drift = now - lastHeartbeatTime;
    lastHeartbeatTime = now;

    if (drift > 10000 && document.visibilityState === 'visible') {
        forceReconnectFirebase();
    }
}, 4000);

async function hydrateInstantLocalStores() {
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

function bootApp() {
    try {
        registerServiceWorker();
        updateNetworkStatus();
        initBatteryMonitor();

        // 1. TIER 1: INSTANT LOCAL CACHE HYDRATION (ZERO LATENCY INDEXEDDB + LOCALSTORAGE)
        hydrateInstantLocalStores();

        if (roster && roster.loadRosterCache) roster.loadRosterCache();
        if (roster && roster.updateRosterUI) roster.updateRosterUI();
        if (roster && roster.loadGlobalCateredList) roster.loadGlobalCateredList();
        if (roster && roster.loadGlobalLoginList) roster.loadGlobalLoginList();
        if (commission && commission.loadCommissionSettingsCache) commission.loadCommissionSettingsCache();
        if (directory && directory.loadDirectoryCache) directory.loadDirectoryCache();
        if (cart && cart.loadCartState) cart.loadCartState();

        // 2. TIER 2: REAL-TIME FIREBASE EVENT BUS
        initRealtimeFirebaseListeners();

        if (commission && commission.fetchCommissionSettings) commission.fetchCommissionSettings();
        if (directory && directory.silentSyncDirectory) directory.silentSyncDirectory();

        // 3. TIER 3: SILENT BACKGROUND SNAPSHOT PERSISTENCE DAEMON
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

        const savedCustomerFbId = localStorage.getItem('lokalex_customer_fb_id');
        const savedCustomerName = localStorage.getItem('lokalex_customer_name') || localStorage.getItem('customerName');
        const savedCustomerEmail = localStorage.getItem('lokalex_customer_email') || localStorage.getItem('customerPhone');
        const savedCustomerAvatar = localStorage.getItem('lokalex_customer_avatar') || localStorage.getItem('customerAvatarUrl');

        if (appState.telegramId) {
            history.replaceState({ view: 'view-home' }, '', '#view-home');
            router.renderViewUI('view-home');
            startBackgroundAudioPulse();
            requestWakeLock();
        } else if (appState.merchantAccountId && appState.merchantStoreId) {
            history.replaceState({ view: 'view-store-hub' }, '', '#view-store-hub');
            router.renderViewUI('view-store-hub');
        } else if (savedCustomerFbId) {
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootApp);
} else {
    bootApp();
}

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

function initRealtimeFirebaseListeners() {
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
    } catch(e) {
        console.error("Firebase listener setup error:", e);
    }
}