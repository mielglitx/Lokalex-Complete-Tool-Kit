// src/features/chat/riderChat.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { escapeHtml } from '../../utils/helpers.js';
import { toggleBodyScroll } from './chatUtils.js';
import { openMapPicker } from '../maps.js';
import { showToast } from '../../ui/notifications.js';
import { uploadImage } from '../../utils/imageUpload.js';
import { highlightActiveMilestoneUI } from './riderThreadActions.js';
import { 
    showRiderInChatToast, 
    hideRiderInChatToast, 
    showRiderTopSpinner, 
    hideRiderTopSpinner, 
    renderRiderMessages 
} from './riderChatRender.js';
import { 
    setRiderChatFilter, 
    listenToAllCustomerChatsForRider, 
    getActiveRiderChatFilter 
} from './riderChatFeed.js';
import { listenToGlobalStoreChats } from './riderStoreChat.js';
import { 
    getPublicFbSendEndpoint,
    resolveFacebookCustomerName,
    getResolvedFbName,
    resolveFacebookMessageAttachment
} from './facebookApiAdmin.js';

let activeRiderChatCustId = null;
let activeRiderChatListener = null;
let activeRiderChatMetaListener = null;
let currentRiderChatMeta = null;
let activeCustData = null;

let activeRiderReplyTarget = null;
const RIDER_CHAT_BATCH_SIZE = 25;
let oldestRiderMsgTimestamp = null;
let hasMoreRiderMsgs = true;
let isLoadingRiderHistory = false;
let loadedRiderMsgsMap = new Map();

function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

function cleanFirebasePathKey(key) {
    return String(key || '').replace(/^#+/, '').replace(/[.#$\[\]\/]/g, '_').trim();
}

export function getActiveRiderChatCustId() { return activeRiderChatCustId; }
export function getCurrentRiderChatMeta() { return currentRiderChatMeta; }
export function getActiveCustData() { return activeCustData; }
export function setActiveCustData(data) { activeCustData = data; }

export function openRiderChatModal(custId, custName) {
    openRiderCustomerChatModal(custId, custName);
}

export function openRiderCustomerChatModal(custId, custName, avatarUrl) {
    activeRiderChatCustId = custId;

    if (db && custId) {
        db.ref(`customerChats/${custId}/metadata`).update({
            unreadForRider: false
        }).catch(() => {});
    }

    const modal = document.getElementById('rider-chat-modal') || document.getElementById('rider-customer-chat-modal');
    const nameEl = document.getElementById('rider-chat-cust-name');
    const avatarEl = document.getElementById('rider-chat-avatar') || document.getElementById('rider-chat-cust-avatar');

    let effectiveName = custName || "Customer";
    let effectiveAvatar = avatarUrl;

    if (custId && custId.startsWith('fb_')) {
        const cached = (typeof getResolvedFbName === 'function') ? getResolvedFbName(custId) : null;
        if (cached && cached.name && (!effectiveName || effectiveName.startsWith('FB Customer ('))) {
            effectiveName = cached.name;
            effectiveAvatar = cached.avatarUrl || effectiveAvatar;
        } else if (!effectiveName || effectiveName.startsWith('FB Customer (')) {
            if (typeof resolveFacebookCustomerName === 'function') {
                resolveFacebookCustomerName(custId).then(resolved => {
                    if (resolved && resolved.name && activeRiderChatCustId === custId) {
                        if (nameEl) nameEl.innerText = resolved.name;
                        if (avatarEl) {
                            if (avatarEl.tagName === 'IMG' && resolved.avatarUrl) {
                                avatarEl.src = resolved.avatarUrl;
                            } else if (resolved.avatarUrl) {
                                avatarEl.innerHTML = `<img src="${resolved.avatarUrl}" class="w-full h-full rounded-full object-cover">`;
                            }
                        }
                    }
                }).catch(() => {});
            }
        }
    }

    const resolvedAvatar = effectiveAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(effectiveName || "Customer")}&background=0084FF&color=fff`;

    if (nameEl) nameEl.innerText = effectiveName || "Customer";
    if (avatarEl) {
        if (avatarEl.tagName === 'IMG') {
            avatarEl.src = resolvedAvatar;
        } else {
            avatarEl.innerHTML = `<img src="${resolvedAvatar}" class="w-full h-full rounded-full object-cover">`;
        }
    }

    if (modal) {
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
        if (typeof syncChatHdButtonUI === 'function') syncChatHdButtonUI();
        else if (window.syncChatHdButtonUI) window.syncChatHdButtonUI();
        if (window.initSharedQuickRepliesListener) window.initSharedQuickRepliesListener();
    }

    cancelRiderReply();

    if (activeRiderChatListener) activeRiderChatListener.off();
    if (activeRiderChatMetaListener) activeRiderChatMetaListener.off();

    if (db && custId) {
        db.ref(`customers/${custId}`).once('value', (snap) => {
            activeCustData = snap.val() || {};
        });

        activeRiderChatMetaListener = db.ref(`customerChats/${custId}/metadata`);
        activeRiderChatMetaListener.on('value', (snapshot) => {
            currentRiderChatMeta = snapshot.val() || {};
            if (currentRiderChatMeta?.customerName && nameEl) {
                if (!nameEl.innerText || nameEl.innerText === 'Customer' || nameEl.innerText.startsWith('FB Customer (')) {
                    nameEl.innerText = currentRiderChatMeta.customerName;
                }
            }
            if (currentRiderChatMeta?.avatarUrl && avatarEl && avatarEl.tagName === 'IMG') {
                avatarEl.src = currentRiderChatMeta.avatarUrl;
            }
            evaluateRiderChatLockPermissions();
            bindRiderToActiveStoreOrders(currentRiderChatMeta);
            syncMilestoneBarUI(currentRiderChatMeta);
        });

        listenToRiderChatMessages(custId);
    }
}

function syncMilestoneBarUI(meta) {
    const bar = document.getElementById('rider-chat-milestone-bar');
    const orderId = meta?.latestOrderId;

    if (!bar) return;

    if (orderId && db) {
        bar.classList.remove('hidden');
        db.ref(`orders/${cleanFirebasePathKey(orderId)}/status`).once('value', (snap) => {
            const currentStatus = snap.val() || 'placed';
            highlightActiveMilestoneUI(currentStatus);
        });
    } else {
        bar.classList.add('hidden');
    }
}

function bindRiderToActiveStoreOrders(meta) {
    if (!meta || !db) return;
    const latestOrderId = cleanFirebasePathKey(meta.latestOrderId);
    const storeIds = meta.orderedStoreIds || [];
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = appState.riderName || localStorage.getItem('riderName') || "Assigned Rider";

    if (latestOrderId && storeIds.length > 0 && myName) {
        storeIds.forEach(sId => {
            const cleanSId = cleanFirebasePathKey(sId);
            db.ref(`storeOrders/${cleanSId}/${latestOrderId}`).update({
                riderId: myId,
                riderName: myName
            }).catch(() => {});
        });
    }
}

export function listenToRiderChatMessages(custId) {
    if (!db || !custId) return;

    const container = document.getElementById('rider-cust-chat-messages') || document.getElementById('rider-chat-messages-container');
    if (!container) return;

    oldestRiderMsgTimestamp = null;
    hasMoreRiderMsgs = true;
    isLoadingRiderHistory = false;
    loadedRiderMsgsMap.clear();

    setupRiderScrollPagination(container, custId);

    activeRiderChatListener = db.ref(`customerChats/${custId}/messages`).orderByChild('timestamp').limitToLast(RIDER_CHAT_BATCH_SIZE);

    activeRiderChatListener.on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            container.innerHTML = `<div class="text-center text-gray-500 dark:text-gray-400 italic py-10 text-xs">No messages yet.</div>`;
            return;
        }

        const isInitialLoad = loadedRiderMsgsMap.size === 0;
        let newCustMsg = null;

        Object.entries(data).forEach(([key, msg]) => {
            const isNew = !loadedRiderMsgsMap.has(key);
            loadedRiderMsgsMap.set(key, { id: key, ...msg });

            // Auto-resolve missing Facebook image attachment from Graph API
            if (String(custId).startsWith('fb_') && !msg.imageUrl && msg.text && (msg.text.includes('[Facebook image]') || msg.text.includes('[Facebook attachment]'))) {
                resolveFacebookMessageAttachment(custId, key, msg.mid || key).then(url => {
                    if (url && activeRiderChatCustId === custId) {
                        const existing = loadedRiderMsgsMap.get(key);
                        if (existing) {
                            existing.imageUrl = url;
                            existing.type = 'image';
                            renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, false, 0, activeCustData);
                        }
                    }
                }).catch(() => {});
            }

            if (isNew && !isInitialLoad && !msg.isRider) {
                newCustMsg = msg;
            }

            if (!msg.isRider && msg.status !== 'seen') {
                db.ref(`customerChats/${custId}/messages/${key}`).update({
                    status: 'seen',
                    seenAt: Date.now()
                });
            }
        });

        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;

        if (loadedRiderMsgsMap.size > 0) {
            const sortedMsgs = Array.from(loadedRiderMsgsMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            oldestRiderMsgTimestamp = sortedMsgs[0].timestamp || null;
        }

        renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, isInitialLoad, 0, activeCustData);

        if (newCustMsg && !isInitialLoad) {
            const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";
            if (!isNearBottom) {
                const preview = newCustMsg.text || (newCustMsg.imageUrl ? "📷 Photo" : "📍 Location");
                showRiderInChatToast(container, newCustMsg.sender || custName, preview);
            } else {
                hideRiderInChatToast();
                requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
            }
        }
    });
}

function setupRiderScrollPagination(container, custId) {
    container.onscroll = () => {
        if (container.scrollTop < 50 && !isLoadingRiderHistory && hasMoreRiderMsgs && oldestRiderMsgTimestamp) {
            loadOlderRiderMessages(container, custId);
        }

        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
        if (isNearBottom) {
            hideRiderInChatToast();
        }
    };
}

async function loadOlderRiderMessages(container, custId) {
    if (isLoadingRiderHistory || !hasMoreRiderMsgs || !oldestRiderMsgTimestamp) return;

    isLoadingRiderHistory = true;
    showRiderTopSpinner(container);

    const oldScrollHeight = container.scrollHeight;

    try {
        const snap = await db.ref(`customerChats/${custId}/messages`)
            .orderByChild('timestamp')
            .endAt(oldestRiderMsgTimestamp - 1)
            .limitToLast(20)
            .once('value');

        const data = snap.val();
        hideRiderTopSpinner();

        if (!data || Object.keys(data).length === 0) {
            hasMoreRiderMsgs = false;
            isLoadingRiderHistory = false;
            renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, false, oldScrollHeight, activeCustData);
            return;
        }

        const entries = Object.entries(data);
        if (entries.length < 20) {
            hasMoreRiderMsgs = false;
        }

        entries.forEach(([key, msg]) => {
            loadedRiderMsgsMap.set(key, { id: key, ...msg });

            // Auto-resolve missing Facebook image attachment from Graph API
            if (String(custId).startsWith('fb_') && !msg.imageUrl && msg.text && (msg.text.includes('[Facebook image]') || msg.text.includes('[Facebook attachment]'))) {
                resolveFacebookMessageAttachment(custId, key, msg.mid || key).then(url => {
                    if (url && activeRiderChatCustId === custId) {
                        const existing = loadedRiderMsgsMap.get(key);
                        if (existing) {
                            existing.imageUrl = url;
                            existing.type = 'image';
                            renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, false, 0, activeCustData);
                        }
                    }
                }).catch(() => {});
            }
        });

        const sortedMsgs = Array.from(loadedRiderMsgsMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        if (sortedMsgs.length > 0) {
            oldestRiderMsgTimestamp = sortedMsgs[0].timestamp || null;
        }

        renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, false, oldScrollHeight, activeCustData);
    } catch (e) {
        console.error("Error loading older rider chat messages:", e);
        hideRiderTopSpinner();
    } finally {
        isLoadingRiderHistory = false;
    }
}

export function setRiderReply(msgId, senderName, text) {
    activeRiderReplyTarget = { id: msgId, sender: senderName, text: text };
    
    let replyBar = document.getElementById('rider-chat-reply-bar');
    if (!replyBar) {
        const inputContainer = document.getElementById('rider-chat-input-container') || (document.getElementById('rider-cust-chat-input') || document.getElementById('rider-chat-input'))?.parentElement;
        if (inputContainer && inputContainer.parentElement) {
            replyBar = document.createElement('div');
            replyBar.id = 'rider-chat-reply-bar';
            replyBar.className = 'bg-blue-50/90 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-500/40 px-3 py-1.5 rounded-xl flex items-center justify-between gap-2 mb-1.5 text-xs';
            inputContainer.parentElement.insertBefore(replyBar, inputContainer);
        }
    }

    if (replyBar) {
        replyBar.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <i class="fa-solid fa-reply text-blue-500 text-xs shrink-0"></i>
                <div class="min-w-0 flex-1 text-[11px] leading-tight">
                    <div class="font-bold text-blue-600 dark:text-blue-300 truncate">Replying to ${escapeHtml(senderName || 'User')}</div>
                    <div class="text-gray-600 dark:text-gray-300 truncate text-[10px]">${escapeHtml(text || '📷 Attachment / Location')}</div>
                </div>
            </div>
            <button type="button" onclick="window.cancelRiderReply()" class="text-gray-400 hover:text-red-500 p-1 text-xs transition active:scale-90" title="Cancel Reply">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;
        replyBar.classList.remove('hidden');
    }

    const input = document.getElementById('rider-chat-input') || document.getElementById('rider-cust-chat-input');
    if (input) input.focus();
}

export function cancelRiderReply() {
    activeRiderReplyTarget = null;
    const replyBar = document.getElementById('rider-chat-reply-bar');
    if (replyBar) replyBar.classList.add('hidden');
}

export async function toggleRiderMessageReaction(msgId, emoji) {
    if (!db || !activeRiderChatCustId || !msgId || !emoji) return;
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || 'rider').toString();

    try {
        const ref = db.ref(`customerChats/${activeRiderChatCustId}/messages/${msgId}/reactions/${emoji}/${myId}`);
        const snap = await ref.once('value');
        if (snap.exists()) {
            await ref.remove();
        } else {
            await ref.set(true);
        }
    } catch(e) {
        console.error("Error toggling rider reaction:", e);
    }
}

function evaluateRiderChatLockPermissions() {
    const lockBanner = document.getElementById('rider-chat-lock-banner');
    const inputEl = document.getElementById('rider-chat-input') || document.getElementById('rider-cust-chat-input');
    const sendBtn = document.getElementById('rider-cust-send-btn');
    const actionToolbar = document.getElementById('rider-chat-action-toolbar');

    if (!currentRiderChatMeta) return;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    const cateredRiderId = (currentRiderChatMeta.cateredByRiderId || "").toString().trim();
    const cateredRiderName = (currentRiderChatMeta.cateredByRiderName || currentRiderChatMeta.cateredBy || "").toString().trim().toLowerCase();

    const isCateringRider = (cateredRiderId && cateredRiderId === myId) || (cateredRiderName && cateredRiderName === myName);
    
    const isAdmin = typeof window.isAdmin === 'function' ? window.isAdmin() : false;
    const canManage = typeof window.canManageRoster === 'function' ? window.canManageRoster() : false;
    const adminControlsActive = globalState.adminControlsEnabled && (isAdmin || canManage);

    const isLocked = (cateredRiderId || cateredRiderName) && !isCateringRider && !adminControlsActive;

    const caterBtn = document.getElementById('rider-chat-cater-btn');
    const cancelBtn = document.getElementById('rider-chat-cancel-btn');

    if (isLocked) {
        if (lockBanner) {
            lockBanner.classList.remove('hidden');
            lockBanner.className = "bg-amber-50 dark:bg-amber-500/20 border-b border-amber-200 dark:border-amber-500/40 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300 font-bold text-center shrink-0";
            lockBanner.innerHTML = `🔒 Being catered by <strong>${escapeHtml(currentRiderChatMeta.cateredByRiderName || currentRiderChatMeta.cateredBy)}</strong>. View only mode.`;
        }
        if (inputEl) inputEl.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        if (actionToolbar) actionToolbar.classList.add('opacity-50', 'pointer-events-none');
        if (caterBtn) caterBtn.classList.add('hidden');
        if (cancelBtn) cancelBtn.classList.add('hidden');
    } else {
        if (lockBanner) {
            if (isCateringRider) {
                lockBanner.classList.remove('hidden');
                lockBanner.className = "bg-emerald-50 dark:bg-emerald-950/40 border-b-2 border-emerald-500 px-3 py-1.5 text-[11px] text-emerald-800 dark:text-emerald-300 font-bold text-center shrink-0 flex items-center justify-center gap-1.5";
                lockBanner.innerHTML = `<i class="fa-solid fa-user-check text-emerald-600"></i> Kasalukuyan mong kinacater ang customer na ito.`;
            } else if (adminControlsActive && (cateredRiderId || cateredRiderName)) {
                lockBanner.classList.remove('hidden');
                lockBanner.className = "bg-amber-50 dark:bg-amber-500/20 border-b border-amber-200 dark:border-amber-500/40 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300 font-bold text-center shrink-0";
                lockBanner.innerHTML = `⚡ Admin Controls Enabled — Replying as Admin (Catered by ${escapeHtml(currentRiderChatMeta.cateredByRiderName || currentRiderChatMeta.cateredBy)}).`;
            } else {
                lockBanner.classList.add('hidden');
            }
        }
        if (inputEl) inputEl.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        if (actionToolbar) actionToolbar.classList.remove('opacity-50', 'pointer-events-none');

        const modalDialog = document.querySelector('#rider-chat-modal > div') || document.querySelector('#rider-customer-chat-modal > div');
        if (modalDialog) {
            modalDialog.classList.remove('ring-2', 'ring-emerald-500', 'border-emerald-500', 'catering-glow-my', 'catering-glow-other', 'catering-glow-gold');
            if (isCateringRider || cateredRiderId || cateredRiderName) {
                modalDialog.classList.add('catering-glow-gold');
            }
        }

        if (isCateringRider) {
            if (caterBtn) caterBtn.classList.add('hidden');
            if (cancelBtn) cancelBtn.classList.remove('hidden');
        } else {
            if (caterBtn) caterBtn.classList.remove('hidden');
            if (cancelBtn) cancelBtn.classList.add('hidden');
        }
    }
}

export function closeRiderChatModal() {
    closeRiderCustomerChatModal();
}

export function closeRiderCustomerChatModal() {
    const modal = document.getElementById('rider-chat-modal') || document.getElementById('rider-customer-chat-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }

    if (activeRiderChatListener) {
        activeRiderChatListener.off();
        activeRiderChatListener = null;
    }
    if (activeRiderChatMetaListener) {
        activeRiderChatMetaListener.off();
        activeRiderChatMetaListener = null;
    }
    activeRiderChatCustId = null;
    currentRiderChatMeta = null;

    oldestRiderMsgTimestamp = null;
    hasMoreRiderMsgs = true;
    isLoadingRiderHistory = false;
    loadedRiderMsgsMap.clear();
    cancelRiderReply();
}

export function sendRiderChatMessage(content = null, type = 'text') {
    sendRiderToCustomerChat(content, type === 'image' ? content : null);
}

export async function sendRiderToCustomerChat(customText = "", customImageUrl = null, customLocationCoords = null) {
    const input1 = document.getElementById('rider-chat-input');
    const input2 = document.getElementById('rider-cust-chat-input');
    const val1 = input1 ? input1.value.trim() : "";
    const val2 = input2 ? input2.value.trim() : "";
    const text = (typeof customText === 'string' && customText.trim()) ? customText.trim() : (val1 || val2);

    if ((!text && !customImageUrl && !customLocationCoords) || !activeRiderChatCustId) return;

    const riderName = appState.riderName || "Lokalex Rider";
    const now = Date.now();

    let finalImageUrl = customImageUrl;
    if (customImageUrl && customImageUrl.startsWith('data:')) {
        showToast("⏳ Uploading photo...");
        try {
            finalImageUrl = await uploadImage(customImageUrl, `chats/${activeRiderChatCustId}/${now}.jpg`);
        } catch (e) {
            console.warn("Chat image upload fallback:", e);
        }
    }

    const targetChannel = currentRiderChatMeta?.channel || (activeRiderChatCustId?.startsWith('fb_') ? 'messenger' : 'web');
    const targetApiId = currentRiderChatMeta?.apiId || currentRiderChatMeta?.channelId || null;

    const newMsg = {
        sender: riderName,
        senderType: 'rider',
        text: text,
        timestamp: now,
        isRider: true,
        status: 'sent',
        channel: targetChannel,
        apiId: targetApiId,
        deliveredAt: null,
        seenAt: null
    };

    if (activeRiderReplyTarget) {
        newMsg.replyTo = {
            id: activeRiderReplyTarget.id,
            sender: activeRiderReplyTarget.sender,
            text: activeRiderReplyTarget.text.substring(0, 120)
        };
    }

    if (finalImageUrl) {
        newMsg.imageUrl = finalImageUrl;
        newMsg.type = 'image';
    }
    if (customLocationCoords) {
        newMsg.locationCoords = customLocationCoords;
        newMsg.type = 'location';
    }

    if (db) {
        db.ref(`customerChats/${activeRiderChatCustId}/messages`).push(sanitizeForFirebase(newMsg));
        db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update(sanitizeForFirebase({
            lastMessage: `You: ${text || (finalImageUrl ? "📷 Photo" : "📍 Location")}`,
            lastUpdated: now,
            unreadForRider: false
        }));
    }

    // Forward reply to Facebook Messenger customer if thread is from Facebook
    if (targetChannel === 'messenger' || String(activeRiderChatCustId).startsWith('fb_')) {
        forwardRiderReplyToMessenger({
            custId: activeRiderChatCustId,
            apiId: targetApiId,
            text: text,
            imageUrl: finalImageUrl,
            locationCoords: customLocationCoords,
            riderName: riderName
        });
    }

    if (!customText) {
        if (input1) input1.value = "";
        if (input2) input2.value = "";
    }
    cancelRiderReply();

    hideRiderInChatToast();

    const container = document.getElementById('rider-chat-messages-container') || document.getElementById('rider-cust-chat-messages');
    if (container) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
        });
    }
}

/**
 * Forwards outbound rider chat message directly to Facebook Messenger via the webhook bridge
 */
async function forwardRiderReplyToMessenger({ custId, apiId, text, imageUrl, locationCoords, riderName }) {
    try {
        const cleanPsid = String(custId || '').replace(/^fb_/, '');
        if (!cleanPsid) return;

        let sendEndpoint = null;
        if (typeof getPublicFbSendEndpoint === 'function') {
            sendEndpoint = getPublicFbSendEndpoint(apiId);
        }
        if (!sendEndpoint && typeof window !== 'undefined' && typeof window.getPublicFbSendEndpoint === 'function') {
            sendEndpoint = window.getPublicFbSendEndpoint(apiId);
        }

        // Fallback 1: Fetch directly from active channel in RTDB
        if (!sendEndpoint && db && apiId) {
            const snap = await db.ref(`facebookChannels/${apiId}/sendEndpoint`).once('value');
            sendEndpoint = snap.val();
        }

        // Fallback 2: Any available sendEndpoint in RTDB
        if (!sendEndpoint && db) {
            const allSnap = await db.ref('facebookChannels').once('value');
            const allVal = allSnap.val() || {};
            const first = Object.values(allVal).find(c => c && c.sendEndpoint);
            if (first) sendEndpoint = first.sendEndpoint;
        }

        // Fallback 3: Production Cloudflare Worker endpoint
        if (!sendEndpoint) {
            sendEndpoint = "https://lokalex-messenger-webhook.lokaledeliver.workers.dev/api/send-reply";
        }

        const resp = await fetch(sendEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipientId: cleanPsid,
                text: text,
                imageUrl: imageUrl,
                locationCoords: locationCoords,
                senderName: riderName,
                apiId: apiId
            })
        });

        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            console.warn("Facebook send reply error:", errData);
            const errMsg = errData.error?.message || errData.error || (typeof errData === 'string' ? errData : 'Check Page permissions');
            showToast(`⚠️ Messenger delivery issue: ${errMsg}`);
        } else {
            console.log("✅ Rider reply delivered to Facebook Messenger!");
            showToast("✅ Delivered to customer Messenger!");
        }
    } catch (err) {
        console.error("Failed to forward rider reply to Messenger:", err);
    }
}

export function sendChatLocationPin() {
    sendRiderLocation();
}

export function sendRiderLocation() {
    openMapPicker('rider-chat');
}

export async function promptRenameCustomerChat() {
    if (!activeRiderChatCustId) return;
    const currentName = document.getElementById('rider-chat-cust-name')?.innerText || "";
    const newName = prompt("I-edit ang pangalan ng Customer:", currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName.trim()) return;

    const cleanName = newName.trim();
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanName)}&background=0084FF&color=fff`;

    if (db && activeRiderChatCustId) {
        await Promise.all([
            db.ref(`customerChatMeta/${activeRiderChatCustId}`).update({
                customerName: cleanName,
                avatarUrl: avatar
            }),
            db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update({
                customerName: cleanName,
                avatarUrl: avatar
            })
        ]).catch(() => {});
        
        const nameEl = document.getElementById('rider-chat-cust-name');
        if (nameEl) nameEl.innerText = cleanName;
        showToast(`✅ Na-update ang pangalan: ${cleanName}`);
    }
}

if (typeof window !== 'undefined') {
    window.getActiveRiderChatCustId = getActiveRiderChatCustId;
    window.getCurrentRiderChatMeta = getCurrentRiderChatMeta;
    window.getActiveCustData = getActiveCustData;
    window.setActiveCustData = setActiveCustData;

    window.openRiderChatModal = openRiderChatModal;
    window.openRiderCustomerChatModal = openRiderCustomerChatModal;
    window.closeRiderChatModal = closeRiderChatModal;
    window.closeRiderCustomerChatModal = closeRiderCustomerChatModal;
    window.promptRenameCustomerChat = promptRenameCustomerChat;
    window.sendRiderChatMessage = sendRiderChatMessage;
    window.sendRiderToCustomerChat = sendRiderToCustomerChat;
    window.sendChatLocationPin = sendChatLocationPin;
    window.sendRiderLocation = sendRiderLocation;
    window.setRiderReply = setRiderReply;
    window.cancelRiderReply = cancelRiderReply;
    window.toggleRiderMessageReaction = toggleRiderMessageReaction;

    window.getActiveRiderChatFilter = getActiveRiderChatFilter;
    window.setRiderChatFilter = setRiderChatFilter;
    window.listenToAllCustomerChatsForRider = listenToAllCustomerChatsForRider;

    listenToGlobalStoreChats();
}