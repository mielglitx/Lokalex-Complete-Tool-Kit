// src/features/commission/commissionUI.js

/**
 * ============================================================================
 * COMMISSION UI, LEDGER AGGREGATION & EARLY SHIFT BREAKDOWN
 * ============================================================================
 */

import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { getLocalTodayStr, copyText, getWeekString, getMonthString, escapeHtml } from '../../utils/helpers.js';
import { switchView } from '../../ui/router.js';
import { isAdmin as checkIsAdmin, getMergedDeduplicatedCommissionList, isSameDateStr, normalizeToDateStr, saveRosterCache, isRiderMatch, invalidateRosterGrossCache } from '../roster/rosterUtils.js';
import { getCommissionRates, fetchCommissionSettings, overtimeReward } from './commissionRates.js';

export let viewSettings = {
    mode: 'earned',
    period: 'daily',
    dateValue: getLocalTodayStr()
};

let isCommissionListenerActive = false;
let activeListenerDate = "";

function normalizeDateStr(d) {
    if (!d) return '';
    const str = String(d).trim().split('T')[0];
    if (str.includes('/')) {
        const parts = str.split('/');
        if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        if (parts[2].length === 4) return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
    }
    return str;
}

export function initCommissionLiveListeners() {
    if (!db) return;

    const todayStr = getLocalTodayStr();
    if (isCommissionListenerActive && activeListenerDate === todayStr) return;

    isCommissionListenerActive = true;
    activeListenerDate = todayStr;

    db.ref('receipts')
        .orderByChild('date')
        .equalTo(todayStr)
        .on('value', (snapshot) => {
            const val = snapshot.val();
            const todayRecords = val ? Object.entries(val).map(([k, v]) => ({
                id: k,
                transactionId: v.transactionId || k,
                ...v
            })).filter(r => r.status !== 'voided' && !r.voided && !r.isVoided) : [];

            // Replace today's slice cleanly so voided/deleted receipts are immediately purged on all clients
            const otherDayReceipts = (globalState.globalDailyReceipts || []).filter(r => {
                const rDate = r.date || (r.timestamp ? new Date(r.timestamp).toISOString().split('T')[0] : null);
                return rDate && rDate !== todayStr;
            });
            globalState.globalDailyReceipts = [...otherDayReceipts, ...todayRecords];

            invalidateRosterGrossCache();
            saveRosterCache();
            refreshCommissionView();
            window.dispatchEvent(new CustomEvent('receiptsUpdated'));
            window.dispatchEvent(new CustomEvent('rosterUpdated'));
        });

    db.ref('cateredHistory')
        .orderByChild('completedDate')
        .equalTo(todayStr)
        .on('value', (snapshot) => {
            const val = snapshot.val();
            const todayCatered = val ? Object.entries(val).map(([k, v]) => ({
                id: k,
                transactionId: v.transactionId || k,
                ...v
            })).filter(h => h.status !== 'voided' && !h.voided && !h.isVoided) : [];

            // Replace today's slice cleanly so voided/deleted history is immediately purged on all clients
            const otherDayHistory = (globalState.globalCateredHistory || []).filter(h => {
                const hDate = h.completedDate || h.date || (h.timestamp ? new Date(h.timestamp).toISOString().split('T')[0] : null);
                return hDate && hDate !== todayStr;
            });
            globalState.globalCateredHistory = [...otherDayHistory, ...todayCatered];

            invalidateRosterGrossCache();
            saveRosterCache();
            refreshCommissionView();
            window.dispatchEvent(new CustomEvent('cateredUpdated'));
            window.dispatchEvent(new CustomEvent('rosterUpdated'));
        });
}

initCommissionLiveListeners();

export async function fetchCommissionData(specificDate = null) {
    if (!db) return;
    try {
        const period = viewSettings.period || 'daily';
        const dateVal = specificDate || viewSettings.dateValue || getLocalTodayStr();

        let rcptPromise, catPromise;

        if (period === 'monthly') {
            const prefix = String(dateVal).substring(0, 7);
            const startStr = `${prefix}-01`;
            const endStr = `${prefix}-31`;
            rcptPromise = db.ref('receipts').orderByChild('date').startAt(startStr).endAt(endStr).once('value');
            catPromise = db.ref('cateredHistory').orderByChild('completedDate').startAt(startStr).endAt(endStr).once('value');
        } else if (period === 'weekly') {
            rcptPromise = db.ref('receipts').limitToLast(250).once('value');
            catPromise = db.ref('cateredHistory').limitToLast(250).once('value');
        } else {
            // Daily (default)
            const todayStr = getLocalTodayStr();
            const targetDate = (dateVal && dateVal.length === 10) ? dateVal : todayStr;
            rcptPromise = db.ref('receipts').orderByChild('date').equalTo(targetDate).once('value');
            catPromise = db.ref('cateredHistory').orderByChild('completedDate').equalTo(targetDate).once('value');
        }

        const [rcptSnap, catSnap] = await Promise.all([rcptPromise, catPromise]);

        const rcptVal = rcptSnap.val();
        if (rcptVal) {
            const newReceipts = Object.entries(rcptVal).map(([k, v]) => ({
                id: k,
                transactionId: v.transactionId || k,
                ...v
            })).filter(r => r.status !== 'voided' && !r.voided && !r.isVoided);

            const map = new Map();
            (globalState.globalDailyReceipts || []).forEach(r => map.set(r.transactionId || r.id, r));
            newReceipts.forEach(r => map.set(r.transactionId || r.id, r));
            globalState.globalDailyReceipts = Array.from(map.values());
        }

        const catVal = catSnap.val();
        if (catVal) {
            const newCatered = Object.entries(catVal).map(([k, v]) => ({
                id: k,
                transactionId: v.transactionId || k,
                ...v
            })).filter(h => h.status !== 'voided' && !h.voided && !h.isVoided);

            const map = new Map();
            (globalState.globalCateredHistory || []).forEach(h => map.set(h.transactionId || h.id, h));
            newCatered.forEach(h => map.set(h.transactionId || h.id, h));
            globalState.globalCateredHistory = Array.from(map.values());
        }

        invalidateRosterGrossCache();
        saveRosterCache();
        window.dispatchEvent(new CustomEvent('cateredUpdated'));
        window.dispatchEvent(new CustomEvent('receiptsUpdated'));
        window.dispatchEvent(new CustomEvent('rosterUpdated'));
    } catch (e) {
        console.warn("Could not fetch commission records:", e);
    }
}

export function getCleanRiderList() {
    const list = [];

    const findExisting = (name, id) => {
        return list.find(r => isRiderMatch(r.name, name, r.id, id));
    };

    (globalState.rosterMembers || []).forEach(r => {
        const name = (r.riderName || r.name || "").trim();
        const id = (r.telegramId || r.id || "").toString().trim();
        if (!name) return;
        const lower = name.toLowerCase();
        if (lower.includes("sample") || lower.includes("plesam") || lower.includes("test")) return;

        const existing = findExisting(name, id);
        if (!existing) {
            list.push({ name, id });
        } else if (!existing.id && id) {
            existing.id = id;
        }
    });

    (globalState.globalCateredHistory || []).forEach(h => {
        const name = (h.riderName || "").trim();
        const id = (h.telegramId || h.riderId || "").toString().trim();
        if (!name) return;
        const lower = name.toLowerCase();
        if (lower.includes("sample") || lower.includes("plesam") || lower.includes("test")) return;

        const existing = findExisting(name, id);
        if (!existing) {
            list.push({ name, id });
        } else if (!existing.id && id) {
            existing.id = id;
        }
    });

    (globalState.globalDailyReceipts || []).forEach(rc => {
        const name = (rc.riderName || "").trim();
        const id = (rc.telegramId || rc.riderId || "").toString().trim();
        if (!name) return;
        const lower = name.toLowerCase();
        if (lower.includes("sample") || lower.includes("plesam") || lower.includes("test")) return;

        const existing = findExisting(name, id);
        if (!existing) {
            list.push({ name, id });
        } else if (!existing.id && id) {
            existing.id = id;
        }
    });

    if (globalState.globalRiderRates) {
        Object.keys(globalState.globalRiderRates).forEach(nameKey => {
            const name = nameKey.trim();
            if (!name) return;
            const lower = name.toLowerCase();
            if (lower.includes("sample") || lower.includes("plesam") || lower.includes("test")) return;

            const existing = findExisting(name, "");
            if (!existing) {
                list.push({ name, id: "" });
            }
        });
    }

    return list.map(r => r.name).sort((a, b) => a.localeCompare(b));
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
            const isSelected = (currentSelected === name) ? "selected" : "";
            options += `<option value="${escapeHtml(name)}" ${isSelected}>${escapeHtml(name)}</option>`;
        });
        
        select.innerHTML = options;
        select.value = currentSelected;
        select.onchange = () => refreshCommissionView();

        let addBtn = document.getElementById('admin-add-comm-btn');
        if (!addBtn) {
            const btnHtml = `
            <div class="flex gap-2 mt-2">
                <button id="admin-add-comm-btn" onclick="promptAdminAddCommissionRecord()" class="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-600/30 dark:hover:bg-emerald-600 dark:text-emerald-300 dark:border-emerald-500/50 text-[11px] font-bold py-2 px-2 rounded-xl transition active:scale-95 flex items-center justify-center gap-1 shadow-xs cursor-pointer">
                    <i class="fa-solid fa-plus-circle"></i> + Manual Record
                </button>
                <button id="admin-add-penalty-btn" onclick="openAdminPenaltyModal()" class="flex-1 bg-red-50 hover:bg-red-100 text-red-800 border border-red-300 dark:bg-red-600/30 dark:hover:bg-red-600 dark:text-red-300 dark:border-red-500/50 text-[11px] font-bold py-2 px-2 rounded-xl transition active:scale-95 flex items-center justify-center gap-1 shadow-xs cursor-pointer">
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
        if (btnEarned) btnEarned.className = "flex-1 py-2 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-300 dark:bg-emerald-600/20 dark:text-emerald-400 dark:border-emerald-500/50 font-black transition shadow-xs cursor-pointer";
        if (btnCompany) btnCompany.className = "flex-1 py-2 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-bold transition cursor-pointer";
    } else {
        if (btnCompany) btnCompany.className = "flex-1 py-2 rounded-lg bg-red-50 text-red-800 border border-red-300 dark:bg-red-600/20 dark:text-red-400 dark:border-red-500/50 font-black transition shadow-xs cursor-pointer";
        if (btnEarned) btnEarned.className = "flex-1 py-2 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-bold transition cursor-pointer";
    }
    
    refreshCommissionView();
}

export function setCommissionPeriod(period) {
    viewSettings.period = period;
    
    ['daily', 'weekly', 'monthly'].forEach(p => {
        const btn = document.getElementById(`comm-period-${p}`);
        const input = document.getElementById(`comm-input-${p}`);
        if (p === period) {
            if (btn) btn.className = "py-1.5 rounded-lg bg-blue-600 text-white font-bold transition shadow cursor-pointer";
            if (input) {
                input.classList.remove('hidden');
                if (input.value) viewSettings.dateValue = input.value;
            }
        } else {
            if (btn) btn.className = "py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-bold transition cursor-pointer";
            if (input) input.classList.add('hidden');
        }
    });

    refreshCommissionView();
    fetchCommissionData().then(() => refreshCommissionView()).catch(() => {});
}

export function checkRiderFilterMatch(targetFilter, rName, rId) {
    if (!targetFilter) return true;
    const target = targetFilter.toString().trim();
    if (!target || target.toUpperCase() === 'ALL' || target.toLowerCase().includes('all riders')) return true;

    const rNameClean = (rName || "").toString().trim();
    const rIdClean = (rId || "").toString().trim();

    // 1. Direct case-insensitive match on ID or Name
    if (rIdClean && target.toLowerCase() === rIdClean.toLowerCase()) return true;
    if (rNameClean && target.toLowerCase() === rNameClean.toLowerCase()) return true;

    // 2. Token/word name match via isRiderMatch
    if (isRiderMatch(target, rNameClean)) return true;

    // 3. Match against roster member
    const targetRoster = (globalState.rosterMembers || []).find(m => {
        const mName = (m.riderName || m.name || "").toString().trim();
        const mId = (m.telegramId || m.id || "").toString().trim();
        return (mId && mId.toLowerCase() === target.toLowerCase()) || (mName && isRiderMatch(target, mName));
    });
    if (targetRoster) {
        const rosterId = (targetRoster.telegramId || targetRoster.id || "").toString().trim();
        const rosterName = (targetRoster.riderName || targetRoster.name || "").toString().trim();
        if (rosterId && rIdClean && rosterId.toLowerCase() === rIdClean.toLowerCase()) return true;
        if (rosterName && isRiderMatch(rosterName, rNameClean)) return true;
    }

    return false;
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

    // Sanitize ALL combinations
    if (!targetRiderFilter || targetRiderFilter.toUpperCase() === "ALL" || targetRiderFilter.toLowerCase().includes("all riders")) {
        targetRiderFilter = null;
    }

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
            return isSameDateStr(rDate, viewSettings.dateValue) || (normalizeDateStr(rDate) === normalizeDateStr(viewSettings.dateValue)) || (normalizeToDateStr(rDate) === normalizeToDateStr(viewSettings.dateValue));
        }
        if (viewSettings.period === 'weekly') {
            const d = new Date(rDate.includes('-') || rDate.includes('/') ? rDate : Number(rDate));
            return getWeekString(d.getTime()) === viewSettings.dateValue;
        }
        if (viewSettings.period === 'monthly') {
            return String(normalizeDateStr(rDate)).substring(0, 7) === String(normalizeDateStr(viewSettings.dateValue)).substring(0, 7);
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
            const rosterRec = globalState.rosterMembers?.find(mem => isRiderMatch(rName, mem.riderName || mem.name || ""));
            if (rosterRec && rosterRec.telegramId) rId = rosterRec.telegramId.toString();
            else rId = rName.toLowerCase();
        }

        let gross = parseFloat(r.totalFees) || 0;
        const receiptTime = r.completedTime || r.doneTime || r.receiptTime || r.time || r.startTime || r.timestamp || null;
        const rates = getCommissionRates(rDate, rName, rId, receiptTime || r);

        let standardCompanyPerc = rates.companyPerc;
        if (rates.isOvertime && rates.overtimeDiscountPerc > 0) {
            standardCompanyPerc = rates.companyPerc + rates.overtimeDiscountPerc;
        }
        let standardCompanyAmt = gross * (standardCompanyPerc / 100);

        let companyAmt = gross * rates.companyRate;
        if (rates.overtimeDiscountAmount > 0) {
            companyAmt = Math.max(0, companyAmt - rates.overtimeDiscountAmount);
        }
        const earnedAmt = Math.max(0, gross - companyAmt);

        const isOt = Boolean(rates.isOvertime);
        const otDiscountAmt = isOt ? Math.max(0, standardCompanyAmt - companyAmt) : 0;

        if (!riderTotals[rId]) {
            const baseRates = getCommissionRates(rDate, rName, rId, "00:00");
            riderTotals[rId] = { 
                id: rId,
                name: rName, 
                gross: 0, 
                earned: 0, 
                company: 0, 
                regularGross: 0,
                regularEarned: 0,
                regularCompany: 0,
                regularOrdersCount: 0,
                otGross: 0,
                otEarned: 0,
                otCompany: 0,
                otDiscountTotal: 0,
                overtimeOrdersCount: 0,
                baseRates: baseRates,
                lastRates: rates, 
                customers: [] 
            };
        }

        if (isOt) {
            riderTotals[rId].overtimeOrdersCount++;
            riderTotals[rId].otGross += gross;
            riderTotals[rId].otCompany += companyAmt;
            riderTotals[rId].otEarned += earnedAmt;
            riderTotals[rId].otDiscountTotal += otDiscountAmt;
        } else {
            riderTotals[rId].regularOrdersCount++;
            riderTotals[rId].regularGross += gross;
            riderTotals[rId].regularCompany += companyAmt;
            riderTotals[rId].regularEarned += earnedAmt;
        }
        
        riderTotals[rId].gross += gross;
        riderTotals[rId].earned += earnedAmt;
        riderTotals[rId].company += companyAmt;
        riderTotals[rId].lastRates = rates;

        riderTotals[rId].customers.push({
            customerName: cName,
            date: rDate,
            time: r.completedTime || r.doneTime || r.receiptTime || r.time || r.startTime || "",
            gross: gross,
            earned: earnedAmt,
            company: companyAmt,
            transactionId: r.transactionId || "",
            isOvertime: rates.isOvertime,
            overtimeDiscountPerc: rates.overtimeDiscountPerc,
            overtimeDiscountAmount: rates.overtimeDiscountAmount
        });
    });

    // 1. Identify Active Date Penalties for Current Period & Render Banner
    const activePeriodPenalties = [];
    if (globalState.globalCommissionPenalties) {
        Object.entries(globalState.globalCommissionPenalties).forEach(([key, rec]) => {
            if (!rec || !rec.date) return;
            const rDate = rec.date;
            let dateMatches = false;
            if (viewSettings.period === 'daily') {
                dateMatches = isSameDateStr(rDate, viewSettings.dateValue) || (normalizeDateStr(rDate) === normalizeDateStr(viewSettings.dateValue));
            } else if (viewSettings.period === 'weekly') {
                const d = new Date(rDate.includes('-') ? rDate : Number(rDate));
                dateMatches = getWeekString(d.getTime()) === viewSettings.dateValue;
            } else if (viewSettings.period === 'monthly') {
                dateMatches = String(normalizeDateStr(rDate)).substring(0, 7) === String(normalizeDateStr(viewSettings.dateValue)).substring(0, 7);
            }
            if (!dateMatches) return;

            // If a specific rider filter is applied, only show their penalty
            if (targetRiderFilter) {
                const isMatch = checkRiderFilterMatch(targetRiderFilter, rec.riderName, rec.telegramId);
                if (!isMatch) return;
            }

            activePeriodPenalties.push({ key, ...rec });

            // Ensure penalized rider is in riderTotals even with 0 deliveries
            const rName = rec.riderName || key.split('_')[0];
            const rosterRec = globalState.rosterMembers?.find(mem => isRiderMatch(rName, mem.riderName || mem.name || "", "", mem.telegramId || mem.id));
            const rId = (rec.telegramId || (rosterRec && (rosterRec.telegramId || rosterRec.id)) || rName.toLowerCase()).toString().trim();

            if (!riderTotals[rId]) {
                const rates = getCommissionRates(rDate, rName, rId);
                riderTotals[rId] = { name: rName, gross: 0, earned: 0, company: 0, lastRates: rates, customers: [] };
            }
        });
    }

    // Render Active Penalties Banner in UI
    const penaltiesSection = document.getElementById('commission-active-penalties-section');
    const penaltiesCountEl = document.getElementById('commission-active-penalties-count');
    const penaltiesListEl = document.getElementById('commission-active-penalties-list');

    if (penaltiesSection && penaltiesListEl) {
        if (activePeriodPenalties.length > 0) {
            penaltiesSection.classList.remove('hidden');
            penaltiesSection.classList.add('flex');
            if (penaltiesCountEl) {
                penaltiesCountEl.innerText = `${activePeriodPenalties.length} active`;
            }
            penaltiesListEl.innerHTML = activePeriodPenalties.map(p => {
                const removeBtn = isUserAdmin ? `
                    <button type="button" onclick="window.removeAdminPenaltyByKey && window.removeAdminPenaltyByKey('${escapeHtml(p.key)}', '${escapeHtml(p.riderName)}', '${escapeHtml(p.date)}')" class="bg-red-600/20 hover:bg-red-600 text-red-700 dark:text-red-300 hover:text-white px-2 py-1 rounded-lg border border-red-500/30 text-[10px] font-bold transition active:scale-95 cursor-pointer flex items-center gap-1 shadow-xs ml-2 shrink-0">
                        <i class="fa-solid fa-trash-can text-[10px]"></i>
                        <span>Remove</span>
                    </button>
                ` : '';

                return `
                <div class="bg-white/90 dark:bg-black/40 border border-red-200 dark:border-red-900/50 p-2.5 rounded-xl flex items-center justify-between text-xs shadow-xs">
                    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="font-black text-xs text-gray-900 dark:text-white flex items-center gap-1">
                                <i class="fa-solid fa-motorcycle text-red-500 text-[10px]"></i>
                                ${escapeHtml(p.riderName)}
                            </span>
                            <span class="bg-red-600 text-white text-[9px] font-black px-1.5 py-0.2 rounded-md">
                                +${p.penaltyPercentage}%
                            </span>
                            <span class="text-[10px] font-mono text-gray-500 dark:text-gray-400 font-bold">
                                ${escapeHtml(p.date)}
                            </span>
                        </div>
                        <span class="text-[10px] text-gray-600 dark:text-gray-300 italic truncate">
                            ${escapeHtml(p.reason || 'Admin Sanction')}
                        </span>
                    </div>
                    ${removeBtn}
                </div>`;
            }).join('');
        } else {
            penaltiesSection.classList.add('hidden');
            penaltiesSection.classList.remove('flex');
            penaltiesListEl.innerHTML = '';
        }
    }

    let finalRiderList = [];
    let grandGross = 0;
    let grandEarned = 0;
    let grandCompany = 0;
    let grandRegularGross = 0;
    let grandRegularEarned = 0;
    let grandRegularCompany = 0;
    let grandRegularCount = 0;
    let grandOtGross = 0;
    let grandOtEarned = 0;
    let grandOtCompany = 0;
    let grandOtDiscount = 0;
    let grandOtCount = 0;
    let selectedRiderRates = null;

    for (let rId in riderTotals) {
        const rates = riderTotals[rId].lastRates || getCommissionRates(viewSettings.dateValue, riderTotals[rId].name, rId);
        const hasPenalty = rates && (rates.manualPenaltyPerc > 0 || rates.earlyShiftPenaltyPerc > 0);
        if (!hasPenalty && (riderTotals[rId].gross <= 0 || riderTotals[rId].customers.length === 0)) continue;

        if (targetRiderFilter) {
            const isMatch = checkRiderFilterMatch(targetRiderFilter, riderTotals[rId].name, rId);
            if (!isMatch) continue;
            selectedRiderRates = riderTotals[rId].lastRates;
        }
        
        finalRiderList.push({ id: rId, ...riderTotals[rId] });
        grandGross += riderTotals[rId].gross;
        grandEarned += riderTotals[rId].earned;
        grandCompany += riderTotals[rId].company;
        grandRegularGross += (riderTotals[rId].regularGross || 0);
        grandRegularEarned += (riderTotals[rId].regularEarned || 0);
        grandRegularCompany += (riderTotals[rId].regularCompany || 0);
        grandRegularCount += (riderTotals[rId].regularOrdersCount || 0);
        grandOtGross += (riderTotals[rId].otGross || 0);
        grandOtEarned += (riderTotals[rId].otEarned || 0);
        grandOtCompany += (riderTotals[rId].otCompany || 0);
        grandOtDiscount += (riderTotals[rId].otDiscountTotal || 0);
        grandOtCount += (riderTotals[rId].overtimeOrdersCount || 0);
    }

    if (targetRiderFilter && !selectedRiderRates) {
        const myRoster = globalState.rosterMembers?.find(m => checkRiderFilterMatch(targetRiderFilter, m.riderName || m.name || "", m.telegramId));
        const rName = myRoster ? (myRoster.riderName || myRoster.name || "") : (appState.riderName || myName);
        const rTelegramId = myRoster?.telegramId ? myRoster.telegramId.toString() : (/^\d+$/.test(targetRiderFilter) ? targetRiderFilter : "");
        selectedRiderRates = getCommissionRates(viewSettings.dateValue, rName, rTelegramId);
    }

    const mainWrapperEl = document.getElementById('comm-main-wrapper');
    const mainLabelEl = document.getElementById('comm-main-label');
    const grossEl = document.getElementById('comm-gross-amount');
    const summaryTitleEl = document.getElementById('comm-summary-title');
    const mainAmountEl = document.getElementById('comm-main-amount');

    if (grossEl) grossEl.innerText = grandGross.toFixed(2);
    if (summaryTitleEl) summaryTitleEl.innerText = `${viewSettings.period.toUpperCase()} SUMMARY`;

    const selectedRiderItem = finalRiderList.find(r => targetRiderFilter && checkRiderFilterMatch(targetRiderFilter, r.name, r.id)) || (finalRiderList.length === 1 ? finalRiderList[0] : null);
    const baseRates = selectedRiderItem?.baseRates || (selectedRiderRates?.baseRates || getCommissionRates(viewSettings.dateValue, (selectedRiderItem?.name || appState.riderName), (selectedRiderItem?.id || appState.telegramId), "00:00"));
    const displayRates = baseRates;

    let penaltyNotice = '';
    if (displayRates.manualPenaltyPerc > 0 && displayRates.earlyShiftPenaltyPerc > 0) {
        penaltyNotice = ` (+${displayRates.manualPenaltyPerc}% Penalty, +${displayRates.earlyShiftPenaltyPerc}% Early Out)`;
    } else if (displayRates.earlyShiftPenaltyPerc > 0) {
        penaltyNotice = ` (+${displayRates.earlyShiftPenaltyPerc}% Early Out)`;
    } else if (displayRates.manualPenaltyPerc > 0) {
        penaltyNotice = ` (+${displayRates.manualPenaltyPerc}% Penalty)`;
    }

    let promoNotice = displayRates.promoDiscountPerc > 0 ? ` (-${displayRates.promoDiscountPerc}% Promo Less)` : '';

    let overtimeNotice = '';
    if (selectedRiderItem && selectedRiderItem.overtimeOrdersCount > 0 && overtimeReward) {
        if (overtimeReward.type === 'fixed') {
            overtimeNotice = ` (⚡ ${selectedRiderItem.overtimeOrdersCount} OT Order${selectedRiderItem.overtimeOrdersCount > 1 ? 's' : ''}: -₱${overtimeReward.value}/ord)`;
        } else {
            overtimeNotice = ` (⚡ ${selectedRiderItem.overtimeOrdersCount} OT Order${selectedRiderItem.overtimeOrdersCount > 1 ? 's' : ''}: -${overtimeReward.value}%)`;
        }
    }

    if (viewSettings.mode === 'earned') {
        if (mainLabelEl) {
            mainLabelEl.innerText = `YOUR EARNINGS (${displayRates.riderPerc}% Base Rate${penaltyNotice}${promoNotice}${overtimeNotice})`;
            mainLabelEl.className = "text-[10px] text-emerald-700 dark:text-emerald-400 font-bold uppercase";
        }
        if (mainWrapperEl) mainWrapperEl.className = "text-4xl font-black text-emerald-600 dark:text-emerald-400 drop-shadow-md";
        if (mainAmountEl) mainAmountEl.innerText = grandEarned.toFixed(2);
    } else {
        if (mainLabelEl) {
            mainLabelEl.innerText = displayRates.isAdmin ? `TO PAY COMPANY (ADMIN EXEMPT)` : `TO PAY COMPANY (${displayRates.companyPerc}% Base Rate${penaltyNotice}${promoNotice}${overtimeNotice})`;
            mainLabelEl.className = "text-[10px] text-red-700 dark:text-red-400 font-bold uppercase";
        }
        if (mainWrapperEl) mainWrapperEl.className = "text-4xl font-black text-red-600 dark:text-red-400 drop-shadow-md";
        if (mainAmountEl) mainAmountEl.innerText = grandCompany.toFixed(2);
    }

    const otSubtotalEl = document.getElementById('comm-ot-subtotal-badge');
    if (otSubtotalEl) {
        if (grandOtCount > 0) {
            otSubtotalEl.classList.remove('hidden');
            const regAmt = viewSettings.mode === 'earned' ? grandRegularEarned : grandRegularCompany;
            const otAmt = viewSettings.mode === 'earned' ? grandOtEarned : grandOtCompany;
            otSubtotalEl.innerHTML = `<span>Regular: <strong>₱${regAmt.toFixed(2)}</strong> (${grandRegularCount} ord)</span> • <span class="text-amber-600 dark:text-amber-400">⚡ OT: <strong>₱${otAmt.toFixed(2)}</strong> (${grandOtCount} ord)</span>`;
        } else {
            otSubtotalEl.classList.add('hidden');
            otSubtotalEl.innerHTML = '';
        }
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
                adminBtn.className = "w-full bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-300 font-black py-3 rounded-xl text-xs transition active:scale-95 shadow mt-1 border border-gray-300 dark:border-gray-700 cursor-pointer";
            } else {
                adminBtn.classList.add('hidden');
            }
        } else {
            badge.className = "absolute top-0 right-0 bg-red-600 text-white text-[9px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-widest shadow-md";
            badge.innerText = "UNPAID";
            if (isAdmin) {
                adminBtn.classList.remove('hidden');
                adminBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> MARK AS PAID`;
                adminBtn.className = "w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 rounded-xl text-xs transition active:scale-95 shadow-lg mt-1 border border-emerald-400/50 cursor-pointer";
            } else {
                adminBtn.classList.add('hidden');
            }
        }
    });
}

export function toggleSettlementStatus() {
    const select = document.getElementById('admin-rider-select');
    const riderId = select ? select.value : (appState.telegramId || appState.riderName);
    if (!riderId || riderId.toUpperCase() === 'ALL' || riderId.toLowerCase().includes('all riders')) {
        showToast("⚠️ Please select a specific rider from the dropdown first.");
        return;
    }
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
        const baseRates = rider.baseRates || getCommissionRates(viewSettings.dateValue, rider.name, rider.id, "00:00");
        const rates = rider.lastRates || baseRates;
        const hasOtOrders = (rider.overtimeOrdersCount || 0) > 0;
        
        let amountLabel = "";
        let colorClass = "";

        if (viewSettings.mode === 'earned') {
            amountLabel = `+ ₱${rider.earned.toFixed(2)}`;
            colorClass = "text-emerald-700 dark:text-emerald-400";
        } else {
            if (baseRates.isAdmin) {
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
                    : (baseRates.isAdmin ? `- ₱0.00 (Exempt)` : `- ₱${c.company.toFixed(2)}`);
                    
                let dateTimeStr = c.date;
                if (c.time) dateTimeStr += ` • ${c.time}`;

                const editBtn = isAdmin 
                    ? `<button onclick="event.stopPropagation(); promptAdminEditCustomerFee('${escapeHtml(rider.name)}', '${escapeHtml(c.customerName)}', '${c.date}',${c.gross})" class="text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 ml-1.5 p-0.5 cursor-pointer" title="Edit Fee"><i class="fa-solid fa-pen text-[10px]"></i></button>` 
                    : ``;

                const deleteBtn = isAdmin 
                    ? `<button onclick="event.stopPropagation(); promptAdminDeleteCommissionRecord('${escapeHtml(rider.name)}', '${escapeHtml(c.customerName)}', '${c.date}', '${c.transactionId}')" class="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 ml-1 p-0.5 cursor-pointer" title="Delete Record"><i class="fa-solid fa-trash text-[10px]"></i></button>` 
                    : ``;

                const otBadge = c.isOvertime 
                    ? `<span class="bg-amber-500/20 text-amber-700 dark:text-amber-400 font-bold px-1.5 py-0.2 rounded text-[8.5px] border border-amber-500/30">⚡ Overtime</span>` 
                    : ``;

                return `
                <div class="bg-white dark:bg-zinc-900/90 p-2.5 rounded-xl border border-gray-200 dark:border-zinc-700/60 flex justify-between items-center text-xs shadow-xs">
                    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                        <span class="font-black text-xs text-orange-700 dark:text-orange-400 flex items-center gap-1.5 truncate">
                            <i class="fa-solid fa-user text-[10px]"></i> ${escapeHtml(c.customerName)} ${otBadge} ${editBtn} ${deleteBtn}
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

        const adminBadge = baseRates.isAdmin ? `<span class="bg-purple-50 dark:bg-purple-600/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30 text-[9px] font-black px-1.5 py-0.5 rounded ml-1">ADMIN</span>` : '';

        const penaltyHeaderBadge = baseRates.manualPenaltyPerc > 0
            ? `<span class="bg-red-600/20 text-red-600 dark:text-red-400 border border-red-500/40 text-[9px] font-black px-1.5 py-0.5 rounded-md flex items-center gap-1 shadow-xs"><i class="fa-solid fa-gavel"></i> +${baseRates.manualPenaltyPerc}% Penalty</span>`
            : '';

        const earlyShiftHeaderBadge = baseRates.earlyShiftPenaltyPerc > 0
            ? `<span class="bg-amber-600/20 text-amber-700 dark:text-amber-400 border border-amber-500/40 text-[9px] font-black px-1.5 py-0.5 rounded-md flex items-center gap-1 shadow-xs"><i class="fa-solid fa-user-clock"></i> +${baseRates.earlyShiftPenaltyPerc}% Early Out</span>`
            : '';

        const overtimeHeaderBadge = (hasOtOrders && overtimeReward)
            ? `<span class="bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/40 text-[9px] font-black px-1.5 py-0.5 rounded-md flex items-center gap-1 shadow-xs"><i class="fa-solid fa-bolt"></i> ${rider.overtimeOrdersCount} OT Order${rider.overtimeOrdersCount > 1 ? 's' : ''} (${overtimeReward.type === 'fixed' ? `-₱${overtimeReward.value}/ord` : `-${overtimeReward.value}%`})</span>`
            : '';

        const earlyShiftBadge = baseRates.earlyShiftPenaltyPerc > 0
            ? `<div class="flex items-center justify-between bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-500/40 px-2.5 py-1.5 rounded-xl text-[10px] text-red-700 dark:text-red-300 font-bold my-1 shadow-xs">
                <span class="flex items-center gap-1.5">
                    <i class="fa-solid fa-user-clock text-red-500"></i>
                    <span>Early Out Penalty: <strong>+${baseRates.earlyShiftPenaltyPerc}%</strong> (${baseRates.earlyShiftDeficitHours}h deficit)</span>
                </span>
                ${isAdmin ? `<button onclick="event.stopPropagation(); window.waiveEarlyShiftPenalty && window.waiveEarlyShiftPenalty('${escapeHtml(rider.name)}', '${escapeHtml(rider.id)}', '${viewSettings.dateValue}')" class="bg-red-600/20 hover:bg-red-600 text-red-700 dark:text-red-300 hover:text-white px-2 py-0.5 rounded-lg border border-red-500/30 font-black transition active:scale-95 cursor-pointer ml-2"><i class="fa-solid fa-hand-holding-hand"></i> Waive</button>` : ''}
               </div>`
            : '';

        const penaltyBadge = baseRates.manualPenaltyPerc > 0 
            ? `<div class="flex items-center justify-between bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-500/40 px-2.5 py-1 rounded-xl text-[10px] text-red-700 dark:text-red-300 font-bold my-1 shadow-xs">
                <span><i class="fa-solid fa-gavel text-red-600 dark:text-red-400"></i> Date Penalty Active (+${baseRates.manualPenaltyPerc}% to Company)</span>
                ${isAdmin ? `<button onclick="event.stopPropagation(); removeAdminPenalty('${escapeHtml(rider.name)}', '${viewSettings.dateValue}')" class="text-red-800 dark:text-white hover:underline ml-2 font-black cursor-pointer"><i class="fa-solid fa-trash"></i> Remove</button>` : ''}
               </div>`
            : '';

        const promoBadge = baseRates.promoDiscountPerc > 0 
            ? `<div class="flex items-center justify-between bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-500/40 px-2.5 py-1 rounded-xl text-[10px] text-emerald-800 dark:text-emerald-300 font-bold my-1 shadow-xs">
                <span><i class="fa-solid fa-tags text-emerald-600 dark:text-emerald-400"></i> Special Promo Active (-${baseRates.promoDiscountPerc}% Commission Less)</span>
               </div>`
            : '';

        const overtimeBadge = (hasOtOrders && overtimeReward)
            ? `<div class="flex items-center justify-between bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-500/40 px-2.5 py-1.5 rounded-xl text-[10px] text-amber-800 dark:text-amber-300 font-bold my-1 shadow-xs">
                <span class="flex items-center gap-1.5">
                    <i class="fa-solid fa-bolt text-amber-500"></i>
                    <span>Overtime Incentive: ${rider.overtimeOrdersCount} order${rider.overtimeOrdersCount > 1 ? 's' : ''} past ${overtimeReward.thresholdHours || 8}h duty (${overtimeReward.type === 'fixed' ? `-₱${overtimeReward.value} off per order` : `-${overtimeReward.value}% less commission`})</span>
                </span>
               </div>`
            : '';

        return `
            <div class="bg-white dark:bg-cardBg rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs flex flex-col overflow-hidden">
                <div onclick="toggleRiderCustomerBreakdown('${uid}')" class="p-3.5 flex justify-between items-center text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition select-none">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="font-black text-xs text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                            <i class="fa-solid fa-motorcycle text-gray-500"></i> ${escapeHtml(rider.name)} ${adminBadge}
                        </span>
                        ${penaltyHeaderBadge}
                        ${earlyShiftHeaderBadge}
                        ${overtimeHeaderBadge}
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
                    ${earlyShiftBadge}
                    ${penaltyBadge}
                    ${promoBadge}
                    ${overtimeBadge}
                    ${hasOtOrders ? `
                    <div class="grid grid-cols-2 gap-2 bg-amber-500/10 border border-amber-500/25 rounded-xl p-2.5 text-xs my-0.5 shadow-xs">
                        <div class="flex flex-col">
                            <span class="text-[9.5px] text-gray-500 dark:text-gray-400 font-bold uppercase">Regular (${rider.regularOrdersCount || 0} ord)</span>
                            <span class="font-black text-xs text-gray-800 dark:text-gray-100">${viewSettings.mode === 'earned' ? `+ ₱${(rider.regularEarned || 0).toFixed(2)}` : (baseRates.isAdmin ? '₱0.00 (Exempt)' : `- ₱${(rider.regularCompany || 0).toFixed(2)}`)}</span>
                            <span class="text-[9px] text-gray-500 font-mono">Gross: ₱${(rider.regularGross || 0).toFixed(2)}</span>
                        </div>
                        <div class="flex flex-col border-l border-amber-300 dark:border-amber-800/60 pl-2">
                            <span class="text-[9.5px] text-amber-700 dark:text-amber-400 font-bold uppercase flex items-center gap-1"><i class="fa-solid fa-bolt text-[9px]"></i> Overtime (${rider.overtimeOrdersCount} ord)</span>
                            <span class="font-black text-xs text-amber-600 dark:text-amber-400">${viewSettings.mode === 'earned' ? `+ ₱${(rider.otEarned || 0).toFixed(2)}` : (baseRates.isAdmin ? '₱0.00 (Exempt)' : `- ₱${(rider.otCompany || 0).toFixed(2)}`)}</span>
                            <span class="text-[9px] text-gray-500 font-mono">Gross: ₱${(rider.otGross || 0).toFixed(2)}${(rider.otDiscountTotal || 0) > 0 ? ` (Saved ₱${rider.otDiscountTotal.toFixed(2)})` : ''}</span>
                        </div>
                    </div>` : ''}
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
    if (!targetRiderFilter || targetRiderFilter.toUpperCase() === "ALL" || targetRiderFilter.toLowerCase().includes("all riders")) {
        targetRiderFilter = null;
    }

    const mergedList = getMergedDeduplicatedCommissionList();

    let filteredHistory = mergedList.filter(record => {
        let rDate = record.date || record.completedDate;
        if (!rDate) return false;
        if (viewSettings.period === 'daily') return isSameDateStr(rDate, viewSettings.dateValue) || (normalizeDateStr(rDate) === normalizeDateStr(viewSettings.dateValue)) || (normalizeToDateStr(rDate) === normalizeToDateStr(viewSettings.dateValue));
        if (viewSettings.period === 'weekly') {
            const d = new Date(rDate.includes('-') || rDate.includes('/') ? rDate : Number(rDate));
            return getWeekString(d.getTime()) === viewSettings.dateValue;
        }
        if (viewSettings.period === 'monthly') return String(normalizeDateStr(rDate)).substring(0, 7) === String(normalizeDateStr(viewSettings.dateValue)).substring(0, 7);
        return false;
    });

    let riderTotals = {}; 
    filteredHistory.forEach(r => {
        let rId = (r.telegramId || "").toString().trim();
        let rName = r.riderName || "Unknown";
        let cName = r.customerName || "Customer";
        let rDate = r.date || r.completedDate;

        if (!rId) {
            const rosterRec = globalState.rosterMembers?.find(mem => isRiderMatch(rName, mem.riderName || mem.name || ""));
            if (rosterRec && rosterRec.telegramId) rId = rosterRec.telegramId.toString();
            else rId = rName.toLowerCase();
        }

        let gross = parseFloat(r.totalFees) || 0;
        const receiptTime = r.completedTime || r.doneTime || r.receiptTime || r.time || r.startTime || r.timestamp || null;
        const rates = getCommissionRates(rDate, rName, rId, receiptTime || r);

        let standardCompanyPerc = rates.companyPerc;
        if (rates.isOvertime && rates.overtimeDiscountPerc > 0) {
            standardCompanyPerc = rates.companyPerc + rates.overtimeDiscountPerc;
        }
        let standardCompanyAmt = gross * (standardCompanyPerc / 100);

        let companyAmt = gross * rates.companyRate;
        if (rates.overtimeDiscountAmount > 0) {
            companyAmt = Math.max(0, companyAmt - rates.overtimeDiscountAmount);
        }
        const earnedAmt = Math.max(0, gross - companyAmt);

        const isOt = Boolean(rates.isOvertime);
        const otDiscountAmt = isOt ? Math.max(0, standardCompanyAmt - companyAmt) : 0;

        if (!riderTotals[rId]) {
            const baseRates = getCommissionRates(rDate, rName, rId, "00:00");
            riderTotals[rId] = { 
                id: rId,
                name: rName, 
                gross: 0, 
                earned: 0, 
                company: 0, 
                regularGross: 0,
                regularEarned: 0,
                regularCompany: 0,
                regularOrdersCount: 0,
                otGross: 0,
                otEarned: 0,
                otCompany: 0,
                otDiscountTotal: 0,
                overtimeOrdersCount: 0,
                baseRates: baseRates,
                lastRates: rates,
                customers: [] 
            };
        }

        if (isOt) {
            riderTotals[rId].overtimeOrdersCount++;
            riderTotals[rId].otGross += gross;
            riderTotals[rId].otCompany += companyAmt;
            riderTotals[rId].otEarned += earnedAmt;
            riderTotals[rId].otDiscountTotal += otDiscountAmt;
        } else {
            riderTotals[rId].regularOrdersCount++;
            riderTotals[rId].regularGross += gross;
            riderTotals[rId].regularCompany += companyAmt;
            riderTotals[rId].regularEarned += earnedAmt;
        }

        riderTotals[rId].gross += gross;
        riderTotals[rId].earned += earnedAmt;
        riderTotals[rId].company += companyAmt;
        riderTotals[rId].lastRates = rates;

        riderTotals[rId].customers.push({
            customerName: cName,
            date: rDate,
            time: r.completedTime || r.doneTime || r.receiptTime || r.time || r.startTime || "",
            gross: gross,
            earned: earnedAmt,
            company: companyAmt,
            isOvertime: isOt,
            overtimeDiscountPerc: rates.overtimeDiscountPerc,
            overtimeDiscountAmount: rates.overtimeDiscountAmount
        });
    });

    const isEarnedMode = viewSettings.mode === 'earned';
    const periodLabel = viewSettings.period.toUpperCase();

    // ==========================================
    // CASE A: RIDER REPORT (Single Rider View)
    // ==========================================
    if (targetRiderFilter) {
        let rider = null;
        for (let rId in riderTotals) {
            if (checkRiderFilterMatch(targetRiderFilter, riderTotals[rId].name, rId)) {
                rider = riderTotals[rId];
                break;
            }
        }

        if (!rider) {
            const rosterMem = globalState.rosterMembers?.find(m => checkRiderFilterMatch(targetRiderFilter, m.riderName || m.name || "", m.telegramId));
            const rName = rosterMem ? (rosterMem.riderName || rosterMem.name || "") : targetRiderFilter;
            const rId = (rosterMem?.telegramId || targetRiderFilter).toString();
            const baseRates = getCommissionRates(viewSettings.dateValue, rName, rId, "00:00");
            rider = {
                id: rId,
                name: rName,
                gross: 0,
                earned: 0,
                company: 0,
                regularGross: 0,
                regularEarned: 0,
                regularCompany: 0,
                regularOrdersCount: 0,
                otGross: 0,
                otEarned: 0,
                otCompany: 0,
                otDiscountTotal: 0,
                overtimeOrdersCount: 0,
                baseRates: baseRates,
                customers: []
            };
        }

        const baseRates = rider.baseRates || getCommissionRates(viewSettings.dateValue, rider.name, rider.id, "00:00");
        const totalOrders = (rider.regularOrdersCount || 0) + (rider.overtimeOrdersCount || 0);

        let report = `📊 LOKALEX SETTLEMENT REPORT (RIDER)\n`;
        report += `👤 Rider: ${rider.name}${baseRates.isAdmin ? ' [ADMIN]' : ''}\n`;
        report += `📅 Period: ${periodLabel} (${viewSettings.dateValue})\n`;
        report += `⚙️ Mode: ${isEarnedMode ? 'RIDER EARNINGS' : 'TO PAY COMPANY'}\n\n`;

        report += `💰 GROSS TOTAL: ₱${rider.gross.toFixed(2)}\n`;
        report += `📦 TOTAL ORDERS: ${totalOrders} (${rider.regularOrdersCount} Regular, ${rider.overtimeOrdersCount} Overtime ⚡)\n\n`;

        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `📋 COMMISSION BREAKDOWN:\n\n`;

        // 1. Regular Duty Commission
        report += `1️⃣ REGULAR COMMISSION (${rider.regularOrdersCount} Order${rider.regularOrdersCount === 1 ? '' : 's'}):\n`;
        report += `   • Regular Gross: ₱${rider.regularGross.toFixed(2)}\n`;
        if (baseRates.isAdmin) {
            report += `   • Rate: Admin Exempt (0%)\n`;
            report += `   • ${isEarnedMode ? 'Rider Earned' : 'To Pay Company'}: ₱0.00\n`;
        } else {
            let penaltyDetails = [];
            if (baseRates.earlyShiftPenaltyPerc > 0) penaltyDetails.push(`+${baseRates.earlyShiftPenaltyPerc}% Early Out`);
            if (baseRates.manualPenaltyPerc > 0) penaltyDetails.push(`+${baseRates.manualPenaltyPerc}% Date Penalty`);
            if (baseRates.promoDiscountPerc > 0) penaltyDetails.push(`-${baseRates.promoDiscountPerc}% Promo`);
            const notes = penaltyDetails.length > 0 ? ` (${penaltyDetails.join(', ')})` : '';

            report += `   • Base Rate: ${baseRates.companyPerc}%${notes}\n`;
            report += `   • ${isEarnedMode ? 'Rider Earned' : 'To Pay Company'}: ₱${(isEarnedMode ? rider.regularEarned : rider.regularCompany).toFixed(2)}\n`;
        }
        report += `\n`;

        // 2. Overtime Commission
        report += `2️⃣ OVERTIME COMMISSION (${rider.overtimeOrdersCount} Order${rider.overtimeOrdersCount === 1 ? '' : 's'} past ${overtimeReward?.thresholdHours || 8}h duty threshold):\n`;
        if (rider.overtimeOrdersCount > 0) {
            report += `   • OT Gross: ₱${rider.otGross.toFixed(2)}\n`;
            if (baseRates.isAdmin) {
                report += `   • Rate: Admin Exempt (0%)\n`;
                report += `   • ${isEarnedMode ? 'Rider Earned' : 'To Pay Company'}: ₱0.00\n`;
            } else {
                const otIncentiveDesc = overtimeReward?.type === 'fixed' 
                    ? `-₱${overtimeReward.value}/order off remittance` 
                    : `-${overtimeReward?.value}% off company commission`;
                report += `   • Base Rate: ${baseRates.companyPerc}%\n`;
                report += `   • OT Incentive Applied: ${otIncentiveDesc}\n`;
                if (rider.otDiscountTotal > 0) {
                    report += `   • OT Incentive Savings: -₱${rider.otDiscountTotal.toFixed(2)}\n`;
                }
                report += `   • ${isEarnedMode ? 'Rider Earned' : 'To Pay Company'}: ₱${(isEarnedMode ? rider.otEarned : rider.otCompany).toFixed(2)}\n`;
            }
        } else {
            report += `   • None (No orders completed past scheduled duty threshold)\n`;
        }
        report += `\n`;

        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `💵 NET SETTLEMENT:\n`;
        if (isEarnedMode) {
            report += `🟢 Rider Net Earned: ₱${rider.earned.toFixed(2)}\n`;
            report += `🔴 Company Share: ₱${rider.company.toFixed(2)}\n`;
        } else {
            if (baseRates.isAdmin) {
                report += `🔴 Net To Pay Company: ₱0.00 (Admin Exempt)\n`;
            } else {
                report += `🔴 Net To Pay Company: ₱${rider.company.toFixed(2)}\n`;
            }
            report += `🟢 Rider Net Earned: ₱${rider.earned.toFixed(2)}\n`;
        }

        // 3. Customer Order Breakdown
        if (rider.customers && rider.customers.length > 0) {
            report += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            report += `📦 ORDER DETAILS (${rider.customers.length}):\n`;
            rider.customers.forEach((c, idx) => {
                const timePart = c.time ? ` • ${c.time}` : '';
                const tag = c.isOvertime ? '[⚡ OVERTIME]' : '[REGULAR]';
                const amtPart = isEarnedMode ? `Earned: ₱${c.earned.toFixed(2)}` : (baseRates.isAdmin ? `To Pay: ₱0.00` : `To Pay: ₱${c.company.toFixed(2)}`);
                report += `${idx + 1}. ${c.customerName}${timePart} — Fee: ₱${c.gross.toFixed(2)} | ${amtPart} ${tag}\n`;
            });
        }

        copyText(report);
        showToast("📄 Rider settlement report copied!");
        return;
    }

    // ==========================================
    // CASE B: ADMIN REPORT (All Riders Report)
    // ==========================================
    let grandGross = 0;
    let grandEarned = 0;
    let grandCompany = 0;
    let grandRegularGross = 0;
    let grandRegularEarned = 0;
    let grandRegularCompany = 0;
    let grandRegularCount = 0;
    let grandOtGross = 0;
    let grandOtEarned = 0;
    let grandOtCompany = 0;
    let grandOtDiscount = 0;
    let grandOtCount = 0;

    let riderEntries = [];

    for (let rId in riderTotals) {
        const r = riderTotals[rId];
        if (r.gross <= 0 && (!r.customers || r.customers.length === 0)) continue;

        grandGross += r.gross;
        grandEarned += r.earned;
        grandCompany += r.company;
        grandRegularGross += r.regularGross;
        grandRegularEarned += r.regularEarned;
        grandRegularCompany += r.regularCompany;
        grandRegularCount += r.regularOrdersCount;
        grandOtGross += r.otGross;
        grandOtEarned += r.otEarned;
        grandOtCompany += r.otCompany;
        grandOtDiscount += r.otDiscountTotal;
        grandOtCount += r.overtimeOrdersCount;

        const baseRates = r.baseRates || getCommissionRates(viewSettings.dateValue, r.name, rId, "00:00");
        let penaltyDetails = [];
        if (baseRates.earlyShiftPenaltyPerc > 0) penaltyDetails.push(`+${baseRates.earlyShiftPenaltyPerc}% Early Out`);
        if (baseRates.manualPenaltyPerc > 0) penaltyDetails.push(`+${baseRates.manualPenaltyPerc}% Penalty`);
        const penaltyNote = penaltyDetails.length > 0 ? ` (${penaltyDetails.join(', ')})` : '';

        const rAdminTag = baseRates.isAdmin ? ' [ADMIN]' : '';
        const rAmt = isEarnedMode ? `₱${r.earned.toFixed(2)}` : (baseRates.isAdmin ? '₱0.00 (Exempt)' : `₱${r.company.toFixed(2)}`);

        let rText = `• ${r.name}${rAdminTag}: Total ${isEarnedMode ? 'Earned' : 'To Pay'}: ${rAmt} (Gross: ₱${r.gross.toFixed(2)} | ${r.customers.length} ord)${penaltyNote}\n`;
        
        // Regular breakdown
        const regAmt = isEarnedMode ? `₱${r.regularEarned.toFixed(2)}` : (baseRates.isAdmin ? '₱0.00' : `₱${r.regularCompany.toFixed(2)}`);
        rText += `  - Regular (${r.regularOrdersCount} ord): ${regAmt} (Gross: ₱${r.regularGross.toFixed(2)} @ ${baseRates.companyPerc}% Base)\n`;
        
        // Overtime breakdown
        if (r.overtimeOrdersCount > 0) {
            const otIncentiveDesc = overtimeReward?.type === 'fixed' 
                ? `-₱${overtimeReward.value}/ord` 
                : `-${overtimeReward?.value}%`;
            const otAmt = isEarnedMode ? `₱${r.otEarned.toFixed(2)}` : (baseRates.isAdmin ? '₱0.00' : `₱${r.otCompany.toFixed(2)}`);
            const savingsNote = r.otDiscountTotal > 0 ? `, Saved: ₱${r.otDiscountTotal.toFixed(2)}` : '';
            rText += `  - Overtime ⚡ (${r.overtimeOrdersCount} ord): ${otAmt} (Gross: ₱${r.otGross.toFixed(2)} @ ${otIncentiveDesc}${savingsNote})\n`;
        } else {
            rText += `  - Overtime: None\n`;
        }
        riderEntries.push(rText);
    }

    let report = `📊 LOKALEX SETTLEMENT REPORT (ALL RIDERS)\n`;
    report += `📅 Period: ${periodLabel} (${viewSettings.dateValue})\n`;
    report += `⚙️ Mode: ${isEarnedMode ? 'RIDER EARNINGS' : 'TO PAY COMPANY'}\n\n`;

    report += `💰 GRAND TOTALS:\n`;
    report += `• Total Gross: ₱${grandGross.toFixed(2)}\n`;
    report += `• Total Orders: ${grandRegularCount + grandOtCount} (${grandRegularCount} Regular, ${grandOtCount} Overtime ⚡)\n`;
    report += `• Regular Commission: ₱${(isEarnedMode ? grandRegularEarned : grandRegularCompany).toFixed(2)} (Gross: ₱${grandRegularGross.toFixed(2)})\n`;
    report += `• Overtime Commission: ₱${(isEarnedMode ? grandOtEarned : grandOtCompany).toFixed(2)} (Gross: ₱${grandOtGross.toFixed(2)}${grandOtDiscount > 0 ? `, OT Savings: -₱${grandOtDiscount.toFixed(2)}` : ''})\n`;
    report += `🔴 Total To Pay Company: ₱${grandCompany.toFixed(2)}\n`;
    report += `🟢 Total Rider Earned: ₱${grandEarned.toFixed(2)}\n\n`;

    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `📋 RIDER BREAKDOWN:\n\n`;
    report += riderEntries.join('\n') || "No records found.";

    copyText(report);
    showToast("📄 All riders settlement report copied!");
}

export async function openCommissionScreen() {
    switchView('view-commission');
    
    const today = new Date();
    const todayStr = getLocalTodayStr();

    const dailyInput = document.getElementById('comm-input-daily');
    const weeklyInput = document.getElementById('comm-input-weekly');
    const monthlyInput = document.getElementById('comm-input-monthly');

    if (dailyInput) {
        if (!dailyInput.value) dailyInput.value = todayStr;
        dailyInput.onchange = () => {
            viewSettings.dateValue = dailyInput.value;
            fetchCommissionData(dailyInput.value).then(() => refreshCommissionView()).catch(() => {});
        };
    }
    if (weeklyInput) {
        if (!weeklyInput.value) weeklyInput.value = getWeekString(today.getTime());
        weeklyInput.onchange = () => {
            viewSettings.dateValue = weeklyInput.value;
            fetchCommissionData().then(() => refreshCommissionView()).catch(() => {});
        };
    }
    if (monthlyInput) {
        if (!monthlyInput.value) monthlyInput.value = getMonthString(today.getTime());
        monthlyInput.onchange = () => {
            viewSettings.dateValue = monthlyInput.value;
            fetchCommissionData().then(() => refreshCommissionView()).catch(() => {});
        };
    }

    if (!viewSettings.dateValue) viewSettings.dateValue = todayStr;

    initCommissionLiveListeners();
    await fetchCommissionSettings();
    await fetchCommissionData();
    setupAdminControls(); // Call after fetchCommissionData so all history riders are registered
    refreshCommissionView();
}

window.addEventListener('loginsUpdated', () => {
    refreshCommissionView();
});

window.addEventListener('cateredUpdated', () => {
    refreshCommissionView();
});

window.addEventListener('receiptsUpdated', () => {
    refreshCommissionView();
});