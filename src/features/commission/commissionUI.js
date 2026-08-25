// src/features/commission/commissionUI.js
import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { getLocalTodayStr, copyText, getWeekString, getMonthString, escapeHtml } from '../../utils/helpers.js';
import { switchView } from '../../ui/router.js';
import { isAdmin as checkIsAdmin, getMergedDeduplicatedCommissionList, isSameDateStr, saveRosterCache } from '../roster/rosterUtils.js';
import { getCommissionRates, fetchCommissionSettings } from './commissionRates.js';

export let viewSettings = {
    mode: 'earned',
    period: 'daily',
    dateValue: getLocalTodayStr()
};

let isCommissionListenerActive = false;

export function initCommissionLiveListeners() {
    if (isCommissionListenerActive || !db) return;
    isCommissionListenerActive = true;

    db.ref('receipts').on('value', (snapshot) => {
        const val = snapshot.val();
        if (val) {
            globalState.globalDailyReceipts = Object.entries(val).map(([k, v]) => ({
                id: k,
                transactionId: v.transactionId || k,
                ...v
            }));
        } else {
            globalState.globalDailyReceipts = [];
        }
        saveRosterCache();
        refreshCommissionView();
        window.dispatchEvent(new CustomEvent('rosterUpdated'));
    });

    db.ref('cateredHistory').on('value', (snapshot) => {
        const val = snapshot.val();
        if (val) {
            globalState.globalCateredHistory = Object.entries(val).map(([k, v]) => ({
                id: k,
                transactionId: v.transactionId || k,
                ...v
            }));
        } else {
            globalState.globalCateredHistory = [];
        }
        saveRosterCache();
        refreshCommissionView();
        window.dispatchEvent(new CustomEvent('rosterUpdated'));
    });
}

initCommissionLiveListeners();

export async function fetchCommissionData() {
    if (!db) return;
    try {
        const [rcptSnap, catSnap] = await Promise.all([
            db.ref('receipts').once('value'),
            db.ref('cateredHistory').once('value')
        ]);

        const rcptVal = rcptSnap.val();
        if (rcptVal) {
            globalState.globalDailyReceipts = Object.entries(rcptVal).map(([k, v]) => ({
                id: k,
                transactionId: v.transactionId || k,
                ...v
            }));
        }

        const catVal = catSnap.val();
        if (catVal) {
            globalState.globalCateredHistory = Object.entries(catVal).map(([k, v]) => ({
                id: k,
                transactionId: v.transactionId || k,
                ...v
            }));
        }

        saveRosterCache();
    } catch (e) {
        console.warn("Could not fetch commission records:", e);
    }
}

export function getCleanRiderList() {
    let riderMap = new Map();

    const addRider = (rawName) => {
        if (!rawName) return;
        const clean = rawName.toString().trim();
        const lower = clean.toLowerCase();
        if (!lower || lower.includes("sample") || lower.includes("plesam") || lower.includes("test")) return;
        if (!riderMap.has(lower)) {
            riderMap.set(lower, clean);
        }
    };

    (globalState.rosterMembers || []).forEach(r => addRider(r.riderName || r.name));
    (globalState.globalCateredHistory || []).forEach(h => addRider(h.riderName));
    (globalState.globalDailyReceipts || []).forEach(rc => addRider(rc.riderName));
    if (globalState.globalRiderRates) {
        Object.keys(globalState.globalRiderRates).forEach(nameKey => addRider(nameKey));
    }

    return Array.from(riderMap.values()).sort((a, b) => a.localeCompare(b));
}

export function setupAdminControls() {
    const isAdmin = checkIsAdmin(); 
    const filterBox = document.getElementById('admin-commission-filter-box');
    const select = document.getElementById('admin-rider-select');
    
    if (isAdmin && filterBox && select) {
        filterBox.classList.remove('hidden');
        filterBox.classList.add('flex');
        
        const cleanRiders = getCleanRiderList();
        let currentSelected = select.value || "ALL";
        
        let options = `<option value="ALL">All Riders (Combined)</option>`;
        cleanRiders.forEach(name => {
            const isSelected = currentSelected === name ? "selected" : "";
            options += `<option value="${escapeHtml(name)}" ${isSelected}>${escapeHtml(name)}</option>`;
        });
        
        select.innerHTML = options;
        select.value = currentSelected;
        select.onchange = () => refreshCommissionView();

        let addBtn = document.getElementById('admin-add-comm-btn');
        if (!addBtn) {
            const btnHtml = `
            <div class="flex gap-2 mt-2">
                <button id="admin-add-comm-btn" onclick="promptAdminAddCommissionRecord()" class="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-600/30 dark:hover:bg-emerald-600 dark:text-emerald-300 dark:border-emerald-500/50 text-[11px] font-bold py-2 px-2 rounded-xl transition active:scale-95 flex items-center justify-center gap-1 shadow-xs">
                    <i class="fa-solid fa-plus-circle"></i> + Manual Record
                </button>
                <button id="admin-add-penalty-btn" onclick="openAdminPenaltyModal()" class="flex-1 bg-red-50 hover:bg-red-100 text-red-800 border border-red-300 dark:bg-red-600/30 dark:hover:bg-red-600 dark:text-red-300 dark:border-red-500/50 text-[11px] font-bold py-2 px-2 rounded-xl transition active:scale-95 flex items-center justify-center gap-1 shadow-xs">
                    <i class="fa-solid fa-gavel"></i> + Date Penalty
                </button>
            </div>`;
            filterBox.insertAdjacentHTML('beforeend', btnHtml);
        }
    } else if (filterBox) {
        filterBox.classList.add('hidden');
        filterBox.classList.remove('flex');
    }
}

export function setCommissionMode(mode) {
    viewSettings.mode = mode;
    
    const btnEarned = document.getElementById('comm-mode-earned');
    const btnCompany = document.getElementById('comm-mode-company');
    
    if (mode === 'earned') {
        if (btnEarned) btnEarned.className = "flex-1 py-2 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-300 dark:bg-emerald-600/20 dark:text-emerald-400 dark:border-emerald-500/50 font-black transition shadow-xs";
        if (btnCompany) btnCompany.className = "flex-1 py-2 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-bold transition";
    } else {
        if (btnCompany) btnCompany.className = "flex-1 py-2 rounded-lg bg-red-50 text-red-800 border border-red-300 dark:bg-red-600/20 dark:text-red-400 dark:border-red-500/50 font-black transition shadow-xs";
        if (btnEarned) btnEarned.className = "flex-1 py-2 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-bold transition";
    }
    
    refreshCommissionView();
}

export function setCommissionPeriod(period) {
    viewSettings.period = period;
    
    ['daily', 'weekly', 'monthly'].forEach(p => {
        const btn = document.getElementById(`comm-period-${p}`);
        const input = document.getElementById(`comm-input-${p}`);
        if (p === period) {
            if (btn) btn.className = "py-1.5 rounded-lg bg-blue-600 text-white font-bold transition shadow";
            if (input) input.classList.remove('hidden');
        } else {
            if (btn) btn.className = "py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-bold transition";
            if (input) input.classList.add('hidden');
        }
    });

    refreshCommissionView();
}

export function refreshCommissionView() {
    const isUserAdmin = checkIsAdmin();
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    let targetRiderFilter = null;
    if (isUserAdmin) {
        const adminSelect = document.getElementById('admin-rider-select');
        targetRiderFilter = adminSelect ? adminSelect.value : "ALL";
    } else {
        targetRiderFilter = myId || myName;
    }

    if (targetRiderFilter === "ALL") targetRiderFilter = null;

    const dateInput = document.getElementById(`comm-input-${viewSettings.period}`);
    if (dateInput && dateInput.value) {
        viewSettings.dateValue = dateInput.value;
    }
    if (!viewSettings.dateValue) {
        viewSettings.dateValue = getLocalTodayStr();
    }

    const mergedList = getMergedDeduplicatedCommissionList();

    let filteredHistory = mergedList.filter(record => {
        let rDate = record.date || record.completedDate;
        if (!rDate) return false;
        
        if (viewSettings.period === 'daily') {
            return isSameDateStr(rDate, viewSettings.dateValue);
        }
        if (viewSettings.period === 'weekly') {
            const d = new Date(rDate.includes('-') || rDate.includes('/') ? rDate : Number(rDate));
            return getWeekString(d.getTime()) === viewSettings.dateValue;
        }
        if (viewSettings.period === 'monthly') {
            return String(rDate).substring(0, 7) === String(viewSettings.dateValue).substring(0, 7);
        }
        return false;
    });

    let riderTotals = {}; 

    filteredHistory.forEach(r => {
        let rId = (r.telegramId || "").toString().trim();
        let rName = r.riderName || "Unknown Rider";
        let cName = r.customerName || "Customer";
        let rDate = r.date || r.completedDate;

        if (!rId) {
            const rosterRec = globalState.rosterMembers?.find(mem => (mem.riderName || mem.name || "").toLowerCase() === rName.toLowerCase());
            if (rosterRec && rosterRec.telegramId) rId = rosterRec.telegramId.toString();
            else rId = rName.toLowerCase();
        }

        let gross = parseFloat(r.totalFees) || 0;
        const rates = getCommissionRates(rDate, rName, rId);

        const earnedAmt = gross * rates.riderRate;
        const companyAmt = gross * rates.companyRate;

        if (!riderTotals[rId]) {
            riderTotals[rId] = { name: rName, gross: 0, earned: 0, company: 0, lastRates: rates, customers: [] };
        }
        
        riderTotals[rId].gross += gross;
        riderTotals[rId].earned += earnedAmt;
        riderTotals[rId].company += companyAmt;
        riderTotals[rId].lastRates = rates;

        riderTotals[rId].customers.push({
            customerName: cName,
            date: rDate,
            time: r.time || "",
            gross: gross,
            earned: earnedAmt,
            company: companyAmt,
            transactionId: r.transactionId || ""
        });
    });

    let finalRiderList = [];
    let grandGross = 0;
    let grandEarned = 0;
    let grandCompany = 0;
    let selectedRiderRates = null;

    for (let rId in riderTotals) {
        if (riderTotals[rId].gross <= 0 || riderTotals[rId].customers.length === 0) continue;

        if (targetRiderFilter && targetRiderFilter !== "ALL") {
            const cleanTarget = targetRiderFilter.toString().trim().toLowerCase();
            const rIdClean = rId.toString().trim().toLowerCase();
            const rNameClean = (riderTotals[rId].name || "").toString().trim().toLowerCase();

            const targetRoster = (globalState.rosterMembers || []).find(m => 
                (m.telegramId || "").toString().trim().toLowerCase() === cleanTarget ||
                (m.riderName || m.name || "").toString().trim().toLowerCase() === cleanTarget
            );
            const targetRosterId = targetRoster ? (targetRoster.telegramId || "").toString().trim().toLowerCase() : "";
            const targetRosterName = targetRoster ? (targetRoster.riderName || targetRoster.name || "").toString().trim().toLowerCase() : "";

            const isIdMatch = (cleanTarget && rIdClean === cleanTarget) || (targetRosterId && rIdClean === targetRosterId) || (myId && rIdClean === myId.toLowerCase());
            const isNameMatch = (cleanTarget && rNameClean === cleanTarget) || (targetRosterName && rNameClean === targetRosterName) || (myName && rNameClean === myName);

            if (!isIdMatch && !isNameMatch) continue;
            selectedRiderRates = riderTotals[rId].lastRates;
        }
        
        finalRiderList.push({ id: rId, ...riderTotals[rId] });
        grandGross += riderTotals[rId].gross;
        grandEarned += riderTotals[rId].earned;
        grandCompany += riderTotals[rId].company;
    }

    if (targetRiderFilter && targetRiderFilter !== "ALL" && !selectedRiderRates) {
        const myRoster = globalState.rosterMembers?.find(m => (m.telegramId || "").toString() === targetRiderFilter.toString());
        const rName = myRoster ? (myRoster.riderName || myRoster.name || "") : (appState.riderName || myName);
        selectedRiderRates = getCommissionRates(viewSettings.dateValue, rName, targetRiderFilter);
    }

    const mainWrapperEl = document.getElementById('comm-main-wrapper');
    const mainLabelEl = document.getElementById('comm-main-label');
    const grossEl = document.getElementById('comm-gross-amount');
    const summaryTitleEl = document.getElementById('comm-summary-title');
    const mainAmountEl = document.getElementById('comm-main-amount');

    if (grossEl) grossEl.innerText = grandGross.toFixed(2);
    if (summaryTitleEl) summaryTitleEl.innerText = `${viewSettings.period.toUpperCase()} SUMMARY`;

    const displayRates = selectedRiderRates || getCommissionRates(viewSettings.dateValue, appState.riderName, appState.telegramId);
    let penaltyNotice = displayRates.penaltyPerc > 0 ? ` (+${displayRates.penaltyPerc}% Penalty)` : '';
    let promoNotice = displayRates.promoDiscountPerc > 0 ? ` (-${displayRates.promoDiscountPerc}% Promo Less)` : '';

    if (viewSettings.mode === 'earned') {
        if (mainLabelEl) {
            mainLabelEl.innerText = `YOUR EARNINGS (${displayRates.riderPerc}% Rate${penaltyNotice}${promoNotice})`;
            mainLabelEl.className = "text-[10px] text-emerald-700 dark:text-emerald-400 font-bold uppercase";
        }
        if (mainWrapperEl) mainWrapperEl.className = "text-4xl font-black text-emerald-600 dark:text-emerald-400 drop-shadow-md";
        if (mainAmountEl) mainAmountEl.innerText = grandEarned.toFixed(2);
    } else {
        if (mainLabelEl) {
            mainLabelEl.innerText = displayRates.isAdmin ? `TO PAY COMPANY (ADMIN EXEMPT)` : `TO PAY COMPANY (${displayRates.companyPerc}% Rate${penaltyNotice}${promoNotice})`;
            mainLabelEl.className = "text-[10px] text-red-700 dark:text-red-400 font-bold uppercase";
        }
        if (mainWrapperEl) mainWrapperEl.className = "text-4xl font-black text-red-600 dark:text-red-400 drop-shadow-md";
        if (mainAmountEl) mainAmountEl.innerText = grandCompany.toFixed(2);
    }

    renderRiderSummaryList(finalRiderList);
    checkSettlementStatus(targetRiderFilter, viewSettings.period, viewSettings.dateValue, isUserAdmin);
}

export function checkSettlementStatus(riderId, period, dateVal, isAdmin) {
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
                adminBtn.className = "w-full bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-300 font-black py-3 rounded-xl text-xs transition active:scale-95 shadow mt-1 border border-gray-300 dark:border-gray-700";
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
    const riderId = select ? select.value : (appState.telegramId || appState.riderName);
    const dateVal = viewSettings.dateValue || getLocalTodayStr();
    const settlementKey = `${riderId}_${viewSettings.period}_${dateVal}`;
    
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

export function toggleRiderCustomerBreakdown(uid) {
    const box = document.getElementById(`box-${uid}`);
    const icon = document.getElementById(`icon-${uid}`);
    if (box) box.classList.toggle('hidden');
    if (icon) {
        icon.style.transform = box.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
    }
}

export function renderRiderSummaryList(riderListArray) {
    const container = document.getElementById('commission-rider-list');
    if (!container) return;
    
    if (riderListArray.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic text-xs py-10">No active commission records for this period.</div>`;
        return;
    }

    const isAdmin = checkIsAdmin();

    container.innerHTML = riderListArray.map((rider, idx) => {
        const rates = rider.lastRates || getCommissionRates(viewSettings.dateValue, rider.name, rider.id);
        
        let amountLabel = "";
        let colorClass = "";

        if (viewSettings.mode === 'earned') {
            amountLabel = `+ ₱${rider.earned.toFixed(2)}`;
            colorClass = "text-emerald-700 dark:text-emerald-400";
        } else {
            if (rates.isAdmin) {
                amountLabel = `- ₱0.00 (Admin Exempt)`;
                colorClass = "text-gray-500 dark:text-gray-400";
            } else {
                amountLabel = `- ₱${rider.company.toFixed(2)}`;
                colorClass = "text-red-700 dark:text-red-400";
            }
        }

        const uid = `comm-rider-cust-${idx}`;
        const customerCount = rider.customers ? rider.customers.length : 0;

        let customerItemsHtml = "";
        if (customerCount > 0) {
            customerItemsHtml = rider.customers.map(c => {
                let cAmt = viewSettings.mode === 'earned' 
                    ? `+ ₱${c.earned.toFixed(2)}` 
                    : (rates.isAdmin ? `- ₱0.00 (Exempt)` : `- ₱${c.company.toFixed(2)}`);
                    
                let dateTimeStr = c.date;
                if (c.time) dateTimeStr += ` • ${c.time}`;

                const editBtn = isAdmin 
                    ? `<button onclick="event.stopPropagation(); promptAdminEditCustomerFee('${escapeHtml(rider.name)}', '${escapeHtml(c.customerName)}', '${c.date}', ${c.gross})" class="text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 ml-1.5 p-0.5" title="Edit Fee"><i class="fa-solid fa-pen text-[10px]"></i></button>` 
                    : ``;

                const deleteBtn = isAdmin 
                    ? `<button onclick="event.stopPropagation(); promptAdminDeleteCommissionRecord('${escapeHtml(rider.name)}', '${escapeHtml(c.customerName)}', '${c.date}', '${c.transactionId}')" class="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 ml-1 p-0.5" title="Delete Record"><i class="fa-solid fa-trash text-[10px]"></i></button>` 
                    : ``;

                return `
                <div class="bg-white dark:bg-zinc-900/90 p-2.5 rounded-xl border border-gray-200 dark:border-zinc-700/60 flex justify-between items-center text-xs shadow-xs">
                    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                        <span class="font-black text-xs text-orange-700 dark:text-orange-400 flex items-center gap-1.5 truncate">
                            <i class="fa-solid fa-user text-[10px]"></i> ${escapeHtml(c.customerName)} ${editBtn} ${deleteBtn}
                        </span>
                        <span class="text-[10px] text-gray-500 dark:text-gray-300 font-mono font-medium">${escapeHtml(dateTimeStr)}</span>
                    </div>
                    <div class="text-right shrink-0">
                        <div class="font-black ${colorClass}">${cAmt}</div>
                        <div class="text-[9px] text-gray-600 dark:text-gray-200 font-mono font-bold">Paid: ₱${c.gross.toFixed(2)}</div>
                    </div>
                </div>`;
            }).join('');
        } else {
            customerItemsHtml = `<div class="text-gray-500 italic text-[11px] py-2 text-center">No individual orders recorded.</div>`;
        }

        const adminBadge = rates.isAdmin ? `<span class="bg-purple-50 dark:bg-purple-600/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30 text-[9px] font-black px-1.5 py-0.5 rounded ml-1">ADMIN</span>` : '';

        const penaltyBadge = rates.penaltyPerc > 0 
            ? `<div class="flex items-center justify-between bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-500/40 px-2.5 py-1 rounded-xl text-[10px] text-red-700 dark:text-red-300 font-bold my-1 shadow-xs">
                <span><i class="fa-solid fa-gavel text-red-600 dark:text-red-400"></i> Date Penalty Active (+${rates.penaltyPerc}% to Company)</span>
                ${isAdmin ? `<button onclick="event.stopPropagation(); removeAdminPenalty('${escapeHtml(rider.name)}', '${viewSettings.dateValue}')" class="text-red-800 dark:text-white hover:underline ml-2 font-black"><i class="fa-solid fa-trash"></i> Remove</button>` : ''}
               </div>`
            : '';

        const promoBadge = rates.promoDiscountPerc > 0
            ? `<div class="flex items-center justify-between bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-500/40 px-2.5 py-1 rounded-xl text-[10px] text-emerald-800 dark:text-emerald-300 font-bold my-1 shadow-xs">
                <span><i class="fa-solid fa-tags text-emerald-600 dark:text-emerald-400"></i> Special Promo Active (-${rates.promoDiscountPerc}% Commission Less)</span>
               </div>`
            : '';

        return `
            <div class="bg-white dark:bg-cardBg rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs flex flex-col overflow-hidden">
                <div onclick="toggleRiderCustomerBreakdown('${uid}')" class="p-3.5 flex justify-between items-center text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition select-none">
                    <div class="flex items-center gap-2">
                        <span class="font-black text-xs text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                            <i class="fa-solid fa-motorcycle text-gray-500"></i> ${escapeHtml(rider.name)} ${adminBadge}
                        </span>
                        <span class="bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-500/30">
                            ${customerCount} ${customerCount === 1 ? 'customer' : 'customers'}
                        </span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="font-black ${colorClass}">${amountLabel}</span>
                        <i id="icon-${uid}" class="fa-solid fa-chevron-down text-gray-400 text-xs transition-transform duration-300"></i>
                    </div>
                </div>

                <div id="box-${uid}" class="hidden bg-gray-50 dark:bg-zinc-950/80 p-3 border-t border-gray-200 dark:border-gray-800/80 flex flex-col gap-2">
                    ${penaltyBadge}
                    ${promoBadge}
                    <div class="text-[10px] text-amber-700 dark:text-amber-400 font-bold uppercase tracking-wider mb-1 flex items-center justify-between">
                        <span><i class="fa-solid fa-list-check"></i> Customer Breakdown (${viewSettings.period.toUpperCase()})</span>
                        <span class="text-gray-700 dark:text-gray-200 font-mono font-black">Total Paid: ₱${rider.gross.toFixed(2)}</span>
                    </div>
                    ${customerItemsHtml}
                </div>
            </div>
        `;
    }).join('');
}

export function generateDailyReportText() {
    const isUserAdmin = checkIsAdmin();
    let targetRiderFilter = isUserAdmin ? document.getElementById('admin-rider-select')?.value : (appState.telegramId || appState.riderName);
    if (targetRiderFilter === "ALL") targetRiderFilter = null;

    const mergedList = getMergedDeduplicatedCommissionList();

    let filteredHistory = mergedList.filter(record => {
        let rDate = record.date || record.completedDate;
        if (!rDate) return false;
        if (viewSettings.period === 'daily') return isSameDateStr(rDate, viewSettings.dateValue);
        if (viewSettings.period === 'weekly') {
            const d = new Date(rDate.includes('-') || rDate.includes('/') ? rDate : Number(rDate));
            return getWeekString(d.getTime()) === viewSettings.dateValue;
        }
        if (viewSettings.period === 'monthly') return String(rDate).substring(0, 7) === String(viewSettings.dateValue).substring(0, 7);
        return false;
    });

    let riderTotals = {}; 
    filteredHistory.forEach(r => {
        let rId = (r.telegramId || "").toString().trim();
        let rName = r.riderName || "Unknown";
        let cName = r.customerName || "Customer";
        let rDate = r.date || r.completedDate;

        if (!rId) {
            const rosterRec = globalState.rosterMembers?.find(mem => (mem.riderName || mem.name || "").toLowerCase() === rName.toLowerCase());
            if (rosterRec && rosterRec.telegramId) rId = rosterRec.telegramId.toString();
            else rId = rName.toLowerCase();
        }

        let gross = parseFloat(r.totalFees) || 0;
        const rates = getCommissionRates(rDate, rName, rId);

        if (!riderTotals[rId]) {
            riderTotals[rId] = { name: rName, gross: 0, earned: 0, company: 0, lastRates: rates };
        }
        riderTotals[rId].gross += gross;
        riderTotals[rId].earned += (gross * rates.riderRate);
        riderTotals[rId].company += (gross * rates.companyRate);
        riderTotals[rId].lastRates = rates;
    });

    let grandGross = 0; let grandEarned = 0; let grandCompany = 0;
    let listText = "";

    for (let rId in riderTotals) {
        if (riderTotals[rId].gross <= 0) continue;

        if (targetRiderFilter && targetRiderFilter !== "ALL") {
            const cleanTarget = targetRiderFilter.toString().trim().toLowerCase();
            const rIdClean = rId.toString().trim().toLowerCase();
            const rNameClean = (riderTotals[rId].name || "").toString().trim().toLowerCase();

            const targetRoster = (globalState.rosterMembers || []).find(m => 
                (m.telegramId || "").toString().trim().toLowerCase() === cleanTarget ||
                (m.riderName || m.name || "").toString().trim().toLowerCase() === cleanTarget
            );
            const targetRosterId = targetRoster ? (targetRoster.telegramId || "").toString().trim().toLowerCase() : "";
            const targetRosterName = targetRoster ? (targetRoster.riderName || targetRoster.name || "").toString().trim().toLowerCase() : "";

            const isIdMatch = (cleanTarget && rIdClean === cleanTarget) || (targetRosterId && rIdClean === targetRosterId);
            const isNameMatch = (cleanTarget && rNameClean === cleanTarget) || (targetRosterName && rNameClean === targetRosterName);

            if (!isIdMatch && !isNameMatch) continue;
        }

        const rates = riderTotals[rId].lastRates || getCommissionRates(viewSettings.dateValue, riderTotals[rId].name, rId);
        
        grandGross += riderTotals[rId].gross;
        grandEarned += riderTotals[rId].earned;
        grandCompany += riderTotals[rId].company;

        let displayAmount = "";
        if (viewSettings.mode === 'earned') {
            displayAmount = `₱${riderTotals[rId].earned.toFixed(2)} (${rates.riderPerc}%)`;
        } else {
            if (rates.isAdmin) {
                displayAmount = `₱0.00 (Admin Exempt)`;
            } else {
                displayAmount = `₱${riderTotals[rId].company.toFixed(2)} (${rates.companyPerc}%)`;
            }
        }
        listText += `• ${riderTotals[rId].name}: ${displayAmount}\n`;
    }

    const periodLabel = viewSettings.period.toUpperCase();

    let report = `📊 LOKALEX SETTLEMENT REPORT\n`;
    report += `Scope: ${targetRiderFilter && riderTotals[targetRiderFilter] ? riderTotals[targetRiderFilter]?.name : "ALL RIDERS"}\n`;
    report += `Period: ${periodLabel} (${viewSettings.dateValue})\n`;
    report += `Mode: ${viewSettings.mode === 'earned' ? 'RIDER EARNINGS' : 'TO PAY COMPANY'}\n\n`;
    report += `💰 Gross Total: ₱${grandGross.toFixed(2)}\n`;
    report += `🟢 Rider Earned: ₱${grandEarned.toFixed(2)}\n`;
    report += `🔴 To Pay Company: ₱${grandCompany.toFixed(2)}\n\n`;
    report += `📋 RIDER BREAKDOWN:\n${listText || "No records found."}`;

    copyText(report);
    showToast("📄 Settlement text report copied!");
}

export async function openCommissionScreen() {
    switchView('view-commission');
    
    const today = new Date();
    const todayStr = getLocalTodayStr();

    const dailyInput = document.getElementById('comm-input-daily');
    const weeklyInput = document.getElementById('comm-input-weekly');
    const monthlyInput = document.getElementById('comm-input-monthly');

    if (dailyInput && !dailyInput.value) {
        dailyInput.value = todayStr;
        dailyInput.onchange = () => refreshCommissionView();
    }
    if (weeklyInput && !weeklyInput.value) {
        weeklyInput.value = getWeekString(today.getTime());
        weeklyInput.onchange = () => refreshCommissionView();
    }
    if (monthlyInput && !monthlyInput.value) {
        monthlyInput.value = getMonthString(today.getTime());
        monthlyInput.onchange = () => refreshCommissionView();
    }

    if (!viewSettings.dateValue) viewSettings.dateValue = todayStr;

    initCommissionLiveListeners();
    setupAdminControls();
    await fetchCommissionSettings();
    await fetchCommissionData();
    refreshCommissionView();
}