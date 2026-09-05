// src/features/storeHub/storeMenu.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';

export async function fetchStoreMenuData(storeId) {
    if (!db || !storeId) return null;
    const snap = await db.ref(`storeMenus/${storeId}`).once('value');
    return snap.val() || { categories: {}, items: {} };
}

export async function saveStoreCategory(storeId, categoryName) {
    if (!db || !storeId || !categoryName) return;

    const cleanCatId = 'CAT_' + categoryName.toUpperCase().replace(/[^A-Z0-9]/g, '') + '_' + Date.now().toString(36).slice(-3).toUpperCase();
    const payload = {
        id: cleanCatId,
        name: categoryName.trim(),
        createdAt: Date.now()
    };

    await db.ref(`storeMenus/${storeId}/categories/${cleanCatId}`).set(payload);
    showToast(`✅ Category [${categoryName}] added!`);
}

export async function deleteStoreCategory(storeId, categoryId, categoryName) {
    if (!db || !storeId || !categoryId) return;
    await db.ref(`storeMenus/${storeId}/categories/${categoryId}`).remove();
    showToast(`🗑️ Category [${categoryName}] deleted.`);
}

export async function saveMenuItem(storeId, itemData) {
    if (!db || !storeId || !itemData) return;

    const itemId = itemData.id || `ITEM_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(-4).toUpperCase()}`;
    const payload = {
        ...itemData,
        id: itemId,
        updatedAt: Date.now()
    };

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

// GRANULAR 86 CONTROLS FOR SIZES AND ADD-ONS
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