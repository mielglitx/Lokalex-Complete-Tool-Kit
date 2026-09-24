// src/features/directory/directoryUi.js

/**
 * ============================================================================
 * DIRECTORY UI, DUAL-TIER ROUTING TOOLBAR & GPS DESTINATION AUTO-SELECT
 * ============================================================================
 * 
 * Description:
 * Manages presentation layer, card rendering, search filtering, and credit consumption:
 * - Dual-Tier Routing Toolbar: Coordinates Origin Hub (`#dir-origin-hub-select`)
 *   and Destination Municipality (`#dir-destination-select`).
 * - Records-Only Destination Population: Dynamically extracts only serviced
 *   municipalities that have recorded rates under the active Starting Hub.
 * - Non-Blocking GPS Auto-Selection: Compares device GPS coordinates against
 *   municipal geographic anchors in the background to auto-select the user's
 *   local municipality without blocking initial page rendering.
 * - Anti-Clipping Typography: Uses flex wrapping and break-words for long barangay
 *   names (e.g., Cacamilingan Norte, Palimbo-Caarosipan) to prevent text cutoff.
 * - Contextual Rate Copy Engine: Formats copied customer fee advisories as:
 *   - Cross-Town: "The delivery fee from [Origin] to [Municipality], [Barangay] starts at ₱[rate]"
 *   - Local Town: "The delivery fee at [Municipality], [Barangay] starts at ₱[rate]"
 * ============================================================================
 */

import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { switchView } from '../../ui/router.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { escapeHtml, copyText } from '../../utils/helpers.js';
import { loadDirectoryCache } from './directoryStorage.js';
import { checkAdminAccess } from './directoryPermissions.js';

let lastJumpLetter = "";
let creditsListenerActive = false;
let hasAttemptedGpsAutoSelect = false;

// MUNICIPALITY GEOGRAPHIC ANCHORS FOR GPS DISTANCE COMPUTATION
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

/**
 * Updates the rider credits pill display on the home roster dashboard.
 */
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

/**
 * Displays informational guidance when tapping the credits pill.
 */
export function showCreditsInfoToast() {
    const isAdmin = checkAdminAccess();
    if (isAdmin) {
        showToast("👑 Admin Account: Mayroon kang UNLIMITED Directory Access at hindi ka nababawasan ng credits.");
        return;
    }

    const cur = parseInt(localStorage.getItem('lokalex_rider_credits') || "0", 10);
    const config = globalState.directoryCreditsConfig || {};
    const cost = config.costPerAccess !== undefined ? config.costPerAccess : 1;
    const custR = config.rewardCustomerRegistration !== undefined ? config.rewardCustomerRegistration : 5;
    const storeR = config.rewardStoreRegistration !== undefined ? config.rewardStoreRegistration : 10;
    const status = config.enabled !== false ? 'ACTIVE' : 'DISABLED';

    showToast(`🪙 Directory Credits (${status})\n• Balance: ${cur} credits\n• -${cost} credit per Directory access\n• +${custR} credits per Customer registered\n• +${storeR} credits per Store registered`);
}

/**
 * Listens to real-time credit balance updates for the current rider from Firebase.
 */
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

/**
 * Populates the Destination dropdown with ONLY municipalities that have records
 * under the active Starting Hub.
 */
export function populateDestinationDropdown() {
    const destSelect = document.getElementById('dir-destination-select');
    if (!destSelect) return [];

    const activeOriginHub = (globalState.selectedOriginHub || "Camiling").trim().toLowerCase();
    const records = (globalState.records || []).filter(r => (r.type || 'customers') === 'barangays');

    // Extract municipalities that have at least 1 record under the current Starting Hub
    const munCountMap = new Map();

    records.forEach(r => {
        const rOrigin = (r.originMunicipality || "Camiling").trim().toLowerCase();
        if (activeOriginHub === "all" || rOrigin === activeOriginHub) {
            const destMun = (r.municipality || "Camiling").trim();
            munCountMap.set(destMun, (munCountMap.get(destMun) || 0) + 1);
        }
    });

    const servicedMunicipalities = Array.from(munCountMap.keys()).sort((a, b) => a.localeCompare(b));

    // Build options
    let optionsHtml = `<option value="ALL">🌐 All Destinations</option>`;

    servicedMunicipalities.forEach(mun => {
        optionsHtml += `<option value="${escapeHtml(mun)}">${escapeHtml(mun)} (${munCountMap.get(mun)})</option>`;
    });

    destSelect.innerHTML = optionsHtml;

    // Validate current selection
    if (!globalState.selectedDestinationMun) {
        globalState.selectedDestinationMun = localStorage.getItem('lokalex_selected_destination_mun') || "ALL";
    }

    if (globalState.selectedDestinationMun !== "ALL" && !servicedMunicipalities.includes(globalState.selectedDestinationMun)) {
        // Fallback to Camiling if available, else ALL
        globalState.selectedDestinationMun = servicedMunicipalities.includes("Camiling") ? "Camiling" : "ALL";
    }

    destSelect.value = globalState.selectedDestinationMun;
    return servicedMunicipalities;
}

/**
 * Non-blocking background GPS locator: finds nearest municipality among serviced towns.
 */
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

        // 0.05 sq deg threshold (~20km distance radius)
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

    // 1. Check existing cached GPS coordinates first
    if (appState.lat && appState.lon) {
        findNearest(appState.lat, appState.lon);
        return;
    }

    // 2. Non-blocking native GPS query
    if (!hasAttemptedGpsAutoSelect && navigator.geolocation) {
        hasAttemptedGpsAutoSelect = true;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                if (pos?.coords?.latitude && pos?.coords?.longitude) {
                    findNearest(pos.coords.latitude, pos.coords.longitude);
                }
            },
            () => {}, // Ignore errors silently
            { timeout: 4000, maximumAge: 300000, enableHighAccuracy: false }
        );
    }
}

/**
 * Handles switching the active Origin Starting Hub filter for rates.
 */
export function handleOriginHubChange(selectedHub) {
    globalState.selectedOriginHub = selectedHub || "Camiling";
    try {
        localStorage.setItem('lokalex_selected_origin_hub', globalState.selectedOriginHub);
    } catch(e) {}

    // Re-evaluate available destination municipalities for the selected origin
    const serviced = populateDestinationDropdown();
    renderDirectoryList();

    const hubLabel = selectedHub === "ALL" ? "Lahat ng Starting Hubs" : `${selectedHub} Hub`;
    showToast(`📍 Na-filter ang mga rates mula sa: ${hubLabel}`);
}

/**
 * Handles switching the active Destination Municipality filter for rates.
 */
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

/**
 * Navigates to directory view with dynamic credit validation and deduction.
 * Automatically synchronizes the dual-tier routing toolbar.
 */
export async function openDirectory(type) {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const isAdmin = checkAdminAccess();

    const creditConfig = globalState.directoryCreditsConfig || {
        enabled: true,
        costPerAccess: 1,
        rewardCustomerRegistration: 5,
        rewardStoreRegistration: 10
    };

    if (creditConfig.enabled && !isAdmin && myId) {
        const cost = creditConfig.costPerAccess !== undefined ? creditConfig.costPerAccess : 1;
        let currentCredits = parseInt(localStorage.getItem('lokalex_rider_credits') || "0", 10);

        if (db) {
            try {
                const snap = await db.ref(`riders/${myId}/directoryCredits`).once('value');
                if (snap.exists()) {
                    currentCredits = parseInt(snap.val(), 10) || 0;
                    localStorage.setItem('lokalex_rider_credits', currentCredits.toString());
                }
            } catch(e) {}
        }

        if (currentCredits < cost) {
            showToast(`⚠️ Kulang ang iyong Directory Credits (${currentCredits} natira)!\nKailangan ng ${cost} credit(s). Mag-rehistro ng Customer (+${creditConfig.rewardCustomerRegistration || 5}) o Store (+${creditConfig.rewardStoreRegistration || 10}) para magka-credits.`);
            showSideNotification("LOW CREDITS", `Insufficient balance (${currentCredits} credits). Register new entries to earn.`, "fa-coins", "text-red-400", "border-red-500");
            return;
        }

        const newBalance = Math.max(0, currentCredits - cost);
        localStorage.setItem('lokalex_rider_credits', newBalance.toString());
        appState.directoryCredits = newBalance;
        updateRosterCreditsDisplay(newBalance);

        if (db) {
            db.ref(`riders/${myId}/directoryCredits`).transaction(c => Math.max(0, (c || cost) - cost));
            db.ref(`roster/${myId}/directoryCredits`).transaction(c => Math.max(0, (c || cost) - cost)).catch(() => {});
        }

        showToast(`🪙 -${cost} Credit used for ${type || 'Directory'}. Balance: ${newBalance}`);
    }

    globalState.currentType = type || 'customers';

    // COORDINATE DUAL-TIER ROUTING TOOLBAR VISIBILITY
    const originContainer = document.getElementById('dir-origin-hub-container');
    const originSelect = document.getElementById('dir-origin-hub-select');

    if (type === 'barangays') {
        if (originContainer) originContainer.classList.remove('hidden');
        if (!globalState.selectedOriginHub) {
            globalState.selectedOriginHub = localStorage.getItem('lokalex_selected_origin_hub') || "Camiling";
        }
        if (originSelect) originSelect.value = globalState.selectedOriginHub;

        loadDirectoryCache();
        const serviced = populateDestinationDropdown();
        renderDirectoryList();

        // Non-blocking background GPS proximity check
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
        if (type === 'customers') headerTitle.innerText = "Customer Directory";
        else if (type === 'stores') headerTitle.innerText = "Store Directory";
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

/**
 * Copies formatted delivery fee message for a barangay:
 * - Cross-Town: "The delivery fee from [Origin] to [Municipality], [Barangay] starts at ₱[rate]"
 * - Intra-Town: "The delivery fee at [Municipality], [Barangay] starts at ₱[rate]"
 */
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

/**
 * Renders the directory cards list with sticky alphabetical sections,
 * anti-clipping titles, isolated Origin Hub, and Destination filtering.
 */
export function renderDirectoryList() {
    const listEl = document.getElementById('record-list');
    const searchVal = (document.getElementById('floating-search-input')?.value || document.getElementById('search-input')?.value || '').toLowerCase().trim();
    if (!listEl) return;

    if (!globalState.records || globalState.records.length === 0) {
        loadDirectoryCache();
    }

    const isBarangay = globalState.currentType === 'barangays';
    const isAdminUser = checkAdminAccess();

    let records = globalState.records ? globalState.records.filter(r => (r.type || 'customers') === globalState.currentType) : [];

    // ISOLATE RATES BY BOTH VECTOR AXES: ORIGIN HUB & DESTINATION MUNICIPALITY
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

    // Comprehensive Geographic Search Predicate
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

        let mapBtn = '';
        if (r.lat_lon_link) {
            mapBtn = `<a href="${escapeHtml(r.lat_lon_link)}" target="_blank" class="text-xs text-blue-600 dark:text-blue-400 font-bold underline flex items-center gap-1 mt-1"><i class="fa-solid fa-map-location-dot"></i> View Location</a>`;
        }

        const safeCompositeKey = escapeHtml(r.compositeKey || "");
        const safeRecordName = escapeHtml(r.name || "");

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

            // Render Geographic Route Breadcrumb Subtitle
            const locationSubtitleHtml = isCrossTown
                ? `<div class="text-[10px] text-amber-500 dark:text-amber-400 mt-0.5 font-bold flex items-center gap-1">
                     <i class="fa-solid fa-arrow-right text-[8.5px]"></i> From <span class="underline">${escapeHtml(originMun)}</span> to <span class="text-white">${escapeHtml(destMun)}</span>
                   </div>`
                : `<div class="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 font-medium flex items-center gap-1">
                     <i class="fa-solid fa-location-dot text-[9px] text-emerald-500"></i> Local: ${escapeHtml(destMun)} Hub
                   </div>`;

            // Anti-clipping header layout using break-words and leading-snug
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
            htmlBuilder += `
            <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 p-3.5 rounded-2xl flex justify-between items-start gap-2 shadow-xs my-1">
                <div class="flex-1 min-w-0 pr-1">
                    <div class="font-black text-sm text-gray-900 dark:text-white break-words leading-snug">${escapeHtml(r.name)}</div>
                    ${r.contact ? `<div class="text-xs text-gray-700 dark:text-gray-400 mt-0.5 font-bold font-mono"><i class="fa-solid fa-phone text-[10px] text-blue-500"></i> ${escapeHtml(r.contact)}</div>` : ''}
                    ${r.address ? `<div class="text-xs text-gray-700 dark:text-gray-300 mt-0.5 font-medium break-words"><i class="fa-solid fa-location-dot text-[10px] text-red-500"></i> ${escapeHtml(r.address)}</div>` : ''}
                    ${mapBtn}
                    ${metaInfoHtml}
                </div>
                <div class="flex gap-1 shrink-0 items-center">
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
    window.copyBarangayRate = copyBarangayRate;

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
// REMARKS: DIRECTORY_UI_DESTINATION_RECORDS_ONLY_GPS_AUTO_SELECT_V6_COMPLETE