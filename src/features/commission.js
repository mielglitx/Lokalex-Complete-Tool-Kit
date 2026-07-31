// src/features/commission.js
import { appState, globalState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { getLocalTodayStr, copyText, getWeekString, getMonthString, getDateString, escapeHtml } from '../utils/helpers.js';
import { showToast } from '../ui/notifications.js';
import { switchView } from '../ui/router.js';

let viewSettings = {
    mode: 'earned', // 'earned' or 'company'
    period: 'daily', // 'daily', 'weekly', 'monthly'
    dateValue: getLocalTodayStr()
};

export function openCommissionScreen() {
    switchView('view-commission');
    
    // Set default dates if empty
    if (!document.getElementById('comm-input-daily').value) {
        const today = new Date();
        document.getElementById('comm-input-daily').value = getLocalTodayStr();
        document.getElementById('comm-input-weekly').value = getWeekString(today.getTime());
        document.getElementById('comm-input-monthly').value = getMonthString(today.getTime());
    }

    setupAdminControls();
    refreshCommissionView();
}

function setupAdminControls() {
    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ["4547425", "5548562"].includes(appState.telegramId); 
    const filterBox = document.getElementById('admin-commission-filter-box');
    const select = document.getElementById('admin-rider-select');
    
    if (isAdmin) {
        filterBox.classList.remove('hidden');
        filterBox.classList.add('flex');
        
        // Populate rider dropdown
        let options = `<option value="ALL">All Riders (Combined)</option>`;
        const uniqueRiders = [...new Set(globalState.globalCateredHistory.map(h => h.riderId).filter(Boolean))];
        
        uniqueRiders.forEach(id => {
            const historyItem = globalState.globalCateredHistory.find(h => h.riderId === id);
            const name = historyItem ? historyItem.riderName : id;
            options += `<option value="${id}">${name}</option>`;
        });
        
        if (select.innerHTML === "") select.innerHTML = options;
    } else {
        filterBox.classList.add('hidden');
        filterBox.classList.remove('flex');
    }
}

export function setCommissionMode(mode) {
    viewSettings.mode = mode;
    
    // UI Button toggles
    const btnEarned = document.getElementById('comm-mode-earned');
    const btnCompany = document.getElementById('comm-mode-company');
    
    if (mode === 'earned') {
        btnEarned.className = "flex-1 py-2 rounded-md bg-emerald-600/20 text-emerald-400 border border-emerald-500/50 transition";
        btnCompany.className = "flex-1 py-2 rounded-md text-gray-400 hover:text-white transition";
    } else {
        btnCompany.className = "flex-1 py-2 rounded-md bg-red-600/20 text-red-400 border border-red-500/50 transition";
        btnEarned.className = "flex-1 py-2 rounded-md text-gray-400 hover:text-white transition";
    }
    
    refreshCommissionView();
}

export function setCommissionPeriod(period) {
    viewSettings.period = period;
    
    // UI Button toggles
    ['daily', 'weekly', 'monthly'].forEach(p => {
        const btn = document.getElementById(`comm-period-${p}`);
        const input = document.getElementById(`comm-input-${p}`);
        if (p === period) {
            btn.className = "py-1.5 rounded bg-blue-600 text-white transition shadow";
            input.classList.remove('hidden');
        } else {
            btn.className = "py-1.5 rounded text-gray-400 hover:text-white transition";
            input.classList.add('hidden');
        }
    });

    refreshCommissionView();
}

export function refreshCommissionView() {
    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ["4547425", "5548562"].includes(appState.telegramId);
    let targetRiderId = isAdmin ? document.getElementById('admin-rider-select').value : appState.telegramId;
    if (targetRiderId === "ALL") targetRiderId = null; // Admin viewing everyone

    viewSettings.dateValue = document.getElementById(`comm-input-${viewSettings.period}`).value;
    if (!viewSettings.dateValue) return;

    // 1. Filter Data
    let filteredHistory = globalState.globalCateredHistory.filter(record => {
        if (targetRiderId && record.riderId !== targetRiderId.toString()) return false;

        const recordTs = record.timestamp || Date.now();
        if (viewSettings.period === 'daily') return getDateString(recordTs) === viewSettings.dateValue;
        if (viewSettings.period === 'weekly') return getWeekString(recordTs) === viewSettings.dateValue;
        if (viewSettings.period === 'monthly') return getMonthString(recordTs) === viewSettings.dateValue;
        return false;
    });

    // 2. Calculate Totals
    let grossTotal = 0;
    let companyShare = 0;
    let riderNet = 0;

    filteredHistory.forEach(r => {
        const hf = parseFloat(r.fees?.handling) || 0;
        const mf = parseFloat(r.fees?.market) || 0;
        const ms = parseFloat(r.fees?.multistop) || 0;
        const rdf = parseFloat(r.fees?.delivery) || 0;
        const disc = parseFloat(r.fees?.discount) || 0;
        const epay = parseFloat(r.fees?.epaymentFee) || 0;

        const recordGross = hf + mf + ms + rdf + epay - disc;
        grossTotal += recordGross;
        companyShare += (recordGross * 0.20);
        riderNet += (recordGross * 0.80);
    });

    // 3. Update UI Text
    const mainAmountEl = document.getElementById('comm-main-amount');
    const mainLabelEl = document.getElementById('comm-main-label');
    document.getElementById('comm-gross-amount').innerText = grossTotal.toFixed(2);
    document.getElementById('comm-summary-title').innerText = `${viewSettings.period.toUpperCase()} SUMMARY`;

    if (viewSettings.mode === 'earned') {
        mainLabelEl.innerText = "YOUR EARNINGS (80%)";
        mainLabelEl.className = "text-[10px] text-emerald-400 font-bold uppercase";
        mainAmountEl.className = "text-4xl font-black text-emerald-400 drop-shadow-md";
        mainAmountEl.innerText = riderNet.toFixed(2);
    } else {
        mainLabelEl.innerText = "TO PAY COMPANY (20%)";
        mainLabelEl.className = "text-[10px] text-red-400 font-bold uppercase";
        mainAmountEl.className = "text-4xl font-black text-red-400 drop-shadow-md";
        mainAmountEl.innerText = companyShare.toFixed(2);
    }

    renderReceiptsList(filteredHistory);

    // 4. Fetch Settlement Status from Firebase
    checkSettlementStatus(targetRiderId, viewSettings.period, viewSettings.dateValue, isAdmin);
}

function checkSettlementStatus(riderId, period, dateVal, isAdmin) {
    const badge = document.getElementById('comm-status-badge');
    const adminBtn = document.getElementById('admin-mark-paid-btn');
    
    // If Admin is viewing "ALL", we don't allow marking as paid (must be done per rider)
    if (!riderId) {
        badge.classList.add('hidden');
        adminBtn.classList.add('hidden');
        return;
    }

    const settlementKey = `${riderId}_${period}_${dateVal}`;
    
    db.ref(`commissionSettlements/${settlementKey}`).once('value').then(snapshot => {
        const data = snapshot.val();
        badge.classList.remove('hidden');

        if (data && data.status === 'paid') {
            badge.className = "absolute top-0 right-0 bg-emerald-600 text-white text-[9px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-widest shadow-md";
            badge.innerText = "PAID";
            if (isAdmin) {
                adminBtn.classList.remove('hidden');
                adminBtn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> MARK AS UNPAID`;
                adminBtn.className = "w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-black py-3 rounded-xl text-xs transition active:scale-95 shadow mt-1 border border-gray-700";
            } else {
                adminBtn.classList.add('hidden');
            }
        } else {
            badge.className = "absolute top-0 right-0 bg-red-600 text-white text-[9px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-widest shadow-md";
            badge.innerText = "UNPAID";
            if (isAdmin) {
                adminBtn.classList.remove('hidden');
                adminBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> MARK AS PAID`;
                adminBtn.className = "w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 rounded-xl text-xs transition active:scale-95 shadow-lg mt-1 border border-emerald-400/50";
            } else {
                adminBtn.classList.add('hidden');
            }
        }
    }); // <-- Missing closing brace was right here!
}

// Exposed to window for Admin button
export function toggleSettlementStatus() {
    const riderId = document.getElementById('admin-rider-select').value;
    const settlementKey = `${riderId}_${viewSettings.period}_${viewSettings.dateValue}`;
    
    db.ref(`commissionSettlements/${settlementKey}`).once('value').then(snapshot => {
        const isPaid = snapshot.val() && snapshot.val().status === 'paid';
        
        if (isPaid) {
            db.ref(`commissionSettlements/${settlementKey}`).remove(); // Revert to unpaid
            showToast("Marked as Unpaid.");
        } else {
            db.ref(`commissionSettlements/${settlementKey}`).set({
                status: 'paid',
                paidAt: Date.now(),
                adminId: appState.telegramId
            });
            showToast("Marked as PAID! ✅");
        }
        refreshCommissionView();
    });
}

function renderReceiptsList(historyArray) {
    const container = document.getElementById('commission-receipts-list');
    
    if (historyArray.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic text-xs py-10">No records found for this period.</div>`;
        return;
    }

    container.innerHTML = historyArray.slice().reverse().map(record => {
        const gross = parseFloat(record.totalFees) || 0;
        const cShare = gross * 0.20;
        const rNet = gross * 0.80;

        let displayAmount = viewSettings.mode === 'earned' 
            ? `<span class="text-emerald-400 font-bold">+ ₱${rNet.toFixed(2)}</span>`
            : `<span class="text-red-400 font-bold">- ₱${cShare.toFixed(2)}</span>`;

        const timeStr = new Date(record.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const dateStr = new Date(record.timestamp || Date.now()).toLocaleDateString([], {month: 'short', day:'numeric'});

        return `
            <div class="bg-cardBg p-3 rounded-xl border border-gray-800 shadow-sm flex flex-col gap-1 text-xs">
                <div class="flex justify-between items-center border-b border-gray-800 pb-1 mb-1">
                    <span class="font-bold text-blue-300 truncate max-w-[180px]"><i class="fa-solid fa-receipt"></i> ${escapeHtml(record.customerName.split(',')[0])}</span>
                    <span class="text-[10px] text-gray-500">${dateStr} ${timeStr}</span>
                </div>
                <div class="flex justify-between items-center text-gray-300">
                    <span>Gross Fee: ₱${gross.toFixed(2)}</span>
                    ${displayAmount}
                </div>
            </div>
        `;
    }).join('');
}

export function generateDailyReportText() {
    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ["4547425", "5548562"].includes(appState.telegramId);
    let targetRiderId = isAdmin ? document.getElementById('admin-rider-select').value : appState.telegramId;
    
    let riderName = "Rider";
    if (targetRiderId === "ALL") {
        riderName = "ALL RIDERS (COMBINED)";
    } else {
        const rosterRec = globalState.rosterMembers?.find(r => r.telegramId && r.telegramId.toString() === targetRiderId.toString());
        riderName = rosterRec ? rosterRec.name : (appState.riderName || "Rider");
    }

    let filteredHistory = globalState.globalCateredHistory.filter(record => {
        if (targetRiderId && targetRiderId !== "ALL" && record.riderId !== targetRiderId.toString()) return false;
        const recordTs = record.timestamp || Date.now();
        if (viewSettings.period === 'daily') return getDateString(recordTs) === viewSettings.dateValue;
        if (viewSettings.period === 'weekly') return getWeekString(recordTs) === viewSettings.dateValue;
        if (viewSettings.period === 'monthly') return getMonthString(recordTs) === viewSettings.dateValue;
        return false;
    });

    let grossTotal = 0;
    let companyShare = 0;
    let riderNet = 0;
    let listText = "";

    filteredHistory.slice().reverse().forEach((r, index) => {
        const gross = parseFloat(r.totalFees) || 0;
        grossTotal += gross;
        companyShare += (gross * 0.20);
        riderNet += (gross * 0.80);
        const cName = (r.customerName || "Customer").split(',')[0];
        listText += `${index + 1}. ${cName} - ₱${gross.toFixed(2)}\n`;
    });

    const periodLabel = viewSettings.period.toUpperCase();
    
    let report = `📊 LOKALEX COMMISSION REPORT\n`;
    report += `Rider: ${riderName}\n`;
    report += `Period: ${periodLabel} (${viewSettings.dateValue})\n\n`;
    report += `💰 Gross Total: ₱${grossTotal.toFixed(2)}\n`;
    report += `🟢 Rider Earned (80%): ₱${riderNet.toFixed(2)}\n`;
    report += `🔴 To Pay Company (20%): ₱${companyShare.toFixed(2)}\n\n`;
    report += `📋 TRANSACTIONS:\n${listText || "No transactions found."}`;

    copyText(report);
    showToast("📄 Text report copied to clipboard!");
}