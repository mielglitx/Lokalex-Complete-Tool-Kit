// src/features/maps/mapState.js

/**
 * ============================================================================
 * OPEN-SOURCE MAPPING STATE & OSRM / NOMINATIM GEOSPATIAL ENGINE
 * ============================================================================
 * 
 * Description:
 * Centralized state container and geospatial networking hub for Lokalex:
 * - Dynamic Leaflet CDN Bootstrapper: injects Leaflet CSS and JS dynamically
 *   to ensure zero setup friction and eliminate Google Maps billing requirements.
 * - Open Source Routing Machine (OSRM) Client: fetches free driving routes,
 *   turn-by-turn polyline GeoJSON coordinates, road distance, and travel ETAs.
 * - Nominatim Geocoding Client: provides free address and landmark search across
 *   the Philippines without requiring Google Places API keys.
 * - Central state holder for active Leaflet instances, markers, and navigation.
 * ============================================================================
 */

export const mapState = {
    // Leaflet instances & layer references
    leafletMapObj: null,
    googleMapObj: null, // Backward-compatible alias pointing to leafletMapObj
    custLeafletMapObj: null,
    custGoogleMapObj: null, // Backward-compatible alias
    custMarkerObj: null,
    leafletRoutePolyline: null,
    activeNavTargetCoords: null,

    // Find Riders Radar state
    findRidersMapObj: null,
    findRidersMarkers: [],

    // Universal coordinate picker state
    mapSearchAutocomplete: null,
    mapPickerContext: 'form', // 'form' | 'chat' | 'rider-chat' | 'registration'
    selectedMapLat: 0,
    selectedMapLng: 0,

    // Tracking session cache
    trackingHistory: JSON.parse(localStorage.getItem('lokalex_tracking_history') || '{}')
};

export function saveTrackingHistory() {
    try {
        localStorage.setItem('lokalex_tracking_history', JSON.stringify(mapState.trackingHistory));
    } catch (e) {}
}

/**
 * Self-healing Leaflet CSS & JS dynamic loader.
 * Guarantees that Leaflet is fully operational in the global window namespace.
 */
export function ensureLeafletLoaded() {
    return new Promise((resolve) => {
        if (window.L && typeof window.L.map === 'function') {
            return resolve(true);
        }

        // 1. Inject Leaflet CSS stylesheet if not present
        if (!document.querySelector('link[href*="leaflet"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            link.crossOrigin = '';
            document.head.appendChild(link);
        }

        // 2. Inject Leaflet JS script if not present
        const existingScript = document.querySelector('script[src*="leaflet"]');
        if (existingScript) {
            existingScript.addEventListener('load', () => resolve(true));
            setTimeout(() => resolve(!!window.L), 2500);
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.crossOrigin = '';
        script.onload = () => resolve(true);
        script.onerror = () => {
            console.error("Failed to load Leaflet from unpkg CDN.");
            resolve(false);
        };
        document.head.appendChild(script);
    });
}

/**
 * OSRM (Open Source Routing Machine) Free Driving Route Fetcher.
 * Queries public OSRM servers for road driving distance, duration, and GeoJSON geometry.
 */
export async function fetchOsrmDrivingRoute(originLat, originLng, destLat, destLng) {
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`OSRM HTTP status ${res.status}`);
        
        const data = await res.json();
        if (!data.routes || data.routes.length === 0) {
            throw new Error("No driving route found between coordinates.");
        }

        const route = data.routes[0];
        const distanceMeters = route.distance || 0;
        const durationSecs = route.duration || 0;

        // OSRM coordinates are returned as [lon, lat]; convert to Leaflet's [lat, lon]
        const latLngCoords = (route.geometry?.coordinates || []).map(coord => [coord[1], coord[0]]);

        const mins = Math.round(durationSecs / 60);
        const durationText = mins >= 60 
            ? `${Math.floor(mins / 60)}h ${mins % 60}m` 
            : `${Math.max(1, mins)} mins`;

        return {
            success: true,
            distanceMeters,
            distanceKm: distanceMeters / 1000,
            durationSecs,
            durationText,
            coordinates: latLngCoords
        };
    } catch (err) {
        console.warn("OSRM routing service notice:", err);
        return {
            success: false,
            error: err.message,
            distanceMeters: 0,
            distanceKm: 0,
            durationText: "N/A",
            coordinates: []
        };
    }
}

/**
 * Nominatim Free Geocoding Search (OpenStreetMap).
 * Searches Philippine addresses and places without requiring Google Places API keys.
 */
export async function searchNominatimPlaces(query) {
    if (!query || query.trim().length < 2) return [];
    try {
        const cleanQuery = encodeURIComponent(query.trim());
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${cleanQuery}&countrycodes=ph&limit=5`;
        const res = await fetch(url, {
            headers: {
                'Accept': 'application/json'
            }
        });
        if (!res.ok) return [];
        return await res.json();
    } catch (e) {
        console.warn("Nominatim search notice:", e);
        return [];
    }
}

// REMARKS: MAP_STATE_LEAFLET_OSM_OSRM_DYNAMIC_ENGINE_V1_COMPLETE