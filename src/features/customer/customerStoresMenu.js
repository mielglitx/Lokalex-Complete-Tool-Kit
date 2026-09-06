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
export let activeViewingCategoryId = null;
export let activeCustomizingItem = null;
export let customizerQty = 1;
export let isPreviewMode = false;

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

export function openCustomerStoresModal() {
    isPreviewMode = false;
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

        const standaloneItems = Object.values(menusCache[storeId]?.items || {}).filter(it => it && !it.isAddonOnly);
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
                    ${standaloneItems.length}
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
    activeViewingCategoryId = null;

    const store = storesCache[storeId] || { storeName: "Store Menu", address: "", isOpen: true };
    const modal = document.getElementById('cust-store-menu-modal');
    const nameEl = document.getElementById('cust-menu-store-name');
    const addrEl = document.getElementById('cust-menu-store-address');
    const statusBadge = document.getElementById('cust-menu-store-status-badge');
    const imgEl = document.getElementById('cust-menu-store-img');
    const iconEl = document.getElementById('cust-menu-store-icon');

    if (modal && modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    const customizerModal = document.getElementById('cust-item-customizer-modal');
    if (customizerModal && customizerModal.parentElement !== document.body) {
        document.body.appendChild(customizerModal);
    }

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

    if (modal) {
        modal.classList.remove('hidden');
    }
}

export function closeCustomerStoreMenuModal() {
    setCustomerStorePreviewMode(false);
    const modal = document.getElementById('cust-store-menu-modal');
    if (modal) modal.classList.add('hidden');
    activeViewingStoreId = null;
    activeViewingCategoryId = null;
}

export function renderStoreMenuItems(storeId) {
    const pillsContainer = document.getElementById('cust-menu-category-pills');
    const feed = document.getElementById('cust-menu-items-feed');
    if (!feed) return;

    const storeMenu = menusCache[storeId] || { categories: {}, items: {} };
    const categories = Object.values(storeMenu.categories || {});
    const rawItems = Object.values(storeMenu.items || {});

    const standaloneItems = rawItems.filter(it => it && !it.isAddonOnly);

    const displayCategories = [];
    const addedCatNames = new Set();

    categories.forEach(cat => {
        if (!cat || !cat.name) return;
        const cName = cat.name.trim();
        const hasVisibleItems = standaloneItems.some(
            it => (it.category || '').trim().toLowerCase() === cName.toLowerCase()
        );
        if (hasVisibleItems && !addedCatNames.has(cName.toLowerCase())) {
            displayCategories.push(cat);
            addedCatNames.add(cName.toLowerCase());
        }
    });

    standaloneItems.forEach(it => {
        const cName = (it.category || 'General').trim();
        if (!addedCatNames.has(cName.toLowerCase())) {
            displayCategories.push({ name: cName, orderIndex: 9999, createdAt: 0 });
            addedCatNames.add(cName.toLowerCase());
        }
    });

    displayCategories.sort((a, b) => {
        const idxA = a.orderIndex !== undefined && a.orderIndex !== null ? a.orderIndex : 9999;
        const idxB = b.orderIndex !== undefined && b.orderIndex !== null ? b.orderIndex : 9999;
        if (idxA !== idxB) return idxA - idxB;
        return (a.createdAt || 0) - (b.createdAt || 0);
    });

    if (displayCategories.length > 0) {
        const currentCatValid = displayCategories.some(
            c => c.name.trim().toLowerCase() === (activeViewingCategoryId || '').trim().toLowerCase()
        );
        if (!currentCatValid || !activeViewingCategoryId || activeViewingCategoryId === 'ALL') {
            activeViewingCategoryId = displayCategories[0].name;
        }
    } else {
        activeViewingCategoryId = null;
    }

    if (pillsContainer) {
        if (displayCategories.length > 0) {
            pillsContainer.classList.remove('hidden');
            let pillsHtml = '';
            displayCategories.forEach(cat => {
                const isSel = (activeViewingCategoryId || '').trim().toLowerCase() === cat.name.trim().toLowerCase();
                pillsHtml += `
                    <button onclick="window.selectCustomerMenuCategory('${escapeHtml(cat.name)}')" class="${isSel ? 'bg-orange-600 text-white font-black shadow-xs' : 'bg-cardBg border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-400 font-bold'} text-xs px-3 py-1.5 rounded-xl shrink-0 transition">
                        ${escapeHtml(cat.name)}
                    </button>`;
            });
            pillsContainer.innerHTML = pillsHtml;
        } else {
            pillsContainer.classList.add('hidden');
            pillsContainer.innerHTML = '';
        }
    }

    let items = [];
    if (activeViewingCategoryId) {
        items = standaloneItems.filter(
            it => (it.category || '').trim().toLowerCase() === activeViewingCategoryId.trim().toLowerCase()
        );
    }

    if (items.length === 0) {
        feed.innerHTML = `<div class="text-center text-gray-500 dark:text-gray-400 italic py-10 text-xs">Walang paninda sa kategoryang ito.</div>`;
        return;
    }

    const store = storesCache[storeId] || {};
    const isStoreOpen = store.isOpen !== false;

    feed.innerHTML = items.map(item => {
        const isAvail = item.isAvailable !== false && isStoreOpen;
        
        const rawSizes = item.sizes;
        const sizesList = Array.isArray(rawSizes) 
            ? rawSizes 
            : (rawSizes && typeof rawSizes === 'object' ? Object.values(rawSizes) : []);
        const hasSizes = sizesList.length > 0;

        const displayPrice = hasSizes 
            ? `From ₱${parseFloat(sizesList[0].priceDelta || 0).toFixed(2)}` 
            : `₱${parseFloat(item.basePrice || 0).toFixed(2)}`;

        return `
        <div class="bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-800/80 rounded-2xl p-2.5 flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-xs text-gray-900 dark:text-white">${escapeHtml(item.name)}</span>
                    <span class="text-xs font-mono font-black text-emerald-600 dark:text-emerald-400">${displayPrice}</span>
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
    document.getElementById('customizer-item-notes').value = '';
    document.getElementById('customizer-qty-display').innerText = '1';

    const submitBtn = document.querySelector('#cust-item-customizer-modal button[onclick*="submitAddCustomizedItemToCart"]') || document.querySelector('#cust-item-customizer-modal button.bg-orange-600, #cust-item-customizer-modal button');
    if (submitBtn) {
        if (isPreviewMode) {
            submitBtn.innerText = "PREVIEW MODE (ORDERING DISABLED)";
            submitBtn.className = "w-full bg-gray-500 text-white font-bold py-3.5 rounded-xl shadow-lg cursor-not-allowed text-xs flex items-center justify-center gap-2";
        } else {
            submitBtn.innerHTML = `<i class="fa-solid fa-cart-plus"></i> ADD TO CART`;
            submitBtn.className = "w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-3.5 rounded-xl shadow-lg transition active:scale-95 flex items-center justify-center gap-2 text-xs";
        }
    }

    const rawSizes = item.sizes;
    const sizesList = Array.isArray(rawSizes) 
        ? rawSizes 
        : (rawSizes && typeof rawSizes === 'object' ? Object.values(rawSizes) : []);
    const sizes = sizesList.filter(s => s && s.isAvailable !== false);
    const hasSizes = sizes.length > 0;

    const basePriceEl = document.getElementById('customizer-item-base-price');
    if (basePriceEl) {
        basePriceEl.innerText = hasSizes 
            ? parseFloat(sizes[0].priceDelta || 0).toFixed(2) 
            : parseFloat(item.basePrice || 0).toFixed(2);
    }

    const sizesWrapper = document.getElementById('customizer-sizes-wrapper');
    const sizesOptions = document.getElementById('customizer-sizes-options');

    if (sizesWrapper && sizesOptions) {
        if (hasSizes) {
            sizesWrapper.classList.remove('hidden');
            sizesOptions.innerHTML = sizes.map((s, idx) => `
                <label class="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 cursor-pointer hover:border-blue-500/50">
                    <div class="flex items-center gap-2">
                        <input type="radio" name="customizer_size_choice" value="${idx}" ${idx === 0 ? 'checked' : ''} onchange="window.recalculateCustomizerPrice()" class="accent-blue-500">
                        <span class="text-xs font-bold text-gray-900 dark:text-white">${escapeHtml(s.name)}</span>
                    </div>
                    <span class="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">₱${parseFloat(s.priceDelta || 0).toFixed(2)}</span>
                </label>
            `).join('');
        } else {
            sizesWrapper.classList.add('hidden');
            sizesOptions.innerHTML = '';
        }
    }

    const addonsWrapper = document.getElementById('customizer-addons-wrapper');
    const addonsOptions = document.getElementById('customizer-addons-options');

    const addonGroups = item.addonGroups || [];
    const legacyAddons = (item.addons || []).filter(a => a.isAvailable !== false && !a.isFromGroup);
    const storeItems = menusCache[storeId]?.items || {};

    if (addonGroups.length > 0 || legacyAddons.length > 0) {
        if (addonsWrapper) addonsWrapper.classList.remove('hidden');

        let groupsHtml = '';

        addonGroups.forEach((group, gIdx) => {
            const groupItems = (group.items || []).filter(i => i.isAvailable !== false);
            if (groupItems.length === 0) return;

            const isRequired = !!group.isRequired;
            const isSingle = !!group.isSingleChoice;

            const badgeHtml = isRequired 
                ? `<span class="text-[9px] bg-red-500/10 text-red-500 border border-red-500/30 px-1.5 py-0.2 rounded font-bold uppercase">Required</span>` 
                : `<span class="text-[9px] bg-gray-100 dark:bg-gray-800 text-gray-500 px-1.5 py-0.2 rounded font-medium">Optional</span>`;

            const choiceBadgeHtml = isSingle 
                ? `<span class="text-[9px] bg-blue-500/10 text-blue-500 border border-blue-500/30 px-1.5 py-0.2 rounded font-bold">Pick 1</span>` 
                : `<span class="text-[9px] bg-amber-500/10 text-amber-500 border border-amber-500/30 px-1.5 py-0.2 rounded font-bold">Multiple choices</span>`;

            let itemsInputsHtml = '';

            if (isSingle && !isRequired) {
                itemsInputsHtml += `
                <label class="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 cursor-pointer hover:border-amber-500/50">
                    <div class="flex items-center gap-2">
                        <input type="radio" name="customizer_addon_group_${gIdx}" value="NONE" checked onchange="window.recalculateCustomizerPrice()" class="accent-amber-500">
                        <span class="text-xs font-bold text-gray-500 dark:text-gray-400 italic">None / Walang Dagdag</span>
                    </div>
                    <span class="text-xs font-mono font-bold text-gray-400">+₱0.00</span>
                </label>`;
            }

            let renderedOptionCount = 0;

            groupItems.forEach((a, aIdx) => {
                const masterItem = a.itemId 
                    ? storeItems[a.itemId] 
                    : Object.values(storeItems).find(it => (it.name || '').toLowerCase().trim() === (a.name || '').toLowerCase().trim());

                const rawAddonSizes = a.sizes || masterItem?.sizes;
                const addonSizesList = Array.isArray(rawAddonSizes) 
                    ? rawAddonSizes 
                    : (rawAddonSizes && typeof rawAddonSizes === 'object' ? Object.values(rawAddonSizes) : []);
                const addonSizes = addonSizesList.filter(s => s && s.isAvailable !== false);

                if (addonSizes.length > 0) {
                    addonSizes.forEach((sizeOption, sIdx) => {
                        const isDefaultChecked = isSingle && isRequired && renderedOptionCount === 0;
                        const inputType = isSingle ? 'radio' : 'checkbox';
                        const inputName = isSingle ? `customizer_addon_group_${gIdx}` : `customizer_addon_group_${gIdx}_${aIdx}_${sIdx}`;

                        const sEffectivePrice = (sizeOption.addonPrice !== undefined && sizeOption.addonPrice !== null && sizeOption.addonPrice !== '' && !isNaN(parseFloat(sizeOption.addonPrice)))
                            ? parseFloat(sizeOption.addonPrice)
                            : (sizeOption.priceDelta !== undefined && !isNaN(parseFloat(sizeOption.priceDelta)) ? parseFloat(sizeOption.priceDelta) : parseFloat(a.priceDelta || 0));

                        const displayName = `${escapeHtml(a.name)} (${escapeHtml(sizeOption.name)})`;

                        itemsInputsHtml += `
                        <label class="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 cursor-pointer hover:border-amber-500/50">
                            <div class="flex items-center gap-2">
                                <input type="${inputType}" name="${inputName}" data-group-index="${gIdx}" data-addon-name="${escapeHtml(a.name)}" data-size-name="${escapeHtml(sizeOption.name)}" data-price="${sEffectivePrice}" value="${aIdx}_${sIdx}" ${isDefaultChecked ? 'checked' : ''} onchange="window.recalculateCustomizerPrice()" class="accent-amber-500 rounded">
                                <span class="text-xs font-bold text-gray-900 dark:text-white">${displayName}</span>
                            </div>
                            <span class="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">+₱${sEffectivePrice.toFixed(2)}</span>
                        </label>`;
                        renderedOptionCount++;
                    });
                } else {
                    const isDefaultChecked = isSingle && isRequired && renderedOptionCount === 0;
                    const inputType = isSingle ? 'radio' : 'checkbox';
                    const inputName = isSingle ? `customizer_addon_group_${gIdx}` : `customizer_addon_group_${gIdx}_${aIdx}`;

                    const itemEffectivePrice = (a.addonPrice !== undefined && a.addonPrice !== null && a.addonPrice !== '' && !isNaN(parseFloat(a.addonPrice)))
                        ? parseFloat(a.addonPrice)
                        : parseFloat(a.priceDelta || 0);

                    itemsInputsHtml += `
                    <label class="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 cursor-pointer hover:border-amber-500/50">
                        <div class="flex items-center gap-2">
                            <input type="${inputType}" name="${inputName}" data-group-index="${gIdx}" data-addon-name="${escapeHtml(a.name)}" data-size-name="" data-price="${itemEffectivePrice}" value="${aIdx}" ${isDefaultChecked ? 'checked' : ''} onchange="window.recalculateCustomizerPrice()" class="accent-amber-500 rounded">
                            <span class="text-xs font-bold text-gray-900 dark:text-white">${escapeHtml(a.name)}</span>
                        </div>
                        <span class="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">+₱${itemEffectivePrice.toFixed(2)}</span>
                    </label>`;
                    renderedOptionCount++;
                }
            });

            groupsHtml += `
            <div class="flex flex-col gap-1.5 bg-gray-50/70 dark:bg-black/20 p-2.5 rounded-2xl border border-gray-200 dark:border-gray-800" data-group-id="${gIdx}">
                <div class="flex items-center justify-between pb-1 border-b border-gray-200/60 dark:border-gray-800/60">
                    <span class="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-1.5">
                        <i class="fa-solid fa-sparkles text-amber-500 text-[10px]"></i> ${escapeHtml(group.categoryName)}
                    </span>
                    <div class="flex items-center gap-1">
                        ${badgeHtml}
                        ${choiceBadgeHtml}
                    </div>
                </div>
                <div class="flex flex-col gap-1 mt-0.5">
                    ${itemsInputsHtml}
                </div>
            </div>`;
        });

        if (legacyAddons.length > 0) {
            groupsHtml += `
            <div class="flex flex-col gap-1.5 bg-gray-50/70 dark:bg-black/20 p-2.5 rounded-2xl border border-gray-200 dark:border-gray-800">
                <span class="font-bold text-xs text-gray-900 dark:text-white uppercase tracking-wide">Custom Extras</span>
                <div class="flex flex-col gap-1">
                    ${legacyAddons.map((a, idx) => `
                        <label class="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 cursor-pointer hover:border-amber-500/50">
                            <div class="flex items-center gap-2">
                                <input type="checkbox" name="customizer_legacy_addon_choice" value="${idx}" onchange="window.recalculateCustomizerPrice()" class="accent-amber-500 rounded">
                                <span class="text-xs font-bold text-gray-900 dark:text-white">${escapeHtml(a.name)}</span>
                            </div>
                            <span class="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">+₱${parseFloat(a.priceDelta || 0).toFixed(2)}</span>
                        </label>
                    `).join('')}
                </div>
            </div>`;
        }

        if (addonsOptions) addonsOptions.innerHTML = groupsHtml;
    } else {
        if (addonsWrapper) addonsWrapper.classList.add('hidden');
        if (addonsOptions) addonsOptions.innerHTML = '';
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

    const rawSizes = activeCustomizingItem.sizes;
    const sizesList = Array.isArray(rawSizes) 
        ? rawSizes 
        : (rawSizes && typeof rawSizes === 'object' ? Object.values(rawSizes) : []);
    const sizes = sizesList.filter(s => s && s.isAvailable !== false);
    const hasSizes = sizes.length > 0;

    let unitPrice = 0;
    if (hasSizes) {
        const selectedSizeRadio = document.querySelector('input[name="customizer_size_choice"]:checked');
        if (selectedSizeRadio) {
            const sizeIdx = parseInt(selectedSizeRadio.value);
            const sizeObj = sizes[sizeIdx];
            if (sizeObj) unitPrice = parseFloat(sizeObj.priceDelta || 0);
        } else {
            unitPrice = parseFloat(sizes[0].priceDelta || 0);
        }
    } else {
        unitPrice = parseFloat(activeCustomizingItem.basePrice || 0);
    }

    const addonGroups = activeCustomizingItem.addonGroups || [];
    addonGroups.forEach((group, gIdx) => {
        const isSingle = !!group.isSingleChoice;
        if (isSingle) {
            const selectedRadio = document.querySelector(`input[name="customizer_addon_group_${gIdx}"]:checked`);
            if (selectedRadio && selectedRadio.value !== 'NONE') {
                unitPrice += parseFloat(selectedRadio.dataset.price || 0);
            }
        } else {
            document.querySelectorAll(`input[name^="customizer_addon_group_${gIdx}_"]:checked`).forEach(cb => {
                unitPrice += parseFloat(cb.dataset.price || 0);
            });
        }
    });

    const legacyAddons = (activeCustomizingItem.addons || []).filter(a => a.isAvailable !== false && !a.isFromGroup);
    document.querySelectorAll('input[name="customizer_legacy_addon_choice"]:checked').forEach(cb => {
        const aIdx = parseInt(cb.value);
        const addonObj = legacyAddons[aIdx];
        if (addonObj) unitPrice += parseFloat(addonObj.priceDelta || 0);
    });

    const total = unitPrice * customizerQty;
    const calcTotalEl = document.getElementById('customizer-calc-total');
    if (calcTotalEl) calcTotalEl.innerText = total.toFixed(2);
}

export function submitAddCustomizedItemToCart() {
    if (!activeCustomizingItem) return;

    if (isPreviewMode) {
        return showToast("⚠️ Naka-Preview Mode: Hindi maaaring mag-add to cart habang tinitingnan ang preview.");
    }

    const rawStoreId = activeCustomizingItem.storeId;
    const storeId = cleanFirebasePathKey(rawStoreId);
    const store = storesCache[rawStoreId] || storesCache[storeId] || { storeName: "Store", address: "Poblacion" };

    const rawSizes = activeCustomizingItem.sizes;
    const sizesList = Array.isArray(rawSizes) 
        ? rawSizes 
        : (rawSizes && typeof rawSizes === 'object' ? Object.values(rawSizes) : []);
    const sizes = sizesList.filter(s => s && s.isAvailable !== false);
    const hasSizes = sizes.length > 0;

    let chosenSize = null;
    let unitPrice = 0;

    if (hasSizes) {
        const selectedSizeRadio = document.querySelector('input[name="customizer_size_choice"]:checked');
        if (selectedSizeRadio) {
            const sizeIdx = parseInt(selectedSizeRadio.value);
            chosenSize = sizes[sizeIdx] || null;
            if (chosenSize) unitPrice = parseFloat(chosenSize.priceDelta || 0);
        } else {
            chosenSize = sizes[0] || null;
            if (chosenSize) unitPrice = parseFloat(chosenSize.priceDelta || 0);
        }
    } else {
        unitPrice = parseFloat(activeCustomizingItem.basePrice || 0);
    }

    const chosenAddons = [];
    const addonGroups = activeCustomizingItem.addonGroups || [];

    for (let gIdx = 0; gIdx < addonGroups.length; gIdx++) {
        const group = addonGroups[gIdx];
        const isRequired = !!group.isRequired;
        const isSingle = !!group.isSingleChoice;

        let selectedInGroup = 0;

        if (isSingle) {
            const selectedRadio = document.querySelector(`input[name="customizer_addon_group_${gIdx}"]:checked`);
            if (selectedRadio && selectedRadio.value !== 'NONE') {
                const aName = selectedRadio.dataset.addonName || 'Addon';
                const sName = selectedRadio.dataset.sizeName || '';
                const effPrice = parseFloat(selectedRadio.dataset.price || 0);
                const fullLabel = sName ? `${aName} (${sName})` : aName;

                chosenAddons.push({
                    name: `${group.categoryName}: ${fullLabel}`,
                    priceDelta: effPrice
                });
                unitPrice += effPrice;
                selectedInGroup++;
            }
        } else {
            document.querySelectorAll(`input[name^="customizer_addon_group_${gIdx}_"]:checked`).forEach(cb => {
                const aName = cb.dataset.addonName || 'Addon';
                const sName = cb.dataset.sizeName || '';
                const effPrice = parseFloat(cb.dataset.price || 0);
                const fullLabel = sName ? `${aName} (${sName})` : aName;

                chosenAddons.push({
                    name: `${group.categoryName}: ${fullLabel}`,
                    priceDelta: effPrice
                });
                unitPrice += effPrice;
                selectedInGroup++;
            });
        }

        if (isRequired && selectedInGroup === 0) {
            return showToast(`⚠️ Paki-pili ang iyong '${group.categoryName}' bago mag-add to cart!`);
        }
    }

    const legacyAddons = (activeCustomizingItem.addons || []).filter(a => a.isAvailable !== false && !a.isFromGroup);
    document.querySelectorAll('input[name="customizer_legacy_addon_choice"]:checked').forEach(cb => {
        const aIdx = parseInt(cb.value);
        const addonObj = legacyAddons[aIdx];
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