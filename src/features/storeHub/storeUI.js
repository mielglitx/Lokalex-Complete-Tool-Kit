// src/features/storeHub/storeUI.js
import { appState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { syncHeaderAndWidgets } from '../../ui/router.js';

import * as stateMod from './ui/storeHubState.js';
import * as audioMod from './ui/storeAudio.js';
import * as profileHoursMod from './ui/storeProfileHours.js';
import * as ordersKDSMod from './ui/storeOrdersKDS.js';
import * as menuUIMod from './ui/storeMenuUI.js';
import * as chatMerchantMod from './ui/storeChatMerchant.js';

export * from './ui/storeHubState.js';
export * from './ui/storeAudio.js';
export * from './ui/storeProfileHours.js';
export * from './ui/storeOrdersKDS.js';
export * from './ui/storeMenuUI.js';
export * from './ui/storeChatMerchant.js';

export async function renderStoreHub() {
    localStorage.setItem('lokalex_active_role', 'merchant');

    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = stateMod.cleanFirebasePathKey(rawStoreId);
    const storeName = appState.merchantStoreName || localStorage.getItem('lokalex_merchant_store_name') || "Merchant Store";
    const username = appState.merchantUsername || localStorage.getItem('lokalex_merchant_username') || "merchant";

    const nameEl = document.getElementById('merch-store-display-name');
    const userEl = document.getElementById('merch-store-username');
    const feedEl = document.getElementById('merch-items-feed');

    if (nameEl) nameEl.innerText = storeName;
    if (userEl) userEl.innerText = `@${username}`;

    syncHeaderAndWidgets('view-store-hub');

    if (!storeId || !db) {
        if (feedEl) {
            feedEl.innerHTML = `
                <div class="text-center text-amber-500 dark:text-amber-400 italic py-12 text-xs bg-cardBg border border-gray-200 dark:border-gray-800 rounded-2xl p-6 flex flex-col items-center gap-2">
                    <i class="fa-solid fa-triangle-exclamation text-2xl text-amber-500"></i>
                    <span>Store session not found. Please log out and sign in again.</span>
                </div>
            `;
        }
        return;
    }

    if (!stateMod.storeHubState.countdownTimerInterval) {
        stateMod.storeHubState.countdownTimerInterval = setInterval(() => {
            ordersKDSMod.updateLiveCountdownTimers();
            profileHoursMod.checkAndApplyStoreOperatingHours();
        }, 1000);
    }

    db.ref('roster').on('value', (snap) => {
        const roster = snap.val() || {};
        stateMod.storeHubState.ridersLocationMap = {};
        Object.entries(roster).forEach(([id, rider]) => {
            if (rider && rider.lat && rider.lng) {
                stateMod.storeHubState.ridersLocationMap[id.toString().trim()] = {
                    lat: parseFloat(rider.lat),
                    lng: parseFloat(rider.lng),
                    riderName: rider.riderName || rider.name || "Rider"
                };
            }
        });
        ordersKDSMod.renderStoreOrders();
    });

    const loadTimeout = setTimeout(() => {
        if (!stateMod.storeHubState.currentMenuData.items || Object.keys(stateMod.storeHubState.currentMenuData.items).length === 0) {
            menuUIMod.renderCategoriesBar();
            menuUIMod.renderItemsFeed();
        }
    }, 2500);

    try {
        db.ref(`stores/${storeId}`).on('value', (snap) => {
            stateMod.storeHubState.currentStoreData = snap.val() || {};
            profileHoursMod.updateStoreProfileUI(stateMod.storeHubState.currentStoreData);
            profileHoursMod.updateStoreStatusButton(stateMod.storeHubState.currentStoreData.isOpen !== false);
            profileHoursMod.renderDailySalesSummary();
            profileHoursMod.checkAndApplyStoreOperatingHours();
        }, (err) => {
            console.warn("Store profile listener error:", err);
            profileHoursMod.updateStoreStatusButton(true);
        });

        db.ref(`storeMenus/${storeId}`).on('value', (snap) => {
            clearTimeout(loadTimeout);
            const val = snap.val();
            stateMod.storeHubState.currentMenuData = {
                categories: (val && val.categories) ? val.categories : {},
                items: (val && val.items) ? val.items : {}
            };
            menuUIMod.renderCategoriesBar();
            menuUIMod.renderItemsFeed();
        }, (err) => {
            clearTimeout(loadTimeout);
            console.error("Store menu listener error:", err);
            stateMod.storeHubState.currentMenuData = { categories: {}, items: {} };
            menuUIMod.renderCategoriesBar();
            menuUIMod.renderItemsFeed();
        });

        db.ref(`storeOrders/${storeId}`).on('value', (snap) => {
            stateMod.storeHubState.currentOrdersData = snap.val() || {};

            let hasPendingUnacknowledged = false;
            Object.entries(stateMod.storeHubState.currentOrdersData).forEach(([id, ord]) => {
                if (ord && (ord.status === 'pending' || !ord.status) && !stateMod.storeHubState.acknowledgedOrders.has(id)) {
                    hasPendingUnacknowledged = true;
                }
            });

            if (hasPendingUnacknowledged) {
                audioMod.startRepeatingKitchenAlarm();
            } else {
                audioMod.stopRepeatingKitchenAlarm();
            }

            ordersKDSMod.renderStoreOrders();
            profileHoursMod.renderDailySalesSummary();
        });
    } catch (e) {
        clearTimeout(loadTimeout);
        console.error("renderStoreHub execution error:", e);
        menuUIMod.renderCategoriesBar();
        menuUIMod.renderItemsFeed();
    }
}

if (typeof window !== 'undefined') {
    window.renderStoreHub = renderStoreHub;
    window.storeHubState = stateMod.storeHubState;

    const modules = [
        stateMod,
        audioMod,
        profileHoursMod,
        ordersKDSMod,
        menuUIMod,
        chatMerchantMod
    ];

    modules.forEach(mod => {
        if (mod) {
            Object.keys(mod).forEach(fn => {
                if (typeof mod[fn] === 'function') {
                    window[fn] = mod[fn];
                }
            });
        }
    });

    window.addEventListener('viewChanged', (e) => {
        if (e.detail === 'view-store-hub') {
            renderStoreHub();
        }
    });

    if (document.getElementById('view-store-hub') && !document.getElementById('view-store-hub').classList.contains('hidden')) {
        renderStoreHub();
    }
}