// src/features/directory/directoryUi.js

/**
 * ============================================================================
 * DIRECTORY UI, DYNAMIC CREDIT GATE & INTERACTIVE SCRUBBER
 * ============================================================================
 * 
 * Description:
 * Manages presentation layer, card rendering, and credit consumption for directories:
 * - Dynamic Directory Credit Gate: Checks `globalState.directoryCreditsConfig`.
 *   If disabled by Admin or user is Admin, grants free access. If enabled for riders,
 *   enforces balance check and deducts the exact configured `costPerAccess`.
 * - Admin Exemption: Admins see `Credits: ∞ (Admin)` on their dashboard pill in
 *   gold styling and are never deducted or blocked.
 * - Live Credit Sync: Synchronizes remaining directory credits in real time.
 * - Universal `scrollIntoView` indexing with `scroll-margin-top: 56px`.
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

export function getSectionLetter(name) {
    if (!name) return "#";
    const firstChar = name.trim().charAt(0).toUpperCase();
    return /^[A-Z]$/.test(firstChar) ? firstChar : "#";
}

/**
 * Updates the rider credits pill display on the home roster dashboard.
 * Admins are rendered with an explicit unlimited / exempt badge.
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
 * Admins are strictly exempt and never blocked or deducted.
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

    // CREDIT DEDUCTION GATE (EXEMPT: ADMINS OR WHEN SYSTEM IS DISABLED)
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

    loadDirectoryCache();
    renderDirectoryList();
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

export function copyBarangayRate(barangayName, rawRate) {
    let rateNum = parseFloat((rawRate || "").replace(/[^0-9.]/g, ''));
    let amountStr = !isNaN(rateNum) ? rateNum.toFixed(0) : (rawRate || '0').replace(/[^0-9.]/g, '');

    const formattedMessage = `The delivery fee at ${barangayName} starts at ₱${amountStr}\n\n(Note: Other fees may apply for additional stores or extra services!)\n\nYou may view our fee guidelines by visiting this google document link:\n\nhttps://docs.google.com/document/d/1CPUE5gx6JZqcZoRcU-OEOWWgUCLyZhF6WnWRbLTnVus/edit?usp=drivesdk`;

    copyText(formattedMessage);
    showToast(`📋 Copied rate message for ${barangayName}!`);
}

export function renderDirectoryList() {
    const listEl = document.getElementById('record-list');
    const searchVal = (document.getElementById('floating-search-input')?.value || document.getElementById('search-input')?.value || '').toLowerCase().trim();
    if (!listEl) return;

    if (!globalState.records || globalState.records.length === 0) {
        loadDirectoryCache();
    }

    let records = globalState.records ? globalState.records.filter(r => (r.type || 'customers') === globalState.currentType) : [];

    if (searchVal) {
        records = records.filter(r => 
            (r.name || '').toLowerCase().includes(searchVal) ||
            (r.address || '').toLowerCase().includes(searchVal) ||
            (r.rate || '').toLowerCase().includes(searchVal) ||
            (r.contact || '').toLowerCase().includes(searchVal)
        );
    }

    if (records.length === 0) {
        listEl.innerHTML = `<div class="text-center text-gray-500 italic py-16 text-xs">No records found. Click + to add or tap 🔄 to refresh.</div>`;
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

    const isBarangay = globalState.currentType === 'barangays';
    const isAdminUser = checkAdminAccess();

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

        const deleteBtnHtml = isAdminUser 
            ? `<button onclick="promptDeleteDirectoryRecord('${escapeHtml(r.name)}')" class="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-red-600 dark:text-red-400 p-2 rounded-lg text-xs transition active:scale-90 cursor-pointer" title="Delete">
                    <i class="fa-solid fa-trash"></i>
               </button>`
            : '';

        const recordedByText = escapeHtml(r.recorded_by || "System");
        const recordedAtText = r.recorded_at ? ` • ${escapeHtml(r.recorded_at)}` : '';
        const metaInfoHtml = `<div class="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5 flex items-center gap-1"><i class="fa-solid fa-user-pen text-[9px]"></i> Recorded by <span class="text-gray-800 dark:text-gray-300 font-bold">${recordedByText}</span>${recordedAtText}</div>`;

        if (isBarangay) {
            let rateNum = parseFloat((r.rate || r.address || "").replace(/[^0-9.]/g, ''));
            let displayRate = !isNaN(rateNum) ? `₱${rateNum.toFixed(2)}` : (r.rate || r.address || '₱0.00');

            htmlBuilder += `
            <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 p-3.5 rounded-2xl flex justify-between items-center gap-2 shadow-xs my-1">
                <div class="flex-1 min-w-0">
                    <div class="font-black text-sm text-gray-900 dark:text-white truncate flex items-center gap-1.5"><i class="fa-solid fa-map-location-dot text-emerald-600 dark:text-emerald-400"></i> <span>${escapeHtml(r.name)}</span></div>
                    <div class="text-xs font-mono text-emerald-700 dark:text-emerald-400 font-black mt-1">Delivery Rate: ${escapeHtml(displayRate)}</div>
                    ${metaInfoHtml}
                </div>
                <div class="flex gap-1.5 shrink-0">
                    <button onclick="copyBarangayRate('${escapeHtml(r.name)}', '${escapeHtml(displayRate)}')" class="bg-blue-50 hover:bg-blue-100 dark:bg-blue-600/30 dark:hover:bg-blue-600 text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-white border border-blue-200 dark:border-blue-500/50 px-2.5 py-1.5 rounded-lg text-xs font-bold transition active:scale-90 flex items-center gap-1 cursor-pointer" title="Copy Rate Message">
                        <i class="fa-solid fa-copy"></i> Copy
                    </button>
                    <button onclick="editDirectoryRecord('${escapeHtml(r.name)}')" class="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-amber-600 dark:text-amber-400 p-2 rounded-lg text-xs transition active:scale-90 cursor-pointer" title="Edit">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    ${deleteBtnHtml}
                </div>
            </div>`;
        } else {
            htmlBuilder += `
            <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 p-3.5 rounded-2xl flex justify-between items-start gap-2 shadow-xs my-1">
                <div class="flex-1 min-w-0">
                    <div class="font-black text-sm text-gray-900 dark:text-white truncate">${escapeHtml(r.name)}</div>
                    ${r.contact ? `<div class="text-xs text-gray-700 dark:text-gray-400 mt-0.5 font-bold font-mono"><i class="fa-solid fa-phone text-[10px] text-blue-500"></i> ${escapeHtml(r.contact)}</div>` : ''}
                    ${r.address ? `<div class="text-xs text-gray-700 dark:text-gray-300 mt-0.5 font-medium"><i class="fa-solid fa-location-dot text-[10px] text-red-500"></i> ${escapeHtml(r.address)}</div>` : ''}
                    ${mapBtn}
                    ${metaInfoHtml}
                </div>
                <div class="flex gap-1 shrink-0">
                    <button onclick="editDirectoryRecord('${escapeHtml(r.name)}')" class="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-amber-600 dark:text-amber-400 p-2 rounded-lg text-xs transition active:scale-90 cursor-pointer" title="Edit">
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
// REMARKS: DIRECTORY_UI_ADMIN_EXEMPTION_AND_ROSTER_CREDITS_PILL_V1_COMPLETE