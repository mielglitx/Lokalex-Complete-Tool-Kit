// src/ui/modals.js
import { appState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { API_URL } from '../config/constants.js';
import { showToast } from './notifications.js';
import { escapeHtml } from '../utils/helpers.js';

let slideDeleteCallback = null;

// ============================================================================
// 1. GCASH DETAILS MANAGEMENT
// ============================================================================
export async function fetchGCashDetails() {
    const riderId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const riderName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    if (!riderId && !riderName) return;

    let foundName = "";
    let foundNo = "";

    // 1. Check Firebase first
    if (db) {
        try {
            const snap = await db.ref('gcash').once('value');
            const data = snap.val();
            if (data) {
                Object.values(data).forEach(item => {
                    const itemTId = (item.telegramId || "").toString().trim();
                    const itemRName = (item.riderName || "").toString().trim().toLowerCase();
                    if ((riderId && itemTId === riderId) || (riderName && itemRName === riderName)) {
                        if (item.gcashName) foundName = item.gcashName;
                        if (item.gcashNo) foundNo = item.gcashNo;
                    }
                });
            }
        } catch(e) {}
    }

    // 2. Fallback check to Google Sheets API
    if (!foundName || !foundNo) {
        try {
            const res = await fetch(`${API_URL}?type=all`);
            if (res.ok) {
                const json = await res.json();
                if (json && json.gcash) {
                    for (let key in json.gcash) {
                        const rec = json.gcash[key];
                        const recTId = (rec.telegramId || "").toString().trim();
                        const recRName = (rec.riderName || "").toString().trim().toLowerCase();
                        if ((riderId && recTId === riderId) || (riderName && recRName === riderName)) {
                            if (rec.gcashName) foundName = rec.gcashName;
                            if (rec.gcashNo) foundNo = rec.gcashNo;
                            break;
                        }
                    }
                }
            }
        } catch(e) {}
    }

    // Restore details to state and local cache
    if (foundName || foundNo) {
        appState.gcashName = foundName;
        appState.gcashNo = foundNo;
        localStorage.setItem('lokalex_gcash_name', foundName);
        localStorage.setItem('lokalex_gcash_no', foundNo);

        const nameInput = document.getElementById('gcash-name-input');
        const noInput = document.getElementById('gcash-no-input');
        if (nameInput) nameInput.value = foundName;
        if (noInput) noInput.value = foundNo;
    }
}

export async function openGCashModal() {
    const modal = document.getElementById('gcash-modal');
    if (modal) {
        const nameInput = document.getElementById('gcash-name-input');
        const noInput = document.getElementById('gcash-no-input');
        
        const localName = appState.gcashName || localStorage.getItem('lokalex_gcash_name') || "";
        const localNo = appState.gcashNo || localStorage.getItem('lokalex_gcash_no') || "";

        if (nameInput) nameInput.value = localName;
        if (noInput) noInput.value = localNo;
        
        modal.classList.remove('hidden');

        // Automatically fetch online records to ensure missing local values populate
        await fetchGCashDetails();
    }
}

export function closeGCashModal() {
    const modal = document.getElementById('gcash-modal');
    if (modal) modal.classList.add('hidden');
}

export function saveGCashDetails() {
    const nameInput = document.getElementById('gcash-name-input');
    const noInput = document.getElementById('gcash-no-input');
    
    const gName = nameInput ? nameInput.value.trim() : "";
    const gNo = noInput ? noInput.value.trim() : "";

    if (!gName || !gNo) {
        showToast("⚠️ Paki-kumpleto ang GCash Name at Number!");
        return;
    }

    openSlideDeleteModal(
        "Confirm GCash Details?",
        `I-drag pakanan para kumpirmahin ang pag-update ng iyong GCash details:\n👤 Name: ${gName}\n📱 Number: ${gNo}`,
        () => {
            executeSaveGCashDetails(gName, gNo);
        }
    );
}

export function executeSaveGCashDetails(gName, gNo) {
    appState.gcashName = gName;
    appState.gcashNo = gNo;

    localStorage.setItem('lokalex_gcash_name', gName);
    localStorage.setItem('lokalex_gcash_no', gNo);

    if (db && appState.telegramId) {
        db.ref('gcash/' + appState.telegramId).set({
            riderName: appState.riderName,
            telegramId: appState.telegramId,
            gcashName: gName,
            gcashNo: gNo,
            updatedAt: Date.now()
        });
    }

    try {
        fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({
                type: "gcash",
                telegramId: appState.telegramId,
                riderName: appState.riderName,
                gcashName: gName,
                gcashNo: gNo
            })
        });
    } catch(e) {}

    closeGCashModal();
    showToast("✅ Na-save na ang iyong GCash Details!");
}

// ============================================================================
// 2. MAP CALCULATION BOARD & LINK GENERATOR LOGIC
// ============================================================================
function formatMapCalcDate(ts) {
    if (!ts) return "N/A";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "N/A";
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

export function openMapCalcBoardModal() {
    const modal = document.getElementById('mapcalc-board-modal');
    if (modal) {
        modal.classList.remove('hidden');
        fetchAndRenderMapCalculations();
    }
}

export function closeMapCalcBoardModal() {
    const modal = document.getElementById('mapcalc-board-modal');
    if (modal) modal.classList.add('hidden');
}

export function promptMapCalcCustomerName() {
    const input = document.getElementById('mapcalc-cust-name-input');
    if (input) input.value = "";
    const modal = document.getElementById('mapcalc-name-modal');
    if (modal) {
        modal.classList.remove('hidden');
        if (input) input.focus();
    }
}

export function closeMapCalcNameModal() {
    const modal = document.getElementById('mapcalc-name-modal');
    if (modal) modal.classList.add('hidden');
}

// GENERATE NEW CALCULATION LINK DIRECTLY TO FIREBASE
export function startMapCalcForCustomer() {
    const input = document.getElementById('mapcalc-cust-name-input');
    const custName = input ? input.value.trim() : "";
    if (!custName) return showToast("⚠️ Please enter customer name.");

    closeMapCalcNameModal();

    const creatorName = appState.riderName || localStorage.getItem('riderName') || "Amiel";

    if (db) {
        const newRef = db.ref('mapCalculations').push();
        const calcId = newRef.key;

        const calcRecord = {
            id: calcId,
            customerName: custName,
            createdBy: creatorName,
            createdAt: Date.now(),
            status: "Awaiting Pin"
        };

        newRef.set(calcRecord).then(() => {
            showToast(`✅ Generated link for ${custName}!`);
            
            appState.mapCalcCustomerName = custName;
            appState.mapCalcId = calcId;

            openMapCalcBoardModal();
            fetchAndRenderMapCalculations();
        }).catch((err) => {
            showToast(`❌ Failed to create link: ${err.message}`);
        });
    } else {
        showToast("⚠️ Database offline.");
    }
}

export function fetchAndRenderMapCalculations() {
    const container = document.getElementById('mapcalc-list-container');
    if (!container) return;

    const topButtonHtml = `
    <button onclick="window.promptMapCalcCustomerName && window.promptMapCalcCustomerName()" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-lg transition active:scale-95 mb-3">
        <i class="fa-solid fa-circle-plus"></i> + Generate Link
    </button>`;

    if (!db) {
        container.innerHTML = topButtonHtml + `<div class="text-center text-gray-500 italic py-10 text-xs">Database connection missing.</div>`;
        return;
    }

    db.ref('mapCalculations').on('value', (snapshot) => {
        const data = snapshot.val();

        if (!data) {
            container.innerHTML = topButtonHtml + `<div class="text-center text-gray-500 italic py-10 text-xs">No active calculations recorded.</div>`;
            return;
        }

        const list = Object.entries(data).map(([id, val]) => ({ id, ...val }));
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        if (list.length === 0) {
            container.innerHTML = topButtonHtml + `<div class="text-center text-gray-500 italic py-10 text-xs">No active calculations recorded.</div>`;
            return;
        }

        const cardsHtml = list.map(item => {
            const custName = item.customerName || item.custName || item.name || "Customer";
            const creator = item.createdBy || item.riderName || "Amiel";
            const formattedDate = formatMapCalcDate(item.createdAt);

            const hasPin = !!(item.lat && item.lng) || !!item.pinSaved || !!item.mapLink || !!item.lat_lon_link;
            const lat = item.lat || item.latitude || "";
            const lng = item.lng || item.longitude || "";

            const rawLink = item.mapLink || item.lat_lon_link || (lat && lng ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : `${window.location.origin}/?mapcalc=${item.id}`);

            let statusAndActions = '';

            if (hasPin) {
                statusAndActions = `
                <div class="flex flex-wrap items-center justify-between gap-2 border-t border-gray-800/60 pt-2.5 mt-1">
                    <span class="bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 px-2.5 py-1 rounded-xl text-[10px] font-bold flex items-center gap-1">
                        <i class="fa-solid fa-location-dot"></i> Pin Saved
                    </span>
                    <div class="flex items-center gap-1.5">
                        <button onclick="event.stopPropagation(); window.copyMapCalcLink && window.copyMapCalcLink('${item.id}', '${escapeHtml(rawLink)}', '${escapeHtml(custName)}')" class="bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1 transition active:scale-95 shadow">
                            <i class="fa-solid fa-link"></i> Copy Link
                        </button>
                        <button onclick="event.stopPropagation(); window.viewMapCalcRoute && window.viewMapCalcRoute('${item.id}', '${lat}', '${lng}')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1 transition active:scale-95 shadow">
                            <i class="fa-solid fa-route"></i> View Route & Distance
                        </button>
                    </div>
                </div>`;
            } else {
                statusAndActions = `
                <div class="flex flex-wrap items-center justify-between gap-2 border-t border-gray-800/60 pt-2.5 mt-1">
                    <span class="bg-amber-500/20 text-amber-400 border border-amber-500/40 px-2.5 py-1 rounded-xl text-[10px] font-bold flex items-center gap-1">
                        <i class="fa-solid fa-hourglass-half"></i> Awaiting Pin
                    </span>
                    <div class="flex items-center gap-2">
                        <button onclick="event.stopPropagation(); window.copyMapCalcLink && window.copyMapCalcLink('${item.id}', '${escapeHtml(rawLink)}', '${escapeHtml(custName)}')" class="bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1.5 rounded-xl text-[10px] font-bold flex items-center gap-1 transition active:scale-95 shadow">
                            <i class="fa-solid fa-link"></i> Copy Link
                        </button>
                        <span class="text-[10px] text-gray-500 italic">No pin captured yet</span>
                    </div>
                </div>`;
            }

            return `
            <div class="bg-black/30 border border-gray-800/80 p-3.5 rounded-2xl flex flex-col gap-1.5 text-xs shadow-md">
                <div class="flex justify-between items-center">
                    <span class="font-bold text-sm text-white flex items-center gap-2">
                        <i class="fa-solid fa-user text-blue-400 text-xs"></i> ${escapeHtml(custName)}
                    </span>
                    <button onclick="event.stopPropagation(); window.deleteMapCalculation && window.deleteMapCalculation('${item.id}')" class="text-red-400 hover:text-red-300 p-1 text-xs transition active:scale-90" title="Delete Entry">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
                <div class="text-[11px] text-gray-400 font-mono">
                    Created by: <span class="text-gray-300 font-medium">${escapeHtml(creator)}</span> • ${formattedDate}
                </div>
                ${statusAndActions}
            </div>`;
        }).join('');

        container.innerHTML = topButtonHtml + `<div class="flex flex-col gap-2.5">${cardsHtml}</div>`;
    });
}

export function copyMapCalcLink(id, rawLink, customerName = "") {
    const targetLink = rawLink || `${window.location.origin}/?mapcalc=${id}`;
    const nameGreeting = customerName ? `Magandang araw po ${customerName}! 👋` : `Magandang araw po! 👋`;
    
    const statement = `${nameGreeting}\n\nIn order for us to calculate your accurate location and delivery fee please click on the link and follow the instructions on the next screen, you can also copy the link below and use google chrome to open the link. please do not use safari:\n\n${targetLink}\n\n⚠️ PAALALA:\nKung binuksan nyo po sa Messenger, paki-pindot ang 3 dots (...) sa itaas at piliin ang "Open in Chrome". Maraming salamat po! 🫡💙`;

    if (navigator.clipboard) {
        navigator.clipboard.writeText(statement).then(() => {
            showToast("📋 Original message template copied!");
        }).catch(() => {
            showToast("📋 Copied message!");
        });
    } else {
        showToast("📋 Copied message!");
    }
}

export function viewMapCalcRoute(id, lat, lng) {
    if (lat && lng) {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
    } else {
        showToast("⚠️ Pin coordinates missing for this calculation.");
    }
}

export function deleteMapCalculation(key) {
    if (db && key) {
        db.ref('mapCalculations/' + key).remove()
            .then(() => showToast("🗑️ Map calculation removed."))
            .catch(() => showToast("❌ Failed to delete record."));
    }
}

export function dismissQueueAlarm() {
    const modal = document.getElementById('first-in-line-modal') || document.getElementById('first-line-modal');
    if (modal) modal.classList.add('hidden');
    
    if (window.setLineAlarmConfirmed && typeof window.setLineAlarmConfirmed === 'function') {
        window.setLineAlarmConfirmed(true);
    }
    if (window.stopLineAlarm && typeof window.stopLineAlarm === 'function') {
        window.stopLineAlarm();
    }
}

// ============================================================================
// 3. SYSTEM UTILITY MODALS
// ============================================================================
export function openSampleReceiptModal() {
    const modal = document.getElementById('sample-receipt-modal');
    if (modal) modal.classList.remove('hidden');
}

export function closeSampleReceiptModal() {
    const modal = document.getElementById('sample-receipt-modal');
    if (modal) modal.classList.add('hidden');
    const input = document.getElementById('rcpt-name');
    if (input) {
        input.disabled = false;
        input.focus();
    }
    const manualToggle = document.getElementById('manual-client-toggle');
    if (manualToggle) manualToggle.checked = true;
}

export function openAdvancedOrdersModal() {
    const modal = document.getElementById('adv-orders-modal');
    if (modal) modal.classList.remove('hidden');
}

export function closeAdvancedOrdersModal() {
    const modal = document.getElementById('adv-orders-modal');
    if (modal) modal.classList.add('hidden');
}

export function showGpsRequiredModal() {
    const modal = document.getElementById('gps-alert-modal');
    if (modal) modal.classList.remove('hidden');
}

export function closeGpsModal() {
    const modal = document.getElementById('gps-alert-modal');
    if (modal) modal.classList.add('hidden');
}

export function closeCateringModal() {
    const modal = document.getElementById('catering-modal');
    if (modal) modal.classList.add('hidden');
}

export function closeAdminCateringModal() {
    const modal = document.getElementById('admin-catering-modal');
    if (modal) modal.classList.add('hidden');
}

export function openPasswordModal() {
    const modal = document.getElementById('password-modal');
    if (modal) modal.classList.remove('hidden');
    const passInput = document.getElementById('modal-pass');
    if (passInput) {
        passInput.value = ''; 
        passInput.focus();
    }
}

export function closePasswordModal() { 
    const modal = document.getElementById('password-modal');
    if (modal) modal.classList.add('hidden'); 
}

export function showBulkAddModal() { 
    const modal = document.getElementById('bulk-modal');
    if (modal) modal.classList.remove('hidden'); 
    const input = document.getElementById('bulk-input');
    if (input) {
        input.value = ""; 
        input.focus(); 
    }
}

export function closeBulkModal() { 
    const modal = document.getElementById('bulk-modal');
    if (modal) modal.classList.add('hidden'); 
}

export function closeEditItemModal() { 
    const modal = document.getElementById('edit-item-modal');
    if (modal) modal.classList.add('hidden'); 
}

export function openSlideDeleteModal(title, arg2, arg3) {
    let subtitle = "I-drag pakanan ang slider para kumpirmahin.";
    let callback = null;

    if (typeof arg2 === 'function') {
        callback = arg2;
    } else if (typeof arg2 === 'string') {
        subtitle = arg2;
        if (typeof arg3 === 'function') {
            callback = arg3;
        }
    }

    const titleEl = document.getElementById('slide-delete-title');
    const subEl = document.getElementById('slide-delete-sub');
    const rangeEl = document.getElementById('slide-delete-range');

    if (titleEl) titleEl.innerText = title;
    if (subEl) subEl.innerText = subtitle;
    if (rangeEl) rangeEl.value = 0;

    slideDeleteCallback = callback;
    const modal = document.getElementById('slide-delete-modal');
    if (modal) modal.classList.remove('hidden');
}

export function closeSlideDeleteModal() {
    const modal = document.getElementById('slide-delete-modal');
    if (modal) modal.classList.add('hidden');
    slideDeleteCallback = null;
}

export function onSlideProgress(val) {
    if (val >= 90) {
        const rangeEl = document.getElementById('slide-delete-range');
        if (rangeEl) rangeEl.value = 100;
        
        if (slideDeleteCallback && typeof slideDeleteCallback === 'function') {
            let cb = slideDeleteCallback;
            closeSlideDeleteModal();
            cb();
        }
    }
}

export function onSlideEnd() {
    const range = document.getElementById('slide-delete-range');
    if (range && range.value < 90) { 
        range.value = 0; 
    }
}

// ============================================================================
// 4. GLOBAL WINDOW ATTACHMENTS
// ============================================================================
if (typeof window !== 'undefined') {
    window.fetchGCashDetails = fetchGCashDetails;
    window.openGCashModal = openGCashModal;
    window.closeGCashModal = closeGCashModal;
    window.saveGCashDetails = saveGCashDetails;
    window.executeSaveGCashDetails = executeSaveGCashDetails;
    window.fetchAndRenderMapCalculations = fetchAndRenderMapCalculations;
    window.copyMapCalcLink = copyMapCalcLink;
    window.viewMapCalcRoute = viewMapCalcRoute;
    window.deleteMapCalculation = deleteMapCalculation;
    window.startMapCalcForCustomer = startMapCalcForCustomer;
    window.openMapCalcBoardModal = openMapCalcBoardModal;
    window.closeMapCalcBoardModal = closeMapCalcBoardModal;
    window.promptMapCalcCustomerName = promptMapCalcCustomerName;
    window.closeMapCalcNameModal = closeMapCalcNameModal;
    window.dismissQueueAlarm = dismissQueueAlarm;
    window.openSampleReceiptModal = openSampleReceiptModal;
    window.closeSampleReceiptModal = closeSampleReceiptModal;
    window.openAdvancedOrdersModal = openAdvancedOrdersModal;
    window.closeAdvancedOrdersModal = closeAdvancedOrdersModal;
    window.showGpsRequiredModal = showGpsRequiredModal;
    window.closeGpsModal = closeGpsModal;
    window.closeCateringModal = closeCateringModal;
    window.closeAdminCateringModal = closeAdminCateringModal;
    window.openPasswordModal = openPasswordModal;
    window.closePasswordModal = closePasswordModal;
    window.showBulkAddModal = showBulkAddModal;
    window.closeBulkModal = closeBulkModal;
    window.closeEditItemModal = closeEditItemModal;
    window.openSlideDeleteModal = openSlideDeleteModal;
    window.closeSlideDeleteModal = closeSlideDeleteModal;
    window.onSlideProgress = onSlideProgress;
    window.onSlideEnd = onSlideEnd;
}