// src/features/roster/ui/rosterFeeds.js
import { globalState } from '../../../store/state.js';
import { escapeHtml, formatTitleCase, getLocalTodayStr } from '../../../utils/helpers.js';
import { 
    loadRosterCache, 
    isAdmin, 
    calculateSplitDuration, 
    parseTimeToMinutes, 
    getMergedDeduplicatedCommissionList, 
    isSameDateStr 
} from '../rosterUtils.js';
import { getForcedCaterBadgeHtml } from './rosterBadge.js';

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

    todayHistory.sort((a, b) => {
        const pA = parseTimeToMinutes(a.startTime || a.cateringStartTime || a.time || "");
        const pB = parseTimeToMinutes(b.startTime || b.cateringStartTime || b.time || "");
        const timeA = pA !== null && pA !== undefined ? pA : 9999;
        const timeB = pB !== null && pB !== undefined ? pB : 9999;
        return timeA - timeB;
    });

    if (badge) badge.innerText = `${todayHistory.length} recorded`;

    if (todayHistory.length === 0) {
        feed.innerHTML = `<div class="text-gray-500 dark:text-gray-400 italic text-center py-4 text-xs">No completed catered customers yet today.</div>`;
        return;
    }

    feed.innerHTML = todayHistory.map(h => {
        let voidBtn = "";
        const recordTxId = h.transactionId || h.id || "";
        const cDate = h.date || h.completedDate || todayStr;
        const riderFormatted = formatTitleCase(h.riderName || "Rider");
        const customerFormatted = formatTitleCase(h.customerName || "Customer");

        if (isAdmin()) {
            voidBtn = `<button onclick="window.promptAdminDeleteCommissionRecord && window.promptAdminDeleteCommissionRecord('${escapeHtml(h.riderName || '')}', '${escapeHtml(h.customerName || '')}', '${escapeHtml(cDate)}', '${escapeHtml(recordTxId)}')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 dark:bg-red-900/40 dark:hover:bg-red-800 dark:text-red-400 dark:border-red-700/50 text-[10px] font-bold px-2 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 shrink-0"><i class="fa-solid fa-ban"></i> Void</button>`;
        }

        const sTime = h.startTime || h.cateringStartTime || h.time || "";
        const cTime = h.completedTime || "";
        const cCount = parseInt(h.customerCount) || 1;
        let durationStr = h.duration || "";

        if ((!durationStr || durationStr === "Just now") && sTime && cTime && sTime !== cTime) {
            durationStr = calculateSplitDuration(sTime, cTime, cCount);
        } else if (durationStr && cCount > 1 && !durationStr.includes('/') && !durationStr.includes('&divide;')) {
            const startMins = parseTimeToMinutes(sTime);
            const endMins = parseTimeToMinutes(cTime);
            if (startMins !== null && endMins !== null) {
                let totalMins = endMins - startMins;
                if (totalMins < 0) totalMins += 24 * 60;
                const splitMins = Math.round(totalMins / cCount);
                durationStr = `${splitMins}m (${totalMins}m / ${cCount})`;
            }
        }

        let timeRange = sTime ? `🕒 ${escapeHtml(sTime)}` : `🕒 Completed`;
        if (cTime && cTime !== sTime) {
            timeRange += ` -> ${escapeHtml(cTime)}`;
        }

        let durationBadge = "";
        if (durationStr) {
            durationBadge = `<span class="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 px-1.5 py-0.5 rounded font-black text-[9px] font-mono tracking-wide">[${escapeHtml(durationStr)}]</span>`;
        }

        const historyForcedBadge = getForcedCaterBadgeHtml(h, h.customerName, h.riderName);

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

            <div class="flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-gray-100 dark:border-gray-800/60 text-[10px] font-mono">
                <span class="text-gray-600 dark:text-gray-400 font-medium">${timeRange}</span>
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