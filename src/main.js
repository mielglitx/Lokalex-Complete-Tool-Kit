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
// 2. APPLICATION BOOTSTRAPPER & PORTAL ROUTER
// -------------------------------------------------------------
function bootApp() {
    try {
        if (chat && chat.initDraggableChat) chat.initDraggableChat();
        if (cart && cart.loadCartState) cart.loadCartState();

<<<<<<< HEAD
        const urlParams = new URLSearchParams(window.location.search);
        
        // ---------------------------------------------------------
        // GUEST / CUSTOMER PUBLIC PORTAL ROUTING
        // ---------------------------------------------------------
        if (urlParams.has('livegps') || urlParams.has('track') || urlParams.has('mapcalc')) {
            // Hide the app / login screen for customers
            const loginView = document.getElementById('view-login');
            if (loginView) loginView.classList.add('hidden');

            // Route to the correct GPS portal
            if (urlParams.has('livegps')) {
                if (liveTracker && liveTracker.checkAndInitLiveGpsPortal) liveTracker.checkAndInitLiveGpsPortal();
            } else if (urlParams.has('track')) {
                if (maps && maps.checkAndInitTrackPortal) maps.checkAndInitTrackPortal();
            } else if (urlParams.has('mapcalc')) {
                if (maps && maps.checkAndInitMapCalcPortal) maps.checkAndInitMapCalcPortal();
            }

            // Init listeners so map locations can sync
            initRealtimeFirebaseListeners();
            return; 
        }

        // ---------------------------------------------------------
        // RIDER APP ROUTING
        // ---------------------------------------------------------
=======
        // CHECK IF VISITOR IS OPENING A PUBLIC TRACKING LINK (?livegps=, ?track=, ?mapcalc=)
        const urlParams = new URLSearchParams(window.location.search);
        const isPublicPortalLink = urlParams.has('livegps') || urlParams.has('track') || urlParams.has('mapcalc');

        if (isPublicPortalLink) {
            // HIDE LOGIN VIEW COMPLETELY FOR PUBLIC GUESTS
            const loginView = document.getElementById('view-login');
            if (loginView) loginView.classList.add('hidden');

            // INITIALIZE PUBLIC GPS TRACKING PORTAL
            if (liveTracker && liveTracker.checkAndInitLiveGpsPortal) liveTracker.checkAndInitLiveGpsPortal();
            if (maps && maps.startMapCalcLocationSharing) maps.startMapCalcLocationSharing();

            // CONNECT FIREBASE REAL-TIME LISTENERS WITHOUT LOGIN
            initRealtimeFirebaseListeners();
            return;
        }

        // RIDER APP NAVIGATION
>>>>>>> d3d79567e1dcffa70218e4f882f2204d43ec4f00
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
// 3. FIREBASE REALTIME LISTENERS
// -------------------------------------------------------------
function initRealtimeFirebaseListeners() {
    try {
        db.ref('roster').on('value', (snapshot) => {
            globalState.rosterMembers = snapshot.val() ? Object.values(snapshot.val()) : [];
            window.dispatchEvent(new Event('rosterUpdated'));
        });
        db.ref('logins').on('value', (snapshot) => {
            globalState.globalLogins = snapshot.val() ? Object.values(snapshot.val()) : [];
            window.dispatchEvent(new Event('loginsUpdated'));
        });
        db.ref('cateredHistory').on('value', (snapshot) => {
            globalState.globalCateredHistory = snapshot.val() ? Object.values(snapshot.val()) : [];
            window.dispatchEvent(new Event('cateredUpdated'));
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
