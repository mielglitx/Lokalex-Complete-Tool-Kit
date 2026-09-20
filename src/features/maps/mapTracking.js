// src/features/maps/mapTracking.js

/**
 * ============================================================================
 * LIVE CUSTOMER TRACKING & ROUTE ENGINE (LEAFLET + OSRM)
 * ============================================================================
 * 
 * Description:
 * End-to-end customer delivery tracking and turn-by-turn route plotting:
 * - Generates personalized customer location sharing links (?track=KEY).
 * - Customer Portal: Captures GPS location and renders on OpenStreetMap.
 * - Rider Portal: Plots real-time driving route from rider to customer using
 *   the free Open Source Routing Machine (OSRM) driving API.
 * - Dynamic Leaflet polyline rendering with distance, duration, and native
 *   turn-by-turn navigation deep-links.
 * 
 * Update Note:
 * - Migrated from Google Maps DirectionsService to Leaflet.js and OSRM routing.
 * - Eliminated Google Maps SDK runtime dependencies.
 * ============================================================================
 */

import { appState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { HUB_LOCATION } from '../../config/constants.js';
import { showToast } from '../../ui/notifications.js';
import { switchView } from '../../ui/router.js';
import { copyText, getLocalTodayStr } from '../../utils/helpers.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { getDeviceLocation } from '../auth/index.js';
import { mapState, saveTrackingHistory, ensureLeafletLoaded, fetchOsrmDrivingRoute } from './mapState.js';

export function copyCustomerTrackingLink(custName, forceRefresh = false) {
    if (!custName) custName = "Customer";
    
    const rName = (appState.riderName || "RIDER").replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const cleanCust = custName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const todayClean = getLocalTodayStr().replace(/-/g, '');
    const sessionKey = `${rName}_${cleanCust}_${todayClean}`;

    if (!mapState.trackingHistory[sessionKey]) {
        mapState.trackingHistory[sessionKey] = { activeKey: "", oldKeys: [] };
    }

    let custData = mapState.trackingHistory[sessionKey];

    if (!custData.activeKey || forceRefresh) {
        if (custData.activeKey) {
            custData.oldKeys.unshift(custData.activeKey);
            if (custData.oldKeys.length > 5) custData.oldKeys = custData.oldKeys.slice(0, 5);
        }
        const nonce = Math.random().toString(36).substring(2, 7).toUpperCase();
        custData.activeKey = `${rName}_${cleanCust}_${Date.now().toString(36).toUpperCase()}_${nonce}`;
    }

    saveTrackingHistory();

    const fullUrl = `${window.location.origin}${window.location.pathname}?track=${custData.activeKey}`;
    const customerMessage = `Magandang araw po! 👋\n\nPara mas mabilis at accurate ang paghatid ng inyong order, paki-pindot lang po ang link na ito para makuha ng ating Lokalex Rider ang inyong eksaktong lokasyon:\n\n${fullUrl}\n\n⚠️ PAALALA:\nKung binuksan nyo po ito sa loob ng Messenger, paki-pindot po ang 3 dots (...) sa itaas at piliin ang "Open in Chrome/Safari". Maraming salamat po! 🛵💙`;

    copyText(customerMessage);
    showToast(`🔗 Tracking message & link copied for ${custName}!`);
}

export function refreshCustomerTrackingLink(custName) {
    if (!custName) custName = "Customer";
    openSlideDeleteModal(`Mag-generate ng bagong GPS tracking link para kay [${custName}]?`, () => {
        copyCustomerTrackingLink(custName, true);
    });
}

export function checkAndInitTrackPortal() {
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.has('track')) return;
    const portal = document.getElementById('customer-tracking-portal');
    if (portal) portal.classList.remove('hidden');
}

export async function startCustomerLocationSharing() {
    const urlParams = new URLSearchParams(window.location.search);
    const trackKey = urlParams.get('track');
    if (!trackKey) return;

    const btn = document.getElementById('cust-share-btn');
    const statusEl = document.getElementById('cust-share-status');
    const mapBox = document.getElementById('cust-map-container-box');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Kumukuha ng GPS...`;
    }

    if (!navigator.geolocation) {
        if (statusEl) {
            statusEl.className = "text-xs font-bold text-red-400 bg-red-500/10 p-3 rounded-xl border border-red-500/20";
            statusEl.innerText = "❌ Hindi suportado ang GPS sa browser na ito.";
        }
        return;
    }

    await ensureLeafletLoaded();
    if (mapBox) mapBox.classList.remove('hidden');
    let shareCount = 0;

    const watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            shareCount++;

            const mapEl = document.getElementById('cust-google-map');
            if (mapEl && window.L) {
                if (!mapState.custLeafletMapObj) {
                    mapState.custLeafletMapObj = window.L.map(mapEl, {
                        center: [lat, lng],
                        zoom: 17,
                        zoomControl: true,
                        attributionControl: false
                    });
                    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                        maxZoom: 19
                    }).addTo(mapState.custLeafletMapObj);

                    mapState.custMarkerObj = window.L.marker([lat, lng], {
                        title: "Iyong Lokasyon"
                    }).addTo(mapState.custLeafletMapObj);

                    mapState.custGoogleMapObj = mapState.custLeafletMapObj;
                } else {
                    mapState.custLeafletMapObj.setView([lat, lng], 17);
                    if (mapState.custMarkerObj) {
                        mapState.custMarkerObj.setLatLng([lat, lng]);
                    }
                }
            }

            if (db) {
                db.ref('liveTracking/' + trackKey).set({
                    lat: lat,
                    lng: lng,
                    capturedAt: Date.now()
                });
            }

            if (statusEl) {
                statusEl.className = "text-xs font-bold text-blue-400 bg-blue-500/10 p-3 rounded-xl border border-blue-500/20";
                statusEl.innerHTML = `📡 Signal Accuracy... (${shareCount}/20)<br><span class="text-gray-300 font-normal">Nasa-save na ang iyong lokasyon...</span>`;
            }

            if (shareCount >= 20) {
                try { navigator.geolocation.clearWatch(watchId); } catch(e) {}
                if (statusEl) {
                    statusEl.innerHTML = "🔒 <strong>Pin Permanently Saved (100%)!</strong><br><span class=\"text-gray-300 font-normal\">Nai-save na ang iyong lokasyon. Ipaalam na ito sa rider.</span>";
                }
                if (btn) {
                    btn.innerHTML = `<i class="fa-solid fa-check-double"></i> LOCATION PINNED`;
                }
            }
        },
        (err) => {
            if (statusEl) {
                statusEl.className = "text-xs font-bold text-red-400 bg-red-500/10 p-3 rounded-xl border border-red-500/20";
                statusEl.innerText = "⚠️ Paki-allow ang GPS Location permission sa iyong browser.";
            }
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> RETRY LOCATION CAPTURE`;
            }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

export async function openLiveCustomerMap(custName) {
    if (!custName) custName = "Customer";

    const rName = (appState.riderName || "RIDER").replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const cleanCust = custName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const todayClean = getLocalTodayStr().replace(/-/g, '');
    const sessionKey = `${rName}_${cleanCust}_${todayClean}`;

    let trackKey = mapState.trackingHistory[sessionKey] && mapState.trackingHistory[sessionKey].activeKey 
        ? mapState.trackingHistory[sessionKey].activeKey 
        : `${rName}_${cleanCust}_${todayClean}`;

    switchView('view-map');
    
    const titleEl = document.getElementById('map-view-title');
    if (titleEl) titleEl.innerText = `Tracking: ${custName}`;
    
    const searchBarContainer = document.getElementById('map-search-bar-container');
    if (searchBarContainer) searchBarContainer.classList.add('hidden');
    
    const centerPin = document.getElementById('map-center-pin');
    const confirmBtn = document.getElementById('map-confirm-btn');
    const navBtn = document.getElementById('map-nav-app-btn');

    if (centerPin) centerPin.classList.add('hidden');
    if (confirmBtn) confirmBtn.classList.add('hidden');
    if (navBtn) navBtn.classList.remove('hidden');

    showToast("Locating rider position...");
    await ensureLeafletLoaded();
    const coords = await getDeviceLocation();
    const riderLat = coords.lat || HUB_LOCATION.lat;
    const riderLng = coords.lon || HUB_LOCATION.lng;
    const riderLoc = [riderLat, riderLng];

    const mapContainer = document.getElementById('google-map-container');
    if (!mapContainer || !window.L) return;

    if (!mapState.leafletMapObj) {
        mapState.leafletMapObj = window.L.map(mapContainer, {
            center: riderLoc,
            zoom: 16,
            zoomControl: true,
            attributionControl: false
        });
        window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
        }).addTo(mapState.leafletMapObj);
        mapState.googleMapObj = mapState.leafletMapObj;
    } else {
        mapState.leafletMapObj.setView(riderLoc, 16);
    }

    // Initialize or clear tracking layer container
    if (mapState.leafletRoutePolyline) {
        mapState.leafletMapObj.removeLayer(mapState.leafletRoutePolyline);
        mapState.leafletRoutePolyline = null;
    }
    if (mapState.trackingMarkers) {
        mapState.trackingMarkers.forEach(m => mapState.leafletMapObj.removeLayer(m));
    }
    mapState.trackingMarkers = [];

    const riderMarker = window.L.marker(riderLoc, { title: "Rider Location" }).addTo(mapState.leafletMapObj);
    mapState.trackingMarkers.push(riderMarker);

    if (db) {
        db.ref('liveTracking/' + trackKey).on('value', async (snapshot) => {
            const data = snapshot.val();
            if (data && data.lat && data.lng) {
                const custLoc = [parseFloat(data.lat), parseFloat(data.lng)];
                mapState.activeNavTargetCoords = { lat: custLoc[0], lng: custLoc[1] };

                // Remove previous customer marker if existing
                if (mapState.trackingMarkers.length > 1) {
                    mapState.leafletMapObj.removeLayer(mapState.trackingMarkers[1]);
                    mapState.trackingMarkers.pop();
                }

                const custMarker = window.L.marker(custLoc, { title: `Customer: ${custName}` }).addTo(mapState.leafletMapObj);
                mapState.trackingMarkers.push(custMarker);

                // Fetch OSRM driving route
                const route = await fetchOsrmDrivingRoute(riderLoc[0], riderLoc[1], custLoc[0], custLoc[1]);

                if (mapState.leafletRoutePolyline) {
                    mapState.leafletMapObj.removeLayer(mapState.leafletRoutePolyline);
                    mapState.leafletRoutePolyline = null;
                }

                if (route.success && route.coordinates.length > 0) {
                    mapState.leafletRoutePolyline = window.L.polyline(route.coordinates, {
                        color: '#3B82F6',
                        weight: 6,
                        opacity: 0.85
                    }).addTo(mapState.leafletMapObj);

                    mapState.leafletMapObj.fitBounds(mapState.leafletRoutePolyline.getBounds(), {
                        padding: [50, 50]
                    });

                    showToast(`📍 Route Plotted: ${route.distanceKm.toFixed(2)} km (~${route.durationText})`);
                } else {
                    mapState.leafletRoutePolyline = window.L.polyline([riderLoc, custLoc], {
                        color: '#3B82F6',
                        weight: 4,
                        dashArray: '5, 10'
                    }).addTo(mapState.leafletMapObj);

                    mapState.leafletMapObj.fitBounds(mapState.leafletRoutePolyline.getBounds(), {
                        padding: [50, 50]
                    });
                }
            } else {
                showToast("Waiting for customer to open tracking link...");
            }
        });
    }
}

export function openExternalGoogleNav() {
    if (!mapState.activeNavTargetCoords) return showToast("No customer GPS pin received yet.");
    const url = `https://www.google.com/maps/dir/?api=1&destination=${mapState.activeNavTargetCoords.lat},${mapState.activeNavTargetCoords.lng}&travelmode=driving`;
    window.open(url, '_blank');
}

// REMARKS: MAP_TRACKING_LEAFLET_OSRM_ROUTING_V1_COMPLETE