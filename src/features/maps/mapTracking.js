// src/features/maps/mapTracking.js
import { appState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { HUB_LOCATION } from '../../config/constants.js';
import { showToast } from '../../ui/notifications.js';
import { switchView } from '../../ui/router.js';
import { copyText, getLocalTodayStr } from '../../utils/helpers.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { getDeviceLocation } from '../auth/index.js';
import { mapState, saveTrackingHistory } from './mapState.js';

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

export function startCustomerLocationSharing() {
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

    if (mapBox) mapBox.classList.remove('hidden');
    let shareCount = 0;

    const watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            shareCount++;
            const custLoc = { lat, lng };

            if (!mapState.custGoogleMapObj && typeof google !== 'undefined' && google.maps) {
                const mapEl = document.getElementById('cust-google-map');
                if (mapEl) {
                    mapState.custGoogleMapObj = new google.maps.Map(mapEl, {
                        center: custLoc,
                        zoom: 17,
                        disableDefaultUI: true,
                        zoomControl: true
                    });
                    mapState.custMarkerObj = new google.maps.Marker({
                        position: custLoc,
                        map: mapState.custGoogleMapObj,
                        title: "Iyong Lokasyon",
                        animation: google.maps.Animation.DROP
                    });
                }
            } else if (mapState.custGoogleMapObj && mapState.custMarkerObj) {
                mapState.custGoogleMapObj.setCenter(custLoc);
                mapState.custMarkerObj.setPosition(custLoc);
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
                statusEl.innerHTML = `📡 Capturing signal accuracy... (${shareCount}/20)<br><span class="text-gray-300 font-normal">Nasa-save na ang iyong lokasyon...</span>`;
            }

            if (shareCount >= 20) {
                navigator.geolocation.clearWatch(watchId);
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
    const coords = await getDeviceLocation();
    const riderLoc = { lat: coords.lat || HUB_LOCATION.lat, lng: coords.lon || HUB_LOCATION.lng };

    const mapContainer = document.getElementById('google-map-container');
    if (!mapState.googleMapObj) {
        mapState.googleMapObj = new google.maps.Map(mapContainer, {
            center: riderLoc,
            zoom: 16,
            disableDefaultUI: false,
            zoomControl: true
        });
    } else {
        mapState.googleMapObj.setCenter(riderLoc);
    }

    if (!mapState.mapDirectionsService) mapState.mapDirectionsService = new google.maps.DirectionsService();
    if (!mapState.mapDirectionsRenderer) {
        mapState.mapDirectionsRenderer = new google.maps.DirectionsRenderer({ 
            map: mapState.googleMapObj, 
            suppressMarkers: false,
            polylineOptions: {
                strokeColor: '#3B82F6',
                strokeWeight: 6,
                strokeOpacity: 0.85
            }
        });
    }

    if (db) {
        db.ref('liveTracking/' + trackKey).on('value', (snapshot) => {
            const data = snapshot.val();
            if (data && data.lat && data.lng) {
                const custLoc = { lat: data.lat, lng: data.lng };
                mapState.activeNavTargetCoords = custLoc;

                mapState.mapDirectionsService.route({
                    origin: riderLoc,
                    destination: custLoc,
                    travelMode: google.maps.TravelMode.DRIVING
                }, (result, status) => {
                    if (status === google.maps.DirectionsStatus.OK) {
                        mapState.mapDirectionsRenderer.setDirections(result);
                        const routeLeg = result.routes[0].legs[0];
                        showToast(`📍 Route Plotted: ${routeLeg.distance.text} (~${routeLeg.duration.text})`);
                    }
                });
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