// src/features/customer/stores/customerStoreList.js
import { escapeHtml } from '../../../utils/helpers.js';
import { updateFloatingCartBadge } from '../customerOrders.js';
import { 
    storesCache, 
    menusCache, 
    setStoresCache, 
    setCustomerStorePreviewMode, 
    isStoreCurrentlyOpen 
} from './customerStoreHours.js';

export function openCustomerStoresModal() {
    setCustomerStorePreviewMode(false);
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
                setStoresCache(JSON.parse(localCached));
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
        const isOpen = isStoreCurrentlyOpen(store, storeId);
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