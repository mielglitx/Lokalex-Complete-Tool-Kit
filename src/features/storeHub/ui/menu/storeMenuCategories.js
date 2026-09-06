// src/features/storeHub/ui/menu/storeMenuCategories.js
import { db } from '../../../../config/firebase.js';
import { appState } from '../../../../store/state.js';
import { showToast } from '../../../../ui/notifications.js';
import { escapeHtml } from '../../../../utils/helpers.js';
import { openSlideDeleteModal } from '../../../../ui/modals.js';
import { 
    RESERVED_ADDONS_CATEGORY, 
    isAddonCategoryName, 
    saveStoreCategory, 
    deleteStoreCategory,
    saveCategoryOrder
} from '../../storeMenu.js';
import { storeHubState, cleanFirebasePathKey } from '../storeHubState.js';
import { renderItemsFeed } from './storeMenuItemsFeed.js';
import { openCustomerStoreMenu, menusCache, storesCache, setCustomerStorePreviewMode } from '../../../customer/customerStoresMenu.js';

let categoryBeingEdited = null;
let stagedArrangeCategories = [];
let dragSrcIndex = null;

export function getSortedCategoriesList() {
    const rawCats = storeHubState.currentMenuData.categories || {};
    const list = Object.entries(rawCats).map(([key, val]) => ({
        id: key, // Strictly use exact Firebase node key for path integrity
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

export function toggleCategoryAddonRulesVisibility() {
    const isAddonCheckbox = document.getElementById('cat-input-is-addon');
    const rulesContainer = document.getElementById('cat-addon-rules-container');
    if (!rulesContainer) return;

    if (isAddonCheckbox?.checked) {
        rulesContainer.classList.remove('hidden');
    } else {
        rulesContainer.classList.add('hidden');
        const reqInput = document.getElementById('cat-input-is-required');
        const singleInput = document.getElementById('cat-input-is-single');
        if (reqInput) reqInput.checked = false;
        if (singleInput) singleInput.checked = false;
    }
}

export function openAddCategoryModal(catId = null, catName = '') {
    const modal = document.getElementById('store-category-modal');
    const title = document.getElementById('cat-modal-title');
    const input = document.getElementById('cat-input-name');
    const editIdInput = document.getElementById('cat-edit-id');
    const isAddonCheckbox = document.getElementById('cat-input-is-addon');
    const reqCheckbox = document.getElementById('cat-input-is-required');
    const singleCheckbox = document.getElementById('cat-input-is-single');

    const cleanCatId = (catId && catId !== 'undefined' && catId !== 'null') ? catId : null;
    const categories = getSortedCategoriesList();
    const existingCat = cleanCatId ? categories.find(c => c.id === cleanCatId || c.name === catName) : null;
    const isAddon = existingCat ? (existingCat.isAddonCategory || isAddonCategoryName(existingCat.name)) : isAddonCategoryName(catName);

    categoryBeingEdited = cleanCatId ? { 
        id: cleanCatId, 
        name: catName, 
        isAddonCategory: isAddon,
        isRequired: !!existingCat?.isRequired,
        isSingleChoice: !!existingCat?.isSingleChoice
    } : null;

    if (title) title.innerText = cleanCatId ? "Edit Category Name" : "Add New Category";
    if (editIdInput) editIdInput.value = cleanCatId || '';
    if (input) input.value = catName || '';

    if (isAddonCheckbox) {
        isAddonCheckbox.checked = isAddon;
        isAddonCheckbox.onchange = toggleCategoryAddonRulesVisibility;
    }
    if (reqCheckbox) reqCheckbox.checked = !!existingCat?.isRequired;
    if (singleCheckbox) singleCheckbox.checked = !!existingCat?.isSingleChoice;

    toggleCategoryAddonRulesVisibility();

    if (modal) modal.classList.remove('hidden');
    if (input) setTimeout(() => input.focus(), 100);
}

export function closeAddCategoryModal() {
    const modal = document.getElementById('store-category-modal');
    categoryBeingEdited = null;
    if (modal) modal.classList.add('hidden');
}

export function editCategoryModal(catId, catName) {
    openAddCategoryModal(catId, catName);
}

export async function submitAddCategory() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const input = document.getElementById('cat-input-name');
    const editIdInput = document.getElementById('cat-edit-id');
    const isAddonCheckbox = document.getElementById('cat-input-is-addon');
    const reqCheckbox = document.getElementById('cat-input-is-required');
    const singleCheckbox = document.getElementById('cat-input-is-single');

    const catName = (input?.value || '').trim();
    let editId = (editIdInput?.value || '').trim();

    if (editId === 'undefined' || editId === 'null' || editId === 'CAT_RESERVED_ADDONS') {
        editId = '';
    }

    const isAddon = !!isAddonCheckbox?.checked || isAddonCategoryName(catName);
    const isRequired = isAddon && !!reqCheckbox?.checked;
    const isSingleChoice = isAddon && !!singleCheckbox?.checked;

    if (!catName) {
        return showToast("⚠️ I-enter ang pangalan ng Kategorya!");
    }

    if (!storeId) {
        return showToast("⚠️ Store session not found. Please log in again.");
    }

    const saveBtn = document.getElementById('cat-save-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        const oldName = categoryBeingEdited ? categoryBeingEdited.name : null;
        await saveStoreCategory(storeId, catName, editId || null, oldName, isAddon, isRequired, isSingleChoice);
        closeAddCategoryModal();
    } catch (err) {
        console.error("Save category error:", err);
        showToast("❌ Failed to save category.");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-plus-circle"></i> SAVE CATEGORY`;
        }
    }
}

export function promptAddNewCategory() {
    openAddCategoryModal();
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

export function promptDeleteCategory(catId, catName) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    openSlideDeleteModal(
        `Delete Category?`,
        `Sigurado ka bang nais burahin ang kategoryang [${catName}]? Ang mga paninda rito ay ililipat sa 'General'.`,
        async () => {
            await deleteStoreCategory(storeId, catId, catName);
        }
    );
}

// ==========================================
// CATEGORY ARRANGE & FLIP-ANIMATED DRAG-AND-DROP
// ==========================================

export function openArrangeCategoriesModal() {
    const modal = document.getElementById('store-arrange-categories-modal');
    stagedArrangeCategories = getSortedCategoriesList();
    renderArrangeCategoriesList();
    if (modal) modal.classList.remove('hidden');
}

export function closeArrangeCategoriesModal() {
    const modal = document.getElementById('store-arrange-categories-modal');
    if (modal) modal.classList.add('hidden');
}

export function animateListReorder(updateCallback) {
    const container = document.getElementById('arrange-categories-list');
    if (!container) {
        updateCallback();
        return;
    }

    const firstRects = new Map();
    container.querySelectorAll('.arrange-cat-item').forEach(el => {
        firstRects.set(el.dataset.id, el.getBoundingClientRect());
    });

    updateCallback();

    container.querySelectorAll('.arrange-cat-item').forEach(el => {
        const id = el.dataset.id;
        const oldRect = firstRects.get(id);
        if (oldRect) {
            const newRect = el.getBoundingClientRect();
            const deltaY = oldRect.top - newRect.top;

            if (deltaY !== 0) {
                el.style.transform = `translateY(${deltaY}px)`;
                el.style.transition = 'none';

                requestAnimationFrame(() => {
                    el.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
                    el.style.transform = '';
                });
            }
        }
    });
}

export function renderArrangeCategoriesList() {
    const container = document.getElementById('arrange-categories-list');
    if (!container) return;

    const rawCats = storeHubState.currentMenuData.categories || {};
    const hasDbAddon = Object.values(rawCats).some(c => c?.isAddonCategory || isAddonCategoryName(c?.name));

    let displayList = [...stagedArrangeCategories];
    if (!hasDbAddon && !displayList.some(c => c.id === 'CAT_RESERVED_ADDONS')) {
        displayList.push({
            id: 'CAT_RESERVED_ADDONS',
            name: RESERVED_ADDONS_CATEGORY,
            isAddonCategory: true,
            orderIndex: 9999
        });
        stagedArrangeCategories = displayList;
    }

    if (stagedArrangeCategories.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-400 dark:text-gray-500 italic py-8 text-xs">
                No custom categories to arrange. Create categories first.
            </div>
        `;
        return;
    }

    container.innerHTML = stagedArrangeCategories.map((cat, idx) => {
        const isAddon = cat.isAddonCategory || isAddonCategoryName(cat.name);
        const isFirst = idx === 0;
        const isLast = idx === stagedArrangeCategories.length - 1;

        return `
        <div class="arrange-cat-item flex items-center justify-between p-2.5 bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-800 rounded-2xl gap-2 shadow-xs cursor-grab active:cursor-grabbing select-none"
             draggable="true"
             data-id="${cat.id}"
             data-index="${idx}">
            <div class="flex items-center gap-2 min-w-0 pointer-events-none">
                <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-grab active:cursor-grabbing px-1 text-xs pointer-events-auto" title="Drag to reorder">
                    <i class="fa-solid fa-grip-vertical"></i>
                </span>
                <span class="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-mono font-bold text-[10px] flex items-center justify-center shrink-0">
                    ${idx + 1}
                </span>
                <span class="font-bold text-xs text-gray-900 dark:text-white truncate">
                    ${escapeHtml(cat.name)}
                </span>
                ${isAddon ? `<span class="text-[9px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 px-1.5 py-0.2 rounded font-bold shrink-0">Add-on</span>` : ''}
            </div>

            <div class="flex items-center gap-1 shrink-0">
                <button type="button" onclick="window.moveCategoryOrder(${idx}, -1)" ${isFirst ? 'disabled class="opacity-20 cursor-not-allowed p-1.5 text-gray-400 text-xs"' : 'class="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg active:scale-90 text-xs transition-all duration-200"'} title="Move Up">
                    <i class="fa-solid fa-arrow-up"></i>
                </button>
                <button type="button" onclick="window.moveCategoryOrder(${idx}, 1)" ${isLast ? 'disabled class="opacity-20 cursor-not-allowed p-1.5 text-gray-400 text-xs"' : 'class="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg active:scale-90 text-xs transition-all duration-200"'} title="Move Down">
                    <i class="fa-solid fa-arrow-down"></i>
                </button>
            </div>
        </div>
        `;
    }).join('');

    attachStableDragAndDropListeners(container);
}

function attachStableDragAndDropListeners(container) {
    const items = container.querySelectorAll('.arrange-cat-item');

    items.forEach(item => {
        item.addEventListener('dragstart', (e) => {
            dragSrcIndex = parseInt(item.dataset.index);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', dragSrcIndex);
            
            setTimeout(() => {
                item.classList.add('opacity-40', 'scale-[1.02]', 'shadow-2xl', 'border-blue-500', 'border-dashed', 'bg-blue-50/10');
            }, 0);
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            const targetIndex = parseInt(item.dataset.index);
            if (dragSrcIndex !== null && !isNaN(targetIndex) && dragSrcIndex !== targetIndex) {
                animateListReorder(() => {
                    const moved = stagedArrangeCategories.splice(dragSrcIndex, 1)[0];
                    stagedArrangeCategories.splice(targetIndex, 0, moved);
                    renderArrangeCategoriesList();
                });
            }
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('opacity-40', 'scale-[1.02]', 'shadow-2xl', 'border-blue-500', 'border-dashed', 'bg-blue-50/10');
            dragSrcIndex = null;
        });

        let touchStartIdx = null;

        item.addEventListener('touchstart', (e) => {
            const handle = e.target.closest('.drag-handle');
            if (!handle) return;
            touchStartIdx = parseInt(item.dataset.index);
            item.classList.add('opacity-60', 'scale-[1.02]', 'shadow-xl', 'border-blue-500', 'bg-blue-50/20');
        }, { passive: true });

        item.addEventListener('touchend', (e) => {
            if (touchStartIdx === null) return;
            const touchY = e.changedTouches[0].clientY;
            const touchX = e.changedTouches[0].clientX;
            const targetEl = document.elementFromPoint(touchX, touchY)?.closest('.arrange-cat-item');
            
            item.classList.remove('opacity-60', 'scale-[1.02]', 'shadow-xl', 'border-blue-500', 'bg-blue-50/20');

            if (targetEl) {
                const targetIndex = parseInt(targetEl.dataset.index);
                if (!isNaN(targetIndex) && targetIndex !== touchStartIdx) {
                    animateListReorder(() => {
                        const moved = stagedArrangeCategories.splice(touchStartIdx, 1)[0];
                        stagedArrangeCategories.splice(targetIndex, 0, moved);
                        renderArrangeCategoriesList();
                    });
                }
            }
            touchStartIdx = null;
        });
    });
}

export function moveCategoryOrder(idx, delta) {
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= stagedArrangeCategories.length) return;

    animateListReorder(() => {
        const temp = stagedArrangeCategories[idx];
        stagedArrangeCategories[idx] = stagedArrangeCategories[targetIdx];
        stagedArrangeCategories[targetIdx] = temp;
        renderArrangeCategoriesList();
    });
}

export function applyAutoSortCategories(mode) {
    animateListReorder(() => {
        if (mode === 'name') {
            stagedArrangeCategories.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            showToast("🔤 Sorted alphabetically (A-Z)!");
        } else if (mode === 'newest') {
            stagedArrangeCategories.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            showToast("🕒 Sorted by newest categories first!");
        }
        renderArrangeCategoriesList();
    });
}

export async function submitSaveCategoryOrder() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);

    if (!storeId) return showToast("⚠️ Store ID not found.");

    const saveBtn = document.getElementById('arrange-cats-save-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        // Filter out virtual/reserved fallback IDs (e.g. CAT_RESERVED_ADDONS) before writing to Firebase
        const validCategoriesToSave = stagedArrangeCategories.filter(c => c && c.id && c.id !== 'CAT_RESERVED_ADDONS');
        const orderedCategoryIds = validCategoriesToSave.map(c => c.id);

        if (orderedCategoryIds.length > 0) {
            await saveCategoryOrder(storeId, orderedCategoryIds);

            orderedCategoryIds.forEach((id, idx) => {
                if (storeHubState.currentMenuData.categories[id]) {
                    storeHubState.currentMenuData.categories[id].orderIndex = idx;
                }
            });
        }

        closeArrangeCategoriesModal();
        renderCategoriesBar();
        renderItemsFeed();
        showToast("✅ Category arrangement saved!");
    } catch (e) {
        console.error("Save category order error:", e);
        showToast("❌ Failed to save arrangement.");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> SAVE CATEGORY ORDER`;
        }
    }
}

// ==========================================
// STOREFRONT LIVE MENU PREVIEW
// ==========================================

export function previewStorefrontMenu() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);

    if (!storeId) {
        return showToast("⚠️ Store session not found. Please log in again.");
    }

    const currentStore = storeHubState.currentStoreData || {};
    const storeName = currentStore.storeName || appState.merchantStoreName || localStorage.getItem('lokalex_merchant_store_name') || "Store Menu";
    const address = currentStore.address || "Poblacion Area";
    const logoUrl = currentStore.logoUrl || "";
    const isOpen = currentStore.isOpen !== false;

    if (typeof storesCache !== 'undefined') {
        storesCache[storeId] = {
            storeName,
            address,
            logoUrl,
            isOpen
        };
    }

    if (typeof menusCache !== 'undefined') {
        menusCache[storeId] = JSON.parse(JSON.stringify(storeHubState.currentMenuData || { categories: {}, items: {} }));
    }

    setCustomerStorePreviewMode(true);

    const storeModal = document.getElementById('cust-store-menu-modal');
    if (storeModal && storeModal.parentElement !== document.body) {
        document.body.appendChild(storeModal);
    }

    const custModal = document.getElementById('cust-item-customizer-modal');
    if (custModal && custModal.parentElement !== document.body) {
        document.body.appendChild(custModal);
    }

    if (!storeModal) {
        return showToast("⚠️ Customer store menu modal not found in DOM.");
    }

    openCustomerStoreMenu(storeId);
    showToast("👀 Previewing customer storefront menu (Ordering disabled)");
}

if (typeof window !== 'undefined') {
    window.toggleCategoryAddonRulesVisibility = toggleCategoryAddonRulesVisibility;
    window.openArrangeCategoriesModal = openArrangeCategoriesModal;
    window.closeArrangeCategoriesModal = closeArrangeCategoriesModal;
    window.renderArrangeCategoriesList = renderArrangeCategoriesList;
    window.moveCategoryOrder = moveCategoryOrder;
    window.applyAutoSortCategories = applyAutoSortCategories;
    window.submitSaveCategoryOrder = submitSaveCategoryOrder;
    window.previewStorefrontMenu = previewStorefrontMenu;
}