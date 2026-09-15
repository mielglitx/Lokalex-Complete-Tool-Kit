// src/features/chat/teamComms/teamCommsTabs.js
import { globalState } from '../../../store/state.js';
import { escapeHtml, formatTitleCase } from '../../../utils/helpers.js';
import { teamCommsState, setCommsHeader } from './teamCommsState.js';
import { restoreBubbleDockedPosition } from './teamCommsDraggable.js';
import { openGeneralChat, renderDirectMessagesRidersList, scrollChatToBottom } from './teamCommsMessages.js';
import { renderGroupRoomsList, closeCreateGroupModal, closeManageGroupModal } from './teamCommsGroups.js';

export function toggleChatWindow(show) {
    const container = document.getElementById('floating-chat-container');
    const windowEl = document.getElementById('expanded-chat-window');
    const bubbleBadge = document.getElementById('chat-unread-badge');
    const tagBadge = document.getElementById('chat-tag-badge');
    const bubble = document.getElementById('chat-bubble');

    teamCommsState.isChatOpen = (typeof show === 'boolean') ? show : !teamCommsState.isChatOpen;

    if (windowEl && container) {
        if (teamCommsState.isChatOpen) {
            if (bubble) bubble.classList.add('hidden');
            windowEl.classList.remove('hidden');

            if (bubbleBadge) bubbleBadge.classList.add('hidden');
            if (tagBadge) tagBadge.classList.add('hidden');

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