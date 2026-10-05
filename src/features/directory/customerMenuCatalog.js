// src/features/directory/customerMenuCatalog.js

import { db } from '../../config/firebase.js';
import { escapeHtml } from '../../utils/helpers.js';
import { openStoreMenuGalleryModal } from './directoryUi.js';

let cachedCatalogStores = [];

/**
 * Loads all stores that have at least 1 menu photo page.
 */
export async function loadCustomerMenuCatalog() {
    const feed = document.getElementById('cust-menu-catalog-feed');
    if (!feed || !db) return;

    try {
        const snap = await db.ref('directory/storeMenuGalleries').once('value');
        const val = snap.val() || {};

        // Keep only stores that have at least 1 page
        const stores = Object.entries(val).map(([key, data]) => {
            const pages = data.pages ? Object.values(data.pages) : [];
            return {
                key,
                name: data.storeName || key,
                pageCount: pages.length,
                previewUrl: pages[0]?.imageUrl || '',
                updatedAt: data.updatedAt || 0
            };
        }).filter(store => store.pageCount > 0);

        stores.sort((a, b) => a.name.localeCompare(b.name));
        cachedCatalogStores = stores;

        renderCustomerMenuFeed(stores);
    } catch (err) {
        console.error("Error loading customer menu catalog:", err);
        feed.innerHTML = `<div class="col-span-full text-center text-red-500 py-12 text-xs">Failed to load menus. Please try again.</div>`;
    }
}

export function renderCustomerMenuFeed(stores) {
    const feed = document.getElementById('cust-menu-catalog-feed');
    if (!feed) return;

    if (stores.length === 0) {
        feed.innerHTML = `
            <div class="col-span-full text-center text-gray-500 py-16 text-xs italic">
                <i class="fa-solid fa-store-slash text-3xl mb-2 text-gray-400"></i>
                <p>No restaurant menus available yet.</p>
            </div>
        `;
        return;
    }

    feed.innerHTML = stores.map(store => {
        const safeName = escapeHtml(store.name);
        return `
        <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 rounded-2xl p-3 flex items-center justify-between gap-3 shadow-xs hover:border-amber-500/50 transition">
            <div class="flex items-center gap-3 min-w-0 flex-1">
                <div class="w-14 h-14 rounded-xl bg-gray-100 dark:bg-black/40 overflow-hidden shrink-0 border border-gray-200 dark:border-gray-800 flex items-center justify-center">
                    ${store.previewUrl ? `
                        <img src="${store.previewUrl}" alt="${safeName}" class="w-full h-full object-cover">
                    ` : `
                        <i class="fa-solid fa-utensils text-amber-500 text-lg"></i>
                    `}
                </div>
                <div class="min-w-0 flex-1">
                    <h3 class="font-black text-xs sm:text-sm text-gray-900 dark:text-white truncate">${safeName}</h3>
                    <div class="flex items-center gap-2 mt-0.5">
                        <span class="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                            ${store.pageCount} ${store.pageCount === 1 ? 'page' : 'pages'}
                        </span>
                    </div>
                </div>
            </div>
            <button type="button" 
                    data-store-name="${safeName}" 
                    data-composite-key="${store.key}"
                    onclick="window.handleOpenMenuGalleryClick && window.handleOpenMenuGalleryClick(this)"
                    class="bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs px-3 py-2 rounded-xl transition active:scale-95 shadow-xs flex items-center gap-1.5 shrink-0 cursor-pointer">
                <i class="fa-solid fa-book-open text-xs"></i> <span>View Menu</span>
            </button>
        </div>`;
    }).join('');
}

export function filterCustomerMenuCatalog(query) {
    const q = (query || "").trim().toLowerCase();
    const filtered = cachedCatalogStores.filter(s => s.name.toLowerCase().includes(q));
    renderCustomerMenuFeed(filtered);
}

// Automatically load catalog when the view is active
window.addEventListener('viewChanged', (e) => {
    if (e.detail === 'view-customer-menus') {
        loadCustomerMenuCatalog();
    }
});

if (typeof window !== 'undefined') {
    window.loadCustomerMenuCatalog = loadCustomerMenuCatalog;
    window.filterCustomerMenuCatalog = filterCustomerMenuCatalog;
}