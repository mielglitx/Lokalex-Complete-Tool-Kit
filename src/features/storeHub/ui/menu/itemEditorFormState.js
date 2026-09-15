// src/features/storeHub/ui/menu/itemEditorFormState.js
import { isAddonCategoryName } from '../../storeMenu.js';
import { storeHubState } from '../storeHubState.js';

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