// src/features/chat.js
import { db } from '../config/firebase.js';
import { appState, globalState } from '../store/state.js';
import { showToast } from '../ui/notifications.js';
import { escapeHtml } from '../utils/helpers.js';

let isChatOpen = false;
let unreadChatCount = 0;
let lastKnownChatMsgCount = 0;

let activeRiderChatCustId = null;
let activeRiderChatListener = null;

// ============================================================================
// 1. TEAM COMMS CHAT WIDGET
// ============================================================================
export function initDraggableChat() {
    const bubble = document.getElementById('chat-bubble');
    const container = document.getElementById('floating-chat-container');

    if (!bubble || !container) return;

    let isPointerDown = false;
    let isDragging = false;
    let startY = 0;
    let initialTop = 0;
    let touchStartTime = 0;

    const onStart = (e) => {
        isPointerDown = true;
        isDragging = false;
        touchStartTime = Date.now();
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        const rect = container.getBoundingClientRect();
        initialTop = rect.top;
    };

    const onMove = (e) => {
        if (!isPointerDown) return;

        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const deltaY = clientY - startY;

        if (Math.abs(deltaY) > 10) {
            isDragging = true;
            let newTop = initialTop + deltaY;
            const maxTop = window.innerHeight - 80;
            newTop = Math.max(60, Math.min(newTop, maxTop));
            container.style.top = `${newTop}px`;
        }
    };

    const onEnd = () => {
        if (!isPointerDown) return;
        isPointerDown = false;

        const elapsedTime = Date.now() - touchStartTime;

        if (!isDragging || elapsedTime < 250) {
            toggleChatWindow(!isChatOpen);
        }
        isDragging = false;
    };

    bubble.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);

    bubble.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);

    listenToFirebaseChat();
}

export function toggleChatWindow(show) {
    isChatOpen = show;
    const windowEl = document.getElementById('expanded-chat-window');
    const unreadBadge = document.getElementById('chat-unread-badge');

    if (windowEl) {
        if (show) {
            windowEl.classList.remove('hidden');
            unreadChatCount = 0;
            if (unreadBadge) unreadBadge.classList.add('hidden');
            scrollChatToBottom();
        } else {
            windowEl.classList.add('hidden');
        }
    }
}

export function listenToFirebaseChat() {
    if (!db) return;

    db.ref('chat').on('value', (snapshot) => {
        const data = snapshot.val();
        let msgs = [];
        if (data) {
            msgs = Object.keys(data).map(key => ({
                id: key,
                ...data[key]
            }));
            msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        }

        globalState.chatMessages = msgs;

        if (lastKnownChatMsgCount > 0 && msgs.length > lastKnownChatMsgCount && !isChatOpen) {
            unreadChatCount += (msgs.length - lastKnownChatMsgCount);
            const unreadBadge = document.getElementById('chat-unread-badge');
            if (unreadBadge) {
                unreadBadge.innerText = unreadChatCount;
                unreadBadge.classList.remove('hidden');
            }
        }
        lastKnownChatMsgCount = msgs.length;

        renderBubbleChatMessages(msgs);
    });
}

export function renderBubbleChatMessages(msgs) {
    const container = document.getElementById('bubble-chat-messages');
    if (!container) return;

    if (!msgs || msgs.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-10 text-xs">No team messages yet.</div>`;
        return;
    }

    const myName = (appState.riderName || "").trim();

    container.innerHTML = msgs.map(m => {
        const isMe = (m.sender || "").trim().toLowerCase() === myName.toLowerCase();
        const alignClass = isMe ? "self-end bg-blue-600 text-white rounded-br-none" : "self-start bg-cardBg border border-gray-700 text-gray-200 rounded-bl-none";
        
        let timeStr = "";
        if (m.timestamp) {
            timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        const imageMarkup = m.imageUrl ? `<img src="${m.imageUrl}" class="w-44 max-w-full rounded-xl mt-1 border border-gray-700 shadow-md">` : '';
        const isEveryoneTagged = m.text && m.text.includes('@everyone');
        const tagHighlight = isEveryoneTagged ? 'ring-2 ring-amber-400 bg-amber-500/20 p-1 rounded-lg' : '';

        return `
        <div class="max-w-[85%] p-2.5 rounded-2xl flex flex-col gap-0.5 shadow-sm text-xs ${alignClass} ${tagHighlight}">
            <div class="text-[9px] ${isMe ? 'text-blue-200' : 'text-blue-400'} font-bold flex justify-between gap-3">
                <span>${escapeHtml(m.sender || "Rider")}</span>
                <span class="opacity-60 font-mono">${timeStr}</span>
            </div>
            <div class="leading-relaxed whitespace-pre-wrap font-sans">${escapeHtml(m.text)}</div>
            ${imageMarkup}
        </div>`;
    }).join('');

    scrollChatToBottom();
}

export function scrollChatToBottom() {
    const container = document.getElementById('bubble-chat-messages');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

export function sendBubbleChatMessage() {
    const input = document.getElementById('bubble-chat-input');
    const text = input ? input.value.trim() : "";

    if (!text) return;

    const senderName = appState.riderName || "Lokalex Rider";
    const isEveryoneTagged = text.includes('@everyone');

    const newMsg = {
        sender: senderName,
        text: text,
        timestamp: Date.now(),
        isEveryoneTagged: isEveryoneTagged
    };

    if (db) {
        db.ref('chat').push(newMsg);
    }

    if (input) input.value = "";

    if (isEveryoneTagged) {
        showToast("📢 Tagged @everyone in Team Comms!");
    }
}

export function triggerTeamChatImage() {
    const input = document.getElementById('team-chat-image-input');
    if (input) input.click();
}

export function handleTeamChatImageFile(event) {
    const file = event.target?.files?.[0];
    if (!file) return;

    showToast("📸 Processing photo...");

    const reader = new FileReader();
    reader.onload = (e) => {
        const imageDataUrl = e.target.result;
        const senderName = appState.riderName || "Lokalex Rider";

        const newMsg = {
            sender: senderName,
            text: "📷 [Shared Image]",
            imageUrl: imageDataUrl,
            timestamp: Date.now()
        };

        if (db) {
            db.ref('chat').push(newMsg);
        }

        showToast("✅ Image sent to Team Comms!");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
}

export function handleChatInput(inputEl) {}

// ============================================================================
// 2. CUSTOMER-SIDE REAL-TIME CHAT WITH RIDERS
// ============================================================================
export function listenToCustomerRiderChat() {
    if (!db) return;

    const custFbId = appState.customerFacebookId || localStorage.getItem('lokalex_customer_fb_id');
    if (!custFbId) return;

    db.ref(`customerChats/${custFbId}/messages`).on('value', (snapshot) => {
        const data = snapshot.val();
        const container = document.getElementById('cust-rider-chat-messages');
        if (!container) return;

        if (!data) {
            container.innerHTML = `<div class="text-center text-gray-500 italic py-10 text-xs">Pumili o mag-type ng mensahe para sa mga riders...</div>`;
            return;
        }

        const msgs = Object.values(data);
        msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        container.innerHTML = msgs.map(m => {
            const isRider = !!m.isRider;
            const alignClass = isRider 
                ? "self-start bg-cardBg border border-gray-700 text-gray-200 rounded-tl-none" 
                : "self-end bg-blue-600 text-white rounded-tr-none";

            let timeStr = "";
            if (m.timestamp) {
                timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }

            return `
            <div class="max-w-[85%] p-2.5 rounded-2xl flex flex-col gap-0.5 shadow-sm text-xs ${alignClass}">
                <div class="text-[9px] ${isRider ? 'text-blue-400' : 'text-blue-200'} font-bold flex justify-between gap-3">
                    <span>${escapeHtml(m.sender || (isRider ? "Lokalex Rider" : "You"))}</span>
                    <span class="opacity-60 font-mono">${timeStr}</span>
                </div>
                <div class="leading-relaxed whitespace-pre-wrap font-sans break-words">${escapeHtml(m.text)}</div>
            </div>`;
        }).join('');

        container.scrollTop = container.scrollHeight;
    });
}

export function sendCustomerToRiderChat() {
    const input = document.getElementById('cust-rider-chat-input');
    const text = input ? input.value.trim() : "";

    if (!text) return;

    const custFbId = appState.customerFacebookId || localStorage.getItem('lokalex_customer_fb_id') || `CUST_${Date.now()}`;
    const custName = appState.customerName || localStorage.getItem('lokalex_customer_name') || "Customer";
    const custAvatar = localStorage.getItem('lokalex_customer_avatar') || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=0084FF&color=fff`;

    const now = Date.now();

    const newMsg = {
        sender: custName,
        senderId: custFbId,
        text: text,
        timestamp: now,
        isRider: false
    };

    if (db) {
        db.ref(`customerChats/${custFbId}/messages`).push(newMsg);
        db.ref(`customerChats/${custFbId}/metadata`).set({
            lastMessage: text,
            lastUpdated: now,
            customerName: custName,
            customerFbId: custFbId,
            avatarUrl: custAvatar
        });
    }

    if (input) input.value = "";
    showToast("💬 Message sent to riders!");
}

// ============================================================================
// 3. RIDER-SIDE CUSTOMER CHAT FEED & DIRECT REPLY MODAL
// ============================================================================
export function listenToAllCustomerChatsForRider() {
    if (!db) return;

    db.ref('customerChats').on('value', (snapshot) => {
        const data = snapshot.val();
        const feed = document.getElementById('rider-cust-chats-feed');
        const badge = document.getElementById('rider-cust-chats-badge');

        if (!feed) return;

        if (!data) {
            feed.innerHTML = `<div class="text-gray-500 italic text-center py-4 text-xs">No active customer messages yet.</div>`;
            if (badge) badge.innerText = "0 threads";
            return;
        }

        const threads = Object.keys(data).map(key => {
            const item = data[key];
            const meta = item.metadata || {};
            return {
                custId: key,
                customerName: meta.customerName || "Customer",
                avatarUrl: meta.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(meta.customerName || "Customer")}&background=0084FF&color=fff`,
                lastMessage: meta.lastMessage || "No messages yet",
                lastUpdated: meta.lastUpdated || 0,
                messages: item.messages ? Object.values(item.messages) : []
            };
        });

        threads.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));

        if (badge) badge.innerText = `${threads.length} ${threads.length === 1 ? 'thread' : 'threads'}`;

        feed.innerHTML = threads.map(t => {
            let timeStr = "";
            if (t.lastUpdated) {
                timeStr = new Date(t.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }

            return `
            <div onclick="openRiderCustomerChatModal('${t.custId}', '${escapeHtml(t.customerName)}', '${escapeHtml(t.avatarUrl)}')" class="bg-black/30 hover:bg-black/50 border border-gray-800 p-2.5 rounded-xl flex items-center justify-between cursor-pointer transition active:scale-[0.99]">
                <div class="flex items-center gap-2.5 min-w-0">
                    <img src="${t.avatarUrl}" class="w-9 h-9 rounded-full object-cover border border-blue-500 shrink-0">
                    <div class="min-w-0">
                        <div class="font-bold text-white text-xs truncate">${escapeHtml(t.customerName)}</div>
                        <div class="text-[11px] text-gray-400 truncate">${escapeHtml(t.lastMessage)}</div>
                    </div>
                </div>
                <div class="text-[9px] text-gray-500 font-mono shrink-0 ml-2">${timeStr}</div>
            </div>`;
        }).join('');
    });
}

export function openRiderCustomerChatModal(custId, custName, avatarUrl) {
    activeRiderChatCustId = custId;

    const modal = document.getElementById('rider-customer-chat-modal');
    const nameEl = document.getElementById('rider-chat-cust-name');
    const avatarEl = document.getElementById('rider-chat-cust-avatar');

    if (nameEl) nameEl.innerText = custName || "Customer";
    if (avatarEl) avatarEl.src = avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=0084FF&color=fff`;

    if (modal) modal.classList.remove('hidden');

    if (activeRiderChatListener) activeRiderChatListener.off();

    if (db && custId) {
        activeRiderChatListener = db.ref(`customerChats/${custId}/messages`);
        activeRiderChatListener.on('value', (snapshot) => {
            const data = snapshot.val();
            const container = document.getElementById('rider-cust-chat-messages');
            if (!container) return;

            if (!data) {
                container.innerHTML = `<div class="text-center text-gray-500 italic py-10 text-xs">No messages yet.</div>`;
                return;
            }

            const msgs = Object.values(data);
            msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

            const riderName = appState.riderName || "Rider";

            container.innerHTML = msgs.map(m => {
                const isRider = !!m.isRider;
                const alignClass = isRider 
                    ? "self-end bg-blue-600 text-white rounded-tr-none" 
                    : "self-start bg-cardBg border border-gray-700 text-gray-200 rounded-tl-none";

                let timeStr = "";
                if (m.timestamp) {
                    timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }

                return `
                <div class="max-w-[85%] p-2.5 rounded-2xl flex flex-col gap-0.5 shadow-sm text-xs ${alignClass}">
                    <div class="text-[9px] ${isRider ? 'text-blue-200' : 'text-blue-400'} font-bold flex justify-between gap-3">
                        <span>${escapeHtml(m.sender || (isRider ? riderName : custName))}</span>
                        <span class="opacity-60 font-mono">${timeStr}</span>
                    </div>
                    <div class="leading-relaxed whitespace-pre-wrap font-sans break-words">${escapeHtml(m.text)}</div>
                </div>`;
            }).join('');

            container.scrollTop = container.scrollHeight;
        });
    }
}

export function closeRiderCustomerChatModal() {
    const modal = document.getElementById('rider-customer-chat-modal');
    if (modal) modal.classList.add('hidden');

    if (activeRiderChatListener) {
        activeRiderChatListener.off();
        activeRiderChatListener = null;
    }
    activeRiderChatCustId = null;
}

export function sendRiderToCustomerChat() {
    const input = document.getElementById('rider-cust-chat-input');
    const text = input ? input.value.trim() : "";

    if (!text || !activeRiderChatCustId) return;

    const riderName = appState.riderName || "Lokalex Rider";
    const now = Date.now();

    const newMsg = {
        sender: riderName,
        text: text,
        timestamp: now,
        isRider: true
    };

    if (db) {
        db.ref(`customerChats/${activeRiderChatCustId}/messages`).push(newMsg);
        db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update({
            lastMessage: `You: ${text}`,
            lastUpdated: now
        });
    }

    if (input) input.value = "";
}

// BIND TO GLOBAL WINDOW OBJECT
if (typeof window !== 'undefined') {
    window.initDraggableChat = initDraggableChat;
    window.toggleChatWindow = toggleChatWindow;
    window.sendBubbleChatMessage = sendBubbleChatMessage;
    window.triggerTeamChatImage = triggerTeamChatImage;
    window.handleTeamChatImageFile = handleTeamChatImageFile;
    window.handleChatInput = handleChatInput;
    window.sendCustomerToRiderChat = sendCustomerToRiderChat;
    window.listenToCustomerRiderChat = listenToCustomerRiderChat;
    window.listenToAllCustomerChatsForRider = listenToAllCustomerChatsForRider;
    window.openRiderCustomerChatModal = openRiderCustomerChatModal;
    window.closeRiderCustomerChatModal = closeRiderCustomerChatModal;
    window.sendRiderToCustomerChat = sendRiderToCustomerChat;
}