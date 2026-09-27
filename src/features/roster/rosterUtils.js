// src/features/roster/rosterUtils.js

/**
 * ============================================================================
 * ROSTER UTILITIES & ROTATION TRUTH ENGINE
 * ============================================================================
 * 
 * Description:
 * Core utility and financial aggregation layer for the Lokalex dispatch roster:
 * - High-Performance Memoized Gross Index: Pre-computes daily rider totals in a
 *   single pass ($O(N)$), enabling instant $O(1)$ lookups during queue sorting
 *   and rendering without secondary database ledgers.
 * - Multi-Customer Comma Expansion: Automatically unbundles grouped multi-customer
 *   deliveries (e.g., "Gerald, Krystin") so every customer is accounted for.
 * - Resilient Date Fallback: Evaluates `rc.date`, `rc.completedDate`, `rc.timestamp`,
 *   and `rc.createdAt` to guarantee admin and direct receipts are never discarded.
 * - Dual-Key Deduplication: Keyed by `${txId}_${cleanCust}` to prevent multi-drop
 *   runs from clobbering sibling records.
 * - Intelligent Date Normalizer: Resolves ISO, Epoch, MM/DD/YYYY, and Philippine
 *   DD/MM/YYYY formats seamlessly.
 * - Shift Crossover Date Resolver (`resolveOrderDate`): Intelligently binds
 *   late-night deliveries (started PM, finished AM) to the originating shift date.
 * ============================================================================
 */

import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { ADMIN_IDS } from '../../config/constants.js';
import { showToast, unlockAudioContext } from '../../ui/notifications.js';
import { getLocalTodayStr, isSameDate } from '../../utils/helpers.js';
import { getQueueLineupSettings } from './rosterQueueSettings.js';

export let lineAlarmInterval = null;
export let lineAlarmConfirmed = false;

export function setLineAlarmConfirmed(val) {
    lineAlarmConfirmed = val;
}

const ROSTER_CACHE_KEY = 'lokalex_roster_cache';
const LOGINS_CACHE_KEY = 'lokalex_logins_cache';
const CATERED_CACHE_KEY = 'lokalex_catered_cache_v2';
const RECEIPTS_CACHE_KEY = 'lokalex_receipts_cache_v2';

let cachedDailyGrossMap = null;
let lastGrossCacheTimestamp = 0;
let cachedMergedCommissionList = null;
let lastMergedListTimestamp = 0;

export function invalidateRosterGrossCache() {
    cachedDailyGrossMap = null;
    cachedMergedCommissionList = null;
    lastGrossCacheTimestamp = 0;
    lastMergedListTimestamp = 0;
}

export function saveRosterCache() {
    try {
        localStorage.setItem(ROSTER_CACHE_KEY, JSON.stringify(globalState.rosterMembers || []));
        localStorage.setItem(LOGINS_CACHE_KEY, JSON.stringify(globalState.globalLogins || []));
        localStorage.setItem(CATERED_CACHE_KEY, JSON.stringify(globalState.globalCateredHistory || []));
        if (globalState.globalDailyReceipts) {
            localStorage.setItem(RECEIPTS_CACHE_KEY, JSON.stringify(globalState.globalDailyReceipts));
        }
    } catch(e) {}
}

export function loadRosterCache() {
    try {
        const savedRoster = localStorage.getItem(ROSTER_CACHE_KEY);
        if (savedRoster && (!globalState.rosterMembers || globalState.rosterMembers.length === 0)) {
            globalState.rosterMembers = JSON.parse(savedRoster);
        }
        const savedLogins = localStorage.getItem(LOGINS_CACHE_KEY);
        if (savedLogins && (!globalState.globalLogins || globalState.globalLogins.length === 0)) {
            globalState.globalLogins = JSON.parse(savedLogins);
        }
        const savedCatered = localStorage.getItem(CATERED_CACHE_KEY) || localStorage.getItem('lokalex_catered_cache');
        if (savedCatered && (!globalState.globalCateredHistory || globalState.globalCateredHistory.length === 0)) {
            globalState.globalCateredHistory = JSON.parse(savedCatered);
        }
        const savedReceipts = localStorage.getItem(RECEIPTS_CACHE_KEY);
        if (savedReceipts && (!globalState.globalDailyReceipts || globalState.globalDailyReceipts.length === 0)) {
            globalState.globalDailyReceipts = JSON.parse(savedReceipts);
        }
    } catch(e) {}
}

loadRosterCache();

export function getPHTDate() {
    try {
        const phtString = new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" });
        return new Date(phtString);
    } catch(e) {
        return new Date();
    }
}

export function getUserType() {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    if (globalState.userTypesMap) {
        if (myId && globalState.userTypesMap[myId]) {
            return globalState.userTypesMap[myId].toString().trim().toLowerCase();
        }
        if (myName && globalState.userTypesMap[myName]) {
            return globalState.userTypesMap[myName].toString().trim().toLowerCase();
        }
    }

    if (globalState.rosterMembers && myId) {
        const myRosterRec = globalState.rosterMembers.find(m => (m.telegramId || "").toString().trim() === myId);
        if (myRosterRec && myRosterRec.userType) {
            return myRosterRec.userType.toString().trim().toLowerCase();
        }
    }

    return (appState.userType || localStorage.getItem('userType') || "rider").toString().trim().toLowerCase();
}

export function isAdmin() {
    const t = getUserType();
    if (t === 'rider') return false;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    if (myId && ADMIN_IDS.some(id => id.toString().trim() === myId && id.toString().trim() !== "1234")) return true;
    if (myName && ADMIN_IDS.some(id => id.toString().toLowerCase().trim() === myName && id.toString().toLowerCase().trim() !== "regular")) return true;

    const validAdminTypes = ['admin', 'owner', 'manager', 'superadmin', 'administrator'];
    return validAdminTypes.includes(t);
}

export function isTL() {
    const t = getUserType();
    const validTlTypes = ['tl', 'lead', 'teamlead', 'leader'];
    return validTlTypes.includes(t);
}

export function hasTlPermission(permissionKey) {
    if (isAdmin()) return true;
    if (!isTL()) return false;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();
    const rosterMembers = globalState.rosterMembers || [];

    const myRecord = rosterMembers.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        return (myId && mId === myId) || (myName && mName === myName);
    });

    const perms = myRecord?.tlPermissions || {};
    if (perms[permissionKey] !== undefined) {
        return perms[permissionKey] === true;
    }

    if (myRecord && myRecord.tlAdminPower !== undefined) {
        return myRecord.tlAdminPower === true;
    }

    return false;
}

export function canManageRoster() {
    if (isAdmin()) return true;

    if (isTL()) {
        const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
        const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();
        const rosterMembers = globalState.rosterMembers || [];

        const myRecord = rosterMembers.find(m => {
            const mId = (m.telegramId || m.id || "").toString().trim();
            const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
            return (myId && mId === myId) || (myName && mName === myName);
        });

        const perms = myRecord?.tlPermissions || {};
        const hasAnyPermission = Object.values(perms).some(val => val === true);
        if (hasAnyPermission) return true;

        if (myRecord && myRecord.tlAdminPower !== undefined) {
            return myRecord.tlAdminPower === true;
        }

        return false;
    }

    return false;
}

export function canForceCaterTarget(targetType, targetId = "") {
    if (isAdmin()) return true;
    if (isTL()) {
        if (!hasTlPermission('canForceCater')) return false;

        const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
        const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();
        const tId = (targetId || "").toString().trim();

        if ((tId && myId && tId === myId) || (tId && myName && tId.toLowerCase() === myName)) {
            return true;
        }

        const t = (targetType || "").toString().toLowerCase().trim();
        const adminTypes = ['admin', 'owner', 'manager', 'superadmin', 'administrator', 'tl', 'lead', 'teamlead', 'leader'];
        return !adminTypes.includes(t);
    }
    return false;
}

export function parseQueueTime(val) {
    if (!val) return 0;
    const clean = val.toString().replace(/,/g, '').trim();
    return parseFloat(clean) || 0;
}

export function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const clean = timeStr.trim();
    const match = clean.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3] ? match[3].toUpperCase() : null;

    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    return hours * 60 + minutes;
}

export function resolveOrderDate(startTimeStr, explicitDate = null) {
    if (explicitDate && String(explicitDate).trim() !== "") {
        return normalizeToDateStr(explicitDate);
    }

    const todayStr = getLocalTodayStr();
    if (!startTimeStr) return todayStr;

    const startMins = parseTimeToMinutes(startTimeStr);
    if (startMins === null) return todayStr;

    const now = getPHTDate();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    if (currentMins < startMins) {
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const yYear = yesterday.getFullYear();
        const yMonth = String(yesterday.getMonth() + 1).padStart(2, '0');
        const yDay = String(yesterday.getDate()).padStart(2, '0');
        return `${yYear}-${yMonth}-${yDay}`;
    }

    return todayStr;
}

export function calculateSplitDuration(startTimeStr, completedTimeStr, customerCount = 1) {
    const startMins = parseTimeToMinutes(startTimeStr);
    const endMins = parseTimeToMinutes(completedTimeStr);

    if (startMins === null || endMins === null) return "";

    let totalMins = endMins - startMins;
    if (totalMins < 0) totalMins += 24 * 60;

    const count = Math.max(1, customerCount);
    const splitMins = Math.round(totalMins / count);

    const hrs = Math.floor(splitMins / 60);
    const mins = splitMins % 60;

    if (hrs > 0) {
        return count > 1 ? `${hrs}h ${mins}m (${totalMins}m ÷ ${count})` : `${hrs}h ${mins}m`;
    }
    return count > 1 ? `${mins}m (${totalMins}m ÷ ${count})` : `${mins}m`;
}

export function normalizeToDateStr(val) {
    if (!val) return "";
    const str = String(val).trim();
    
    // 1. ISO Format: YYYY-MM-DD
    const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (isoMatch) {
        return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    }

    // 2. Slashed Dates: DD/MM/YYYY vs MM/DD/YYYY
    const slashMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (slashMatch) {
        const p1 = parseInt(slashMatch[1], 10);
        const p2 = parseInt(slashMatch[2], 10);
        const year = slashMatch[3];

        if (p1 > 12) {
            return `${year}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
        }
        if (p2 > 12) {
            return `${year}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
        }
        const now = getPHTDate();
        const curMonth = now.getMonth() + 1;
        if (p2 === curMonth && p1 !== curMonth) {
            return `${year}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
        }
        return `${year}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
    }

    // 3. Epoch Milliseconds / Seconds
    if (/^\d{10,13}$/.test(str)) {
        const d = new Date(Number(str));
        if (!isNaN(d.getTime())) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }
    }

    // 4. Human strings (e.g., "Sep 27, 2026")
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    return str;
}

export function isSameDateStr(date1, date2) {
    if (!date1 || !date2) return false;
    const n1 = normalizeToDateStr(date1);
    const n2 = normalizeToDateStr(date2);
    if (n1 && n2 && n1 === n2) return true;

    try {
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
            return d1.getFullYear() === d2.getFullYear() &&
                   d1.getMonth() === d2.getMonth() &&
                   d1.getDate() === d2.getDate();
        }
    } catch(e) {}

    return false;
}

export function parseItemGross(item) {
    if (!item) return 0;

    const rawVal = item.totalFees ?? item.gross ?? item.amount ?? item.total;
    let gross = 0;

    if (rawVal !== undefined && rawVal !== null) {
        if (typeof rawVal === 'number') {
            gross = rawVal;
        } else {
            const cleaned = String(rawVal).replace(/[^0-9.-]/g, '');
            gross = parseFloat(cleaned) || 0;
        }
    }

    if (gross <= 0 && item.fees) {
        let f = item.fees;
        if (typeof f === 'string') {
            try { f = JSON.parse(f); } catch(e) { f = null; }
        }
        if (f && typeof f === 'object') {
            const parseNum = (v) => {
                if (typeof v === 'number') return v;
                return parseFloat(String(v || '0').replace(/[^0-9.-]/g, '')) || 0;
            };
            const hf = parseNum(f.handling);
            const mf = parseNum(f.market);
            const ms = parseNum(f.multistore || f.multistop || f.multistoreFees);
            const rdf = parseNum(f.delivery || f.deliveryFees || f.riderFee || f.deliveryFee);
            const epay = parseNum(f.epaymentFee || f.epay);
            const disc = parseNum(f.discount);
            gross = Math.max(0, hf + mf + ms + rdf + epay - disc);
        }
    }

    return isNaN(gross) || gross <= 0 ? 0 : gross;
}

export function isCustomerMatch(cust1 = "", cust2 = "") {
    const c1 = (cust1 || "").toLowerCase().replace(/[^a-z0-9]/g, '');
    const c2 = (cust2 || "").toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!c1 || !c2) return false;
    if (c1 === c2) return true;
    if (c1.length >= 4 && c2.includes(c1)) return true;
    if (c2.length >= 4 && c1.includes(c2)) return true;
    return false;
}

export function isRiderMatch(targetName = "", recordName = "", targetId = "", recordId = "") {
    const tId = (targetId || "").toString().trim().toLowerCase();
    const rId = (recordId || "").toString().trim().toLowerCase();
    if (tId && rId && tId === rId) return true;

    const tn = (targetName || "").trim().toLowerCase();
    const rn = (recordName || "").trim().toLowerCase();
    if (!tn || !rn) return false;
    if (tn === rn) return true;

    const w1 = tn.split(/\s+/);
    const w2 = rn.split(/\s+/);
    if (w1[0] && w2[0] && w1[0] === w2[0] && w1[0].length >= 3) {
        return true;
    }

    if (tn.includes(rn) || rn.includes(tn)) {
        return true;
    }

    return false;
}

/**
 * 100% FINANCIAL & ROSTER SOURCE OF TRUTH
 * Expands multi-customer bundles and includes fallback timestamps to capture
 * admin direct receipts.
 */
export function getMergedDeduplicatedCommissionList(forceFresh = false) {
    const now = Date.now();
    if (!forceFresh && cachedMergedCommissionList && cachedMergedCommissionList.length > 0 && (now - lastMergedListTimestamp < 500)) {
        return cachedMergedCommissionList;
    }

    if ((!globalState.globalDailyReceipts || globalState.globalDailyReceipts.length === 0) &&
        (!globalState.globalCateredHistory || globalState.globalCateredHistory.length === 0)) {
        loadRosterCache();
    }

    const mergedMap = new Map();
    const processedSignatures = new Set();
    const todayStr = getLocalTodayStr();

    (globalState.globalDailyReceipts || []).forEach(rc => {
        if (!rc) return;
        const rawCName = (rc.customerName || "Customer").trim();
        if (!rawCName || rawCName.toLowerCase() === 'sample' || rawCName.toLowerCase() === 'test') return;

        const sTime = rc.cateringStartTime || rc.startTime || rc.time || "";
        const rawDate = rc.date || rc.completedDate || rc.timestamp || rc.createdAt || todayStr;
        const rcDate = resolveOrderDate(sTime, rawDate);
        if (!rcDate) return;

        const rName = (rc.riderName || "Rider").trim();
        const cleanRider = rName.toLowerCase();
        let cTime = rc.completedTime || "";
        let dur = rc.duration || "";
        const baseTxId = (rc.transactionId || rc.id || `${cleanRider}_${rcDate}_${sTime}`).toString().trim();
        const totalGross = parseItemGross(rc);

        const subCustomers = rawCName.includes(',')
            ? rawCName.split(',').map(s => s.trim()).filter(Boolean)
            : [rawCName];

        const count = subCustomers.length;
        const splitGross = count > 1 ? (totalGross / count) : totalGross;

        subCustomers.forEach(cName => {
            const cleanCust = cName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const uniqueKey = `${baseTxId}_${cleanCust}`;
            const sigKey = `${cleanRider}_${cleanCust}_${rcDate}_${sTime || 'default'}`;

            processedSignatures.add(sigKey);
            processedSignatures.add(uniqueKey);

            mergedMap.set(uniqueKey, {
                transactionId: baseTxId,
                id: baseTxId,
                telegramId: (rc.telegramId || rc.riderId || "").toString().trim(),
                riderName: rName,
                customerName: cName,
                date: rcDate,
                time: sTime,
                startTime: sTime,
                completedTime: cTime,
                customerCount: count,
                duration: dur,
                totalFees: splitGross,
                isReceipt: true
            });
        });
    });

    (globalState.globalCateredHistory || []).forEach(ch => {
        if (!ch) return;
        const rawCName = (ch.customerName || "Customer").trim();
        if (!rawCName || rawCName.toLowerCase() === 'sample' || rawCName.toLowerCase() === 'test') return;

        const sTime = ch.startTime || ch.cateringStartTime || ch.time || "";
        const rawDate = ch.completedDate || ch.date || ch.timestamp || ch.createdAt || todayStr;
        const chDate = resolveOrderDate(sTime, rawDate);
        if (!chDate) return;

        const rName = (ch.riderName || "Rider").trim();
        const cleanRider = rName.toLowerCase();
        const cTime = ch.completedTime || "";
        const dur = ch.duration || "";
        const baseTxId = (ch.transactionId || ch.id || `${cleanRider}_${chDate}_${sTime}`).toString().trim();
        const totalGross = parseItemGross(ch);

        const subCustomers = rawCName.includes(',')
            ? rawCName.split(',').map(s => s.trim()).filter(Boolean)
            : [rawCName];

        const count = parseInt(ch.customerCount) || subCustomers.length || 1;
        const splitGross = subCustomers.length > 1 ? (totalGross / subCustomers.length) : totalGross;

        subCustomers.forEach(cName => {
            const cleanCust = cName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const uniqueKey = `${baseTxId}_${cleanCust}`;
            const sigKey = `${cleanRider}_${cleanCust}_${chDate}_${sTime || 'default'}`;

            if (processedSignatures.has(sigKey) || processedSignatures.has(uniqueKey)) {
                if (mergedMap.has(uniqueKey)) {
                    const existing = mergedMap.get(uniqueKey);
                    if (!existing.completedTime && cTime) existing.completedTime = cTime;
                    if (!existing.duration && dur) existing.duration = dur;
                    if (existing.customerCount === 1 && count > 1) existing.customerCount = count;
                }
                return;
            }

            mergedMap.set(uniqueKey, {
                transactionId: baseTxId,
                id: baseTxId,
                telegramId: (ch.telegramId || ch.riderId || "").toString().trim(),
                riderName: rName,
                customerName: cName,
                date: chDate,
                time: sTime,
                startTime: sTime,
                completedTime: cTime,
                customerCount: count,
                duration: dur,
                totalFees: splitGross,
                isReceipt: false
            });
        });
    });

    cachedMergedCommissionList = Array.from(mergedMap.values());
    lastMergedListTimestamp = now;
    return cachedMergedCommissionList;
}

function buildDailyGrossIndex() {
    const todayStr = getLocalTodayStr();
    const mergedList = getMergedDeduplicatedCommissionList();
    const grossIndex = new Map();

    for (let i = 0; i < mergedList.length; i++) {
        const rec = mergedList[i];
        const recDate = rec.date || rec.completedDate;
        if (!isSameDateStr(recDate, todayStr)) continue;

        const fee = parseFloat(rec.totalFees) || 0;
        if (fee <= 0) continue;

        let recId = (rec.telegramId || "").toString().trim();
        const recName = (rec.riderName || "").trim().toLowerCase();

        if (!recId && globalState.rosterMembers) {
            const rosterRec = globalState.rosterMembers.find(mem => 
                isRiderMatch(recName, mem.riderName || mem.name || "")
            );
            if (rosterRec && rosterRec.telegramId) {
                recId = rosterRec.telegramId.toString().trim();
            }
        }

        if (recId) {
            grossIndex.set(`id_${recId}`, (grossIndex.get(`id_${recId}`) || 0) + fee);
        }
        if (recName) {
            grossIndex.set(`name_${recName}`, (grossIndex.get(`name_${recName}`) || 0) + fee);
        }
    }

    lastGrossCacheTimestamp = Date.now();
    return grossIndex;
}

export function getRiderTodayGross(riderName, telegramId) {
    const tId = (telegramId || "").toString().trim();
    const rName = (riderName || "").trim().toLowerCase();

    if (!tId && !rName) return 0;

    const now = Date.now();
    if (!cachedDailyGrossMap || (now - lastGrossCacheTimestamp > 600)) {
        cachedDailyGrossMap = buildDailyGrossIndex();
    }

    if (tId && cachedDailyGrossMap.has(`id_${tId}`)) {
        return cachedDailyGrossMap.get(`id_${tId}`);
    }

    if (rName && cachedDailyGrossMap.has(`name_${rName}`)) {
        return cachedDailyGrossMap.get(`name_${rName}`);
    }

    for (const [key, amount] of cachedDailyGrossMap.entries()) {
        if (key.startsWith('name_')) {
            const kName = key.replace('name_', '');
            if (isRiderMatch(rName, kName, tId)) {
                return amount;
            }
        }
    }

    return 0;
}

export function sortAvailableRiders(availableList) {
    const settings = getQueueLineupSettings();
    const mode = settings.mode || 'lowest_gross';
    const cooldownMins = parseInt(settings.cooldownMinutes, 10) || 0;
    const cooldownMs = cooldownMins * 60 * 1000;
    const now = Date.now();

    if (mode === 'fifo') {
        return (availableList || []).slice().sort((a, b) => {
            const timeA = a.availableTimestamp || parseQueueTime(a.queueTime) || 0;
            const timeB = b.availableTimestamp || parseQueueTime(b.queueTime) || 0;
            return timeA - timeB;
        });
    }

    return (availableList || []).slice().sort((a, b) => {
        const timeA = a.availableTimestamp || parseQueueTime(a.queueTime) || 0;
        const timeB = b.availableTimestamp || parseQueueTime(b.queueTime) || 0;

        const isCoolingA = cooldownMs > 0 && timeA > 0 && (now - timeA < cooldownMs);
        const isCoolingB = cooldownMs > 0 && timeB > 0 && (now - timeB < cooldownMs);

        if (!isCoolingA && isCoolingB) return -1;
        if (isCoolingA && !isCoolingB) return 1;

        if (isCoolingA && isCoolingB) {
            return timeA - timeB;
        }

        const grossA = getRiderTodayGross(a.riderName || a.name, a.telegramId);
        const grossB = getRiderTodayGross(b.riderName || b.name, b.telegramId);

        if (grossA !== grossB) {
            return grossA - grossB;
        }

        return timeA - timeB;
    });
}

export const sortAvailableRidersByGross = sortAvailableRiders;

export async function archiveRiderCateringIfNeeded(targetRecord) {
    if (!targetRecord || targetRecord.status !== 'Catering' || !targetRecord.customerName) return;

    const custs = targetRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
    const times = targetRecord.startTime ? targetRecord.startTime.split(', ').map(t => t.trim()) : [];
    const custCount = custs.length || 1;
    const completedTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const tId = (targetRecord.telegramId || "").toString().trim();
    const tName = targetRecord.riderName || targetRecord.name || "Rider";
    const todayStr = getLocalTodayStr();

    if (db && custs.length > 0) {
        custs.forEach(cName => {
            const cleanC = cName.trim();
            db.ref('customerChats')
                .orderByChild('metadata/customerName')
                .equalTo(cleanC)
                .once('value', (snap) => {
                    const chats = snap.val();
                    if (chats) {
                        Object.keys(chats).forEach(custId => {
                            db.ref(`customerChats/${custId}/metadata`).update({
                                folder: 'done',
                                cateredByRiderId: null,
                                cateredByRiderName: null,
                                cateredBy: null,
                                lastUpdated: Date.now()
                            });
                        });
                    }
                });
        });
    }

    for (let i = 0; i < custs.length; i++) {
        const cName = custs[i];
        const cleanCustKey = cName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanRiderKey = tName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const sTime = times[i] || times[0] || 'N/A';
        const resolvedDate = resolveOrderDate(sTime, todayStr);
        const resolvedClean = resolvedDate.replace(/-/g, '');
        const cleanTimeKey = sTime.replace(/[^a-z0-9]/gi, '');
        const splitDuration = calculateSplitDuration(sTime, completedTimeStr, custCount);

        let finalFees = 0;
        let finalFeeDetails = null;
        let targetTxId = `RCPT_${cleanRiderKey}_${cleanCustKey}_${resolvedClean}_${cleanTimeKey || '1'}`;

        if (targetRecord.customerFees && cleanCustKey && targetRecord.customerFees[cleanCustKey]) {
            finalFees = parseFloat(targetRecord.customerFees[cleanCustKey].totalFees) || 0;
            finalFeeDetails = targetRecord.customerFees[cleanCustKey].fees || null;
            if (targetRecord.customerFees[cleanCustKey].transactionId) {
                targetTxId = targetRecord.customerFees[cleanCustKey].transactionId;
            }
        }

        if (finalFees <= 0 && globalState.globalDailyReceipts) {
            const matchReceipt = globalState.globalDailyReceipts.find(rc => {
                const rMatch = isRiderMatch(tName, rc.riderName, tId, rc.telegramId);
                const cMatch = isCustomerMatch(rc.customerName, cName);
                const dMatch = isSameDateStr(rc.date || rc.completedDate, resolvedDate) || isSameDateStr(rc.date || rc.completedDate, todayStr);
                return rMatch && cMatch && dMatch;
            });

            if (matchReceipt) {
                finalFees = parseItemGross(matchReceipt);
                finalFeeDetails = matchReceipt.fees || null;
                targetTxId = matchReceipt.transactionId || matchReceipt.id || targetTxId;
            }
        }

        const cleanSTime = (sTime || '').trim().toLowerCase();
        const alreadyInHistory = (globalState.globalCateredHistory || []).some(h => {
            if (!h) return false;
            const hTxId = (h.transactionId || h.id || "").toString();
            if (targetTxId && hTxId === targetTxId) return true;

            const hRider = (h.riderName || "").trim();
            const hCust = (h.customerName || "").trim().toLowerCase();
            const hDate = h.completedDate || h.date;
            const hSTime = (h.startTime || "").trim().toLowerCase();

            const isSameRider = isRiderMatch(tName, hRider, tId, h.telegramId);
            const isSameCustomer = isCustomerMatch(hCust, cName);
            const isDateMatch = isSameDateStr(hDate, resolvedDate) || isSameDateStr(hDate, todayStr);
            const isTimeMatch = !cleanSTime || cleanSTime === 'n/a' || !hSTime || hSTime === 'n/a' || hSTime === cleanSTime;

            return isSameRider && isSameCustomer && isDateMatch && isTimeMatch;
        });

        if (!alreadyInHistory) {
            const hItem = {
                id: targetTxId,
                transactionId: targetTxId,
                riderName: tName,
                telegramId: tId,
                customerName: cName,
                startTime: sTime,
                completedTime: completedTimeStr,
                completedDate: resolvedDate,
                date: resolvedDate,
                customerCount: custCount,
                duration: splitDuration,
                totalFees: finalFees,
                fees: finalFeeDetails
            };

            if (db) db.ref(`cateredHistory/${targetTxId}`).set(hItem);

            if (!globalState.globalCateredHistory) globalState.globalCateredHistory = [];
            globalState.globalCateredHistory.push(hItem);
        }
    }

    if (db && tId) {
        db.ref(`roster/${tId}/customerFees`).remove().catch(() => {});
        db.ref(`roster/${tId}/lastReceiptTotalFees`).remove().catch(() => {});
        db.ref(`roster/${tId}/lastReceiptFees`).remove().catch(() => {});
    }

    invalidateRosterGrossCache();
    saveRosterCache();
    window.dispatchEvent(new CustomEvent('cateredUpdated'));
    window.dispatchEvent(new CustomEvent('receiptsUpdated'));
}

export function getElapsedCateringTime(startTimeStr) {
    if (!startTimeStr) return "";
    
    const firstTime = startTimeStr.split(',')[0].trim();
    if (!firstTime) return "";

    const match = firstTime.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
    if (!match) return ` • ${firstTime}`;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3] ? match[3].toUpperCase() : null;

    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    const now = getPHTDate();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);

    let diffMs = now - start;
    if (diffMs < 0) {
        diffMs += 24 * 60 * 60 * 1000;
    }

    const totalMins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;

    if (hrs > 0) {
        return ` • ${firstTime} [${hrs}h ${mins}m]`;
    }
    return ` • ${firstTime} [${mins}m]`;
}

export function getElapsedBreakTime(rider) {
    if (!rider) return "0m";
    const now = Date.now();
    let startMs = rider.breakTimestamp || 0;

    if (!startMs && (rider.breakStartTime || rider.startTime || rider.lastUpdated)) {
        const timeStr = rider.breakStartTime || rider.startTime || rider.lastUpdated;
        const mins = parseTimeToMinutes(timeStr);
        if (mins !== null) {
            const pht = getPHTDate();
            const start = new Date(pht.getFullYear(), pht.getMonth(), pht.getDate(), Math.floor(mins / 60), mins % 60, 0);
            startMs = start.getTime();
            if (startMs > now) startMs -= 24 * 60 * 60 * 1000;
        }
    }

    if (!startMs) return "0m";

    const diffMs = Math.max(0, now - startMs);
    const totalMins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;

    if (hrs > 0) {
        return `${hrs}h ${String(mins).padStart(2, '0')}m`;
    }
    return `${mins}m`;
}

export function getActiveCateringCustomersWithTimes() {
    const myId = (appState.telegramId || "").toString();
    const myRecord = globalState.rosterMembers ? globalState.rosterMembers.find(m => (m.telegramId || "").toString() === myId) : null;
    if (!myRecord || myRecord.status !== 'Catering' || !myRecord.customerName) return [];

    const custs = myRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
    const times = myRecord.startTime ? myRecord.startTime.split(', ').map(t => t.trim()) : [];

    return custs.map((c, idx) => ({
        name: c,
        startTime: times[idx] || times[0] || ""
    }));
}

export function hasReceiptForActiveSession(custName, custStartTime) {
    if (!custName || custName.toLowerCase() === 'sample') return true;
    const rName = (appState.riderName || "").trim().toLowerCase();
    const cName = custName.trim().toLowerCase();
    const sTime = (custStartTime || "").trim();
    const todayStr = getLocalTodayStr();
    const resolvedOrderDate = resolveOrderDate(sTime, todayStr);

    const keyWithTime = `receipt_done_${rName}_${cName}_${sTime}_${resolvedOrderDate}`;
    const keyTypo = `receipt_done_${rName}_${cName}__${resolvedOrderDate}`;
    const keyWithoutTime = `receipt_done_${rName}_${cName}_${resolvedOrderDate}`;

    if (localStorage.getItem(keyWithTime) === 'true' ||
        localStorage.getItem(keyTypo) === 'true' ||
        localStorage.getItem(keyWithoutTime) === 'true') {
        return true;
    }

    const receipts = globalState.globalDailyReceipts || [];
    const hasReceiptRecord = receipts.some(rc => {
        const rcRider = (rc.riderName || "").trim().toLowerCase();
        const rcDate = rc.date || rc.completedDate;

        return isRiderMatch(rName, rcRider, appState.telegramId, rc.telegramId) && 
               isCustomerMatch(rc.customerName, custName) && 
               (isSameDateStr(rcDate, resolvedOrderDate) || isSameDateStr(rcDate, todayStr));
    });

    if (hasReceiptRecord) return true;

    const myRecord = globalState.rosterMembers ? globalState.rosterMembers.find(m => (m.telegramId || "").toString() === (appState.telegramId || "").toString()) : null;
    const cleanCName = cName.replace(/[^a-z0-9]/g, '');
    if (myRecord && myRecord.customerFees && cleanCName && myRecord.customerFees[cleanCName]) {
        return true;
    }

    return false;
}

export function checkFirstInLineAlarm(availableRiders) {
    const myId = (appState.telegramId || "").toString();
    const firstRiderId = (availableRiders[0]?.telegramId || "").toString();
    const isFirst = availableRiders.length > 0 && firstRiderId === myId && myId !== "";
    
    const modal = document.getElementById('first-line-modal') || document.getElementById('first-in-line-modal');
    const goldenBox = document.getElementById('golden-first-line-border');

    if (isFirst) {
        if (goldenBox) goldenBox.classList.remove('hidden');

        if (!lineAlarmConfirmed) {
            if (modal && modal.classList.contains('hidden')) {
                modal.classList.remove('hidden');
            }
            if (!lineAlarmInterval) {
                lineAlarmInterval = setInterval(playLineBeep, 1200);
            }
        }
    } else {
        stopLineAlarm();
        if (modal) modal.classList.add('hidden');
        if (goldenBox) goldenBox.classList.add('hidden');
    }
}

export function confirmFirstInLineAlarm() {
    lineAlarmConfirmed = true;
    stopLineAlarm();
    const modal = document.getElementById('first-line-modal') || document.getElementById('first-in-line-modal');
    if (modal) modal.classList.add('hidden');
    showToast("✅ Confirmed! Alarm stopped.");
}

export function stopLineAlarm() {
    if (lineAlarmInterval) {
        clearInterval(lineAlarmInterval);
        lineAlarmInterval = null;
    }
}

export function playLineBeep() {
    try {
        unlockAudioContext();
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const audioCtx = new AudioContext();
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.4);
    } catch(e) {}
}

export const playLineAlarm = playLineBeep;

// REMARKS: ROSTER_UTILS_MULTI_CUSTOMER_COMMA_EXPANSION_V4_COMPLETE