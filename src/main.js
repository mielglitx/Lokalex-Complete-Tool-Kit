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

import * as modals from './ui/modals.js';
import * as router from './ui/router.js';
import * as helpers from './utils/helpers.js';
import { unlockAudioContext, showToast, showSideNotification } from './ui/notifications.js';

const allModules = [
    authFeature, cart, chat, roster, directory, commission, 
    advancedOrders, maps, wizard, liveTracker, storeHub, 
    customerStorefront, modals, router, helpers
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
                
                showToast(`🔔 ${title}: ${body}`);
                if (showSideNotification) {
                    showSideNotification(title, body, 'fa-bell', 'text-amber-400', 'border-amber-500');
                }

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

export function updateNetworkStatus(forcedState = null) {
    const container = document.getElementById('network-status-pill');
    if (!container) return;

    const isOnline = forcedState !== null ? forcedState : (navigator.onLine && document.visibilityState === 'visible');

    if (isOnline) {
        container.className = "flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm transition-all duration-300";
        container.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>ONLINE</span>`;
    } else {
        container.className = "flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm transition-all duration-300";
        container.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span><span>${navigator.onLine ? 'CONNECTING...' : 'OFFLINE'}</span>`;
    }
}

// FORCE RECONNECT FIREBASE WEBSOCKET ON APP RESUME
export function forceReconnectFirebase() {
    if (isReconnecting) return;
    isReconnecting = true;

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
                });

                if (chat && chat.listenToAllCustomerChatsForRider) {
                    chat.listenToAllCustomerChatsForRider();
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
            }, 150);
        } catch (e) {
            isReconnecting = false;
        }
    } else {
        isReconnecting = false;
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
        updateNetworkStatus(false);
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

function bootApp() {
    try {
        registerServiceWorker();
        updateNetworkStatus();

        const legacyWidget = document.getElementById('floating-chat-container');
        if (legacyWidget) legacyWidget.remove();

        // 1. INSTANT LOCAL CACHE HYDRATION (Zero latency)
        if (roster && roster.loadRosterCache) roster.loadRosterCache();
        if (roster && roster.updateRosterUI) roster.updateRosterUI();
        if (commission && commission.loadCommissionSettingsCache) commission.loadCommissionSettingsCache();
        if (directory && directory.loadDirectoryCache) directory.loadDirectoryCache();
        if (cart && cart.loadCartState) cart.loadCartState();

        // 2. BACKGROUND FIREBASE SYNC
        initRealtimeFirebaseListeners();

        if (commission && commission.fetchCommissionSettings) commission.fetchCommissionSettings();
        if (directory && directory.silentSyncDirectory) directory.silentSyncDirectory();

        // Continuous precision check for Auto End Shift every 15 seconds
        setInterval(() => {
            if (roster && roster.checkAndTriggerAutoEndShift) {
                roster.checkAndTriggerAutoEndShift();
            }
        }, 15000);

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

    initRealtimeFirebaseListeners();
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

        // ROSTER LISTENER GUARANTEES TELEGRAM_ID IS NEVER EMPTY
        db.ref('roster').on('value', (snapshot) => {
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
            globalState.globalAdvancedOrders = snapshot.val() ? Object.values(snapshot.val()) : [];
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