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
import { getCachedCustomerThreadsMap, getThreadDedupKey } from '../chatFeed/chatFeedState.js';
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
    if (msg.attachmentFailed) return;
    if (msg.text && msg.text.includes('[Message unavailable')) return;
    let mid = msg.metaMid || msg.mid || (String(msg.id).startsWith('m_') ? msg.id : null) || msg.id;
    if (typeof mid === 'string') {
        if (mid.startsWith('m_mid_')) mid = 'm_mid.' + mid.slice(6);
        else if (mid.startsWith('mid_')) mid = 'mid.' + mid.slice(4);
    }
    // Only valid Meta Message IDs (m_... or mid....) can be resolved via Meta Graph API
    if (typeof mid !== 'string' || (!mid.startsWith('m_') && !mid.startsWith('mid.'))) {
        return;
    }

    let isHandled = false;
    const markFailed = () => {
        if (isHandled) return;
        isHandled = true;
        const existing = loadedRiderMsgsMap.get(msg.id) || msg;
        existing.attachmentFailed = true;
        if (activeRiderChatCustId === custId && container) {
            appendOrUpdateSingleRiderMessage(container, existing, custData || activeCustData);
        }
    };

    const timer = setTimeout(markFailed, 7000);

    resolveFacebookMessageAttachment(custId, msg.id, mid).then(res => {
        clearTimeout(timer);
        if (isHandled) return;
        if (res && activeRiderChatCustId === custId) {
            isHandled = true;
            delete msg.attachmentFailed;
            const existing = loadedRiderMsgsMap.get(msg.id) || msg;
            delete existing.attachmentFailed;
            if (typeof res === 'string') {
                existing.imageUrl = res;
                existing.type = 'image';
            } else if (typeof res === 'object') {
                if (res.text) existing.text = res.text;
                if (res.imageUrl) existing.imageUrl = res.imageUrl;
                if (res.images && res.images.length > 0) existing.images = res.images;
                if (res.audioUrl) existing.audioUrl = res.audioUrl;
                if (res.videoUrl) existing.videoUrl = res.videoUrl;
                if (res.fileUrl) existing.fileUrl = res.fileUrl;
                if (res.type) existing.type = res.type;
            }

            const mediaPreview = existing.videoUrl ? '🎥 Video' : (existing.audioUrl ? '🎤 Voice message' : (existing.images && existing.images.length > 1 ? `📷 ${existing.images.length} Photos` : (existing.imageUrl ? '📷 Photo' : (existing.fileUrl ? '📄 Document' : existing.text))));
            if (!existing.text || existing.text.includes('[Facebook') || existing.text === '📷 Photo' || existing.text === 'Facebook Message') {
                existing.text = mediaPreview;
            }

            loadedRiderMsgsMap.set(msg.id, existing);

            const updatedSorted = Array.from(loadedRiderMsgsMap.values()).sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
            riderChatMemoryCache.set(custId, updatedSorted);
            idbSet('chats', custId, updatedSorted).catch(() => {});

            if (container) {
                appendOrUpdateSingleRiderMessage(container, existing, custData || activeCustData);
            }

            // Sync resolved preview to feed cache & customerChatMeta
            const msgTs = getMessageTimestamp(existing);
            const isFromCust = !existing.isRider && existing.senderType !== 'admin';
            const formattedPreview = isFromCust ? mediaPreview : `You: ${mediaPreview}`;
            try {
                if (typeof getCachedCustomerThreadsMap === 'function') {
                    const threadsMap = getCachedCustomerThreadsMap();
                    const dedupKey = getThreadDedupKey(custId, currentRiderChatMeta || {});
                    const t = threadsMap.get(dedupKey) || threadsMap.get(custId);
                    if (t && msgTs >= (t.lastUpdated || 0)) {
                        t.lastMessage = formattedPreview;
                        t.lastUpdated = msgTs;
                        t.hasRealMessages = true;
                    }
                }
            } catch (_) {}

            // Persist resolved media fields back to Firebase RTDB so they are permanently cached
            if (db && msg.id) {
                const patch = {};
                if (existing.imageUrl) patch.imageUrl = existing.imageUrl;
                if (existing.images) patch.images = existing.images;
                if (existing.audioUrl) patch.audioUrl = existing.audioUrl;
                if (existing.videoUrl) patch.videoUrl = existing.videoUrl;
                if (existing.fileUrl) patch.fileUrl = existing.fileUrl;
                if (existing.type) patch.type = existing.type;
                if (existing.text) patch.text = existing.text;
                if (Object.keys(patch).length > 0) {
                    db.ref(`customerChats/${custId}/messages/${msg.id}`).update(patch).catch(() => {});
                }
                const currentMetaTs = Number(currentRiderChatMeta?.lastUpdated) || 0;
                if (msgTs >= currentMetaTs) {
                    db.ref(`customerChatMeta/${custId}`).update({
                        lastMessage: formattedPreview,
                        lastUpdated: msgTs
                    }).catch(() => {});
                }
            }

            try {
                if (existing.imageUrl) {
                    const preloader = new Image();
                    preloader.src = existing.imageUrl;
                }
            } catch (_) {}
        } else if (!res) {
            markFailed();
        }
    }).catch(() => {
        clearTimeout(timer);
        markFailed();
    });
}

if (typeof window !== 'undefined') {
    window.retryFbAttachmentResolution = (custId, msgId) => {
        const msg = loadedRiderMsgsMap.get(msgId);
        if (!msg) return;
        delete msg.attachmentFailed;
        const container = document.getElementById('rider-cust-chat-messages') || document.getElementById('rider-chat-messages-container');
        if (container) appendOrUpdateSingleRiderMessage(container, msg, activeCustData);
        let mid = msg.metaMid || msg.mid || (String(msg.id).startsWith('m_') ? msg.id : null) || msg.id;
        resolveFacebookMessageAttachment(custId, msgId, mid, true).then(res => {
            if (res && activeRiderChatCustId === custId) {
                triggerInstantFbAttachmentResolution(custId, msg, container, activeCustData);
            } else {
                msg.attachmentFailed = true;
                if (container) appendOrUpdateSingleRiderMessage(container, msg, activeCustData);
            }
        }).catch(() => {
            msg.attachmentFailed = true;
            if (container) appendOrUpdateSingleRiderMessage(container, msg, activeCustData);
        });
    };
}

function autoResolveRecentFbCustomerAttachments(custId, container, custData) {
    if (!String(custId).startsWith('fb_')) return;
    const candidates = Array.from(loadedRiderMsgsMap.values())
        .filter(m => m && !m.attachmentFailed && !m.imageUrl && (!m.images || m.images.length === 0) && !m.audioUrl && !m.videoUrl && !(m.text && m.text.includes('[Message unavailable')) && (
            (m.text && (
                m.text.includes('[Facebook Attachment]') || 
                m.text.includes('[Facebook Photo]') || 
                m.text.includes('[Facebook Video]') || 
                m.text.includes('[Facebook Audio]') || 
                m.text.includes('📷 Photo') || 
                m.text.includes('🎥 Video') || 
                m.text.includes('🎤 Voice')
            )) ||
            m.type === 'image' ||
            m.type === 'video' ||
            m.type === 'audio' ||
            m.type === 'file'
        ));
    for (const m of candidates) {
        triggerInstantFbAttachmentResolution(custId, m, container, custData);
    }
}

function autoResolveRecentFbCustomerReplies(custId, container, custData) {
    if (!String(custId).startsWith('fb_')) return;
    const isMetaMid = (val) => typeof val === 'string' && (val.startsWith('m_') || val.startsWith('mid.') || val.startsWith('m_mid.') || val.startsWith('m_mid_') || val.startsWith('mid_'));
    const candidates = Array.from(loadedRiderMsgsMap.values())
        .filter(m => m && !m.isRider && !m.replyTo && (isMetaMid(m.mid) || isMetaMid(m.metaMid) || isMetaMid(m.id)))
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
let fbGraphPollingInterval = null;

export function stopFbGraphPolling() {
    if (fbGraphPollingInterval) {
        clearInterval(fbGraphPollingInterval);
        fbGraphPollingInterval = null;
    }
}

/**
 * Direct Parallel Meta Graph API Fast-Sync:
 * Fetches the newest 15 messages directly from the Facebook Page / Meta edge servers
 * in parallel with Firebase RTDB. Guarantees 0-latency message retrieval even if webhook was delayed.
 */
export const lastGraphSyncTimeMap = new Map(); // targetCustId -> timestamp

export async function syncCurrentThreadFromMetaGraph(custId, showFeedback = false) {
    const targetCustId = custId || activeRiderChatCustId;
    if (!targetCustId || !String(targetCustId).startsWith('fb_')) return;
    if (isSyncingGraphMessages) return;

    // Throttle automatic Graph API fetches (minimum 3 minutes interval per thread) unless user clicked manual Sync button
    const now = Date.now();
    const lastSyncTime = lastGraphSyncTimeMap.get(targetCustId) || 0;
    if (!showFeedback && (now - lastSyncTime < 180000)) {
        return;
    }

    const psid = String(targetCustId).replace(/^(?:fb_|messenger_)+/i, '').trim();
    if (!psid || !/^\d+$/.test(psid)) return;

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

        const convUrl = `https://graph.facebook.com/v19.0/me/conversations?user_id=${psid}&fields=messages.limit(15){id,message,from,created_time,attachments{id,mime_type,name,size,file_url,image_data,video_data,payload,subattachments}}&access_token=${encodeURIComponent(token)}`;
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

            const hasTextMessage = Boolean(m.message && m.message.trim().length > 0);
            const hasAttachments = Boolean(m.attachments?.data && m.attachments.data.length > 0);
            const hasShares = Boolean(m.shares?.data && m.shares.data.length > 0);

            // Filter out empty Facebook status/transfer/handoff echoes that have no content
            if (!hasTextMessage && !hasAttachments && !hasShares) {
                if (db) {
                    db.ref(`customerChats/${targetCustId}/messages/${safeMid}`).remove().catch(() => {});
                }
                document.getElementById(`msg-bubble-${safeMid}`)?.remove();
                loadedRiderMsgsMap.delete(safeMid);
                continue;
            }

            // Check if already loaded or rendered
            const existingLoaded = loadedRiderMsgsMap.get(safeMid) 
                || loadedRiderMsgsMap.get(rawMid)
                || Array.from(loadedRiderMsgsMap.values()).find(prev => prev.id === safeMid || prev.id === rawMid || prev.mid === safeMid || prev.metaMid === rawMid || prev.mid === rawMid || prev.metaMid === safeMid);

            if (existingLoaded) {
                // If message is already loaded or rendered:
                // NEVER allow Meta Graph API's static historical body to overwrite an edited message!
                // Meta Graph API GET /messages returns the original pre-edit text for historical messages.
                if (existingLoaded.isEdited) {
                    continue;
                }
                // If existingLoaded already has text, do not overwrite it with Graph API historical text
                if (existingLoaded.text) {
                    continue;
                }
                // If existingLoaded was a placeholder lacking text, populate it
                if (m.message && !existingLoaded.text) {
                    existingLoaded.text = m.message.trim();
                    if (container) appendOrUpdateSingleRiderMessage(container, existingLoaded, activeCustData);
                }
                continue;
            }

            const isRider = m.from?.id && String(m.from.id) !== psid;
            const ts = m.created_time ? new Date(m.created_time).getTime() : Date.now();
            let text = m.message || '';
            let imageUrl = null;
            let thumbnailUrl = null;
            let images = [];
            let audioUrl = null;
            let videoUrl = null;
            let fileUrl = null;
            let type = 'text';

            if (m.attachments?.data && Array.isArray(m.attachments.data)) {
                for (const att of m.attachments.data) {
                    const attType = (att.type || '').toLowerCase();
                    const mime = (att.mime_type || '').toLowerCase();
                    const u = att?.image_data?.url || att?.video_data?.url || att?.audio_data?.url || att?.payload?.url || att?.media?.image?.src || att?.file_url;
                    const thumb = att?.image_data?.preview_url || att?.preview_url;
                    if (thumb && !thumbnailUrl) thumbnailUrl = thumb;

                    // Strictly detect Google Maps Links or Shared Location attachments
                    const isMapUrl = typeof u === 'string' && /maps\.google\.com|google\.com\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.apple\.com|waze\.com/i.test(u);
                    if (attType === 'location' || isMapUrl) {
                        type = 'location';
                        if (!text || text === '📷 Photo' || text.startsWith('📷')) {
                            text = u || att?.title || 'Shared Location Pin';
                        }
                        continue;
                    }
                    
                    if (attType === 'audio' || attType === 'voice' || mime.includes('audio') || (typeof u === 'string' && (/\.(aac|mp3|m4a|wav|ogg|opus)(\?|$)/i.test(u) || u.includes('audioclip')))) {
                        if (u && !audioUrl) audioUrl = u;
                        type = 'audio';
                        continue;
                    }
                    if (attType === 'video' || mime.includes('video') || (typeof u === 'string' && (/\.(mp4|mov|webm|3gp|mkv)(\?|$)/i.test(u) || u.includes('video.xx.fbcdn.net') || u.includes('/m483/') || u.includes('/v/t2/')))) {
                        if (u && !videoUrl) videoUrl = u;
                        type = 'video';
                        continue;
                    }
                    if (attType === 'file' || (typeof u === 'string' && /\.(pdf|docx?|xlsx?|csv|zip|rar|txt)(\?|$)/i.test(u))) {
                        if (u && !fileUrl) fileUrl = u;
                        type = 'file';
                        continue;
                    }

                    if (att.subattachments?.data && Array.isArray(att.subattachments.data)) {
                        for (const sub of att.subattachments.data) {
                            const subUrl = sub?.image_data?.url || sub?.video_data?.url || sub?.audio_data?.url || sub?.media?.image?.src || sub?.payload?.url || sub?.file_url;
                            const isSubMap = typeof subUrl === 'string' && /maps\.google\.com|google\.com\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.apple\.com|waze\.com/i.test(subUrl);
                            if (subUrl && !isSubMap && !images.includes(subUrl)) images.push(subUrl);
                        }
                    }

                    if (u && !isMapUrl && !images.includes(u)) {
                        images.push(u);
                    }
                }
                if (images.length > 0) {
                    imageUrl = images[0];
                    if (type === 'text') type = 'image';
                }
            }

            // Check if text itself contains a Google Map link:
            if (typeof text === 'string' && /maps\.google\.com|google\.com\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.apple\.com|waze\.com/i.test(text)) {
                if (type === 'image') type = 'location';
                imageUrl = null;
                images = [];
            }

            if (!text) {
                if (type === 'audio' || audioUrl) text = '🎤 Voice message';
                else if (type === 'video' || videoUrl) text = '🎥 Video';
                else if (images.length > 1) text = `📷 ${images.length} Photos`;
                else if (imageUrl || type === 'image') text = '📷 Photo';
                else if (fileUrl || type === 'file') text = '📄 Document';
                else if (m.attachments?.data && m.attachments.data.length > 0) {
                    const firstMime = (m.attachments.data[0]?.mime_type || '').toLowerCase();
                    if (firstMime.includes('video')) {
                        type = 'video';
                        text = '🎥 Video';
                    } else if (firstMime.includes('audio')) {
                        type = 'audio';
                        text = '🎤 Voice message';
                    } else {
                        type = 'image';
                        text = '📷 Photo';
                    }
                }
            }

            // Skip empty Meta system/page events that have neither text nor attachments
            if (!text && !imageUrl && !videoUrl && !audioUrl && !fileUrl && (!images || images.length === 0)) {
                continue;
            }

            const normText = (text || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim().toLowerCase();

            const isGenericMsgPlaceholder = (t) => {
                if (!t) return true;
                const clean = String(t).trim().toLowerCase();
                return clean === '📷 photo' || 
                       clean === '🎥 video' || 
                       clean === '🎤 voice message' || 
                       clean.includes('photos') || 
                       clean.includes('[facebook') || 
                       clean === 'facebook message' ||
                       clean === '📄 document';
            };

            const hasAnyMediaAttachment = (m) => {
                if (!m) return false;
                return Boolean(
                    m.imageUrl || 
                    m.videoUrl || 
                    m.audioUrl || 
                    m.fileUrl || 
                    (Array.isArray(m.images) && m.images.length > 0) ||
                    (m.type && m.type !== 'text')
                );
            };

            // Comprehensive deduplication: check if this message already exists in memory or loaded messages
            const isMatch = (existing) => {
                if (!existing) return false;
                if (existing.id === safeMid || existing.id === rawMid || existing.metaMid === rawMid || existing.mid === safeMid) {
                    return true;
                }
                const sameDirection = Boolean(existing.isRider) === Boolean(isRider);
                if (sameDirection) {
                    const exNorm = (existing.text || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim().toLowerCase();
                    const isGeneric = isGenericMsgPlaceholder(normText) || isGenericMsgPlaceholder(exNorm);
                    const eitherHasMedia = hasAnyMediaAttachment(existing) || Boolean(imageUrl || videoUrl || audioUrl || fileUrl || (images && images.length) || (type && type !== 'text'));

                    // NEVER deduplicate separate media items or generic placeholder messages by text alone
                    if (!isGeneric && !eitherHasMedia && exNorm && normText && (exNorm === normText || exNorm.startsWith(normText.slice(0, 40)) || normText.startsWith(exNorm.slice(0, 40)))) {
                        const diff = Math.abs(getMessageTimestamp(existing) - ts);
                        if (diff < 300000) { // within 5 minutes
                            return true;
                        }
                    }

                    // Match rider media sent from app within 2 minutes if the rider message does not have mid yet
                    if (isRider && eitherHasMedia) {
                        const diff = Math.abs(getMessageTimestamp(existing) - ts);
                        if (diff < 120000 && !existing.metaMid && (existing.id.startsWith('-') || existing.id.startsWith('msg_'))) {
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

                // Heal failed or sending status if confirmed present on Meta Graph API
                if (existingMatch.status === 'failed' || existingMatch.failed || existingMatch.status === 'sending') {
                    existingMatch.status = 'sent';
                    existingMatch.failed = false;
                    existingMatch.failedReason = null;
                    if (db) {
                        db.ref(`customerChats/${targetCustId}/messages/${existingMatch.id}`).update({
                            status: 'sent',
                            failed: null,
                            failedReason: null,
                            metaMid: rawMid,
                            mid: safeMid
                        }).catch(() => {});
                    }
                    const container = document.getElementById('rider-chat-messages-container') || document.getElementById('rider-cust-chat-messages');
                    if (container && typeof appendOrUpdateSingleRiderMessage === 'function') {
                        appendOrUpdateSingleRiderMessage(container, existingMatch, activeCustData);
                    }
                }

                // Refresh image URL if fresh attachment was retrieved from Graph API
                if (imageUrl && (!existingMatch.imageUrl || existingMatch.imageUrl !== imageUrl)) {
                    existingMatch.imageUrl = imageUrl;
                    if (thumbnailUrl) existingMatch.thumbnailUrl = thumbnailUrl;
                    if (images && images.length > 0) existingMatch.images = images;
                    if (existingMatch.type === 'text') existingMatch.type = 'image';

                    const bubble = document.getElementById(`msg-bubble-${existingMatch.id}`) || document.getElementById(`msg-bubble-${safeMid}`);
                    if (bubble) {
                        const fallbackCard = bubble.querySelector('.chat-img-fallback-card');
                        if (fallbackCard) fallbackCard.remove();
                        const img = bubble.querySelector('img');
                        if (img) {
                            img.referrerPolicy = 'no-referrer';
                            img.src = thumbnailUrl || imageUrl;
                            img.removeAttribute('data-failed');
                            img.style.display = '';
                        }
                    }

                    if (db) {
                        db.ref(`customerChats/${targetCustId}/messages/${existingMatch.id}`).update({
                            imageUrl: imageUrl,
                            thumbnailUrl: thumbnailUrl || null,
                            images: (images && images.length > 0) ? images : null,
                            metaMid: rawMid,
                            mid: safeMid,
                            type: 'image'
                        }).catch(() => {});
                    }
                }

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
                thumbnailUrl: thumbnailUrl || null,
                images: images.length > 0 ? images : null,
                audioUrl: audioUrl,
                videoUrl: videoUrl,
                fileUrl: fileUrl,
                type: type,
                attachmentFailed: Boolean((text && text.includes('[Message unavailable')) || (existingMatch?.attachmentFailed && !imageUrl && (!images || images.length === 0)))
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

        if (sortedGraphMsgs.length > 0 && db) {
            // Find the latest Graph message that actually has text or media attachments (skip empty system events)
            let absoluteLatestMsg = null;
            for (let i = sortedGraphMsgs.length - 1; i >= 0; i--) {
                const candidate = sortedGraphMsgs[i];
                if ((candidate?.message && candidate.message.trim()) || (candidate?.attachments?.data && candidate.attachments.data.length > 0)) {
                    absoluteLatestMsg = candidate;
                    break;
                }
            }
            const absTs = absoluteLatestMsg?.created_time ? new Date(absoluteLatestMsg.created_time).getTime() : 0;
            const isFromPage = Boolean(absoluteLatestMsg?.from && String(absoluteLatestMsg.from.id) !== psid);
            const absText = (absoluteLatestMsg?.message || '').trim() || (absoluteLatestMsg?.attachments?.data?.length ? '📷 Facebook Attachment' : (lastMsgText || ''));
            const formattedLatestPreview = absText ? (isFromPage ? `You: ${absText}` : absText) : '';

            // Only update customerChatMeta if this graph message has real content and is newer or equal to current metadata timestamp
            const currentMetaTs = Number(currentRiderChatMeta?.lastUpdated) || 0;
            if (formattedLatestPreview && absTs && absTs >= currentMetaTs) {
                db.ref(`customerChatMeta/${targetCustId}`).update({
                    lastMessage: formattedLatestPreview,
                    lastUpdated: absTs,
                    channel: 'messenger'
                }).catch(() => {});

                try {
                    if (typeof getCachedCustomerThreadsMap === 'function') {
                        const threadsMap = getCachedCustomerThreadsMap();
                        const dedupKey = getThreadDedupKey(targetCustId, currentRiderChatMeta || {});
                        const t = threadsMap.get(dedupKey) || threadsMap.get(targetCustId);
                        if (t && absTs >= (t.lastUpdated || 0)) {
                            t.lastMessage = formattedLatestPreview;
                            t.lastUpdated = absTs;
                            t.hasRealMessages = true;
                        }
                    }
                } catch (_) {}
            }

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
        lastGraphSyncTimeMap.set(targetCustId, Date.now());
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

    // Fast-sync directly with Facebook Page on open; real-time incoming messages stream over WebSockets
    stopFbGraphPolling();
    if (String(custId).startsWith('fb_')) {
        syncCurrentThreadFromMetaGraph(custId, false).catch(() => {});
    }

    // =========================================================================
    // HELPER: Realtime live incoming child_added event processor
    // =========================================================================
    function handleIncomingLiveChild(childSnap) {
        if (activeRiderChatCustId !== custId) return;
        const key = childSnap.key;
        const msg = childSnap.val();
        if (!key || !msg) return;

        const fullMsg = { id: key, ...msg };
        const msgTs = getMessageTimestamp(fullMsg);
        if (!fullMsg.timestamp && msgTs > 0) {
            fullMsg.timestamp = msgTs;
        }

        // Keep master RAM cache & IndexedDB updated
        let memCached = riderChatMemoryCache.get(custId) || [];
        const existingIdx = memCached.findIndex(m => m.id === key);
        if (existingIdx >= 0) {
            const prev = memCached[existingIdx];
            if (prev && prev.isEdited && (!fullMsg.isEdited || fullMsg.text === prev.originalText)) {
                fullMsg.text = prev.text;
                fullMsg.message = prev.text;
                fullMsg.originalText = prev.originalText;
                fullMsg.isEdited = true;
                fullMsg.editedAt = prev.editedAt;
                fullMsg.numEdit = prev.numEdit;
            }
            memCached[existingIdx] = fullMsg;
        } else {
            memCached.push(fullMsg);
        }
        memCached.sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
        riderChatMemoryCache.set(custId, memCached);
        idbSet('chats', custId, memCached).catch(() => {});

        // If message is already rendered in the current DOM view:
        if (loadedRiderMsgsMap.has(key)) {
            const prev = loadedRiderMsgsMap.get(key);
            if (prev && prev.isEdited && (!fullMsg.isEdited || fullMsg.text === prev.originalText)) {
                fullMsg.text = prev.text;
                fullMsg.message = prev.text;
                fullMsg.originalText = prev.originalText;
                fullMsg.isEdited = true;
                fullMsg.editedAt = prev.editedAt;
                fullMsg.numEdit = prev.numEdit;
            }
            loadedRiderMsgsMap.set(key, fullMsg);
            appendOrUpdateSingleRiderMessage(container, fullMsg, activeCustData);
            const needsRes = String(custId).startsWith('fb_') && 
                !fullMsg.imageUrl && 
                (!fullMsg.images || fullMsg.images.length === 0) && 
                !fullMsg.audioUrl && 
                !fullMsg.videoUrl && 
                !fullMsg.attachmentFailed &&
                (
                    (fullMsg.text && (
                        fullMsg.text.includes('[Facebook') || 
                        fullMsg.text.includes('📷 Photo') || 
                        fullMsg.text.includes('🎥 Video') || 
                        fullMsg.text.includes('🎤 Voice')
                    )) || 
                    fullMsg.type === 'image' || 
                    fullMsg.type === 'video' || 
                    fullMsg.type === 'audio'
                );
            if (needsRes) {
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
                const sameMid = (fullMsg.metaMid && prev.metaMid && fullMsg.metaMid === prev.metaMid)
                             || (fullMsg.mid && prev.mid && fullMsg.mid === prev.mid)
                             || (fullMsg.mid && prev.id === fullMsg.mid)
                             || (prev.mid && key === prev.mid);
                if (sameMid) return true;

                const prevNorm = (prev.text || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim().toLowerCase();
                const isGeneric = (t) => {
                    if (!t) return true;
                    const c = t.toLowerCase();
                    return c === '📷 photo' || c === '🎥 video' || c === '🎤 voice message' || c.includes('photos') || c.includes('[facebook');
                };
                const hasMedia = (m) => Boolean(m.imageUrl || m.videoUrl || m.audioUrl || m.fileUrl || (m.images && m.images.length) || (m.type && m.type !== 'text'));

                if (!isGeneric(incomingNorm) && !isGeneric(prevNorm) && !hasMedia(fullMsg) && !hasMedia(prev)) {
                    const sameText = incomingNorm && prevNorm && (incomingNorm === prevNorm || incomingNorm.startsWith(prevNorm.slice(0, 40)) || prevNorm.startsWith(incomingNorm.slice(0, 40)));
                    const timeDiff = Math.abs(getMessageTimestamp(prev) - msgTs);
                    return sameText && timeDiff < 300000;
                }
                return false;
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

        const hasAnyContent = Boolean(
            (fullMsg.text && fullMsg.text.trim().length > 0) ||
            fullMsg.imageUrl ||
            (Array.isArray(fullMsg.images) && fullMsg.images.length > 0) ||
            fullMsg.videoUrl ||
            fullMsg.audioUrl ||
            fullMsg.fileUrl ||
            fullMsg.locationCoords ||
            (fullMsg.type && fullMsg.type !== 'text' && fullMsg.type !== 'system')
        );

        // Discard any empty ghost message (echo with no content)
        if (!hasAnyContent) {
            if (db && key.startsWith('m_')) {
                db.ref(`customerChats/${custId}/messages/${key}`).remove().catch(() => {});
            }
            return;
        }

        // If initial slice is already rendered, ignore any older historical message
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

            // Proactively resolve incoming Facebook attachment immediately
            const needsRes = String(custId).startsWith('fb_') && 
                !fullMsg.imageUrl && 
                (!fullMsg.images || fullMsg.images.length === 0) && 
                !fullMsg.audioUrl && 
                !fullMsg.videoUrl && 
                !fullMsg.attachmentFailed &&
                (
                    (fullMsg.text && (
                        fullMsg.text.includes('[Facebook') || 
                        fullMsg.text.includes('📷 Photo') || 
                        fullMsg.text.includes('🎥 Video') || 
                        fullMsg.text.includes('🎤 Voice')
                    )) || 
                    fullMsg.type === 'image' || 
                    fullMsg.type === 'video' || 
                    fullMsg.type === 'audio' ||
                    fullMsg.type === 'file'
                );
            if (needsRes) {
                triggerInstantFbAttachmentResolution(custId, fullMsg, container, activeCustData);
            }

            // Keep in-memory feed thread card & Firebase customerChatMeta in sync immediately
            const preview = fullMsg.text || (fullMsg.videoUrl ? "🎥 Video" : (fullMsg.imageUrl ? "📷 Photo" : (fullMsg.audioUrl ? "🎤 Voice message" : (fullMsg.locationCoords ? "📍 Location" : "Message"))));
            const formattedPreview = isFromCustomer ? preview : `You: ${preview}`;

            try {
                if (typeof getCachedCustomerThreadsMap === 'function') {
                    const threadsMap = getCachedCustomerThreadsMap();
                    const dedupKey = getThreadDedupKey(custId, currentRiderChatMeta || {});
                    const existingThread = threadsMap.get(dedupKey) || threadsMap.get(custId);
                    if (existingThread && msgTs >= (existingThread.lastUpdated || 0)) {
                        existingThread.lastMessage = formattedPreview;
                        existingThread.lastUpdated = msgTs;
                        existingThread.hasRealMessages = true;
                        if (isFromCustomer) {
                            existingThread.isUnread = true;
                            existingThread.unreadForRider = true;
                        }
                    }
                }
            } catch (_) {}

            if (db && msgTs >= (Number(currentRiderChatMeta?.lastUpdated) || 0)) {
                const metaPatch = {
                    lastMessage: formattedPreview,
                    lastUpdated: msgTs
                };
                if (isFromCustomer) {
                    metaPatch.unreadForRider = true;
                }
                db.ref(`customerChatMeta/${custId}`).update(metaPatch).catch(() => {});
            }

            if (isNew && isFromCustomer) {
                const rawFolder = (currentRiderChatMeta?.folder || 'inbox').toLowerCase();
                const isDone = rawFolder === 'done' || currentRiderChatMeta?.status === 'completed' || currentRiderChatMeta?.status === 'done';
                const custDisplayName = activeCustData?.name || currentRiderChatMeta?.customerName || "";
                const activeCaterer = getActiveRosterCaterer(custDisplayName, custId, currentRiderChatMeta);
                const isCatered = !isDone && (Boolean(activeCaterer) || rawFolder === 'catering');
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
                    threadForCheck.cateredByRiderId = (activeCaterer.telegramId || activeCaterer.id || "").toString().trim();
                    threadForCheck.cateredByRiderName = (activeCaterer.riderName || activeCaterer.name || "Rider").toString().trim();
                    threadForCheck.cateredBy = threadForCheck.cateredByRiderName;
                }

                if (isCatered || targetFolder === 'catering' || rawFolder === 'catering') {
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
    }

    // =========================================================================
    // INTELLIGENT DELTA SYNC vs INITIAL BATCH LOAD
    // =========================================================================
    const latestCachedTs = hasLocalRecord 
        ? Math.max(...localMessages.map(m => getMessageTimestamp(m) || 0), 0)
        : 0;

    if (hasLocalRecord && latestCachedTs > 0) {
        // CASE A: Thread is already in local memory/IndexedDB cache!
        // Instant 0ms visual display is already rendered on screen.
        // Strictly fetch ONLY messages that were posted after our latest cached timestamp.
        const deltaQuery = db.ref(`customerChats/${custId}/messages`)
            .orderByChild('timestamp')
            .startAt(latestCachedTs + 1);

        setActiveRiderChatListener(deltaQuery);

        deltaQuery.once('value', (snap) => {
            if (activeRiderChatCustId !== custId) return;
            const data = snap.val();
            if (data && typeof data === 'object') {
                const newDeltas = Object.entries(data)
                    .map(([k, m]) => ({ id: k, ...m }))
                    .sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));

                if (newDeltas.length > 0) {
                    let mem = riderChatMemoryCache.get(custId) || [];
                    const map = new Map(mem.map(m => [m.id, m]));
                    newDeltas.forEach(m => map.set(m.id, m));
                    const updated = Array.from(map.values()).sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
                    riderChatMemoryCache.set(custId, updated);
                    idbSet('chats', custId, updated).catch(() => {});

                    newDeltas.forEach(m => {
                        loadedRiderMsgsMap.set(m.id, m);
                        appendOrUpdateSingleRiderMessage(container, m, activeCustData);
                    });
                    requestAnimationFrame(() => {
                        container.scrollTop = container.scrollHeight;
                    });
                }
            }
        });

        // Attach live listener starting strictly after cached timestamp
        // Skip duplicate initial fetch since deltaQuery.once('value') above already fetched missed deltas!
        deltaQuery._skipInitialFetch = true;
        setActiveRiderChatChildListener(deltaQuery);
        deltaQuery.on('child_added', handleIncomingLiveChild);

    } else {
        // CASE B: First-time open / Cache miss.
        // Atomically fetch the last 10 messages in ONE pass with .once('value')
        const initialQuery = db.ref(`customerChats/${custId}/messages`)
            .orderByChild('timestamp')
            .limitToLast(RIDER_CHAT_BATCH_SIZE);

        setActiveRiderChatListener(initialQuery);

        let skeletonTimeout = setTimeout(() => {
            if (activeRiderChatCustId === custId && loadedRiderMsgsMap.size === 0) {
                // If taking more than 8s, offer a manual sync button instead of falsely showing "No messages yet"
                const skel = document.getElementById('rider-chat-loading-skeleton');
                if (skel) {
                    skel.innerHTML = `
                    <div class="flex flex-col items-center justify-center py-8 text-center text-xs text-gray-500 dark:text-gray-400">
                        <i class="fa-solid fa-spinner fa-spin text-lg text-emerald-500 mb-2"></i>
                        <span>Loading conversation...</span>
                        ${String(custId).startsWith('fb_') ? `
                        <button type="button" onclick="window.syncCurrentThreadFromMetaGraph && window.syncCurrentThreadFromMetaGraph('${escapeHtml(custId)}', true)" class="mt-2 text-blue-500 hover:underline text-[11px] font-bold cursor-pointer">
                            Sync from Facebook
                        </button>` : ''}
                    </div>`;
                }
            }
        }, 8000);

        initialQuery.once('value', (snapshot) => {
            if (skeletonTimeout) {
                clearTimeout(skeletonTimeout);
                skeletonTimeout = null;
            }
            if (activeRiderChatCustId !== custId) return;
            const data = snapshot.val();
            if (!data || Object.keys(data).length === 0) {
                // Check if this thread has an existing lastMessage or conversation from cache or metadata
                let hasKnownConversation = false;
                let lastKnownText = "";
                if (typeof getCachedCustomerThreadsMap === 'function') {
                    const tMap = getCachedCustomerThreadsMap();
                    const rawPsid = custId.replace(/^(?:fb_|messenger_)+/i, '');
                    const t = tMap ? (tMap.get(custId) || tMap.get(`fb_${rawPsid}`) || tMap.get(rawPsid)) : null;
                    if (t && (t.hasRealMessages || (t.lastMessage && t.lastMessage !== 'No messages yet'))) {
                        hasKnownConversation = true;
                        lastKnownText = t.lastMessage;
                    }
                }
                if (!hasKnownConversation && currentRiderChatMeta && (currentRiderChatMeta.lastMessage && currentRiderChatMeta.lastMessage !== 'No messages yet')) {
                    hasKnownConversation = true;
                    lastKnownText = currentRiderChatMeta.lastMessage;
                }

                if (hasKnownConversation && String(custId).startsWith('fb_')) {
                    // Instantly trigger Graph API sync to pull messages directly from Facebook
                    syncCurrentThreadFromMetaGraph(custId, false).catch(() => {});
                }

                if (loadedRiderMsgsMap.size === 0) {
                    if (hasKnownConversation) {
                        container.innerHTML = `
                        <div class="flex flex-col items-center justify-center py-10 px-4 text-center">
                            <div class="w-10 h-10 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center text-lg mb-2">
                                <i class="fa-solid fa-comments"></i>
                            </div>
                            <span class="text-xs font-bold text-gray-700 dark:text-gray-300">${escapeHtml(lastKnownText || 'Existing Conversation')}</span>
                            <button type="button" onclick="window.syncCurrentThreadFromMetaGraph && window.syncCurrentThreadFromMetaGraph('${escapeHtml(custId)}', true)" class="mt-3 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-md">
                                <i class="fa-solid fa-arrows-rotate"></i> Sync Messages
                            </button>
                        </div>`;
                    } else {
                        container.innerHTML = `<div class="text-center text-gray-500 dark:text-gray-400 italic py-10 text-xs">No messages yet.</div>`;
                    }
                }
                setHasMoreRiderMsgs(false);
                setIsInitialScrollDone(true);

                // Listen for incoming messages with a 60s buffer (skip initial HTTP re-fetch)
                const liveQuery = db.ref(`customerChats/${custId}/messages`)
                    .orderByChild('timestamp')
                    .startAt(Date.now() - 60000);
                liveQuery._skipInitialFetch = true;
                setActiveRiderChatChildListener(liveQuery);
                liveQuery.on('child_added', handleIncomingLiveChild);
            } else {
                const allMsgs = Object.entries(data)
                    .map(([key, msg]) => {
                        const full = { id: key, ...msg };
                        if (!full.timestamp) {
                            const resolvedTs = getMessageTimestamp(full);
                            if (resolvedTs > 0) {
                                full.timestamp = resolvedTs;
                            }
                        }
                        return full;
                    })
                    .sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));

                riderChatMemoryCache.set(custId, allMsgs);
                idbSet('chats', custId, allMsgs).catch(() => {});

                const displayChunk = allMsgs.slice(-RIDER_CHAT_BATCH_SIZE);
                loadedRiderMsgsMap.clear();
                displayChunk.forEach(m => loadedRiderMsgsMap.set(m.id, m));
                setHasMoreRiderMsgs(allMsgs.length >= RIDER_CHAT_BATCH_SIZE);
                if (displayChunk.length > 0) {
                    setOldestRiderMsgTimestamp(getMessageTimestamp(displayChunk[0]));
                    setOldestRiderMsgKey(displayChunk[0].id || null);
                }

                // Render ALL initial messages atomically at once - ZERO one-by-one popping!
                renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, true, 0, activeCustData);
                setIsInitialScrollDone(true);
                requestAnimationFrame(() => {
                    container.scrollTop = container.scrollHeight;
                    setTimeout(() => { container.scrollTop = container.scrollHeight; }, 60);
                });
                autoResolveRecentFbCustomerReplies(custId, container, activeCustData);
                autoResolveRecentFbCustomerAttachments(custId, container, activeCustData);

                // Now attach live query strictly starting AFTER the newest loaded message timestamp
                const maxTs = Math.max(...allMsgs.map(m => getMessageTimestamp(m) || 0), 0);
                const liveQuery = db.ref(`customerChats/${custId}/messages`)
                    .orderByChild('timestamp')
                    .startAt(maxTs + 1);
                liveQuery._skipInitialFetch = true;
                setActiveRiderChatChildListener(liveQuery);
                liveQuery.on('child_added', handleIncomingLiveChild);
            }
        });
    }

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
        const existingIdx = memCached.findIndex(m => m.id === key || m.mid === key || m.metaMid === key || (fullMsg.mid && m.mid === fullMsg.mid));
        if (existingIdx >= 0) {
            const prev = memCached[existingIdx];
            let updated = { ...prev, ...fullMsg };
            if (prev && prev.isEdited && (!fullMsg.isEdited || fullMsg.text === prev.originalText)) {
                updated.text = prev.text;
                updated.message = prev.text;
                updated.originalText = prev.originalText;
                updated.isEdited = true;
                updated.editedAt = prev.editedAt;
                updated.numEdit = prev.numEdit;
            }
            memCached[existingIdx] = updated;
        } else {
            memCached.push(fullMsg);
        }
        memCached.sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
        riderChatMemoryCache.set(custId, memCached);
        idbSet('chats', custId, memCached).catch(() => {});

        let targetKey = key;
        if (!loadedRiderMsgsMap.has(key)) {
            for (const [k, m] of loadedRiderMsgsMap.entries()) {
                if (k === key || m.id === key || m.mid === key || m.metaMid === key ||
                    (fullMsg.mid && (k === fullMsg.mid || m.mid === fullMsg.mid || m.id === fullMsg.mid)) ||
                    (fullMsg.metaMid && (k === fullMsg.metaMid || m.metaMid === fullMsg.metaMid))) {
                    targetKey = k;
                    break;
                }
            }
        }

        const isKnown = loadedRiderMsgsMap.has(targetKey) 
            || Boolean(document.getElementById(`msg-bubble-${key}`))
            || Boolean(fullMsg.mid && document.getElementById(`msg-bubble-${fullMsg.mid}`))
            || Boolean(fullMsg.metaMid && document.getElementById(`msg-bubble-${fullMsg.metaMid}`));

        if (isKnown) {
            const existingLoaded = loadedRiderMsgsMap.get(targetKey) || {};
            let mergedMsg = { ...existingLoaded, ...fullMsg, id: targetKey };
            if (existingLoaded && existingLoaded.isEdited && (!fullMsg.isEdited || fullMsg.text === existingLoaded.originalText)) {
                mergedMsg.text = existingLoaded.text;
                mergedMsg.message = existingLoaded.text;
                mergedMsg.originalText = existingLoaded.originalText;
                mergedMsg.isEdited = true;
                mergedMsg.editedAt = existingLoaded.editedAt;
                mergedMsg.numEdit = existingLoaded.numEdit;
            }
            loadedRiderMsgsMap.set(targetKey, mergedMsg);
            appendOrUpdateSingleRiderMessage(container, mergedMsg, activeCustData);
            const needsRes = String(custId).startsWith('fb_') && 
                !mergedMsg.imageUrl && 
                (!mergedMsg.images || mergedMsg.images.length === 0) && 
                !mergedMsg.audioUrl && 
                !mergedMsg.videoUrl && 
                !mergedMsg.attachmentFailed &&
                (
                    (mergedMsg.text && (
                        mergedMsg.text.includes('[Facebook') || 
                        mergedMsg.text.includes('📷 Photo') || 
                        mergedMsg.text.includes('🎥 Video') || 
                        mergedMsg.text.includes('🎤 Voice')
                    )) || 
                    mergedMsg.type === 'image' || 
                    mergedMsg.type === 'video' || 
                    mergedMsg.type === 'audio'
                );
            if (needsRes) {
                triggerInstantFbAttachmentResolution(custId, mergedMsg, container, activeCustData);
            }
        }
    });
}

const lastSyncedMetaSigMap = new Map();

/**
 * Instant Bridge: When customerChatMeta receives an update for the currently active thread,
 * immediately synchronizes the new message to eliminate any delay between feed and open thread.
 */
export function syncIncomingMessageFromMeta(custId, meta) {
    if (!custId || activeRiderChatCustId !== custId || !db) return;
    const container = document.getElementById('rider-cust-chat-messages') || document.getElementById('rider-chat-messages-container');
    if (!container) return;

    const msgs = Array.from(loadedRiderMsgsMap.values());
    if (msgs.length === 0) return; // Initial load is already handling empty state

    const lastLoaded = msgs[msgs.length - 1];
    const lastLoadedText = (lastLoaded?.text || lastLoaded?.message || '').replace(/^You:\s*/i, '').trim();
    const metaLastText = (meta?.lastMessage || meta?.text || '').replace(/^You:\s*/i, '').trim();
    const lastMsgTime = Number(meta?.lastUpdated) || Number(meta?.timestamp) || 0;

    // Deduplicate identical metadata snapshots so global feed updates never trigger redundant DB queries
    const metaSig = `${custId}:${metaLastText}:${meta?.lastMessageId || ''}:${lastMsgTime}`;
    const prevSync = lastSyncedMetaSigMap.get(custId);
    if (prevSync && prevSync.sig === metaSig) return;
    if (prevSync && (Date.now() - prevSync.time) < 2500 && lastMsgTime <= prevSync.lastMsgTime) return;

    const newestLoadedTime = Math.max(...msgs.map(m => getMessageTimestamp(m) || 0), 0);
    const isNewId = Boolean(meta?.lastMessageId && !loadedRiderMsgsMap.has(meta.lastMessageId));
    const isNewerTime = Boolean(lastMsgTime > 0 && newestLoadedTime > 0 && lastMsgTime > (newestLoadedTime + 1500));
    const isDifferentText = Boolean(
        metaLastText &&
        lastLoadedText &&
        metaLastText !== lastLoadedText &&
        !metaLastText.startsWith('📋') &&
        !metaLastText.startsWith('🧾') &&
        !metaLastText.startsWith('📷') &&
        lastMsgTime > newestLoadedTime
    );

    // Only query if metadata genuinely indicates a newer message than what we already have in memory:
    if (isDifferentText || isNewId || isNewerTime) {
        lastSyncedMetaSigMap.set(custId, { sig: metaSig, time: Date.now(), lastMsgTime });
        let q = db.ref(`customerChats/${custId}/messages`).orderByChild('timestamp');
        if (newestLoadedTime > 0) {
            q = q.startAt(newestLoadedTime - 5000).limitToLast(4);
        } else {
            q = q.limitToLast(5);
        }
        q.once('value', (snap) => {
            if (activeRiderChatCustId !== custId) return;
            const data = snap.val();
            if (data && typeof data === 'object') {
                const recentMsgs = Object.entries(data)
                    .map(([key, msg]) => ({ id: key, ...msg }))
                    .sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));

                let memCached = riderChatMemoryCache.get(custId) || [];
                const map = new Map(memCached.map(m => [m.id, m]));
                recentMsgs.forEach(m => {
                    const prev = map.get(m.id);
                    if (prev && prev.isEdited && (!m.isEdited || m.text === prev.originalText)) {
                        map.set(m.id, {
                            ...m,
                            text: prev.text,
                            message: prev.text,
                            originalText: prev.originalText,
                            isEdited: true,
                            editedAt: prev.editedAt,
                            numEdit: prev.numEdit
                        });
                    } else {
                        map.set(m.id, m);
                    }
                });
                const merged = Array.from(map.values()).sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
                riderChatMemoryCache.set(custId, merged);
                idbSet('chats', custId, merged).catch(() => {});

                let hasAppended = false;
                recentMsgs.forEach(fullMsg => {
                    const ts = getMessageTimestamp(fullMsg);
                    let existing = loadedRiderMsgsMap.get(fullMsg.id);
                    let existingKey = fullMsg.id;
                    if (!existing) {
                        for (const [k, m] of loadedRiderMsgsMap.entries()) {
                            if (k === fullMsg.id || m.id === fullMsg.id || m.mid === fullMsg.id || m.metaMid === fullMsg.id ||
                                (fullMsg.mid && (k === fullMsg.mid || m.mid === fullMsg.mid || m.id === fullMsg.mid)) ||
                                (fullMsg.metaMid && (k === fullMsg.metaMid || m.metaMid === fullMsg.metaMid))) {
                                existing = m;
                                existingKey = k;
                                break;
                            }
                        }
                    }

                    if (existing && existing.isEdited && (!fullMsg.isEdited || fullMsg.text === existing.originalText)) {
                        fullMsg.text = existing.text;
                        fullMsg.message = existing.text;
                        fullMsg.originalText = existing.originalText;
                        fullMsg.isEdited = true;
                        fullMsg.editedAt = existing.editedAt;
                        fullMsg.numEdit = existing.numEdit;
                    }

                    const isChanged = existing && (
                        (existing.text || '') !== (fullMsg.text || '') ||
                        Boolean(existing.isEdited) !== Boolean(fullMsg.isEdited) ||
                        (existing.editedAt || 0) !== (fullMsg.editedAt || 0) ||
                        JSON.stringify(existing.reactions || {}) !== JSON.stringify(fullMsg.reactions || {})
                    );

                    if (!existing && (newestLoadedTime === 0 || ts >= (newestLoadedTime - 3000))) {
                        loadedRiderMsgsMap.set(fullMsg.id, fullMsg);
                        appendOrUpdateSingleRiderMessage(container, fullMsg, activeCustData);
                        hasAppended = true;
                    } else if (isChanged) {
                        let mergedMsg = { ...existing, ...fullMsg, id: existingKey };
                        if (existing && existing.isEdited && (!fullMsg.isEdited || fullMsg.text === existing.originalText)) {
                            mergedMsg.text = existing.text;
                            mergedMsg.message = existing.text;
                            mergedMsg.originalText = existing.originalText;
                            mergedMsg.isEdited = true;
                            mergedMsg.editedAt = existing.editedAt;
                            mergedMsg.numEdit = existing.numEdit;
                        }
                        loadedRiderMsgsMap.set(existingKey, mergedMsg);
                        appendOrUpdateSingleRiderMessage(container, mergedMsg, activeCustData);
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
                const needsRes = !msg.imageUrl && (!msg.images || msg.images.length === 0) && !msg.audioUrl && !msg.videoUrl && (
                    (msg.text && (
                        msg.text.includes('[Facebook') || 
                        msg.text.includes('📷 Photo') || 
                        msg.text.includes('🎥 Video') || 
                        msg.text.includes('🎤 Voice')
                    )) || 
                    msg.type === 'image' || 
                    msg.type === 'video' || 
                    msg.type === 'audio'
                );
                if (needsRes) {
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

