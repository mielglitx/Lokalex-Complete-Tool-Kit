// src/features/commission.js
import { appState, globalState } from '../store/state.js';
import { API_URL, ADMIN_IDS } from '../config/constants.js';
import { switchView } from '../ui/router.js';
import { getLocalTodayStr, isSameDate, escapeHtml, copyText } from '../utils/helpers.js';

// Direct CSV export URL for the CommissionSettings tab (gid=1969671340)
const CSV_COMMISSION_SETTINGS_URL = "https://docs.google.com/spreadsheets/d/1lc-1os3xTnAuE0dsm6UmEle7vxuRyewBnuBlSrfPSWk/export?format=csv&gid=1969671340";

function isAdmin() {
    const t = (appState.userType || "").toLowerCase();
    return t === "admin" || ADMIN_IDS.includes(appState.telegramId);
}

// Fetch commission rates directly from Google Sheets CommissionSettings tab
export async function fetchRiderRates() {
    try {
        // 1. Try Apps Script API first
        const res = await fetch(`${API_URL}?type=all`);
        if (res.ok) {
            const bundle = await res.json();
            if (bundle && bundle.riderRates && Object.keys(bundle.riderRates).length > 0) {
                globalState.globalRiderRates = bundle.riderRates;
                return;
            }
        }
    } catch(e) {}

    // 2. Direct CSV Export Fallback (gid=1969671340)
    try {
        const csvRes = await fetch(CSV_COMMISSION_SETTINGS_URL);
        if (csvRes.ok) {
            const csvText = await csvRes.text();
            const lines = csvText.split('\n');
            const rates = {};

            lines.forEach((line, index) => {
                if (index === 0) return; // Skip headers (Rider, Percentage, IsPromoLessPerc)
                const cols = line.split(',');
                if (cols.length >= 2) {
                    const rider = cols[0].replace(/['"\r\n]+/g, '').trim().toLowerCase();
                    const percentage = parseFloat(cols[1].replace(/['"\r\n]+/g, '').trim()) || 20;
                    const promoLess = cols[2] ? (parseFloat(cols[2].replace(/['"\r\n]+/g, '').trim()) || 0) : 0;

                    if (rider) {
                        rates[rider] = {
                            rate: percentage,
                            promoLess: promoLess,
                            effectiveRate: Math.max(0, percentage - promoLess)
                        };
                    }
                }
            });

            if (Object.keys(rates).length > 0) {
                globalState.globalRiderRates = rates;
            }
        }
    } catch(e) {
        console.warn("Failed to fetch CommissionSettings sheet CSV:", e);
    }
}

export function getRiderEffectiveRate(rName) {
    if (!rName) return 20;
    const clean = rName.trim().toLowerCase();
    
    if (globalState.globalRiderRates && globalState.globalRiderRates[clean]) {
        const item = globalState.globalRiderRates[clean];
        if (item.effectiveRate !== undefined) return item.effectiveRate;
        if (item.rate !== undefined) return item.rate;
    }
    return 20;
}

export function toggleRiderCustomers(uid) {
    const drawer = document.getElementById(`rider-cust-drawer-${uid}`);
    const icon = document.getElementById(`rider-cust-icon-${uid}`);
    const textEl = document.getElementById(`rider-cust-text-${uid}`);

    if (!drawer) return;

    const isHidden = drawer.classList.contains('hidden');
    if (isHidden) {
        drawer.classList.remove('hidden');
        if (icon) icon.style.transform = "rotate(180deg)";
        if (textEl) textEl.innerText = "Hide Customers";
    } else {
        drawer.classList.add('hidden');
        if (icon) icon.style.transform = "rotate(0deg)";
        if (textEl) textEl.innerText = "Show Customers";
    }
}

export async function openCommissionScreen(selectedDate = null) {
    switchView('view-commission');
    document.getElementById('header-title').innerText = "Daily Commission";
    const container = document.getElementById('commission-receipts-list');
    container.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fa-solid fa-spinner fa-spin"></i> Loading records & settings...</div>`;

    // Always fetch latest rates from CommissionSettings tab first
    await fetchRiderRates();

    const todayStr = getLocalTodayStr();
    const targetDate = selectedDate && typeof selectedDate === 'string' ? selectedDate : todayStr;
    document.getElementById('commission-date-picker').value = targetDate;
    document.getElementById('commission-date-label').innerText = targetDate === todayStr ? "Today" : targetDate;

    const filterBox = document.getElementById('admin-commission-filter-box');
    const riderSelect = document.getElementById('admin-rider-select');

    if (isAdmin()) {
        filterBox.classList.remove('hidden');
        let riders = globalState.rosterMembers ? globalState.rosterMembers.map(r => r.riderName) : [];
        if (globalState.globalRiderRates) {
            Object.keys(globalState.globalRiderRates).forEach(k => {
                let formattedName = k.charAt(0).toUpperCase() + k.slice(1);
                riders.push(formattedName);
            });
        }
        riders = [...new Set(riders)];
        let currentSel = riderSelect.value || "ALL";
        riderSelect.innerHTML = `<option value="ALL">All Riders</option>` + riders.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
        riderSelect.value = currentSel;
    } else {
        filterBox.classList.add('hidden');
    }

    try {
        const res = await fetch(`${API_URL}?type=receipts`);
        if (res.ok) {
            const allReceipts = await res.json();
            const selectedFilterRider = isAdmin() ? riderSelect.value : appState.riderName;

            const myTargetReceipts = allReceipts.filter(r => isSameDate(r.date || r.Date, targetDate));
            globalState.globalDailyReceipts = myTargetReceipts;

            // Helper: Detect if a rider name belongs to an Admin account
            const isRiderAdmin = (rName) => {
                if (!rName) return false;
                const clean = rName.trim().toLowerCase();
                const record = globalState.rosterMembers ? globalState.rosterMembers.find(rm => rm.riderName.trim().toLowerCase() === clean) : null;
                if (record && (record.userType.toLowerCase() === 'admin' || ADMIN_IDS.includes(record.telegramId))) {
                    return true;
                }
                return false;
            };

            // -------------------------------------------------------------
            // MODE A: ADMIN - ALL RIDERS SUMMARY VIEW WITH EXPANDABLE CUSTOMERS
            // -------------------------------------------------------------
            if (isAdmin() && selectedFilterRider === "ALL") {
                const riderSummary = {};

                myTargetReceipts.forEach(r => {
                    const cName = (r.customerName || r.customername || r.CustomerName || "").toString().trim();
                    if (!cName || cName.toLowerCase() === "sample") return;

                    const rName = r.riderName || r.ridername || r.RiderName || "Unknown";
                    
                    // EXCLUDE ADMINS
                    if (isRiderAdmin(rName)) return;

                    const feesVal = parseFloat(r.totalFees || r.totalfees || r.TotalFees || 0);
                    const rate = getRiderEffectiveRate(rName);

                    if (!riderSummary[rName]) {
                        riderSummary[rName] = { gross: 0, rate: rate, pay: 0, customers: {} };
                    }
                    
                    riderSummary[rName].gross += feesVal;
                    riderSummary[rName].pay += feesVal * (rate / 100);

                    if (!riderSummary[rName].customers[cName]) {
                        riderSummary[rName].customers[cName] = 0;
                    }
                    riderSummary[rName].customers[cName] += feesVal;
                });

                let totalGross = 0;
                let totalCompanyShare = 0;

                const riderKeys = Object.keys(riderSummary).filter(rName => riderSummary[rName].pay > 0 || riderSummary[rName].gross > 0);

                if (riderKeys.length === 0) {
                    container.innerHTML = `<div class="text-center py-10 text-gray-400 text-xs">No rider commissions recorded for date: ${targetDate}</div>`;
                } else {
                    container.innerHTML = riderKeys.map(rName => {
                        const item = riderSummary[rName];
                        totalGross += item.gross;
                        totalCompanyShare += item.pay;

                        const uid = Math.random().toString(36).substr(2, 9);
                        const custNames = Object.keys(item.customers);

                        const customerListHtml = custNames.map(cName => `
                            <div class="flex justify-between items-center py-1.5 px-2.5 rounded-lg bg-darkBg/50 border border-gray-800 text-xs">
                                <span class="text-gray-300 flex items-center gap-2 font-medium">
                                    <i class="fa-solid fa-user text-[10px] text-blue-400"></i> ${escapeHtml(cName)}
                                </span>
                                <span class="font-bold text-green-400">₱${item.customers[cName].toFixed(2)}</span>
                            </div>
                        `).join('');

                        return `
                        <div class="bg-cardBg border border-gray-800 p-4 rounded-xl shadow-sm flex flex-col gap-3 transition-all">
                            <div class="flex justify-between items-center border-b border-gray-800 pb-2">
                                <div class="flex items-center gap-2.5">
                                    <div class="w-8 h-8 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold text-xs">
                                        <i class="fa-solid fa-motorcycle"></i>
                                    </div>
                                    <span class="font-bold text-sm text-white">${escapeHtml(rName)}</span>
                                </div>
                                <span class="bg-amber-500/20 text-amber-400 text-[11px] font-bold px-2.5 py-1 rounded-lg border border-amber-500/30">
                                    ${item.rate}% Rate
                                </span>
                            </div>

                            <div class="grid grid-cols-2 gap-2 text-xs pt-0.5">
                                <div class="bg-darkBg/60 p-2.5 rounded-lg border border-gray-800/80">
                                    <span class="text-[10px] text-gray-400 font-semibold block uppercase">Earned (Gross)</span>
                                    <span class="font-black text-white text-sm mt-0.5 block">₱${item.gross.toFixed(2)}</span>
                                </div>
                                <div class="bg-red-950/30 p-2.5 rounded-lg border border-red-800/40">
                                    <span class="text-[10px] text-red-400 font-semibold block uppercase">To Pay Company</span>
                                    <span class="font-black text-red-400 text-sm mt-0.5 block">₱${item.pay.toFixed(2)}</span>
                                </div>
                            </div>

                            <!-- TOGGLE SHOW CUSTOMERS BUTTON -->
                            <button onclick="toggleRiderCustomers('${uid}')" class="w-full mt-1 py-2 px-3 rounded-lg bg-inputBg hover:bg-gray-800 border border-gray-700/60 text-xs font-bold text-blue-400 hover:text-blue-300 flex items-center justify-between transition active:scale-98">
                                <span class="flex items-center gap-1.5">
                                    <i class="fa-solid fa-users text-xs"></i> 
                                    <span id="rider-cust-text-${uid}">Show Customers</span> (${custNames.length})
                                </span>
                                <i id="rider-cust-icon-${uid}" class="fa-solid fa-chevron-down transition-transform duration-300 text-gray-400 text-xs"></i>
                            </button>

                            <!-- EXPANDABLE CUSTOMERS LIST DRAWER -->
                            <div id="rider-cust-drawer-${uid}" class="hidden flex flex-col gap-1.5 pt-2 border-t border-gray-800/60 transition-all">
                                ${customerListHtml}
                            </div>
                        </div>`;
                    }).join('');
                }

                globalState.currentDayTotalCommission = totalGross;
                globalState.currentDayCompanyShare = totalCompanyShare;
                globalState.currentDayRiderNet = totalGross - totalCompanyShare;

                document.getElementById('company-rate-label').innerText = "VAR";
                document.getElementById('daily-gross-total').innerText = totalGross.toFixed(2);
                document.getElementById('daily-company-share').innerText = totalCompanyShare.toFixed(2);
                document.getElementById('daily-company-share-pay').innerText = totalCompanyShare.toFixed(2);
                document.getElementById('daily-rider-net').innerText = (totalGross - totalCompanyShare).toFixed(2);

            // -------------------------------------------------------------
            // MODE B: SINGLE RIDER VIEW (Individual Customer Breakdowns)
            // -------------------------------------------------------------
            } else {
                const filteredReceipts = myTargetReceipts.filter(r => {
                    const cName = (r.customerName || r.customername || r.CustomerName || "").toString().trim().toLowerCase();
                    if (cName === "sample") return false;

                    const rName = (r.riderName || r.ridername || r.RiderName || "").toString().trim().toLowerCase();
                    return rName === (selectedFilterRider || appState.riderName).trim().toLowerCase();
                });

                globalState.currentDayTotalCommission = 0;
                globalState.currentDayCompanyShare = 0;
                globalState.currentDayCustomerMap = {};

                if (filteredReceipts.length === 0) {
                    container.innerHTML = `<div class="text-center py-10 text-gray-400 text-xs">No receipts logged for date: ${targetDate}</div>`;
                } else {
                    filteredReceipts.forEach(r => {
                        const custName = r.customerName || r.customername || r.CustomerName || "Unknown";
                        const riderWhoServed = r.riderName || r.ridername || r.RiderName || appState.riderName;
                        const feesVal = parseFloat(r.totalFees || r.totalfees || r.TotalFees || 0);
                        
                        globalState.currentDayTotalCommission += feesVal;
                        const riderEffectiveRate = getRiderEffectiveRate(riderWhoServed);
                        globalState.currentDayCompanyShare += feesVal * (riderEffectiveRate / 100);

                        if (!globalState.currentDayCustomerMap[custName]) globalState.currentDayCustomerMap[custName] = 0;
                        globalState.currentDayCustomerMap[custName] += feesVal;
                    });

                    container.innerHTML = Object.keys(globalState.currentDayCustomerMap).map(custName => {
                        return `
                        <div class="bg-cardBg border border-gray-800 p-4 rounded-xl shadow-sm flex justify-between items-center">
                            <div class="flex items-center gap-3">
                                <div class="w-9 h-9 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold text-sm">
                                    <i class="fa-solid fa-user"></i>
                                </div>
                                <div class="font-bold text-sm text-white">${escapeHtml(custName)}</div>
                            </div>
                            <div class="font-bold text-base text-green-400">
                                ₱${globalState.currentDayCustomerMap[custName].toFixed(2)}
                            </div>
                        </div>`;
                    }).join('');
                }

                globalState.currentDayRiderNet = globalState.currentDayTotalCommission - globalState.currentDayCompanyShare;

                const displayRate = `${getRiderEffectiveRate(selectedFilterRider || appState.riderName)}%`;

                document.getElementById('company-rate-label').innerText = displayRate;
                document.getElementById('daily-gross-total').innerText = globalState.currentDayTotalCommission.toFixed(2);
                document.getElementById('daily-company-share').innerText = globalState.currentDayCompanyShare.toFixed(2);
                document.getElementById('daily-company-share-pay').innerText = globalState.currentDayCompanyShare.toFixed(2);
                document.getElementById('daily-rider-net').innerText = globalState.currentDayRiderNet.toFixed(2);
            }
        }
    } catch(e) {
        container.innerHTML = `<div class="text-center py-10 text-red-400">Failed to load commission logs.</div>`;
    }
}

export function generateDailyReportText() {
    const targetDate = document.getElementById('commission-date-picker').value || getLocalTodayStr();
    const filterTarget = isAdmin() ? document.getElementById('admin-rider-select').value : appState.riderName;

    let reportText = "";

    if (isAdmin() && filterTarget === "ALL") {
        let grandTotalGross = 0;
        let grandTotalPay = 0;
        const riderStats = {};

        globalState.globalDailyReceipts.forEach(r => {
            const cName = (r.customerName || r.customername || r.CustomerName || "").toString().trim().toLowerCase();
            if (cName === "sample") return;

            const rName = r.riderName || "Unknown";
            const rRecord = globalState.rosterMembers ? globalState.rosterMembers.find(rm => rm.riderName.toLowerCase() === rName.toLowerCase()) : null;
            if (rRecord && (rRecord.userType.toLowerCase() === "admin" || ADMIN_IDS.includes(rRecord.telegramId))) return;

            const rate = getRiderEffectiveRate(rName);
            if (rate <= 0) return;

            if (!riderStats[rName]) riderStats[rName] = { gross: 0, rate: rate };
            riderStats[rName].gross += parseFloat(r.totalFees || r.totalfees || r.TotalFees || 0);
        });

        let lines = [];
        Object.keys(riderStats).forEach(rName => {
            const gross = riderStats[rName].gross;
            const rate = riderStats[rName].rate;
            const pay = gross * (rate / 100);
            grandTotalGross += gross; 
            grandTotalPay += pay;

            lines.push(
`👤 **Rider:** ${rName}
💵 **Total Earned:** ₱${gross.toFixed(2)}
🏢 **Commission Rate:** ${rate}%
🔴 **To Pay Company:** ₱${pay.toFixed(2)}
------------------------`);
        });

        reportText = 
`📊 **LOKALEX ALL-RIDERS COMMISSION REPORT** 📊
📅 **Date:** ${targetDate}
➖➖➖➖➖➖➖➖➖➖➖➖
${lines.length ? lines.join('\n') : '• No commissionable riders recorded today.'}
➖➖➖➖➖➖➖➖➖➖➖➖
💵 **GRAND TOTAL GROSS:** ₱${grandTotalGross.toFixed(2)}
🔴 **GRAND TOTAL TO PAY COMPANY:** ₱${grandTotalPay.toFixed(2)}

💙 Generated via Lokalex Hub`;
    } else {
        const effectiveRate = getRiderEffectiveRate(filterTarget);
        let customerLines = Object.keys(globalState.currentDayCustomerMap).length > 0 
            ? Object.keys(globalState.currentDayCustomerMap).map(c => `• ${c}: ₱${globalState.currentDayCustomerMap[c].toFixed(2)}`).join('\n')
            : '• No customers served.';

        reportText = 
`📊 **LOKALEX COMMISSION REPORT** 📊
📅 **Date:** ${targetDate}
🛵 **Target:** ${filterTarget}
➖➖➖➖➖➖➖➖➖➖➖➖
👥 **CUSTOMERS SERVED & FEES:**
${customerLines}
➖➖➖➖➖➖➖➖➖➖➖➖
💵 **Total Fees Collected (Gross): ₱${globalState.currentDayTotalCommission.toFixed(2)}**
🏢 **Company Share (${effectiveRate}%): ₱${globalState.currentDayCompanyShare.toFixed(2)}**
💰 **Rider Take-Home (Net): ₱${globalState.currentDayRiderNet.toFixed(2)}**
➖➖➖➖➖➖➖➖➖➖➖➖
🔴 **AMOUNT TO PAY COMPANY: ₱${globalState.currentDayCompanyShare.toFixed(2)}** 🔴

💙 Generated via Lokalex Hub`;
    }

    copyText(reportText);
}