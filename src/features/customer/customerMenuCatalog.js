// src/features/customer/customerMenuCatalog.js

/**
 * ============================================================================
 * CUSTOMER RESTAURANT MENU CATALOG ENGINE (ON-DEMAND EXPLORER)
 * ============================================================================
 * 
 * Description:
 * Dedicated customer-facing catalog engine for browsing restaurant menus:
 * - Lazy On-Demand Photo Loading: Renders lightweight store directory cards first
 *   without downloading or preloading full-size menu photos on the main screen.
 * - Single-Tap Store Exploration: Fetches and displays menu images only when the
 *   customer taps "Explore Menu" on a specific store.
 * - Dynamic Search Filtering: Filters stores by name in real-time.
 * - Public Deep-Link Sharing: Generates and shares `#view-customer-menus` via
 *   Web Share API with automatic clipboard fallback.
 * - Safe Character Binding: Uses HTML5 data attributes to handle store names
 *   containing apostrophes or quotes without syntax errors.
 * ============================================================================
 */

import { db } from '../../config/firebase.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml, copyText } from '../../utils/helpers.js';

let cachedCatalogStores = [];

/**
 * Formats timestamps into human-readable date strings (e.g., Oct 6, 2026).
 */
function formatMenuUpdatedAt(timestamp) {
    if (!timestamp) return "";
    try {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return "";
        return date.toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    } catch (e) {
        return "";
    }
}

/**
 * Generates and shares/copies the public Customer Menu Link.
 */
export async function shareCustomerMenuCatalogLink() {
    const baseUrl = window.location.origin + window.location.pathname;
    const customerUrl = `${baseUrl.replace(/\/$/, '')}#view-customer-menus`;

    const shareData = {
        title: "Lokalex Restaurant Menus",
        text: "Tingnan ang kumpletong restaurant photo menus at mag-order sa Lokalex:",
        url: customerUrl
    };

    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        try {
            await navigator.share(shareData);
            showToast("🔗 Customer Menu Link shared!");
            return;
        } catch (e) {
            if (e.name === 'AbortError') return;
        }
    }

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(customerUrl);
        } else {
            copyText(customerUrl);
        }
        showToast("📋 Copied Customer Menu link to clipboard!");
    } catch (err) {
        copyText(customerUrl);
        showToast("📋 Copied Customer Menu link!");
    }
}

/**
 * Loads metadata for stores that have at least one uploaded menu photo.
 * Stores with zero photos are automatically omitted.
 */
export async function loadCustomerMenuCatalog() {
    const feed = document.getElementById('cust-menu-catalog-feed');
    if (!feed) return;

    if (!db) {
        feed.innerHTML = `<div class="col-span-full text-center text-red-500 py-12 text-xs">Database is currently offline.</div>`;
        return;
    }

    try {
        const snap = await db.ref('directory/storeMenuGalleries').once('value');
        const val = snap.val() || {};

        const stores = Object.entries(val).map(([key, data]) => {
            const pages = data.pages ? Object.values(data.pages) : [];
            return {
                key,
                name: data.storeName || key,
                pageCount: pages.length,
                updatedAt: data.updatedAt || 0
            };
        }).filter(store => store.pageCount > 0);

        stores.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
        cachedCatalogStores = stores;

        renderCustomerMenuFeed(stores);
    } catch (err) {
        console.error("Error loading customer menu catalog:", err);
        feed.innerHTML = `<div class="col-span-full text-center text-red-500 py-12 text-xs">Failed to load menus. Please refresh.</div>`;
    }
}

/**
 * Renders lightweight store directory cards.
 * Zero menu photos are downloaded or displayed on the list view.
 */
export function renderCustomerMenuFeed(stores) {
    const feed = document.getElementById('cust-menu-catalog-feed');
    if (!feed) return;

    if (!stores || stores.length === 0) {
        feed.innerHTML = `
            <div class="col-span-full text-center text-gray-500 dark:text-gray-400 py-16 text-xs italic flex flex-col items-center gap-2">
                <i class="fa-solid fa-store-slash text-3xl text-gray-400"></i>
                <span>Walang available na menu photos sa ngayon.</span>
            </div>
        `;
        return;
    }

    feed.innerHTML = stores.map(store => {
        const safeName = escapeHtml(store.name);
        const safeKey = escapeHtml(store.key);
        const updatedDateStr = formatMenuUpdatedAt(store.updatedAt);

        return `
        <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 rounded-2xl p-3.5 flex items-center justify-between gap-3 shadow-xs hover:border-amber-500/50 transition">
            <div class="flex items-center gap-3 min-w-0 flex-1">
                <div class="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <i class="fa-solid fa-store text-lg"></i>
                </div>
                <div class="min-w-0 flex-1">
                    <h3 class="font-black text-xs sm:text-sm text-gray-900 dark:text-white truncate leading-snug">${safeName}</h3>
                    <div class="flex items-center gap-1.5 flex-wrap mt-1">
                        <span class="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30 text-[9.5px] font-black px-2 py-0.5 rounded-md flex items-center gap-1 shadow-2xs">
                            <i class="fa-solid fa-camera"></i> ${store.pageCount} ${store.pageCount === 1 ? 'Page' : 'Pages'}
                        </span>
                        ${updatedDateStr ? `
                        <span class="text-[9.5px] text-gray-500 dark:text-gray-400 flex items-center gap-1 font-medium">
                            <i class="fa-regular fa-calendar-check text-[9px] text-amber-500"></i> Updated: <strong class="text-gray-700 dark:text-gray-300 font-bold">${escapeHtml(updatedDateStr)}</strong>
                        </span>` : ''}
                    </div>
                </div>
            </div>
            <button type="button" 
                    data-store-name="${safeName}" 
                    data-composite-key="${safeKey}"
                    onclick="window.exploreStoreMenu && window.exploreStoreMenu(this)"
                    class="bg-amber-600 hover:bg-amber-500 text-white font-black text-xs px-3.5 py-2 rounded-xl transition active:scale-95 shadow-xs flex items-center gap-1.5 shrink-0 cursor-pointer">
                <i class="fa-solid fa-book-open text-xs"></i> <span>Explore Menu</span>
            </button>
        </div>`;
    }).join('');
}

/**
 * Triggered when a customer clicks "Explore Menu".
 * Opens the compact modal gallery to fetch and display photos on demand.
 */
export function exploreStoreMenu(btn) {
    if (!btn) return;
    const storeName = btn.getAttribute('data-store-name') || '';
    const compositeKey = btn.getAttribute('data-composite-key') || '';
    if (window.openStoreMenuGalleryModal) {
        window.openStoreMenuGalleryModal(storeName, compositeKey);
    }
}

/**
 * Real-time search filter for customer menu catalog.
 */
export function filterCustomerMenuCatalog(query) {
    const q = (query || "").trim().toLowerCase();
    const filtered = cachedCatalogStores.filter(s => (s.name || '').toLowerCase().includes(q));
    renderCustomerMenuFeed(filtered);
}

// Global window attachments
if (typeof window !== 'undefined') {
    window.loadCustomerMenuCatalog = loadCustomerMenuCatalog;
    window.renderCustomerMenuFeed = renderCustomerMenuFeed;
    window.filterCustomerMenuCatalog = filterCustomerMenuCatalog;
    window.shareCustomerMenuCatalogLink = shareCustomerMenuCatalogLink;
    window.exploreStoreMenu = exploreStoreMenu;
}

// REMARKS: CUSTOMER_MENU_CATALOG_LAZY_EXPLORE_V1_COMPLETE