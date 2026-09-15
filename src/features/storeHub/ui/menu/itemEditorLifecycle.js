// src/features/storeHub/ui/menu/itemEditorLifecycle.js
import { appState } from '../../../../store/state.js';
import { showToast } from '../../../../ui/notifications.js';
import { escapeHtml } from '../../../../utils/helpers.js';
import { RESERVED_ADDONS_CATEGORY, isAddonCategoryName, saveMenuItem } from '../../storeMenu.js';
import { storeHubState, cleanFirebasePathKey } from '../storeHubState.js';
import { clearItemPhoto } from './storeMenuItemPhoto.js';
import { updateBasePriceVoidState, updateAddonsSectionState } from './itemEditorFormState.js';
import { addSizeVariantRow, addCustomAddonRow, renderAddonGroupsSelection } from './itemEditorVariants.js';

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