// src/features/chat.js
import { db } from '../config/firebase.js';
import { appState, globalState } from '../store/state.js';
import { showToast } from '../ui/notifications.js';
import { escapeHtml } from '../utils/helpers.js';

let isChatOpen = false;
let unreadChatCount = 0;
let lastKnownChatMsgCount = 0;

export function initDraggableChat() {
    const bubble = document.getElementById('chat-bubble');
    const container = document.getElementById('floating-chat-container');

    if (!bubble || !container) return;

    let isDragging = false;
    let startY = 0;
    let initialTop = 0;

    const onStart = (e) => {
        isDragging = false;
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        const rect = container.getBoundingClientRect();
        initialTop = rect.top;
    };

    const onMove = (e) => {
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const deltaY = clientY - startY;
        if (Math.abs(deltaY) > 5) {
            isDragging = true;
            let newTop = initialTop + deltaY;
            const maxTop = window.innerHeight - 80;
            newTop = Math.max(60, Math.min(newTop, maxTop));
            container.style.top = `${newTop}px`;
        }
    };

    const onEnd = () => {
        if (!isDragging) {
            toggleChatWindow(!isChatOpen);
        }
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

// SEND TEAM CHAT MESSAGE WITH @everyone TAG SUPPORT
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

// TRIGGER TEAM CHAT PHOTO ATTACHMENT
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

export function handleChatInput(inputEl) {
    // Optional auto-complete trigger
}

if (typeof window !== 'undefined') {
    window.initDraggableChat = initDraggableChat;
    window.toggleChatWindow = toggleChatWindow;
    window.sendBubbleChatMessage = sendBubbleChatMessage;
    window.triggerTeamChatImage = triggerTeamChatImage;
    window.handleTeamChatImageFile = handleTeamChatImageFile;
    window.handleChatInput = handleChatInput;
}