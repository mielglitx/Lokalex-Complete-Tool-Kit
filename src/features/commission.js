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

// src/features/commission.js

function setupAdminControls() {
    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ["4547425", "5548562"].includes(appState.telegramId); 
    const filterBox = document.getElementById('admin-commission-filter-box');
    const select = document.getElementById('admin-rider-select');
    
    if (isAdmin) {
        filterBox.classList.remove('hidden');
        filterBox.classList.add('flex');
        
        // 1. Smart merge of riders from Roster AND History
        let uniqueRiderMap = {};
        
        (globalState.rosterMembers || []).forEach(r => {
            // FIXED: Look up r.riderName first before falling back to r.name or r.telegramId
            if (r.telegramId) uniqueRiderMap[r.telegramId] = r.riderName || r.name || r.telegramId;
        });
        
        (globalState.globalCateredHistory || []).forEach(h => {
            const hId = h.riderId || h.telegramId;
            if (hId) uniqueRiderMap[hId] = h.riderName || uniqueRiderMap[hId] || hId;
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

export function refreshCommissionView() {
    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ["4547425", "5548562"].includes(appState.telegramId);
    let targetRiderId = isAdmin ? document.getElementById('admin-rider-select').value : appState.telegramId;
    if (targetRiderId === "ALL") targetRiderId = null; 

    viewSettings.dateValue = document.getElementById(`comm-input-${viewSettings.period}`).value;
    if (!viewSettings.dateValue) return;

    // 1. Filter Data by Date/Week/Month
    let filteredHistory = globalState.globalCateredHistory.filter(record => {
        const recordTs = record.timestamp || Date.now();
        if (viewSettings.period === 'daily') return getDateString(recordTs) === viewSettings.dateValue;
        if (viewSettings.period === 'weekly') return getWeekString(recordTs) === viewSettings.dateValue;
        if (viewSettings.period === 'monthly') return getMonthString(recordTs) === viewSettings.dateValue;
        return false;
    });

    // 2. Group Totals by Rider
    let riderTotals = {}; 

    filteredHistory.forEach(r => {
        let rId = r.riderId || r.telegramId || "unknown";
        
        let gross = parseFloat(r.totalFees);
        if (isNaN(gross)) {
            const hf = parseFloat(r.fees?.handling) || 0;
            const mf = parseFloat(r.fees?.market) || 0;
            const ms = parseFloat(r.fees?.multistop) || 0;
            const rdf = parseFloat(r.fees?.delivery) || 0;
            const epay = parseFloat(r.fees?.epaymentFee) || 0;
            const disc = parseFloat(r.fees?.discount) || 0;
            gross = hf + mf + ms + rdf + epay - disc;
        }

        if (!riderTotals[rId]) {
            let rName = r.riderName || "Unknown Rider";
            const rosterRec = globalState.rosterMembers?.find(mem => (mem.telegramId || "").toString() === rId.toString());
            // FIXED: Look up rosterRec.riderName
            if (rosterRec) rName = rosterRec.riderName || rosterRec.name || rName;

            riderTotals[rId] = { name: rName, gross: 0, earned: 0, company: 0 };
        }
        
        riderTotals[rId].gross += gross;
        riderTotals[rId].earned += (gross * 0.80);
        riderTotals[rId].company += (gross * 0.20);
    });

    // 3. Filter down to Target Rider & Calculate Grand Totals
    let finalRiderList = [];
    let grandGross = 0;
    let grandEarned = 0;
    let grandCompany = 0;

    for (let rId in riderTotals) {
        if (targetRiderId && rId !== targetRiderId.toString()) continue; 
        
        finalRiderList.push({ id: rId, ...riderTotals[rId] });
        grandGross += riderTotals[rId].gross;
        grandEarned += riderTotals[rId].earned;
        grandCompany += riderTotals[rId].company;
    }

    // 4. Update UI Text
    const mainWrapperEl = document.getElementById('comm-main-wrapper');
    const mainLabelEl = document.getElementById('comm-main-label');
    
    document.getElementById('comm-gross-amount').innerText = grandGross.toFixed(2);
    document.getElementById('comm-summary-title').innerText = `${viewSettings.period.toUpperCase()} SUMMARY`;

    if (viewSettings.mode === 'earned') {
        mainLabelEl.innerText = "YOUR EARNINGS (80%)";
        mainLabelEl.className = "text-[10px] text-emerald-400 font-bold uppercase";
        mainWrapperEl.className = "text-4xl font-black text-emerald-400 drop-shadow-md";
        document.getElementById('comm-main-amount').innerText = grandEarned.toFixed(2);
    } else {
        mainLabelEl.innerText = "TO PAY COMPANY (20%)";
        mainLabelEl.className = "text-[10px] text-red-400 font-bold uppercase";
        mainWrapperEl.className = "text-4xl font-black text-red-400 drop-shadow-md";
        document.getElementById('comm-main-amount').innerText = grandCompany.toFixed(2);
    }

    renderRiderSummaryList(finalRiderList);

    // 5. Fetch Settlement Status
    checkSettlementStatus(targetRiderId, viewSettings.period, viewSettings.dateValue, isAdmin);
}

export function generateDailyReportText() {
    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ["4547425", "5548562"].includes(appState.telegramId);
    let targetRiderId = isAdmin ? document.getElementById('admin-rider-select').value : appState.telegramId;
    if (targetRiderId === "ALL") targetRiderId = null;

    let filteredHistory = globalState.globalCateredHistory.filter(record => {
        const recordTs = record.timestamp || Date.now();
        if (viewSettings.period === 'daily') return getDateString(recordTs) === viewSettings.dateValue;
        if (viewSettings.period === 'weekly') return getWeekString(recordTs) === viewSettings.dateValue;
        if (viewSettings.period === 'monthly') return getMonthString(recordTs) === viewSettings.dateValue;
        return false;
    });

    let riderTotals = {}; 
    filteredHistory.forEach(r => {
        let rId = r.riderId || r.telegramId || "unknown";
        let gross = parseFloat(r.totalFees);
        if (isNaN(gross)) {
            const hf = parseFloat(r.fees?.handling) || 0;
            const mf = parseFloat(r.fees?.market) || 0;
            const ms = parseFloat(r.fees?.multistop) || 0;
            const rdf = parseFloat(r.fees?.delivery) || 0;
            const epay = parseFloat(r.fees?.epaymentFee) || 0;
            const disc = parseFloat(r.fees?.discount) || 0;
            gross = hf + mf + ms + rdf + epay - disc;
        }

        if (!riderTotals[rId]) {
            let rName = r.riderName || "Unknown";
            const rosterRec = globalState.rosterMembers?.find(mem => (mem.telegramId || "").toString() === rId.toString());
            // FIXED: Look up rosterRec.riderName
            if (rosterRec) rName = rosterRec.riderName || rosterRec.name || rName;
            riderTotals[rId] = { name: rName, gross: 0, earned: 0, company: 0 };
        }
        riderTotals[rId].gross += gross;
        riderTotals[rId].earned += (gross * 0.80);
        riderTotals[rId].company += (gross * 0.20);
    });

    let grandGross = 0; let grandEarned = 0; let grandCompany = 0;
    let listText = "";

    for (let rId in riderTotals) {
        if (targetRiderId && rId !== targetRiderId.toString()) continue;
        
        grandGross += riderTotals[rId].gross;
        grandEarned += riderTotals[rId].earned;
        grandCompany += riderTotals[rId].company;

        let displayAmount = viewSettings.mode === 'earned' ? `₱${riderTotals[rId].earned.toFixed(2)}` : `₱${riderTotals[rId].company.toFixed(2)}`;
        listText += `• ${riderTotals[rId].name}: ${displayAmount}\n`;
    }

    const periodLabel = viewSettings.period.toUpperCase();
    const modeLabel = viewSettings.mode === 'earned' ? "RIDER EARNINGS" : "TO PAY COMPANY";
    
    let report = `📊 LOKALEX SETTLEMENT REPORT\n`;
    report += `Scope: ${targetRiderId ? riderTotals[targetRiderId]?.name : "ALL RIDERS"}\n`;
    report += `Period: ${periodLabel} (${viewSettings.dateValue})\n`;
    report += `Mode: ${modeLabel}\n\n`;
    report += `💰 Gross Total: ₱${grandGross.toFixed(2)}\n`;
    report += `🟢 Rider Earned (80%): ₱${grandEarned.toFixed(2)}\n`;
    report += `🔴 To Pay Company (20%): ₱${grandCompany.toFixed(2)}\n\n`;
    report += `📋 RIDER BREAKDOWN:\n${listText || "No records found."}`;

    copyText(report);
    showToast("📄 Settlement text report copied!");
}

export function toggleSettlementStatus() {
    const riderId = document.getElementById('admin-rider-select').value;
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
    let targetRiderId = isAdmin ? document.getElementById('admin-rider-select').value : appState.telegramId;
    if (targetRiderId === "ALL") targetRiderId = null;

    let filteredHistory = globalState.globalCateredHistory.filter(record => {
        const recordTs = record.timestamp || Date.now();
        if (viewSettings.period === 'daily') return getDateString(recordTs) === viewSettings.dateValue;
        if (viewSettings.period === 'weekly') return getWeekString(recordTs) === viewSettings.dateValue;
        if (viewSettings.period === 'monthly') return getMonthString(recordTs) === viewSettings.dateValue;
        return false;
    });

    let riderTotals = {}; 
    filteredHistory.forEach(r => {
        let rId = r.riderId || "unknown";
        let gross = parseFloat(r.totalFees);
        if (isNaN(gross)) {
            const hf = parseFloat(r.fees?.handling) || 0;
            const mf = parseFloat(r.fees?.market) || 0;
            const ms = parseFloat(r.fees?.multistop) || 0;
            const rdf = parseFloat(r.fees?.delivery) || 0;
            const epay = parseFloat(r.fees?.epaymentFee) || 0;
            const disc = parseFloat(r.fees?.discount) || 0;
            gross = hf + mf + ms + rdf + epay - disc;
        }

        if (!riderTotals[rId]) {
            let rName = r.riderName || "Unknown";
            const rosterRec = globalState.rosterMembers?.find(mem => mem.telegramId == rId);
            if (rosterRec) rName = rosterRec.name;
            riderTotals[rId] = { name: rName, gross: 0, earned: 0, company: 0 };
        }
        riderTotals[rId].gross += gross;
        riderTotals[rId].earned += (gross * 0.80);
        riderTotals[rId].company += (gross * 0.20);
    });

    let grandGross = 0; let grandEarned = 0; let grandCompany = 0;
    let listText = "";

    for (let rId in riderTotals) {
        if (targetRiderId && rId !== targetRiderId.toString()) continue;
        
        grandGross += riderTotals[rId].gross;
        grandEarned += riderTotals[rId].earned;
        grandCompany += riderTotals[rId].company;

        let displayAmount = viewSettings.mode === 'earned' ? `₱${riderTotals[rId].earned.toFixed(2)}` : `₱${riderTotals[rId].company.toFixed(2)}`;
        listText += `• ${riderTotals[rId].name}: ${displayAmount}\n`;
    }

    const periodLabel = viewSettings.period.toUpperCase();
    const modeLabel = viewSettings.mode === 'earned' ? "RIDER EARNINGS" : "TO PAY COMPANY";
    
    let report = `📊 LOKALEX SETTLEMENT REPORT\n`;
    report += `Scope: ${targetRiderId ? riderTotals[targetRiderId]?.name : "ALL RIDERS"}\n`;
    report += `Period: ${periodLabel} (${viewSettings.dateValue})\n`;
    report += `Mode: ${modeLabel}\n\n`;
    report += `💰 Gross Total: ₱${grandGross.toFixed(2)}\n`;
    report += `🟢 Rider Earned (80%): ₱${grandEarned.toFixed(2)}\n`;
    report += `🔴 To Pay Company (20%): ₱${grandCompany.toFixed(2)}\n\n`;
    report += `📋 RIDER BREAKDOWN:\n${listText || "No records found."}`;

    copyText(report);
    showToast("📄 Settlement text report copied!");
}