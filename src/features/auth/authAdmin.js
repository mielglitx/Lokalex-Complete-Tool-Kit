// src/features/auth/authAdmin.js
import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { showToast } from '../../ui/notifications.js';

export function isUserBlocked(idOrName) {
    if (!idOrName || !globalState.blockedUsers) return false;
    const clean = idOrName.toString().toLowerCase().trim();

    return Object.values(globalState.blockedUsers).some(b => {
        if (!b) return false;
        const bId = (b.id || "").toString().toLowerCase().trim();
        const bName = (b.name || "").toString().toLowerCase().trim();
        return (bId && bId === clean) || (bName && bName === clean);
    });
}

export function openAdminBlockModal() {
    const modal = document.getElementById('admin-block-user-modal');
    const selectEl = document.getElementById('block-target-select');

    if (modal) {
        if (selectEl) {
            let riderMap = new Map();

            (globalState.rosterMembers || []).forEach(r => {
                const name = (r.riderName || r.name || "").trim();
                const id = (r.telegramId || r.id || name).toString().trim();
                if (name) riderMap.set(name.toLowerCase(), { id: id || name, name: name });
            });

            (globalState.globalLogins || []).forEach(l => {
                const name = (l.riderName || "").trim();
                if (name && !riderMap.has(name.toLowerCase())) {
                    riderMap.set(name.toLowerCase(), { id: name, name: name });
                }
            });

            if (globalState.userTypesMap) {
                Object.keys(globalState.userTypesMap).forEach(key => {
                    if (isNaN(key) && !riderMap.has(key.toLowerCase())) {
                        const cleanName = key.trim();
                        if (cleanName) riderMap.set(cleanName.toLowerCase(), { id: cleanName, name: cleanName });
                    }
                });
            }

            const cleanList = Array.from(riderMap.values()).sort((a,b) => a.name.localeCompare(b.name));

            let optionsHtml = '<option value="" disabled selected>-- Select Rider / User --</option>';
            cleanList.forEach(item => {
                optionsHtml += `<option value="${item.id}">${item.name}</option>`;
            });
            selectEl.innerHTML = optionsHtml;
        }

        modal.classList.remove('hidden');
        renderBlockedUsersList();
    }
}

export function closeAdminBlockModal() {
    const modal = document.getElementById('admin-block-user-modal');
    if (modal) modal.classList.add('hidden');
}

export function submitBlockUser() {
    const targetSelect = document.getElementById('block-target-select');
    const reasonInput = document.getElementById('block-reason-input');

    const targetVal = targetSelect ? targetSelect.value.trim() : "";
    const targetText = targetSelect && targetSelect.selectedIndex >= 0 ? targetSelect.options[targetSelect.selectedIndex].text : targetVal;
    const reason = reasonInput ? reasonInput.value.trim() : "Violation of Terms";

    if (!targetVal) return showToast("⚠️ Please select a user to block.");

    const cleanKey = targetVal.toLowerCase().replace(/[^a-z0-9]/g, '');

    const blockRecord = {
        id: targetVal,
        name: targetText || targetVal,
        reason: reason,
        blockedBy: appState.riderName || "Admin",
        blockedAt: Date.now()
    };

    if (db) {
        db.ref(`blockedUsers/${cleanKey}`).set(blockRecord);
    }

    if (!globalState.blockedUsers) globalState.blockedUsers = {};
    globalState.blockedUsers[cleanKey] = blockRecord;

    if (targetSelect) targetSelect.selectedIndex = 0;
    if (reasonInput) reasonInput.value = "";

    showToast(`🚫 Blocked user: ${targetText || targetVal}`);
    renderBlockedUsersList();
}

export function unblockUser(cleanKey) {
    if (db) {
        db.ref(`blockedUsers/${cleanKey}`).remove();
    }
    if (globalState.blockedUsers) {
        delete globalState.blockedUsers[cleanKey];
    }
    showToast(`✅ User unblocked.`);
    renderBlockedUsersList();
}

export function renderBlockedUsersList() {
    const container = document.getElementById('blocked-users-list');
    if (!container) return;

    const list = globalState.blockedUsers ? Object.entries(globalState.blockedUsers) : [];

    if (list.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-6 text-xs">No blocked users recorded.</div>`;
        return;
    }

    container.innerHTML = list.map(([key, record]) => `
        <div class="bg-black/40 border border-red-500/30 p-2.5 rounded-xl flex justify-between items-center text-xs">
            <div>
                <div class="font-bold text-red-400">${record.name || record.id}</div>
                <div class="text-[10px] text-gray-400">Reason: ${record.reason || 'N/A'}</div>
            </div>
            <button onclick="unblockUser('${key}')" class="bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 px-2 py-1 rounded text-[10px] font-bold transition active:scale-95">
                Unblock
            </button>
        </div>
    `).join('');
}