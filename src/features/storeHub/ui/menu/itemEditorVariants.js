// src/features/storeHub/ui/menu/itemEditorVariants.js
import { escapeHtml } from '../../../../utils/helpers.js';
import { RESERVED_ADDONS_CATEGORY, isAddonCategoryName } from '../../storeMenu.js';
import { storeHubState } from '../storeHubState.js';
import { updateBasePriceVoidState } from './itemEditorFormState.js';

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