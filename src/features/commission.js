// src/features/commission.js
import { appState, globalState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { API_URL } from '../config/constants.js';
import { getLocalTodayStr, copyText, getWeekString, getMonthString, getDateString, escapeHtml } from '../utils/helpers.js';
import { showToast } from '../ui/notifications.js';
import { switchView } from '../ui/router.js';

let viewSettings = {
    mode: 'earned', // 'earned' or 'company'
    period: 'daily', // 'daily', 'weekly', 'monthly'
    dateValue: getLocalTodayStr()
};

// DYNAMIC HELPER: Calculates commission rates based on individual rider settings and Sunday promo
function getCommissionRates(dateStr, riderName = "") {
    const d = new Date((dateStr || getLocalTodayStr()) + "T00:00:00");
    const isSunday = d.getDay() === 0;

    const cleanName = (riderName || "").toLowerCase().trim();
    const setting = globalState.globalRiderRates ? globalState.globalRiderRates[cleanName] : null;

    // Default base company percentage is 20% if no custom rate is specified for a rider
    let baseCompanyPerc = 20;
    if (setting) {
        if (setting.percentage !== undefined) baseCompanyPerc = parseFloat(setting.percentage);
        else if (setting.basePercentage !== undefined) baseCompanyPerc = parseFloat(setting.basePercentage);
    }

    // Sunday Promo deducts 5 percentage points from company rate
    let sundayDiscount = isSunday ? 5 : 0;

    // Calculate final percentages
    let finalCompanyPerc = Math.max(0, baseCompanyPerc - sundayDiscount);
    let companyRate = finalCompanyPerc / 100;
    let riderRate = (100 - finalCompanyPerc) / 100;

    return {
        companyRate: companyRate,
        riderRate: riderRate,
        isSunday: isSunday,
        companyPerc: finalCompanyPerc,
        riderPerc: 100 - finalCompanyPerc,
        baseCompanyPerc: baseCompanyPerc
    };
}

// FETCH COMMISSION SETTINGS FROM GOOGLE APPS SCRIPT / FIREBASE
export async function fetchCommissionSettings() {
    try {
        // 1. Fetch live commission settings from Apps Script
        const res = await fetch(`${API_URL}?type=all`);
        if (res.ok) {
            const data = await res.json();
            if (data && data.riderRates) {
                let ratesMap = {};
                for (let name in data.riderRates) {
                    const cleanName = name.toLowerCase().trim();
                    const item = data.riderRates[name];
                    ratesMap[cleanName] = {
                        percentage: item.basePercentage !== undefined ? item.basePercentage : (item.percentage || 20),
                        promoLess: item.promoLess || 0
                    };
                }
                globalState.globalRiderRates = ratesMap;
            }
        }
    } catch(e) {
        console.warn("Could not fetch live commission settings from Google Sheets, checking Firebase...", e);
    }

    // 2. Firebase Fallback listener
    if (db) {
        db.ref('commissionSettings').once('value', (snapshot) => {
            const val = snapshot.val();
            if (val) {
                let ratesMap = globalState.globalRiderRates || {};
                Object.values(val).forEach(item => {
                    const name = (item.rider || item.Rider || "").toLowerCase().trim();
                    if (name) {
                        ratesMap[name] = {
                            percentage: parseFloat(item.percentage || item.Percentage || item.basePercentage) || 20,
                            promoLess: parseFloat(item.isPromoLessPerc || item.IsPromoLessPerc || item.promoLess) || 0
                        };
                    }
                });
                globalState.globalRiderRates = ratesMap;
                refreshCommissionView();
            }
        });
    }
}

export async function openCommissionScreen() {
    switchView('view-commission');
    
    // Set default dates if empty
    if (!document.getElementById('comm-input-daily').value) {
        const today = new Date();
        document.getElementById('comm-input-daily').value = getLocalTodayStr();
        document.getElementById('comm-input-weekly').value = getWeekString(today.getTime());
        document.getElementById('comm-input-monthly').value = getMonthString(today.getTime());
    }

    setupAdminControls();
    await fetchCommissionSettings();
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

    // 1. Intelligently merge Receipts and Catered History
    const mergedList = [];
    const processedKeys = new Set();

    (globalState.globalDailyReceipts || []).forEach(rc => {
        mergedList.push(rc);
        const key = `${(rc.riderName||'').toLowerCase()}_${(rc.customerName||'').toLowerCase()}_${rc.date||rc.completedDate}`;
        processedKeys.add(key);
    });

    (globalState.globalCateredHistory || []).forEach(ch => {
        const key = `${(ch.riderName||'').toLowerCase()}_${(ch.customerName||'').toLowerCase()}_${ch.completedDate||ch.date}`;
        if (!processedKeys.has(key)) {
            mergedList.push(ch);
        }
    });

    // 2. Filter Data by Date/Week/Month
    let filteredHistory = mergedList.filter(record => {
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

    // 3. Group Totals by Rider using Dynamic Rider Rates
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
        if (isNaN(gross) || gross === 0) {
            let f = r.fees;
            if (typeof f === 'string') {
                try { f = JSON.parse(f); } catch(e) { f = null; }
            }
            if (f) {
                const hf = parseFloat(f.handling) || 0;
                const mf = parseFloat(f.market) || 0;
                const ms = parseFloat(f.multistore || f.multistop) || 0;
                const rdf = parseFloat(f.delivery) || 0;
                const epay = parseFloat(f.epaymentFee) || 0;
                const disc = parseFloat(f.discount) || 0;
                gross = hf + mf + ms + rdf + epay - disc;
            } else {
                gross = 0;
            }
        }

        let rDate = r.date || r.completedDate || getLocalTodayStr();
        // Pass rider name dynamically into rate calculator
        const rates = getCommissionRates(rDate, rName);

        if (!riderTotals[rId]) {
            riderTotals[rId] = { name: rName, gross: 0, earned: 0, company: 0, lastRates: rates };
        }
        
        riderTotals[rId].gross += gross;
        riderTotals[rId].earned += (gross * rates.riderRate);
        riderTotals[rId].company += (gross * rates.companyRate);
        riderTotals[rId].lastRates = rates;
    });

    // 4. Filter down to Target Rider & Calculate Grand Totals
    let finalRiderList = [];
    let grandGross = 0;
    let grandEarned = 0;
    let grandCompany = 0;
    let selectedRiderRates = null;

    for (let rId in riderTotals) {
        if (targetRiderId && targetRiderId !== "ALL") {
            const myRoster = globalState.rosterMembers?.find(m => (m.telegramId || "").toString() === targetRiderId.toString());
            const targetName = myRoster ? (myRoster.riderName || myRoster.name || "").toLowerCase() : "";
            
            const isIdMatch = rId.toString() === targetRiderId.toString();
            const isNameMatch = targetName && riderTotals[rId].name.toLowerCase() === targetName;

            if (!isIdMatch && !isNameMatch) continue;
            selectedRiderRates = riderTotals[rId].lastRates;
        }
        
        finalRiderList.push({ id: rId, ...riderTotals[rId] });
        grandGross += riderTotals[rId].gross;
        grandEarned += riderTotals[rId].earned;
        grandCompany += riderTotals[rId].company;
    }

    // Fallback if target rider selected but has no history records today
    if (targetRiderId && targetRiderId !== "ALL" && !selectedRiderRates) {
        const myRoster = globalState.rosterMembers?.find(m => (m.telegramId || "").toString() === targetRiderId.toString());
        const rName = myRoster ? (myRoster.riderName || myRoster.name || "") : appState.riderName;
        selectedRiderRates = getCommissionRates(viewSettings.dateValue, rName);
    }

    // 5. Update UI Display with Dynamic Percentages
    const mainWrapperEl = document.getElementById('comm-main-wrapper');
    const mainLabelEl = document.getElementById('comm-main-label');
    const grossEl = document.getElementById('comm-gross-amount');
    const summaryTitleEl = document.getElementById('comm-summary-title');
    const mainAmountEl = document.getElementById('comm-main-amount');

    if (grossEl) grossEl.innerText = grandGross.toFixed(2);
    if (summaryTitleEl) summaryTitleEl.innerText = `${viewSettings.period.toUpperCase()} SUMMARY`;

    const selDate = new Date(viewSettings.dateValue + "T00:00:00");
    const isSelSunday = viewSettings.period === 'daily' && selDate.getDay() === 0;

    const displayRates = selectedRiderRates || getCommissionRates(viewSettings.dateValue, appState.riderName);

    if (viewSettings.mode === 'earned') {
        if (mainLabelEl) {
            mainLabelEl.innerText = isSelSunday 
                ? `YOUR EARNINGS (${displayRates.riderPerc}% SUNDAY PROMO)` 
                : `YOUR EARNINGS (${displayRates.riderPerc}%)`;
            mainLabelEl.className = "text-[10px] text-emerald-400 font-bold uppercase";
        }
        if (mainWrapperEl) mainWrapperEl.className = "text-4xl font-black text-emerald-400 drop-shadow-md";
        if (mainAmountEl) mainAmountEl.innerText = grandEarned.toFixed(2);
    } else {
        if (mainLabelEl) {
            mainLabelEl.innerText = isSelSunday 
                ? `TO PAY COMPANY (${displayRates.companyPerc}% SUNDAY PROMO)` 
                : `TO PAY COMPANY (${displayRates.companyPerc}%)`;
            mainLabelEl.className = "text-[10px] text-red-400 font-bold uppercase";
        }
        if (mainWrapperEl) mainWrapperEl.className = "text-4xl font-black text-red-400 drop-shadow-md";
        if (mainAmountEl) mainAmountEl.innerText = grandCompany.toFixed(2);
    }

    renderRiderSummaryList(finalRiderList);
    checkSettlementStatus(targetRiderId, viewSettings.period, viewSettings.dateValue, isAdmin);
}

function checkSettlementStatus(riderId, period, dateVal, isAdmin) {
    const badge = document.getElementById('comm-status-badge');
    const adminBtn = document.getElementById('admin-mark-paid-btn');
    
    if (!badge || !adminBtn) return;

    if (viewSettings.mode !== 'company' || !riderId) {
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

        let rDate = r.date || r.completedDate || getLocalTodayStr();
        const rates = getCommissionRates(rDate, rName);

        if (!riderTotals[rId]) {
            riderTotals[rId] = { name: rName, gross: 0, earned: 0, company: 0 };
        }
        riderTotals[rId].gross += gross;
        riderTotals[rId].earned += (gross * rates.riderRate);
        riderTotals[rId].company += (gross * rates.companyRate);
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
    const repDate = new Date(viewSettings.dateValue + "T00:00:00");
    const isRepSunday = viewSettings.period === 'daily' && repDate.getDay() === 0;
    
    let report = `📊 LOKALEX SETTLEMENT REPORT\n`;
    report += `Scope: ${targetRiderId && riderTotals[targetRiderId] ? riderTotals[targetRiderId]?.name : "ALL RIDERS"}\n`;
    report += `Period: ${periodLabel} (${viewSettings.dateValue})${isRepSunday ? ' 🎁 [SUNDAY 5% COMMISSION DISCOUNT]' : ''}\n`;
    report += `Mode: ${modeLabel}\n\n`;
    report += `💰 Gross Total: ₱${grandGross.toFixed(2)}\n`;
    report += `🟢 Rider Earned: ₱${grandEarned.toFixed(2)}\n`;
    report += `🔴 To Pay Company: ₱${grandCompany.toFixed(2)}\n\n`;
    report += `📋 RIDER BREAKDOWN:\n${listText || "No records found."}`;

    copyText(report);
    showToast("📄 Settlement text report copied!");
}

// Global window bindings
if (typeof window !== 'undefined') {
    window.openCommissionScreen = openCommissionScreen;
    window.setCommissionMode = setCommissionMode;
    window.setCommissionPeriod = setCommissionPeriod;
    window.refreshCommissionView = refreshCommissionView;
    window.toggleSettlementStatus = toggleSettlementStatus;
    window.generateDailyReportText = generateDailyReportText;
}

// Reactive UI updates
window.addEventListener('receiptsUpdated', refreshCommissionView);
window.addEventListener('cateredUpdated', refreshCommissionView);