// src/features/directory/ui/directoryRouting.js
import { appState, globalState } from '../../../store/state.js';
import { showToast, showSideNotification } from '../../../ui/notifications.js';
import { escapeHtml, copyText } from '../../../utils/helpers.js';
import { renderDirectoryList } from './directoryListRender.js';
import { BARANGAY_DATA } from '../../../config/constants.js';
import { idbGet } from '../../../utils/storageEngine.js';

let hasAttemptedGpsAutoSelect = false;

export const MUNICIPALITY_COORDINATES = {
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
            }
        }
    };

    if (globalState.selectedDestinationMun) {
        return;
    }

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

    const hubLabel = selectedHub === "ALL" ? "All Starting Hubs" : `${selectedHub} Hub`;
    showToast(`📍 Filtered rates from: ${hubLabel}`);
}

export function handleDestinationChange(selectedMun) {
    globalState.selectedDestinationMun = selectedMun || "ALL";
    try {
        localStorage.setItem('lokalex_selected_destination_mun', globalState.selectedDestinationMun);
    } catch(e) {}

    renderDirectoryList();

    const destLabel = selectedMun === "ALL" ? "All Destinations" : `${selectedMun}`;
    showToast(`🎯 Destination: ${destLabel}`);
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

/**
 * ============================================================================
 * CHAT DELIVERY FARE RATE PICKER & INSTANT SENDER
 * ============================================================================
 */

export function formatFareRateMessage(barangayName, rawRate, destinationMun = "Camiling", originMun = "Camiling") {
    let rateNum = parseFloat((rawRate || "").toString().replace(/[^0-9.]/g, ''));
    let amountStr = !isNaN(rateNum) ? rateNum.toFixed(0) : (rawRate || '0').toString().replace(/[^0-9.]/g, '');

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

    return `${firstLine}\n\n(Note: Other fees may apply for additional stores or extra services!)\n\nYou may view our fee guidelines by visiting this google document link:\n\nhttps://docs.google.com/document/d/1CPUE5gx6JZqcZoRcU-OEOWWgUCLyZhF6WnWRbLTnVus/edit?usp=drivesdk`;
}

function getOrCreateChatFareRatePickerModal() {
    let modal = document.getElementById('chat-fare-rate-picker-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'chat-fare-rate-picker-modal';
        modal.className = 'fixed inset-0 z-[1000005] flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 hidden';
        modal.style.zIndex = '1000005';
        modal.innerHTML = `
        <div class="bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-800 rounded-3xl max-w-sm sm:max-w-md w-full max-h-[85vh] shadow-2xl flex flex-col overflow-hidden animate-scaleUp">
            <!-- Header -->
            <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800/80 bg-gray-50/70 dark:bg-black/30">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-9 h-9 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-sm font-bold shrink-0 shadow-2xs border border-emerald-500/20">
                        <i class="fa-solid fa-peso-sign"></i>
                    </div>
                    <div class="min-w-0">
                        <h3 class="font-black text-xs sm:text-sm text-gray-900 dark:text-white truncate">Delivery Fare Rates</h3>
                        <p id="chat-rate-picker-subtitle" class="text-[10px] text-gray-500 dark:text-gray-400 truncate">Pick a barangay rate to send</p>
                    </div>
                </div>
                <button type="button" onclick="window.closeFareRatePickerFromChat && window.closeFareRatePickerFromChat()" class="w-7 h-7 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center justify-center text-xs transition active:scale-95 cursor-pointer">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <!-- Filter Controls (Origin Hub + Destination Municipality) -->
            <div class="px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-black/20 flex flex-col gap-2">
                <div class="grid grid-cols-2 gap-2 text-[11px]">
                    <div class="flex flex-col gap-0.5 min-w-0">
                        <label class="text-[9.5px] font-bold text-amber-500 uppercase tracking-wider truncate flex items-center gap-1">
                            <i class="fa-solid fa-location-crosshairs text-[8.5px]"></i> Origin Hub
                        </label>
                        <select id="chat-rate-picker-origin" onchange="window.filterChatFareRatePicker && window.filterChatFareRatePicker()" class="w-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-2 py-1.5 text-xs text-gray-900 dark:text-white outline-none focus:border-emerald-500 cursor-pointer font-bold">
                            <option value="Camiling">Camiling</option>
                            <option value="San Clemente">San Clemente</option>
                            <option value="Santa Ignacia">Santa Ignacia</option>
                            <option value="Paniqui">Paniqui</option>
                            <option value="Mayantoc">Mayantoc</option>
                            <option value="Moncada">Moncada</option>
                            <option value="Gerona">Gerona</option>
                            <option value="Bayambang">Bayambang</option>
                            <option value="Mangatarem">Mangatarem</option>
                            <option value="ALL">All Origins</option>
                        </select>
                    </div>
                    <div class="flex flex-col gap-0.5 min-w-0">
                        <label class="text-[9.5px] font-bold text-emerald-500 uppercase tracking-wider truncate flex items-center gap-1">
                            <i class="fa-solid fa-map-pin text-[8.5px]"></i> Destination
                        </label>
                        <select id="chat-rate-picker-destination" onchange="window.filterChatFareRatePicker && window.filterChatFareRatePicker()" class="w-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-2 py-1.5 text-xs text-gray-900 dark:text-white outline-none focus:border-emerald-500 cursor-pointer font-bold">
                            <option value="ALL">All Destinations</option>
                        </select>
                    </div>
                </div>

                <!-- Search Bar -->
                <div class="relative flex items-center">
                    <i class="fa-solid fa-magnifying-glass absolute left-3 text-gray-400 text-xs"></i>
                    <input type="text" id="chat-rate-picker-search" placeholder="Search barangay name or destination..." oninput="window.filterChatFareRatePicker && window.filterChatFareRatePicker()" class="w-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 dark:text-white outline-none focus:border-emerald-500">
                </div>
            </div>

            <!-- Rates List Body -->
            <div id="chat-rate-picker-list" class="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2 max-h-[52vh]">
                <div class="text-center text-gray-400 text-xs py-8 italic">Loading fare rates...</div>
            </div>
        </div>`;
        document.body.appendChild(modal);
    }
    return modal;
}

export function openFareRatePickerFromChat() {
    const modal = getOrCreateChatFareRatePickerModal();
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    modal.style.zIndex = '1000005';

    const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";
    const subtitle = document.getElementById('chat-rate-picker-subtitle');
    if (subtitle) {
        subtitle.innerHTML = `Sending rate to <strong class="text-emerald-600 dark:text-emerald-400">${escapeHtml(custName)}</strong>`;
    }

    const originSelect = document.getElementById('chat-rate-picker-origin');
    if (originSelect) {
        originSelect.value = globalState.selectedOriginHub || "Camiling";
    }

    const searchInput = document.getElementById('chat-rate-picker-search');
    if (searchInput) searchInput.value = "";

    modal.classList.remove('hidden');
    renderChatFareRatePicker();
}

export function closeFareRatePickerFromChat() {
    const modal = document.getElementById('chat-fare-rate-picker-modal');
    if (modal) modal.classList.add('hidden');
}

export function filterChatFareRatePicker() {
    renderChatFareRatePicker();
}

export async function renderChatFareRatePicker() {
    const container = document.getElementById('chat-rate-picker-list');
    const destSelect = document.getElementById('chat-rate-picker-destination');
    const originSelect = document.getElementById('chat-rate-picker-origin');
    const searchInput = document.getElementById('chat-rate-picker-search');
    if (!container) return;

    let records = [];
    if (globalState.records && Array.isArray(globalState.records)) {
        records = globalState.records.filter(r => (r.type || 'customers') === 'barangays');
    }

    if (records.length === 0) {
        try {
            const cached = await idbGet('directory', 'all_directory_records');
            if (cached && Array.isArray(cached)) {
                records = cached.filter(r => (r.type || 'customers') === 'barangays');
            }
        } catch(e) {}
    }

    if (records.length === 0) {
        try {
            const raw = localStorage.getItem('lokalex_directory_cache_v2');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    records = parsed.filter(r => (r.type || 'customers') === 'barangays');
                }
            }
        } catch(e) {}
    }

    // Always ensure default constants are present
    if (records.length === 0 && Array.isArray(BARANGAY_DATA)) {
        records = BARANGAY_DATA.map(b => ({
            name: b.name,
            barangay: b.name,
            originMunicipality: 'Camiling',
            municipality: 'Camiling',
            rate: `₱${b.fee}`
        }));
    }

    // Populate Destination Dropdown if needed
    if (destSelect) {
        const munSet = new Set();
        records.forEach(r => {
            const d = (r.municipality || "Camiling").trim();
            if (d) munSet.add(d.charAt(0).toUpperCase() + d.slice(1));
        });
        const currentVal = destSelect.value || globalState.selectedDestinationMun || "ALL";
        const sortedMuns = Array.from(munSet).sort((a, b) => a.localeCompare(b));
        
        let destHtml = `<option value="ALL">🌐 All Destinations</option>`;
        sortedMuns.forEach(m => {
            destHtml += `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`;
        });
        destSelect.innerHTML = destHtml;
        destSelect.value = sortedMuns.includes(currentVal) ? currentVal : "ALL";
    }

    const selectedOrigin = originSelect ? originSelect.value : "Camiling";
    const selectedDest = destSelect ? destSelect.value : "ALL";
    const searchQuery = (searchInput ? searchInput.value : "").trim().toLowerCase();

    // Filter records
    const filtered = records.filter(r => {
        const rOrigin = (r.originMunicipality || "Camiling").trim().toLowerCase();
        const rDest = (r.municipality || "Camiling").trim().toLowerCase();
        const rBrgy = (r.barangay || r.name || "").trim().toLowerCase();

        if (selectedOrigin !== "ALL" && rOrigin !== selectedOrigin.toLowerCase()) {
            return false;
        }

        if (selectedDest !== "ALL" && rDest !== selectedDest.toLowerCase()) {
            return false;
        }

        if (searchQuery) {
            const matchName = rBrgy.includes(searchQuery);
            const matchDest = rDest.includes(searchQuery);
            const matchOrigin = rOrigin.includes(searchQuery);
            if (!matchName && !matchDest && !matchOrigin) return false;
        }

        return true;
    });

    // Deduplicate by origin + destination + barangay
    const seen = new Set();
    const unique = [];
    filtered.forEach(r => {
        const rOrigin = (r.originMunicipality || "Camiling").trim();
        const rDest = (r.municipality || "Camiling").trim();
        const rBrgy = (r.barangay || r.name || "").trim();
        const key = `${rOrigin.toLowerCase()}_${rDest.toLowerCase()}_${rBrgy.toLowerCase()}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(r);
        }
    });

    // Sort alphabetically by destination then barangay
    unique.sort((a, b) => {
        const destA = (a.municipality || "Camiling").trim();
        const destB = (b.municipality || "Camiling").trim();
        if (destA !== destB) return destA.localeCompare(destB);
        return (a.barangay || a.name || "").localeCompare(b.barangay || b.name || "");
    });

    if (unique.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-400 text-xs py-8 italic">No fare rates found matching filter.</div>`;
        return;
    }

    container.innerHTML = unique.map(r => {
        const brgy = (r.barangay || r.name || "Barangay").trim();
        const destMun = (r.municipality || "Camiling").trim();
        const originMun = (r.originMunicipality || "Camiling").trim();
        let rateNum = parseFloat((r.rate || r.address || "0").toString().replace(/[^0-9.]/g, ''));
        let amountStr = !isNaN(rateNum) ? rateNum.toFixed(0) : (r.rate || '0').toString().replace(/[^0-9.]/g, '');

        const safeBrgy = escapeHtml(brgy);
        const safeDest = escapeHtml(destMun);
        const safeOrigin = escapeHtml(originMun);

        return `
        <div class="p-2.5 rounded-2xl bg-gray-50/80 hover:bg-gray-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 border border-gray-200 dark:border-zinc-700/60 flex items-center justify-between gap-2 shadow-2xs transition">
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="font-bold text-xs text-gray-900 dark:text-white truncate">${safeBrgy}</span>
                    <span class="text-[10px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-500/30 font-mono shrink-0">₱${amountStr}</span>
                </div>
                <div class="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5 truncate">
                    <i class="fa-solid fa-location-arrow text-amber-500 text-[8.5px]"></i>
                    <span class="truncate">${safeOrigin}</span>
                    <i class="fa-solid fa-arrow-right text-[7.5px] opacity-60"></i>
                    <span class="font-semibold text-gray-700 dark:text-gray-300 truncate">${safeDest}</span>
                </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
                <button type="button" 
                    onclick="window.insertFareRateToChatInput && window.insertFareRateToChatInput('${safeBrgy}', '${amountStr}', '${safeDest}', '${safeOrigin}')" 
                    class="bg-gray-100 hover:bg-gray-200 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-gray-700 dark:text-gray-200 text-[10px] font-bold px-2 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 cursor-pointer border border-gray-200 dark:border-zinc-600" title="Insert into chat box">
                    <i class="fa-solid fa-pen-to-square text-[9px]"></i> Insert
                </button>
                <button type="button" 
                    onclick="window.quickSendFareRateToActiveChat && window.quickSendFareRateToActiveChat('${safeBrgy}', '${amountStr}', '${safeDest}', '${safeOrigin}')" 
                    class="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 shadow-sm cursor-pointer" title="Directly send to customer">
                    <i class="fa-solid fa-paper-plane text-[9px]"></i> Send
                </button>
            </div>
        </div>`;
    }).join('');
}

function getOrCreateFareRateSendConfirmModal() {
    let modal = document.getElementById('fare-rate-send-confirm-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'fare-rate-send-confirm-modal';
        modal.className = 'fixed inset-0 z-[1000030] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 hidden';
        modal.style.zIndex = '1000030';
        modal.innerHTML = `
        <div class="bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-800 rounded-3xl max-w-sm w-full p-5 shadow-2xl flex flex-col gap-4 animate-scaleUp">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-base font-bold shrink-0 border border-emerald-500/20">
                    <i class="fa-solid fa-paper-plane"></i>
                </div>
                <div class="min-w-0">
                    <h4 class="font-black text-sm text-gray-900 dark:text-white">Send Delivery Fare Rate?</h4>
                    <p class="text-xs text-gray-500 dark:text-gray-400">Confirm delivery fee message</p>
                </div>
            </div>

            <div class="p-3 bg-emerald-50/60 dark:bg-emerald-950/20 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 text-xs flex flex-col gap-1.5">
                <div class="flex justify-between items-center">
                    <span class="text-gray-500 dark:text-gray-400">Destination:</span>
                    <span id="rate-confirm-dest" class="font-bold text-gray-900 dark:text-white truncate max-w-[180px]"></span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-gray-500 dark:text-gray-400">Starting Fee:</span>
                    <span id="rate-confirm-amount" class="font-black text-emerald-600 dark:text-emerald-400 font-mono text-sm"></span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-gray-500 dark:text-gray-400">Recipient:</span>
                    <span id="rate-confirm-cust" class="font-bold text-gray-900 dark:text-white truncate max-w-[180px]"></span>
                </div>
            </div>

            <div class="flex items-center justify-end gap-2 pt-1">
                <button id="rate-confirm-cancel-btn" type="button" class="px-3.5 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-300 font-bold text-xs transition active:scale-95 cursor-pointer">
                    Cancel
                </button>
                <button id="rate-confirm-proceed-btn" type="button" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition active:scale-95 flex items-center gap-1.5 shadow-sm cursor-pointer">
                    <i class="fa-solid fa-paper-plane text-xs"></i> Send Rate
                </button>
            </div>
        </div>`;
        document.body.appendChild(modal);
    }
    return modal;
}

export function askFareRateSendConfirmation({ barangay = "", destMun = "", originMun = "", amount = "0", custName = "Customer" }) {
    return new Promise((resolve) => {
        const modal = getOrCreateFareRateSendConfirmModal();
        if (modal.parentElement !== document.body) document.body.appendChild(modal);
        modal.style.zIndex = '1000030';

        const destEl = document.getElementById('rate-confirm-dest');
        const amountEl = document.getElementById('rate-confirm-amount');
        const custEl = document.getElementById('rate-confirm-cust');
        const cancelBtn = document.getElementById('rate-confirm-cancel-btn');
        const proceedBtn = document.getElementById('rate-confirm-proceed-btn');

        if (destEl) destEl.innerText = `${barangay}, ${destMun}`;
        if (amountEl) amountEl.innerText = `₱${amount}`;
        if (custEl) custEl.innerText = custName || "Customer";

        const cleanup = (result) => {
            modal.classList.add('hidden');
            if (cancelBtn) cancelBtn.onclick = null;
            if (proceedBtn) proceedBtn.onclick = null;
            resolve(result);
        };

        if (cancelBtn) cancelBtn.onclick = () => cleanup(false);
        if (proceedBtn) proceedBtn.onclick = () => cleanup(true);

        modal.classList.remove('hidden');
    });
}

export async function quickSendFareRateToActiveChat(barangay, rawAmount, destMun, originMun) {
    const chatModal = document.getElementById('rider-chat-modal');
    const isChatOpen = chatModal && !chatModal.classList.contains('hidden');
    const activeCustId = (typeof window.getActiveRiderChatCustId === 'function') 
        ? window.getActiveRiderChatCustId() 
        : window.activeRiderChatCustId;
    const validCustId = (activeCustId && activeCustId !== 'undefined' && activeCustId !== 'null') ? String(activeCustId).trim() : null;
    const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";

    if (!isChatOpen || !validCustId) {
        showToast("⚠️ Chat is not active. Please open a customer chat first.");
        return;
    }

    const confirmed = await askFareRateSendConfirmation({
        barangay,
        destMun,
        originMun,
        amount: rawAmount,
        custName
    });
    if (!confirmed) return;

    const formattedMessage = formatFareRateMessage(barangay, rawAmount, destMun, originMun);

    if (typeof window.sendRiderToCustomerChat === 'function') {
        await window.sendRiderToCustomerChat(formattedMessage, null, null, validCustId);
    }

    closeFareRatePickerFromChat();
    showToast(`✅ Delivery fare rate for ${barangay} sent to ${custName}!`);
}

export function insertFareRateToChatInput(barangay, rawAmount, destMun, originMun) {
    const formattedMessage = formatFareRateMessage(barangay, rawAmount, destMun, originMun);
    const input = document.getElementById('rider-chat-input');
    if (input) {
        input.value = formattedMessage;
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        input.focus();
        if (typeof window.handleRiderChatInputDraft === 'function') {
            window.handleRiderChatInputDraft(input.value);
        }
    }
    closeFareRatePickerFromChat();
    showToast(`📋 Fare rate for ${barangay} inserted into chat!`);
}

// Global attachments
if (typeof window !== 'undefined') {
    window.openFareRatePickerFromChat = openFareRatePickerFromChat;
    window.closeFareRatePickerFromChat = closeFareRatePickerFromChat;
    window.filterChatFareRatePicker = filterChatFareRatePicker;
    window.renderChatFareRatePicker = renderChatFareRatePicker;
    window.quickSendFareRateToActiveChat = quickSendFareRateToActiveChat;
    window.insertFareRateToChatInput = insertFareRateToChatInput;
    window.formatFareRateMessage = formatFareRateMessage;
    window.copyBarangayRate = copyBarangayRate;
}

