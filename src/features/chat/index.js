// src/features/chat/index.js
import * as chatUtils from './chatUtils.js';
import * as imageEditor from './imageEditor.js';
import * as imageViewer from './imageViewer.js';
import * as customerChat from './customerChat.js';
import * as riderChat from './riderChat.js';
import * as riderStoreChat from './riderStoreChat.js';
import * as riderThreadActions from './riderThreadActions.js';
import * as teamComms from './teamComms.js';
import { globalState, appState } from '../../store/state.js';
import { escapeHtml } from '../../utils/helpers.js';
import { showToast } from '../../ui/notifications.js';
import { canRiderTakeMoreBookings } from '../roster/rosterStatus.js';

export * from './chatUtils.js';
export * from './imageEditor.js';
export * from './imageViewer.js';
export * from './customerChat.js';
export * from './riderChat.js';
export * from './riderStoreChat.js';
export * from './riderThreadActions.js';
export * from './teamComms.js';

// Bind all chat functions to global window object with max booking limit safety
if (typeof window !== 'undefined') {
    const modules = [
        chatUtils, 
        imageEditor, 
        imageViewer, 
        customerChat, 
        riderChat, 
        riderStoreChat, 
        riderThreadActions, 
        teamComms
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
                                return showToast(`⚠️ Naabot mo na ang limit na ${limitCheck.maxAllowed} active booking(s).`);
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
    const filterTabs = ['inbox', 'catering', 'followup', 'done', 'canceled'];
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
            const cName = (meta.customerName || meta.name || "").trim().toLowerCase();
            const isFolderCatering = meta.folder === 'catering';
            const hasRiderAssigned = !!(meta.cateredBy || meta.cateredByRiderName || meta.cateredByRiderId);
            const isLiveInRoster = cName && activeCateringNames.has(cName);

            return isFolderCatering || hasRiderAssigned || isLiveInRoster;
        });
    } else {
        // Standard folder filtering (inbox, followup, done, etc.)
        filtered = allChats.filter(chat => {
            const meta = chat.metadata || chat;
            const folder = (meta.folder || 'inbox').toLowerCase();
            const hasRiderAssigned = !!(meta.cateredBy || meta.cateredByRiderName || meta.cateredByRiderId);
            
            if (targetFolder === 'inbox') {
                return (folder === 'inbox') && !hasRiderAssigned;
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
        const custName = escapeHtml(meta.customerName || meta.name || "Customer");
        const lastMsg = escapeHtml(meta.lastMessage || meta.lastMsg || "No messages yet");
        const riderName = meta.cateredByRiderName || meta.cateredBy || "";

        return `
        <div onclick="window.openCustomerChatThread && window.openCustomerChatThread('${chat.id}')" class="bg-cardBg border border-gray-800 hover:border-blue-500/50 p-3 rounded-2xl flex items-center justify-between cursor-pointer transition active:scale-[0.98]">
            <div class="flex items-center gap-3 min-w-0 flex-1">
                <div class="w-10 h-10 rounded-full bg-blue-600/20 text-blue-400 font-bold flex items-center justify-center text-sm shrink-0 border border-blue-500/30">
                    <i class="fa-solid fa-user"></i>
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-xs text-white truncate">${custName}</span>
                        ${riderName ? `<span class="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"><i class="fa-solid fa-motorcycle"></i> ${escapeHtml(riderName)}</span>` : ''}
                    </div>
                    <p class="text-[11px] text-gray-400 truncate mt-0.5">${lastMsg}</p>
                </div>
            </div>
            <i class="fa-solid fa-chevron-right text-xs text-gray-600 shrink-0 ml-2"></i>
        </div>`;
    }).join('');
}

if (typeof window !== 'undefined') {
    window.renderFilteredCustomerChats = renderFilteredCustomerChats;
}