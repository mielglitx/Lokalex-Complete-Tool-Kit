// src/features/directory/ui/directoryRouting.js
import { appState, globalState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { escapeHtml, copyText } from '../../../utils/helpers.js';
import { renderDirectoryList } from './directoryListRender.js';

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

