// src/features/chat/riderThreadActions.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { toggleBodyScroll, compressAndResizeImage } from './chatUtils.js';
import { voidSingleCateringCustomer } from '../roster/rosterStatus.js';
import { uploadImage } from '../../utils/imageUpload.js';
import { escapeHtml, cleanCustomerForMatch } from '../../utils/helpers.js';
import { isCustomerMatch } from '../roster/rosterUtils.js';
import { loadDirectoryCache } from '../directory/directoryStorage.js';
import { idbGet } from '../../utils/storageEngine.js';

let stagedPodImageBase64 = null;
let currentDirectoryCustomersList = [];
let currentFilteredDirectoryResults = [];
let currentActiveDirectoryMatch = null;
let currentActiveLinkedRecord = null;
let currentChatDetailsCustId = null;

function cleanFirebasePathKey(key) {
    return String(key || '').replace(/^#+/, '').replace(/[.#$\[\]\/]/g, '_').trim();
}

function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

function formatMapPinUrl(linkOrCoords) {
    if (!linkOrCoords) return '#';
    const str = String(linkOrCoords).trim();
    if (!str || str === '#') return '#';
    if (str.startsWith('http://') || str.startsWith('https://')) return str;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(str)}`;
}

function extractCleanSearchName(rawName) {
    if (!rawName) return "";
    let s = String(rawName).trim();
    s = s.replace(/\(FB Customer[^)]*\)/gi, '').trim();
    if (s.toLowerCase().startsWith('fb customer') || s.toLowerCase() === 'customer' || s.toLowerCase() === 'customer name') {
        return "";
    }
    return s;
}

export async function getDirectoryCustomersList() {
    const customerMap = new Map();

    const addCustomerToMap = (item, fallbackKey = '') => {
        if (!item) return;
        const name = String(item.name || item.customerName || item.displayName || item.fullName || item.storeName || '').trim();
        if (!name) return;

        // Skip generic placeholder or system names
        const lower = name.toLowerCase();
        if (
            lower === 'customer' ||
            lower === 'customer name' ||
            lower.startsWith('fb customer') ||
            lower === 'anonymous' ||
            lower === 'unknown'
        ) {
            return;
        }

        const cleanKey = cleanCustomerForMatch(name);
        if (!cleanKey || cleanKey.length < 2) return;

        const contact = String(item.contact || item.phoneNumber || item.phone || item.mobile || '').trim();
        const address = String(item.address || item.location || '').trim();
        const barangay = String(item.barangay || '').trim();
        const lat_lon_link = String(item.lat_lon_link || item.mapPinLink || item.mapLink || '').trim();
        const compKey = String(item.compositeKey || item.id || fallbackKey || cleanKey).trim();

        if (customerMap.has(cleanKey)) {
            const existing = customerMap.get(cleanKey);
            customerMap.set(cleanKey, {
                ...existing,
                compositeKey: existing.compositeKey || compKey,
                name: existing.name || name,
                contact: existing.contact || contact,
                address: existing.address || address,
                barangay: existing.barangay || barangay,
                lat_lon_link: existing.lat_lon_link || lat_lon_link,
                type: 'customers'
            });
        } else {
            customerMap.set(cleanKey, {
                ...item,
                compositeKey: compKey,
                name,
                contact,
                address,
                barangay,
                lat_lon_link,
                type: 'customers'
            });
        }
    };

    // 1. Ingest from globalState.records (in-memory)
    if (Array.isArray(globalState.records) && globalState.records.length > 0) {
        globalState.records.forEach(r => {
            if ((r.type || 'customers') === 'customers') {
                addCustomerToMap(r, r.compositeKey);
            }
        });
    }

    // 2. Ingest from LocalStorage directory cache
    try {
        const cached = localStorage.getItem('lokalex_directory_cache_v2');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed)) {
                parsed.forEach(r => {
                    if ((r.type || 'customers') === 'customers') {
                        addCustomerToMap(r, r.compositeKey);
                    }
                });
            }
        }
    } catch(e) {}

    // 3. Ingest from IndexedDB directory cache
    try {
        const idbRecords = await idbGet('directory', 'all_directory_records');
        if (Array.isArray(idbRecords) && idbRecords.length > 0) {
            idbRecords.forEach(r => {
                if ((r.type || 'customers') === 'customers') {
                    addCustomerToMap(r, r.compositeKey);
                }
            });
            if (!globalState.records || idbRecords.length > globalState.records.length) {
                globalState.records = idbRecords;
            }
        }
    } catch(e) {}

    // 4. Ingest from Firebase (directory/customers and root customers)
    if (db) {
        try {
            const [dirSnap, custSnap] = await Promise.allSettled([
                db.ref('directory/customers').once('value'),
                db.ref('customers').once('value')
            ]);
            if (dirSnap.status === 'fulfilled' && dirSnap.value) {
                const data = dirSnap.value.val() || {};
                Object.entries(data).forEach(([k, item]) => {
                    if (item) addCustomerToMap(item, k);
                });
            }
            if (custSnap.status === 'fulfilled' && custSnap.value) {
                const data = custSnap.value.val() || {};
                Object.entries(data).forEach(([k, item]) => {
                    if (item) addCustomerToMap(item, k);
                });
            }
        } catch(e) {}
    }

    // Sort strictly alphabetically (A to Z)
    const sortedList = Array.from(customerMap.values()).sort((a, b) => {
        return (a.name || '').localeCompare(b.name || '', undefined, {
            sensitivity: 'base',
            numeric: true
        });
    });

    currentDirectoryCustomersList = sortedList;
    return sortedList;
}

export function renderCustomerDetailsUI(custId, data = {}, meta = {}, dirRecord = null, autoMatchCandidate = null) {
    const modal = document.getElementById('customer-details-modal');
    if (!modal) return;

    currentChatDetailsCustId = custId;
    currentActiveLinkedRecord = dirRecord;
    currentActiveDirectoryMatch = autoMatchCandidate;

    const channelEl = document.getElementById('cust-modal-thread-channel');
    const nameEl = document.getElementById('cust-modal-name');
    const sourcePillEl = document.getElementById('cust-modal-source-pill');
    const phoneEl = document.getElementById('cust-modal-phone');
    const phoneCopyBtn = document.getElementById('cust-modal-phone-copy-btn');
    const phoneCallBtn = document.getElementById('cust-modal-phone-call-btn');
    const addrEl = document.getElementById('cust-modal-address');
    const mapEl = document.getElementById('cust-modal-map');
    const noMapHint = document.getElementById('cust-modal-no-map-hint');

    // Banner elements
    const bannerBox = document.getElementById('cust-modal-link-status-banner');
    const bannerIcon = document.getElementById('cust-modal-link-status-icon');
    const bannerTitle = document.getElementById('cust-modal-link-status-title');
    const bannerBadge = document.getElementById('cust-modal-link-status-badge');
    const bannerSub = document.getElementById('cust-modal-link-status-sub');
    const autoConfirmBtn = document.getElementById('cust-modal-auto-confirm-btn');
    const linkBtn = document.getElementById('cust-modal-link-btn');
    const linkBtnText = document.getElementById('cust-modal-link-btn-text');
    const unlinkBtn = document.getElementById('cust-modal-unlink-btn');

    const isFb = String(custId || '').startsWith('fb_') || String(custId || '').startsWith('messenger_');
    if (channelEl) {
        channelEl.innerText = isFb ? 'Facebook Messenger Thread' : 'In-App Live Chat Thread';
    }

    const chatHeaderName = document.getElementById('rider-chat-cust-name')?.innerText?.trim();
    const fallbackName = meta.customerName || (chatHeaderName && chatHeaderName !== 'Customer' ? chatHeaderName : 'Customer');

    // Resolve effective name, phone, address, map pin
    let effectiveName = fallbackName;
    let effectivePhone = data.phoneNumber || data.phone || data.contact || "";
    let effectiveAddress = data.address || "";
    let effectiveMapPin = data.mapPinLink || (data.lat && data.lng ? `https://www.google.com/maps/search/?api=1&query=${data.lat},${data.lng}` : "");
    let isLinked = false;
    let isAutoMatched = false;

    if (dirRecord) {
        isLinked = true;
        effectiveName = dirRecord.name || effectiveName;
        effectivePhone = dirRecord.contact || effectivePhone;
        effectiveAddress = dirRecord.address || effectiveAddress;
        effectiveMapPin = dirRecord.lat_lon_link || effectiveMapPin;
    } else if (autoMatchCandidate) {
        isAutoMatched = true;
        effectiveName = autoMatchCandidate.name || effectiveName;
        effectivePhone = autoMatchCandidate.contact || effectivePhone;
        effectiveAddress = autoMatchCandidate.address || effectiveAddress;
        effectiveMapPin = autoMatchCandidate.lat_lon_link || effectiveMapPin;
    } else {
        effectiveName = data.name || fallbackName;
    }

    // Populate Fields
    if (nameEl) nameEl.innerText = effectiveName || "Customer Name";
    
    // Phone
    const cleanPhoneDigits = String(effectivePhone || '').replace(/[^0-9+]/g, '');
    const hasPhone = cleanPhoneDigits.length >= 7;
    if (phoneEl) {
        phoneEl.innerText = effectivePhone || "No contact recorded";
        if (hasPhone) {
            phoneEl.href = `tel:${cleanPhoneDigits}`;
            phoneEl.className = "font-bold text-sm text-blue-600 dark:text-blue-400 font-mono mt-0.5 block hover:underline truncate";
        } else {
            phoneEl.removeAttribute('href');
            phoneEl.className = "font-medium text-sm text-gray-400 dark:text-gray-500 font-mono mt-0.5 block truncate";
        }
    }
    if (phoneCopyBtn) {
        if (hasPhone) phoneCopyBtn.classList.remove('hidden');
        else phoneCopyBtn.classList.add('hidden');
    }
    if (phoneCallBtn) {
        if (hasPhone) {
            phoneCallBtn.href = `tel:${cleanPhoneDigits}`;
            phoneCallBtn.classList.remove('hidden');
        } else {
            phoneCallBtn.classList.add('hidden');
        }
    }

    // Address
    if (addrEl) {
        addrEl.innerText = effectiveAddress || "No address provided.";
    }

    // Map Pin
    const mapUrl = formatMapPinUrl(effectiveMapPin);
    if (mapEl) {
        mapEl.href = mapUrl;
        if (mapUrl === '#' || !effectiveMapPin) {
            mapEl.classList.add('opacity-50', 'pointer-events-none');
            if (noMapHint) noMapHint.classList.remove('hidden');
        } else {
            mapEl.classList.remove('opacity-50', 'pointer-events-none');
            if (noMapHint) noMapHint.classList.add('hidden');
        }
    }

    // Banner and Badges
    if (isLinked) {
        if (bannerBox) {
            bannerBox.className = "bg-emerald-500/10 dark:bg-emerald-500/20 p-2.5 rounded-2xl border border-emerald-500/40 flex items-center justify-between gap-2 transition-all";
        }
        if (bannerIcon) {
            bannerIcon.className = "w-7 h-7 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs shrink-0";
            bannerIcon.innerHTML = `<i class="fa-solid fa-circle-check"></i>`;
        }
        if (bannerTitle) bannerTitle.innerText = "Linked to Directory";
        if (bannerBadge) {
            bannerBadge.innerText = "Linked";
            bannerBadge.className = "text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-emerald-600 text-white";
        }
        if (bannerSub) bannerSub.innerText = dirRecord.name ? `Profile: ${dirRecord.name}` : "Directory customer matched";
        if (autoConfirmBtn) autoConfirmBtn.classList.add('hidden');
        if (linkBtnText) linkBtnText.innerText = "Change";
        if (unlinkBtn) unlinkBtn.classList.remove('hidden');
        if (sourcePillEl) {
            sourcePillEl.innerHTML = `<span class="text-[9px] bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1"><i class="fa-solid fa-check"></i> Directory</span>`;
        }
    } else if (isAutoMatched) {
        if (bannerBox) {
            bannerBox.className = "bg-blue-500/10 dark:bg-blue-500/20 p-2.5 rounded-2xl border border-blue-500/40 flex items-center justify-between gap-2 transition-all";
        }
        if (bannerIcon) {
            bannerIcon.className = "w-7 h-7 rounded-xl bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs shrink-0";
            bannerIcon.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i>`;
        }
        if (bannerTitle) bannerTitle.innerText = "Suggested Match";
        if (bannerBadge) {
            bannerBadge.innerText = "Auto-Match";
            bannerBadge.className = "text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-blue-600 text-white";
        }
        if (bannerSub) bannerSub.innerText = `Directory: ${autoMatchCandidate.name}`;
        if (autoConfirmBtn) autoConfirmBtn.classList.remove('hidden');
        if (linkBtnText) linkBtnText.innerText = "Change";
        if (unlinkBtn) unlinkBtn.classList.add('hidden');
        if (sourcePillEl) {
            sourcePillEl.innerHTML = `<span class="text-[9px] bg-blue-500/20 text-blue-600 dark:text-blue-400 font-bold px-2 py-0.5 rounded-full border border-blue-500/30 flex items-center gap-1"><i class="fa-solid fa-wand-magic-sparkles"></i> Match</span>`;
        }
    } else {
        if (bannerBox) {
            bannerBox.className = "bg-amber-500/10 dark:bg-amber-500/20 p-2.5 rounded-2xl border border-amber-500/30 flex items-center justify-between gap-2 transition-all";
        }
        if (bannerIcon) {
            bannerIcon.className = "w-7 h-7 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xs shrink-0";
            bannerIcon.innerHTML = `<i class="fa-solid fa-link-slash"></i>`;
        }
        if (bannerTitle) bannerTitle.innerText = "Not Linked to Directory";
        if (bannerBadge) {
            bannerBadge.innerText = "Unlinked";
            bannerBadge.className = "text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-amber-600 text-white";
        }
        if (bannerSub) bannerSub.innerText = "Connect to load saved phone, address & GPS pin";
        if (autoConfirmBtn) autoConfirmBtn.classList.add('hidden');
        if (linkBtnText) linkBtnText.innerText = "Link Now";
        if (unlinkBtn) unlinkBtn.classList.add('hidden');
        if (sourcePillEl) {
            sourcePillEl.innerHTML = `<span class="text-[9px] bg-gray-200 dark:bg-gray-800 text-gray-500 font-bold px-2 py-0.5 rounded-full">Unlinked</span>`;
        }
    }
}

export async function showCustomerDetails() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (!custId) {
        return showToast("⚠️ No active customer thread selected.");
    }

    const modal = document.getElementById('customer-details-modal');
    if (!modal) return;

    modal.classList.remove('hidden');
    toggleBodyScroll(true);
    toggleDirectoryLinkPicker(false);

    let custData = {};
    let meta = (window.getCurrentRiderChatMeta && window.getCurrentRiderChatMeta()) || {};

    if (db) {
        try {
            const [custSnap, metaSnap] = await Promise.all([
                db.ref(`customers/${custId}`).once('value'),
                db.ref(`customerChats/${custId}/metadata`).once('value')
            ]);
            custData = custSnap.val() || {};
            const fetchedMeta = metaSnap.val() || {};
            meta = { ...meta, ...fetchedMeta };
        } catch(err) {
            console.warn("Notice: Error fetching customer profile from Firebase:", err);
        }
    }

    if (window.setActiveCustData) {
        window.setActiveCustData(custData);
    }

    const dirList = await getDirectoryCustomersList();

    // 1. Check if explicitly linked
    const linkedKey = custData.linkedDirectoryKey || meta.linkedDirectoryKey || custData.directoryCustomerId;
    const linkedName = custData.linkedDirectoryName || meta.linkedDirectoryName;

    let linkedRecord = null;
    if (linkedKey || linkedName) {
        linkedRecord = dirList.find(r => 
            (linkedKey && r.compositeKey === linkedKey) ||
            (linkedKey && r.name && cleanCustomerForMatch(r.name) === cleanCustomerForMatch(linkedKey)) ||
            (linkedName && r.name && cleanCustomerForMatch(r.name) === cleanCustomerForMatch(linkedName))
        );
        // If not in local dirList but stored in custData, synthesize record
        if (!linkedRecord && (custData.phoneNumber || custData.address)) {
            linkedRecord = {
                name: custData.name || linkedName || linkedKey,
                contact: custData.phoneNumber || "",
                address: custData.address || "",
                lat_lon_link: custData.mapPinLink || "",
                barangay: custData.barangay || "",
                compositeKey: linkedKey
            };
        }
    }

    // 2. If not linked, check auto-matching candidate
    let autoMatchCandidate = null;
    if (!linkedRecord) {
        const chatHeaderName = document.getElementById('rider-chat-cust-name')?.innerText?.trim();
        const candidateRaw = meta.customerName || custData.name || (chatHeaderName && chatHeaderName !== 'Customer' ? chatHeaderName : '');
        const cleanName = extractCleanSearchName(candidateRaw);

        if (cleanName && cleanName.length >= 2) {
            const cleanTarget = cleanCustomerForMatch(cleanName);
            // Try exact clean match first
            let candidate = dirList.find(r => cleanCustomerForMatch(r.name) === cleanTarget);
            // Try fuzzy match
            if (!candidate) {
                candidate = dirList.find(r => isCustomerMatch(r.name, cleanName));
            }
            if (candidate) {
                autoMatchCandidate = candidate;
            }
        }
    }

    renderCustomerDetailsUI(custId, custData, meta, linkedRecord, autoMatchCandidate);
}

export async function confirmDirectoryAutoMatch() {
    if (!currentActiveDirectoryMatch || !currentChatDetailsCustId) {
        return showToast("⚠️ No auto-matched record to confirm.");
    }
    await linkChatToDirectoryRecord(currentChatDetailsCustId, currentActiveDirectoryMatch);
}

export async function toggleDirectoryLinkPicker(show) {
    const picker = document.getElementById('cust-modal-link-picker');
    if (!picker) return;

    const willShow = show !== undefined ? Boolean(show) : picker.classList.contains('hidden');
    if (willShow) {
        picker.classList.remove('hidden');
        const input = document.getElementById('cust-modal-search-input');
        if (input) {
            input.value = "";
            setTimeout(() => input.focus(), 100);
        }
        const clearBtn = document.getElementById('cust-modal-search-clear');
        if (clearBtn) clearBtn.classList.add('hidden');
        if (!currentDirectoryCustomersList || currentDirectoryCustomersList.length === 0) {
            await getDirectoryCustomersList();
        }
        renderDirectorySearchResults("");
    } else {
        picker.classList.add('hidden');
    }
}

export function handleDirectorySearchInput(query = "") {
    const clearBtn = document.getElementById('cust-modal-search-clear');
    if (clearBtn) {
        if (query.trim()) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }
    renderDirectorySearchResults(query);
}

export function clearDirectorySearch() {
    const input = document.getElementById('cust-modal-search-input');
    if (input) {
        input.value = "";
        input.focus();
    }
    const clearBtn = document.getElementById('cust-modal-search-clear');
    if (clearBtn) clearBtn.classList.add('hidden');
    renderDirectorySearchResults("");
}

export function renderDirectorySearchResults(query = "") {
    const container = document.getElementById('cust-modal-search-results');
    if (!container) return;

    const countEl = document.getElementById('cust-modal-results-count');
    const cleanQ = String(query || '').trim().toLowerCase();
    const list = currentDirectoryCustomersList || [];

    let filtered = list;
    if (cleanQ) {
        filtered = list.filter(r => {
            const name = (r.name || '').toLowerCase();
            const phone = (r.contact || '').toLowerCase();
            const addr = (r.address || '').toLowerCase();
            const brgy = (r.barangay || '').toLowerCase();
            return name.includes(cleanQ) || phone.includes(cleanQ) || addr.includes(cleanQ) || brgy.includes(cleanQ);
        });
    }

    if (countEl) {
        if (cleanQ) {
            countEl.innerText = `${filtered.length} found (${list.length} total)`;
        } else {
            countEl.innerText = `All Customers (${list.length})`;
        }
    }

    currentFilteredDirectoryResults = filtered;

    if (filtered.length === 0) {
        container.innerHTML = `
        <div class="text-center py-6 px-2 text-gray-500 dark:text-gray-400">
            <i class="fa-solid fa-user-slash text-base text-gray-400 mb-1 block"></i>
            <span class="text-[11px] block font-bold text-gray-700 dark:text-gray-300">No customer found matching "${escapeHtml(query)}"</span>
            <span class="text-[10px] text-gray-400 block mt-0.5">Click "+ Add New to Directory" below to register.</span>
        </div>`;
        return;
    }

    // Render ALL filtered records (sorted alphabetically A-Z)
    container.innerHTML = filtered.map((r, idx) => {
        const key = r.compositeKey || r.name;
        const isCurrent = currentActiveLinkedRecord && (
            (r.compositeKey && currentActiveLinkedRecord.compositeKey === r.compositeKey) ||
            (r.name && cleanCustomerForMatch(currentActiveLinkedRecord.name) === cleanCustomerForMatch(r.name))
        );

        return `
        <div onclick="window.selectDirectoryCustomerIndex && window.selectDirectoryCustomerIndex(${idx})" class="p-2.5 rounded-xl bg-white dark:bg-cardBg border ${isCurrent ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 ring-1 ring-emerald-500/30' : 'border-gray-200 dark:border-gray-800 hover:border-blue-400 dark:hover:border-blue-500'} cursor-pointer flex items-center justify-between gap-2.5 transition active:scale-[0.98]">
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                    <span class="font-bold text-xs text-gray-900 dark:text-white truncate">${escapeHtml(r.name || 'Customer')}</span>
                    ${r.barangay ? `<span class="text-[9px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-1.5 py-0.2 rounded font-medium truncate">${escapeHtml(r.barangay)}</span>` : ''}
                </div>
                <div class="text-[10px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    ${r.contact ? `<i class="fa-solid fa-phone text-[9px] text-emerald-500 mr-0.5"></i> ${escapeHtml(r.contact)} • ` : ''}${escapeHtml(r.address || 'No address')}
                </div>
            </div>
            <button type="button" class="px-2.5 py-1 rounded-lg ${isCurrent ? 'bg-emerald-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'} text-[10px] font-bold shrink-0 shadow-xs">
                ${isCurrent ? 'Linked' : 'Link'}
            </button>
        </div>`;
    }).join('');
}

export function selectDirectoryCustomerIndex(idx) {
    const record = currentFilteredDirectoryResults[idx];
    if (record && currentChatDetailsCustId) {
        linkChatToDirectoryRecord(currentChatDetailsCustId, record);
    }
}

export async function selectAndLinkDirectoryCustomer(compositeKeyOrName) {
    if (!compositeKeyOrName || !currentChatDetailsCustId) return;

    const list = currentDirectoryCustomersList || [];
    const target = list.find(r => 
        (r.compositeKey && r.compositeKey === compositeKeyOrName) ||
        (r.name && r.name === compositeKeyOrName) ||
        (r.name && cleanCustomerForMatch(r.name) === cleanCustomerForMatch(compositeKeyOrName))
    );

    if (!target) {
        return showToast("⚠️ Could not find selected directory record.");
    }

    await linkChatToDirectoryRecord(currentChatDetailsCustId, target);
}

export async function unlinkCurrentChatDirectory() {
    const custId = currentChatDetailsCustId || (window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null);
    if (!custId) return;

    const unlinkCustPayload = {
        linkedDirectoryKey: null,
        linkedDirectoryName: null
    };
    const unlinkMetaPayload = {
        linkedDirectoryKey: null,
        linkedDirectoryName: null
    };

    if (db) {
        try {
            await Promise.all([
                db.ref(`customers/${custId}`).update(unlinkCustPayload),
                db.ref(`customerChats/${custId}/metadata`).update(unlinkMetaPayload),
                db.ref(`customerChatMeta/${custId}`).update(unlinkMetaPayload)
            ]);
        } catch(e) {
            console.warn("Notice: Error unlinking customer directory:", e);
        }
    }

    currentActiveLinkedRecord = null;
    currentActiveDirectoryMatch = null;
    toggleDirectoryLinkPicker(false);
    await showCustomerDetails();
    showToast("ℹ️ Unlinked from Customer Directory.");
}

export async function linkChatToDirectoryRecord(custId, dirRecord) {
    if (!custId || !dirRecord) return;

    const dirKey = dirRecord.compositeKey || dirRecord.name;
    const dirName = dirRecord.name;
    const phone = dirRecord.contact || "";
    const address = dirRecord.address || "";
    const mapPin = dirRecord.lat_lon_link || "";
    const barangay = dirRecord.barangay || "";

    const customerUpdates = {
        linkedDirectoryKey: dirKey,
        linkedDirectoryName: dirName,
        name: dirName,
        phoneNumber: phone,
        address: address,
        mapPinLink: mapPin,
        barangay: barangay,
        linkedAt: Date.now(),
        linkedBy: appState.riderName || "Rider"
    };

    const chatMetaUpdates = {
        customerName: dirName,
        linkedDirectoryKey: dirKey,
        linkedDirectoryName: dirName,
        customerPhone: phone,
        customerAddress: address,
        customerMapPin: mapPin
    };

    if (window.setActiveCustData) {
        window.setActiveCustData(customerUpdates);
    }

    if (db) {
        try {
            await Promise.all([
                db.ref(`customers/${custId}`).update(customerUpdates),
                db.ref(`customerChats/${custId}/metadata`).update(chatMetaUpdates),
                db.ref(`customerChatMeta/${custId}`).update(chatMetaUpdates)
            ]);
            if (dirRecord.compositeKey) {
                db.ref(`directory/customers/${dirRecord.compositeKey}/linkedChatId`).set(custId).catch(() => {});
            }
        } catch(e) {
            console.warn("Notice: Firebase directory link update error:", e);
        }
    }

    // Update active chat header name if currently viewing this thread
    const headerNameEl = document.getElementById('rider-chat-cust-name');
    if (headerNameEl && window.getActiveRiderChatCustId && window.getActiveRiderChatCustId() === custId) {
        headerNameEl.innerText = dirName;
    }

    currentActiveLinkedRecord = dirRecord;
    currentActiveDirectoryMatch = null;
    toggleDirectoryLinkPicker(false);
    renderCustomerDetailsUI(custId, customerUpdates, chatMetaUpdates, dirRecord, null);
    showToast(`✅ Linked to ${dirName} in Customer Directory!`);
    showSideNotification("CUSTOMER LINKED", `Connected ${dirName} to Directory profile`, "fa-link", "text-emerald-400", "border-emerald-500");
}

export function copyCustomerPhone() {
    const phoneEl = document.getElementById('cust-modal-phone');
    const phoneText = phoneEl?.innerText?.trim();
    if (!phoneText || phoneText === '---' || phoneText === 'No contact recorded') {
        return showToast("⚠️ No phone number to copy.");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(phoneText).then(() => {
            showToast(`📋 Copied: ${phoneText}`);
        }).catch(() => {
            fallbackCopyPhoneText(phoneText);
        });
    } else {
        fallbackCopyPhoneText(phoneText);
    }
}

function fallbackCopyPhoneText(text) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast(`📋 Copied: ${text}`);
    } catch(e) {
        showToast("⚠️ Could not copy phone number.");
    }
}

export function openNewDirectoryCustomerFromChat() {
    closeCustomerDetailsModal();
    const chatHeaderName = document.getElementById('rider-chat-cust-name')?.innerText?.trim();
    const fallbackName = chatHeaderName && !chatHeaderName.startsWith('FB Customer') && chatHeaderName !== 'Customer' ? chatHeaderName : '';
    
    if (window.closeRiderChatModal) {
        window.closeRiderChatModal();
    }
    
    if (typeof window.openForm === 'function') {
        globalState.currentType = 'customers';
        window.openForm({ name: fallbackName, type: 'customers' });
        showToast(`📝 Adding new customer: ${fallbackName || 'New Customer'}`);
    } else {
        showToast("⚠️ Directory form unavailable.");
    }
}

export function closeCustomerDetailsModal() {
    const modal = document.getElementById('customer-details-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
}

let isQuickRepliesListening = false;

export function initSharedQuickRepliesListener() {
    // 1. Immediately render from local cache if available
    try {
        const cached = localStorage.getItem('lokalex_shared_quick_replies_cache');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && typeof parsed === 'object') {
                renderSharedQuickReplies(parsed);
            }
        }
    } catch(e) {}

    if (isQuickRepliesListening || !db) return;
    isQuickRepliesListening = true;

    db.ref('sharedQuickReplies').on('value', (snapshot) => {
        const data = snapshot.val() || {};
        try {
            localStorage.setItem('lokalex_shared_quick_replies_cache', JSON.stringify(data));
        } catch(e) {}
        renderSharedQuickReplies(data);
    }, (error) => {
        console.warn("Shared quick replies listener error:", error);
        const container = document.getElementById('quick-replies-chips-container');
        if (container && (!container.children.length || container.innerText.includes('Loading'))) {
            let hadCached = false;
            try {
                const cached = localStorage.getItem('lokalex_shared_quick_replies_cache');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (parsed && Object.keys(parsed).length > 0) {
                        renderSharedQuickReplies(parsed);
                        hadCached = true;
                    }
                }
            } catch(e) {}

            if (!hadCached) {
                container.innerHTML = `<span class="text-[10px] text-amber-600 dark:text-amber-400 italic shrink-0 py-1">⚠️ RTDB Permission: I-update ang rules sa Firebase Console para sa 'sharedQuickReplies'.</span>`;
            }
        }
    });
}

let currentQuickRepliesList = [];
let draggedQuickReplyId = null;

export function renderSharedQuickReplies(data) {
    const container = document.getElementById('quick-replies-chips-container');
    const badge = document.getElementById('quick-replies-count-badge');
    if (!container) return;

    const rawEntries = Object.entries(data || {});
    if (rawEntries.length === 0) {
        if (badge) badge.textContent = "0";
        currentQuickRepliesList = [];
        container.innerHTML = `
        <div class="text-center py-6 px-3 flex flex-col items-center gap-2">
            <i class="fa-solid fa-bolt text-2xl text-amber-500/40"></i>
            <span class="text-xs text-gray-500 dark:text-gray-400">No quick replies yet.</span>
            <button type="button" onclick="window.promptAddQuickReply && window.promptAddQuickReply()" class="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold rounded-xl text-xs border border-amber-300 dark:border-amber-700/60 transition active:scale-95 cursor-pointer">
                + Add Quick Reply
            </button>
        </div>`;
        return;
    }

    // Normalize each item with title, text, order, createdAt
    const parsedList = rawEntries.map(([id, item], index) => {
        let text = "";
        let title = "";
        let order = 9999;
        let createdAt = 0;

        if (typeof item === 'string') {
            text = item;
            title = item.length > 26 ? item.substring(0, 24) + '...' : item;
            order = index + 1;
        } else if (item && typeof item === 'object') {
            text = item.text || '';
            title = item.title || (text.length > 26 ? text.substring(0, 24) + '...' : text) || 'Quick Reply';
            order = item.order !== undefined && item.order !== null ? Number(item.order) : (index + 1);
            createdAt = item.createdAt ? Number(item.createdAt) : 0;
        }

        return {
            id,
            title: title.trim(),
            text: text.trim(),
            order: isNaN(order) ? index + 1 : order,
            createdAt: isNaN(createdAt) ? 0 : createdAt,
            raw: item
        };
    }).filter(e => Boolean(e.text));

    // Sort by order ascending; tiebreaker by createdAt ascending
    parsedList.sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.createdAt - b.createdAt;
    });

    currentQuickRepliesList = parsedList;
    if (badge) badge.textContent = String(parsedList.length);

    container.innerHTML = parsedList.map((item, index) => {
        const isFirst = index === 0;
        const isLast = index === parsedList.length - 1;
        const escapedTitle = escapeHtml(item.title);
        const escapedText = escapeHtml(item.text);
        const encodedText = encodeURIComponent(item.text);
        const encodedTitle = encodeURIComponent(item.title);

        return `
        <div class="quick-reply-card flex items-center justify-between gap-2.5 p-2 bg-white dark:bg-cardBg hover:bg-amber-50/70 dark:hover:bg-amber-950/20 border border-gray-200 dark:border-gray-800 hover:border-amber-400/60 rounded-xl shadow-2xs transition group cursor-pointer" data-id="${item.id}" draggable="true" ondragstart="window.handleQuickReplyDragStart && window.handleQuickReplyDragStart(event, '${item.id}')" ondragover="window.handleQuickReplyDragOver && window.handleQuickReplyDragOver(event)" ondrop="window.handleQuickReplyDrop && window.handleQuickReplyDrop(event, '${item.id}')">
            <!-- REORDER CONTROLS (MOVE TO TOP / UP / DOWN) -->
            <div class="flex items-center gap-0.5 text-gray-400 shrink-0" onclick="event.stopPropagation()">
                <button type="button" onclick="window.moveQuickReplyToTop && window.moveQuickReplyToTop('${item.id}')" ${isFirst ? 'disabled class="opacity-20 cursor-not-allowed w-6 h-6 flex items-center justify-center text-gray-400"' : 'class="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 text-gray-500 hover:text-amber-600 transition active:scale-90 cursor-pointer"'} title="Move to top">
                    <i class="fa-solid fa-angles-up text-[10px]"></i>
                </button>
                <button type="button" onclick="window.moveQuickReplyOrder && window.moveQuickReplyOrder('${item.id}', -1)" ${isFirst ? 'disabled class="opacity-20 cursor-not-allowed w-6 h-6 flex items-center justify-center text-gray-400"' : 'class="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 text-gray-500 hover:text-amber-600 transition active:scale-90 cursor-pointer"'} title="Move up in order">
                    <i class="fa-solid fa-chevron-up text-[10px]"></i>
                </button>
                <button type="button" onclick="window.moveQuickReplyOrder && window.moveQuickReplyOrder('${item.id}', 1)" ${isLast ? 'disabled class="opacity-20 cursor-not-allowed w-6 h-6 flex items-center justify-center text-gray-400"' : 'class="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 text-gray-500 hover:text-amber-600 transition active:scale-90 cursor-pointer"'} title="Move down in order">
                    <i class="fa-solid fa-chevron-down text-[10px]"></i>
                </button>
            </div>

            <!-- TITLE CARD (CLICK TO CHOOSE / SEND) -->
            <div onclick="window.handleQuickReplyChipClick && window.handleQuickReplyChipClick(decodeURIComponent('${encodedText}'), decodeURIComponent('${encodedTitle}'))" class="flex-1 min-w-0 flex flex-col justify-center select-none py-0.5" title="Tap to select reply">
                <div class="flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
                    <span class="font-bold text-xs text-gray-900 dark:text-gray-100 truncate group-hover:text-amber-600 dark:group-hover:text-amber-400">
                        ${escapedTitle}
                    </span>
                </div>
                <p class="text-[10px] text-gray-500 dark:text-gray-400 truncate pl-3 leading-tight pt-0.5">
                    ${escapedText}
                </p>
            </div>

            <!-- DELETE BUTTON -->
            <div class="flex items-center gap-1 shrink-0" onclick="event.stopPropagation()">
                <button type="button" onclick="window.deleteQuickReply && window.deleteQuickReply('${item.id}')" class="text-gray-400 hover:text-red-500 p-1.5 text-xs opacity-60 hover:opacity-100 transition active:scale-90 cursor-pointer" title="Delete reply">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

export async function moveQuickReplyToTop(id) {
    if (!currentQuickRepliesList || currentQuickRepliesList.length <= 1) return;
    const currentIndex = currentQuickRepliesList.findIndex(item => item.id === id);
    if (currentIndex <= 0) return;

    const reordered = [...currentQuickRepliesList];
    const [movedItem] = reordered.splice(currentIndex, 1);
    reordered.unshift(movedItem);

    await applyQuickRepliesReorder(reordered);
}

export async function moveQuickReplyOrder(id, direction) {
    if (!currentQuickRepliesList || currentQuickRepliesList.length <= 1) return;
    const currentIndex = currentQuickRepliesList.findIndex(item => item.id === id);
    if (currentIndex === -1) return;

    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= currentQuickRepliesList.length) return;

    const reordered = [...currentQuickRepliesList];
    const [movedItem] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, movedItem);

    await applyQuickRepliesReorder(reordered);
}

export function handleQuickReplyDragStart(event, id) {
    draggedQuickReplyId = id;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
    }
}

export function handleQuickReplyDragOver(event) {
    event.preventDefault();
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
    }
}

export async function handleQuickReplyDrop(event, targetId) {
    event.preventDefault();
    if (!draggedQuickReplyId || draggedQuickReplyId === targetId) return;

    const fromIndex = currentQuickRepliesList.findIndex(item => item.id === draggedQuickReplyId);
    const toIndex = currentQuickRepliesList.findIndex(item => item.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const reordered = [...currentQuickRepliesList];
    const [movedItem] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, movedItem);

    draggedQuickReplyId = null;
    await applyQuickRepliesReorder(reordered);
}

async function applyQuickRepliesReorder(reorderedList) {
    if (!Array.isArray(reorderedList) || reorderedList.length === 0) return;
    currentQuickRepliesList = reorderedList;

    const newCache = {};
    const updates = {};
    reorderedList.forEach((item, idx) => {
        const newOrder = idx + 1;
        item.order = newOrder;
        const entry = {
            ...(typeof item.raw === 'object' ? item.raw : { text: item.text }),
            title: item.title,
            text: item.text,
            order: newOrder,
            createdAt: item.createdAt || Date.now(),
            createdBy: item.raw?.createdBy || (appState.riderName || localStorage.getItem('riderName') || 'Rider')
        };
        newCache[item.id] = entry;
        updates[item.id] = entry;
    });

    try {
        localStorage.setItem('lokalex_shared_quick_replies_cache', JSON.stringify(newCache));
    } catch (e) {}

    renderSharedQuickReplies(newCache);

    if (db) {
        try {
            await db.ref('sharedQuickReplies').update(updates);
            showToast("↕️ Quick replies order saved!");
        } catch (err) {
            console.warn("RTDB sharedQuickReplies update error:", err);
            try {
                const promises = Object.entries(updates).map(([k, v]) =>
                    db.ref(`sharedQuickReplies/${k}`).set(v)
                );
                await Promise.all(promises);
                showToast("↕️ Quick replies order saved!");
            } catch (fallbackErr) {
                console.error("RTDB individual set error:", fallbackErr);
                showToast("⚠️ Order updated locally.");
            }
        }
    } else {
        showToast("↕️ Order updated locally.");
    }
}

export function toggleQuickReplies() {
    const drawer = document.getElementById('quick-replies-drawer');
    if (!drawer) return;
    drawer.classList.toggle('hidden');
    if (!drawer.classList.contains('hidden')) {
        initSharedQuickRepliesListener();
    }
}

let activeSelectedQuickReplyText = "";

export function handleQuickReplyChipClick(text, title) {
    if (!text) return;
    activeSelectedQuickReplyText = text;

    const modal = document.getElementById('quick-reply-action-modal');
    const previewEl = document.getElementById('quick-reply-preview-text');
    const editInput = document.getElementById('edit-quick-reply-textarea');
    const choiceView = document.getElementById('quick-reply-choice-view');
    const editView = document.getElementById('quick-reply-edit-view');
    const titleEl = document.getElementById('quick-reply-modal-title');
    const subtitleEl = document.getElementById('quick-reply-modal-subtitle');

    if (previewEl) previewEl.textContent = text;
    if (editInput) editInput.value = text;
    if (choiceView) choiceView.classList.remove('hidden');
    if (editView) editView.classList.add('hidden');
    if (titleEl) titleEl.innerText = title ? `Quick Reply: ${title}` : "Quick Reply";
    if (subtitleEl) subtitleEl.innerText = "Choose to send or edit before sending";

    if (modal) {
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
    }
}

export function confirmSendQuickReply() {
    if (!activeSelectedQuickReplyText) return;
    const textToSend = activeSelectedQuickReplyText;
    closeQuickReplyActionModal();
    sendQuickReply(textToSend);
}

export function openEditQuickReplyModal() {
    const choiceView = document.getElementById('quick-reply-choice-view');
    const editView = document.getElementById('quick-reply-edit-view');
    const editInput = document.getElementById('edit-quick-reply-textarea');
    const titleEl = document.getElementById('quick-reply-modal-title');
    const subtitleEl = document.getElementById('quick-reply-modal-subtitle');

    if (choiceView) choiceView.classList.add('hidden');
    if (editView) editView.classList.remove('hidden');
    if (titleEl) titleEl.innerText = "Edit Quick Reply";
    if (subtitleEl) subtitleEl.innerText = "Edit text before sending to customer";

    if (editInput) {
        editInput.value = activeSelectedQuickReplyText;
        setTimeout(() => {
            editInput.focus();
            editInput.setSelectionRange(editInput.value.length, editInput.value.length);
        }, 100);
    }
}

export function backToQuickReplyChoiceView() {
    const choiceView = document.getElementById('quick-reply-choice-view');
    const editView = document.getElementById('quick-reply-edit-view');
    const titleEl = document.getElementById('quick-reply-modal-title');
    const subtitleEl = document.getElementById('quick-reply-modal-subtitle');

    if (choiceView) choiceView.classList.remove('hidden');
    if (editView) editView.classList.add('hidden');
    if (titleEl) titleEl.innerText = "Quick Reply";
    if (subtitleEl) subtitleEl.innerText = "Choose to send or edit before sending";
}

export function sendEditedQuickReply() {
    const editInput = document.getElementById('edit-quick-reply-textarea');
    const text = editInput ? editInput.value.trim() : '';
    if (!text) {
        showToast("⚠️ Please enter a message to send.");
        return;
    }
    closeQuickReplyActionModal();
    sendQuickReply(text);
}

export function closeQuickReplyActionModal() {
    const modal = document.getElementById('quick-reply-action-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
    activeSelectedQuickReplyText = "";
}

export function sendQuickReply(text) {
    if (!text) return;
    if (window.sendRiderToCustomerChat) {
        window.sendRiderToCustomerChat(text);
    } else if (window.sendCustomerToRiderChat) {
        window.sendCustomerToRiderChat(text);
    }
    const drawer = document.getElementById('quick-replies-drawer');
    if (drawer && !drawer.classList.contains('hidden')) {
        drawer.classList.add('hidden');
    }
}

export function promptAddQuickReply() {
    const modal = document.getElementById('add-quick-reply-modal');
    const titleInput = document.getElementById('new-quick-reply-title');
    const textInput = document.getElementById('new-quick-reply-input');
    if (modal) {
        if (titleInput) titleInput.value = '';
        if (textInput) textInput.value = '';
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
        setTimeout(() => (titleInput || textInput)?.focus(), 150);
    }
}

export function closeAddQuickReplyModal() {
    const modal = document.getElementById('add-quick-reply-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
}

function saveQuickReplyToLocalCache(id, item) {
    try {
        const cached = localStorage.getItem('lokalex_shared_quick_replies_cache');
        const data = cached ? JSON.parse(cached) : {};
        data[id] = item;
        localStorage.setItem('lokalex_shared_quick_replies_cache', JSON.stringify(data));
        renderSharedQuickReplies(data);
    } catch(e) {}
}

export async function submitSaveQuickReply() {
    const titleInput = document.getElementById('new-quick-reply-title');
    const textInput = document.getElementById('new-quick-reply-input');
    const text = textInput ? textInput.value.trim() : '';
    if (!text) {
        showToast("⚠️ Paki-type ang message content bago i-save!");
        return;
    }

    let title = titleInput ? titleInput.value.trim() : '';
    if (!title) {
        title = text.length > 26 ? text.substring(0, 24) + '...' : text;
    }

    const riderName = appState.riderName || localStorage.getItem('riderName') || 'Rider';
    const localId = 'qr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    
    // Find next order number
    const maxOrder = currentQuickRepliesList.reduce((max, item) => Math.max(max, item.order || 0), 0);
    const newEntry = {
        title: title,
        text: text,
        order: maxOrder + 1,
        createdBy: riderName,
        createdAt: Date.now()
    };

    closeAddQuickReplyModal();

    if (!db) {
        saveQuickReplyToLocalCache(localId, newEntry);
        showToast("✅ Quick reply saved locally!");
        return;
    }

    try {
        await db.ref('sharedQuickReplies').push(newEntry);
        showToast("✅ Quick reply saved! Makikita na ito ng lahat ng riders.");
    } catch (e) {
        console.error("Save quick reply error:", e);
        saveQuickReplyToLocalCache(localId, newEntry);
        if (e.message && e.message.includes('PERMISSION_DENIED')) {
            showToast("⚠️ Naka-save locally. I-publish ang updated database.rules.json sa Firebase Console!");
        } else {
            showToast("⚠️ Naka-save locally: " + e.message);
        }
    }
}

export async function deleteQuickReply(id) {
    if (!id) return;
    if (!confirm("Sigurado ka bang nais mong tanggalin ang quick reply na ito para sa lahat ng riders?")) {
        return;
    }
    try {
        if (db) {
            await db.ref(`sharedQuickReplies/${id}`).remove();
        }
    } catch (e) {
        console.warn("Delete remote quick reply error:", e);
    }
    try {
        const cached = localStorage.getItem('lokalex_shared_quick_replies_cache');
        if (cached) {
            const data = JSON.parse(cached);
            delete data[id];
            localStorage.setItem('lokalex_shared_quick_replies_cache', JSON.stringify(data));
            renderSharedQuickReplies(data);
        }
    } catch(e) {}
    showToast("🗑️ Quick reply deleted.");
}

export function markThreadUndone() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (!custId) return;

    if (db) {
        db.ref(`customerChats/${custId}/metadata`).update({
            folder: 'inbox',
            cateredByRiderId: null,
            cateredByRiderName: null,
            cateredBy: null,
            status: 'active'
        });
    }

    showToast("↩️ Moved thread back to Inbox!");
    if (window.closeRiderCustomerChatModal) window.closeRiderCustomerChatModal();
}

// -------------------------------------------------------------
// PROOF OF DELIVERY (POD) MODAL HANDLERS
// -------------------------------------------------------------
export function openPodModal() {
    stagedPodImageBase64 = null;
    const modal = document.getElementById('pod-capture-modal');
    const previewImg = document.getElementById('pod-preview-img');
    const placeholder = document.getElementById('pod-placeholder-ui');

    if (previewImg) {
        previewImg.src = "";
        previewImg.classList.add('hidden');
    }
    if (placeholder) {
        placeholder.classList.remove('hidden');
    }

    if (modal) {
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
    }
}

export function closePodModal() {
    const modal = document.getElementById('pod-capture-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
    stagedPodImageBase64 = null;
}

export function handlePodImageSelected(inputEl) {
    const file = inputEl?.files?.[0];
    if (!file) return;

    showToast("⏳ Processing Proof of Delivery photo...");

    compressAndResizeImage(file, false, (base64Img) => {
        stagedPodImageBase64 = base64Img;

        const previewImg = document.getElementById('pod-preview-img');
        const placeholder = document.getElementById('pod-placeholder-ui');

        if (previewImg && placeholder) {
            previewImg.src = base64Img;
            previewImg.classList.remove('hidden');
            placeholder.classList.add('hidden');
        }

        showToast("✅ POD photo ready!");
    });

    inputEl.value = "";
}

export async function submitProofOfDelivery(withPhoto = true) {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    const meta = window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {};
    const orderId = cleanFirebasePathKey(meta?.latestOrderId);
    const riderName = localStorage.getItem('riderName') || "Rider";
    const now = Date.now();

    closePodModal();

    let finalPodUrl = stagedPodImageBase64;
    if (withPhoto && stagedPodImageBase64) {
        showToast("⏳ Uploading POD photo...");
        try {
            finalPodUrl = await uploadImage(stagedPodImageBase64, `pod/${orderId || custId}_${Date.now()}.jpg`);
        } catch (e) {
            console.warn("POD storage upload fallback:", e);
        }
    }

    if (withPhoto && finalPodUrl && db && custId) {
        const podMsg = {
            sender: riderName,
            senderType: 'rider',
            text: "📦 Order has been successfully delivered! [Proof of Delivery Attached]",
            imageUrl: finalPodUrl,
            type: 'image',
            timestamp: now,
            isRider: true,
            status: 'sent'
        };

        await db.ref(`customerChats/${custId}/messages`).push(sanitizeForFirebase(podMsg));
    }

    if (orderId && db) {
        await updateOrderMilestone('delivered', orderId, finalPodUrl);
    }

    executeThreadDone();
}

export function markThreadDone() {
    const meta = window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {};
    const orderId = meta?.latestOrderId;

    if (orderId) {
        openPodModal();
    } else {
        executeThreadDone();
    }
}

export function executeThreadDone() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (!custId) return;

    if (db) {
        db.ref(`customerChats/${custId}/metadata`).update({
            cateredByRiderId: null,
            cateredByRiderName: null,
            cateredBy: null,
            folder: 'done'
        });
    }

    document.getElementById('rider-chat-cancel-btn')?.classList.add('hidden');
    showToast("✅ Released lock & moved chat to Done!");
    if (window.closeRiderCustomerChatModal) window.closeRiderCustomerChatModal();
}

export function markThreadFollowUp() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (!custId) return;

    const custName = document.getElementById('rider-chat-cust-name')?.innerText || "";
    const activeCustData = window.getActiveCustData ? window.getActiveCustData() : null;
    const phone = activeCustData?.phoneNumber || "";
    const address = activeCustData?.address || "";

    if (db) {
        db.ref(`customerChats/${custId}/metadata`).update({ folder: 'followup' });
    }

    const advModal = document.getElementById('adv-orders-modal');
    if (advModal) {
        advModal.classList.remove('hidden');
        toggleBodyScroll(true);

        if (window.switchAdvTab) window.switchAdvTab('add');

        const nameInput = document.getElementById('adv-cust-name');
        const contactInput = document.getElementById('adv-contact');
        const addrInput = document.getElementById('adv-address');

        if (nameInput) nameInput.value = custName;
        if (contactInput) contactInput.value = phone;
        if (addrInput) addrInput.value = address;
    }

    showToast("📌 Moved chat to Follow Up & loaded Advance Order form!");
}

// VOID SPECIFIC CUSTOMER WITHOUT CANCELING OTHER ACTIVE BOOKINGS
export function cancelCustomerThread() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    const meta = window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {};
    const custName = document.getElementById('rider-chat-cust-name')?.innerText?.trim() || meta?.customerName || "";
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = appState.riderName || localStorage.getItem('riderName') || "Rider";

    if (!custId && !custName) return;

    openSlideDeleteModal(
        `Cancel & Void Customer?`,
        `Sigurado ka bang nais i-void si [${custName || 'Customer'}]?\nKung may iba ka pang dalang customer, mananatili ka sa Catering.`,
        async () => {
            if (db && custId) {
                db.ref(`customerChats/${custId}/metadata`).update({
                    cateredByRiderId: null,
                    cateredByRiderName: null,
                    cateredBy: null,
                    folder: 'done',
                    status: 'cancelled',
                    lastUpdated: Date.now()
                });
            }

            if (custName && myId) {
                await voidSingleCateringCustomer(myId, myName, custName);
            }

            document.getElementById('rider-chat-cancel-btn')?.classList.add('hidden');
            if (window.closeRiderCustomerChatModal) window.closeRiderCustomerChatModal();
        }
    );
}

export async function caterCurrentChatCustomer() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    const meta = (window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {}) || {};
    const nameEl = document.getElementById('rider-chat-cust-name');
    let custName = nameEl?.innerText?.trim();
    if (!custName || custName === 'Customer Name' || custName === 'Customer' || custName.startsWith('FB Customer (')) {
        custName = meta.customerName || meta.name || custName || "";
    }
    if (!custName || custName === 'Customer Name' || custName.toLowerCase() === 'customer') {
        custName = (meta.customerName || meta.name || "").trim();
    }

    if (!custName || custName.toLowerCase() === 'customer' || custName.toLowerCase() === 'customer name') {
        return showToast("⚠️ Pakilagay o i-update muna ang totoong pangalan ng customer bago i-cater.");
    }

    if (!custId || custId.toString().toLowerCase() === 'customer') {
        return showToast("⚠️ Walang aktibong valid customer chat para i-cater.");
    }

    const currentId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const currentName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim();

    const cateredRiderId = (meta.cateredByRiderId || "").toString().trim();
    const cateredRiderName = (meta.cateredByRiderName || meta.cateredBy || "").toString().trim().toLowerCase();

    if ((cateredRiderId && cateredRiderId === currentId) || (cateredRiderName && currentName && cateredRiderName === currentName.toLowerCase())) {
        return showToast("🛵 Kasalukuyan mo nang kinacater ang customer na ito!");
    }

    const isAdmin = typeof window.isAdmin === 'function' ? window.isAdmin() : false;
    const canManage = typeof window.canManageRoster === 'function' ? window.canManageRoster() : false;
    if ((cateredRiderId || cateredRiderName) && !isAdmin && !canManage) {
        return showToast(`⚠️ Ang customer na ito ay kinacater na ni ${meta.cateredByRiderName || meta.cateredBy}.`);
    }

    if (typeof window.confirmCateringStatus === 'function') {
        const res = await window.confirmCateringStatus(custName, custId);
        if (res && typeof window.setRiderChatFilter === 'function') {
            window.setRiderChatFilter('catering');
        }
    } else {
        showToast("⚠️ Catering system unavailable.");
    }
}

// -------------------------------------------------------------
// ORDER CHECKPOINT MILESTONE TRACKING
// -------------------------------------------------------------
export async function setOrderMilestone(stage) {
    const meta = window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {};
    const orderId = cleanFirebasePathKey(meta?.latestOrderId);

    if (!orderId) {
        return showToast("⚠️ No active order tied to this thread.");
    }

    await updateOrderMilestone(stage, orderId);
}

export async function updateOrderMilestone(stage, orderId, podImageUrl = null) {
    const cleanOrderId = cleanFirebasePathKey(orderId);
    if (!cleanOrderId || !db) return;

    const riderName = localStorage.getItem('riderName') || "Rider";
    const now = Date.now();

    const updates = {};
    updates[`orders/${cleanOrderId}/status`] = stage;
    updates[`orders/${cleanOrderId}/milestones/${stage}`] = {
        timestamp: now,
        updatedBy: riderName
    };

    if (podImageUrl) {
        updates[`orders/${cleanOrderId}/podImageUrl`] = podImageUrl;
    }

    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (custId) {
        updates[`customerChats/${custId}/metadata/orderStatus`] = stage;
    }

    try {
        await db.ref().update(updates);
        highlightActiveMilestoneUI(stage);

        const stageLabels = {
            preparing: "Order is being prepared",
            picked_up: "Order picked up by rider",
            arrived: "Rider arrived at drop-off",
            delivered: "Order delivered"
        };

        const label = stageLabels[stage] || stage.toUpperCase();
        showToast(`📍 Milestone updated: ${label}`);
        if (showSideNotification) {
            showSideNotification("MILESTONE UPDATED", `#${cleanOrderId}: ${label}`, "fa-route", "text-blue-400", "border-blue-500");
        }
    } catch(e) {
        console.error("Milestone update error:", e);
        showToast("❌ Failed to update order milestone.");
    }
}

export function highlightActiveMilestoneUI(activeStage) {
    const stages = ['preparing', 'picked_up', 'arrived', 'delivered'];
    const activeIdx = stages.indexOf(activeStage);

    stages.forEach((stage, idx) => {
        const btn = document.getElementById(`milestone-btn-${stage}`);
        if (btn) {
            if (idx <= activeIdx && activeIdx !== -1) {
                btn.className = "flex-1 min-w-[70px] py-1 px-1.5 rounded-lg bg-emerald-600 text-white font-bold text-[9px] transition active:scale-95 text-center flex flex-col items-center gap-0.5 shadow-sm";
            } else {
                btn.className = "flex-1 min-w-[70px] py-1 px-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 font-bold text-[9px] transition active:scale-95 text-center flex flex-col items-center gap-0.5";
            }
        }
    });
}

export const undoCustomerThread = markThreadUndone;
export const followUpCustomerOrder = markThreadFollowUp;
export const completeCatering = markThreadDone;
export const cancelCatering = cancelCustomerThread;

if (typeof window !== 'undefined') {
    window.showCustomerDetails = showCustomerDetails;
    window.closeCustomerDetailsModal = closeCustomerDetailsModal;
    window.confirmDirectoryAutoMatch = confirmDirectoryAutoMatch;
    window.toggleDirectoryLinkPicker = toggleDirectoryLinkPicker;
    window.handleDirectorySearchInput = handleDirectorySearchInput;
    window.clearDirectorySearch = clearDirectorySearch;
    window.selectAndLinkDirectoryCustomer = selectAndLinkDirectoryCustomer;
    window.selectDirectoryCustomerIndex = selectDirectoryCustomerIndex;
    window.unlinkCurrentChatDirectory = unlinkCurrentChatDirectory;
    window.copyCustomerPhone = copyCustomerPhone;
    window.openNewDirectoryCustomerFromChat = openNewDirectoryCustomerFromChat;
    window.toggleQuickReplies = toggleQuickReplies;
    window.sendQuickReply = sendQuickReply;
    window.initSharedQuickRepliesListener = initSharedQuickRepliesListener;
    window.renderSharedQuickReplies = renderSharedQuickReplies;
    window.promptAddQuickReply = promptAddQuickReply;
    window.closeAddQuickReplyModal = closeAddQuickReplyModal;
    window.handleQuickReplyChipClick = handleQuickReplyChipClick;
    window.confirmSendQuickReply = confirmSendQuickReply;
    window.openEditQuickReplyModal = openEditQuickReplyModal;
    window.backToQuickReplyChoiceView = backToQuickReplyChoiceView;
    window.sendEditedQuickReply = sendEditedQuickReply;
    window.closeQuickReplyActionModal = closeQuickReplyActionModal;
    window.moveQuickReplyToTop = moveQuickReplyToTop;
    window.moveQuickReplyOrder = moveQuickReplyOrder;
    window.handleQuickReplyDragStart = handleQuickReplyDragStart;
    window.handleQuickReplyDragOver = handleQuickReplyDragOver;
    window.handleQuickReplyDrop = handleQuickReplyDrop;
    window.submitSaveQuickReply = submitSaveQuickReply;
    window.deleteQuickReply = deleteQuickReply;
    window.markThreadUndone = markThreadUndone;
    window.markThreadDone = markThreadDone;
    window.executeThreadDone = executeThreadDone;
    window.markThreadFollowUp = markThreadFollowUp;
    window.cancelCustomerThread = cancelCustomerThread;
    window.undoCustomerThread = undoCustomerThread;
    window.followUpCustomerOrder = followUpCustomerOrder;
    window.completeCatering = completeCatering;
    window.cancelCatering = cancelCatering;

    window.openPodModal = openPodModal;
    window.closePodModal = closePodModal;
    window.handlePodImageSelected = handlePodImageSelected;
    window.submitProofOfDelivery = submitProofOfDelivery;
    window.setOrderMilestone = setOrderMilestone;
    window.updateOrderMilestone = updateOrderMilestone;
    window.highlightActiveMilestoneUI = highlightActiveMilestoneUI;
    window.caterCurrentChatCustomer = caterCurrentChatCustomer;
    window.caterCustomer = caterCurrentChatCustomer;
}