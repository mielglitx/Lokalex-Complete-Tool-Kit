// src/features/chat/teamComms/teamCommsState.js

export const teamCommsState = {
    isChatOpen: false,
    unreadChatCount: 0,
    lastKnownMsgCount: 0,
    pendingReplyTo: null, // { id, sender, text }
    activeChannelListener: null,
    savedBubbleTop: null,
    savedBubbleSide: 'right' // 'right' | 'left'
};

export function setCommsHeader(title, subtitle, iconClass = 'fa-comments', colorClass = 'text-blue-400') {
    const titleEl = document.getElementById('team-comms-channel-title');
    const subEl = document.getElementById('team-comms-channel-subtitle');
    const iconEl = document.getElementById('team-comms-header-icon');

    if (titleEl) titleEl.innerText = title;
    if (subEl) subEl.innerText = subtitle;
    if (iconEl) iconEl.className = `fa-solid ${iconClass} ${colorClass}`;
}