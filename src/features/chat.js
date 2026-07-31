// src/features/chat.js
import { db } from '../config/firebase.js';
import { appState, globalState } from '../store/state.js';
import { escapeHtml } from '../utils/helpers.js';
import { playNotificationSound } from '../ui/notifications.js';

let isChatDragging = false;
let chatStartY = 0;
let chatTopOffset = 0;
let currentBubbleY = Math.max(120, window.innerHeight - 180);
let lastReadChatCount = parseInt(localStorage.getItem('lastReadChatCount') || "0");
let lastSoundProcessedCount = -1;
let tagObserver = null;

export function initDraggableChat() {
    const bubble = document.getElementById('chat-bubble');
    if (!bubble) return;

    updateChatPositions();

    bubble.addEventListener('pointerdown', (e) => {
        isChatDragging = false;
        chatStartY = e.clientY;
        chatTopOffset = currentBubbleY;
        bubble.setPointerCapture(e.pointerId);
    });

    bubble.addEventListener('pointermove', (e) => {
        if (Math.abs(e.clientY - chatStartY) > 5) isChatDragging = true;
        if (!isChatDragging) return;

        const deltaY = e.clientY - chatStartY;
        let newY = chatTopOffset + deltaY;
        currentBubbleY = Math.max(70, Math.min(window.innerHeight - 60, newY));
        updateChatPositions();
    });

    bubble.addEventListener('pointerup', (e) => {
        try { bubble.releasePointerCapture(e.pointerId); } catch(err){}
        if (!isChatDragging) toggleChatWindow();
        isChatDragging = false;
    });

    document.addEventListener('pointerdown', (e) => {
        const windowEl = document.getElementById('expanded-chat-window');
        const containerEl = document.getElementById('floating-chat-container');
        if (windowEl && !windowEl.classList.contains('hidden') && containerEl && !containerEl.contains(e.target)) {
            toggleChatWindow(false);
        }
    });

    window.addEventListener('chatUpdated', updateChatBadgesAndUI);
}

function updateChatPositions() {
    const container = document.getElementById('floating-chat-container');
    const windowEl = document.getElementById('expanded-chat-window');
    if (!container) return;
    
    if (windowEl.classList.contains('hidden')) {
        container.style.top = currentBubbleY + 'px';
        container.style.bottom = 'auto';
    } else {
        const windowHeight = 384;
        let windowTop = Math.max(60, currentBubbleY - windowHeight - 8);
        if (windowTop + windowHeight + 50 > window.innerHeight) {
            windowTop = Math.max(60, window.innerHeight - windowHeight - 60);
        }
        container.style.top = windowTop + 'px';
        container.style.bottom = 'auto';
    }
}

export function toggleChatWindow(forceShow) {
    const windowEl = document.getElementById('expanded-chat-window');
    const show = forceShow !== undefined ? forceShow : windowEl.classList.contains('hidden');
    
    if (show) {
        windowEl.classList.remove('hidden');
        lastReadChatCount = globalState.chatMessages.length;
        localStorage.setItem('lastReadChatCount', lastReadChatCount.toString());
        document.getElementById('chat-unread-badge').classList.add('hidden');
        document.getElementById('chat-tag-badge').classList.add('hidden');
        renderBubbleMessages(); 
    } else {
        windowEl.classList.add('hidden');
    }
    updateChatPositions();
}

function updateChatBadgesAndUI() {
    const chatMessages = globalState.chatMessages;
    const myName = (appState.riderName || "").toLowerCase();

    if (lastSoundProcessedCount === -1) {
        lastSoundProcessedCount = chatMessages.length;
    } else if (chatMessages.length > lastSoundProcessedCount) {
        const newMessages = chatMessages.slice(lastSoundProcessedCount);
        let hasIncoming = false;
        let hasMention = false;

        newMessages.forEach(m => {
            if (m.sender !== appState.riderName) {
                hasIncoming = true;
                if (myName && m.text && m.text.toLowerCase().includes('@' + myName)) hasMention = true;
            }
        });

        if (hasMention) playNotificationSound(true);
        else if (hasIncoming) playNotificationSound(false);
        lastSoundProcessedCount = chatMessages.length;
    }

    const isChatOpen = !document.getElementById('expanded-chat-window').classList.contains('hidden');
    if (isChatOpen) {
        lastReadChatCount = chatMessages.length;
        localStorage.setItem('lastReadChatCount', lastReadChatCount.toString());
        renderBubbleMessages();
        return;
    }

    const unreadCount = Math.max(0, chatMessages.length - lastReadChatCount);
    const unreadBadge = document.getElementById('chat-unread-badge');
    const tagBadge = document.getElementById('chat-tag-badge');

    if (unreadCount > 0) {
        unreadBadge.innerText = unreadCount > 99 ? '99+' : unreadCount;
        unreadBadge.classList.remove('hidden');
        const hasTag = myName && chatMessages.slice(lastReadChatCount).some(m => m.text && m.text.toLowerCase().includes('@' + myName));
        hasTag ? tagBadge.classList.remove('hidden') : tagBadge.classList.add('hidden');
    } else {
        unreadBadge.classList.add('hidden');
        tagBadge.classList.add('hidden');
    }
}

function renderBubbleMessages() {
    const feed = document.getElementById('bubble-chat-messages');
    const chatMessages = globalState.chatMessages;
    
    if (!chatMessages || chatMessages.length === 0) {
        feed.innerHTML = `<div class="text-center text-gray-500 italic py-10">No messages yet.</div>`;
        return;
    }

    const myName = (appState.riderName || "").toLowerCase();
    feed.innerHTML = chatMessages.map((m) => {
        const isMe = m.sender === appState.riderName;
        const isTagged = myName && m.text && m.text.toLowerCase().includes('@' + myName);
        return `
        <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} my-0.5">
            <span class="text-[9px] text-gray-400 font-bold px-1">${escapeHtml(m.sender || 'Rider')} • ${escapeHtml(m.time || '')}</span>
            <div class="chat-msg-bubble px-3 py-2 rounded-2xl max-w-[85%] text-xs transition-all duration-700 ${isMe ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-800 text-gray-200 rounded-bl-none'} ${isTagged ? 'pending-tag-highlight' : ''}">
                ${escapeHtml(m.text || '').replace(/@(\w+)/g, '<span class="bg-blue-900/80 text-blue-300 font-bold px-1 rounded">@$1</span>')}
            </div>
        </div>`;
    }).join('');
    feed.scrollTop = feed.scrollHeight;
}

export function sendBubbleChatMessage() {
    const input = document.getElementById('bubble-chat-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    document.getElementById('tag-suggestions').classList.add('hidden');

    const msgData = {
        sender: appState.riderName,
        text: text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    db.ref('chat').push(msgData);
}
// --- PASTE AT THE BOTTOM OF src/features/chat.js ---
export function handleChatInput(inputEl) {
    const val = inputEl.value;
    const dropdown = document.getElementById('tag-suggestions');
    const atIndex = val.lastIndexOf('@');

    if (atIndex !== -1 && atIndex === val.length - 1 || (atIndex !== -1 && !val.substring(atIndex).includes(' '))) {
        const query = val.substring(atIndex + 1).toLowerCase();
        let riders = globalState.rosterMembers ? globalState.rosterMembers.map(r => r.riderName) : [];
        riders = [...new Set(riders)].filter(r => r.toLowerCase().includes(query));

        if (riders.length > 0) {
            dropdown.innerHTML = riders.map(r => `
                <div onclick="selectTagRider('${escapeHtml(r)}')" class="p-2 hover:bg-blue-600/30 rounded cursor-pointer flex items-center gap-2 font-bold text-blue-400">
                    <i class="fa-solid fa-at"></i> ${escapeHtml(r)}
                </div>
            `).join('');
            dropdown.classList.remove('hidden');
            return;
        }
    }
    dropdown.classList.add('hidden');
}

export function selectTagRider(name) {
    const inputEl = document.getElementById('bubble-chat-input');
    const val = inputEl.value;
    const atIndex = val.lastIndexOf('@');
    inputEl.value = val.substring(0, atIndex) + '@' + name + ' ';
    document.getElementById('tag-suggestions').classList.add('hidden');
    inputEl.focus();
}