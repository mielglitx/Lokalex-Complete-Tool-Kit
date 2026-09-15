// src/features/customer/stores/customerStoreHours.js
import { db } from '../../../config/firebase.js';

export let storesCache = {};
export let menusCache = {};
export let activeViewingStoreId = null;
export let activeViewingCategoryId = null;
export let activeCustomizingItem = null;
export let customizerQty = 1;
export let isPreviewMode = false;

export function setActiveViewingStoreId(val) {
    activeViewingStoreId = val;
}

export function setActiveViewingCategoryId(val) {
    activeViewingCategoryId = val;
}

export function setActiveCustomizingItem(val) {
    activeCustomizingItem = val;
}

export function setCustomizerQty(val) {
    customizerQty = val;
}

export function setCustomerStorePreviewMode(val) {
    isPreviewMode = !!val;
}

try {
    const cachedStores = localStorage.getItem('lokalex_cached_stores_v1');
    if (cachedStores) storesCache = JSON.parse(cachedStores);
    const cachedMenus = localStorage.getItem('lokalex_cached_menus_v1');
    if (cachedMenus) menusCache = JSON.parse(cachedMenus);
} catch(e) {}

export function setStoresCache(data) {
    storesCache = data || {};
}

export function setMenusCache(data) {
    menusCache = data || {};
}

export function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const clean = String(timeStr).trim();
    const match = clean.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3] ? match[3].toUpperCase() : null;

    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    return hours * 60 + minutes;
}

export function isStoreCurrentlyOpen(store, storeId = null) {
    if (!store) return false;

    const hours = store.operatingHours;
    if (hours && hours.enabled && hours.openTime && hours.closeTime) {
        const openMins = parseTimeToMinutes(hours.openTime);
        const closeMins = parseTimeToMinutes(hours.closeTime);

        if (openMins !== null && closeMins !== null) {
            const now = new Date();
            const currentMins = now.getHours() * 60 + now.getMinutes();

            let shouldBeOpen = false;
            if (openMins <= closeMins) {
                shouldBeOpen = currentMins >= openMins && currentMins < closeMins;
            } else {
                shouldBeOpen = currentMins >= openMins || currentMins < closeMins;
            }

            if (storeId && db && store.isOpen !== shouldBeOpen) {
                store.isOpen = shouldBeOpen;
                db.ref(`stores/${storeId}`).update({ isOpen: shouldBeOpen }).catch(() => {});
            }

            return shouldBeOpen;
        }
    }

    return store.isOpen !== false;
}