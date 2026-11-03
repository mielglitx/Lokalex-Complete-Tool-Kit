// src/features/roster/rosterPerformanceTracker.js
import { db } from '../../config/firebase.js';
import { globalState, appState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { isAdmin, canManageRoster, isRiderMatch } from './rosterUtils.js';

let performanceModalElement = null;
let currentReportType = 'weekly'; // 'weekly' | 'monthly' | 'custom'
let activeSortCriteria = 'income'; // 'income' | 'catered' | 'time' | 'attendance'
let currentOffset = 0; // 0 = current, -1 = last, etc.
let customStartDate = '';
let customEndDate = '';
let cachedPerformanceData = null;
let isFetchingReport = false;

/**
 * Calculates start and end YYYY-MM-DD for a weekly period based on offset (0 = current week, -1 = last week).
 * Uses Monday as the start of the week and Sunday as the end.
 */
export function getWeeklyDateRange(offset = 0) {
    const now = new Date();
    const day = now.getDay(); // 0 is Sunday, 1 is Monday...
    const diffToMonday = day === 0 ? -6 : 1 - day; // distance to Monday

    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday + (offset * 7));
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const formatDate = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dt = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dt}`;
    };

    return {
        startDate: formatDate(monday),
        endDate: formatDate(sunday),
        label: offset === 0 ? "This Week" : (offset === -1 ? "Last Week" : `${formatDate(monday)} to ${formatDate(sunday)}`)
    };
}

/**
 * Calculates start and end YYYY-MM-DD for a monthly period based on offset (0 = current month, -1 = last month).
 */
export function getMonthlyDateRange(offset = 0) {
    const now = new Date();
    const targetMonth = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const y = targetMonth.getFullYear();
    const m = targetMonth.getMonth();

    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);

    const formatDate = (d) => {
        const yr = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const dt = String(d.getDate()).padStart(2, '0');
        return `${yr}-${mo}-${dt}`;
    };

    const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    return {
        startDate: formatDate(firstDay),
        endDate: formatDate(lastDay),
        label: `${monthNames[m]} ${y}`
    };
}

/**
 * Formats minutes into human-readable hours and minutes (e.g., "14h 30m").
 */
export function formatMinutesToHours(minutes = 0) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const hrs = Math.floor(total / 60);
    const mins = total % 60;
    if (hrs === 0) return `${mins}m`;
    if (mins === 0) return `${hrs}h`;
    return `${hrs}h ${mins}m`;
}

/**
 * Fetches and aggregates performance records across receipts, cateredHistory, shiftHistory, and riders.
 */
export async function loadRiderPerformanceData(startDate, endDate) {
    if (!db) {
        showToast("⚠️ Database unavailable.");
        return null;
    }

    try {
        isFetchingReport = true;
        renderLoadingState(true);

        const safeQuery = (refPromise, timeoutMs = 6000) => {
            return Promise.race([
                Promise.resolve(refPromise),
                new Promise(resolve => setTimeout(() => resolve(null), timeoutMs))
            ]).catch(() => null);
        };

        // 1. Concurrently fetch Receipts, Catered History, Shift History, Logins, and Riders with safe timeouts
        const [receiptsSnap, cateredSnap, shiftsSnap, loginsSnap, ridersSnap] = await Promise.all([
            safeQuery(db.ref('receipts').once('value')),
            safeQuery(db.ref('cateredHistory').once('value')),
            safeQuery(db.ref('shiftHistory').once('value')),
            safeQuery(db.ref('logins').once('value')),
            safeQuery(db.ref('riders').once('value'))
        ]);

        const rawReceipts = (receiptsSnap && typeof receiptsSnap.val === 'function') ? (receiptsSnap.val() || {}) : {};
        const rawCatered = (cateredSnap && typeof cateredSnap.val === 'function') ? (cateredSnap.val() || {}) : {};
        const rawShifts = (shiftsSnap && typeof shiftsSnap.val === 'function') ? (shiftsSnap.val() || {}) : {};
        const rawLogins = (loginsSnap && typeof loginsSnap.val === 'function') ? (loginsSnap.val() || {}) : {};
        const rawRiders = (ridersSnap && typeof ridersSnap.val === 'function') ? (ridersSnap.val() || {}) : {};

        // Merge in any daily receipts in memory
        if (globalState && Array.isArray(globalState.globalDailyReceipts)) {
            globalState.globalDailyReceipts.forEach(r => {
                if (r && (r.id || r.transactionId)) {
                    const id = r.transactionId || r.id;
                    if (!rawReceipts[id]) rawReceipts[id] = r;
                }
            });
        }

        // 2. Build canonical registered riders registry
        const riderStatsMap = new Map();

        const getOrCreateRiderStats = (id, name, avatar = '') => {
            const cleanId = (id || '').toString().trim();
            const cleanName = (name || 'Rider').trim();
            const key = cleanId || cleanName.toLowerCase();

            if (!riderStatsMap.has(key)) {
                riderStatsMap.set(key, {
                    id: cleanId,
                    name: cleanName,
                    avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanName)}&background=0284c7&color=ffffff&bold=true&size=128`,
                    totalIncome: 0,
                    customerCount: 0,
                    workedMinutes: 0,
                    breakMinutes: 0,
                    attendedDates: new Set(),
                    completedTxIds: new Set()
                });
            }
            const item = riderStatsMap.get(key);
            if (cleanName && (!item.name || item.name === 'Rider')) item.name = cleanName;
            if (avatar && !item.avatar.includes('ui-avatars')) item.avatar = avatar;
            return item;
        };

        // Populate registered riders from db 'riders'
        Object.entries(rawRiders).forEach(([rId, rData]) => {
            if (!rData) return;
            const id = (rData.telegramId || rData.id || rId).toString().trim();
            const name = (rData.riderName || rData.name || rData.displayName || '').trim();
            let photo = rData.photoUrl || rData.avatar || '';
            if (photo && (photo.includes('litterbox') || photo.includes('catbox'))) photo = '';
            getOrCreateRiderStats(id, name, photo);
        });

        // Also seed riders from globalState.allRidersList if present
        if (globalState && Array.isArray(globalState.allRidersList)) {
            globalState.allRidersList.forEach(r => {
                if (r && r.name) {
                    getOrCreateRiderStats(r.telegramId || r.id, r.name, r.avatar || r.photoUrl);
                }
            });
        }

        // 3. Process Receipts (Total delivery fees & Income)
        Object.entries(rawReceipts).forEach(([txId, r]) => {
            if (!r || r.status === 'voided' || r.voided || r.isVoided) return;
            const rDate = String(r.date || r.createdAtDate || r.completedDate || '').substring(0, 10);
            if (!rDate || rDate < startDate || rDate > endDate) return;

            const riderId = (r.telegramId || r.riderId || '').toString().trim();
            const riderName = (r.riderName || r.name || 'Rider').trim();
            const stat = getOrCreateRiderStats(riderId, riderName);

            if (!stat.completedTxIds.has(txId)) {
                stat.completedTxIds.add(txId);
                const fee = parseFloat(r.totalFees || r.fees?.delivery || r.totalFee || 0) || 0;
                stat.totalIncome += fee;
                const custs = parseInt(r.customerCount, 10) || 1;
                stat.customerCount += custs;
                if (rDate) stat.attendedDates.add(rDate);

                const dur = parseInt(r.duration, 10) || 0;
                if (dur > 0 && dur < 300) {
                    stat._orderDurations = (stat._orderDurations || 0) + dur;
                }
            }
        });

        // 4. Process Catered History (Captures orders marked done via roster)
        Object.entries(rawCatered).forEach(([txId, h]) => {
            if (!h || h.status === 'voided' || h.voided || h.isVoided) return;
            const hDate = String(h.completedDate || h.date || '').substring(0, 10);
            if (!hDate || hDate < startDate || hDate > endDate) return;

            const riderId = (h.telegramId || h.riderId || '').toString().trim();
            const riderName = (h.riderName || h.name || 'Rider').trim();
            const stat = getOrCreateRiderStats(riderId, riderName);

            if (!stat.completedTxIds.has(txId)) {
                stat.completedTxIds.add(txId);
                const fee = parseFloat(h.totalFees || h.fee || 0) || 0;
                stat.totalIncome += fee;
                const custs = parseInt(h.customerCount, 10) || 1;
                stat.customerCount += custs;
                if (hDate) stat.attendedDates.add(hDate);

                const dur = parseInt(h.duration, 10) || 0;
                if (dur > 0 && dur < 300) {
                    stat._orderDurations = (stat._orderDurations || 0) + dur;
                }
            }
        });

        // 5. Process Shift History and Daily Logins (Duty Time, Break Time & Attendance Days)
        const combinedShifts = { ...rawShifts };
        Object.entries(rawLogins).forEach(([lId, lData]) => {
            if (lData && lData.date) {
                const lDate = String(lData.date).substring(0, 10);
                if (lDate >= startDate && lDate <= endDate) {
                    combinedShifts[`${lDate}_${lId}`] = lData;
                }
            }
        });

        Object.entries(combinedShifts).forEach(([key, shift]) => {
            if (!shift || !shift.date) return;
            const sDate = String(shift.date).substring(0, 10);
            if (sDate < startDate || sDate > endDate) return;

            const riderId = (shift.riderId || shift.id || '').toString().trim();
            const riderName = (shift.riderName || '').trim();
            const stat = getOrCreateRiderStats(riderId, riderName);

            stat.attendedDates.add(sDate);

            // Track worked & break minutes
            let netWorked = parseInt(shift.workedMinutes, 10);
            let totalBreak = parseInt(shift.totalBreakMinutes, 10) || 0;

            if (isNaN(netWorked) || netWorked <= 0) {
                if (shift.loginTimestamp) {
                    const endTs = shift.clockOutTimestamp || Date.now();
                    const gross = Math.max(0, Math.floor((endTs - shift.loginTimestamp) / 60000));
                    netWorked = Math.max(0, gross - totalBreak);
                } else {
                    netWorked = 0;
                }
            }

            if (netWorked > 18 * 60) netWorked = 18 * 60;
            if (totalBreak > 8 * 60) totalBreak = 8 * 60;

            stat.workedMinutes += netWorked;
            stat.breakMinutes += totalBreak;
        });

        // Fallback: order durations
        riderStatsMap.forEach(stat => {
            if (stat.workedMinutes === 0 && stat._orderDurations > 0) {
                stat.workedMinutes = stat._orderDurations;
            }
        });

        // 6. Convert Map to Array & Calculate Averages
        const ridersList = Array.from(riderStatsMap.values()).map(r => {
            const daysCount = r.attendedDates.size;
            return {
                ...r,
                daysAttended: daysCount,
                avgIncomePerDay: daysCount > 0 ? (r.totalIncome / daysCount) : 0,
                avgOrdersPerDay: daysCount > 0 ? (r.customerCount / daysCount) : 0
            };
        });

        // Active riders
        const activeRiders = ridersList.filter(r => r.daysAttended > 0 || r.customerCount > 0 || r.totalIncome > 0);

        // 7. Find Top Performers for the 4 Criteria
        const topIncome = [...activeRiders].sort((a, b) => b.totalIncome - a.totalIncome)[0] || null;
        const topCaterer = [...activeRiders].sort((a, b) => b.customerCount - a.customerCount)[0] || null;
        const topTime = [...activeRiders].sort((a, b) => b.workedMinutes - a.workedMinutes)[0] || null;
        const topAttendance = [...activeRiders].sort((a, b) => b.daysAttended - a.daysAttended)[0] || null;

        cachedPerformanceData = {
            startDate,
            endDate,
            reportType: currentReportType,
            riders: activeRiders,
            champions: {
                income: topIncome,
                caterer: topCaterer,
                time: topTime,
                attendance: topAttendance
            },
            totalRevenue: activeRiders.reduce((acc, cur) => acc + cur.totalIncome, 0),
            totalOrders: activeRiders.reduce((acc, cur) => acc + cur.customerCount, 0),
            totalHoursWorked: activeRiders.reduce((acc, cur) => acc + cur.workedMinutes, 0)
        };

        return cachedPerformanceData;
    } catch (err) {
        console.error("Error loading performance data:", err);
        showToast("⚠️ Notice: Loaded partial or offline performance data.");
        return {
            startDate,
            endDate,
            reportType: currentReportType,
            riders: [],
            champions: { income: null, caterer: null, time: null, attendance: null },
            totalRevenue: 0,
            totalOrders: 0,
            totalHoursWorked: 0
        };
    } finally {
        isFetchingReport = false;
        renderLoadingState(false);
    }
}

/**
 * Creates or gets the Performance Tracker Modal element.
 */
export function getOrCreatePerformanceTrackerModal() {
    let modal = document.getElementById('performance-tracker-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'performance-tracker-modal';
        modal.className = 'hidden fixed inset-0 z-[9999] bg-black/85 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 select-none';
        modal.innerHTML = `
        <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 rounded-3xl w-full max-w-xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden transition-all duration-300">
            <!-- HEADER -->
            <div class="bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 p-3.5 sm:p-4 text-white flex items-center justify-between shrink-0 shadow-md">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30 text-amber-300 shadow-md text-lg shrink-0">
                        <i class="fa-solid fa-trophy"></i>
                    </div>
                    <div class="min-w-0">
                        <h2 class="text-sm sm:text-base font-black truncate leading-tight flex items-center gap-2">
                            Rider Performance Tracker
                            <span class="bg-amber-400 text-black text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider">Admin</span>
                        </h2>
                        <p class="text-[11px] text-teal-100 truncate">Top income, customers catered, work time & attendance</p>
                    </div>
                </div>
                <button type="button" onclick="window.closeAdminPerformanceTrackerModal && window.closeAdminPerformanceTrackerModal()" class="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition active:scale-95 cursor-pointer shrink-0">
                    <i class="fa-solid fa-xmark text-sm"></i>
                </button>
            </div>

            <!-- CONTROLS TOOLBAR: PERIOD PICKER & DATE NAVIGATOR -->
            <div class="p-3 bg-gray-50 dark:bg-zinc-900/90 border-b border-gray-200 dark:border-gray-800 shrink-0 flex flex-col gap-2.5">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                    <!-- Period Tabs -->
                    <div class="inline-flex p-1 bg-gray-200 dark:bg-black/40 rounded-xl gap-1 shrink-0">
                        <button type="button" id="perf-tab-weekly" onclick="window.switchPerformanceReportType('weekly')" class="px-3 py-1 text-xs font-bold rounded-lg transition-all bg-white dark:bg-emerald-600 text-emerald-700 dark:text-white shadow-xs cursor-pointer">
                            <i class="fa-solid fa-calendar-week mr-1"></i> Weekly
                        </button>
                        <button type="button" id="perf-tab-monthly" onclick="window.switchPerformanceReportType('monthly')" class="px-3 py-1 text-xs font-bold rounded-lg transition-all text-gray-600 dark:text-gray-300 hover:text-gray-900 cursor-pointer">
                            <i class="fa-solid fa-calendar-days mr-1"></i> Monthly
                        </button>
                    </div>

                    <!-- Navigation arrows & Date Badge -->
                    <div class="flex items-center gap-1.5 ml-auto">
                        <button type="button" onclick="window.navigatePerformanceOffset(-1)" class="w-7 h-7 rounded-lg bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-700 flex items-center justify-center text-xs transition active:scale-95 cursor-pointer" title="Previous Period">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                        <div id="perf-date-range-badge" class="px-2.5 py-1 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-[11px] font-mono font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1 shadow-2xs">
                            <i class="fa-regular fa-calendar text-emerald-500 text-[10px]"></i>
                            <span id="perf-date-range-text">Loading...</span>
                        </div>
                        <button type="button" id="perf-btn-next" onclick="window.navigatePerformanceOffset(1)" class="w-7 h-7 rounded-lg bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-700 flex items-center justify-center text-xs transition active:scale-95 cursor-pointer" title="Next Period">
                            <i class="fa-solid fa-chevron-right"></i>
                        </button>
                        <button type="button" onclick="window.refreshPerformanceData()" class="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 flex items-center justify-center text-xs transition active:scale-95 cursor-pointer ml-1" title="Refresh Data">
                            <i class="fa-solid fa-rotate text-xs"></i>
                        </button>
                    </div>
                </div>

                <!-- CRITERIA SORTING PILLS -->
                <div class="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
                    <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider shrink-0 mr-1">Sort By:</span>
                    <button type="button" onclick="window.sortPerformanceLeaderboard('income')" id="perf-sort-income" class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5 shrink-0 bg-amber-500 text-white shadow-xs cursor-pointer">
                        <i class="fa-solid fa-coins text-yellow-200"></i> Income
                    </button>
                    <button type="button" onclick="window.sortPerformanceLeaderboard('catered')" id="perf-sort-catered" class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5 shrink-0 bg-gray-200 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 cursor-pointer">
                        <i class="fa-solid fa-box text-blue-400"></i> Customers
                    </button>
                    <button type="button" onclick="window.sortPerformanceLeaderboard('time')" id="perf-sort-time" class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5 shrink-0 bg-gray-200 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 cursor-pointer">
                        <i class="fa-solid fa-clock text-purple-400"></i> Time Worked
                    </button>
                    <button type="button" onclick="window.sortPerformanceLeaderboard('attendance')" id="perf-sort-attendance" class="px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5 shrink-0 bg-gray-200 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 cursor-pointer">
                        <i class="fa-solid fa-calendar-check text-emerald-400"></i> Days Attended
                    </button>
                </div>
            </div>

            <!-- MODAL SCROLLABLE BODY -->
            <div id="perf-modal-body" class="flex-1 overflow-y-auto p-3 sm:p-4 flex flex-col gap-3.5 overscroll-contain">
                <!-- 4 SPOTLIGHT CHAMPION CARDS -->
                <div id="perf-champions-grid" class="grid grid-cols-2 sm:grid-cols-4 gap-2"></div>

                <!-- OVERVIEW AGGREGATE SUMMARY STRIP -->
                <div id="perf-overview-strip" class="bg-gray-100 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl p-2.5 flex items-center justify-around text-center text-xs"></div>

                <!-- DETAILED LEADERBOARD LIST -->
                <div class="flex flex-col gap-2">
                    <div class="flex items-center justify-between text-xs font-bold text-gray-500 uppercase tracking-wider px-1">
                        <span>Rider Leaderboard</span>
                        <span id="perf-riders-count">0 Riders</span>
                    </div>
                    <div id="perf-leaderboard-container" class="flex flex-col gap-2"></div>
                </div>
            </div>

            <!-- FOOTER -->
            <div class="p-3 bg-gray-50 dark:bg-zinc-900/90 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2 shrink-0">
                <button type="button" onclick="window.copyPerformanceReportSummary()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2 px-3 rounded-xl transition active:scale-95 flex items-center gap-1.5 shadow-md cursor-pointer">
                    <i class="fa-regular fa-copy"></i> Copy Group Summary
                </button>
                <button type="button" onclick="window.closeAdminPerformanceTrackerModal && window.closeAdminPerformanceTrackerModal()" class="bg-gray-200 hover:bg-gray-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-800 dark:text-gray-200 font-bold text-xs py-2 px-4 rounded-xl transition active:scale-95 cursor-pointer">
                    Close
                </button>
            </div>
        </div>
        `;
        document.body.appendChild(modal);
    }
    performanceModalElement = modal;
    return modal;
}

/**
 * Renders the 4 top performer spotlight cards (Most Income, Most Customers, Most Time, Most Days).
 */
function renderChampionsGrid(champions) {
    const grid = document.getElementById('perf-champions-grid');
    if (!grid) return;

    if (!champions || (!champions.income && !champions.caterer && !champions.time && !champions.attendance)) {
        grid.innerHTML = `
        <div class="col-span-full py-4 text-center text-gray-500 italic text-xs">
            No activity recorded in this period.
        </div>`;
        return;
    }

    const { income, caterer, time, attendance } = champions;

    grid.innerHTML = `
        <!-- 1. TOP INCOME -->
        <div class="bg-gradient-to-br from-amber-500/10 to-yellow-500/10 border border-amber-500/30 dark:border-amber-500/40 rounded-2xl p-2.5 flex flex-col justify-between shadow-xs">
            <div class="flex items-center justify-between text-amber-600 dark:text-amber-400 text-[10px] font-black uppercase tracking-wider">
                <span>Top Income</span>
                <i class="fa-solid fa-sack-dollar text-xs"></i>
            </div>
            <div class="my-1.5 flex items-center gap-2 min-w-0">
                <img src="${income?.avatar || 'Logo.png'}" class="w-7 h-7 rounded-full object-cover border border-amber-500 shadow-2xs shrink-0" onerror="this.src='Logo.png';">
                <div class="truncate text-xs font-bold text-gray-900 dark:text-white leading-tight">
                    ${income?.name || 'N/A'}
                </div>
            </div>
            <div class="text-xs font-black text-amber-600 dark:text-amber-300 font-mono">
                ₱${(income?.totalIncome || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
        </div>

        <!-- 2. TOP CATERER -->
        <div class="bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border border-blue-500/30 dark:border-blue-500/40 rounded-2xl p-2.5 flex flex-col justify-between shadow-xs">
            <div class="flex items-center justify-between text-blue-600 dark:text-blue-400 text-[10px] font-black uppercase tracking-wider">
                <span>Top Caterer</span>
                <i class="fa-solid fa-box text-xs"></i>
            </div>
            <div class="my-1.5 flex items-center gap-2 min-w-0">
                <img src="${caterer?.avatar || 'Logo.png'}" class="w-7 h-7 rounded-full object-cover border border-blue-500 shadow-2xs shrink-0" onerror="this.src='Logo.png';">
                <div class="truncate text-xs font-bold text-gray-900 dark:text-white leading-tight">
                    ${caterer?.name || 'N/A'}
                </div>
            </div>
            <div class="text-xs font-black text-blue-600 dark:text-blue-300 font-mono">
                ${caterer?.customerCount || 0} customers
            </div>
        </div>

        <!-- 3. TOP TIME WORKED -->
        <div class="bg-gradient-to-br from-purple-500/10 to-violet-500/10 border border-purple-500/30 dark:border-purple-500/40 rounded-2xl p-2.5 flex flex-col justify-between shadow-xs">
            <div class="flex items-center justify-between text-purple-600 dark:text-purple-400 text-[10px] font-black uppercase tracking-wider">
                <span>Most Time</span>
                <i class="fa-solid fa-business-time text-xs"></i>
            </div>
            <div class="my-1.5 flex items-center gap-2 min-w-0">
                <img src="${time?.avatar || 'Logo.png'}" class="w-7 h-7 rounded-full object-cover border border-purple-500 shadow-2xs shrink-0" onerror="this.src='Logo.png';">
                <div class="truncate text-xs font-bold text-gray-900 dark:text-white leading-tight">
                    ${time?.name || 'N/A'}
                </div>
            </div>
            <div class="text-xs font-black text-purple-600 dark:text-purple-300 font-mono">
                ${formatMinutesToHours(time?.workedMinutes || 0)}
            </div>
        </div>

        <!-- 4. TOP ATTENDANCE -->
        <div class="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 dark:border-emerald-500/40 rounded-2xl p-2.5 flex flex-col justify-between shadow-xs">
            <div class="flex items-center justify-between text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-wider">
                <span>Attendance</span>
                <i class="fa-solid fa-calendar-check text-xs"></i>
            </div>
            <div class="my-1.5 flex items-center gap-2 min-w-0">
                <img src="${attendance?.avatar || 'Logo.png'}" class="w-7 h-7 rounded-full object-cover border border-emerald-500 shadow-2xs shrink-0" onerror="this.src='Logo.png';">
                <div class="truncate text-xs font-bold text-gray-900 dark:text-white leading-tight">
                    ${attendance?.name || 'N/A'}
                </div>
            </div>
            <div class="text-xs font-black text-emerald-600 dark:text-emerald-300 font-mono">
                ${attendance?.daysAttended || 0} days
            </div>
        </div>
    `;
}

/**
 * Renders the top summary strip (Total Revenue, Total Customers, Total Duty Hours).
 */
function renderOverviewStrip(data) {
    const strip = document.getElementById('perf-overview-strip');
    if (!strip || !data) return;

    strip.innerHTML = `
        <div class="flex flex-col">
            <span class="text-[9px] text-gray-500 uppercase font-bold">Total Fees Generated</span>
            <span class="font-black text-emerald-600 dark:text-emerald-400 font-mono text-xs sm:text-sm">
                ₱${(data.totalRevenue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
        </div>
        <div class="w-px h-6 bg-gray-300 dark:bg-zinc-800"></div>
        <div class="flex flex-col">
            <span class="text-[9px] text-gray-500 uppercase font-bold">Total Orders</span>
            <span class="font-black text-blue-600 dark:text-blue-400 font-mono text-xs sm:text-sm">
                ${data.totalOrders || 0}
            </span>
        </div>
        <div class="w-px h-6 bg-gray-300 dark:bg-zinc-800"></div>
        <div class="flex flex-col">
            <span class="text-[9px] text-gray-500 uppercase font-bold">Total Duty Hours</span>
            <span class="font-black text-purple-600 dark:text-purple-400 font-mono text-xs sm:text-sm">
                ${formatMinutesToHours(data.totalHoursWorked || 0)}
            </span>
        </div>
    `;
}

/**
 * Renders the detailed sorted leaderboard cards.
 */
function renderLeaderboardList(riders = [], criteria = 'income') {
    const container = document.getElementById('perf-leaderboard-container');
    const countEl = document.getElementById('perf-riders-count');
    if (!container) return;

    if (countEl) countEl.innerText = `${riders.length} Active ${riders.length === 1 ? 'Rider' : 'Riders'}`;

    if (riders.length === 0) {
        container.innerHTML = `
        <div class="text-center text-gray-500 italic py-10 text-xs bg-gray-50 dark:bg-zinc-900 rounded-2xl border border-dashed border-gray-300 dark:border-zinc-800">
            No rider performance data found for this period.
        </div>`;
        return;
    }

    // Sort riders based on active criteria
    const sorted = [...riders].sort((a, b) => {
        if (criteria === 'income') return b.totalIncome - a.totalIncome;
        if (criteria === 'catered') return b.customerCount - a.customerCount;
        if (criteria === 'time') return b.workedMinutes - a.workedMinutes;
        if (criteria === 'attendance') return b.daysAttended - a.daysAttended;
        return b.totalIncome - a.totalIncome;
    });

    container.innerHTML = sorted.map((r, index) => {
        let rankBadge = `<span class="w-6 h-6 rounded-full bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs flex items-center justify-center shrink-0">#${index + 1}</span>`;
        let cardBorder = "border-gray-200 dark:border-zinc-800";

        if (index === 0) {
            rankBadge = `<span class="w-6 h-6 rounded-full bg-amber-500 text-white font-black text-xs flex items-center justify-center shadow-sm shrink-0">🥇</span>`;
            cardBorder = "border-amber-400/50 dark:border-amber-500/40 shadow-xs";
        } else if (index === 1) {
            rankBadge = `<span class="w-6 h-6 rounded-full bg-slate-300 text-slate-800 font-black text-xs flex items-center justify-center shadow-sm shrink-0">🥈</span>`;
            cardBorder = "border-slate-300/60 dark:border-slate-600/40";
        } else if (index === 2) {
            rankBadge = `<span class="w-6 h-6 rounded-full bg-amber-700 text-amber-100 font-black text-xs flex items-center justify-center shadow-sm shrink-0">🥉</span>`;
            cardBorder = "border-amber-700/40 dark:border-amber-700/30";
        }

        return `
        <div class="bg-white dark:bg-zinc-900 border ${cardBorder} rounded-2xl p-3 flex flex-col gap-2 transition hover:border-emerald-500/40 shadow-2xs">
            <!-- Rider Header: Rank, Avatar, Name -->
            <div class="flex items-center justify-between gap-2 min-w-0">
                <div class="flex items-center gap-2.5 min-w-0">
                    ${rankBadge}
                    <img src="${r.avatar || 'Logo.png'}" class="w-8 h-8 rounded-full object-cover border border-gray-300 dark:border-zinc-700 shadow-2xs shrink-0" onerror="this.src='Logo.png';">
                    <div class="min-w-0">
                        <span class="font-bold text-xs sm:text-sm text-gray-900 dark:text-white truncate block">
                            ${r.name}
                        </span>
                        <span class="text-[10px] text-gray-400 truncate block">
                            Avg: ₱${r.avgIncomePerDay.toFixed(0)}/day • ${r.avgOrdersPerDay.toFixed(1)} orders/day
                        </span>
                    </div>
                </div>

                <!-- Primary Metric Highlight -->
                <div class="text-right shrink-0">
                    <span class="text-xs sm:text-sm font-black text-emerald-600 dark:text-emerald-400 font-mono">
                        ₱${r.totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span class="text-[9px] text-gray-400 block font-semibold">Total Income</span>
                </div>
            </div>

            <!-- Metric Grid -->
            <div class="grid grid-cols-3 gap-1.5 pt-1.5 border-t border-gray-100 dark:border-zinc-800/80 text-center text-xs">
                <div class="bg-gray-50 dark:bg-black/30 p-1.5 rounded-xl border border-gray-100 dark:border-zinc-800">
                    <span class="text-[9px] text-gray-400 block uppercase font-bold">Catered</span>
                    <span class="font-black text-blue-600 dark:text-blue-400 font-mono">${r.customerCount}</span>
                </div>
                <div class="bg-gray-50 dark:bg-black/30 p-1.5 rounded-xl border border-gray-100 dark:border-zinc-800">
                    <span class="text-[9px] text-gray-400 block uppercase font-bold">Time Worked</span>
                    <span class="font-black text-purple-600 dark:text-purple-400 font-mono">${formatMinutesToHours(r.workedMinutes)}</span>
                    ${r.breakMinutes > 0 ? `<span class="text-[8px] text-amber-500 block">☕ ${formatMinutesToHours(r.breakMinutes)}</span>` : ''}
                </div>
                <div class="bg-gray-50 dark:bg-black/30 p-1.5 rounded-xl border border-gray-100 dark:border-zinc-800">
                    <span class="text-[9px] text-gray-400 block uppercase font-bold">Attended</span>
                    <span class="font-black text-emerald-600 dark:text-emerald-400 font-mono">${r.daysAttended} days</span>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

/**
 * Visual loading indicator for report fetching.
 */
function renderLoadingState(isLoading) {
    const container = document.getElementById('perf-leaderboard-container');
    if (!container) return;

    if (isLoading) {
        container.innerHTML = `
        <div class="py-12 flex flex-col items-center justify-center gap-2 text-gray-500">
            <i class="fa-solid fa-spinner fa-spin text-xl text-emerald-500"></i>
            <span class="text-xs font-bold">Calculating performance metrics across all orders & shifts...</span>
        </div>`;
    } else {
        if (container.innerHTML.includes('fa-spinner')) {
            container.innerHTML = '';
        }
    }
}

/**
 * Updates active sort button visuals.
 */
function updateSortButtonStyles(activeCriteria) {
    const buttons = ['income', 'catered', 'time', 'attendance'];
    buttons.forEach(b => {
        const btn = document.getElementById(`perf-sort-${b}`);
        if (!btn) return;
        if (b === activeCriteria) {
            btn.className = "px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5 shrink-0 bg-emerald-600 text-white shadow-xs cursor-pointer";
        } else {
            btn.className = "px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5 shrink-0 bg-gray-200 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 cursor-pointer";
        }
    });
}

/**
 * Opens the Performance Tracker Modal (Admin only).
 */
export async function openAdminPerformanceTrackerModal() {
    if (!isAdmin() && !canManageRoster()) {
        showToast("⚠️ Unauthorized: Administrator access required.");
        return;
    }

    const modal = getOrCreatePerformanceTrackerModal();
    modal.classList.remove('hidden');

    currentOffset = 0;
    activeSortCriteria = 'income';
    updateSortButtonStyles('income');

    await refreshPerformanceView();
}

/**
 * Closes the Performance Tracker Modal.
 */
export function closeAdminPerformanceTrackerModal() {
    if (performanceModalElement) {
        performanceModalElement.classList.add('hidden');
    }
}

/**
 * Refreshes data and renders view based on current period settings.
 */
export async function refreshPerformanceView() {
    let range;
    if (currentReportType === 'weekly') {
        range = getWeeklyDateRange(currentOffset);
    } else {
        range = getMonthlyDateRange(currentOffset);
    }

    const rangeText = document.getElementById('perf-date-range-text');
    if (rangeText) {
        rangeText.innerText = `${range.label} (${range.startDate} to ${range.endDate})`;
    }

    // Toggle next button disable state if currently in present week/month
    const nextBtn = document.getElementById('perf-btn-next');
    if (nextBtn) {
        nextBtn.style.opacity = currentOffset >= 0 ? "0.4" : "1";
        nextBtn.style.pointerEvents = currentOffset >= 0 ? "none" : "auto";
    }

    try {
        const data = await loadRiderPerformanceData(range.startDate, range.endDate);
        if (data && data.riders) {
            renderChampionsGrid(data.champions);
            renderOverviewStrip(data);
            renderLeaderboardList(data.riders, activeSortCriteria);
        } else {
            renderChampionsGrid(null);
            renderOverviewStrip({ totalRevenue: 0, totalOrders: 0, totalHoursWorked: 0 });
            renderLeaderboardList([], activeSortCriteria);
        }
    } catch (err) {
        console.error("refreshPerformanceView error:", err);
        renderChampionsGrid(null);
        renderOverviewStrip({ totalRevenue: 0, totalOrders: 0, totalHoursWorked: 0 });
        renderLeaderboardList([], activeSortCriteria);
    }
}

/**
 * Switches report type between 'weekly' and 'monthly'.
 */
export function switchPerformanceReportType(type) {
    if (currentReportType === type) return;
    currentReportType = type;
    currentOffset = 0;

    const weeklyTab = document.getElementById('perf-tab-weekly');
    const monthlyTab = document.getElementById('perf-tab-monthly');

    if (type === 'weekly') {
        if (weeklyTab) weeklyTab.className = "px-3 py-1 text-xs font-bold rounded-lg transition-all bg-white dark:bg-emerald-600 text-emerald-700 dark:text-white shadow-xs cursor-pointer";
        if (monthlyTab) monthlyTab.className = "px-3 py-1 text-xs font-bold rounded-lg transition-all text-gray-600 dark:text-gray-300 hover:text-gray-900 cursor-pointer";
    } else {
        if (weeklyTab) weeklyTab.className = "px-3 py-1 text-xs font-bold rounded-lg transition-all text-gray-600 dark:text-gray-300 hover:text-gray-900 cursor-pointer";
        if (monthlyTab) monthlyTab.className = "px-3 py-1 text-xs font-bold rounded-lg transition-all bg-white dark:bg-emerald-600 text-emerald-700 dark:text-white shadow-xs cursor-pointer";
    }

    refreshPerformanceView();
}

/**
 * Navigates to previous or next period.
 */
export function navigatePerformanceOffset(delta) {
    currentOffset += delta;
    if (currentOffset > 0) currentOffset = 0; // Don't navigate to future dates
    refreshPerformanceView();
}

/**
 * Sorts the leaderboard by criteria.
 */
export function sortPerformanceLeaderboard(criteria) {
    activeSortCriteria = criteria;
    updateSortButtonStyles(criteria);
    if (cachedPerformanceData && cachedPerformanceData.riders) {
        renderLeaderboardList(cachedPerformanceData.riders, activeSortCriteria);
    }
}

/**
 * Copies a clean summary report to clipboard for sharing in group chats.
 */
export function copyPerformanceReportSummary() {
    if (!cachedPerformanceData || !cachedPerformanceData.riders) {
        showToast("⚠️ No report data to copy.");
        return;
    }

    const { startDate, endDate, reportType, champions, riders, totalRevenue, totalOrders } = cachedPerformanceData;
    const periodLabel = reportType === 'weekly' ? 'WEEKLY' : 'MONTHLY';

    let summary = `🏆 LOKALEX RIDER ${periodLabel} PERFORMANCE REPORT 🏆\n`;
    summary += `📅 Period: ${startDate} to ${endDate}\n`;
    summary += `💰 Total Income Generated: ₱${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`;
    summary += `📦 Total Customers Catered: ${totalOrders}\n`;
    summary += `-------------------------------------------\n`;
    summary += `👑 TOP PERFORMERS:\n`;
    if (champions.income) summary += `🥇 Most Income: ${champions.income.name} (₱${champions.income.totalIncome.toFixed(2)})\n`;
    if (champions.caterer) summary += `📦 Most Customers: ${champions.caterer.name} (${champions.caterer.customerCount} orders)\n`;
    if (champions.time) summary += `⏱️ Most Time Worked: ${champions.time.name} (${formatMinutesToHours(champions.time.workedMinutes)})\n`;
    if (champions.attendance) summary += `📅 Most Days Attended: ${champions.attendance.name} (${champions.attendance.daysAttended} days)\n`;
    summary += `-------------------------------------------\n`;
    summary += `📊 FULL LEADERBOARD:\n`;

    const sorted = [...riders].sort((a, b) => b.totalIncome - a.totalIncome);
    sorted.forEach((r, idx) => {
        summary += `#${idx + 1} ${r.name}: ₱${r.totalIncome.toFixed(2)} | ${r.customerCount} orders | ${formatMinutesToHours(r.workedMinutes)} | ${r.daysAttended} days\n`;
    });

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(summary);
            showToast("📋 Performance report copied to clipboard!");
        } else {
            const ta = document.createElement('textarea');
            ta.value = summary;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showToast("📋 Performance report copied to clipboard!");
        }
    } catch (e) {
        showToast("❌ Unable to copy summary.");
    }
}

// Global Window Bindings for HTML onclick access
if (typeof window !== 'undefined') {
    window.openAdminPerformanceTrackerModal = openAdminPerformanceTrackerModal;
    window.closeAdminPerformanceTrackerModal = closeAdminPerformanceTrackerModal;
    window.switchPerformanceReportType = switchPerformanceReportType;
    window.navigatePerformanceOffset = navigatePerformanceOffset;
    window.sortPerformanceLeaderboard = sortPerformanceLeaderboard;
    window.refreshPerformanceData = refreshPerformanceView;
    window.copyPerformanceReportSummary = copyPerformanceReportSummary;
}

