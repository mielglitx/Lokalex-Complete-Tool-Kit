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
        
        let uniqueRiderMap = {};
        
        (globalState.rosterMembers || []).forEach(r => {
            if (r.telegramId) uniqueRiderMap[r.telegramId] = r.riderName || r.name || r.telegramId;
        });
        
        (globalState.globalCateredHistory || []).forEach(h => {
            const hId = h.riderId || h.telegramId;
            if (hId) uniqueRiderMap[hId] = h.riderName || uniqueRiderMap[hId] || hId;
        });

        (globalState.globalDailyReceipts || []).forEach(rc => {
            const rId = rc.telegramId || rc.riderId;
            if (rId) uniqueRiderMap[rId] = rc.riderName || uniqueRiderMap[rId] || rId;
        });
        
        let options = `<option value="ALL">All Riders (Combined)</option>`;
        for (let id in uniqueRiderMap) {
            const isSelected = select.value === id ? "selected" : "";
            options += `<option value="${id}" ${isSelected}>${escapeHtml(uniqueRiderMap[id])}</option>`;
        }
        
        select.innerHTML = options;
    } else {
        filterBox.classList.add('hidden');
        filterBox.classList.remove('flex');
    }
}

export function setCommissionMode(mode) {
    viewSettings.mode = mode;
    
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
    let targetRiderId = isAdmin ? document.getElementById('admin-rider-select')?.value : appState.telegramId;
    if (targetRiderId === "ALL") targetRiderId = null; 

    const dateInput = document.getElementById(`comm-input-${viewSettings.period}`);
    if (dateInput) viewSettings.dateValue = dateInput.value;
    if (!viewSettings.dateValue) return;

    // 1. Read from Firebase receipts or catered history fallback
    const receiptList = (globalState.globalDailyReceipts && globalState.globalDailyReceipts.length > 0)
        ? globalState.globalDailyReceipts
        : globalState.globalCateredHistory;

    // 2. Filter Data by Date/Week/Month string matching
    let filteredHistory = receiptList.filter(record => {
        let rDate = record.date || record.completedDate || getLocalTodayStr();
        
        if (viewSettings.period === 'daily') {
            return rDate === viewSettings.dateValue;
        }
        if (viewSettings.period === 'weekly') {
            const d = new Date(rDate + "T00:00:00");
            return getWeekString(d.getTime()) === viewSettings.dateValue;
        }
        if (viewSettings.period === 'monthly') {
            return rDate.substring(0, 7) === viewSettings.dateValue;
        }
        return false;
    });

    // 3. Group Totals by Rider
    let riderTotals = {}; 

    filteredHistory.forEach(r => {
        let rId = (r.telegramId || r.riderId || "").toString();
        let rName = r.riderName || "Unknown Rider";

        if (!rId) {
            const rosterRec = globalState.rosterMembers?.find(mem => (mem.riderName || mem.name || "").toLowerCase() === rName.toLowerCase());
            if (rosterRec && rosterRec.telegramId) rId = rosterRec.telegramId.toString();
            else rId = rName.toLowerCase();
        }

        let gross = parseFloat(r.totalFees);
        if (isNaN(gross)) {
            const hf = parseFloat(r.fees?.handling) || 0;
            const mf = parseFloat(r.fees?.market) || 0;
            const ms = parseFloat(r.fees?.multistore || r.fees?.multistop) || 0;
            const rdf = parseFloat(r.fees?.delivery) || 0;
            const epay = parseFloat(r.fees?.epaymentFee) || 0;
            const disc = parseFloat(r.fees?.discount) || 0;
            gross = hf + mf + ms + rdf + epay - disc;
        }

        if (!riderTotals[rId]) {
            riderTotals[rId] = { name: rName, gross: 0, earned: 0, company: 0 };
        }
        
        riderTotals[rId].gross += gross;
        riderTotals[rId].earned += (gross * 0.80);
        riderTotals[rId].company += (gross * 0.20);
    });

    // 4. Filter down to Target Rider & Calculate Grand Totals
    let finalRiderList = [];
    let grandGross = 0;
    let grandEarned = 0;
    let grandCompany = 0;

    for (let rId in riderTotals) {
        if (targetRiderId && targetRiderId !== "ALL") {
            const myRoster = globalState.rosterMembers?.find(m => (m.telegramId || "").toString() === targetRiderId.toString());
            const targetName = myRoster ? (myRoster.riderName || myRoster.name || "").toLowerCase() : "";
            
            const isIdMatch = rId.toString() === targetRiderId.toString();
            const isNameMatch = targetName && riderTotals[rId].name.toLowerCase() === targetName;

            if (!isIdMatch && !isNameMatch) continue;
        }
        
        finalRiderList.push({ id: rId, ...riderTotals[rId] });
        grandGross += riderTotals[rId].gross;
        grandEarned += riderTotals[rId].earned;
        grandCompany += riderTotals[rId].company;
    }

    // 5. Update UI Text
    const mainWrapperEl = document.getElementById('comm-main-wrapper');
    const mainLabelEl = document.getElementById('comm-main-label');
    
    const grossEl = document.getElementById('comm-gross-amount');
    const summaryTitleEl = document.getElementById('comm-summary-title');
    const mainAmountEl = document.getElementById('comm-main-amount');

    if (grossEl) grossEl.innerText = grandGross.toFixed(2);
    if (summaryTitleEl) summaryTitleEl.innerText = `${viewSettings.period.toUpperCase()} SUMMARY`;

    if (viewSettings.mode === 'earned') {
        if (mainLabelEl) {
            mainLabelEl.innerText = "YOUR EARNINGS (80%)";
            mainLabelEl.className = "text-[10px] text-emerald-400 font-bold uppercase";
        }
        if (mainWrapperEl) mainWrapperEl.className = "text-4xl font-black text-emerald-400 drop-shadow-md";
        if (mainAmountEl) mainAmountEl.innerText = grandEarned.toFixed(2);
    } else {
        if (mainLabelEl) {
            mainLabelEl.innerText = "TO PAY COMPANY (20%)";
            mainLabelEl.className = "text-[10px] text-red-400 font-bold uppercase";
        }
        if (mainWrapperEl) mainWrapperEl.className = "text-4xl font-black text-red-400 drop-shadow-md";
        if (mainAmountEl) mainAmountEl.innerText = grandCompany.toFixed(2);
    }

    renderRiderSummaryList(finalRiderList);

    // 6. Fetch Settlement Status
    checkSettlementStatus(targetRiderId, viewSettings.period, viewSettings.dateValue, isAdmin);
}

function checkSettlementStatus(riderId, period, dateVal, isAdmin) {
    const badge = document.getElementById('comm-status-badge');
    const adminBtn = document.getElementById('admin-mark-paid-btn');
    
    if (!badge || !adminBtn) return;

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
                adminBtn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> REVERT TO UNPAID`;
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
    });
}

export function toggleSettlementStatus() {
    const select = document.getElementById('admin-rider-select');
    const riderId = select ? select.value : appState.telegramId;
    const settlementKey = `${riderId}_${viewSettings.period}_${viewSettings.dateValue}`;
    
    db.ref(`commissionSettlements/${settlementKey}`).once('value').then(snapshot => {
        const isPaid = snapshot.val() && snapshot.val().status === 'paid';
        
        if (isPaid) {
            db.ref(`commissionSettlements/${settlementKey}`).remove(); 
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

function renderRiderSummaryList(riderListArray) {
    const container = document.getElementById('commission-rider-list');
    if (!container) return;
    
    if (riderListArray.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic text-xs py-10">No records found for this period.</div>`;
        return;
    }

    container.innerHTML = riderListArray.map(rider => {
        let amountLabel = viewSettings.mode === 'earned' 
            ? `+ ₱${rider.earned.toFixed(2)}` 
            : `- ₱${rider.company.toFixed(2)}`;
            
        let colorClass = viewSettings.mode === 'earned' ? 'text-emerald-400' : 'text-red-400';

        return `
            <div class="bg-cardBg p-3.5 rounded-xl border border-gray-800 shadow-sm flex justify-between items-center text-sm">
                <span class="font-bold text-blue-300"><i class="fa-solid fa-motorcycle text-gray-500 mr-1.5"></i> ${escapeHtml(rider.name)}</span>
                <span class="font-black ${colorClass}">${amountLabel}</span>
            </div>
        `;
    }).join('');
}

export function generateDailyReportText() {
    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ["4547425", "5548562"].includes(appState.telegramId);
    let targetRiderId = isAdmin ? document.getElementById('admin-rider-select')?.value : appState.telegramId;
    if (targetRiderId === "ALL") targetRiderId = null;

    const receiptList = (globalState.globalDailyReceipts && globalState.globalDailyReceipts.length > 0)
        ? globalState.globalDailyReceipts
        : globalState.globalCateredHistory;

    let filteredHistory = receiptList.filter(record => {
        let rDate = record.date || record.completedDate || getLocalTodayStr();
        if (viewSettings.period === 'daily') return rDate === viewSettings.dateValue;
        if (viewSettings.period === 'weekly') {
            const d = new Date(rDate + "T00:00:00");
            return getWeekString(d.getTime()) === viewSettings.dateValue;
        }
        if (viewSettings.period === 'monthly') return rDate.substring(0, 7) === viewSettings.dateValue;
        return false;
    });

    let riderTotals = {}; 
    filteredHistory.forEach(r => {
        let rId = (r.telegramId || r.riderId || "").toString();
        let rName = r.riderName || "Unknown";

        if (!rId) {
            const rosterRec = globalState.rosterMembers?.find(mem => (mem.riderName || mem.name || "").toLowerCase() === rName.toLowerCase());
            if (rosterRec && rosterRec.telegramId) rId = rosterRec.telegramId.toString();
            else rId = rName.toLowerCase();
        }

        let gross = parseFloat(r.totalFees);
        if (isNaN(gross)) {
            const hf = parseFloat(r.fees?.handling) || 0;
            const mf = parseFloat(r.fees?.market) || 0;
            const ms = parseFloat(r.fees?.multistore || r.fees?.multistop) || 0;
            const rdf = parseFloat(r.fees?.delivery) || 0;
            const epay = parseFloat(r.fees?.epaymentFee) || 0;
            const disc = parseFloat(r.fees?.discount) || 0;
            gross = hf + mf + ms + rdf + epay - disc;
        }

        if (!riderTotals[rId]) {
            riderTotals[rId] = { name: rName, gross: 0, earned: 0, company: 0 };
        }
        riderTotals[rId].gross += gross;
        riderTotals[rId].earned += (gross * 0.80);
        riderTotals[rId].company += (gross * 0.20);
    });

    let grandGross = 0; let grandEarned = 0; let grandCompany = 0;
    let listText = "";

    for (let rId in riderTotals) {
        if (targetRiderId && targetRiderId !== "ALL") {
            const myRoster = globalState.rosterMembers?.find(m => (m.telegramId || "").toString() === targetRiderId.toString());
            const targetName = myRoster ? (myRoster.riderName || myRoster.name || "").toLowerCase() : "";
            
            const isIdMatch = rId.toString() === targetRiderId.toString();
            const isNameMatch = targetName && riderTotals[rId].name.toLowerCase() === targetName;

            if (!isIdMatch && !isNameMatch) continue;
        }
        
        grandGross += riderTotals[rId].gross;
        grandEarned += riderTotals[rId].earned;
        grandCompany += riderTotals[rId].company;

        let displayAmount = viewSettings.mode === 'earned' ? `₱${riderTotals[rId].earned.toFixed(2)}` : `₱${riderTotals[rId].company.toFixed(2)}`;
        listText += `• ${riderTotals[rId].name}: ${displayAmount}\n`;
    }

    const periodLabel = viewSettings.period.toUpperCase();
    const modeLabel = viewSettings.mode === 'earned' ? "RIDER EARNINGS" : "TO PAY COMPANY";
    
    let report = `📊 LOKALEX SETTLEMENT REPORT\n`;
    report += `Scope: ${targetRiderId && riderTotals[targetRiderId] ? riderTotals[targetRiderId]?.name : "ALL RIDERS"}\n`;
    report += `Period: ${periodLabel} (${viewSettings.dateValue})\n`;
    report += `Mode: ${modeLabel}\n\n`;
    report += `💰 Gross Total: ₱${grandGross.toFixed(2)}\n`;
    report += `🟢 Rider Earned (80%): ₱${grandEarned.toFixed(2)}\n`;
    report += `🔴 To Pay Company (20%): ₱${grandCompany.toFixed(2)}\n\n`;
    report += `📋 RIDER BREAKDOWN:\n${listText || "No records found."}`;

    copyText(report);
    showToast("📄 Settlement text report copied!");
}

// Reactive UI updates
window.addEventListener('receiptsUpdated', refreshCommissionView);
window.addEventListener('cateredUpdated', refreshCommissionView);