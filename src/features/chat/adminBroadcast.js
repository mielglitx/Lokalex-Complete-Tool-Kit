// src/features/chat/adminBroadcast.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';
import { isAdmin, canManageRoster, hasTlPermission } from '../roster/rosterUtils.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { forwardRiderReplyToMessenger } from './riderChat.js';

let broadcastMode = 'choice'; // 'choice' | 'all' | 'group'
let broadcastGroup = 'inbox'; // 'inbox' | 'catering' | 'done' | 'messenger' | 'web'
let broadcastSelectedCustIds = new Set();
let broadcastSearchQuery = '';
let isBroadcastSending = false;

const BROADCAST_TEMPLATES = {
    volume: "Good day from Lokalex! We are currently experiencing a high volume of orders and deliveries. Your inquiry or order is being processed. Thank you very much for your patience and support! 🙏🛵",
    available: "Good day! Lokalex Delivery riders are online and available today for your errands, grocery, and food delivery. Just send us a message here. Thank you very much!",
    holiday: "Good day! We would like to inform you of our operating hours and delivery updates for today. Stay safe and have a great day!",
    delivery: "Reminder from Lokalex Rider: Our delivery rider is on the way. Please prepare your payment and ensure your phone line is open. Thank you very much! 🛵✨"
};

function checkAdminAuth() {
    return (typeof isAdmin === 'function' && isAdmin()) ||
           (typeof canManageRoster === 'function' && canManageRoster()) ||
           (typeof window.isAdmin === 'function' && window.isAdmin()) ||
           (typeof hasTlPermission === 'function' && hasTlPermission('canManageBroadcast')) ||
           Boolean(globalState.adminControlsEnabled);
}

/**
 * Gather all customer threads known to the client.
 */
function getAllCustomerThreadsList() {
    const list = [];
    if (typeof window.getCachedCustomerThreadsMap === 'function') {
        const map = window.getCachedCustomerThreadsMap();
        if (map && map.size > 0) {
            for (const t of map.values()) {
                list.push(t);
            }
        }
    }
    return list;
}

/**
 * Filter threads based on group selection.
 */
function getThreadsForGroup(groupName) {
    const all = getAllCustomerThreadsList();
    return all.filter(t => {
        const folder = (t.folder || 'inbox').toLowerCase();
        const status = (t.status || '').toLowerCase();
        const channel = (t.channel || (t.custId?.startsWith('fb_') ? 'messenger' : 'web')).toLowerCase();

        switch (groupName) {
            case 'inbox':
                return folder === 'inbox' && status !== 'completed' && status !== 'done' && status !== 'cancelled' && !t.cateredByRiderId && !t.cateredByRiderName;
            case 'catering':
                return folder === 'catering' || Boolean(t.cateredByRiderId || t.cateredByRiderName);
            case 'done':
                return folder === 'done' || status === 'completed' || status === 'done';
            case 'messenger':
                return channel === 'messenger' || String(t.custId).startsWith('fb_');
            case 'web':
                return channel === 'web' && !String(t.custId).startsWith('fb_');
            default:
                return true;
        }
    });
}

/**
 * Open the Broadcast (Send to Many) modal.
 */
export function openBroadcastModal() {
    if (!checkAdminAuth()) {
        showToast("⚠️ Admin access required to use Broadcast / Send to Many.");
        return;
    }

    const modal = document.getElementById('admin-broadcast-modal');
    if (!modal) {
        console.warn("Broadcast modal element not found in DOM");
        return;
    }

    broadcastMode = 'choice';
    broadcastGroup = 'inbox';
    broadcastSelectedCustIds.clear();
    broadcastSearchQuery = '';
    isBroadcastSending = false;

    // Reset inputs
    const msgInput = document.getElementById('broadcast-message-input');
    if (msgInput) msgInput.value = '';
    const searchInput = document.getElementById('broadcast-customer-search');
    if (searchInput) searchInput.value = '';

    const progressBox = document.getElementById('broadcast-progress-container');
    if (progressBox) progressBox.classList.add('hidden');
    const sendBtn = document.getElementById('broadcast-send-btn');
    if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.classList.remove('opacity-50', 'pointer-events-none');
    }

    modal.classList.remove('hidden');
    renderBroadcastUI();
}

/**
 * Close the Broadcast modal.
 */
export function closeBroadcastModal() {
    if (isBroadcastSending) {
        showToast("⚠️ Please wait for broadcast sending to finish...");
        return;
    }
    const modal = document.getElementById('admin-broadcast-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Switch broadcast mode: 'choice' | 'all' | 'group'
 */
export function setBroadcastMode(mode) {
    broadcastMode = mode;
    renderBroadcastUI();
}

/**
 * Set target group when in 'group' mode.
 */
export function setBroadcastGroup(group) {
    broadcastGroup = group;
    renderBroadcastUI();
}

/**
 * Filter customer list in 'choice' mode.
 */
export function handleBroadcastCustomerSearch(val) {
    broadcastSearchQuery = (val || '').trim().toLowerCase();
    renderBroadcastUI();
}

/**
 * Toggle individual customer checkbox in 'choice' mode.
 */
export function toggleBroadcastCustomer(custId) {
    if (broadcastSelectedCustIds.has(custId)) {
        broadcastSelectedCustIds.delete(custId);
    } else {
        broadcastSelectedCustIds.add(custId);
    }
    updateBroadcastCounts();
}

/**
 * Select all currently visible customers.
 */
export function broadcastSelectAllVisible() {
    const list = getFilteredChoiceCustomers();
    list.forEach(c => broadcastSelectedCustIds.add(c.custId));
    renderBroadcastUI();
}

/**
 * Deselect all customers.
 */
export function broadcastDeselectAll() {
    broadcastSelectedCustIds.clear();
    renderBroadcastUI();
}

/**
 * Apply a predefined message template.
 */
export function applyBroadcastTemplate(key) {
    const text = BROADCAST_TEMPLATES[key];
    if (!text) return;
    const msgInput = document.getElementById('broadcast-message-input');
    if (msgInput) {
        msgInput.value = text;
        updateBroadcastCharCount();
    }
}

/**
 * Update character count indicator.
 */
export function updateBroadcastCharCount() {
    const msgInput = document.getElementById('broadcast-message-input');
    const counter = document.getElementById('broadcast-char-counter');
    if (msgInput && counter) {
        counter.textContent = `${msgInput.value.length} / 1000`;
    }
    updateBroadcastCounts();
}

function getFilteredChoiceCustomers() {
    const all = getAllCustomerThreadsList();
    if (!broadcastSearchQuery) return all;
    return all.filter(t => {
        const name = (t.customerName || t.name || '').toLowerCase();
        const id = (t.custId || '').toLowerCase();
        const lastMsg = (t.lastMessage || '').toLowerCase();
        return name.includes(broadcastSearchQuery) || id.includes(broadcastSearchQuery) || lastMsg.includes(broadcastSearchQuery);
    });
}

/**
 * Calculate target recipient list based on current mode and selections.
 */
function getResolvedRecipients() {
    const all = getAllCustomerThreadsList();
    if (broadcastMode === 'all') {
        return all;
    }
    if (broadcastMode === 'group') {
        return getThreadsForGroup(broadcastGroup);
    }
    // choice
    return all.filter(t => broadcastSelectedCustIds.has(t.custId));
}

function updateBroadcastCounts() {
    const recipients = getResolvedRecipients();
    const countBadge = document.getElementById('broadcast-target-count-badge');
    if (countBadge) {
        countBadge.textContent = `${recipients.length} Recipient(s)`;
    }
    const sendBtnText = document.getElementById('broadcast-send-btn-text');
    if (sendBtnText) {
        sendBtnText.textContent = `Send to ${recipients.length} Recipient(s)`;
    }
}

/**
 * Main UI render coordinator for broadcast modal.
 */
export function renderBroadcastUI() {
    // 1. Update Mode Tabs
    const tabChoice = document.getElementById('broadcast-tab-choice');
    const tabAll = document.getElementById('broadcast-tab-all');
    const tabGroup = document.getElementById('broadcast-tab-group');

    const activeTabClass = "bg-blue-600 text-white shadow-xs font-bold";
    const inactiveTabClass = "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium";

    if (tabChoice) tabChoice.className = `flex-1 py-1.5 rounded-lg text-xs transition cursor-pointer flex items-center justify-center gap-1.5 ${broadcastMode === 'choice' ? activeTabClass : inactiveTabClass}`;
    if (tabAll) tabAll.className = `flex-1 py-1.5 rounded-lg text-xs transition cursor-pointer flex items-center justify-center gap-1.5 ${broadcastMode === 'all' ? activeTabClass : inactiveTabClass}`;
    if (tabGroup) tabGroup.className = `flex-1 py-1.5 rounded-lg text-xs transition cursor-pointer flex items-center justify-center gap-1.5 ${broadcastMode === 'group' ? activeTabClass : inactiveTabClass}`;

    // 2. Toggle Mode Containers
    const containerChoice = document.getElementById('broadcast-container-choice');
    const containerAll = document.getElementById('broadcast-container-all');
    const containerGroup = document.getElementById('broadcast-container-group');

    if (containerChoice) containerChoice.classList.toggle('hidden', broadcastMode !== 'choice');
    if (containerAll) containerAll.classList.toggle('hidden', broadcastMode !== 'all');
    if (containerGroup) containerGroup.classList.toggle('hidden', broadcastMode !== 'group');

    // 3. Render Choice List
    if (broadcastMode === 'choice') {
        renderChoiceCustomersList();
    } else if (broadcastMode === 'all') {
        renderAllModeSummary();
    } else if (broadcastMode === 'group') {
        renderGroupModeCards();
    }

    updateBroadcastCounts();
}

function renderChoiceCustomersList() {
    const listContainer = document.getElementById('broadcast-customers-list');
    if (!listContainer) return;

    const customers = getFilteredChoiceCustomers();

    if (customers.length === 0) {
        listContainer.innerHTML = `<div class="text-center text-gray-400 dark:text-gray-500 italic py-6 text-xs">No customers match your search.</div>`;
        return;
    }

    listContainer.innerHTML = customers.map(c => {
        const isChecked = broadcastSelectedCustIds.has(c.custId);
        const name = escapeHtml(c.customerName || "Customer");
        const channel = (c.channel || (c.custId?.startsWith('fb_') ? 'messenger' : 'web')).toLowerCase();
        const isFb = channel === 'messenger' || c.custId?.startsWith('fb_');
        const folder = (c.folder || 'inbox').toLowerCase();

        const channelBadge = isFb 
            ? `<span class="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700/50 text-[9px] font-black px-1.5 py-0.2 rounded-full flex items-center gap-0.5"><i class="fa-brands fa-facebook-messenger text-[8px]"></i> FB</span>`
            : `<span class="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/50 text-[9px] font-black px-1.5 py-0.2 rounded-full flex items-center gap-0.5"><i class="fa-solid fa-globe text-[8px]"></i> Web</span>`;

        const folderBadge = `<span class="text-[9px] text-gray-500 dark:text-gray-400 capitalize">${folder}</span>`;

        return `
        <label class="flex items-center gap-2.5 p-2 rounded-xl border ${isChecked ? 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-400 dark:border-blue-500' : 'bg-white dark:bg-black/30 border-gray-200 dark:border-gray-800 hover:border-gray-300'} transition cursor-pointer select-none">
            <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="window.toggleBroadcastCustomer && window.toggleBroadcastCustomer('${escapeHtml(c.custId)}')" class="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer">
            <img src="${escapeHtml(c.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3B82F6&color=fff`)}" class="w-7 h-7 rounded-full object-cover shrink-0 border border-gray-200 dark:border-gray-700">
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                    <span class="text-xs font-bold text-gray-900 dark:text-white truncate">${name}</span>
                    ${channelBadge}
                </div>
                <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-[10px] text-gray-400 dark:text-gray-500 truncate">${escapeHtml(c.lastMessage || 'No chat history')}</span>
                    ${folderBadge}
                </div>
            </div>
        </label>`;
    }).join('');
}

function renderAllModeSummary() {
    const all = getAllCustomerThreadsList();
    const fbCount = all.filter(t => t.channel === 'messenger' || String(t.custId).startsWith('fb_')).length;
    const webCount = all.length - fbCount;

    const summaryEl = document.getElementById('broadcast-all-summary');
    if (summaryEl) {
        summaryEl.innerHTML = `
        <div class="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800/60">
            <div class="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-lg shrink-0 shadow-sm">
                <i class="fa-solid fa-users"></i>
            </div>
            <div class="min-w-0 flex-1">
                <h4 class="text-xs font-black text-gray-900 dark:text-white">Broadcast to All Active Customer Threads</h4>
                <p class="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5">
                    Total: <strong class="text-blue-600 dark:text-blue-400">${all.length} customers</strong> 
                    (${fbCount} Facebook Messenger, ${webCount} Web App).
                </p>
            </div>
        </div>`;
    }
}

function renderGroupModeCards() {
    const groups = [
        { id: 'inbox', label: 'Inbox Waiting', icon: 'fa-inbox', color: 'text-blue-500' },
        { id: 'catering', label: 'Catering / In-Delivery', icon: 'fa-motorcycle', color: 'text-amber-500' },
        { id: 'done', label: 'Done / Delivered', icon: 'fa-circle-check', color: 'text-emerald-500' },
        { id: 'messenger', label: 'Facebook Messenger', icon: 'fa-facebook-messenger', isBrand: true, color: 'text-blue-600' },
        { id: 'web', label: 'Web Customers', icon: 'fa-globe', color: 'text-purple-500' }
    ];

    const cardsContainer = document.getElementById('broadcast-group-cards');
    if (!cardsContainer) return;

    cardsContainer.innerHTML = groups.map(g => {
        const count = getThreadsForGroup(g.id).length;
        const isSelected = broadcastGroup === g.id;
        const iconPrefix = g.isBrand ? 'fa-brands' : 'fa-solid';

        return `
        <div onclick="window.setBroadcastGroup && window.setBroadcastGroup('${g.id}')" class="p-2.5 rounded-xl border flex items-center justify-between transition cursor-pointer select-none ${isSelected ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500 shadow-xs ring-1 ring-indigo-500' : 'bg-white dark:bg-black/30 border-gray-200 dark:border-gray-800 hover:border-gray-300'}">
            <div class="flex items-center gap-2.5 min-w-0">
                <i class="${iconPrefix} ${g.icon} ${g.color} text-sm shrink-0"></i>
                <div class="flex flex-col min-w-0">
                    <span class="text-xs font-bold text-gray-900 dark:text-white truncate">${g.label}</span>
                    <span class="text-[10px] text-gray-500 dark:text-gray-400">${count} customer(s)</span>
                </div>
            </div>
            <div class="w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 dark:border-gray-600'}">
                ${isSelected ? '<i class="fa-solid fa-check text-[9px]"></i>' : ''}
            </div>
        </div>`;
    }).join('');
}

/**
 * Execute Broadcast Send loop across all resolved recipients.
 */
export async function executeBroadcastSend() {
    if (!checkAdminAuth()) {
        showToast("⚠️ Admin access required to send broadcast.");
        return;
    }
    if (isBroadcastSending) return;

    const recipients = getResolvedRecipients();
    if (recipients.length === 0) {
        showToast("⚠️ Please select at least one customer or group to broadcast to.");
        return;
    }

    const msgInput = document.getElementById('broadcast-message-input');
    let messageText = (msgInput ? msgInput.value.trim() : "");
    if (!messageText) {
        showToast("⚠️ Please enter the message you want to broadcast.");
        return;
    }

    // Optional admin signature
    const signatureCheck = document.getElementById('broadcast-include-sig-check');
    const myName = (appState.riderName || localStorage.getItem('riderName') || "Admin").trim();
    if (signatureCheck && signatureCheck.checked) {
        messageText += `\n\n— Lokalex Dispatch (${myName})`;
    }

    openSlideDeleteModal(
        `Send Broadcast to ${recipients.length} Recipient(s)?`,
        `The message will be sent to ${recipients.length} customer(s).\nAre you sure?`,
        async () => {
            isBroadcastSending = true;
            const progressContainer = document.getElementById('broadcast-progress-container');
            const progressBar = document.getElementById('broadcast-progress-bar');
            const progressText = document.getElementById('broadcast-progress-text');
            const sendBtn = document.getElementById('broadcast-send-btn');

            if (progressContainer) progressContainer.classList.remove('hidden');
            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.classList.add('opacity-50', 'pointer-events-none');
            }

            let successCount = 0;
            let failedCount = 0;
            const total = recipients.length;

            for (let i = 0; i < total; i++) {
                const target = recipients[i];
                const custId = target.custId;
                const custName = target.customerName || "Customer";
                const channel = (target.channel || (custId?.startsWith('fb_') ? 'messenger' : 'web')).toLowerCase();
                const apiId = target.apiId || target.channelId || null;

                const percent = Math.round(((i + 1) / total) * 100);
                if (progressBar) progressBar.style.width = `${percent}%`;
                if (progressText) progressText.textContent = `Sending (${i + 1}/${total}): ${custName}...`;

                try {
                    const now = Date.now();
                    const newMsg = {
                        sender: myName || "Lokalex Admin",
                        senderType: 'admin',
                        senderAvatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(myName || 'Admin')}&background=3B82F6&color=fff`,
                        text: messageText,
                        timestamp: now,
                        isRider: true,
                        status: 'sent',
                        channel: channel,
                        apiId: apiId,
                        isBroadcast: true,
                        deliveredAt: null,
                        seenAt: null
                    };

                    if (db && custId) {
                        await db.ref(`customerChats/${custId}/messages`).push(newMsg);
                        const metaUpdate = {
                            lastMessage: `You: ${messageText}`,
                            lastUpdated: now,
                            unreadForRider: false
                        };
                        await Promise.all([
                            db.ref(`customerChats/${custId}/metadata`).update(metaUpdate),
                            db.ref(`customerChatMeta/${custId}`).update(metaUpdate)
                        ]).catch(() => {});
                    }

                    // Forward to Facebook Messenger if applicable
                    if (channel === 'messenger' || String(custId).startsWith('fb_')) {
                        await forwardRiderReplyToMessenger({
                            custId: custId,
                            apiId: apiId,
                            text: messageText,
                            riderName: myName || "Lokalex Admin"
                        }).catch(e => console.warn(`Broadcast forward FB error for ${custId}:`, e));
                    }

                    successCount++;
                } catch (sendErr) {
                    console.error(`Failed broadcast message to ${custId}:`, sendErr);
                    failedCount++;
                }

                // Stagger by 60ms to avoid overwhelming network or Meta Graph API
                await new Promise(r => setTimeout(r, 60));
            }

            isBroadcastSending = false;
            showToast(`✅ Broadcast sent! Success: ${successCount}${failedCount > 0 ? `, Failed: ${failedCount}` : ''}`);

            // Re-render feed so the new messages show up in the feed immediately
            if (typeof window.renderRiderCustomerChatFeed === 'function') {
                window.renderRiderCustomerChatFeed();
            }

            closeBroadcastModal();
        }
    );
}

if (typeof window !== 'undefined') {
    window.openBroadcastModal = openBroadcastModal;
    window.closeBroadcastModal = closeBroadcastModal;
    window.setBroadcastMode = setBroadcastMode;
    window.setBroadcastGroup = setBroadcastGroup;
    window.handleBroadcastCustomerSearch = handleBroadcastCustomerSearch;
    window.toggleBroadcastCustomer = toggleBroadcastCustomer;
    window.broadcastSelectAllVisible = broadcastSelectAllVisible;
    window.broadcastDeselectAll = broadcastDeselectAll;
    window.applyBroadcastTemplate = applyBroadcastTemplate;
    window.updateBroadcastCharCount = updateBroadcastCharCount;
    window.executeBroadcastSend = executeBroadcastSend;
}

