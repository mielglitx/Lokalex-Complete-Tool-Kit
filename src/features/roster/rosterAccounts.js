// src/features/roster/rosterAccounts.js

/**
 * ============================================================================
 * RIDER ACCOUNTS, ROLE PERMISSION & APP SECTION ACCESS MANAGEMENT
 * ============================================================================
 * 
 * Controls account provisioning, role transitions (Admin, TL, Rider), Team Lead
 * granular privilege matrices, account deletion, and modular app access rules.
 * 
 * Update Note:
 * - Added modular App Access controls: admins can dictate which sections of the
 *   app (Smart Cart, Map Calc, Commission, Adv. Orders, Live GPS, Directory, GCash)
 *   each individual rider is permitted to access.
 * - Synchronizes `allowedFeatures` across `riders/`, `roster/`, and active sessions.
 * ============================================================================
 */

import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { escapeHtml } from '../../utils/helpers.js';
import { isAdmin, saveRosterCache } from './rosterUtils.js';
import { updateRosterUI } from './rosterUI.js';

let editingRiderTarget = null;
let activeTlPermissionsTarget = null;
let activeAppAccessTarget = null;

export const TL_PERMISSION_DEFINITIONS = [
    { key: 'canForceCater', label: 'Force Cater Orders', icon: 'fa-motorcycle', desc: 'Assign orders directly to riders' },
    { key: 'canForceStatus', label: 'Force Status Changes', icon: 'fa-bolt', desc: 'Change rider status (Available, Break, End)' },
    { key: 'canShiftQueue', label: 'Lineup Queue Shift', icon: 'fa-arrow-up-1-9', desc: 'Move riders up, down, top, or bottom' },
    { key: 'canVoidCustomer', label: 'Void Active Orders', icon: 'fa-ban', desc: 'Void ongoing customer assignments' },
    { key: 'canEndAllShifts', label: 'Force End All Shifts', icon: 'fa-power-off', desc: 'End shift for all roster riders at once' },
    { key: 'canManageSchedules', label: 'Time-In & Early Pass', icon: 'fa-clock', desc: 'Grant 1-day early passes to riders' },
    { key: 'canManageDayOff', label: 'Day-Off Management', icon: 'fa-umbrella-beach', desc: 'Reassign or modify rider day-off slots' }
];

export const APP_FEATURE_DEFINITIONS = [
    { key: 'cart', label: 'Smart Cart & Receipts', icon: 'fa-receipt', color: 'emerald', desc: 'Create orders, build items & issue receipts' },
    { key: 'mapcalc', label: 'Map Calc & Fare Estimation', icon: 'fa-calculator', color: 'blue', desc: 'Calculate road distance and delivery fees' },
    { key: 'commission', label: 'Daily Commission View', icon: 'fa-wallet', color: 'amber', desc: 'View gross income, earnings & deductions' },
    { key: 'advOrders', label: 'Advanced Orders Hub', icon: 'fa-calendar-check', color: 'purple', desc: 'View and accept advance scheduled bookings' },
    { key: 'livegps', label: 'Mutual Live GPS Tracker', icon: 'fa-satellite-dish', color: 'indigo', desc: 'Share real-time GPS tracking with customer' },
    { key: 'directory', label: 'Directories (Rates/Stores)', icon: 'fa-map-location-dot', color: 'teal', desc: 'Access customer, store and barangay rates' },
    { key: 'gcash', label: 'GCash Payment QR/Details', icon: 'fa-mobile-screen-button', color: 'blue', desc: 'Show payment numbers & QR code modal' }
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
            ridersList = Object.entries(val).map(([id, item]) => {
                const cleanId = (item.telegramId || item.id || id).toString().trim();
                
                let resolvedName = (item.riderName || item.name || item.displayName || "").trim();

                if (!resolvedName) {
                    const matchedRoster = (globalState.rosterMembers || []).find(m => 
                        (m.telegramId || m.id || "").toString().trim() === cleanId
                    );
                    if (matchedRoster) {
                        resolvedName = (matchedRoster.riderName || matchedRoster.name || "").trim();
                    }
                }

                if (!resolvedName && globalState.globalCateredHistory) {
                    const historyMatch = globalState.globalCateredHistory.find(h => 
                        (h.telegramId || h.riderId || "").toString().trim() === cleanId
                    );
                    if (historyMatch && historyMatch.riderName) {
                        resolvedName = historyMatch.riderName.trim();
                    }
                }

                return {
                    id: cleanId,
                    name: resolvedName || `Rider #${cleanId}`,
                    userType: (item.userType || item.type || "rider").toLowerCase().trim(),
                    tlPermissions: item.tlPermissions || {},
                    tlAdminPower: item.tlAdminPower === true || item.tlAdminPower === 'true',
                    allowedFeatures: item.allowedFeatures || item.allowedViews || null
                };
            });
        }

        (globalState.rosterMembers || []).forEach(m => {
            const mId = (m.telegramId || m.id || "").toString().trim();
            const mName = (m.riderName || m.name || "").trim();
            const mType = (m.userType || "rider").toLowerCase().trim();
            const mPerms = m.tlPermissions || {};
            const mPower = m.tlAdminPower === true || m.tlAdminPower === 'true';
            const mFeatures = m.allowedFeatures || m.allowedViews || null;

            const existing = ridersList.find(r => r.id.toString() === mId);
            if (mId && !existing) {
                ridersList.push({ 
                    id: mId, 
                    name: mName || `Rider #${mId}`, 
                    userType: mType, 
                    tlPermissions: mPerms, 
                    tlAdminPower: mPower,
                    allowedFeatures: mFeatures
                });
            } else if (existing) {
                if ((!existing.name || existing.name.startsWith("Rider #") || existing.name === existing.id) && mName) {
                    existing.name = mName;
                }
                if (!existing.tlPermissions || Object.keys(existing.tlPermissions).length === 0) {
                    existing.tlPermissions = mPerms;
                }
                if (existing.tlAdminPower === undefined) {
                    existing.tlAdminPower = mPower;
                }
                if (!existing.allowedFeatures && mFeatures) {
                    existing.allowedFeatures = mFeatures;
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
                <button onclick="window.openTlPermissionsModal && window.openTlPermissionsModal('${r.id}', '${escapeHtml(r.name)}')" class="px-2.5 py-1 rounded-xl text-[10px] font-bold border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition active:scale-95 flex items-center gap-1.5 shadow-xs shrink-0" title="Configure Granular TL Permissions">
                    <i class="fa-solid fa-user-shield"></i> Powers (${permsCount}/${TL_PERMISSION_DEFINITIONS.length})
                </button>`;
            }

            let appAccessBtn = "";
            if (currentType !== 'admin') {
                const allowedCount = APP_FEATURE_DEFINITIONS.filter(def => r.allowedFeatures ? r.allowedFeatures[def.key] !== false : true).length;
                appAccessBtn = `
                <button onclick="window.openRiderAppAccessModal && window.openRiderAppAccessModal('${r.id}', '${escapeHtml(r.name)}')" class="px-2.5 py-1 rounded-xl text-[10px] font-bold border border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 transition active:scale-95 flex items-center gap-1.5 shadow-xs shrink-0" title="Control app sections accessible to this rider">
                    <i class="fa-solid fa-cubes"></i> Access (${allowedCount}/${APP_FEATURE_DEFINITIONS.length})
                </button>`;
            }

            return `
            <div class="bg-black/40 border border-gray-800/90 p-3 rounded-2xl flex flex-col gap-2 shadow-xs text-xs">
                <!-- TOP ROW: FULL RIDER NAME & ACTION CONTROLS -->
                <div class="flex items-center justify-between gap-2 border-b border-gray-800/60 pb-2">
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                        <div class="w-7 h-7 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center text-xs shrink-0 border border-blue-500/20">
                            <i class="fa-solid fa-id-badge"></i>
                        </div>
                        <div class="flex flex-col min-w-0">
                            <span class="font-black text-white text-xs truncate">
                                ${escapeHtml(r.name)}
                            </span>
                            <span class="text-[10px] text-gray-400 font-mono">ID: ${escapeHtml(r.id)}</span>
                        </div>
                    </div>

                    <div class="flex items-center gap-1 shrink-0">
                        <button onclick="window.openEditRiderModal && window.openEditRiderModal('${r.id}')" class="bg-gray-800 hover:bg-gray-700 text-blue-400 w-7 h-7 rounded-lg text-xs transition active:scale-90 flex items-center justify-center cursor-pointer" title="Edit Rider Details">
                            <i class="fa-solid fa-pen text-[11px]"></i>
                        </button>
                        <button onclick="window.promptDeleteRiderAccount && window.promptDeleteRiderAccount('${r.id}', '${escapeHtml(r.name)}')" class="bg-gray-800 hover:bg-gray-700 text-red-400 w-7 h-7 rounded-lg text-xs transition active:scale-90 flex items-center justify-center cursor-pointer" title="Delete Rider Account">
                            <i class="fa-solid fa-trash text-[11px]"></i>
                        </button>
                    </div>
                </div>

                <!-- BOTTOM ROW: ROLE SELECTOR, BADGE & PERMISSION BUTTONS -->
                <div class="flex items-center justify-between gap-2 flex-wrap pt-0.5">
                    <div class="flex items-center gap-1.5">
                        <select onchange="window.quickChangeRiderUserType && window.quickChangeRiderUserType('${r.id}', this.value)" class="bg-gray-900 text-[10px] font-bold border border-gray-700 rounded-lg px-2 py-1 text-gray-200 cursor-pointer outline-none">
                            <option value="rider" ${currentType === 'rider' ? 'selected' : ''}>Rider</option>
                            <option value="tl" ${currentType === 'tl' ? 'selected' : ''}>TL</option>
                            <option value="admin" ${currentType === 'admin' ? 'selected' : ''}>Admin</option>
                        </select>

                        <span class="text-[9.5px] font-bold uppercase px-2 py-0.5 rounded-lg border ${typeBadgeClass}">
                            ${escapeHtml(currentType)}
                        </span>
                    </div>

                    <div class="flex items-center gap-1.5 flex-wrap">
                        ${tlPermissionsBtn}
                        ${appAccessBtn}
                    </div>
                </div>
            </div>`;
        }).join('');
    });
}

function ensureRiderAppAccessModal() {
    let modal = document.getElementById('admin-rider-app-access-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'admin-rider-app-access-modal';
        modal.className = 'hidden fixed inset-0 bg-black/85 backdrop-blur-md z-[999999] flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-cardBg border border-purple-500/50 p-5 rounded-3xl w-full max-w-sm shadow-2xl flex flex-col gap-3.5 max-h-[90vh] overflow-hidden relative animate-in fade-in zoom-in duration-200">
                <div class="flex justify-between items-center border-b border-gray-800 pb-2.5">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center text-sm font-bold border border-purple-500/30">
                            <i class="fa-solid fa-cubes"></i>
                        </div>
                        <div>
                            <h3 class="font-bold text-xs text-white">Rider App Access Controls</h3>
                            <p id="rider-app-access-target-subtitle" class="text-[9px] text-purple-400 font-mono">Select Authorized App Sections</p>
                        </div>
                    </div>
                    <button onclick="window.closeRiderAppAccessModal && window.closeRiderAppAccessModal()" class="text-gray-400 hover:text-white text-sm cursor-pointer"><i class="fa-solid fa-xmark"></i></button>
                </div>

                <div class="flex items-center justify-between gap-2 px-1">
                    <span class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Permitted Features</span>
                    <div class="flex items-center gap-2">
                        <button type="button" onclick="window.toggleAllRiderFeatures && window.toggleAllRiderFeatures(true)" class="text-[9px] text-emerald-400 font-bold hover:underline cursor-pointer">Allow All</button>
                        <span class="text-gray-600 text-[10px]">|</span>
                        <button type="button" onclick="window.toggleAllRiderFeatures && window.toggleAllRiderFeatures(false)" class="text-[9px] text-red-400 font-bold hover:underline cursor-pointer">Restrict All</button>
                    </div>
                </div>

                <div id="rider-app-access-list-container" class="flex flex-col gap-2 overflow-y-auto flex-1 pr-1 min-h-0">
                    <div class="text-center text-gray-500 italic py-6 text-xs">Loading feature list...</div>
                </div>

                <div class="pt-2 border-t border-gray-800">
                    <button type="button" onclick="window.closeRiderAppAccessModal && window.closeRiderAppAccessModal()" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold py-2.5 rounded-xl text-xs transition active:scale-95 cursor-pointer">
                        Done
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    return modal;
}

export async function openRiderAppAccessModal(riderId, riderName = "") {
    if (!isAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin accounts can modify rider app access.");
    }

    activeAppAccessTarget = { id: riderId.toString().trim(), name: riderName };
    const modal = ensureRiderAppAccessModal();

    const subtitle = document.getElementById('rider-app-access-target-subtitle');
    if (subtitle) {
        subtitle.innerText = `${riderName || 'Rider'} (ID: ${riderId})`;
    }

    renderRiderAppAccessModalContent();
    modal.classList.remove('hidden');
}

export function closeRiderAppAccessModal() {
    const modal = document.getElementById('admin-rider-app-access-modal');
    if (modal) modal.classList.add('hidden');
    activeAppAccessTarget = null;
}

export async function renderRiderAppAccessModalContent() {
    const container = document.getElementById('rider-app-access-list-container');
    if (!container || !activeAppAccessTarget) return;

    const riderId = activeAppAccessTarget.id;

    let currentFeatures = {};
    if (db) {
        try {
            const snap = await db.ref(`riders/${riderId}/allowedFeatures`).once('value');
            if (snap.exists()) {
                currentFeatures = snap.val() || {};
            }
        } catch(e) {}
    }

    if (Object.keys(currentFeatures).length === 0) {
        const rosterMem = (globalState.rosterMembers || []).find(m => (m.telegramId || m.id || "").toString().trim() === riderId);
        if (rosterMem && rosterMem.allowedFeatures) {
            currentFeatures = { ...rosterMem.allowedFeatures };
        }
    }

    container.innerHTML = APP_FEATURE_DEFINITIONS.map(def => {
        // Missing keys default to true (unrestricted by default until toggled)
        const isAllowed = currentFeatures[def.key] !== false;

        return `
        <label class="bg-black/40 border border-gray-800 hover:border-gray-700 p-2.5 rounded-2xl flex items-center justify-between gap-3 cursor-pointer select-none transition">
            <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-7 h-7 rounded-xl ${isAllowed ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'bg-gray-800 text-gray-500 border border-gray-700'} flex items-center justify-center text-xs shrink-0">
                    <i class="fa-solid ${def.icon}"></i>
                </div>
                <div class="flex flex-col min-w-0">
                    <span class="font-bold text-xs ${isAllowed ? 'text-white' : 'text-gray-400'} truncate">${escapeHtml(def.label)}</span>
                    <span class="text-[9.5px] text-gray-500 leading-tight">${escapeHtml(def.desc)}</span>
                </div>
            </div>

            <input type="checkbox" ${isAllowed ? 'checked' : ''} onchange="window.toggleRiderFeatureAccess && window.toggleRiderFeatureAccess('${escapeHtml(riderId)}', '${def.key}', this.checked)" class="w-4 h-4 accent-purple-500 cursor-pointer shrink-0">
        </label>`;
    }).join('');
}

export async function toggleRiderFeatureAccess(riderId, featureKey, isAllowed) {
    if (!isAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin accounts can modify rider app access.");
    }

    if (!riderId || !featureKey) return;

    try {
        let currentFeatures = {};
        if (db) {
            const snap = await db.ref(`riders/${riderId}/allowedFeatures`).once('value');
            if (snap.exists()) currentFeatures = snap.val() || {};
        }

        APP_FEATURE_DEFINITIONS.forEach(d => {
            if (currentFeatures[d.key] === undefined) currentFeatures[d.key] = true;
        });

        currentFeatures[featureKey] = !!isAllowed;

        if (db) {
            await db.ref(`riders/${riderId}/allowedFeatures`).set(currentFeatures);
            await db.ref(`roster/${riderId}/allowedFeatures`).set(currentFeatures).catch(() => {});
        }

        const rosterMembers = globalState.rosterMembers || [];
        const member = rosterMembers.find(m => (m.telegramId || m.id || "").toString().trim() === riderId.toString().trim());
        if (member) {
            member.allowedFeatures = currentFeatures;
        }

        const currentRiderId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
        if (currentRiderId === riderId.toString().trim()) {
            localStorage.setItem('lokalex_allowed_features', JSON.stringify(currentFeatures));
            if (window.syncRiderAppDockPermissions) {
                window.syncRiderAppDockPermissions();
            }
        }

        saveRosterCache();
        renderAdminRidersList();
        renderRiderAppAccessModalContent();
        updateRosterUI();
        window.dispatchEvent(new CustomEvent('rosterUpdated'));

        const featureDef = APP_FEATURE_DEFINITIONS.find(d => d.key === featureKey);
        showToast(`📱 ${featureDef ? featureDef.label : featureKey}: ${isAllowed ? 'ALLOWED' : 'RESTRICTED'}`);
    } catch(err) {
        console.error("toggleRiderFeatureAccess error:", err);
        showToast("❌ Failed to update rider feature access.");
    }
}

export async function toggleAllRiderFeatures(grantAll) {
    if (!isAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin accounts can modify rider app access.");
    }

    if (!activeAppAccessTarget || !activeAppAccessTarget.id) return;
    const riderId = activeAppAccessTarget.id;

    const newFeatures = {};
    APP_FEATURE_DEFINITIONS.forEach(def => {
        newFeatures[def.key] = !!grantAll;
    });

    try {
        if (db) {
            await db.ref(`riders/${riderId}/allowedFeatures`).set(newFeatures);
            await db.ref(`roster/${riderId}/allowedFeatures`).set(newFeatures).catch(() => {});
        }

        const rosterMembers = globalState.rosterMembers || [];
        const member = rosterMembers.find(m => (m.telegramId || m.id || "").toString().trim() === riderId);
        if (member) {
            member.allowedFeatures = newFeatures;
        }

        const currentRiderId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
        if (currentRiderId === riderId) {
            localStorage.setItem('lokalex_allowed_features', JSON.stringify(newFeatures));
            if (window.syncRiderAppDockPermissions) {
                window.syncRiderAppDockPermissions();
            }
        }

        saveRosterCache();
        renderAdminRidersList();
        renderRiderAppAccessModalContent();
        updateRosterUI();
        window.dispatchEvent(new CustomEvent('rosterUpdated'));

        showToast(`✅ All features ${grantAll ? 'ALLOWED' : 'RESTRICTED'} for ${activeAppAccessTarget.name || riderId}`);
    } catch(err) {
        console.error("toggleAllRiderFeatures error:", err);
        showToast("❌ Failed to update all permissions.");
    }
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
                    <button onclick="window.closeTlPermissionsModal && window.closeTlPermissionsModal()" class="text-gray-400 hover:text-white text-sm cursor-pointer"><i class="fa-solid fa-xmark"></i></button>
                </div>

                <div class="flex items-center justify-between gap-2 px-1">
                    <span class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Granular Privileges</span>
                    <div class="flex items-center gap-2">
                        <button type="button" onclick="window.toggleAllTlPermissions && window.toggleAllTlPermissions(true)" class="text-[9px] text-emerald-400 font-bold hover:underline cursor-pointer">Enable All</button>
                        <span class="text-gray-600 text-[10px]">|</span>
                        <button type="button" onclick="window.toggleAllTlPermissions && window.toggleAllTlPermissions(false)" class="text-[9px] text-red-400 font-bold hover:underline cursor-pointer">Revoke All</button>
                    </div>
                </div>

                <div id="tl-permissions-list-container" class="flex flex-col gap-2 overflow-y-auto flex-1 pr-1 min-h-0">
                    <div class="text-center text-gray-500 italic py-6 text-xs">Loading permissions...</div>
                </div>

                <div class="pt-2 border-t border-gray-800">
                    <button type="button" onclick="window.closeTlPermissionsModal && window.closeTlPermissionsModal()" class="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold py-2.5 rounded-xl text-xs transition active:scale-95 cursor-pointer">
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
            await db.ref(`settings/userTypes/${riderId}`).remove().catch(() => {});
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
    const cleanType = newUserType.toLowerCase().trim();

    try {
        const rosterMembers = globalState.rosterMembers || [];
        const existingMem = rosterMembers.find(m => (m.telegramId || m.id || "").toString().trim() === riderId.toString().trim());
        const riderName = existingMem ? (existingMem.riderName || existingMem.name || "").trim() : "";

        if (db) {
            await db.ref(`riders/${riderId}`).update({
                userType: cleanType,
                updatedAt: Date.now()
            });

            await db.ref(`roster/${riderId}`).update({
                telegramId: riderId,
                id: riderId,
                userType: cleanType
            }).catch(() => {});

            await db.ref(`settings/userTypes/${riderId}`).set(cleanType).catch(() => {});
            if (riderName) {
                await db.ref(`settings/userTypes/${riderName.toLowerCase()}`).set(cleanType).catch(() => {});
            }
        }

        if (existingMem) {
            existingMem.userType = cleanType;
            if (cleanType === 'rider') {
                existingMem.tlAdminPower = false;
                existingMem.tlPermissions = {};
            }
        }

        if (!globalState.userTypesMap) globalState.userTypesMap = {};
        globalState.userTypesMap[riderId] = cleanType;
        if (riderName) {
            globalState.userTypesMap[riderName.toLowerCase()] = cleanType;
        }

        saveRosterCache();
        showToast(`✅ Account type for ID [${riderId}] updated to ${cleanType.toUpperCase()}`);
        renderAdminRidersList();
        updateRosterUI();
        window.dispatchEvent(new CustomEvent('rosterUpdated'));
    } catch(e) {
        console.error("quickChangeRiderUserType error:", e);
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
                    tlPermissions: rMem.tlPermissions,
                    allowedFeatures: rMem.allowedFeatures
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

export async function submitSaveRiderAccount() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const idInput = document.getElementById('edit-rider-id-input');
    const nameInput = document.getElementById('edit-rider-name-input');
    const typeSelect = document.getElementById('edit-rider-usertype-select');

    const riderId = idInput ? idInput.value.trim() : "";
    const riderName = nameInput ? nameInput.value.trim() : "";
    const userType = typeSelect ? typeSelect.value.toLowerCase().trim() : "rider";

    if (!riderId) return showToast("⚠️ Please enter Rider ID.");
    if (!riderName) return showToast("⚠️ Please enter Rider Name.");

    try {
        let existingPower = false;
        let existingPerms = {};
        let existingAllowed = null;

        if (db) {
            const snap = await db.ref(`riders/${riderId}`).once('value');
            if (snap.exists()) {
                const data = snap.val() || {};
                existingPower = data.tlAdminPower === true || data.tlAdminPower === 'true';
                existingPerms = data.tlPermissions || {};
                existingAllowed = data.allowedFeatures || null;
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
            allowedFeatures: userType === 'admin' ? null : existingAllowed,
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
            allowedFeatures: userType === 'admin' ? null : existingAllowed,
            lastActiveTimestamp: Date.now()
        };

        if (db) {
            await db.ref(`riders/${riderId}`).set(payload);
            await db.ref(`roster/${riderId}`).update(rosterEntry).catch(() => {});
            await db.ref(`settings/userTypes/${riderId}`).set(userType).catch(() => {});
            await db.ref(`settings/userTypes/${riderName.toLowerCase()}`).set(userType).catch(() => {});
        }

        if (!globalState.rosterMembers) globalState.rosterMembers = [];
        const existingIdx = globalState.rosterMembers.findIndex(m => 
            ((m.telegramId || m.id || "").toString().trim() === riderId) ||
            ((m.riderName || m.name || "").toLowerCase().trim() === riderName.toLowerCase().trim())
        );

        if (existingIdx !== -1) {
            globalState.rosterMembers[existingIdx] = { ...globalState.rosterMembers[existingIdx], ...rosterEntry };
        } else {
            globalState.rosterMembers.push({
                ...rosterEntry,
                status: 'End',
                customerName: "",
                startTime: "",
                queueTime: Date.now()
            });
        }

        if (!globalState.userTypesMap) globalState.userTypesMap = {};
        globalState.userTypesMap[riderId] = userType;
        globalState.userTypesMap[riderName.toLowerCase()] = userType;

        saveRosterCache();
        closeAdminEditRiderModal();
        showToast(`✅ Saved rider account for ${riderName} (${userType.toUpperCase()})`);
        renderAdminRidersList();
        updateRosterUI();
        window.dispatchEvent(new CustomEvent('rosterUpdated'));
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

    window.openRiderAppAccessModal = openRiderAppAccessModal;
    window.closeRiderAppAccessModal = closeRiderAppAccessModal;
    window.toggleRiderFeatureAccess = toggleRiderFeatureAccess;
    window.toggleAllRiderFeatures = toggleAllRiderFeatures;
}
// REMARKS: ROSTER_ACCOUNTS_APP_ACCESS_MATRIX_MANAGEMENT_V1_COMPLETE