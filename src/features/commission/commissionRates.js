// src/features/commission/commissionRates.js

/**
 * ============================================================================
 * COMMISSION RATES ENGINE & STRICT ADMIN PRIVILEGE RESOLVER
 * ============================================================================
 * 
 * Description:
 * Resolves net commission percentages per rider, date, and operational conditions:
 * - Strict Admin Validation: Eliminates fuzzy substring matching and volatile
 *   roster state checks, preventing ordinary riders from inheriting 0% fee exemptions.
 * - Date-specific Admin penalties and recurring/special calendar discounts.
 * - Early Shift Out Surcharge Resolver: factors unexcused early clock-outs directly
 *   into payable company rates.
 * ============================================================================
 */

import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { ADMIN_IDS } from '../../config/constants.js';
import { getLocalTodayStr } from '../../utils/helpers.js';
import { isSameDateStr, isRiderMatch, parseTimeToMinutes } from '../roster/rosterUtils.js';

export const SETTINGS_CACHE_KEY = 'lokalex_commission_settings_cache_v2';
export const RECEIPTS_CACHE_KEY = 'lokalex_receipts_cache_v2';
export const CATERED_CACHE_KEY = 'lokalex_catered_cache_v2';

export let defaultCommissionRate = 10;
export function setDefaultCommissionRate(val) { defaultCommissionRate = val; }

export let customRiderRates = {};
export function setCustomRiderRates(val) { customRiderRates = val; }

export let recurringDiscount = {
    enabled: true,
    day: 0,
    percentage: 5
};
export function setRecurringDiscount(val) { recurringDiscount = val; }

export let specialDateDiscounts = {};
export function setSpecialDateDiscounts(val) { specialDateDiscounts = val; }

export let overtimeReward = {
    enabled: false,
    type: 'percentage', // 'percentage' | 'fixed'
    value: 5,
    thresholdHours: 8
};
export function setOvertimeReward(val) { overtimeReward = val; }

export function loadCommissionSettingsCache() {
    try {
        const savedSettings = localStorage.getItem(SETTINGS_CACHE_KEY);
        if (savedSettings) {
            const data = JSON.parse(savedSettings);
            if (data) {
                if (data.defaultPercentage !== undefined) defaultCommissionRate = parseFloat(data.defaultPercentage);
                if (data.riderRates) customRiderRates = data.riderRates;
                if (data.recurringDiscount) recurringDiscount = data.recurringDiscount;
                if (data.specialDateDiscounts) specialDateDiscounts = data.specialDateDiscounts;
                if (data.overtimeReward) {
                    overtimeReward = {
                        enabled: !!data.overtimeReward.enabled,
                        type: data.overtimeReward.type || 'percentage',
                        value: parseFloat(data.overtimeReward.value) || 0,
                        thresholdHours: parseFloat(data.overtimeReward.thresholdHours) || 8
                    };
                }
            }
        }

        const savedReceipts = localStorage.getItem(RECEIPTS_CACHE_KEY);
        if (savedReceipts && (!globalState.globalDailyReceipts || globalState.globalDailyReceipts.length === 0)) {
            globalState.globalDailyReceipts = JSON.parse(savedReceipts);
        }

        const savedCatered = localStorage.getItem(CATERED_CACHE_KEY);
        if (savedCatered && (!globalState.globalCateredHistory || globalState.globalCateredHistory.length === 0)) {
            globalState.globalCateredHistory = JSON.parse(savedCatered);
        }
    } catch(e) {}
}

export function saveCommissionSettingsCache() {
    try {
        const payload = {
            defaultPercentage: defaultCommissionRate,
            riderRates: customRiderRates,
            recurringDiscount: recurringDiscount,
            specialDateDiscounts: specialDateDiscounts,
            overtimeReward: overtimeReward
        };
        localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(payload));
        if (globalState.globalDailyReceipts) {
            localStorage.setItem(RECEIPTS_CACHE_KEY, JSON.stringify(globalState.globalDailyReceipts));
        }
        if (globalState.globalCateredHistory) {
            localStorage.setItem(CATERED_CACHE_KEY, JSON.stringify(globalState.globalCateredHistory));
        }
    } catch(e) {}
}

loadCommissionSettingsCache();

export async function fetchRiderUserTypes() {
    if (!db) return;
    try {
        const snap = await db.ref('riders').once('value');
        const val = snap.val();
        if (val) {
            const userTypes = {};
            Object.entries(val).forEach(([id, rider]) => {
                const name = (rider.riderName || rider.name || "").toLowerCase().trim();
                const type = (rider.userType || rider.type || "rider").toLowerCase().trim();
                const cleanId = (rider.telegramId || rider.id || id).toString().trim();
                if (name) userTypes[name] = type;
                if (cleanId) userTypes[cleanId] = type;
            });
            globalState.userTypesMap = userTypes;
        }
    } catch(e) {
        console.warn("Could not fetch rider user types from Firebase:", e);
    }
}

/**
 * STRICT CHECK IF A RIDER IS AN ADMIN
 * Relies strictly on ADMIN_IDS and registered user accounts in `riders`.
 * Never evaluates temporary roster state or loose substring matches.
 */
export function isRiderAdmin(riderName = "", telegramId = "") {
    const cleanName = (riderName || "").toString().toLowerCase().trim();
    const cleanId = (telegramId || "").toString().trim();

    // 1. Direct match in ADMIN_IDS array
    if (cleanId && ADMIN_IDS.some(id => id.toString().trim() === cleanId && cleanId !== "1234")) {
        return true;
    }
    if (cleanName && ADMIN_IDS.some(id => id.toString().toLowerCase().trim() === cleanName && cleanName !== "regular")) {
        return true;
    }

    // 2. Exact match in registered users map (from riders/)
    if (globalState.userTypesMap) {
        if (cleanId && globalState.userTypesMap[cleanId]) {
            const type = globalState.userTypesMap[cleanId].toString().toLowerCase().trim();
            if (['admin', 'owner', 'manager', 'superadmin', 'administrator'].includes(type)) {
                return true;
            }
        }
        if (cleanName && globalState.userTypesMap[cleanName]) {
            const type = globalState.userTypesMap[cleanName].toString().toLowerCase().trim();
            if (['admin', 'owner', 'manager', 'superadmin', 'administrator'].includes(type)) {
                return true;
            }
        }
    }

    return false;
}

export function checkRiderIsOvertime(dateStr, riderName = "", telegramId = "", receiptTimeOrItem = null) {
    if (!overtimeReward || !overtimeReward.enabled) return false;
    if (isRiderAdmin(riderName, telegramId)) return false;

    const dateFormatted = dateStr || getLocalTodayStr();
    const cleanName = (riderName || "").toLowerCase().trim();
    const cleanId = (telegramId || "").toString().trim();

    let thresholdHours = parseFloat(overtimeReward.thresholdHours);
    if (isNaN(thresholdHours) || thresholdHours <= 0) thresholdHours = 8;

    if (globalState.earlyShiftPenaltyConfig && globalState.earlyShiftPenaltyConfig.riderTargets) {
        const customTarget = parseFloat(globalState.earlyShiftPenaltyConfig.riderTargets[cleanId] || globalState.earlyShiftPenaltyConfig.riderTargets[cleanName]);
        if (!isNaN(customTarget) && customTarget > 0 && thresholdHours === 8) {
            thresholdHours = customTarget;
        }
    }
    const targetMins = Math.round(thresholdHours * 60);

    let loginRec = null;
    if (globalState.globalLogins && Array.isArray(globalState.globalLogins)) {
        loginRec = globalState.globalLogins.find(l => 
            isSameDateStr(l.date, dateFormatted) &&
            ((cleanId && (l.riderId || l.id || "").toString().trim() === cleanId) ||
             (cleanName && (l.riderName || "").trim().toLowerCase() === cleanName))
        );
    }

    let rosterMem = null;
    if (globalState.rosterMembers) {
        rosterMem = globalState.rosterMembers.find(m => 
            (cleanId && (m.telegramId || m.id || "").toString().trim() === cleanId) ||
            (cleanName && (m.riderName || m.name || "").trim().toLowerCase() === cleanName)
        );
    }

    let totalBreakMins = 0;
    if (loginRec && loginRec.totalBreakMinutes !== undefined) {
        totalBreakMins = parseInt(loginRec.totalBreakMinutes, 10) || 0;
    } else if (rosterMem && rosterMem.totalBreakMinutes !== undefined) {
        totalBreakMins = parseInt(rosterMem.totalBreakMinutes, 10) || 0;
    }

    let loginTimestamp = loginRec?.loginTimestamp || null;
    let loginTimeStr = loginRec?.loginTime || rosterMem?.timeIn || "";

    if (!loginTimestamp && loginTimeStr) {
        const parsedMins = parseTimeToMinutes(loginTimeStr);
        if (parsedMins !== null) {
            const d = new Date(dateFormatted.includes('-') ? dateFormatted + "T00:00:00" : Number(dateFormatted));
            d.setHours(Math.floor(parsedMins / 60), parsedMins % 60, 0, 0);
            loginTimestamp = d.getTime();
        }
    }

    // 1. Specific receipt/order time check
    if (receiptTimeOrItem !== null && receiptTimeOrItem !== undefined) {
        if (typeof receiptTimeOrItem === 'string' && receiptTimeOrItem.trim() !== '') {
            const rMins = parseTimeToMinutes(receiptTimeOrItem);
            const lMins = loginTimeStr ? parseTimeToMinutes(loginTimeStr) : null;
            if (rMins !== null && lMins !== null) {
                let grossMins = rMins - lMins;
                if (grossMins < 0) grossMins += 1440;
                const netMins = Math.max(0, grossMins - totalBreakMins);
                return netMins >= targetMins;
            }
        } else if (typeof receiptTimeOrItem === 'number' && loginTimestamp) {
            const grossMins = Math.max(0, Math.floor((receiptTimeOrItem - loginTimestamp) / 60000));
            const netMins = Math.max(0, grossMins - totalBreakMins);
            return netMins >= targetMins;
        }
    }

    // 2. Active duty check for live/upcoming orders today
    const now = Date.now();
    const isToday = isSameDateStr(dateFormatted, getLocalTodayStr());

    if (isToday && loginTimestamp) {
        let activeBreakMins = totalBreakMins;
        if (rosterMem?.status === 'Break' && rosterMem.breakTimestamp) {
            activeBreakMins += Math.max(0, Math.floor((now - rosterMem.breakTimestamp) / 60000));
        }
        const grossMins = Math.max(0, Math.floor((now - loginTimestamp) / 60000));
        const netMins = Math.max(0, grossMins - activeBreakMins);
        return netMins >= targetMins;
    }

    // 3. Historical or logged-out record
    if (loginRec) {
        if (loginRec.netWorkedMinutes !== undefined) {
            return parseInt(loginRec.netWorkedMinutes, 10) >= targetMins;
        }
        if (loginTimestamp && loginRec.logoutTimestamp) {
            const grossMins = Math.max(0, Math.floor((loginRec.logoutTimestamp - loginTimestamp) / 60000));
            const netMins = Math.max(0, grossMins - totalBreakMins);
            return netMins >= targetMins;
        }
    }

    return false;
}

export function getCommissionRates(dateStr, riderName = "", telegramId = "", receiptTimeOrItem = null) {
    const dateFormatted = dateStr || getLocalTodayStr();
    const d = new Date(dateFormatted + "T00:00:00");
    const dayOfWeek = d.getDay();

    const isAdmin = isRiderAdmin(riderName, telegramId);

    if (isAdmin) {
        return {
            companyRate: 0,
            riderRate: 1.0,
            isSunday: dayOfWeek === 0,
            companyPerc: 0,
            riderPerc: 100,
            baseCompanyPerc: 0,
            penaltyPerc: 0,
            manualPenaltyPerc: 0,
            earlyShiftPenaltyPerc: 0,
            earlyShiftDeficitHours: 0,
            promoDiscountPerc: 0,
            hasCustomOverride: true,
            isAdmin: true,
            isOvertime: false,
            overtimeDiscountPerc: 0,
            overtimeDiscountAmount: 0,
            overtimeReward: overtimeReward
        };
    }

    const cleanName = (riderName || "").toLowerCase().trim();
    const cleanId = (telegramId || "").toString().trim();

    let baseCompanyPerc = defaultCommissionRate;
    let hasCustomOverride = false;

    if (cleanId && customRiderRates[cleanId] !== undefined && customRiderRates[cleanId] !== null && customRiderRates[cleanId] !== "") {
        baseCompanyPerc = parseFloat(customRiderRates[cleanId]);
        hasCustomOverride = true;
    } else if (cleanName && customRiderRates[cleanName] !== undefined && customRiderRates[cleanName] !== null && customRiderRates[cleanName] !== "") {
        baseCompanyPerc = parseFloat(customRiderRates[cleanName]);
        hasCustomOverride = true;
    }

    if (!hasCustomOverride && globalState.globalRiderRates) {
        if (globalState.globalRiderRates[cleanName]) {
            const setting = globalState.globalRiderRates[cleanName];
            baseCompanyPerc = parseFloat(setting.percentage || setting.basePercentage || defaultCommissionRate);
            hasCustomOverride = true;
        } else if (cleanId && globalState.globalRiderRates[cleanId]) {
            const setting = globalState.globalRiderRates[cleanId];
            baseCompanyPerc = parseFloat(setting.percentage || setting.basePercentage || defaultCommissionRate);
            hasCustomOverride = true;
        }
    }

    let manualPenaltyPerc = 0;
    let penaltyReason = "";

    if (globalState.globalCommissionPenalties) {
        const safeName = cleanName.replace(/[.#$\[\]\/]/g, '_');
        const safeId = cleanId ? cleanId.replace(/[.#$\[\]\/]/g, '_') : null;

        const directKey = `${cleanName}_${dateFormatted}`;
        const safeKey = `${safeName}_${dateFormatted}`;
        const idKey = cleanId ? `${cleanId}_${dateFormatted}` : null;
        const safeIdKey = safeId ? `${safeId}_${dateFormatted}` : null;

        let directRecord = globalState.globalCommissionPenalties[safeKey] ||
                             globalState.globalCommissionPenalties[directKey] || 
                             (safeIdKey ? globalState.globalCommissionPenalties[safeIdKey] : null) ||
                             (idKey ? globalState.globalCommissionPenalties[idKey] : null);

        // Fallback: If cleanName doesn't directly match key, search with isRiderMatch
        if (!directRecord) {
            const matchEntry = Object.entries(globalState.globalCommissionPenalties).find(([k, rec]) => {
                if (!rec) return false;
                if (!isSameDateStr(rec.date, dateFormatted)) return false;
                const recRider = (rec.riderName || k.split('_')[0] || "").toLowerCase().trim();
                const recId = (rec.telegramId || "").toString().trim();
                return isRiderMatch(cleanName, recRider, cleanId, recId);
            });
            if (matchEntry) directRecord = matchEntry[1];
        }

        if (directRecord && directRecord.penaltyPercentage) {
            manualPenaltyPerc = Math.max(0, parseFloat(directRecord.penaltyPercentage) || 0);
            penaltyReason = directRecord.reason || "";
        }
    }

    let earlyShiftPenaltyPerc = 0;
    let earlyShiftDeficitHours = 0;

    if (globalState.globalLogins && Array.isArray(globalState.globalLogins)) {
        const loginRec = globalState.globalLogins.find(l => 
            isSameDateStr(l.date, dateFormatted) &&
            ((cleanId && (l.riderId || l.id || "").toString().trim() === cleanId) ||
             (cleanName && (l.riderName || "").trim().toLowerCase() === cleanName))
        );
        if (loginRec && loginRec.earlyShiftPenaltyPercent) {
            earlyShiftPenaltyPerc = Math.max(0, parseFloat(loginRec.earlyShiftPenaltyPercent) || 0);
            earlyShiftDeficitHours = parseInt(loginRec.deficitHours, 10) || 0;
        }
    }

    if (earlyShiftPenaltyPerc === 0 && isSameDateStr(dateFormatted, getLocalTodayStr()) && globalState.rosterMembers) {
        const rosterMem = globalState.rosterMembers.find(m => 
            (cleanId && (m.telegramId || m.id || "").toString().trim() === cleanId) ||
            (cleanName && (m.riderName || m.name || "").trim().toLowerCase() === cleanName)
        );
        if (rosterMem && rosterMem.commissionSurcharge) {
            earlyShiftPenaltyPerc = Math.max(0, parseFloat(rosterMem.commissionSurcharge) || 0);
            earlyShiftDeficitHours = parseInt(rosterMem.earlyShiftDeficitHours, 10) || 0;
        }
    }

    let promoDiscountPerc = 0;

    if (recurringDiscount && recurringDiscount.enabled && recurringDiscount.day === dayOfWeek) {
        promoDiscountPerc = Math.max(promoDiscountPerc, parseFloat(recurringDiscount.percentage) || 0);
    }

    if (specialDateDiscounts && specialDateDiscounts[dateFormatted] !== undefined) {
        promoDiscountPerc = Math.max(promoDiscountPerc, parseFloat(specialDateDiscounts[dateFormatted]) || 0);
    }

    const totalPenaltyPerc = manualPenaltyPerc + earlyShiftPenaltyPerc;
    let finalCompanyPerc = Math.max(0, baseCompanyPerc + totalPenaltyPerc - promoDiscountPerc);

    let isOvertime = false;
    let overtimeDiscountPerc = 0;
    let overtimeDiscountAmount = 0;

    if (overtimeReward && overtimeReward.enabled) {
        isOvertime = checkRiderIsOvertime(dateFormatted, cleanName, cleanId, receiptTimeOrItem);
        if (isOvertime) {
            if (overtimeReward.type === 'fixed') {
                overtimeDiscountAmount = Math.max(0, parseFloat(overtimeReward.value) || 0);
            } else {
                overtimeDiscountPerc = Math.min(finalCompanyPerc, Math.max(0, parseFloat(overtimeReward.value) || 0));
                finalCompanyPerc = Math.max(0, finalCompanyPerc - overtimeDiscountPerc);
            }
        }
    }

    const companyRate = finalCompanyPerc / 100;
    const riderRate = Math.max(0, (100 - finalCompanyPerc) / 100);

    return {
        companyRate: companyRate,
        riderRate: riderRate,
        isSunday: dayOfWeek === 0,
        companyPerc: finalCompanyPerc,
        riderPerc: Math.max(0, 100 - finalCompanyPerc),
        baseCompanyPerc: baseCompanyPerc,
        penaltyPerc: totalPenaltyPerc,
        manualPenaltyPerc: manualPenaltyPerc,
        earlyShiftPenaltyPerc: earlyShiftPenaltyPerc,
        earlyShiftDeficitHours: earlyShiftDeficitHours,
        promoDiscountPerc: promoDiscountPerc,
        hasCustomOverride: hasCustomOverride,
        penaltyReason: penaltyReason,
        isAdmin: false,
        isOvertime: isOvertime,
        overtimeDiscountPerc: overtimeDiscountPerc,
        overtimeDiscountAmount: overtimeDiscountAmount,
        overtimeReward: overtimeReward
    };
}

export async function fetchCommissionSettings() {
    loadCommissionSettingsCache();
    await fetchRiderUserTypes();

    if (db) {
        const todayStr = getLocalTodayStr();

        db.ref('settings/commission').on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                defaultCommissionRate = typeof data.defaultPercentage === 'number' ? data.defaultPercentage : (parseFloat(data.defaultPercentage) || 10);
                customRiderRates = data.riderRates || {};
                
                if (data.recurringDiscount) {
                    recurringDiscount = {
                        enabled: !!data.recurringDiscount.enabled,
                        day: parseInt(data.recurringDiscount.day) || 0,
                        percentage: parseFloat(data.recurringDiscount.percentage) || 0
                    };
                }
                specialDateDiscounts = data.specialDateDiscounts || {};
                if (data.overtimeReward) {
                    overtimeReward = {
                        enabled: !!data.overtimeReward.enabled,
                        type: data.overtimeReward.type || 'percentage',
                        value: parseFloat(data.overtimeReward.value) || 0,
                        thresholdHours: parseFloat(data.overtimeReward.thresholdHours) || 8
                    };
                }
                saveCommissionSettingsCache();
            }
            if (window.refreshCommissionView) window.refreshCommissionView();
        });

        db.ref('commissionSettings').once('value', (snapshot) => {
            const val = snapshot.val();
            if (val) {
                let ratesMap = globalState.globalRiderRates || {};
                Object.values(val).forEach(item => {
                    const name = (item.rider || item.Rider || "").toLowerCase().trim();
                    if (name) {
                        ratesMap[name] = {
                            percentage: parseFloat(item.percentage || item.Percentage || item.basePercentage) || defaultCommissionRate,
                            promoLess: parseFloat(item.isPromoLessPerc || item.IsPromoLessPerc || item.promoLess) || 0
                        };
                    }
                });
                globalState.globalRiderRates = ratesMap;
                if (window.refreshCommissionView) window.refreshCommissionView();
            }
        });

        db.ref('commissionPenalties').on('value', (snapshot) => {
            globalState.globalCommissionPenalties = snapshot.val() || {};
            if (window.refreshCommissionView) window.refreshCommissionView();
        });

        db.ref('logins')
            .orderByChild('date')
            .equalTo(todayStr)
            .on('value', (snapshot) => {
                const val = snapshot.val();
                globalState.globalLogins = val ? Object.values(val) : [];
                if (window.refreshCommissionView) window.refreshCommissionView();
            });
    }
}

// REMARKS: COMMISSION_RATES_STRICT_ADMIN_VALIDATION_V3_COMPLETE