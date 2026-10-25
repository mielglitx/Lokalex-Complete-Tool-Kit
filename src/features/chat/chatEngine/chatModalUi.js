// src/features/chat/chatEngine/chatModalUi.js
import { db } from '../../../config/firebase.js';
import { appState, globalState } from '../../../store/state.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { toggleBodyScroll } from '../chatUtils.js';
import { clearNativeNotification } from '../../../ui/notifications.js';
import { isAdmin, canManageRoster, isCustomerMatch } from '../../roster/rosterUtils.js';
import { resolveFacebookCustomerName, getResolvedFbName } from '../facebookApiAdmin.js';
import { highlightActiveMilestoneUI } from '../riderThreadActions.js';
import {
    activeRiderChatCustId,
    setActiveRiderChatCustId,
    currentRiderChatMeta,
    setCurrentRiderChatMeta,
    activeCustData,
    setActiveCustData,
    setOpenSessionTime,
    currentActiveRiderChatCustAvatar,
    setCurrentActiveRiderChatCustAvatar,
    saveCurrentThreadDraft,
    restoreThreadDraft,
    cleanFirebasePathKey,
    activeRiderChatListener,
    setActiveRiderChatListener,
    activeRiderChatChildListener,
    setActiveRiderChatChildListener,
    activeRiderChatChangedListener,
    setActiveRiderChatChangedListener,
    activeRiderChatMetaListener,
    setActiveRiderChatMetaListener,
    setOldestRiderMsgTimestamp,
    setHasMoreRiderMsgs,
    setIsLoadingRiderHistory,
    loadedRiderMsgsMap
} from './chatState.js';
import {
    cancelRiderReply,
    listenToRiderChatMessages,
    syncIncomingMessageFromMeta
} from './chatListeners.js';
import { startChatPresence, stopChatPresence, startChatTypingListener } from './chatPresence.js';

export function openRiderChatModal(custId, custName, avatarUrl) {
    openRiderCustomerChatModal(custId, custName, avatarUrl);
}

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

    setActiveRiderChatCustId(custId);
    setOpenSessionTime(Date.now());
    if (typeof window !== 'undefined') {
        window.activeRiderChatCustId = custId;
    }
    setActiveCustData(null);

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
        if (typeof window.updateAllChatFolderBadges === 'function') {
            window.updateAllChatFolderBadges();
        } else {
            if (typeof window.updateInboxUnreadBadge === 'function') window.updateInboxUnreadBadge();
            if (typeof window.updateDoneUnreadBadge === 'function') window.updateDoneUnreadBadge();
        }
    }

    const modal = document.getElementById('rider-chat-modal') || document.getElementById('rider-customer-chat-modal');
    const nameEl = document.getElementById('rider-chat-cust-name');
    const avatarEl = document.getElementById('rider-chat-avatar') || document.getElementById('rider-chat-cust-avatar');

    // Immediately clear previous thread's metadata to prevent cross-customer data leakage
    setCurrentRiderChatMeta(null);

    let effectiveName = custName || "Customer";
    let effectiveAvatar = avatarUrl;

    if (custId && custId.startsWith('fb_')) {
        const cached = (typeof getResolvedFbName === 'function') ? getResolvedFbName(custId) : null;
        if (cached && cached.name && (!effectiveName || effectiveName.startsWith('FB Customer (') || effectiveName.toLowerCase() === 'customer')) {
            effectiveName = cached.name;
        }
        if (cached && cached.avatarUrl && !cached.avatarUrl.includes('ui-avatars.com') && (!effectiveAvatar || effectiveAvatar.includes('ui-avatars.com'))) {
            effectiveAvatar = cached.avatarUrl;
        }
        
        // Background check to resolve customer name or real Facebook photo
        if (typeof resolveFacebookCustomerName === 'function') {
            resolveFacebookCustomerName(custId).then(resolved => {
                if (resolved && activeRiderChatCustId === custId) {
                    const currentTitle = nameEl?.innerText?.trim();
                    if (resolved.name && (!currentTitle || currentTitle.startsWith('FB Customer (') || currentTitle.toLowerCase() === 'customer') && nameEl) {
                        nameEl.innerText = resolved.name;
                    }
                    if (resolved.avatarUrl && !resolved.avatarUrl.includes('ui-avatars.com')) {
                        setCurrentActiveRiderChatCustAvatar(resolved.avatarUrl);
                        if (avatarEl) {
                            if (avatarEl.tagName === 'IMG') {
                                avatarEl.src = resolved.avatarUrl;
                            } else {
                                avatarEl.innerHTML = `<img src="${resolved.avatarUrl}" class="w-full h-full rounded-full object-cover">`;
                            }
                        }
                    }
                    renderRiderCateredSwitcher();
                }
            }).catch(() => {});
        }
    }

    const resolvedAvatar = effectiveAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(effectiveName || "Customer")}&background=0084FF&color=fff`;
    setCurrentActiveRiderChatCustAvatar(resolvedAvatar);

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
        startChatPresence(custId);
        startChatTypingListener(custId);
    }

    cancelRiderReply();

    if (activeRiderChatListener) {
        if (typeof activeRiderChatListener.off === 'function') activeRiderChatListener.off();
        setActiveRiderChatListener(null);
    }
    if (activeRiderChatChildListener) {
        if (typeof activeRiderChatChildListener.off === 'function') activeRiderChatChildListener.off();
        setActiveRiderChatChildListener(null);
    }
    if (activeRiderChatChangedListener) {
        if (typeof activeRiderChatChangedListener.off === 'function') activeRiderChatChangedListener.off();
        setActiveRiderChatChangedListener(null);
    }
    if (activeRiderChatMetaListener) {
        if (typeof activeRiderChatMetaListener.off === 'function') activeRiderChatMetaListener.off();
        setActiveRiderChatMetaListener(null);
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
            setActiveCustData(snap.val() || {});
        });

        const metaRef = db.ref(`customerChats/${custId}/metadata`);
        setActiveRiderChatMetaListener(metaRef);
        metaRef.on('value', (snapshot) => {
            const fetchedMeta = snapshot.val() || {};
            setCurrentRiderChatMeta(fetchedMeta);
            if (!fetchedMeta.isApplicant && typeof window.getCachedCustomerThreadsMap === 'function') {
                const map = window.getCachedCustomerThreadsMap();
                const thread = map ? (map.get(custId) || map.get(`fb_${custId}`) || (custId.startsWith('fb_') ? map.get(custId.replace(/^fb_/, '')) : null)) : null;
                if (thread?.isApplicant) {
                    fetchedMeta.isApplicant = true;
                    fetchedMeta.folder = 'applicant';
                } else if (thread?.folder === 'followup' && fetchedMeta.folder !== 'applicant') {
                    fetchedMeta.folder = 'followup';
                }
            }
            if (activeRiderChatCustId !== custId) return;

            const hasLinkedDir = Boolean(fetchedMeta.linkedDirectoryKey || fetchedMeta.linkedDirectoryName);
            if (fetchedMeta?.customerName && nameEl) {
                nameEl.innerText = fetchedMeta.customerName;
            } else if (custId && custId.startsWith('fb_') && !hasLinkedDir) {
                const cached = (typeof getResolvedFbName === 'function') ? getResolvedFbName(custId) : null;
                if (cached && cached.name && nameEl) {
                    nameEl.innerText = cached.name;
                }
            }
            if (fetchedMeta?.avatarUrl && avatarEl) {
                setCurrentActiveRiderChatCustAvatar(fetchedMeta.avatarUrl);
                if (avatarEl.tagName === 'IMG') {
                    avatarEl.src = fetchedMeta.avatarUrl;
                } else {
                    avatarEl.innerHTML = `<img src="${fetchedMeta.avatarUrl}" class="w-full h-full rounded-full object-cover">`;
                }
            }
            evaluateRiderChatLockPermissions();
            bindRiderToActiveStoreOrders(fetchedMeta);
            syncMilestoneBarUI(fetchedMeta);
            syncApplicantUI(fetchedMeta);
            renderRiderCateredSwitcher();

            // Instant reconcile: any metadata change while thread is open synchronizes incoming messages immediately!
            if (activeRiderChatCustId === custId) {
                syncIncomingMessageFromMeta(custId, fetchedMeta);
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

export function syncMilestoneBarUI(meta) {
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

export function bindRiderToActiveStoreOrders(meta) {
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
                const resolvedFb = (typeof getResolvedFbName === 'function') ? getResolvedFbName(tId) : null;
                const fbName = (resolvedFb?.name || "").trim().toLowerCase();
                const chatName = (t.customerName || t.name || "").trim().toLowerCase();
                if ((fbName && (fbName === targetLower || isCustomerMatch(fbName, targetLower))) ||
                    (chatName && (chatName === targetLower || isCustomerMatch(chatName, targetLower)))) {
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
        const matchesId = Boolean(
            currentActiveId && (
                item.threadId === currentActiveId || 
                (item.thread && (item.thread.custId === currentActiveId || item.thread.id === currentActiveId))
            )
        );
        const matchesName = Boolean(
            !currentActiveId && currentActiveName && (
                item.name.toLowerCase() === currentActiveName || isCustomerMatch(item.name, currentActiveName)
            )
        );
        const isCurrentActive = matchesId || matchesName;

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

export function evaluateRiderChatLockPermissions() {
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
                lockBanner.innerHTML = `<span class="truncate"><i class="fa-solid fa-user-check text-emerald-600"></i> You are currently catering to this customer.</span>
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
    stopChatPresence();
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
        setActiveRiderChatListener(null);
    }
    if (activeRiderChatChildListener) {
        if (typeof activeRiderChatChildListener.off === 'function') activeRiderChatChildListener.off();
        setActiveRiderChatChildListener(null);
    }
    if (activeRiderChatChangedListener) {
        if (typeof activeRiderChatChangedListener.off === 'function') activeRiderChatChangedListener.off();
        setActiveRiderChatChangedListener(null);
    }
    if (activeRiderChatMetaListener) {
        if (typeof activeRiderChatMetaListener.off === 'function') activeRiderChatMetaListener.off();
        setActiveRiderChatMetaListener(null);
    }
    setActiveRiderChatCustId(null);
    if (typeof window !== 'undefined') {
        window.activeRiderChatCustId = null;
    }
    setCurrentRiderChatMeta(null);

    setOldestRiderMsgTimestamp(null);
    setHasMoreRiderMsgs(true);
    setIsLoadingRiderHistory(false);
    loadedRiderMsgsMap.clear();
    cancelRiderReply();

    if (typeof window !== 'undefined' && typeof window.renderRiderCustomerChatFeed === 'function') {
        window.renderRiderCustomerChatFeed();
    }
}

export async function promptRenameCustomerChat() {
    if (!activeRiderChatCustId) return;
    const nameEl = document.getElementById('rider-chat-cust-name');
    let currentName = nameEl?.innerText?.trim() || "";
    if (currentName === 'Customer Name' || currentName.startsWith('FB Customer (')) {
        currentName = currentRiderChatMeta?.customerName || currentName;
    }

    const newName = prompt("Edit customer name:", currentName);
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

    // 3. Persist update to Firebase RTDB
    if (db) {
        const payload = {
            customerName: cleanName,
            name: cleanName,
            avatarUrl: avatar
        };
        db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update(payload).catch(() => {});
        db.ref(`customerChatMeta/${activeRiderChatCustId}`).update(payload).catch(() => {});
    }

    if (typeof window.renderRiderCustomerChatFeed === 'function') {
        window.renderRiderCustomerChatFeed();
    }
}

