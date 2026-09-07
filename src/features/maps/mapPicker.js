// src/features/maps/mapPicker.js
import { appState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { HUB_LOCATION } from '../../config/constants.js';
import { showToast } from '../../ui/notifications.js';
import { switchView, goBack } from '../../ui/router.js';
import { getDeviceLocation } from '../auth/index.js';
import { sendCustomerToRiderChat, sendRiderToCustomerChat } from '../chat/index.js';
import { mapState } from './mapState.js';

export function initMapSearchAutocomplete() {
    const input = document.getElementById('map-search-input');
    if (!input || !window.google || !window.google.maps || !window.google.maps.places) return;

    if (!mapState.mapSearchAutocomplete) {
        mapState.mapSearchAutocomplete = new google.maps.places.Autocomplete(input, {
            types: ['geocode', 'establishment']
        });

        mapState.mapSearchAutocomplete.addListener('place_changed', () => {
            const place = mapState.mapSearchAutocomplete.getPlace();
            if (!place.geometry || !place.geometry.location) {
                showToast("⚠️ Location not found. Please select from dropdown.");
                return;
            }

            if (mapState.googleMapObj) {
                mapState.googleMapObj.panTo(place.geometry.location);
                mapState.googleMapObj.setZoom(17);
            }
        });
    }
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

    initGoogleMapObject(mapState.selectedMapLat, mapState.selectedMapLng);
    initMapSearchAutocomplete();
}

export function initGoogleMapObject(lat, lng) {
    const mapCenter = { lat: parseFloat(lat), lng: parseFloat(lng) };
    const mapContainer = document.getElementById('google-map-container');

    if (!mapContainer || !window.google || !window.google.maps) return;

    if (!mapState.googleMapObj) {
        mapState.googleMapObj = new google.maps.Map(mapContainer, {
            center: mapCenter,
            zoom: 17,
            mapTypeId: 'hybrid',
            disableDefaultUI: false,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false
        });

        mapState.googleMapObj.addListener('center_changed', () => {
            const center = mapState.googleMapObj.getCenter();
            mapState.selectedMapLat = center.lat();
            mapState.selectedMapLng = center.lng();
        });
    } else {
        mapState.googleMapObj.setCenter(mapCenter);
        mapState.googleMapObj.setZoom(17);
    }

    appState.lat = lat;
    appState.lon = lng;
}

export function confirmGoogleMapPin() {
    if (!mapState.googleMapObj) return;

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