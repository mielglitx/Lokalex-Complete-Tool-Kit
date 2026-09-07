// src/features/storeHub/ui/menu/categoryReorder.js
import { appState } from '../../../../store/state.js';
import { showToast } from '../../../../ui/notifications.js';
import { escapeHtml } from '../../../../utils/helpers.js';
import { 
    RESERVED_ADDONS_CATEGORY, 
    isAddonCategoryName, 
    saveCategoryOrder 
} from '../../storeMenu.js';
import { storeHubState, cleanFirebasePathKey } from '../storeHubState.js';
import { renderItemsFeed } from './storeMenuItemsFeed.js';
import { getSortedCategoriesList, renderCategoriesBar } from './categoryCore.js';

let stagedArrangeCategories = [];
let dragSrcIndex = null;

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