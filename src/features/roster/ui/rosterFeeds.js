// src/features/roster/ui/rosterFeeds.js

/**
 * ============================================================================
 * ROSTER FEEDS & CATERED CUSTOMER LOG ENGINE
 * ============================================================================
 * 
 * Description:
 * Manages presentation and live activity feeds for completed customer catering
 * orders and daily rider logins:
 * - High-Speed O(1) Pre-Indexed Lookup: Replaces heavy nested O(N*M) regex scanning
 *   with pre-built transaction and customer hash maps, rendering catered history
 *   instantly without blocking the main browser thread.
 * - Single-Pass Timestamp Sorting: Evaluates parseTimeToMinutes once per record
 *   prior to sorting, eliminating redundant comparator regex parsing.
 * - Batched Frame Refresh: Leverages requestAnimationFrame (requestCateredFeedRefresh)
 *   to isolate feed updates from rapid roster rotation and break timer ticks.
 * - Multi-customer duration splits, milestone progression badges, and admin void controls.
 * ============================================================================
 */

import { globalState } from '../../../store/state.js';
import { escapeHtml, formatTitleCase, getLocalTodayStr } from '../../../utils/helpers.js';
import { 
    loadRosterCache, 
    isAdmin, 
    calculateSplitDuration, 
    parseTimeToMinutes, 
    getMergedDeduplicatedCommissionList, 
    isSameDateStr,
    isCustomerMatch
} from '../rosterUtils.js';
import { getForcedCaterBadgeHtml } from './rosterBadge.js';

let cateredFeedScheduled = false;

/**
 * Batches incoming catered feed updates into a single animation frame,
 * preventing layout thrashing when multiple orders arrive or complete.
 */
export function requestCateredFeedRefresh() {
    if (cateredFeedScheduled) return;
    cateredFeedScheduled = true;
    requestAnimationFrame(() => {
        cateredFeedScheduled = false;
        loadGlobalCateredList();
    });
}

/**
 * Renders the Catered Customers feed using single-pass O(1) indexed lookups.
 */
export function loadGlobalCateredList() {
    const feed = document.getElementById('catered-customers-feed');
    const badge = document.getElementById('catered-count-badge');
    if (!feed) return;

    if ((!globalState.globalDailyReceipts || globalState.globalDailyReceipts.length === 0) &&
        (!globalState.globalCateredHistory || globalState.globalCateredHistory.length === 0)) {
        loadRosterCache();
    }

    const todayStr = getLocalTodayStr();
    const mergedList = getMergedDeduplicatedCommissionList();

    const todayHistory = mergedList.filter(item => {
        const itemDate = item.date || item.completedDate;
        return itemDate && isSameDateStr(itemDate, todayStr);
    });

    // Pre-calculate sorting minutes once per item to avoid O(N log N) regex parsing in comparator
    for (let i = 0; i < todayHistory.length; i++) {
        const item = todayHistory[i];
        const sTime = item.startTime || item.cateringStartTime || item.time || "";
        const mins = parseTimeToMinutes(sTime);
        item._sortMinutes = mins !== null && mins !== undefined ? mins : 9999;
    }

    todayHistory.sort((a, b) => a._sortMinutes - b._sortMinutes);

    if (badge) badge.innerText = `${todayHistory.length} recorded`;

    if (todayHistory.length === 0) {
        feed.innerHTML = `<div class="text-gray-500 dark:text-gray-400 italic text-center py-4 text-xs">No completed catered customers yet today.</div>`;
        return;
    }

    // Build single-pass O(1) lookup tables for receipts and catered history
    const rcById = new Map();
    const rcByCustKey = new Map();
    (globalState.globalDailyReceipts || []).forEach(rc => {
        if (!rc) return;
        const txId = (rc.transactionId || rc.id || "").toString().trim();
        if (txId) rcById.set(txId, rc);
        const cName = (rc.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '');
        const rDate = rc.date || rc.completedDate || "";
        if (cName && rDate) {
            rcByCustKey.set(`${cName}_${rDate}`, rc);
        }
    });

    const chById = new Map();
    const chByCustKey = new Map();
    (globalState.globalCateredHistory || []).forEach(ch => {
        if (!ch) return;
        const txId = (ch.transactionId || ch.id || "").toString().trim();
        if (txId) chById.set(txId, ch);
        const cName = (ch.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '');
        const cDate = ch.completedDate || ch.date || "";
        if (cName && cDate) {
            chByCustKey.set(`${cName}_${cDate}`, ch);
        }
    });

    const isAdminUser = isAdmin();

    feed.innerHTML = todayHistory.map(h => {
        let voidBtn = "";
        const recordTxId = (h.transactionId || h.id || "").toString().trim();
        const cDate = h.date || h.completedDate || todayStr;
        const riderFormatted = formatTitleCase(h.riderName || "Rider");
        const customerFormatted = formatTitleCase(h.customerName || "Customer");
        const cleanCustKey = (h.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '');

        if (isAdminUser) {
            voidBtn = `<button onclick="window.promptAdminDeleteCommissionRecord && window.promptAdminDeleteCommissionRecord('${escapeHtml(h.riderName || '')}', '${escapeHtml(h.customerName || '')}', '${escapeHtml(cDate)}', '${escapeHtml(recordTxId)}')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 dark:bg-red-900/40 dark:hover:bg-red-800 dark:text-red-400 dark:border-red-700/50 text-[10px] font-bold px-2 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 shrink-0 cursor-pointer"><i class="fa-solid fa-ban"></i> Void</button>`;
        }

        // Instant O(1) resolution instead of nested O(N*M) linear scanning
        let rcMatch = (recordTxId && rcById.get(recordTxId)) || rcByCustKey.get(`${cleanCustKey}_${cDate}`) || null;
        let chMatch = (recordTxId && chById.get(recordTxId)) || chByCustKey.get(`${cleanCustKey}_${cDate}`) || null;

        // Fallback to customer match only if direct key was absent
        if (!rcMatch && cleanCustKey) {
            rcMatch = (globalState.globalDailyReceipts || []).find(rc => 
                isCustomerMatch(rc.customerName, h.customerName) && isSameDateStr(rc.date || rc.completedDate, cDate)
            );
        }
        if (!chMatch && cleanCustKey) {
            chMatch = (globalState.globalCateredHistory || []).find(ch => 
                isCustomerMatch(ch.customerName, h.customerName) && isSameDateStr(ch.completedDate || ch.date, cDate)
            );
        }

        const sTime = h.startTime || h.cateringStartTime || rcMatch?.cateringStartTime || rcMatch?.startTime || chMatch?.startTime || h.time || "";

        let rTime = h.receiptTime || rcMatch?.receiptTime || chMatch?.receiptTime || "";
        if (!rTime && rcMatch && rcMatch.time && rcMatch.time !== sTime) {
            rTime = rcMatch.time;
        }

        let dTime = h.doneTime || chMatch?.doneTime || rcMatch?.doneTime || "";
        if (!dTime) {
            const possibleDone = chMatch?.completedTime || rcMatch?.completedTime || h.completedTime || "";
            if (possibleDone && possibleDone !== rTime) {
                dTime = possibleDone;
            }
        }
        if (!dTime && (h.isReceipt === false || !h.isReceipt)) {
            dTime = chMatch?.completedTime || h.completedTime || "";
        }

        const cCount = parseInt(h.customerCount) || 1;
        let durationStr = h.duration || chMatch?.duration || rcMatch?.duration || "";

        const effectiveEndTime = dTime || rTime;
        if ((!durationStr || durationStr === "Just now") && sTime && effectiveEndTime && sTime !== effectiveEndTime) {
            durationStr = calculateSplitDuration(sTime, effectiveEndTime, cCount);
        } else if (durationStr && cCount > 1 && !durationStr.includes('/') && !durationStr.includes('&divide;')) {
            const startMins = parseTimeToMinutes(sTime);
            const endMins = parseTimeToMinutes(effectiveEndTime);
            if (startMins !== null && endMins !== null) {
                let totalMins = endMins - startMins;
                if (totalMins < 0) totalMins += 24 * 60;
                const splitMins = Math.round(totalMins / cCount);
                durationStr = `${splitMins}m (${totalMins}m / ${cCount})`;
            }
        }

        let durationBadge = "";
        if (durationStr) {
            durationBadge = `<span class="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 px-1.5 py-0.5 rounded font-black text-[9px] font-mono tracking-wide">[${escapeHtml(durationStr)}]</span>`;
        }

        const historyForcedBadge = getForcedCaterBadgeHtml(h, h.customerName, h.riderName);

        let timelineParts = [];
        if (sTime) {
            timelineParts.push(`
                <span class="inline-flex items-center gap-1 text-gray-700 dark:text-gray-300" title="Started Catering">
                    <i class="fa-solid fa-play text-blue-500 text-[8px]"></i>
                    <span>${escapeHtml(sTime)}</span>
                </span>
            `);
        }

        if (rTime && rTime !== sTime) {
            timelineParts.push(`
                <span class="inline-flex items-center gap-1 text-gray-700 dark:text-gray-300" title="Receipt Created">
                    <i class="fa-solid fa-receipt text-amber-500 text-[9px]"></i>
                    <span>${escapeHtml(rTime)}</span>
                </span>
            `);
        }

        if (dTime && (dTime !== sTime || !rTime)) {
            timelineParts.push(`
                <span class="inline-flex items-center gap-1 text-gray-700 dark:text-gray-300 font-bold" title="Marked as Done (Finished)">
                    <i class="fa-solid fa-circle-check text-emerald-500 text-[9px]"></i>
                    <span class="text-emerald-700 dark:text-emerald-400">${escapeHtml(dTime)}</span>
                </span>
            `);
        }

        let timelineHtml = timelineParts.length > 0 
            ? timelineParts.join('<span class="text-gray-300 dark:text-gray-700 select-none">→</span>') 
            : `<span class="text-gray-500 dark:text-gray-400"><i class="fa-solid fa-circle-check text-emerald-500 text-[9px]"></i> Done</span>`;

        return `
        <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 p-2.5 rounded-2xl flex flex-col gap-1.5 shadow-xs">
            <div class="flex items-center justify-between gap-2">
                <div class="font-black text-xs text-gray-900 dark:text-white flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
                    <i class="fa-solid fa-user text-orange-600 dark:text-orange-400 text-[11px] shrink-0"></i> 
                    <span class="truncate">${escapeHtml(customerFormatted)}</span>
                    ${historyForcedBadge}
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <span class="text-[10px] text-gray-600 dark:text-gray-400 font-medium">Rider: <span class="text-blue-600 dark:text-blue-400 font-bold">${escapeHtml(riderFormatted)}</span></span>
                    ${voidBtn}
                </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-800/60 text-[10px] font-mono">
                <div class="flex flex-wrap items-center gap-1.5">
                    ${timelineHtml}
                </div>
                ${durationBadge}
            </div>
        </div>`;
    }).join('');
}

export function loadGlobalLoginList() {
    const feed = document.getElementById('login-list-feed');
    const badge = document.getElementById('login-count-badge');
    if (!feed) return;

    if (!globalState.globalLogins || globalState.globalLogins.length === 0) {
        loadRosterCache();
    }

    const todayStr = getLocalTodayStr();
    const todayLogins = globalState.globalLogins ? globalState.globalLogins.filter(l => l && isSameDateStr(l.date, todayStr)) : [];

    if (badge) badge.innerText = `${todayLogins.length} ${todayLogins.length === 1 ? 'login' : 'logins'}`;

    if (todayLogins.length === 0) {
        feed.innerHTML = `<div class="text-gray-500 dark:text-gray-400 italic text-center py-2 text-xs">No logins recorded yet today.</div>`;
        return;
    }

    feed.innerHTML = todayLogins.slice().reverse().map(l => {
        let mapBtn = "";
        if (l.location) {
            mapBtn = `<a href="${escapeHtml(l.location)}" target="_blank" class="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold underline flex items-center gap-1 mt-0.5 active:opacity-60"><i class="fa-solid fa-location-dot text-red-500 text-[9px]"></i> View Pin Location</a>`;
        }
        const clockOutTxt = l.clockOutTime ? `<span class="text-red-600 dark:text-red-400 font-bold ml-1">(Out: ${escapeHtml(l.clockOutTime)})</span>` : '';
        const riderFormatted = formatTitleCase(l.riderName || 'Rider');

        return `
        <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 p-2.5 rounded-xl flex justify-between items-center gap-2 shadow-xs">
            <div class="flex flex-col min-w-0 flex-1">
                <span class="font-black text-xs text-gray-900 dark:text-white truncate flex items-center gap-1.5"><i class="fa-solid fa-motorcycle text-blue-600 dark:text-blue-400 text-[10px]"></i> <span>${escapeHtml(riderFormatted)}</span></span>
                ${mapBtn}
            </div>
            <div class="text-[10px] text-gray-800 dark:text-gray-200 font-mono text-right shrink-0 font-medium">
                <span>In: ${escapeHtml(l.loginTime || 'N/A')}</span>
                ${clockOutTxt}
            </div>
        </div>`;
    }).join('');
}

if (typeof window !== 'undefined') {
    window.loadGlobalCateredList = loadGlobalCateredList;
    window.requestCateredFeedRefresh = requestCateredFeedRefresh;
    window.loadGlobalLoginList = loadGlobalLoginList;

    window.addEventListener('receiptsUpdated', () => requestCateredFeedRefresh());
    window.addEventListener('cateredUpdated', () => requestCateredFeedRefresh());
}

// REMARKS: ROSTER_FEEDS_FAST_MEMOIZED_CATERED_LIST_V2_COMPLETE