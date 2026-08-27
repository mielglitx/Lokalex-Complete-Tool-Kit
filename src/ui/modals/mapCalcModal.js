// src/ui/modals/mapCalcModal.js
import { appState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { showToast } from '../notifications.js';
import { escapeHtml } from '../../utils/helpers.js';

export function formatMapCalcDate(ts) {
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