// src/features/storeHub/storeMenu.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';

export const RESERVED_ADDONS_CATEGORY = 'Add-ons & Extras';

export function isAddonCategoryName(catName) {
    if (!catName) return false;
    const clean = catName.trim().toLowerCase();
    return clean === RESERVED_ADDONS_CATEGORY.toLowerCase() || clean.includes('addon') || clean.includes('add-on') || clean.includes('extra');
}

export async function fetchStoreMenuData(storeId) {
    if (!db || !storeId) return null;
    const snap = await db.ref(`storeMenus/${storeId}`).once('value');
    return snap.val() || { categories: {}, items: {} };
}

export async function saveStoreCategory(storeId, categoryName, categoryId = null, oldCategoryName = null, isAddonCategory = false, isRequired = false, isSingleChoice = false) {
    if (!db || !storeId || !categoryName) return null;

    const trimmedName = categoryName.trim();
    const validCatId = (categoryId && categoryId !== 'undefined' && categoryId !== 'null' && categoryId !== 'CAT_RESERVED_ADDONS') ? categoryId : null;
    const cleanCatId = validCatId || ('CAT_' + trimmedName.toUpperCase().replace(/[^A-Z0-9]/g, '') + '_' + Date.now().toString(36).slice(-3).toUpperCase());

    const isAddon = !!isAddonCategory || trimmedName.toLowerCase() === RESERVED_ADDONS_CATEGORY.toLowerCase();

    let orderIndex = Date.now();
    try {
        if (validCatId) {
            const existingSnap = await db.ref(`storeMenus/${storeId}/categories/${cleanCatId}/orderIndex`).once('value');
            if (existingSnap.exists() && existingSnap.val() !== null) {
                orderIndex = existingSnap.val();
            }
        } else {
            const catsSnap = await db.ref(`storeMenus/${storeId}/categories`).once('value');
            const currentCats = catsSnap.val() || {};
            orderIndex = Object.keys(currentCats).length;
        }
    } catch (e) {}

    const payload = {
        id: cleanCatId,
        name: trimmedName,
        isAddonCategory: isAddon,
        isRequired: isAddon ? !!isRequired : false,
        isSingleChoice: isAddon ? !!isSingleChoice : false,
        orderIndex,
        updatedAt: Date.now()
    };

    if (!validCatId) {
        payload.createdAt = Date.now();
    }

    await db.ref(`storeMenus/${storeId}/categories/${cleanCatId}`).set(payload);

    if (validCatId && oldCategoryName && oldCategoryName.trim().toLowerCase() !== trimmedName.toLowerCase()) {
        try {
            const itemsSnap = await db.ref(`storeMenus/${storeId}/items`).once('value');
            const items = itemsSnap.val() || {};
            const cleanOld = oldCategoryName.trim().toLowerCase();
            const itemUpdates = {};

            Object.entries(items).forEach(([itemId, item]) => {
                if (item && item.category && item.category.trim().toLowerCase() === cleanOld) {
                    itemUpdates[`${itemId}/category`] = trimmedName;
                }
            });

            if (Object.keys(itemUpdates).length > 0) {
                await db.ref(`storeMenus/${storeId}/items`).update(itemUpdates);
            }
        } catch (e) {
            console.warn("Category cascade note:", e);
        }
    }

    showToast(validCatId ? `✅ Category updated to [${trimmedName}]!` : `✅ Category [${trimmedName}] added!`);
    return cleanCatId;
}

export async function deleteStoreCategory(storeId, categoryId, categoryName) {
    if (!db || !storeId || !categoryId) return false;

    try {
        const catSnap = await db.ref(`storeMenus/${storeId}/categories`).once('value');
        const categories = catSnap.val() || {};
        const catList = Object.entries(categories).map(([k, v]) => ({ id: v?.id || k, ...(v || {}) }));

        const currentCat = categories[categoryId] || catList.find(c => c.id === categoryId || c.name === categoryName);
        const isTargetAddon = currentCat?.isAddonCategory || (categoryName && isAddonCategoryName(categoryName));

        if (isTargetAddon) {
            const totalAddonCats = catList.filter(c => c.isAddonCategory || isAddonCategoryName(c.name));
            if (totalAddonCats.length <= 1) {
                showToast("⚠️ Hindi maaaring burahin: Dapat mayroong kahit isang Add-ons & Extras category na natitira.");
                return false;
            }
        }
    } catch (e) {
        console.warn("Addon category check note:", e);
    }

    await db.ref(`storeMenus/${storeId}/categories/${categoryId}`).remove();

    if (categoryName) {
        try {
            const itemsSnap = await db.ref(`storeMenus/${storeId}/items`).once('value');
            const items = itemsSnap.val() || {};
            const cleanTarget = categoryName.trim().toLowerCase();
            const itemUpdates = {};

            Object.entries(items).forEach(([itemId, item]) => {
                if (item && item.category && item.category.trim().toLowerCase() === cleanTarget) {
                    itemUpdates[`${itemId}/category`] = 'General';
                }
            });

            if (Object.keys(itemUpdates).length > 0) {
                await db.ref(`storeMenus/${storeId}/items`).update(itemUpdates);
            }
        } catch (e) {
            console.warn("Category delete cascade note:", e);
        }
    }

    showToast(`🗑️ Category [${categoryName}] deleted.`);
    return true;
}

export async function saveCategoryOrder(storeId, orderedCategoryIds = []) {
    if (!db || !storeId || !Array.isArray(orderedCategoryIds)) return;

    // Use robust, scoped individual updates to guarantee success
    const updatePromises = orderedCategoryIds.map((catId, idx) => {
        if (!catId || catId === 'CAT_RESERVED_ADDONS') return Promise.resolve();
        return db.ref(`storeMenus/${storeId}/categories/${catId}`).update({
            orderIndex: idx
        });
    });

    await Promise.all(updatePromises);
    showToast("✅ Category arrangement saved!");
    showSideNotification("MENU ORDER", "Category order updated", "fa-arrow-down-short-wide", "text-blue-400", "border-blue-500");
}

export async function saveCategorySortMode(storeId, sortMode) {
    if (!db || !storeId) return;
    await db.ref(`storeMenus/${storeId}/categorySortMode`).set(sortMode);
}

export async function saveMenuItem(storeId, itemData) {
    if (!db || !storeId || !itemData) return;

    const itemId = itemData.id || `ITEM_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(-4).toUpperCase()}`;
    const payload = {
        ...itemData,
        id: itemId,
        updatedAt: Date.now()
    };

    if (!itemData.id) {
        payload.createdAt = Date.now();
    }

    await db.ref(`storeMenus/${storeId}/items/${itemId}`).set(payload);
    showToast(`✅ Item [${itemData.name}] saved successfully!`);
    showSideNotification("STORE MENU", `Saved: ${itemData.name}`, "fa-utensils", "text-emerald-400", "border-emerald-500");
}

export async function deleteMenuItem(storeId, itemId, itemName) {
    if (!db || !storeId || !itemId) return;
    await db.ref(`storeMenus/${storeId}/items/${itemId}`).remove();
    showToast(`🗑️ Item [${itemName}] removed from menu.`);
}

export async function toggleItemStockStatus(storeId, itemId, currentAvailable) {
    if (!db || !storeId || !itemId) return;
    const newStatus = !currentAvailable;
    await db.ref(`storeMenus/${storeId}/items/${itemId}`).update({
        isAvailable: newStatus
    });
    showToast(newStatus ? "🟢 Item marked IN STOCK" : "🔴 Item marked SOLD OUT");
}

export async function toggleSizeStockStatus(storeId, itemId, sizeIdx, currentStatus) {
    if (!db || !storeId || !itemId) return;
    const newStatus = !currentStatus;
    await db.ref(`storeMenus/${storeId}/items/${itemId}/sizes/${sizeIdx}`).update({
        isAvailable: newStatus
    });
    showToast(newStatus ? "🟢 Size marked IN STOCK" : "🔴 Size marked SOLD OUT");
}

export async function toggleAddonStockStatus(storeId, itemId, addonIdx, currentStatus) {
    if (!db || !storeId || !itemId) return;
    const newStatus = !currentStatus;
    await db.ref(`storeMenus/${storeId}/items/${itemId}/addons/${addonIdx}`).update({
        isAvailable: newStatus
    });
    showToast(newStatus ? "🟢 Extra marked IN STOCK" : "🔴 Extra marked SOLD OUT");
}

export async function updateStoreOpenStatus(storeId, isOpen) {
    if (!db || !storeId) return;
    await db.ref(`stores/${storeId}`).update({ isOpen });
    showToast(isOpen ? "🟢 Store is now OPEN for orders" : "🔴 Store is now CLOSED");
}

export async function updateStoreProfile(storeId, { storeName, address, commissionRate }) {
    if (!db || !storeId) return;

    const updates = {};

    if (storeName) {
        updates[`stores/${storeId}/storeName`] = storeName;

        const accountId = appState.merchantAccountId || localStorage.getItem('lokalex_merchant_account_id');
        if (accountId) {
            updates[`storeAccounts/${accountId}/storeName`] = storeName;
        }

        const dirCleanKey = storeName.toLowerCase().replace(/[^a-z0-9]/g, '');
        updates[`directory/stores/${dirCleanKey}/name`] = storeName;

        appState.merchantStoreName = storeName;
        localStorage.setItem('lokalex_merchant_store_name', storeName);
    }

    if (address !== undefined) {
        updates[`stores/${storeId}/address`] = address;
        const dirName = storeName || appState.merchantStoreName || "store";
        const dirCleanKey = dirName.toLowerCase().replace(/[^a-z0-9]/g, '');
        updates[`directory/stores/${dirCleanKey}/address`] = address;
        updates[`directory/stores/${dirCleanKey}/rate`] = address;
    }

    if (commissionRate !== undefined && commissionRate !== null && commissionRate !== '' && !isNaN(parseFloat(commissionRate))) {
        updates[`stores/${storeId}/commissionRate`] = parseFloat(commissionRate);
    }

    await db.ref().update(updates);

    showToast("✅ Store details updated!");
    showSideNotification("STORE UPDATED", storeName || appState.merchantStoreName || "Store", "fa-store", "text-orange-400", "border-orange-500");
}

export async function updateStoreLogo(storeId, logoUrl) {
    if (!db || !storeId) return;

    await db.ref(`stores/${storeId}`).update({
        logoUrl: logoUrl || ""
    });

    showToast(logoUrl ? "✅ Store Logo updated!" : "🗑️ Store Logo removed.");
    showSideNotification("STORE LOGO", "Logo image updated", "fa-image", "text-blue-400", "border-blue-500");
}