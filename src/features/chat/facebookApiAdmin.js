// src/features/chat/facebookApiAdmin.js

/**
 * ============================================================================
 * FACEBOOK MESSENGER API & MULTI-CHANNEL LIVE CHAT CONTROLLER
 * ============================================================================
 * 
 * Description:
 * Manages admin-configured Facebook Messenger APIs and public rider channel selection:
 * 1. Admin Management:
 *    - Create, edit, pause, and delete Facebook APIs with dedicated names and private webhook links.
 *    - Sensitive API links and tokens are strictly segregated in `adminSettings/facebookApis`.
 * 2. Multi-Source Live Chat Feed Filter:
 *    - Riders can pick multiple sources (Web App, Page A, Page B, etc.) simultaneously.
 *    - Quick-toggle chips on the dashboard + complete checklist modal.
 *    - Zero-exposure security: riders only subscribe to public metadata in `facebookChannels`.
 * ============================================================================
 */

import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { escapeHtml } from '../../utils/helpers.js';
import { isAdmin, canManageRoster } from '../roster/rosterUtils.js';
import { toggleBodyScroll } from './chatUtils.js';

let cachedPublicChannelsMap = new Map();
let cachedAdminApisMap = new Map();
let isPublicChannelsListening = false;
let isAdminApisListening = false;
let visibleLinksSet = new Set();

/**
 * Set of active sources selected by the rider.
 * 'all' means all sources are active (default).
 * Otherwise contains specific source IDs: 'web' and/or Facebook channel IDs.
 */
let activeRiderSources = new Set(['all']);

// Initialize active sources from persistent storage
(function initActiveSources() {
    if (typeof localStorage === 'undefined') return;
    try {
        const saved = localStorage.getItem('lokalex_selected_sources');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                activeRiderSources = new Set(parsed);
                return;
            }
        }
        // Fallback to legacy single channel setting
        const legacySingle = localStorage.getItem('lokalex_selected_fb_channel');
        if (legacySingle && legacySingle !== 'all') {
            activeRiderSources = new Set([legacySingle]);
        }
    } catch (e) {
        activeRiderSources = new Set(['all']);
    }
})();

export function getActiveRiderSources() {
    return Array.from(activeRiderSources);
}

export function isAllSourcesSelected() {
    return activeRiderSources.has('all');
}

export function getAllKnownSourceIds() {
    const ids = ['web'];
    cachedPublicChannelsMap.forEach((ch, id) => {
        if (ch && ch.isActive !== false) {
            ids.push(id);
        }
    });
    return ids;
}

export function isSourceSelected(sourceId) {
    if (!sourceId) return true;
    if (activeRiderSources.has('all')) return true;
    return activeRiderSources.has(sourceId);
}

export function hasAnyFbSourceSelected() {
    if (activeRiderSources.has('all')) return true;
    if (activeRiderSources.has('messenger')) return true;
    for (const id of activeRiderSources) {
        if (id !== 'web' && id !== 'all') return true;
    }
    return false;
}

export function getPublicFbChannelName(apiId) {
    if (!apiId) return null;
    if (apiId === 'web') return "Web App";
    const channel = cachedPublicChannelsMap.get(apiId);
    return channel ? channel.name : null;
}

export function getPublicFbSendEndpoint(apiId) {
    if (apiId) {
        const channel = cachedPublicChannelsMap.get(apiId);
        if (channel?.sendEndpoint) return channel.sendEndpoint;
    }
    // Fallback: check any active channel in cache
    for (const ch of cachedPublicChannelsMap.values()) {
        if (ch?.sendEndpoint && ch.isActive !== false) {
            return ch.sendEndpoint;
        }
    }
    return "https://lokalex-messenger-webhook.lokaledeliver.workers.dev/api/send-reply";
}

/**
 * Backward compatibility helper for single active channel queries
 */
export function getActiveRiderFbChannel() {
    if (activeRiderSources.has('all')) return 'all';
    if (activeRiderSources.size === 1) return Array.from(activeRiderSources)[0];
    return 'multiple';
}

/**
 * Backward compatibility helper for legacy single-select triggers
 */
export function selectRiderFbChannel(channelId) {
    if (channelId === '__manage_apis__') {
        openAdminFbApiModal();
        renderRiderSourcesUI();
        return;
    }

    if (channelId === 'all') {
        selectAllRiderSources();
    } else if (channelId) {
        activeRiderSources = new Set([channelId]);
        saveAndSyncRiderSources();
        const name = channelId === 'web' ? 'Web App' : (getPublicFbChannelName(channelId) || channelId);
        showToast(`📌 Feed filtered to: ${name}`);
    }
}

/**
 * Toggles an individual source on or off.
 * If user currently has 'all' selected and clicks a specific source, it isolates to that source.
 * If user selects all available sources, it automatically simplifies back to 'all'.
 */
export function toggleRiderSource(sourceId) {
    if (sourceId === '__manage_apis__') {
        closeRiderChatSourcesModal();
        openAdminFbApiModal();
        return;
    }

    if (sourceId === 'all') {
        selectAllRiderSources();
        return;
    }

    const allKnown = getAllKnownSourceIds();

    if (activeRiderSources.has('all')) {
        // Isolate to the clicked source
        activeRiderSources = new Set([sourceId]);
        const name = sourceId === 'web' ? 'Web App' : (getPublicFbChannelName(sourceId) || 'Channel');
        showToast(`📌 Filtered to: ${name}`);
    } else if (activeRiderSources.has(sourceId)) {
        // Deselect
        activeRiderSources.delete(sourceId);
        if (activeRiderSources.size === 0) {
            showToast(`⚠️ No sources selected.`);
        } else {
            showToast(`📌 Updated chat sources (${activeRiderSources.size} active)`);
        }
    } else {
        // Select
        activeRiderSources.add(sourceId);
        const hasAll = allKnown.every(id => activeRiderSources.has(id));
        if (hasAll) {
            activeRiderSources = new Set(['all']);
            showToast(`🌐 Showing all chat sources`);
        } else {
            showToast(`📌 Updated chat sources (${activeRiderSources.size} active)`);
        }
    }

    saveAndSyncRiderSources();
}

export function selectAllRiderSources() {
    activeRiderSources = new Set(['all']);
    saveAndSyncRiderSources();
    showToast(`🌐 Showing all chat sources`);
}

export function clearAllRiderSources() {
    activeRiderSources = new Set();
    saveAndSyncRiderSources();
    showToast(`⚠️ Cleared all source selections.`);
}

function saveAndSyncRiderSources() {
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem('lokalex_selected_sources', JSON.stringify(Array.from(activeRiderSources)));
            if (activeRiderSources.has('all')) {
                localStorage.setItem('lokalex_selected_fb_channel', 'all');
            } else if (activeRiderSources.size === 1) {
                localStorage.setItem('lokalex_selected_fb_channel', Array.from(activeRiderSources)[0]);
            } else {
                localStorage.setItem('lokalex_selected_fb_channel', 'multiple');
            }
        } catch(e) {}
    }

    renderRiderSourcesUI();
    if (window.renderRiderCustomerChatFeed) {
        window.renderRiderCustomerChatFeed();
    }
}

/**
 * Public channel listener for ordinary riders.
 * Strictly downloads public names and IDs from `facebookChannels` (no API links).
 */
export function listenToPublicFbChannels() {
    if (!db || isPublicChannelsListening) return;
    isPublicChannelsListening = true;

    db.ref('facebookChannels').on('value', (snapshot) => {
        const val = snapshot.val() || {};
        cachedPublicChannelsMap.clear();

        Object.entries(val).forEach(([id, data]) => {
            if (data && data.isActive !== false) {
                cachedPublicChannelsMap.set(id, {
                    id: id,
                    name: data.name || "FB Channel",
                    sendEndpoint: data.sendEndpoint || null,
                    isActive: data.isActive !== false,
                    createdAt: data.createdAt || 0
                });
            }
        });

        // Clean up sources if a previously selected channel was deleted and we're not on 'all'
        if (!activeRiderSources.has('all')) {
            let changed = false;
            Array.from(activeRiderSources).forEach(id => {
                if (id !== 'web' && !cachedPublicChannelsMap.has(id)) {
                    activeRiderSources.delete(id);
                    changed = true;
                }
            });
            if (changed) {
                if (activeRiderSources.size === 0) {
                    activeRiderSources = new Set(['all']);
                }
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem('lokalex_selected_sources', JSON.stringify(Array.from(activeRiderSources)));
                }
            }
        }

        renderRiderSourcesUI();
        if (window.renderRiderCustomerChatFeed) {
            window.renderRiderCustomerChatFeed();
        }
    });
}

/**
 * Renders the multi-source selector UI:
 * 1. Filter button summary text & count badge.
 * 2. Horizontal quick-toggle pill chips.
 * 3. Modal checklist items in #rider-chat-sources-list.
 */
export function renderRiderSourcesUI() {
    const summaryTextEl = document.getElementById('rider-sources-summary-text');
    const countBadgeEl = document.getElementById('rider-sources-count-badge');
    const resetBtnEl = document.getElementById('rider-sources-reset-all-btn');
    const chipsContainerEl = document.getElementById('rider-sources-chips-container');
    const modalListEl = document.getElementById('rider-chat-sources-list');
    const adminBarEl = document.getElementById('rider-chat-sources-admin-bar');
    const legacySelectEl = document.getElementById('rider-fb-channel-select');

    const allIds = getAllKnownSourceIds();
    const totalCount = allIds.length;
    const isAll = isAllSourcesSelected();
    const activeCount = isAll ? totalCount : activeRiderSources.size;

    // 1. Update summary button label
    if (summaryTextEl) {
        if (isAll) {
            summaryTextEl.innerText = "🌐 All Sources";
        } else if (activeCount === 0) {
            summaryTextEl.innerText = "⚠️ None Selected";
        } else if (activeCount === 1) {
            const singleId = Array.from(activeRiderSources)[0];
            if (singleId === 'web') {
                summaryTextEl.innerText = "🌐 Web App";
            } else {
                const name = getPublicFbChannelName(singleId) || "FB Page";
                summaryTextEl.innerText = `📘 ${name}`;
            }
        } else {
            summaryTextEl.innerText = `${activeCount} Sources Active`;
        }
    }

    // 2. Update count badge & reset button
    if (countBadgeEl) {
        if (isAll) {
            countBadgeEl.innerText = "All";
            countBadgeEl.className = "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700/50 text-[9px] font-black px-1.5 py-0.2 rounded-full shrink-0";
        } else if (activeCount === 0) {
            countBadgeEl.innerText = "0";
            countBadgeEl.className = "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700/50 text-[9px] font-black px-1.5 py-0.2 rounded-full shrink-0";
        } else {
            countBadgeEl.innerText = `${activeCount}/${totalCount}`;
            countBadgeEl.className = "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/50 text-[9px] font-black px-1.5 py-0.2 rounded-full shrink-0";
        }
    }

    if (resetBtnEl) {
        if (isAll) {
            resetBtnEl.classList.add('hidden');
        } else {
            resetBtnEl.classList.remove('hidden');
        }
    }

    // 3. Render horizontal quick-toggle chips
    if (chipsContainerEl) {
        const publicChannels = Array.from(cachedPublicChannelsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        let chipsHtml = '';

        // All Sources chip
        chipsHtml += `
        <button type="button" onclick="window.toggleRiderSource && window.toggleRiderSource('all')" class="shrink-0 px-2 py-0.5 rounded-lg text-[9.5px] font-black transition active:scale-95 flex items-center gap-1 cursor-pointer ${isAll ? 'bg-blue-600 text-white shadow-xs' : 'bg-white dark:bg-cardBg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-700 opacity-70'}">
            ${isAll ? '<i class="fa-solid fa-check text-[8px]"></i>' : ''}
            <span>🌐 All</span>
        </button>`;

        // Web App chip
        const isWebActive = isSourceSelected('web');
        chipsHtml += `
        <button type="button" onclick="window.toggleRiderSource && window.toggleRiderSource('web')" class="shrink-0 px-2 py-0.5 rounded-lg text-[9.5px] font-black transition active:scale-95 flex items-center gap-1 cursor-pointer ${isWebActive ? 'bg-emerald-600 text-white shadow-xs' : 'bg-white dark:bg-cardBg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-700 opacity-60'}">
            ${isWebActive ? '<i class="fa-solid fa-check text-[8px]"></i>' : ''}
            <i class="fa-solid fa-globe text-[8.5px]"></i>
            <span>Web</span>
        </button>`;

        // Facebook Channel chips
        publicChannels.forEach(c => {
            const isChannelActive = isSourceSelected(c.id);
            chipsHtml += `
            <button type="button" onclick="window.toggleRiderSource && window.toggleRiderSource('${escapeHtml(c.id)}')" class="shrink-0 px-2 py-0.5 rounded-lg text-[9.5px] font-black transition active:scale-95 flex items-center gap-1 cursor-pointer ${isChannelActive ? 'bg-blue-600 text-white shadow-xs' : 'bg-white dark:bg-cardBg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-700 opacity-60'}" title="${escapeHtml(c.name)}">
                ${isChannelActive ? '<i class="fa-solid fa-check text-[8px]"></i>' : ''}
                <i class="fa-brands fa-facebook-messenger text-[9px] ${isChannelActive ? 'text-white' : 'text-blue-500'}"></i>
                <span class="max-w-[110px] truncate">${escapeHtml(c.name)}</span>
            </button>`;
        });

        chipsContainerEl.innerHTML = chipsHtml;
    }

    // 4. Render Modal Checklist
    if (modalListEl) {
        const publicChannels = Array.from(cachedPublicChannelsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        let listHtml = '';

        // Web App row
        const isWebActive = isSourceSelected('web');
        listHtml += `
        <div onclick="window.toggleRiderSource && window.toggleRiderSource('web')" class="p-2.5 rounded-2xl border transition flex items-center justify-between cursor-pointer active:scale-[0.99] ${isWebActive ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700 shadow-2xs' : 'bg-gray-50 dark:bg-darkBg border-gray-200 dark:border-gray-800 opacity-70'}">
            <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-8 h-8 rounded-xl ${isWebActive ? 'bg-emerald-500 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400'} flex items-center justify-center text-sm font-bold shrink-0">
                    <i class="fa-solid fa-globe"></i>
                </div>
                <div class="min-w-0">
                    <div class="font-bold text-xs text-gray-900 dark:text-white truncate">Lokalex Web App</div>
                    <div class="text-[10px] text-gray-500 dark:text-gray-400 truncate">Direct customer website chats</div>
                </div>
            </div>
            <div class="w-5 h-5 rounded-lg border flex items-center justify-center ${isWebActive ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-gray-400 dark:border-gray-600 text-transparent'}">
                <i class="fa-solid fa-check text-[10px]"></i>
            </div>
        </div>`;

        // Facebook channels rows
        publicChannels.forEach(c => {
            const isChannelActive = isSourceSelected(c.id);
            listHtml += `
            <div onclick="window.toggleRiderSource && window.toggleRiderSource('${escapeHtml(c.id)}')" class="p-2.5 rounded-2xl border transition flex items-center justify-between cursor-pointer active:scale-[0.99] ${isChannelActive ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700 shadow-2xs' : 'bg-gray-50 dark:bg-darkBg border-gray-200 dark:border-gray-800 opacity-70'}">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-8 h-8 rounded-xl ${isChannelActive ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-blue-500'} flex items-center justify-center text-sm font-bold shrink-0">
                        <i class="fa-brands fa-facebook-messenger"></i>
                    </div>
                    <div class="min-w-0">
                        <div class="font-bold text-xs text-gray-900 dark:text-white truncate">${escapeHtml(c.name)}</div>
                        <div class="text-[10px] text-gray-500 dark:text-gray-400 truncate">Facebook Messenger API</div>
                    </div>
                </div>
                <div class="w-5 h-5 rounded-lg border flex items-center justify-center ${isChannelActive ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-400 dark:border-gray-600 text-transparent'}">
                    <i class="fa-solid fa-check text-[10px]"></i>
                </div>
            </div>`;
        });

        if (publicChannels.length === 0) {
            listHtml += `
            <div class="text-center text-gray-400 dark:text-gray-500 italic py-3 text-[11px]">
                No Facebook APIs added yet. (Admin can add one anytime)
            </div>`;
        }

        modalListEl.innerHTML = listHtml;
    }

    // 5. Admin bar in modal
    if (adminBarEl) {
        if (isAdmin() || canManageRoster()) {
            adminBarEl.classList.remove('hidden');
        } else {
            adminBarEl.classList.add('hidden');
        }
    }

    // 6. Keep legacy select synced if present
    if (legacySelectEl) {
        const publicChannels = Array.from(cachedPublicChannelsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        let optHtml = `<option value="all" ${isAll ? 'selected' : ''}>🌐 All Channels</option>`;
        publicChannels.forEach(c => {
            optHtml += `<option value="${escapeHtml(c.id)}" ${isSourceSelected(c.id) ? 'selected' : ''}>📘 ${escapeHtml(c.name)}</option>`;
        });
        legacySelectEl.innerHTML = optHtml;
    }
}

/**
 * Backward-compatible alias
 */
export function renderFbChannelSelector() {
    renderRiderSourcesUI();
}

export function openRiderChatSourcesModal() {
    const modal = document.getElementById('rider-chat-sources-modal');
    if (modal) {
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
        renderRiderSourcesUI();
    }
}

export function closeRiderChatSourcesModal() {
    const modal = document.getElementById('rider-chat-sources-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
}

// ============================================================================
// ADMIN FACEBOOK API CONFIGURATION MODAL HANDLERS
// ============================================================================

export function hasAdminFbPermission() {
    if (isAdmin() || canManageRoster()) return true;
    if (globalState.adminControlsEnabled === true) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('adminControlsEnabled') === 'true') return true;
    const myName = (appState.riderName || (typeof localStorage !== 'undefined' ? localStorage.getItem('riderName') : '') || '').toLowerCase().trim();
    if (myName.includes('amiel') || myName.includes('admin')) return true;
    return false;
}

export function openAdminFbApiModal() {
    if (!hasAdminFbPermission()) {
        return showToast("⚠️ Unauthorized: Only Admin can configure Facebook APIs.");
    }

    const modal = document.getElementById('admin-fb-api-modal');
    if (modal) {
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
        resetAdminFbApiForm();
        listenToAdminFbApis();
    }
}

export function closeAdminFbApiModal() {
    const modal = document.getElementById('admin-fb-api-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
}

export function resetAdminFbApiForm() {
    const nameInput = document.getElementById('admin-fb-api-name');
    const linkInput = document.getElementById('admin-fb-api-link');
    const pageIdInput = document.getElementById('admin-fb-api-pageid');
    const tokenInput = document.getElementById('admin-fb-api-token');
    const accessTokenInput = document.getElementById('admin-fb-api-accesstoken');
    const editingIdInput = document.getElementById('admin-fb-api-editing-id');
    const submitBtn = document.getElementById('admin-fb-api-submit-btn');
    const cancelEditBtn = document.getElementById('admin-fb-api-cancel-edit-btn');

    if (nameInput) nameInput.value = '';
    if (linkInput) linkInput.value = '';
    if (pageIdInput) pageIdInput.value = '';
    if (tokenInput) tokenInput.value = '';
    if (accessTokenInput) accessTokenInput.value = '';
    if (editingIdInput) editingIdInput.value = '';

    if (submitBtn) {
        submitBtn.innerHTML = `<i class="fa-solid fa-plus mr-1"></i> Save & Connect API`;
    }
    if (cancelEditBtn) {
        cancelEditBtn.classList.add('hidden');
    }
}

/**
 * Subscribes to the secure `adminSettings/facebookApis` node (Admins only).
 */
export function listenToAdminFbApis() {
    if (!db || !hasAdminFbPermission()) return;
    if (isAdminApisListening) {
        renderAdminFbApisList();
        return;
    }
    isAdminApisListening = true;

    db.ref('adminSettings/facebookApis').on('value', (snapshot) => {
        const val = snapshot.val() || {};
        cachedAdminApisMap.clear();

        Object.entries(val).forEach(([id, data]) => {
            if (data) {
                cachedAdminApisMap.set(id, { id, ...data });
            }
        });

        renderAdminFbApisList();
    });
}

export function toggleAdminFbLinkVisibility(apiId) {
    if (visibleLinksSet.has(apiId)) {
        visibleLinksSet.delete(apiId);
    } else {
        visibleLinksSet.add(apiId);
    }
    renderAdminFbApisList();
}

export function renderAdminFbApisList() {
    const listContainer = document.getElementById('admin-fb-apis-list');
    const countBadge = document.getElementById('admin-fb-apis-count-badge');
    if (!listContainer) return;

    const apis = Array.from(cachedAdminApisMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (countBadge) {
        countBadge.innerText = `${apis.length} configured`;
    }

    if (apis.length === 0) {
        listContainer.innerHTML = `
        <div class="text-center text-gray-400 dark:text-gray-500 italic py-8 text-xs flex flex-col items-center gap-1.5">
            <i class="fa-brands fa-facebook-messenger text-2xl text-blue-500/50"></i>
            <span>No Facebook APIs configured yet.</span>
            <span class="text-[10px]">Add your first API above so riders can select it in Live Chats.</span>
        </div>`;
        return;
    }

    listContainer.innerHTML = apis.map(api => {
        const isRevealed = visibleLinksSet.has(api.id);
        const maskedLink = isRevealed ? escapeHtml(api.apiLink || '') : '••••••••••••••••••••••••••••••••';
        const isActive = api.isActive !== false;

        return `
        <div class="bg-darkBg p-3 rounded-2xl border border-gray-200 dark:border-gray-800 flex flex-col gap-2 transition hover:border-blue-500/40 shadow-xs">
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                    <div class="w-7 h-7 rounded-lg bg-blue-600/20 text-blue-500 flex items-center justify-center text-xs font-black shrink-0">
                        <i class="fa-brands fa-facebook-messenger"></i>
                    </div>
                    <div class="min-w-0">
                        <div class="font-black text-xs text-gray-900 dark:text-white truncate flex items-center gap-1.5">
                            <span class="truncate">${escapeHtml(api.name)}</span>
                            <span class="text-[9px] px-1.5 py-0.2 rounded-full font-bold ${isActive ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400' : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-400'}">
                                ${isActive ? '● Active' : '○ Paused'}
                            </span>
                        </div>
                        ${api.pageId ? `<div class="text-[9px] text-gray-400 font-mono truncate">Page ID: ${escapeHtml(api.pageId)}</div>` : ''}
                    </div>
                </div>

                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" onclick="window.editAdminFbApi && window.editAdminFbApi('${api.id}')" class="bg-gray-100 hover:bg-gray-200 dark:bg-cardBg dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 p-1.5 rounded-lg text-xs transition active:scale-95" title="Edit API details">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button type="button" onclick="window.toggleAdminFbApiStatus && window.toggleAdminFbApiStatus('${api.id}', ${isActive})" class="${isActive ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'} p-1.5 rounded-lg text-xs transition active:scale-95" title="${isActive ? 'Pause API' : 'Activate API'}">
                        <i class="fa-solid ${isActive ? 'fa-pause' : 'fa-play'}"></i>
                    </button>
                    <button type="button" onclick="window.deleteAdminFbApi && window.deleteAdminFbApi('${api.id}', '${escapeHtml(api.name)}')" class="bg-red-50 hover:bg-red-100 dark:bg-red-500/20 dark:hover:bg-red-500/30 text-red-600 dark:text-red-400 p-1.5 rounded-lg text-xs transition active:scale-95" title="Delete API">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>

            <!-- Masked Webhook URL (Click Eye to Reveal) -->
            <div class="bg-gray-100 dark:bg-black/40 rounded-xl p-2 flex items-center justify-between gap-2 border border-gray-200 dark:border-gray-800 text-[10px]">
                <div class="min-w-0 flex-1">
                    <div class="text-gray-400 text-[9px] font-bold">API / WEBHOOK URL:</div>
                    <div class="font-mono text-gray-800 dark:text-gray-200 truncate ${!isRevealed ? 'tracking-widest' : ''}">${maskedLink}</div>
                </div>
                <button type="button" onclick="window.toggleAdminFbLinkVisibility && window.toggleAdminFbLinkVisibility('${api.id}')" class="text-gray-500 hover:text-gray-700 dark:hover:text-white p-1 text-xs shrink-0" title="${isRevealed ? 'Mask URL' : 'Reveal URL'}">
                    <i class="fa-solid ${isRevealed ? 'fa-eye-slash' : 'fa-eye'}"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

export function editAdminFbApi(apiId) {
    const api = cachedAdminApisMap.get(apiId);
    if (!api) return;

    const nameInput = document.getElementById('admin-fb-api-name');
    const linkInput = document.getElementById('admin-fb-api-link');
    const pageIdInput = document.getElementById('admin-fb-api-pageid');
    const tokenInput = document.getElementById('admin-fb-api-token');
    const accessTokenInput = document.getElementById('admin-fb-api-accesstoken');
    const editingIdInput = document.getElementById('admin-fb-api-editing-id');
    const submitBtn = document.getElementById('admin-fb-api-submit-btn');
    const cancelEditBtn = document.getElementById('admin-fb-api-cancel-edit-btn');

    if (nameInput) nameInput.value = api.name || '';
    if (linkInput) linkInput.value = api.apiLink || '';
    if (pageIdInput) pageIdInput.value = api.pageId || '';
    if (tokenInput) tokenInput.value = api.verifyToken || '';
    if (accessTokenInput) accessTokenInput.value = api.pageAccessToken || '';
    if (editingIdInput) editingIdInput.value = api.id;

    if (submitBtn) {
        submitBtn.innerHTML = `<i class="fa-solid fa-check mr-1"></i> Update Facebook API`;
    }
    if (cancelEditBtn) {
        cancelEditBtn.classList.remove('hidden');
    }

    const formEl = document.getElementById('admin-fb-api-form');
    if (formEl) formEl.scrollIntoView({ behavior: 'smooth' });
}

export async function saveAdminFbApi() {
    if (!hasAdminFbPermission()) {
        return showToast("⚠️ Unauthorized: Admin access required.");
    }

    const nameInput = document.getElementById('admin-fb-api-name');
    const linkInput = document.getElementById('admin-fb-api-link');
    const pageIdInput = document.getElementById('admin-fb-api-pageid');
    const tokenInput = document.getElementById('admin-fb-api-token');
    const accessTokenInput = document.getElementById('admin-fb-api-accesstoken');
    const editingIdInput = document.getElementById('admin-fb-api-editing-id');

    const name = (nameInput?.value || '').trim();
    const link = (linkInput?.value || '').trim();
    const pageId = (pageIdInput?.value || '').trim();
    const token = (tokenInput?.value || '').trim();
    const accessToken = (accessTokenInput?.value || '').trim();
    const editingId = (editingIdInput?.value || '').trim();

    if (!name) {
        return showToast("⚠️ Please enter a Dedicated Name for this Facebook API.");
    }

    if (!link) {
        return showToast("⚠️ Please provide an API Link or Webhook URL.");
    }

    const apiId = editingId || `fb_api_${Date.now()}`;
    const now = Date.now();

    let sendEndpoint = null;
    if (link) {
        try {
            sendEndpoint = link.replace(/\/webhook\/?$/, '') + '/api/send-reply';
        } catch(e) {}
    }

    const publicPayload = {
        id: apiId,
        name: name,
        sendEndpoint: sendEndpoint,
        isActive: true,
        createdAt: now
    };

    const privatePayload = {
        id: apiId,
        name: name,
        apiLink: link,
        pageId: pageId || null,
        verifyToken: token || null,
        pageAccessToken: accessToken || null,
        isActive: true,
        updatedAt: now,
        createdBy: appState.riderName || (typeof localStorage !== 'undefined' ? localStorage.getItem('riderName') : null) || 'Admin'
    };

    const submitBtn = document.getElementById('admin-fb-api-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving...`;
    }

    try {
        if (!db) {
            throw new Error("Database connection not ready. Please refresh the page.");
        }

        // Direct scoped writes to public and secured paths
        await Promise.all([
            db.ref(`facebookChannels/${apiId}`).set(publicPayload),
            db.ref(`adminSettings/facebookApis/${apiId}`).set(privatePayload)
        ]);

        showToast(`✅ Facebook API "${name}" saved successfully!`);
        resetAdminFbApiForm();

        // Immediately update local caches and re-render UI
        cachedPublicChannelsMap.set(apiId, publicPayload);
        cachedAdminApisMap.set(apiId, privatePayload);
        renderAdminFbApisList();
        renderRiderSourcesUI();
    } catch(err) {
        console.error("Save FB API error:", err);
        showToast(`❌ Failed to save: ${err.message || 'Check database permissions'}`);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="fa-solid fa-plus mr-1"></i> Save & Connect API`;
        }
    }
}

export function deleteAdminFbApi(apiId, apiName) {
    if (!hasAdminFbPermission()) {
        return showToast("⚠️ Unauthorized: Admin access required.");
    }

    openSlideDeleteModal(
        `Delete Facebook API?`,
        `Sigurado ka bang nais mong tanggalin ang "${apiName || 'FB API'}"?\nHindi na makakatanggap ng messages ang mga rider mula sa channel na ito.`,
        async () => {
            try {
                await Promise.all([
                    db.ref(`facebookChannels/${apiId}`).remove(),
                    db.ref(`adminSettings/facebookApis/${apiId}`).remove()
                ]);

                cachedPublicChannelsMap.delete(apiId);
                cachedAdminApisMap.delete(apiId);

                if (activeRiderSources.has(apiId)) {
                    activeRiderSources.delete(apiId);
                    if (activeRiderSources.size === 0) {
                        activeRiderSources = new Set(['all']);
                    }
                    saveAndSyncRiderSources();
                } else {
                    renderAdminFbApisList();
                    renderRiderSourcesUI();
                }

                showToast(`🗑️ Facebook API "${apiName}" removed.`);
            } catch(e) {
                console.error("Delete FB API error:", e);
                showToast(`❌ Failed to delete: ${e.message || 'Error'}`);
            }
        }
    );
}

export async function toggleAdminFbApiStatus(apiId, currentActive) {
    if (!hasAdminFbPermission()) return;
    const newActive = !currentActive;

    try {
        await Promise.all([
            db.ref(`facebookChannels/${apiId}/isActive`).set(newActive),
            db.ref(`adminSettings/facebookApis/${apiId}/isActive`).set(newActive)
        ]);

        const adminItem = cachedAdminApisMap.get(apiId);
        if (adminItem) adminItem.isActive = newActive;
        const pubItem = cachedPublicChannelsMap.get(apiId);
        if (pubItem) pubItem.isActive = newActive;

        renderAdminFbApisList();
        renderRiderSourcesUI();

        showToast(`Status updated: ${newActive ? 'Active' : 'Paused'}`);
    } catch(e) {
        showToast(`❌ Failed to update status: ${e.message || 'Error'}`);
    }
}

// In-memory cache & in-flight requests for resolved Facebook customer names
const fbNameResolutionCache = new Map();
const inFlightFbResolutions = new Map();
let autoResolveDebounceTimer = null;

export function getResolvedFbName(custId) {
    if (!custId) return null;
    const psid = String(custId).replace(/^fb_/, '').trim();
    return fbNameResolutionCache.get(psid) || null;
}

/**
 * Resolves the real customer name and avatar from Facebook Graph API.
 * Uses targeted Page Conversations API (`user_id=${psid}`) which works for all public
 * Facebook Messenger customers without requiring User Profile Advanced Access permissions.
 */
export async function resolveFacebookCustomerName(custId, force = false) {
    if (!custId) return null;
    const cleanId = String(custId).trim();
    const psid = cleanId.replace(/^fb_/, '').trim();
    if (!psid) return null;

    if (!force && fbNameResolutionCache.has(psid)) {
        return fbNameResolutionCache.get(psid);
    }
    if (inFlightFbResolutions.has(psid)) {
        return inFlightFbResolutions.get(psid);
    }

    const resolutionPromise = (async () => {
        try {
            // 1. Retrieve configured Facebook APIs with Page Access Token
            let apiList = Array.from(cachedAdminApisMap.values()).filter(a => a && a.pageAccessToken);
            if (apiList.length === 0 && db) {
                const apiSnap = await db.ref('adminSettings/facebookApis').once('value');
                const apis = apiSnap.val() || {};
                apiList = Object.values(apis).filter(a => a && a.pageAccessToken);
            }

            if (apiList.length === 0) {
                return null;
            }

            for (const api of apiList) {
                const pageId = api.pageId || "1098954353295816";
                const token = (api.pageAccessToken || '').trim();
                if (!token) continue;

                // Method A: Targeted Page Conversations API by user_id
                try {
                    const convResp = await fetch(
                        `https://graph.facebook.com/v19.0/${pageId}/conversations?user_id=${psid}&fields=participants,senders&access_token=${token}`
                    );
                    if (convResp.ok) {
                        const convData = await convResp.json();
                        if (Array.isArray(convData.data) && convData.data.length > 0) {
                            const people = [
                                ...(convData.data[0].participants?.data || []),
                                ...(convData.data[0].senders?.data || [])
                            ];
                            const match = people.find(p => String(p.id) === String(psid));
                            if (match && match.name) {
                                const realName = match.name.trim();
                                const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(realName)}&background=0084FF&color=fff`;
                                const resolved = { name: realName, avatarUrl: avatar };
                                fbNameResolutionCache.set(psid, resolved);

                                // Update Firebase in the background
                                if (db) {
                                    await Promise.all([
                                        db.ref(`customerChatMeta/${cleanId}`).update({
                                            customerName: realName,
                                            avatarUrl: avatar
                                        }),
                                        db.ref(`customerChats/${cleanId}/metadata`).update({
                                            customerName: realName,
                                            avatarUrl: avatar
                                        })
                                    ]).catch(() => {});
                                }
                                return resolved;
                            }
                        }
                    }
                } catch (errConv) {
                    console.warn(`[FB Resolver] Conversations lookup error for PSID ${psid}:`, errConv);
                }

                // Method B: Direct PSID Node API (Fallback for app testers / admins with profile picture)
                try {
                    const profileResp = await fetch(
                        `https://graph.facebook.com/v19.0/${psid}?fields=first_name,last_name,name,profile_pic&access_token=${token}`
                    );
                    if (profileResp.ok) {
                        const profile = await profileResp.json();
                        const fullName = (profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`).trim();
                        if (fullName) {
                            const avatar = profile.profile_pic || `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=0084FF&color=fff`;
                            const resolved = { name: fullName, avatarUrl: avatar };
                            fbNameResolutionCache.set(psid, resolved);

                            if (db) {
                                await Promise.all([
                                    db.ref(`customerChatMeta/${cleanId}`).update({
                                        customerName: fullName,
                                        avatarUrl: avatar
                                    }),
                                    db.ref(`customerChats/${cleanId}/metadata`).update({
                                        customerName: fullName,
                                        avatarUrl: avatar
                                    })
                                ]).catch(() => {});
                            }
                            return resolved;
                        }
                    }
                } catch (errProfile) {
                    console.warn(`[FB Resolver] Profile lookup error for PSID ${psid}:`, errProfile);
                }
            }
        } catch (e) {
            console.error(`[FB Resolver] Failed resolving customer ${cleanId}:`, e);
        } finally {
            inFlightFbResolutions.delete(psid);
        }
        return null;
    })();

    inFlightFbResolutions.set(psid, resolutionPromise);
    return resolutionPromise;
}

/**
 * Automatically inspects the current list of threads and auto-resolves any
 * Facebook threads that are missing real customer names in the background.
 */
export function autoResolvePendingFacebookThreads(threadsList) {
    if (!Array.isArray(threadsList) || threadsList.length === 0) return;

    if (autoResolveDebounceTimer) {
        clearTimeout(autoResolveDebounceTimer);
    }

    autoResolveDebounceTimer = setTimeout(async () => {
        const pending = threadsList.filter(t => {
            if (!t) return false;
            const cid = t.custId || t.id || '';
            if (!cid.startsWith('fb_')) return false;
            const name = (t.customerName || t.name || '').trim();
            return !name || name.startsWith('FB Customer (') || name.toLowerCase() === 'customer';
        });

        if (pending.length === 0) return;

        for (const t of pending) {
            const cid = t.custId || t.id;
            try {
                await resolveFacebookCustomerName(cid);
            } catch (e) {}
        }
    }, 1200);
}

export async function syncAllFacebookCustomerNames() {
    if (!db) return;
    try {
        showToast("🔄 Sinusuri ang mga customer names sa Facebook...");

        const apiSnap = await db.ref('adminSettings/facebookApis').once('value');
        const apis = apiSnap.val() || {};
        const apiList = Object.values(apis).filter(a => a && a.pageAccessToken);
        if (apiList.length === 0) {
            return showToast("⚠️ Walang Facebook API na may Page Access Token.");
        }

        const metaSnap = await db.ref('customerChatMeta').once('value');
        const allMeta = metaSnap.val() || {};

        let updatedCount = 0;

        // 1. Process bulk conversations
        for (const api of apiList) {
            const pageId = api.pageId || "1098954353295816";
            const token = api.pageAccessToken.trim();

            try {
                const convResp = await fetch(
                    `https://graph.facebook.com/v19.0/${pageId}/conversations?fields=participants,senders&limit=100&access_token=${token}`
                );
                if (convResp.ok) {
                    const convData = await convResp.json();
                    if (Array.isArray(convData.data)) {
                        const nameMap = new Map();
                        convData.data.forEach(c => {
                            const people = [
                                ...(c.participants?.data || []),
                                ...(c.senders?.data || [])
                            ];
                            people.forEach(p => {
                                if (p.id && String(p.id) !== String(pageId) && p.name) {
                                    nameMap.set(String(p.id).trim(), p.name.trim());
                                }
                            });
                        });

                        for (const [custId, item] of Object.entries(allMeta)) {
                            if (!custId.startsWith('fb_')) continue;
                            const psid = custId.replace(/^fb_/, '');
                            const currentName = item.customerName || item.metadata?.customerName || '';

                            if (nameMap.has(psid)) {
                                const realName = nameMap.get(psid);
                                if (realName && (realName !== currentName || currentName.startsWith('FB Customer ('))) {
                                    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(realName)}&background=0084FF&color=fff`;
                                    fbNameResolutionCache.set(psid, { name: realName, avatarUrl: avatar });
                                    await Promise.all([
                                        db.ref(`customerChatMeta/${custId}`).update({
                                            customerName: realName,
                                            avatarUrl: avatar
                                        }),
                                        db.ref(`customerChats/${custId}/metadata`).update({
                                            customerName: realName,
                                            avatarUrl: avatar
                                        })
                                    ]).catch(() => {});
                                    item.customerName = realName;
                                    updatedCount++;
                                }
                            }
                        }
                    }
                }
            } catch (bulkErr) {
                console.warn("Bulk conversations sync error:", bulkErr);
            }
        }

        // 2. Direct resolution fallback for any remaining FB Customer entries
        for (const [custId, item] of Object.entries(allMeta)) {
            if (!custId.startsWith('fb_')) continue;
            const currentName = item.customerName || item.metadata?.customerName || '';
            if (!currentName || currentName.startsWith('FB Customer (')) {
                const resolved = await resolveFacebookCustomerName(custId, true);
                if (resolved && resolved.name && resolved.name !== currentName) {
                    updatedCount++;
                }
            }
        }

        if (updatedCount > 0) {
            showToast(`✅ Na-update ang ${updatedCount} Facebook customer name(s)!`);
        } else {
            showToast("ℹ️ Lahat ng Facebook customer names ay up-to-date na.");
        }
    } catch (err) {
        console.error("syncAllFacebookCustomerNames error:", err);
        showToast("⚠️ Bigo mag-sync ng FB names: " + (err.message || err));
    }
}

const inFlightAttachmentResolutions = new Map();

/**
 * Resolves a missing image attachment URL from Meta Graph API for a Facebook message
 */
export async function resolveFacebookMessageAttachment(custId, msgId, rawMid) {
    if (!custId || !msgId) return null;
    const cleanMid = rawMid || msgId;
    const cacheKey = `${custId}_${msgId}`;

    if (inFlightAttachmentResolutions.has(cacheKey)) {
        return inFlightAttachmentResolutions.get(cacheKey);
    }

    const promise = (async () => {
        try {
            let apiList = Array.from(cachedAdminApisMap.values()).filter(a => a && a.pageAccessToken);
            if (apiList.length === 0 && db) {
                const apiSnap = await db.ref('adminSettings/facebookApis').once('value');
                const apis = apiSnap.val() || {};
                apiList = Object.values(apis).filter(a => a && a.pageAccessToken);
            }
            if (apiList.length === 0) return null;

            for (const api of apiList) {
                const token = (api.pageAccessToken || '').trim();
                if (!token) continue;

                const resp = await fetch(`https://graph.facebook.com/v19.0/${cleanMid}?fields=id,message,attachments&access_token=${token}`);
                if (resp.ok) {
                    const data = await resp.json();
                    const att = data?.attachments?.data?.[0];
                    const imgUrl = att?.image_data?.url || att?.payload?.url;
                    if (imgUrl) {
                        if (db) {
                            db.ref(`customerChats/${custId}/messages/${msgId}`).update({
                                imageUrl: imgUrl,
                                type: 'image'
                            }).catch(() => {});
                        }
                        return imgUrl;
                    }
                }
            }
        } catch (e) {
            console.warn(`[FB Attachment] Resolution failed for mid ${cleanMid}:`, e);
        } finally {
            inFlightAttachmentResolutions.delete(cacheKey);
        }
        return null;
    })();

    inFlightAttachmentResolutions.set(cacheKey, promise);
    return promise;
}

if (typeof window !== 'undefined') {
    window.resolveFacebookMessageAttachment = resolveFacebookMessageAttachment;
    window.openAdminFbApiModal = openAdminFbApiModal;
    window.closeAdminFbApiModal = closeAdminFbApiModal;
    window.saveAdminFbApi = saveAdminFbApi;
    window.resetAdminFbApiForm = resetAdminFbApiForm;
    window.editAdminFbApi = editAdminFbApi;
    window.deleteAdminFbApi = deleteAdminFbApi;
    window.toggleAdminFbApiStatus = toggleAdminFbApiStatus;
    window.toggleAdminFbLinkVisibility = toggleAdminFbLinkVisibility;
    window.syncAllFacebookCustomerNames = syncAllFacebookCustomerNames;
    window.resolveFacebookCustomerName = resolveFacebookCustomerName;
    window.autoResolvePendingFacebookThreads = autoResolvePendingFacebookThreads;
    window.getResolvedFbName = getResolvedFbName;
    
    // Multi-source live chat selectors
    window.openRiderChatSourcesModal = openRiderChatSourcesModal;
    window.closeRiderChatSourcesModal = closeRiderChatSourcesModal;
    window.toggleRiderSource = toggleRiderSource;
    window.selectAllRiderSources = selectAllRiderSources;
    window.clearAllRiderSources = clearAllRiderSources;
    window.getActiveRiderSources = getActiveRiderSources;
    window.isSourceSelected = isSourceSelected;
    window.isAllSourcesSelected = isAllSourcesSelected;
    window.hasAnyFbSourceSelected = hasAnyFbSourceSelected;
    window.renderRiderSourcesUI = renderRiderSourcesUI;
    
    // Legacy single channel compatibility
    window.selectRiderFbChannel = selectRiderFbChannel;
    window.renderFbChannelSelector = renderFbChannelSelector;
    window.getActiveRiderFbChannel = getActiveRiderFbChannel;
    window.getPublicFbChannelName = getPublicFbChannelName;
    window.getPublicFbSendEndpoint = getPublicFbSendEndpoint;
    window.listenToPublicFbChannels = listenToPublicFbChannels;
}
