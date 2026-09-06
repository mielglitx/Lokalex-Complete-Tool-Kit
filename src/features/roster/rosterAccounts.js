// src/features/roster/rosterAccounts.js
import { db } from '../../config/firebase.js';
import { globalState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { escapeHtml } from '../../utils/helpers.js';
import { isAdmin, saveRosterCache } from './rosterUtils.js';
import { updateRosterUI } from './rosterUI.js';

let editingRiderTarget = null;
let activeTlPermissionsTarget = null;

const TL_PERMISSION_DEFINITIONS = [
    { key: 'canForceCater', label: 'Force Cater Orders', icon: 'fa-motorcycle', desc: 'Assign orders directly to riders' },
    { key: 'canForceStatus', label: 'Force Status Changes', icon: 'fa-bolt', desc: 'Change rider status (Available, Break, End)' },
    { key: 'canShiftQueue', label: 'Lineup Queue Shift', icon: 'fa-arrow-up-1-9', desc: 'Move riders up, down, top, or bottom' },
    { key: 'canVoidCustomer', label: 'Void Active Orders', icon: 'fa-ban', desc: 'Void ongoing customer assignments' },
    { key: 'canEndAllShifts', label: 'Force End All Shifts', icon: 'fa-power-off', desc: 'End shift for all roster riders at once' },
    { key: 'canManageSchedules', label: 'Time-In & Early Pass', icon: 'fa-clock', desc: 'Grant 1-day early passes to riders' },
    { key: 'canManageDayOff', label: 'Day-Off Management', icon: 'fa-umbrella-beach', desc: 'Reassign or modify rider day-off slots' }
];

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
                userType: (item.userType || item.type || "rider").toLowerCase().trim(),
                tlPermissions: item.tlPermissions || {},
                tlAdminPower: item.tlAdminPower === true || item.tlAdminPower === 'true'
            }));
        }

        (globalState.rosterMembers || []).forEach(m => {
            const mId = (m.telegramId || m.id || "").toString().trim();
            const mName = m.riderName || m.name || mId;
            const mType = (m.userType || "rider").toLowerCase().trim();
            const mPerms = m.tlPermissions || {};
            const mPower = m.tlAdminPower === true || m.tlAdminPower === 'true';

            const existing = ridersList.find(r => r.id.toString() === mId);
            if (mId && !existing) {
                ridersList.push({ id: mId, name: mName, userType: mType, tlPermissions: mPerms, tlAdminPower: mPower });
            } else if (existing) {
                if (!existing.tlPermissions || Object.keys(existing.tlPermissions).length === 0) {
                    existing.tlPermissions = mPerms;
                }
                if (existing.tlAdminPower === undefined) {
                    existing.tlAdminPower = mPower;
                }
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

            let tlPermissionsBtn = "";
            if (currentType === 'tl' && isAdmin()) {
                const permsCount = Object.values(r.tlPermissions || {}).filter(v => v === true).length;
                tlPermissionsBtn = `
                <button onclick="window.openTlPermissionsModal && window.openTlPermissionsModal('${r.id}', '${escapeHtml(r.name)}')" class="px-2.5 py-1 rounded-xl text-[10px] font-bold border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition active:scale-95 flex items-center gap-1.5 shadow-xs" title="Configure Granular TL Permissions">
                    <i class="fa-solid fa-user-shield"></i> Powers (${permsCount}/${TL_PERMISSION_DEFINITIONS.length})
                </button>`;
            }

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

                    ${tlPermissionsBtn}

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

function ensureTlPermissionsModal() {
    let modal = document.getElementById('admin-tl-permissions-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'admin-tl-permissions-modal';
        modal.className = 'hidden fixed inset-0 bg-black/85 backdrop-blur-md z-[999999] flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-cardBg border border-blue-500/50 p-5 rounded-3xl w-full max-w-sm shadow-2xl flex flex-col gap-3.5 max-h-[90vh] overflow-hidden relative animate-in fade-in zoom-in duration-200">
                <div class="flex justify-between items-center border-b border-gray-800 pb-2.5">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center text-sm font-bold border border-blue-500/30">
                            <i class="fa-solid fa-user-shield"></i>
                        </div>
                        <div>
                            <h3 class="font-bold text-xs text-white">TL Permissions Manager</h3>
                            <p id="tl-permissions-target-subtitle" class="text-[9px] text-blue-400 font-mono">Select Active Powers</p>
                        </div>
                    </div>
                    <button onclick="window.closeTlPermissionsModal && window.closeTlPermissionsModal()" class="text-gray-400 hover:text-white text-sm"><i class="fa-solid fa-xmark"></i></button>
                </div>

                <div class="flex items-center justify-between gap-2 px-1">
                    <span class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Granular Privileges</span>
                    <div class="flex items-center gap-2">
                        <button type="button" onclick="window.toggleAllTlPermissions && window.toggleAllTlPermissions(true)" class="text-[9px] text-emerald-400 font-bold hover:underline">Enable All</button>
                        <span class="text-gray-600 text-[10px]">|</span>
                        <button type="button" onclick="window.toggleAllTlPermissions && window.toggleAllTlPermissions(false)" class="text-[9px] text-red-400 font-bold hover:underline">Revoke All</button>
                    </div>
                </div>

                <div id="tl-permissions-list-container" class="flex flex-col gap-2 overflow-y-auto flex-1 pr-1 min-h-0">
                    <div class="text-center text-gray-500 italic py-6 text-xs">Loading permissions...</div>
                </div>

                <div class="pt-2 border-t border-gray-800">
                    <button type="button" onclick="window.closeTlPermissionsModal && window.closeTlPermissionsModal()" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold py-2.5 rounded-xl text-xs transition active:scale-95">
                        Done
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    return modal;
}

export async function openTlPermissionsModal(riderId, riderName = "") {
    if (!isAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin accounts can modify TL permissions.");
    }

    activeTlPermissionsTarget = { id: riderId.toString().trim(), name: riderName };
    const modal = ensureTlPermissionsModal();

    const subtitle = document.getElementById('tl-permissions-target-subtitle');
    if (subtitle) {
        subtitle.innerText = `${riderName || 'Team Lead'} (ID: ${riderId})`;
    }

    renderTlPermissionsModalContent();
    modal.classList.remove('hidden');
}

export function closeTlPermissionsModal() {
    const modal = document.getElementById('admin-tl-permissions-modal');
    if (modal) modal.classList.add('hidden');
    activeTlPermissionsTarget = null;
}

export async function renderTlPermissionsModalContent() {
    const container = document.getElementById('tl-permissions-list-container');
    if (!container || !activeTlPermissionsTarget) return;

    const riderId = activeTlPermissionsTarget.id;

    let currentPerms = {};
    if (db) {
        try {
            const snap = await db.ref(`riders/${riderId}/tlPermissions`).once('value');
            if (snap.exists()) {
                currentPerms = snap.val() || {};
            }
        } catch(e) {}
    }

    if (Object.keys(currentPerms).length === 0) {
        const rosterMem = (globalState.rosterMembers || []).find(m => (m.telegramId || m.id || "").toString().trim() === riderId);
        if (rosterMem && rosterMem.tlPermissions) {
            currentPerms = { ...rosterMem.tlPermissions };
        }
    }

    container.innerHTML = TL_PERMISSION_DEFINITIONS.map(def => {
        const isGranted = currentPerms[def.key] === true;

        return `
        <label class="bg-black/40 border border-gray-800 hover:border-gray-700 p-2.5 rounded-2xl flex items-center justify-between gap-3 cursor-pointer select-none transition">
            <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-7 h-7 rounded-xl ${isGranted ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-gray-800 text-gray-500 border border-gray-700'} flex items-center justify-center text-xs shrink-0">
                    <i class="fa-solid ${def.icon}"></i>
                </div>
                <div class="flex flex-col min-w-0">
                    <span class="font-bold text-xs ${isGranted ? 'text-white' : 'text-gray-400'} truncate">${escapeHtml(def.label)}</span>
                    <span class="text-[9.5px] text-gray-500 leading-tight">${escapeHtml(def.desc)}</span>
                </div>
            </div>

            <input type="checkbox" ${isGranted ? 'checked' : ''} onchange="window.toggleTlIndividualPermission && window.toggleTlIndividualPermission('${escapeHtml(riderId)}', '${def.key}', this.checked)" class="w-4 h-4 accent-emerald-500 cursor-pointer shrink-0">
        </label>`;
    }).join('');
}

export async function toggleTlIndividualPermission(riderId, permissionKey, granted) {
    if (!isAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin accounts can modify TL permissions.");
    }

    if (!riderId || !permissionKey) return;

    try {
        if (db) {
            await db.ref(`riders/${riderId}/tlPermissions/${permissionKey}`).set(granted);
            await db.ref(`roster/${riderId}/tlPermissions/${permissionKey}`).set(granted).catch(() => {});
        }

        const rosterMembers = globalState.rosterMembers || [];
        const member = rosterMembers.find(m => (m.telegramId || m.id || "").toString().trim() === riderId.toString().trim());
        if (member) {
            if (!member.tlPermissions) member.tlPermissions = {};
            member.tlPermissions[permissionKey] = granted;
        }

        let cached = {};
        const savedCache = localStorage.getItem(`tl_permissions_${riderId}`);
        if (savedCache) {
            try { cached = JSON.parse(savedCache) || {}; } catch(e) {}
        }
        cached[permissionKey] = granted;
        localStorage.setItem(`tl_permissions_${riderId}`, JSON.stringify(cached));

        saveRosterCache();
        renderAdminRidersList();
        renderTlPermissionsModalContent();
        updateRosterUI();
        window.dispatchEvent(new CustomEvent('rosterUpdated'));

        const permDef = TL_PERMISSION_DEFINITIONS.find(d => d.key === permissionKey);
        showToast(`⚙️ ${permDef ? permDef.label : permissionKey}: ${granted ? 'GRANTED' : 'REVOKED'}`);
    } catch(err) {
        console.error("Toggle TL individual permission error:", err);
        showToast("❌ Failed to update TL permission.");
    }
}

export async function toggleAllTlPermissions(grantAll) {
    if (!isAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin accounts can modify TL permissions.");
    }

    if (!activeTlPermissionsTarget || !activeTlPermissionsTarget.id) return;
    const riderId = activeTlPermissionsTarget.id;

    const updatedPermissions = {};
    TL_PERMISSION_DEFINITIONS.forEach(def => {
        updatedPermissions[def.key] = !!grantAll;
    });

    try {
        if (db) {
            await db.ref(`riders/${riderId}/tlPermissions`).set(updatedPermissions);
            await db.ref(`roster/${riderId}/tlPermissions`).set(updatedPermissions).catch(() => {});
            await db.ref(`riders/${riderId}/tlAdminPower`).set(!!grantAll).catch(() => {});
            await db.ref(`roster/${riderId}/tlAdminPower`).set(!!grantAll).catch(() => {});
        }

        const rosterMembers = globalState.rosterMembers || [];
        const member = rosterMembers.find(m => (m.telegramId || m.id || "").toString().trim() === riderId);
        if (member) {
            member.tlPermissions = updatedPermissions;
            member.tlAdminPower = !!grantAll;
        }

        localStorage.setItem(`tl_permissions_${riderId}`, JSON.stringify(updatedPermissions));
        localStorage.setItem(`tl_admin_power_${riderId}`, String(!!grantAll));

        saveRosterCache();
        renderAdminRidersList();
        renderTlPermissionsModalContent();
        updateRosterUI();
        window.dispatchEvent(new CustomEvent('rosterUpdated'));

        showToast(`✅ All TL permissions ${grantAll ? 'GRANTED' : 'REVOKED'} for ${activeTlPermissionsTarget.name || riderId}`);
    } catch(err) {
        console.error("Toggle all TL permissions error:", err);
        showToast("❌ Failed to update all permissions.");
    }
}

export async function toggleTlAdminPower(riderId, currentPowerState) {
    if (!isAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin accounts can modify TL permissions.");
    }

    if (!riderId) return showToast("⚠️ Invalid rider ID.");

    const newPowerState = !currentPowerState;
    const allPerms = {};
    TL_PERMISSION_DEFINITIONS.forEach(def => {
        allPerms[def.key] = newPowerState;
    });

    try {
        if (db) {
            await db.ref(`riders/${riderId}/tlAdminPower`).set(newPowerState);
            await db.ref(`riders/${riderId}/tlPermissions`).set(allPerms);
            await db.ref(`roster/${riderId}/tlAdminPower`).set(newPowerState).catch(() => {});
            await db.ref(`roster/${riderId}/tlPermissions`).set(allPerms).catch(() => {});
        }

        if (globalState.rosterMembers) {
            const targetMember = globalState.rosterMembers.find(m => (m.telegramId || m.id || "").toString().trim() === riderId.toString().trim());
            if (targetMember) {
                targetMember.tlAdminPower = newPowerState;
                targetMember.tlPermissions = allPerms;
            }
        }

        localStorage.setItem(`tl_admin_power_${riderId}`, String(newPowerState));
        localStorage.setItem(`tl_permissions_${riderId}`, JSON.stringify(allPerms));
        saveRosterCache();

        showToast(`✅ TL Admin Power ${newPowerState ? 'ENABLED' : 'DISABLED'} for ID [${riderId}]`);
        renderAdminRidersList();
        updateRosterUI();
        window.dispatchEvent(new CustomEvent('rosterUpdated'));
    } catch(err) {
        console.error("Toggle TL Admin Power error:", err);
        showToast("❌ Failed to update TL admin power.");
    }
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
                existingData = { 
                    riderName: rMem.riderName || rMem.name, 
                    userType: rMem.userType,
                    tlAdminPower: rMem.tlAdminPower,
                    tlPermissions: rMem.tlPermissions
                };
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
        let existingPower = false;
        let existingPerms = {};

        if (db) {
            const snap = await db.ref(`riders/${riderId}`).once('value');
            if (snap.exists()) {
                const data = snap.val() || {};
                existingPower = data.tlAdminPower === true || data.tlAdminPower === 'true';
                existingPerms = data.tlPermissions || {};
            }
        }

        const payload = {
            telegramId: riderId,
            id: riderId,
            name: riderName,
            riderName: riderName,
            userType: userType,
            tlAdminPower: userType === 'tl' ? existingPower : false,
            tlPermissions: userType === 'tl' ? existingPerms : null,
            updatedAt: Date.now()
        };

        const rosterEntry = {
            telegramId: riderId,
            id: riderId,
            riderName: riderName,
            name: riderName,
            userType: userType,
            tlAdminPower: userType === 'tl' ? existingPower : false,
            tlPermissions: userType === 'tl' ? existingPerms : null,
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

if (typeof window !== 'undefined') {
    window.openAdminManageRidersModal = openAdminManageRidersModal;
    window.closeAdminManageRidersModal = closeAdminManageRidersModal;
    window.renderAdminRidersList = renderAdminRidersList;
    window.promptDeleteRiderAccount = promptDeleteRiderAccount;
    window.executeDeleteRiderAccount = executeDeleteRiderAccount;
    window.quickChangeRiderUserType = quickChangeRiderUserType;
    window.openAddRiderModal = openAddRiderModal;
    window.openEditRiderModal = openEditRiderModal;
    window.closeAdminEditRiderModal = closeAdminEditRiderModal;
    window.generateRandomRiderId = generateRandomRiderId;
    window.submitSaveRiderAccount = submitSaveRiderAccount;
    window.toggleTlAdminPower = toggleTlAdminPower;

    window.openTlPermissionsModal = openTlPermissionsModal;
    window.closeTlPermissionsModal = closeTlPermissionsModal;
    window.toggleTlIndividualPermission = toggleTlIndividualPermission;
    window.toggleAllTlPermissions = toggleAllTlPermissions;
}