// src/features/roster/rosterAccounts.js
import { db } from '../../config/firebase.js';
import { globalState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { escapeHtml } from '../../utils/helpers.js';
import { isAdmin, saveRosterCache } from './rosterUtils.js';
import { updateRosterUI } from './rosterUI.js';

let editingRiderTarget = null;

export function openAdminManageRidersModal() {
    if (!isAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin accounts can manage riders.");
    }

    const modal = document.getElementById('admin-manage-riders-modal');
    if (modal) {
        modal.classList.remove('hidden');
        renderAdminRidersList();
    }
}

export function closeAdminManageRidersModal() {
    const modal = document.getElementById('admin-manage-riders-modal');
    if (modal) modal.classList.add('hidden');
}

export function renderAdminRidersList() {
    const container = document.getElementById('admin-riders-list-container');
    if (!container) return;

    if (!db) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-8 text-xs">Database offline.</div>`;
        return;
    }

    db.ref('riders').once('value', (snapshot) => {
        const val = snapshot.val();
        let ridersList = [];

        if (val) {
            ridersList = Object.entries(val).map(([id, item]) => ({
                id: (item.telegramId || item.id || id).toString().trim(),
                name: item.riderName || item.name || id,
                userType: (item.userType || item.type || "rider").toLowerCase().trim()
            }));
        }

        (globalState.rosterMembers || []).forEach(m => {
            const mId = (m.telegramId || m.id || "").toString().trim();
            const mName = m.riderName || m.name || mId;
            const mType = (m.userType || "rider").toLowerCase().trim();

            if (mId && !ridersList.some(r => r.id.toString() === mId)) {
                ridersList.push({ id: mId, name: mName, userType: mType });
            }
        });

        if (ridersList.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-500 italic py-8 text-xs">No registered riders found. Click "+ Add Rider" to create one.</div>`;
            return;
        }

        ridersList.sort((a, b) => a.name.localeCompare(b.name));

        container.innerHTML = ridersList.map(r => {
            const currentType = r.userType || 'rider';
            let typeBadgeClass = "text-gray-400 bg-gray-800 border-gray-700";
            if (currentType === 'admin') typeBadgeClass = "text-amber-300 bg-amber-500/10 border-amber-500/30";
            else if (currentType === 'tl') typeBadgeClass = "text-blue-300 bg-blue-500/10 border-blue-500/30";

            return `
            <div class="bg-black/30 border border-gray-800 p-3 rounded-2xl flex items-center justify-between gap-2 shadow text-xs">
                <div class="flex flex-col min-w-0 flex-1">
                    <span class="font-bold text-white truncate flex items-center gap-1.5">
                        <i class="fa-solid fa-id-badge text-blue-400"></i> ${escapeHtml(r.name)}
                    </span>
                    <span class="text-[10px] text-gray-400 font-mono">ID: ${escapeHtml(r.id)}</span>
                </div>

                <div class="flex items-center gap-1.5 shrink-0">
                    <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-lg border ${typeBadgeClass}">
                        ${escapeHtml(currentType)}
                    </span>

                    <button onclick="window.openEditRiderModal && window.openEditRiderModal('${r.id}')" class="bg-gray-800 hover:bg-gray-700 text-blue-400 p-2 rounded-xl text-xs transition active:scale-95" title="Edit Rider Details">
                        <i class="fa-solid fa-pen"></i>
                    </button>

                    <button onclick="window.promptDeleteRiderAccount && window.promptDeleteRiderAccount('${r.id}', '${escapeHtml(r.name)}')" class="bg-gray-800 hover:bg-gray-700 text-red-400 p-2 rounded-xl text-xs transition active:scale-95" title="Delete Rider Account">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>`;
        }).join('');
    });
}

export function promptDeleteRiderAccount(riderId, riderName) {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    openSlideDeleteModal(
        `Delete Rider Account?`,
        `Sigurado ka bang nais mong burahin ang account ni [${riderName}] (ID: ${riderId})?`,
        () => {
            executeDeleteRiderAccount(riderId, riderName);
        }
    );
}

export async function executeDeleteRiderAccount(riderId, riderName) {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    try {
        if (db) {
            await db.ref(`riders/${riderId}`).remove();
            await db.ref(`roster/${riderId}`).remove();
            await db.ref(`settings/timeInSchedule/riderSchedules/${riderId}`).remove().catch(() => {});
        }

        if (globalState.rosterMembers) {
            globalState.rosterMembers = globalState.rosterMembers.filter(m => (m.telegramId || m.id || "").toString().trim() !== riderId.toString().trim());
        }

        if (globalState.userTypesMap) {
            delete globalState.userTypesMap[riderId];
            delete globalState.userTypesMap[(riderName || "").toLowerCase()];
        }

        saveRosterCache();
        showToast(`🗑️ Deleted rider account for ${riderName}`);
        renderAdminRidersList();
        updateRosterUI();
    } catch(e) {
        showToast("❌ Failed to delete rider account.");
    }
}

export async function quickChangeRiderUserType(riderId, newUserType) {
    if (!isAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin can change account types.");
    }

    if (!riderId || !newUserType) return;

    try {
        if (db) {
            await db.ref(`riders/${riderId}`).update({
                userType: newUserType,
                updatedAt: Date.now()
            });

            await db.ref(`roster/${riderId}`).update({
                telegramId: riderId,
                id: riderId,
                userType: newUserType
            }).catch(() => {});
        }

        if (!globalState.userTypesMap) globalState.userTypesMap = {};
        globalState.userTypesMap[riderId] = newUserType;

        showToast(`✅ Account type for ID [${riderId}] updated to ${newUserType.toUpperCase()}`);
        renderAdminRidersList();
        updateRosterUI();
    } catch(e) {
        showToast("❌ Failed to update rider account type.");
    }
}

export function openAddRiderModal() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    editingRiderTarget = null;
    const modal = document.getElementById('admin-edit-rider-modal');
    const titleEl = document.getElementById('admin-edit-rider-title');
    const idInput = document.getElementById('edit-rider-id-input');
    const nameInput = document.getElementById('edit-rider-name-input');
    const typeSelect = document.getElementById('edit-rider-usertype-select');

    if (titleEl) titleEl.innerText = "Add New Rider Account";
    if (idInput) {
        idInput.value = "";
        idInput.disabled = false;
    }
    if (nameInput) nameInput.value = "";
    if (typeSelect) typeSelect.value = "rider";

    if (modal) modal.classList.remove('hidden');
}

export async function openEditRiderModal(riderId) {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    editingRiderTarget = riderId;
    const modal = document.getElementById('admin-edit-rider-modal');
    const titleEl = document.getElementById('admin-edit-rider-title');
    const idInput = document.getElementById('edit-rider-id-input');
    const nameInput = document.getElementById('edit-rider-name-input');
    const typeSelect = document.getElementById('edit-rider-usertype-select');

    if (titleEl) titleEl.innerText = `Edit Rider Account (${riderId})`;
    if (idInput) {
        idInput.value = riderId;
        idInput.disabled = true;
    }

    try {
        let existingData = null;
        if (db) {
            const snap = await db.ref(`riders/${riderId}`).once('value');
            existingData = snap.val();
        }

        if (!existingData) {
            const rMem = (globalState.rosterMembers || []).find(m => (m.telegramId || m.id || "").toString() === riderId.toString());
            if (rMem) {
                existingData = { riderName: rMem.riderName || rMem.name, userType: rMem.userType };
            }
        }

        if (nameInput) nameInput.value = existingData ? (existingData.riderName || existingData.name || "") : "";
        if (typeSelect) typeSelect.value = existingData ? (existingData.userType || existingData.type || "rider").toLowerCase() : "rider";

        if (modal) modal.classList.remove('hidden');
    } catch(e) {
        showToast("⚠️ Failed to load rider details.");
    }
}

export function closeAdminEditRiderModal() {
    const modal = document.getElementById('admin-edit-rider-modal');
    if (modal) modal.classList.add('hidden');
    editingRiderTarget = null;
}

export function generateRandomRiderId() {
    const idInput = document.getElementById('edit-rider-id-input');
    if (idInput && !idInput.disabled) {
        const randomId = Math.floor(10000000 + Math.random() * 90000000).toString();
        idInput.value = randomId;
        showToast("🎲 Random Rider ID generated!");
    } else if (idInput && idInput.disabled) {
        showToast("⚠️ Cannot generate ID for an existing account.");
    }
}

// UNIFIES LOGIN ID AND TELEGRAM ID ACROSS ALL DATABASE RECORDS
export async function submitSaveRiderAccount() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const idInput = document.getElementById('edit-rider-id-input');
    const nameInput = document.getElementById('edit-rider-name-input');
    const typeSelect = document.getElementById('edit-rider-usertype-select');

    const riderId = idInput ? idInput.value.trim() : "";
    const riderName = nameInput ? nameInput.value.trim() : "";
    const userType = typeSelect ? typeSelect.value : "rider";

    if (!riderId) return showToast("⚠️ Please enter Rider ID.");
    if (!riderName) return showToast("⚠️ Please enter Rider Name.");

    try {
        const payload = {
            telegramId: riderId,
            id: riderId,
            name: riderName,
            riderName: riderName,
            userType: userType,
            updatedAt: Date.now()
        };

        const rosterEntry = {
            telegramId: riderId,
            id: riderId,
            riderName: riderName,
            name: riderName,
            userType: userType,
            status: 'End',
            customerName: "",
            startTime: "",
            queueTime: Date.now(),
            lastActiveTimestamp: Date.now()
        };

        if (db) {
            await db.ref(`riders/${riderId}`).set(payload);
            await db.ref(`roster/${riderId}`).update(rosterEntry).catch(() => {});
        }

        if (!globalState.rosterMembers) globalState.rosterMembers = [];
        const existingIdx = globalState.rosterMembers.findIndex(m => 
            ((m.telegramId || m.id || "").toString().trim() === riderId) ||
            ((m.riderName || m.name || "").toLowerCase().trim() === riderName.toLowerCase().trim())
        );

        if (existingIdx !== -1) {
            globalState.rosterMembers[existingIdx] = { ...globalState.rosterMembers[existingIdx], ...rosterEntry };
        } else {
            globalState.rosterMembers.push(rosterEntry);
        }

        if (!globalState.userTypesMap) globalState.userTypesMap = {};
        globalState.userTypesMap[riderId] = userType;
        globalState.userTypesMap[riderName.toLowerCase()] = userType;

        saveRosterCache();
        closeAdminEditRiderModal();
        showToast(`✅ Saved rider account for ${riderName} (ID: ${riderId})`);
        renderAdminRidersList();
        updateRosterUI();
    } catch(e) {
        showToast("❌ Error saving rider account.");
    }
}