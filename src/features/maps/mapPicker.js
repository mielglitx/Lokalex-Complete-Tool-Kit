// src/features/maps/mapPicker.js

/**
 * ============================================================================
 * LEAFLET & OPENSTREETMAP COORDINATE PICKER MODULE
 * ============================================================================
 * 
 * Description:
 * Interactive location selector and coordinate calibration tool powered by Leaflet:
 * - Free OpenStreetMap cartographic tile layer with zero billing overhead.
 * - Dynamic Nominatim geocoding search for Philippine addresses and landmarks.
 * - Draggable/movable map center with visual crosshair/pin alignment.
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

    switchView('view-map');
    
    const searchBarContainer = document.getElementById('map-search-bar-container');
    const confirmBtn = document.getElementById('map-confirm-btn');
    const confirmBtnText = document.getElementById('map-confirm-btn-text');
    const navBtn = document.getElementById('map-nav-app-btn');
    const centerPin = document.getElementById('map-center-pin');
    const titleEl = document.getElementById('map-view-title');

    if (searchBarContainer) searchBarContainer.classList.remove('hidden');
    if (centerPin) centerPin.classList.remove('hidden');
    if (confirmBtn) confirmBtn.classList.remove('hidden');
    if (navBtn) navBtn.classList.add('hidden');

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

    showToast("📡 Calibrating map center...");
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

        // Backward compatibility link
        mapState.googleMapObj = mapState.leafletMapObj;
    } else {
        mapState.leafletMapObj.setView(initialPos, 17);
    }

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

export function confirmGoogleMapPin() {
    if (!mapState.leafletMapObj) return;

    const formattedLat = mapState.selectedMapLat.toFixed(6);
    const formattedLng = mapState.selectedMapLng.toFixed(6);
    const mapLink = `https://www.google.com/maps/search/?api=1&query=${formattedLat},${formattedLng}`;

    appState.lat = mapState.selectedMapLat;
    appState.lon = mapState.selectedMapLng;

    if (mapState.mapPickerContext === 'chat') {
        goBack();
        if (typeof sendCustomerToRiderChat === 'function') {
            sendCustomerToRiderChat("", null, { lat: mapState.selectedMapLat, lng: mapState.selectedMapLng });
        }
        showToast("📍 Location card sent to chat!");
    } else if (mapState.mapPickerContext === 'rider-chat') {
        goBack();
        if (typeof sendRiderToCustomerChat === 'function') {
            sendRiderToCustomerChat("📍 Shared Rider Location", null, { lat: mapState.selectedMapLat, lng: mapState.selectedMapLng });
        }
        showToast("📍 Rider location pin sent to chat!");
    } else if (mapState.mapPickerContext === 'registration') {
        const regGpsInput = document.getElementById('reg-gps-link');
        const regLatInput = document.getElementById('reg-lat');
        const regLonInput = document.getElementById('reg-lon');

        if (regGpsInput) regGpsInput.value = mapLink;
        if (regLatInput) regLatInput.value = formattedLat;
        if (regLonInput) regLonInput.value = formattedLng;

        goBack();
        showToast("📍 Registration location pinned!");
    } else {
        const formLatLonInput = document.getElementById('form-latlon');
        if (formLatLonInput) formLatLonInput.value = mapLink;
        
        goBack();
        showToast("📍 Location pin confirmed!");
    }
}

// REMARKS: MAP_PICKER_LEAFLET_OSM_NOMINATIM_GEOCODER_V1_COMPLETE