// src/features/chat/teamComms.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml, formatTitleCase } from '../../utils/helpers.js';
import { compressAndResizeImage, isHdMode, openMessageActionPopover } from './chatUtils.js';

let isChatOpen = false;
let unreadChatCount = 0;
let lastKnownMsgCount = 0;
let pendingReplyTo = null; // { id, sender, text }
let activeChannelListener = null;

let savedBubbleTop = null;
let savedBubbleSide = 'right'; // 'right' | 'left'

// ============================================================================
// 1. DOCKED BUBBLE POSITION RESTORER
// ============================================================================
export function restoreBubbleDockedPosition() {
    const container = document.getElementById('floating-chat-container');
    const bubble = document.getElementById('chat-bubble');
    if (!container || !bubble) return;

    container.style.transition = 'top 0.25s ease-out, right 0.25s ease-out';

    const defaultTop = window.innerHeight * 0.75;
    const targetTop = (savedBubbleTop !== null) ? savedBubbleTop : defaultTop;
    const maxTop = window.innerHeight - (bubble.offsetHeight + 10);
    const safeTop = Math.max(10, Math.min(targetTop, maxTop));

    container.style.top = `${safeTop}px`;

    if (savedBubbleSide === 'right') {
        container.style.right = '0px';
        bubble.className = "pointer-events-auto relative bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-l-2xl shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing transition-all border-l-2 border-t-2 border-b-2 border-white/20 select-none touch-none";
    } else {
        const leftOffset = window.innerWidth - bubble.offsetWidth;
        container.style.right = `${leftOffset}px`;
        bubble.className = "pointer-events-auto relative bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-r-2xl shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing transition-all border-r-2 border-t-2 border-b-2 border-white/20 select-none touch-none";
    }
}

// ============================================================================
// 2. DRAGGABLE ENGINE (BUBBLE IN CLOSED STATE & WINDOW IN OPEN STATE)
// ============================================================================
export function initDraggableChat() {
    const container = document.getElementById('floating-chat-container');
    const bubble = document.getElementById('chat-bubble');
    const dragHandle = document.getElementById('chat-drag-handle');
    const windowEl = document.getElementById('expanded-chat-window');

    if (!container || !bubble) return;

    // --- A. DRAGGABLE BUBBLE (WHEN CHAT IS CLOSED) ---
    let isDraggingBubble = false;
    let bubbleMoved = false;
    let bubbleStartX = 0, bubbleStartY = 0;
    let initialContainerTop = 0, initialContainerRight = 0;

    const onBubbleDragStart = (e) => {
        if (isChatOpen) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        isDraggingBubble = true;
        bubbleMoved = false;
        bubbleStartX = clientX;
        bubbleStartY = clientY;

        const rect = container.getBoundingClientRect();
        initialContainerTop = rect.top;
        initialContainerRight = window.innerWidth - rect.right;

        container.style.transition = 'none';
        bubble.style.cursor = 'grabbing';
    };

    const onBubbleDragMove = (e) => {
        if (!isDraggingBubble || isChatOpen) return;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const dx = clientX - bubbleStartX;
        const dy = clientY - bubbleStartY;

        if (Math.hypot(dx, dy) > 5) {
            bubbleMoved = true;
            if (e.cancelable && e.preventDefault) e.preventDefault();
        }

        if (bubbleMoved) {
            let newTop = initialContainerTop + dy;
            let newRight = initialContainerRight - dx;

            const maxTop = window.innerHeight - (bubble.offsetHeight + 10);
            const minTop = 10;
            const maxRight = window.innerWidth - (bubble.offsetWidth + 10);
            const minRight = 0;

            newTop = Math.max(minTop, Math.min(newTop, maxTop));
            newRight = Math.max(minRight, Math.min(newRight, maxRight));

            container.style.top = `${newTop}px`;
            container.style.right = `${newRight}px`;
            container.style.bottom = 'auto';
            container.style.left = 'auto';
        }
    };

    const onBubbleDragEnd = () => {
        if (!isDraggingBubble) return;
        isDraggingBubble = false;
        bubble.style.cursor = 'grab';

        if (!bubbleMoved) {
            toggleChatWindow(true);
        } else {
            // Dock bubble to nearest edge
            const rect = container.getBoundingClientRect();
            const snapToRight = (rect.left + rect.width / 2) > (window.innerWidth / 2);
            savedBubbleTop = rect.top;
            savedBubbleSide = snapToRight ? 'right' : 'left';

            restoreBubbleDockedPosition();
        }
    };

    bubble.addEventListener('mousedown', onBubbleDragStart);
    window.addEventListener('mousemove', onBubbleDragMove, { passive: false });
    window.addEventListener('mouseup', onBubbleDragEnd);

    bubble.addEventListener('touchstart', onBubbleDragStart, { passive: true });
    window.addEventListener('touchmove', onBubbleDragMove, { passive: false });
    window.addEventListener('touchend', onBubbleDragEnd);

    // --- B. DRAGGABLE WINDOW (WHEN CHAT IS OPEN) ---
    if (dragHandle) {
        let isDraggingWindow = false;
        let winStartX = 0, winStartY = 0;
        let winInitialTop = 0, winInitialRight = 0;

        const onWindowDragStart = (e) => {
            if (!isChatOpen) return;
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;

            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            isDraggingWindow = true;
            winStartX = clientX;
            winStartY = clientY;

            const rect = container.getBoundingClientRect();
            winInitialTop = rect.top;
            winInitialRight = window.innerWidth - rect.right;

            container.style.transition = 'none';
            dragHandle.style.cursor = 'grabbing';
        };

        const onWindowDragMove = (e) => {
            if (!isDraggingWindow || !isChatOpen) return;

            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const dx = clientX - winStartX;
            const dy = clientY - winStartY;

            if (e.cancelable && e.preventDefault) e.preventDefault();

            let newTop = winInitialTop + dy;
            let newRight = winInitialRight - dx;

            const winWidth = windowEl ? windowEl.offsetWidth : 360;
            const winHeight = windowEl ? windowEl.offsetHeight : 520;

            const maxTop = window.innerHeight - (winHeight + 10);
            const minTop = 10;
            const maxRight = window.innerWidth - (winWidth + 10);
            const minRight = 10;

            newTop = Math.max(minTop, Math.min(newTop, maxTop));
            newRight = Math.max(minRight, Math.min(newRight, maxRight));

            container.style.top = `${newTop}px`;
            container.style.right = `${newRight}px`;
            container.style.bottom = 'auto';
            container.style.left = 'auto';
        };

        const onWindowDragEnd = () => {
            if (!isDraggingWindow) return;
            isDraggingWindow = false;
            dragHandle.style.cursor = 'grab';
        };

        dragHandle.addEventListener('mousedown', onWindowDragStart);
        window.addEventListener('mousemove', onWindowDragMove, { passive: false });
        window.addEventListener('mouseup', onWindowDragEnd);

        dragHandle.addEventListener('touchstart', onWindowDragStart, { passive: true });
        window.addEventListener('touchmove', onWindowDragMove, { passive: false });
        window.addEventListener('touchend', onWindowDragEnd);
    }
}

// ============================================================================
// 3. WINDOW TOGGLER & TAB NAVIGATION (GENERAL, DIRECT DMs, GROUPS)
// ============================================================================
export function toggleChatWindow(show) {
    const container = document.getElementById('floating-chat-container');
    const windowEl = document.getElementById('expanded-chat-window');
    const bubbleBadge = document.getElementById('chat-unread-badge');
    const tagBadge = document.getElementById('chat-tag-badge');
    const bubble = document.getElementById('chat-bubble');

    isChatOpen = (typeof show === 'boolean') ? show : !isChatOpen;

    if (windowEl && container) {
        if (isChatOpen) {
            if (bubble) bubble.classList.add('hidden');
            windowEl.classList.remove('hidden');

            if (bubbleBadge) bubbleBadge.classList.add('hidden');
            if (tagBadge) tagBadge.classList.add('hidden');

            // Position window safely inside viewport
            const winWidth = Math.min(window.innerWidth - 24, 390);
            const winHeight = Math.min(window.innerHeight - 80, 520);
            const safeRight = Math.max(12, Math.min(window.innerWidth - winWidth - 12, 12));
            const safeTop = Math.max(10, Math.min(window.innerHeight - winHeight - 20, window.innerHeight * 0.2));

            container.style.transition = 'none';
            container.style.right = `${safeRight}px`;
            container.style.top = `${safeTop}px`;

            if (!globalState.teamCommsActiveChannel) {
                globalState.teamCommsActiveChannel = { type: 'general', id: 'general', name: 'General Chat' };
            }
            switchTeamCommsTab(globalState.teamCommsActiveChannel.type === 'general' ? 'general' : (globalState.teamCommsActiveChannel.type === 'dm' ? 'dms' : 'groups'), false);
            scrollChatToBottom();
        } else {
            windowEl.classList.add('hidden');
            if (bubble) bubble.classList.remove('hidden');

            restoreBubbleDockedPosition();
            closeCreateGroupModal();
            closeManageGroupModal();
        }
    }
}

export function switchTeamCommsTab(tabName, resetToFeed = true) {
    const tabGen = document.getElementById('team-tab-general');
    const tabDMs = document.getElementById('team-tab-dms');
    const tabGrp = document.getElementById('team-tab-groups');

    const viewDMs = document.getElementById('team-comms-dms-list-view');
    const viewGrp = document.getElementById('team-comms-groups-list-view');
    const viewMsgs = document.getElementById('team-comms-messages-view');

    const backBtn = document.getElementById('team-comms-back-btn');
    const manageGrpBtn = document.getElementById('team-comms-group-manage-btn');

    // Tab button styling
    const activeClass = "py-1.5 rounded-xl text-[11px] font-bold transition bg-blue-600 text-white shadow";
    const inactiveClass = "py-1.5 rounded-xl text-[11px] font-bold transition text-gray-400 hover:text-white";

    if (tabGen) tabGen.className = (tabName === 'general') ? activeClass : inactiveClass;
    if (tabDMs) tabDMs.className = (tabName === 'dms') ? activeClass : inactiveClass;
    if (tabGrp) tabGrp.className = (tabName === 'groups') ? activeClass : inactiveClass;

    if (tabName === 'general') {
        if (viewDMs) viewDMs.classList.add('hidden');
        if (viewGrp) viewGrp.classList.add('hidden');
        if (viewMsgs) viewMsgs.classList.remove('hidden');
        if (backBtn) backBtn.classList.add('hidden');
        if (manageGrpBtn) manageGrpBtn.classList.add('hidden');

        setCommsHeader('General Comms', 'General Lounge (All Riders)', 'fa-comments', 'text-blue-400');
        openGeneralChat();
    } else if (tabName === 'dms') {
        if (resetToFeed || !globalState.teamCommsActiveChannel || globalState.teamCommsActiveChannel.type !== 'dm') {
            if (viewDMs) viewDMs.classList.remove('hidden');
            if (viewGrp) viewGrp.classList.add('hidden');
            if (viewMsgs) viewMsgs.classList.add('hidden');
            if (backBtn) backBtn.classList.add('hidden');
            if (manageGrpBtn) manageGrpBtn.classList.add('hidden');

            setCommsHeader('Direct Messages', '1-on-1 Rider Conversations', 'fa-user', 'text-emerald-400');
            renderDirectMessagesRidersList();
        } else {
            if (viewDMs) viewDMs.classList.add('hidden');
            if (viewGrp) viewGrp.classList.add('hidden');
            if (viewMsgs) viewMsgs.classList.remove('hidden');
            if (backBtn) backBtn.classList.remove('hidden');
            if (manageGrpBtn) manageGrpBtn.classList.add('hidden');
        }
    } else if (tabName === 'groups') {
        if (resetToFeed || !globalState.teamCommsActiveChannel || globalState.teamCommsActiveChannel.type !== 'group') {
            if (viewDMs) viewDMs.classList.add('hidden');
            if (viewGrp) viewGrp.classList.remove('hidden');
            if (viewMsgs) viewMsgs.classList.add('hidden');
            if (backBtn) backBtn.classList.add('hidden');
            if (manageGrpBtn) manageGrpBtn.classList.add('hidden');

            setCommsHeader('Group Rooms', 'Team Squads & Custom Rooms', 'fa-users', 'text-purple-400');
            renderGroupRoomsList();
        } else {
            if (viewDMs) viewDMs.classList.add('hidden');
            if (viewGrp) viewGrp.classList.add('hidden');
            if (viewMsgs) viewMsgs.classList.remove('hidden');
            if (backBtn) backBtn.classList.remove('hidden');
            if (manageGrpBtn) manageGrpBtn.classList.remove('hidden');
        }
    }
}

export function returnToChannelList() {
    const curType = globalState.teamCommsActiveChannel?.type || 'general';
    if (curType === 'dm') {
        switchTeamCommsTab('dms', true);
    } else if (curType === 'group') {
        switchTeamCommsTab('groups', true);
    } else {
        switchTeamCommsTab('general', true);
    }
}

function setCommsHeader(title, subtitle, iconClass = 'fa-comments', colorClass = 'text-blue-400') {
    const titleEl = document.getElementById('team-comms-channel-title');
    const subEl = document.getElementById('team-comms-channel-subtitle');
    const iconEl = document.getElementById('team-comms-header-icon');

    if (titleEl) titleEl.innerText = title;
    if (subEl) subEl.innerText = subtitle;
    if (iconEl) iconEl.className = `fa-solid ${iconClass} ${colorClass}`;
}

// ============================================================================
// 4. CHANNEL SELECTORS (GENERAL, DMs, GROUPS)
// ============================================================================
export function openGeneralChat() {
    globalState.teamCommsActiveChannel = {
        type: 'general',
        id: 'general',
        name: 'General Chat'
    };
    subscribeToActiveChannelMessages('teamChat/general');
}

export function openDirectMessageChat(targetRiderId, targetRiderName) {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();

    if (!myId) return showToast("⚠️ Login session required.");
    if (targetRiderId.toString().trim() === myId) return showToast("⚠️ Cannot start DM with yourself.");

    const sortedIds = [myId, targetRiderId.toString().trim()].sort().join('_');
    const formattedTargetName = formatTitleCase(targetRiderName || 'Rider');

    globalState.teamCommsActiveChannel = {
        type: 'dm',
        id: sortedIds,
        targetRiderId: targetRiderId.toString().trim(),
        name: formattedTargetName
    };

    setCommsHeader(formattedTargetName, `Private DM • ${targetRiderId}`, 'fa-user', 'text-emerald-400');

    const viewDMs = document.getElementById('team-comms-dms-list-view');
    const viewMsgs = document.getElementById('team-comms-messages-view');
    const backBtn = document.getElementById('team-comms-back-btn');
    const manageGrpBtn = document.getElementById('team-comms-group-manage-btn');

    if (viewDMs) viewDMs.classList.add('hidden');
    if (viewMsgs) viewMsgs.classList.remove('hidden');
    if (backBtn) backBtn.classList.remove('hidden');
    if (manageGrpBtn) manageGrpBtn.classList.add('hidden');

    subscribeToActiveChannelMessages(`teamChat/dms/${sortedIds}`);
}

export function openGroupChat(groupId) {
    const group = globalState.teamCommsGroups?.[groupId];
    if (!group) return showToast("⚠️ Group room not found.");

    const formattedTitle = formatTitleCase(group.title || 'Group Room');
    const memberCount = group.members ? Object.keys(group.members).length : 0;

    globalState.teamCommsActiveChannel = {
        type: 'group',
        id: groupId,
        name: formattedTitle,
        groupData: group
    };

    setCommsHeader(formattedTitle, `${memberCount} Member(s) Squad`, 'fa-users', 'text-purple-400');

    const viewGrp = document.getElementById('team-comms-groups-list-view');
    const viewMsgs = document.getElementById('team-comms-messages-view');
    const backBtn = document.getElementById('team-comms-back-btn');
    const manageGrpBtn = document.getElementById('team-comms-group-manage-btn');

    if (viewGrp) viewGrp.classList.add('hidden');
    if (viewMsgs) viewMsgs.classList.remove('hidden');
    if (backBtn) backBtn.classList.remove('hidden');
    if (manageGrpBtn) manageGrpBtn.classList.remove('hidden');

    subscribeToActiveChannelMessages(`teamChat/groups/${groupId}/messages`);
}

// ============================================================================
// 5. REALTIME MESSAGE SUBSCRIPTION & RENDERING
// ============================================================================
function subscribeToActiveChannelMessages(dbPath) {
    if (activeChannelListener && typeof activeChannelListener.off === 'function') {
        activeChannelListener.off();
        activeChannelListener = null;
    }

    const container = document.getElementById('bubble-chat-messages');
    if (container) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-12">Loading messages...</div>`;
    }

    if (!db) return;

    const ref = db.ref(dbPath).limitToLast(60);
    activeChannelListener = ref;

    ref.on('value', (snapshot) => {
        const data = snapshot.val();
        let msgs = [];
        if (data) {
            msgs = Object.keys(data).map(key => ({ id: key, ...data[key] }));
            msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        }

        renderBubbleChatMessages(msgs);
    });
}

export function renderBubbleChatMessages(msgs) {
    const container = document.getElementById('bubble-chat-messages');
    if (!container) return;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const myName = formatTitleCase(appState.riderName || localStorage.getItem('riderName') || 'Rider');

    if (!msgs || msgs.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-12 text-xs">No messages here yet. Say hi! 👋</div>`;
        return;
    }

    container.innerHTML = msgs.map(msg => {
        const isMine = (msg.senderId && msg.senderId.toString() === myId) || 
                       (msg.sender && msg.sender.toLowerCase().trim() === myName.toLowerCase().trim());
        const senderName = formatTitleCase(msg.sender || 'Rider');
        const timeStr = msg.time || (msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
        const avatarUrl = msg.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName)}&background=0284c7&color=ffffff&bold=true&size=128`;

        // Reply snippet
        let replyHtml = "";
        if (msg.replyTo) {
            replyHtml = `
            <div onclick="window.scrollToBubble && window.scrollToBubble('${msg.replyTo.id}')" class="bg-black/30 border-l-2 border-blue-400 px-2 py-1 mb-1 rounded text-[10px] cursor-pointer hover:bg-black/50 transition truncate">
                <span class="font-bold text-blue-300">${escapeHtml(formatTitleCase(msg.replyTo.sender))}:</span> 
                <span class="text-gray-300 italic">${escapeHtml(msg.replyTo.text || 'Photo')}</span>
            </div>`;
        }

        // Image attachment
        let imageHtml = "";
        if (msg.imageUrl) {
            imageHtml = `
            <div class="rounded-xl overflow-hidden mb-1 border border-white/10 max-h-48 cursor-pointer" onclick="window.openImageViewerModal && window.openImageViewerModal('${escapeHtml(msg.imageUrl)}')">
                <img src="${escapeHtml(msg.imageUrl)}" alt="Attached Photo" class="w-full h-full object-cover">
            </div>`;
        }

        return `
        <div id="msg-bubble-${msg.id}" class="flex gap-2 items-end ${isMine ? 'justify-end' : 'justify-start'} group">
            ${!isMine ? `
                <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(senderName)}" class="w-7 h-7 rounded-full object-cover border border-gray-700 shrink-0 mb-0.5">
            ` : ''}

            <div class="flex flex-col max-w-[78%] ${isMine ? 'items-end' : 'items-start'}">
                ${!isMine ? `
                    <span class="text-[10px] font-bold text-gray-400 px-1 mb-0.5">${escapeHtml(senderName)}</span>
                ` : ''}

                <div class="relative p-2.5 rounded-2xl shadow-md text-xs select-text ${isMine ? 'bg-blue-600 text-white rounded-br-xs' : 'bg-gray-800 text-gray-100 rounded-bl-xs border border-gray-700/70'}">
                    ${replyHtml}
                    ${imageHtml}
                    ${msg.text ? `<p class="break-words leading-relaxed">${escapeHtml(msg.text)}</p>` : ''}
                    
                    <div class="flex items-center justify-end gap-1 mt-1 text-[9px] text-white/60 font-mono">
                        <span>${escapeHtml(timeStr)}</span>
                        ${isMine ? `<i class="fa-solid fa-check text-[8px] text-emerald-300"></i>` : ''}
                    </div>
                </div>

                <!-- Quick Action Trigger -->
                <button type="button" onclick="window.openMessageActionPopover(event, '${msg.id}', 'team-chat', '${encodeURIComponent(msg.text || '')}', '${encodeURIComponent(senderName)}')" class="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-white p-0.5 text-[10px] transition">
                    <i class="fa-solid fa-ellipsis"></i>
                </button>
            </div>
        </div>`;
    }).join('');

    scrollChatToBottom();
}

export function scrollChatToBottom() {
    const container = document.getElementById('bubble-chat-messages');
    if (container) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
        });
    }
}

// ============================================================================
// 6. SEND MESSAGE, REPLY & IMAGE UPLOAD
// ============================================================================
export async function sendBubbleChatMessage(customText = null, customImage = null) {
    const inputEl = document.getElementById('bubble-chat-input');
    const text = (customText !== null) ? customText.trim() : (inputEl ? inputEl.value.trim() : "");
    const imgUrl = customImage || null;

    if (!text && !imgUrl) return;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const myName = formatTitleCase(appState.riderName || localStorage.getItem('riderName') || 'Rider');
    const photoUrl = appState.photoUrl || localStorage.getItem('lokalex_photo_url') || localStorage.getItem('riderPhotoUrl') || '';

    const channel = globalState.teamCommsActiveChannel || { type: 'general', id: 'general' };
    const nowTimestamp = Date.now();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newMsg = {
        senderId: myId,
        sender: myName,
        photoUrl: photoUrl,
        text: text || "",
        imageUrl: imgUrl || "",
        timestamp: nowTimestamp,
        time: timeStr
    };

    if (pendingReplyTo) {
        newMsg.replyTo = {
            id: pendingReplyTo.id,
            sender: pendingReplyTo.sender,
            text: pendingReplyTo.text
        };
    }

    if (inputEl) inputEl.value = "";
    cancelTeamReply();

    let targetPath = 'teamChat/general';
    if (channel.type === 'dm') {
        targetPath = `teamChat/dms/${channel.id}`;
    } else if (channel.type === 'group') {
        targetPath = `teamChat/groups/${channel.id}/messages`;
    }

    if (db) {
        try {
            await db.ref(targetPath).push(newMsg);

            // Update DM / Group metadata timestamp
            if (channel.type === 'group') {
                db.ref(`teamChat/groups/${channel.id}/metadata`).update({
                    lastMessage: text || "Photo attached",
                    lastUpdated: nowTimestamp,
                    lastSender: myName
                }).catch(() => {});
            }
        } catch (e) {
            showToast("❌ Failed to send message.");
        }
    }
}

export function handleTeamChatImageFile(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast("⚠️ Select a valid image file.");
        return;
    }

    showToast(isHdMode ? "📸 Processing HD Image..." : "⚡ Compressing image...");
    compressAndResizeImage(file, isHdMode, (base64Img) => {
        sendBubbleChatMessage("", base64Img);
        showToast("✅ Image sent!");
    });

    event.target.value = "";
}

export function setTeamReply(msgId, sender, text) {
    pendingReplyTo = { id: msgId, sender: formatTitleCase(sender), text: text.substring(0, 50) };
    const banner = document.getElementById('team-chat-reply-banner');
    const senderEl = document.getElementById('team-reply-sender');
    const textEl = document.getElementById('team-reply-text');

    if (banner && senderEl && textEl) {
        senderEl.innerText = pendingReplyTo.sender;
        textEl.innerText = pendingReplyTo.text || 'Photo';
        banner.classList.remove('hidden');
    }

    const input = document.getElementById('bubble-chat-input');
    if (input) input.focus();
}

export function cancelTeamReply() {
    pendingReplyTo = null;
    const banner = document.getElementById('team-chat-reply-banner');
    if (banner) banner.classList.add('hidden');
}

export function handleChatInput(inputEl) {
    const val = inputEl.value;
    const atIdx = val.lastIndexOf('@');
    const tagBox = document.getElementById('tag-suggestions');

    if (atIdx !== -1 && atIdx === val.length - 1) {
        const roster = globalState.rosterMembers || [];
        if (tagBox && roster.length > 0) {
            tagBox.innerHTML = roster.map(r => {
                const name = formatTitleCase(r.riderName || r.name || "Rider");
                return `
                <div onclick="window.insertTagMention('${escapeHtml(name)}')" class="p-2 hover:bg-blue-600 hover:text-white rounded-xl cursor-pointer font-bold text-xs flex items-center gap-2">
                    <i class="fa-solid fa-at text-blue-400"></i> ${escapeHtml(name)}
                </div>`;
            }).join('');
            tagBox.classList.remove('hidden');
        }
    } else {
        if (tagBox) tagBox.classList.add('hidden');
    }
}

export function insertTagMention(riderName) {
    const input = document.getElementById('bubble-chat-input');
    const tagBox = document.getElementById('tag-suggestions');
    if (input) {
        const atIdx = input.value.lastIndexOf('@');
        input.value = input.value.substring(0, atIdx) + `@${riderName} `;
        input.focus();
    }
    if (tagBox) tagBox.classList.add('hidden');
}

// ============================================================================
// 7. DIRECT MESSAGES LIST VIEW
// ============================================================================
export function renderDirectMessagesRidersList() {
    const feed = document.getElementById('team-comms-riders-feed');
    if (!feed) return;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const roster = (globalState.rosterMembers || []).filter(r => (r.telegramId || r.id || '').toString() !== myId);

    if (roster.length === 0) {
        feed.innerHTML = `<div class="text-center text-gray-500 italic py-8 text-xs">No other riders in lineup.</div>`;
        return;
    }

    feed.innerHTML = roster.map(r => {
        const rId = (r.telegramId || r.id || '').toString().trim();
        const rName = formatTitleCase(r.riderName || r.name || 'Rider');
        const photoUrl = r.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(rName)}&background=0284c7&color=ffffff&bold=true&size=128`;
        const status = r.status || 'Offline';

        return `
        <div onclick="window.openDirectMessageChat('${escapeHtml(rId)}', '${escapeHtml(rName)}')" class="bg-cardBg border border-gray-800 hover:border-emerald-500/50 p-2.5 rounded-2xl flex items-center justify-between cursor-pointer transition active:scale-[0.98]">
            <div class="flex items-center gap-2.5 min-w-0">
                <img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(rName)}" class="w-9 h-9 rounded-full object-cover border border-emerald-500/40 shrink-0">
                <div class="min-w-0">
                    <span class="font-bold text-xs text-white truncate block">${escapeHtml(rName)}</span>
                    <span class="text-[9px] font-bold ${status === 'Available' ? 'text-emerald-400' : (status === 'Catering' ? 'text-red-400' : 'text-gray-400')} uppercase font-mono">${escapeHtml(status)}</span>
                </div>
            </div>
            <button type="button" class="bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 w-7 h-7 rounded-xl flex items-center justify-center text-xs">
                <i class="fa-solid fa-paper-plane"></i>
            </button>
        </div>`;
    }).join('');
}

// ============================================================================
// 8. GROUP ROOMS LIST & MANAGEMENT
// ============================================================================
export function renderGroupRoomsList() {
    const feed = document.getElementById('team-comms-groups-feed');
    if (!feed) return;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const allGroups = globalState.teamCommsGroups || {};
    const myGroups = Object.entries(allGroups).filter(([id, g]) => {
        return g && g.members && g.members[myId];
    });

    if (myGroups.length === 0) {
        feed.innerHTML = `
        <div class="text-center text-gray-500 italic py-8 text-xs flex flex-col items-center gap-2">
            <span>You are not in any group rooms yet.</span>
            <button type="button" onclick="window.openCreateGroupModal && window.openCreateGroupModal()" class="bg-purple-600 hover:bg-purple-500 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition shadow">
                + Create First Group
            </button>
        </div>`;
        return;
    }

    feed.innerHTML = myGroups.map(([groupId, g]) => {
        const title = formatTitleCase(g.title || 'Group Room');
        const memberCount = g.members ? Object.keys(g.members).length : 0;
        const lastMsg = g.lastMessage ? escapeHtml(g.lastMessage) : "No messages yet";

        return `
        <div onclick="window.openGroupChat('${escapeHtml(groupId)}')" class="bg-cardBg border border-gray-800 hover:border-purple-500/50 p-3 rounded-2xl flex items-center justify-between cursor-pointer transition active:scale-[0.98]">
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
                <div class="w-9 h-9 rounded-full bg-purple-600/20 text-purple-300 font-bold flex items-center justify-center text-sm shrink-0 border border-purple-500/30">
                    <i class="fa-solid fa-users"></i>
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                        <span class="font-bold text-xs text-white truncate">${escapeHtml(title)}</span>
                        <span class="text-[9px] bg-purple-500/20 text-purple-300 px-1.5 py-0.2 rounded-full font-bold border border-purple-500/30">${memberCount}</span>
                    </div>
                    <p class="text-[10px] text-gray-400 truncate mt-0.5">${lastMsg}</p>
                </div>
            </div>
            <i class="fa-solid fa-chevron-right text-xs text-gray-600 shrink-0 ml-2"></i>
        </div>`;
    }).join('');
}

export function openCreateGroupModal() {
    const modal = document.getElementById('create-group-chat-modal');
    const titleInput = document.getElementById('create-group-title-input');
    const listEl = document.getElementById('create-group-members-checklist');

    if (titleInput) titleInput.value = "";
    if (modal) modal.classList.remove('hidden');

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const roster = (globalState.rosterMembers || []).filter(r => (r.telegramId || r.id || '').toString() !== myId);

    if (listEl) {
        if (roster.length === 0) {
            listEl.innerHTML = `<div class="text-center text-gray-500 italic py-4 text-xs">No other riders available to add.</div>`;
            return;
        }

        listEl.innerHTML = roster.map(r => {
            const rId = (r.telegramId || r.id || '').toString().trim();
            const rName = formatTitleCase(r.riderName || r.name || 'Rider');
            return `
            <label class="flex items-center justify-between p-2 rounded-xl bg-darkBg/60 hover:bg-darkBg cursor-pointer select-none border border-gray-800">
                <span class="font-bold text-xs text-gray-200">${escapeHtml(rName)}</span>
                <input type="checkbox" value="${escapeHtml(rId)}" data-name="${escapeHtml(rName)}" class="group-member-checkbox w-4 h-4 accent-purple-500 cursor-pointer">
            </label>`;
        }).join('');
    }
}

export function closeCreateGroupModal() {
    const modal = document.getElementById('create-group-chat-modal');
    if (modal) modal.classList.add('hidden');
}

export async function submitCreateGroupChat() {
    const titleInput = document.getElementById('create-group-title-input');
    const rawTitle = titleInput ? titleInput.value.trim() : '';
    const title = formatTitleCase(rawTitle);

    if (!title) return showToast("⚠️ Group room name is required.");

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const myName = formatTitleCase(appState.riderName || localStorage.getItem('riderName') || 'Rider');

    const checkedBoxes = Array.from(document.querySelectorAll('.group-member-checkbox:checked'));
    if (checkedBoxes.length === 0) return showToast("⚠️ Select at least 1 rider to join the group.");

    const members = {
        [myId]: { name: myName, role: 'admin' }
    };

    checkedBoxes.forEach(box => {
        const id = box.value.trim();
        const name = box.getAttribute('data-name') || 'Rider';
        if (id) members[id] = { name: name, role: 'member' };
    });

    const groupId = `grp_${Date.now()}`;
    const newGroup = {
        id: groupId,
        title: title,
        createdBy: myId,
        creatorName: myName,
        createdAt: Date.now(),
        lastMessage: "Group created",
        lastUpdated: Date.now(),
        members: members
    };

    if (db) {
        try {
            await db.ref(`teamChat/groups/${groupId}/metadata`).set(newGroup);
            await db.ref(`teamChat/groups/${groupId}/messages`).push({
                senderId: 'system',
                sender: 'System',
                text: `🎉 ${myName} created the group "${title}".`,
                timestamp: Date.now(),
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });

            closeCreateGroupModal();
            showToast(`✅ Created group "${title}"!`);
            openGroupChat(groupId);
        } catch (e) {
            showToast("❌ Failed to create group.");
        }
    }
}

export function openManageGroupModal() {
    const modal = document.getElementById('manage-group-modal');
    const channel = globalState.teamCommsActiveChannel;

    if (!channel || channel.type !== 'group' || !channel.id) {
        return showToast("⚠️ No active group chat open.");
    }

    const group = globalState.teamCommsGroups?.[channel.id] || channel.groupData;
    if (!group) return showToast("⚠️ Group details not found.");

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const isGroupAdmin = (group.createdBy === myId) || (group.members?.[myId]?.role === 'admin');

    const titleEl = document.getElementById('manage-group-modal-title');
    const countEl = document.getElementById('manage-group-member-count');
    const addSection = document.getElementById('manage-group-add-member-section');
    const addSelect = document.getElementById('manage-group-add-select');
    const membersList = document.getElementById('manage-group-members-list');
    const leaveBtn = document.getElementById('manage-group-leave-btn');

    if (titleEl) titleEl.innerText = formatTitleCase(group.title || 'Group Settings');
    if (leaveBtn) {
        leaveBtn.innerText = isGroupAdmin ? "🗑️ Delete Group Room" : "🚪 Leave Group";
    }

    if (addSection) {
        if (isGroupAdmin) addSection.classList.remove('hidden');
        else addSection.classList.add('hidden');
    }

    // Populate Add Member Dropdown
    if (addSelect && isGroupAdmin) {
        const existingMemberIds = new Set(Object.keys(group.members || {}));
        const availableRiders = (globalState.rosterMembers || []).filter(r => {
            const id = (r.telegramId || r.id || '').toString().trim();
            return id && !existingMemberIds.has(id);
        });

        let opts = '<option value="" disabled selected>-- Select Rider --</option>';
        availableRiders.forEach(r => {
            const id = (r.telegramId || r.id || '').toString().trim();
            const name = formatTitleCase(r.riderName || r.name || 'Rider');
            opts += `<option value="${escapeHtml(id)}" data-name="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
        });
        addSelect.innerHTML = opts;
    }

    // Render Members List
    if (membersList) {
        const membersArr = Object.entries(group.members || {});
        if (countEl) countEl.innerText = membersArr.length;

        membersList.innerHTML = membersArr.map(([mId, mInfo]) => {
            const mName = formatTitleCase(mInfo.name || 'Rider');
            const isCreator = (group.createdBy === mId);
            const canRemove = isGroupAdmin && (mId !== myId);

            return `
            <div class="flex items-center justify-between p-2 rounded-xl bg-darkBg/60 border border-gray-800">
                <div class="flex items-center gap-2">
                    <span class="font-bold text-xs text-white">${escapeHtml(mName)}</span>
                    ${isCreator ? `<span class="bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[9px] font-black px-1.5 py-0.5 rounded">ADMIN</span>` : ''}
                </div>
                ${canRemove ? `
                    <button type="button" onclick="window.removeGroupMember('${escapeHtml(channel.id)}', '${escapeHtml(mId)}', '${escapeHtml(mName)}')" class="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded-lg hover:bg-red-900/30 transition">
                        <i class="fa-solid fa-user-minus"></i> Remove
                    </button>
                ` : ''}
            </div>`;
        }).join('');
    }

    if (modal) modal.classList.remove('hidden');
}

export function closeManageGroupModal() {
    const modal = document.getElementById('manage-group-modal');
    if (modal) modal.classList.add('hidden');
}

export async function submitAddGroupMember() {
    const channel = globalState.teamCommsActiveChannel;
    if (!channel || channel.type !== 'group') return;

    const select = document.getElementById('manage-group-add-select');
    const newId = select ? select.value.trim() : '';
    const newName = select && select.selectedIndex >= 0 ? select.options[select.selectedIndex].getAttribute('data-name') : 'Rider';

    if (!newId) return showToast("⚠️ Select a rider to add.");

    if (db) {
        try {
            await db.ref(`teamChat/groups/${channel.id}/metadata/members/${newId}`).set({
                name: newName,
                role: 'member'
            });

            await db.ref(`teamChat/groups/${channel.id}/messages`).push({
                senderId: 'system',
                sender: 'System',
                text: `👤 ${newName} joined the group.`,
                timestamp: Date.now(),
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });

            showToast(`✅ Added ${newName} to group.`);
            openManageGroupModal();
        } catch (e) {
            showToast("❌ Failed to add member.");
        }
    }
}

export async function removeGroupMember(groupId, targetId, targetName) {
    if (!confirm(`Remove ${targetName} from the group?`)) return;

    if (db) {
        try {
            await db.ref(`teamChat/groups/${groupId}/metadata/members/${targetId}`).remove();
            await db.ref(`teamChat/groups/${groupId}/messages`).push({
                senderId: 'system',
                sender: 'System',
                text: `🚪 ${targetName} was removed from the group.`,
                timestamp: Date.now(),
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });

            showToast(`Removed ${targetName}.`);
            openManageGroupModal();
        } catch (e) {
            showToast("❌ Failed to remove member.");
        }
    }
}

export async function leaveOrDeleteGroup() {
    const channel = globalState.teamCommsActiveChannel;
    if (!channel || channel.type !== 'group') return;

    const group = globalState.teamCommsGroups?.[channel.id] || channel.groupData;
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const myName = formatTitleCase(appState.riderName || localStorage.getItem('riderName') || 'Rider');
    const isCreator = (group?.createdBy === myId);

    if (isCreator) {
        if (!confirm(`Are you sure you want to permanently delete "${group.title}" for everyone?`)) return;
        if (db) {
            await db.ref(`teamChat/groups/${channel.id}`).remove();
            showToast("🗑️ Group deleted.");
            closeManageGroupModal();
            switchTeamCommsTab('groups', true);
        }
    } else {
        if (!confirm(`Leave "${group.title}"?`)) return;
        if (db) {
            await db.ref(`teamChat/groups/${channel.id}/metadata/members/${myId}`).remove();
            await db.ref(`teamChat/groups/${channel.id}/messages`).push({
                senderId: 'system',
                sender: 'System',
                text: `🚪 ${myName} left the group.`,
                timestamp: Date.now(),
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
            showToast("Left group.");
            closeManageGroupModal();
            switchTeamCommsTab('groups', true);
        }
    }
}

// ============================================================================
// 9. BACKGROUND SYNC & GLOBAL LISTENERS
// ============================================================================
export function listenToFirebaseChat() {
    if (!db) return;

    // Listen to Groups Metadata for dynamic member rooms
    db.ref('teamChat/groups').on('value', (snap) => {
        globalState.teamCommsGroups = {};
        const val = snap.val();
        if (val) {
            Object.entries(val).forEach(([gId, gData]) => {
                if (gData && gData.metadata) {
                    globalState.teamCommsGroups[gId] = gData.metadata;
                }
            });
        }
        if (isChatOpen && globalState.teamCommsActiveChannel?.type === 'group') {
            renderGroupRoomsList();
        }
    });

    // Default to General Chat channel
    openGeneralChat();
}

// Auto-initialize draggable listeners on script execution and DOM load
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDraggableChat);
    } else {
        initDraggableChat();
    }
}

// Global attachments
if (typeof window !== 'undefined') {
    window.initDraggableChat = initDraggableChat;
    window.restoreBubbleDockedPosition = restoreBubbleDockedPosition;
    window.toggleChatWindow = toggleChatWindow;
    window.switchTeamCommsTab = switchTeamCommsTab;
    window.returnToChannelList = returnToChannelList;
    window.openGeneralChat = openGeneralChat;
    window.openDirectMessageChat = openDirectMessageChat;
    window.openGroupChat = openGroupChat;
    window.openCreateGroupModal = openCreateGroupModal;
    window.closeCreateGroupModal = closeCreateGroupModal;
    window.submitCreateGroupChat = submitCreateGroupChat;
    window.openManageGroupModal = openManageGroupModal;
    window.closeManageGroupModal = closeManageGroupModal;
    window.submitAddGroupMember = submitAddGroupMember;
    window.removeGroupMember = removeGroupMember;
    window.leaveOrDeleteGroup = leaveOrDeleteGroup;
    window.sendBubbleChatMessage = sendBubbleChatMessage;
    window.handleTeamChatImageFile = handleTeamChatImageFile;
    window.setTeamReply = setTeamReply;
    window.cancelTeamReply = cancelTeamReply;
    window.handleChatInput = handleChatInput;
    window.insertTagMention = insertTagMention;
}