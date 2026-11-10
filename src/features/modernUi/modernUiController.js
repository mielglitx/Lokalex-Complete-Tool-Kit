// src/features/modernUi/modernUiController.js

/**
 * ============================================================================
 * LOKALEX MODERN WORKSPACE & DUAL UI CONTROLLER
 * ============================================================================
 * 
 * Provides the interactive logic for the New GUI workspace and supports
 * seamless, zero-loss switching between Classic and Modern UI.
 * 
 * Core Capabilities:
 * 1. UI Switcher (`Classic UI` <-> `New UI`) with localStorage persistence.
 * 2. Facebook-style drill-down Hamburger menu (Settings, Actions, Directories,
 *    Pathfinder, Admin Settings A-Z).
 * 3. Main 4-Tab Workspace:
 *    - Tab 1: Live Chats Feed with 5 color-coded count circles (Green, Gold,
 *             Blue, Purple, Red) and split-screen list/chat room.
 *    - Tab 2: Lokalex Rider Rotations with exact line # badge (#1, #2, ...).
 *    - Tab 3: Rider Login List with Logged In / Not Logged In ratio (e.g., 3/4)
 *             and clickable profile inspection.
 *    - Tab 4: Catered Customer List with timestamps, elapsed total time,
 *             and admin-only [Void] button.
 * 4. Moveable Floating Cart button (🛒 Cart) strictly bounded inside the
 *    right-hand chat room.
 * 5. Top-right [chat menu ▾] dropdown and bottom composer [menu] pop-up.
 * 6. Bottom persistent Rider status dock (Available, Catering, Break, End, Gross).
 * ============================================================================
 */

import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { escapeHtml, escapeJsAttr, formatTitleCase, getLocalTodayStr } from '../../utils/helpers.js';
import { showToast } from '../../ui/notifications.js';
import { 
    isAdmin, 
    canManageRoster, 
    hasTlPermission, 
    isTL,
    canForceCaterTarget,
    isRiderMatch, 
    isCustomerMatch,
    sortAvailableRiders, 
    getRiderTodayGross, 
    getElapsedCateringTime, 
    getElapsedBreakTime, 
    getElapsedBreakMinutes,
    isSameDateStr,
    normalizeToDateStr,
    calculateSplitDuration,
    parseTimeToMinutes,
    parseQueueTime
} from '../roster/rosterUtils.js';
import { getQueueLineupSettings } from '../roster/rosterQueueSettings.js';
import { getForcedCaterBadgeHtml } from '../roster/ui/rosterBadge.js';
import { openRiderInfoModal } from '../roster/ui/rosterRiderModal.js';
import { 
    getActiveRiderChatCustId, 
    openRiderCustomerChatModal, 
    closeRiderCustomerChatModal 
} from '../chat/riderChat.js';
import { 
    activeRiderChatFilter, 
    cachedCustomerThreadsMap, 
    getLoggedInRiderInfo, 
    isMyCustomerThread,
    getActiveRosterCaterer
} from '../chat/chatFeed/chatFeedState.js';
import { storeChatState } from '../chat/storeChat/storeChatState.js';
import { getSupabase } from '../../config/supabaseClient.js';
import { processCustomerChatMetaData } from '../chat/riderChatFeed.js';
import { adminReassignRiderDayOff, openRiderDayOffModal } from '../roster/rosterDayOff.js';
import { getRiderStorageKey } from '../roster/rosterSchedule.js';

let modernActiveTab = 'chats'; // 'chats' | 'rotations' | 'logins' | 'catered'
let modernChatCategory = 'inbox'; // 'inbox' | 'catering' | 'stores' | 'followup' | 'done' | 'applicant'
let modernSearchQuery = '';
let isFloatingCartDragging = false;
let floatingCartHasMoved = false;
let floatingCartStartX = 0;
let floatingCartStartY = 0;
let floatingCartElemInitialLeft = 0;
let floatingCartElemInitialTop = 0;
let modernClockInterval = null;

// Helper to detect inspector accounts (excluded from rider lists & rotation)
export function isInspectorUser(uType, rId = '', rName = '') {
    const cleanType = (uType || '').toString().toLowerCase().trim();
    if (cleanType === 'inspector') return true;
    const cleanId = (rId || '').toString().trim();
    const cleanName = (rName || '').toString().toLowerCase().trim();
    if (cleanId && globalState.userTypesMap?.[cleanId]?.toString().toLowerCase().trim() === 'inspector') return true;
    if (cleanName && globalState.userTypesMap?.[cleanName]?.toString().toLowerCase().trim() === 'inspector') return true;
    return false;
}

// ============================================================================
// 1. DUAL UI MODE CONTROLLER (CLASSIC <-> MODERN)
// ============================================================================

export function isModernUiActive() {
    if (typeof localStorage === 'undefined') return true;
    // New UI is now the main UI by default unless explicitly set to 'classic'
    return localStorage.getItem('lokalex_ui_mode') !== 'classic';
}

export function toggleLokalexUiMode(targetMode = null) {
    const current = isModernUiActive() ? 'modern' : 'classic';
    let newMode = targetMode;
    if (!newMode) {
        newMode = current === 'modern' ? 'classic' : 'modern';
    }

    localStorage.setItem('lokalex_ui_mode', newMode);
    applyLokalexUiMode(newMode, true);
}

export function applyLokalexUiMode(mode = null, notify = false) {
    const activeMode = mode || (isModernUiActive() ? 'modern' : 'classic');
    const modernWorkspace = document.getElementById('modern-ui-workspace');
    const appHeader = document.getElementById('app-header');
    const homeView = document.getElementById('view-home');
    const currentActiveView = document.querySelector('main > section:not(.hidden)')?.id || 'view-home';

    if (activeMode === 'modern') {
        if (modernWorkspace) {
            modernWorkspace.classList.remove('hidden');
        }
        if (currentActiveView === 'view-home') {
            if (appHeader) appHeader.classList.add('hidden');
            if (homeView) homeView.classList.add('hidden');
        }
        dockChatMessagesToModern();
        syncModernHeaderUser();
        initModernHeaderClock();
        initModernTheme();
        if (typeof window.updateHeaderDataUsagePill === 'function') window.updateHeaderDataUsagePill();
        initFloatingCartDrag();
        refreshAllModernViews();
        if (typeof window.syncChannelBarLockUI === 'function') window.syncChannelBarLockUI();
        if (typeof window.checkScheduledDeliveryAlerts === 'function') window.checkScheduledDeliveryAlerts();
        if (notify) showToast("✨ Switched to New UI");
    } else {
        if (modernWorkspace) {
            modernWorkspace.classList.add('hidden');
        }
        undockChatMessagesFromModern();
        if (currentActiveView === 'view-home') {
            if (appHeader) appHeader.classList.remove('hidden');
            if (homeView) homeView.classList.remove('hidden');
        }
        if (typeof window.checkScheduledDeliveryAlerts === 'function') window.checkScheduledDeliveryAlerts();
        // Restore Classic UI saved theme
        const savedClassicTheme = localStorage.getItem('lokalex_theme_preference') || localStorage.getItem('lokalex_theme') || 'light';
        if (typeof window.applyTheme === 'function') {
            window.applyTheme(savedClassicTheme, false);
        } else if (typeof applyTheme === 'function') {
            applyTheme(savedClassicTheme, false);
        }
        // Force release any lingering body scroll lock when switching to Classic UI
        if (typeof document !== 'undefined' && document.body) {
            document.body.classList.remove('overflow-hidden', 'touch-none');
            document.body.style.overflow = '';
            document.body.style.touchAction = '';
            if (document.documentElement) {
                document.documentElement.classList.remove('overflow-hidden', 'touch-none', 'has-chat-open');
                document.documentElement.style.overflow = '';
                document.documentElement.style.touchAction = '';
            }
        }
        if (notify) showToast("🔄 Switched to Classic UI");
    }
}

// ============================================================================
// 2. DOCKING / UNDOCKING LIVE CHAT MESSAGES
// ============================================================================

export function dockChatMessagesToModern() {
    const modernDock = document.getElementById('modern-chat-messages-dock');
    const classicModal = document.getElementById('rider-chat-modal');
    if (!modernDock || !classicModal) return;

    const elementsToMove = [
        document.getElementById('rider-chat-presence-banner'),
        document.getElementById('rider-chat-lock-banner'),
        document.getElementById('rider-chat-milestone-bar'),
        document.getElementById('quick-replies-drawer'),
        document.getElementById('rider-chat-messages-container')
    ];

    elementsToMove.forEach(el => {
        if (el && el.parentElement !== modernDock) {
            modernDock.appendChild(el);
        }
    });

    if (classicModal) {
        classicModal.classList.add('hidden');
    }
}

export function undockChatMessagesFromModern() {
    const classicModalInner = document.querySelector('#rider-chat-modal > div');
    const modernDock = document.getElementById('modern-chat-messages-dock');
    if (!classicModalInner || !modernDock) return;

    const elementsToMove = [
        document.getElementById('rider-chat-presence-banner'),
        document.getElementById('rider-chat-lock-banner'),
        document.getElementById('rider-chat-milestone-bar'),
        document.getElementById('quick-replies-drawer'),
        document.getElementById('rider-chat-messages-container')
    ];

    const footer = classicModalInner.querySelector('.p-2\\.5, .sm\\:p-3, .border-t') || classicModalInner.lastElementChild;
    elementsToMove.forEach(el => {
        if (el && el.parentElement === modernDock) {
            if (footer) {
                classicModalInner.insertBefore(el, footer);
            } else {
                classicModalInner.appendChild(el);
            }
        }
    });
}

// ============================================================================
// 3. HEADER & CLOCK SYNCHRONIZATION
// ============================================================================

export function syncModernHeaderUser() {
    const riderName = appState.riderName || localStorage.getItem('riderName') || "Rider";
    let avatarUrl = appState.photoUrl || localStorage.getItem('lokalex_photo_url') || "";
    if (!avatarUrl || avatarUrl.includes('litterbox.catbox.moe') || avatarUrl.includes('litter.')) {
        avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(riderName)}&background=10b981&color=ffffff&bold=true&size=128`;
    }

    const headerNameEl = document.getElementById('modern-header-rider-name');
    const headerAvatarEl = document.getElementById('modern-header-avatar');
    const menuNameEl = document.getElementById('modern-menu-rider-name');
    const menuAvatarEl = document.getElementById('modern-menu-avatar');
    const menuRoleEl = document.getElementById('modern-menu-rider-role');

    if (headerNameEl) headerNameEl.innerText = riderName;
    if (headerAvatarEl) headerAvatarEl.src = avatarUrl;
    if (menuNameEl) menuNameEl.innerText = riderName;
    if (menuAvatarEl) menuAvatarEl.src = avatarUrl;

    const userType = (appState.userType || localStorage.getItem('userType') || "rider").toUpperCase();
    if (menuRoleEl) menuRoleEl.innerText = `${userType} Account`;

    // Admin row in Hamburger Menu
    const adminRow = document.getElementById('modern-menu-admin-row');
    if (adminRow) {
        const canSeeAdmin = isAdmin() || canManageRoster() || Boolean(globalState.adminControlsEnabled);
        if (canSeeAdmin) adminRow.classList.remove('hidden');
        else adminRow.classList.add('hidden');
    }
}

export function initModernHeaderClock() {
    updateModernHeaderClock();
    if (!modernClockInterval) {
        modernClockInterval = setInterval(updateModernHeaderClock, 10000);
    }
}

export function updateModernHeaderClock() {
    const clockEl = document.getElementById('modern-header-clock');
    if (clockEl) {
        const now = new Date();
        clockEl.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    }

    const batteryEl = document.getElementById('modern-header-battery');
    const originalBattery = document.getElementById('header-battery-text');
    if (batteryEl && originalBattery) {
        batteryEl.innerText = originalBattery.innerText || '--%';
    }
}

let syncBadgeHideTimeout = null;

/**
 * Updates the modern header sync status pill with optimistic feedback:
 * - 'syncing': Handshake in flight over cellular network (yellow pulsing dot)
 * - 'synced': Successfully confirmed by Supabase (green dot, auto-hides after 3s)
 * - 'queued': Offline or poor signal, safely saved locally in outbox (sky dot)
 */
export function setModernSyncState(state, customLabel = null) {
    const pill = document.getElementById('modern-header-sync-pill');
    const dot = document.getElementById('modern-header-sync-dot');
    const text = document.getElementById('modern-header-sync-text');
    if (!pill || !dot || !text) return;

    if (syncBadgeHideTimeout) {
        clearTimeout(syncBadgeHideTimeout);
        syncBadgeHideTimeout = null;
    }

    if (state === 'syncing') {
        pill.classList.remove('hidden');
        pill.classList.add('flex');
        pill.className = "px-2 py-1 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] sm:text-[11px] font-mono font-bold flex items-center gap-1.5 shrink-0 transition-all duration-300";
        dot.className = "w-2 h-2 rounded-full bg-amber-400 animate-pulse";
        text.innerText = customLabel || "Syncing...";
    } else if (state === 'synced') {
        pill.classList.remove('hidden');
        pill.classList.add('flex');
        pill.className = "px-2 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] sm:text-[11px] font-mono font-bold flex items-center gap-1.5 shrink-0 transition-all duration-300";
        dot.className = "w-2 h-2 rounded-full bg-emerald-400";
        text.innerText = customLabel || "Synced";
        syncBadgeHideTimeout = setTimeout(() => {
            pill.classList.remove('flex');
            pill.classList.add('hidden');
        }, 3000);
    } else if (state === 'queued') {
        pill.classList.remove('hidden');
        pill.classList.add('flex');
        pill.className = "px-2 py-1 rounded-xl bg-sky-500/15 border border-sky-500/40 text-sky-300 text-[10px] sm:text-[11px] font-mono font-bold flex items-center gap-1.5 shrink-0 transition-all duration-300";
        dot.className = "w-2 h-2 rounded-full bg-sky-400 animate-ping";
        text.innerText = customLabel || "Saved (Syncing)";
    } else {
        pill.classList.remove('flex');
        pill.classList.add('hidden');
    }
}

// ============================================================================
// 4. FACEBOOK-STYLE FLOATING DRILL-DOWN MENU
// ============================================================================

export function toggleModernHamburgerMenu(event) {
    if (event) event.stopPropagation();
    const popover = document.getElementById('modern-hamburger-popover');
    if (!popover) return;
    const isHidden = popover.classList.contains('hidden');
    closeModernPopovers();
    if (isHidden) {
        backToModernMenuMain();
        const adminRow = document.getElementById('modern-menu-admin-row');
        if (adminRow) {
            const isUserAdmin = isAdmin();
            const isUserTL = isTL();
            const canManage = typeof canManageRoster === 'function' ? canManageRoster() : (isUserAdmin || isUserTL);
            if (isUserAdmin) {
                adminRow.classList.remove('hidden');
                const titleEl = adminRow.querySelector('span.text-rose-400');
                const subEl = adminRow.querySelector('span.text-slate-400');
                if (titleEl) titleEl.innerText = "Admin Settings (A–Z)";
                if (subEl) subEl.innerText = "All 24 Admin & Dispatch Controls";
            } else if (isUserTL && canManage) {
                adminRow.classList.remove('hidden');
                const titleEl = adminRow.querySelector('span.text-rose-400');
                const subEl = adminRow.querySelector('span.text-slate-400');
                if (titleEl) titleEl.innerText = "TL Supervisory Controls";
                if (subEl) subEl.innerText = "Assigned Team Leader Dispatch Tools";
            } else {
                adminRow.classList.add('hidden');
            }
        }
        popover.classList.remove('hidden');
    } else {
        popover.classList.add('hidden');
    }
}

export function closeModernHamburgerMenu() {
    const popover = document.getElementById('modern-hamburger-popover');
    if (popover) popover.classList.add('hidden');
}

export function backToModernMenuMain() {
    const mainView = document.getElementById('modern-menu-main-view');
    const subView = document.getElementById('modern-menu-sub-view');
    if (mainView) mainView.classList.remove('hidden');
    if (subView) subView.classList.add('hidden');
}

export function openModernMenuCategory(catKey) {
    const mainView = document.getElementById('modern-menu-main-view');
    const subView = document.getElementById('modern-menu-sub-view');
    const subTitle = document.getElementById('modern-menu-sub-title');
    const subItems = document.getElementById('modern-menu-sub-items');
    if (!mainView || !subView || !subTitle || !subItems) return;

    mainView.classList.add('hidden');
    subView.classList.remove('hidden');

    let title = "";
    let items = [];

    if (catKey === 'settings') {
        title = "Settings";
        items = [
            { icon: "fa-chart-simple text-emerald-400", label: "Data Usage Monitor", desc: "Track mobile data (10m, 30m, 1h, 1d, 1mo)", action: () => { closeModernHamburgerMenu(); window.openDataUsageModal && window.openDataUsageModal(); } },
            { icon: "fa-text-height text-sky-400", label: "View / Font size", desc: "Adjust app display scale & font size", action: () => { closeModernHamburgerMenu(); window.openProfileSettingsModal && window.openProfileSettingsModal(); } },
            { icon: "fa-user-pen text-emerald-400", label: "Profile", desc: "Edit personal details & avatar", action: () => { closeModernHamburgerMenu(); window.handleHeaderUserClick && window.handleHeaderUserClick(); } },
            { icon: "fa-key text-amber-400", label: "Security", desc: "Change PIN code & password", action: () => { closeModernHamburgerMenu(); window.openRiderPasswordModal && window.openRiderPasswordModal(); } },
            { icon: "fa-wallet text-blue-400", label: "GCash", desc: "Configure GCash account number & QR", action: () => { closeModernHamburgerMenu(); window.openGCashModal && window.openGCashModal(); } },
            { icon: "fa-arrow-right-arrow-left text-slate-400", label: "Classic UI", desc: "Switch back to the classic single-column layout", action: () => { closeModernHamburgerMenu(); toggleLokalexUiMode('classic'); } }
        ];
    } else if (catKey === 'actions') {
        title = "Actions";
        items = [
            { icon: "fa-cart-shopping text-amber-400", label: "Smart Cart", desc: "Create, view and issue receipts", action: () => { closeModernHamburgerMenu(); window.switchView && window.switchView('view-cart'); } },
            { icon: "fa-calendar-days text-purple-400", label: "Advance Order", desc: "View & track reserved catering dates", action: () => { closeModernHamburgerMenu(); window.openAdvancedOrdersModal && window.openAdvancedOrdersModal(); } },
            { icon: "fa-chart-pie text-emerald-400", label: "Commission", desc: "View earnings, fees and reports", action: () => { closeModernHamburgerMenu(); window.openCommissionScreen && window.openCommissionScreen(); } }
        ];
    } else if (catKey === 'directories') {
        title = "Directories";
        items = [
            { icon: "fa-shop text-orange-400", label: "Store", desc: "Merchant directory & contacts", action: () => { closeModernHamburgerMenu(); window.openDirectory && window.openDirectory('stores'); } },
            { icon: "fa-motorcycle text-blue-400", label: "Riders", desc: "Rider contact directory", action: () => { closeModernHamburgerMenu(); window.openDirectory && window.openDirectory('riders'); } },
            { icon: "fa-users text-teal-400", label: "Customers", desc: "Saved customer phone & delivery addresses", action: () => { closeModernHamburgerMenu(); window.openDirectory && window.openDirectory('customers'); } },
            { icon: "fa-map-location-dot text-rose-400", label: "Delivery Rates / Barangays", desc: "Fare matrix and town barangays", action: () => { closeModernHamburgerMenu(); window.openDirectory && window.openDirectory('barangays'); } }
        ];
    } else if (catKey === 'pathfinder') {
        title = "Pathfinder";
        items = [
            { icon: "fa-route text-emerald-400", label: "Map Calc", desc: "Estimate distance and delivery fares", action: () => { closeModernHamburgerMenu(); window.openMapCalcBoardModal && window.openMapCalcBoardModal(); } },
            { icon: "fa-satellite-dish text-indigo-400", label: "Live GPS", desc: "Start live customer GPS share session", action: () => { closeModernHamburgerMenu(); window.promptStartLiveGpsSession && window.promptStartLiveGpsSession(); } },
            { icon: "fa-share-nodes text-blue-400", label: "Share Location", desc: "Generate map pin link for customer", action: () => { closeModernHamburgerMenu(); window.openLiveCustomerMap && window.openLiveCustomerMap(); } }
        ];
    } else if (catKey === 'admin') {
        const isUserAdmin = isAdmin();
        title = isUserAdmin ? "Admin Settings (A–Z)" : "TL Supervisory Controls";
        const allAdminItems = [
            { icon: "fa-toggle-on text-amber-400", label: "Admin Mode Toggle", desc: "Toggle supervisory action buttons", permKey: null, adminOnly: true, action: () => { closeModernHamburgerMenu(); window.toggleAdminControls && window.toggleAdminControls(!globalState.adminControlsEnabled); } },
            { icon: "fa-clock-rotate-left text-purple-400", label: "Auto End", desc: "Automatic shift termination cutoff", permKey: "canManageAutoEndShift", action: () => { closeModernHamburgerMenu(); window.openAdminAutoEndShiftModal && window.openAdminAutoEndShiftModal(); } },
            { icon: "fa-robot text-purple-400", label: "Auto-Msg", desc: "Automated catering & done responses", permKey: null, adminOnly: true, action: () => { closeModernHamburgerMenu(); window.openAutoMessageSettingsModal && window.openAutoMessageSettingsModal(); } },
            { icon: "fa-user-slash text-rose-400", label: "Ban List", desc: "Blocked users and blacklisted accounts", permKey: "canManageBanList", action: () => { closeModernHamburgerMenu(); window.openAdminBlockModal && window.openAdminBlockModal(); } },
            { icon: "fa-mug-hot text-amber-400", label: "Breaks", desc: "Break allowances and durations", permKey: "canManageBreakSettings", action: () => { closeModernHamburgerMenu(); window.openAdminBreakSettingsModal && window.openAdminBreakSettingsModal(); } },
            { icon: "fa-bell text-yellow-400", label: "Chimes", desc: "Audio alerts & notification tones", permKey: null, adminOnly: false, action: () => { closeModernHamburgerMenu(); window.openChatSoundSettingsModal && window.openChatSoundSettingsModal(); } },
            { icon: "fa-broom text-sky-400", label: "Clear Inbox", desc: "Move active inbox threads to done", permKey: "canClearInbox", action: () => { closeModernHamburgerMenu(); window.clearAllInboxThreads && window.clearAllInboxThreads(); } },
            { icon: "fa-percent text-amber-400", label: "Commission (% Commission)", desc: "Daily commission fees and tier rates", permKey: "canManageCommission", action: () => { closeModernHamburgerMenu(); window.openAdminCommissionSettingsModal && window.openAdminCommissionSettingsModal(); } },
            { icon: "fa-coins text-amber-400", label: "Credits", desc: "Directory search credit balances", permKey: "canManageCredits", action: () => { closeModernHamburgerMenu(); window.openAdminDirectoryCreditsModal && window.openAdminDirectoryCreditsModal(); } },
            { icon: "fa-umbrella-beach text-teal-400", label: "Day Off", desc: "Weekly scheduled day-off view", permKey: null, adminOnly: false, action: () => { closeModernHamburgerMenu(); window.openRiderDayOffModal && window.openRiderDayOffModal(); } },
            { icon: "fa-sliders text-teal-400", label: "Day-Off Rules", desc: "Quotas and day-off change limits", permKey: "canManageDayOff", action: () => { closeModernHamburgerMenu(); window.openAdminDayOffSettingsModal && window.openAdminDayOffSettingsModal(); } },
            { icon: "fa-user-clock text-rose-400", label: "Early Out", desc: "Shift duration & early exit penalty rules", permKey: "canManageEarlyShift", action: () => { closeModernHamburgerMenu(); window.openAdminEarlyShiftModal && window.openAdminEarlyShiftModal(); } },
            { icon: "fa-brands fa-facebook-messenger text-blue-400", label: "FB APIs", desc: "Facebook Messenger webhook tokens", permKey: "canManageFbApis", action: () => { closeModernHamburgerMenu(); window.openAdminFbApiModal && window.openAdminFbApiModal(); } },
            { icon: "fa-map-location-dot text-indigo-400", label: "Find", desc: "Geospatial rider locations map", permKey: null, adminOnly: false, action: () => { closeModernHamburgerMenu(); if (window.openFindRidersModal) window.openFindRidersModal(); else if (window.openFindRidersMap) window.openFindRidersMap(); } },
            { icon: "fa-power-off text-rose-500", label: "Force All End", desc: "Terminate shifts for all riders", permKey: "canEndAllShifts", action: () => { closeModernHamburgerMenu(); window.forceAllEndShift && window.forceAllEndShift(); } },
            { icon: "fa-ban text-rose-400", label: "Full Booking", desc: "Full booking auto-responder toggle", permKey: "canManageFullBooking", action: () => { closeModernHamburgerMenu(); window.openFullBookingModal && window.openFullBookingModal(); } },
            { icon: "fa-arrow-down-short-wide text-purple-400", label: "Lineup Rules", desc: "Queue rotation mode & cooldown buffer", permKey: "canManageQueueSettings", action: () => { closeModernHamburgerMenu(); window.openAdminQueueSettingsModal && window.openAdminQueueSettingsModal(); } },
            { icon: "fa-users-gear text-blue-400", label: "Manage (Riders)", desc: "Accounts, roles, and privileges", permKey: "canManageRiderAccounts", action: () => { closeModernHamburgerMenu(); window.openAdminManageRidersModal && window.openAdminManageRidersModal(); } },
            { icon: "fa-layer-group text-rose-400", label: "Max Orders", desc: "Active catering order capacity caps", permKey: "canManageBookingLimits", action: () => { closeModernHamburgerMenu(); window.openAdminBookingLimitsModal && window.openAdminBookingLimitsModal(); } },
            { icon: "fa-trophy text-amber-400", label: "Performance", desc: "Weekly & monthly rider performance reports", permKey: null, adminOnly: false, action: () => { closeModernHamburgerMenu(); window.openAdminPerformanceTrackerModal && window.openAdminPerformanceTrackerModal(); } },
            { icon: "fa-clock text-purple-400", label: "Schedule", desc: "Rider time-in schedules & early passes", permKey: "canManageSchedules", action: () => { closeModernHamburgerMenu(); window.openAdminTimeInScheduleModal && window.openAdminTimeInScheduleModal(); } },
            { icon: "fa-bullhorn text-sky-400", label: "Send to Many", desc: "Mass broadcast customer announcement", permKey: "canManageBroadcast", action: () => { closeModernHamburgerMenu(); window.openBroadcastModal && window.openBroadcastModal(); } },
            { icon: "fa-shop text-orange-400", label: "Store Hub", desc: "Store accounts & menu administration", permKey: "canManageStoreAccounts", action: () => { closeModernHamburgerMenu(); window.openAdminStoreAccountModal && window.openAdminStoreAccountModal(); } }
        ];

        items = isUserAdmin ? allAdminItems : allAdminItems.filter(it => {
            if (it.adminOnly) return false;
            if (!it.permKey) return true;
            return hasTlPermission(it.permKey);
        });
    }

    subTitle.innerText = title;
    subItems.innerHTML = items.map((it, idx) => `
        <button type="button" id="modern-subitem-btn-${idx}" class="w-full flex items-center justify-between p-2 rounded-xl hover:bg-white/5 transition text-left cursor-pointer">
            <span class="flex items-center gap-2.5 min-w-0">
                <span class="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-xs shrink-0"><i class="fa-solid ${it.icon}"></i></span>
                <span class="min-w-0">
                    <span class="block text-xs font-bold text-white truncate">${escapeHtml(it.label)}</span>
                    <span class="block text-[9.5px] text-slate-400 truncate">${escapeHtml(it.desc)}</span>
                </span>
            </span>
            <i class="fa-solid fa-chevron-right text-slate-500 text-[10px] shrink-0"></i>
        </button>
    `).join('');

    items.forEach((it, idx) => {
        const btn = document.getElementById(`modern-subitem-btn-${idx}`);
        if (btn) btn.onclick = it.action;
    });
}

// ============================================================================
// 5. WORKSPACE TABS & NAVIGATION (CHATS, ROTATIONS, LOGINS, CATERED)
// ============================================================================

export function switchModernWorkspaceTab(tabId) {
    modernActiveTab = tabId;
    const tabs = ['chats', 'rotations', 'logins', 'catered'];
    const isLight = document.getElementById('modern-ui-workspace')?.classList.contains('modern-theme-light') || (typeof getModernTheme === 'function' && getModernTheme() === 'light');

    tabs.forEach(t => {
        const tabBtn = document.getElementById(`modern-main-tab-${t}`);
        const panel = document.getElementById(`modern-panel-${t}`);

        if (t === tabId) {
            if (tabBtn) {
                tabBtn.classList.remove('border-b-transparent', 'text-slate-400', 'text-slate-500');
                tabBtn.classList.add('border-b-emerald-400', 'bg-emerald-500/10');
                if (isLight) {
                    tabBtn.classList.add('text-emerald-800', 'font-black');
                    tabBtn.classList.remove('text-emerald-400');
                } else {
                    tabBtn.classList.add('text-emerald-400');
                    tabBtn.classList.remove('text-emerald-800');
                }
            }
            if (panel) panel.classList.remove('hidden');
        } else {
            if (tabBtn) {
                tabBtn.classList.remove('border-b-emerald-400', 'bg-emerald-500/10', 'text-emerald-400', 'text-emerald-800', 'font-black');
                tabBtn.classList.add('border-b-transparent', 'text-slate-400');
            }
            if (panel) panel.classList.add('hidden');
        }
    });

    closeModernPopovers();
    refreshCurrentTab();
}

export function refreshAllModernViews() {
    updateModernTabBadges();
    refreshCurrentTab();
    syncModernFooterDock();
}

export function refreshCurrentTab() {
    if (modernActiveTab === 'chats') {
        const activeCustId = getActiveRiderChatCustId();
        const filtered = getModernFilteredThreads();
        const cleanActive = String(activeCustId || '').replace(/^(?:fb_|messenger_)+/i, '').trim().toLowerCase();
        const stillExists = cleanActive && filtered.some(t => {
            const cleanT = String(t.custId || t.id || '').replace(/^(?:fb_|messenger_)+/i, '').trim().toLowerCase();
            return cleanT && cleanT === cleanActive;
        });

        if (stillExists) {
            renderModernChatLeftList();
            if (!isCateringChatRoomLocked(activeCustId)) {
                syncModernRightChatRoom();
            }
        } else {
            if (!activeCustId && filtered.length > 0) {
                const first = filtered[0];
                const cid = first.custId || first.id;
                const name = formatTitleCase(first.customerName || first.name || "Customer");
                const avatar = first.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0084FF&color=fff`;
                selectModernCustomerChat(cid, name, avatar);
            } else if (!activeCustId) {
                clearModernChatRightRoom();
                renderModernChatLeftList();
            } else {
                renderModernChatLeftList();
            }
        }
    } else if (modernActiveTab === 'rotations') {
        renderModernRotationsTab();
    } else if (modernActiveTab === 'logins') {
        renderModernLoginsTab();
    } else if (modernActiveTab === 'catered') {
        renderModernCateredTab();
    }
}

// ============================================================================
// 6. TAB BADGE CALCULATIONS (5 CIRCLES, EXACT LINE #, RATIO, CATERED COUNT)
// ============================================================================

export function updateModernTabBadges() {
    const threads = Array.from(cachedCustomerThreadsMap?.values() || []);
    const loggedInAuth = getLoggedInRiderInfo();

    let countInbox = 0;
    let countCatering = 0;
    let countStores = 0;
    let countApplicant = 0;
    let countFollowup = 0;

    threads.forEach(t => {
        const folder = (t.folder || 'inbox').toLowerCase();
        const isDone = t.status === 'completed' || t.status === 'done' || t.status === 'cancelled' || folder === 'done';
        if (folder === 'spam' || folder === 'other' || t.status === 'spam') return;
        if (folder === 'done' || isDone) return;

        // Only count if thread has new/unread message for rider
        const isUnread = Boolean(t.isUnread || t.unreadForRider === true || (t.unreadForRider !== false && t.lastMessage && !t.lastMessage.startsWith('You:')));
        if (!isUnread) return;

        const isCatered = folder === 'catering' || Boolean(t.cateredByRiderName || t.cateredByRiderId || t.cateredBy);
        if (isCatered) {
            // Count for gold circle: customers catered by the logged-in rider with new message
            if (isMyCustomerThread(t, loggedInAuth)) {
                countCatering++;
            }
        } else if (folder === 'applicant' || t.isApplicant === true) {
            countApplicant++;
        } else if (folder === 'followup') {
            countFollowup++;
        } else {
            countInbox++;
        }
    });

    // Stores unread
    try {
        if (storeChatState?.cachedStoreChatsData) {
            Object.values(storeChatState.cachedStoreChatsData).forEach(val => {
                if (val && val.unreadForRider && !val.isDone && val.status !== 'done') {
                    countStores++;
                }
            });
        }
    } catch (_) {}

    const updateBadgeElement = (el, count) => {
        if (!el) return;
        if (count > 0) {
            el.innerText = count > 99 ? '99+' : count.toString();
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    };

    // 1. Update 5 color-coded circles on Tab 1 (only show if it has messages > 0, hide if 0)
    updateBadgeElement(document.getElementById('modern-circle-inbox'), countInbox);
    updateBadgeElement(document.getElementById('modern-circle-catering'), countCatering);
    updateBadgeElement(document.getElementById('modern-circle-store'), countStores);
    updateBadgeElement(document.getElementById('modern-circle-applicant'), countApplicant);
    updateBadgeElement(document.getElementById('modern-circle-followup'), countFollowup);

    // 2. Update category bar badges (only show if it has messages > 0, hide if 0, Done has NO badge)
    updateBadgeElement(document.getElementById('modern-cat-badge-inbox'), countInbox);
    updateBadgeElement(document.getElementById('modern-cat-badge-catering'), countCatering);
    updateBadgeElement(document.getElementById('modern-cat-badge-stores'), countStores);
    updateBadgeElement(document.getElementById('modern-cat-badge-followup'), countFollowup);
    updateBadgeElement(document.getElementById('modern-cat-badge-applicant'), countApplicant);

    // 3. Tab 2 Badge: Exact line # position in queue
    const roster = globalState.rosterMembers || [];
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || '').toString().trim();
    const myRecord = roster.find(m => {
        const mId = (m.telegramId || m.id || '').toString().trim();
        const mName = (m.riderName || m.name || '').toString().trim();
        return (myId && mId && mId === myId) || isRiderMatch(myName, mName, myId, mId);
    });

    const rotBadge = document.getElementById('modern-tab-rotations-badge');
    if (rotBadge) {
        if (!myRecord || myRecord.status === 'End' || !myRecord.status) {
            rotBadge.innerText = "End";
            rotBadge.className = "px-1.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 font-mono font-black text-[10px] shrink-0";
        } else if (myRecord.status === 'Break') {
            rotBadge.innerText = "Break";
            rotBadge.className = "px-1.5 py-0.5 rounded-full bg-sky-500/20 border border-sky-400/50 text-sky-300 font-mono font-black text-[10px] shrink-0";
        } else if (myRecord.status === 'Catering') {
            rotBadge.innerText = "Catering";
            rotBadge.className = "px-1.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 font-mono font-black text-[10px] shrink-0";
        } else {
            const availables = sortAvailableRiders(roster.filter(m => m.status === 'Available'));
            const idx = availables.findIndex(m => {
                const mId = (m.telegramId || m.id || '').toString().trim();
                const mName = (m.riderName || m.name || '').toString().trim();
                return (myId && mId && mId === myId) || isRiderMatch(myName, mName, myId, mId);
            });
            const posText = idx !== -1 ? `#${idx + 1}` : '#1';
            rotBadge.innerText = posText;
            rotBadge.className = "px-1.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 font-mono font-black text-[10px] shrink-0";
        }
    }

    // 4. Tab 3 Badge: Logged In / Not Logged In ratio (e.g. 3/4)
    const todayStr = getLocalTodayStr();
    const todayLogins = (globalState.globalLogins || []).filter(l => {
        if (!l) return false;
        const rawName = l.riderName || "";
        const rId = (l.riderId || l.telegramId || '').toString();
        const member = roster.find(m => isRiderMatch(rawName, m.riderName || m.name || '', rId, (m.telegramId || m.id || '').toString()));
        if (isInspectorUser(l.userType || member?.userType, rId, rawName)) return false;

        if (isSameDateStr(l.date, todayStr)) return true;
        if (l.loginTimestamp && isSameDateStr(new Date(l.loginTimestamp).toLocaleDateString('en-CA'), todayStr)) return true;
        if (l.clockOutTimestamp && isSameDateStr(new Date(l.clockOutTimestamp).toLocaleDateString('en-CA'), todayStr)) return true;
        return false;
    });

    const activeRidersSet = new Set();
    todayLogins.forEach(l => {
        const name = (l.riderName || '').trim().toLowerCase();
        if (name) activeRidersSet.add(name);
    });

    const eligibleRoster = roster.filter(m => !isInspectorUser(m.userType, m.telegramId || m.id, m.riderName || m.name));
    const totalRosterRiders = eligibleRoster.length > 0 ? eligibleRoster : (todayLogins.length > 0 ? todayLogins : [{ name: 'Rider' }]);
    const notLoggedInCount = Math.max(0, eligibleRoster.length - activeRidersSet.size);

    const loginBadge = document.getElementById('modern-tab-logins-badge');
    if (loginBadge) {
        loginBadge.innerHTML = `<span class="text-emerald-400">${activeRidersSet.size}</span>/<span class="text-rose-400">${notLoggedInCount}</span>`;
    }

    // 5. Tab 4 Badge: Catered Customers count
    const cateredBadge = document.getElementById('modern-tab-catered-badge');
    const originalCateredBadge = document.getElementById('catered-count-badge');
    if (cateredBadge) {
        const countTxt = originalCateredBadge?.innerText?.replace(/\D/g, '') || "0";
        cateredBadge.innerText = countTxt;
    }
}

// ============================================================================
// 7. TAB 1: LIVE CHATS FEED & SPLIT CHAT ROOM
// ============================================================================

export function getModernFilteredThreads(customCategory = null) {
    const allThreads = Array.from(cachedCustomerThreadsMap?.values() || []);
    const searchQ = modernSearchQuery;
    const cat = customCategory || modernChatCategory || 'inbox';

    let filtered = allThreads.filter(t => {
        if (searchQ) {
            const name = (t.customerName || t.name || '').toLowerCase();
            const msg = (t.lastMessage || '').toLowerCase();
            const cid = (t.custId || '').toLowerCase();
            return name.includes(searchQ) || msg.includes(searchQ) || cid.includes(searchQ);
        }

        const activeCaterer = (typeof getActiveRosterCaterer === 'function')
            ? getActiveRosterCaterer(t.customerName, t.custId, t)
            : null;
        if (activeCaterer) {
            t.folder = 'catering';
            t.status = 'active';
            t.completedAt = null;
            t.cateredByRiderId = (activeCaterer.telegramId || activeCaterer.id || "").toString().trim();
            t.cateredByRiderName = (activeCaterer.riderName || activeCaterer.name || "Rider").toString().trim();
            t.cateredBy = t.cateredByRiderName;
        }

        const folder = (t.folder || 'inbox').toLowerCase();
        const isExplicitDone = (folder === 'done' || t.status === 'completed' || t.status === 'done' || t.status === 'cancelled');

        // Only consider catering if there is an active roster caterer OR (thread is marked catering/has catering fields AND NOT explicitly done)
        const hasCatering = Boolean(activeCaterer || (!isExplicitDone && (folder === 'catering' || t.cateredByRiderName || t.cateredByRiderId || t.cateredBy)));

        if (hasCatering) {
            t.folder = 'catering';
            t.status = 'active';
            t.completedAt = null;
        } else if (isExplicitDone) {
            // Strictly sanitize finished threads so they cleanly stay in Done
            t.folder = 'done';
            t.status = 'completed';
            t.cateredByRiderName = null;
            t.cateredByRiderId = null;
            t.cateredBy = null;
            t.isForcedCater = false;
        }

        const curFolder = (t.folder || 'inbox').toLowerCase();
        const isDone = !hasCatering && isExplicitDone;

        // Stale caterer sanitization: Only if thread is strictly in inbox or explicitly done without catering
        if (!hasCatering && (curFolder === 'inbox' || isDone)) {
            t.cateredByRiderName = null;
            t.cateredByRiderId = null;
            t.cateredBy = null;
            t.isForcedCater = false;
        }

        const isCatered = hasCatering;

        if (cat === 'done') {
            if (isCatered) return false;
            return curFolder === 'done' || isDone;
        }
        if (isDone) return false;

        if (cat === 'inbox') {
            return !isCatered && curFolder !== 'applicant' && curFolder !== 'followup' && curFolder !== 'stores';
        } else if (cat === 'catering') {
            return isCatered;
        } else if (cat === 'applicant') {
            return !isCatered && (curFolder === 'applicant' || t.isApplicant === true);
        } else if (cat === 'followup') {
            return !isCatered && curFolder === 'followup';
        } else if (cat === 'stores') {
            return !isCatered && curFolder === 'stores';
        }
        return true;
    });

    // In the Catering category, prioritize the rider's own active customers at the very top
    const loggedInAuth = getLoggedInRiderInfo();
    filtered.sort((a, b) => {
        if (cat === 'catering') {
            const aMine = isMyCustomerThread(a, loggedInAuth);
            const bMine = isMyCustomerThread(b, loggedInAuth);
            if (aMine && !bMine) return -1;
            if (!aMine && bMine) return 1;
        }
        return (Number(b.lastUpdated || b.timestamp) || 0) - (Number(a.lastUpdated || a.timestamp) || 0);
    });
    return filtered;
}

export function selectModernChatCategory(category) {
    modernChatCategory = category;
    const categories = ['inbox', 'catering', 'stores', 'followup', 'done', 'applicant'];
    categories.forEach(cat => {
        const btn = document.getElementById(`modern-cat-${cat}`);
        if (!btn) return;
        if (cat === category) {
            btn.className = "px-2.5 py-1 rounded-lg border border-emerald-500/50 bg-emerald-500/15 text-white text-[11px] font-bold flex items-center gap-1.5 shrink-0 cursor-pointer transition";
        } else {
            btn.className = "px-2.5 py-1 rounded-lg border border-transparent hover:border-slate-700 text-slate-300 text-[11px] font-bold flex items-center gap-1.5 shrink-0 cursor-pointer transition";
        }
    });

    const filtered = getModernFilteredThreads(category);
    if (filtered && filtered.length > 0) {
        // Auto open the first chat card in this folder
        const first = filtered[0];
        const cid = first.custId || first.id;
        const name = formatTitleCase(first.customerName || first.name || "Customer");
        const avatar = first.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0084FF&color=fff`;
        selectModernCustomerChat(cid, name, avatar);
    } else {
        // If no chat card exists or is open in this folder, clear out the chat thread section
        clearModernChatRightRoom();
        renderModernChatLeftList();
    }
}

export async function handleModernChatSearch(val) {
    modernSearchQuery = (val || '').trim().toLowerCase();
    const clearBtn = document.getElementById('modern-chat-search-clear');
    const searchInput = document.getElementById('modern-chat-search-input');
    if (searchInput && val === '') searchInput.value = '';
    if (clearBtn) {
        if (modernSearchQuery) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }
    renderModernChatLeftList();

    if (modernSearchQuery.length >= 3) {
        const client = getSupabase ? getSupabase() : null;
        if (client) {
            try {
                const cleanQ = modernSearchQuery;
                const { data } = await client
                    .from('customer_chat_meta')
                    .select('id, data')
                    .or(`id.ilike.%${cleanQ}%,data->>customerName.ilike.%${cleanQ}%`)
                    .limit(15);
                if (data && data.length > 0 && typeof processCustomerChatMetaData === 'function') {
                    const extraData = {};
                    data.forEach(row => {
                        if (row.data) extraData[row.id] = row.data;
                    });
                    processCustomerChatMetaData(extraData, true);
                    renderModernChatLeftList();
                }
            } catch (_) {}
        }
    }
}

export function renderModernChatLeftList() {
    const listContainer = document.getElementById('modern-chat-left-list');
    if (!listContainer) return;

    const filtered = getModernFilteredThreads();
    const activeCustId = getActiveRiderChatCustId();
    const loggedInAuth = getLoggedInRiderInfo();

    if (filtered.length === 0) {
        listContainer.innerHTML = `<div class="text-slate-500 italic text-center py-8 px-2 text-[11px]">No threads in ${escapeHtml(modernChatCategory)}</div>`;
        return;
    }

    const cleanActiveId = String(activeCustId || '').replace(/^(?:fb_|messenger_)+/i, '').trim().toLowerCase();

    listContainer.innerHTML = filtered.map(t => {
        const cid = t.custId || t.id;
        const cleanCid = String(cid || '').replace(/^(?:fb_|messenger_)+/i, '').trim().toLowerCase();
        const isSelected = cleanActiveId && (cid === activeCustId || cleanCid === cleanActiveId);
        const isMine = isMyCustomerThread(t, loggedInAuth);
        const isCateringCategory = modernChatCategory === 'catering';
        const isInboxCategory = modernChatCategory === 'inbox' || (t.folder || '').toLowerCase() === 'inbox';
        const isMyCateredCustomer = !isInboxCategory && isMine && (isCateringCategory || t.folder === 'catering' || (t.cateredByRiderName && t.status !== 'completed' && t.status !== 'done'));
        const name = formatTitleCase(t.customerName || t.name || "Customer");
        const msg = (t.lastMessage || 'No messages yet').replace(/\[Facebook.*?\]/g, '📷 Photo');
        const avatar = t.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0084FF&color=fff`;

        const hasNewMessage = Boolean(t.isUnread || t.unreadForRider === true || (t.unreadForRider !== false && t.lastMessage && !t.lastMessage.startsWith('You:')));

        // Color badge determination
        let badgeColorClass = "bg-emerald-500 text-black";
        if (!isInboxCategory && (t.folder === 'catering' || (t.cateredByRiderName || t.cateredByRiderId))) {
            badgeColorClass = "bg-amber-400 text-black";
        } else if (t.folder === 'stores') {
            badgeColorClass = "bg-blue-500 text-white";
        } else if (t.isApplicant || t.folder === 'applicant') {
            badgeColorClass = "bg-purple-500 text-white";
        } else if (t.folder === 'followup') {
            badgeColorClass = "bg-rose-500 text-white";
        }

        const isLocked = isCateringCategory && !isMyCateredCustomer && isCateringChatRoomLocked(cid, t);
        const lockBadge = isLocked 
            ? `<span class="bg-amber-500/20 text-amber-500 dark:text-amber-400 border border-amber-500/30 text-[8px] font-black px-1 py-0.5 rounded uppercase tracking-wider inline-flex items-center gap-0.5 shrink-0" title="Locked to save data"><i class="fa-solid fa-lock text-[7px]"></i> LOCKED</span>`
            : '';

        const countBadgeHtml = hasNewMessage 
            ? `<span class="w-4 h-4 rounded-full ${badgeColorClass} font-mono font-black text-[9px] inline-flex items-center justify-center shrink-0">1</span>`
            : '';

        const myCustomerBadge = isMyCateredCustomer
            ? `<span class="bg-emerald-500 text-black text-[8px] font-black px-1 py-0.5 rounded uppercase tracking-wider inline-flex items-center gap-0.5 shadow-xs shrink-0" title="Your Catering Customer"><i class="fa-solid fa-motorcycle text-[7px]"></i> YOU</span>`
            : '';

        // Distinctive green border highlight around card for the rider's own catering customer
        let cardContainerClass = "group relative flex flex-col p-2 transition cursor-pointer select-none rounded-xl mx-1 my-1 ";
        if (isMyCateredCustomer) {
            if (isSelected) {
                cardContainerClass += "border-2 border-emerald-400 bg-emerald-500/25 shadow-[0_0_16px_rgba(52,211,153,0.35)] ring-2 ring-emerald-500/40";
            } else {
                cardContainerClass += "border-2 border-emerald-500/90 bg-emerald-950/40 hover:bg-emerald-900/50 shadow-[0_0_12px_rgba(16,185,129,0.25)]";
            }
        } else if (isSelected) {
            cardContainerClass += "border border-emerald-500/40 bg-emerald-500/15 border-l-4 border-l-emerald-400";
        } else {
            cardContainerClass += "border border-transparent hover:bg-white/5";
        }

        return `
        <div id="modern-card-${cid}" class="${cardContainerClass}" onclick="window.selectModernCustomerChat('${escapeHtml(cid)}', '${escapeHtml(name)}', '${escapeHtml(avatar)}')">
            <div class="flex items-center justify-between gap-1 mb-1">
                <div class="flex items-center gap-1 min-w-0 flex-1">
                    ${countBadgeHtml}
                    <span class="font-extrabold text-xs text-white truncate flex-1 min-w-0">${escapeHtml(name)}</span>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    ${lockBadge}
                    ${myCustomerBadge}
                    <!-- Secret Swipe Menu Toggle Button -->
                    <button type="button" onclick="event.stopPropagation(); window.toggleModernCardSwipe('${escapeHtml(cid)}')" class="px-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[9px] font-mono shrink-0 cursor-pointer" title="Reveal Cater / Unread / Done actions">
                        ⇄
                    </button>
                </div>
            </div>
            <p class="text-[10px] text-slate-400 truncate leading-tight">${escapeHtml(msg)}</p>

            <!-- Revealable Secret Action Strip -->
            <div id="modern-card-actions-${cid}" class="hidden flex items-center gap-1 mt-1.5 pt-1.5 border-t border-slate-700/80">
                <button type="button" onclick="event.stopPropagation(); window.handleThreadSwipeCater && window.handleThreadSwipeCater('${escapeHtml(cid)}', '${escapeHtml(name)}');" class="flex-1 py-1 rounded bg-teal-600 hover:bg-teal-500 text-white text-[10px] font-black cursor-pointer">
                    Cater
                </button>
                <button type="button" onclick="event.stopPropagation(); window.handleThreadSwipeUnread && window.handleThreadSwipeUnread('${escapeHtml(cid)}');" class="flex-1 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold cursor-pointer">
                    Unread
                </button>
                <button type="button" onclick="event.stopPropagation(); window.handleThreadSwipeDone && window.handleThreadSwipeDone('${escapeHtml(cid)}');" class="flex-1 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black cursor-pointer">
                    Done
                </button>
            </div>
        </div>`;
    }).join('');
}

export const unlockedCateringChatRooms = new Set();
if (typeof window !== 'undefined') {
    window.unlockedCateringChatRooms = unlockedCateringChatRooms;
}

export function isCateringChatRoomLocked(custId, thread = null) {
    if (!custId) return false;
    const cleanId = String(custId).replace(/^(?:fb_|messenger_)+/i, '').trim().toLowerCase();
    if (unlockedCateringChatRooms.has(custId) || unlockedCateringChatRooms.has(cleanId) || unlockedCateringChatRooms.has(`fb_${cleanId}`)) return false;

    let t = thread;
    if (!t && cachedCustomerThreadsMap) {
        t = cachedCustomerThreadsMap.get(custId) ||
            cachedCustomerThreadsMap.get(`fb_${cleanId}`) ||
            cachedCustomerThreadsMap.get(cleanId);
        if (!t) {
            for (const th of cachedCustomerThreadsMap.values()) {
                const thCid = String(th.custId || th.id || '').replace(/^(?:fb_|messenger_)+/i, '').trim().toLowerCase();
                if (thCid && thCid === cleanId) {
                    t = th;
                    break;
                }
            }
        }
    }
    if (!t) return false;

    // Check if the thread is completed: finished threads must NEVER be locked!
    const isFinished = (t.folder || '').toLowerCase() === 'done' || t.status === 'completed' || t.status === 'done' || t.status === 'cancelled';
    const activeCaterer = (typeof getActiveRosterCaterer === 'function')
        ? getActiveRosterCaterer(t.customerName, t.custId, t)
        : null;
    if (isFinished && !activeCaterer) return false;

    // Check if the thread is in catering folder or actively catered
    const isCatering = Boolean(activeCaterer || (!isFinished && (t.folder === 'catering' || (typeof modernChatCategory !== 'undefined' && modernChatCategory === 'catering'))));
    if (!isCatering) return false;

    // Check if it belongs to another rider
    const loggedInAuth = getLoggedInRiderInfo();
    const isMine = isMyCustomerThread(t, loggedInAuth);
    if (isMine) return false;

    return true;
}

export function renderModernLockedCateringRoom(targetCustId, targetName, targetAvatar) {
    try {
        if (typeof window.stopChatPresence === 'function') window.stopChatPresence();
        if (typeof window.stopFbGraphPolling === 'function') window.stopFbGraphPolling();
    } catch (_) {}

    if (typeof setActiveRiderChatCustId === 'function') {
        setActiveRiderChatCustId(targetCustId);
    }
    if (typeof window !== 'undefined') {
        window.activeRiderChatCustId = targetCustId;
    }

    const allThreads = Array.from(cachedCustomerThreadsMap?.values() || []);
    const cleanTargetId = String(targetCustId || '').replace(/^(?:fb_|messenger_)+/i, '').trim().toLowerCase();
    const t = cachedCustomerThreadsMap?.get(targetCustId) ||
              cachedCustomerThreadsMap?.get(`fb_${cleanTargetId}`) ||
              cachedCustomerThreadsMap?.get(cleanTargetId) ||
              allThreads.find(th => {
                  const thCid = String(th.custId || th.id || '').replace(/^(?:fb_|messenger_)+/i, '').trim().toLowerCase();
                  return thCid && thCid === cleanTargetId;
              });
    const activeCaterer = t ? getActiveRosterCaterer(t.customerName, t.custId, t) : null;
    const catererName = activeCaterer ? (activeCaterer.riderName || activeCaterer.name) : (t?.cateredByRiderName || t?.cateredBy || "Another Rider");

    const effectiveName = formatTitleCase(targetName || t?.customerName || t?.name || "Customer");
    const effectiveAvatar = targetAvatar || t?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(effectiveName)}&background=0084FF&color=fff`;

    const avatarEl = document.getElementById('modern-chat-room-avatar');
    const titleEl = document.getElementById('modern-chat-room-title');
    const subtitleEl = document.getElementById('modern-chat-room-subtitle');
    const infoBtn = document.getElementById('modern-chat-info-btn');

    if (titleEl) titleEl.innerText = effectiveName;
    if (subtitleEl) {
        subtitleEl.innerHTML = `<span class="text-amber-500 font-bold flex items-center gap-1"><i class="fa-solid fa-lock text-[10px]"></i> Locked • Catered by ${escapeHtml(formatTitleCase(catererName))}</span>`;
    }
    if (avatarEl) {
        avatarEl.className = "w-8 h-8 rounded-full bg-slate-800 text-white font-black text-xs flex items-center justify-center overflow-hidden shrink-0 border border-slate-700 select-none";
        avatarEl.innerHTML = `<img src="${effectiveAvatar}" class="w-full h-full object-cover rounded-full">`;
    }
    if (infoBtn) infoBtn.classList.add('hidden');

    ['rider-chat-presence-banner', 'rider-chat-lock-banner', 'rider-chat-milestone-bar', 'quick-replies-drawer'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('hidden');
            el.innerHTML = '';
        }
    });

    const msgContainer = document.getElementById('rider-chat-messages-container') || document.getElementById('rider-cust-chat-messages');
    if (msgContainer) {
        msgContainer.innerHTML = `
        <div class="h-full w-full flex flex-col items-center justify-center text-center p-6 my-auto select-none">
            <div class="w-16 h-16 rounded-3xl bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center text-amber-500 text-2xl mb-3 shadow-md shadow-amber-500/10">
                <i class="fa-solid fa-lock"></i>
            </div>
            <h3 class="text-base font-extrabold text-slate-800 dark:text-white mb-1">Chat Room Locked</h3>
            <p class="text-xs text-slate-600 dark:text-slate-400 max-w-xs mb-3">
                This customer is currently being catered by <span class="font-extrabold text-amber-600 dark:text-amber-400">${escapeHtml(formatTitleCase(catererName))}</span>.
            </p>
            <div class="p-3 mb-5 rounded-xl bg-slate-100 dark:bg-[#11191e] border border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 max-w-xs text-left">
                <div class="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                    <i class="fa-solid fa-shield-halved text-emerald-500"></i> Mobile Data Saver Active
                </div>
                Messages and receipt photos are not downloaded while locked to save your mobile data.
            </div>
            <button type="button" onclick="window.unlockCateringChatRoom('${escapeHtml(targetCustId)}', '${escapeHtml(effectiveName)}', '${escapeHtml(effectiveAvatar)}')" class="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs shadow-md shadow-emerald-600/30 active:scale-95 transition flex items-center gap-2 cursor-pointer">
                <i class="fa-solid fa-lock-open text-xs"></i>
                <span>Unlock & Load Chat</span>
            </button>
        </div>`;
    }

    const input = document.getElementById('rider-cust-chat-input') || document.getElementById('rider-chat-input');
    if (input) {
        input.value = "";
        input.placeholder = `🔒 Locked (Catered by ${formatTitleCase(catererName)})`;
        input.disabled = true;
    }
}

export function unlockCateringChatRoom(custId, name, avatar) {
    if (!custId) return;
    const cleanId = String(custId).replace(/^(?:fb_|messenger_)+/i, '');
    unlockedCateringChatRooms.add(custId);
    unlockedCateringChatRooms.add(cleanId);
    unlockedCateringChatRooms.add(`fb_${cleanId}`);
    if (typeof window.isModernUiActive === 'function' && window.isModernUiActive()) {
        selectModernCustomerChat(custId, name, avatar);
    } else if (typeof window.openRiderCustomerChatModal === 'function') {
        window.openRiderCustomerChatModal(custId, name, avatar);
    }
}

export function selectModernCustomerChat(custId, custName, avatarUrl) {
    if (!custId) return;

    let targetCustId = custId;
    let targetName = custName || custId;
    let targetAvatar = avatarUrl;

    // Resolve true thread custId: First by exact/normalized ID match, and only fallback to customerName if ID not found
    const allThreads = Array.from(cachedCustomerThreadsMap?.values() || []);
    const cleanTargetId = String(targetCustId || '').replace(/^(?:fb_|messenger_)+/i, '').trim().toLowerCase();

    const idMatched = allThreads.find(t => {
        const thCid = String(t.custId || t.id || '').replace(/^(?:fb_|messenger_)+/i, '').trim().toLowerCase();
        return thCid && thCid === cleanTargetId;
    });

    if (idMatched) {
        targetCustId = idMatched.custId || idMatched.id || targetCustId;
        targetName = idMatched.customerName || idMatched.name || targetName;
        targetAvatar = targetAvatar || idMatched.avatarUrl;
    } else {
        const normTarget = String(targetCustId).trim().toLowerCase();
        if (normTarget && normTarget !== 'customer' && normTarget !== 'customer name') {
            const matched = allThreads.find(t => {
                const tName = (t.customerName || t.name || '').trim().toLowerCase();
                return tName && (tName === normTarget || (typeof isCustomerMatch === 'function' && isCustomerMatch(tName, normTarget)));
            });
            if (matched) {
                targetCustId = matched.custId || matched.id;
                targetName = matched.customerName || matched.name || targetName;
                targetAvatar = targetAvatar || matched.avatarUrl;
            }
        }
    }

    if (isCateringChatRoomLocked(targetCustId)) {
        renderModernLockedCateringRoom(targetCustId, targetName, targetAvatar);
        renderModernChatLeftList();
        return;
    }

    openRiderCustomerChatModal(targetCustId, targetName, targetAvatar);
    dockChatMessagesToModern();
    syncModernRightChatRoom();
    renderModernChatLeftList();
}

export function toggleModernCardSwipe(cid) {
    const strip = document.getElementById(`modern-card-actions-${cid}`);
    if (strip) {
        strip.classList.toggle('hidden');
    }
}

let isClearingModernChat = false;
export function clearModernChatRightRoom() {
    if (isClearingModernChat) return;
    isClearingModernChat = true;
    try {
        // 1. Close any active customer chat session
        try {
            if (typeof closeRiderCustomerChatModal === 'function') {
                closeRiderCustomerChatModal();
            } else if (typeof window.closeRiderCustomerChatModal === 'function') {
                window.closeRiderCustomerChatModal();
            }
        } catch (_) {}

        if (typeof setActiveRiderChatCustId === 'function') {
            setActiveRiderChatCustId(null);
        }
        if (typeof window !== 'undefined') {
            window.activeRiderChatCustId = null;
        }

        dockChatMessagesToModern();

        // 2. Clear message thread container
        const msgContainer = document.getElementById('rider-chat-messages-container') || document.getElementById('rider-cust-chat-messages');
        if (msgContainer) {
            msgContainer.innerHTML = `
            <div class="h-full w-full flex flex-col items-center justify-center text-center p-6 text-slate-500 select-none">
                <div class="w-14 h-14 rounded-2xl bg-[#121a1f] border border-slate-800 flex items-center justify-center text-2xl mb-3 shadow-inner">
                    💬
                </div>
                <p class="font-extrabold text-xs sm:text-sm text-slate-300">No Chat Selected</p>
                <p class="text-[11px] text-slate-500 mt-1 max-w-[240px]">No conversation open. Select a customer from the left or switch folders.</p>
            </div>`;
        }

        // 3. Clear/hide all banners and ancillary drawers
        const presenceBanner = document.getElementById('rider-chat-presence-banner');
        if (presenceBanner) {
            presenceBanner.classList.add('hidden');
            presenceBanner.innerHTML = '';
        }
        const lockBanner = document.getElementById('rider-chat-lock-banner');
        if (lockBanner) {
            lockBanner.classList.add('hidden');
            lockBanner.innerHTML = '';
        }
        const milestoneBar = document.getElementById('rider-chat-milestone-bar');
        if (milestoneBar) {
            milestoneBar.classList.add('hidden');
        }
        const quickReplies = document.getElementById('quick-replies-drawer');
        if (quickReplies) {
            quickReplies.classList.add('hidden');
        }

        // 4. Reset Header elements
        const avatarEl = document.getElementById('modern-chat-room-avatar');
        const titleEl = document.getElementById('modern-chat-room-title');
        const subtitleEl = document.getElementById('modern-chat-room-subtitle');
        const infoBtn = document.getElementById('modern-chat-info-btn');
        if (titleEl) titleEl.innerText = "Select a customer";
        if (subtitleEl) subtitleEl.innerText = "Tap any customer on the left to read & reply";
        if (avatarEl) {
            avatarEl.className = "w-8 h-8 rounded-full bg-slate-800 text-slate-400 font-black text-xs flex items-center justify-center overflow-hidden shrink-0 border border-slate-700 select-none";
            avatarEl.innerHTML = "CU";
            avatarEl.title = "No customer selected";
        }
        if (infoBtn) infoBtn.classList.add('hidden');

        // 5. Reset composer input
        const input = document.getElementById('rider-cust-chat-input') || document.getElementById('rider-chat-input');
        if (input) {
            input.value = "";
            input.placeholder = "Select a customer to reply...";
            input.disabled = true;
        }
    } finally {
        isClearingModernChat = false;
    }
}

export function syncModernRightChatRoom() {
    const custId = getActiveRiderChatCustId();

    if (!custId) {
        clearModernChatRightRoom();
        return;
    }

    if (isCateringChatRoomLocked(custId)) {
        return;
    }

    const avatarEl = document.getElementById('modern-chat-room-avatar');
    const titleEl = document.getElementById('modern-chat-room-title');
    const subtitleEl = document.getElementById('modern-chat-room-subtitle');
    const infoBtn = document.getElementById('modern-chat-info-btn');

    const t = cachedCustomerThreadsMap?.get(custId) || cachedCustomerThreadsMap?.get(`fb_${custId}`) || null;
    const name = formatTitleCase(t?.customerName || t?.name || "Customer");
    const avatar = t?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0084FF&color=fff`;

    if (titleEl) titleEl.innerText = name;
    if (subtitleEl) {
        const channelName = t?.apiName || (t?.channel === 'messenger' ? 'Camiling FB' : 'Web Chat');
        subtitleEl.innerText = `${channelName} • Real-time Connected`;
    }
    if (avatarEl) {
        avatarEl.className = "w-8 h-8 rounded-full bg-emerald-600 text-white font-black text-xs flex items-center justify-center overflow-hidden shrink-0 cursor-pointer border border-emerald-400/50";
        avatarEl.innerHTML = `<img src="${avatar}" class="w-full h-full object-cover rounded-full">`;
        avatarEl.title = "View customer photo";
    }
    if (infoBtn) infoBtn.classList.remove('hidden');

    const input = document.getElementById('rider-cust-chat-input') || document.getElementById('rider-chat-input');
    if (input) {
        input.disabled = false;
        input.placeholder = "Type message...";
    }
}

// Top-Right [chat menu ▾] Dropdown
export function toggleModernChatMenuDropdown(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('modern-chat-menu-dropdown');
    if (!dropdown) return;
    const isHidden = dropdown.classList.contains('hidden');
    closeModernPopovers();
    if (isHidden) {
        const forceCaterBtn = document.getElementById('modern-chat-force-cater-btn');
        if (forceCaterBtn) {
            const canForceCater = isAdmin() || hasTlPermission('canForceCater');
            if (canForceCater) forceCaterBtn.classList.remove('hidden');
            else forceCaterBtn.classList.add('hidden');
        }
        dropdown.classList.remove('hidden');
    }
}

export function openAdminForceCaterFromChat() {
    const isUserAdmin = isAdmin();
    const canForceCater = isUserAdmin || hasTlPermission('canForceCater');
    if (!canForceCater) {
        return showToast("⚠️ Unauthorized: You do not have permission to Force Cater.");
    }

    const titleEl = document.getElementById('modern-chat-room-title');
    const meta = (window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {}) || {};
    let custName = titleEl?.innerText?.trim();
    if (!custName || custName === 'Customer Name' || custName === 'Select a customer' || custName.startsWith('FB Customer (')) {
        custName = meta.customerName || meta.name || custName || "";
    }
    if (!custName || custName === 'Select a customer' || custName === 'Customer Name') {
        return showToast("⚠️ Please select an active customer chat first.");
    }

    if (typeof window.openAdminCateringModal === 'function') {
        window.openAdminCateringModal(null, null);
        const custInput = document.getElementById('admin-cater-cust-name') || document.getElementById('catering-customer-name');
        if (custInput) {
            custInput.value = custName;
        }
        const custSelect = document.getElementById('admin-cater-customer-select') || document.getElementById('catering-customer-select');
        if (custSelect) {
            for (let i = 0; i < custSelect.options.length; i++) {
                if (custSelect.options[i].value.toLowerCase() === custName.toLowerCase()) {
                    custSelect.selectedIndex = i;
                    break;
                }
            }
        }
    } else {
        showToast("⚠️ Admin catering modal unavailable.");
    }
}

// Bottom Composer [menu] Pop-up
export function toggleModernComposerMenu(event) {
    if (event) event.stopPropagation();
    const popup = document.getElementById('modern-composer-menu-popup');
    if (!popup) return;
    const isHidden = popup.classList.contains('hidden');
    closeModernPopovers();
    if (isHidden) popup.classList.remove('hidden');
}

export function closeModernPopovers() {
    const popover = document.getElementById('modern-hamburger-popover');
    const chatMenu = document.getElementById('modern-chat-menu-dropdown');
    const composerMenu = document.getElementById('modern-composer-menu-popup');
    if (popover) popover.classList.add('hidden');
    if (chatMenu) chatMenu.classList.add('hidden');
    if (composerMenu) composerMenu.classList.add('hidden');
}

// ============================================================================
// 8. MOVEABLE FLOATING CART BUTTON (DRAGGABLE & CLAMPED INSIDE CHAT ROOM)
// ============================================================================

export function initFloatingCartDrag() {
    // Deprecated: floating cart button removed
}

// ============================================================================
// 9. TAB 2: LOKALEX RIDER ROTATIONS (AVAILABLE, CATERING, BREAK)
// ============================================================================

export function renderModernRotationsToolbar() {
    const toolbar = document.getElementById('modern-rot-admin-toolbar');
    if (!toolbar) return;

    const isUserAdmin = isAdmin();
    const isUserTL = isTL();
    const canManage = typeof canManageRoster === 'function' ? canManageRoster() : (isUserAdmin || isUserTL);

    if (!isUserAdmin && (!isUserTL || !canManage)) {
        toolbar.classList.remove('hidden');
        toolbar.innerHTML = `
            <div class="flex items-center gap-1.5 shrink-0">
                <span class="inline-flex items-center gap-1 px-2 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-black shrink-0"><i class="fa-solid fa-motorcycle"></i> Rider Lineup</span>
            </div>
            <div class="flex-1"></div>
            <button id="modern-refresh-rotations-btn" type="button" onclick="window.handleModernRefreshRotations && window.handleModernRefreshRotations(this)" class="p-1 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold shrink-0 transition active:scale-95 cursor-pointer shadow-xs" title="Refresh Rotations">
                <i class="fa-solid fa-rotate"></i>
            </button>
        `;
        return;
    }

    const toolbarButtons = [
        { label: "Lineup Rules", icon: "fa-arrow-down-short-wide text-purple-400", permKey: "canManageQueueSettings", action: "window.openAdminQueueSettingsModal && window.openAdminQueueSettingsModal()" },
        { label: "Max Orders", icon: "fa-layer-group text-rose-400", permKey: "canManageBookingLimits", action: "window.openAdminBookingLimitsModal && window.openAdminBookingLimitsModal()" },
        { label: "Breaks", icon: "fa-mug-hot text-amber-400", permKey: "canManageBreakSettings", action: "window.openAdminBreakSettingsModal && window.openAdminBreakSettingsModal()" },
        { label: "Day-Off Rules", icon: "fa-sliders text-teal-400", permKey: "canManageDayOff", action: "window.openAdminDayOffSettingsModal && window.openAdminDayOffSettingsModal()" },
        { label: "Schedules", icon: "fa-clock text-purple-400", permKey: "canManageSchedules", action: "window.openAdminTimeInScheduleModal && window.openAdminTimeInScheduleModal()" },
        { label: "Full Booking", icon: "fa-ban text-rose-400", permKey: "canManageFullBooking", action: "window.openFullBookingModal && window.openFullBookingModal()" },
        { label: "Early Out", icon: "fa-user-clock text-rose-400", permKey: "canManageEarlyShift", action: "window.openAdminEarlyShiftModal && window.openAdminEarlyShiftModal()" },
        { label: "Auto End", icon: "fa-clock-rotate-left text-purple-400", permKey: "canManageAutoEndShift", action: "window.openAdminAutoEndShiftModal && window.openAdminAutoEndShiftModal()" },
        { label: "Force All End", icon: "fa-power-off text-rose-500", permKey: "canEndAllShifts", action: "window.forceAllEndShift && window.forceAllEndShift()" },
        { label: "Performance", icon: "fa-trophy text-amber-400", permKey: null, action: "window.openAdminPerformanceTrackerModal && window.openAdminPerformanceTrackerModal()" },
        { label: "Radar", icon: "fa-map-location-dot text-indigo-400", permKey: null, action: "if (window.openFindRidersModal) window.openFindRidersModal(); else if (window.openFindRidersMap) window.openFindRidersMap();" },
        { label: "Manage Riders", icon: "fa-users-gear text-blue-400", permKey: "canManageRiderAccounts", action: "window.openAdminManageRidersModal && window.openAdminManageRidersModal()" },
        { label: "Store Hub", icon: "fa-shop text-orange-400", permKey: "canManageStoreAccounts", action: "window.openAdminStoreAccountModal && window.openAdminStoreAccountModal()" },
        { label: "Ban List", icon: "fa-user-slash text-rose-400", permKey: "canManageBanList", action: "window.openAdminBlockModal && window.openAdminBlockModal()" },
        { label: "Commission", icon: "fa-percent text-amber-400", permKey: "canManageCommission", action: "window.openAdminCommissionSettingsModal && window.openAdminCommissionSettingsModal()" },
        { label: "Credits", icon: "fa-coins text-amber-400", permKey: "canManageCredits", action: "window.openAdminDirectoryCreditsModal && window.openAdminDirectoryCreditsModal()" },
        { label: "Clear Inbox", icon: "fa-broom text-sky-400", permKey: "canClearInbox", action: "window.clearAllInboxThreads && window.clearAllInboxThreads()" },
        { label: "Broadcast", icon: "fa-bullhorn text-sky-400", permKey: "canManageBroadcast", action: "window.openBroadcastModal && window.openBroadcastModal()" },
        { label: "FB APIs", icon: "fa-brands fa-facebook-messenger text-blue-400", permKey: "canManageFbApis", action: "window.openAdminFbApiModal && window.openAdminFbApiModal()" }
    ];

    const visibleButtons = toolbarButtons.filter(btn => isUserAdmin || (btn.permKey ? hasTlPermission(btn.permKey) : true));

    if (!isUserAdmin && visibleButtons.length === 0) {
        toolbar.classList.add('hidden');
        toolbar.innerHTML = '';
        return;
    }

    toolbar.classList.remove('hidden');

    const roleBadgeHtml = isUserAdmin
        ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[10px] font-black shrink-0"><i class="fa-solid fa-shield-halved"></i> Admin Powers</span>`
        : `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-black shrink-0"><i class="fa-solid fa-star"></i> TL Supervisory</span>`;

    toolbar.innerHTML = `
        <div class="flex items-center gap-1.5 shrink-0">
            ${roleBadgeHtml}
        </div>
        <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 min-w-0">
            ${visibleButtons.map(btn => `
                <button type="button" onclick="${btn.action}" class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#182229] hover:bg-white/10 border border-slate-700/80 rounded-xl text-[10px] font-bold text-slate-200 hover:text-white transition active:scale-95 shrink-0 cursor-pointer shadow-xs whitespace-nowrap">
                    <i class="fa-solid ${btn.icon}"></i>
                    <span>${escapeHtml(btn.label)}</span>
                </button>
            `).join('')}
        </div>
        <button id="modern-refresh-rotations-btn" type="button" onclick="window.handleModernRefreshRotations && window.handleModernRefreshRotations(this)" class="p-1 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold shrink-0 transition active:scale-95 cursor-pointer shadow-xs" title="Refresh Rotations">
            <i class="fa-solid fa-rotate"></i>
        </button>
    `;
}

export async function handleModernRefreshRotations(btn = null) {
    if (!btn && typeof document !== 'undefined') {
        btn = document.getElementById('modern-refresh-rotations-btn');
    }
    const icon = btn ? btn.querySelector('i') : null;
    if (icon) icon.classList.add('fa-spin');
    if (btn) {
        btn.disabled = true;
        btn.classList.add('opacity-75');
    }
    const startTime = Date.now();
    try {
        if (typeof window.forceRefreshRosterList === 'function') {
            await window.forceRefreshRosterList(null, true);
        }
        renderModernRotationsTab();
        if (typeof window.showToast === 'function') window.showToast('✓ Rotations lineup refreshed');
    } catch (e) {
        console.warn('Rotations refresh error:', e);
    } finally {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 700 - elapsed);
        setTimeout(() => {
            if (icon) icon.classList.remove('fa-spin');
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('opacity-75');
            }
        }, remaining);
    }
}

export function renderModernRotationsTab() {
    renderModernRotationsToolbar();

    const availList = document.getElementById('modern-rot-avail-list');
    const caterList = document.getElementById('modern-rot-cater-list');
    const breakList = document.getElementById('modern-rot-break-list');
    const availCountEl = document.getElementById('modern-rot-avail-count');
    const caterCountEl = document.getElementById('modern-rot-cater-count');
    const breakCountEl = document.getElementById('modern-rot-break-count');
    if (!availList || !caterList || !breakList) return;

    const roster = (globalState.rosterMembers || []).filter(m => !isInspectorUser(m.userType, m.telegramId || m.id, m.riderName || m.name));
    const availables = sortAvailableRiders(roster.filter(m => m.status === 'Available'));
    const caterings = roster.filter(m => m.status === 'Catering');
    const breaks = roster.filter(m => m.status === 'Break');

    const isUserAdmin = isAdmin();
    const isUserTL = isTL();
    const canShift = isUserAdmin || hasTlPermission('canShiftQueue');
    const canStatus = isUserAdmin || hasTlPermission('canForceStatus');
    const canCater = isUserAdmin || hasTlPermission('canForceCater');
    const canVoidCust = isUserAdmin || hasTlPermission('canVoidCustomer');

    if (availCountEl) availCountEl.innerText = `${availables.length} riders`;
    if (caterCountEl) caterCountEl.innerText = `${caterings.length} active`;
    if (breakCountEl) breakCountEl.innerText = `${breaks.length} on break`;

    const queueSettings = typeof getQueueLineupSettings === 'function' ? getQueueLineupSettings() : { mode: 'lowest_gross', cooldownMinutes: 10 };
    const cooldownMins = parseInt(queueSettings?.cooldownMinutes, 10) || 10;
    const cooldownMs = cooldownMins * 60 * 1000;
    const now = Date.now();

    // 1. Available Column
    if (availables.length === 0) {
        availList.innerHTML = `<div class="text-slate-500 italic text-center py-6 text-xs">No available riders</div>`;
    } else {
        availList.innerHTML = availables.map((m, idx) => {
            const rawName = m.riderName || m.name || "Rider";
            const mId = (m.telegramId || m.id || "").toString();
            const gross = getRiderTodayGross(rawName, mId);
            const mUserType = (m.userType || globalState.userTypesMap?.[mId] || globalState.userTypesMap?.[rawName.toLowerCase()] || '').toString().toLowerCase().trim();
            const canTarget = isUserAdmin || canForceCaterTarget(mUserType, mId);

            const rawTs = m.availableTimestamp || (typeof parseQueueTime === 'function' ? parseQueueTime(m.queueTime) : (Number(m.queueTime) || 0)) || 0;
            const cooldownUntil = m.cooldownUntil || (rawTs > 0 && cooldownMs > 0 ? (rawTs + cooldownMs) : 0);
            let cooldownBadge = "";

            if (cooldownUntil > now) {
                const remSecs = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
                const mins = Math.floor(remSecs / 60);
                const secs = remSecs % 60;
                const timeTag = `${mins}:${String(secs).padStart(2, '0')}`;
                cooldownBadge = ` <span class="queue-cooldown-timer inline-flex items-center gap-1 text-[9px] font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded cursor-default select-none shrink-0" data-cooldown-until="${cooldownUntil}" title="Queue Cooldown Active: Placed at the end of the line for ${cooldownMins}m">⏳ <span class="timer-digits">${timeTag}</span></span>`;
            }

            let controlsHtml = "";
            if (canTarget) {
                let actionSelectHtml = "";
                if (canStatus || canCater) {
                    let optionsHtml = `<option value="" selected>⚡ Action</option>`;
                    if (canStatus) optionsHtml += `<option value="Available">Available</option>`;
                    if (canCater) optionsHtml += `<option value="Catering">Catering</option>`;
                    if (canStatus) {
                        optionsHtml += `<option value="Break">Break</option>`;
                        optionsHtml += `<option value="End">End Shift</option>`;
                    }
                    actionSelectHtml = `
                    <select onchange="const sel = this; const val = sel.value; if (val) { sel.selectedIndex = 0; sel.value = ''; setTimeout(() => { try { sel.selectedIndex = 0; sel.value = ''; } catch(_) {} }, 100); window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeJsAttr(rawName)}', val); }" class="bg-black/60 text-[9px] text-amber-400 border border-slate-700 rounded px-1 py-0.5 cursor-pointer">
                        ${optionsHtml}
                    </select>`;
                }

                let shiftBtnsHtml = "";
                if (canShift) {
                    shiftBtnsHtml = `
                    <div class="inline-flex gap-0.5 text-[9px]">
                        <button onclick="window.adminShiftRiderQueue && window.adminShiftRiderQueue('${mId}', 'move_top')" class="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-1 py-0.5 rounded font-bold transition active:scale-95 cursor-pointer" title="Move Top">⬆️</button>
                        <button onclick="window.adminShiftRiderQueue && window.adminShiftRiderQueue('${mId}', 'move_up')" class="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-1 py-0.5 rounded font-bold transition active:scale-95 cursor-pointer" title="Move Up (+1)">▲</button>
                        <button onclick="window.adminShiftRiderQueue && window.adminShiftRiderQueue('${mId}', 'move_down')" class="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-1 py-0.5 rounded font-bold transition active:scale-95 cursor-pointer" title="Move Down (-1)">▼</button>
                        <button onclick="window.adminShiftRiderQueue && window.adminShiftRiderQueue('${mId}', 'move_bottom')" class="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-1 py-0.5 rounded font-bold transition active:scale-95 cursor-pointer" title="Move Bottom">⬇️</button>
                    </div>`;
                }

                if (actionSelectHtml || shiftBtnsHtml) {
                    controlsHtml = `<div class="inline-flex items-center gap-1 shrink-0">${actionSelectHtml}${shiftBtnsHtml}</div>`;
                }
            }

            return `
            <div class="flex items-center justify-between p-2 rounded-xl bg-black/40 border border-slate-800 hover:border-emerald-500/50 transition gap-1.5">
                <div class="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
                    <span class="font-black text-emerald-400 font-mono text-xs shrink-0">#${idx + 1}</span>
                    <button type="button" onclick="window.openModernRiderProfile('${escapeHtml(mId)}', '${escapeHtml(rawName)}')" class="font-bold text-xs text-white hover:text-emerald-400 truncate text-left cursor-pointer">${escapeHtml(formatTitleCase(rawName))}</button>
                    ${cooldownBadge}
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    ${controlsHtml}
                    <span class="text-[10px] font-mono font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded shrink-0">₱${gross.toFixed(0)}</span>
                </div>
            </div>`;
        }).join('');
    }

    // 2. Catering Column
    if (caterings.length === 0) {
        caterList.innerHTML = `<div class="text-slate-500 italic text-center py-6 text-xs">No active deliveries</div>`;
    } else {
        const loggedIn = getLoggedInRiderInfo();
        const myId = loggedIn?.myId || (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
        const myName = loggedIn?.myName || (appState.riderName || localStorage.getItem('riderName') || '').trim().toLowerCase();

        caterList.innerHTML = caterings.map(m => {
            const rawName = m.riderName || m.name || "Rider";
            const mId = (m.telegramId || m.id || "").toString();
            const mName = formatTitleCase(rawName);
            const gross = getRiderTodayGross(rawName, mId);
            const mUserType = (m.userType || globalState.userTypesMap?.[mId] || globalState.userTypesMap?.[rawName.toLowerCase()] || '').toString().toLowerCase().trim();

            const isMyLine = (myId && mId === myId) || (myName && (mName.toLowerCase() === myName || rawName.toLowerCase() === myName || isRiderMatch(rawName, myName)));
            const canTarget = isUserAdmin || canForceCaterTarget(mUserType, mId);

            const canComplete = isMyLine || (canTarget && (canCater || canVoidCust));
            const canSwap = isMyLine || (canTarget && canCater);
            const canVoid = isMyLine || (canTarget && canVoidCust);
            const canEdit = isUserAdmin || (canTarget && (canCater || canVoidCust));
            const canGet = !isMyLine && !isUserAdmin && !isUserTL;

            const custs = m.customerName ? m.customerName.split(', ').map(c => c.trim()).filter(Boolean) : [];
            const times = m.startTime ? m.startTime.split(', ').map(t => t.trim()) : [];

            let forceActionSelect = "";
            if (canTarget && (canStatus || canCater || canVoidCust)) {
                let optionsHtml = `<option value="" selected>⚡ Action</option>`;
                if (canStatus) optionsHtml += `<option value="Available">Available</option>`;
                if (canCater) optionsHtml += `<option value="Catering">Catering</option>`;
                if (canStatus) {
                    optionsHtml += `<option value="Break">Break</option>`;
                    optionsHtml += `<option value="End">End Shift</option>`;
                }
                if (canVoidCust) optionsHtml += `<option value="VoidActive">🚫 Void All Orders</option>`;

                forceActionSelect = `
                <select onchange="const sel = this; const val = sel.value; if (val) { sel.selectedIndex = 0; sel.value = ''; setTimeout(() => { try { sel.selectedIndex = 0; sel.value = ''; } catch(_) {} }, 100); window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeJsAttr(mName)}', val); }" class="bg-black/60 text-[9px] text-amber-400 border border-slate-700 rounded px-1 py-0.5 cursor-pointer shrink-0">
                    ${optionsHtml}
                </select>`;
            }

            let custCardsHtml = "";
            if (custs.length === 0) {
                custCardsHtml = `<span class="text-[10px] text-slate-500 italic">No customer name assigned</span>`;
            } else {
                custCardsHtml = custs.map((cName, idx) => {
                    const formattedCustName = formatTitleCase(cName);
                    const cTime = times[idx] || times[0] || '';
                    const timeDetails = getElapsedCateringTime(cTime);
                    const forcedBadge = typeof getForcedCaterBadgeHtml === 'function' ? getForcedCaterBadgeHtml(m, cName, mName) : "";

                    return `
                    <div class="flex flex-col gap-1.5 bg-[#182229] p-2 rounded-xl border border-slate-700/60 shadow-xs transition">
                        <div class="flex items-center justify-between gap-1 flex-wrap min-w-0">
                            <button type="button" onclick="window.selectModernCustomerChat('${escapeJsAttr(cName)}', '${escapeJsAttr(cName)}'); window.switchModernWorkspaceTab('chats');" class="text-left font-black text-xs text-amber-300 hover:text-white flex items-center gap-1 truncate cursor-pointer transition" title="Open chat with ${escapeHtml(formattedCustName)}">
                                <span>👤</span>
                                <span class="truncate">${escapeHtml(formattedCustName)}</span>
                                <span class="text-slate-400 text-[10px] font-normal font-mono">(${timeDetails})</span>
                            </button>
                            ${forcedBadge ? `<div class="shrink-0">${forcedBadge}</div>` : ''}
                        </div>

                        <div class="flex flex-wrap items-center gap-1 shrink-0 pt-1 border-t border-slate-800/80">
                            ${canComplete ? `
                                <button type="button" onclick="window.completeSingleCateringCustomer && window.completeSingleCateringCustomer('${mId}', '${escapeJsAttr(mName)}', '${escapeJsAttr(cName)}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-[10px] px-2 py-1 rounded-lg shadow-sm transition active:scale-95 flex items-center gap-1 cursor-pointer" title="Mark this customer delivery as completed">
                                    <i class="fa-solid fa-check"></i> Done
                                </button>
                            ` : ''}

                            ${(isMyLine || isUserAdmin || canTarget) ? `
                                <button type="button" onclick="window.copyCustomerTrackingLink && window.copyCustomerTrackingLink('${escapeJsAttr(cName)}')" class="bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/40 font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 cursor-pointer" title="Copy tracking link">
                                    🔗 Link
                                </button>
                                <button type="button" onclick="window.openLiveCustomerMap && window.openLiveCustomerMap('${escapeJsAttr(cName)}')" class="bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 border border-teal-500/40 font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 cursor-pointer" title="Open Live Map">
                                    🗺️ Map
                                </button>
                            ` : ''}

                            ${canSwap ? `
                                <button type="button" onclick="window.openSwapCustomerModal && window.openSwapCustomerModal('${mId}', '${escapeJsAttr(mName)}', '${escapeJsAttr(cName)}')" class="bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 cursor-pointer" title="Swap customer with another rider">
                                    🔀 Swap
                                </button>
                            ` : ''}

                            ${canGet ? `
                                <button type="button" onclick="window.claimCustomerFromRider && window.claimCustomerFromRider('${mId}', '${escapeJsAttr(mName)}', '${escapeJsAttr(cName)}')" class="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 cursor-pointer" title="Request to get this customer">
                                    📥 Get
                                </button>
                            ` : ''}

                            ${canEdit ? `
                                <button type="button" onclick="window.openEditCateringCustomerModal && window.openEditCateringCustomerModal('${mId}', '${escapeJsAttr(mName)}', '${escapeJsAttr(cName)}')" class="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 cursor-pointer" title="Edit Customer Name">
                                    <i class="fa-solid fa-pen text-[9px]"></i> Edit
                                </button>
                            ` : ''}

                            ${canVoid ? `
                                <button type="button" onclick="window.adminVoidSpecificCustomer && window.adminVoidSpecificCustomer('${mId}', '${escapeJsAttr(mName)}', '${escapeJsAttr(cName)}')" class="bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 cursor-pointer" title="Void specific customer">
                                    <i class="fa-solid fa-ban text-[9px]"></i> Void
                                </button>
                            ` : ''}
                        </div>
                    </div>`;
                }).join('');
            }

            return `
            <div class="flex flex-col p-2.5 rounded-xl bg-black/40 border border-slate-800 gap-1.5">
                <div class="flex items-center justify-between gap-1 flex-wrap">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <button type="button" onclick="window.openModernRiderProfile('${escapeHtml(mId)}', '${escapeHtml(rawName)}')" class="font-black text-xs text-amber-300 hover:underline truncate text-left cursor-pointer">${escapeHtml(formatTitleCase(rawName))}</button>
                        ${forceActionSelect}
                    </div>
                    <span class="text-[10px] font-mono font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded shrink-0">₱${gross.toFixed(0)}</span>
                </div>
                <div class="flex flex-col gap-1.5 pl-1">
                    ${custCardsHtml}
                </div>
            </div>`;
        }).join('');
    }

    // 3. Break Column
    if (breaks.length === 0) {
        breakList.innerHTML = `<div class="text-slate-500 italic text-center py-6 text-xs">No riders on break</div>`;
    } else {
        breakList.innerHTML = breaks.map(m => {
            const rawName = m.riderName || m.name || "Rider";
            const mId = (m.telegramId || m.id || "").toString();
            const gross = getRiderTodayGross(rawName, mId);
            const elapsed = getElapsedBreakTime(m);
            const plannedMins = m.breakDurationMinutes ? parseInt(m.breakDurationMinutes, 10) : null;
            const mUserType = (m.userType || globalState.userTypesMap?.[mId] || globalState.userTypesMap?.[rawName.toLowerCase()] || '').toString().toLowerCase().trim();
            const canTarget = isUserAdmin || canForceCaterTarget(mUserType, mId);

            let breakActionSelect = "";
            if (canTarget && (canStatus || canCater)) {
                let optionsHtml = `<option value="" selected>⚡ Action</option>`;
                if (canStatus) optionsHtml += `<option value="Available">Available</option>`;
                if (canCater) optionsHtml += `<option value="Catering">Catering</option>`;
                if (canStatus) optionsHtml += `<option value="End">End Shift</option>`;

                breakActionSelect = `
                <select onchange="const sel = this; const val = sel.value; if (val) { sel.selectedIndex = 0; sel.value = ''; setTimeout(() => { try { sel.selectedIndex = 0; sel.value = ''; } catch(_) {} }, 100); window.adminForceStatus && window.adminForceStatus('${mId}', '${escapeJsAttr(rawName)}', val); }" class="bg-black/60 text-[9px] text-amber-400 border border-slate-700 rounded px-1 py-0.5 cursor-pointer shrink-0">
                    ${optionsHtml}
                </select>`;
            }

            return `
            <div class="flex items-center justify-between p-2 rounded-xl bg-black/40 border border-slate-800 gap-1.5">
                <div class="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
                    <button type="button" onclick="window.openModernRiderProfile('${escapeHtml(mId)}', '${escapeHtml(rawName)}')" class="font-bold text-xs text-sky-300 hover:underline truncate text-left cursor-pointer">${escapeHtml(formatTitleCase(rawName))}</button>
                    <span class="text-[10px] font-mono text-sky-400 bg-sky-500/10 border border-sky-500/30 px-1.5 py-0.5 rounded shrink-0">${elapsed}${plannedMins ? ` / ${plannedMins}m` : ''}</span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    ${breakActionSelect}
                    <span class="text-[10px] font-mono font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded shrink-0">₱${gross.toFixed(0)}</span>
                </div>
            </div>`;
        }).join('');
    }
}

// ============================================================================
// 10. TAB 3: RIDER LOGIN LIST (LOGGED IN vs NOT LOGGED IN + PROFILE CARD)
// ============================================================================

const DAYS_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function getRiderDayOffDetails(riderId, riderName) {
    const allDayOffs = globalState.riderDayOffs || {};
    const rId = (riderId || '').toString().trim();
    const rName = (riderName || '').trim();
    const cleanName = rName.toLowerCase();
    const storageKey = getRiderStorageKey(rId, rName);

    const roster = globalState.rosterMembers || [];
    const member = roster.find(m => isRiderMatch(rName, m.riderName || m.name || '', rId, (m.telegramId || m.id || '').toString()));

    const rec = allDayOffs[rId] || (storageKey ? allDayOffs[storageKey] : null) || allDayOffs[cleanName] || null;

    let dayOfWeek = null;
    if (rec && rec.dayOfWeek !== undefined && rec.dayOfWeek !== null && parseInt(rec.dayOfWeek) >= 0) {
        dayOfWeek = parseInt(rec.dayOfWeek);
    } else if (member && member.dayOff !== undefined && member.dayOff !== null && parseInt(member.dayOff) >= 0) {
        dayOfWeek = parseInt(member.dayOff);
    }

    const todayDayOfWeek = new Date().getDay();
    const isToday = dayOfWeek !== null && dayOfWeek === todayDayOfWeek;

    const specificDate = rec?.dateStr || rec?.dayOffDate || rec?.date || null;
    const isSpecificDateToday = specificDate && isSameDateStr(specificDate, getLocalTodayStr());

    const isVacationToday = isToday || isSpecificDateToday;

    let label = null;
    if (dayOfWeek !== null && DAYS_NAMES[dayOfWeek]) {
        label = `Every ${SHORT_DAYS[dayOfWeek] || DAYS_NAMES[dayOfWeek]}`;
    } else if (specificDate) {
        label = specificDate;
    }

    return {
        hasDayOff: !!label,
        dayOfWeek,
        label,
        isToday: isVacationToday
    };
}

export function renderModernDayOffBadgeHtml(riderId, rawName) {
    const info = getRiderDayOffDetails(riderId, rawName);

    const loggedIn = getLoggedInRiderInfo();
    const myId = loggedIn?.myId || (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const myName = loggedIn?.myName || (appState.riderName || localStorage.getItem('riderName') || '').trim();
    const isMe = isRiderMatch(rawName, myName, riderId, myId);
    const isUserAdmin = isAdmin() || hasTlPermission('canManageDayOff');
    const canSetDayOff = isUserAdmin || isMe;

    if (info.isToday) {
        // Vacation animation when rider's day off is today
        if (canSetDayOff) {
            return `
            <span onclick="event.stopPropagation(); window.promptSetRiderDayOff && window.promptSetRiderDayOff('${escapeHtml(riderId)}', '${escapeHtml(rawName)}', event);" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-teal-500/20 hover:bg-teal-500/30 border border-teal-400/60 text-teal-300 font-extrabold text-[9.5px] shadow-[0_0_12px_rgba(20,184,166,0.35)] animate-pulse shrink-0 cursor-pointer" title="Day-off is TODAY! (${escapeHtml(info.label)}) • Tap to edit">
                <span class="inline-block animate-bounce text-xs" style="animation-duration: 1.1s;">🏖️</span>
                <span class="uppercase tracking-wider font-black text-[9px] text-teal-200">Day Off</span>
            </span>`;
        } else {
            return `
            <span onclick="event.stopPropagation();" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-teal-500/20 border border-teal-400/60 text-teal-300 font-extrabold text-[9.5px] shadow-[0_0_12px_rgba(20,184,166,0.35)] animate-pulse shrink-0 cursor-default select-none" title="Day-off is TODAY! (${escapeHtml(info.label)})">
                <span class="inline-block animate-bounce text-xs" style="animation-duration: 1.1s;">🏖️</span>
                <span class="uppercase tracking-wider font-black text-[9px] text-teal-200">Day Off</span>
            </span>`;
        }
    }

    if (info.hasDayOff) {
        // Scheduled day-off date/day
        if (canSetDayOff) {
            return `
            <button type="button" onclick="event.stopPropagation(); window.promptSetRiderDayOff && window.promptSetRiderDayOff('${escapeHtml(riderId)}', '${escapeHtml(rawName)}', event);" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#18232a] hover:bg-slate-800 border border-slate-700 hover:border-teal-500/50 text-slate-300 hover:text-teal-300 font-bold text-[9.5px] transition active:scale-95 cursor-pointer shrink-0" title="Scheduled Day-Off: ${escapeHtml(info.label)} • Tap to edit">
                <i class="fa-solid fa-umbrella-beach text-[9px] text-teal-400"></i>
                <span>${escapeHtml(info.label)}</span>
            </button>`;
        } else {
            return `
            <span onclick="event.stopPropagation();" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#18232a] border border-slate-800 text-slate-400 font-bold text-[9.5px] shrink-0 cursor-default select-none" title="Scheduled Day-Off: ${escapeHtml(info.label)}">
                <i class="fa-solid fa-umbrella-beach text-[9px] text-teal-500/70"></i>
                <span>${escapeHtml(info.label)}</span>
            </span>`;
        }
    }

    // Set day-off button when not set: ONLY rendered for Admin or the actual rider themselves!
    if (canSetDayOff) {
        return `
        <button type="button" onclick="event.stopPropagation(); window.promptSetRiderDayOff && window.promptSetRiderDayOff('${escapeHtml(riderId)}', '${escapeHtml(rawName)}', event);" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-teal-500/10 hover:bg-teal-500/25 border border-teal-500/40 hover:border-teal-400 text-teal-400 hover:text-teal-300 font-bold text-[9.5px] transition active:scale-95 cursor-pointer shrink-0 shadow-2xs" title="Set Day-Off for ${escapeHtml(rawName)}">
            <i class="fa-solid fa-plus text-[8.5px]"></i>
            <span>Set Day-Off</span>
        </button>`;
    }

    // Other riders without a day-off set show nothing to non-admins
    return '';
}

export function renderModernLoginsTab() {
    const inList = document.getElementById('modern-login-in-list');
    const outList = document.getElementById('modern-login-out-list');
    const inHeader = document.getElementById('modern-login-in-header');
    const outHeader = document.getElementById('modern-login-out-header');
    const inFooter = document.getElementById('modern-login-in-footer');
    const outFooter = document.getElementById('modern-login-out-footer');
    if (!inList || !outList) return;

    try {
        const todayStr = getLocalTodayStr();
        const roster = globalState.rosterMembers || [];
        const eligibleRoster = roster.filter(m => !isInspectorUser(m?.userType, m?.telegramId || m?.id, m?.riderName || m?.name));

        const todayLogins = (globalState.globalLogins || []).filter(l => {
            if (!l) return false;
            const rawName = l.riderName || "";
            const rId = (l.riderId || l.telegramId || '').toString();
            const member = roster.find(m => isRiderMatch(rawName, m?.riderName || m?.name || '', rId, (m?.telegramId || m?.id || '').toString()));
            if (isInspectorUser(l.userType || member?.userType, rId, rawName)) return false;

            if (isSameDateStr(l.date, todayStr)) return true;
            if (l.loginTimestamp && isSameDateStr(new Date(l.loginTimestamp).toLocaleDateString('en-CA'), todayStr)) return true;
            if (l.clockOutTimestamp && isSameDateStr(new Date(l.clockOutTimestamp).toLocaleDateString('en-CA'), todayStr)) return true;
            return false;
        });

        // AUTO-HEALING: If any rider is currently on duty (Available or Catering)
        // but has no login record today, synthesize and persist their login record immediately!
        eligibleRoster.forEach(m => {
            const rawName = (m?.riderName || m?.name || '').trim();
            const rId = (m?.telegramId || m?.id || '').toString().trim();
            const n = rawName.toLowerCase();
            const isOnDuty = m && (m.status === 'Available' || m.status === 'Catering');
            if (isOnDuty && n && !todayLogins.some(l => (l.riderId || l.id || '').toString() === rId || isRiderMatch(rawName, l.riderName || '', rId, (l.riderId || l.id || '').toString()))) {
                const nowTs = Date.now();
                const timeStr = m.startTime || m.lastUpdated || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const autoEntry = {
                    riderId: rId,
                    id: rId,
                    riderName: rawName,
                    loginTime: timeStr,
                    loginTimestamp: nowTs,
                    firstLoginTime: timeStr,
                    firstLoginTimestamp: nowTs,
                    sessionLoginTimestamp: nowTs,
                    clockOutTime: "",
                    clockOutTimestamp: null,
                    date: todayStr,
                    location: "",
                    earlyShiftPenaltyPercent: 0,
                    deficitHours: 0,
                    totalBreakMinutes: m.totalBreakMinutes || 0,
                    totalBreakSeconds: m.totalBreakSeconds || 0,
                    accumulatedWorkedMinutes: 0,
                    workedMinutes: 0
                };
                todayLogins.push(autoEntry);
                if (!globalState.globalLogins) globalState.globalLogins = [];
                globalState.globalLogins.push(autoEntry);
                if (db && rId) {
                    db.ref(`logins/${rId}`).set(autoEntry).catch(() => {});
                    db.ref(`shiftHistory/${todayStr}_${rId}`).set(autoEntry).catch(() => {});
                }
            }
        });

        const loggedInNames = new Set();
        todayLogins.forEach(l => {
            const n = (l.riderName || '').trim().toLowerCase();
            if (n) loggedInNames.add(n);
        });

        const notLoggedInRiders = eligibleRoster.filter(m => {
            const n = (m?.riderName || m?.name || '').trim().toLowerCase();
            return n && !loggedInNames.has(n);
        });

        const isUserAdmin = isAdmin();
        const isUserTL = isTL();
        const canManage = isUserAdmin || hasTlPermission('canManageRoster') || hasTlPermission('canForceStatus');

        if (inHeader) inHeader.innerText = `Logged IN (${todayLogins.length})`;
        if (outHeader) outHeader.innerText = `Not Logged In (${notLoggedInRiders.length}):`;
        if (inFooter) inFooter.innerHTML = `Logged In: <span class="text-emerald-700 dark:text-emerald-400 font-black">${todayLogins.length} Riders</span> (out of ${eligibleRoster.length} total → ${todayLogins.length}/${notLoggedInRiders.length})`;
        if (outFooter) outFooter.innerHTML = `Not Logged In: <span class="text-rose-700 dark:text-rose-400 font-black">${notLoggedInRiders.length} Riders</span>`;

        // Render Logged IN
        if (todayLogins.length === 0) {
            inList.innerHTML = `<div class="text-slate-500 italic text-center py-4 text-xs">No logins recorded yet today.</div>`;
        } else {
            inList.innerHTML = todayLogins.map((l, idx) => {
                try {
                    const rawName = l.riderName || "Rider";
                    const rId = (l.riderId || l.telegramId || '').toString();
                    const member = roster.find(m => isRiderMatch(rawName, m?.riderName || m?.name || '', rId, (m?.telegramId || m?.id || '').toString()));
                    let timeIn = l.firstLoginTime || l.loginTime || '--:--';

                    const isCurrentlyOnDuty = member ? (member.status && member.status !== 'End') : !l.clockOutTime;
                    const timeOut = isCurrentlyOnDuty 
                        ? '<span class="text-emerald-700 dark:text-emerald-400 font-black">On Duty</span>' 
                        : (l.clockOutTime ? escapeHtml(l.clockOutTime) : '<span class="text-slate-500 font-bold">Ended</span>');
                    const dayOffBadge = renderModernDayOffBadgeHtml(rId, rawName);

                    return `
                    <div class="grid grid-cols-[1.8fr_0.9fr_0.9fr] sm:grid-cols-[2fr_1fr_1fr] items-center p-2 rounded-xl bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-xs transition cursor-pointer" onclick="window.openModernRiderProfile('${escapeHtml(rId)}', '${escapeHtml(rawName)}')">
                        <div class="flex items-center gap-1.5 min-w-0 flex-wrap pr-1">
                            <span class="font-extrabold text-xs text-slate-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 truncate">${idx + 1}. ${escapeHtml(formatTitleCase(rawName))}</span>
                            ${dayOffBadge}
                        </div>
                        <div class="flex items-center gap-1 min-w-0">
                            <span class="font-mono text-xs font-bold text-slate-800 dark:text-slate-300">${escapeHtml(timeIn)}</span>
                            ${canManage ? `
                                <button type="button" onclick="event.stopPropagation(); window.promptAdminSetRiderTimeIn && window.promptAdminSetRiderTimeIn('${escapeHtml(rId)}', '${escapeHtml(rawName)}', '${escapeHtml(timeIn)}')" class="text-[9px] text-slate-500 hover:text-amber-500 px-0.5 transition active:scale-90 cursor-pointer" title="Edit Time In">✏️</button>
                            ` : ''}
                        </div>
                        <span class="font-mono text-xs font-bold text-slate-800 dark:text-slate-300">${timeOut}</span>
                    </div>`;
                } catch (rowErr) {
                    console.error('[ModernLogin] Error rendering row:', rowErr);
                    return '';
                }
            }).join('');
        }

        // Render Not Logged In
        if (notLoggedInRiders.length === 0) {
            outList.innerHTML = `<div class="text-slate-500 italic text-center py-4 text-xs">All registered riders are logged in!</div>`;
        } else {
            outList.innerHTML = notLoggedInRiders.map((m, idx) => {
                try {
                    const rawName = m?.riderName || m?.name || "Rider";
                    const mId = (m?.telegramId || m?.id || '').toString();
                    const dayOffBadge = renderModernDayOffBadgeHtml(mId, rawName);

                    return `
                    <div class="flex items-center justify-between gap-2 p-2 rounded-xl bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-xs transition cursor-pointer" onclick="window.openModernRiderProfile('${escapeHtml(mId)}', '${escapeHtml(rawName)}')">
                        <div class="flex items-center gap-1.5 min-w-0 flex-wrap pr-1">
                            <span class="font-extrabold text-xs text-slate-900 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 truncate">${idx + 1}. ${escapeHtml(formatTitleCase(rawName))}</span>
                            ${dayOffBadge}
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                            ${canManage ? `
                                <button type="button" onclick="event.stopPropagation(); window.promptAdminSetRiderTimeIn && window.promptAdminSetRiderTimeIn('${escapeHtml(mId)}', '${escapeHtml(rawName)}')" class="px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/15 hover:bg-emerald-100 dark:hover:bg-emerald-500/25 border border-emerald-300 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-400 text-[10px] font-black transition active:scale-95 cursor-pointer" title="Manually Set Time In for ${escapeHtml(rawName)}">+ Time In</button>
                            ` : ''}
                            <span class="text-[10px] text-slate-600 dark:text-slate-500 font-mono font-semibold">Offline</span>
                        </div>
                    </div>`;
                } catch (rowErr) {
                    console.error('[ModernNotLogin] Error rendering row:', rowErr);
                    return '';
                }
            }).join('');
        }
    } catch (err) {
        console.error('[ModernLoginsTab] Render error:', err);
    }
}

// Clickable Profile Inspector (Populates inline card and scrolls down immediately)
export async function openModernRiderProfile(riderId, riderName) {
    if (!riderId && !riderName) return;

    // Populate inline modern card (Do not open modal - bottom inspector is enough)
    const card = document.getElementById('modern-rider-profile-card');
    if (!card) return;

    let cloudData = null;
    if (db && riderId) {
        try {
            const snap = await db.ref(`riders/${riderId}`).once('value');
            cloudData = snap.val() || {};
        } catch (_) {}
    }

    const roster = globalState.rosterMembers || [];
    const member = roster.find(m => isRiderMatch(riderName, m.riderName || m.name || '', riderId, (m.telegramId || m.id || '').toString()));
    const photoUrl = cloudData?.photoUrl || member?.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(riderName)}&background=0284c7&color=ffffff&bold=true&size=128`;
    const phone = cloudData?.phone || cloudData?.mobile || member?.phone || "Not Set";
    const address = cloudData?.address || cloudData?.homeAddress || member?.address || "Camiling, Tarlac";
    const gross = getRiderTodayGross(riderName, riderId);

    // Calculate deliveries & daily time served
    const todayStr = getLocalTodayStr();
    let deliveriesCount = 0;
    (globalState.globalDailyReceipts || []).forEach(rc => {
        if (isSameDateStr(rc.date || rc.completedDate, todayStr)) {
            if (isRiderMatch(riderName, rc.riderName || '', riderId, (rc.telegramId || rc.riderId || '').toString())) {
                deliveriesCount++;
            }
        }
    });

    // Time served net of break time
    let timeServedStr = "Not shifted in";
    const loginRec = (globalState.globalLogins || []).find(l => isSameDateStr(l.date, todayStr) && isRiderMatch(riderName, l.riderName || '', riderId, (l.riderId || l.id || '').toString()));
    if (loginRec && (loginRec.loginTime || loginRec.loginTimestamp || loginRec.firstLoginTime)) {
        let grossMins = 0;
        let loginTs = loginRec.sessionLoginTimestamp || loginRec.firstLoginTimestamp || loginRec.loginTimestamp;
        const totalBreakMins = loginRec.totalBreakMinutes || member?.totalBreakMinutes || 0;
        if (!loginTs && (loginRec.firstLoginTime || loginRec.loginTime)) {
            const parsed = parseTimeToMinutes(loginRec.firstLoginTime || loginRec.loginTime);
            if (parsed !== null) {
                const d = new Date();
                d.setHours(Math.floor(parsed / 60), parsed % 60, 0, 0);
                loginTs = d.getTime();
            }
        }

        const isCurrentlyOnDuty = member ? (member.status && member.status !== 'End') : !loginRec.clockOutTime;
        const accumulated = Number(loginRec.accumulatedWorkedMinutes) || 0;

        if (loginTs) {
            if (isCurrentlyOnDuty && !loginRec.clockOutTimestamp) {
                grossMins = Math.max(0, Math.floor((Date.now() - loginTs) / 60000));
                const currentSessionNet = Math.max(0, grossMins - totalBreakMins);
                const totalNetMins = accumulated + currentSessionNet;
                timeServedStr = `${Math.floor(totalNetMins / 60)}h ${totalNetMins % 60}m (Break: ${totalBreakMins}m)`;
            } else {
                // Rider is signed out / ended: time counting has stopped!
                const endTs = loginRec.clockOutTimestamp || loginTs;
                grossMins = Math.max(0, Math.floor((endTs - loginTs) / 60000));
                const sessionNet = Math.max(0, grossMins - totalBreakMins);
                const totalNetMins = Math.max(accumulated, Number(loginRec.workedMinutes) || (accumulated + sessionNet));
                timeServedStr = `${Math.floor(totalNetMins / 60)}h ${totalNetMins % 60}m (Break: ${totalBreakMins}m, Ended)`;
            }
        }
    }

    // Clickable phone number for phone calls
    let phoneHtml = `<span class="text-slate-400 text-[11px]">📞 Not Set</span>`;
    if (phone && phone !== "Not Set") {
        const cleanPhone = phone.replace(/[^0-9+]/g, '');
        phoneHtml = `
        <a href="tel:${escapeHtml(cleanPhone)}" class="text-emerald-400 hover:text-emerald-300 hover:underline inline-flex items-center gap-1 font-mono text-[11px] font-bold transition active:scale-95" title="Tap to call ${escapeHtml(riderName)}">
            <span>📞</span>
            <span>${escapeHtml(phone)}</span>
            <span class="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1 py-0.2 rounded font-sans font-bold ml-1">Call</span>
        </a>`;
    }

    const isUserAdmin = isAdmin();
    const isUserTL = isTL();
    const canManage = isUserAdmin || hasTlPermission('canManageRoster') || hasTlPermission('canForceStatus');

    card.innerHTML = `
    <div class="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
        <span class="text-xs font-black text-emerald-400 uppercase tracking-wide">Rider Profile Inspector</span>
        <button type="button" onclick="window.openRiderInfoModal && window.openRiderInfoModal('${escapeHtml(riderId)}', '${escapeHtml(riderName)}')" class="text-[10px] text-sky-400 font-bold hover:underline cursor-pointer">Full Details ↗</button>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-[auto_1fr_1fr] items-center gap-3">
        <img src="${photoUrl}" class="w-14 h-14 rounded-full object-cover border-2 border-emerald-500 shadow-md mx-auto sm:mx-0">
        <div class="flex flex-col gap-0.5 text-xs">
            <span class="font-extrabold text-white text-sm">${escapeHtml(formatTitleCase(riderName))}</span>
            ${phoneHtml}
            <span class="text-slate-400 text-[11px]">📍 ${escapeHtml(address)}</span>
        </div>
        <div class="grid grid-cols-2 gap-1.5 text-[10px] font-mono bg-black/40 p-2 rounded-xl border border-slate-800">
            <div><span class="text-slate-400">Gross:</span> <span class="text-emerald-400 font-bold">₱${gross.toFixed(2)}</span></div>
            <div><span class="text-slate-400">Orders:</span> <span class="text-white font-bold">${deliveriesCount}</span></div>
            <div class="col-span-2"><span class="text-slate-400">Duty Served:</span> <span class="text-amber-300 font-bold">${timeServedStr}</span></div>
            ${canManage ? `
                <div class="col-span-2 pt-1.5 mt-0.5 border-t border-slate-800/80 flex items-center justify-between">
                    <span class="text-slate-400">Time In:</span>
                    <button type="button" onclick="window.promptAdminSetRiderTimeIn && window.promptAdminSetRiderTimeIn('${escapeHtml(riderId)}', '${escapeHtml(riderName)}', '${escapeHtml(loginRec?.loginTime || '')}')" class="px-2 py-0.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 font-sans font-bold text-[10px] transition active:scale-95 cursor-pointer shadow-2xs">
                        ⏱️ ${loginRec?.loginTime ? `Edit Time In (${escapeHtml(loginRec.loginTime)})` : `+ Set Time In`}
                    </button>
                </div>
            ` : ''}
        </div>
    </div>`;

    // Immediately scroll down to the rider profile inspector for faster viewing
    try {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        card.classList.add('ring-2', 'ring-emerald-400');
        setTimeout(() => {
            card.classList.remove('ring-2', 'ring-emerald-400');
        }, 1200);
    } catch (_) {}
}

let currentDayOffTargetRiderKey = null;
let currentDayOffTargetRiderName = null;

export function promptSetRiderDayOff(riderId, riderName, event) {
    if (event) event.stopPropagation();

    const loggedIn = getLoggedInRiderInfo();
    const myId = loggedIn?.myId || (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const myName = loggedIn?.myName || (appState.riderName || localStorage.getItem('riderName') || '').trim();
    const isMe = isRiderMatch(riderName, myName, riderId, myId);

    if (!isAdmin() && !hasTlPermission('canManageDayOff')) {
        if (isMe) {
            if (typeof openRiderDayOffModal === 'function') {
                openRiderDayOffModal();
                return;
            } else if (typeof window.openRiderDayOffModal === 'function') {
                window.openRiderDayOffModal();
                return;
            }
        }
        showToast("⚠️ Only Admins can set day-off for other riders.");
        return;
    }

    currentDayOffTargetRiderKey = getRiderStorageKey(riderId, riderName);
    currentDayOffTargetRiderName = riderName;

    const modal = document.getElementById('modern-quick-dayoff-modal');
    const labelEl = document.getElementById('modern-dayoff-rider-label');
    if (labelEl) {
        labelEl.innerText = `${formatTitleCase(riderName)} (${riderId || currentDayOffTargetRiderKey})`;
    }

    // Highlight currently selected day if any
    const info = getRiderDayOffDetails(riderId, riderName);
    const dayButtons = document.querySelectorAll('.modern-dayoff-opt-btn');
    dayButtons.forEach((btn, idx) => {
        if (info.hasDayOff && info.dayOfWeek === idx) {
            btn.className = "modern-dayoff-opt-btn p-2 rounded-xl bg-teal-500/25 border-2 border-teal-400 text-xs font-black text-teal-300 transition text-center cursor-pointer shadow-xs";
        } else {
            btn.className = "modern-dayoff-opt-btn p-2 rounded-xl bg-[#0b1114] hover:bg-teal-500/15 border border-slate-700 hover:border-teal-500/50 text-xs font-bold text-slate-200 hover:text-teal-300 transition text-center cursor-pointer";
        }
    });

    if (modal) modal.classList.remove('hidden');
}

export function closeModernQuickDayOffModal() {
    const modal = document.getElementById('modern-quick-dayoff-modal');
    if (modal) modal.classList.add('hidden');
    currentDayOffTargetRiderKey = null;
    currentDayOffTargetRiderName = null;
}

export async function selectQuickDayOff(dayIndex) {
    if (!currentDayOffTargetRiderKey && !currentDayOffTargetRiderName) return;
    const rKey = currentDayOffTargetRiderKey;
    const rName = currentDayOffTargetRiderName;

    closeModernQuickDayOffModal();

    if (typeof adminReassignRiderDayOff === 'function') {
        await adminReassignRiderDayOff(rKey, rName, dayIndex);
    } else if (typeof window.adminReassignRiderDayOff === 'function') {
        await window.adminReassignRiderDayOff(rKey, rName, dayIndex);
    }

    renderModernLoginsTab();
}

// ============================================================================
// 11. TAB 4: CATERED CUSTOMER LIST (TIMESTAMPS, TOTAL TIME, ADMIN VOID)
// ============================================================================

export function renderModernCateredTab() {
    const listContainer = document.getElementById('modern-catered-list');
    if (!listContainer) return;

    const todayStr = getLocalTodayStr();
    const receipts = (globalState.globalDailyReceipts || []).filter(rc => {
        const d = rc.date || rc.completedDate;
        return d && (isSameDateStr(d, todayStr) || normalizeToDateStr(d) === normalizeToDateStr(todayStr));
    });

    const isUserAdmin = isAdmin();

    if (receipts.length === 0) {
        listContainer.innerHTML = `<div class="text-slate-500 italic text-center py-8 text-xs">No completed catered customers yet today.</div>`;
        return;
    }

    listContainer.innerHTML = receipts.map(rc => {
        const custName = formatTitleCase(rc.customerName || "Customer");
        const riderName = formatTitleCase(rc.riderName || "Rider");
        const sTime = rc.startTime || rc.cateringStartTime || rc.time || "--:--";
        const rTime = rc.receiptTime || rc.time || "--:--";
        const dTime = rc.doneTime || rc.completedTime || rc.receiptTime || "--:--";
        const txId = rc.transactionId || rc.id || "";
        const cDate = rc.date || rc.completedDate || todayStr;

        // Calculate total time
        let totalTimeText = rc.duration || "";
        if (!totalTimeText || totalTimeText === "Just now") {
            totalTimeText = calculateSplitDuration(sTime, dTime, 1);
        }

        return `
        <div class="flex flex-col p-3 rounded-2xl bg-white dark:bg-[#121a1f] border border-slate-200 dark:border-slate-800 gap-2 shadow-xs transition hover:border-slate-300 dark:hover:border-slate-700">
            <!-- Top Row: Customer Name & Rider Name & Void Button -->
            <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-1.5 min-w-0 flex-1">
                    <span class="text-[11px] text-slate-600 dark:text-slate-400 font-bold shrink-0">Customer:</span>
                    <span class="text-xs font-black text-slate-900 dark:text-amber-300 truncate" title="${escapeHtml(custName)}">${escapeHtml(custName)}</span>
                </div>

                <div class="flex items-center gap-1.5 shrink-0 ml-auto">
                    <div class="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-400 font-black text-xs shrink-0 whitespace-nowrap shadow-2xs" title="Delivering Rider">
                        <i class="fa-solid fa-motorcycle text-[10px]"></i>
                        <span>${escapeHtml(riderName)}</span>
                    </div>

                    ${isUserAdmin ? `
                        <button type="button" onclick="window.promptAdminDeleteCommissionRecord && window.promptAdminDeleteCommissionRecord('${escapeHtml(rc.riderName || '')}', '${escapeHtml(rc.customerName || '')}', '${escapeHtml(cDate)}', '${escapeHtml(txId)}')" class="px-2 py-0.5 rounded-lg border border-red-500/50 hover:bg-red-500/20 text-rose-600 dark:text-rose-400 font-black text-[10px] transition active:scale-95 cursor-pointer shrink-0" title="Void Customer Record">
                            <i class="fa-solid fa-ban text-[9px]"></i> Void
                        </button>
                    ` : ''}
                </div>
            </div>

            <!-- Bottom Row: Timeline & Total Time Duration -->
            <div class="flex items-center justify-between gap-2 flex-wrap pt-1.5 border-t border-slate-200 dark:border-slate-800/80 text-[10px] font-mono">
                <div class="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 flex-wrap">
                    <span class="inline-flex items-center gap-1 text-slate-800 dark:text-slate-300 font-bold"><i class="fa-solid fa-play text-blue-600 dark:text-blue-400 text-[8px]"></i> Start: ${escapeHtml(sTime)}</span>
                    <span class="text-slate-400 dark:text-slate-600 select-none">•</span>
                    <span class="inline-flex items-center gap-1 text-slate-800 dark:text-slate-300 font-bold"><i class="fa-solid fa-receipt text-amber-600 dark:text-amber-400 text-[8px]"></i> Receipt: ${escapeHtml(rTime)}</span>
                    <span class="text-slate-400 dark:text-slate-600 select-none">•</span>
                    <span class="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-black"><i class="fa-solid fa-circle-check text-emerald-600 dark:text-emerald-400 text-[8px]"></i> Done: ${escapeHtml(dTime)}</span>
                </div>

                <div class="shrink-0 ml-auto">
                    <span class="text-xs font-mono font-black text-emerald-800 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/30 px-2 py-0.5 rounded-lg whitespace-nowrap">⏱️ ${escapeHtml(totalTimeText || 'N/A')}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ============================================================================
// 12. BOTTOM PERSISTENT RIDER STATUS DOCK
// ============================================================================

export function syncModernFooterDock() {
    const grossEl = document.getElementById('modern-footer-gross');
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const myName = appState.riderName || localStorage.getItem('riderName') || '';

    if (grossEl) {
        const gross = getRiderTodayGross(myName, myId);
        grossEl.innerText = `₱${gross.toFixed(0)}`;
    }

    const roster = globalState.rosterMembers || [];
    const myRecord = roster.find(m => isRiderMatch(myName, m.riderName || m.name || '', myId, (m.telegramId || m.id || '').toString()));
    const status = myRecord?.status || (myRecord ? 'End' : (localStorage.getItem('lokalex_active_role') === 'rider' ? '' : 'End'));

    const btnAvail = document.getElementById('modern-btn-status-avail');
    const btnCater = document.getElementById('modern-btn-status-cater');
    const btnBreak = document.getElementById('modern-btn-status-break');
    const btnEnd = document.getElementById('modern-btn-status-end');

    [btnAvail, btnCater, btnBreak, btnEnd].forEach(b => {
        if (b) b.classList.remove('ring-2', 'ring-emerald-400', 'ring-amber-400', 'ring-sky-400', 'ring-rose-400', 'bg-white/10');
    });

    if (btnAvail) {
        const queueSettings = typeof getQueueLineupSettings === 'function' ? getQueueLineupSettings() : { cooldownMinutes: 10 };
        const cooldownMins = parseInt(queueSettings?.cooldownMinutes, 10) || 10;
        const cooldownMs = cooldownMins * 60 * 1000;
        const myAvailableTs = myRecord?.availableTimestamp || (myRecord?.queueTime ? parseQueueTime(myRecord.queueTime) : 0) || 0;
        const myCooldownUntil = myRecord?.cooldownUntil || (myAvailableTs > 0 && cooldownMs > 0 ? (myAvailableTs + cooldownMs) : 0);
        const now = Date.now();

        if (status === 'Available' && myCooldownUntil > now) {
            const remSecs = Math.max(0, Math.ceil((myCooldownUntil - now) / 1000));
            const mins = Math.floor(remSecs / 60);
            const secs = remSecs % 60;
            const timeTag = `${mins}:${String(secs).padStart(2, '0')}`;
            btnAvail.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> <span class="queue-cooldown-timer flex items-center gap-1 font-black text-[11px]" data-cooldown-until="${myCooldownUntil}">Available <span class="text-amber-400 font-mono text-[10px]">⏳<span class="timer-digits">${timeTag}</span></span></span>`;
        } else {
            btnAvail.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span> <span>Available</span>`;
        }
    }

    if (status === 'Available' && btnAvail) btnAvail.classList.add('ring-2', 'ring-emerald-400', 'bg-white/10');
    else if (status === 'Catering' && btnCater) btnCater.classList.add('ring-2', 'ring-amber-400', 'bg-white/10');
    else if (status === 'Break' && btnBreak) btnBreak.classList.add('ring-2', 'ring-sky-400', 'bg-white/10');
    else if (status === 'End' && btnEnd) btnEnd.classList.add('ring-2', 'ring-rose-400', 'bg-white/10');
}

// ============================================================================
// 13. MODERN UI THEME TOGGLE (LIGHT / DARK MODE)
// ============================================================================

export function getModernTheme() {
    if (typeof localStorage === 'undefined') return 'dark';
    const saved = localStorage.getItem('lokalex_modern_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark'; // Dark mode is default, riders can toggle anytime
}

export function applyModernTheme(theme = null, notify = false) {
    const targetTheme = theme || getModernTheme();
    const workspace = document.getElementById('modern-ui-workspace');
    const icon = document.getElementById('modern-theme-icon');
    const btn = document.getElementById('modern-theme-toggle-btn');
    if (!workspace) return;

    const root = document.documentElement;

    if (targetTheme === 'light') {
        workspace.classList.add('modern-theme-light');
        if (root) {
            root.classList.remove('dark');
            root.classList.add('light');
            root.style.backgroundColor = '#EDF7F2';
            root.style.colorScheme = 'light';
        }
        if (document.body) {
            document.body.style.backgroundColor = '#EDF7F2';
            document.body.style.color = '#0F172A';
        }
        if (icon) {
            icon.className = 'fa-solid fa-moon text-slate-700';
        }
        if (btn) {
            btn.title = "Switch to Dark Mode";
        }
    } else {
        workspace.classList.remove('modern-theme-light');
        if (root) {
            root.classList.add('dark');
            root.classList.remove('light');
            root.style.backgroundColor = '#0b1114';
            root.style.colorScheme = 'dark';
        }
        if (document.body) {
            document.body.style.backgroundColor = '#0b1114';
            document.body.style.color = '#F8FAFC';
        }
        if (icon) {
            icon.className = 'fa-solid fa-sun text-amber-400';
        }
        if (btn) {
            btn.title = "Switch to Light Mode";
        }
    }
    localStorage.setItem('lokalex_modern_theme', targetTheme);
    if (notify) {
        showToast(targetTheme === 'light' ? "☀️ Modern UI: Light Mode activated" : "🌙 Modern UI: Dark Mode activated");
    }
}

export function toggleModernTheme() {
    const current = getModernTheme();
    const next = current === 'light' ? 'dark' : 'light';
    applyModernTheme(next, true);
}

export function initModernTheme() {
    applyModernTheme(getModernTheme(), false);
}

// ============================================================================
// 14. GLOBAL INITIALIZER & WINDOW BINDINGS
// ============================================================================

export function initModernUiController() {
    // One-time automatic migration: transition existing devices to New UI as the main UI
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('lokalex_main_ui_v2') !== 'true') {
            localStorage.setItem('lokalex_ui_mode', 'modern');
            localStorage.setItem('lokalex_main_ui_v2', 'true');
        }
    } catch (_) {}

    // Check initial mode from localStorage
    initModernTheme();
    const activeMode = isModernUiActive() ? 'modern' : 'classic';
    if (activeMode === 'modern') {
        applyLokalexUiMode('modern', false);
    }

    // Outside click listener for floating menus
    document.addEventListener('pointerdown', (e) => {
        const popover = document.getElementById('modern-hamburger-popover');
        const burgerBtn = document.getElementById('modern-hamburger-btn');
        const chatMenu = document.getElementById('modern-chat-menu-dropdown');
        const chatMenuBtn = document.getElementById('modern-chat-menu-btn');
        const compMenu = document.getElementById('modern-composer-menu-popup');
        const compMenuBtn = document.getElementById('modern-composer-menu-btn');

        if (popover && !popover.classList.contains('hidden') && !popover.contains(e.target) && !burgerBtn?.contains(e.target)) {
            popover.classList.add('hidden');
        }
        if (chatMenu && !chatMenu.classList.contains('hidden') && !chatMenu.contains(e.target) && !chatMenuBtn?.contains(e.target)) {
            chatMenu.classList.add('hidden');
        }
        if (compMenu && !compMenu.classList.contains('hidden') && !compMenu.contains(e.target) && !compMenuBtn?.contains(e.target)) {
            compMenu.classList.add('hidden');
        }
    }, { passive: true });

    // Real-time Event Subscriptions
    window.addEventListener('rosterUpdated', () => {
        if (isModernUiActive()) refreshAllModernViews();
    });
    window.addEventListener('receiptsUpdated', () => {
        if (isModernUiActive()) refreshAllModernViews();
    });
    window.addEventListener('cateredUpdated', () => {
        if (isModernUiActive()) refreshAllModernViews();
    });
    window.addEventListener('loginsUpdated', () => {
        if (isModernUiActive()) refreshAllModernViews();
    });
    window.addEventListener('customerChatsUpdated', () => {
        if (isModernUiActive()) {
            refreshModernChatsView();
        }
    });
    window.addEventListener('viewChanged', (e) => {
        if (e.detail === 'view-home') {
            if (isModernUiActive()) {
                applyLokalexUiMode('modern', false);
            }
        } else {
            // Secondary view navigated to (view-cart, view-commission, etc.)
            const modernWorkspace = document.getElementById('modern-ui-workspace');
            if (modernWorkspace) modernWorkspace.classList.add('hidden');
        }
    });
}

export function getModernChatCategory() {
    return modernChatCategory;
}

export function refreshModernChatsView() {
    updateModernTabBadges();
    if (modernActiveTab === 'chats') {
        const activeCustId = getActiveRiderChatCustId();
        const filtered = getModernFilteredThreads();
        const cleanActive = String(activeCustId || '').replace(/^(?:fb_|messenger_)+/i, '').trim().toLowerCase();
        const stillExists = cleanActive && filtered.some(t => {
            const cleanT = String(t.custId || t.id || '').replace(/^(?:fb_|messenger_)+/i, '').trim().toLowerCase();
            return cleanT && cleanT === cleanActive;
        });

        if (!stillExists) {
            if (!activeCustId && filtered.length > 0) {
                const first = filtered[0];
                const cid = first.custId || first.id;
                const name = formatTitleCase(first.customerName || first.name || "Customer");
                const avatar = first.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0084FF&color=fff`;
                selectModernCustomerChat(cid, name, avatar);
            } else if (!activeCustId) {
                clearModernChatRightRoom();
                renderModernChatLeftList();
            } else {
                renderModernChatLeftList();
            }
        } else {
            renderModernChatLeftList();
            if (!isCateringChatRoomLocked(activeCustId)) {
                syncModernRightChatRoom();
            }
        }
    }
}

// Window Attachments
if (typeof window !== 'undefined') {
    window.isModernUiActive = isModernUiActive;
    window.toggleLokalexUiMode = toggleLokalexUiMode;
    window.applyLokalexUiMode = applyLokalexUiMode;
    window.toggleModernHamburgerMenu = toggleModernHamburgerMenu;
    window.closeModernHamburgerMenu = closeModernHamburgerMenu;
    window.backToModernMenuMain = backToModernMenuMain;
    window.openModernMenuCategory = openModernMenuCategory;
    window.switchModernWorkspaceTab = switchModernWorkspaceTab;
    window.selectModernChatCategory = selectModernChatCategory;
    window.handleModernChatSearch = handleModernChatSearch;
    window.selectModernCustomerChat = selectModernCustomerChat;
    window.toggleModernCardSwipe = toggleModernCardSwipe;
    window.toggleModernChatMenuDropdown = toggleModernChatMenuDropdown;
    window.toggleModernComposerMenu = toggleModernComposerMenu;
    window.closeModernPopovers = closeModernPopovers;
    window.openModernRiderProfile = openModernRiderProfile;
    window.promptSetRiderDayOff = promptSetRiderDayOff;
    window.closeModernQuickDayOffModal = closeModernQuickDayOffModal;
    window.selectQuickDayOff = selectQuickDayOff;
    window.clearModernChatRightRoom = clearModernChatRightRoom;
    window.getModernFilteredThreads = getModernFilteredThreads;
    window.getModernChatCategory = getModernChatCategory;
    window.refreshModernChatsView = refreshModernChatsView;
    window.refreshAllModernViews = refreshAllModernViews;
    window.renderModernRotationsTab = renderModernRotationsTab;
    window.renderModernRotationsToolbar = renderModernRotationsToolbar;
    window.handleModernRefreshRotations = handleModernRefreshRotations;
    window.openAdminForceCaterFromChat = openAdminForceCaterFromChat;
    window.setModernSyncState = setModernSyncState;
    window.toggleModernTheme = toggleModernTheme;
    window.applyModernTheme = applyModernTheme;
    window.getModernTheme = getModernTheme;
    window.isCateringChatRoomLocked = isCateringChatRoomLocked;
    window.renderModernLockedCateringRoom = renderModernLockedCateringRoom;
    window.unlockCateringChatRoom = unlockCateringChatRoom;
}

