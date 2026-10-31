// src/features/directory/ui/directoryListRender.js
import { db } from '../../../config/firebase.js';
import { appState, globalState } from '../../../store/state.js';
import { switchView } from '../../../ui/router.js';
import { showToast } from '../../../ui/notifications.js';
import { escapeHtml, copyText } from '../../../utils/helpers.js';
import { loadDirectoryCache } from '../directoryStorage.js';
import { checkAdminAccess } from '../directoryPermissions.js';
import { updateRosterCreditsDisplay, isDirectoryCreditsEnabled } from './directoryCredits.js';
import { populateDestinationDropdown, detectAndSetGpsDestination, copyBarangayRate } from './directoryRouting.js';
import { storeMenuMetadataMap, initStoreMenuGalleriesListener, formatMenuUpdatedAt } from './directoryGalleries.js';

let lastJumpLetter = "";
let pendingMapUnlock = null;

export function getSectionLetter(name) {
    if (!name) return "#";
    const firstChar = name.trim().charAt(0).toUpperCase();
    return /^[A-Z]$/.test(firstChar) ? firstChar : "#";
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
                    ⚠️ Insufficient Directory Credits! Register a customer (+5) or store (+10) first to earn credits.
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

export function handleViewCustomerLocationClick(btn) {
    if (!btn) return;
    const custName = btn.getAttribute('data-customer-name') || "Customer";
    const mapUrl = btn.getAttribute('data-map-link') || "";
    promptViewCustomerLocation(custName, mapUrl);
}

export function promptViewCustomerLocation(customerName, mapUrl) {
    if (!mapUrl) {
        showToast("⚠️ No saved GPS link for this customer.");
        return;
    }

    const isAdmin = checkAdminAccess();
    const creditsEnabled = typeof isDirectoryCreditsEnabled === 'function' ? isDirectoryCreditsEnabled() : true;

    // If Credit System is turned OFF by Admin, or user is Admin:
    // Location lookup is 100% free; open map directly without deduction!
    if (!creditsEnabled || isAdmin) {
        window.open(mapUrl, '_blank');
        return;
    }

    const modal = getOrCreateLocationConfirmModal();
    const nameEl = document.getElementById('loc-confirm-customer-name');
    const balanceEl = document.getElementById('loc-confirm-current-balance');
    const costLabel = document.getElementById('loc-confirm-cost-label');
    const warningEl = document.getElementById('loc-confirm-warning');
    const proceedBtn = document.getElementById('loc-confirm-proceed-btn');

    if (nameEl) nameEl.innerText = customerName || "Customer";

    let currentBalance = parseInt(localStorage.getItem('lokalex_rider_credits') || "0", 10);
    if (isNaN(currentBalance)) currentBalance = 0;

    pendingMapUnlock = { customerName, mapUrl };

    if (costLabel) costLabel.innerText = "-1 Directory Credit";
    if (balanceEl) balanceEl.innerText = `${currentBalance} credit(s)`;

    if (currentBalance < 1) {
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
    const creditsEnabled = typeof isDirectoryCreditsEnabled === 'function' ? isDirectoryCreditsEnabled() : true;
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();

    // STRICT GUARD: Only deduct credits if Credit System is ACTUALLY enabled and user is not admin
    if (creditsEnabled && !isAdmin && myId) {
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
            showToast("⚠️ Insufficient credits to view location.");
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
        if (targetType === 'stores') {
            initStoreMenuGalleriesListener();
        }
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
    if (typeof document !== 'undefined' && document.body) {
        document.body.classList.remove('overflow-hidden', 'touch-none');
    }
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

export function handleEditDirectoryRecordClick(btn) {
    if (!btn) return;
    const name = btn.getAttribute('data-record-name') || '';
    const key = btn.getAttribute('data-composite-key') || '';
    if (window.editDirectoryRecord) window.editDirectoryRecord(name, key);
}

export function handleDeleteDirectoryRecordClick(btn) {
    if (!btn) return;
    const name = btn.getAttribute('data-record-name') || '';
    const key = btn.getAttribute('data-composite-key') || '';
    if (window.promptDeleteDirectoryRecord) window.promptDeleteDirectoryRecord(name, key);
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

    let htmlBuilder = "";

    if (isStore) {
        htmlBuilder += `
        <div class="mb-3 p-3 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-between gap-2 shadow-xs">
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
                <div class="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <i class="fa-solid fa-share-nodes text-xs"></i>
                </div>
                <div class="min-w-0 flex-1">
                    <div class="font-bold text-xs text-gray-900 dark:text-white truncate">Customer Menu Link</div>
                    <div class="text-[10px] text-gray-500 dark:text-gray-400 truncate">Share restaurant photo menus with customers</div>
                </div>
            </div>
            <button type="button" onclick="window.shareCustomerMenuCatalogLink && window.shareCustomerMenuCatalogLink()" class="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs px-3 py-1.5 rounded-xl shadow-xs transition active:scale-95 flex items-center gap-1.5 shrink-0 cursor-pointer">
                <i class="fa-solid fa-link text-[10px]"></i> <span>Share Link</span>
            </button>
        </div>`;
    }

    if (records.length === 0) {
        let noRecordsMsg = 'No records found. Click + to add or tap 🔄 to refresh.';
        if (isBarangay) {
            const originLabel = globalState.selectedOriginHub || 'Camiling';
            const destLabel = globalState.selectedDestinationMun || 'ALL';
            noRecordsMsg = `No rates registered [From: ${originLabel} ➔ To: ${destLabel}]. Click + to add.`;
        }
        htmlBuilder += `<div class="text-center text-gray-500 italic py-16 text-xs">${escapeHtml(noRecordsMsg)}</div>`;
        listEl.innerHTML = htmlBuilder;
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
    let availableLetters = new Set();

    records.forEach(r => {
        const letterHeader = getSectionLetter(r.name);
        availableLetters.add(letterHeader);

        if (letterHeader !== currentLetterGroup) {
            currentLetterGroup = letterHeader;
            const headerLabel = letterHeader === "#" ? "# (Special & Foreign)" : letterHeader;

            htmlBuilder += `
            <div id="dir-section-${letterHeader === "#" ? "SPECIAL" : letterHeader}" data-section="${letterHeader}" style="scroll-margin-top: 56px;" class="scroll-mt-14 sticky top-0 z-20 bg-amber-100/95 dark:bg-amber-950/70 backdrop-blur-md text-amber-900 dark:text-amber-300 font-black text-xs px-3 py-2 border border-amber-300 dark:border-amber-700/60 rounded-xl shadow-xs my-1 flex items-center justify-between">
                <span>${headerLabel}</span>
                <span class="text-[9px] text-amber-700/80 dark:text-amber-400/80 font-bold uppercase tracking-wider">Section</span>
            </div>`;
        }

        const safeCompositeKey = escapeHtml(r.compositeKey || "");
        const rawName = r.name || "";
        const safeRecordName = escapeHtml(rawName);
        const safeMapLink = escapeHtml(r.lat_lon_link || "");

        let mapBtn = '';
        if (r.lat_lon_link) {
            if (isCustomer) {
                mapBtn = `<button type="button" data-customer-name="${safeRecordName}" data-map-link="${safeMapLink}" onclick="window.handleViewCustomerLocationClick && window.handleViewCustomerLocationClick(this)" class="text-xs text-blue-600 dark:text-blue-400 font-bold underline flex items-center gap-1 mt-1 cursor-pointer hover:text-blue-500 transition active:scale-95"><i class="fa-solid fa-map-location-dot"></i> View Location</button>`;
            } else {
                mapBtn = `<a href="${safeMapLink}" target="_blank" class="text-xs text-blue-600 dark:text-blue-400 font-bold underline flex items-center gap-1 mt-1"><i class="fa-solid fa-map-location-dot"></i> View Location</a>`;
            }
        }

        const deleteBtnHtml = isAdminUser 
            ? `<button type="button" data-record-name="${safeRecordName}" data-composite-key="${safeCompositeKey}" onclick="window.handleDeleteDirectoryRecordClick && window.handleDeleteDirectoryRecordClick(this)" class="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-red-600 dark:text-red-400 p-2 rounded-lg text-xs transition active:scale-90 cursor-pointer" title="Delete">
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
                ? `<div class="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 font-bold flex items-center gap-1">
                     <i class="fa-solid fa-arrow-right text-[8.5px]"></i> From <span class="underline">${escapeHtml(originMun)}</span> to <span class="text-gray-900 dark:text-white font-black">${escapeHtml(destMun)}</span>
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
                    <button type="button" data-record-name="${safeRecordName}" data-composite-key="${safeCompositeKey}" onclick="window.handleEditDirectoryRecordClick && window.handleEditDirectoryRecordClick(this)" class="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-amber-600 dark:text-amber-400 p-2 rounded-lg text-xs transition active:scale-95 cursor-pointer" title="Edit">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    ${deleteBtnHtml}
                </div>
            </div>`;
        } else {
            let menuStatusHtml = '';
            let menuGalleryBtn = '';

            if (isStore) {
                // Dual-key lookup guarantees instant 0ms resolution regardless of formatting
                const keyByComposite = (r.compositeKey || "").toLowerCase().replace(/[^a-z0-9]/g, '');
                const keyByName = (r.name || "").toLowerCase().replace(/[^a-z0-9]/g, '');
                const meta = (keyByComposite && storeMenuMetadataMap[keyByComposite])
                    || (keyByName && storeMenuMetadataMap[keyByName])
                    || null;

                const pageCount = meta?.pageCount || 0;
                const hasMenu = pageCount > 0;
                const updatedDateStr = formatMenuUpdatedAt(meta?.updatedAt);

                if (hasMenu) {
                    menuStatusHtml = `
                    <div class="flex items-center gap-1.5 flex-wrap mt-1">
                        <span class="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 text-[9.5px] font-black px-2 py-0.5 rounded-md flex items-center gap-1 shadow-2xs">
                            <i class="fa-solid fa-camera"></i> ${pageCount} ${pageCount === 1 ? 'Page' : 'Pages'}
                        </span>
                        ${updatedDateStr ? `
                        <span class="text-[9.5px] text-gray-500 dark:text-gray-400 flex items-center gap-1 font-medium">
                            <i class="fa-regular fa-calendar-check text-[9px] text-emerald-500"></i> Updated: <strong class="text-gray-700 dark:text-gray-300 font-bold">${escapeHtml(updatedDateStr)}</strong>
                        </span>` : ''}
                    </div>`;

                    menuGalleryBtn = `
                    <button type="button"
                            data-store-name="${safeRecordName}"
                            data-composite-key="${safeCompositeKey}"
                            onclick="window.handleOpenMenuGalleryClick && window.handleOpenMenuGalleryClick(this)"
                            class="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition active:scale-95 flex items-center gap-1.5 cursor-pointer shadow-xs"
                            title="View Restaurant Menu (${pageCount} pages)">
                        <i class="fa-solid fa-book-open text-xs"></i> <span>Menu (${pageCount})</span>
                    </button>`;
                } else {
                    menuStatusHtml = `
                    <div class="flex items-center gap-1.5 flex-wrap mt-1">
                        <span class="bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-zinc-700/60 text-[9.5px] font-medium px-2 py-0.5 rounded-md flex items-center gap-1">
                            <i class="fa-regular fa-image text-gray-400"></i> No menu photos yet
                        </span>
                    </div>`;

                    menuGalleryBtn = `
                    <button type="button"
                            data-store-name="${safeRecordName}"
                            data-composite-key="${safeCompositeKey}"
                            onclick="window.handleOpenMenuGalleryClick && window.handleOpenMenuGalleryClick(this)"
                            class="bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/10 dark:hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30 px-2.5 py-1.5 rounded-lg text-xs font-bold transition active:scale-95 flex items-center gap-1.5 cursor-pointer shadow-xs"
                            title="Add Restaurant Menu Photos">
                        <i class="fa-solid fa-camera text-xs"></i> <span>+ Add Menu</span>
                    </button>`;
                }
            }

            let locationsHtml = '';
            if (isCustomer && Array.isArray(r.locations) && r.locations.length > 1) {
                locationsHtml = `
                <div class="mt-1.5 flex flex-col gap-1">
                    <span class="text-[9.5px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
                        <i class="fa-solid fa-map-location-dot text-rose-500"></i> ${r.locations.length} Saved Locations:
                    </span>
                    ${r.locations.map((loc, lIdx) => {
                        const locName = loc.label || `Location ${lIdx + 1}`;
                        const locAddr = loc.address || '';
                        const locMap = loc.lat_lon_link || loc.mapPinLink || '';
                        const locMapBtn = locMap ? `
                            <button type="button" data-customer-name="${safeRecordName} (${escapeHtml(locName)})" data-map-link="${escapeHtml(locMap)}" onclick="window.handleViewCustomerLocationClick && window.handleViewCustomerLocationClick(this)" class="text-[10px] text-blue-600 dark:text-blue-400 font-bold underline flex items-center gap-1 cursor-pointer hover:text-blue-500 transition active:scale-95 shrink-0">
                                <i class="fa-solid fa-map-location-dot"></i> View Pin
                            </button>` : '';

                        return `
                        <div class="bg-gray-50 dark:bg-black/30 p-2 rounded-xl border border-gray-200 dark:border-gray-800 text-xs flex flex-col gap-0.5">
                            <div class="flex items-center justify-between gap-1">
                                <span class="font-bold text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                    <i class="fa-solid fa-location-dot text-rose-500 text-[9px]"></i> ${escapeHtml(locName)}
                                    ${loc.isPrimary ? '<span class="text-[8px] bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold px-1 rounded">Default</span>' : ''}
                                </span>
                                ${locMapBtn}
                            </div>
                            ${locAddr ? `<span class="text-gray-700 dark:text-gray-300 font-medium break-words text-[11px]">${escapeHtml(locAddr)}</span>` : ''}
                        </div>`;
                    }).join('')}
                </div>`;
            } else {
                locationsHtml = `
                    ${r.address ? `<div class="text-xs text-gray-700 dark:text-gray-300 mt-0.5 font-medium break-words"><i class="fa-solid fa-location-dot text-[10px] text-red-500"></i> ${escapeHtml(r.address)}</div>` : ''}
                    ${mapBtn}
                `;
            }

            htmlBuilder += `
            <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 p-3.5 rounded-2xl flex justify-between items-start gap-2 shadow-xs my-1">
                <div class="flex-1 min-w-0 pr-1">
                    <div class="font-black text-sm text-gray-900 dark:text-white break-words leading-snug flex items-center gap-1.5 flex-wrap">
                        ${isStore ? '<i class="fa-solid fa-store text-orange-500 text-xs"></i>' : ''}
                        <span>${safeRecordName}</span>
                    </div>
                    ${menuStatusHtml}
                    ${r.contact ? `<div class="text-xs text-gray-700 dark:text-gray-400 mt-1 font-bold font-mono"><i class="fa-solid fa-phone text-[10px] text-blue-500"></i> ${escapeHtml(r.contact)}</div>` : ''}
                    ${locationsHtml}
                    ${metaInfoHtml}
                </div>
                <div class="flex gap-1.5 shrink-0 items-center">
                    ${menuGalleryBtn}
                    <button type="button" data-record-name="${safeRecordName}" data-composite-key="${safeCompositeKey}" onclick="window.handleEditDirectoryRecordClick && window.handleEditDirectoryRecordClick(this)" class="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-amber-600 dark:text-amber-400 p-2 rounded-lg text-xs transition active:scale-95 cursor-pointer" title="Edit">
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

