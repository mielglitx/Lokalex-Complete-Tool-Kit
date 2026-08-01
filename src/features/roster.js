// src/features/roster.js
import { appState, globalState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { showToast } from '../ui/notifications.js';
import { openSlideDeleteModal } from '../ui/modals.js';
import { escapeHtml, isSameDate } from '../utils/helpers.js';

let isAdminControlsActive = false;

export function listenToRoster() {
    db.ref('roster').on('value', snapshot => {
        const data = snapshot.val() || {};
        const membersMap = {};

        // DE-DUPLICATION LOGIC: Always keep only ONE (the latest) record per rider
        for (let key in data) {
            const member = data[key];
            member.fireKey = key;
            const id = (member.telegramId || "").toString().trim() || (member.name || "").toString().trim().toLowerCase() || key;

            if (!membersMap[id] || (member.timestamp || 0) > (membersMap[id].timestamp || 0)) {
                membersMap[id] = member;
            }
        }

        const members = Object.values(membersMap);
        globalState.rosterMembers = members;
        renderLiveRoster(members);
        checkAdminControlVisibility();
    });
}

function checkAdminControlVisibility() {
    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ["4547425", "5548562"].includes(appState.telegramId);
    const toggleWrapper = document.getElementById('admin-toggle-wrapper');
    const forceAllBtn = document.getElementById('admin-force-all-btn');

    if (isAdmin) {
        if (toggleWrapper) toggleWrapper.classList.remove('hidden');
        if (forceAllBtn) forceAllBtn.classList.remove('hidden');
    } else {
        if (toggleWrapper) toggleWrapper.classList.add('hidden');
        if (forceAllBtn) forceAllBtn.classList.add('hidden');
    }
}

export function toggleAdminControls(isActive) {
    isAdminControlsActive = isActive;
    renderLiveRoster(globalState.rosterMembers || []);
}

export function renderLiveRoster(members) {
    const availContainer = document.getElementById('home-roster-avail');
    const busyContainer = document.getElementById('home-roster-busy');
    const breakContainer = document.getElementById('home-roster-break');
    const cooldownContainer = document.getElementById('home-roster-cooldown');

    if (!availContainer || !busyContainer) return;

    const availableRiders = members
        .filter(m => (m.status || "").toLowerCase() === 'available')
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const busyRiders = members.filter(m => (m.status || "").toLowerCase() === 'catering');
    const breakRiders = members.filter(m => (m.status || "").toLowerCase() === 'break');
    const cooldownRiders = members.filter(m => (m.status || "").toLowerCase() === 'penalty');

    const myId = (appState.telegramId || "").toString().trim();
    if (availableRiders.length > 0 && availableRiders[0].telegramId && availableRiders[0].telegramId.toString().trim() === myId) {
        const borderEl = document.getElementById('golden-first-line-border');
        if (borderEl) borderEl.classList.remove('hidden');
    } else {
        const borderEl = document.getElementById('golden-first-line-border');
        if (borderEl) borderEl.classList.add('hidden');
    }

    // 1. AVAILABLE QUEUE
    if (availableRiders.length === 0) {
        availContainer.innerHTML = `<div class="text-gray-500 italic text-xs">(Walang naka-duty)</div>`;
    } else {
        availContainer.innerHTML = availableRiders.map((m, index) => {
            return `
                <div class="flex items-center justify-between bg-darkBg/60 p-2 rounded-lg border border-gray-800/80">
                    <span class="font-bold text-xs text-white">
                        <span class="text-emerald-400 font-black mr-1">${index + 1}.</span> ${escapeHtml(m.name || 'Rider')}
                    </span>
                    
                    ${isAdminControlsActive ? `
                        <div class="flex items-center gap-1">
                            <select onchange="handleAdminForceAction('${m.fireKey}', this.value)" class="bg-inputBg text-[10px] text-amber-400 font-bold p-1 rounded border border-gray-700 outline-none">
                                <option value="">Force Action</option>
                                <option value="Catering">Force Cater</option>
                                <option value="Break">Force Break</option>
                                <option value="End">Force End</option>
                            </select>
                            <button onclick="moveRiderPosition('${m.fireKey}', 'up')" class="bg-blue-600/30 text-blue-400 p-1 rounded text-[10px]"><i class="fa-solid fa-arrow-up"></i></button>
                            <button onclick="moveRiderPosition('${m.fireKey}', 'down')" class="bg-blue-600/30 text-blue-400 p-1 rounded text-[10px]"><i class="fa-solid fa-arrow-down"></i></button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    // 2. CATERING / BUSY
    if (busyRiders.length === 0) {
        busyContainer.innerHTML = `<div class="text-gray-500 italic text-xs">(Walang bumibiyahe)</div>`;
    } else {
        busyContainer.innerHTML = busyRiders.map(m => {
            const custDisplay = m.customerName ? `<span class="text-amber-300 font-bold ml-1">(${escapeHtml(m.customerName)})</span>` : '';
            return `
                <div class="flex items-center justify-between bg-darkBg/60 p-2 rounded-lg border border-gray-800/80">
                    <span class="font-bold text-xs text-white">
                        <i class="fa-solid fa-motorcycle text-red-500 mr-1"></i> ${escapeHtml(m.name || 'Rider')} ${custDisplay}
                    </span>

                    ${isAdminControlsActive ? `
                        <select onchange="handleAdminForceAction('${m.fireKey}', this.value)" class="bg-inputBg text-[10px] text-amber-400 font-bold p-1 rounded border border-gray-700 outline-none">
                            <option value="">Force Action</option>
                            <option value="Available">Force Available</option>
                            <option value="Break">Force Break</option>
                            <option value="End">Force End</option>
                        </select>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    // 3. ON BREAK
    if (breakContainer) {
        if (breakRiders.length === 0) {
            breakContainer.innerHTML = `<div class="text-gray-500 italic text-xs">(Walang naka-break)</div>`;
        } else {
            breakContainer.innerHTML = breakRiders.map(m => `
                <div class="flex items-center justify-between text-xs text-gray-300 bg-darkBg/60 p-1.5 rounded-lg border border-gray-800">
                    <span>☕ ${escapeHtml(m.name || 'Rider')}</span>
                    ${isAdminControlsActive ? `
                        <button onclick="handleAdminForceAction('${m.fireKey}', 'Available')" class="bg-green-600/30 text-green-400 px-2 py-0.5 rounded text-[10px] font-bold">End Break</button>
                    ` : ''}
                </div>
            `).join('');
        }
    }

    // 4. PENALTY COOLDOWN
    if (cooldownContainer) {
        if (cooldownRiders.length === 0) {
            cooldownContainer.innerHTML = `<div class="text-gray-500 italic text-xs">(Walang naka-cooldown)</div>`;
        } else {
            cooldownContainer.innerHTML = cooldownRiders.map(m => `
                <div class="flex items-center justify-between text-xs text-yellow-400 bg-darkBg/60 p-1.5 rounded-lg border border-yellow-500/20">
                    <span>⏳ ${escapeHtml(m.name || 'Rider')} (Penalty)</span>
                    ${isAdminControlsActive ? `
                        <button onclick="handleAdminForceAction('${m.fireKey}', 'Available')" class="bg-yellow-600/30 text-yellow-300 px-2 py-0.5 rounded text-[10px] font-bold">Clear Cooldown</button>
                    ` : ''}
                </div>
            `).join('');
        }
    }
}

// STATUS UPDATE & SLIDE MODAL HANDLERS
export function triggerStatusWithSlide(targetStatus) {
    const myId = (appState.telegramId || "").toString().trim();
    if (!myId) {
        showToast("⚠️ Paki-login muna bago mag-update ng status!");
        return;
    }

    openSlideDeleteModal(
        `Confirm Status: ${targetStatus}`,
        `I-drag pakanan para baguhin ang iyong status sa ${targetStatus}.`,
        () => {
            updateRiderStatus(targetStatus);
        }
    );
}

export function updateRiderStatus(newStatus, customerName = "") {
    const myId = (appState.telegramId || "").toString().trim();
    const myName = appState.riderName || "Rider";

    if (!myId) return;

    db.ref('roster').once('value').then(snapshot => {
        const data = snapshot.val() || {};
        let targetKey = null;

        for (let key in data) {
            const rec = data[key];
            const recId = (rec.telegramId || "").toString().trim();
            const recName = (rec.name || "").trim().toLowerCase();

            if ((myId && recId === myId) || (myName && recName === myName.toLowerCase())) {
                if (!targetKey) {
                    targetKey = key;
                } else {
                    // Remove duplicate keys if any exist in DB
                    db.ref(`roster/${key}`).remove();
                }
            }
        }

        if (newStatus === 'End') {
            if (targetKey) db.ref(`roster/${targetKey}`).remove();
            showToast(" Shift Ended!");
            return;
        }

        const payload = {
            telegramId: myId,
            name: myName,
            status: newStatus,
            customerName: customerName || "",
            timestamp: Date.now()
        };

        if (targetKey) {
            db.ref(`roster/${targetKey}`).set(payload);
        } else {
            db.ref('roster').push(payload);
        }

        showToast(` Status updated to ${newStatus}`);
    });
}

export function promptCateringStatus() {
    const modal = document.getElementById('catering-modal');
    if (modal) modal.classList.remove('hidden');
}

export function closeCateringModal() {
    const modal = document.getElementById('catering-modal');
    if (modal) modal.classList.add('hidden');
}

export function confirmCateringStatus() {
    const input = document.getElementById('catering-customer-name');
    const nameVal = input ? input.value.trim() : "";
    if (!nameVal) {
        showToast("⚠️ Paki-lagay ang Customer Name!");
        return;
    }

    closeCateringModal();
    if (input) input.value = "";

    updateRiderStatus('Catering', nameVal);
}

// ADMIN FORCE ACTIONS
export function handleAdminForceAction(fireKey, action) {
    if (!fireKey || !action) return;

    if (action === 'End') {
        db.ref(`roster/${fireKey}`).remove();
        showToast("Rider removed from roster.");
    } else {
        db.ref(`roster/${fireKey}`).update({
            status: action,
            timestamp: Date.now()
        });
        showToast(`Rider status forced to ${action}.`);
    }
}

export function forceAllEndShift() {
    openSlideDeleteModal(
        "Force End ALL Shifts?",
        "I-drag pakanan para tanggalin ang LAHAT ng rider sa roster.",
        () => {
            db.ref('roster').remove();
            showToast("All shifts ended.");
        }
    );
}

export function moveRiderPosition(fireKey, direction) {
    db.ref(`roster/${fireKey}`).once('value').then(snapshot => {
        const data = snapshot.val();
        if (!data) return;

        const currentTs = data.timestamp || Date.now();
        const shiftMs = direction === 'up' ? -60000 : 60000;

        db.ref(`roster/${fireKey}`).update({
            timestamp: currentTs + shiftMs
        });
    });
}

export function getActiveCateringCustomersWithTimes() {
    const myId = (appState.telegramId || "").toString().trim();
    const myName = (appState.riderName || "").toString().trim().toLowerCase();
    const roster = globalState.rosterMembers || [];

    const myRecord = roster.find(r => {
        const rId = (r.telegramId || "").toString().trim();
        const rName = (r.name || "").toString().trim().toLowerCase();
        return ((myId && rId === myId) || (myName && rName === myName)) && (r.status || "").toLowerCase() === 'catering';
    });

    if (!myRecord || !myRecord.customerName) return [];

    return myRecord.customerName.split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(name => ({
            name: name,
            startTime: myRecord.timestamp ? new Date(myRecord.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ""
        }));
}

window.promptCateringStatus = promptCateringStatus;
window.closeCateringModal = closeCateringModal;
window.confirmCateringStatus = confirmCateringStatus;
window.triggerStatusWithSlide = triggerStatusWithSlide;
window.handleAdminForceAction = handleAdminForceAction;
window.forceAllEndShift = forceAllEndShift;
window.moveRiderPosition = moveRiderPosition;
window.toggleAdminControls = toggleAdminControls;