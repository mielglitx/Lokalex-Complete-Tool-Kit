// src/features/commission.js
import { appState, globalState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { API_URL, CSV_AUTH_URL, ADMIN_IDS } from '../config/constants.js';
import { getLocalTodayStr, copyText, getWeekString, getMonthString, getDateString, escapeHtml } from '../utils/helpers.js';
import { showToast } from '../ui/notifications.js';
import { switchView } from '../ui/router.js';
import { openSlideDeleteModal } from '../ui/modals.js';

let viewSettings = {
    mode: 'earned', // 'earned' or 'company'
    period: 'daily', // 'daily', 'weekly', 'monthly'
    dateValue: getLocalTodayStr()
};

// FETCH LOGIN ID SHEET TO IDENTIFY RIDER TYPES (ADMIN, TL, ETC.)
export async function fetchRiderUserTypes() {
    try {
        const res = await fetch(CSV_AUTH_URL);
        if (res.ok) {
            const csvText = await res.text();
            const userTypes = {};
            csvText.split('\n').forEach(line => {
                const cols = line.split(',').map(c => c.replace(/['"\r\n]+/g, '').trim());
                if (cols.length >= 3) {
                    const cleanType = cols[0].toLowerCase();
                    const cleanId = cols[1];
                    const cleanName = cols[2].toLowerCase();
                    if (cleanName) userTypes[cleanName] = cleanType;
                    if (cleanId) userTypes[cleanId] = cleanType;
                } else if (cols.length >= 2) {
                    const cleanId = cols[0];
                    const cleanName = cols[1].toLowerCase();
                    if (cleanName) userTypes[cleanName] = "";
                    if (cleanId) userTypes[cleanId] = "";
                }
            });
            globalState.userTypesMap = userTypes;
        }
    } catch(e) {
        console.warn("Could not fetch rider user types from CSV, using fallback roster state...", e);
    }
}

// STRICT CHECK IF A RIDER IS AN ADMIN (EXCLUDES TL & TEAM LEADS)
export function isRiderAdmin(riderName = "", telegramId = "") {
    const cleanName = (riderName || "").toString().toLowerCase().trim();
    const cleanId = (telegramId || "").toString().trim();

    if (cleanId && ADMIN_IDS.includes(cleanId)) return true;

    if (globalState.userTypesMap) {
        const typeByName = cleanName ? globalState.userTypesMap[cleanName] : "";
        const typeById = cleanId ? globalState.userTypesMap[cleanId] : "";

        if (typeByName === "tl" || typeById === "tl" || typeByName === "lead" || typeById === "lead") {
            return false;
        }

        if (typeByName === "admin" || typeById === "admin") {
            return true;
        }
    }

    const rosterMem = (globalState.rosterMembers || []).find(m => 
        (m.riderName || m.name || "").toLowerCase().trim() === cleanName ||
        (m.telegramId || "").toString().trim() === cleanId
    );

    if (rosterMem) {
        const uType = (rosterMem.userType || "").toLowerCase().trim();
        if (uType === "tl" || uType.includes("lead")) return false;
        if (uType === "admin" || uType === "owner" || uType === "manager") return true;
    }

    return false;
}

// GET DYNAMIC COMMISSION RATES PER RIDER BASED ON COMMISSIONSETTINGS & ADMIN STATUS
function getCommissionRates(dateStr, riderName = "", telegramId = "") {
    const d = new Date((dateStr || getLocalTodayStr()) + "T00:00:00");
    const isSunday = d.getDay() === 0;

    const isAdmin = isRiderAdmin(riderName, telegramId);

    if (isAdmin) {
        return {
            companyRate: 0,
            riderRate: 1.0,
            isSunday: isSunday,
            companyPerc: 0,
            riderPerc: 100,
            baseCompanyPerc: 0,
            isAdmin: true
        };
    }

    const cleanName = (riderName || "").toLowerCase().trim();
    const setting = globalState.globalRiderRates ? globalState.globalRiderRates[cleanName] : null;

    let baseCompanyPerc = 20;
    if (setting) {
        if (setting.percentage !== undefined) baseCompanyPerc = parseFloat(setting.percentage);
        else if (setting.basePercentage !== undefined) baseCompanyPerc = parseFloat(setting.basePercentage);
    }

    let sundayDiscount = isSunday ? 5 : 0;

    let finalCompanyPerc = Math.max(0, baseCompanyPerc - sundayDiscount);
    let companyRate = finalCompanyPerc / 100;
    let riderRate = (100 - finalCompanyPerc) / 100;

    return {
        companyRate: companyRate,
        riderRate: riderRate,
        isSunday: isSunday,
        companyPerc: finalCompanyPerc,
        riderPerc: 100 - finalCompanyPerc,
        baseCompanyPerc: baseCompanyPerc,
        isAdmin: false
    };
}

export async function fetchCommissionSettings() {
    await fetchRiderUserTypes();

    try {
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

function getCleanRiderList() {
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

function setupAdminControls() {
    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ADMIN_IDS.includes(appState.telegramId); 
    const filterBox = document.getElementById('admin-commission-filter-box');
    const select = document.getElementById('admin-rider-select');
    
    if (isAdmin) {
        filterBox.classList.remove('hidden');
        filterBox.classList.add('flex');
        
        const cleanRiders = getCleanRiderList();
        
        let options = `<option value="ALL">All Riders (Combined)</option>`;
        cleanRiders.forEach(name => {
            const isSelected = select.value === name ? "selected" : "";
            options += `<option value="${escapeHtml(name)}" ${isSelected}>${escapeHtml(name)}</option>`;
        });
        
        select.innerHTML = options;

        let addBtn = document.getElementById('admin-add-comm-btn');
        if (!addBtn && filterBox) {
            const btnHtml = `<button id="admin-add-comm-btn" onclick="promptAdminAddCommissionRecord()" class="mt-2 bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 border border-emerald-500/50 text-xs font-bold py-2 px-3 rounded-lg transition active:scale-95 flex items-center justify-center gap-1.5"><i class="fa-solid fa-plus-circle"></i> + Add Manual Record</button>`;
            filterBox.insertAdjacentHTML('beforeend', btnHtml);
        }
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

function findReceiptFeeForCustomer(rName, cName, rDate) {
    const cleanRider = (rName || "").toLowerCase().trim();
    const cleanCust = (cName || "").toLowerCase().replace(/[^a-z0-9]/g, '');

    const receipts = globalState.globalDailyReceipts || [];
    for (let rc of receipts) {
        const rcRider = (rc.riderName || "").toLowerCase().trim();
        const rcCust = (rc.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '');
        const rcDate = rc.date || rc.completedDate;

        if (rcRider === cleanRider && rcCust === cleanCust && rcDate === rDate) {
            let gross = parseFloat(rc.totalFees);
            if (!isNaN(gross) && gross > 0) return gross;
        }
    }
    return 0;
}

// EXPORTED MERGED & DEDUPLICATED COMMISSION DATASET
export function getMergedDeduplicatedCommissionList() {
    const mergedMap = new Map();

    (globalState.globalDailyReceipts || []).forEach(rc => {
        const cleanRider = (rc.riderName || "").toLowerCase().trim();
        const cleanCust = (rc.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '');
        const date = rc.date || rc.completedDate || getLocalTodayStr();
        const time = rc.cateringStartTime || rc.startTime || "";
        const txId = rc.transactionId || `${cleanRider}_${cleanCust}_${date}_${time}`;

        let gross = parseFloat(rc.totalFees);
        if (isNaN(gross) || gross === 0) {
            let f = rc.fees;
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

        const dedupKey = txId || `${cleanRider}_${cleanCust}_${date}_${time}`;
        if (!mergedMap.has(dedupKey) || (mergedMap.get(dedupKey).totalFees < gross)) {
            mergedMap.set(dedupKey, {
                transactionId: txId,
                telegramId: rc.telegramId || rc.riderId,
                riderName: rc.riderName || "Rider",
                customerName: rc.customerName || "Customer",
                date: date,
                time: time,
                totalFees: gross,
                isReceipt: true
            });
        }
    });

    (globalState.globalCateredHistory || []).forEach(ch => {
        const cleanRider = (ch.riderName || "").toLowerCase().trim();
        const cleanCust = (ch.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '');
        const date = ch.completedDate || ch.date || getLocalTodayStr();
        const time = ch.startTime || ch.completedTime || "";

        let gross = parseFloat(ch.totalFees);
        if (isNaN(gross) || gross === 0) {
            gross = findReceiptFeeForCustomer(cleanRider, cleanCust, date);
        }

        const dedupKey = ch.transactionId || `${cleanRider}_${cleanCust}_${date}_${time}`;

        if (gross > 0 && !mergedMap.has(dedupKey)) {
            let matchedInMap = false;
            for (let [k, val] of mergedMap.entries()) {
                if (val.riderName.toLowerCase().trim() === cleanRider && 
                    val.customerName.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCust && 
                    val.date === date) {
                    matchedInMap = true;
                    break;
                }
            }

            if (!matchedInMap) {
                mergedMap.set(dedupKey, {
                    transactionId: ch.transactionId || dedupKey,
                    telegramId: ch.telegramId || ch.riderId,
                    riderName: ch.riderName || "Rider",
                    customerName: ch.customerName || "Customer",
                    date: date,
                    time: time,
                    startTime: ch.startTime || "",
                    completedTime: ch.completedTime || "",
                    duration: ch.duration || "",
                    totalFees: gross,
                    isReceipt: false
                });
            }
        }
    });

    return Array.from(mergedMap.values());
}

export function refreshCommissionView() {
    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ADMIN_IDS.includes(appState.telegramId);
    let targetRiderFilter = isAdmin ? document.getElementById('admin-rider-select')?.value : appState.telegramId;
    if (targetRiderFilter === "ALL") targetRiderFilter = null; 

    const dateInput = document.getElementById(`comm-input-${viewSettings.period}`);
    if (dateInput) viewSettings.dateValue = dateInput.value;
    if (!viewSettings.dateValue) return;

    const mergedList = getMergedDeduplicatedCommissionList();

    let filteredHistory = mergedList.filter(record => {
        let rDate = record.date || getLocalTodayStr();
        
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

    let riderTotals = {}; 

    filteredHistory.forEach(r => {
        let rId = (r.telegramId || "").toString();
        let rName = r.riderName || "Unknown Rider";
        let cName = r.customerName || "Customer";
        let rDate = r.date || getLocalTodayStr();

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
            const myRoster = globalState.rosterMembers?.find(m => (m.telegramId || "").toString() === targetRiderFilter.toString());
            const targetName = myRoster ? (myRoster.riderName || myRoster.name || "").toLowerCase() : targetRiderFilter.toLowerCase();
            
            const isIdMatch = rId.toString() === targetRiderFilter.toString();
            const isNameMatch = riderTotals[rId].name.toLowerCase() === targetName;

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
        const rName = myRoster ? (myRoster.riderName || myRoster.name || "") : appState.riderName;
        selectedRiderRates = getCommissionRates(viewSettings.dateValue, rName, targetRiderFilter);
    }

    const mainWrapperEl = document.getElementById('comm-main-wrapper');
    const mainLabelEl = document.getElementById('comm-main-label');
    const grossEl = document.getElementById('comm-gross-amount');
    const summaryTitleEl = document.getElementById('comm-summary-title');
    const mainAmountEl = document.getElementById('comm-main-amount');

    if (grossEl) grossEl.innerText = grandGross.toFixed(2);
    if (summaryTitleEl) summaryTitleEl.innerText = `${viewSettings.period.toUpperCase()} SUMMARY`;

    const selDate = new Date(viewSettings.dateValue + "T00:00:00");
    const isSelSunday = viewSettings.period === 'daily' && selDate.getDay() === 0;

    const displayRates = selectedRiderRates || getCommissionRates(viewSettings.dateValue, appState.riderName, appState.telegramId);

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
            if (displayRates.isAdmin) {
                mainLabelEl.innerText = `TO PAY COMPANY (ADMIN EXEMPT)`;
            } else {
                mainLabelEl.innerText = isSelSunday 
                    ? `TO PAY COMPANY (${displayRates.companyPerc}% SUNDAY PROMO)` 
                    : `TO PAY COMPANY (${displayRates.companyPerc}%)`;
            }
            mainLabelEl.className = "text-[10px] text-red-400 font-bold uppercase";
        }
        if (mainWrapperEl) mainWrapperEl.className = "text-4xl font-black text-red-400 drop-shadow-md";
        if (mainAmountEl) mainAmountEl.innerText = grandCompany.toFixed(2);
    }

    renderRiderSummaryList(finalRiderList);
    checkSettlementStatus(targetRiderFilter, viewSettings.period, viewSettings.dateValue, isAdmin);
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

export function promptAdminAddCommissionRecord() {
    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ADMIN_IDS.includes(appState.telegramId);
    if (!isAdmin) return showToast("⚠️ Admin access required.");

    const modal = document.getElementById('admin-add-comm-modal');
    const riderSelect = document.getElementById('manual-comm-rider-select');
    const custInput = document.getElementById('manual-comm-cust-input');
    const feeInput = document.getElementById('manual-comm-fee-input');
    const dateInput = document.getElementById('manual-comm-date-input');

    if (!modal || !riderSelect) return;

    const cleanRiders = getCleanRiderList();
    let optionsHtml = "";
    cleanRiders.forEach(name => {
        optionsHtml += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
    });
    riderSelect.innerHTML = optionsHtml;

    if (custInput) custInput.value = "";
    if (feeInput) feeInput.value = "";
    if (dateInput) dateInput.value = viewSettings.dateValue || getLocalTodayStr();

    modal.classList.remove('hidden');
}

export function closeAdminAddCommModal() {
    const modal = document.getElementById('admin-add-comm-modal');
    if (modal) modal.classList.add('hidden');
}

export function submitAdminAddCommissionRecord() {
    const riderSelect = document.getElementById('manual-comm-rider-select');
    const custInput = document.getElementById('manual-comm-cust-input');
    const feeInput = document.getElementById('manual-comm-fee-input');
    const dateInput = document.getElementById('manual-comm-date-input');

    const rNameInput = riderSelect ? riderSelect.value.trim() : "";
    const cNameInput = custInput ? custInput.value.trim() : "";
    const grossFee = feeInput ? parseFloat(feeInput.value) : NaN;
    const dateVal = dateInput ? dateInput.value : getLocalTodayStr();

    if (!rNameInput) return showToast("⚠️ Please select a rider.");
    if (!cNameInput) return showToast("⚠️ Please enter customer name.");
    if (isNaN(grossFee) || grossFee <= 0) return showToast("⚠️ Please enter a valid gross fee.");

    const timeVal = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const cleanRiderKey = rNameInput.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanCustKey = cNameInput.toLowerCase().replace(/[^a-z0-9]/g, '');
    const txId = `RCPT_MANUAL_${cleanRiderKey}_${cleanCustKey}_${Date.now()}`;

    const newRecord = {
        type: "receipts",
        transactionId: txId,
        telegramId: "",
        riderName: rNameInput,
        customerName: cNameInput,
        cateringStartTime: timeVal,
        totalFees: grossFee,
        date: dateVal,
        fees: { delivery: grossFee }
    };

    if (!globalState.globalDailyReceipts) globalState.globalDailyReceipts = [];
    globalState.globalDailyReceipts.push(newRecord);

    db.ref('receipts/' + txId).set(newRecord);

    try {
        fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(newRecord) });
    } catch(e) {}

    closeAdminAddCommModal();
    showToast(`✅ Added ₱${grossFee.toFixed(2)} for ${cNameInput} (${rNameInput})`);
    refreshCommissionView();
}

export function promptAdminDeleteCommissionRecord(riderName, customerName, dateVal, txId) {
    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ADMIN_IDS.includes(appState.telegramId);
    if (!isAdmin) return showToast("⚠️ Admin access required.");

    openSlideDeleteModal(
        `Delete Commission Record?`,
        `Sigurado ka bang nais mong burahin ang record ni [${customerName}] (${riderName}) sa ${dateVal}?`,
        () => {
            executeDeleteCommissionRecord(riderName, customerName, dateVal, txId);
        }
    );
}

export function executeDeleteCommissionRecord(riderName, customerName, dateVal, txId) {
    const cleanRider = (riderName || "").toLowerCase().trim();
    const cleanCust = (customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '');

    if (globalState.globalDailyReceipts) {
        globalState.globalDailyReceipts = globalState.globalDailyReceipts.filter(rc => {
            if (txId && rc.transactionId === txId) return false;
            const matchRider = (rc.riderName || "").toLowerCase().trim() === cleanRider;
            const matchCust = (rc.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCust;
            const matchDate = (rc.date || rc.completedDate) === dateVal;
            return !(matchRider && matchCust && matchDate);
        });
    }

    if (globalState.globalCateredHistory) {
        globalState.globalCateredHistory = globalState.globalCateredHistory.filter(ch => {
            if (txId && ch.transactionId === txId) return false;
            const matchRider = (ch.riderName || "").toLowerCase().trim() === cleanRider;
            const matchCust = (ch.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCust;
            const matchDate = (ch.completedDate || ch.date) === dateVal;
            return !(matchRider && matchCust && matchDate);
        });
    }

    db.ref('receipts').once('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            Object.keys(data).forEach(key => {
                const item = data[key];
                if (txId && (item.transactionId === txId || key === txId)) {
                    db.ref('receipts/' + key).remove();
                } else {
                    const matchRider = (item.riderName || "").toLowerCase().trim() === cleanRider;
                    const matchCust = (item.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCust;
                    const matchDate = (item.date || item.completedDate) === dateVal;
                    if (matchRider && matchCust && matchDate) {
                        db.ref('receipts/' + key).remove();
                    }
                }
            });
        }
    });

    db.ref('cateredHistory').once('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            Object.keys(data).forEach(key => {
                const item = data[key];
                if (txId && (item.transactionId === txId || key === txId)) {
                    db.ref('cateredHistory/' + key).remove();
                } else {
                    const matchRider = (item.riderName || "").toLowerCase().trim() === cleanRider;
                    const matchCust = (item.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCust;
                    const matchDate = (item.completedDate || item.date) === dateVal;
                    if (matchRider && matchCust && matchDate) {
                        db.ref('cateredHistory/' + key).remove();
                    }
                }
            });
        }
    });

    try {
        fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ type: "void_history", riderName, customerName, completedDate: dateVal }) });
    } catch(e) {}

    showToast("🗑️ Record deleted successfully!");
    refreshCommissionView();
}

export function promptAdminEditCustomerFee(riderName, customerName, dateVal, currentGross) {
    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ADMIN_IDS.includes(appState.telegramId);
    if (!isAdmin) return showToast("⚠️ Admin access required to update fees.");

    const newFeeInput = prompt(`Update Gross Fee for [${customerName}] (${riderName}):`, currentGross || "0.00");
    if (newFeeInput === null) return;

    const parsedFee = parseFloat(newFeeInput);
    if (isNaN(parsedFee) || parsedFee < 0) return showToast("⚠️ Invalid fee amount entered.");

    const cleanCustKey = customerName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanRider = riderName.toLowerCase().trim();

    (globalState.globalDailyReceipts || []).forEach(rc => {
        const matchRider = (rc.riderName || "").toLowerCase().trim() === cleanRider;
        const matchCust = (rc.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCustKey;
        if (matchRider && matchCust) {
            rc.totalFees = parsedFee;
        }
    });

    (globalState.globalCateredHistory || []).forEach(ch => {
        const matchRider = (ch.riderName || "").toLowerCase().trim() === cleanRider;
        const matchCust = (ch.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCustKey;
        if (matchRider && matchCust) {
            ch.totalFees = parsedFee;
        }
    });

    db.ref('receipts').once('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            Object.keys(data).forEach(key => {
                const item = data[key];
                const matchRider = (item.riderName || "").toLowerCase().trim() === cleanRider;
                const matchCust = (item.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCustKey;
                if (matchRider && matchCust) {
                    db.ref('receipts/' + key).update({ totalFees: parsedFee });
                }
            });
        }
    });

    db.ref('cateredHistory').once('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            Object.keys(data).forEach(key => {
                const item = data[key];
                const matchRider = (item.riderName || "").toLowerCase().trim() === cleanRider;
                const matchCust = (item.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCustKey;
                if (matchRider && matchCust) {
                    db.ref('cateredHistory/' + key).update({ totalFees: parsedFee });
                }
            });
        }
    });

    showToast(`✅ Fee updated to ₱${parsedFee.toFixed(2)} for ${customerName}!`);
    refreshCommissionView();
}

function renderRiderSummaryList(riderListArray) {
    const container = document.getElementById('commission-rider-list');
    if (!container) return;
    
    if (riderListArray.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic text-xs py-10">No active commission records for this period.</div>`;
        return;
    }

    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ADMIN_IDS.includes(appState.telegramId);

    container.innerHTML = riderListArray.map((rider, idx) => {
        const rates = rider.lastRates || getCommissionRates(viewSettings.dateValue, rider.name, rider.id);
        
        let amountLabel = "";
        let colorClass = "";

        if (viewSettings.mode === 'earned') {
            amountLabel = `+ ₱${rider.earned.toFixed(2)}`;
            colorClass = "text-emerald-400";
        } else {
            if (rates.isAdmin) {
                amountLabel = `- ₱0.00 (Admin Exempt)`;
                colorClass = "text-gray-400";
            } else {
                amountLabel = `- ₱${rider.company.toFixed(2)}`;
                colorClass = "text-red-400";
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
                    ? `<button onclick="event.stopPropagation(); promptAdminEditCustomerFee('${escapeHtml(rider.name)}', '${escapeHtml(c.customerName)}', '${c.date}', ${c.gross})" class="text-amber-400 hover:text-amber-300 ml-1.5 p-0.5" title="Edit Fee"><i class="fa-solid fa-pen text-[10px]"></i></button>` 
                    : ``;

                const deleteBtn = isAdmin 
                    ? `<button onclick="event.stopPropagation(); promptAdminDeleteCommissionRecord('${escapeHtml(rider.name)}', '${escapeHtml(c.customerName)}', '${c.date}', '${c.transactionId}')" class="text-red-400 hover:text-red-300 ml-1 p-0.5" title="Delete Record"><i class="fa-solid fa-trash text-[10px]"></i></button>` 
                    : ``;

                return `
                <div class="bg-black/40 p-2.5 rounded-lg border border-gray-800/80 flex justify-between items-center text-xs">
                    <div class="flex flex-col gap-0.5">
                        <span class="font-bold text-orange-300 flex items-center gap-1.5">
                            <i class="fa-solid fa-user text-[10px]"></i> ${escapeHtml(c.customerName)} ${editBtn} ${deleteBtn}
                        </span>
                        <span class="text-[10px] text-gray-400 font-mono">${escapeHtml(dateTimeStr)}</span>
                    </div>
                    <div class="text-right">
                        <div class="font-bold ${colorClass}">${cAmt}</div>
                        <div class="text-[9px] text-gray-500 font-mono">Paid: ₱${c.gross.toFixed(2)}</div>
                    </div>
                </div>`;
            }).join('');
        } else {
            customerItemsHtml = `<div class="text-gray-500 italic text-[11px] py-2 text-center">No individual orders recorded.</div>`;
        }

        const adminBadge = rates.isAdmin ? `<span class="bg-purple-600/20 text-purple-300 border border-purple-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded ml-1">ADMIN</span>` : '';

        return `
            <div class="bg-cardBg rounded-xl border border-gray-800 shadow-sm flex flex-col overflow-hidden">
                <div onclick="toggleRiderCustomerBreakdown('${uid}')" class="p-3.5 flex justify-between items-center text-sm cursor-pointer hover:bg-white/5 transition active:scale-[0.99] select-none">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-blue-300 flex items-center gap-1.5">
                            <i class="fa-solid fa-motorcycle text-gray-500"></i> ${escapeHtml(rider.name)} ${adminBadge}
                        </span>
                        <span class="bg-blue-600/20 text-blue-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-500/30">
                            ${customerCount} ${customerCount === 1 ? 'customer' : 'customers'}
                        </span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="font-black ${colorClass}">${amountLabel}</span>
                        <i id="icon-${uid}" class="fa-solid fa-chevron-down text-gray-400 text-xs transition-transform duration-300"></i>
                    </div>
                </div>

                <div id="box-${uid}" class="hidden bg-darkBg/60 p-3 border-t border-gray-800/80 flex flex-col gap-2">
                    <div class="text-[10px] text-amber-400 font-bold uppercase tracking-wider mb-1 flex items-center justify-between">
                        <span><i class="fa-solid fa-list-check"></i> Customer Breakdown (${viewSettings.period.toUpperCase()})</span>
                        <span class="text-gray-400">Total Paid: ₱${rider.gross.toFixed(2)}</span>
                    </div>
                    ${customerItemsHtml}
                </div>
            </div>
        `;
    }).join('');
}

export function generateDailyReportText() {
    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ADMIN_IDS.includes(appState.telegramId);
    let targetRiderFilter = isAdmin ? document.getElementById('admin-rider-select')?.value : appState.telegramId;
    if (targetRiderFilter === "ALL") targetRiderFilter = null;

    const mergedList = getMergedDeduplicatedCommissionList();

    let filteredHistory = mergedList.filter(record => {
        let rDate = record.date || getLocalTodayStr();
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
        let rId = (r.telegramId || "").toString();
        let rName = r.riderName || "Unknown";
        let cName = r.customerName || "Customer";
        let rDate = r.date || getLocalTodayStr();

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
            const myRoster = globalState.rosterMembers?.find(m => (m.telegramId || "").toString() === targetRiderFilter.toString());
            const targetName = myRoster ? (myRoster.riderName || myRoster.name || "").toLowerCase() : targetRiderFilter.toLowerCase();
            
            const isIdMatch = rId.toString() === targetRiderFilter.toString();
            const isNameMatch = riderTotals[rId].name.toLowerCase() === targetName;

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

if (typeof window !== 'undefined') {
    window.openCommissionScreen = openCommissionScreen;
    window.setCommissionMode = setCommissionMode;
    window.setCommissionPeriod = setCommissionPeriod;
    window.refreshCommissionView = refreshCommissionView;
    window.toggleSettlementStatus = toggleSettlementStatus;
    window.generateDailyReportText = generateDailyReportText;
    window.toggleRiderCustomerBreakdown = toggleRiderCustomerBreakdown;
    window.promptAdminEditCustomerFee = promptAdminEditCustomerFee;
    window.promptAdminAddCommissionRecord = promptAdminAddCommissionRecord;
    window.closeAdminAddCommModal = closeAdminAddCommModal;
    window.submitAdminAddCommissionRecord = submitAdminAddCommissionRecord;
    window.promptAdminDeleteCommissionRecord = promptAdminDeleteCommissionRecord;
    window.executeDeleteCommissionRecord = executeDeleteCommissionRecord;
    window.fetchRiderUserTypes = fetchRiderUserTypes;
    window.isRiderAdmin = isRiderAdmin;
    window.getMergedDeduplicatedCommissionList = getMergedDeduplicatedCommissionList;
}

window.addEventListener('receiptsUpdated', refreshCommissionView);
window.addEventListener('cateredUpdated', refreshCommissionView);