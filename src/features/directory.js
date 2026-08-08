// src/features/directory.js
import { appState, globalState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { API_URL, BARANGAY_DATA, ADMIN_IDS } from '../config/constants.js';
import { showToast, showSideNotification } from '../ui/notifications.js';
import { switchView } from '../ui/router.js';
import { openSlideDeleteModal } from '../ui/modals.js';
import { calibrateGPS } from './auth.js';
import { escapeHtml, copyText } from '../utils/helpers.js';
import { isRiderAdmin } from './commission.js';

let editingRecord = null;
let mapInstance = null;
let selectedMapLat = 0;
let selectedMapLng = 0;
let lastJumpLetter = "";

const CACHE_KEY = 'lokalex_directory_cache';

// CHECK IF CURRENT USER IS AN ADMIN
export function checkAdminAccess() {
    const uType = (appState.userType || localStorage.getItem('userType') || "").toString().trim().toLowerCase();
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim();

    if (uType.includes("admin") || uType.includes("owner") || uType.includes("manager") || ADMIN_IDS.includes(myId)) {
        return true;
    }

    if (typeof isRiderAdmin === 'function') {
        return isRiderAdmin(myName, myId);
    }

    return false;
}

// PERSIST DIRECTORY RECORDS TO LOCALSTORAGE
export function saveDirectoryCache() {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(globalState.records || []));
    } catch(e) {}
}

// LOAD DIRECTORY RECORDS FROM LOCALSTORAGE ON APP BOOT
export function loadDirectoryCache() {
    try {
        const saved = localStorage.getItem(CACHE_KEY);
        if (saved) {
            globalState.records = JSON.parse(saved);
        } else {
            if (!globalState.records || globalState.records.length === 0) {
                globalState.records = BARANGAY_DATA.map(b => ({
                    name: b.name,
                    contact: "",
                    address: `₱${b.fee.toFixed(2)}`,
                    rate: `₱${b.fee.toFixed(2)}`,
                    lat_lon_link: "",
                    type: 'barangays',
                    recorded_by: "System"
                }));
                saveDirectoryCache();
            }
        }
    } catch(e) {
        globalState.records = [];
    }
}

// OPEN DIRECTORY (INSTANT RENDER FROM CACHE)
export async function openDirectory(type) {
    globalState.currentType = type || 'customers';
    switchView('view-directory');
    
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) {
        if (type === 'customers') headerTitle.innerText = "Customer Directory";
        else if (type === 'stores') headerTitle.innerText = "Store Directory";
        else headerTitle.innerText = "Rates & Barangays";
    }

    if (!globalState.records || globalState.records.length === 0) {
        loadDirectoryCache();
    }

    renderDirectoryList();
}

// SILENT BACKGROUND SYNC ON APP STARTUP
export async function silentSyncDirectory() {
    loadDirectoryCache();
    try {
        await syncData(true);
    } catch(e) {}
}

// DUAL-SOURCE DATA SYNC WITH OFFLINE MERGE
export async function syncData(isSilent = false) {
    const type = globalState.currentType || 'customers';
    const listEl = document.getElementById('record-list');
    
    const hasExistingLocal = (globalState.records || []).some(r => (r.type || 'customers') === type);

    if (!isSilent && !hasExistingLocal && listEl) {
        listEl.innerHTML = `
        <div class="text-center text-blue-400 font-bold py-16 text-xs flex flex-col items-center justify-center gap-2">
            <i class="fa-solid fa-rotate fa-spin text-2xl"></i>
            <span>Syncing ${type.toUpperCase()} records from Google Sheets...</span>
        </div>`;
    }

    let fetchedRecords = [];

    try {
        const res = await fetch(`${API_URL}?type=${type}`);
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
                fetchedRecords = data.map(item => {
                    const barangayName = item.barangay || item.barangay_name || item.name || item.title || "";
                    const rateVal = item.rate || item.delivery_rate || item.fee || item.price || item.amount || item.address || item.general_address || "";
                    const contact = item.contact || item.contact_number || item.phone || item.mobile || "";
                    const address = item.address || item.general_address || item.location || "";
                    const lat_lon_link = item.lat_lon_link || item.lat_lon || item.coordinates || item.map || item.map_link || "";

                    const finalName = (type === 'barangays' ? barangayName : (item.name || item.customer_name || item.store_name || barangayName)).trim();

                    return {
                        name: finalName,
                        contact: contact.trim(),
                        address: address.trim(),
                        rate: rateVal.toString().trim(),
                        lat_lon_link: lat_lon_link.trim(),
                        type: item.type || type,
                        recorded_by: item.recorded_by || item.recordedby || "Amiel"
                    };
                }).filter(r => r.name !== "");
            }
        }
    } catch (err) {
        console.warn("Offline/Network error syncing directory from Sheets, using local cache...", err);
    }

    if (db) {
        try {
            const snap = await db.ref(`directory/${type}`).once('value');
            const fbData = snap.val();
            if (fbData) {
                const fbList = Object.values(fbData).map(item => ({
                    name: (item.name || "").trim(),
                    contact: (item.contact || "").trim(),
                    address: (item.address || "").trim(),
                    rate: (item.rate || item.address || "").toString().trim(),
                    lat_lon_link: (item.lat_lon_link || "").trim(),
                    type: item.type || type,
                    recorded_by: item.recorded_by || "Amiel"
                })).filter(r => r.name !== "");

                const recordMap = new Map();
                fetchedRecords.forEach(r => recordMap.set(r.name.toLowerCase(), r));
                fbList.forEach(r => recordMap.set(r.name.toLowerCase(), r));
                fetchedRecords = Array.from(recordMap.values());
            }
        } catch(e) {}
    }

    if (fetchedRecords.length > 0) {
        const otherTypeRecords = (globalState.records || []).filter(r => r.type !== type);
        globalState.records = [...otherTypeRecords, ...fetchedRecords];
        saveDirectoryCache();

        if (!isSilent) {
            showToast(`✅ Synced ${fetchedRecords.length} ${type} records!`);
        }
    }

    const currentViewEl = document.querySelector('main > section:not(.hidden)');
    if (currentViewEl && currentViewEl.id === 'view-directory') {
        renderDirectoryList();
    }
}

export function filterDirectoryRecords() {
    renderDirectoryList();
}

// COPY BARANGAY RATE WITH CUSTOMER FEE TEMPLATE & CLEAN SPACING
export function copyBarangayRate(barangayName, rawRate) {
    let rateNum = parseFloat((rawRate || "").replace(/[^0-9.]/g, ''));
    let amountStr = !isNaN(rateNum) ? rateNum.toFixed(0) : (rawRate || '0').replace(/[^0-9.]/g, '');

    const formattedMessage = `The delivery fee at ${barangayName} starts at ₱${amountStr}\n\n(Note: Other fees may apply for additional stores or extra services!)\n\nWould you like to see our fee guidelines po?`;

    copyText(formattedMessage);
    showToast(`📋 Copied rate message for ${barangayName}!`);
}

function getSectionLetter(name) {
    if (!name) return "#";
    const firstChar = name.trim().charAt(0).toUpperCase();
    
    if (/^[A-Z]$/.test(firstChar)) {
        return firstChar;
    }
    
    return "#";
}

// RENDER DIRECTORY LIST WITH SPECIAL CHARACTERS / FOREIGN SYMBOLS & CONTINUOUS SCROLL
export function renderDirectoryList() {
    const listEl = document.getElementById('record-list');
    const searchVal = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
    if (!listEl) return;

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
            <div id="dir-section-${letterHeader === "#" ? "SPECIAL" : letterHeader}" data-section="${letterHeader}" class="sticky top-0 z-10 bg-darkBg/95 backdrop-blur-md text-amber-400 font-black text-xs px-2 py-1.5 border-b border-gray-800/80 my-1 flex items-center justify-between">
                <span>${headerLabel}</span>
                <span class="text-[9px] text-gray-500 font-normal">Section Header</span>
            </div>`;
        }

        let mapBtn = '';
        if (r.lat_lon_link) {
            mapBtn = `<a href="${escapeHtml(r.lat_lon_link)}" target="_blank" class="text-xs text-blue-400 font-bold underline flex items-center gap-1 mt-1"><i class="fa-solid fa-map-location-dot"></i> View Location</a>`;
        }

        const deleteBtnHtml = isAdminUser 
            ? `<button onclick="promptDeleteDirectoryRecord('${escapeHtml(r.name)}')" class="bg-gray-800 hover:bg-gray-700 text-red-400 p-2 rounded-lg text-xs transition active:scale-90" title="Delete">
                    <i class="fa-solid fa-trash"></i>
               </button>`
            : '';

        if (isBarangay) {
            let rateNum = parseFloat((r.rate || r.address || "").replace(/[^0-9.]/g, ''));
            let displayRate = !isNaN(rateNum) ? `₱${rateNum.toFixed(2)}` : (r.rate || r.address || '₱0.00');

            htmlBuilder += `
            <div class="bg-cardBg border border-gray-800 p-3.5 rounded-xl flex justify-between items-center gap-2 shadow-sm my-1">
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-sm text-white truncate"><i class="fa-solid fa-map-location-dot text-emerald-400 mr-1.5"></i> ${escapeHtml(r.name)}</div>
                    <div class="text-xs font-mono text-emerald-400 font-bold mt-1">Delivery Rate: ${escapeHtml(displayRate)}</div>
                </div>
                <div class="flex gap-1.5 shrink-0">
                    <button onclick="copyBarangayRate('${escapeHtml(r.name)}', '${escapeHtml(displayRate)}')" class="bg-blue-600/30 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/50 px-2.5 py-1.5 rounded-lg text-xs font-bold transition active:scale-90 flex items-center gap-1" title="Copy Rate Message">
                        <i class="fa-solid fa-copy"></i> Copy
                    </button>
                    <button onclick="editDirectoryRecord('${escapeHtml(r.name)}')" class="bg-gray-800 hover:bg-gray-700 text-amber-400 p-2 rounded-lg text-xs transition active:scale-90" title="Edit">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    ${deleteBtnHtml}
                </div>
            </div>`;
        } else {
            htmlBuilder += `
            <div class="bg-cardBg border border-gray-800 p-3.5 rounded-xl flex justify-between items-start gap-2 shadow-sm my-1">
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-sm text-white truncate">${escapeHtml(r.name)}</div>
                    ${r.contact ? `<div class="text-xs text-gray-400 mt-0.5"><i class="fa-solid fa-phone text-[10px]"></i> ${escapeHtml(r.contact)}</div>` : ''}
                    ${r.address ? `<div class="text-xs text-gray-400 mt-0.5"><i class="fa-solid fa-location-dot text-[10px]"></i> ${escapeHtml(r.address)}</div>` : ''}
                    ${mapBtn}
                </div>
                <div class="flex gap-1 shrink-0">
                    <button onclick="editDirectoryRecord('${escapeHtml(r.name)}')" class="bg-gray-800 hover:bg-gray-700 text-amber-400 p-2 rounded-lg text-xs transition active:scale-90" title="Edit">
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

// ELASTIC ALPHABET SCRUBBER
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
        const opacityClass = hasRecords ? "text-blue-400 font-black" : "text-gray-600 opacity-40 font-semibold";
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
            targetEl = allSections.find(sec => sec.dataset.section.localeCompare(letter) >= 0) || allSections[allSections.length - 1];
        }

        if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

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
                node.style.color = '#38bdf8';

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

export function openForm(record = null) {
    editingRecord = record;
    switchView('view-form');

    const warningEl = document.getElementById('edit-warning');
    const warningText = document.getElementById('warning-text');
    const submitBtn = document.getElementById('form-submit-btn');

    const nameInput = document.getElementById('form-name');
    const contactInput = document.getElementById('form-contact');
    const addressInput = document.getElementById('form-address');
    const latlonInput = document.getElementById('form-latlon');

    if (record) {
        if (warningEl) warningEl.classList.remove('hidden');
        if (warningText) warningText.innerText = `Editing record: ${record.name}`;
        if (submitBtn) submitBtn.innerText = "UPDATE RECORD";

        if (nameInput) nameInput.value = record.name || "";
        if (contactInput) contactInput.value = record.contact || "";
        if (addressInput) addressInput.value = record.address || record.rate || "";
        if (latlonInput) latlonInput.value = record.lat_lon_link || "";
    } else {
        if (warningEl) warningEl.classList.add('hidden');
        if (submitBtn) submitBtn.innerText = "SAVE RECORD";

        if (nameInput) nameInput.value = "";
        if (contactInput) contactInput.value = "";
        if (addressInput) addressInput.value = "";
        if (latlonInput) latlonInput.value = "";
    }
}

export function editDirectoryRecord(name) {
    const record = globalState.records?.find(r => r.name === name);
    if (record) openForm(record);
}

// SLIDE TO CONFIRM DIRECTORY DELETE FOR ADMINS
export function promptDeleteDirectoryRecord(name) {
    if (!checkAdminAccess()) {
        return showToast("⚠️ Admin access required to delete directory records.");
    }

    openSlideDeleteModal(
        `Delete Directory Record?`,
        `Sigurado ka bang nais mong burahin ang record na [${name}]?`,
        () => {
            executeDeleteDirectoryRecord(name);
        }
    );
}

// INSTANT OFFLINE DELETE WITH BACKGROUND SYNC
export function executeDeleteDirectoryRecord(name) {
    const type = globalState.currentType || 'customers';
    
    if (globalState.records) {
        globalState.records = globalState.records.filter(r => !(r.name === name && r.type === type));
    }

    saveDirectoryCache();
    renderDirectoryList();
    showToast(`🗑️ Deleted record: ${name}`);

    if (db) {
        const cleanKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        db.ref(`directory/${type}/${cleanKey}`).remove().catch(() => {});
    }

    try {
        fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({
                type: type,
                action: 'delete',
                data: { name: name }
            })
        }).catch(() => {});
    } catch(e) {}
}

// INSTANT OFFLINE SAVE & EDIT WITH STRICT GPS GUARDRAIL & BACKGROUND SYNC
export async function submitForm() {
    const nameInput = document.getElementById('form-name');
    const contactInput = document.getElementById('form-contact');
    const addressInput = document.getElementById('form-address');
    const latlonInput = document.getElementById('form-latlon');

    const name = nameInput ? nameInput.value.trim() : "";
    const contact = contactInput ? contactInput.value.trim() : "";
    const address = addressInput ? addressInput.value.trim() : "";
    const lat_lon_link = latlonInput ? latlonInput.value.trim() : "";

    if (!name) return showToast("⚠️ Name / Store Name / Barangay is required!");

    // STRICT GPS SIGNAL CHECK BEFORE SAVING RECORD
    showToast("📡 Calibrating GPS location...");
    const coords = await calibrateGPS((acc) => {
        showToast(`📡 Checking GPS signal: ±${Math.round(acc)}m`);
    });

    if (!coords || (coords.lat === 0 && coords.lon === 0) || coords.accuracy > 50) {
        const gpsModal = document.getElementById('gps-alert-modal');
        if (gpsModal) gpsModal.classList.remove('hidden');
        showToast(`⚠️ Cannot save record: Bad GPS signal (±${Math.round(coords ? coords.accuracy : 999)}m)! Move to an open area.`);
        return;
    }

    const type = globalState.currentType || 'customers';

    const recordData = {
        name, contact, address, rate: address, lat_lon_link,
        type: type,
        recorded_by: appState.riderName || "Amiel",
        originalName: editingRecord ? editingRecord.name : name
    };

    if (editingRecord) {
        const idx = globalState.records.findIndex(r => r.name === editingRecord.name && r.type === type);
        if (idx !== -1) globalState.records[idx] = recordData;
    } else {
        if (!globalState.records) globalState.records = [];
        globalState.records.push(recordData);
    }

    saveDirectoryCache();
    openDirectory(type);
    showToast(`✅ Record ${editingRecord ? 'updated' : 'saved'} successfully!`);

    if (db) {
        const cleanKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        db.ref(`directory/${type}/${cleanKey}`).set(recordData).catch(() => {});
    }

    showSideNotification("SAVING RECORD", `Syncing ${name} to ${type}...`, "fa-floppy-disk", "text-emerald-400", "border-emerald-500");

    try {
        fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({
                type: type,
                action: editingRecord ? 'edit' : 'add',
                data: recordData
            })
        }).catch(() => {});
    } catch(e) {}
}

export async function openMapPicker() {
    switchView('view-map');

    showToast("📡 Calibrating GPS for map pin...");
    const coords = await calibrateGPS((acc) => {
        showToast(`📡 Calibrating Map GPS: ±${Math.round(acc)}m`);
    });

    if (!coords || (coords.lat === 0 && coords.lon === 0) || coords.accuracy > 50) {
        showToast(`⚠️ Weak GPS Signal (±${Math.round(coords ? coords.accuracy : 999)}m)! Move to an open area.`);
    } else {
        showToast(`✅ Map GPS Calibrated: ±${Math.round(coords.accuracy)}m`);
    }

    selectedMapLat = coords.lat || 15.6886;
    selectedMapLng = coords.lon || 120.4131;

    initGoogleMap(selectedMapLat, selectedMapLng);
}

function initGoogleMap(lat, lng) {
    const container = document.getElementById('google-map-container');
    if (!container || !window.google || !window.google.maps) return;

    const latLng = new google.maps.LatLng(lat, lng);
    mapInstance = new google.maps.Map(container, {
        center: latLng,
        zoom: 17,
        mapTypeId: 'hybrid',
        disableDefaultUI: false,
        zoomControl: true
    });

    mapInstance.addListener('center_changed', () => {
        const center = mapInstance.getCenter();
        selectedMapLat = center.lat();
        selectedMapLng = center.lng();
    });
}

export function confirmGoogleMapPin() {
    const latlonInput = document.getElementById('form-latlon');
    if (latlonInput && selectedMapLat && selectedMapLng) {
        latlonInput.value = `https://www.google.com/maps/search/?api=1&query=${selectedMapLat.toFixed(6)},${selectedMapLng.toFixed(6)}`;
    }
    switchView('view-form');
    showToast("📍 Map Pin location confirmed!");
}

loadDirectoryCache();

if (typeof window !== 'undefined') {
    window.openDirectory = openDirectory;
    window.syncData = syncData;
    window.silentSyncDirectory = silentSyncDirectory;
    window.filterDirectoryRecords = filterDirectoryRecords;
    window.openForm = openForm;
    window.editDirectoryRecord = editDirectoryRecord;
    window.promptDeleteDirectoryRecord = promptDeleteDirectoryRecord;
    window.executeDeleteDirectoryRecord = executeDeleteDirectoryRecord;
    window.submitForm = submitForm;
    window.openMapPicker = openMapPicker;
    window.confirmGoogleMapPin = confirmGoogleMapPin;
    window.copyBarangayRate = copyBarangayRate;
    window.loadDirectoryCache = loadDirectoryCache;
    window.saveDirectoryCache = saveDirectoryCache;
    window.checkAdminAccess = checkAdminAccess;
}
