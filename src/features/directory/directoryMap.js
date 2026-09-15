// src/features/directory/directoryMap.js
import { showToast } from '../../ui/notifications.js';
import { switchView } from '../../ui/router.js';
import { calibrateGPS } from '../auth/index.js';

let mapInstance = null;
let selectedMapLat = 0;
let selectedMapLng = 0;

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

    selectedMapLat = coords?.lat || 15.6886;
    selectedMapLng = coords?.lon || 120.4131;

    initGoogleMap(selectedMapLat, selectedMapLng);
}

export function initGoogleMap(lat, lng) {
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