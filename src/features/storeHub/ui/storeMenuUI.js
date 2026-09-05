// src/features/storeHub/ui/storeMenuUI.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { openSlideDeleteModal } from '../../../ui/modals.js';
import { 
    saveStoreCategory, 
    deleteStoreCategory, 
    saveMenuItem, 
    deleteMenuItem, 
    toggleItemStockStatus, 
    toggleSizeStockStatus, 
    toggleAddonStockStatus 
} from '../storeMenu.js';
import { storeHubState, cleanFirebasePathKey } from './storeHubState.js';

export function openAddCategoryModal() {
    const modal = document.getElementById('store-category-modal');
    const input = document.getElementById('cat-input-name');
    if (input) input.value = '';
    if (modal) modal.classList.remove('hidden');
    if (input) setTimeout(() => input.focus(), 100);
}

export function closeAddCategoryModal() {
    const modal = document.getElementById('store-category-modal');
    if (modal) modal.classList.add('hidden');
}

export async function submitAddCategory() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const input = document.getElementById('cat-input-name');
    const catName = (input?.value || '').trim();

    if (!catName) {
        return showToast("⚠️ I-enter ang pangalan ng Kategorya!");
    }

    const saveBtn = document.getElementById('cat-save-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        await saveStoreCategory(storeId, catName);
        closeAddCategoryModal();
    } catch (err) {
        showToast("❌ Failed to add category.");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-plus-circle"></i> CREATE CATEGORY`;
        }
    }
}

export function promptAddNewCategory() {
    openAddCategoryModal();
}

export function renderCategoriesBar() {
    const pillsContainer = document.getElementById('merch-category-pills');
    const subPillsContainer = document.getElementById('merch-subcategory-pills');
    const catSelect = document.getElementById('item-input-category');
    const totalCatsBadge = document.getElementById('merch-total-cats-badge');

    const categories = Object.values(storeHubState.currentMenuData.categories || {});
    if (totalCatsBadge) totalCatsBadge.innerText = `${categories.length} Categories`;

    if (catSelect) {
        catSelect.innerHTML = categories.length > 0
            ? categories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('')
            : `<option value="General">General</option>`;
    }

    if (!pillsContainer) return;

    let html = `
        <button onclick="window.selectCategoryFilter('ALL')" class="${storeHubState.selectedCategoryId === 'ALL' ? 'bg-orange-600 text-white' : 'bg-cardBg border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300'} text-xs font-bold px-3 py-1.5 rounded-xl shrink-0 transition">
            All Items
        </button>
    `;

    categories.forEach(cat => {
        const isSelected = storeHubState.selectedCategoryId === cat.name;
        html += `
            <div class="shrink-0 flex items-center bg-cardBg border ${isSelected ? 'border-orange-500 text-orange-600 dark:text-orange-400' : 'border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300'} rounded-xl overflow-hidden">
                <button onclick="window.selectCategoryFilter('${escapeHtml(cat.name)}')" class="text-xs font-bold px-3 py-1.5 transition">
                    ${escapeHtml(cat.name)}
                </button>
                <button onclick="window.promptDeleteCategory('${cat.id}', '${escapeHtml(cat.name)}')" class="pr-2 pl-1 text-[10px] text-gray-400 hover:text-red-500 transition" title="Delete Category">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;
    });

    pillsContainer.innerHTML = html;

    const items = Object.values(storeHubState.currentMenuData.items || {});
    const subCats = new Set();
    items.forEach(it => {
        if ((storeHubState.selectedCategoryId === 'ALL' || it.category === storeHubState.selectedCategoryId) && it.subCategory) {
            subCats.add(it.subCategory.trim());
        }
    });

    if (subCats.size > 0 && subPillsContainer) {
        subPillsContainer.classList.remove('hidden');
        let subHtml = `
            <button onclick="window.selectSubCategoryFilter('ALL')" class="${storeHubState.selectedSubCategory === 'ALL' ? 'bg-blue-600 text-white' : 'bg-cardBg border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-400'} text-[10px] font-bold px-2.5 py-1 rounded-lg shrink-0 transition">
                All Subcategories
            </button>
        `;
        subCats.forEach(sub => {
            const isSubSelected = storeHubState.selectedSubCategory === sub;
            subHtml += `
                <button onclick="window.selectSubCategoryFilter('${escapeHtml(sub)}')" class="${isSubSelected ? 'bg-blue-600 text-white' : 'bg-cardBg border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-400'} text-[10px] font-bold px-2.5 py-1 rounded-lg shrink-0 transition">
                    ${escapeHtml(sub)}
                </button>
            `;
        });
        subPillsContainer.innerHTML = subHtml;
    } else if (subPillsContainer) {
        subPillsContainer.classList.add('hidden');
    }
}

export function selectCategoryFilter(catName) {
    storeHubState.selectedCategoryId = catName;
    storeHubState.selectedSubCategory = 'ALL';
    renderCategoriesBar();
    renderItemsFeed();
}

export function selectSubCategoryFilter(subName) {
    storeHubState.selectedSubCategory = subName;
    renderCategoriesBar();
    renderItemsFeed();
}

export function promptDeleteCategory(catId, catName) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    openSlideDeleteModal(
        `Delete Category?`,
        `Sigurado ka bang nais burahin ang kategoryang [${catName}]?`,
        () => {
            deleteStoreCategory(storeId, catId, catName);
        }
    );
}

export function renderItemsFeed() {
    const feed = document.getElementById('merch-items-feed');
    const totalItemsBadge = document.getElementById('merch-total-items-badge');
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);

    if (!feed) return;

    let items = Object.values(storeHubState.currentMenuData.items || {});
    if (totalItemsBadge) totalItemsBadge.innerText = `${items.length} Items`;

    if (storeHubState.selectedCategoryId !== 'ALL') {
        items = items.filter(it => it.category === storeHubState.selectedCategoryId);
    }
    if (storeHubState.selectedSubCategory !== 'ALL') {
        items = items.filter(it => it.subCategory === storeHubState.selectedSubCategory);
    }

    if (items.length === 0) {
        feed.innerHTML = `
            <div class="text-center text-gray-500 dark:text-gray-400 italic py-12 text-xs bg-cardBg border border-gray-200 dark:border-gray-800 rounded-2xl p-6 flex flex-col items-center gap-2">
                <i class="fa-solid fa-utensils text-2xl text-gray-400 dark:text-gray-600"></i>
                <span>No menu items found in this section. Tap "+ Add New Item" to create one.</span>
            </div>
        `;
        return;
    }

    feed.innerHTML = items.map(item => {
        const isAvail = item.isAvailable !== false;
        const sizes = item.sizes || [];
        const addons = item.addons || [];

        let upgradesPreview = '';
        if (sizes.length > 0) {
            const sizesHtml = sizes.map((s, sIdx) => {
                const sAvail = s.isAvailable !== false;
                return `
                    <button onclick="window.toggleSizeStock('${storeId}', '${item.id}', ${sIdx}, ${sAvail})" class="inline-flex items-center gap-1 text-[9.5px] px-1.5 py-0.5 rounded border ${sAvail ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700/40' : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-700/40 line-through'} transition active:scale-95">
                        <span>${escapeHtml(s.name)} (+₱${parseFloat(s.priceDelta || 0).toFixed(0)})</span>
                        <span class="font-black text-[8px]">${sAvail ? '✓' : '86'}</span>
                    </button>
                `;
            }).join('');
            upgradesPreview += `<div class="flex flex-wrap gap-1 items-center mt-1"><span class="text-[9px] font-bold text-gray-400 uppercase">Sizes:</span> ${sizesHtml}</div>`;
        }

        if (addons.length > 0) {
            const addonsHtml = addons.map((a, aIdx) => {
                const aAvail = a.isAvailable !== false;
                return `
                    <button onclick="window.toggleAddonStock('${storeId}', '${item.id}', ${aIdx}, ${aAvail})" class="inline-flex items-center gap-1 text-[9.5px] px-1.5 py-0.5 rounded border ${aAvail ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700/40' : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-700/40 line-through'} transition active:scale-95">
                        <span>${escapeHtml(a.name)} (+₱${parseFloat(a.priceDelta || 0).toFixed(0)})</span>
                        <span class="font-black text-[8px]">${aAvail ? '✓' : '86'}</span>
                    </button>
                `;
            }).join('');
            upgradesPreview += `<div class="flex flex-wrap gap-1 items-center mt-1"><span class="text-[9px] font-bold text-gray-400 uppercase">Extras:</span> ${addonsHtml}</div>`;
        }

        return `
        <div class="bg-cardBg border border-gray-200 dark:border-gray-800 rounded-2xl p-3.5 flex items-start justify-between gap-3 shadow-xs">
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-black text-sm text-gray-900 dark:text-white">${escapeHtml(item.name)}</span>
                    <span class="text-xs font-mono font-black text-emerald-600 dark:text-emerald-400">₱${parseFloat(item.basePrice || 0).toFixed(2)}</span>
                    ${item.subCategory ? `<span class="text-[9px] bg-gray-100 dark:bg-darkBg text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-800 px-1.5 py-0.5 rounded">${escapeHtml(item.subCategory)}</span>` : ''}
                </div>

                ${item.description ? `<p class="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-snug">${escapeHtml(item.description)}</p>` : ''}
                
                <div class="mt-1">
                    ${upgradesPreview}
                </div>
            </div>

            <div class="flex flex-col items-end gap-2 shrink-0">
                <button onclick="window.toggleItemStock('${item.id}', ${isAvail})" class="text-[10px] font-bold px-2 py-1 rounded-lg border transition active:scale-95 ${isAvail ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-700 dark:text-red-400'}">
                    ${isAvail ? '🟢 IN STOCK' : '🔴 SOLD OUT'}
                </button>

                <div class="flex items-center gap-1.5">
                    <button onclick="window.editMenuItemModal('${item.id}')" class="bg-gray-100 hover:bg-gray-200 text-amber-600 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-amber-400 p-2 rounded-xl text-xs transition active:scale-95" title="Edit Item">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button onclick="window.promptDeleteMenuItem('${item.id}', '${escapeHtml(item.name)}')" class="bg-gray-100 hover:bg-gray-200 text-red-600 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-red-400 p-2 rounded-xl text-xs transition active:scale-95" title="Delete Item">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

export function toggleItemStock(itemId, currentStatus) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    toggleItemStockStatus(storeId, itemId, currentStatus);
}

export function toggleSizeStock(storeId, itemId, sizeIdx, currentStatus) {
    toggleSizeStockStatus(storeId, itemId, sizeIdx, currentStatus);
}

export function toggleAddonStock(storeId, itemId, addonIdx, currentStatus) {
    toggleAddonStockStatus(storeId, itemId, addonIdx, currentStatus);
}

export function promptDeleteMenuItem(itemId, itemName) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    openSlideDeleteModal(
        `Delete Menu Item?`,
        `Sigurado ka bang nais burahin ang panindang [${itemName}]?`,
        () => {
            deleteMenuItem(storeId, itemId, itemName);
        }
    );
}

export function openItemEditorModal(item = null) {
    const modal = document.getElementById('store-item-modal');
    const title = document.getElementById('item-modal-title');
    const idInput = document.getElementById('item-edit-id');
    const nameInput = document.getElementById('item-input-name');
    const priceInput = document.getElementById('item-input-price');
    const catInput = document.getElementById('item-input-category');
    const subCatInput = document.getElementById('item-input-subcategory');
    const descInput = document.getElementById('item-input-desc');
    const imgInput = document.getElementById('item-input-image');
    const sizesContainer = document.getElementById('item-sizes-container');
    const addonsContainer = document.getElementById('item-addons-container');

    if (sizesContainer) sizesContainer.innerHTML = '';
    if (addonsContainer) addonsContainer.innerHTML = '';

    if (item) {
        if (title) title.innerText = "Edit Menu Item";
        if (idInput) idInput.value = item.id;
        if (nameInput) nameInput.value = item.name || '';
        if (priceInput) priceInput.value = item.basePrice || '';
        if (catInput) catInput.value = item.category || 'General';
        if (subCatInput) subCatInput.value = item.subCategory || '';
        if (descInput) descInput.value = item.description || '';
        if (imgInput) imgInput.value = item.imageUrl || '';

        (item.sizes || []).forEach(s => addSizeVariantRow(s.name, s.priceDelta));
        (item.addons || []).forEach(a => addAddonRow(a.name, a.priceDelta));
    } else {
        if (title) title.innerText = "Add Menu Item";
        if (idInput) idInput.value = '';
        if (nameInput) nameInput.value = '';
        if (priceInput) priceInput.value = '';
        if (subCatInput) subCatInput.value = '';
        if (descInput) descInput.value = '';
        if (imgInput) imgInput.value = '';
    }

    if (modal) modal.classList.remove('hidden');
}

export function closeItemEditorModal() {
    const modal = document.getElementById('store-item-modal');
    if (modal) modal.classList.add('hidden');
}

export function editMenuItemModal(itemId) {
    const item = storeHubState.currentMenuData.items ? storeHubState.currentMenuData.items[itemId] : null;
    if (item) openItemEditorModal(item);
}

export function addSizeVariantRow(name = '', priceDelta = 0) {
    const container = document.getElementById('item-sizes-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = "flex items-center gap-2 size-variant-row";
    row.innerHTML = `
        <input type="text" placeholder="Size (e.g. Medium 16oz / Large 22oz)" value="${escapeHtml(name)}" class="flex-1 bg-inputBg text-xs rounded-xl p-2 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white font-bold size-name-input">
        <input type="number" step="0.01" placeholder="+₱ Delta" value="${priceDelta}" class="w-24 bg-inputBg text-xs rounded-xl p-2 border border-gray-300 dark:border-gray-700 outline-none text-blue-600 dark:text-blue-400 font-mono font-bold size-delta-input">
        <button type="button" onclick="this.parentElement.remove()" class="text-gray-400 hover:text-red-500 p-1 text-sm"><i class="fa-solid fa-trash"></i></button>
    `;
    container.appendChild(row);
}

export function addAddonRow(name = '', priceDelta = 0) {
    const container = document.getElementById('item-addons-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = "flex items-center gap-2 addon-row";
    row.innerHTML = `
        <input type="text" placeholder="Add-on (e.g. Boba / Extra Egg)" value="${escapeHtml(name)}" class="flex-1 bg-inputBg text-xs rounded-xl p-2 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white font-bold addon-name-input">
        <input type="number" step="0.01" placeholder="+₱ Price" value="${priceDelta}" class="w-24 bg-inputBg text-xs rounded-xl p-2 border border-gray-300 dark:border-gray-700 outline-none text-amber-600 dark:text-amber-400 font-mono font-bold addon-delta-input">
        <button type="button" onclick="this.parentElement.remove()" class="text-gray-400 hover:text-red-500 p-1 text-sm"><i class="fa-solid fa-trash"></i></button>
    `;
    container.appendChild(row);
}

export async function submitSaveStoreItem() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const id = document.getElementById('item-edit-id')?.value.trim();
    const name = document.getElementById('item-input-name')?.value.trim();
    const basePrice = parseFloat(document.getElementById('item-input-price')?.value);
    const category = document.getElementById('item-input-category')?.value.trim() || 'General';
    const subCategory = document.getElementById('item-input-subcategory')?.value.trim();
    const description = document.getElementById('item-input-desc')?.value.trim();
    const imageUrl = document.getElementById('item-input-image')?.value.trim();

    if (!name) return showToast("⚠️ Item Name is required!");
    if (isNaN(basePrice) || basePrice < 0) return showToast("⚠️ Valid Base Price is required!");

    const sizes = [];
    document.querySelectorAll('.size-variant-row').forEach(row => {
        const sName = row.querySelector('.size-name-input')?.value.trim();
        const sDelta = parseFloat(row.querySelector('.size-delta-input')?.value) || 0;
        if (sName) sizes.push({ name: sName, priceDelta: sDelta, isAvailable: true });
    });

    const addons = [];
    document.querySelectorAll('.addon-row').forEach(row => {
        const aName = row.querySelector('.addon-name-input')?.value.trim();
        const aDelta = parseFloat(row.querySelector('.addon-delta-input')?.value) || 0;
        if (aName) addons.push({ name: aName, priceDelta: aDelta, isAvailable: true });
    });

    const itemPayload = {
        id: id || null,
        name,
        basePrice,
        category,
        subCategory,
        description,
        imageUrl,
        sizes,
        addons,
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