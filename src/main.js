// src/main.js
import { appState, globalState } from './store/state.js';
import { db } from './config/firebase.js';

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

import * as modals from './ui/modals.js';
import * as router from './ui/router.js';
import * as helpers from './utils/helpers.js';
import { unlockAudioContext, showToast } from './ui/notifications.js';

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

export function updateNetworkStatus() {
    const container = document.getElementById('network-status-pill');
    if (!container) return;

    if (navigator.onLine) {
        container.className = "flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm transition-all duration-300";
        container.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>ONLINE</span>`;
    } else {
        container.className = "flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm transition-all duration-300";
        container.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span><span>OFFLINE</span>`;
    }
}

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

function bootApp() {
    try {
        updateNetworkStatus();

        if (chat && chat.initDraggableChat) chat.initDraggableChat();
        if (cart && cart.loadCartState) cart.loadCartState();

        if (commission && commission.fetchRiderUserTypes) {
            commission.fetchRiderUserTypes();
        }

        if (roster && roster.loadRosterCache) roster.loadRosterCache();

        if (directory && directory.silentSyncDirectory) {
            directory.silentSyncDirectory();
        }

        const urlParams = new URLSearchParams(window.location.search);
        
        // Public GPS tracking guest portal routes
        if (urlParams.has('livegps') || urlParams.has('track') || urlParams.has('mapcalc')) {
            const loginView = document.getElementById('view-login');
            if (loginView) loginView.classList.add('hidden');

            const chatWidget = document.getElementById('floating-chat-container');
            if (chatWidget) chatWidget.classList.add('hidden');

            if (urlParams.has('livegps') && liveTracker.checkAndInitLiveGpsPortal) liveTracker.checkAndInitLiveGpsPortal();
            else if (urlParams.has('track') && maps.checkAndInitTrackPortal) maps.checkAndInitTrackPortal();
            else if (urlParams.has('mapcalc') && maps.checkAndInitMapCalcPortal) maps.checkAndInitMapCalcPortal();

            initRealtimeFirebaseListeners();
            return; 
        }

        // Active Session Checks (Rider vs. Customer)
        const savedCustomerFbId = localStorage.getItem('lokalex_customer_fb_id');
        const savedCustomerName = localStorage.getItem('lokalex_customer_name');
        const savedCustomerEmail = localStorage.getItem('lokalex_customer_email');
        const savedCustomerAvatar = localStorage.getItem('lokalex_customer_avatar');

        if (appState.telegramId) {
            // Rider session active
            history.replaceState({ view: 'view-home' }, '', '#view-home');
            router.renderViewUI('view-home');
            initRealtimeFirebaseListeners();
        } else if (savedCustomerFbId) {
            // Customer session active
            appState.customerFacebookId = savedCustomerFbId;
            appState.customerName = savedCustomerName || "Customer";

            const avatarImg = document.getElementById('cust-landing-avatar');
            const nameEl = document.getElementById('cust-landing-name');
            const emailEl = document.getElementById('cust-landing-email');

            if (avatarImg && savedCustomerAvatar) avatarImg.src = savedCustomerAvatar;
            if (nameEl) nameEl.innerText = savedCustomerName || "Customer Account";
            if (emailEl) emailEl.innerText = savedCustomerEmail || "Facebook Connected";

            history.replaceState({ view: 'view-customer-home' }, '', '#view-customer-home');
            router.renderViewUI('view-customer-home');
            initRealtimeFirebaseListeners();
        } else {
            // Default splash login screen
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
    if (commission && commission.fetchRiderUserTypes) {
        commission.fetchRiderUserTypes();
    }
    initRealtimeFirebaseListeners();
});

function initRealtimeFirebaseListeners() {
    try {
        if (roster && roster.listenToSwapRequests) {
            roster.listenToSwapRequests();
        }

        if (chat && chat.listenToCustomerRiderChat) {
            chat.listenToCustomerRiderChat();
        }

        if (chat && chat.listenToAllCustomerChatsForRider) {
            chat.listenToAllCustomerChatsForRider();
        }

        db.ref('roster').on('value', (snapshot) => {
            globalState.rosterMembers = snapshot.val() ? Object.values(snapshot.val()) : [];
            if (roster && roster.saveRosterCache) roster.saveRosterCache();
            window.dispatchEvent(new Event('rosterUpdated'));
        });
        db.ref('blockedUsers').on('value', (snapshot) => {
            globalState.blockedUsers = snapshot.val() || {};
            if (appState.telegramId && auth.isUserBlocked(appState.telegramId)) {
                showToast("🚫 Your account has been blocked by Admin.");
                auth.logout();
            }
        });
        db.ref('commissionPenalties').on('value', (snapshot) => {
            globalState.globalCommissionPenalties = snapshot.val() || {};
            if (commission.refreshCommissionView) commission.refreshCommissionView();
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