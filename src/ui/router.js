// src/ui/router.js

/**
 * ============================================================================
 * ROUTER, NAVIGATION GUARD & APP ACCESS CONTROLLER
 * ============================================================================
 * 
 * Description:
 * Client-side view routing engine with built-in runtime permission gates:
 * - Digital clock heartbeat and theme state management.
 * - Runtime View Guard: intercepts navigation attempts to restricted sections
 *   (e.g., Smart Cart, Directory, Commission) and displays an alert toast.
 * - Dynamic Dock Synchronization: grays out and locks quick action buttons
 *   on the rider home dashboard when disabled by an administrator.
 * - Capture-phase click listener that halts execution on restricted buttons.
 * ============================================================================
 */

import { showToast } from './notifications.js';
import { appState, globalState } from '../store/state.js';

let backPressCount = 0;
let backPressTimer = null;
let headerClockInterval = null;

// ============================================================================
// 1. LIVE DIGITAL CLOCK ENGINE
// ============================================================================
export function initHeaderClock() {
    updateHeaderClock();
    if (!headerClockInterval) {
        headerClockInterval = setInterval(updateHeaderClock, 1000);
    }
}

export function updateHeaderClock() {
    const clockEl = document.getElementById('header-clock-time');
    if (!clockEl) return;

    const now = new Date();
    clockEl.innerText = now.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

// ============================================================================
// 2. THEME ENGINE & MODAL SYNC
// ============================================================================
export function setTheme(themeMode) {
    localStorage.setItem('lokalex_theme', themeMode);
    applyTheme(themeMode);
    showToast(`🎨 Theme switched to ${themeMode.toUpperCase()}`);
}

export function applyTheme(themeMode) {
    const savedTheme = themeMode || localStorage.getItem('lokalex_theme') || 'system';
    const root = document.documentElement;

    const isSystemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = savedTheme === 'dark' || (savedTheme === 'system' && isSystemDark);

    if (shouldBeDark) {
        root.classList.add('dark');
    } else {
        root.classList.remove('dark');
    }

    syncThemeUI(savedTheme);
}

export function syncThemeUI(activeTheme) {
    const theme = activeTheme || localStorage.getItem('lokalex_theme') || 'system';
    const modes = ['light', 'system', 'dark'];

    modes.forEach(mode => {
        const btn = document.getElementById(`modal-theme-btn-${mode}`);
        if (btn) {
            if (mode === theme) {
                btn.className = "p-2.5 rounded-xl border-2 border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-black text-xs flex items-center justify-center gap-1.5 transition active:scale-95 shadow-sm";
            } else {
                btn.className = "p-2.5 rounded-xl border border-gray-300 dark:border-gray-700/60 bg-gray-50 dark:bg-black/30 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 shadow-xs";
            }
        }
    });
}

if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const savedTheme = localStorage.getItem('lokalex_theme') || 'system';
        if (savedTheme === 'system') {
            applyTheme('system');
        }
    });
}

// ============================================================================
// 3. RIDER APP SECTION ACCESS CONTROLS & DOCK PERMISSION GATES
// ============================================================================

/**
 * Checks whether a specific feature key is permitted for the active rider.
 * Admins are exempt from all restrictions.
 */
export function isFeatureAllowed(featureKey) {
    if (!featureKey) return true;

    const activeRole = localStorage.getItem('lokalex_active_role');
    const riderId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();

    // Customers and Merchants do not use the rider tool gating system
    if (!riderId && activeRole !== 'rider') return true;

    // Full administrators have unrestricted access to all features
    const userType = (appState.userType || localStorage.getItem('userType') || "").toLowerCase().trim();
    if (userType === 'admin') return true;

    let allowedFeatures = null;

    try {
        const cached = localStorage.getItem('lokalex_allowed_features');
        if (cached) allowedFeatures = JSON.parse(cached);
    } catch (e) {}

    if (!allowedFeatures && globalState.rosterMembers) {
        const myRecord = globalState.rosterMembers.find(m => (m.telegramId || m.id || "").toString().trim() === riderId);
        if (myRecord && myRecord.allowedFeatures) {
            allowedFeatures = myRecord.allowedFeatures;
        }
    }

    // Unconfigured features default to allowed
    if (!allowedFeatures) return true;

    return allowedFeatures[featureKey] !== false;
}

/**
 * Validates route navigation requests against the rider's permitted features.
 */
export function isViewPermittedForCurrentRider(targetViewId) {
    if (targetViewId === 'view-cart') return isFeatureAllowed('cart');
    if (targetViewId === 'view-directory') return isFeatureAllowed('directory');
    if (targetViewId === 'view-commission') return isFeatureAllowed('commission');
    return true;
}

/**
 * Dynamically updates the home dashboard quick action dock buttons to reflect
 * active administrative access restrictions.
 */
export function syncRiderAppDockPermissions() {
    const dockConfigs = [
        { selector: '#view-home button[onclick*="view-cart"]', key: 'cart' },
        { selector: '#view-home button[onclick*="openMapCalcBoardModal"]', key: 'mapcalc' },
        { selector: '#view-home button[onclick*="openCommissionScreen"]', key: 'commission' },
        { selector: '#view-home button[onclick*="openAdvancedOrdersModal"]', key: 'advOrders' },
        { selector: '#view-home button[onclick*="promptStartLiveGpsSession"]', key: 'livegps' },
        { selector: '#view-home button[onclick*="openDirectory"]', key: 'directory' },
        { selector: '#view-home button[onclick*="openGCashModal"]', key: 'gcash' }
    ];

    dockConfigs.forEach(({ selector, key }) => {
        const btns = document.querySelectorAll(selector);
        const allowed = isFeatureAllowed(key);
        btns.forEach(btn => {
            if (!allowed) {
                btn.classList.add('opacity-40', 'grayscale');
                btn.setAttribute('data-restricted', 'true');
            } else {
                btn.classList.remove('opacity-40', 'grayscale');
                btn.removeAttribute('data-restricted');
            }
        });
    });
}

// Capture-phase event listener: blocks restricted buttons before inline onclick execution
if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        const restrictedBtn = e.target.closest('[data-restricted="true"]');
        if (restrictedBtn) {
            e.preventDefault();
            e.stopImmediatePropagation();
            showToast("🚫 Access Restricted: Hindi pinahihintulutan ng Admin ang access sa feature na ito.");
        }
    }, true);
}

// ============================================================================
// 4. ROUTING & VIEW CONTROLLERS
// ============================================================================
export function switchView(targetViewId, isBackwards = false, replace = false) {
    if (!isViewPermittedForCurrentRider(targetViewId)) {
        showToast("🚫 Access Restricted: Hindi pinahihintulutan ng Admin ang access sa feature na ito.");
        return;
    }

    if (replace) {
        history.replaceState({ view: targetViewId }, '', '#' + targetViewId);
    } else if (!isBackwards) {
        history.pushState({ view: targetViewId }, '', '#' + targetViewId);
    }
    renderViewUI(targetViewId);
}

export function handleHeaderUserClick() {
    syncThemeUI();
    if (window.openProfileSettingsModal && typeof window.openProfileSettingsModal === 'function') {
        window.openProfileSettingsModal();
    }
}

export function syncHeaderAndWidgets(targetViewId) {
    const appHeader = document.getElementById('app-header');
    const userSection = document.getElementById('header-user-section');
    const avatarEl = document.getElementById('header-user-avatar');
    const nameEl = document.getElementById('header-user-name');
    const roleEl = document.getElementById('header-user-role');
    const badgeIcon = document.getElementById('header-user-badge-icon');
    const networkPill = document.getElementById('network-status-pill');
    const floatingChat = document.getElementById('floating-chat-container');

    initHeaderClock();

    const isLogin = targetViewId === 'view-login';

    if (isLogin) {
        if (appHeader) appHeader.classList.add('hidden');
        if (floatingChat) floatingChat.classList.add('hidden');
        return;
    }

    if (appHeader) appHeader.classList.remove('hidden');
    if (userSection) userSection.classList.remove('hidden');

    const activeRole = localStorage.getItem('lokalex_active_role');

    // 1. MERCHANT VIEW / ROLE
    if (targetViewId === 'view-store-hub' || (!appState.telegramId && activeRole === 'merchant')) {
        const storeName = appState.merchantStoreName || localStorage.getItem('lokalex_merchant_store_name') || "Merchant Store";
        const storeAvatar = localStorage.getItem('lokalex_merchant_avatar') || `https://ui-avatars.com/api/?name=${encodeURIComponent(storeName)}&background=ea580c&color=fff&bold=true&size=128`;

        if (avatarEl) avatarEl.src = storeAvatar;
        if (nameEl) nameEl.innerText = storeName;
        if (roleEl) roleEl.innerText = "Welcome!";
        if (badgeIcon) badgeIcon.className = "fa-solid fa-shop";
        if (userSection) userSection.title = "Click to edit merchant store settings";

        if (networkPill) networkPill.classList.add('hidden');
        if (floatingChat) floatingChat.classList.add('hidden');
    }
    // 2. CUSTOMER VIEW / ROLE
    else if (targetViewId === 'view-customer-home' || (!appState.telegramId && activeRole === 'customer')) {
        const custName = appState.customerName || localStorage.getItem('lokalex_customer_name') || "Customer";
        const custAvatar = localStorage.getItem('lokalex_customer_avatar') || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=10B981&color=fff&bold=true&size=128`;

        if (avatarEl) avatarEl.src = custAvatar;
        if (nameEl) nameEl.innerText = custName;
        if (roleEl) roleEl.innerText = "Welcome!";
        if (badgeIcon) badgeIcon.className = "fa-solid fa-pen";
        if (userSection) userSection.title = "Click to edit customer account";

        if (networkPill) networkPill.classList.add('hidden');
        if (floatingChat) floatingChat.classList.add('hidden');
    }
    // 3. RIDER VIEW / ROLE
    else {
        const riderName = appState.riderName || localStorage.getItem('riderName') || "Rider";
        const riderAvatar = appState.photoUrl || localStorage.getItem('lokalex_photo_url') || localStorage.getItem('riderPhotoUrl') || `https://ui-avatars.com/api/?name=${encodeURIComponent(riderName)}&background=0284c7&color=ffffff&bold=true&size=128`;

        if (avatarEl) avatarEl.src = riderAvatar;
        if (nameEl) nameEl.innerText = riderName;
        if (roleEl) roleEl.innerText = "Welcome!";
        if (badgeIcon) badgeIcon.className = "fa-solid fa-camera";
        if (userSection) userSection.title = "Click to change rider profile";

        if (networkPill) networkPill.classList.remove('hidden');
        if (floatingChat) floatingChat.classList.remove('hidden');
    }
}

export function renderViewUI(targetViewId) {
    document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
    const targetEl = document.getElementById(targetViewId);
    if (targetEl) targetEl.classList.remove('hidden');

    const appHeader = document.getElementById('app-header');
    const backBtn = document.getElementById('back-btn');
    const headerSpacer = document.getElementById('header-spacer');
    const headerTitle = document.getElementById('header-title');

    if (targetViewId === 'view-home' || targetViewId === 'view-login' || targetViewId === 'view-customer-home' || targetViewId === 'view-store-hub') {
        if (appHeader) appHeader.classList.remove('hidden');
        if (backBtn) {
            if (targetViewId === 'view-store-hub' && appState.telegramId) {
                backBtn.classList.remove('hidden');
                if (headerSpacer) headerSpacer.classList.add('hidden');
            } else {
                backBtn.classList.add('hidden');
                if (headerSpacer) headerSpacer.classList.remove('hidden');
            }
        }

        if (targetViewId === 'view-home') {
            if (headerTitle) headerTitle.innerHTML = `L<i class="fa-solid fa-location-dot text-red-500"></i>kalex Hub`;
            syncRiderAppDockPermissions();
        } else if (targetViewId === 'view-customer-home' && headerTitle) {
            headerTitle.innerHTML = `L<i class="fa-solid fa-location-dot text-red-500"></i>kalex Customer Portal`;
        } else if (targetViewId === 'view-store-hub' && headerTitle) {
            const storeName = appState.merchantStoreName || localStorage.getItem('lokalex_merchant_store_name') || "Merchant Store";
            headerTitle.innerHTML = `<i class="fa-solid fa-shop text-orange-400 mr-1.5"></i> ${storeName}`;
        }

        if (targetViewId === 'view-login' && appHeader) appHeader.classList.add('hidden');
    } else {
        if (appHeader) appHeader.classList.remove('hidden');
        if (backBtn) backBtn.classList.remove('hidden');
        if (headerSpacer) headerSpacer.classList.add('hidden');
    }

    syncHeaderAndWidgets(targetViewId);

    window.dispatchEvent(new CustomEvent('viewChanged', { detail: targetViewId }));
}

export function goBack() {
    const currentView = document.querySelector('main > section:not(.hidden)')?.id;
    
    if (currentView === 'view-receipt-final') {
        switchView('view-wizard', true);
        return;
    }

    if (currentView === 'view-store-hub' && appState.telegramId) {
        switchView('view-home', true);
        return;
    }

    if (window.history.length > 1) {
        history.back();
    } else {
        const activeRole = localStorage.getItem('lokalex_active_role');
        const isCustomer = activeRole === 'customer' || (!appState.telegramId && !!localStorage.getItem('lokalex_customer_fb_id'));
        const isMerchant = activeRole === 'merchant' || (!appState.telegramId && !!localStorage.getItem('lokalex_merchant_account_id'));
        
        if (isMerchant) {
            switchView('view-store-hub', true);
        } else {
            switchView(isCustomer ? 'view-customer-home' : 'view-home', true);
        }
    }
}

window.addEventListener('popstate', function(event) {
    const currentView = document.querySelector('main > section:not(.hidden)')?.id;

    if (currentView === 'view-home' || currentView === 'view-login' || currentView === 'view-customer-home' || currentView === 'view-store-hub') {
        backPressCount++;
        if (backPressCount < 3) {
            history.pushState({ view: currentView }, '', '#' + currentView);
            showToast(`Press/Swipe Back ${3 - backPressCount} more time(s) to exit`);
            if (backPressTimer) clearTimeout(backPressTimer);
            backPressTimer = setTimeout(() => { backPressCount = 0; }, 3000);
        } else {
            backPressCount = 0;
        }
    } else {
        backPressCount = 0;
        if (event.state && event.state.view) {
            renderViewUI(event.state.view);
        } else {
            const activeRole = localStorage.getItem('lokalex_active_role');
            const isCustomer = activeRole === 'customer' || (!appState.telegramId && !!localStorage.getItem('lokalex_customer_fb_id'));
            const isMerchant = activeRole === 'merchant' || (!appState.telegramId && !!localStorage.getItem('lokalex_merchant_account_id'));

            if (isMerchant) {
                renderViewUI('view-store-hub');
            } else {
                renderViewUI(isCustomer ? 'view-customer-home' : 'view-home');
            }
        }
    }
});

// Synchronize dock permissions whenever roster updates
window.addEventListener('rosterUpdated', () => {
    syncRiderAppDockPermissions();
});

// Run initialization immediately on evaluation
initHeaderClock();
applyTheme();

if (typeof window !== 'undefined') {
    window.switchView = switchView;
    window.renderViewUI = renderViewUI;
    window.goBack = goBack;
    window.handleHeaderUserClick = handleHeaderUserClick;
    window.syncHeaderAndWidgets = syncHeaderAndWidgets;
    window.setTheme = setTheme;
    window.applyTheme = applyTheme;
    window.syncThemeUI = syncThemeUI;
    window.initHeaderClock = initHeaderClock;
    window.updateHeaderClock = updateHeaderClock;
    window.isFeatureAllowed = isFeatureAllowed;
    window.isViewPermittedForCurrentRider = isViewPermittedForCurrentRider;
    window.syncRiderAppDockPermissions = syncRiderAppDockPermissions;
}
// REMARKS: ROUTER_APP_ACCESS_GUARD_AND_DOCK_SYNC_V1_COMPLETE