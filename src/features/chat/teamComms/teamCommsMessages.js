// src/features/chat/teamComms/teamCommsMessages.js
import { db } from '../../../config/firebase.js';
import { appState, globalState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { escapeHtml, formatTitleCase } from '../../../utils/helpers.js';
import { compressAndResizeImage, isHdMode } from '../chatUtils.js';
import { teamCommsState, setCommsHeader } from './teamCommsState.js';

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

export function subscribeToActiveChannelMessages(dbPath) {
    if (teamCommsState.activeChannelListener && typeof teamCommsState.activeChannelListener.off === 'function') {
        teamCommsState.activeChannelListener.off();
        teamCommsState.activeChannelListener = null;
    }

    const container = document.getElementById('bubble-chat-messages');
    if (container) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-12">Loading messages...</div>`;
    }

    if (!db) return;

    const ref = db.ref(dbPath).limitToLast(60);
    teamCommsState.activeChannelListener = ref;

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

        let replyHtml = "";
        if (msg.replyTo) {
            replyHtml = `
            <div onclick="window.scrollToBubble && window.scrollToBubble('${msg.replyTo.id}')" class="bg-black/30 border-l-2 border-blue-400 px-2 py-1 mb-1 rounded text-[10px] cursor-pointer hover:bg-black/50 transition truncate">
                <span class="font-bold text-blue-300">${escapeHtml(formatTitleCase(msg.replyTo.sender))}:</span> 
                <span class="text-gray-300 italic">${escapeHtml(msg.replyTo.text || 'Photo')}</span>
            </div>`;
        }

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

    if (teamCommsState.pendingReplyTo) {
        newMsg.replyTo = {
            id: teamCommsState.pendingReplyTo.id,
            sender: teamCommsState.pendingReplyTo.sender,
            text: teamCommsState.pendingReplyTo.text
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
    teamCommsState.pendingReplyTo = { id: msgId, sender: formatTitleCase(sender), text: text.substring(0, 50) };
    const banner = document.getElementById('team-chat-reply-banner');
    const senderEl = document.getElementById('team-reply-sender');
    const textEl = document.getElementById('team-reply-text');

    if (banner && senderEl && textEl) {
        senderEl.innerText = teamCommsState.pendingReplyTo.sender;
        textEl.innerText = teamCommsState.pendingReplyTo.text || 'Photo';
        banner.classList.remove('hidden');
    }

    const input = document.getElementById('bubble-chat-input');
    if (input) input.focus();
}

export function cancelTeamReply() {
    teamCommsState.pendingReplyTo = null;
    const banner = document.getElementById('team-chat-reply-banner');
    if (banner) banner.classList.add('hidden');
}

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