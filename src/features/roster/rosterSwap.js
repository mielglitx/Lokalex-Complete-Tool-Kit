// src/features/roster/rosterSwap.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';
import { parseQueueTime } from './rosterUtils.js';
import { autoStartLiveGpsSession } from '../liveTracker.js';

let activeSwapData = null;
let currentPendingSwapRequest = null;

// HELPER: CALCULATE QUEUE TIME TO PLACE RIDER AT #1 SPOT IN AVAILABLE QUEUE
function getTopQueueTime() {
    const rosterMembers = globalState.rosterMembers || [];
    const availableRiders = rosterMembers
        .filter(m => m.status === 'Available')
        .map(m => parseQueueTime(m.queueTime))
        .filter(t => t > 0);

    if (availableRiders.length > 0) {
        const minTime = Math.min(...availableRiders);
        return minTime - 1000;
    }
    return Date.now() - 1000;
}

export function openSwapCustomerModal(sourceRiderId, sourceRiderName, sourceCustomerName) {
    activeSwapData = { sourceRiderId, sourceRiderName, sourceCustomerName, type: 'swap' };

    const labelEl = document.getElementById('swap-modal-source-label');
    if (labelEl) {
        labelEl.innerText = `${sourceCustomerName} (${sourceRiderName})`;
    }

    renderSwapRidersAccordion();

    const modal = document.getElementById('swap-customer-modal');
    if (modal) modal.classList.remove('hidden');
}

export function closeSwapCustomerModal() {
    const modal = document.getElementById('swap-customer-modal');
    if (modal) modal.classList.add('hidden');
    activeSwapData = null;
}

export function renderSwapRidersAccordion() {
    const container = document.getElementById('swap-riders-accordion-list');
    if (!container || !activeSwapData) return;

    const roster = globalState.rosterMembers || [];
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();
    
    const otherRiders = roster.filter(m => {
        const mId = (m.telegramId || "").toString().trim();
        const mName = (m.riderName || m.name || "").trim().toLowerCase();
        const srcId = (activeSwapData.sourceRiderId || "").toString().trim();
        const srcName = (activeSwapData.sourceRiderName || "").trim().toLowerCase();

        if ((srcId && mId === srcId) || (srcName && mName === srcName)) return false;
        if ((myId && mId === myId) || (myName && mName === myName)) return false;
        if (!m.status || m.status === 'End' || m.status === 'End Shift') return false;
        return true;
    });

    if (otherRiders.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-6 text-xs">Walang ibang active na rider na pwedeng pag-swappan.</div>`;
        return;
    }

    container.innerHTML = otherRiders.map((rider, idx) => {
        const targetId = (rider.telegramId || "").toString();
        const targetName = rider.riderName || rider.name || "Rider";
        const rStatus = rider.status || "Offline";
        const isCatering = rStatus === 'Catering';
        const isAvailable = rStatus === 'Available';

        const custs = isCatering && rider.customerName ? rider.customerName.split(', ').map(c => c.trim()).filter(Boolean) : [];
        const statusBadge = isCatering 
            ? `<span class="bg-red-600/30 text-red-300 border border-red-500/40 text-[9px] font-bold px-2 py-0.5 rounded">Catering (${custs.length})</span>`
            : (isAvailable ? `<span class="bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-[9px] font-bold px-2 py-0.5 rounded">Available</span>` : `<span class="bg-gray-700 text-gray-400 text-[9px] font-bold px-2 py-0.5 rounded">${escapeHtml(rStatus)}</span>`);

        let expandableItemsHtml = "";
        if (isCatering && custs.length > 0) {
            expandableItemsHtml = custs.map(tCust => `
                <div class="flex items-center justify-between bg-black/40 p-2 rounded-xl border border-gray-800 text-xs">
                    <span class="text-orange-300 font-bold"><i class="fa-solid fa-user"></i> ${escapeHtml(tCust)}</span>
                    <button onclick="window.requestCustomerSwap && window.requestCustomerSwap('${targetId}', '${escapeHtml(targetName)}', '${escapeHtml(tCust)}')" class="bg-purple-600 hover:bg-purple-500 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 shadow">
                        <i class="fa-solid fa-arrows-rotate"></i> Request Swap with ${escapeHtml(tCust)}
                    </button>
                </div>
            `).join('');
        } else if (isAvailable) {
            expandableItemsHtml = `
                <div class="flex items-center justify-between bg-black/40 p-2 rounded-xl border border-gray-800 text-xs">
                    <span class="text-emerald-400 text-[11px]">Ipasasa ang order kay ${escapeHtml(targetName)} (Available)</span>
                    <button onclick="window.requestCustomerSwap && window.requestCustomerSwap('${targetId}', '${escapeHtml(targetName)}', '')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 shadow">
                        <i class="fa-solid fa-share"></i> Request Transfer
                    </button>
                </div>`;
        } else {
            expandableItemsHtml = `<div class="text-gray-500 italic text-[10px] p-2 text-center">Naka-${escapeHtml(rStatus)} ang rider na ito.</div>`;
        }

        const accordionId = `swap-accordion-${idx}`;

        return `
            <div class="bg-cardBg border border-gray-800 rounded-2xl overflow-hidden flex flex-col">
                <div onclick="window.toggleSwapRiderAccordion && window.toggleSwapRiderAccordion('${accordionId}')" class="p-3 flex justify-between items-center cursor-pointer hover:bg-white/5 transition active:scale-[0.99] select-none">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-xs text-white"><i class="fa-solid fa-motorcycle text-gray-400 mr-1"></i> ${escapeHtml(targetName)}</span>
                        ${statusBadge}
                    </div>
                    <i id="icon-${accordionId}" class="fa-solid fa-chevron-down text-gray-400 text-xs transition-transform duration-200"></i>
                </div>
                <div id="${accordionId}" class="hidden bg-darkBg/60 p-2.5 border-t border-gray-800 flex flex-col gap-1.5">
                    ${expandableItemsHtml}
                </div>
            </div>`;
    }).join('');
}

export function toggleSwapRiderAccordion(accordionId) {
    const box = document.getElementById(accordionId);
    const icon = document.getElementById(`icon-${accordionId}`);
    if (box) box.classList.toggle('hidden');
    if (icon) {
        icon.style.transform = box.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
    }
}

export function requestCustomerSwap(targetRiderId, targetRiderName, targetCustomerName = "") {
    if (!activeSwapData) return;

    const { sourceRiderId, sourceRiderName, sourceCustomerName } = activeSwapData;
    closeSwapCustomerModal();

    if (db) {
        db.ref('swapRequests').once('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                Object.keys(data).forEach(key => {
                    const req = data[key];
                    if (req && req.status === 'pending' &&
                        (req.sourceRiderId || "").toString() === sourceRiderId.toString() &&
                        (req.sourceCustomerName || "").toLowerCase().trim() === sourceCustomerName.toLowerCase().trim()) {
                        db.ref('swapRequests/' + key).remove();
                    }
                });
            }

            const requestId = `SWAP_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).substring(2,6).toUpperCase()}`;

            const requestObj = {
                id: requestId,
                type: targetCustomerName ? 'swap' : 'transfer',
                sourceRiderId: sourceRiderId,
                sourceRiderName: sourceRiderName,
                sourceCustomerName: sourceCustomerName,
                targetRiderId: targetRiderId,
                targetRiderName: targetRiderName,
                targetCustomerName: targetCustomerName,
                status: 'pending',
                createdAt: Date.now()
            };

            db.ref('swapRequests/' + requestId).set(requestObj);
        });
    }

    if (targetCustomerName) {
        showToast(`⏳ Swap request sent to ${targetRiderName}. Waiting for agreement...`);
    } else {
        showToast(`⏳ Transfer request sent to ${targetRiderName}. Waiting for agreement...`);
    }
}

// REQUEST CLAIM / GET CUSTOMER FROM ANOTHER RIDER (REQUIRES HOLDER APPROVAL)
export function requestClaimCustomer(targetRiderId, targetRiderName, targetCustomerName) {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "Rider").trim();

    if (!myId) return showToast("⚠️ Rider ID missing.");
    if (targetRiderId.toString().trim() === myId) return showToast("⚠️ Iyo na ang customer na ito.");

    if (db) {
        db.ref('swapRequests').once('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                Object.keys(data).forEach(key => {
                    const req = data[key];
                    if (req && req.status === 'pending' &&
                        (req.sourceRiderId || "").toString() === myId &&
                        (req.targetCustomerName || "").toLowerCase().trim() === targetCustomerName.toLowerCase().trim()) {
                        db.ref('swapRequests/' + key).remove();
                    }
                });
            }

            const requestId = `CLAIM_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).substring(2,6).toUpperCase()}`;

            const requestObj = {
                id: requestId,
                type: 'claim',
                sourceRiderId: myId,
                sourceRiderName: myName,
                sourceCustomerName: "",
                targetRiderId: targetRiderId.toString().trim(),
                targetRiderName: targetRiderName,
                targetCustomerName: targetCustomerName,
                status: 'pending',
                createdAt: Date.now()
            };

            db.ref('swapRequests/' + requestId).set(requestObj);
        });
    }

    showToast(`⏳ Humihingi ng pahintulot kay ${targetRiderName} upang kunin si ${targetCustomerName}...`);
    showSideNotification("REQUEST SENT", `Waiting for ${targetRiderName} to approve transfer of ${targetCustomerName}`, "fa-paper-plane", "text-blue-400", "border-blue-500");
}

export function listenToSwapRequests() {
    if (!db) return;

    db.ref('swapRequests').on('value', (snapshot) => {
        const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
        const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

        if (!myId && !myName) return;

        const data = snapshot.val();
        const approvalModal = document.getElementById('swap-approval-modal');
        const msgEl = document.getElementById('swap-approval-msg');
        const acceptBtn = document.getElementById('swap-accept-btn');

        if (!data) {
            if (approvalModal) approvalModal.classList.add('hidden');
            return;
        }

        const requests = Object.values(data);

        // 1. Check incoming pending requests where CURRENT USER is the target
        const incomingPending = requests.find(r => {
            if (!r || r.status !== 'pending') return false;

            const isTargetMe = (
                (r.targetRiderId && myId && r.targetRiderId.toString().trim() === myId) ||
                (r.targetRiderName && myName && r.targetRiderName.toString().trim().toLowerCase() === myName)
            );

            const isSourceMe = (
                (r.sourceRiderId && myId && r.sourceRiderId.toString().trim() === myId) ||
                (r.sourceRiderName && myName && r.sourceRiderName.toString().trim().toLowerCase() === myName)
            );

            return isTargetMe && !isSourceMe;
        });

        if (incomingPending) {
            currentPendingSwapRequest = incomingPending;
            if (msgEl) {
                if (incomingPending.type === 'claim' || (!incomingPending.sourceCustomerName && incomingPending.targetCustomerName)) {
                    msgEl.innerHTML = `Nais <strong>KUNIN / I-CLAIM</strong> ni <strong>${escapeHtml(incomingPending.sourceRiderName)}</strong> ang customer mo na si <strong>${escapeHtml(incomingPending.targetCustomerName)}</strong>.<br><br>Papayag ka bang ibigay ito sa kanya?`;
                    if (acceptBtn) acceptBtn.innerHTML = `<i class="fa-solid fa-hand-holding-hand mr-1"></i> Ibigay ang Customer`;
                } else if (incomingPending.targetCustomerName) {
                    msgEl.innerHTML = `Nais makipag-<strong>SWAP</strong> si <strong>${escapeHtml(incomingPending.sourceRiderName)}</strong>:<br><br>• Ibibigay sayo: <strong>${escapeHtml(incomingPending.sourceCustomerName)}</strong><br>• Kukunin ang sayo: <strong>${escapeHtml(incomingPending.targetCustomerName)}</strong>`;
                    if (acceptBtn) acceptBtn.innerHTML = `<i class="fa-solid fa-arrows-rotate mr-1"></i> Accept Swap`;
                } else {
                    msgEl.innerHTML = `Nais i-<strong>TRANSFER</strong> ni <strong>${escapeHtml(incomingPending.sourceRiderName)}</strong> ang customer na si <strong>${escapeHtml(incomingPending.sourceCustomerName)}</strong> sa iyo.`;
                    if (acceptBtn) acceptBtn.innerHTML = `<i class="fa-solid fa-check mr-1"></i> Accept Transfer`;
                }
            }
            if (approvalModal) approvalModal.classList.remove('hidden');
        } else {
            if (approvalModal) approvalModal.classList.add('hidden');
        }

        // 2. Check completed requests initiated by CURRENT USER to give instant feedback
        requests.forEach(r => {
            if (!r) return;
            const isSourceMe = (
                (r.sourceRiderId && myId && r.sourceRiderId.toString().trim() === myId) ||
                (r.sourceRiderName && myName && r.sourceRiderName.toString().trim().toLowerCase() === myName)
            );

            if (isSourceMe && r.status === 'accepted') {
                const targetCust = r.targetCustomerName || r.sourceCustomerName || "Customer";
                showToast(`✅ Inaprubahan ni ${r.targetRiderName}! Na-transfer na si ${targetCust} sa iyo.`);
                db.ref(`swapRequests/${r.id}`).remove();
            } else if (isSourceMe && r.status === 'rejected') {
                const targetCust = r.targetCustomerName || r.sourceCustomerName || "Customer";
                showToast(`❌ Tinanggihan ni ${r.targetRiderName} ang iyong request para kay ${targetCust}.`);
                db.ref(`swapRequests/${r.id}`).remove();
            }
        });
    });
}

export function acceptSwapRequest() {
    if (!currentPendingSwapRequest) return;

    const req = currentPendingSwapRequest;
    currentPendingSwapRequest = null;

    const approvalModal = document.getElementById('swap-approval-modal');
    if (approvalModal) approvalModal.classList.add('hidden');

    if (db) {
        db.ref(`swapRequests/${req.id}`).update({ status: 'accepted' });
    }

    activeSwapData = {
        sourceRiderId: req.sourceRiderId,
        sourceRiderName: req.sourceRiderName,
        sourceCustomerName: req.sourceCustomerName,
        type: req.type || (req.sourceCustomerName ? (req.targetCustomerName ? 'swap' : 'transfer') : 'claim')
    };

    executeCustomerSwap(req.targetRiderId, req.targetRiderName, req.targetCustomerName);
}

export function declineSwapRequest() {
    if (!currentPendingSwapRequest) return;

    const req = currentPendingSwapRequest;
    currentPendingSwapRequest = null;

    const approvalModal = document.getElementById('swap-approval-modal');
    if (approvalModal) approvalModal.classList.add('hidden');

    if (db) {
        db.ref(`swapRequests/${req.id}`).update({ status: 'rejected' });
    }

    showToast("❌ Request declined.");
}

export async function executeCustomerSwap(targetRiderId, targetRiderName, targetCustomerName = "") {
    if (!activeSwapData) return;

    const { sourceRiderId, sourceRiderName, sourceCustomerName, type } = activeSwapData;
    const isClaim = type === 'claim' || (!sourceCustomerName && targetCustomerName);

    const roster = globalState.rosterMembers || [];
    const sourceRec = roster.find(m => (m.telegramId || "").toString() === sourceRiderId.toString());
    const targetRec = roster.find(m => (m.telegramId || "").toString() === targetRiderId.toString());

    if (!sourceRec || !targetRec) return showToast("⚠️ Operational error executing customer swap.");

    const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let sourceCusts = sourceRec.customerName ? sourceRec.customerName.split(', ').map(c => c.trim()).filter(Boolean) : [];
    let sourceTimes = sourceRec.startTime ? sourceRec.startTime.split(', ').map(t => t.trim()) : [];

    let targetCusts = targetRec.customerName ? targetRec.customerName.split(', ').map(c => c.trim()).filter(Boolean) : [];
    let targetTimes = targetRec.startTime ? targetRec.startTime.split(', ').map(t => t.trim()) : [];

    if (isClaim) {
        // SCENARIO 1: CLAIM / GET (Target/Holder gives targetCustomerName to Source/Requester)
        const tgtIdx = targetCusts.findIndex(c => c.toLowerCase() === targetCustomerName.toLowerCase());
        const extractedTime = tgtIdx !== -1 ? (targetTimes[tgtIdx] || nowTimeStr) : nowTimeStr;

        if (tgtIdx !== -1) {
            targetCusts.splice(tgtIdx, 1);
            if (targetTimes[tgtIdx]) targetTimes.splice(tgtIdx, 1);
        }

        if (!sourceCusts.some(c => c.toLowerCase() === targetCustomerName.toLowerCase())) {
            sourceCusts.push(targetCustomerName);
            sourceTimes.push(extractedTime);
        }

        const newTargetStatus = targetCusts.length > 0 ? 'Catering' : 'Available';
        const newTargetQueue = newTargetStatus === 'Available' ? getTopQueueTime() : parseQueueTime(targetRec.queueTime);

        if (db) {
            db.ref('roster/' + targetRiderId).update({
                status: newTargetStatus,
                customerName: targetCusts.join(', '),
                startTime: targetTimes.join(', '),
                queueTime: newTargetQueue,
                lastUpdated: nowTimeStr
            });

            db.ref('roster/' + sourceRiderId).update({
                status: 'Catering',
                customerName: sourceCusts.join(', '),
                startTime: sourceTimes.join(', '),
                lastUpdated: nowTimeStr
            });

            // Reassign customer chat thread in Firebase
            const cleanSearchName = targetCustomerName.toLowerCase().trim();
            db.ref('customerChats').once('value', (snapshot) => {
                const chats = snapshot.val();
                if (chats) {
                    Object.keys(chats).forEach(custId => {
                        const meta = chats[custId]?.metadata || chats[custId] || {};
                        const chatCustName = (meta.customerName || meta.name || "").toLowerCase().trim();
                        if (chatCustName && chatCustName === cleanSearchName) {
                            db.ref(`customerChats/${custId}/metadata`).update({
                                folder: 'catering',
                                cateredByRiderId: sourceRiderId,
                                cateredByRiderName: sourceRiderName,
                                cateredBy: sourceRiderName,
                                lastUpdated: Date.now()
                            });
                        }
                    });
                }
            });
        }

        showSideNotification("CUSTOMER CLAIMED", `Transferred ${targetCustomerName} to ${sourceRiderName}`, "fa-hand-holding-hand", "text-emerald-400", "border-emerald-500");
        showToast(`✅ Naibigay na si ${targetCustomerName} kay ${sourceRiderName}!`);
        return;
    }

    // SCENARIO 2: STANDARD SWAP OR TRANSFER
    const srcIdx = sourceCusts.findIndex(c => c.toLowerCase() === sourceCustomerName.toLowerCase());
    const srcTime = srcIdx !== -1 ? sourceTimes[srcIdx] : nowTimeStr;

    if (srcIdx !== -1) {
        sourceCusts.splice(srcIdx, 1);
        if (sourceTimes[srcIdx]) sourceTimes.splice(srcIdx, 1);
    }

    let tgtTime = nowTimeStr;
    if (targetCustomerName) {
        const tgtIdx = targetCusts.findIndex(c => c.toLowerCase() === targetCustomerName.toLowerCase());
        if (tgtIdx !== -1) {
            tgtTime = targetTimes[tgtIdx] || nowTimeStr;
            targetCusts.splice(tgtIdx, 1);
            if (targetTimes[tgtIdx]) targetTimes.splice(tgtIdx, 1);
        }
        
        if (!sourceCusts.some(c => c.toLowerCase() === targetCustomerName.toLowerCase())) {
            sourceCusts.push(targetCustomerName);
            sourceTimes.push(tgtTime);
        }
    }

    if (!targetCusts.some(c => c.toLowerCase() === sourceCustomerName.toLowerCase())) {
        targetCusts.push(sourceCustomerName);
        targetTimes.push(srcTime);
    }

    const newSourceStatus = sourceCusts.length > 0 ? 'Catering' : 'Available';
    let newSourceQueue = parseQueueTime(sourceRec.queueTime);

    if (newSourceStatus === 'Available') {
        const availables = roster.filter(m => m.status === 'Available' && (m.telegramId || "").toString() !== sourceRiderId.toString());
        let maxTime = new Date().getTime();
        availables.forEach(r => {
            const t = parseQueueTime(r.queueTime);
            if (t > maxTime) maxTime = t;
        });
        newSourceQueue = maxTime + 1000;
    }

    if (db) {
        db.ref('roster/' + sourceRiderId).update({
            status: newSourceStatus,
            customerName: sourceCusts.join(', '),
            startTime: sourceTimes.join(', '),
            queueTime: newSourceQueue,
            lastUpdated: nowTimeStr
        });

        db.ref('roster/' + targetRiderId).update({
            status: 'Catering',
            customerName: targetCusts.join(', '),
            startTime: targetTimes.join(', '),
            lastUpdated: nowTimeStr
        });

        // Reassign chat thread metadata
        if (sourceCustomerName) {
            const cleanSrc = sourceCustomerName.toLowerCase().trim();
            db.ref('customerChats').once('value', (snapshot) => {
                const chats = snapshot.val();
                if (chats) {
                    Object.keys(chats).forEach(custId => {
                        const meta = chats[custId]?.metadata || chats[custId] || {};
                        const chatCustName = (meta.customerName || meta.name || "").toLowerCase().trim();
                        if (chatCustName && chatCustName === cleanSrc) {
                            db.ref(`customerChats/${custId}/metadata`).update({
                                folder: 'catering',
                                cateredByRiderId: targetRiderId,
                                cateredByRiderName: targetRiderName,
                                cateredBy: targetRiderName,
                                lastUpdated: Date.now()
                            });
                        }
                    });
                }
            });
        }
    }

    if (targetCustomerName) {
        showSideNotification("CUSTOMER SWAPPED", `Swapped ${sourceCustomerName} with ${targetCustomerName}`, "fa-arrows-rotate", "text-purple-400", "border-purple-500");
        showToast(`🔀 Swapped ${sourceCustomerName} (${sourceRiderName}) with ${targetCustomerName} (${targetRiderName})`);
    } else {
        showSideNotification("CUSTOMER TRANSFERRED", `Transferred ${sourceCustomerName} to ${targetRiderName}`, "fa-share", "text-purple-400", "border-purple-500");
        showToast(`🔀 Transferred ${sourceCustomerName} to ${targetRiderName}`);
    }
}

if (typeof window !== 'undefined') {
    window.openSwapCustomerModal = openSwapCustomerModal;
    window.closeSwapCustomerModal = closeSwapCustomerModal;
    window.renderSwapRidersAccordion = renderSwapRidersAccordion;
    window.toggleSwapRiderAccordion = toggleSwapRiderAccordion;
    window.requestCustomerSwap = requestCustomerSwap;
    window.requestClaimCustomer = requestClaimCustomer;
    window.listenToSwapRequests = listenToSwapRequests;
    window.acceptSwapRequest = acceptSwapRequest;
    window.declineSwapRequest = declineSwapRequest;
    window.executeCustomerSwap = executeCustomerSwap;
}