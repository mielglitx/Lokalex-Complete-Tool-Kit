// src/features/chat/index.js

/**
 * ============================================================================
 * CHAT SUBSYSTEM MASTER BARREL & DISPATCH COORDINATOR
 * ============================================================================
 * 
 * Central facade for all real-time communication systems. Aggregates customer
 * messaging, rider dispatch threads, store coordination, image markup/viewers,
 * and internal staff team comms. Enforces safety capacity limits on catering
 * operations and exposes functions to the global window scope.
 * 
 * Sub-Module Functional Breakdown:
 * ----------------------------------------------------------------------------
 * 1. chatUtils.js
 *    - Core utilities: modal body-scroll locking and customer dropdown population.
 *    - Image compression engine (HD 1920px vs Data Saver 600px via Canvas).
 *    - Camera/file selection dialogs and message action popovers (reactions, replies, copy).
 * 
 * 2. imageEditor.js
 *    - Canvas-based image markup tool with freehand drawing (4 brush sizes, 3 colors).
 *    - Dynamic text overlay tool supporting touch pinch-to-scale and two-finger rotation.
 *    - Brightness adjustments and image export/dispatch to active chats.
 * 
 * 3. imageViewer.js
 *    - Fullscreen image lightbox with multi-touch pinch-to-zoom and wheel zoom (50%-400%).
 *    - Direct handoff bridge from viewer into the image markup editor.
 * 
 * 4. videoViewer.js
 *    - Fullscreen in-chat video player with custom controls, speed toggles, and downloads.
 * 
 * 5. videoSender.js
 *    - Video clip recorder/picker, thumbnail generation, preview modal, and upload dispatcher.
 * 
 * 6. customerChat.js (Facade)
 *    - Sub-barrel for customer-facing chat components (state, animations, UI, feeds, actions).
 * 
 * 7. riderChat.js
 *    - Active rider-to-customer chat session manager and message dispatcher.
 *    - Lock enforcement preventing unauthorized replies if catered by another rider.
 *    - Infinite scroll history pagination with top-loading progress spinners.
 * 
 * 8. riderChatFeed.js
 *    - Filtered thread feed management (inbox, catering, stores, followup, done).
 *    - Customer account deduplication algorithm merging matching names/phone numbers.
 *    - Unread inbox badge calculation.
 * 
 * 9. riderChatRender.js
 *    - Bubble DOM renderer with seen/delivered status indicators, static map previews, and inline video cards.
 *    - Pointer long-press popovers and playful rapid-tap animations with particle bursts.
 *    - In-chat toast banners for unread messages received while scrolled up.
 * 
 * 10. riderStoreChat.js
 *     - Integration module for direct rider-to-merchant store communication channels.
 * 
 * 11. riderThreadActions.js
 *     - Order delivery lifecycle: customer info modals, quick replies, and thread voiding.
 *     - Proof of Delivery (POD) photo capture, compression, and delivery submission.
 *     - Order milestone tracking checkpoints (preparing, picked_up, arrived, delivered).
 * 
 * 12. teamComms.js (Facade)
 *      - Sub-barrel for internal staff team communications, draggable widgets, and group rooms.
 * ============================================================================
 */

import * as chatUtils from './chatUtils.js';
import * as imageEditor from './imageEditor.js';
import * as imageViewer from './imageViewer.js';
import * as videoViewer from './videoViewer.js';
import * as videoSender from './videoSender.js';
import * as customerChat from './customerChat.js';
import * as riderChat from './riderChat.js';
import * as riderChatFeed from './riderChatFeed.js';
import * as riderChatRender from './riderChatRender.js';
import * as riderStoreChat from './riderStoreChat.js';
import * as riderThreadActions from './riderThreadActions.js';
import * as teamComms from './teamComms.js';
import * as facebookApiAdmin from './facebookApiAdmin.js';
import * as fullBookingMode from './fullBookingMode.js';
import * as chatSoundManager from './chatSoundManager.js';
import * as adminBroadcast from './adminBroadcast.js';
import { globalState, appState } from '../../store/state.js';
import { escapeHtml, formatTitleCase } from '../../utils/helpers.js';
import { showToast } from '../../ui/notifications.js';
import { canRiderTakeMoreBookings } from '../roster/rosterStatus.js';

export * from './chatUtils.js';
export * from './imageEditor.js';
export * from './imageViewer.js';
export * from './videoViewer.js';
export * from './videoSender.js';
export * from './customerChat.js';
export * from './riderChat.js';
export * from './riderChatFeed.js';
export * from './riderChatRender.js';
export * from './riderStoreChat.js';
export * from './riderThreadActions.js';
export * from './teamComms.js';
export * from './facebookApiAdmin.js';
export * from './fullBookingMode.js';
export * from './chatSoundManager.js';
export * from './adminBroadcast.js';

// Bind all chat functions to global window object with max booking limit safety
if (typeof window !== 'undefined') {
    const modules = [
        chatUtils, 
        imageEditor, 
        imageViewer, 
        videoViewer,
        videoSender,
        customerChat, 
        riderChat, 
        riderChatFeed,
        riderChatRender, 
        riderStoreChat, 
        riderThreadActions, 
        teamComms,
        facebookApiAdmin,
        fullBookingMode,
        chatSoundManager,
        adminBroadcast
    ];
    modules.forEach(mod => {
        if (mod) {
            Object.keys(mod).forEach(fn => {
                if (typeof mod[fn] === 'function') {
                    // Wrap catering triggers to enforce the max booking limit
                    if (fn === 'caterCustomerThread' || fn === 'caterCustomerOrder') {
                        const originalFn = mod[fn];
                        window[fn] = function(...args) {
                            const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
                            const myName = (appState.riderName || localStorage.getItem('riderName') || "Rider").trim();
                            const limitCheck = canRiderTakeMoreBookings(myId, myName);
                            if (!limitCheck.allowed) {
                                return showToast(`⚠️ You have reached the limit of ${limitCheck.maxAllowed} active booking(s).`);
                            }
                            return originalFn.apply(this, args);
                        };
                    } else {
                        window[fn] = mod[fn];
                    }
                }
            });
        }
    });
}

// Helper to get all customer names currently being catered by active riders
function getActiveCateringCustomerNames() {
    const activeNames = new Set();
    const rosterMembers = globalState.rosterMembers || [];

    rosterMembers.forEach(m => {
        if (m.status === 'Catering' && m.customerName) {
            m.customerName.split(',').forEach(c => {
                const cleanName = c.trim().toLowerCase();
                if (cleanName) activeNames.add(cleanName);
            });
        }
    });

    return activeNames;
}

// MAIN FUNCTION TO FILTER CUSTOMER CHATS BY FOLDER / CATEGORY (INBOX, CATERING, FOLLOWUP, DONE)
export function renderFilteredCustomerChats(targetFolder = 'inbox') {
    globalState.activeChatFilter = targetFolder;

    // Highlight active filter tab in UI
    const filterTabs = ['inbox', 'catering', 'applicant', 'followup', 'done', 'canceled'];
    filterTabs.forEach(folder => {
        const tabBtn = document.getElementById(`chat-tab-${folder}`);
        if (tabBtn) {
            if (folder === targetFolder) {
                tabBtn.className = "flex-1 py-1.5 px-2 rounded-lg bg-blue-600 text-white font-bold transition text-[11px] shadow";
            } else {
                tabBtn.className = "flex-1 py-1.5 px-2 rounded-lg text-gray-400 hover:text-white font-bold transition text-[11px]";
            }
        }
    });

    const feedContainer = document.getElementById('customer-chat-threads-feed');
    if (!feedContainer) return;

    const allChats = globalState.customerChats ? Object.entries(globalState.customerChats).map(([id, val]) => ({ id, ...val })) : [];
    const activeCateringNames = getActiveCateringCustomerNames();

    let filtered = [];

    if (targetFolder === 'catering') {
        // FILTER: Show chats currently being catered to
        filtered = allChats.filter(chat => {
            const meta = chat.metadata || chat;
            const isCatered = !!(meta.cateredByRiderName || meta.cateredByRiderId || meta.cateredBy) && meta.status !== 'completed' && meta.status !== 'done' && meta.status !== 'cancelled';
            const folder = (meta.folder || 'inbox').toLowerCase();
            if (folder !== 'catering' && !isCatered) return false;
            if (meta.status === 'completed' || meta.status === 'done' || meta.status === 'cancelled') return false;

            const rName = (meta.cateredByRiderName || meta.cateredBy || "").trim().toLowerCase();
            const rId = (meta.cateredByRiderId || "").toString().trim();
            if (rId || rName) {
                const assignedRider = (globalState.rosterMembers || []).find(m => 
                    (rId && (m.telegramId || m.id || "").toString() === rId) ||
                    (rName && (m.riderName || m.name || "").trim().toLowerCase() === rName)
                );
                if (assignedRider && assignedRider.status !== 'Catering') {
                    return false;
                }
            }

            return true;
        });
    } else {
        // Standard folder filtering (inbox, applicant, done, etc.)
        filtered = allChats.filter(chat => {
            const meta = chat.metadata || chat;
            const isCatered = !!(meta.cateredByRiderName || meta.cateredByRiderId || meta.cateredBy) && meta.status !== 'completed' && meta.status !== 'done' && meta.status !== 'cancelled';
            const folder = (meta.folder || 'inbox').toLowerCase();
            
            if (targetFolder === 'inbox') {
                if (isCatered || folder === 'catering') return false;
                if (folder === 'applicant' || folder === 'followup' || meta.isApplicant) return false;
                return folder === 'inbox';
            }
            if (targetFolder === 'applicant') {
                return folder === 'applicant' || meta.isApplicant === true;
            }
            if (targetFolder === 'followup') {
                return folder === 'followup' && !meta.isApplicant;
            }
            if (targetFolder === 'done') {
                if (folder === 'done' || meta.status === 'completed' || meta.status === 'done') return true;
                if (folder === 'catering') {
                    const rName = (meta.cateredByRiderName || meta.cateredBy || "").trim().toLowerCase();
                    const rId = (meta.cateredByRiderId || "").toString().trim();
                    if (rId || rName) {
                        const assignedRider = (globalState.rosterMembers || []).find(m => 
                            (rId && (m.telegramId || m.id || "").toString() === rId) ||
                            (rName && (m.riderName || m.name || "").trim().toLowerCase() === rName)
                        );
                        if (assignedRider && assignedRider.status === 'Available') return true;
                    }
                }
                return false;
            }
            return folder === targetFolder.toLowerCase();
        });
    }

    if (filtered.length === 0) {
        feedContainer.innerHTML = `<div class="text-center text-gray-500 italic py-12 text-xs">No active chats in ${targetFolder.toUpperCase()}.</div>`;
        return;
    }

    // Sort by latest message timestamp
    filtered.sort((a, b) => (b.lastTimestamp || b.updatedAt || 0) - (a.lastTimestamp || a.updatedAt || 0));

    // Render list with live catering rider badge
    feedContainer.innerHTML = filtered.map(chat => {
        const meta = chat.metadata || chat;
        const custName = escapeHtml(formatTitleCase(meta.customerName || meta.name || "Customer"));
        const lastMsg = escapeHtml(meta.lastMessage || meta.lastMsg || "No messages yet");
        const riderName = meta.cateredByRiderName || meta.cateredBy ? formatTitleCase(meta.cateredByRiderName || meta.cateredBy) : "";
        const custAvatar = meta.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=0084FF&color=fff`;

        return `
        <div onclick="window.openCustomerChatThread && window.openCustomerChatThread('${chat.id}')" class="bg-cardBg border border-gray-200 dark:border-gray-800 hover:border-blue-500/50 p-3 rounded-2xl flex items-center justify-between cursor-pointer transition active:scale-[0.98]">
            <div class="flex items-center gap-3 min-w-0 flex-1">
                <div class="relative shrink-0" onclick="event.stopPropagation(); window.openImageViewerModal && window.openImageViewerModal('${escapeHtml(custAvatar)}', 'customer')" title="Tap to view photo">
                    <img src="${escapeHtml(custAvatar)}" loading="lazy" decoding="async" class="w-10 h-10 rounded-full object-cover border border-blue-500/30 cursor-pointer hover:scale-105 transition" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=0084FF&color=fff'">
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-xs text-gray-900 dark:text-white truncate">${custName}</span>
                        ${riderName ? `<span class="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"><i class="fa-solid fa-motorcycle"></i> ${escapeHtml(riderName)}</span>` : ''}
                    </div>
                    <p class="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">${lastMsg}</p>
                </div>
            </div>
            <i class="fa-solid fa-chevron-right text-xs text-gray-400 dark:text-gray-600 shrink-0 ml-2"></i>
        </div>`;
    }).join('');
}

if (typeof window !== 'undefined') {
    window.renderFilteredCustomerChats = renderFilteredCustomerChats;
}