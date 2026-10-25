// src/features/chat/chatEngine/chatSending.js
import { db } from '../../../config/firebase.js';
import { appState, globalState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { uploadImage, dataUrlToBlob } from '../../../utils/imageUpload.js';
import { openMapPicker } from '../../maps.js';
import { getMessageTimestamp } from '../chatUtils.js';
import { appendOrUpdateSingleRiderMessage, hideRiderInChatToast } from '../riderChatRender.js';
import { getPublicFbSendEndpoint, getFbPageAccessToken, getResolvedFbName } from '../facebookApiAdmin.js';
import { idbGet, idbSet } from '../../../utils/storageEngine.js';
import {
    activeRiderChatCustId,
    currentRiderChatMeta,
    activeCustData,
    activeRiderReplyTarget,
    loadedRiderMsgsMap,
    riderChatMemoryCache,
    threadDraftsMap,
    sanitizeForFirebase
} from './chatState.js';
import { cancelRiderReply } from './chatListeners.js';
import { clearMyTypingStatus } from './chatPresence.js';

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

export function sendRiderChatMessage(content = null, type = 'text', explicitCustId = null) {
    sendRiderToCustomerChat(content, type === 'image' ? content : null, null, explicitCustId);
}

export async function sendRiderToCustomerChat(customText = "", customImageUrl = null, customLocationCoords = null, explicitCustId = null, customDoc = null, customVideo = null) {
    // Freeze target customer ID immediately so background operations never divert to another thread!
    const targetCustId = explicitCustId || activeRiderChatCustId;
    if (!targetCustId) return;

    const input1 = document.getElementById('rider-chat-input');
    const input2 = document.getElementById('rider-cust-chat-input');
    const val1 = input1 ? input1.value.trim() : "";
    const val2 = input2 ? input2.value.trim() : "";
    const savedDraft = threadDraftsMap.get(targetCustId) || "";
    const text = (typeof customText === 'string' && customText.trim()) ? customText.trim() : (val1 || val2 || savedDraft);

    if (!text && !customImageUrl && !customLocationCoords && !customDoc && !customVideo) return;

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
    clearMyTypingStatus();

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
        const targetText = replyTargetSnapshot.text || (replyTargetSnapshot.videoUrl ? "🎥 Video" : (replyTargetSnapshot.imageUrl ? "📷 Photo" : (replyTargetSnapshot.locationCoords ? "📍 Location" : "Message")));
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
    if (customVideo) {
        newMsg.videoUrl = customVideo.videoUrl || (typeof customVideo === 'string' ? customVideo : '');
        newMsg.videoThumbnail = customVideo.videoThumbnail || null;
        newMsg.videoDuration = customVideo.videoDuration || 0;
        newMsg.videoSize = customVideo.videoSize || 0;
        newMsg.videoName = customVideo.videoName || 'Video';
        newMsg.type = 'video';
        if (!newMsg.text) {
            newMsg.text = customVideo.caption || customVideo.videoName || '🎥 Video';
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
            const lastSummary = customVideo 
                ? `🎥 ${customVideo.videoName || 'Video'}`
                : (customDoc 
                    ? `📄 ${customDoc.fileName || 'Document'}` 
                    : (text || (finalImageUrl ? "📷 Photo" : "📍 Location")));
            const metaPayload = sanitizeForFirebase({
                lastMessage: `You: ${lastSummary}`,
                lastUpdated: now,
                unreadForRider: false
            });

            // Safeguard customer name in metadata: Never cross-contaminate with stale activeCustData
            let resolvedCustName = null;
            if (targetCustId.startsWith('fb_')) {
                const fbResolved = (typeof getResolvedFbName === 'function') ? getResolvedFbName(targetCustId) : null;
                resolvedCustName = fbResolved?.name || targetMeta?.customerName || null;
            } else {
                resolvedCustName = targetMeta?.customerName || targetCustDataSnapshot?.name || targetCustDataSnapshot?.customerName || null;
            }

            if (resolvedCustName && (!targetMeta?.customerName || targetMeta.customerName.startsWith('FB Customer (') || targetMeta.customerName.toLowerCase() === 'customer')) {
                metaPayload.customerName = resolvedCustName;
            } else if (!targetMeta?.customerName && targetCustId.startsWith('cust_')) {
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
        const currentActiveCustId = (typeof window.getActiveRiderChatCustId === 'function') 
            ? window.getActiveRiderChatCustId() 
            : activeRiderChatCustId;

        if (currentActiveCustId === cleanCustId || activeRiderChatCustId === cleanCustId) {
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

function compressDataUrlForBridge(dataUrl, maxDim = 800, quality = 0.65) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
        return Promise.resolve(dataUrl);
    }
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                let w = img.width;
                let h = img.height;
                if (w > maxDim || h > maxDim) {
                    if (w > h) {
                        h = Math.round((h * maxDim) / w);
                        w = maxDim;
                    } else {
                        w = Math.round((w * maxDim) / h);
                        h = maxDim;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            } catch (_) {
                resolve(dataUrl);
            }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
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
                                    if (!suppressToast) showToast("✅ Photo sent to customer on Messenger!");
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
                        if (!suppressToast) showToast("✅ Photo sent to customer on Messenger!");
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
            if (finalFbImageUrl && finalFbImageUrl.startsWith('data:')) {
                finalFbImageUrl = await compressDataUrlForBridge(finalFbImageUrl, 800, 0.65);
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

