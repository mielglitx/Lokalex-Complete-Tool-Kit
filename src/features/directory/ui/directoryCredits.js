// src/features/directory/ui/directoryCredits.js
import { db } from '../../../config/firebase.js';
import { appState, globalState } from '../../../store/state.js';
import { showToast, showSideNotification } from '../../../ui/notifications.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { checkAdminAccess } from '../directoryPermissions.js';

let creditsListenerActive = false;

export function updateRosterCreditsDisplay(credits) {
    const countEl = document.getElementById('rider-credits-count');
    const pillEl = document.getElementById('rider-credits-pill');
    
    const isAdmin = checkAdminAccess();

    if (isAdmin) {
        if (countEl) countEl.innerText = "∞ (Admin)";
        if (pillEl) {
            pillEl.className = "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 text-[10px] px-2.5 py-0.5 rounded-lg font-bold flex items-center gap-1.5 shadow-xs transition select-none cursor-pointer";
            pillEl.onclick = () => openShareCreditsModal();
        }
        return;
    }

    let balance = credits;
    if (balance === undefined || balance === null) {
        balance = parseInt(localStorage.getItem('lokalex_rider_credits') || "0", 10);
    }

    if (countEl) countEl.innerText = balance;

    if (pillEl) {
        pillEl.onclick = () => openShareCreditsModal();
        if (balance <= 0) {
            pillEl.className = "bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-500/40 text-red-700 dark:text-red-400 text-[10px] px-2.5 py-0.5 rounded-lg font-bold flex items-center gap-1.5 shadow-xs transition select-none cursor-pointer";
        } else {
            pillEl.className = "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 text-[10px] px-2.5 py-0.5 rounded-lg font-bold flex items-center gap-1.5 shadow-xs transition select-none cursor-pointer";
        }
    }
}

export function showCreditsInfoToast() {
    const isAdmin = checkAdminAccess();
    if (isAdmin) {
        showToast("👑 Admin Account: You have UNLIMITED Directory Access and credits are not deducted.");
        return;
    }

    const cur = parseInt(localStorage.getItem('lokalex_rider_credits') || "0", 10);
    const config = globalState.directoryCreditsConfig || {};
    const custR = config.rewardCustomerRegistration !== undefined ? config.rewardCustomerRegistration : 5;
    const storeR = config.rewardStoreRegistration !== undefined ? config.rewardStoreRegistration : 10;
    const status = config.enabled !== false ? 'ACTIVE' : 'DISABLED';

    showToast(`🪙 Directory Credits (${status})\n• Balance: ${cur} credits\n• Free Customer & Store browsing\n• -1 credit per Customer Location viewed\n• +${custR} credits per Customer registration\n• +${storeR} credits per Store registration\n• You can also share credits with fellow riders!`);
}

export function initRiderCreditsListener() {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    if (!myId || !db || creditsListenerActive) return;

    creditsListenerActive = true;
    db.ref(`riders/${myId}/directoryCredits`).on('value', (snap) => {
        const val = snap.exists() ? parseInt(snap.val(), 10) || 0 : 0;
        localStorage.setItem('lokalex_rider_credits', val.toString());
        appState.directoryCredits = val;
        updateRosterCreditsDisplay(val);
    });
}

// ============================================================================
// PEER-TO-PEER RIDER CREDIT TRANSFER ENGINE
// ============================================================================

function getOrCreateShareCreditsModal() {
    let modal = document.getElementById('share-credits-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'share-credits-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 hidden';
        modal.innerHTML = `
        <div class="bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-800 rounded-3xl p-5 max-w-sm w-full shadow-2xl flex flex-col gap-4 animate-scaleUp">
            <!-- Header -->
            <div class="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-gray-800/80">
                <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-full bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-600 dark:text-amber-400">
                        <i class="fa-solid fa-coins text-sm"></i>
                    </div>
                    <div>
                        <h3 class="font-black text-sm text-gray-900 dark:text-white">Directory Credits</h3>
                        <p class="text-[10px] text-gray-500 dark:text-gray-400">Transfer & Balance Management</p>
                    </div>
                </div>
                <button type="button" onclick="window.closeShareCreditsModal && window.closeShareCreditsModal()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 text-sm cursor-pointer">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <!-- Body Details -->
            <div class="flex flex-col gap-3 text-xs">
                <!-- Balance Card -->
                <div class="bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-500/30 p-3.5 rounded-2xl flex items-center justify-between">
                    <div>
                        <span class="text-[10px] text-amber-700 dark:text-amber-400 font-bold uppercase tracking-wider block">Your Balance</span>
                        <span id="share-credit-balance-display" class="font-black text-lg text-amber-900 dark:text-amber-200 font-mono">0 credits</span>
                    </div>
                    <button type="button" onclick="window.showCreditsInfoToast && window.showCreditsInfoToast()" class="text-[10px] text-amber-800 dark:text-amber-300 font-bold underline flex items-center gap-1 cursor-pointer">
                        <i class="fa-solid fa-circle-info"></i> Rules
                    </button>
                </div>

                <!-- Recipient Picker -->
                <div class="flex flex-col gap-1">
                    <label class="text-[11px] font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                        <i class="fa-solid fa-user-tag text-blue-500"></i> Send Credits To:
                    </label>
                    <select id="share-credit-recipient-select" class="w-full bg-gray-50 dark:bg-black/30 border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-900 dark:text-white font-medium outline-none focus:border-amber-500">
                        <option value="">Loading riders...</option>
                    </select>
                </div>

                <!-- Amount Input & Quick Increment Buttons -->
                <div class="flex flex-col gap-1.5">
                    <label class="text-[11px] font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                        <i class="fa-solid fa-hashtag text-amber-500"></i> Amount of Credits:
                    </label>
                    <div class="flex items-center gap-2">
                        <input type="number" id="share-credit-amount-input" min="1" step="1" value="1" placeholder="1" class="flex-1 bg-gray-50 dark:bg-black/30 border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-gray-900 dark:text-white outline-none focus:border-amber-500">
                        <div class="flex items-center gap-1">
                            <button type="button" onclick="window.setTransferCreditAmount && window.setTransferCreditAmount(1)" class="px-2 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-lg text-[10px] font-bold text-gray-700 dark:text-gray-300 transition active:scale-90 cursor-pointer">+1</button>
                            <button type="button" onclick="window.setTransferCreditAmount && window.setTransferCreditAmount(5)" class="px-2 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-lg text-[10px] font-bold text-gray-700 dark:text-gray-300 transition active:scale-90 cursor-pointer">+5</button>
                            <button type="button" onclick="window.setTransferCreditAmount && window.setTransferCreditAmount('MAX')" class="px-2 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-black transition active:scale-90 cursor-pointer">MAX</button>
                        </div>
                    </div>
                </div>

                <div class="text-[10px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-black/20 p-2.5 rounded-xl border border-gray-200 dark:border-gray-800 flex items-start gap-1.5 leading-relaxed">
                    <i class="fa-solid fa-shield-halved text-amber-500 mt-0.5 shrink-0 text-xs"></i>
                    <span>This transfer is <strong>instant</strong> and will be deducted from your credits immediately before being added to the selected rider.</span>
                </div>
            </div>

            <!-- Action Buttons -->
            <div class="flex items-center gap-2 pt-1">
                <button type="button" onclick="window.closeShareCreditsModal && window.closeShareCreditsModal()" class="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-black/30 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-xs transition active:scale-95 cursor-pointer">
                    Cancel
                </button>
                <button type="button" id="btn-confirm-transfer-credits" onclick="window.confirmTransferCredits && window.confirmTransferCredits()" class="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs transition active:scale-95 shadow-md flex items-center justify-center gap-1.5 cursor-pointer">
                    <i class="fa-solid fa-paper-plane"></i> Send Credits
                </button>
            </div>
        </div>`;
        document.body.appendChild(modal);
    }
    return modal;
}

export function openShareCreditsModal() {
    const modal = getOrCreateShareCreditsModal();
    const balanceDisplay = document.getElementById('share-credit-balance-display');
    const recipientSelect = document.getElementById('share-credit-recipient-select');
    const amountInput = document.getElementById('share-credit-amount-input');

    const isAdmin = checkAdminAccess();
    let currentBalance = parseInt(localStorage.getItem('lokalex_rider_credits') || "0", 10);
    if (isNaN(currentBalance)) currentBalance = 0;

    if (balanceDisplay) {
        balanceDisplay.innerText = isAdmin ? "∞ (Admin Unlimited)" : `${currentBalance} credits`;
    }

    if (amountInput) {
        amountInput.value = "1";
    }

    if (recipientSelect) {
        const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
        const myName = (appState.riderName || localStorage.getItem('riderName') || "").trim().toLowerCase();
        const rosterMembers = globalState.rosterMembers || [];

        const validRecipients = rosterMembers.filter(m => {
            const mId = (m.telegramId || m.id || "").toString().trim();
            const mName = (m.riderName || m.name || "").trim().toLowerCase();
            if (myId && mId === myId) return false;
            if (myName && mName === myName) return false;
            return !!(m.riderName || m.name);
        });

        const seenIds = new Set();
        let optionsHtml = `<option value="">-- Choose Rider --</option>`;

        validRecipients.forEach(r => {
            const rId = (r.telegramId || r.id || "").toString().trim();
            const rName = (r.riderName || r.name || "Rider").trim();
            if (rId && seenIds.has(rId)) return;
            if (rId) seenIds.add(rId);

            optionsHtml += `<option value="${escapeHtml(rId)}" data-name="${escapeHtml(rName)}">${escapeHtml(rName)} ${rId ? `(ID: ${escapeHtml(rId)})` : ''}</option>`;
        });

        if (validRecipients.length === 0) {
            optionsHtml = `<option value="">No other active riders</option>`;
        }

        recipientSelect.innerHTML = optionsHtml;
    }

    modal.classList.remove('hidden');
}

export function closeShareCreditsModal() {
    const modal = document.getElementById('share-credits-modal');
    if (modal) modal.classList.add('hidden');
}

export function setTransferCreditAmount(val) {
    const input = document.getElementById('share-credit-amount-input');
    if (!input) return;

    const isAdmin = checkAdminAccess();
    let currentBalance = parseInt(localStorage.getItem('lokalex_rider_credits') || "0", 10);
    if (isNaN(currentBalance)) currentBalance = 0;

    if (val === 'MAX') {
        input.value = isAdmin ? 50 : Math.max(1, currentBalance);
    } else {
        const currentVal = parseInt(input.value || "0", 10);
        input.value = Math.max(1, currentVal + val);
    }
}

export async function confirmTransferCredits() {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = appState.riderName || localStorage.getItem('riderName') || "Rider";
    const isAdmin = checkAdminAccess();

    const recipientSelect = document.getElementById('share-credit-recipient-select');
    const targetId = recipientSelect?.value?.trim();
    const selectedOption = recipientSelect?.options[recipientSelect.selectedIndex];
    const targetName = selectedOption?.dataset?.name || "Rider";

    if (!targetId) {
        showToast("⚠️ Please select a rider to send credits to first.");
        return;
    }

    const amountInput = document.getElementById('share-credit-amount-input');
    const amount = parseInt(amountInput?.value, 10);

    if (isNaN(amount) || amount <= 0) {
        showToast("⚠️ Please enter a valid credit amount (minimum 1).");
        return;
    }

    let currentCredits = parseInt(localStorage.getItem('lokalex_rider_credits') || "0", 10);
    if (isNaN(currentCredits)) currentCredits = 0;

    if (!isAdmin && currentCredits < amount) {
        showToast(`⚠️ Insufficient credits (${currentCredits} available, attempting to transfer ${amount}).`);
        return;
    }

    const transferBtn = document.getElementById('btn-confirm-transfer-credits');
    if (transferBtn) {
        transferBtn.disabled = true;
        transferBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Transferring...`;
    }

    try {
        if (db) {
            // 1. Deduct from sender if not admin
            if (!isAdmin && myId) {
                await db.ref(`riders/${myId}/directoryCredits`).transaction(c => Math.max(0, (c || 0) - amount));
                try {
                    await db.ref(`roster/${myId}/directoryCredits`).transaction(c => Math.max(0, (c || 0) - amount));
                } catch (_) {}
            }

            // 2. Add to recipient
            await db.ref(`riders/${targetId}/directoryCredits`).transaction(c => (c || 0) + amount);
            try {
                await db.ref(`roster/${targetId}/directoryCredits`).transaction(c => (c || 0) + amount);
            } catch (_) {}

            // 3. Log transfer audit record in Firebase
            try {
                const transferLogKey = `TX_${Date.now()}_${myId || 'ADMIN'}_${targetId}`;
                await db.ref(`directoryCreditTransfers/${transferLogKey}`).set({
                    senderId: myId || "ADMIN",
                    senderName: myName,
                    recipientId: targetId,
                    recipientName: targetName,
                    amount: amount,
                    timestamp: Date.now(),
                    date: new Date().toLocaleDateString()
                });
            } catch (_) {}
        }

        if (!isAdmin) {
            const newBal = Math.max(0, currentCredits - amount);
            localStorage.setItem('lokalex_rider_credits', newBal.toString());
            appState.directoryCredits = newBal;
            updateRosterCreditsDisplay(newBal);
        }

        closeShareCreditsModal();
        showToast(`✅ Successfully sent ${amount} credit(s) to ${targetName}!`);
        showSideNotification("CREDITS TRANSFERRED", `${amount} credits to ${targetName}`, "fa-coins", "text-amber-400", "border-amber-500");
    } catch (err) {
        console.error("Credit transfer failed:", err);
        showToast("❌ Failed to send credits: " + (err.message || "Failed"));
    } finally {
        if (transferBtn) {
            transferBtn.disabled = false;
            transferBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Send Credits`;
        }
    }
}
