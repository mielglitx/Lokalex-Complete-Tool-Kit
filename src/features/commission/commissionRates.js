// src/features/commission/commissionRates.js
import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { ADMIN_IDS } from '../../config/constants.js';
import { getLocalTodayStr } from '../../utils/helpers.js';

export const SETTINGS_CACHE_KEY = 'lokalex_commission_settings_cache_v2';

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

// LOAD COMMISSION SETTINGS FROM LOCAL CACHE
export function loadCommissionSettingsCache() {
    try {
        const saved = localStorage.getItem(SETTINGS_CACHE_KEY);
        if (saved) {
            const data = JSON.parse(saved);
            if (data) {
                if (data.defaultPercentage !== undefined) defaultCommissionRate = parseFloat(data.defaultPercentage);
                if (data.riderRates) customRiderRates = data.riderRates;
                if (data.recurringDiscount) recurringDiscount = data.recurringDiscount;
                if (data.specialDateDiscounts) specialDateDiscounts = data.specialDateDiscounts;
            }
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
    if (cleanName && ADMIN_IDS.some(id => id.toString().toLowerCase().trim() === cleanName)) return true;

    if (globalState.userTypesMap) {
        const hasName = cleanName && (cleanName in globalState.userTypesMap);
        const hasId = cleanId && (cleanId in globalState.userTypesMap);

        if (hasName || hasId) {
            const typeByName = hasName ? globalState.userTypesMap[cleanName] : "";
            const typeById = hasId ? globalState.userTypesMap[cleanId] : "";

            return typeByName === "admin" || typeById === "admin";
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

    if (cleanId && customRiderRates[cleanId] !== undefined && customRiderRates[cleanId] !== null && customRiderRates[cleanId] !== "") {
        baseCompanyPerc = parseFloat(customRiderRates[cleanId]);
        hasCustomOverride = true;
    } else if (cleanName && customRiderRates[cleanName] !== undefined && customRiderRates[cleanName] !== null && customRiderRates[cleanName] !== "") {
        baseCompanyPerc = parseFloat(customRiderRates[cleanName]);
        hasCustomOverride = true;
    } else if (globalState.globalRiderRates && globalState.globalRiderRates[cleanName]) {
        const setting = globalState.globalRiderRates[cleanName];
        if (setting.percentage !== undefined) {
            baseCompanyPerc = parseFloat(setting.percentage);
            hasCustomOverride = true;
        } else if (setting.basePercentage !== undefined) {
            baseCompanyPerc = parseFloat(setting.basePercentage);
            hasCustomOverride = true;
        }
    }

    const penaltyKey = `${cleanName}_${dateFormatted}`;
    const penaltyRecord = globalState.globalCommissionPenalties ? globalState.globalCommissionPenalties[penaltyKey] : null;
    let penaltyPerc = 0;

    if (penaltyRecord && penaltyRecord.penaltyPercentage) {
        penaltyPerc = Math.max(0, parseFloat(penaltyRecord.penaltyPercentage) || 0);
    }

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
        penaltyReason: penaltyRecord ? penaltyRecord.reason : "",
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
    }
}