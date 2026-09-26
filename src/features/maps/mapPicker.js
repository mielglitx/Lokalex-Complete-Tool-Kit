// src/features/maps/mapPicker.js

/**
 * ============================================================================
 * LEAFLET & OPENSTREETMAP COORDINATE PICKER MODULE
 * ============================================================================
 * 
 * Description:
 * Interactive location selector and coordinate calibration tool powered by Leaflet:
 * - Persistent Center Reticle: High-z-index precision crosshairs locked to the
 *   exact viewport center that never disappears under loading map tiles.
 * - Interactive Manual Pin Drop: Allows users to tap anywhere on the map to drop
 *   or drag a custom pin.
 * - Two-Tier Capture Hierarchy: Captures manual pin coordinates first if placed;
 *   otherwise falls back to capturing the exact center reticle coordinates.
 * - Dynamic Nominatim geocoding search for Philippine addresses and landmarks.
 * - Integrates with Form fields, Customer Chat, Rider Chat, and Registration.
 * ============================================================================
 */

import { appState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { HUB_LOCATION } from '../../config/constants.js';
import { showToast } from '../../ui/notifications.js';
import { switchView, goBack } from '../../ui/router.js';
import { getDeviceLocation } from '../auth/index.js';
import { sendCustomerToRiderChat, sendRiderToCustomerChat } from '../chat/index.js';
import { 
    mapState, 
    ensureLeafletLoaded, 
    searchNominatimPlaces 
} from './mapState.js';

let nominatimSearchTimeout = null;

/**
 * Creates custom styled HTML pin icons for Leaflet manual marker.
 */
function createManualPinIcon() {
    const html = `
        <div style="position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; transform: translate(0, -50%); cursor: grab;">
            <div style="background-color: #EF4444; width: 34px; height: 34px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5); border: 2.5px solid white;">
                <i class="fa-solid fa-location-dot" style="font-size: 15px; color: white; transform: rotate(45deg);"></i>
            </div>
            <div style="width: 8px; height: 8px; background: rgba(0,0,0,0.4); border-radius: 50%; filter: blur(1px); margin-top: 2px;"></div>
        </div>
    `;

    return window.L.divIcon({
        className: 'custom-manual-pin-icon',
        html: html,
        iconSize: [34, 42],
        iconAnchor: [17, 38],
        popupAnchor: [0, -38]
    });
}

/**
 * Injects or updates a persistent center reticle crosshair overlay on the map container.
 */
function ensureCenterReticleOverlay(container) {
    if (!container) return;

    let reticle = document.getElementById('map-persistent-center-reticle');
    if (!reticle) {
        reticle = document.createElement('div');
        reticle.id = 'map-persistent-center-reticle';
        reticle.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 1000;
            pointer-events: none;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 44px;
            height: 44px;
        `;

        reticle.innerHTML = `
            <div style="position: relative; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
                <div style="position: absolute; width: 36px; height: 36px; border: 2px solid rgba(59, 130, 246, 0.85); border-radius: 50%; box-shadow: 0 0 10px rgba(59, 130, 246, 0.5), inset 0 0 6px rgba(59, 130, 246, 0.3);"></div>
                <div style="position: absolute; width: 14px; height: 2px; background: #3B82F6; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>
                <div style="position: absolute; height: 14px; width: 2px; background: #3B82F6; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>
                <div style="position: absolute; width: 6px; height: 6px; background: #EF4444; border-radius: 50%; border: 1.5px solid white; box-shadow: 0 0 5px rgba(239, 68, 68, 0.9);"></div>
            </div>
        `;
        container.style.position = 'relative';
        container.appendChild(reticle);
    }

    reticle.classList.remove('hidden');
}

/**
 * Injects or updates an interactive status bar on top of the map showing
 * which capture target (Manual Pin vs. Center Reticle) is active.
 */
function updatePinStatusOverlay(container) {
    if (!container) return;

    let banner = document.getElementById('map-pin-mode-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'map-pin-mode-banner';
        banner.style.cssText = `
            position: absolute;
            bottom: 24px;
            left: 12px;
            right: 12px;
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(15, 23, 42, 0.92);
            border: 1px solid rgba(59, 130, 246, 0.4);
            border-radius: 14px;
            padding: 8px 12px;
            color: white;
            font-size: 11px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.6);
            backdrop-filter: blur(8px);
        `;
        container.appendChild(banner);
    }

    if (mapState.isManualPinPlaced && mapState.manualPinCoords) {
        banner.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <span style="background: rgba(239, 68, 68, 0.2); color: #F87171; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; padding: 2px 6px; font-weight: 800; font-size: 10px;">PIN PLACED</span>
                <span style="font-family: monospace; font-size: 11px; color: #E2E8F0; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                    ${mapState.manualPinCoords.lat.toFixed(5)}, ${mapState.manualPinCoords.lng.toFixed(5)}
                </span>
            </div>
            <button type="button" onclick="window.clearManualPin && window.clearManualPin()" style="background: rgba(239, 68, 68, 0.85); hover:background: #DC2626; color: white; border: none; border-radius: 8px; padding: 4px 8px; font-weight: 700; font-size: 10px; cursor: pointer; transition: all 0.2s;" title="Remove placed pin and revert to map center">
                <i class="fa-solid fa-xmark"></i> Clear
            </button>
        `;
    } else {
        banner.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <span style="background: rgba(59, 130, 246, 0.2); color: #60A5FA; border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 6px; padding: 2px 6px; font-weight: 800; font-size: 10px;">CENTER RETICLE</span>
                <span style="font-size: 11px; color: #CBD5E1;">Pan map to target, or tap anywhere to drop pin</span>
            </div>
            <div style="font-size: 9px; color: #94A3B8; font-style: italic;">Auto-center</div>
        `;
    }

    banner.classList.remove('hidden');
}

/**
 * Places or relocates the draggable manual pin on the map.
 */
export function placeManualPin(lat, lng) {
    if (!mapState.leafletMapObj || !window.L) return;

    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    if (isNaN(numLat) || isNaN(numLng)) return;

    mapState.manualPinCoords = { lat: numLat, lng: numLng };
    mapState.isManualPinPlaced = true;

    if (!mapState.manualPinMarker) {
        const pinIcon = createManualPinIcon();
        mapState.manualPinMarker = window.L.marker([numLat, numLng], {
            icon: pinIcon,
            draggable: true,
            zIndexOffset: 1000
        }).addTo(mapState.leafletMapObj);

        // Update coordinates when user drags the manual marker
        mapState.manualPinMarker.on('dragend', () => {
            const pos = mapState.manualPinMarker.getLatLng();
            mapState.manualPinCoords = { lat: pos.lat, lng: pos.lng };
            const container = document.getElementById('google-map-container');
            updatePinStatusOverlay(container);
        });
    } else {
        mapState.manualPinMarker.setLatLng([numLat, numLng]);
        if (!mapState.leafletMapObj.hasLayer(mapState.manualPinMarker)) {
            mapState.manualPinMarker.addTo(mapState.leafletMapObj);
        }
    }

    const container = document.getElementById('google-map-container');
    updatePinStatusOverlay(container);
    showToast("📍 Pin placed! Tapping confirm will capture this pin.");
}

/**
 * Clears the manual pin and restores capture priority to the map center reticle.
 */
export function clearManualPin() {
    if (mapState.manualPinMarker && mapState.leafletMapObj) {
        mapState.leafletMapObj.removeLayer(mapState.manualPinMarker);
    }
    mapState.manualPinMarker = null;
    mapState.isManualPinPlaced = false;
    mapState.manualPinCoords = null;

    const container = document.getElementById('google-map-container');
    updatePinStatusOverlay(container);
    showToast("🎯 Pin cleared. Active capture switched back to Map Center.");
}

/**
 * Initializes the search bar with free Nominatim autocomplete for OpenStreetMap.
 */
export function initMapSearchAutocomplete() {
    const input = document.getElementById('map-search-input');
    if (!input) return;

    let dropdown = document.getElementById('map-nominatim-results-box');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'map-nominatim-results-box';
        dropdown.className = 'hidden absolute left-0 right-0 top-full mt-1 bg-gray-900/95 border border-gray-700 rounded-xl shadow-2xl z-50 max-h-56 overflow-y-auto text-xs flex flex-col backdrop-blur-md';
        input.parentElement.style.position = 'relative';
        input.parentElement.appendChild(dropdown);
    }

    input.oninput = () => {
        const val = input.value.trim();
        if (nominatimSearchTimeout) clearTimeout(nominatimSearchTimeout);

        if (val.length < 3) {
            dropdown.innerHTML = '';
            dropdown.classList.add('hidden');
            return;
        }

        nominatimSearchTimeout = setTimeout(async () => {
            dropdown.innerHTML = '<div class="p-2.5 text-gray-400 text-[11px] italic text-center">Searching OpenStreetMap...</div>';
            dropdown.classList.remove('hidden');

            const results = await searchNominatimPlaces(val);
            if (!results || results.length === 0) {
                dropdown.innerHTML = '<div class="p-2.5 text-gray-400 text-[11px] italic text-center">No matching locations found.</div>';
                return;
            }

            dropdown.innerHTML = results.map(item => {
                const displayName = item.display_name || 'Location';
                const lat = parseFloat(item.lat);
                const lon = parseFloat(item.lon);

                return `
                <div class="nominatim-result-item p-2.5 border-b border-gray-800/80 hover:bg-blue-600/30 cursor-pointer transition flex items-start gap-2 text-white text-[11px]" data-lat="${lat}" data-lon="${lon}">
                    <i class="fa-solid fa-location-dot text-red-400 text-xs mt-0.5 shrink-0"></i>
                    <span class="truncate leading-snug">${displayName}</span>
                </div>`;
            }).join('');

            dropdown.querySelectorAll('.nominatim-result-item').forEach(el => {
                el.onclick = () => {
                    const lat = parseFloat(el.getAttribute('data-lat'));
                    const lon = parseFloat(el.getAttribute('data-lon'));

                    if (!isNaN(lat) && !isNaN(lon) && mapState.leafletMapObj) {
                        mapState.leafletMapObj.setView([lat, lon], 17);
                        mapState.selectedMapLat = lat;
                        mapState.selectedMapLng = lon;

                        // Place the manual pin directly at the searched landmark
                        placeManualPin(lat, lon);
                    }

                    input.value = el.querySelector('span')?.innerText || '';
                    dropdown.classList.add('hidden');
                };
            });
        }, 350);
    };

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
}

export async function openMapPicker(context = 'form') {
    mapState.mapPickerContext = context;

    // Reset manual pin state for clean session calibration
    clearManualPin();

    switchView('view-map');
    
    const searchBarContainer = document.getElementById('map-search-bar-container');
    const confirmBtn = document.getElementById('map-confirm-btn');
    const confirmBtnText = document.getElementById('map-confirm-btn-text');
    const navBtn = document.getElementById('map-nav-app-btn');
    const centerPin = document.getElementById('map-center-pin');
    const titleEl = document.getElementById('map-view-title');

    if (searchBarContainer) searchBarContainer.classList.remove('hidden');
    if (confirmBtn) confirmBtn.classList.remove('hidden');
    if (navBtn) navBtn.classList.add('hidden');

    // Hide legacy center pin in favor of our high-z-index reticle
    if (centerPin) centerPin.classList.add('hidden');

    if (context === 'chat') {
        if (titleEl) titleEl.innerText = "Select Location for Chat";
        if (confirmBtnText) confirmBtnText.innerText = "SEND LOCATION PIN TO CHAT";
    } else if (context === 'rider-chat') {
        if (titleEl) titleEl.innerText = "Select Rider Location Pin";
        if (confirmBtnText) confirmBtnText.innerText = "SEND RIDER LOCATION PIN";
    } else if (context === 'registration') {
        if (titleEl) titleEl.innerText = "Pin Delivery Location";
        if (confirmBtnText) confirmBtnText.innerText = "CONFIRM REGISTRATION PIN";
    } else {
        if (titleEl) titleEl.innerText = "Pick Location Pin";
        if (confirmBtnText) confirmBtnText.innerText = "CONFIRM LOCATION PIN";
    }

    showToast("📍 Calibrating map position...");
    await ensureLeafletLoaded();
    const coords = await getDeviceLocation();

    let initialLat = 0;
    let initialLng = 0;

    if (coords && coords.lat !== 0 && coords.lon !== 0) {
        initialLat = coords.lat;
        initialLng = coords.lon;
    } else {
        const custUid = appState.customerFacebookId || localStorage.getItem('lokalex_customer_fb_id');
        let savedProfileLat = 0;
        let savedProfileLng = 0;

        if (custUid && db) {
            try {
                const snap = await db.ref(`customers/${custUid}`).once('value');
                const val = snap.val();
                if (val && val.lat && val.lng) {
                    savedProfileLat = parseFloat(val.lat);
                    savedProfileLng = parseFloat(val.lng);
                }
            } catch (e) {}
        }

        if (savedProfileLat !== 0 && savedProfileLng !== 0) {
            initialLat = savedProfileLat;
            initialLng = savedProfileLng;
            showToast("📍 Using saved profile address as map center");
        } else {
            initialLat = appState.lat || HUB_LOCATION.lat;
            initialLng = appState.lon || HUB_LOCATION.lng;
        }
    }

    mapState.selectedMapLat = initialLat;
    mapState.selectedMapLng = initialLng;

    initLeafletMapObject(mapState.selectedMapLat, mapState.selectedMapLng);
    initMapSearchAutocomplete();
}

/**
 * Initializes or recenters the Leaflet OpenStreetMap canvas.
 */
export function initLeafletMapObject(lat, lng) {
    const mapContainer = document.getElementById('google-map-container');
    if (!mapContainer || !window.L) return;

    const initialPos = [parseFloat(lat), parseFloat(lng)];

    if (!mapState.leafletMapObj) {
        // Initialize Leaflet map instance
        mapState.leafletMapObj = window.L.map(mapContainer, {
            center: initialPos,
            zoom: 17,
            zoomControl: true,
            attributionControl: false
        });

        // Add free OpenStreetMap cartographic tile layer
        window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap'
        }).addTo(mapState.leafletMapObj);

        // Update selected center pin coordinates on map move
        mapState.leafletMapObj.on('move', () => {
            const center = mapState.leafletMapObj.getCenter();
            mapState.selectedMapLat = center.lat;
            mapState.selectedMapLng = center.lng;
        });

        // Tap/click listener: Drop or move manual pin on the map
        mapState.leafletMapObj.on('click', (e) => {
            if (e && e.latlng) {
                placeManualPin(e.latlng.lat, e.latlng.lng);
            }
        });

        // Backward compatibility link
        mapState.googleMapObj = mapState.leafletMapObj;
    } else {
        mapState.leafletMapObj.setView(initialPos, 17);
    }

    // Attach high-z-index center reticle & pin indicator overlay
    ensureCenterReticleOverlay(mapContainer);
    updatePinStatusOverlay(mapContainer);

    // Force container dimension refresh when opening view
    setTimeout(() => {
        if (mapState.leafletMapObj) {
            mapState.leafletMapObj.invalidateSize();
        }
    }, 200);

    appState.lat = lat;
    appState.lon = lng;
}

// Backward-compatible alias for existing imports
export const initGoogleMapObject = initLeafletMapObject;

/**
 * Confirms coordinates according to strict priority hierarchy:
 * Priority 1: Captures user-placed manual pin (ignores center).
 * Priority 2: Captures map center reticle if no manual pin is placed.
 */
export function confirmGoogleMapPin() {
    if (!mapState.leafletMapObj) return;

    let targetLat = 0;
    let targetLng = 0;
    let isManualCapture = false;

    // Strict Selection Hierarchy
    if (mapState.isManualPinPlaced && mapState.manualPinCoords) {
        targetLat = mapState.manualPinCoords.lat;
        targetLng = mapState.manualPinCoords.lng;
        isManualCapture = true;
    } else {
        const center = mapState.leafletMapObj.getCenter();
        targetLat = center.lat;
        targetLng = center.lng;
    }

    const formattedLat = targetLat.toFixed(6);
    const formattedLng = targetLng.toFixed(6);
    const mapLink = `https://www.google.com/maps/search/?api=1&query=${formattedLat},${formattedLng}`;

    appState.lat = targetLat;
    appState.lon = targetLng;

    const captureLabel = isManualCapture ? "Placed Pin" : "Center Reticle";

    if (mapState.mapPickerContext === 'chat') {
        goBack();
        if (typeof sendCustomerToRiderChat === 'function') {
            sendCustomerToRiderChat("", null, { lat: targetLat, lng: targetLng });
        }
        showToast(`📍 ${captureLabel} location sent to chat!`);
    } else if (mapState.mapPickerContext === 'rider-chat') {
        goBack();
        if (typeof sendRiderToCustomerChat === 'function') {
            sendRiderToCustomerChat("Shared Rider Location", null, { lat: targetLat, lng: targetLng });
        }
        showToast(`📍 ${captureLabel} location sent to chat!`);
    } else if (mapState.mapPickerContext === 'registration') {
        const regGpsInput = document.getElementById('reg-gps-link');
        const regLatInput = document.getElementById('reg-lat');
        const regLonInput = document.getElementById('reg-lon');

        if (regGpsInput) regGpsInput.value = mapLink;
        if (regLatInput) regLatInput.value = formattedLat;
        if (regLonInput) regLonInput.value = formattedLng;

        goBack();
        showToast(`📍 ${captureLabel} pinned for registration!`);
    } else {
        const formLatLonInput = document.getElementById('form-latlon');
        if (formLatLonInput) formLatLonInput.value = mapLink;
        
        goBack();
        showToast(`📍 ${captureLabel} confirmed!`);
    }
}

// Global window attachments
if (typeof window !== 'undefined') {
    window.placeManualPin = placeManualPin;
    window.clearManualPin = clearManualPin;
    window.confirmGoogleMapPin = confirmGoogleMapPin;
    window.openMapPicker = openMapPicker;
}

// REMARKS: MAP_PICKER_PERSISTENT_RETICLE_AND_MANUAL_PIN_HIERARCHY_V2_COMPLETE