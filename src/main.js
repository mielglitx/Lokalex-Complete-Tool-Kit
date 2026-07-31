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
// 1. GLOBAL WINDOW BINDER (Fixes all HTML `onclick="..."` calls)
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

// Explicit audio context unlock binding for body click
window.unlockAudioContext = unlockAudioContext;

// -------------------------------------------------------------
// 2. APPLICATION BOOTSTRAPPER
// -------------------------------------------------------------
function bootApp() {
    try {
        if (chat && chat.initDraggableChat) chat.initDraggableChat();
        if (cart && cart.loadCartState) cart.loadCartState();
        if (liveTracker && liveTracker.checkAndInitLiveGpsPortal) liveTracker.checkAndInitLiveGpsPortal();

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
        if (router && router.renderViewUI) {
            router.renderViewUI(appState.telegramId ? 'view-home' : 'view-login');
        }
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
// 3. FIREBASE REALTIME DATABASE LISTENERS
// -------------------------------------------------------------
function initRealtimeFirebaseListeners() {
    try {
        // Roster Rotation Updates
        db.ref('roster').on('value', (snapshot) => {
            globalState.rosterMembers = snapshot.val() ? Object.values(snapshot.val()) : [];
            window.dispatchEvent(new Event('rosterUpdated'));
        });

        // Rider Logins
        db.ref('logins').on('value', (snapshot) => {
            globalState.globalLogins = snapshot.val() ? Object.values(snapshot.val()) : [];
            window.dispatchEvent(new Event('loginsUpdated'));
        });

        // Completed Catering History
        db.ref('cateredHistory').on('value', (snapshot) => {
            globalState.globalCateredHistory = snapshot.val() ? Object.values(snapshot.val()) : [];
            window.dispatchEvent(new Event('cateredUpdated'));
        });

        // Team Chat Comms
        db.ref('chat').on('value', (snapshot) => {
            globalState.chatMessages = snapshot.val() ? Object.values(snapshot.val()) : [];
            window.dispatchEvent(new Event('chatUpdated'));
        });

        // Advanced / Scheduled Orders
        db.ref('advancedOrders').on('value', (snapshot) => {
            globalState.globalAdvancedOrders = snapshot.val() ? Object.values(snapshot.val()) : [];
            if (advancedOrders.checkScheduledDeliveryAlerts) advancedOrders.checkScheduledDeliveryAlerts();
            if (advancedOrders.renderAdvancedOrdersList) advancedOrders.renderAdvancedOrdersList();
        });

        // Map Calculation Records
        db.ref('mapCalculations').on('value', (snapshot) => {
            globalState.globalMapCalculations = snapshot.val() ? Object.values(snapshot.val()) : [];
            if (maps.renderMapCalcBoardList) maps.renderMapCalcBoardList();
        });
    } catch(e) {
        console.error("Firebase listener setup error:", e);
    }
}