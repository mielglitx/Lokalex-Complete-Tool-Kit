// src/features/commission/commissionRates.js
import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { ADMIN_IDS } from '../../config/constants.js';
import { getLocalTodayStr } from '../../utils/helpers.js';
import { isRiderMatch, isSameDateStr } from '../roster/rosterUtils.js';

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

// LOAD COMMISSION SETTINGS & DATA FROM LOCAL CACHE
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
            specialDateDiscounts: specialDateDiscounts
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

// 100% FIREBASE USER TYPE LOADER
export async function fetchRiderUserTypes() {
    if (!db) return;
    try {
        const snap = await db.ref('riders').once('value');
        const val = snap.val();
        if (val) {
            const userTypes = {};
            Object.entries(val).forEach(([id, rider]) => {
                const name = (rider.riderName || rider.name || "").toLowerCase().trim();
                const type = (rider.userType || rider.type || "").toLowerCase().trim();
                if (name) userTypes[name] = type;
                if (id) userTypes[id] = type;
            });
            globalState.userTypesMap = userTypes;
        }
    } catch(e) {
        console.warn("Could not fetch rider user types from Firebase:", e);
    }
}

// STRICT CHECK IF A RIDER IS AN ADMIN
export function isRiderAdmin(riderName = "", telegramId = "") {
    const cleanName = (riderName || "").toString().toLowerCase().trim();
    const cleanId = (telegramId || "").toString().trim();

    if (cleanId && ADMIN_IDS.some(id => id.toString().trim() === cleanId)) return true;
    if (cleanName && ADMIN_IDS.some(id => isRiderMatch(cleanName, id.toString()))) return true;

    if (globalState.userTypesMap) {
        if (cleanId && globalState.userTypesMap[cleanId]) {
            const type = globalState.userTypesMap[cleanId];
            if (type === "admin" || type === "owner" || type === "manager") return true;
        }
        if (cleanName && globalState.userTypesMap[cleanName]) {
            const type = globalState.userTypesMap[cleanName];
            if (type === "admin" || type === "owner" || type === "manager") return true;
        }

        for (const [key, type] of Object.entries(globalState.userTypesMap)) {
            if (type === "admin" || type === "owner" || type === "manager") {
                if (isRiderMatch(cleanName, key, cleanId, key)) return true;
            }
        }
    }

    const rosterMem = (globalState.rosterMembers || []).find(m => 
        isRiderMatch(cleanName, m.riderName || m.name || "", cleanId, m.telegramId || m.id)
    );

    if (rosterMem) {
        const uType = (rosterMem.userType || "").toLowerCase().trim();
        if (uType === "tl" || uType.includes("lead")) return false;
        if (uType === "admin" || uType === "owner" || uType === "manager") return true;
    }

    return false;
}

// GET DYNAMIC COMMISSION RATES PER RIDER
export function getCommissionRates(dateStr, riderName = "", telegramId = "") {
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
            promoDiscountPerc: 0,
            hasCustomOverride: true,
            isAdmin: true
        };
    }

    const cleanName = (riderName || "").toLowerCase().trim();
    const cleanId = (telegramId || "").toString().trim();

    let baseCompanyPerc = defaultCommissionRate;
    let hasCustomOverride = false;

    // 1. Direct ID or Name Match
    if (cleanId && customRiderRates[cleanId] !== undefined && customRiderRates[cleanId] !== null && customRiderRates[cleanId] !== "") {
        baseCompanyPerc = parseFloat(customRiderRates[cleanId]);
        hasCustomOverride = true;
    } else if (cleanName && customRiderRates[cleanName] !== undefined && customRiderRates[cleanName] !== null && customRiderRates[cleanName] !== "") {
        baseCompanyPerc = parseFloat(customRiderRates[cleanName]);
        hasCustomOverride = true;
    } else {
        // Fuzzy Match across customRiderRates keys
        for (const [rateKey, rateVal] of Object.entries(customRiderRates)) {
            if (rateVal !== undefined && rateVal !== null && rateVal !== "") {
                if (isRiderMatch(cleanName, rateKey, cleanId, rateKey)) {
                    baseCompanyPerc = parseFloat(rateVal);
                    hasCustomOverride = true;
                    break;
                }
            }
        }
    }

    // 2. Fallback to globalRiderRates settings
    if (!hasCustomOverride && globalState.globalRiderRates) {
        if (globalState.globalRiderRates[cleanName]) {
            const setting = globalState.globalRiderRates[cleanName];
            baseCompanyPerc = parseFloat(setting.percentage || setting.basePercentage || defaultCommissionRate);
            hasCustomOverride = true;
        } else {
            for (const [rKey, setting] of Object.entries(globalState.globalRiderRates)) {
                if (isRiderMatch(cleanName, rKey, cleanId, rKey)) {
                    baseCompanyPerc = parseFloat(setting.percentage || setting.basePercentage || defaultCommissionRate);
                    hasCustomOverride = true;
                    break;
                }
            }
        }
    }

    // 3. Penalty lookup with canonical fuzzy matching
    let penaltyPerc = 0;
    let penaltyReason = "";

    if (globalState.globalCommissionPenalties) {
        const directKey = `${cleanName}_${dateFormatted}`;
        const idKey = cleanId ? `${cleanId}_${dateFormatted}` : null;

        const directRecord = globalState.globalCommissionPenalties[directKey] || 
                             (idKey ? globalState.globalCommissionPenalties[idKey] : null);

        if (directRecord && directRecord.penaltyPercentage) {
            penaltyPerc = Math.max(0, parseFloat(directRecord.penaltyPercentage) || 0);
            penaltyReason = directRecord.reason || "";
        } else {
            for (const [key, rec] of Object.entries(globalState.globalCommissionPenalties)) {
                if (!rec) continue;
                if (isSameDateStr(rec.date, dateFormatted)) {
                    const recRiderName = rec.riderName || key.split('_')[0] || "";
                    const recRiderId = (rec.telegramId || "").toString().trim();
                    if (isRiderMatch(riderName, recRiderName, cleanId, recRiderId)) {
                        penaltyPerc = Math.max(0, parseFloat(rec.penaltyPercentage) || 0);
                        penaltyReason = rec.reason || "";
                        break;
                    }
                }
            }
        }
    }

    // 4. Promo discounts
    let promoDiscountPerc = 0;

    if (recurringDiscount && recurringDiscount.enabled && recurringDiscount.day === dayOfWeek) {
        promoDiscountPerc = Math.max(promoDiscountPerc, parseFloat(recurringDiscount.percentage) || 0);
    }

    if (specialDateDiscounts && specialDateDiscounts[dateFormatted] !== undefined) {
        promoDiscountPerc = Math.max(promoDiscountPerc, parseFloat(specialDateDiscounts[dateFormatted]) || 0);
    }

    let finalCompanyPerc = Math.max(0, baseCompanyPerc + penaltyPerc - promoDiscountPerc);
    let companyRate = finalCompanyPerc / 100;
    let riderRate = Math.max(0, (100 - finalCompanyPerc) / 100);

    return {
        companyRate: companyRate,
        riderRate: riderRate,
        isSunday: dayOfWeek === 0,
        companyPerc: finalCompanyPerc,
        riderPerc: Math.max(0, 100 - finalCompanyPerc),
        baseCompanyPerc: baseCompanyPerc,
        penaltyPerc: penaltyPerc,
        promoDiscountPerc: promoDiscountPerc,
        hasCustomOverride: hasCustomOverride,
        penaltyReason: penaltyReason,
        isAdmin: false
    };
}

export async function fetchCommissionSettings() {
    loadCommissionSettingsCache();
    await fetchRiderUserTypes();

    if (db) {
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

        // REALTIME LISTENER FOR RECEIPTS
        db.ref('receipts').on('value', (snapshot) => {
            const val = snapshot.val();
            globalState.globalDailyReceipts = val ? Object.values(val) : [];
            saveCommissionSettingsCache();
            if (window.refreshCommissionView) window.refreshCommissionView();
        });

        // REALTIME LISTENER FOR CATERED HISTORY
        db.ref('cateredHistory').on('value', (snapshot) => {
            const val = snapshot.val();
            globalState.globalCateredHistory = val ? Object.values(val) : [];
            saveCommissionSettingsCache();
            if (window.refreshCommissionView) window.refreshCommissionView();
        });
    }
}