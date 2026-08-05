// src/main.js
import { appState, globalState } from './store/state.js';
import { db } from './config/firebase.js';

// --- FEATURE MODULE IMPORTS ---
import * as auth from './features/auth.js';
import * as cart from './features/cart.js';
import * as chat from './features/chat.js';
import * as roster from './features/roster.js';
import * as directory from './features/directory.js';
import * as commission from './features/commission.js';
import * as advancedOrders from './features/advancedOrders.js';
import * as maps from './features/maps.js';
import * as wizard from './features/wizard.js';
import * as liveTracker from './features/liveTracker.js';

// --- UI & HELPER IMPORTS ---
import * as modals from './ui/modals.js';
import * as router from './ui/router.js';
import * as helpers from './utils/helpers.js';
import { unlockAudioContext } from './ui/notifications.js';

// -------------------------------------------------------------
// 1. GLOBAL WINDOW BINDER (Fixes HTML `onclick` handlers)
// -------------------------------------------------------------
const allModules = [
    auth, cart, chat, roster, directory, commission, 
    advancedOrders, maps, wizard, liveTracker, modals, router, helpers
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

// -------------------------------------------------------------
// 2. NETWORK STATUS MONITORING (ONLINE / OFFLINE PILL)
// -------------------------------------------------------------
export function updateNetworkStatus() {
    const pill = document.getElementById('network-status-pill');
    if (!pill) return;

    if (navigator.onLine) {
        pill.className = "flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm transition-all duration-300";
        pill.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span id="network-status-text">ONLINE</span>`;
    } else {
        pill.className = "flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm transition-all duration-300";
        pill.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span><span id="network-status-text">OFFLINE</span>`;
    }
}

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

// -------------------------------------------------------------
// 3. APPLICATION BOOTSTRAPPER & PORTAL ROUTER
// -------------------------------------------------------------
function bootApp() {
    try {
        updateNetworkStatus();

        if (chat && chat.initDraggableChat) chat.initDraggableChat();
        if (cart && cart.loadCartState) cart.loadCartState();

        // LOAD LOCAL ROSTER CACHE INSTANTLY FOR OFFLINE FRONTPAGE
        if (roster && roster.loadRosterCache) roster.loadRosterCache();

        // INSTANT OFFLINE DIRECTORY LOAD & SILENT BACKGROUND SYNC ON STARTUP
        if (directory && directory.silentSyncDirectory) {
            directory.silentSyncDirectory();
        }

        const urlParams = new URLSearchParams(window.location.search);
        
        // ---------------------------------------------------------
        // GUEST / CUSTOMER PUBLIC PORTAL ROUTING
        // ---------------------------------------------------------
        if (urlParams.has('livegps') || urlParams.has('track') || urlParams.has('mapcalc')) {
            const loginView = document.getElementById('view-login');
            if (loginView) loginView.classList.add('hidden');

            const chatWidget = document.getElementById('floating-chat-container');
            if (chatWidget) chatWidget.classList.add('hidden');

            if (urlParams.has('livegps')) {
                if (liveTracker && liveTracker.checkAndInitLiveGpsPortal) liveTracker.checkAndInitLiveGpsPortal();
            } else if (urlParams.has('track')) {
                if (maps && maps.checkAndInitTrackPortal) maps.checkAndInitTrackPortal();
            } else if (urlParams.has('mapcalc')) {
                if (maps && maps.checkAndInitMapCalcPortal) maps.checkAndInitMapCalcPortal();
            }

            initRealtimeFirebaseListeners();
            return; 
        }

        // ---------------------------------------------------------
        // RIDER APP ROUTING
        // ---------------------------------------------------------
        if (appState.telegramId) {
            history.replaceState({ view: 'view-home' }, '', '#view-home');
            router.renderViewUI('view-home');
            initRealtimeFirebaseListeners();
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
    initRealtimeFirebaseListeners();
});

// -------------------------------------------------------------
// 4. FIREBASE REALTIME LISTENERS WITH LOCAL CACHING
// -------------------------------------------------------------
function initRealtimeFirebaseListeners() {
    try {
        db.ref('roster').on('value', (snapshot) => {
            globalState.rosterMembers = snapshot.val() ? Object.values(snapshot.val()) : [];
            if (roster && roster.saveRosterCache) roster.saveRosterCache();
            window.dispatchEvent(new Event('rosterUpdated'));
        });
        db.ref('logins').on('value', (snapshot) => {
            globalState.globalLogins = snapshot.val() ? Object.values(snapshot.val()) : [];
            if (roster && roster.saveRosterCache) roster.saveRosterCache();
            window.dispatchEvent(new Event('loginsUpdated'));
        });
        db.ref('cateredHistory').on('value', (snapshot) => {
            globalState.globalCateredHistory = snapshot.val() ? Object.values(snapshot.val()) : [];
            if (roster && roster.saveRosterCache) roster.saveRosterCache();
            window.dispatchEvent(new Event('cateredUpdated'));
        });
        db.ref('receipts').on('value', (snapshot) => {
            globalState.globalDailyReceipts = snapshot.val() ? Object.values(snapshot.val()) : [];
            window.dispatchEvent(new Event('receiptsUpdated'));
        });
        db.ref('chat').on('value', (snapshot) => {
            globalState.chatMessages = snapshot.val() ? Object.values(snapshot.val()) : [];
            window.dispatchEvent(new Event('chatUpdated'));
        });
        db.ref('advancedOrders').on('value', (snapshot) => {
            globalState.globalAdvancedOrders = snapshot.val() ? Object.values(snapshot.val()) : [];
            if (advancedOrders.checkScheduledDeliveryAlerts) advancedOrders.checkScheduledDeliveryAlerts();
            if (advancedOrders.renderAdvancedOrdersList) advancedOrders.renderAdvancedOrdersList();
        });
        db.ref('mapCalculations').on('value', (snapshot) => {
            globalState.globalMapCalculations = snapshot.val() ? Object.values(snapshot.val()) : [];
            if (maps.renderMapCalcBoardList) maps.renderMapCalcBoardList();
        });
    } catch(e) {
        console.error("Firebase listener setup error:", e);
    }
}