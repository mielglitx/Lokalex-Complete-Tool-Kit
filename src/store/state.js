// src/store/state.js
export const appState = {
    telegramId: localStorage.getItem('telegramId') || "",
    riderName: localStorage.getItem('riderName') || "",
    userType: localStorage.getItem('userType') || "",
    photoUrl: localStorage.getItem('lokalex_photo_url') || localStorage.getItem('riderPhotoUrl') || "",
    phoneNumber: localStorage.getItem('lokalex_rider_phone') || "",
    gcashNo: localStorage.getItem('lokalex_gcash_no') || "",
    gcashName: localStorage.getItem('lokalex_gcash_name') || "",
    themePreference: localStorage.getItem('lokalex_theme_preference') || "system",
    lat: 0, 
    lon: 0,
    gpsAccuracy: 0,
    customerFacebookId: localStorage.getItem('lokalex_customer_fb_id') || "",
    customerName: localStorage.getItem('lokalex_customer_name') || ""
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
    teamCommsMessages: [],
    teamCommsActiveChannel: {
        type: 'general', // 'general' | 'dm' | 'group'
        id: 'general',
        name: 'General Chat'
    },
    teamCommsGroups: {},
    teamCommsDMs: {},
    globalAdvancedOrders: [],
    globalMapCalculations: [],
    globalRiderRates: {},
    globalDailyReceipts: [],
    globalCommissionPenalties: {},
    adminControlsEnabled: false,
    records: [],
    currentType: 'customers',
    cartLocked: [false, false, false, false],
    cartTxIds: ["", "", "", ""],
    riderDayOffs: {},
    timeInSchedule: {},
    bookingLimits: {},
    blockedUsers: {},
    customerChats: {},
    userTypesMap: {},
    activeChatFilter: 'inbox'
};