// src/features/storeHub/ui/menu/storeMenuItemsFeed.js
import { appState } from '../../../../store/state.js';
import { escapeHtml } from '../../../../utils/helpers.js';
import { openSlideDeleteModal } from '../../../../ui/modals.js';
import { 
    RESERVED_ADDONS_CATEGORY,
    deleteMenuItem, 
    toggleItemStockStatus, 
    toggleSizeStockStatus, 
    toggleAddonStockStatus 
} from '../../storeMenu.js';
import { storeHubState, cleanFirebasePathKey } from '../storeHubState.js';

export function renderItemCard(item, storeId) {
    const isAvail = item.isAvailable !== false;
    const sizes = item.sizes || [];
    const addons = item.addons || [];

    let upgradesPreview = '';
    if (sizes.length > 0) {
        const sizesHtml = sizes.map((s, sIdx) => {
            const sAvail = s.isAvailable !== false;
            return `
                <button onclick="window.toggleSizeStock('${storeId}', '${item.id}', ${sIdx}, ${sAvail})" class="inline-flex items-center gap-1 text-[9.5px] px-1.5 py-0.5 rounded border ${sAvail ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700/40' : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-700/40 line-through'} transition active:scale-95">
                    <span>${escapeHtml(s.name)} (₱${parseFloat(s.priceDelta || 0).toFixed(0)})</span>
                    <span class="font-black text-[8px]">${sAvail ? '✓' : '86'}</span>
                </button>
            `;
        }).join('');
        upgradesPreview += `<div class="flex flex-wrap gap-1 items-center mt-1.5"><span class="text-[9px] font-bold text-gray-400 uppercase">Sizes:</span> ${sizesHtml}</div>`;
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

    const imageHtml = item.imageUrl ? `
        <div class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-darkBg overflow-hidden border border-gray-200 dark:border-gray-800 shrink-0 shadow-inner">
            <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" class="w-full h-full object-cover">
        </div>
    ` : `
        <div class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-darkBg border border-gray-200 dark:border-gray-800 flex items-center justify-center text-gray-400 shrink-0">
            <i class="fa-solid fa-utensils text-xl opacity-40"></i>
        </div>
    `;

    const displayPrice = sizes.length > 0 
        ? `From ₱${parseFloat(sizes[0].priceDelta || 0).toFixed(2)}`
        : `₱${parseFloat(item.basePrice || 0).toFixed(2)}`;

    return `
    <div class="bg-cardBg border border-gray-200 dark:border-gray-800 rounded-2xl p-3 flex items-start gap-3 shadow-xs transition hover:border-orange-500/40">
        ${imageHtml}

        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
                <span class="font-black text-sm text-gray-900 dark:text-white leading-tight">${escapeHtml(item.name)}</span>
                <span class="text-xs font-mono font-black text-emerald-600 dark:text-emerald-400">${displayPrice}</span>
                ${item.isAddonOnly ? `<span class="text-[8.5px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 px-1.5 py-0.2 rounded font-bold">Add-on Only</span>` : ''}
            </div>

            ${item.description ? `<p class="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-snug line-clamp-2">${escapeHtml(item.description)}</p>` : ''}
            
            ${upgradesPreview}
        </div>

        <div class="flex flex-col items-end justify-between self-stretch gap-2 shrink-0">
            <button onclick="window.toggleItemStock('${item.id}', ${isAvail})" class="text-[10px] font-bold px-2 py-1 rounded-lg border transition active:scale-95 ${isAvail ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-700 dark:text-red-400'}">
                ${isAvail ? '🟢 IN STOCK' : '🔴 SOLD OUT'}
            </button>

            <div class="flex items-center gap-1.5">
                <button onclick="window.editMenuItemModal('${item.id}')" class="bg-gray-100 hover:bg-gray-200 text-amber-600 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-amber-400 p-2 rounded-xl text-xs transition active:scale-95 shadow-xs" title="Edit Item">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button onclick="window.promptDeleteMenuItem('${item.id}', '${escapeHtml(item.name)}')" class="bg-gray-100 hover:bg-gray-200 text-red-600 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-red-400 p-2 rounded-xl text-xs transition active:scale-95 shadow-xs" title="Delete Item">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>
    </div>
    `;
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
        items = items.filter(it => (it.category || 'General').toLowerCase() === storeHubState.selectedCategoryId.toLowerCase());
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

    if (storeHubState.selectedCategoryId === 'ALL') {
        const groups = {};
        items.forEach(it => {
            const cat = it.category || 'General';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(it);
        });

        // Arrange category group blocks by orderIndex
        const rawCats = storeHubState.currentMenuData.categories || {};
        const catOrderMap = {};
        Object.values(rawCats).forEach(c => {
            if (c && c.name) {
                catOrderMap[c.name.trim().toLowerCase()] = c.orderIndex !== undefined ? c.orderIndex : 9999;
            }
        });

        const sortedCatNames = Object.keys(groups).sort((a, b) => {
            const orderA = catOrderMap[a.trim().toLowerCase()] !== undefined ? catOrderMap[a.trim().toLowerCase()] : 9999;
            const orderB = catOrderMap[b.trim().toLowerCase()] !== undefined ? catOrderMap[b.trim().toLowerCase()] : 9999;
            if (orderA !== orderB) return orderA - orderB;
            return a.localeCompare(b);
        });

        let groupedHtml = '';
        sortedCatNames.forEach(catName => {
            const catItems = groups[catName];
            const isReserved = catName.toLowerCase() === RESERVED_ADDONS_CATEGORY.toLowerCase();

            groupedHtml += `
                <div class="flex flex-col gap-2.5">
                    <div class="flex items-center justify-between px-1 pt-1 border-b border-gray-200 dark:border-gray-800 pb-1.5">
                        <div class="flex items-center gap-2">
                            <span class="font-black text-xs text-gray-900 dark:text-white uppercase tracking-wide flex items-center gap-1.5">
                                <i class="fa-solid ${isReserved ? 'fa-sparkles text-amber-500' : 'fa-bookmark text-orange-500'} text-[11px]"></i> ${escapeHtml(catName)}
                            </span>
                            <span class="text-[10px] bg-gray-100 dark:bg-darkBg text-gray-600 dark:text-gray-400 font-mono font-bold px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-800">
                                ${catItems.length}
                            </span>
                        </div>
                        <button onclick="window.openItemEditorModal(null, '${escapeHtml(catName)}')" class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1">
                            <i class="fa-solid fa-plus"></i> Add here
                        </button>
                    </div>

                    <div class="flex flex-col gap-2.5">
                        ${catItems.map(item => renderItemCard(item, storeId)).join('')}
                    </div>
                </div>
            `;
        });

        feed.innerHTML = groupedHtml;
    } else {
        feed.innerHTML = `
            <div class="flex flex-col gap-2.5">
                ${items.map(item => renderItemCard(item, storeId)).join('')}
            </div>
        `;
    }
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