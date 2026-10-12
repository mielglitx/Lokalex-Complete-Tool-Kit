// src/features/chat/customerChat/custChatFeed.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { uploadImage } from '../../../utils/imageUpload.js';
import { 
    custChatState, 
    CUST_CHAT_BATCH_SIZE, 
    CUST_CHAT_OLDER_BATCH_SIZE, 
    sanitizeForFirebase 
} from './custChatState.js';
import { 
    renderCustomerMessages, 
    showCustInChatToast, 
    hideCustInChatToast, 
    showCustTopSpinner, 
    hideCustTopSpinner 
} from './custChatUI.js';

export function listenToCustomerRiderChat() {
    if (!db) return;
    const custFbId = localStorage.getItem('lokalex_customer_fb_id') || localStorage.getItem('customerId') || appState.customerFacebookId || appState.customerId;
    if (!custFbId) return;

    const container = document.getElementById('cust-rider-chat-messages');
    if (!container) return;

    custChatState.oldestCustMsgTimestamp = null;
    custChatState.oldestCustMsgKey = null;
    custChatState.hasMoreCustMsgs = true;
    custChatState.isLoadingCustHistory = false;
    custChatState.isInitialScrollDone = false;
    custChatState.lastPaginationRequestTime = 0;
    custChatState.loadedCustMsgsMap.clear();

    setupCustScrollPagination(container, custFbId);

    // Fast query using direct node reference (avoids Firebase unindexed key error)
    custChatState.custChatListener = db.ref(`customerChats/${custFbId}/messages`);

    custChatState.custChatListener.on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data || Object.keys(data).length === 0) {
            container.innerHTML = `<div class="text-center text-gray-400 dark:text-gray-500 italic py-12 text-xs">Pumili o mag-type ng mensahe para sa rider o merchant...</div>`;
            return;
        }

        const isInitialLoad = !custChatState.isInitialScrollDone;
        let incomingMsg = null;

        const entries = Object.entries(data);
        custChatState.hasMoreCustMsgs = false;

        const seenUpdates = {};
        let hasUnseen = false;
        const now = Date.now();

        entries.forEach(([key, msg]) => {
            const isNew = !custChatState.loadedCustMsgsMap.has(key);
            custChatState.loadedCustMsgsMap.set(key, { id: key, ...msg });

            const isFromOther = !!(msg.isRider || msg.senderType === 'rider' || msg.senderType === 'store' || msg.isStore);

            if (isNew && !isInitialLoad && isFromOther) {
                incomingMsg = msg;
            }

            // Batch mark as seen in ONE atomic update (and mark in memory immediately to prevent cascading listener loop!)
            if (isFromOther && msg.status !== 'seen') {
                msg.status = 'seen';
                seenUpdates[`customerChats/${custFbId}/messages/${key}/status`] = 'seen';
                seenUpdates[`customerChats/${custFbId}/messages/${key}/seenAt`] = now;
                hasUnseen = true;
            }
        });

        if (hasUnseen && db) {
            db.ref().update(seenUpdates).catch(() => {});
        }

        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;

        if (custChatState.loadedCustMsgsMap.size > 0) {
            const sortedMsgs = Array.from(custChatState.loadedCustMsgsMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            custChatState.oldestCustMsgTimestamp = sortedMsgs[0].timestamp || null;
            custChatState.oldestCustMsgKey = sortedMsgs[0].id || null;
        }

        renderCustomerMessages(container, isInitialLoad);

        if (isInitialLoad) {
            setTimeout(() => {
                custChatState.isInitialScrollDone = true;
            }, 250);
        }

        if (incomingMsg && !isInitialLoad) {
            if (!isNearBottom) {
                const preview = incomingMsg.text || (incomingMsg.imageUrl ? "📷 Photo" : "📍 Shared Location");
                const defaultSender = incomingMsg.senderType === 'store' ? "Merchant" : "Lokalex Rider";
                showCustInChatToast(container, incomingMsg.sender || defaultSender, preview);
            } else {
                hideCustInChatToast();
                requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
            }
        }
    });
}

export function setupCustScrollPagination(container, custFbId) {
    container.onscroll = () => {
        const now = Date.now();
        if (
            custChatState.isInitialScrollDone &&
            container.scrollTop < 60 &&
            !custChatState.isLoadingCustHistory &&
            custChatState.hasMoreCustMsgs &&
            custChatState.oldestCustMsgKey &&
            (now - custChatState.lastPaginationRequestTime > 500)
        ) {
            custChatState.lastPaginationRequestTime = now;
            loadOlderCustMessages(container, custFbId);
        }

        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
        if (isNearBottom) {
            hideCustInChatToast();
        }
    };
}

export async function loadOlderCustMessages(container, custFbId) {
    if (custChatState.isLoadingCustHistory || !custChatState.hasMoreCustMsgs || !custChatState.oldestCustMsgKey) return;

    custChatState.isLoadingCustHistory = true;
    showCustTopSpinner(container);

    const oldScrollHeight = container.scrollHeight;

    try {
        const snap = await db.ref(`customerChats/${custFbId}/messages`)
            .orderByKey()
            .endAt(custChatState.oldestCustMsgKey)
            .limitToLast(CUST_CHAT_OLDER_BATCH_SIZE + 1)
            .once('value');

        const data = snap.val() || {};
        hideCustTopSpinner();

        if (data[custChatState.oldestCustMsgKey]) {
            delete data[custChatState.oldestCustMsgKey];
        }

        const entries = Object.entries(data);
        if (entries.length === 0) {
            custChatState.hasMoreCustMsgs = false;
            custChatState.isLoadingCustHistory = false;
            renderCustomerMessages(container, false, oldScrollHeight);
            return;
        }

        if (entries.length < CUST_CHAT_OLDER_BATCH_SIZE) {
            custChatState.hasMoreCustMsgs = false;
        }

        entries.forEach(([key, msg]) => {
            custChatState.loadedCustMsgsMap.set(key, { id: key, ...msg });
        });

        const sortedMsgs = Array.from(custChatState.loadedCustMsgsMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        if (sortedMsgs.length > 0) {
            custChatState.oldestCustMsgTimestamp = sortedMsgs[0].timestamp || null;
            custChatState.oldestCustMsgKey = sortedMsgs[0].id || null;
        }

        renderCustomerMessages(container, false, oldScrollHeight);
    } catch (e) {
        console.error("Error loading older customer chat messages:", e);
        hideCustTopSpinner();
    } finally {
        custChatState.isLoadingCustHistory = false;
    }
}

export function setCustomerReply(msgId, senderName, text) {
    custChatState.activeCustReplyTarget = {
        id: msgId,
        sender: senderName,
        text: text
    };

    const replyBox = document.getElementById('cust-chat-reply-bar');
    const replySender = document.getElementById('cust-reply-sender');
    const replyText = document.getElementById('cust-reply-text');
    const input = document.getElementById('cust-rider-chat-input');

    if (replyBox && replySender && replyText) {
        replySender.innerText = `Replying to ${senderName || "User"}`;
        replyText.innerText = text || "📷 Attachment / Location";
        replyBox.classList.remove('hidden');
    }

    if (input) input.focus();
}

export function cancelCustomerReply() {
    custChatState.activeCustReplyTarget = null;
    const replyBox = document.getElementById('cust-chat-reply-bar');
    if (replyBox) replyBox.classList.add('hidden');
}

export async function toggleCustomerMessageReaction(msgId, emoji) {
    const custFbId = localStorage.getItem('lokalex_customer_fb_id') || localStorage.getItem('customerId') || appState.customerFacebookId || appState.customerId;
    if (!db || !custFbId || !msgId || !emoji) return;

    try {
        const reactionRef = db.ref(`customerChats/${custFbId}/messages/${msgId}/reactions/${emoji}/${custFbId}`);
        const snap = await reactionRef.once('value');
        if (snap.exists()) {
            await reactionRef.remove();
        } else {
            await reactionRef.set(true);
        }
    } catch(e) {
        console.error("Error toggling reaction:", e);
    }
}

export async function sendCustomerToRiderChat(customText = "", customImageUrl = null, customLocationCoords = null) {
    const input = document.getElementById('cust-rider-chat-input');
    const text = customText || (input ? input.value.trim() : "");

    if (!text && !customImageUrl && !customLocationCoords) return;

    const custFbId = localStorage.getItem('lokalex_customer_fb_id') || localStorage.getItem('customerId') || appState.customerFacebookId || appState.customerId || `CUST_${Date.now()}`;
    const custName = localStorage.getItem('customerName') || localStorage.getItem('lokalex_customer_name') || appState.customerName || "Customer";
    const custAvatar = localStorage.getItem('customerAvatarUrl') || localStorage.getItem('lokalex_customer_avatar') || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=0084FF&color=fff`;
    const now = Date.now();

    let finalImageUrl = customImageUrl;
    if (customImageUrl && customImageUrl.startsWith('data:')) {
        showToast("⏳ Uploading photo...");
        try {
            finalImageUrl = await uploadImage(customImageUrl, `chats/${custFbId}/${now}.jpg`);
        } catch (e) {
            console.warn("Chat image upload fallback:", e);
        }
    }

    const newMsg = {
        sender: custName,
        senderId: custFbId,
        text: text || "",
        timestamp: now,
        isRider: false,
        status: 'sent',
        deliveredAt: null,
        seenAt: null
    };

    if (custChatState.activeCustReplyTarget) {
        newMsg.replyTo = {
            id: custChatState.activeCustReplyTarget.id,
            sender: custChatState.activeCustReplyTarget.sender,
            text: custChatState.activeCustReplyTarget.text.substring(0, 120)
        };
    }

    if (finalImageUrl) newMsg.imageUrl = finalImageUrl;
    if (customLocationCoords) newMsg.locationCoords = customLocationCoords;

    if (db) {
        db.ref(`customerChats/${custFbId}/messages`).push(sanitizeForFirebase(newMsg));
        
        let targetFolder = 'inbox';
        try {
            const metaSnap = await db.ref(`customerChats/${custFbId}/metadata`).once('value');
            const metaVal = metaSnap.val();
            if (metaVal) {
                const curFolder = (metaVal.folder || '').toLowerCase();
                const isCatered = (metaVal.cateredByRiderId || metaVal.cateredByRiderName || curFolder === 'catering') && metaVal.status !== 'completed' && metaVal.status !== 'done';
                if (isCatered) {
                    targetFolder = 'catering';
                } else if (curFolder === 'followup') {
                    targetFolder = 'followup';
                }
            }
        } catch (_) {}

        db.ref(`customerChats/${custFbId}/metadata`).update(sanitizeForFirebase({
            lastMessage: text || (finalImageUrl ? "📷 Photo" : "📍 Shared Location"),
            lastUpdated: now,
            customerName: custName,
            customerFbId: custFbId,
            avatarUrl: custAvatar,
            folder: targetFolder,
            unreadForRider: true
        }));
    }

    if (input && !customText) input.value = "";
    cancelCustomerReply();
    showToast("💬 Message sent!");

    hideCustInChatToast();

    const container = document.getElementById('cust-rider-chat-messages');
    if (container) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
        });
    }
}

if (typeof window !== 'undefined') {
    window.listenToCustomerRiderChat = listenToCustomerRiderChat;
    window.setCustomerReply = setCustomerReply;
    window.cancelCustomerReply = cancelCustomerReply;
    window.toggleCustomerMessageReaction = toggleCustomerMessageReaction;
    window.sendCustomerToRiderChat = sendCustomerToRiderChat;
}