// src/features/chat/customerChat/custChatFeed.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { 
    custChatState, 
    CUST_CHAT_BATCH_SIZE, 
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
    custChatState.hasMoreCustMsgs = true;
    custChatState.isLoadingCustHistory = false;
    custChatState.loadedCustMsgsMap.clear();

    setupCustScrollPagination(container, custFbId);

    if (custChatState.custChatListener) custChatState.custChatListener.off();

    custChatState.custChatListener = db.ref(`customerChats/${custFbId}/messages`).orderByChild('timestamp').limitToLast(CUST_CHAT_BATCH_SIZE);

    custChatState.custChatListener.on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            container.innerHTML = `<div class="text-center text-gray-400 dark:text-gray-500 italic py-12 text-xs">Pumili o mag-type ng mensahe para sa mga riders...</div>`;
            return;
        }

        const isInitialLoad = custChatState.loadedCustMsgsMap.size === 0;
        let newRiderMsg = null;

        Object.entries(data).forEach(([key, msg]) => {
            const isNew = !custChatState.loadedCustMsgsMap.has(key);
            custChatState.loadedCustMsgsMap.set(key, { id: key, ...msg });

            if (isNew && !isInitialLoad && msg.isRider) {
                newRiderMsg = msg;
            }

            if (msg.isRider && msg.status !== 'seen') {
                db.ref(`customerChats/${custFbId}/messages/${key}`).update({
                    status: 'seen',
                    seenAt: Date.now()
                });
            }
        });

        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;

        renderCustomerMessages(container, isInitialLoad);

        if (newRiderMsg && !isInitialLoad) {
            if (!isNearBottom) {
                const preview = newRiderMsg.text || (newRiderMsg.imageUrl ? "📷 Photo" : "📍 Shared Location");
                showCustInChatToast(container, newRiderMsg.sender || "Lokalex Rider", preview);
            } else {
                hideCustInChatToast();
                requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
            }
        }
    });
}

export function setupCustScrollPagination(container, custFbId) {
    container.onscroll = () => {
        if (container.scrollTop < 50 && !custChatState.isLoadingCustHistory && custChatState.hasMoreCustMsgs && custChatState.oldestCustMsgTimestamp) {
            loadOlderCustMessages(container, custFbId);
        }

        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
        if (isNearBottom) {
            hideCustInChatToast();
        }
    };
}

export async function loadOlderCustMessages(container, custFbId) {
    if (custChatState.isLoadingCustHistory || !custChatState.hasMoreCustMsgs || !custChatState.oldestCustMsgTimestamp) return;

    custChatState.isLoadingCustHistory = true;
    showCustTopSpinner(container);

    const oldScrollHeight = container.scrollHeight;

    try {
        const snap = await db.ref(`customerChats/${custFbId}/messages`)
            .orderByChild('timestamp')
            .endAt(custChatState.oldestCustMsgTimestamp - 1)
            .limitToLast(20)
            .once('value');

        const data = snap.val();
        hideCustTopSpinner();

        if (!data || Object.keys(data).length === 0) {
            custChatState.hasMoreCustMsgs = false;
            custChatState.isLoadingCustHistory = false;
            renderCustomerMessages(container, false, oldScrollHeight);
            return;
        }

        const entries = Object.entries(data);
        if (entries.length < 20) {
            custChatState.hasMoreCustMsgs = false;
        }

        entries.forEach(([key, msg]) => {
            custChatState.loadedCustMsgsMap.set(key, { id: key, ...msg });
        });

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

export function sendCustomerToRiderChat(customText = "", customImageUrl = null, customLocationCoords = null) {
    const input = document.getElementById('cust-rider-chat-input');
    const text = customText || (input ? input.value.trim() : "");

    if (!text && !customImageUrl && !customLocationCoords) return;

    const custFbId = localStorage.getItem('lokalex_customer_fb_id') || localStorage.getItem('customerId') || appState.customerFacebookId || appState.customerId || `CUST_${Date.now()}`;
    const custName = localStorage.getItem('customerName') || localStorage.getItem('lokalex_customer_name') || appState.customerName || "Customer";
    const custAvatar = localStorage.getItem('customerAvatarUrl') || localStorage.getItem('lokalex_customer_avatar') || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=0084FF&color=fff`;
    const now = Date.now();

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

    if (customImageUrl) newMsg.imageUrl = customImageUrl;
    if (customLocationCoords) newMsg.locationCoords = customLocationCoords;

    if (db) {
        db.ref(`customerChats/${custFbId}/messages`).push(sanitizeForFirebase(newMsg));
        db.ref(`customerChats/${custFbId}/metadata`).update(sanitizeForFirebase({
            lastMessage: text || (customImageUrl ? "📷 Photo" : "📍 Shared Location"),
            lastUpdated: now,
            customerName: custName,
            customerFbId: custFbId,
            avatarUrl: custAvatar,
            folder: 'inbox',
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