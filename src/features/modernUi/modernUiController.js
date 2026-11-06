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
import { escapeHtml, formatTitleCase, getLocalTodayStr } from '../../utils/helpers.js';
import { showToast } from '../../ui/notifications.js';
import { 
    isAdmin, 
    canManageRoster, 
    hasTlPermission, 
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
    parseTimeToMinutes
} from '../roster/rosterUtils.js';
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
    isMyCustomerThread 
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

// ============================================================================
// 1. DUAL UI MODE CONTROLLER (CLASSIC <-> MODERN)
// ============================================================================

export function isModernUiActive() {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('lokalex_ui_mode') === 'modern';
}

export function toggleLokalexUiMode(targetMode = null) {
    const current = localStorage.getItem('lokalex_ui_mode') || 'classic';
    let newMode = targetMode;
    if (!newMode) {
        newMode = current === 'modern' ? 'classic' : 'modern';
    }

    localStorage.setItem('lokalex_ui_mode', newMode);
    applyLokalexUiMode(newMode, true);
}

export function applyLokalexUiMode(mode = null, notify = false) {
    const activeMode = mode || localStorage.getItem('lokalex_ui_mode') || 'classic';
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
        initFloatingCartDrag();
        refreshAllModernViews();
        if (typeof window.syncChannelBarLockUI === 'function') window.syncChannelBarLockUI();
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
            { icon: "fa-text-height text-sky-400", label: "View / Font size", desc: "Adjust app display scale & font size", action: () => { closeModernHamburgerMenu(); window.openProfileSettingsModal && window.openProfileSettingsModal(); } },
            { icon: "fa-user-pen text-emerald-400", label: "Profile", desc: "Edit personal details & avatar", action: () => { closeModernHamburgerMenu(); window.handleHeaderUserClick && window.handleHeaderUserClick(); } },
            { icon: "fa-key text-amber-400", label: "Security", desc: "Change PIN code & password", action: () => { closeModernHamburgerMenu(); window.openRiderPasswordModal && window.openRiderPasswordModal(); } },
            { icon: "fa-wallet text-blue-400", label: "GCash", desc: "Configure GCash account number & QR", action: () => { closeModernHamburgerMenu(); window.openGCashModal && window.openGCashModal(); } }
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
        title = "Admin Settings (A–Z)";
        items = [
            { icon: "fa-toggle-on text-amber-400", label: "Admin Mode Toggle", desc: "Toggle supervisory action buttons", action: () => { closeModernHamburgerMenu(); window.toggleAdminControls && window.toggleAdminControls(!globalState.adminControlsEnabled); } },
            { icon: "fa-clock-rotate-left text-purple-400", label: "Auto End", desc: "Automatic shift termination cutoff", action: () => { closeModernHamburgerMenu(); window.openAdminAutoEndShiftModal && window.openAdminAutoEndShiftModal(); } },
            { icon: "fa-robot text-purple-400", label: "Auto-Msg", desc: "Automated catering & done responses", action: () => { closeModernHamburgerMenu(); window.openAutoMessageSettingsModal && window.openAutoMessageSettingsModal(); } },
            { icon: "fa-user-slash text-rose-400", label: "Ban List", desc: "Blocked users and blacklisted accounts", action: () => { closeModernHamburgerMenu(); window.openAdminBlockModal && window.openAdminBlockModal(); } },
            { icon: "fa-mug-hot text-amber-400", label: "Breaks", desc: "Break allowances and durations", action: () => { closeModernHamburgerMenu(); window.openAdminBreakSettingsModal && window.openAdminBreakSettingsModal(); } },
            { icon: "fa-bell text-yellow-400", label: "Chimes", desc: "Audio alerts & notification tones", action: () => { closeModernHamburgerMenu(); window.openChatSoundSettingsModal && window.openChatSoundSettingsModal(); } },
            { icon: "fa-broom text-sky-400", label: "Clear Inbox", desc: "Move active inbox threads to done", action: () => { closeModernHamburgerMenu(); window.clearAllInboxThreads && window.clearAllInboxThreads(); } },
            { icon: "fa-percent text-amber-400", label: "Commission (% Commission)", desc: "Daily commission fees and tier rates", action: () => { closeModernHamburgerMenu(); window.openAdminCommissionSettingsModal && window.openAdminCommissionSettingsModal(); } },
            { icon: "fa-coins text-amber-400", label: "Credits", desc: "Directory search credit balances", action: () => { closeModernHamburgerMenu(); window.openAdminDirectoryCreditsModal && window.openAdminDirectoryCreditsModal(); } },
            { icon: "fa-umbrella-beach text-teal-400", label: "Day Off", desc: "Weekly scheduled day-off view", action: () => { closeModernHamburgerMenu(); window.openRiderDayOffModal && window.openRiderDayOffModal(); } },
            { icon: "fa-sliders text-teal-400", label: "Day-Off Rules", desc: "Quotas and day-off change limits", action: () => { closeModernHamburgerMenu(); window.openAdminDayOffSettingsModal && window.openAdminDayOffSettingsModal(); } },
            { icon: "fa-user-clock text-rose-400", label: "Early Out", desc: "Shift duration & early exit penalty rules", action: () => { closeModernHamburgerMenu(); window.openAdminEarlyShiftModal && window.openAdminEarlyShiftModal(); } },
            { icon: "fa-brands fa-facebook-messenger text-blue-400", label: "FB APIs", desc: "Facebook Messenger webhook tokens", action: () => { closeModernHamburgerMenu(); window.openAdminFbApiModal && window.openAdminFbApiModal(); } },
            { icon: "fa-map-location-dot text-indigo-400", label: "Find", desc: "Geospatial rider locations map", action: () => { closeModernHamburgerMenu(); if (window.openFindRidersModal) window.openFindRidersModal(); else if (window.openFindRidersMap) window.openFindRidersMap(); } },
            { icon: "fa-power-off text-rose-500", label: "Force All End", desc: "Terminate shifts for all riders", action: () => { closeModernHamburgerMenu(); window.forceAllEndShift && window.forceAllEndShift(); } },
            { icon: "fa-ban text-rose-400", label: "Full Booking", desc: "Full booking auto-responder toggle", action: () => { closeModernHamburgerMenu(); window.openFullBookingModal && window.openFullBookingModal(); } },
            { icon: "fa-arrow-down-short-wide text-purple-400", label: "Lineup Rules", desc: "Queue rotation mode & cooldown buffer", action: () => { closeModernHamburgerMenu(); window.openAdminQueueSettingsModal && window.openAdminQueueSettingsModal(); } },
            { icon: "fa-users-gear text-blue-400", label: "Manage (Riders)", desc: "Accounts, roles, and privileges", action: () => { closeModernHamburgerMenu(); window.openAdminManageRidersModal && window.openAdminManageRidersModal(); } },
            { icon: "fa-layer-group text-rose-400", label: "Max Orders", desc: "Active catering order capacity caps", action: () => { closeModernHamburgerMenu(); window.openAdminBookingLimitsModal && window.openAdminBookingLimitsModal(); } },
            { icon: "fa-trophy text-amber-400", label: "Performance", desc: "Weekly & monthly rider performance reports", action: () => { closeModernHamburgerMenu(); window.openAdminPerformanceTrackerModal && window.openAdminPerformanceTrackerModal(); } },
            { icon: "fa-clock text-purple-400", label: "Schedule", desc: "Rider time-in schedules & early passes", action: () => { closeModernHamburgerMenu(); window.openAdminTimeInScheduleModal && window.openAdminTimeInScheduleModal(); } },
            { icon: "fa-bullhorn text-sky-400", label: "Send to Many", desc: "Mass broadcast customer announcement", action: () => { closeModernHamburgerMenu(); window.openBroadcastModal && window.openBroadcastModal(); } },
            { icon: "fa-shop text-orange-400", label: "Store Hub", desc: "Store accounts & menu administration", action: () => { closeModernHamburgerMenu(); window.openAdminStoreAccountModal && window.openAdminStoreAccountModal(); } }
        ];
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

    tabs.forEach(t => {
        const tabBtn = document.getElementById(`modern-main-tab-${t}`);
        const panel = document.getElementById(`modern-panel-${t}`);

        if (t === tabId) {
            if (tabBtn) {
                tabBtn.classList.remove('border-b-transparent', 'text-slate-400');
                tabBtn.classList.add('border-b-emerald-400', 'bg-emerald-500/10', 'text-emerald-400');
            }
            if (panel) panel.classList.remove('hidden');
        } else {
            if (tabBtn) {
                tabBtn.classList.remove('border-b-emerald-400', 'bg-emerald-500/10', 'text-emerald-400');
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
        const stillExists = activeCustId && filtered.some(t => (t.custId || t.id) === activeCustId);

        if (stillExists) {
            renderModernChatLeftList();
            syncModernRightChatRoom();
        } else {
            if (filtered.length > 0) {
                const first = filtered[0];
                const cid = first.custId || first.id;
                const name = formatTitleCase(first.customerName || first.name || "Customer");
                const avatar = first.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0084FF&color=fff`;
                selectModernCustomerChat(cid, name, avatar);
            } else {
                clearModernChatRightRoom();
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
        const isDone = t.status === 'completed' || t.status === 'done' || t.status === 'cancelled';
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
    const myName = (appState.riderName || localStorage.getItem('riderName') || '').toString().trim().toLowerCase();
    const myRecord = roster.find(m => {
        const mId = (m.telegramId || m.id || '').toString().trim();
        const mName = (m.riderName || m.name || '').toString().trim().toLowerCase();
        return (myId && mId === myId) || (myName && mName === myName);
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
                const mName = (m.riderName || m.name || '').toString().trim().toLowerCase();
                return (myId && mId === myId) || (myName && mName === myName);
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

    const totalRosterRiders = roster.length > 0 ? roster : (todayLogins.length > 0 ? todayLogins : [{ name: 'Rider' }]);
    const notLoggedInCount = Math.max(0, totalRosterRiders.length - activeRidersSet.size);

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

        const folder = (t.folder || 'inbox').toLowerCase();
        const isDone = t.status === 'completed' || t.status === 'done' || t.status === 'cancelled';
        const isCatered = folder === 'catering' || Boolean(t.cateredByRiderName || t.cateredByRiderId || t.cateredBy);

        if (cat === 'done') {
            return folder === 'done' || isDone;
        }
        if (isDone) return false;

        if (cat === 'inbox') {
            return !isCatered && folder !== 'applicant' && folder !== 'followup' && folder !== 'stores';
        } else if (cat === 'catering') {
            return isCatered;
        } else if (cat === 'applicant') {
            return folder === 'applicant' || t.isApplicant === true;
        } else if (cat === 'followup') {
            return folder === 'followup';
        } else if (cat === 'stores') {
            return folder === 'stores';
        }
        return true;
    });

    // Sort by latest message timestamp descending
    filtered.sort((a, b) => (Number(b.lastUpdated || b.timestamp) || 0) - (Number(a.lastUpdated || a.timestamp) || 0));
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

    if (filtered.length === 0) {
        listContainer.innerHTML = `<div class="text-slate-500 italic text-center py-8 px-2 text-[11px]">No threads in ${escapeHtml(modernChatCategory)}</div>`;
        return;
    }

    listContainer.innerHTML = filtered.map(t => {
        const isSelected = activeCustId && (t.custId === activeCustId || t.id === activeCustId);
        const name = formatTitleCase(t.customerName || t.name || "Customer");
        const msg = (t.lastMessage || 'No messages yet').replace(/\[Facebook.*?\]/g, '📷 Photo');
        const cid = t.custId || t.id;
        const avatar = t.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0084FF&color=fff`;

        const hasNewMessage = Boolean(t.isUnread || t.unreadForRider === true || (t.unreadForRider !== false && t.lastMessage && !t.lastMessage.startsWith('You:')));

        // Color badge determination
        let badgeColorClass = "bg-emerald-500 text-black";
        if (t.folder === 'catering' || (t.cateredByRiderName || t.cateredByRiderId)) {
            badgeColorClass = "bg-amber-400 text-black";
        } else if (t.folder === 'stores') {
            badgeColorClass = "bg-blue-500 text-white";
        } else if (t.isApplicant || t.folder === 'applicant') {
            badgeColorClass = "bg-purple-500 text-white";
        } else if (t.folder === 'followup') {
            badgeColorClass = "bg-rose-500 text-white";
        }

        const countBadgeHtml = hasNewMessage 
            ? `<span class="w-4 h-4 rounded-full ${badgeColorClass} font-mono font-black text-[9px] inline-flex items-center justify-center shrink-0">1</span>`
            : '';

        return `
        <div id="modern-card-${cid}" class="group relative flex flex-col p-2 transition cursor-pointer select-none ${isSelected ? 'bg-emerald-500/15 border-l-4 border-emerald-400' : 'hover:bg-white/5'}" onclick="window.selectModernCustomerChat('${escapeHtml(cid)}', '${escapeHtml(name)}', '${escapeHtml(avatar)}')">
            <div class="flex items-center justify-between gap-1.5 mb-1">
                <div class="flex items-center gap-1.5 min-w-0 flex-1">
                    ${countBadgeHtml}
                    <span class="font-extrabold text-xs text-white truncate">${escapeHtml(name)}</span>
                </div>
                <!-- Secret Swipe Menu Toggle Button -->
                <button type="button" onclick="event.stopPropagation(); window.toggleModernCardSwipe('${escapeHtml(cid)}')" class="px-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[9px] font-mono shrink-0 cursor-pointer" title="Reveal Cater / Unread / Done actions">
                    ⇄
                </button>
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

export function selectModernCustomerChat(custId, custName, avatarUrl) {
    if (!custId) return;
    openRiderCustomerChatModal(custId, custName, avatarUrl);
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

        // 5. Hide floating cart button
        const cartBtn = document.getElementById('modern-floating-cart-btn');
        if (cartBtn) cartBtn.classList.add('hidden');

        // 6. Reset composer input
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

    const cartBtn = document.getElementById('modern-floating-cart-btn');
    if (cartBtn) cartBtn.classList.remove('hidden');

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
    if (isHidden) dropdown.classList.remove('hidden');
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
    const cartBtn = document.getElementById('modern-floating-cart-btn');
    const container = document.getElementById('modern-chat-right-room');
    if (!cartBtn || !container || cartBtn._isDragInitialized) return;
    cartBtn._isDragInitialized = true;

    const onStart = (clientX, clientY) => {
        isFloatingCartDragging = true;
        floatingCartHasMoved = false;
        floatingCartStartX = clientX;
        floatingCartStartY = clientY;
        const rect = cartBtn.getBoundingClientRect();
        const cRect = container.getBoundingClientRect();
        floatingCartElemInitialLeft = rect.left - cRect.left;
        floatingCartElemInitialTop = rect.top - cRect.top;
    };

    const onMove = (clientX, clientY) => {
        if (!isFloatingCartDragging) return;
        const dx = clientX - floatingCartStartX;
        const dy = clientY - floatingCartStartY;

        if (Math.hypot(dx, dy) > 6) {
            floatingCartHasMoved = true;
        }

        const cRect = container.getBoundingClientRect();
        const btnW = cartBtn.offsetWidth;
        const btnH = cartBtn.offsetHeight;

        let nextLeft = floatingCartElemInitialLeft + dx;
        let nextTop = floatingCartElemInitialTop + dy;

        // Strict clamp inside container bounds
        nextLeft = Math.max(8, Math.min(nextLeft, cRect.width - btnW - 8));
        nextTop = Math.max(48, Math.min(nextTop, cRect.height - btnH - 60));

        cartBtn.style.left = `${nextLeft}px`;
        cartBtn.style.top = `${nextTop}px`;
        cartBtn.style.right = 'auto';
        cartBtn.style.bottom = 'auto';
    };

    const onEnd = () => {
        if (!isFloatingCartDragging) return;
        isFloatingCartDragging = false;
        if (!floatingCartHasMoved) {
            // It's a clean tap/click -> open customer's cart
            if (window.goToCustomerCartFromChat) {
                window.goToCustomerCartFromChat();
            } else if (window.switchView) {
                window.switchView('view-cart');
            }
        }
    };

    // Mouse listeners
    cartBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onStart(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onEnd);

    // Touch listeners
    cartBtn.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            onStart(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
        if (isFloatingCartDragging && e.touches.length === 1) {
            onMove(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });
    window.addEventListener('touchend', onEnd);
}

// ============================================================================
// 9. TAB 2: LOKALEX RIDER ROTATIONS (AVAILABLE, CATERING, BREAK)
// ============================================================================

export function renderModernRotationsTab() {
    const availList = document.getElementById('modern-rot-avail-list');
    const caterList = document.getElementById('modern-rot-cater-list');
    const breakList = document.getElementById('modern-rot-break-list');
    const availCountEl = document.getElementById('modern-rot-avail-count');
    const caterCountEl = document.getElementById('modern-rot-cater-count');
    const breakCountEl = document.getElementById('modern-rot-break-count');
    if (!availList || !caterList || !breakList) return;

    const roster = globalState.rosterMembers || [];
    const availables = sortAvailableRiders(roster.filter(m => m.status === 'Available'));
    const caterings = roster.filter(m => m.status === 'Catering');
    const breaks = roster.filter(m => m.status === 'Break');

    if (availCountEl) availCountEl.innerText = `${availables.length} riders`;
    if (caterCountEl) caterCountEl.innerText = `${caterings.length} active`;
    if (breakCountEl) breakCountEl.innerText = `${breaks.length} on break`;

    // 1. Available Column
    if (availables.length === 0) {
        availList.innerHTML = `<div class="text-slate-500 italic text-center py-6 text-xs">No available riders</div>`;
    } else {
        availList.innerHTML = availables.map((m, idx) => {
            const rawName = m.riderName || m.name || "Rider";
            const mId = (m.telegramId || m.id || "").toString();
            const gross = getRiderTodayGross(rawName, mId);
            return `
            <div class="flex items-center justify-between p-2 rounded-xl bg-black/40 border border-slate-800 hover:border-emerald-500/50 transition">
                <div class="flex items-center gap-1.5 min-w-0">
                    <span class="font-black text-emerald-400 font-mono text-xs">#${idx + 1}</span>
                    <button type="button" onclick="window.openModernRiderProfile('${escapeHtml(mId)}', '${escapeHtml(rawName)}')" class="font-bold text-xs text-white hover:text-emerald-400 truncate text-left cursor-pointer">${escapeHtml(formatTitleCase(rawName))}</button>
                </div>
                <span class="text-[10px] font-mono font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded shrink-0">₱${gross.toFixed(0)}</span>
            </div>`;
        }).join('');
    }

    // 2. Catering Column
    if (caterings.length === 0) {
        caterList.innerHTML = `<div class="text-slate-500 italic text-center py-6 text-xs">No active deliveries</div>`;
    } else {
        caterList.innerHTML = caterings.map(m => {
            const rawName = m.riderName || m.name || "Rider";
            const mId = (m.telegramId || m.id || "").toString();
            const gross = getRiderTodayGross(rawName, mId);
            const custs = m.customerName ? m.customerName.split(', ').map(c => c.trim()).filter(Boolean) : [];

            return `
            <div class="flex flex-col p-2.5 rounded-xl bg-black/40 border border-slate-800 gap-1.5">
                <div class="flex items-center justify-between">
                    <button type="button" onclick="window.openModernRiderProfile('${escapeHtml(mId)}', '${escapeHtml(rawName)}')" class="font-black text-xs text-amber-300 hover:underline truncate text-left cursor-pointer">${escapeHtml(formatTitleCase(rawName))}</button>
                    <span class="text-[10px] font-mono font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded shrink-0">₱${gross.toFixed(0)}</span>
                </div>
                <div class="flex flex-col gap-1 pl-1">
                    ${custs.length > 0 ? custs.map(c => `
                        <button type="button" onclick="window.selectModernCustomerChat('${escapeHtml(c)}', '${escapeHtml(c)}'); window.switchModernWorkspaceTab('chats');" class="text-left text-[11px] font-bold text-slate-200 hover:text-amber-400 flex items-center gap-1.5 truncate cursor-pointer bg-[#182229] px-2 py-1 rounded-lg border border-slate-700/60">
                            <span>👤</span>
                            <span class="truncate">${escapeHtml(c)}</span>
                        </button>
                    `).join('') : '<span class="text-[10px] text-slate-500 italic">No customer name assigned</span>'}
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
            return `
            <div class="flex items-center justify-between p-2 rounded-xl bg-black/40 border border-slate-800">
                <div class="flex items-center gap-1.5 min-w-0">
                    <button type="button" onclick="window.openModernRiderProfile('${escapeHtml(mId)}', '${escapeHtml(rawName)}')" class="font-bold text-xs text-sky-300 hover:underline truncate text-left cursor-pointer">${escapeHtml(formatTitleCase(rawName))}</button>
                    <span class="text-[10px] font-mono text-sky-400 bg-sky-500/10 border border-sky-500/30 px-1.5 py-0.5 rounded shrink-0">${elapsed}${plannedMins ? ` / ${plannedMins}m` : ''}</span>
                </div>
                <span class="text-[10px] font-mono font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded shrink-0">₱${gross.toFixed(0)}</span>
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

    const todayStr = getLocalTodayStr();
    const roster = globalState.rosterMembers || [];

    const todayLogins = (globalState.globalLogins || []).filter(l => {
        if (!l) return false;
        if (isSameDateStr(l.date, todayStr)) return true;
        if (l.loginTimestamp && isSameDateStr(new Date(l.loginTimestamp).toLocaleDateString('en-CA'), todayStr)) return true;
        if (l.clockOutTimestamp && isSameDateStr(new Date(l.clockOutTimestamp).toLocaleDateString('en-CA'), todayStr)) return true;
        return false;
    });

    const loggedInNames = new Set();
    todayLogins.forEach(l => {
        const n = (l.riderName || '').trim().toLowerCase();
        if (n) loggedInNames.add(n);
    });

    const notLoggedInRiders = roster.filter(m => {
        const n = (m.riderName || m.name || '').trim().toLowerCase();
        return n && !loggedInNames.has(n);
    });

    if (inHeader) inHeader.innerText = `Logged IN (${todayLogins.length})`;
    if (outHeader) outHeader.innerText = `Not Logged In (${notLoggedInRiders.length}):`;
    if (inFooter) inFooter.innerHTML = `Logged In: <span class="text-emerald-400 font-bold">${todayLogins.length} Riders</span> (out of ${roster.length} total → ${todayLogins.length}/${notLoggedInRiders.length})`;
    if (outFooter) outFooter.innerHTML = `Not Logged In: <span class="text-rose-400 font-bold">${notLoggedInRiders.length} Riders</span>`;

    // Render Logged IN
    if (todayLogins.length === 0) {
        inList.innerHTML = `<div class="text-slate-500 italic text-center py-4 text-xs">No logins recorded yet today.</div>`;
    } else {
        inList.innerHTML = todayLogins.map((l, idx) => {
            const rawName = l.riderName || "Rider";
            const rId = (l.riderId || l.telegramId || '').toString();
            const timeIn = l.loginTime || '--:--';
            const timeOut = l.clockOutTime ? l.clockOutTime : '<span class="text-emerald-400 font-bold">On Duty</span>';
            const dayOffBadge = renderModernDayOffBadgeHtml(rId, rawName);

            return `
            <div class="grid grid-cols-[1.8fr_0.9fr_0.9fr] sm:grid-cols-[2fr_1fr_1fr] items-center p-2 rounded-xl bg-black/40 border border-slate-800 hover:border-slate-700 transition cursor-pointer" onclick="window.openModernRiderProfile('${escapeHtml(rId)}', '${escapeHtml(rawName)}')">
                <div class="flex items-center gap-1.5 min-w-0 flex-wrap pr-1">
                    <span class="font-bold text-xs text-white hover:text-emerald-400 truncate">${idx + 1}. ${escapeHtml(formatTitleCase(rawName))}</span>
                    ${dayOffBadge}
                </div>
                <span class="font-mono text-xs text-slate-300">${escapeHtml(timeIn)}</span>
                <span class="font-mono text-xs text-slate-300">${timeOut}</span>
            </div>`;
        }).join('');
    }

    // Render Not Logged In
    if (notLoggedInRiders.length === 0) {
        outList.innerHTML = `<div class="text-slate-500 italic text-center py-4 text-xs">All registered riders are logged in!</div>`;
    } else {
        outList.innerHTML = notLoggedInRiders.map((m, idx) => {
            const rawName = m.riderName || m.name || "Rider";
            const mId = (m.telegramId || m.id || '').toString();
            const dayOffBadge = renderModernDayOffBadgeHtml(mId, rawName);

            return `
            <div class="flex items-center justify-between gap-2 p-2 rounded-xl bg-black/40 border border-slate-800 hover:border-slate-700 transition cursor-pointer" onclick="window.openModernRiderProfile('${escapeHtml(mId)}', '${escapeHtml(rawName)}')">
                <div class="flex items-center gap-1.5 min-w-0 flex-wrap pr-1">
                    <span class="font-bold text-xs text-slate-300 hover:text-rose-400 truncate">${idx + 1}. ${escapeHtml(formatTitleCase(rawName))}</span>
                    ${dayOffBadge}
                </div>
                <span class="text-[10px] text-slate-500 font-mono shrink-0">Offline</span>
            </div>`;
        }).join('');
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
    if (loginRec && loginRec.loginTime) {
        let grossMins = 0;
        let loginTs = loginRec.loginTimestamp;
        const totalBreakMins = loginRec.totalBreakMinutes || member?.totalBreakMinutes || 0;
        if (!loginTs) {
            const parsed = parseTimeToMinutes(loginRec.loginTime);
            if (parsed !== null) {
                const d = new Date();
                d.setHours(Math.floor(parsed / 60), parsed % 60, 0, 0);
                loginTs = d.getTime();
            }
        }
        if (loginTs) {
            const endTs = loginRec.clockOutTimestamp || Date.now();
            grossMins = Math.max(0, Math.floor((endTs - loginTs) / 60000));
            const netMins = Math.max(0, grossMins - totalBreakMins);
            timeServedStr = `${Math.floor(netMins / 60)}h ${netMins % 60}m (Break: ${totalBreakMins}m)`;
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
        <div class="flex items-center justify-between p-3 rounded-2xl bg-[#121a1f] border border-slate-800 gap-2">
            <div class="flex flex-col gap-1 min-w-0 flex-1">
                <div class="text-xs font-extrabold text-white truncate">
                    <span>Customer Name:</span> <span class="text-white font-black">${escapeHtml(custName)}</span>
                    <span class="text-slate-500 mx-1">|</span>
                    <span class="text-slate-400">Rider Name:</span> <span class="text-emerald-400 font-black">${escapeHtml(riderName)}</span>
                </div>
                <div class="flex items-center gap-2 text-[10px] font-mono text-slate-400 flex-wrap">
                    <span>Time Start: ${escapeHtml(sTime)}</span>
                    <span class="text-slate-600">|</span>
                    <span>Time Receipt Created: ${escapeHtml(rTime)}</span>
                    <span class="text-slate-600">|</span>
                    <span>Time Marked as done: ${escapeHtml(dTime)}</span>
                </div>
            </div>

            <div class="flex flex-col items-end gap-1 shrink-0">
                ${isUserAdmin ? `
                    <button type="button" onclick="window.promptAdminDeleteCommissionRecord && window.promptAdminDeleteCommissionRecord('${escapeHtml(rc.riderName || '')}', '${escapeHtml(rc.customerName || '')}', '${escapeHtml(cDate)}', '${escapeHtml(txId)}')" class="px-2 py-0.5 rounded-lg border border-red-500/50 hover:bg-red-500/20 text-rose-400 font-black text-[10px] transition active:scale-95 cursor-pointer">
                        [void button]
                    </button>
                ` : ''}
                <span class="text-xs font-mono font-black text-emerald-400">Total Time: ${escapeHtml(totalTimeText || 'N/A')}</span>
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
    const status = myRecord?.status || 'End';

    const btnAvail = document.getElementById('modern-btn-status-avail');
    const btnCater = document.getElementById('modern-btn-status-cater');
    const btnBreak = document.getElementById('modern-btn-status-break');
    const btnEnd = document.getElementById('modern-btn-status-end');

    [btnAvail, btnCater, btnBreak, btnEnd].forEach(b => {
        if (b) b.classList.remove('ring-2', 'ring-emerald-400', 'ring-amber-400', 'ring-sky-400', 'ring-rose-400', 'bg-white/10');
    });

    if (status === 'Available' && btnAvail) btnAvail.classList.add('ring-2', 'ring-emerald-400', 'bg-white/10');
    else if (status === 'Catering' && btnCater) btnCater.classList.add('ring-2', 'ring-amber-400', 'bg-white/10');
    else if (status === 'Break' && btnBreak) btnBreak.classList.add('ring-2', 'ring-sky-400', 'bg-white/10');
    else if (status === 'End' && btnEnd) btnEnd.classList.add('ring-2', 'ring-rose-400', 'bg-white/10');
}

// ============================================================================
// 13. GLOBAL INITIALIZER & WINDOW BINDINGS
// ============================================================================

export function initModernUiController() {
    // Check initial mode from localStorage
    const savedMode = localStorage.getItem('lokalex_ui_mode') || 'classic';
    if (savedMode === 'modern') {
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
        const stillExists = activeCustId && filtered.some(t => (t.custId || t.id) === activeCustId);

        if (!stillExists) {
            if (filtered.length > 0) {
                const first = filtered[0];
                const cid = first.custId || first.id;
                const name = formatTitleCase(first.customerName || first.name || "Customer");
                const avatar = first.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0084FF&color=fff`;
                selectModernCustomerChat(cid, name, avatar);
            } else {
                clearModernChatRightRoom();
                renderModernChatLeftList();
            }
        } else {
            renderModernChatLeftList();
            syncModernRightChatRoom();
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
}

