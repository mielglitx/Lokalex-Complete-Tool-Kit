// src/features/storeHub/ui/menu/categoryCore.js
import { appState } from '../../../../store/state.js';
import { showToast } from '../../../../ui/notifications.js';
import { escapeHtml } from '../../../../utils/helpers.js';
import { 
    RESERVED_ADDONS_CATEGORY, 
    isAddonCategoryName, 
    saveStoreCategory 
} from '../../storeMenu.js';
import { storeHubState, cleanFirebasePathKey } from '../storeHubState.js';
import { renderItemsFeed } from './storeMenuItemsFeed.js';

export function getSortedCategoriesList() {
    const rawCats = storeHubState.currentMenuData.categories || {};
    const list = Object.entries(rawCats).map(([key, val]) => ({
        id: key,
        name: val?.name || key,
        orderIndex: val?.orderIndex !== undefined && val?.orderIndex !== null ? val.orderIndex : 9999,
        createdAt: val?.createdAt || 0,
        ...(val || {})
    }));

    list.sort((a, b) => {
        if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
        return (a.createdAt || 0) - (b.createdAt || 0);
    });

    return list;
}

export function renderCategoriesBar() {
    const pillsContainer = document.getElementById('merch-category-pills');
    const catSelect = document.getElementById('item-input-category');
    const totalCatsBadge = document.getElementById('merch-total-cats-badge');

    const categories = getSortedCategoriesList();

    let hasAddonCategory = categories.some(c => c.isAddonCategory || isAddonCategoryName(c.name));
    let displayCategories = [...categories];

    if (!hasAddonCategory) {
        displayCategories.push({
            id: 'CAT_RESERVED_ADDONS',
            name: RESERVED_ADDONS_CATEGORY,
            isAddonCategory: true
        });
    }

    if (totalCatsBadge) {
        totalCatsBadge.innerText = `${displayCategories.length} Categories`;
    }

    if (catSelect) {
        const currentVal = catSelect.value;
        const opts = displayCategories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`);
        if (!displayCategories.some(c => c.name.toLowerCase() === 'general')) {
            opts.unshift(`<option value="General">General</option>`);
        }
        catSelect.innerHTML = opts.join('');
        if (currentVal) catSelect.value = currentVal;
    }

    if (!pillsContainer) return;

    const isAllSelected = storeHubState.selectedCategoryId === 'ALL';

    let html = `
        <button onclick="window.selectCategoryFilter('ALL')" class="${isAllSelected ? 'bg-orange-600 text-white shadow-xs font-black' : 'bg-cardBg border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 font-bold'} text-xs px-3.5 py-1.5 rounded-xl shrink-0 transition">
            All Items
        </button>
    `;

    displayCategories.forEach(cat => {
        const isSelected = storeHubState.selectedCategoryId.toLowerCase() === cat.name.toLowerCase();
        const isAddon = cat.isAddonCategory || isAddonCategoryName(cat.name);

        html += `
            <div class="shrink-0 flex items-center bg-cardBg border ${isSelected ? 'border-orange-500 text-orange-600 dark:text-orange-400 font-black' : 'border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 font-bold'} rounded-xl overflow-hidden shadow-xs">
                <button onclick="window.selectCategoryFilter('${escapeHtml(cat.name)}')" class="text-xs px-3 py-1.5 transition flex items-center gap-1.5">
                    ${isAddon ? '<i class="fa-solid fa-sparkles text-amber-500 text-[10px]"></i>' : ''}
                    <span>${escapeHtml(cat.name)}</span>
                </button>
                <button onclick="window.editCategoryModal('${cat.id}', '${escapeHtml(cat.name)}')" class="px-1 text-[10px] text-gray-400 hover:text-amber-500 transition" title="Rename Category">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button onclick="window.promptDeleteCategory('${cat.id}', '${escapeHtml(cat.name)}')" class="pr-2 pl-1 text-[10px] text-gray-400 hover:text-red-500 transition" title="Delete Category">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;
    });

    pillsContainer.innerHTML = html;
}

export function selectCategoryFilter(catName) {
    storeHubState.selectedCategoryId = catName;
    renderCategoriesBar();
    renderItemsFeed();
}

export async function promptQuickAddCategory() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const newCatName = window.prompt("Enter new category name:");

    if (!newCatName || !newCatName.trim()) return;

    try {
        const isAddon = isAddonCategoryName(newCatName.trim());
        await saveStoreCategory(storeId, newCatName.trim(), null, null, isAddon, false, false);
        const catSelect = document.getElementById('item-input-category');
        if (catSelect) {
            const opt = document.createElement('option');
            opt.value = newCatName.trim();
            opt.innerText = newCatName.trim();
            opt.selected = true;
            catSelect.appendChild(opt);
        }
        showToast(`✅ Created and selected [${newCatName.trim()}]`);
    } catch (e) {
        console.error("Quick add category error:", e);
        showToast("❌ Failed to create category.");
    }
}