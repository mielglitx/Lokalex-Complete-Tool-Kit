// src/features/storeHub/ui/menu/storeMenuItemEditor.js
import { appState } from '../../../../store/state.js';
import { showToast } from '../../../../ui/notifications.js';
import { escapeHtml } from '../../../../utils/helpers.js';
import { RESERVED_ADDONS_CATEGORY, isAddonCategoryName, saveMenuItem } from '../../storeMenu.js';
import { storeHubState, cleanFirebasePathKey } from '../storeHubState.js';
import { clearItemPhoto } from './storeMenuItemPhoto.js';

export function updateBasePriceVoidState() {
    const container = document.getElementById('item-sizes-container');
    const badge = document.getElementById('item-price-void-badge');
    const priceInput = document.getElementById('item-input-price');
    const priceLabel = document.getElementById('item-label-price');

    const sizeCount = container ? container.querySelectorAll('.size-variant-row').length : 0;

    if (sizeCount > 0) {
        if (badge) badge.classList.remove('hidden');
        if (priceInput) {
            priceInput.disabled = true;
            priceInput.value = '0';
        }
        if (priceLabel) {
            priceLabel.innerHTML = `Menu ₱ <span class="text-amber-500 lowercase text-[9px]">(voided: sizes active)</span>`;
        }
    } else {
        if (badge) badge.classList.add('hidden');
        if (priceInput) {
            priceInput.disabled = false;
        }
        if (priceLabel) {
            priceLabel.innerText = "Menu ₱ *";
        }
    }
}

export function updateAddonsSectionState() {
    const catSelect = document.getElementById('item-input-category');
    const addonsSection = document.getElementById('item-addons-section');
    const disabledBanner = document.getElementById('item-addons-disabled-banner');

    const currentCat = (catSelect?.value || '').trim();
    const categories = Object.values(storeHubState.currentMenuData.categories || {});
    const catObj = categories.find(c => c.name.toLowerCase() === currentCat.toLowerCase());

    const isThisAnAddonCategory = catObj ? (catObj.isAddonCategory || isAddonCategoryName(catObj.name)) : isAddonCategoryName(currentCat);

    if (isThisAnAddonCategory) {
        if (addonsSection) addonsSection.classList.add('hidden');
        if (disabledBanner) disabledBanner.classList.remove('hidden');

        document.querySelectorAll('.master-addon-checkbox:checked').forEach(cb => {
            cb.checked = false;
        });

        const addonsContainer = document.getElementById('item-addons-container');
        if (addonsContainer) addonsContainer.innerHTML = '';
    } else {
        if (addonsSection) addonsSection.classList.remove('hidden');
        if (disabledBanner) disabledBanner.classList.add('hidden');
    }
}

export function renderAddonGroupsSelection(activeAddonGroups = [], activeItemAddons = []) {
    const container = document.getElementById('item-addon-groups-container');
    if (!container) return;

    const allCategories = Object.values(storeHubState.currentMenuData.categories || {});
    const allItems = Object.values(storeHubState.currentMenuData.items || {});

    let addonCategories = allCategories.filter(c => c.isAddonCategory || isAddonCategoryName(c.name));

    if (addonCategories.length === 0) {
        addonCategories = [{
            id: 'CAT_RESERVED_ADDONS',
            name: RESERVED_ADDONS_CATEGORY,
            isAddonCategory: true
        }];
    }

    const groupsList = Array.isArray(activeAddonGroups)
        ? activeAddonGroups
        : (activeAddonGroups && typeof activeAddonGroups === 'object' ? Object.values(activeAddonGroups) : []);

    const configuredGroupsMap = {};
    groupsList.forEach(g => {
        if (g && g.categoryName) {
            configuredGroupsMap[g.categoryName.trim().toLowerCase()] = g;
        }
    });

    const addonsList = Array.isArray(activeItemAddons)
        ? activeItemAddons
        : (activeItemAddons && typeof activeItemAddons === 'object' ? Object.values(activeItemAddons) : []);

    const activeAddonNames = new Set(
        addonsList.map(a => (a.name || '').trim().toLowerCase())
    );

    let html = '';

    addonCategories.forEach((cat) => {
        const catName = cat.name || RESERVED_ADDONS_CATEGORY;
        const savedGroup = configuredGroupsMap[catName.toLowerCase()] || null;

        const isRequired = savedGroup !== null ? !!savedGroup.isRequired : !!cat.isRequired;
        const isSingleChoice = savedGroup !== null ? !!savedGroup.isSingleChoice : !!cat.isSingleChoice;

        const groupItemsList = savedGroup && savedGroup.items
            ? (Array.isArray(savedGroup.items) ? savedGroup.items : Object.values(savedGroup.items))
            : [];

        const groupSavedItemNames = new Set(
            groupItemsList.map(i => (i.name || '').trim().toLowerCase())
        );

        const categoryItems = allItems.filter(it => 
            (it.category || '').trim().toLowerCase() === catName.toLowerCase()
        );

        let itemsHtml = '';
        if (categoryItems.length === 0) {
            itemsHtml = `<div class="text-[10px] text-gray-400 italic py-1 px-1">Walang items sa '${escapeHtml(catName)}' category. Magdagdag ng item gamit ang category na ito.</div>`;
        } else {
            itemsHtml = categoryItems.map(item => {
                const aName = item.name || 'Extra';
                const regPrice = parseFloat(item.basePrice || 0);
                const hasAddonPrice = item.addonPrice !== undefined && item.addonPrice !== null && item.addonPrice !== '' && !isNaN(parseFloat(item.addonPrice));
                const aPrice = hasAddonPrice ? parseFloat(item.addonPrice) : regPrice;

                const isChecked = groupSavedItemNames.has(aName.toLowerCase()) || activeAddonNames.has(aName.toLowerCase());

                const priceDisplay = hasAddonPrice && aPrice !== regPrice
                    ? `<span class="font-mono text-amber-600 dark:text-amber-400 font-bold">+₱${aPrice.toFixed(0)}</span> <span class="text-[8.5px] text-gray-400 line-through">₱${regPrice.toFixed(0)}</span>`
                    : `<span class="font-mono text-amber-600 dark:text-amber-400 font-bold">+₱${aPrice.toFixed(0)}</span>`;

                return `
                <label class="inline-flex items-center gap-1.5 bg-gray-50 dark:bg-black/40 border ${isChecked ? 'border-amber-500/80 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-black' : 'border-gray-200 dark:border-gray-700/70 text-gray-700 dark:text-gray-300 font-bold'} px-2.5 py-1.5 rounded-xl cursor-pointer select-none text-[11px] transition hover:border-amber-500 shrink-0">
                    <input type="checkbox" class="master-addon-checkbox w-3.5 h-3.5 accent-amber-500" data-item-id="${item.id}" data-cat-name="${escapeHtml(catName)}" data-name="${escapeHtml(aName)}" data-price="${aPrice}" ${isChecked ? 'checked' : ''} onchange="this.parentElement.className = this.checked ? 'inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/80 text-amber-700 dark:text-amber-300 font-black px-2.5 py-1.5 rounded-xl cursor-pointer select-none text-[11px] transition shrink-0' : 'inline-flex items-center gap-1.5 bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-700/70 text-gray-700 dark:text-gray-300 font-bold px-2.5 py-1.5 rounded-xl cursor-pointer select-none text-[11px] transition shrink-0'">
                    <span>${escapeHtml(aName)}</span>
                    ${priceDisplay}
                </label>`;
            }).join('');
        }

        html += `
        <div class="addon-category-group bg-white dark:bg-black/30 border border-gray-200 dark:border-gray-800 rounded-2xl p-3 flex flex-col gap-2 shadow-xs" data-cat-name="${escapeHtml(catName)}">
            <div class="flex items-center justify-between border-b border-gray-100 dark:border-gray-800/80 pb-1.5">
                <span class="font-bold text-gray-900 dark:text-white text-xs flex items-center gap-1.5">
                    <i class="fa-solid fa-sparkles text-amber-500 text-[10px]"></i> ${escapeHtml(catName)}
                </span>
                <div class="flex items-center gap-2.5">
                    <label class="inline-flex items-center gap-1 text-[10px] text-gray-600 dark:text-gray-300 cursor-pointer font-bold select-none">
                        <input type="checkbox" class="addon-group-required accent-amber-500 rounded w-3.5 h-3.5" ${isRequired ? 'checked' : ''}>
                        <span>Required</span>
                    </label>
                    <label class="inline-flex items-center gap-1 text-[10px] text-gray-600 dark:text-gray-300 cursor-pointer font-bold select-none">
                        <input type="checkbox" class="addon-group-single accent-amber-500 rounded w-3.5 h-3.5" ${isSingleChoice ? 'checked' : ''}>
                        <span>Single Choice (1 only)</span>
                    </label>
                </div>
            </div>

            <div class="flex flex-wrap gap-1.5 pt-1">
                ${itemsHtml}
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

export function openItemEditorModal(item = null, preselectedCategory = null) {
    const modal = document.getElementById('store-item-modal');
    const title = document.getElementById('item-modal-title');
    const idInput = document.getElementById('item-edit-id');
    const nameInput = document.getElementById('item-input-name');
    const priceInput = document.getElementById('item-input-price');
    const addonPriceInput = document.getElementById('item-input-addon-price');
    const isAddonOnlyCheckbox = document.getElementById('item-input-is-addon-only');
    const catInput = document.getElementById('item-input-category');
    const descInput = document.getElementById('item-input-desc');
    const imgInput = document.getElementById('item-input-image');
    const stagedInput = document.getElementById('item-staged-image-data');
    const sizesContainer = document.getElementById('item-sizes-container');
    const addonsContainer = document.getElementById('item-addons-container');

    const imgPreview = document.getElementById('item-modal-preview-img');
    const iconPreview = document.getElementById('item-modal-preview-icon');

    if (sizesContainer) sizesContainer.innerHTML = '';
    if (addonsContainer) addonsContainer.innerHTML = '';
    if (stagedInput) stagedInput.value = '';

    if (catInput) {
        const categories = Object.values(storeHubState.currentMenuData.categories || {});
        let displayCats = [...categories];

        if (!displayCats.some(c => c.isAddonCategory || isAddonCategoryName(c.name))) {
            displayCats.push({ name: RESERVED_ADDONS_CATEGORY, isAddonCategory: true });
        }

        const opts = displayCats.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`);
        if (!displayCats.some(c => c.name.toLowerCase() === 'general')) {
            opts.unshift(`<option value="General">General</option>`);
        }
        catInput.innerHTML = opts.join('');

        catInput.onchange = () => {
            updateAddonsSectionState();
        };
    }

    if (item) {
        if (title) title.innerText = "Edit Menu Item";
        if (idInput) idInput.value = item.id;
        if (nameInput) nameInput.value = item.name || '';
        if (priceInput) priceInput.value = item.basePrice || '';
        if (addonPriceInput) addonPriceInput.value = item.addonPrice !== undefined && item.addonPrice !== null ? item.addonPrice : '';
        if (isAddonOnlyCheckbox) isAddonOnlyCheckbox.checked = !!item.isAddonOnly;
        if (descInput) descInput.value = item.description || '';
        if (imgInput) imgInput.value = item.imageUrl || '';

        if (catInput) {
            const itemCat = (item.category || 'General').trim().toLowerCase();
            const matchingOpt = Array.from(catInput.options).find(
                opt => opt.value.trim().toLowerCase() === itemCat
            );
            if (matchingOpt) {
                catInput.value = matchingOpt.value;
            } else {
                const newOpt = document.createElement('option');
                newOpt.value = item.category || 'General';
                newOpt.innerText = item.category || 'General';
                catInput.appendChild(newOpt);
                catInput.value = newOpt.value;
            }
        }

        if (item.imageUrl && imgPreview && iconPreview) {
            imgPreview.src = item.imageUrl;
            imgPreview.classList.remove('hidden');
            iconPreview.classList.add('hidden');
        } else if (imgPreview && iconPreview) {
            imgPreview.src = '';
            imgPreview.classList.add('hidden');
            iconPreview.classList.remove('hidden');
        }

        // Handle both Firebase array and object representation for item sizes
        const rawSizes = item.sizes;
        const sizesList = Array.isArray(rawSizes)
            ? rawSizes
            : (rawSizes && typeof rawSizes === 'object' ? Object.values(rawSizes) : []);

        sizesList.forEach(s => {
            if (s && s.name) {
                addSizeVariantRow(s.name, s.priceDelta, s.addonPrice);
            }
        });

        renderAddonGroupsSelection(item.addonGroups || [], item.addons || []);

        const rawAddons = item.addons;
        const addonsList = Array.isArray(rawAddons)
            ? rawAddons
            : (rawAddons && typeof rawAddons === 'object' ? Object.values(rawAddons) : []);

        const customAddons = addonsList.filter(a => a && !a.isMaster && !a.isFromGroup);
        customAddons.forEach(a => addCustomAddonRow(a.name, a.priceDelta));
    } else {
        if (title) title.innerText = "Add Menu Item";
        if (idInput) idInput.value = '';
        if (nameInput) nameInput.value = '';
        if (priceInput) priceInput.value = '';
        if (addonPriceInput) addonPriceInput.value = '';
        if (isAddonOnlyCheckbox) isAddonOnlyCheckbox.checked = false;
        if (descInput) descInput.value = '';
        if (imgInput) imgInput.value = '';

        let targetCategory = preselectedCategory;
        if (!targetCategory && storeHubState.selectedCategoryId && storeHubState.selectedCategoryId !== 'ALL') {
            targetCategory = storeHubState.selectedCategoryId;
        }

        if (catInput) {
            if (targetCategory) {
                const matchingOpt = Array.from(catInput.options).find(
                    opt => opt.value.trim().toLowerCase() === targetCategory.trim().toLowerCase()
                );
                if (matchingOpt) {
                    catInput.value = matchingOpt.value;
                } else {
                    const newOpt = document.createElement('option');
                    newOpt.value = targetCategory.trim();
                    newOpt.innerText = targetCategory.trim();
                    catInput.appendChild(newOpt);
                    catInput.value = targetCategory.trim();
                }
            } else {
                catInput.value = catInput.options[0]?.value || 'General';
            }
        }

        renderAddonGroupsSelection([], []);
        clearItemPhoto();
    }

    updateBasePriceVoidState();
    updateAddonsSectionState();

    if (modal) modal.classList.remove('hidden');
}

export function closeItemEditorModal() {
    const modal = document.getElementById('store-item-modal');
    clearItemPhoto();
    if (modal) modal.classList.add('hidden');
}

export function editMenuItemModal(itemId) {
    const item = storeHubState.currentMenuData.items ? storeHubState.currentMenuData.items[itemId] : null;
    if (item) openItemEditorModal(item);
}

export function addSizeVariantRow(name = '', priceDelta = 0, addonPrice = '') {
    const container = document.getElementById('item-sizes-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = "flex items-center gap-1.5 size-variant-row";
    row.innerHTML = `
        <input type="text" placeholder="Size (e.g. 16oz)" value="${escapeHtml(name)}" class="flex-1 bg-inputBg text-xs rounded-xl p-2 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white font-bold size-name-input">
        <input type="number" step="0.01" placeholder="Menu ₱" value="${priceDelta !== undefined && priceDelta !== null ? priceDelta : ''}" class="w-20 bg-inputBg text-xs rounded-xl p-2 border border-gray-300 dark:border-gray-700 outline-none text-blue-600 dark:text-blue-400 font-mono font-bold size-delta-input" title="Regular standalone size price">
        <input type="number" step="0.01" placeholder="Add-on ₱" value="${addonPrice !== undefined && addonPrice !== null ? addonPrice : ''}" class="w-20 bg-inputBg text-xs rounded-xl p-2 border border-amber-300 dark:border-amber-700/60 outline-none text-amber-600 dark:text-amber-400 font-mono font-bold size-addon-price-input" title="Price when this size is selected as an add-on (leave blank to match Menu ₱)">
        <button type="button" onclick="this.parentElement.remove(); window.updateBasePriceVoidState && window.updateBasePriceVoidState();" class="text-gray-400 hover:text-red-500 p-1 text-sm"><i class="fa-solid fa-trash"></i></button>
    `;
    container.appendChild(row);
    updateBasePriceVoidState();
}

export function addCustomAddonRow(name = '', priceDelta = 0) {
    const container = document.getElementById('item-addons-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = "flex items-center gap-2 addon-row";
    row.innerHTML = `
        <input type="text" placeholder="Add-on Name (e.g. Extra Sauce / Toppings)" value="${escapeHtml(name)}" class="flex-1 bg-inputBg text-xs rounded-xl p-2 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white font-bold addon-name-input">
        <input type="number" step="0.01" placeholder="+₱ Price" value="${priceDelta || ''}" class="w-24 bg-inputBg text-xs rounded-xl p-2 border border-gray-300 dark:border-gray-700 outline-none text-amber-600 dark:text-amber-400 font-mono font-bold addon-delta-input">
        <button type="button" onclick="this.parentElement.remove()" class="text-gray-400 hover:text-red-500 p-1 text-sm"><i class="fa-solid fa-trash"></i></button>
    `;
    container.appendChild(row);
}

export const addAddonRow = addCustomAddonRow;

export async function submitSaveStoreItem() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const id = document.getElementById('item-edit-id')?.value.trim();
    const name = document.getElementById('item-input-name')?.value.trim();
    const rawBasePrice = parseFloat(document.getElementById('item-input-price')?.value);
    const rawAddonPrice = document.getElementById('item-input-addon-price')?.value;
    const isAddonOnly = !!document.getElementById('item-input-is-addon-only')?.checked;
    const category = document.getElementById('item-input-category')?.value.trim() || 'General';
    const description = document.getElementById('item-input-desc')?.value.trim();
    const stagedImage = document.getElementById('item-staged-image-data')?.value.trim();
    const urlImage = document.getElementById('item-input-image')?.value.trim();
    const finalImage = stagedImage || urlImage || "";

    const addonPrice = (rawAddonPrice !== undefined && rawAddonPrice !== null && rawAddonPrice.trim() !== '' && !isNaN(parseFloat(rawAddonPrice)))
        ? parseFloat(rawAddonPrice)
        : null;

    const allStoreItems = storeHubState.currentMenuData.items || {};
    const categories = Object.values(storeHubState.currentMenuData.categories || {});
    const catObj = categories.find(c => c.name.toLowerCase() === category.toLowerCase());
    const isThisAnAddonCategory = catObj ? (catObj.isAddonCategory || isAddonCategoryName(catObj.name)) : isAddonCategoryName(category);

    const sizes = [];
    document.querySelectorAll('.size-variant-row').forEach(row => {
        const sName = row.querySelector('.size-name-input')?.value.trim();
        const sPrice = parseFloat(row.querySelector('.size-delta-input')?.value) || 0;
        const rawSAddonPrice = row.querySelector('.size-addon-price-input')?.value;
        const sAddonPrice = (rawSAddonPrice !== undefined && rawSAddonPrice !== null && rawSAddonPrice.trim() !== '' && !isNaN(parseFloat(rawSAddonPrice)))
            ? parseFloat(rawSAddonPrice)
            : null;

        if (sName) {
            sizes.push({ 
                name: sName, 
                priceDelta: sPrice, 
                addonPrice: sAddonPrice,
                isAvailable: true 
            });
        }
    });

    if (!name) return showToast("⚠️ Item Name is required!");

    let finalBasePrice = 0;
    if (sizes.length > 0) {
        finalBasePrice = 0;
    } else {
        if (isNaN(rawBasePrice) || rawBasePrice < 0) {
            return showToast("⚠️ Valid Base Price is required when no sizes are defined!");
        }
        finalBasePrice = rawBasePrice;
    }

    const addonGroups = [];
    const flattenedAddons = [];

    if (!isThisAnAddonCategory) {
        document.querySelectorAll('.addon-category-group').forEach(groupEl => {
            const groupCatName = groupEl.dataset.catName;
            const isRequired = !!groupEl.querySelector('.addon-group-required')?.checked;
            const isSingleChoice = !!groupEl.querySelector('.addon-group-single')?.checked;

            const selectedItems = [];
            groupEl.querySelectorAll('.master-addon-checkbox:checked').forEach(cb => {
                const itemId = cb.dataset.itemId;
                const itemName = cb.dataset.name;
                const itemPrice = parseFloat(cb.dataset.price) || 0;

                const originalItem = itemId ? allStoreItems[itemId] : null;
                const rawOriginalSizes = originalItem?.sizes;
                const originalSizesList = Array.isArray(rawOriginalSizes)
                    ? rawOriginalSizes
                    : (rawOriginalSizes && typeof rawOriginalSizes === 'object' ? Object.values(rawOriginalSizes) : []);

                selectedItems.push({
                    itemId: itemId || null,
                    name: itemName,
                    priceDelta: itemPrice,
                    addonPrice: originalItem?.addonPrice ?? null,
                    sizes: originalSizesList,
                    isAvailable: true
                });

                flattenedAddons.push({
                    itemId: itemId || null,
                    name: itemName,
                    priceDelta: itemPrice,
                    addonPrice: originalItem?.addonPrice ?? null,
                    sizes: originalSizesList,
                    categoryName: groupCatName,
                    isAvailable: true,
                    isMaster: true,
                    isFromGroup: true
                });
            });

            if (selectedItems.length > 0) {
                addonGroups.push({
                    categoryName: groupCatName,
                    isRequired,
                    isSingleChoice,
                    items: selectedItems
                });
            }
        });

        document.querySelectorAll('.addon-row').forEach(row => {
            const aName = row.querySelector('.addon-name-input')?.value.trim();
            const aDelta = parseFloat(row.querySelector('.addon-delta-input')?.value) || 0;
            if (aName) {
                flattenedAddons.push({
                    name: aName,
                    priceDelta: aDelta,
                    isAvailable: true,
                    isMaster: false,
                    isFromGroup: false
                });
            }
        });
    }

    const itemPayload = {
        id: id || null,
        name,
        basePrice: finalBasePrice,
        addonPrice,
        isAddonOnly,
        category,
        description,
        imageUrl: finalImage,
        sizes,
        addonGroups,
        addons: flattenedAddons,
        isAvailable: true
    };

    const saveBtn = document.getElementById('item-save-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        await saveMenuItem(storeId, itemPayload);
        closeItemEditorModal();
    } catch(e) {
        showToast("❌ Failed to save item.");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> SAVE MENU ITEM`;
        }
    }
}