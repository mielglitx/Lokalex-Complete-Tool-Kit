// src/features/chat/threadActions/threadCustomerDetails.js
import { db } from '../../../config/firebase.js';
import { appState, globalState } from '../../../store/state.js';
import { showToast, showSideNotification } from '../../../ui/notifications.js';
import { toggleBodyScroll, compressAndResizeImage } from '../chatUtils.js';
import { uploadImage } from '../../../utils/imageUpload.js';
import { escapeHtml, cleanCustomerForMatch } from '../../../utils/helpers.js';
import { idbGet } from '../../../utils/storageEngine.js';
import { resolveFacebookCustomerName } from '../facebookApiAdmin.js';
import { cleanFirebasePathKey, formatMapPinUrl, extractCleanSearchName } from './threadUtils.js';

let currentDirectoryCustomersList = [];
let currentFilteredDirectoryResults = [];
let currentActiveDirectoryMatch = null;
let currentActiveLinkedRecord = null;
let currentChatDetailsCustId = null;

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

    // 4. Ingest from Firebase (strictly directory/customers)
    if (db) {
        try {
            const dirSnap = await db.ref('directory/customers').once('value');
            if (dirSnap && dirSnap.val()) {
                const data = dirSnap.val() || {};
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
    const actualCustName = meta.originalCustomerName || meta.facebookName || 
                           (chatHeaderName && !chatHeaderName.startsWith('FB Customer (') && chatHeaderName !== 'Customer' ? chatHeaderName : null) || 
                           data.name || meta.customerName || 'Customer';

    // Resolve effective name, phone, address, map pin
    let effectiveName = actualCustName;
    let effectivePhone = data.phoneNumber || data.phone || data.contact || meta.customerPhone || "";
    let effectiveAddress = data.address || meta.customerAddress || "";
    let effectiveMapPin = data.mapPinLink || meta.customerMapPin || (data.lat && data.lng ? `https://www.google.com/maps/search/?api=1&query=${data.lat},${data.lng}` : "");
    let isLinked = false;
    let isAutoMatched = false;

    if (dirRecord) {
        isLinked = true;
        effectivePhone = dirRecord.contact || effectivePhone;
        effectiveAddress = dirRecord.address || effectiveAddress;
        effectiveMapPin = dirRecord.lat_lon_link || effectiveMapPin;
    } else if (autoMatchCandidate) {
        isAutoMatched = true;
        // NOTE: Suggested match ONLY - never overwrite the customer's actual identity, phone, or address!
    }

    // Populate Fields
    const avatarImg = document.getElementById('cust-modal-avatar-img');
    let custAvatar = meta.avatarUrl || data.avatarUrl || data.photoUrl || (typeof getResolvedFbName === 'function' ? getResolvedFbName(custId)?.avatarUrl : null);
    if (!custAvatar || custAvatar.includes('ui-avatars.com')) {
        if (dirRecord?.photoUrl || dirRecord?.avatarUrl) {
            custAvatar = dirRecord.photoUrl || dirRecord.avatarUrl;
        }
    }
    if (!custAvatar) {
        custAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(actualCustName)}&background=0084FF&color=fff`;
    }
    if (avatarImg) {
        avatarImg.src = custAvatar;
        avatarImg.alt = actualCustName;
    }

    // Auto-resolve real Facebook profile picture in the background if currently a placeholder
    if (custId && custId.startsWith('fb_') && custAvatar.includes('ui-avatars.com')) {
        resolveFacebookCustomerName(custId).then(resolved => {
            if (resolved && resolved.avatarUrl && !resolved.avatarUrl.includes('ui-avatars.com')) {
                if (avatarImg && currentChatDetailsCustId === custId) {
                    avatarImg.src = resolved.avatarUrl;
                }
            }
        }).catch(() => {});
    }

    if (nameEl) {
        if (dirRecord && dirRecord.name) {
            nameEl.innerHTML = `
                <div class="flex flex-col min-w-0">
                    <span class="font-bold text-sm text-gray-900 dark:text-white truncate">${escapeHtml(actualCustName)}</span>
                    <span class="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 mt-0.5 truncate">
                        <i class="fa-solid fa-link text-[9px]"></i> Directory: ${escapeHtml(dirRecord.name)}
                    </span>
                </div>
            `;
        } else {
            nameEl.innerText = actualCustName || "Customer Name";
        }
    }
    
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
            bannerBadge.innerText = "Suggested";
            bannerBadge.className = "text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-blue-600 text-white";
        }
        if (bannerSub) bannerSub.innerText = `Directory: ${autoMatchCandidate.name}`;
        if (autoConfirmBtn) {
            autoConfirmBtn.classList.remove('hidden');
            autoConfirmBtn.innerHTML = `<i class="fa-solid fa-link"></i> Link Profile`;
        }
        if (linkBtnText) linkBtnText.innerText = "Change";
        if (unlinkBtn) unlinkBtn.classList.add('hidden');
        if (sourcePillEl) {
            sourcePillEl.innerHTML = `<span class="text-[9px] bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold px-2 py-0.5 rounded-full border border-amber-500/30 flex items-center gap-1"><i class="fa-solid fa-wand-magic-sparkles"></i> Unlinked</span>`;
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
    const linkedKey = custData.linkedDirectoryKey || meta.linkedDirectoryKey;
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
                name: linkedName || linkedKey || custData.name,
                contact: custData.phoneNumber || "",
                address: custData.address || "",
                lat_lon_link: custData.mapPinLink || "",
                barangay: custData.barangay || "",
                compositeKey: linkedKey
            };
        }
    }

    // If unlinked Facebook thread, ensure real customer name is resolved from Facebook Graph API/cache
    if (!linkedRecord && custId.startsWith('fb_')) {
        try {
            const resolved = await resolveFacebookCustomerName(custId);
            if (resolved && resolved.name && !resolved.name.startsWith('FB Customer (')) {
                meta.facebookName = resolved.name;
                meta.originalCustomerName = resolved.name;
                meta.customerName = resolved.name;
            }
        } catch(e) {}
    }

    // 2. If not linked, check auto-matching candidate (STRICT EXACT MATCH ONLY)
    let autoMatchCandidate = null;
    if (!linkedRecord) {
        const chatHeaderName = document.getElementById('rider-chat-cust-name')?.innerText?.trim();
        const candidateRaw = meta.originalCustomerName || meta.facebookName || meta.customerName || custData.name || (chatHeaderName && chatHeaderName !== 'Customer' ? chatHeaderName : '');
        const cleanName = extractCleanSearchName(candidateRaw);

        if (cleanName && cleanName.length >= 2) {
            const cleanTarget = cleanCustomerForMatch(cleanName);
            // Strict exact match only: NEVER use loose fuzzy matching to auto-match directory profiles
            let candidate = dirList.find(r => {
                const rClean = cleanCustomerForMatch(r.name);
                return rClean && rClean === cleanTarget;
            });
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

    let restoredName = null;
    let meta = (window.getCurrentRiderChatMeta && window.getCurrentRiderChatMeta()) || {};
    
    // Check if we have original customer name or Facebook name stored
    if (meta.originalCustomerName) {
        restoredName = meta.originalCustomerName;
    } else if (meta.facebookName) {
        restoredName = meta.facebookName;
    } else if (custId.startsWith('fb_')) {
        try {
            const resolved = await resolveFacebookCustomerName(custId, true);
            if (resolved && resolved.name && !resolved.name.startsWith('FB Customer (')) {
                restoredName = resolved.name;
            }
        } catch(e) {}
    }

    const unlinkCustPayload = {
        linkedDirectoryKey: null,
        linkedDirectoryName: null,
        ...(restoredName ? { name: restoredName } : {})
    };
    const unlinkMetaPayload = {
        linkedDirectoryKey: null,
        linkedDirectoryName: null,
        customerPhone: null,
        customerAddress: null,
        customerMapPin: null,
        ...(restoredName ? { customerName: restoredName } : {})
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

    // Update active chat header name if currently viewing this thread
    if (restoredName) {
        const headerNameEl = document.getElementById('rider-chat-cust-name');
        if (headerNameEl && window.getActiveRiderChatCustId && window.getActiveRiderChatCustId() === custId) {
            headerNameEl.innerText = restoredName;
        }
    }

    currentActiveLinkedRecord = null;
    currentActiveDirectoryMatch = null;
    toggleDirectoryLinkPicker(false);
    await showCustomerDetails();
    showToast(restoredName ? `ℹ️ Unlinked! Restored original name: ${restoredName}` : "ℹ️ Unlinked from Customer Directory.");
}

export async function linkChatToDirectoryRecord(custId, dirRecord) {
    if (!custId || !dirRecord) return;

    const dirKey = dirRecord.compositeKey || dirRecord.name;
    const dirName = dirRecord.name;
    const phone = dirRecord.contact || "";
    const address = dirRecord.address || "";
    const mapPin = dirRecord.lat_lon_link || "";
    const barangay = dirRecord.barangay || "";

    const currentMeta = (window.getCurrentRiderChatMeta && window.getCurrentRiderChatMeta()) || {};
    const chatHeaderName = document.getElementById('rider-chat-cust-name')?.innerText?.trim();
    const originalName = currentMeta.originalCustomerName || currentMeta.facebookName || 
                         (chatHeaderName && !chatHeaderName.startsWith('FB Customer (') && chatHeaderName !== 'Customer' ? chatHeaderName : null) || 
                         currentMeta.customerName || dirName;

    const customerUpdates = {
        linkedDirectoryKey: dirKey,
        linkedDirectoryName: dirName,
        originalCustomerName: originalName,
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
        originalCustomerName: originalName,
        linkedDirectoryKey: dirKey,
        linkedDirectoryName: dirName,
        customerPhone: phone,
        customerAddress: address,
        customerMapPin: mapPin
    };
    if (custId.startsWith('fb_')) {
        chatMetaUpdates.facebookName = originalName;
        customerUpdates.facebookName = originalName;
    }

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

export async function openNewDirectoryCustomerFromChat() {
    const activeCustId = currentChatDetailsCustId || (window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null);
    closeCustomerDetailsModal();
    const custModalName = document.getElementById('cust-modal-name')?.innerText?.trim();
    const chatHeaderName = document.getElementById('rider-chat-cust-name')?.innerText?.trim();
    const candidateRaw = (custModalName && custModalName !== 'Customer Name' && custModalName !== 'Customer') 
        ? custModalName 
        : (chatHeaderName && !chatHeaderName.startsWith('FB Customer') && chatHeaderName !== 'Customer' ? chatHeaderName : '');
    const fallbackName = extractCleanSearchName(candidateRaw);

    const phoneEl = document.getElementById('cust-modal-phone');
    const phoneText = phoneEl?.innerText?.trim();
    const cleanPhone = (phoneText && phoneText !== '---' && phoneText !== 'No contact recorded') ? phoneText : '';
    
    if (window.closeRiderChatModal) {
        window.closeRiderChatModal();
    }

    // Auto-capture rider's exact current GPS location
    showToast("📍 Kinukuha ang eksaktong GPS location mo...");

    let capturedLat = appState.lat || null;
    let capturedLon = appState.lon || null;
    let mapPinLink = "";

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
        try {
            const pos = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 4500,
                    maximumAge: 10000
                });
            });
            if (pos && pos.coords) {
                capturedLat = pos.coords.latitude;
                capturedLon = pos.coords.longitude;
                appState.lat = capturedLat;
                appState.lon = capturedLon;
            }
        } catch (_) {
            // Keep fallback lat/lon from appState
        }
    }

    if (capturedLat && capturedLon) {
        mapPinLink = `https://maps.google.com/?q=${Number(capturedLat).toFixed(6)},${Number(capturedLon).toFixed(6)}`;
    }

    if (typeof window.openForm === 'function') {
        globalState.currentType = 'customers';
        if (activeCustId) {
            window._pendingLinkCustIdFromChat = activeCustId;
        }
        await window.openForm({ 
            name: fallbackName, 
            contact: cleanPhone,
            lat_lon_link: mapPinLink,
            isNew: true,
            type: 'customers' 
        });
        if (mapPinLink) {
            showToast(`📍 Na-capture ang eksaktong GPS location mo para sa customer profile!`);
        } else {
            showToast(`📝 Adding new customer: ${fallbackName || 'New Customer'}`);
        }
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

export async function handleCustomerPhotoUpload(event) {
    const file = event?.target?.files?.[0];
    if (event?.target) event.target.value = '';
    if (!file) return;

    const custId = currentChatDetailsCustId || (window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null);
    if (!custId) {
        showToast("⚠️ Walang aktibong customer na napili.");
        return;
    }

    if (!file.type || !file.type.startsWith('image/')) {
        showToast("⚠️ Mangyaring pumili ng image file (JPG, PNG, WebP).");
        return;
    }

    showToast("⏳ Sinusuri at sine-save ang customer photo...");

    try {
        const compressedBase64 = await compressAndResizeImage(file, 320, 320, 0.85);
        if (!compressedBase64) {
            throw new Error("Failed to process image.");
        }

        let finalAvatarUrl = compressedBase64;
        try {
            const cleanPath = `customer_avatars/${cleanFirebasePathKey(custId)}_${Date.now()}.jpg`;
            const uploadedUrl = await uploadImage(compressedBase64, cleanPath);
            if (uploadedUrl && typeof uploadedUrl === 'string' && uploadedUrl.startsWith('http')) {
                finalAvatarUrl = uploadedUrl;
            }
        } catch (_) {}

        if (db) {
            await Promise.all([
                db.ref(`customerChatMeta/${custId}/avatarUrl`).set(finalAvatarUrl),
                db.ref(`customerChats/${custId}/metadata/avatarUrl`).set(finalAvatarUrl)
            ]).catch(err => {
                console.warn("RTDB avatar update note:", err);
            });
        }

        const avatarImg = document.getElementById('cust-modal-avatar-img');
        if (avatarImg) {
            avatarImg.src = finalAvatarUrl;
        }

        const chatAvatar = document.getElementById('rider-chat-avatar') || document.getElementById('rider-chat-cust-avatar');
        if (chatAvatar) {
            if (chatAvatar.tagName === 'IMG') {
                chatAvatar.src = finalAvatarUrl;
            } else {
                chatAvatar.innerHTML = `<img src="${finalAvatarUrl}" class="w-full h-full rounded-full object-cover">`;
            }
        }

        if (typeof window !== 'undefined') {
            window.currentActiveRiderChatCustAvatar = finalAvatarUrl;
            if (typeof window.getCachedCustomerThreadsMap === 'function') {
                const map = window.getCachedCustomerThreadsMap();
                if (map && map.has(custId)) {
                    map.get(custId).avatarUrl = finalAvatarUrl;
                }
            }
            if (typeof window.renderRiderCustomerChatFeed === 'function') {
                window.renderRiderCustomerChatFeed();
            }
        }

        showToast("✅ Customer profile picture updated!");
    } catch (err) {
        console.error("Failed to upload customer avatar:", err);
        showToast("❌ Hindi na-save ang larawan: " + (err.message || "Error"));
    }
}
