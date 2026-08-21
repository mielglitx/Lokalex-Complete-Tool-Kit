// src/features/chat/teamComms.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';
import { compressAndResizeImage, isHdMode } from './chatUtils.js';

let isChatOpen = false;
let unreadChatCount = 0;
let lastKnownChatMsgCount = 0;

export function initDraggableChat() {
    // Widget permanently removed
    const container = document.getElementById('floating-chat-container');
    if (container) {
        container.remove();
    }
}

export function toggleChatWindow(show) {
    isChatOpen = false;
    const windowEl = document.getElementById('expanded-chat-window');
    if (windowEl) windowEl.classList.add('hidden');
}

export function listenToFirebaseChat() {
    if (!db) return;

    db.ref('chat').on('value', (snapshot) => {
        const data = snapshot.val();
        let msgs = [];
        if (data) {
            msgs = Object.keys(data).map(key => ({ id: key, ...data[key] }));
            msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        }

        globalState.chatMessages = msgs;
    });
}

export function renderBubbleChatMessages(msgs) {}

export function scrollChatToBottom() {}

export function sendBubbleChatMessage() {}

export function triggerTeamChatImage() {}

export function handleTeamChatImageFile(event) {}

export function handleChatInput() {}