// src/features/chat/riderChat.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { escapeHtml } from '../../utils/helpers.js';
import { toggleBodyScroll, getMessageTimestamp } from './chatUtils.js';
import { openMapPicker } from '../maps.js';
import { showToast, showNativeNotification, clearNativeNotification } from '../../ui/notifications.js';
import { uploadImage, dataUrlToBlob } from '../../utils/imageUpload.js';
import { highlightActiveMilestoneUI } from './riderThreadActions.js';
import { isAdmin, canManageRoster, isCustomerMatch } from '../roster/rosterUtils.js';
import { 
    showRiderInChatToast, 
    hideRiderInChatToast, 
    showRiderTopSpinner, 
    hideRiderTopSpinner, 
    renderRiderMessages,
    appendOrUpdateSingleRiderMessage 
} from './riderChatRender.js';
import { 
    setRiderChatFilter, 
    listenToAllCustomerChatsForRider, 
    getActiveRiderChatFilter,
    isMyCustomerThread
} from './riderChatFeed.js';
import { listenToGlobalStoreChats } from './riderStoreChat.js';
import { 
    getPublicFbSendEndpoint,
    getFbPageAccessToken,
    resolveFacebookCustomerName,
    getResolvedFbName,
    resolveFacebookMessageAttachment,
    resolveFacebookMessageReplyTo
} from './facebookApiAdmin.js';
import { playChatChime } from './chatSoundManager.js';
import { idbGet, idbSet } from '../../utils/storageEngine.js';

let activeRiderChatCustId = null;
let activeRiderChatListener = null;
let activeRiderChatChildListener = null;
let activeRiderChatChangedListener = null;
let activeRiderChatMetaListener = null;
let currentRiderChatMeta = null;
let activeCustData = null;
let openSessionTime = 0;

let activeRiderReplyTarget = null;
const RIDER_CHAT_BATCH_SIZE = 10; // Initial partial load: only 10 messages for lightning fast loading
const RIDER_CHAT_OLDER_BATCH_SIZE = 10; // On-demand chunk size when scrolling up
let oldestRiderMsgTimestamp = null;
let oldestRiderMsgKey = null;
let hasMoreRiderMsgs = true;
let isLoadingRiderHistory = false;
let isInitialScrollDone = false;
let lastPaginationRequestTime = 0;
let loadedRiderMsgsMap = new Map();
const riderChatMemoryCache = new Map(); // Fast RAM cache: custId -> Array of messages
const threadDraftsMap = new Map(); // Thread-specific input drafts: custId -> text

export function saveCurrentThreadDraft(targetCustId = null) {
    const custId = targetCustId || activeRiderChatCustId;
    if (!custId) return;
    const input = document.getElementById('rider-chat-input') || document.getElementById('rider-cust-chat-input');
    if (input) {
        const val = input.value;
        if (typeof val === 'string' && val.trim().length > 0) {
            threadDraftsMap.set(custId, val);
        } else {
            threadDraftsMap.delete(custId);
        }
    }
}

export function restoreThreadDraft(targetCustId) {
    const input = document.getElementById('rider-chat-input') || document.getElementById('rider-cust-chat-input');
    if (input) {
        const draft = (targetCustId && threadDraftsMap.get(targetCustId)) ? threadDraftsMap.get(targetCustId) : "";
        input.value = draft;
        input.style.height = 'auto';
        if (draft) {
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        }
    }
}

export function handleRiderChatInputDraft(val) {
    if (!activeRiderChatCustId) return;
    if (typeof val === 'string' && val.trim().length > 0) {
        threadDraftsMap.set(activeRiderChatCustId, val);
    } else {
        threadDraftsMap.delete(activeRiderChatCustId);
    }
}

function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

function cleanFirebasePathKey(key) {
    return String(key || '').replace(/^#+/, '').replace(/[.#$\[\]\/]/g, '_').trim();
}

export function getActiveRiderChatCustId() { return activeRiderChatCustId; }
export function getCurrentRiderChatMeta() { 
    if (activeRiderChatCustId && typeof window.getCachedCustomerThreadsMap === 'function') {
        const map = window.getCachedCustomerThreadsMap();
        const thread = map ? (map.get(activeRiderChatCustId) || map.get(`fb_${activeRiderChatCustId}`) || (activeRiderChatCustId.startsWith('fb_') ? map.get(activeRiderChatCustId.replace(/^fb_/, '')) : null)) : null;
        if (thread) {
            return { ...thread, ...(currentRiderChatMeta || {}) };
        }
    }
    return currentRiderChatMeta || {}; 
}
export function getLoadedRiderMsgsMap() { return loadedRiderMsgsMap; }
export function getActiveCustData() { return activeCustData; }
export function setActiveCustData(data) { activeCustData = data; }

export function openRiderChatModal(custId, custName) {
    openRiderCustomerChatModal(custId, custName);
}

let currentActiveRiderChatCustAvatar = "";

export function viewCurrentCustomerPhoto() {
    const avatarUrl = currentActiveRiderChatCustAvatar || document.getElementById('rider-chat-avatar')?.querySelector('img')?.src;
    if (avatarUrl && window.openImageViewerModal) {
        window.openImageViewerModal(avatarUrl, 'customer');
    }
}

export function openRiderCustomerChatModal(custId, custName, avatarUrl) {
    if (activeRiderChatCustId && activeRiderChatCustId !== custId) {
        saveCurrentThreadDraft(activeRiderChatCustId);
    }

    activeRiderChatCustId = custId;
    openSessionTime = Date.now();
    if (typeof window !== 'undefined') {
        window.activeRiderChatCustId = custId;
    }
    activeCustData = null;

    restoreThreadDraft(custId);

    if (custId) {
        clearNativeNotification('chat_' + custId);
    }

    if (db && typeof db.goOnline === 'function') {
        try { db.goOnline(); } catch (_) {}
    }

    if (db && custId) {
        const payload = { unreadForRider: false };
        db.ref(`customerChats/${custId}/metadata`).update(payload).catch(() => {});
        db.ref(`customerChatMeta/${custId}`).update(payload).catch(() => {});
    }

    if (custId && typeof window.getCachedCustomerThreadsMap === 'function') {
        const map = window.getCachedCustomerThreadsMap();
        if (map) {
            for (const thread of map.values()) {
                if (thread.custId === custId) {
                    thread.isUnread = false;
                    break;
                }
            }
        }
        if (typeof window.updateInboxUnreadBadge === 'function') window.updateInboxUnreadBadge();
        if (typeof window.updateDoneUnreadBadge === 'function') window.updateDoneUnreadBadge();
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
        }
        if (cached && cached.avatarUrl && !cached.avatarUrl.includes('ui-avatars.com')) {
            effectiveAvatar = cached.avatarUrl;
        }
        
        // Background check to resolve customer name or real Facebook photo if missing/placeholder
        const needsName = !effectiveName || effectiveName.startsWith('FB Customer (');
        const needsAvatar = !effectiveAvatar || effectiveAvatar.includes('ui-avatars.com');
        if (needsName || needsAvatar) {
            if (typeof resolveFacebookCustomerName === 'function') {
                resolveFacebookCustomerName(custId).then(resolved => {
                    if (resolved && activeRiderChatCustId === custId) {
                        if (resolved.name && needsName && nameEl) {
                            nameEl.innerText = resolved.name;
                        }
                        if (resolved.avatarUrl && !resolved.avatarUrl.includes('ui-avatars.com')) {
                            currentActiveRiderChatCustAvatar = resolved.avatarUrl;
                            if (avatarEl) {
                                if (avatarEl.tagName === 'IMG') {
                                    avatarEl.src = resolved.avatarUrl;
                                } else {
                                    avatarEl.innerHTML = `<img src="${resolved.avatarUrl}" class="w-full h-full rounded-full object-cover">`;
                                }
                            }
                        }
                    }
                }).catch(() => {});
            }
        }
    }

    const resolvedAvatar = effectiveAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(effectiveName || "Customer")}&background=0084FF&color=fff`;
    currentActiveRiderChatCustAvatar = resolvedAvatar;

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
        renderRiderCateredSwitcher();
    }

    cancelRiderReply();

    if (activeRiderChatListener) {
        if (typeof activeRiderChatListener.off === 'function') activeRiderChatListener.off();
        activeRiderChatListener = null;
    }
    if (activeRiderChatChildListener) {
        if (typeof activeRiderChatChildListener.off === 'function') activeRiderChatChildListener.off();
        activeRiderChatChildListener = null;
    }
    if (activeRiderChatChangedListener) {
        if (typeof activeRiderChatChangedListener.off === 'function') activeRiderChatChangedListener.off();
        activeRiderChatChangedListener = null;
    }
    if (activeRiderChatMetaListener) {
        if (typeof activeRiderChatMetaListener.off === 'function') activeRiderChatMetaListener.off();
        activeRiderChatMetaListener = null;
    }
    if (custId && typeof window.getCachedCustomerThreadsMap === 'function') {
        const map = window.getCachedCustomerThreadsMap();
        const thread = map ? (map.get(custId) || map.get(`fb_${custId}`) || (custId.startsWith('fb_') ? map.get(custId.replace(/^fb_/, '')) : null)) : null;
        if (thread) {
            syncApplicantUI(thread);
        } else {
            syncApplicantUI(null);
        }
    } else {
        syncApplicantUI(null);
    }

    if (db && custId) {
        db.ref(`customers/${custId}`).once('value', (snap) => {
            activeCustData = snap.val() || {};
        });

        activeRiderChatMetaListener = db.ref(`customerChats/${custId}/metadata`);
        activeRiderChatMetaListener.on('value', (snapshot) => {
            currentRiderChatMeta = snapshot.val() || {};
            if (!currentRiderChatMeta.isApplicant && typeof window.getCachedCustomerThreadsMap === 'function') {
                const map = window.getCachedCustomerThreadsMap();
                const thread = map ? (map.get(custId) || map.get(`fb_${custId}`) || (custId.startsWith('fb_') ? map.get(custId.replace(/^fb_/, '')) : null)) : null;
                if (thread?.isApplicant) {
                    currentRiderChatMeta.isApplicant = true;
                    currentRiderChatMeta.folder = 'applicant';
                } else if (thread?.folder === 'followup' && currentRiderChatMeta.folder !== 'applicant') {
                    currentRiderChatMeta.folder = 'followup';
                }
            }
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
            syncApplicantUI(currentRiderChatMeta);
            renderRiderCateredSwitcher();

            // Instant reconcile: any metadata change while thread is open synchronizes incoming messages immediately!
            if (activeRiderChatCustId === custId) {
                syncIncomingMessageFromMeta(custId, currentRiderChatMeta);
                const container = document.getElementById('rider-cust-chat-messages') || document.getElementById('rider-chat-messages-container');
                if (container && typeof window.updateRiderChatSeenAvatar === 'function') {
                    window.updateRiderChatSeenAvatar(container, activeCustData, loadedRiderMsgsMap);
                }
            }
        });

        listenToRiderChatMessages(custId);
    }
}

export function syncApplicantUI(meta) {
    const applicantPill = document.getElementById('rider-chat-applicant-pill');
    const applicantBtn = document.getElementById('rider-chat-applicant-btn');
    const followupPill = document.getElementById('rider-chat-followup-pill');
    const followupBtn = document.getElementById('rider-chat-followup-btn');

    const isApplicant = Boolean(meta?.isApplicant || meta?.folder === 'applicant');
    const isFollowUp = Boolean(!isApplicant && meta?.folder === 'followup');

    if (applicantPill) {
        if (isApplicant) {
            applicantPill.classList.remove('hidden');
        } else {
            applicantPill.classList.add('hidden');
        }
    }

    if (applicantBtn) {
        if (isApplicant) {
            applicantBtn.className = "flex-1 min-w-[90px] bg-purple-700 hover:bg-purple-600 text-white border border-purple-400 py-2 px-3 rounded-xl text-xs font-black transition active:scale-95 flex items-center justify-center gap-1.5 shadow-md ring-2 ring-purple-400/50";
            applicantBtn.innerHTML = `<i class="fa-solid fa-user-tie"></i> Applicant ✓`;
            applicantBtn.title = "Marked as Applicant (Click to remove tag)";
        } else {
            applicantBtn.className = "flex-1 min-w-[90px] bg-purple-600 hover:bg-purple-500 text-white border border-purple-500/30 py-2 px-3 rounded-xl text-xs font-bold transition active:scale-95 flex items-center justify-center gap-1.5 shadow-sm";
            applicantBtn.innerHTML = `<i class="fa-solid fa-user-tie"></i> Applicant`;
            applicantBtn.title = "Mark as Applicant";
        }
    }

    if (followupPill) {
        if (isFollowUp) {
            followupPill.classList.remove('hidden');
        } else {
            followupPill.classList.add('hidden');
        }
    }

    if (followupBtn) {
        if (isFollowUp) {
            followupBtn.className = "flex-1 min-w-[90px] bg-amber-700 hover:bg-amber-600 text-white border border-amber-400 py-2 px-3 rounded-xl text-xs font-black transition active:scale-95 flex items-center justify-center gap-1.5 shadow-md ring-2 ring-amber-400/50";
            followupBtn.innerHTML = `<i class="fa-solid fa-bookmark"></i> Follow Up ✓`;
            followupBtn.title = "Marked as Follow Up (Click to remove tag)";
        } else {
            followupBtn.className = "flex-1 min-w-[90px] bg-amber-600 hover:bg-amber-500 text-white border border-amber-500/30 py-2 px-3 rounded-xl text-xs font-bold transition active:scale-95 flex items-center justify-center gap-1.5 shadow-sm";
            followupBtn.innerHTML = `<i class="fa-solid fa-bookmark"></i> Follow Up`;
            followupBtn.title = "Move to Follow Up & open Advance Order";
        }
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

export function renderRiderCateredSwitcher() {
    const container = document.getElementById('rider-chat-catered-switcher');
    const pillsWrapper = document.getElementById('rider-chat-catered-pills');
    if (!container || !pillsWrapper) return;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    const roster = globalState.rosterMembers || [];
    const myRecord = roster.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        return (myId && mId === myId) || (myName && mName === myName);
    });

    const cateredList = [];
    const addedNames = new Set();

    if (myRecord) {
        if (myRecord.customerName) {
            const custs = myRecord.customerName.split(',').map(c => c.trim()).filter(Boolean);
            custs.forEach(c => {
                const lower = c.toLowerCase();
                if (!addedNames.has(lower)) {
                    addedNames.add(lower);
                    cateredList.push({ name: c });
                }
            });
        }
        if (myRecord.forcedCaters && typeof myRecord.forcedCaters === 'object') {
            Object.entries(myRecord.forcedCaters).forEach(([k, v]) => {
                const fName = (v && typeof v === 'object' && v.customerName) ? v.customerName : (typeof v === 'string' ? v : "");
                if (fName && typeof fName === 'string') {
                    const lower = fName.toLowerCase();
                    if (!addedNames.has(lower)) {
                        addedNames.add(lower);
                        cateredList.push({ name: fName, forcedKey: k });
                    }
                }
            });
        }
    }

    const threadMap = (typeof window.getCachedCustomerThreadsMap === 'function') ? window.getCachedCustomerThreadsMap() : null;
    if (threadMap && threadMap.size > 0) {
        for (const [tId, t] of threadMap.entries()) {
            const isMe = (myId && t.cateredByRiderId && t.cateredByRiderId.toString() === myId) ||
                         (myName && t.cateredByRiderName && t.cateredByRiderName.toLowerCase() === myName);
            if (isMe && t.folder === 'catering' && t.status !== 'completed' && t.status !== 'cancelled') {
                const cName = t.customerName || t.name || "";
                if (cName && typeof cName === 'string') {
                    const lower = cName.toLowerCase();
                    if (!addedNames.has(lower)) {
                        addedNames.add(lower);
                        cateredList.push({ name: cName, threadId: tId, thread: t });
                    } else {
                        const item = cateredList.find(i => i.name.toLowerCase() === lower);
                        if (item && !item.threadId) {
                            item.threadId = tId;
                            item.thread = t;
                        }
                    }
                }
            }
        }
    }

    if (cateredList.length === 0) {
        container.classList.add('hidden');
        pillsWrapper.innerHTML = '';
        return;
    }

    // Match thread IDs if missing
    cateredList.forEach(item => {
        if (!item.threadId && threadMap) {
            const targetLower = item.name.toLowerCase().trim();
            for (const [tId, t] of threadMap.entries()) {
                const chatName = (t.customerName || t.name || "").trim().toLowerCase();
                if (chatName && (chatName === targetLower || isCustomerMatch(chatName, targetLower))) {
                    item.threadId = tId;
                    item.thread = t;
                    break;
                }
            }
        }
        if (!item.threadId) {
            item.threadId = item.forcedKey || item.name;
        }
    });

    container.classList.remove('hidden');

    const currentActiveId = activeRiderChatCustId || (window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : "");
    const currentNameEl = document.getElementById('rider-chat-cust-name');
    const currentActiveName = (currentNameEl ? currentNameEl.innerText.trim() : "").toLowerCase();

    pillsWrapper.innerHTML = cateredList.map(item => {
        const isCurrentActive = Boolean(
            (currentActiveId && (item.threadId === currentActiveId || (item.thread && item.thread.custId === currentActiveId))) ||
            (currentActiveName && (item.name.toLowerCase() === currentActiveName || isCustomerMatch(item.name, currentActiveName)))
        );

        const hasUnread = Boolean(
            !isCurrentActive && item.thread && (item.thread.isUnread || item.thread.unreadForRider)
        );

        const escapedName = escapeHtml(item.name);
        const escapedId = escapeHtml(item.threadId || item.name);

        const activeClasses = isCurrentActive
            ? "bg-emerald-600 text-white font-black shadow-sm ring-2 ring-emerald-400/60"
            : "bg-white dark:bg-cardBg text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-700 hover:border-emerald-500 font-bold";

        return `
            <button type="button" 
                onclick="window.switchCateredCustomerChat('${escapedId}', '${escapedName}')"
                class="relative px-3 py-1 rounded-full text-xs transition active:scale-95 flex items-center gap-1.5 shrink-0 ${activeClasses} cursor-pointer">
                <i class="fa-solid fa-user text-[10px] ${isCurrentActive ? 'text-white' : 'text-gray-400'}"></i>
                <span class="max-w-[120px] truncate">${escapedName}</span>
                ${hasUnread ? `
                    <span class="relative flex h-2 w-2 shrink-0">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                ` : ''}
            </button>
        `;
    }).join('');
}

export function switchCateredCustomerChat(targetCustId, targetCustName) {
    if (!targetCustId && !targetCustName) return;
    openRiderCustomerChatModal(targetCustId, targetCustName);
    renderRiderCateredSwitcher();
}

export async function reloadRiderChatFromFirebase(custId) {
    const targetCustId = custId || activeRiderChatCustId;
    if (!targetCustId) return;
    riderChatMemoryCache.delete(targetCustId);
    try {
        await idbSet('chats', targetCustId, []);
    } catch (_) {}
    listenToRiderChatMessages(targetCustId, true);
}

function triggerInstantFbAttachmentResolution(custId, msg, container, activeCustData) {
    if (!custId || !msg || !msg.id) return;
    const mid = msg.mid || (String(msg.id).startsWith('m_') ? msg.id : null) || msg.id;
    resolveFacebookMessageAttachment(custId, msg.id, mid).then(url => {
        if (url && activeRiderChatCustId === custId) {
            const existing = loadedRiderMsgsMap.get(msg.id) || msg;
            existing.imageUrl = url;
            existing.type = 'image';
            loadedRiderMsgsMap.set(msg.id, existing);

            const updatedSorted = Array.from(loadedRiderMsgsMap.values()).sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
            riderChatMemoryCache.set(custId, updatedSorted);
            idbSet('chats', custId, updatedSorted).catch(() => {});

            if (container) {
                appendOrUpdateSingleRiderMessage(container, existing, activeCustData);
            }

            try {
                const preloader = new Image();
                preloader.src = url;
            } catch (_) {}
        }
    }).catch(() => {});
}

function autoResolveRecentFbCustomerAttachments(custId, container, activeCustData) {
    if (!String(custId).startsWith('fb_')) return;
    const candidates = Array.from(loadedRiderMsgsMap.values())
        .filter(m => m && !m.imageUrl && m.text && (m.text.includes('[Facebook image]') || m.text.includes('[Facebook attachment]')));
    for (const m of candidates) {
        triggerInstantFbAttachmentResolution(custId, m, container, activeCustData);
    }
}

function autoResolveRecentFbCustomerReplies(custId, container, activeCustData) {
    if (!String(custId).startsWith('fb_')) return;
    const candidates = Array.from(loadedRiderMsgsMap.values())
        .filter(m => m && !m.isRider && !m.replyTo && (m.mid || (m.id && m.id.startsWith('m_'))))
        .slice(-8);
    for (const m of candidates) {
        resolveFacebookMessageReplyTo(custId, m.id, m.mid || m.id).then(replyToObj => {
            if (replyToObj && activeRiderChatCustId === custId) {
                const existing = loadedRiderMsgsMap.get(m.id);
                if (existing) {
                    existing.replyTo = replyToObj;
                    const updatedSorted = Array.from(loadedRiderMsgsMap.values()).sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
                    riderChatMemoryCache.set(custId, updatedSorted);
                    idbSet('chats', custId, updatedSorted).catch(() => {});
                    appendOrUpdateSingleRiderMessage(container, existing, activeCustData);
                }
            }
        }).catch(() => {});
    }
}

export async function listenToRiderChatMessages(custId, forceReloadFromFirebase = false) {
    if (!db || !custId) return;
    activeRiderChatCustId = custId;

    const container = document.getElementById('rider-cust-chat-messages') || document.getElementById('rider-chat-messages-container');
    if (!container) return;

    oldestRiderMsgTimestamp = null;
    oldestRiderMsgKey = null;
    hasMoreRiderMsgs = false;
    isLoadingRiderHistory = false;
    isInitialScrollDone = false;
    lastPaginationRequestTime = 0;
    loadedRiderMsgsMap.clear();

    // Clean up any previous chat listeners
    if (activeRiderChatListener) {
        if (typeof activeRiderChatListener.off === 'function') activeRiderChatListener.off();
        activeRiderChatListener = null;
    }
    if (activeRiderChatChildListener) {
        if (typeof activeRiderChatChildListener.off === 'function') activeRiderChatChildListener.off();
        activeRiderChatChildListener = null;
    }
    if (activeRiderChatChangedListener) {
        if (typeof activeRiderChatChangedListener.off === 'function') activeRiderChatChangedListener.off();
        activeRiderChatChangedListener = null;
    }

    setupRiderScrollPagination(container, custId);

    // 1. CHECK LOCAL STORAGE FIRST (RAM Cache -> IndexedDB persistent storage)
    let localMessages = null;
    if (!forceReloadFromFirebase) {
        const memCached = riderChatMemoryCache.get(custId);
        if (Array.isArray(memCached) && memCached.length > 0) {
            localMessages = memCached;
        } else {
            try {
                const idbCached = await idbGet('chats', custId);
                if (Array.isArray(idbCached) && idbCached.length > 0) {
                    localMessages = idbCached;
                    riderChatMemoryCache.set(custId, idbCached);
                }
            } catch (_) {}
        }
    }

    if (activeRiderChatCustId !== custId) return;

    const hasLocalRecord = Array.isArray(localMessages) && localMessages.length > 0;

    if (hasLocalRecord) {
        // Fast initial render: strictly sort by timestamp first, then load ONLY the last 10 messages
        localMessages.sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
        const initialChunk = localMessages.slice(-RIDER_CHAT_BATCH_SIZE);
        loadedRiderMsgsMap.clear();
        initialChunk.forEach(m => loadedRiderMsgsMap.set(m.id, m));
        hasMoreRiderMsgs = localMessages.length > initialChunk.length;
        if (initialChunk.length > 0) {
            oldestRiderMsgTimestamp = getMessageTimestamp(initialChunk[0]);
            oldestRiderMsgKey = initialChunk[0].id || null;
        }
        renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, true, 0, activeCustData);
        setTimeout(() => { isInitialScrollDone = true; }, 250);
        autoResolveRecentFbCustomerReplies(custId, container, activeCustData);
        autoResolveRecentFbCustomerAttachments(custId, container, activeCustData);
    } else {
        container.innerHTML = `
        <div id="rider-chat-loading-skeleton" class="flex flex-col gap-3 py-6 px-4 animate-pulse">
            <div class="flex items-end gap-2 self-start w-3/4">
                <div class="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-800 shrink-0"></div>
                <div class="h-8 rounded-2xl rounded-bl-none bg-gray-200 dark:bg-gray-800 flex-1"></div>
            </div>
            <div class="flex items-end gap-2 self-end w-2/3 justify-end">
                <div class="h-8 rounded-2xl rounded-br-none bg-emerald-600/20 dark:bg-emerald-600/30 w-3/4"></div>
                <div class="w-7 h-7 rounded-full bg-emerald-600/20 dark:bg-emerald-600/30 shrink-0"></div>
            </div>
            <div class="flex items-end gap-2 self-start w-1/2">
                <div class="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-800 shrink-0"></div>
                <div class="h-6 rounded-2xl rounded-bl-none bg-gray-200 dark:bg-gray-800 flex-1"></div>
            </div>
        </div>`;
    }

    // Realtime Firebase connection: strictly load only the last 10 messages for lightning-fast startup ordered by timestamp
    const messagesQuery = db.ref(`customerChats/${custId}/messages`).orderByChild('timestamp').limitToLast(RIDER_CHAT_BATCH_SIZE);
    activeRiderChatListener = messagesQuery;

    // Authoritative check & synchronization of newest incoming messages on thread open
    messagesQuery.once('value', (snapshot) => {
        if (activeRiderChatCustId !== custId) return;
        const data = snapshot.val();
        if (!data || Object.keys(data).length === 0) {
            if (loadedRiderMsgsMap.size === 0) {
                container.innerHTML = `<div class="text-center text-gray-500 dark:text-gray-400 italic py-10 text-xs">No messages yet.</div>`;
            }
            hasMoreRiderMsgs = false;
        } else {
            const allMsgs = Object.entries(data)
                .map(([key, msg]) => ({ id: key, ...msg }))
                .sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));

            // Merge into persistent cache without wiping older history
            let memCached = riderChatMemoryCache.get(custId) || [];
            const map = new Map(memCached.map(m => [m.id, m]));
            allMsgs.forEach(m => map.set(m.id, m));
            const merged = Array.from(map.values()).sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
            riderChatMemoryCache.set(custId, merged);
            idbSet('chats', custId, merged).catch(() => {});

            const latestMsgInAll = allMsgs[allMsgs.length - 1];
            const lastLoadedMsg = Array.from(loadedRiderMsgsMap.values()).pop();
            const hasNewerMessages = !lastLoadedMsg || 
                (latestMsgInAll && !loadedRiderMsgsMap.has(latestMsgInAll.id)) ||
                (latestMsgInAll && lastLoadedMsg && getMessageTimestamp(latestMsgInAll) > getMessageTimestamp(lastLoadedMsg));

            if (!hasLocalRecord || loadedRiderMsgsMap.size === 0 || hasNewerMessages) {
                // Strictly display only the last 10 messages on initial open
                const displayChunk = allMsgs.slice(-RIDER_CHAT_BATCH_SIZE);
                loadedRiderMsgsMap.clear();
                displayChunk.forEach(m => loadedRiderMsgsMap.set(m.id, m));
                hasMoreRiderMsgs = merged.length > displayChunk.length || allMsgs.length >= RIDER_CHAT_BATCH_SIZE;
                if (displayChunk.length > 0) {
                    oldestRiderMsgTimestamp = getMessageTimestamp(displayChunk[0]);
                    oldestRiderMsgKey = displayChunk[0].id || null;
                }
                renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, true, 0, activeCustData);
                isInitialScrollDone = true;
                requestAnimationFrame(() => {
                    container.scrollTop = container.scrollHeight;
                    setTimeout(() => { container.scrollTop = container.scrollHeight; }, 60);
                    setTimeout(() => { container.scrollTop = container.scrollHeight; }, 180);
                });
                autoResolveRecentFbCustomerReplies(custId, container, activeCustData);
                autoResolveRecentFbCustomerAttachments(custId, container, activeCustData);
            } else {
                hasMoreRiderMsgs = merged.length > loadedRiderMsgsMap.size || allMsgs.length >= RIDER_CHAT_BATCH_SIZE;
            }
        }
    });

    // 1. Lightning-fast child_added: streams each incoming/sent message individually in milliseconds (<50ms)
    activeRiderChatChildListener = messagesQuery;
    activeRiderChatChildListener.on('child_added', (childSnap) => {
        if (activeRiderChatCustId !== custId) return;
        const key = childSnap.key;
        const msg = childSnap.val();
        if (!key || !msg) return;

        const fullMsg = { id: key, ...msg };
        const msgTs = getMessageTimestamp(fullMsg);

        // Keep master RAM cache & IndexedDB updated
        let memCached = riderChatMemoryCache.get(custId) || [];
        const existingIdx = memCached.findIndex(m => m.id === key);
        if (existingIdx >= 0) {
            memCached[existingIdx] = fullMsg;
        } else {
            memCached.push(fullMsg);
        }
        memCached.sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
        riderChatMemoryCache.set(custId, memCached);
        idbSet('chats', custId, memCached).catch(() => {});

        // If message is already rendered in the current DOM view:
        if (loadedRiderMsgsMap.has(key)) {
            loadedRiderMsgsMap.set(key, fullMsg);
            appendOrUpdateSingleRiderMessage(container, fullMsg, activeCustData);
            if (String(custId).startsWith('fb_') && !fullMsg.imageUrl && fullMsg.text && (fullMsg.text.includes('[Facebook image]') || fullMsg.text.includes('[Facebook attachment]'))) {
                triggerInstantFbAttachmentResolution(custId, fullMsg, container, activeCustData);
            }
            return;
        }

        // If initial 10-message slice is already rendered, ignore any older historical message
        if (isInitialScrollDone && oldestRiderMsgTimestamp && msgTs > 0 && msgTs < oldestRiderMsgTimestamp) {
            hasMoreRiderMsgs = true;
            return;
        }

        const isNew = !loadedRiderMsgsMap.has(key);
        loadedRiderMsgsMap.set(key, fullMsg);

        if (oldestRiderMsgTimestamp === null || msgTs < oldestRiderMsgTimestamp) {
            oldestRiderMsgTimestamp = msgTs;
            oldestRiderMsgKey = key;
        }

        const isFromCustomer = !msg.isRider && msg.senderType !== 'rider';

        // Auto-mark seen for incoming customer messages
        if (isFromCustomer && msg.status !== 'seen' && db) {
            msg.status = 'seen';
            const now = Date.now();
            const seenUpdates = {};
            seenUpdates[`customerChats/${custId}/messages/${key}/status`] = 'seen';
            seenUpdates[`customerChats/${custId}/messages/${key}/seenAt`] = now;
            db.ref().update(seenUpdates).catch(() => {});
        }

        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 140;
        const isRecentlyOpened = (Date.now() - openSessionTime) < 4000;
        const shouldScroll = isNearBottom || isRecentlyOpened;

        if (!isInitialScrollDone) {
            renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, true, 0, activeCustData);
            isInitialScrollDone = true;
            requestAnimationFrame(() => {
                container.scrollTop = container.scrollHeight;
                setTimeout(() => { container.scrollTop = container.scrollHeight; }, 60);
            });
            autoResolveRecentFbCustomerReplies(custId, container, activeCustData);
            autoResolveRecentFbCustomerAttachments(custId, container, activeCustData);
        } else {
            appendOrUpdateSingleRiderMessage(container, fullMsg, activeCustData);

            // Proactively resolve incoming Facebook photo attachment immediately
            if (String(custId).startsWith('fb_') && !fullMsg.imageUrl && fullMsg.text && (fullMsg.text.includes('[Facebook image]') || fullMsg.text.includes('[Facebook attachment]'))) {
                triggerInstantFbAttachmentResolution(custId, fullMsg, container, activeCustData);
            }

            if (isNew && isFromCustomer) {
                const isCatered = !!(currentRiderChatMeta?.cateredByRiderName || currentRiderChatMeta?.cateredByRiderId || currentRiderChatMeta?.cateredBy || (currentRiderChatMeta?.folder || '').toLowerCase() === 'catering');
                const isMine = isMyCustomerThread({ custId, ...(currentRiderChatMeta || {}) });
                if (isCatered) {
                    if (isMine) playChatChime('catering');
                } else {
                    playChatChime('inbox');
                }

                if (shouldScroll) {
                    requestAnimationFrame(() => { 
                        container.scrollTop = container.scrollHeight;
                        setTimeout(() => { container.scrollTop = container.scrollHeight; }, 60);
                    });
                } else {
                    const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";
                    const preview = fullMsg.text || (fullMsg.imageUrl ? "📷 Photo" : "📍 Location");
                    showRiderInChatToast(container, fullMsg.sender || custName, preview);
                }
            } else if (shouldScroll) {
                requestAnimationFrame(() => { 
                    container.scrollTop = container.scrollHeight;
                    setTimeout(() => { container.scrollTop = container.scrollHeight; }, 60);
                });
            }
        }
    });

    // 2. Immediate child_changed for reactions, status, or edited text on base messages ref
    activeRiderChatChangedListener = db.ref(`customerChats/${custId}/messages`);
    activeRiderChatChangedListener.on('child_changed', (childSnap) => {
        if (activeRiderChatCustId !== custId) return;
        const key = childSnap.key;
        const msg = childSnap.val();
        if (!key || !msg) return;

        const fullMsg = { id: key, ...msg };

        let memCached = riderChatMemoryCache.get(custId) || [];
        const existingIdx = memCached.findIndex(m => m.id === key);
        if (existingIdx >= 0) {
            memCached[existingIdx] = fullMsg;
        } else {
            memCached.push(fullMsg);
        }
        memCached.sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
        riderChatMemoryCache.set(custId, memCached);
        idbSet('chats', custId, memCached).catch(() => {});

        if (loadedRiderMsgsMap.has(key)) {
            loadedRiderMsgsMap.set(key, fullMsg);
            appendOrUpdateSingleRiderMessage(container, fullMsg, activeCustData);
            if (String(custId).startsWith('fb_') && !fullMsg.imageUrl && fullMsg.text && (fullMsg.text.includes('[Facebook image]') || fullMsg.text.includes('[Facebook attachment]'))) {
                triggerInstantFbAttachmentResolution(custId, fullMsg, container, activeCustData);
            }
        }
    });
}

/**
 * Instant Bridge: When customerChatMeta receives an update for the currently active thread,
 * immediately synchronizes the new message to eliminate any delay between feed and open thread.
 */
export function syncIncomingMessageFromMeta(custId, meta) {
    if (!custId || activeRiderChatCustId !== custId || !db) return;
    const container = document.getElementById('rider-cust-chat-messages') || document.getElementById('rider-chat-messages-container');
    if (!container) return;

    const msgs = Array.from(loadedRiderMsgsMap.values());
    const lastLoaded = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    const lastLoadedText = (lastLoaded?.text || lastLoaded?.message || '').trim();
    const metaLastText = (meta?.lastMessage || meta?.text || '').trim();

    const isDifferentText = Boolean(metaLastText && metaLastText !== lastLoadedText);
    const isNewId = Boolean(meta?.lastMessageId && !loadedRiderMsgsMap.has(meta.lastMessageId));
    const lastMsgTime = Number(meta?.lastUpdated) || Number(meta?.timestamp) || 0;
    const newestLoadedTime = msgs.length > 0 ? Math.max(...msgs.map(m => getMessageTimestamp(m))) : 0;
    const isNewerTime = Boolean(lastMsgTime > 0 && lastMsgTime > (newestLoadedTime - 3000));

    // If metadata indicates a newer message than what we currently have in memory:
    if (isDifferentText || isNewId || isNewerTime) {
        db.ref(`customerChats/${custId}/messages`).orderByChild('timestamp').limitToLast(10).once('value', (snap) => {
            if (activeRiderChatCustId !== custId) return;
            const data = snap.val();
            if (data && typeof data === 'object') {
                const recentMsgs = Object.entries(data)
                    .map(([key, msg]) => ({ id: key, ...msg }))
                    .sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));

                let memCached = riderChatMemoryCache.get(custId) || [];
                const map = new Map(memCached.map(m => [m.id, m]));
                recentMsgs.forEach(m => map.set(m.id, m));
                const merged = Array.from(map.values()).sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
                riderChatMemoryCache.set(custId, merged);
                idbSet('chats', custId, merged).catch(() => {});

                let hasAppended = false;
                recentMsgs.forEach(fullMsg => {
                    const ts = getMessageTimestamp(fullMsg);
                    // Only append if it's truly a newer incoming message, never an older past message
                    if (!loadedRiderMsgsMap.has(fullMsg.id) && (newestLoadedTime === 0 || ts >= (newestLoadedTime - 3000))) {
                        loadedRiderMsgsMap.set(fullMsg.id, fullMsg);
                        appendOrUpdateSingleRiderMessage(container, fullMsg, activeCustData);
                        hasAppended = true;
                    }
                });

                if (hasAppended) {
                    requestAnimationFrame(() => { 
                        container.scrollTop = container.scrollHeight; 
                        setTimeout(() => { container.scrollTop = container.scrollHeight; }, 60);
                    });
                    autoResolveRecentFbCustomerReplies(custId, container, activeCustData);
                    autoResolveRecentFbCustomerAttachments(custId, container, activeCustData);
                }
            }
        });
    }
}

function setupRiderScrollPagination(container, custId) {
    container.onscroll = () => {
        const now = Date.now();
        if (
            isInitialScrollDone &&
            container.scrollTop < 60 &&
            !isLoadingRiderHistory &&
            hasMoreRiderMsgs &&
            (now - lastPaginationRequestTime > 400)
        ) {
            lastPaginationRequestTime = now;
            loadOlderRiderMessages(container, custId);
        }

        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
        if (isNearBottom) {
            hideRiderInChatToast();
        }
    };
}

export async function loadOlderRiderMessages(container, custId) {
    if (!container) {
        container = document.getElementById('rider-cust-chat-messages') || document.getElementById('rider-chat-messages-container');
    }
    const targetCustId = custId || activeRiderChatCustId;
    if (!container || !targetCustId || isLoadingRiderHistory || !hasMoreRiderMsgs) return;

    isLoadingRiderHistory = true;
    showRiderTopSpinner(container);

    const oldScrollHeight = container.scrollHeight;

    // 1. Instant cache check: if we already have older messages in memory from IndexedDB, load the previous 10 instantly
    let memCached = riderChatMemoryCache.get(targetCustId);
    if (!memCached || memCached.length === 0) {
        try {
            const idbCached = await idbGet('chats', targetCustId);
            if (Array.isArray(idbCached) && idbCached.length > 0) {
                memCached = idbCached;
                riderChatMemoryCache.set(targetCustId, idbCached);
            }
        } catch (_) {}
    }

    if (Array.isArray(memCached) && memCached.length > 0) {
        const unrenderedCached = memCached
            .filter(m => m && m.id && !loadedRiderMsgsMap.has(m.id) && (!oldestRiderMsgTimestamp || getMessageTimestamp(m) <= oldestRiderMsgTimestamp))
            .sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));

        if (unrenderedCached.length > 0) {
            const nextBatch = unrenderedCached.slice(-RIDER_CHAT_OLDER_BATCH_SIZE);
            nextBatch.forEach(m => loadedRiderMsgsMap.set(m.id, m));
            const sortedMsgs = Array.from(loadedRiderMsgsMap.values()).sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
            if (sortedMsgs.length > 0) {
                oldestRiderMsgTimestamp = getMessageTimestamp(sortedMsgs[0]);
                oldestRiderMsgKey = sortedMsgs[0].id || null;
            }
            hideRiderTopSpinner();
            hasMoreRiderMsgs = unrenderedCached.length > nextBatch.length;
            isLoadingRiderHistory = false;
            renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, false, oldScrollHeight, activeCustData);
            return;
        }
    }

    try {
        if (!oldestRiderMsgKey) {
            hasMoreRiderMsgs = false;
            hideRiderTopSpinner();
            isLoadingRiderHistory = false;
            renderRiderMessages(container, loadedRiderMsgsMap, false, false, oldScrollHeight, activeCustData);
            return;
        }

        let snap;
        if (oldestRiderMsgTimestamp && oldestRiderMsgTimestamp > 0) {
            snap = await db.ref(`customerChats/${targetCustId}/messages`)
                .orderByChild('timestamp')
                .endAt(oldestRiderMsgTimestamp)
                .limitToLast(RIDER_CHAT_OLDER_BATCH_SIZE + 1)
                .once('value');
        } else {
            snap = await db.ref(`customerChats/${targetCustId}/messages`)
                .orderByKey()
                .endAt(oldestRiderMsgKey)
                .limitToLast(RIDER_CHAT_OLDER_BATCH_SIZE + 1)
                .once('value');
        }
        const data = snap.val() || {};
        hideRiderTopSpinner();

        if (oldestRiderMsgKey && data[oldestRiderMsgKey]) {
            delete data[oldestRiderMsgKey];
        }
        Object.keys(data).forEach(k => {
            if (loadedRiderMsgsMap.has(k)) delete data[k];
        });

        const entries = Object.entries(data);
        if (entries.length === 0) {
            hasMoreRiderMsgs = false;
            isLoadingRiderHistory = false;
            renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, false, oldScrollHeight, activeCustData);
            return;
        }

        const olderMsgs = entries
            .map(([key, msg]) => ({ id: key, ...msg }))
            .sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));

        // Merge older messages into persistent cache
        let cached = riderChatMemoryCache.get(targetCustId) || [];
        const map = new Map(cached.map(m => [m.id, m]));
        olderMsgs.forEach(m => map.set(m.id, m));
        const merged = Array.from(map.values()).sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
        riderChatMemoryCache.set(targetCustId, merged);
        idbSet('chats', targetCustId, merged).catch(() => {});

        olderMsgs.forEach(m => loadedRiderMsgsMap.set(m.id, m));

        // Auto-resolve missing Facebook image attachment from Graph API for newly loaded history
        if (String(targetCustId).startsWith('fb_')) {
            olderMsgs.forEach(msg => {
                if (!msg.imageUrl && msg.text && (msg.text.includes('[Facebook image]') || msg.text.includes('[Facebook attachment]'))) {
                    triggerInstantFbAttachmentResolution(targetCustId, msg, container, activeCustData);
                }
            });
        }

        const sortedMsgs = Array.from(loadedRiderMsgsMap.values()).sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
        if (sortedMsgs.length > 0) {
            oldestRiderMsgTimestamp = getMessageTimestamp(sortedMsgs[0]);
            oldestRiderMsgKey = sortedMsgs[0].id || null;
        }
        hasMoreRiderMsgs = entries.length >= RIDER_CHAT_OLDER_BATCH_SIZE;

        renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, false, oldScrollHeight, activeCustData);
    } catch (e) {
        console.error("Error loading older rider chat messages:", e);
        hideRiderTopSpinner();
    } finally {
        isLoadingRiderHistory = false;
    }
}

export function setRiderReply(msgId, senderName, text) {
    let previewText = text;
    let targetMsg = null;
    if (loadedRiderMsgsMap && loadedRiderMsgsMap.has(msgId)) {
        targetMsg = loadedRiderMsgsMap.get(msgId);
    }
    if (!previewText && targetMsg) {
        previewText = targetMsg.text || (targetMsg.imageUrl ? "📷 Photo" : (targetMsg.locationCoords ? "📍 Location" : "Message"));
    }
    if (!previewText) previewText = "Quoted Message";

    activeRiderReplyTarget = { 
        id: msgId, 
        sender: senderName, 
        text: previewText,
        metaMid: targetMsg?.metaMid || null,
        mid: targetMsg?.mid || null
    };
    
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
                    <div class="text-gray-600 dark:text-gray-300 truncate text-[10px]">${escapeHtml(previewText)}</div>
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
        const willReact = !snap.exists();
        if (willReact) {
            await ref.set(true);
        } else {
            await ref.remove();
        }

        // Vis-a-vis reaction forwarding for Facebook Messenger threads
        if (String(activeRiderChatCustId).startsWith('fb_')) {
            forwardRiderReactionToMessenger({
                custId: activeRiderChatCustId,
                msgId: msgId,
                emoji: emoji,
                action: willReact ? 'react' : 'unreact'
            });
        }
    } catch(e) {
        console.error("Error toggling rider reaction:", e);
    }
}

export async function forwardRiderReactionToMessenger({ custId, msgId, emoji, action = 'react' }) {
    try {
        const cleanPsid = String(custId || '').replace(/^fb_/, '');
        if (!cleanPsid || !msgId) return;

        // Find the actual Facebook mid from loaded messages or fetch from db
        let fbMid = msgId;
        const msg = loadedRiderMsgsMap.get(msgId);
        // Meta Graph API explicitly rejects Pages reacting to their own messages (Error subcode 2018468)
        if (msg && (msg.isRider || msg.sender === 'rider' || msg.sender === 'bot')) {
            return;
        }
        if (msg) {
            fbMid = msg.metaMid || msg.mid || msgId;
        }
        if (fbMid && fbMid.startsWith('mid__')) {
            fbMid = fbMid.replace(/^mid__/, 'mid.$');
        }

        const apiId = currentRiderChatMeta?.apiId || currentRiderChatMeta?.channelId || null;
        const token = (typeof getFbPageAccessToken === 'function') 
            ? await getFbPageAccessToken(apiId) 
            : null;

        let sent = false;
        if (token && fbMid) {
            const body = {
                recipient: { id: cleanPsid },
                sender_action: action,
                payload: {
                    message_id: fbMid
                }
            };
            if (action === 'react' && emoji) {
                body.payload.reaction = emoji;
            }

            try {
                const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                if (res.ok) sent = true;
            } catch (e) {
                console.warn("Direct Meta reaction call failed, fallback will be used:", e);
            }
        }

        // Fallback to Cloudflare Worker endpoint if direct call wasn't made or failed
        if (!sent && fbMid) {
            const sendReactionEndpoint = "https://lokalex-messenger-webhook.lokaledeliver.workers.dev/api/send-reaction";
            try {
                await fetch(sendReactionEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        recipientId: cleanPsid,
                        mid: fbMid,
                        emoji: emoji || '',
                        action: action,
                        apiId: apiId
                    })
                });
            } catch (e) {
                // Ignore offline / worker network glitch
            }
        }
    } catch(err) {
        console.warn("forwardRiderReactionToMessenger error:", err);
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

    // Check active roster catering list for current rider
    const myCateringCusts = (typeof window.getMyCateringCustomers === 'function') ? window.getMyCateringCustomers() : [];
    const custDisplayName = (currentRiderChatMeta.customerName || currentRiderChatMeta.name || '').trim();
    const isCustomerInMyList = myCateringCusts.some(c => c.toLowerCase() === custDisplayName.toLowerCase() || (typeof isCustomerMatch === 'function' && isCustomerMatch(c, custDisplayName)));

    const isCateringRider = (cateredRiderId && cateredRiderId === myId) || (cateredRiderName && cateredRiderName === myName) || isCustomerInMyList;
    
    const isUserAdmin = (typeof isAdmin === 'function' && isAdmin()) ||
                        (typeof canManageRoster === 'function' && canManageRoster()) ||
                        (typeof window.isAdmin === 'function' && window.isAdmin()) ||
                        (typeof window.canManageRoster === 'function' && window.canManageRoster()) ||
                        Boolean(globalState.adminControlsEnabled);

    const isLocked = (cateredRiderId || cateredRiderName) && !isCateringRider && !isUserAdmin;

    const caterBtn = document.getElementById('rider-chat-cater-btn');
    const cancelBtn = document.getElementById('rider-chat-cancel-btn');
    const goCartBtn = document.getElementById('rider-chat-go-cart-btn');

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
        if (goCartBtn) goCartBtn.classList.add('hidden');
    } else {
        if (lockBanner) {
            if (isCateringRider) {
                lockBanner.classList.remove('hidden');
                lockBanner.className = "bg-emerald-50 dark:bg-emerald-950/40 border-b-2 border-emerald-500 px-3 py-1.5 text-[11px] text-emerald-800 dark:text-emerald-300 font-bold text-center shrink-0 flex items-center justify-between gap-1.5";
                lockBanner.innerHTML = `<span class="truncate"><i class="fa-solid fa-user-check text-emerald-600"></i> Kasalukuyan mong kinacater ang customer na ito.</span>
                <button type="button" onclick="window.goToCustomerCartFromChat && window.goToCustomerCartFromChat()" class="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black px-2.5 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 shadow-xs cursor-pointer shrink-0">
                    <i class="fa-solid fa-cart-shopping"></i> Go to Cart
                </button>`;
            } else if (isUserAdmin && (cateredRiderId || cateredRiderName)) {
                lockBanner.classList.remove('hidden');
                lockBanner.className = "bg-amber-50 dark:bg-amber-500/20 border-b border-amber-200 dark:border-amber-500/40 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300 font-bold text-center shrink-0";
                lockBanner.innerHTML = `⚡ Admin Mode — Replying as Admin (Catered by ${escapeHtml(currentRiderChatMeta.cateredByRiderName || currentRiderChatMeta.cateredBy)}).`;
            } else {
                lockBanner.classList.add('hidden');
            }
        }
        if (inputEl) inputEl.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        if (actionToolbar) actionToolbar.classList.remove('opacity-50', 'pointer-events-none');
        if (caterBtn) caterBtn.classList.remove('hidden');
        if (cancelBtn) cancelBtn.classList.remove('hidden');

        const modalDialog = document.querySelector('#rider-chat-modal > div') || document.querySelector('#rider-customer-chat-modal > div');
        if (modalDialog) {
            modalDialog.classList.remove('ring-2', 'ring-emerald-500', 'border-emerald-500', 'catering-glow-my', 'catering-glow-other', 'catering-glow-gold');
            if (isCateringRider) {
                modalDialog.classList.add('catering-glow-gold');
            }
        }

        if (isCateringRider) {
            if (caterBtn) caterBtn.classList.add('hidden');
            if (cancelBtn) cancelBtn.classList.remove('hidden');
            if (goCartBtn) goCartBtn.classList.remove('hidden');
        } else {
            const activeRole = localStorage.getItem('lokalex_active_role');
            const isRiderLoggedIn = Boolean(myId && myName && activeRole === 'rider');
            if (caterBtn) {
                if (isRiderLoggedIn || isUserAdmin) {
                    caterBtn.classList.remove('hidden');
                } else {
                    caterBtn.classList.add('hidden');
                }
            }
            if (cancelBtn) cancelBtn.classList.add('hidden');
            if (goCartBtn) goCartBtn.classList.add('hidden');
        }
    }
}

export function closeRiderChatModal() {
    closeRiderCustomerChatModal();
}

export function closeRiderCustomerChatModal() {
    if (activeRiderChatCustId) {
        saveCurrentThreadDraft(activeRiderChatCustId);
    }
    const input = document.getElementById('rider-chat-input') || document.getElementById('rider-cust-chat-input');
    if (input) {
        input.value = "";
        input.style.height = 'auto';
    }

    const modal = document.getElementById('rider-chat-modal') || document.getElementById('rider-customer-chat-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }

    if (activeRiderChatListener) {
        if (typeof activeRiderChatListener.off === 'function') activeRiderChatListener.off();
        activeRiderChatListener = null;
    }
    if (activeRiderChatChildListener) {
        if (typeof activeRiderChatChildListener.off === 'function') activeRiderChatChildListener.off();
        activeRiderChatChildListener = null;
    }
    if (activeRiderChatChangedListener) {
        if (typeof activeRiderChatChangedListener.off === 'function') activeRiderChatChangedListener.off();
        activeRiderChatChangedListener = null;
    }
    if (activeRiderChatMetaListener) {
        if (typeof activeRiderChatMetaListener.off === 'function') activeRiderChatMetaListener.off();
        activeRiderChatMetaListener = null;
    }
    activeRiderChatCustId = null;
    if (typeof window !== 'undefined') {
        window.activeRiderChatCustId = null;
    }
    currentRiderChatMeta = null;

    oldestRiderMsgTimestamp = null;
    hasMoreRiderMsgs = true;
    isLoadingRiderHistory = false;
    loadedRiderMsgsMap.clear();
    cancelRiderReply();

    if (typeof window !== 'undefined' && typeof window.renderRiderCustomerChatFeed === 'function') {
        window.renderRiderCustomerChatFeed();
    }
}

export function sendRiderChatMessage(content = null, type = 'text', explicitCustId = null) {
    sendRiderToCustomerChat(content, type === 'image' ? content : null, null, explicitCustId);
}

export async function sendRiderToCustomerChat(customText = "", customImageUrl = null, customLocationCoords = null, explicitCustId = null, customDoc = null) {
    // Freeze target customer ID immediately so background operations never divert to another thread!
    const targetCustId = explicitCustId || activeRiderChatCustId;
    if (!targetCustId) return;

    const input1 = document.getElementById('rider-chat-input');
    const input2 = document.getElementById('rider-cust-chat-input');
    const val1 = input1 ? input1.value.trim() : "";
    const val2 = input2 ? input2.value.trim() : "";
    const savedDraft = threadDraftsMap.get(targetCustId) || "";
    const text = (typeof customText === 'string' && customText.trim()) ? customText.trim() : (val1 || val2 || savedDraft);

    if (!text && !customImageUrl && !customLocationCoords && !customDoc) return;

    // Clear inputs and remove draft for target thread immediately
    if (!customText) {
        if (targetCustId === activeRiderChatCustId) {
            if (input1) {
                input1.value = "";
                input1.style.height = 'auto';
            }
            if (input2) {
                input2.value = "";
                input2.style.height = 'auto';
            }
        }
    }
    threadDraftsMap.delete(targetCustId);

    // Freeze reply target snapshot
    const replyTargetSnapshot = (targetCustId === activeRiderChatCustId && activeRiderReplyTarget)
        ? { ...activeRiderReplyTarget }
        : null;
    if (targetCustId === activeRiderChatCustId) {
        cancelRiderReply();
    }

    // Freeze metadata snapshot
    let targetMeta = null;
    if (targetCustId === activeRiderChatCustId && currentRiderChatMeta) {
        targetMeta = { ...currentRiderChatMeta };
    } else if (typeof window.getCachedCustomerThreadsMap === 'function') {
        const tMap = window.getCachedCustomerThreadsMap();
        if (tMap && tMap.has(targetCustId)) targetMeta = { ...tMap.get(targetCustId) };
    }
    if (!targetMeta && db) {
        try {
            const mSnap = await db.ref(`customerChatMeta/${targetCustId}`).once('value');
            if (mSnap.exists()) targetMeta = mSnap.val();
        } catch (_) {}
    }

    const targetCustDataSnapshot = (targetCustId === activeRiderChatCustId && activeCustData)
        ? { ...activeCustData }
        : null;

    const riderName = appState.riderName || localStorage.getItem('riderName') || "Lokalex Rider";
    const now = Date.now();

    // Isolated photo upload for target customer thread
    let finalImageUrl = customImageUrl;
    if (customImageUrl && customImageUrl.startsWith('data:')) {
        showToast("⏳ Uploading photo...");
        try {
            finalImageUrl = await uploadImage(customImageUrl, `chats/${targetCustId}/${now}.jpg`);
        } catch (e) {
            console.warn("Chat image upload fallback:", e);
        }
    }

    const isFb = String(targetCustId).startsWith('fb_');
    const targetChannel = targetMeta?.channel || (isFb ? 'messenger' : 'web');
    const targetApiId = targetMeta?.apiId || targetMeta?.channelId || null;
    const myPhoto = appState.photoUrl || localStorage.getItem('lokalex_photo_url') || localStorage.getItem('riderPhotoUrl') || null;

    const newMsg = {
        sender: riderName,
        senderType: 'rider',
        senderAvatar: myPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(riderName)}&background=3B82F6&color=fff`,
        avatarUrl: myPhoto || null,
        text: text,
        timestamp: now,
        isRider: true,
        status: 'sent',
        channel: targetChannel,
        apiId: targetApiId,
        deliveredAt: null,
        seenAt: null
    };

    if (replyTargetSnapshot) {
        const targetText = replyTargetSnapshot.text || (replyTargetSnapshot.imageUrl ? "📷 Photo" : (replyTargetSnapshot.locationCoords ? "📍 Location" : "Message"));
        newMsg.replyTo = {
            id: replyTargetSnapshot.id,
            sender: replyTargetSnapshot.sender || "User",
            text: String(targetText).substring(0, 120)
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
    if (customDoc) {
        newMsg.fileUrl = customDoc.fileUrl;
        newMsg.fileName = customDoc.fileName || 'Document';
        newMsg.fileSize = customDoc.fileSize || 0;
        newMsg.fileType = customDoc.fileType || 'file';
        newMsg.type = 'file';
        if (!newMsg.text) {
            newMsg.text = customDoc.fileName || 'Document';
        }
    }

    let newMsgKey = null;
    if (db) {
        try {
            const pushRef = db.ref(`customerChats/${targetCustId}/messages`).push();
            newMsgKey = pushRef ? pushRef.key : null;
            if (pushRef) {
                await pushRef.set(sanitizeForFirebase(newMsg));
            }
            if (newMsgKey) {
                const fullNewMsg = { id: newMsgKey, ...newMsg };

                // Always update persistent cache for this customer
                let targetMemCached = riderChatMemoryCache.get(targetCustId);
                if (!Array.isArray(targetMemCached)) targetMemCached = [];
                targetMemCached.push(fullNewMsg);
                targetMemCached.sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
                riderChatMemoryCache.set(targetCustId, targetMemCached);
                idbSet('chats', targetCustId, targetMemCached).catch(() => {});

                // Update active viewing container if rider is still in this thread
                if (activeRiderChatCustId === targetCustId) {
                    loadedRiderMsgsMap.set(newMsgKey, fullNewMsg);
                    const container = document.getElementById('rider-chat-messages-container') || document.getElementById('rider-cust-chat-messages');
                    if (container) {
                        appendOrUpdateSingleRiderMessage(container, fullNewMsg, activeCustData);
                        requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
                    }
                }
            }
            const currentName = targetCustDataSnapshot?.name || targetCustDataSnapshot?.customerName || targetMeta?.customerName;
            const lastSummary = customDoc 
                ? `📄 ${customDoc.fileName || 'Document'}` 
                : (text || (finalImageUrl ? "📷 Photo" : "📍 Location"));
            const metaPayload = sanitizeForFirebase({
                lastMessage: `You: ${lastSummary}`,
                lastUpdated: now,
                unreadForRider: false
            });
            if (currentName) {
                metaPayload.customerName = currentName;
            } else if (targetCustId.startsWith('cust_')) {
                const ext = targetCustId.replace(/^cust_/, '').replace(/_/g, ' ').trim();
                if (ext) metaPayload.customerName = ext.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
            }
            await Promise.all([
                db.ref(`customerChats/${targetCustId}/metadata`).update(metaPayload),
                db.ref(`customerChatMeta/${targetCustId}`).update(metaPayload)
            ]).catch(() => {});
        } catch (dbErr) {
            console.warn("Failed pushing chat message to db:", dbErr);
        }
    }

    const replyTargetMid = replyTargetSnapshot?.metaMid || replyTargetSnapshot?.mid || replyTargetSnapshot?.id || null;
    const cleanReplyMid = (replyTargetMid && replyTargetMid.startsWith('mid__')) ? replyTargetMid.replace(/^mid__/, 'mid.$') : replyTargetMid;
    const replyTargetText = replyTargetSnapshot?.text || (replyTargetSnapshot?.imageUrl ? "📷 Photo" : "");

    // Forward reply to Facebook Messenger customer if thread is from Facebook
    if (targetChannel === 'messenger' || isFb) {
        forwardRiderReplyToMessenger({
            custId: targetCustId,
            apiId: targetApiId,
            text: text,
            imageUrl: finalImageUrl,
            fileUrl: customDoc?.fileUrl || null,
            fileName: customDoc?.fileName || null,
            locationCoords: customLocationCoords,
            riderName: riderName,
            replyToMid: cleanReplyMid,
            replyToText: replyTargetText,
            newMsgKey: newMsgKey
        }).catch(err => console.warn("forwardRiderReplyToMessenger error:", err));
    }

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
 * Directly sends a menu photo to a specific customer thread (Firebase RTDB + Messenger)
 */
export async function sendDirectMenuPhotoToCustomer(targetCustId, imageUrl, captionText = "") {
    const cleanCustId = String(targetCustId || '').trim();
    if (!cleanCustId || cleanCustId === 'undefined' || cleanCustId === 'null' || !imageUrl || !db) {
        console.warn("[MenuSend] Aborted: Invalid targetCustId or imageUrl:", { targetCustId, imageUrl });
        return false;
    }

    const riderName = appState.riderName || localStorage.getItem('riderName') || "Lokalex Rider";
    const now = Date.now();
    const myPhoto = appState.photoUrl || localStorage.getItem('lokalex_photo_url') || localStorage.getItem('riderPhotoUrl') || null;

    const isFb = cleanCustId.startsWith('fb_');
    const targetChannel = isFb ? 'messenger' : 'web';

    let targetApiId = null;
    let custName = null;
    try {
        const metaSnap = await db.ref(`customerChatMeta/${cleanCustId}`).once('value');
        if (metaSnap.exists()) {
            const m = metaSnap.val();
            targetApiId = m.apiId || m.channelId || null;
            custName = m.customerName || m.name || null;
        }
    } catch(e) {}

    if (!targetApiId) {
        try {
            const chatMetaSnap = await db.ref(`customerChats/${cleanCustId}/metadata`).once('value');
            if (chatMetaSnap.exists()) {
                const cm = chatMetaSnap.val();
                targetApiId = cm.apiId || cm.channelId || null;
                if (!custName) custName = cm.customerName || cm.name || null;
            }
        } catch(e) {}
    }

    if (!targetApiId && isFb) {
        targetApiId = 'fb_api_1791648211091';
    }

    const textPayload = captionText ? `📋 Menu: ${captionText}` : "📋 Restaurant Menu";

    const newMsg = {
        sender: riderName,
        senderType: 'rider',
        senderAvatar: myPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(riderName)}&background=3B82F6&color=fff`,
        avatarUrl: myPhoto || null,
        text: textPayload,
        imageUrl: imageUrl,
        type: 'image',
        timestamp: now,
        isRider: true,
        status: 'sent',
        channel: targetChannel,
        apiId: targetApiId,
        deliveredAt: null,
        seenAt: null
    };

    let newMsgKey = null;
    try {
        const pushRef = db.ref(`customerChats/${cleanCustId}/messages`).push();
        newMsgKey = pushRef ? pushRef.key : null;
        if (pushRef) {
            await pushRef.set(sanitizeForFirebase(newMsg));
        }

        const metaUpdate = sanitizeForFirebase({
            lastMessage: `You: 📋 ${captionText || "Menu Photo"}`,
            lastUpdated: now,
            unreadForRider: false
        });
        if (custName) {
            metaUpdate.customerName = custName;
        }

        await Promise.all([
            db.ref(`customerChats/${cleanCustId}/metadata`).update(metaUpdate),
            db.ref(`customerChatMeta/${cleanCustId}`).update(metaUpdate)
        ]).catch(() => {});

        const fullMsg = { id: newMsgKey || `MENU_${now}`, ...newMsg };

        // 1. ALWAYS update riderChatMemoryCache and IndexedDB for this customer,
        // whether the chat modal is currently open or not!
        let memCached = riderChatMemoryCache.get(cleanCustId);
        if (!Array.isArray(memCached) || memCached.length === 0) {
            try {
                const idbCached = await idbGet('chats', cleanCustId);
                if (Array.isArray(idbCached)) memCached = idbCached;
            } catch (_) {}
        }
        if (!Array.isArray(memCached)) memCached = [];
        const existingIdx = memCached.findIndex(m => m.id === fullMsg.id);
        if (existingIdx >= 0) {
            memCached[existingIdx] = fullMsg;
        } else {
            memCached.push(fullMsg);
        }
        memCached.sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
        riderChatMemoryCache.set(cleanCustId, memCached);
        idbSet('chats', cleanCustId, memCached).catch(() => {});

        // 2. If this chat is currently open, dynamically render it immediately
        if (activeRiderChatCustId === cleanCustId) {
            loadedRiderMsgsMap.set(fullMsg.id, fullMsg);
            const container = document.getElementById('rider-chat-messages-container') || document.getElementById('rider-cust-chat-messages');
            if (container) {
                appendOrUpdateSingleRiderMessage(container, fullMsg, activeCustData);
                requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
            }
        }

        // Forward to Messenger if thread is from Facebook
        if (isFb) {
            await forwardRiderReplyToMessenger({
                custId: cleanCustId,
                apiId: targetApiId,
                text: textPayload,
                imageUrl: imageUrl,
                riderName: riderName,
                newMsgKey: newMsgKey,
                suppressToast: true
            }).catch(err => console.warn("[MenuSend] forwardRiderReplyToMessenger error:", err));
        }

        return true;
    } catch(err) {
        console.error("[MenuSend] sendDirectMenuPhotoToCustomer failed:", err);
        return false;
    }
}

/**
 * Forwards outbound rider chat message directly to Facebook Messenger via the webhook bridge
 */
export async function forwardRiderReplyToMessenger({ custId, apiId, text, imageUrl, fileUrl, fileName, locationCoords, riderName, replyToMid, replyToText, newMsgKey, suppressToast = false }) {
    try {
        const cleanPsid = String(custId || '').replace(/^fb_/, '');
        if (!cleanPsid) return;

        const markDeliverySuccess = async (rawMid = null) => {
            if (!newMsgKey || !custId) return;
            const safeMid = rawMid ? String(rawMid).replace(/[.#$\[\]\/]/g, '_') : null;

            // 1. Immediately update loaded memory and cache
            const local = loadedRiderMsgsMap.get(newMsgKey);
            if (local) {
                local.status = 'sent';
                local.failed = false;
                local.failedReason = null;
                if (safeMid) {
                    local.mid = safeMid;
                    local.metaMid = rawMid;
                }
            }

            let memCached = riderChatMemoryCache.get(custId) || [];
            const memItem = memCached.find(m => m.id === newMsgKey);
            if (memItem) {
                memItem.status = 'sent';
                memItem.failed = false;
                memItem.failedReason = null;
                if (safeMid) {
                    memItem.mid = safeMid;
                    memItem.metaMid = rawMid;
                }
                idbSet('chats', custId, memCached).catch(() => {});
            }

            // 2. Immediately re-render the DOM bubble to clear "Sending failed • Retry"
            const container = document.getElementById('rider-chat-messages-container') || document.getElementById('rider-cust-chat-messages');
            if (container && local) {
                appendOrUpdateSingleRiderMessage(container, local, activeCustData);
            }

            // 3. Persist success status to Firebase RTDB
            if (db) {
                const updates = {
                    status: 'sent',
                    failed: null,
                    failedReason: null
                };
                if (safeMid) {
                    updates.mid = safeMid;
                    updates.metaMid = rawMid;
                }

                const promises = [
                    db.ref(`customerChats/${custId}/messages/${newMsgKey}`).update(updates)
                ];
                if (safeMid) {
                    promises.push(db.ref(`customerChats/${custId}/midIndex/${safeMid}`).set(newMsgKey));
                    promises.push(db.ref(`customerChats/${custId}/midIndex/${rawMid}`).set(newMsgKey));
                }
                await Promise.all(promises).catch(e => console.warn("Failed to record delivered status in RTDB:", e));
            }
        };

        const recordFbMid = markDeliverySuccess;

        const token = (typeof getFbPageAccessToken === 'function') 
            ? await getFbPageAccessToken(apiId) 
            : null;

        // 0. DIRECT DOCUMENT / FILE ATTACHMENT TO META GRAPH API
        if (fileUrl && token) {
            try {
                let sendResp = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messaging_type: 'RESPONSE',
                        recipient: { id: cleanPsid },
                        message: {
                            attachment: {
                                type: 'file',
                                payload: { url: fileUrl, is_reusable: true }
                            }
                        }
                    })
                });
                let sendData = await sendResp.json().catch(() => ({}));
                if (!sendResp.ok && sendData?.error?.code === 10) {
                    sendResp = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            messaging_type: 'MESSAGE_TAG',
                            tag: 'CONFIRMED_EVENT_UPDATE',
                            recipient: { id: cleanPsid },
                            message: {
                                attachment: {
                                    type: 'file',
                                    payload: { url: fileUrl, is_reusable: true }
                                }
                            }
                        })
                    });
                    sendData = await sendResp.json().catch(() => ({}));
                }
                if (sendResp.ok) {
                    recordFbMid(sendData?.message_id || null);
                    console.log("✅ Document delivered directly to Facebook Messenger!");
                    if (!suppressToast) showToast(`✅ Document (${fileName || 'file'}) sent to Messenger!`);
                    return;
                }
            } catch (docErr) {
                console.warn("Direct Facebook document send error:", docErr);
            }
        }

        // 1. DIRECT ATTACHMENT UPLOAD TO META GRAPH API (Instant, bypasses size limits, 100% reliable)
        if (imageUrl) {
            // Case A: Base64 data URL (Photo upload, canvas screenshot, receipt)
            if (imageUrl.startsWith('data:') && token) {
                try {
                    const blob = dataUrlToBlob(imageUrl);
                    if (blob) {
                        const formData = new FormData();
                        formData.append('message', JSON.stringify({
                            attachment: {
                                type: 'image',
                                payload: { is_reusable: true }
                            }
                        }));
                        const isPng = imageUrl.startsWith('data:image/png');
                        formData.append('filedata', blob, isPng ? 'receipt.png' : 'image.jpg');

                        const uploadResp = await fetch(`https://graph.facebook.com/v19.0/me/message_attachments?access_token=${token}`, {
                            method: 'POST',
                            body: formData
                        });

                        if (uploadResp.ok) {
                            const uploadData = await uploadResp.json();
                            const attachmentId = uploadData.attachment_id;
                            if (attachmentId) {
                                let sendResp = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        messaging_type: 'RESPONSE',
                                        recipient: { id: cleanPsid },
                                        message: {
                                            attachment: {
                                                type: 'image',
                                                payload: { attachment_id: attachmentId }
                                            }
                                        }
                                    })
                                });

                                let sendData = await sendResp.json().catch(() => ({}));

                                // Retry with MESSAGE_TAG if outside 24h window (error code 10)
                                if (!sendResp.ok && sendData?.error?.code === 10) {
                                    sendResp = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            messaging_type: 'MESSAGE_TAG',
                                            tag: 'CONFIRMED_EVENT_UPDATE',
                                            recipient: { id: cleanPsid },
                                            message: {
                                                attachment: {
                                                    type: 'image',
                                                    payload: { attachment_id: attachmentId }
                                                }
                                            }
                                        })
                                    });
                                    sendData = await sendResp.json().catch(() => ({}));
                                }

                                if (sendResp.ok) {
                                    recordFbMid(sendData?.message_id || null);
                                    console.log("✅ Photo delivered directly to Facebook Messenger via attachment_id!");
                                    if (text && typeof text === 'string' && text.trim()) {
                                        await forwardRiderReplyToMessenger({ custId, apiId, text: text.trim(), riderName, replyToMid, replyToText, newMsgKey, suppressToast });
                                    }
                                    if (!suppressToast) showToast("✅ Litrato naipadala sa customer sa Messenger!");
                                    return;
                                } else {
                                    console.warn("Direct Facebook attachment send returned error:", sendData);
                                }
                            }
                        } else {
                            const uploadErr = await uploadResp.json().catch(() => ({}));
                            console.warn("Direct Facebook attachment upload failed:", uploadErr);
                        }
                    }
                } catch (directErr) {
                    console.warn("Direct Facebook upload threw error, falling back to webhook bridge:", directErr);
                }
            } else if (imageUrl.startsWith('https://') && token) {
                // Case B: Public HTTPS Image URL
                try {
                    let sendResp = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            messaging_type: 'RESPONSE',
                            recipient: { id: cleanPsid },
                            message: {
                                attachment: {
                                    type: 'image',
                                    payload: { url: imageUrl, is_reusable: true }
                                }
                            }
                        })
                    });

                    let sendData = await sendResp.json().catch(() => ({}));

                    if (!sendResp.ok && sendData?.error?.code === 10) {
                        sendResp = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                messaging_type: 'MESSAGE_TAG',
                                tag: 'CONFIRMED_EVENT_UPDATE',
                                recipient: { id: cleanPsid },
                                message: {
                                    attachment: {
                                        type: 'image',
                                        payload: { url: imageUrl, is_reusable: true }
                                    }
                                }
                            })
                        });
                        sendData = await sendResp.json().catch(() => ({}));
                    }

                    if (sendResp.ok) {
                        recordFbMid(sendData?.message_id || null);
                        console.log("✅ HTTPS Photo delivered directly to Facebook Messenger!");
                        if (text && typeof text === 'string' && text.trim()) {
                            await forwardRiderReplyToMessenger({ custId, apiId, text: text.trim(), riderName, replyToMid, replyToText, newMsgKey, suppressToast });
                        }
                        if (!suppressToast) showToast("✅ Litrato naipadala sa customer sa Messenger!");
                        return;
                    }
                } catch (e) {
                    console.warn("Direct HTTPS photo send threw:", e);
                }
            }
        }

        // 2. DIRECT TEXT SENDING WITH NATIVE THREADED QUOTE
        if (text && typeof text === 'string' && text.trim() && token && !imageUrl && !locationCoords) {
            try {
                const sendText = text.trim();

                const sendPayload = {
                    messaging_type: 'RESPONSE',
                    recipient: { id: cleanPsid },
                    message: { text: sendText }
                };
                if (replyToMid) {
                    sendPayload.reply_to = { mid: replyToMid };
                }
                let sendResp = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(sendPayload)
                });
                let sendData = await sendResp.json().catch(() => ({}));

                // If Meta rejects the reply_to parameter (e.g. invalid mid or outside threading context), retry without reply_to
                if (!sendResp.ok && replyToMid && (sendData?.error?.message?.toLowerCase().includes('reply_to') || sendData?.error?.code === 100)) {
                    console.warn("Direct reply_to rejected by Meta, retrying without reply_to:", sendData?.error?.message);
                    sendResp = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            messaging_type: 'RESPONSE',
                            recipient: { id: cleanPsid },
                            message: { text: sendText }
                        })
                    });
                    sendData = await sendResp.json().catch(() => ({}));
                }

                if (!sendResp.ok && sendData?.error?.code === 10) {
                    const tagPayload = {
                        messaging_type: 'MESSAGE_TAG',
                        tag: 'CONFIRMED_EVENT_UPDATE',
                        recipient: { id: cleanPsid },
                        message: { text: sendText }
                    };
                    if (replyToMid) {
                        tagPayload.reply_to = { mid: replyToMid };
                    }
                    sendResp = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(tagPayload)
                    });
                    sendData = await sendResp.json().catch(() => ({}));
                }
                if (sendResp.ok) {
                    recordFbMid(sendData?.message_id || null);
                    console.log("✅ Text reply delivered directly to Facebook Messenger!");
                    if (!suppressToast) showToast("✅ Delivered to customer Messenger!");
                    return;
                }
            } catch (err) {
                console.warn("Direct text send to Meta failed, falling back to endpoint:", err);
            }
        }

        // 3. FALLBACK: WEBHOOK BRIDGE / CLOUDFLARE WORKER ENDPOINT
        let sendEndpoint = null;
        if (typeof getPublicFbSendEndpoint === 'function') {
            sendEndpoint = getPublicFbSendEndpoint(apiId);
        }
        if (!sendEndpoint && typeof window !== 'undefined' && typeof window.getPublicFbSendEndpoint === 'function') {
            sendEndpoint = window.getPublicFbSendEndpoint(apiId);
        }

        // Fallback 1: Fetch directly from active channel in RTDB
        if (!sendEndpoint && db && apiId) {
            const snap = await db.ref(`facebookChannels/${apiId}/sendEndpoint`).once('value').catch(() => null);
            sendEndpoint = snap?.val();
        }

        // Fallback 2: Any available sendEndpoint in RTDB
        if (!sendEndpoint && db) {
            const allSnap = await db.ref('facebookChannels').once('value').catch(() => null);
            const allVal = allSnap?.val() || {};
            const first = Object.values(allVal).find(c => c && c.sendEndpoint);
            if (first) sendEndpoint = first.sendEndpoint;
        }

        // Fallback 3: Production Cloudflare Worker endpoint
        if (!sendEndpoint) {
            sendEndpoint = "https://lokalex-messenger-webhook.lokaledeliver.workers.dev/api/send-reply";
        }

        let finalFbImageUrl = imageUrl;
        if (finalFbImageUrl && finalFbImageUrl.startsWith('data:')) {
            try {
                finalFbImageUrl = await uploadImage(finalFbImageUrl, `chats/${custId}/${Date.now()}.jpg`);
            } catch (err) {
                console.warn("[RiderChat] uploadImage before Messenger send failed:", err);
            }
        }
        const safeFbImageUrl = finalFbImageUrl || null;

        const resp = await fetch(sendEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipientId: cleanPsid,
                text: text || (fileUrl ? `📄 ${fileName || 'Document'}: ${fileUrl}` : ""),
                imageUrl: safeFbImageUrl,
                fileUrl: fileUrl || null,
                fileName: fileName || null,
                locationCoords: locationCoords,
                senderName: riderName,
                apiId: apiId,
                msgKey: newMsgKey || null,
                replyToMid: replyToMid || null,
                replyToText: replyToText || null
            })
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            let errMsg = 'Check Page permissions';
            try {
                const errData = JSON.parse(errText);
                errMsg = errData.error?.message || errData.error || errMsg;
            } catch (_) {
                if (errText.includes('502') || errText.includes('Bad Gateway')) {
                    errMsg = 'Server busy, please retry in a moment.';
                } else if (errText.length > 0 && errText.length < 80) {
                    errMsg = errText;
                }
            }
            console.warn("Facebook send reply error:", errMsg);
            showToast(`⚠️ Messenger delivery issue: ${errMsg}`);

            if (newMsgKey && custId && db) {
                db.ref(`customerChats/${custId}/messages/${newMsgKey}`).update({
                    status: 'failed',
                    failed: true,
                    failedReason: errMsg
                }).catch(() => {});
            }
            if (newMsgKey && loadedRiderMsgsMap.has(newMsgKey)) {
                const targetMsg = loadedRiderMsgsMap.get(newMsgKey);
                targetMsg.status = 'failed';
                targetMsg.failed = true;
                const container = document.getElementById('rider-chat-messages-container') || document.getElementById('rider-cust-chat-messages');
                if (container) appendOrUpdateSingleRiderMessage(container, targetMsg, activeCustData);
            }
        } else {
            const respData = await resp.json().catch(() => ({}));
            recordFbMid(respData?.message_id || respData?.mid || null);
            console.log("✅ Rider reply delivered to Facebook Messenger!");
            showToast("✅ Delivered to customer Messenger!");
        }
    } catch (err) {
        console.error("Failed to forward rider reply to Messenger:", err);
        showToast("⚠️ Delivery failed. Check internet connection.");
        if (newMsgKey && custId && db) {
            db.ref(`customerChats/${custId}/messages/${newMsgKey}`).update({
                status: 'failed',
                failed: true,
                failedReason: (err?.message || 'Network error')
            }).catch(() => {});
        }
        if (newMsgKey && loadedRiderMsgsMap.has(newMsgKey)) {
            const targetMsg = loadedRiderMsgsMap.get(newMsgKey);
            targetMsg.status = 'failed';
            targetMsg.failed = true;
            const container = document.getElementById('rider-chat-messages-container') || document.getElementById('rider-cust-chat-messages');
            if (container) appendOrUpdateSingleRiderMessage(container, targetMsg, activeCustData);
        }
    }
}

export async function retryRiderChatMessage(msgId) {
    if (!msgId || !loadedRiderMsgsMap.has(msgId)) return;
    const msg = loadedRiderMsgsMap.get(msgId);
    const targetCustId = msg.custId || activeRiderChatCustId;
    if (!targetCustId) return;

    // 1. Instantly display sending state in DOM & memory (clear failure badge immediately)
    msg.status = 'sending';
    msg.failed = false;
    msg.failedReason = null;
    const container = document.getElementById('rider-chat-messages-container') || document.getElementById('rider-cust-chat-messages');
    if (container) appendOrUpdateSingleRiderMessage(container, msg, activeCustData);

    const isFb = msg.channel === 'messenger' || String(targetCustId).startsWith('fb_');

    if (isFb) {
        try {
            await forwardRiderReplyToMessenger({
                custId: targetCustId,
                apiId: msg.apiId,
                text: msg.text,
                imageUrl: msg.imageUrl,
                fileUrl: msg.fileUrl || null,
                fileName: msg.fileName || null,
                locationCoords: msg.locationCoords || null,
                riderName: msg.sender || appState.riderName,
                replyToMid: msg.replyTo?.id || msg.replyToMid || null,
                replyToText: msg.replyTo?.text || msg.replyToText || null,
                newMsgKey: msgId
            });

            // Double ensure status is persisted as sent & failure fields removed
            if (db && targetCustId) {
                await db.ref(`customerChats/${targetCustId}/messages/${msgId}`).update({
                    status: 'sent',
                    failed: null,
                    failedReason: null
                }).catch(() => {});
            }
            msg.status = 'sent';
            msg.failed = false;
            msg.failedReason = null;

            let memCached = riderChatMemoryCache.get(targetCustId) || [];
            const memItem = memCached.find(m => m.id === msgId);
            if (memItem) {
                memItem.status = 'sent';
                memItem.failed = false;
                memItem.failedReason = null;
                idbSet('chats', targetCustId, memCached).catch(() => {});
            }

            if (container) appendOrUpdateSingleRiderMessage(container, msg, activeCustData);
        } catch (err) {
            console.error("retryRiderChatMessage failed:", err);
            msg.status = 'failed';
            msg.failed = true;
            msg.failedReason = err?.message || 'Send failed';
            if (container) appendOrUpdateSingleRiderMessage(container, msg, activeCustData);
        }
    } else if (db && targetCustId) {
        try {
            await db.ref(`customerChats/${targetCustId}/messages/${msgId}`).update({
                status: 'sent',
                failed: null,
                failedReason: null
            });
            msg.status = 'sent';
            msg.failed = false;
            msg.failedReason = null;

            let memCached = riderChatMemoryCache.get(targetCustId) || [];
            const memItem = memCached.find(m => m.id === msgId);
            if (memItem) {
                memItem.status = 'sent';
                memItem.failed = false;
                memItem.failedReason = null;
                idbSet('chats', targetCustId, memCached).catch(() => {});
            }

            if (container) appendOrUpdateSingleRiderMessage(container, msg, activeCustData);
        } catch (_) {
            msg.status = 'failed';
            msg.failed = true;
            if (container) appendOrUpdateSingleRiderMessage(container, msg, activeCustData);
        }
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
    const nameEl = document.getElementById('rider-chat-cust-name');
    let currentName = nameEl?.innerText?.trim() || "";
    if (currentName === 'Customer Name' || currentName.startsWith('FB Customer (')) {
        currentName = currentRiderChatMeta?.customerName || currentName;
    }

    const newName = prompt("I-edit ang pangalan ng Customer:", currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName.trim()) return;

    const cleanName = newName.trim();
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanName)}&background=0084FF&color=fff`;

    // 1. Update in-memory metadata & DOM immediately
    if (currentRiderChatMeta) {
        currentRiderChatMeta.customerName = cleanName;
        currentRiderChatMeta.avatarUrl = avatar;
    }
    if (nameEl) nameEl.innerText = cleanName;
    const avatarEl = document.getElementById('rider-chat-avatar') || document.getElementById('rider-chat-cust-avatar');
    if (avatarEl) {
        if (avatarEl.tagName === 'IMG') avatarEl.src = avatar;
        else avatarEl.innerHTML = `<img src="${avatar}" class="w-full h-full rounded-full object-cover">`;
    }

    // 2. If thread is cached, update in-memory thread map
    if (typeof window.getCachedCustomerThreadsMap === 'function') {
        const threadMap = window.getCachedCustomerThreadsMap();
        if (threadMap) {
            if (threadMap.has(activeRiderChatCustId)) {
                const t = threadMap.get(activeRiderChatCustId);
                t.customerName = cleanName;
                t.name = cleanName;
                t.avatarUrl = avatar;
            }
        }
    }

    // 3. If Facebook thread, update local FB name cache so it doesn't get reverted
    if (activeRiderChatCustId.startsWith('fb_')) {
        try {
            const rawCache = localStorage.getItem('fb_name_cache_v2');
            const cache = rawCache ? JSON.parse(rawCache) : {};
            cache[activeRiderChatCustId] = { name: cleanName, avatarUrl: avatar, timestamp: Date.now() };
            localStorage.setItem('fb_name_cache_v2', JSON.stringify(cache));
        } catch (_) {}
    }

    // 4. Update customerChats metadata and customerChatMeta in Firebase RTDB
    const batchUpdates = {};
    batchUpdates[`customerChatMeta/${activeRiderChatCustId}/customerName`] = cleanName;
    batchUpdates[`customerChatMeta/${activeRiderChatCustId}/avatarUrl`] = avatar;
    batchUpdates[`customerChatMeta/${activeRiderChatCustId}/lastUpdated`] = Date.now();
    batchUpdates[`customerChats/${activeRiderChatCustId}/metadata/customerName`] = cleanName;
    batchUpdates[`customerChats/${activeRiderChatCustId}/metadata/avatarUrl`] = avatar;
    batchUpdates[`customerChats/${activeRiderChatCustId}/metadata/lastUpdated`] = Date.now();
    batchUpdates[`customers/${activeRiderChatCustId}/name`] = cleanName;
    batchUpdates[`customers/${activeRiderChatCustId}/customerName`] = cleanName;

    // 5. CRITICAL FIX FOR CATERED CUSTOMERS:
    // Update the catering rider's customerName on the live roster so it doesn't get de-synced or locked out!
    const liveRoster = globalState.rosterMembers || [];
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();
    const cateredRiderId = (currentRiderChatMeta?.cateredByRiderId || "").toString().trim();
    const cateredRiderName = (currentRiderChatMeta?.cateredByRiderName || currentRiderChatMeta?.cateredBy || "").toString().trim().toLowerCase();

    // Find the catering rider (first check forcedCaters / meta, then roster match)
    const cateringRider = liveRoster.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        if (m.forcedCaters && typeof m.forcedCaters === 'object' && m.forcedCaters[activeRiderChatCustId]) return true;
        if (cateredRiderId && mId === cateredRiderId) return true;
        if (cateredRiderName && mName === cateredRiderName) return true;
        if (m.customerName) {
            const custs = m.customerName.split(/\s*,\s*/).map(c => c.trim().toLowerCase());
            if (custs.includes(currentName.toLowerCase()) || (typeof isCustomerMatch === 'function' && custs.some(c => isCustomerMatch(c, currentName)))) return true;
        }
        return false;
    });

    if (cateringRider) {
        const targetRiderId = cateringRider.telegramId || cateringRider.id || myId;
        let existingCusts = (cateringRider.customerName || "").split(/\s*,\s*/).map(c => c.trim()).filter(Boolean);
        let replaced = false;
        existingCusts = existingCusts.map(c => {
            if (c.toLowerCase() === currentName.toLowerCase() || (typeof isCustomerMatch === 'function' && isCustomerMatch(c, currentName))) {
                replaced = true;
                return cleanName;
            }
            return c;
        });

        if (!replaced) {
            if (existingCusts.length === 1 && (existingCusts[0].toLowerCase() === 'customer' || existingCusts[0].startsWith('FB Customer ('))) {
                existingCusts = [cleanName];
            } else if (!existingCusts.some(c => c.toLowerCase() === cleanName.toLowerCase())) {
                existingCusts.push(cleanName);
            }
        }

        const newRosterCustString = existingCusts.join(', ');
        cateringRider.customerName = newRosterCustString;
        if (targetRiderId) {
            batchUpdates[`roster/${targetRiderId}/customerName`] = newRosterCustString;
            if (cateringRider.id && cateringRider.id !== targetRiderId) {
                batchUpdates[`roster/${cateringRider.id}/customerName`] = newRosterCustString;
            }

            // Migrate customerFees if keyed by old customer name
            if (cateringRider.customerFees) {
                const oldCleanKey = currentName.toLowerCase().trim();
                const newCleanKey = cleanName.toLowerCase().trim();
                if (cateringRider.customerFees[oldCleanKey]) {
                    const feeVal = cateringRider.customerFees[oldCleanKey];
                    cateringRider.customerFees[newCleanKey] = feeVal;
                    batchUpdates[`roster/${targetRiderId}/customerFees/${newCleanKey}`] = feeVal;
                    batchUpdates[`roster/${targetRiderId}/customerFees/${oldCleanKey}`] = null;
                    if (cateringRider.id && cateringRider.id !== targetRiderId) {
                        batchUpdates[`roster/${cateringRider.id}/customerFees/${newCleanKey}`] = feeVal;
                        batchUpdates[`roster/${cateringRider.id}/customerFees/${oldCleanKey}`] = null;
                    }
                    delete cateringRider.customerFees[oldCleanKey];
                }
            }

            // Update forcedCaters if present
            if (cateringRider.forcedCaters && typeof cateringRider.forcedCaters === 'object') {
                for (const [fcKey, fcVal] of Object.entries(cateringRider.forcedCaters)) {
                    if (fcKey === activeRiderChatCustId || (fcVal && fcVal.customerName && (fcVal.customerName.toLowerCase() === currentName.toLowerCase() || (typeof isCustomerMatch === 'function' && isCustomerMatch(fcVal.customerName, currentName))))) {
                        batchUpdates[`roster/${targetRiderId}/forcedCaters/${fcKey}/customerName`] = cleanName;
                        if (cateringRider.id && cateringRider.id !== targetRiderId) {
                            batchUpdates[`roster/${cateringRider.id}/forcedCaters/${fcKey}/customerName`] = cleanName;
                        }
                    }
                }
            }
        }
    }

    // 6. Update active order customerName if linked
    const orderId = currentRiderChatMeta?.latestOrderId;
    if (orderId) {
        batchUpdates[`orders/${cleanFirebasePathKey(orderId)}/customerName`] = cleanName;
    }

    // 7. Update Cart slot customer name if present in localStorage
    try {
        for (let i = 1; i <= 5; i++) {
            const slotKey = `cart_customer_slot_${i}`;
            const val = localStorage.getItem(slotKey);
            if (val && (val.toLowerCase() === currentName.toLowerCase() || (typeof isCustomerMatch === 'function' && isCustomerMatch(val, currentName)))) {
                localStorage.setItem(slotKey, cleanName);
            }
        }
        const generalCust = localStorage.getItem('cart_customer_name');
        if (generalCust && (generalCust.toLowerCase() === currentName.toLowerCase() || (typeof isCustomerMatch === 'function' && isCustomerMatch(generalCust, currentName)))) {
            localStorage.setItem('cart_customer_name', cleanName);
        }
    } catch (_) {}

    // 8. Execute batch updates to Firebase RTDB
    if (db) {
        try {
            await db.ref().update(batchUpdates);
        } catch (e) {
            console.warn("Rename customer batch update error:", e);
            for (const [path, val] of Object.entries(batchUpdates)) {
                db.ref(path).set(val).catch(() => {});
            }
        }
    }

    // 9. Re-evaluate lock permissions and refresh UI
    evaluateRiderChatLockPermissions();
    if (typeof window.renderRiderCustomerChatFeed === 'function') {
        window.renderRiderCustomerChatFeed();
    }
    if (typeof window.updateRosterUI === 'function') {
        window.updateRosterUI();
    }
    showToast(`✅ Na-update ang pangalan: ${cleanName}`);
}

if (typeof window !== 'undefined') {
    window.getActiveRiderChatCustId = getActiveRiderChatCustId;
    window.getCurrentRiderChatMeta = getCurrentRiderChatMeta;
    window.getLoadedRiderMsgsMap = getLoadedRiderMsgsMap;
    window.getActiveCustData = getActiveCustData;
    window.setActiveCustData = setActiveCustData;

    window.openRiderChatModal = openRiderChatModal;
    window.openRiderCustomerChatModal = openRiderCustomerChatModal;
    window.viewCurrentCustomerPhoto = viewCurrentCustomerPhoto;
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
    window.forwardRiderReplyToMessenger = forwardRiderReplyToMessenger;
    window.sendDirectMenuPhotoToCustomer = sendDirectMenuPhotoToCustomer;
    window.retryRiderChatMessage = retryRiderChatMessage;

    window.getActiveRiderChatFilter = getActiveRiderChatFilter;
    window.setRiderChatFilter = setRiderChatFilter;
    window.listenToAllCustomerChatsForRider = listenToAllCustomerChatsForRider;
    window.listenToRiderChatMessages = listenToRiderChatMessages;
    window.reloadRiderChatFromFirebase = reloadRiderChatFromFirebase;
    window.syncIncomingMessageFromMeta = syncIncomingMessageFromMeta;
    window.loadOlderRiderMessages = loadOlderRiderMessages;
    window.triggerLoadOlderRiderMessages = () => loadOlderRiderMessages(null, activeRiderChatCustId);
    window.syncApplicantUI = syncApplicantUI;
    window.saveCurrentThreadDraft = saveCurrentThreadDraft;
    window.restoreThreadDraft = restoreThreadDraft;
    window.handleRiderChatInputDraft = handleRiderChatInputDraft;
    window.renderRiderCateredSwitcher = renderRiderCateredSwitcher;
    window.switchCateredCustomerChat = switchCateredCustomerChat;

    listenToGlobalStoreChats();

    window.addEventListener('rosterUpdated', () => {
        if (activeRiderChatCustId) renderRiderCateredSwitcher();
    });
    window.addEventListener('customerChatsUpdated', () => {
        if (activeRiderChatCustId) renderRiderCateredSwitcher();
    });

    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && activeRiderChatCustId) {
                clearNativeNotification('chat_' + activeRiderChatCustId);
            }
        });

        // Track user typing in real-time for active thread draft
        document.addEventListener('input', (e) => {
            if (e.target && (e.target.id === 'rider-chat-input' || e.target.id === 'rider-cust-chat-input')) {
                if (activeRiderChatCustId) {
                    handleRiderChatInputDraft(e.target.value);
                }
            }
        });
    }
}