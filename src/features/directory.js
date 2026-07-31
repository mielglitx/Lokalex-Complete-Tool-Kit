// src/features/directory.js
import { appState, globalState } from '../store/state.js';
import { API_URL, BARANGAY_DATA } from '../config/constants.js';
import { switchView, goBack } from '../ui/router.js';
import { showToast, showSideNotification } from '../ui/notifications.js';
import { escapeHtml, copyText } from '../utils/helpers.js';
import { openSlideDeleteModal, closePasswordModal } from '../ui/modals.js';

let editingRecord = null;
let pendingRecordToEdit = null;
let activeFilterLetter = "";

export async function openDirectory(type) {
    globalState.currentType = type; 
    activeFilterLetter = ""; 
    document.getElementById('search-input').value = "";
    const fab = document.getElementById('directory-add-fab');

    if (type === 'customers') {
        document.getElementById('header-title').innerText = "Customer Directory";
        if(fab) fab.classList.remove('hidden');
        loadLocalRecords(); 
        syncDataBackground();
    } else if (type === 'stores') {
        document.getElementById('header-title').innerText = "Store Directory";
        if(fab) fab.classList.remove('hidden');
        loadLocalRecords(); 
        syncDataBackground();
    } else if (type === 'barangays') {
        document.getElementById('header-title').innerText = "Barangay Delivery Rates";
        if(fab) fab.classList.add('hidden');
        globalState.records = BARANGAY_DATA.map(b => ({ name: b.name, km: b.km, fee: b.fee }));
        sortRecordsAlphabetically();
        filterDirectoryRecords();
    }

    switchView('view-directory');
    buildAlphabetScrubber(); 
    attachScrubberEvents(); 
}

export function loadLocalRecords() { 
    const cached = localStorage.getItem(`lokalex_${globalState.currentType}`); 
    if (cached) { 
        globalState.records = JSON.parse(cached); 
        sortRecordsAlphabetically();
        filterDirectoryRecords(); 
    } else {
        globalState.records = [];
        filterDirectoryRecords();
    }
}

export async function syncDataBackground() {
    try {
        const response = await fetch(`${API_URL}?type=${globalState.currentType}`);
        if (response.ok) { 
            const freshData = await response.json(); 
            globalState.records = freshData;
            sortRecordsAlphabetically();
            localStorage.setItem(`lokalex_${globalState.currentType}`, JSON.stringify(globalState.records)); 
            filterDirectoryRecords(); 
        }
    } catch (e) {}
}

export async function syncData() {
    showToast("Syncing database...");
    await syncDataBackground();
    showToast("Synchronized!");
}

export function filterDirectoryRecords() {
    const query = document.getElementById('search-input').value.toLowerCase();
    const filtered = globalState.records.filter(r => {
        const name = (r['name'] || r['customer name'] || r['store name'] || "").toLowerCase();
        if (query.length > 0) { activeFilterLetter = ""; return name.includes(query); }
        return activeFilterLetter === "" || name.toUpperCase().startsWith(activeFilterLetter);
    });
    renderDirectoryRecords(filtered);
}

function renderDirectoryRecords(list) {
    const container = document.getElementById('record-list');
    if (list.length === 0) return container.innerHTML = `<div class="text-center py-20 text-gray-500">No records found.</div>`;

    if (globalState.currentType === 'barangays') {
        container.innerHTML = list.map((b) => {
            const uid = Math.random().toString(36).substr(2, 9);
            
            // PROPERLY FORMATTED SPACING WITH LINE BREAKS (\n\n)
            const msgText = `Hello! 👋 The delivery fee to ${b.name} is ₱${b.fee}.\n\nPlease note that additional fees (such as handling or multi-stop fees) may apply depending on your order.\n\nWould you like to see our full fee guidelines?`;

            return `
                <div class="bg-cardBg border border-gray-800/80 rounded-xl shadow-sm flex flex-col transition-all overflow-hidden">
                    <div onclick="toggleCard('${uid}')" class="p-4 flex items-center justify-between cursor-pointer active:bg-white/5 transition">
                        <div class="flex items-center gap-3">
                            <div class="w-9 h-9 rounded-full bg-emerald-600/20 text-emerald-400 flex items-center justify-center font-bold text-sm">
                                <i class="fa-solid fa-map-location-dot"></i>
                            </div>
                            <div>
                                <h3 class="font-bold text-sm text-white">${escapeHtml(b.name)}</h3>
                                <div class="text-[10px] text-gray-400">${b.km} km distance</div>
                            </div>
                        </div>
                        <div class="flex items-center gap-3">
                            <span class="text-sm font-black text-emerald-400">₱${b.fee}</span>
                            <i id="card-icon-${uid}" class="fa-solid fa-chevron-down text-gray-500 transition-transform duration-300"></i>
                        </div>
                    </div>
                    <div id="card-details-${uid}" class="hidden px-4 pb-4 pt-2 border-t border-gray-800/50 text-xs text-gray-300 flex flex-col gap-3">
                        <div class="bg-darkBg p-3 rounded-xl border border-gray-700/60 font-sans text-xs text-gray-200 leading-relaxed select-text whitespace-pre-line">
${escapeHtml(msgText)}
                        </div>
                        <button onclick="event.stopPropagation(); copyText(\`${escapeHtml(msgText)}\`)" class="w-full bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 font-bold py-2.5 rounded-xl border border-emerald-600/30 flex items-center justify-center gap-2 transition active:scale-95">
                            <i class="fa-solid fa-copy"></i> Copy Customer Message
                        </button>
                    </div>
                </div>`;
        }).join('');
        return;
    }

    container.innerHTML = list.map((record) => {
        const name = record['name'] || record['customer name'] || record['store name'] || "Unknown";
        const contact = record['contact'] || record['phone'] || "";
        const address = record['address'] || "";
        const latLon = record['lat_lon_link'] || record['lat_lon'] || record['latlon'] || record['coordinates'] || record['map'] || "";
        const uid = Math.random().toString(36).substr(2, 9);
        const isAdmin = appState.userType.toLowerCase() === 'admin' || ['4547425', '5548562'].includes(appState.telegramId);

        let mapHtml = "";
        if (latLon && latLon.toString().trim() !== "") {
            const rawMapStr = latLon.toString().trim();
            const mapUrl = rawMapStr.startsWith('http') ? rawMapStr : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rawMapStr)}`;
            mapHtml = `<a href="${mapUrl}" target="_blank" class="text-blue-400 flex items-center gap-2 py-1 active:opacity-50"><i class="fa-solid fa-map-location-dot w-4 text-red-500"></i> <span class="underline">Open Map Location</span></a>`;
        }

        return `
            <div class="bg-cardBg border border-gray-800/80 rounded-xl shadow-sm flex flex-col transition-all overflow-hidden">
                <div onclick="toggleCard('${uid}')" class="p-4 flex items-center justify-between cursor-pointer active:bg-white/5 transition">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-full ${globalState.currentType === 'customers' ? 'bg-blue-600/20 text-blue-400' : 'bg-orange-600/20 text-orange-400'} flex items-center justify-center font-bold text-sm shrink-0">
                            <i class="fa-solid ${globalState.currentType === 'customers' ? 'fa-user' : 'fa-store'}"></i>
                        </div>
                        <div class="flex flex-col">
                            <h3 class="font-bold text-sm">${escapeHtml(name)}</h3>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick='event.stopPropagation(); promptEditRecord(${JSON.stringify(record)})' class="w-8 h-8 rounded-lg bg-inputBg hover:bg-gray-700 text-amber-400 flex items-center justify-center text-sm transition active:scale-90" title="Edit"><i class="fa-solid fa-pen"></i></button>
                        ${isAdmin ? `<button onclick='event.stopPropagation(); promptDeleteRecord(${JSON.stringify(record)})' class="w-8 h-8 rounded-lg bg-inputBg hover:bg-gray-700 text-red-400 flex items-center justify-center text-sm transition active:scale-90" title="Delete"><i class="fa-solid fa-trash"></i></button>` : ''}
                        <i id="card-icon-${uid}" class="fa-solid fa-chevron-down text-gray-500 transition-transform duration-300"></i>
                    </div>
                </div>
                <div id="card-details-${uid}" class="hidden px-4 pb-4 pt-1 border-t border-gray-800/50 text-xs text-gray-300 flex flex-col gap-2">
                    ${contact ? `<div onclick="copyText('${contact}')" class="text-emerald-400 flex items-center gap-2 cursor-pointer py-1"><i class="fa-solid fa-copy w-4"></i> <span class="font-mono text-sm">${contact}</span></div>` : ''}
                    ${address ? `<div class="flex items-start gap-2 py-1"><i class="fa-solid fa-location-dot w-4 mt-0.5 text-gray-500"></i> <span class="leading-tight">${escapeHtml(address)}</span></div>` : ''}
                    ${mapHtml}
                </div>
            </div>`;
    }).join('');
}

export function toggleCard(uid) {
    const details = document.getElementById(`card-details-${uid}`);
    const icon = document.getElementById(`card-icon-${uid}`);
    details.classList.toggle('hidden');
    icon.style.transform = details.classList.contains('hidden') ? "rotate(0deg)" : "rotate(180deg)";
}

function sortRecordsAlphabetically() {
    globalState.records.sort((a, b) => {
        const nameA = (a['name'] || a['customer name'] || a['store name'] || "").toLowerCase();
        const nameB = (b['name'] || b['customer name'] || b['store name'] || "").toLowerCase();
        return nameA.localeCompare(nameB);
    });
}

export function promptEditRecord(record) {
    const isAdmin = appState.userType.toLowerCase() === 'admin' || ['4547425', '5548562'].includes(appState.telegramId);
    if (isAdmin) {
        openSlideDeleteModal(`I-edit ang record na ito [${record['name'] || record['customer name'] || record['store name']}]?`, () => {
            openForm(record);
        });
    } else {
        pendingRecordToEdit = record; 
        document.getElementById('password-modal').classList.remove('hidden'); 
        document.getElementById('modal-pass').value = ''; 
        document.getElementById('modal-pass').focus();
    }
}

export function verifyPassword() { 
    if (document.getElementById('modal-pass').value === "Smart09300") { 
        closePasswordModal(); 
        openForm(pendingRecordToEdit); 
    } else { 
        showToast("Incorrect Password!"); 
    } 
}

export function promptDeleteRecord(record) {
    const recName = record['name'] || record['customer name'] || record['store name'] || "Record";
    openSlideDeleteModal(`Sigurado ka bang nais burahin ang [${recName}]?`, async () => {
        showSideNotification("DELETING RECORD", `Removing ${recName} from database...`, "fa-trash", "text-red-400", "border-red-500");
        try {
            await fetch(API_URL, { 
                method: 'POST', mode: 'no-cors', 
                body: JSON.stringify({ type: globalState.currentType, action: "delete", data: { name: recName } }) 
            });
            setTimeout(() => { syncData(); }, 600);
        } catch(e) {}
    });
}

export function openForm(record) {
    switchView('view-form');
    const isEdit = record !== null; 
    editingRecord = record;
    document.getElementById('edit-warning').classList.toggle('hidden', !isEdit);
    document.getElementById('header-title').innerText = isEdit ? "Edit Record" : "Add New Record";
    document.getElementById('form-name').value = isEdit ? (record['name'] || record['customer name'] || record['store name'] || "") : "";
    document.getElementById('form-contact').value = isEdit ? (record['contact'] || record['phone'] || "") : "";
    document.getElementById('form-address').value = isEdit ? (record['address'] || "") : "";
    document.getElementById('form-latlon').value = isEdit ? (record['lat_lon_link'] || record['lat_lon'] || record['latlon'] || record['coordinates'] || record['map'] || "") : "";
}

export async function submitForm() {
    const name = document.getElementById('form-name').value.trim();
    if (!name) return showToast("Name is required");
    const btn = document.getElementById('form-submit-btn');
    btn.disabled = true; btn.innerText = "SAVING...";

    showSideNotification("SAVING RECORD", `Updating ${name} in database...`, "fa-floppy-disk", "text-green-400", "border-green-500");

    const payload = { 
        type: globalState.currentType, 
        action: editingRecord ? "edit" : "add", 
        data: { 
            name: name, 
            contact: document.getElementById('form-contact').value.trim(), 
            address: document.getElementById('form-address').value.trim(), 
            lat_lon_link: document.getElementById('form-latlon').value.trim(),
            recorded_by: appState.riderName || "Unknown"
        } 
    };
    try {
        await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
        setTimeout(() => { goBack(); openDirectory(globalState.currentType); }, 600);
    } catch (e) { showToast("Network error."); } 
    finally { btn.disabled = false; btn.innerText = "SAVE RECORD"; }
}

function buildAlphabetScrubber() {
    const scrubber = document.getElementById('alphabet-scrubber');
    if (!scrubber) return;
    scrubber.innerHTML = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('').map(letter => 
        `<div data-letter="${letter}" class="scrubber-letter w-6 h-5 flex items-center justify-center text-[10px] rounded-full transition-all duration-100 ${activeFilterLetter === letter ? 'text-blue-400 font-black scale-125' : 'text-gray-400'}">${letter}</div>`
    ).join('');
}

function attachScrubberEvents() {
    const scrubber = document.getElementById('alphabet-scrubber');
    if (!scrubber) return;
    let isDragging = false;
    
    const updateCurve = (touchY) => {
        const letters = scrubber.querySelectorAll('.scrubber-letter');
        const radius = 170; const maxPull = 120;
        let closestLetter = null; let minDistance = Infinity;

        letters.forEach(el => {
            const rect = el.getBoundingClientRect();
            const elCenterY = rect.top + rect.height / 2;
            const distY = Math.abs(elCenterY - touchY);

            if (distY < minDistance) { minDistance = distY; closestLetter = el; }

            if (distY < radius) {
                const factor = Math.cos((distY / radius) * (Math.PI / 2));
                const pullX = -maxPull * factor;
                const scale = 1 + (0.6 * factor);

                el.style.transform = `translateX(${pullX}px) scale(${scale})`;
                
                if (factor > 0.7) {
                    el.style.color = '#60a5fa'; el.style.fontWeight = '900';
                    el.classList.add('bg-blue-600/30', 'border', 'border-blue-400/50', 'shadow-lg');
                } else {
                    el.style.color = '#9ca3af'; el.style.fontWeight = '600';
                    el.classList.remove('bg-blue-600/30', 'border', 'border-blue-400/50', 'shadow-lg');
                }
            } else {
                el.style.transform = 'translateX(0px) scale(1)';
                el.style.color = ''; el.style.fontWeight = '';
                el.classList.remove('bg-blue-600/30', 'border', 'border-blue-400/50', 'shadow-lg');
            }
        });

        if (closestLetter) {
            const letter = closestLetter.getAttribute('data-letter');
            if (letter && activeFilterLetter !== letter) {
                activeFilterLetter = letter;
                document.getElementById('search-input').value = "";
                filterDirectoryRecords();
            }
        }
    };

    const resetCurve = () => {
        const letters = scrubber.querySelectorAll('.scrubber-letter');
        letters.forEach(el => {
            el.style.transition = 'transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            el.style.transform = 'translateX(0px) scale(1)';
            el.style.color = ''; el.style.fontWeight = '';
            el.classList.remove('bg-blue-600/30', 'border', 'border-blue-400/50', 'shadow-lg');
        });
    };

    scrubber.ontouchstart = (e) => {
        isDragging = true;
        const letters = scrubber.querySelectorAll('.scrubber-letter');
        letters.forEach(el => el.style.transition = 'none');
        updateCurve(e.touches[0].clientY);
    };

    scrubber.ontouchmove = (e) => {
        if (!isDragging) return;
        if (e.cancelable) e.preventDefault();
        updateCurve(e.touches[0].clientY);
    };

    scrubber.ontouchend = () => { isDragging = false; resetCurve(); };
    scrubber.ontouchcancel = () => { isDragging = false; resetCurve(); };
}