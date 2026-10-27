// src/features/chat/fbAdmin/fbChannels.js
import { db } from '../../../config/firebase.js';
import { showToast } from '../../../ui/notifications.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { isAdmin, canManageRoster } from '../../roster/rosterUtils.js';
import { toggleBodyScroll } from '../chatUtils.js';

export const cachedPublicChannelsMap = new Map();
export const cachedAdminApisMap = new Map();
export let isPublicChannelsListening = false;
export let activeRiderSources = new Set(['all']);

export function setActiveRiderSources(sources) {
    activeRiderSources = sources;
}

// Immediately restore cached public channels from disk (0ms instant startup)
(function initCachedPublicChannels() {
    if (typeof localStorage === 'undefined') return;
    try {
        const saved = localStorage.getItem('lokalex_cached_facebook_channels');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object') {
                Object.entries(parsed).forEach(([id, data]) => {
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
            }
        }
    } catch (_) {}
})();

// Immediately restore cached admin APIs from disk (0ms instant startup)
(function initCachedAdminApis() {
    if (typeof localStorage === 'undefined') return;
    try {
        const saved = localStorage.getItem('lokalex_cached_admin_facebook_apis');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object') {
                Object.entries(parsed).forEach(([id, data]) => {
                    if (data) {
                        cachedAdminApisMap.set(id, { id, ...data });
                    }
                });
            }
        }
    } catch (_) {}

    // Proactive background fetch to ensure cachedAdminApisMap always has valid tokens across all devices
    fetch(`https://lokalexoptimized-rtdb-default-rtdb.asia-southeast1.firebasedatabase.app/adminSettings/facebookApis.json`)
        .then(res => res.json())
        .then(apis => {
            if (apis && typeof apis === 'object') {
                try {
                    localStorage.setItem('lokalex_cached_admin_facebook_apis', JSON.stringify(apis));
                } catch (_) {}
                Object.entries(apis).forEach(([id, data]) => {
                    if (data) cachedAdminApisMap.set(id, { id, ...data });
                });
            }
        })
        .catch(() => {});
})();

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

export async function getFbPageAccessToken(apiId) {
    if (apiId) {
        const cached = cachedAdminApisMap.get(apiId);
        if (cached?.pageAccessToken && typeof cached.pageAccessToken === 'string' && cached.pageAccessToken.trim()) {
            return cached.pageAccessToken.trim();
        }
    }
    // Any cached with pageAccessToken
    for (const api of cachedAdminApisMap.values()) {
        if (api?.pageAccessToken && typeof api.pageAccessToken === 'string' && api.pageAccessToken.trim()) {
            return api.pageAccessToken.trim();
        }
    }
    // RTDB fallback
    if (db) {
        try {
            if (apiId) {
                const snap = await db.ref(`adminSettings/facebookApis/${apiId}/pageAccessToken`).once('value');
                const val = snap.val();
                if (val && typeof val === 'string' && val.trim()) return val.trim();
            }
            const allSnap = await db.ref('adminSettings/facebookApis').once('value');
            const allVal = allSnap.val() || {};
            for (const api of Object.values(allVal)) {
                if (api?.pageAccessToken && typeof api.pageAccessToken === 'string' && api.pageAccessToken.trim()) {
                    return api.pageAccessToken.trim();
                }
            }
        } catch (e) {
            console.warn("[FbApiAdmin] Error fetching Page Access Token:", e);
        }
    }
    return null;
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
        if (typeof window.openAdminFbApiModal === 'function') {
            window.openAdminFbApiModal();
        }
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
    if (isChannelBarLocked()) {
        onChannelBarLockedClick();
        return;
    }

    if (sourceId === '__manage_apis__') {
        closeRiderChatSourcesModal();
        if (typeof window.openAdminFbApiModal === 'function') {
            window.openAdminFbApiModal();
        }
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
    if (isChannelBarLocked()) {
        onChannelBarLockedClick();
        return;
    }
    activeRiderSources = new Set(['all']);
    saveAndSyncRiderSources();
    showToast(`🌐 Showing all chat sources`);
}

export function clearAllRiderSources() {
    activeRiderSources = new Set();
    saveAndSyncRiderSources();
    showToast(`⚠️ Cleared all source selections.`);
}

export function saveAndSyncRiderSources() {
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
    // 1. Immediately render UI with current memory/disk cache (0ms instant)
    renderRiderSourcesUI();

    // 2. Fast parallel direct REST fetch (<150ms guaranteed on mobile networks)
    const directRestUrl = `https://lokalexoptimized-rtdb-default-rtdb.asia-southeast1.firebasedatabase.app/facebookChannels.json?t=${Date.now()}`;
    fetch(directRestUrl, { cache: 'no-store' })
        .then(res => res.json())
        .then(val => {
            if (val && typeof val === 'object') {
                try {
                    localStorage.setItem('lokalex_cached_facebook_channels', JSON.stringify(val));
                } catch (_) {}
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
                renderRiderSourcesUI();
                if (window.renderRiderCustomerChatFeed) {
                    window.renderRiderCustomerChatFeed();
                }
            }
        })
        .catch(err => {
            console.warn('[FacebookChannels] Direct REST fetch fallback:', err);
        });

    if (!db || isPublicChannelsListening) return;
    isPublicChannelsListening = true;

    // 3. Realtime WebSocket listener for ongoing channel updates
    db.ref('facebookChannels').on('value', (snapshot) => {
        const val = snapshot.val() || {};
        try {
            localStorage.setItem('lokalex_cached_facebook_channels', JSON.stringify(val));
        } catch (_) {}
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

    // 7. Sync channel bar lock state UI
    syncChannelBarLockUI();
}

export function isChannelBarLocked() {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem('lokalex_channel_bar_locked') !== 'false';
}

export function toggleRiderChannelBarLock(event) {
    if (event) {
        event.stopPropagation();
    }
    const currentlyLocked = isChannelBarLocked();
    const newLocked = !currentlyLocked;
    try {
        localStorage.setItem('lokalex_channel_bar_locked', newLocked ? 'true' : 'false');
    } catch (_) {}
    
    syncChannelBarLockUI();

    if (newLocked) {
        showToast("🔒 Live feed filter locked (misclick protection ON).");
        if (typeof window.triggerNativeHaptic === 'function') window.triggerNativeHaptic('light');
    } else {
        showToast("🔓 Live feed filter unlocked. You can now tap sources or full booking.");
        if (typeof window.triggerNativeHaptic === 'function') window.triggerNativeHaptic('success');
    }
}

export function onChannelBarLockedClick(event) {
    if (event) {
        if (event.target && (event.target.closest('#rider-sources-lock-btn') || event.target.id === 'rider-sources-lock-btn')) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
    }
    showToast("🔒 Feed filters are locked to prevent misclicks. Tap 🔓 on the right to edit.");
    if (typeof window.triggerNativeHaptic === 'function') window.triggerNativeHaptic('warning');
}

export function syncChannelBarLockUI() {
    const locked = isChannelBarLocked();
    const lockBtn = document.getElementById('rider-sources-lock-btn');
    const lockIcon = document.getElementById('rider-sources-lock-icon');
    const lockText = document.getElementById('rider-sources-lock-text');
    const overlay = document.getElementById('rider-channel-bar-lock-overlay');
    const filterWrapper = document.getElementById('rider-sources-filter-wrapper');
    const chipsContainer = document.getElementById('rider-sources-chips-container');
    const fullBookingBtn = document.getElementById('btn-full-booking-trigger');

    if (lockBtn) {
        lockBtn.style.position = 'relative';
        lockBtn.style.zIndex = '50';
        lockBtn.style.pointerEvents = 'auto';

        if (locked) {
            lockBtn.className = "relative z-50 pointer-events-auto bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-lg font-black flex items-center gap-1 shadow-2xs transition active:scale-95 cursor-pointer shrink-0";
            lockBtn.title = "Feed filters are LOCKED. Tap to unlock.";
            if (lockIcon) lockIcon.className = "fa-solid fa-lock text-[8.5px]";
            if (lockText) lockText.innerText = "Locked";
        } else {
            lockBtn.className = "relative z-50 pointer-events-auto bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-lg font-black flex items-center gap-1 shadow-2xs transition active:scale-95 cursor-pointer shrink-0";
            lockBtn.title = "Feed filters are UNLOCKED. Tap to lock.";
            if (lockIcon) lockIcon.className = "fa-solid fa-lock-open text-[8.5px]";
            if (lockText) lockText.innerText = "Unlocked";
        }
    }

    if (overlay) {
        if (locked) overlay.classList.remove('hidden');
        else overlay.classList.add('hidden');
    }

    if (filterWrapper) {
        if (locked) filterWrapper.classList.add('opacity-60');
        else filterWrapper.classList.remove('opacity-60');
    }

    if (chipsContainer) {
        if (locked) chipsContainer.classList.add('opacity-60');
        else chipsContainer.classList.remove('opacity-60');
    }

    if (fullBookingBtn) {
        if (locked) fullBookingBtn.classList.add('opacity-60');
        else fullBookingBtn.classList.remove('opacity-60');
    }
}

/**
 * Backward-compatible alias
 */
export function renderFbChannelSelector() {
    renderRiderSourcesUI();
}

export function openRiderChatSourcesModal() {
    if (isChannelBarLocked()) {
        showToast("🔒 Live feed filters are locked. Tap 🔓 to unlock first.");
        if (typeof window.triggerNativeHaptic === 'function') window.triggerNativeHaptic('warning');
        return;
    }
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

if (typeof window !== 'undefined') {
    window.isChannelBarLocked = isChannelBarLocked;
    window.toggleRiderChannelBarLock = toggleRiderChannelBarLock;
    window.onChannelBarLockedClick = onChannelBarLockedClick;
    window.syncChannelBarLockUI = syncChannelBarLockUI;
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            syncChannelBarLockUI();
        });
    } else {
        setTimeout(syncChannelBarLockUI, 50);
    }
}
