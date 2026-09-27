// src/features/directory/directoryUi.js

/**
 * ============================================================================
 * DIRECTORY UI, DUAL-TIER ROUTING TOOLBAR & RESTAURANT MENU GALLERY ENGINE
 * ============================================================================
 * 
 * Description:
 * Manages presentation layer, card rendering, search filtering, and restaurant menus:
 * - Multi-Photo Menu Upload: Allows riders to select and batch-upload multiple
 *   menu pages at once with client-side canvas compression.
 * - Firebase Storage Integration: Uploads compressed JPEG/WebP blobs directly to
 *   Firebase Storage (`menus/${storeKey}/${pageId}.jpg`), writing only lightweight
 *   HTTPS URLs (~120 bytes) to RTDB to prevent database bandwidth exhaustion.
 * - Device Photo Saving: Uses Web Share API with staggered anchor fallbacks to
 *   download all menu pages directly to the rider's phone gallery.
 * - Free Customer Directory Browsing: Browsing customer contacts is free.
 * - Confirmed Location Unlock: Clicking "View Location" opens a modal requiring
 *   the rider to confirm spending 1 credit before Google Maps is opened.
 * - Dynamic Destination Synchronization: Automatically updates the Destination
 *   dropdown whenever rates are rendered.
 * ============================================================================
 */

import { db, storage } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { switchView } from '../../ui/router.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { escapeHtml, copyText } from '../../utils/helpers.js';
import { idbGet, idbSet } from '../../utils/storageEngine.js';
import { loadDirectoryCache } from './directoryStorage.js';
import { checkAdminAccess } from './directoryPermissions.js';

let lastJumpLetter = "";
let creditsListenerActive = false;
let hasAttemptedGpsAutoSelect = false;
let pendingMapUnlock = null;
let activeGalleryStore = null;

const MUNICIPALITY_COORDINATES = {
    "Camiling": { lat: 15.6881, lng: 120.4144 },
    "San Clemente": { lat: 15.7136, lng: 120.3598 },
    "Santa Ignacia": { lat: 15.6186, lng: 120.4856 },
    "Paniqui": { lat: 15.6664, lng: 120.5819 },
    "Mayantoc": { lat: 15.6200, lng: 120.3700 },
    "Moncada": { lat: 15.7347, lng: 120.5700 },
    "Gerona": { lat: 15.6067, lng: 120.5989 },
    "Bayambang": { lat: 15.8115, lng: 120.4578 },
    "Mangatarem": { lat: 15.7892, lng: 120.2975 },
    "San Manuel": { lat: 15.8000, lng: 120.6000 },
    "Tarlac City": { lat: 15.4802, lng: 120.5979 }
};

export function getSectionLetter(name) {
    if (!name) return "#";
    const firstChar = name.trim().charAt(0).toUpperCase();
    return /^[A-Z]$/.test(firstChar) ? firstChar : "#";
}

export function updateRosterCreditsDisplay(credits) {
    const countEl = document.getElementById('rider-credits-count');
    const pillEl = document.getElementById('rider-credits-pill');
    
    const isAdmin = checkAdminAccess();

    if (isAdmin) {
        if (countEl) countEl.innerText = "∞ (Admin)";
        if (pillEl) {
            pillEl.className = "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 text-[10px] px-2.5 py-0.5 rounded-lg font-bold flex items-center gap-1.5 shadow-xs transition select-none cursor-pointer";
        }
        return;
    }

    let balance = credits;
    if (balance === undefined || balance === null) {
        balance = parseInt(localStorage.getItem('lokalex_rider_credits') || "0", 10);
    }

    if (countEl) countEl.innerText = balance;

    if (pillEl) {
        if (balance <= 0) {
            pillEl.className = "bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-500/40 text-red-700 dark:text-red-400 text-[10px] px-2.5 py-0.5 rounded-lg font-bold flex items-center gap-1.5 shadow-xs transition select-none cursor-pointer";
        } else {
            pillEl.className = "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 text-[10px] px-2.5 py-0.5 rounded-lg font-bold flex items-center gap-1.5 shadow-xs transition select-none cursor-pointer";
        }
    }
}

export function showCreditsInfoToast() {
    const isAdmin = checkAdminAccess();
    if (isAdmin) {
        showToast("👑 Admin Account: Mayroon kang UNLIMITED Directory Access at hindi ka nababawasan ng credits.");
        return;
    }

    const cur = parseInt(localStorage.getItem('lokalex_rider_credits') || "0", 10);
    const config = globalState.directoryCreditsConfig || {};
    const custR = config.rewardCustomerRegistration !== undefined ? config.rewardCustomerRegistration : 5;
    const storeR = config.rewardStoreRegistration !== undefined ? config.rewardStoreRegistration : 10;
    const status = config.enabled !== false ? 'ACTIVE' : 'DISABLED';

    showToast(`🪙 Directory Credits (${status})\n• Balance: ${cur} credits\n• Libre ang Customer & Store browsing\n• -1 credit bawat Customer Location na titingnan\n• +${custR} credits bawat Customer registration\n• +${storeR} credits bawat Store registration`);
}

export function initRiderCreditsListener() {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    if (!myId || !db || creditsListenerActive) return;

    creditsListenerActive = true;
    db.ref(`riders/${myId}/directoryCredits`).on('value', (snap) => {
        const val = snap.exists() ? parseInt(snap.val(), 10) || 0 : 0;
        localStorage.setItem('lokalex_rider_credits', val.toString());
        appState.directoryCredits = val;
        updateRosterCreditsDisplay(val);
    });
}

export function populateDestinationDropdown() {
    const destSelect = document.getElementById('dir-destination-select');
    if (!destSelect) return [];

    const activeOriginHub = (globalState.selectedOriginHub || "Camiling").trim().toLowerCase();
    const records = (globalState.records || []).filter(r => (r.type || 'customers') === 'barangays');

    const munCountMap = new Map();

    records.forEach(r => {
        const rOrigin = (r.originMunicipality || "Camiling").trim().toLowerCase();
        if (activeOriginHub === "all" || rOrigin === activeOriginHub) {
            const rawDest = (r.municipality || "Camiling").trim();
            const destMun = rawDest.charAt(0).toUpperCase() + rawDest.slice(1);
            munCountMap.set(destMun, (munCountMap.get(destMun) || 0) + 1);
        }
    });

    const servicedMunicipalities = Array.from(munCountMap.keys()).sort((a, b) => a.localeCompare(b));

    let optionsHtml = `<option value="ALL">🌐 All Destinations</option>`;

    servicedMunicipalities.forEach(mun => {
        optionsHtml += `<option value="${escapeHtml(mun)}">${escapeHtml(mun)} (${munCountMap.get(mun)})</option>`;
    });

    destSelect.innerHTML = optionsHtml;

    if (!globalState.selectedDestinationMun) {
        globalState.selectedDestinationMun = localStorage.getItem('lokalex_selected_destination_mun') || "ALL";
    }

    const currentSelected = globalState.selectedDestinationMun;
    const isAvailable = servicedMunicipalities.some(m => m.toLowerCase() === currentSelected.toLowerCase());

    if (currentSelected !== "ALL" && !isAvailable) {
        globalState.selectedDestinationMun = servicedMunicipalities.includes("Camiling") ? "Camiling" : "ALL";
    }

    destSelect.value = globalState.selectedDestinationMun;
    return servicedMunicipalities;
}

export function detectAndSetGpsDestination(servicedMunicipalities) {
    if (!servicedMunicipalities || servicedMunicipalities.length === 0) return;

    const findNearest = (userLat, userLng) => {
        let closestMun = null;
        let minDistance = Infinity;

        servicedMunicipalities.forEach(mun => {
            const anchor = MUNICIPALITY_COORDINATES[mun];
            if (anchor) {
                const dLat = userLat - anchor.lat;
                const dLng = userLng - anchor.lng;
                const distSq = (dLat * dLat) + (dLng * dLng);
                if (distSq < minDistance) {
                    minDistance = distSq;
                    closestMun = mun;
                }
            }
        });

        if (closestMun && minDistance < 0.05) {
            const destSelect = document.getElementById('dir-destination-select');
            if (destSelect && globalState.selectedDestinationMun !== closestMun) {
                globalState.selectedDestinationMun = closestMun;
                destSelect.value = closestMun;
                try {
                    localStorage.setItem('lokalex_selected_destination_mun', closestMun);
                } catch(e) {}
                renderDirectoryList();
                showToast(`📍 GPS: Focused on destination [${closestMun}]`);
            }
        }
    };

    if (appState.lat && appState.lon) {
        findNearest(appState.lat, appState.lon);
        return;
    }

    if (!hasAttemptedGpsAutoSelect && navigator.geolocation) {
        hasAttemptedGpsAutoSelect = true;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                if (pos?.coords?.latitude && pos?.coords?.longitude) {
                    findNearest(pos.coords.latitude, pos.coords.longitude);
                }
            },
            () => {},
            { timeout: 4000, maximumAge: 300000, enableHighAccuracy: false }
        );
    }
}

export function handleOriginHubChange(selectedHub) {
    globalState.selectedOriginHub = selectedHub || "Camiling";
    try {
        localStorage.setItem('lokalex_selected_origin_hub', globalState.selectedOriginHub);
    } catch(e) {}

    populateDestinationDropdown();
    renderDirectoryList();

    const hubLabel = selectedHub === "ALL" ? "Lahat ng Starting Hubs" : `${selectedHub} Hub`;
    showToast(`📍 Na-filter ang mga rates mula sa: ${hubLabel}`);
}

export function handleDestinationChange(selectedMun) {
    globalState.selectedDestinationMun = selectedMun || "ALL";
    try {
        localStorage.setItem('lokalex_selected_destination_mun', globalState.selectedDestinationMun);
    } catch(e) {}

    renderDirectoryList();

    const destLabel = selectedMun === "ALL" ? "Lahat ng Destinations" : `${selectedMun}`;
    showToast(`🎯 Destination: ${destLabel}`);
}

export function minimizeDirectorySearch() {
    const floatingBar = document.getElementById('dir-floating-search-bar');
    const minSearchWrapper = document.getElementById('dir-min-search-wrapper');

    if (floatingBar && !floatingBar.classList.contains('hidden')) floatingBar.classList.add('hidden');
    if (minSearchWrapper && minSearchWrapper.classList.contains('hidden')) minSearchWrapper.classList.remove('hidden');
}

export function restoreDirectorySearch() {
    const minSearchWrapper = document.getElementById('dir-min-search-wrapper');
    const floatingBar = document.getElementById('dir-floating-search-bar');

    if (minSearchWrapper && !minSearchWrapper.classList.contains('hidden')) minSearchWrapper.classList.add('hidden');
    if (floatingBar && !floatingBar.classList.contains('hidden')) floatingBar.classList.add('hidden');
}

export function expandDirectorySearch() {
    const floatingBar = document.getElementById('dir-floating-search-bar');
    const minSearchWrapper = document.getElementById('dir-min-search-wrapper');
    const floatingInput = document.getElementById('floating-search-input');
    const searchInput = document.getElementById('search-input');

    if (minSearchWrapper) minSearchWrapper.classList.add('hidden');
    if (floatingBar) floatingBar.classList.remove('hidden');
    if (floatingInput) {
        floatingInput.value = searchInput ? searchInput.value : '';
        floatingInput.focus();
    }
}

export function syncAndFilterFloatingSearch(val) {
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = val;
    filterDirectoryRecords();
}

export function initDirectoryScrollListener() {
    const recordList = document.getElementById('record-list');

    const handleScroll = () => {
        const viewDir = document.getElementById('view-directory');
        if (!viewDir || viewDir.classList.contains('hidden')) return;

        const winScroll = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
        const listScroll = recordList ? recordList.scrollTop : 0;
        const currentScroll = Math.max(winScroll, listScroll);

        const floatingBar = document.getElementById('dir-floating-search-bar');
        const isFloatingOpen = floatingBar && !floatingBar.classList.contains('hidden');

        if (currentScroll > 60) {
            if (!isFloatingOpen) {
                const minSearchWrapper = document.getElementById('dir-min-search-wrapper');
                if (minSearchWrapper && minSearchWrapper.classList.contains('hidden')) {
                    minSearchWrapper.classList.remove('hidden');
                }
            }
        } else if (currentScroll <= 25) {
            restoreDirectorySearch();
        }
    };

    window.removeEventListener('scroll', handleScroll);
    window.addEventListener('scroll', handleScroll, { passive: true });

    if (recordList && recordList.dataset.scrollBound !== 'true') {
        recordList.dataset.scrollBound = 'true';
        recordList.addEventListener('scroll', handleScroll, { passive: true });
    }
}

// ============================================================================
// CUSTOMER MAP LOCATION CONFIRMATION & CREDIT DEDUCTION MODAL
// ============================================================================

function getOrCreateLocationConfirmModal() {
    let modal = document.getElementById('customer-location-confirm-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'customer-location-confirm-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 hidden';
        modal.innerHTML = `
        <div class="bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-800 rounded-3xl p-5 max-w-sm w-full shadow-2xl flex flex-col gap-4 animate-scaleUp">
            <div class="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-gray-800/80">
                <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-600 dark:text-blue-400">
                        <i class="fa-solid fa-map-location-dot text-sm"></i>
                    </div>
                    <div>
                        <h3 class="font-black text-sm text-gray-900 dark:text-white">View Saved Location</h3>
                        <p class="text-[10px] text-gray-500 dark:text-gray-400">Customer Location Access</p>
                    </div>
                </div>
                <button type="button" onclick="window.closeCustomerLocationConfirmModal && window.closeCustomerLocationConfirmModal()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 text-sm cursor-pointer">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            
            <div class="flex flex-col gap-2.5 text-xs">
                <div class="bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-800 p-3 rounded-2xl">
                    <div class="text-[10px] text-gray-500 dark:text-gray-400">Customer:</div>
                    <div id="loc-confirm-customer-name" class="font-black text-sm text-gray-900 dark:text-white truncate mt-0.5">Customer Name</div>
                </div>

                <div id="loc-confirm-credit-details" class="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-[11px] flex flex-col gap-1.5">
                    <div class="flex justify-between items-center font-bold">
                        <span>Fee to view location:</span>
                        <span id="loc-confirm-cost-label" class="font-mono text-xs text-red-600 dark:text-red-400 font-black">-1 Directory Credit</span>
                    </div>
                    <div class="flex justify-between items-center text-[10px] text-gray-600 dark:text-gray-400 pt-1 border-t border-amber-200/50 dark:border-amber-500/20">
                        <span>Your Current Balance:</span>
                        <span id="loc-confirm-current-balance" class="font-mono font-bold text-gray-900 dark:text-white">0 credits</span>
                    </div>
                </div>

                <div id="loc-confirm-warning" class="hidden text-[11px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-500/30 p-2.5 rounded-xl text-center">
                    ⚠️ Hindi sapat ang iyong Directory Credits! Mag-rehistro muna ng customer (+5) o store (+10) para magka-credits.
                </div>
            </div>

            <div class="flex items-center gap-2 pt-1">
                <button type="button" onclick="window.closeCustomerLocationConfirmModal && window.closeCustomerLocationConfirmModal()" class="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-black/30 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-xs transition active:scale-95 cursor-pointer">
                    Cancel
                </button>
                <button type="button" id="loc-confirm-proceed-btn" onclick="window.confirmAndOpenCustomerLocation && window.confirmAndOpenCustomerLocation()" class="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs transition active:scale-95 shadow-md flex items-center justify-center gap-1.5 cursor-pointer">
                    <i class="fa-solid fa-unlock"></i> Proceed & Open
                </button>
            </div>
        </div>`;
        document.body.appendChild(modal);
    }
    return modal;
}

export function promptViewCustomerLocation(customerName, mapUrl) {
    if (!mapUrl) {
        showToast("⚠️ Walang naka-save na GPS link para sa customer na ito.");
        return;
    }

    const modal = getOrCreateLocationConfirmModal();
    const nameEl = document.getElementById('loc-confirm-customer-name');
    const balanceEl = document.getElementById('loc-confirm-current-balance');
    const costLabel = document.getElementById('loc-confirm-cost-label');
    const warningEl = document.getElementById('loc-confirm-warning');
    const proceedBtn = document.getElementById('loc-confirm-proceed-btn');

    if (nameEl) nameEl.innerText = customerName || "Customer";

    const isAdmin = checkAdminAccess();
    let currentCredits = parseInt(localStorage.getItem('lokalex_rider_credits') || "0", 10);
    if (isNaN(currentCredits)) currentCredits = 0;

    pendingMapUnlock = { customerName, mapUrl };

    if (isAdmin) {
        if (costLabel) costLabel.innerText = "0 Credits (Admin Free)";
        if (balanceEl) balanceEl.innerText = "Unlimited (Admin)";
        if (warningEl) warningEl.classList.add('hidden');
        if (proceedBtn) {
            proceedBtn.disabled = false;
            proceedBtn.classList.remove('opacity-40', 'cursor-not-allowed');
            proceedBtn.innerHTML = `<i class="fa-solid fa-arrow-up-right-from-square"></i> Open Map`;
        }
    } else {
        if (costLabel) costLabel.innerText = "-1 Directory Credit";
        if (balanceEl) balanceEl.innerText = `${currentCredits} credit(s)`;

        if (currentCredits < 1) {
            if (warningEl) warningEl.classList.remove('hidden');
            if (proceedBtn) {
                proceedBtn.disabled = true;
                proceedBtn.classList.add('opacity-40', 'cursor-not-allowed');
                proceedBtn.innerHTML = `⚠️ Insufficient Credits`;
            }
        } else {
            if (warningEl) warningEl.classList.add('hidden');
            if (proceedBtn) {
                proceedBtn.disabled = false;
                proceedBtn.classList.remove('opacity-40', 'cursor-not-allowed');
                proceedBtn.innerHTML = `<i class="fa-solid fa-unlock"></i> Proceed & Open (-1)`;
            }
        }
    }

    modal.classList.remove('hidden');
}

export function closeCustomerLocationConfirmModal() {
    const modal = document.getElementById('customer-location-confirm-modal');
    if (modal) modal.classList.add('hidden');
    pendingMapUnlock = null;
}

export async function confirmAndOpenCustomerLocation() {
    if (!pendingMapUnlock || !pendingMapUnlock.mapUrl) {
        closeCustomerLocationConfirmModal();
        return;
    }

    const { customerName, mapUrl } = pendingMapUnlock;
    const isAdmin = checkAdminAccess();
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();

    if (!isAdmin && myId) {
        let currentCredits = parseInt(localStorage.getItem('lokalex_rider_credits') || "0", 10);
        if (isNaN(currentCredits)) currentCredits = 0;

        if (db) {
            try {
                const snap = await db.ref(`riders/${myId}/directoryCredits`).once('value');
                if (snap.exists()) {
                    currentCredits = parseInt(snap.val(), 10) || 0;
                }
            } catch(e) {}
        }

        if (currentCredits < 1) {
            showToast("⚠️ Kulang ang iyong credits para tingnan ang lokasyon.");
            closeCustomerLocationConfirmModal();
            return;
        }

        const newBalance = Math.max(0, currentCredits - 1);
        localStorage.setItem('lokalex_rider_credits', newBalance.toString());
        appState.directoryCredits = newBalance;
        updateRosterCreditsDisplay(newBalance);

        if (db) {
            db.ref(`riders/${myId}/directoryCredits`).transaction(c => Math.max(0, (c || 1) - 1));
            db.ref(`roster/${myId}/directoryCredits`).transaction(c => Math.max(0, (c || 1) - 1)).catch(() => {});
        }

        showToast(`🪙 -1 Credit used for ${customerName}'s location. Balance: ${newBalance}`);
    }

    closeCustomerLocationConfirmModal();
    window.open(mapUrl, '_blank');
}

// ============================================================================
// RESTAURANT MENU PHOTO GALLERY & CLOUD STORAGE PIPELINE (MULTI-FILE)
// ============================================================================

function getOrCreateMenuGalleryModal() {
    let modal = document.getElementById('store-menu-gallery-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'store-menu-gallery-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2.5 sm:p-5 hidden';
        modal.innerHTML = `
        <div class="bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-800 rounded-3xl max-w-2xl w-full max-h-[92vh] shadow-2xl flex flex-col overflow-hidden animate-scaleUp">
            <!-- Header -->
            <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800/80 bg-gray-50/60 dark:bg-black/20">
                <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                    <div class="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                        <i class="fa-solid fa-book-open text-sm"></i>
                    </div>
                    <div class="min-w-0 flex-1">
                        <h3 id="gallery-store-title" class="font-black text-xs sm:text-sm text-gray-900 dark:text-white truncate">Store Menu</h3>
                        <p id="gallery-store-subtitle" class="text-[9px] sm:text-[10px] text-gray-500 dark:text-gray-400 truncate">Rider-contributed physical restaurant menu</p>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button type="button" id="btn-download-all-menu" onclick="window.downloadCompleteMenuToPhone && window.downloadCompleteMenuToPhone()" class="hidden bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] px-2.5 py-1.5 rounded-xl transition active:scale-95 shadow-xs flex items-center gap-1.5 cursor-pointer">
                        <i class="fa-solid fa-cloud-arrow-down"></i> <span class="hidden sm:inline">Save All</span>
                    </button>
                    <button type="button" onclick="window.closeStoreMenuGalleryModal && window.closeStoreMenuGalleryModal()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 text-base cursor-pointer">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>

            <!-- Compact Upload Bar -->
            <div class="px-4 py-2 bg-amber-50/50 dark:bg-amber-950/20 border-b border-amber-200/50 dark:border-amber-500/20 flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-1 text-[10px] text-amber-800 dark:text-amber-300 font-bold">
                    <i class="fa-solid fa-camera"></i>
                    <span>Got updated photos?</span>
                </div>
                <label class="bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-black px-2.5 py-1 rounded-lg cursor-pointer transition active:scale-95 shadow-xs flex items-center gap-1">
                    <i class="fa-solid fa-plus text-[9px]"></i> Add Pages
                    <input type="file" id="gallery-upload-input" accept="image/*" multiple class="hidden" onchange="window.handleMenuPhotoUpload && window.handleMenuPhotoUpload(event)">
                </label>
            </div>

            <!-- Body: Compact 2-Column Mobile Grid -->
            <div id="gallery-images-container" class="flex-1 overflow-y-auto p-2.5 sm:p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                <div class="col-span-full text-center text-gray-500 italic py-16 text-xs">Loading menu photos...</div>
            </div>

            <!-- Lightbox / Preview Layer -->
            <div id="gallery-lightbox" class="fixed inset-0 z-60 bg-black/95 flex flex-col items-center justify-center p-3 hidden" onclick="window.closeGalleryLightbox && window.closeGalleryLightbox()">
                <div class="absolute top-4 right-4 flex items-center gap-2">
                    <a id="lightbox-download-single" href="#" download="menu_page.jpg" onclick="event.stopPropagation()" class="bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 backdrop-blur-md">
                        <i class="fa-solid fa-download"></i> Save Image
                    </a>
                    <button type="button" class="text-white text-xl p-2 cursor-pointer" onclick="window.closeGalleryLightbox && window.closeGalleryLightbox()">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <img id="lightbox-image" src="" alt="Menu Full View" class="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl select-none" onclick="event.stopPropagation()">
                <div id="lightbox-caption" class="text-white text-xs font-bold mt-2 text-center bg-black/60 px-3 py-1 rounded-lg backdrop-blur-xs select-none"></div>
            </div>
        </div>`;
        document.body.appendChild(modal);
    }
    return modal;
}

/**
 * Compresses an image file on an off-screen HTML5 canvas to a binary Blob.
 */
function compressImageToBlob(file, maxWidth = 1400, quality = 0.82) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error("Canvas blob compression failed."));
                    }
                }, 'image/jpeg', quality);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export async function openStoreMenuGalleryModal(storeName, compositeKey) {
    const modal = getOrCreateMenuGalleryModal();
    const cleanName = (storeName || "Store").trim();
    const galleryKey = (compositeKey || cleanName).toLowerCase().replace(/[^a-z0-9]/g, '');

    activeGalleryStore = {
        name: cleanName,
        key: galleryKey
    };

    const titleEl = document.getElementById('gallery-store-title');
    const subEl = document.getElementById('gallery-store-subtitle');
    const container = document.getElementById('gallery-images-container');
    const dlBtn = document.getElementById('btn-download-all-menu');

    if (titleEl) titleEl.innerText = `${cleanName} - Menu`;
    if (subEl) subEl.innerText = `Complete physical menu for ${cleanName}`;
    if (dlBtn) dlBtn.classList.add('hidden');

    modal.classList.remove('hidden');

    try {
        const cached = await idbGet('storeMenuGalleries', galleryKey);
        if (cached && cached.pages && cached.pages.length > 0) {
            renderMenuPages(cached.pages, cleanName);
        }
    } catch(e) {}

    if (db) {
        db.ref(`directory/storeMenuGalleries/${galleryKey}`).on('value', (snap) => {
            const val = snap.val() || {};
            const pages = val.pages ? Object.values(val.pages) : [];

            pages.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));

            idbSet('storeMenuGalleries', galleryKey, { pages, updatedAt: val.updatedAt || Date.now() }).catch(() => {});
            renderMenuPages(pages, cleanName);
        });
    }
}

export function closeStoreMenuGalleryModal() {
    const modal = document.getElementById('store-menu-gallery-modal');
    if (modal) modal.classList.add('hidden');
    if (db && activeGalleryStore) {
        db.ref(`directory/storeMenuGalleries/${activeGalleryStore.key}`).off();
    }
    activeGalleryStore = null;
}

function renderMenuPages(pages = [], storeName = "Store") {
    const container = document.getElementById('gallery-images-container');
    const dlBtn = document.getElementById('btn-download-all-menu');
    if (!container) return;

    if (pages.length === 0) {
        if (dlBtn) dlBtn.classList.add('hidden');
        container.innerHTML = `
        <div class="col-span-full text-center text-gray-500 dark:text-gray-400 italic py-12 text-xs flex flex-col items-center gap-2">
            <i class="fa-solid fa-camera-retro text-2xl text-amber-500/60"></i>
            <span>Walang naka-save na photo menu para sa restaurant na ito.</span>
            <span class="text-[10px] text-gray-400">Mag-picture at mag-register gamit ang buton sa itaas.</span>
        </div>`;
        return;
    }

    if (dlBtn) dlBtn.classList.remove('hidden');

    container.innerHTML = pages.map((page, idx) => {
        const pageNum = idx + 1;
        const caption = page.caption || `Page ${pageNum}`;
        const uploader = page.uploaderName || "Rider";
        const uploadedAt = page.uploadedAt ? ` • ${page.uploadedAt}` : "";
        const safeUrl = page.imageUrl || "";

        return `
        <div class="bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800/80 rounded-xl p-1.5 flex flex-col gap-1.5 shadow-2xs group">
            <div class="relative w-full aspect-[4/3] bg-black/60 rounded-lg overflow-hidden cursor-pointer" onclick="window.openGalleryLightbox && window.openGalleryLightbox('${safeUrl}', '${escapeHtml(caption)}')">
                <img src="${safeUrl}" alt="${escapeHtml(caption)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition duration-200">
                <span class="absolute top-1.5 left-1.5 bg-black/75 backdrop-blur-xs text-amber-400 font-mono font-black text-[9px] px-1.5 py-0.5 rounded-md border border-amber-500/30">
                    P${pageNum}
                </span>
                <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold gap-1 pointer-events-none">
                    <i class="fa-solid fa-magnifying-glass-plus text-[10px]"></i> View
                </div>
            </div>
            
            <div class="flex items-center justify-between text-xs px-0.5 pt-0.5">
                <div class="flex flex-col min-w-0 pr-1">
                    <span class="font-bold text-[11px] text-gray-900 dark:text-white truncate">${escapeHtml(caption)}</span>
                    <span class="text-[8.5px] text-gray-500 dark:text-gray-400 truncate leading-tight">${escapeHtml(uploader)}${uploadedAt}</span>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <a href="${safeUrl}" download="${storeName}_Menu_Page_${pageNum}.jpg" class="p-1 rounded-md bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:text-emerald-500 transition active:scale-95" title="Save this page">
                        <i class="fa-solid fa-download text-[9px]"></i>
                    </a>
                    ${checkAdminAccess() ? `
                    <button type="button" onclick="window.deleteMenuGalleryPage && window.deleteMenuGalleryPage('${page.id}')" class="p-1 rounded-md bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 transition active:scale-95" title="Delete page">
                        <i class="fa-solid fa-trash text-[9px]"></i>
                    </button>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
}

/**
 * Handles multi-file photo uploads with sequential canvas compression and Storage upload.
 */
export async function handleMenuPhotoUpload(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !activeGalleryStore) return;

    const input = e.target;
    showToast(`⏳ Compressing and uploading ${files.length} menu photo(s)...`);

    try {
        const riderName = appState.riderName || localStorage.getItem('riderName') || "Rider";
        const riderId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
        const todayFormatted = new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

        const snap = await db.ref(`directory/storeMenuGalleries/${activeGalleryStore.key}/pages`).once('value');
        let count = snap.exists() ? Object.keys(snap.val()).length : 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            count++;
            const pageId = `PAGE_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            const imageBlob = await compressImageToBlob(file, 1400, 0.82);

            let finalImageUrl = "";

            if (storage) {
                const storageRef = storage.ref(`menus/${activeGalleryStore.key}/${pageId}.jpg`);
                const uploadTask = await storageRef.put(imageBlob, {
                    contentType: 'image/jpeg',
                    customMetadata: {
                        storeKey: activeGalleryStore.key,
                        uploaderId: riderId,
                        uploaderName: riderName
                    }
                });
                finalImageUrl = await uploadTask.ref.getDownloadURL();
            } else {
                finalImageUrl = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(imageBlob);
                });
            }

            const pagePayload = {
                id: pageId,
                imageUrl: finalImageUrl,
                caption: `Menu Page ${count}`,
                uploaderName: riderName,
                uploaderId: riderId,
                orderIndex: count,
                uploadedAt: todayFormatted
            };

            await db.ref(`directory/storeMenuGalleries/${activeGalleryStore.key}/pages/${pageId}`).set(pagePayload);
        }

        await db.ref(`directory/storeMenuGalleries/${activeGalleryStore.key}/updatedAt`).set(Date.now());
        await db.ref(`directory/storeMenuGalleries/${activeGalleryStore.key}/storeName`).set(activeGalleryStore.name);

        showToast(`✅ Na-upload ang ${files.length} pahina ng menu para sa ${activeGalleryStore.name}!`);
        showSideNotification("MENU UPLOADED", `${activeGalleryStore.name} (+${files.length} pages)`, "fa-book-open", "text-emerald-400", "border-emerald-500");
    } catch(err) {
        console.error("Upload error:", err);
        showToast("❌ Hindi na-save ang litrato: " + (err.message || "Upload failed"));
    } finally {
        if (input) input.value = "";
    }
}

export async function downloadCompleteMenuToPhone() {
    if (!activeGalleryStore || !db) return;

    showToast("📥 Preparing complete menu for download...");

    try {
        const snap = await db.ref(`directory/storeMenuGalleries/${activeGalleryStore.key}/pages`).once('value');
        const pages = snap.exists() ? Object.values(snap.val()) : [];

        if (pages.length === 0) {
            showToast("⚠️ Walang naka-save na mga litrato.");
            return;
        }

        pages.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));

        const filesToShare = [];
        for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            const res = await fetch(p.imageUrl);
            const blob = await res.blob();
            const ext = blob.type.includes('webp') ? 'webp' : 'jpg';
            const file = new File([blob], `${activeGalleryStore.name}_Menu_Page_${i + 1}.${ext}`, { type: blob.type });
            filesToShare.push(file);
        }

        if (navigator.canShare && navigator.canShare({ files: filesToShare })) {
            await navigator.share({
                title: `${activeGalleryStore.name} Complete Menu`,
                text: `Complete menu for ${activeGalleryStore.name} (${pages.length} pages)`,
                files: filesToShare
            });
            showToast("🎉 Na-share / na-save sa gallery!");
            return;
        }

        pages.forEach((p, idx) => {
            setTimeout(() => {
                const a = document.createElement('a');
                a.href = p.imageUrl;
                a.download = `${activeGalleryStore.name}_Menu_Page_${idx + 1}.jpg`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }, idx * 350);
        });

        showToast(`✅ Na-download ang ${pages.length} pahina ng menu!`);
    } catch(err) {
        if (err.name !== 'AbortError') {
            console.error("Download error:", err);
            showToast("⚠️ Hindi na-download ang kumpletong menu.");
        }
    }
}

export async function deleteMenuGalleryPage(pageId) {
    if (!activeGalleryStore || !pageId || !db) return;
    if (!confirm("Sigurado ka bang nais burahin ang page na ito?")) return;

    try {
        await db.ref(`directory/storeMenuGalleries/${activeGalleryStore.key}/pages/${pageId}`).remove();
        if (storage) {
            storage.ref(`menus/${activeGalleryStore.key}/${pageId}.jpg`).delete().catch(() => {});
        }
        showToast("🗑️ Nabura ang page sa gallery.");
    } catch(e) {
        showToast("❌ Hindi nabura ang page.");
    }
}

export function openGalleryLightbox(url, caption) {
    const lightbox = document.getElementById('gallery-lightbox');
    const img = document.getElementById('lightbox-image');
    const cap = document.getElementById('lightbox-caption');
    const dlBtn = document.getElementById('lightbox-download-single');

    if (img) img.src = url;
    if (cap) cap.innerText = caption;
    if (dlBtn) dlBtn.href = url;
    if (lightbox) lightbox.classList.remove('hidden');
}

export function closeGalleryLightbox() {
    const lightbox = document.getElementById('gallery-lightbox');
    if (lightbox) lightbox.classList.add('hidden');
}

export async function openDirectory(type) {
    const targetType = type || 'customers';
    globalState.currentType = targetType;

    const originContainer = document.getElementById('dir-origin-hub-container');
    const originSelect = document.getElementById('dir-origin-hub-select');

    if (targetType === 'barangays') {
        if (originContainer) originContainer.classList.remove('hidden');
        if (!globalState.selectedOriginHub) {
            globalState.selectedOriginHub = localStorage.getItem('lokalex_selected_origin_hub') || "Camiling";
        }
        if (originSelect) originSelect.value = globalState.selectedOriginHub;

        loadDirectoryCache();
        const serviced = populateDestinationDropdown();
        renderDirectoryList();
        detectAndSetGpsDestination(serviced);
    } else {
        if (originContainer) originContainer.classList.add('hidden');
        loadDirectoryCache();
        renderDirectoryList();
    }

    const searchInput = document.getElementById('search-input');
    const floatingInput = document.getElementById('floating-search-input');
    if (searchInput) searchInput.value = '';
    if (floatingInput) floatingInput.value = '';

    const clearBtn = document.getElementById('clear-search-btn');
    const floatingClearBtn = document.getElementById('floating-clear-search-btn');
    if (clearBtn) clearBtn.classList.add('hidden');
    if (floatingClearBtn) floatingClearBtn.classList.add('hidden');

    const minLabel = document.getElementById('dir-min-search-label');
    const minIndicator = document.getElementById('dir-min-search-indicator');
    if (minLabel) minLabel.innerText = "Search";
    if (minIndicator) minIndicator.classList.add('hidden');

    restoreDirectorySearch();
    switchView('view-directory');

    window.scrollTo({ top: 0 });
    const recordList = document.getElementById('record-list');
    if (recordList) recordList.scrollTop = 0;
    
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) {
        if (targetType === 'customers') headerTitle.innerText = "Customer Directory";
        else if (targetType === 'stores') headerTitle.innerText = "Store Directory";
        else headerTitle.innerText = "Rates & Barangays";
    }

    initDirectoryScrollListener();
}

export function filterDirectoryRecords() {
    const searchInput = document.getElementById('search-input');
    const floatingInput = document.getElementById('floating-search-input');
    const clearBtn = document.getElementById('clear-search-btn');
    const floatingClearBtn = document.getElementById('floating-clear-search-btn');
    const minLabel = document.getElementById('dir-min-search-label');
    const minIndicator = document.getElementById('dir-min-search-indicator');

    const activeVal = searchInput?.value || floatingInput?.value || '';
    const query = activeVal.trim();

    if (searchInput && searchInput.value !== activeVal) searchInput.value = activeVal;
    if (floatingInput && floatingInput.value !== activeVal) floatingInput.value = activeVal;

    if (clearBtn) {
        if (query.length > 0) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }

    if (floatingClearBtn) {
        if (query.length > 0) floatingClearBtn.classList.remove('hidden');
        else floatingClearBtn.classList.add('hidden');
    }

    if (minLabel) minLabel.innerText = query ? query : "Search";

    if (minIndicator) {
        if (query) minIndicator.classList.remove('hidden');
        else minIndicator.classList.add('hidden');
    }

    renderDirectoryList();
}

export function clearDirectorySearch() {
    const searchInput = document.getElementById('search-input');
    const floatingInput = document.getElementById('floating-search-input');
    const clearBtn = document.getElementById('clear-search-btn');
    const floatingClearBtn = document.getElementById('floating-clear-search-btn');
    const minLabel = document.getElementById('dir-min-search-label');
    const minIndicator = document.getElementById('dir-min-search-indicator');

    if (searchInput) searchInput.value = '';
    if (floatingInput) floatingInput.value = '';

    if (clearBtn) clearBtn.classList.add('hidden');
    if (floatingClearBtn) floatingClearBtn.classList.add('hidden');

    if (minLabel) minLabel.innerText = "Search";
    if (minIndicator) minIndicator.classList.add('hidden');

    const floatingBar = document.getElementById('dir-floating-search-bar');
    if (floatingBar && !floatingBar.classList.contains('hidden')) {
        floatingInput?.focus();
    } else {
        searchInput?.focus();
    }

    renderDirectoryList();
}

export function copyBarangayRate(barangayName, rawRate, destinationMun = "Camiling", originMun = "Camiling") {
    let rateNum = parseFloat((rawRate || "").replace(/[^0-9.]/g, ''));
    let amountStr = !isNaN(rateNum) ? rateNum.toFixed(0) : (rawRate || '0').replace(/[^0-9.]/g, '');

    const cleanDestMun = (destinationMun || "Camiling").trim();
    const cleanOriginMun = (originMun || "Camiling").trim();
    const cleanBrgy = (barangayName || "").trim();

    const isCrossTown = cleanOriginMun.toLowerCase() !== cleanDestMun.toLowerCase();

    let firstLine = "";
    if (isCrossTown) {
        firstLine = `The delivery fee from ${cleanOriginMun} to ${cleanDestMun}, ${cleanBrgy} starts at ₱${amountStr}`;
    } else {
        firstLine = `The delivery fee at ${cleanDestMun}, ${cleanBrgy} starts at ₱${amountStr}`;
    }

    const formattedMessage = `${firstLine}\n\n(Note: Other fees may apply for additional stores or extra services!)\n\nYou may view our fee guidelines by visiting this google document link:\n\nhttps://docs.google.com/document/d/1CPUE5gx6JZqcZoRcU-OEOWWgUCLyZhF6WnWRbLTnVus/edit?usp=drivesdk`;

    copyText(formattedMessage);
    showToast(`📋 Copied rate message for ${cleanBrgy}!`);
}

export function renderDirectoryList() {
    const listEl = document.getElementById('record-list');
    const searchVal = (document.getElementById('floating-search-input')?.value || document.getElementById('search-input')?.value || '').toLowerCase().trim();
    if (!listEl) return;

    if (!globalState.records || globalState.records.length === 0) {
        loadDirectoryCache();
    }

    const isBarangay = globalState.currentType === 'barangays';
    const isCustomer = globalState.currentType === 'customers';
    const isStore = globalState.currentType === 'stores';
    const isAdminUser = checkAdminAccess();

    if (isBarangay) {
        populateDestinationDropdown();
    }

    let records = globalState.records ? globalState.records.filter(r => (r.type || 'customers') === globalState.currentType) : [];

    if (isBarangay) {
        const activeOriginHub = (globalState.selectedOriginHub || "Camiling").trim().toLowerCase();
        const activeDestination = (globalState.selectedDestinationMun || "ALL").trim().toLowerCase();

        if (activeOriginHub !== "all") {
            records = records.filter(r => {
                const recordOrigin = (r.originMunicipality || "Camiling").trim().toLowerCase();
                return recordOrigin === activeOriginHub;
            });
        }

        if (activeDestination !== "all") {
            records = records.filter(r => {
                const recordDest = (r.municipality || "Camiling").trim().toLowerCase();
                return recordDest === activeDestination;
            });
        }
    }

    if (searchVal) {
        records = records.filter(r => 
            (r.name || '').toLowerCase().includes(searchVal) ||
            (r.barangay || '').toLowerCase().includes(searchVal) ||
            (r.originMunicipality || '').toLowerCase().includes(searchVal) ||
            (r.municipality || '').toLowerCase().includes(searchVal) ||
            (r.region || '').toLowerCase().includes(searchVal) ||
            (r.nationality || '').toLowerCase().includes(searchVal) ||
            (r.address || '').toLowerCase().includes(searchVal) ||
            (r.rate || '').toLowerCase().includes(searchVal) ||
            (r.contact || '').toLowerCase().includes(searchVal)
        );
    }

    if (records.length === 0) {
        let noRecordsMsg = 'No records found. Click + to add or tap 🔄 to refresh.';
        if (isBarangay) {
            const originLabel = globalState.selectedOriginHub || 'Camiling';
            const destLabel = globalState.selectedDestinationMun || 'ALL';
            noRecordsMsg = `Walang rates na nakarehistro [From: ${originLabel} ➔ To: ${destLabel}]. I-click ang + para magdagdag.`;
        }
        listEl.innerHTML = `<div class="text-center text-gray-500 italic py-16 text-xs">${escapeHtml(noRecordsMsg)}</div>`;
        setupAlphabetScrubber([]);
        return;
    }

    records.sort((a, b) => {
        const secA = getSectionLetter(a.name);
        const secB = getSectionLetter(b.name);
        if (secA === "#" && secB !== "#") return -1;
        if (secA !== "#" && secB === "#") return 1;
        return (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' });
    });

    let currentLetterGroup = "";
    let htmlBuilder = "";
    let availableLetters = new Set();

    records.forEach(r => {
        const letterHeader = getSectionLetter(r.name);
        availableLetters.add(letterHeader);

        if (letterHeader !== currentLetterGroup) {
            currentLetterGroup = letterHeader;
            const headerLabel = letterHeader === "#" ? "# (Special & Foreign)" : letterHeader;

            htmlBuilder += `
            <div id="dir-section-${letterHeader === "#" ? "SPECIAL" : letterHeader}" data-section="${letterHeader}" style="scroll-margin-top: 56px;" class="scroll-mt-14 sticky top-0 z-20 bg-gray-100/95 dark:bg-cardBg/95 backdrop-blur-md text-amber-700 dark:text-amber-400 font-black text-xs px-3 py-2 border-b border-gray-200 dark:border-gray-800 rounded-xl shadow-xs my-1 flex items-center justify-between">
                <span>${headerLabel}</span>
                <span class="text-[9px] text-gray-500 dark:text-gray-400 font-medium">Section Header</span>
            </div>`;
        }

        const safeCompositeKey = escapeHtml(r.compositeKey || "");
        const safeRecordName = escapeHtml(r.name || "");
        const safeEscapedName = (r.name || "").replace(/'/g, "\\'");
        const safeMapLink = escapeHtml(r.lat_lon_link || "");

        let mapBtn = '';
        if (r.lat_lon_link) {
            if (isCustomer) {
                mapBtn = `<button type="button" onclick="window.promptViewCustomerLocation && window.promptViewCustomerLocation('${safeEscapedName}', '${safeMapLink}')" class="text-xs text-blue-600 dark:text-blue-400 font-bold underline flex items-center gap-1 mt-1 cursor-pointer hover:text-blue-500 transition active:scale-95"><i class="fa-solid fa-map-location-dot"></i> View Location</button>`;
            } else {
                mapBtn = `<a href="${safeMapLink}" target="_blank" class="text-xs text-blue-600 dark:text-blue-400 font-bold underline flex items-center gap-1 mt-1"><i class="fa-solid fa-map-location-dot"></i> View Location</a>`;
            }
        }

        const deleteBtnHtml = isAdminUser 
            ? `<button onclick="promptDeleteDirectoryRecord('${safeRecordName}', '${safeCompositeKey}')" class="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-red-600 dark:text-red-400 p-2 rounded-lg text-xs transition active:scale-90 cursor-pointer" title="Delete">
                    <i class="fa-solid fa-trash"></i>
               </button>`
            : '';

        const recordedByText = escapeHtml(r.recorded_by || "System");
        const recordedAtText = r.recorded_at ? ` • ${escapeHtml(r.recorded_at)}` : '';
        const metaInfoHtml = `<div class="text-[10px] text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1 flex-wrap"><i class="fa-solid fa-user-pen text-[9px] shrink-0"></i> <span>Recorded by <span class="text-gray-800 dark:text-gray-300 font-bold">${recordedByText}</span></span>${recordedAtText ? `<span class="whitespace-nowrap">${recordedAtText}</span>` : ''}</div>`;

        if (isBarangay) {
            let rateNum = parseFloat((r.rate || r.address || "").replace(/[^0-9.]/g, ''));
            let displayRate = !isNaN(rateNum) ? `₱${rateNum.toFixed(2)}` : (r.rate || r.address || '₱0.00');

            const originMun = (r.originMunicipality || "Camiling").trim();
            const destMun = (r.municipality || "Camiling").trim();
            const resolvedBrgy = (r.barangay || r.name || "").trim();

            const isCrossTown = originMun.toLowerCase() !== destMun.toLowerCase();

            const locationSubtitleHtml = isCrossTown
                ? `<div class="text-[10px] text-amber-500 dark:text-amber-400 mt-0.5 font-bold flex items-center gap-1">
                     <i class="fa-solid fa-arrow-right text-[8.5px]"></i> From <span class="underline">${escapeHtml(originMun)}</span> to <span class="text-white">${escapeHtml(destMun)}</span>
                   </div>`
                : `<div class="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 font-medium flex items-center gap-1">
                     <i class="fa-solid fa-location-dot text-[9px] text-emerald-500"></i> Local: ${escapeHtml(destMun)} Hub
                   </div>`;

            htmlBuilder += `
            <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 p-3.5 rounded-2xl flex justify-between items-center gap-2 shadow-xs my-1">
                <div class="flex-1 min-w-0 pr-1">
                    <div class="font-black text-sm text-gray-900 dark:text-white flex items-start gap-1.5 leading-snug break-words">
                        <i class="fa-solid fa-map-location-dot text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0 text-xs"></i>
                        <span class="break-words">${escapeHtml(resolvedBrgy)}</span>
                    </div>
                    ${locationSubtitleHtml}
                    <div class="text-xs font-mono text-emerald-700 dark:text-emerald-400 font-black mt-1">Delivery Rate: ${escapeHtml(displayRate)}</div>
                    ${metaInfoHtml}
                </div>
                <div class="flex gap-1.5 shrink-0 items-center">
                    <button onclick="copyBarangayRate('${escapeHtml(resolvedBrgy)}', '${escapeHtml(displayRate)}', '${escapeHtml(destMun)}', '${escapeHtml(originMun)}')" class="bg-blue-50 hover:bg-blue-100 dark:bg-blue-600/30 dark:hover:bg-blue-600 text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-white border border-blue-200 dark:border-blue-500/50 px-2.5 py-1.5 rounded-lg text-xs font-bold transition active:scale-90 flex items-center gap-1 cursor-pointer" title="Copy Rate Message">
                        <i class="fa-solid fa-copy"></i> Copy
                    </button>
                    <button onclick="editDirectoryRecord('${safeRecordName}', '${safeCompositeKey}')" class="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-amber-600 dark:text-amber-400 p-2 rounded-lg text-xs transition active:scale-90 cursor-pointer" title="Edit">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    ${deleteBtnHtml}
                </div>
            </div>`;
        } else {
            const menuGalleryBtn = isStore ? `
                <button type="button" onclick="window.openStoreMenuGalleryModal && window.openStoreMenuGalleryModal('${safeEscapedName}', '${safeCompositeKey}')" class="bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/10 dark:hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30 px-2.5 py-1.5 rounded-lg text-xs font-bold transition active:scale-90 flex items-center gap-1.5 cursor-pointer shadow-xs" title="View & Download Restaurant Menu">
                    <i class="fa-solid fa-book-open text-xs"></i> <span>Menu</span>
                </button>
            ` : '';

            htmlBuilder += `
            <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 p-3.5 rounded-2xl flex justify-between items-start gap-2 shadow-xs my-1">
                <div class="flex-1 min-w-0 pr-1">
                    <div class="font-black text-sm text-gray-900 dark:text-white break-words leading-snug flex items-center gap-1.5 flex-wrap">
                        ${isStore ? '<i class="fa-solid fa-store text-orange-500 text-xs"></i>' : ''}
                        <span>${escapeHtml(r.name)}</span>
                    </div>
                    ${r.contact ? `<div class="text-xs text-gray-700 dark:text-gray-400 mt-0.5 font-bold font-mono"><i class="fa-solid fa-phone text-[10px] text-blue-500"></i> ${escapeHtml(r.contact)}</div>` : ''}
                    ${r.address ? `<div class="text-xs text-gray-700 dark:text-gray-300 mt-0.5 font-medium break-words"><i class="fa-solid fa-location-dot text-[10px] text-red-500"></i> ${escapeHtml(r.address)}</div>` : ''}
                    ${mapBtn}
                    ${metaInfoHtml}
                </div>
                <div class="flex gap-1.5 shrink-0 items-center">
                    ${menuGalleryBtn}
                    <button onclick="editDirectoryRecord('${safeRecordName}', '${safeCompositeKey}')" class="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-amber-600 dark:text-amber-400 p-2 rounded-lg text-xs transition active:scale-90 cursor-pointer" title="Edit">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    ${deleteBtnHtml}
                </div>
            </div>`;
        }
    });

    listEl.innerHTML = htmlBuilder;
    setupAlphabetScrubber(Array.from(availableLetters));
}

export function setupAlphabetScrubber(availableLetters) {
    const scrubberContainer = document.getElementById('alphabet-scrubber');
    if (!scrubberContainer) return;

    const alphabet = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

    let bubbleEl = document.getElementById('scrubber-bubble');
    if (!bubbleEl) {
        bubbleEl = document.createElement('div');
        bubbleEl.id = 'scrubber-bubble';
        bubbleEl.className = 'fixed right-12 z-50 w-12 h-12 rounded-full bg-blue-600 text-white font-black text-xl flex items-center justify-center shadow-2xl border-2 border-white pointer-events-none transition-opacity duration-150 opacity-0 transform -translate-y-1/2';
        document.body.appendChild(bubbleEl);
    }

    scrubberContainer.innerHTML = alphabet.map(char => {
        const hasRecords = availableLetters.includes(char);
        const opacityClass = hasRecords ? "text-blue-600 dark:text-blue-400 font-black" : "text-gray-400 dark:text-gray-600 opacity-40 font-semibold";
        return `<span data-letter="${char}" class="scrubber-letter py-0.5 px-1 cursor-pointer transition-transform duration-75 text-[10px] select-none block text-center ${opacityClass}">${char}</span>`;
    }).join('');

    const letterNodes = Array.from(scrubberContainer.querySelectorAll('.scrubber-letter'));

    const jumpToSectionLetter = (letter) => {
        if (!letter || letter === lastJumpLetter) return;
        lastJumpLetter = letter;

        const sectionId = letter === "#" ? "dir-section-SPECIAL" : `dir-section-${letter}`;
        let targetEl = document.getElementById(sectionId);

        if (!targetEl) {
            const allSections = Array.from(document.querySelectorAll('[data-section]'));
            if (allSections.length === 0) return;

            if (letter === "#") {
                targetEl = allSections[0];
            } else {
                targetEl = allSections.find(sec => {
                    const s = sec.dataset.section;
                    if (s === "#") return false;
                    return s.localeCompare(letter) >= 0;
                }) || allSections[allSections.length - 1];
            }
        }

        if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'auto', block: 'start' });

            const recordList = document.getElementById('record-list');
            if (recordList && (recordList.scrollHeight > recordList.clientHeight + 10)) {
                const targetRect = targetEl.getBoundingClientRect();
                const containerRect = recordList.getBoundingClientRect();
                const diff = targetRect.top - containerRect.top;
                if (Math.abs(diff) > 5) {
                    recordList.scrollTop += diff;
                }
            }
        }
    };

    letterNodes.forEach(node => {
        node.onclick = (e) => {
            e.stopPropagation();
            jumpToSectionLetter(node.dataset.letter);
        };
    });

    const updateElasticDistortion = (clientY) => {
        let activeChar = "";
        let activeY = clientY;

        letterNodes.forEach((node) => {
            const rect = node.getBoundingClientRect();
            const nodeCenterY = rect.top + rect.height / 2;
            const dist = Math.abs(clientY - nodeCenterY);

            if (dist < 50) {
                const factor = 1 - (dist / 50);
                const scale = 1 + (factor * 1.3);
                const translateX = -(factor * 16);

                node.style.transform = `scale(${scale}) translateX(${translateX}px)`;
                node.style.color = '#0284c7';

                if (dist < 15) {
                    activeChar = node.dataset.letter;
                    activeY = nodeCenterY;
                }
            } else {
                node.style.transform = 'scale(1) translateX(0px)';
                node.style.color = '';
            }
        });

        if (activeChar && bubbleEl) {
            bubbleEl.innerText = activeChar;
            bubbleEl.style.top = `${activeY}px`;
            bubbleEl.style.opacity = '1';
            jumpToSectionLetter(activeChar);
        }
    };

    const resetElasticDistortion = () => {
        lastJumpLetter = "";
        letterNodes.forEach(node => {
            node.style.transform = 'scale(1) translateX(0px)';
            node.style.color = '';
        });
        if (bubbleEl) bubbleEl.style.opacity = '0';
    };

    scrubberContainer.ontouchstart = (e) => {
        e.preventDefault();
        if (e.touches[0]) updateElasticDistortion(e.touches[0].clientY);
    };

    scrubberContainer.ontouchmove = (e) => {
        e.preventDefault();
        if (e.touches[0]) updateElasticDistortion(e.touches[0].clientY);
    };

    scrubberContainer.ontouchend = () => resetElasticDistortion();
    scrubberContainer.ontouchcancel = () => resetElasticDistortion();

    scrubberContainer.onmousedown = (e) => {
        const onMouseMove = (moveEvt) => updateElasticDistortion(moveEvt.clientY);
        const onMouseUp = () => {
            resetElasticDistortion();
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        updateElasticDistortion(e.clientY);
    };
}

if (typeof window !== 'undefined') {
    window.updateRosterCreditsDisplay = updateRosterCreditsDisplay;
    window.showCreditsInfoToast = showCreditsInfoToast;
    window.initRiderCreditsListener = initRiderCreditsListener;
    window.handleOriginHubChange = handleOriginHubChange;
    window.handleDestinationChange = handleDestinationChange;
    window.populateDestinationDropdown = populateDestinationDropdown;
    window.copyBarangayRate = copyBarangayRate;
    window.promptViewCustomerLocation = promptViewCustomerLocation;
    window.closeCustomerLocationConfirmModal = closeCustomerLocationConfirmModal;
    window.confirmAndOpenCustomerLocation = confirmAndOpenCustomerLocation;
    window.openStoreMenuGalleryModal = openStoreMenuGalleryModal;
    window.closeStoreMenuGalleryModal = closeStoreMenuGalleryModal;
    window.handleMenuPhotoUpload = handleMenuPhotoUpload;
    window.downloadCompleteMenuToPhone = downloadCompleteMenuToPhone;
    window.deleteMenuGalleryPage = deleteMenuGalleryPage;
    window.openGalleryLightbox = openGalleryLightbox;
    window.closeGalleryLightbox = closeGalleryLightbox;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            updateRosterCreditsDisplay();
            initRiderCreditsListener();
        });
    } else {
        updateRosterCreditsDisplay();
        initRiderCreditsListener();
    }
}

// REMARKS: DIRECTORY_UI_MULTI_PHOTO_GALLERY_STORAGE_V11_COMPLETE