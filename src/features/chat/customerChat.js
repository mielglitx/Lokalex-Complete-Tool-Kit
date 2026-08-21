// src/features/chat/customerChat.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml, copyText } from '../../utils/helpers.js';

const MAPS_API_KEY = "AIzaSyBVAwn0UnyHJ926oHeK0k789ncADMzmX80";

// --- PAGINATION & INFINITE SCROLL STATE ---
const CUST_CHAT_BATCH_SIZE = 25;
let oldestCustMsgTimestamp = null;
let hasMoreCustMsgs = true;
let isLoadingCustHistory = false;
let loadedCustMsgsMap = new Map();
let custChatListener = null;

// REPLY & REACTION STATE
let activeCustReplyTarget = null;

function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

function renderMessageStatusIndicator(msg) {
    const sentTime = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
    const seenTime = msg.seenAt ? new Date(msg.seenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
    
    let iconHtml = '<i class="fa-regular fa-clock text-blue-200" title="Sending..."></i>';
    let titleAttr = `Sent ${sentTime}`;

    if (msg.status === 'sent') {
        iconHtml = '<i class="fa-solid fa-check text-blue-200" title="Sent"></i>';
    } else if (msg.status === 'delivered') {
        iconHtml = '<i class="fa-solid fa-check-double text-blue-200" title="Delivered"></i>';
        titleAttr += ` • Delivered`;
    } else if (msg.status === 'seen') {
        iconHtml = '<i class="fa-solid fa-check-double text-cyan-200" title="Seen"></i>';
        titleAttr += ` • Seen at ${seenTime}`;
    }

    return `<span class="inline-flex items-center gap-1 ml-1 cursor-help" title="${titleAttr}">
        ${iconHtml}
        ${msg.status === 'seen' && seenTime ? `<span class="text-[8px] text-cyan-200 opacity-90 font-mono">Seen ${seenTime}</span>` : ''}
    </span>`;
}

function renderReactionsHtml(reactions, msgId, context = 'customer') {
    if (!reactions || typeof reactions !== 'object') return '';
    
    const reactionEntries = Object.entries(reactions);
    if (reactionEntries.length === 0) return '';

    const custId = localStorage.getItem('lokalex_customer_fb_id') || localStorage.getItem('customerId') || appState.customerFacebookId || appState.customerId;

    const badges = reactionEntries.map(([emoji, usersMap]) => {
        if (!usersMap || typeof usersMap !== 'object') return '';
        const count = Object.keys(usersMap).length;
        if (count === 0) return '';
        const hasReacted = custId && usersMap[custId];

        return `
        <button onclick="event.stopPropagation(); window.toggleCustomerMessageReaction('${msgId}', '${emoji}')" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] ${hasReacted ? 'bg-blue-600/30 border border-blue-400 text-white' : 'bg-gray-100 dark:bg-black/60 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'} transition active:scale-90">
            <span>${emoji}</span>
            <span class="font-bold text-[9px]">${count}</span>
        </button>`;
    }).join('');

    return badges ? `<div class="flex flex-wrap gap-1 mt-1">${badges}</div>` : '';
}

function renderReplyPreviewInsideMessage(replyTo) {
    if (!replyTo || !replyTo.text) return '';
    const clickHandler = replyTo.id ? `event.stopPropagation(); window.scrollToBubble('${replyTo.id}')` : '';
    return `
    <div ${clickHandler ? `onclick="${clickHandler}"` : ''} class="bg-black/10 dark:bg-black/40 border-l-2 border-amber-400 px-2 py-1 rounded-r-lg mb-1.5 text-[10px] opacity-90 truncate max-w-full cursor-pointer hover:opacity-100 transition">
        <div class="font-bold text-amber-600 dark:text-amber-300 truncate flex items-center gap-1">
            <i class="fa-solid fa-reply text-[8px]"></i>
            <span>${escapeHtml(replyTo.sender || 'Reply')}</span>
        </div>
        <div class="text-gray-700 dark:text-gray-200 truncate">${escapeHtml(replyTo.text)}</div>
    </div>`;
}

export function scrollToBubble(msgId) {
    const bubbleEl = document.getElementById(`msg-bubble-${msgId}`);
    if (!bubbleEl) return;
    bubbleEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    bubbleEl.classList.add('outline', 'outline-2', 'outline-amber-400', 'transition-all', 'duration-300');
    setTimeout(() => {
        bubbleEl.classList.remove('outline', 'outline-2', 'outline-amber-400');
    }, 1600);
}

function showCustInChatToast(container, senderName, previewText) {
    let toast = document.getElementById('cust-inchat-newmsg-toast');
    const parent = container.parentElement;

    if (parent && !parent.classList.contains('relative')) {
        parent.classList.add('relative');
    }

    if (!toast && parent) {
        toast = document.createElement('div');
        toast.id = 'cust-inchat-newmsg-toast';
        toast.className = 'absolute bottom-14 left-4 right-4 bg-blue-600 text-white text-xs py-2 px-3 rounded-xl border border-blue-400 flex items-center justify-between cursor-pointer z-30 transition-all duration-200';
        parent.appendChild(toast);
    }

    if (toast) {
        toast.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                <i class="fa-solid fa-circle-down text-blue-200 text-sm shrink-0 animate-bounce"></i>
                <span class="truncate font-medium"><strong>${escapeHtml(senderName)}:</strong> ${escapeHtml(previewText)}</span>
            </div>
            <span class="text-[10px] bg-blue-800/80 px-2 py-0.5 rounded-md font-bold uppercase shrink-0">View ↓</span>
        `;

        toast.onclick = () => {
            container.scrollTop = container.scrollHeight;
            toast.classList.add('hidden');
        };

        toast.classList.remove('hidden');
    }
}

function hideCustInChatToast() {
    const toast = document.getElementById('cust-inchat-newmsg-toast');
    if (toast) toast.classList.add('hidden');
}

export function listenToCustomerRiderChat() {
    if (!db) return;
    const custFbId = localStorage.getItem('lokalex_customer_fb_id') || localStorage.getItem('customerId') || appState.customerFacebookId || appState.customerId;
    if (!custFbId) return;

    const container = document.getElementById('cust-rider-chat-messages');
    if (!container) return;

    oldestCustMsgTimestamp = null;
    hasMoreCustMsgs = true;
    isLoadingCustHistory = false;
    loadedCustMsgsMap.clear();

    setupCustScrollPagination(container, custFbId);

    if (custChatListener) custChatListener.off();

    custChatListener = db.ref(`customerChats/${custFbId}/messages`).orderByChild('timestamp').limitToLast(CUST_CHAT_BATCH_SIZE);

    custChatListener.on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            container.innerHTML = `<div class="text-center text-gray-400 dark:text-gray-500 italic py-12 text-xs">Pumili o mag-type ng mensahe para sa mga riders...</div>`;
            return;
        }

        const isInitialLoad = loadedCustMsgsMap.size === 0;
        let newRiderMsg = null;

        Object.entries(data).forEach(([key, msg]) => {
            const isNew = !loadedCustMsgsMap.has(key);
            loadedCustMsgsMap.set(key, { id: key, ...msg });

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

function setupCustScrollPagination(container, custFbId) {
    container.onscroll = () => {
        if (container.scrollTop < 50 && !isLoadingCustHistory && hasMoreCustMsgs && oldestCustMsgTimestamp) {
            loadOlderCustMessages(container, custFbId);
        }

        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
        if (isNearBottom) {
            hideCustInChatToast();
        }
    };
}

async function loadOlderCustMessages(container, custFbId) {
    if (isLoadingCustHistory || !hasMoreCustMsgs || !oldestCustMsgTimestamp) return;

    isLoadingCustHistory = true;
    showCustTopSpinner(container);

    const oldScrollHeight = container.scrollHeight;

    try {
        const snap = await db.ref(`customerChats/${custFbId}/messages`)
            .orderByChild('timestamp')
            .endAt(oldestCustMsgTimestamp - 1)
            .limitToLast(20)
            .once('value');

        const data = snap.val();
        hideCustTopSpinner();

        if (!data || Object.keys(data).length === 0) {
            hasMoreCustMsgs = false;
            isLoadingCustHistory = false;
            renderCustomerMessages(container, false, oldScrollHeight);
            return;
        }

        const entries = Object.entries(data);
        if (entries.length < 20) {
            hasMoreCustMsgs = false;
        }

        entries.forEach(([key, msg]) => {
            loadedCustMsgsMap.set(key, { id: key, ...msg });
        });

        renderCustomerMessages(container, false, oldScrollHeight);
    } catch (e) {
        console.error("Error loading older customer chat messages:", e);
        hideCustTopSpinner();
    } finally {
        isLoadingCustHistory = false;
    }
}

function showCustTopSpinner(container) {
    let spinner = document.getElementById('cust-chat-history-spinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'cust-chat-history-spinner';
        spinner.className = 'flex items-center justify-center py-2 text-blue-500 dark:text-blue-400 text-xs gap-2 font-bold shrink-0';
        spinner.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading older messages...`;
    }
    if (container.firstChild) {
        container.insertBefore(spinner, container.firstChild);
    } else {
        container.appendChild(spinner);
    }
}

function hideCustTopSpinner() {
    const spinner = document.getElementById('cust-chat-history-spinner');
    if (spinner) spinner.remove();
}

function renderCustomerMessages(container, isInitialLoad = false, oldScrollHeight = 0) {
    const msgs = Array.from(loadedCustMsgsMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    if (msgs.length > 0) {
        oldestCustMsgTimestamp = msgs[0].timestamp || null;
    }

    const myAvatar = localStorage.getItem('customerAvatarUrl') || localStorage.getItem('lokalex_customer_avatar') || `https://ui-avatars.com/api/?name=User&background=0084FF&color=fff`;

    const messagesHtml = msgs.map(m => {
        const isRider = !!m.isRider;
        const alignClass = isRider 
            ? "self-start bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-200 rounded-tl-none" 
            : "self-end bg-blue-600 text-white rounded-tr-none";
        const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
        const imgHtml = m.imageUrl ? `<img src="${m.imageUrl}" onclick="event.stopPropagation(); window.openImageViewerModal && window.openImageViewerModal('${escapeHtml(m.imageUrl)}', 'customer')" class="w-52 max-w-full rounded-xl mt-1.5 border border-gray-200 dark:border-gray-700 cursor-pointer hover:opacity-90 transition">` : '';
        
        const senderName = m.sender || (isRider ? "Lokalex Rider" : "You");
        const senderAvatar = isRider 
            ? `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName)}&background=3B82F6&color=fff`
            : myAvatar;

        const statusIndicator = !isRider ? renderMessageStatusIndicator(m) : '';
        const replyBlockHtml = renderReplyPreviewInsideMessage(m.replyTo);
        const reactionsHtml = renderReactionsHtml(m.reactions, m.id, 'customer');

        let locationHtml = "";
        let lat = null;
        let lng = null;

        if (m.locationCoords && m.locationCoords.lat && m.locationCoords.lng) {
            lat = m.locationCoords.lat;
            lng = m.locationCoords.lng;
        } else if (m.type === 'location' && m.text) {
            const match = m.text.match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (match) {
                lat = match[1];
                lng = match[2];
            }
        }

        if (lat && lng) {
            const mapUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
            const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&size=400x200&maptype=roadmap&markers=color:red%7C${lat},${lng}&key=${MAPS_API_KEY}`;

            locationHtml = `
            <div class="mt-1.5 flex flex-col gap-1 rounded-xl overflow-hidden border border-emerald-500/40 bg-gray-50 dark:bg-black/40 p-1">
                <a href="${mapUrl}" target="_blank" onclick="event.stopPropagation()" class="block relative group overflow-hidden rounded-lg">
                    <img src="${staticMapUrl}" alt="Map Location Preview" class="w-full h-32 object-cover rounded-lg group-hover:scale-105 transition-transform duration-200">
                    <div class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <span class="bg-black/80 text-white text-[10px] font-bold px-2 py-1 rounded-md"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open in Maps</span>
                    </div>
                </a>
                <a href="${mapUrl}" target="_blank" onclick="event.stopPropagation()" class="bg-emerald-600/20 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 font-bold px-2.5 py-1.5 rounded-lg text-[11px] flex items-center justify-center gap-1.5 active:scale-95 transition">
                    <i class="fa-solid fa-map-location-dot text-red-500"></i> View Shared Location
                </a>
            </div>`;
        }

        return `
        <div id="msg-bubble-${m.id}" class="flex items-start gap-1.5 ${isRider ? 'flex-row' : 'flex-row-reverse'} my-0.5 group/row">
            <img src="${senderAvatar}" class="w-6 h-6 rounded-full object-cover border border-blue-400/40 shrink-0 mt-1">
            <div onclick="window.openMessageActionPopover(event, '${m.id}', 'customer', '${encodeURIComponent(m.text || '')}', '${encodeURIComponent(senderName)}')" class="max-w-[85%] p-2.5 rounded-2xl flex flex-col gap-0.5 text-xs ${alignClass} cursor-pointer transition active:scale-[0.98] select-text">
                <div class="text-[9px] ${isRider ? 'text-blue-600 dark:text-blue-400' : 'text-blue-100'} font-bold flex justify-between gap-3">
                    <span>${escapeHtml(senderName)}</span>
                    <div class="flex items-center gap-1 opacity-80 font-mono">
                        <span>${timeStr}</span>
                        ${statusIndicator}
                    </div>
                </div>
                ${replyBlockHtml}
                ${(m.text && !imgHtml && !locationHtml) ? `<div class="leading-relaxed whitespace-pre-wrap font-sans break-words">${escapeHtml(m.text)}</div>` : ''}
                ${imgHtml}
                ${locationHtml}
                ${reactionsHtml}
            </div>
        </div>`;
    }).join('');

    let topHeader = '';
    if (!hasMoreCustMsgs) {
        topHeader = `<div class="text-center text-gray-400 dark:text-gray-500 text-[10px] py-1.5 italic shrink-0">Beginning of message history</div>`;
    }

    container.innerHTML = topHeader + messagesHtml;

    if (isInitialLoad) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 80);
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 250);
        });
    } else if (oldScrollHeight > 0) {
        const newScrollHeight = container.scrollHeight;
        container.scrollTop = newScrollHeight - oldScrollHeight;
    }
}

export function setCustomerReply(msgId, senderName, text) {
    activeCustReplyTarget = {
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
    activeCustReplyTarget = null;
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

    if (activeCustReplyTarget) {
        newMsg.replyTo = {
            id: activeCustReplyTarget.id,
            sender: activeCustReplyTarget.sender,
            text: activeCustReplyTarget.text.substring(0, 120)
        };
    }

    if (customImageUrl) newMsg.imageUrl = customImageUrl;
    if (customLocationCoords) newMsg.locationCoords = customLocationCoords;

    if (db) {
        db.ref(`customerChats/${custFbId}/messages`).push(sanitizeForFirebase(newMsg));
        // Flag unreadForRider: true so rider dashboard reflects bold status and badge
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

export function openMessageActionPopover(event, msgId, context, rawText, rawSender) {
    if (event) event.stopPropagation();

    const text = decodeURIComponent(rawText || '');
    const sender = decodeURIComponent(rawSender || '');

    let modal = document.getElementById('global-chat-bubble-action-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'global-chat-bubble-action-modal';
        modal.className = 'fixed inset-0 z-[9999] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-3 transition-opacity';
        modal.onclick = (e) => {
            if (e.target === modal) closeMessageActionPopover();
        };
        document.body.appendChild(modal);
    }

    const emojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    const emojiBtnsHtml = emojis.map(em => `
        <button onclick="window.dispatchBubbleReaction('${msgId}', '${context}', '${em}')" class="w-9 h-9 text-lg rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-center transition active:scale-125">
            ${em}
        </button>
    `).join('');

    modal.innerHTML = `
        <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 w-full max-w-xs rounded-3xl p-3.5 flex flex-col gap-2.5 animate-in fade-in zoom-in-95 duration-150">
            <div class="bg-gray-100 dark:bg-black/40 border-l-2 border-blue-500 px-2.5 py-1.5 rounded-r-xl text-xs">
                <div class="text-[10px] font-bold text-blue-600 dark:text-blue-400 truncate">${escapeHtml(sender || 'Message')}</div>
                <div class="text-gray-700 dark:text-gray-300 text-[11px] truncate mt-0.5">${escapeHtml(text || '📷 Attachment / Location')}</div>
            </div>

            <div class="flex items-center justify-between bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800/80 p-1 rounded-2xl">
                ${emojiBtnsHtml}
            </div>

            <div class="flex flex-col gap-1 text-xs font-bold">
                <button onclick="window.dispatchBubbleReply('${msgId}', '${context}', '${encodeURIComponent(sender)}', '${encodeURIComponent(text)}')" class="flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200 transition active:scale-98">
                    <i class="fa-solid fa-reply text-blue-500 w-4"></i>
                    <span>Reply to this message</span>
                </button>

                ${text ? `
                <button onclick="window.dispatchBubbleCopy('${encodeURIComponent(text)}')" class="flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200 transition active:scale-98">
                    <i class="fa-solid fa-copy text-amber-500 w-4"></i>
                    <span>Copy Text</span>
                </button>` : ''}

                <button onclick="window.closeMessageActionPopover()" class="flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition active:scale-98 border-t border-gray-100 dark:border-gray-800/80 mt-1">
                    <i class="fa-solid fa-xmark text-gray-400 w-4"></i>
                    <span>Cancel</span>
                </button>
            </div>
        </div>`;

    modal.classList.remove('hidden');
}

export function closeMessageActionPopover() {
    const modal = document.getElementById('global-chat-bubble-action-modal');
    if (modal) modal.classList.add('hidden');
}

export function dispatchBubbleReaction(msgId, context, emoji) {
    closeMessageActionPopover();
    if (context === 'customer') {
        toggleCustomerMessageReaction(msgId, emoji);
    } else if (context === 'rider-cust' && window.toggleRiderMessageReaction) {
        window.toggleRiderMessageReaction(msgId, emoji);
    } else if (context === 'store-rider' && window.toggleStoreRiderReaction) {
        window.toggleStoreRiderReaction(msgId, emoji);
    }
}

export function dispatchBubbleReply(msgId, context, encodedSender, encodedText) {
    closeMessageActionPopover();
    const sender = decodeURIComponent(encodedSender);
    const text = decodeURIComponent(encodedText);

    if (context === 'customer') {
        setCustomerReply(msgId, sender, text);
    } else if (context === 'rider-cust' && window.setRiderReply) {
        window.setRiderReply(msgId, sender, text);
    } else if (context === 'store-rider' && window.setStoreRiderReply) {
        window.setStoreRiderReply(msgId, sender, text);
    }
}

export function dispatchBubbleCopy(encodedText) {
    closeMessageActionPopover();
    const text = decodeURIComponent(encodedText);
    copyText(text);
    showToast("📋 Message copied to clipboard!");
}

if (typeof window !== 'undefined') {
    window.listenToCustomerRiderChat = listenToCustomerRiderChat;
    window.sendCustomerToRiderChat = sendCustomerToRiderChat;
    window.setCustomerReply = setCustomerReply;
    window.cancelCustomerReply = cancelCustomerReply;
    window.toggleCustomerMessageReaction = toggleCustomerMessageReaction;
    window.scrollToBubble = scrollToBubble;
    window.openMessageActionPopover = openMessageActionPopover;
    window.closeMessageActionPopover = closeMessageActionPopover;
    window.dispatchBubbleReaction = dispatchBubbleReaction;
    window.dispatchBubbleReply = dispatchBubbleReply;
    window.dispatchBubbleCopy = dispatchBubbleCopy;
}