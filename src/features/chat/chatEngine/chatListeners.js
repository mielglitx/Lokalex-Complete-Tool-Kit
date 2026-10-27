// src/features/chat/chatEngine/chatListeners.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { getMessageTimestamp } from '../chatUtils.js';
import { idbGet, idbSet } from '../../../utils/storageEngine.js';
import { playChatChime } from '../chatSoundManager.js';
import { 
    showRiderInChatToast, 
    hideRiderInChatToast, 
    showRiderTopSpinner, 
    hideRiderTopSpinner, 
    renderRiderMessages,
    appendOrUpdateSingleRiderMessage 
} from '../riderChatRender.js';
import { isMyCustomerThread, getActiveRosterCaterer } from '../riderChatFeed.js';
import { 
    resolveFacebookMessageAttachment,
    resolveFacebookMessageReplyTo,
    getFbPageAccessToken
} from '../facebookApiAdmin.js';
import { showToast } from '../../../ui/notifications.js';
import {
    activeRiderChatCustId,
    setActiveRiderChatCustId,
    activeRiderChatListener,
    setActiveRiderChatListener,
    activeRiderChatChildListener,
    setActiveRiderChatChildListener,
    activeRiderChatChangedListener,
    setActiveRiderChatChangedListener,
    currentRiderChatMeta,
    activeCustData,
    openSessionTime,
    activeRiderReplyTarget,
    setActiveRiderReplyTarget,
    RIDER_CHAT_BATCH_SIZE,
    RIDER_CHAT_OLDER_BATCH_SIZE,
    oldestRiderMsgTimestamp,
    setOldestRiderMsgTimestamp,
    oldestRiderMsgKey,
    setOldestRiderMsgKey,
    hasMoreRiderMsgs,
    setHasMoreRiderMsgs,
    isLoadingRiderHistory,
    setIsLoadingRiderHistory,
    isInitialScrollDone,
    setIsInitialScrollDone,
    lastPaginationRequestTime,
    setLastPaginationRequestTime,
    loadedRiderMsgsMap,
    riderChatMemoryCache
} from './chatState.js';
import { forwardRiderReactionToMessenger } from './chatSending.js';

export async function reloadRiderChatFromFirebase(custId) {
    const targetCustId = custId || activeRiderChatCustId;
    if (!targetCustId) return;
    riderChatMemoryCache.delete(targetCustId);
    try {
        await idbSet('chats', targetCustId, []);
    } catch (_) {}
    listenToRiderChatMessages(targetCustId, true);
}

function triggerInstantFbAttachmentResolution(custId, msg, container, custData) {
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
                appendOrUpdateSingleRiderMessage(container, existing, custData || activeCustData);
            }

            try {
                const preloader = new Image();
                preloader.src = url;
            } catch (_) {}
        }
    }).catch(() => {});
}

function autoResolveRecentFbCustomerAttachments(custId, container, custData) {
    if (!String(custId).startsWith('fb_')) return;
    const candidates = Array.from(loadedRiderMsgsMap.values())
        .filter(m => m && !m.imageUrl && m.text && (m.text.includes('[Facebook image]') || m.text.includes('[Facebook attachment]')));
    for (const m of candidates) {
        triggerInstantFbAttachmentResolution(custId, m, container, custData);
    }
}

function autoResolveRecentFbCustomerReplies(custId, container, custData) {
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
                    appendOrUpdateSingleRiderMessage(container, existing, custData || activeCustData);
                }
            }
        }).catch(() => {});
    }
}

let isSyncingGraphMessages = false;

/**
 * Direct Parallel Meta Graph API Fast-Sync:
 * Fetches the newest 15 messages directly from the Facebook Page / Meta edge servers
 * in parallel with Firebase RTDB. Guarantees 0-latency message retrieval even if webhook was delayed.
 */
export async function syncCurrentThreadFromMetaGraph(custId, showFeedback = false) {
    const targetCustId = custId || activeRiderChatCustId;
    if (!targetCustId || !String(targetCustId).startsWith('fb_')) return;
    if (isSyncingGraphMessages) return;

    const psid = String(targetCustId).replace(/^fb_/, '').trim();
    if (!psid) return;

    const syncBtn = document.getElementById('rider-chat-sync-fb-btn');
    if (syncBtn) {
        syncBtn.classList.remove('hidden');
        syncBtn.querySelector('i')?.classList.add('animate-spin');
    }

    isSyncingGraphMessages = true;

    try {
        const token = (typeof getFbPageAccessToken === 'function') ? await getFbPageAccessToken() : null;
        if (!token) return;

        const container = document.getElementById('rider-cust-chat-messages') || document.getElementById('rider-chat-messages-container');

        const convUrl = `https://graph.facebook.com/v19.0/me/conversations?user_id=${psid}&fields=messages.limit(15){id,message,from,created_time,attachments}&access_token=${encodeURIComponent(token)}`;
        const resp = await fetch(convUrl);
        if (!resp.ok) return;

        const data = await resp.json();
        const convList = data?.data || [];
        if (convList.length === 0) return;

        const rawMsgList = convList[0]?.messages?.data || [];
        if (rawMsgList.length === 0) return;

        // Process in chronological order (oldest to newest)
        const sortedGraphMsgs = rawMsgList.slice().reverse();
        let newCount = 0;
        let lastMsgText = '';
        let lastMsgTs = 0;

        for (const m of sortedGraphMsgs) {
            const rawMid = String(m.id || '');
            if (!rawMid) continue;
            const safeMid = rawMid.replace(/[.#$\[\]\/]/g, '_');

            // Skip if already loaded or rendered
            if (loadedRiderMsgsMap.has(safeMid) || loadedRiderMsgsMap.has(rawMid)) {
                continue;
            }

            const isRider = m.from?.id && String(m.from.id) !== psid;
            const ts = m.created_time ? new Date(m.created_time).getTime() : Date.now();
            let text = m.message || '';
            let imageUrl = null;
            let type = 'text';

            if (m.attachments?.data && Array.isArray(m.attachments.data)) {
                for (const att of m.attachments.data) {
                    const u = att?.image_data?.url || att?.payload?.url || att?.media?.image?.src || att?.file_url;
                    if (u) {
                        imageUrl = u;
                        type = 'image';
                        break;
                    }
                }
            }

            if (!text && imageUrl) text = '📷 Photo';

            const normText = (text || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim().toLowerCase();

            // Comprehensive deduplication: check if this message already exists in memory or loaded messages
            const isMatch = (existing) => {
                if (!existing) return false;
                if (existing.id === safeMid || existing.id === rawMid || existing.metaMid === rawMid || existing.mid === safeMid) {
                    return true;
                }
                const sameDirection = Boolean(existing.isRider) === Boolean(isRider);
                if (sameDirection) {
                    const exNorm = (existing.text || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim().toLowerCase();
                    if (exNorm && normText && (exNorm === normText || exNorm.startsWith(normText.slice(0, 40)) || normText.startsWith(exNorm.slice(0, 40)))) {
                        const diff = Math.abs(getMessageTimestamp(existing) - ts);
                        if (diff < 300000) { // within 5 minutes
                            return true;
                        }
                    }
                }
                return false;
            };

            const existingInLoaded = Array.from(loadedRiderMsgsMap.values()).find(isMatch);
            let memCached = riderChatMemoryCache.get(targetCustId) || [];
            const existingInMem = memCached.find(isMatch);
            const existingMatch = existingInLoaded || existingInMem;

            if (existingMatch) {
                // Link mid on existing message so future lookups are instant
                existingMatch.metaMid = rawMid;
                existingMatch.mid = safeMid;

                // Clean up any stale duplicate message from Firebase if one was previously stored under safeMid
                if (db && existingMatch.id !== safeMid) {
                    db.ref(`customerChats/${targetCustId}/messages/${safeMid}`).remove().catch(() => {});
                }
                // Also remove any duplicate echo bubble from DOM if present
                if (existingMatch.id !== safeMid) {
                    document.getElementById(`msg-bubble-${safeMid}`)?.remove();
                    loadedRiderMsgsMap.delete(safeMid);
                }
                continue; // Do NOT insert duplicate!
            }

            // If it's an outbound message from the Page, check if sent from app (midIndex in RTDB)
            if (isRider && db) {
                try {
                    const midSnap = await db.ref(`customerChats/${targetCustId}/midIndex/${safeMid}`).once('value');
                    if (midSnap.exists()) {
                        continue; // Already exists under rider's app push key!
                    }
                } catch (_) {}
            }

            const isPageOutbound = Boolean(isRider);
            const senderName = isPageOutbound ? 'Page Admin' : (m.from?.name || activeCustData?.customerName || 'Customer');

            const formattedMsg = {
                id: safeMid,
                mid: safeMid,
                metaMid: rawMid,
                text: text,
                timestamp: ts,
                isRider: Boolean(isRider),
                sender: senderName,
                senderType: isPageOutbound ? 'admin' : 'customer',
                senderAvatar: isPageOutbound ? 'https://ui-avatars.com/api/?name=Page+Admin&background=0284c7&color=fff' : null,
                status: 'delivered',
                channel: 'messenger',
                imageUrl: imageUrl,
                type: type
            };

            loadedRiderMsgsMap.set(safeMid, formattedMsg);

            // Update RAM cache & IndexedDB
            memCached = riderChatMemoryCache.get(targetCustId) || [];
            if (!memCached.some(existing => existing.id === safeMid || existing.metaMid === rawMid)) {
                memCached.push(formattedMsg);
                memCached.sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
                riderChatMemoryCache.set(targetCustId, memCached);
                idbSet('chats', targetCustId, memCached).catch(() => {});
            }

            // Render directly into active chat UI
            if (activeRiderChatCustId === targetCustId && container) {
                appendOrUpdateSingleRiderMessage(container, formattedMsg, activeCustData);
            }

            // Concurrently persist to Firebase RTDB so other riders see it immediately
            if (db) {
                db.ref(`customerChats/${targetCustId}/messages/${safeMid}`).set(formattedMsg).catch(() => {});
            }

            lastMsgText = text;
            lastMsgTs = ts;
            newCount++;
        }

        if (newCount > 0 && db && lastMsgTs) {
            db.ref(`customerChatMeta/${targetCustId}`).update({
                lastMessage: lastMsgText || 'Facebook Message',
                lastUpdated: lastMsgTs,
                channel: 'messenger'
            }).catch(() => {});

            if (activeRiderChatCustId === targetCustId && container) {
                requestAnimationFrame(() => {
                    container.scrollTop = container.scrollHeight;
                });
            }
        }

        if (showFeedback) {
            if (newCount > 0) {
                showToast(`✅ Synced ${newCount} new message(s) from Facebook Page!`);
            } else {
                showToast("ℹ️ Chat is already up-to-date with Facebook Page.");
            }
        }
    } catch (err) {
        console.warn("[MetaGraphSync] Direct sync error:", err);
        if (showFeedback) {
            showToast("⚠️ Could not fetch messages from Facebook Page.");
        }
    } finally {
        isSyncingGraphMessages = false;
        if (syncBtn) {
            syncBtn.querySelector('i')?.classList.remove('animate-spin');
        }
    }
}

export async function listenToRiderChatMessages(custId, forceReloadFromFirebase = false) {
    if (!db || !custId) return;
    setActiveRiderChatCustId(custId);

    const container = document.getElementById('rider-cust-chat-messages') || document.getElementById('rider-chat-messages-container');
    if (!container) return;

    setOldestRiderMsgTimestamp(null);
    setOldestRiderMsgKey(null);
    setHasMoreRiderMsgs(false);
    setIsLoadingRiderHistory(false);
    setIsInitialScrollDone(false);
    setLastPaginationRequestTime(0);
    loadedRiderMsgsMap.clear();

    // Clean up any previous chat listeners
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

    setupRiderScrollPagination(container, custId);

    const syncFbBtn = document.getElementById('rider-chat-sync-fb-btn');
    if (String(custId).startsWith('fb_')) {
        if (syncFbBtn) syncFbBtn.classList.remove('hidden');
    } else {
        if (syncFbBtn) syncFbBtn.classList.add('hidden');
    }

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
        setHasMoreRiderMsgs(localMessages.length > initialChunk.length);
        if (initialChunk.length > 0) {
            setOldestRiderMsgTimestamp(getMessageTimestamp(initialChunk[0]));
            setOldestRiderMsgKey(initialChunk[0].id || null);
        }
        renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, true, 0, activeCustData);
        setTimeout(() => { setIsInitialScrollDone(true); }, 250);
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

    // Fast-sync directly with Facebook Page after local memory and DOM are initialized
    if (String(custId).startsWith('fb_')) {
        syncCurrentThreadFromMetaGraph(custId, false).catch(() => {});
    }

    // Realtime Firebase connection: strictly load only the last 10 messages for lightning-fast startup ordered by timestamp
    const messagesQuery = db.ref(`customerChats/${custId}/messages`).orderByChild('timestamp').limitToLast(RIDER_CHAT_BATCH_SIZE);
    setActiveRiderChatListener(messagesQuery);

    // Authoritative check & synchronization of newest incoming messages on thread open
    messagesQuery.once('value', (snapshot) => {
        if (activeRiderChatCustId !== custId) return;
        const data = snapshot.val();
        if (!data || Object.keys(data).length === 0) {
            if (loadedRiderMsgsMap.size === 0) {
                container.innerHTML = `<div class="text-center text-gray-500 dark:text-gray-400 italic py-10 text-xs">No messages yet.</div>`;
            }
            setHasMoreRiderMsgs(false);
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
                setHasMoreRiderMsgs(merged.length > displayChunk.length || allMsgs.length >= RIDER_CHAT_BATCH_SIZE);
                if (displayChunk.length > 0) {
                    setOldestRiderMsgTimestamp(getMessageTimestamp(displayChunk[0]));
                    setOldestRiderMsgKey(displayChunk[0].id || null);
                }
                renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, true, 0, activeCustData);
                setIsInitialScrollDone(true);
                requestAnimationFrame(() => {
                    container.scrollTop = container.scrollHeight;
                    setTimeout(() => { container.scrollTop = container.scrollHeight; }, 60);
                    setTimeout(() => { container.scrollTop = container.scrollHeight; }, 180);
                });
                autoResolveRecentFbCustomerReplies(custId, container, activeCustData);
                autoResolveRecentFbCustomerAttachments(custId, container, activeCustData);
            } else {
                setHasMoreRiderMsgs(merged.length > loadedRiderMsgsMap.size || allMsgs.length >= RIDER_CHAT_BATCH_SIZE);
            }
        }
    });

    // 1. Lightning-fast child_added: streams each incoming/sent message individually in milliseconds (<50ms)
    const childListener = messagesQuery;
    setActiveRiderChatChildListener(childListener);
    childListener.on('child_added', (childSnap) => {
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

        // Guard against duplicate page echo arriving from Firebase (e.g. m_... duplicate of rider message)
        const isMsgRider = Boolean(fullMsg.isRider || fullMsg.senderType === 'rider');
        const isMsgPageSender = (fullMsg.sender || '').toLowerCase().includes('camiling delivery') || (fullMsg.sender || '').toLowerCase().includes('lokalex') || (fullMsg.sender || '').toLowerCase().includes('lolalex') || key.startsWith('m_');

        if (isMsgRider) {
            const incomingNorm = (fullMsg.text || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim().toLowerCase();
            const existingRiderMatch = Array.from(loadedRiderMsgsMap.values()).find(prev => {
                if (prev.id === key) return false;
                const isPrevRider = Boolean(prev.isRider || prev.senderType === 'rider');
                if (!isPrevRider) return false;
                const prevNorm = (prev.text || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim().toLowerCase();
                const sameMid = (fullMsg.metaMid && prev.metaMid && fullMsg.metaMid === prev.metaMid)
                             || (fullMsg.mid && prev.mid && fullMsg.mid === prev.mid)
                             || (fullMsg.mid && prev.id === fullMsg.mid)
                             || (prev.mid && key === prev.mid);
                const sameText = incomingNorm && prevNorm && (incomingNorm === prevNorm || incomingNorm.startsWith(prevNorm.slice(0, 40)) || prevNorm.startsWith(incomingNorm.slice(0, 40)));
                const timeDiff = Math.abs(getMessageTimestamp(prev) - msgTs);
                return sameMid || (sameText && timeDiff < 300000);
            });

            if (existingRiderMatch) {
                if (isMsgPageSender) {
                    // Drop page echo and delete stale key from Firebase
                    if (db && key.startsWith('m_')) {
                        db.ref(`customerChats/${custId}/messages/${key}`).remove().catch(() => {});
                    }
                    return;
                }
            }
        }

        // If initial 10-message slice is already rendered, ignore any older historical message
        if (isInitialScrollDone && oldestRiderMsgTimestamp && msgTs > 0 && msgTs < oldestRiderMsgTimestamp) {
            setHasMoreRiderMsgs(true);
            return;
        }

        const isNew = !loadedRiderMsgsMap.has(key);
        loadedRiderMsgsMap.set(key, fullMsg);

        if (oldestRiderMsgTimestamp === null || msgTs < oldestRiderMsgTimestamp) {
            setOldestRiderMsgTimestamp(msgTs);
            setOldestRiderMsgKey(key);
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
            setIsInitialScrollDone(true);
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
                const rawFolder = (currentRiderChatMeta?.folder || 'inbox').toLowerCase();
                const isDone = rawFolder === 'done' || currentRiderChatMeta?.status === 'completed' || currentRiderChatMeta?.status === 'done';
                const custDisplayName = activeCustData?.name || currentRiderChatMeta?.customerName || "";
                const activeCaterer = getActiveRosterCaterer(custDisplayName, custId, currentRiderChatMeta);
                const isCatered = !isDone && (rawFolder === 'catering' || Boolean(currentRiderChatMeta?.cateredByRiderName || currentRiderChatMeta?.cateredByRiderId || currentRiderChatMeta?.cateredBy) || Boolean(activeCaterer));
                const isApplicant = !isDone && !isCatered && (rawFolder === 'applicant' || currentRiderChatMeta?.isApplicant === true);
                const isFollowup = !isDone && !isCatered && !isApplicant && (rawFolder === 'followup');

                let targetFolder = 'inbox';
                if (isDone) targetFolder = 'done';
                else if (isCatered) targetFolder = 'catering';
                else if (isApplicant) targetFolder = 'applicant';
                else if (isFollowup) targetFolder = 'followup';
                else targetFolder = 'inbox';

                const threadForCheck = { custId, ...(currentRiderChatMeta || {}), customerName: custDisplayName };
                if (activeCaterer) {
                    threadForCheck.cateredByRiderId = threadForCheck.cateredByRiderId || (activeCaterer.telegramId || activeCaterer.id || "").toString().trim();
                    threadForCheck.cateredByRiderName = threadForCheck.cateredByRiderName || (activeCaterer.riderName || activeCaterer.name || "Rider").toString().trim();
                    threadForCheck.cateredBy = threadForCheck.cateredBy || threadForCheck.cateredByRiderName;
                }

                if (isCatered || targetFolder === 'catering') {
                    const isMine = isMyCustomerThread(threadForCheck);
                    if (isMine) playChatChime('catering');
                } else {
                    playChatChime(targetFolder);
                }

                if (shouldScroll) {
                    requestAnimationFrame(() => { 
                        container.scrollTop = container.scrollHeight;
                        setTimeout(() => { container.scrollTop = container.scrollHeight; }, 60);
                    });
                } else {
                    const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";
                    const preview = fullMsg.text || (fullMsg.videoUrl ? "🎥 Video" : (fullMsg.imageUrl ? "📷 Photo" : "📍 Location"));
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
    const changedListener = db.ref(`customerChats/${custId}/messages`);
    setActiveRiderChatChangedListener(changedListener);
    changedListener.on('child_changed', (childSnap) => {
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
            setLastPaginationRequestTime(now);
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

    setIsLoadingRiderHistory(true);
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
                setOldestRiderMsgTimestamp(getMessageTimestamp(sortedMsgs[0]));
                setOldestRiderMsgKey(sortedMsgs[0].id || null);
            }
            hideRiderTopSpinner();
            setHasMoreRiderMsgs(unrenderedCached.length > nextBatch.length);
            setIsLoadingRiderHistory(false);
            renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, false, oldScrollHeight, activeCustData);
            return;
        }
    }

    try {
        if (!oldestRiderMsgKey) {
            setHasMoreRiderMsgs(false);
            hideRiderTopSpinner();
            setIsLoadingRiderHistory(false);
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
            setHasMoreRiderMsgs(false);
            setIsLoadingRiderHistory(false);
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
            setOldestRiderMsgTimestamp(getMessageTimestamp(sortedMsgs[0]));
            setOldestRiderMsgKey(sortedMsgs[0].id || null);
        }
        setHasMoreRiderMsgs(entries.length >= RIDER_CHAT_OLDER_BATCH_SIZE);

        renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, false, oldScrollHeight, activeCustData);
    } catch (e) {
        console.error("Error loading older rider chat messages:", e);
        hideRiderTopSpinner();
    } finally {
        setIsLoadingRiderHistory(false);
    }
}

export function setRiderReply(msgId, senderName, text) {
    let previewText = text;
    let targetMsg = null;
    if (loadedRiderMsgsMap && loadedRiderMsgsMap.has(msgId)) {
        targetMsg = loadedRiderMsgsMap.get(msgId);
    }
    if (!previewText && targetMsg) {
        previewText = targetMsg.text || (targetMsg.videoUrl ? "🎥 Video" : (targetMsg.imageUrl ? "📷 Photo" : (targetMsg.locationCoords ? "📍 Location" : "Message")));
    }
    if (!previewText) previewText = "Quoted Message";

    setActiveRiderReplyTarget({ 
        id: msgId, 
        sender: senderName, 
        text: previewText,
        metaMid: targetMsg?.metaMid || null,
        mid: targetMsg?.mid || null
    });
    
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
    setActiveRiderReplyTarget(null);
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

if (typeof window !== 'undefined') {
    window.syncCurrentThreadFromMetaGraph = syncCurrentThreadFromMetaGraph;
}

