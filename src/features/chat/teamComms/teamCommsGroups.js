// src/features/chat/teamComms/teamCommsGroups.js
import { db } from '../../../config/firebase.js';
import { appState, globalState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { escapeHtml, formatTitleCase } from '../../../utils/helpers.js';
import { setCommsHeader } from './teamCommsState.js';
import { subscribeToActiveChannelMessages } from './teamCommsMessages.js';
import { switchTeamCommsTab } from './teamCommsTabs.js';

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