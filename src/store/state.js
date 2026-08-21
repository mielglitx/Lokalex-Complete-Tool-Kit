// src/store/state.js
export const appState = {
    telegramId: localStorage.getItem('telegramId') || "",
    riderName: localStorage.getItem('riderName') || "",
    userType: localStorage.getItem('userType') || "",
    gcashNo: localStorage.getItem('lokalex_gcash_no') || "",
    gcashName: localStorage.getItem('lokalex_gcash_name') || "",
    themePreference: localStorage.getItem('lokalex_theme_preference') || "system",
    lat: 0, lon: 0
};

// Starts with 1 Cart by default
export const multiCarts = {
    1: { items: [], selectedIds: new Set(), customerName: "", isManual: false, txId: "" }
};

export let activeCartSlot = 1;
export function setActiveCartSlot(slot) { activeCartSlot = Number(slot); }

export const wizState = { storeCount: 1 };
export const globalState = {
    rosterMembers: [],
    globalCateredHistory: [],
    globalLogins: [],
    chatMessages: [],
    globalAdvancedOrders: [],
    globalMapCalculations: [],
    globalRiderRates: {},
    globalDailyReceipts: [],
    adminControlsEnabled: false,
    records: [],
    currentType: 'customers',
    cartLocked: [false, false, false, false],
    cartTxIds: ["", "", "", ""]
};