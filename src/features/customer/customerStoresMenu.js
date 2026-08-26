// src/features/customer/customerStoresMenu.js
import { escapeHtml } from '../../utils/helpers.js';
import { showToast } from '../../ui/notifications.js';
import { cleanFirebasePathKey } from './customerProfile.js';
import { 
    getCustomerCart, 
    saveCustomerCart, 
    updateFloatingCartBadge, 
    areItemsMatching 
} from './customerOrders.js';

export let storesCache = {};
export let menusCache = {};
export let activeViewingStoreId = null;
export let activeViewingCategoryId = 'ALL';
export let activeCustomizingItem = null;
export let customizerQty = 1;

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

export function openCustomerStoresModal() {
    const modal = document.getElementById('cust-stores-popup-modal');
    const searchInput = document.getElementById('cust-store-search-input');
    if (searchInput) searchInput.value = '';

    if (modal) {
        modal.classList.remove('hidden');
    }

    renderStoresGrid('');
    updateFloatingCartBadge();
}

export function closeCustomerStoresModal() {
    const modal = document.getElementById('cust-stores-popup-modal');
    if (modal) modal.classList.add('hidden');
}

export function renderStoresGrid(searchQuery = '') {
    const grid = document.getElementById('cust-stores-grid');
    if (!grid) return;

    let storeEntries = Object.entries(storesCache || {});

    if (storeEntries.length === 0) {
        try {
            const localCached = localStorage.getItem('lokalex_cached_stores_v1');
            if (localCached) {
                storesCache = JSON.parse(localCached);
                storeEntries = Object.entries(storesCache || {});
            }
        } catch(e) {}
    }

    if (storeEntries.length === 0) {
        grid.innerHTML = `
            <div class="text-center text-gray-500 dark:text-gray-400 italic py-6 text-xs bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-800 rounded-xl p-3 flex flex-col items-center gap-1">
                <i class="fa-solid fa-store-slash text-base text-gray-400 dark:text-gray-600"></i>
                <span>No registered local stores available.</span>
            </div>`;
        return;
    }

    const query = (searchQuery || '').trim().toLowerCase();

    const filtered = storeEntries.filter(([id, store]) => {
        if (!store) return false;
        if (!query) return true;
        const nameMatch = (store.storeName || store.name || '').toLowerCase().includes(query);
        const addrMatch = (store.address || store.rate || '').toLowerCase().includes(query);

        const storeMenu = menusCache[id]?.items || {};
        const itemMatch = Object.values(storeMenu).some(i => (i.name || '').toLowerCase().includes(query));

        return nameMatch || addrMatch || itemMatch;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="text-center text-gray-500 dark:text-gray-400 italic py-4 text-xs bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-800 rounded-xl p-2.5">
                No stores match "${escapeHtml(searchQuery)}".
            </div>`;
        return;
    }

    grid.innerHTML = filtered.map(([storeId, store]) => {
        const isOpen = store.isOpen !== false;
        const storeName = store.storeName || store.name || 'Store';
        const address = store.address || store.rate || 'Poblacion';
        const menuItems = Object.values(menusCache[storeId]?.items || {});
        const logoUrl = store.logoUrl || '';

        return `
        <button type="button" onclick="window.openCustomerStoreMenu('${storeId}')" class="w-full bg-gray-50 dark:bg-black/40 hover:bg-orange-50 dark:hover:bg-orange-950/20 border border-gray-200 dark:border-gray-800 hover:border-orange-500/50 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-2 transition active:scale-[0.99] text-left group shadow-xs">
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <div class="w-6 h-6 rounded-lg bg-orange-500/10 border border-orange-500/30 overflow-hidden flex items-center justify-center text-orange-500 dark:text-orange-400 text-[10px] shrink-0">
                    ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" class="w-full h-full object-cover">` : `<i class="fa-solid fa-shop"></i>`}
                </div>
                <div class="min-w-0 flex-1 flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'} shrink-0"></span>
                    <span class="font-bold text-xs text-gray-900 dark:text-white truncate group-hover:text-orange-600 dark:group-hover:text-orange-400 transition">${escapeHtml(storeName)}</span>
                    <span class="text-[9px] text-gray-400 dark:text-gray-500 truncate hidden sm:inline">• ${escapeHtml(address)}</span>
                </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                <span class="text-[9px] font-bold ${isOpen ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' : 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10'} px-1.5 py-0.5 rounded-md border border-gray-200 dark:border-gray-800">
                    ${isOpen ? 'Open' : 'Closed'}
                </span>
                <span class="text-[9px] text-gray-500 dark:text-gray-400 font-mono font-bold bg-white dark:bg-black/50 border border-gray-200 dark:border-gray-800 px-1.5 py-0.5 rounded-md">
                    ${menuItems.length}
                </span>
                <i class="fa-solid fa-chevron-right text-[8px] text-gray-400 group-hover:text-orange-400 transition"></i>
            </div>
        </button>`;
    }).join('');
}

export function filterCustomerStores(query) {
    renderStoresGrid(query);
}

export function openCustomerStoreMenu(storeId) {
    activeViewingStoreId = storeId;
    activeViewingCategoryId = 'ALL';

    const store = storesCache[storeId] || { storeName: "Store Menu", address: "", isOpen: true };
    const modal = document.getElementById('cust-store-menu-modal');
    const nameEl = document.getElementById('cust-menu-store-name');
    const addrEl = document.getElementById('cust-menu-store-address');
    const statusBadge = document.getElementById('cust-menu-store-status-badge');
    const imgEl = document.getElementById('cust-menu-store-img');
    const iconEl = document.getElementById('cust-menu-store-icon');

    if (nameEl) nameEl.innerText = store.storeName || store.name || "Store";
    if (addrEl) addrEl.innerHTML = `<i class="fa-solid fa-location-dot text-red-500 text-[9px]"></i> <span>${escapeHtml(store.address || store.rate || 'Poblacion')}</span>`;
    
    if (imgEl && iconEl) {
        if (store.logoUrl) {
            imgEl.src = store.logoUrl;
            imgEl.classList.remove('hidden');
            iconEl.classList.add('hidden');
        } else {
            imgEl.classList.add('hidden');
            iconEl.classList.remove('hidden');
        }
    }

    const isOpen = store.isOpen !== false;
    if (statusBadge) {
        statusBadge.className = `mt-1 inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border ${isOpen ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' : 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30'}`;
        statusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}"></span> ${isOpen ? 'OPEN FOR ORDERS' : 'STORE CLOSED'}`;
    }

    renderStoreMenuItems(storeId);
    updateFloatingCartBadge();

    if (modal) modal.classList.remove('hidden');
}

export function closeCustomerStoreMenuModal() {
    const modal = document.getElementById('cust-store-menu-modal');
    if (modal) modal.classList.add('hidden');
    activeViewingStoreId = null;
}

export function renderStoreMenuItems(storeId) {
    const pillsContainer = document.getElementById('cust-menu-category-pills');
    const feed = document.getElementById('cust-menu-items-feed');
    if (!feed) return;

    const storeMenu = menusCache[storeId] || { categories: {}, items: {} };
    const categories = Object.values(storeMenu.categories || {});
    let items = Object.values(storeMenu.items || {});

    if (pillsContainer) {
        let pillsHtml = `
            <button onclick="window.selectCustomerMenuCategory('ALL')" class="${activeViewingCategoryId === 'ALL' ? 'bg-orange-600 text-white' : 'bg-cardBg border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-400'} text-xs font-bold px-3 py-1.5 rounded-xl shrink-0 transition">
                All Items
            </button>`;
        categories.forEach(cat => {
            const isSel = activeViewingCategoryId === cat.name;
            pillsHtml += `
                <button onclick="window.selectCustomerMenuCategory('${escapeHtml(cat.name)}')" class="${isSel ? 'bg-orange-600 text-white' : 'bg-cardBg border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-400'} text-xs font-bold px-3 py-1.5 rounded-xl shrink-0 transition">
                    ${escapeHtml(cat.name)}
                </button>`;
        });
        pillsContainer.innerHTML = pillsHtml;
    }

    if (activeViewingCategoryId !== 'ALL') {
        items = items.filter(it => it.category === activeViewingCategoryId);
    }

    if (items.length === 0) {
        feed.innerHTML = `<div class="text-center text-gray-500 dark:text-gray-400 italic py-10 text-xs">Walang paninda sa kategoryang ito.</div>`;
        return;
    }

    const store = storesCache[storeId] || {};
    const isStoreOpen = store.isOpen !== false;

    feed.innerHTML = items.map(item => {
        const isAvail = item.isAvailable !== false && isStoreOpen;
        const basePrice = parseFloat(item.basePrice || 0);

        return `
        <div class="bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-800/80 rounded-2xl p-2.5 flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-xs text-gray-900 dark:text-white">${escapeHtml(item.name)}</span>
                    <span class="text-xs font-mono font-black text-emerald-600 dark:text-emerald-400">₱${basePrice.toFixed(2)}</span>
                </div>
                ${item.description ? `<p class="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">${escapeHtml(item.description)}</p>` : ''}
            </div>

            <button ${!isAvail ? 'disabled' : ''} onclick="window.openItemCustomizerModal('${storeId}', '${item.id}')" class="shrink-0 ${isAvail ? 'bg-orange-600 hover:bg-orange-500 text-white active:scale-95' : 'bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'} text-xs font-bold px-2.5 py-1.5 rounded-xl transition flex items-center gap-1 shadow-xs">
                <i class="fa-solid fa-plus"></i> ${isAvail ? 'Add' : 'Sold Out'}
            </button>
        </div>`;
    }).join('');
}

export function selectCustomerMenuCategory(catName) {
    activeViewingCategoryId = catName;
    if (activeViewingStoreId) {
        renderStoreMenuItems(activeViewingStoreId);
    }
}

// -------------------------------------------------------------
// ITEM CUSTOMIZER MODAL
// -------------------------------------------------------------
export function openItemCustomizerModal(storeId, itemId) {
    const item = menusCache[storeId]?.items?.[itemId];
    if (!item) return;

    activeCustomizingItem = { ...item, storeId };
    customizerQty = 1;

    document.getElementById('customizer-store-id').value = storeId;
    document.getElementById('customizer-item-id').value = itemId;
    document.getElementById('customizer-item-name').innerText = item.name;
    document.getElementById('customizer-item-desc').innerText = item.description || '';
    document.getElementById('customizer-item-base-price').innerText = parseFloat(item.basePrice || 0).toFixed(2);
    document.getElementById('customizer-item-notes').value = '';
    document.getElementById('customizer-qty-display').innerText = '1';

    const sizesWrapper = document.getElementById('customizer-sizes-wrapper');
    const sizesOptions = document.getElementById('customizer-sizes-options');
    const sizes = (item.sizes || []).filter(s => s.isAvailable !== false);

    if (sizes.length > 0) {
        sizesWrapper.classList.remove('hidden');
        sizesOptions.innerHTML = sizes.map((s, idx) => `
            <label class="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 cursor-pointer hover:border-blue-500/50">
                <div class="flex items-center gap-2">
                    <input type="radio" name="customizer_size_choice" value="${idx}" ${idx === 0 ? 'checked' : ''} onchange="window.recalculateCustomizerPrice()" class="accent-blue-500">
                    <span class="text-xs font-bold text-gray-900 dark:text-white">${escapeHtml(s.name)}</span>
                </div>
                <span class="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">+₱${parseFloat(s.priceDelta || 0).toFixed(2)}</span>
            </label>
        `).join('');
    } else {
        sizesWrapper.classList.add('hidden');
        sizesOptions.innerHTML = '';
    }

    const addonsWrapper = document.getElementById('customizer-addons-wrapper');
    const addonsOptions = document.getElementById('customizer-addons-options');
    const addons = (item.addons || []).filter(a => a.isAvailable !== false);

    if (addons.length > 0) {
        addonsWrapper.classList.remove('hidden');
        addonsOptions.innerHTML = addons.map((a, idx) => `
            <label class="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 cursor-pointer hover:border-amber-500/50">
                <div class="flex items-center gap-2">
                    <input type="checkbox" name="customizer_addon_choice" value="${idx}" onchange="window.recalculateCustomizerPrice()" class="accent-amber-500 rounded">
                    <span class="text-xs font-bold text-gray-900 dark:text-white">${escapeHtml(a.name)}</span>
                </div>
                <span class="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">+₱${parseFloat(a.priceDelta || 0).toFixed(2)}</span>
            </label>
        `).join('');
    } else {
        addonsWrapper.classList.add('hidden');
        addonsOptions.innerHTML = '';
    }

    recalculateCustomizerPrice();

    const modal = document.getElementById('cust-item-customizer-modal');
    if (modal) modal.classList.remove('hidden');
}

export function closeItemCustomizerModal() {
    const modal = document.getElementById('cust-item-customizer-modal');
    if (modal) modal.classList.add('hidden');
    activeCustomizingItem = null;
}

export function adjustCustomizerQty(delta) {
    customizerQty = Math.max(1, customizerQty + delta);
    document.getElementById('customizer-qty-display').innerText = customizerQty.toString();
    recalculateCustomizerPrice();
}

export function recalculateCustomizerPrice() {
    if (!activeCustomizingItem) return;

    let unitPrice = parseFloat(activeCustomizingItem.basePrice || 0);

    const selectedSizeRadio = document.querySelector('input[name="customizer_size_choice"]:checked');
    if (selectedSizeRadio) {
        const sizeIdx = parseInt(selectedSizeRadio.value);
        const sizeObj = activeCustomizingItem.sizes?.[sizeIdx];
        if (sizeObj) unitPrice += parseFloat(sizeObj.priceDelta || 0);
    }

    document.querySelectorAll('input[name="customizer_addon_choice"]:checked').forEach(cb => {
        const addonIdx = parseInt(cb.value);
        const addonObj = activeCustomizingItem.addons?.[addonIdx];
        if (addonObj) unitPrice += parseFloat(addonObj.priceDelta || 0);
    });

    const total = unitPrice * customizerQty;
    const calcTotalEl = document.getElementById('customizer-calc-total');
    if (calcTotalEl) calcTotalEl.innerText = total.toFixed(2);
}

export function submitAddCustomizedItemToCart() {
    if (!activeCustomizingItem) return;

    const rawStoreId = activeCustomizingItem.storeId;
    const storeId = cleanFirebasePathKey(rawStoreId);
    const store = storesCache[rawStoreId] || storesCache[storeId] || { storeName: "Store", address: "Poblacion" };
    let unitPrice = parseFloat(activeCustomizingItem.basePrice || 0);

    let chosenSize = null;
    const selectedSizeRadio = document.querySelector('input[name="customizer_size_choice"]:checked');
    if (selectedSizeRadio) {
        const sizeIdx = parseInt(selectedSizeRadio.value);
        chosenSize = activeCustomizingItem.sizes?.[sizeIdx] || null;
        if (chosenSize) unitPrice += parseFloat(chosenSize.priceDelta || 0);
    }

    const chosenAddons = [];
    document.querySelectorAll('input[name="customizer_addon_choice"]:checked').forEach(cb => {
        const addonIdx = parseInt(cb.value);
        const addonObj = activeCustomizingItem.addons?.[addonIdx];
        if (addonObj) {
            chosenAddons.push({
                name: addonObj.name || "Addon",
                priceDelta: parseFloat(addonObj.priceDelta || 0)
            });
            unitPrice += parseFloat(addonObj.priceDelta || 0);
        }
    });

    const instructions = document.getElementById('customizer-item-notes')?.value.trim() || '';
    const addQty = parseInt(customizerQty) || 1;
    const targetItemId = activeCustomizingItem.id || `ITEM_${Date.now()}`;

    let cart = getCustomerCart();
    if (!cart[storeId]) {
        cart[storeId] = {
            storeId,
            storeName: store.storeName || store.name || "Store",
            storeAddress: store.address || store.rate || "Poblacion",
            items: []
        };
    }

    const newItemPayload = {
        itemId: targetItemId,
        name: activeCustomizingItem.name || "Menu Item",
        size: chosenSize ? { name: chosenSize.name, priceDelta: parseFloat(chosenSize.priceDelta || 0) } : null,
        addons: chosenAddons,
        instructions: instructions || "",
        unitPrice: parseFloat(unitPrice) || 0,
        quantity: addQty,
        totalPrice: (parseFloat(unitPrice) || 0) * addQty
    };

    const existingIndex = (cart[storeId].items || []).findIndex(it => areItemsMatching(it, newItemPayload));

    if (existingIndex !== -1) {
        const existing = cart[storeId].items[existingIndex];
        existing.quantity = (parseInt(existing.quantity) || 0) + addQty;
        existing.totalPrice = (parseFloat(existing.unitPrice) || 0) * existing.quantity;
    } else {
        const cartItemId = `CITEM_${Date.now().toString(36)}_${Math.random().toString(36).slice(-3)}`;
        cart[storeId].items.push({
            cartItemId,
            ...newItemPayload
        });
    }

    saveCustomerCart(cart);
    closeItemCustomizerModal();
    updateFloatingCartBadge();
    showToast(`🛒 Added ${activeCustomizingItem.name} (${addQty}x) to cart!`);
}