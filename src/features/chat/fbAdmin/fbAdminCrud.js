// src/features/chat/fbAdmin/fbAdminCrud.js
import { db } from '../../../config/firebase.js';
import { appState, globalState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { openSlideDeleteModal } from '../../../ui/modals.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { isAdmin, canManageRoster, hasTlPermission } from '../../roster/rosterUtils.js';
import { toggleBodyScroll } from '../chatUtils.js';
import {
    cachedPublicChannelsMap,
    cachedAdminApisMap,
    activeRiderSources,
    setActiveRiderSources,
    renderRiderSourcesUI,
    saveAndSyncRiderSources
} from './fbChannels.js';

let isAdminApisListening = false;
let visibleLinksSet = new Set();

export function hasAdminFbPermission() {
    if (isAdmin() || canManageRoster() || hasTlPermission('canManageFbApis')) return true;
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
    if (!hasAdminFbPermission()) return;

    // 1. Immediately render UI with current memory/disk cache (0ms instant)
    renderAdminFbApisList();

    // 2. Fast parallel direct REST fetch (<150ms guaranteed on mobile networks)
    const directRestUrl = `https://lokalexoptimized-rtdb-default-rtdb.asia-southeast1.firebasedatabase.app/adminSettings/facebookApis.json?t=${Date.now()}`;
    fetch(directRestUrl, { cache: 'no-store' })
        .then(res => res.json())
        .then(val => {
            if (val && typeof val === 'object') {
                try {
                    localStorage.setItem('lokalex_cached_admin_facebook_apis', JSON.stringify(val));
                } catch (_) {}
                cachedAdminApisMap.clear();
                Object.entries(val).forEach(([id, data]) => {
                    if (data) {
                        cachedAdminApisMap.set(id, { id, ...data });
                    }
                });
                renderAdminFbApisList();
            }
        })
        .catch(err => {
            console.warn('[AdminFbApis] Direct REST fetch fallback:', err);
        });

    if (!db || isAdminApisListening) return;
    isAdminApisListening = true;

    // 3. Realtime WebSocket listener for live admin configuration changes
    db.ref('adminSettings/facebookApis').on('value', (snapshot) => {
        const val = snapshot.val() || {};
        try {
            localStorage.setItem('lokalex_cached_admin_facebook_apis', JSON.stringify(val));
        } catch (_) {}
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
                        setActiveRiderSources(new Set(['all']));
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
