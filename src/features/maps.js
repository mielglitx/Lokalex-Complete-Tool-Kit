// src/features/maps.js
import { appState, globalState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { HUB_LOCATION, API_URL } from '../config/constants.js';
import { showToast } from '../ui/notifications.js';
import { switchView, goBack } from '../ui/router.js';
import { escapeHtml, copyText, getLocalTodayStr } from '../utils/helpers.js';
import { openSlideDeleteModal } from '../ui/modals.js';
import { getDeviceLocation } from './auth.js';

let googleMapObj = null;
let custGoogleMapObj = null;
let custMarkerObj = null;
let mapDirectionsService = null;
let mapDirectionsRenderer = null;
let activeNavTargetCoords = null;

// Local tracking session history persistence
let trackingHistory = JSON.parse(localStorage.getItem('lokalex_tracking_history') || '{}');

// --- 1. CUSTOMER TRACKING LINK GENERATION ---
export function copyCustomerTrackingLink(custName, forceRefresh = false) {
    if (!custName) custName = "Customer";
    
    const rName = (appState.riderName || "RIDER").replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const cleanCust = custName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const todayClean = getLocalTodayStr().replace(/-/g, '');
    const sessionKey = `${rName}_${cleanCust}_${todayClean}`;

    if (!trackingHistory[sessionKey]) {
        trackingHistory[sessionKey] = { activeKey: "", oldKeys: [] };
    }

    let custData = trackingHistory[sessionKey];

    if (!custData.activeKey || forceRefresh) {
        if (custData.activeKey) {
            custData.oldKeys.unshift(custData.activeKey);
            if (custData.oldKeys.length > 5) custData.oldKeys = custData.oldKeys.slice(0, 5);
        }
        const nonce = Math.random().toString(36).substring(2, 7).toUpperCase();
        custData.activeKey = `${rName}_${cleanCust}_${Date.now().toString(36).toUpperCase()}_${nonce}`;
    }

    localStorage.setItem('lokalex_tracking_history', JSON.stringify(trackingHistory));

    const fullUrl = `${window.location.origin}${window.location.pathname}?track=${custData.activeKey}`;

    const customerMessage = `Magandang araw po! 👋\n\nPara mas mabilis, mas madali, at accurate ang paghatid ng inyong order, paki-pindot lang po ang link na ito para makuha ng ating Lokalex Rider ang inyong eksaktong lokasyon:\n\n${fullUrl}\n\n⚠️ PAALALA / INSTRUCTION:\nKung binuksan nyo po ito sa loob ng Messenger, paki-pindot po ang 3 dots (...) sa kanang itaas o ibaba at piliin ang "Open in Chrome" (para sa Android) o "Open in Safari" (para sa iPhone). Paki-approve o allow din po ang Location Access. Aabutin lang po ito ng 1 minuto para ma-pin ng ating system. Maraming salamat po! 🛵💙`;

    copyText(customerMessage);

    if (forceRefresh) {
        showToast(`🔄 Fresh link & message copied for ${custName}!`);
    } else {
        showToast(`🔗 Tracking message & link copied for ${custName}! Send via Messenger.`);
    }
}

export function refreshCustomerTrackingLink(custName) {
    if (!custName) custName = "Customer";
    openSlideDeleteModal(`Mag-generate ng bagong GPS tracking link para kay [${custName}]?`, () => {
        copyCustomerTrackingLink(custName, true);
    });
}

// --- 2. LIVE GPS NAV / MAP TRACKING FOR RIDER ---
export async function openLiveCustomerMap(custName) {
    if (!custName) custName = "Customer";

    const rName = (appState.riderName || "RIDER").replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const cleanCust = custName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const todayClean = getLocalTodayStr().replace(/-/g, '');
    const sessionKey = `${rName}_${cleanCust}_${todayClean}`;

    let trackKey = "";
    if (trackingHistory[sessionKey] && trackingHistory[sessionKey].activeKey) {
        trackKey = trackingHistory[sessionKey].activeKey;
    } else {
        trackKey = `${rName}_${cleanCust}_${todayClean}`;
    }

    switchView('view-map');
    document.getElementById('map-view-title').innerText = `Live Nav: ${custName}`;
    document.getElementById('map-center-pin').classList.add('hidden');
    document.getElementById('map-confirm-btn').classList.add('hidden');
    document.getElementById('map-nav-app-btn').classList.remove('hidden');

    showToast("Locating rider position...");
    const coords = await getDeviceLocation();
    const riderLoc = { lat: coords.lat || HUB_LOCATION.lat, lng: coords.lon || HUB_LOCATION.lng };

    const mapContainer = document.getElementById('google-map-container');
    if (!googleMapObj) {
        googleMapObj = new google.maps.Map(mapContainer, {
            center: riderLoc, zoom: 16, disableDefaultUI: false, zoomControl: true
        });
    } else {
        googleMapObj.setCenter(riderLoc);
    }

    if (!mapDirectionsService) mapDirectionsService = new google.maps.DirectionsService();
    if (!mapDirectionsRenderer) {
        mapDirectionsRenderer = new google.maps.DirectionsRenderer({
            map: googleMapObj, suppressMarkers: false
        });
    }

    // Subscribe to Firebase real-time pin updates from customer tracking link
    db.ref('liveTracking/' + trackKey).on('value', (snapshot) => {
        const data = snapshot.val();
        if (data && data.lat && data.lng) {
            const custLoc = { lat: data.lat, lng: data.lng };
            activeNavTargetCoords = custLoc;

            mapDirectionsService.route({
                origin: riderLoc,
                destination: custLoc,
                travelMode: google.maps.TravelMode.DRIVING
            }, (result, status) => {
                if (status === google.maps.DirectionsStatus.OK) {
                    mapDirectionsRenderer.setDirections(result);
                    const routeLeg = result.routes[0].legs[0];
                    showToast(`📍 Live Pin Received! Distance: ${routeLeg.distance.text} (${routeLeg.duration.text})`);
                }
            });
        } else {
            showToast("Waiting for customer to open tracking link...");
        }
    });
}

export function openExternalGoogleNav() {
    if (!activeNavTargetCoords) return showToast("No customer GPS pin received yet.");
    const url = `https://www.google.com/maps/dir/?api=1&destination=${activeNavTargetCoords.lat},${activeNavTargetCoords.lng}&travelmode=driving`;
    window.open(url, '_blank');
}

// --- 3. MAP CALCULATION BOARD & LINK GENERATION ---
export function openMapCalcBoardModal() {
    const modal = document.getElementById('mapcalc-board-modal');
    if (modal) modal.classList.remove('hidden');
    renderMapCalcBoardList();
}

export function closeMapCalcBoardModal() {
    const modal = document.getElementById('mapcalc-board-modal');
    if (modal) modal.classList.add('hidden');
}

export function promptMapCalcCustomerName() {
    const input = document.getElementById('mapcalc-cust-name-input');
    if (input) input.value = "";
    
    const nameModal = document.getElementById('mapcalc-name-modal');
    if (nameModal) nameModal.classList.remove('hidden');
    if (input) input.focus();
}

export function closeMapCalcNameModal() {
    const nameModal = document.getElementById('mapcalc-name-modal');
    if (nameModal) nameModal.classList.add('hidden');
}

export async function confirmGenerateMapCalcLink() {
    const inputEl = document.getElementById('mapcalc-cust-name-input');
    const custName = inputEl ? inputEl.value.trim() : "";
    if (!custName) return showToast("Paki-lagay ang Customer Name!");

    closeMapCalcNameModal();

    const calcKey = `CALC_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).substring(2,6).toUpperCase()}`;
    const dateStr = new Date().toLocaleDateString('en-US', { 
        month: 'short', day: 'numeric', year: 'numeric', 
        hour: '2-digit', minute: '2-digit' 
    });

    const newRecord = {
        key: calcKey,
        custName: custName,
        custMapPin: "",
        dateAdded: dateStr,
        createdBy: appState.riderName || "Rider",
        pinCaptured: false
    };

    db.ref('mapCalculations/' + calcKey).set(newRecord);
    copyMapCalcCustomerMessage(custName, calcKey);
    showToast(`✅ Map Calc link created for ${custName}! Message copied.`);
    renderMapCalcBoardList();
}

export function copyMapCalcCustomerMessage(custName, calcKey) {
    const fullUrl = `${window.location.origin}${window.location.pathname}?mapcalc=${calcKey}`;
    const message = `Magandang araw po ${custName}! 👋\n\nPara ma-calculate po namin ang eksaktong distansya at delivery fee mula sa aming Hub papunta sa inyong lugar, paki-pindot lang po ang link na ito para ma-pin ang inyong lokasyon:\n\n${fullUrl}\n\n⚠️ PAALALA / INSTRUCTION:\nKung binuksan nyo po ito sa loob ng Messenger, paki-pindot po ang 3 dots (...) sa kanang itaas o ibaba at piliin ang "Open in Chrome" (para sa Android) o "Open in Safari" (para sa iPhone). Paki-approve o allow din po ang Location Access. Aabutin lang po ito ng 1 minuto para ma-pin ng ating system. Maraming salamat po! 🛵💙`;
    
    copyText(message);
}

export function renderMapCalcBoardList() {
    const container = document.getElementById('mapcalc-board-list');
    if (!container) return;

    const list = globalState.globalMapCalculations || [];
    if (list.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-10 text-xs">No map calculations created yet.</div>`;
        return;
    }

    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ["4547425", "5548562"].includes(appState.telegramId);

    container.innerHTML = list.slice().reverse().map(item => {
        const isPinned = item.pinCaptured && item.lat && item.lng;
        let statusBadge = isPinned 
            ? `<span class="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-500/30">📍 Pin Saved</span>`
            : `<span class="bg-amber-500/20 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-500/30">⏳ Awaiting Pin</span>`;

        let mapBtn = isPinned 
            ? `<button onclick="openMapCalcRoute(${item.lat}, ${item.lng}, '${escapeHtml(item.custName)}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95 flex items-center gap-1"><i class="fa-solid fa-route"></i> View Route & Distance</button>`
            : `<span class="text-[10px] text-gray-500 italic">No pin captured yet</span>`;

        let deleteBtn = isAdmin 
            ? `<button onclick="deleteMapCalcRecord('${item.key}', '${escapeHtml(item.custName)}')" class="text-red-400 hover:text-red-500 text-xs p-1" title="Delete Record"><i class="fa-solid fa-trash"></i></button>`
            : ``;

        return `
        <div class="bg-cardBg border border-gray-800 p-3 rounded-xl flex flex-col gap-1.5 text-xs shadow-sm">
            <div class="flex justify-between items-center font-bold">
                <span class="text-blue-300 flex items-center gap-1.5"><i class="fa-solid fa-user"></i> ${escapeHtml(item.custName)}</span>
                ${deleteBtn}
            </div>
            <div class="text-[10px] text-gray-400">Created by: ${escapeHtml(item.createdBy)} • ${escapeHtml(item.dateAdded)}</div>
            <div class="flex justify-between items-center mt-1 pt-1.5 border-t border-gray-800">
                ${statusBadge}
                <div class="flex items-center gap-1">
                    <button onclick="copyMapCalcCustomerMessage('${escapeHtml(item.custName)}', '${item.key}')" class="bg-blue-600/30 border border-blue-500/50 text-blue-300 hover:text-white font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95" title="Copy Message & Link">🔗 Copy Link</button>
                    ${mapBtn}
                </div>
            </div>
        </div>`;
    }).join('');
}

export function deleteMapCalcRecord(key, custName) {
    openSlideDeleteModal(`Sigurado ka bang nais burahin ang Map Calc record para kay [${custName}]?`, () => {
        db.ref('mapCalculations/' + key).remove();
        showToast(`Deleted Map Calc record for ${custName}`);

        fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({ type: "delete_map_calc", custName: custName })
        }).catch(() => {});
    });
}

// --- 4. ROUTE & DISTANCE DISPLAY FROM HUB ---
export function openMapCalcRoute(targetLat, targetLng, custName) {
    closeMapCalcBoardModal();
    switchView('view-map');
    
    document.getElementById('map-view-title').innerText = `Map Calc: ${custName}`;
    document.getElementById('map-center-pin').classList.add('hidden');
    document.getElementById('map-confirm-btn').classList.add('hidden');
    document.getElementById('map-nav-app-btn').classList.remove('hidden');

    const hubLoc = { lat: HUB_LOCATION.lat, lng: HUB_LOCATION.lng };
    const custLoc = { lat: parseFloat(targetLat), lng: parseFloat(targetLng) };
    activeNavTargetCoords = custLoc;

    const mapContainer = document.getElementById('google-map-container');
    if (!googleMapObj) {
        googleMapObj = new google.maps.Map(mapContainer, {
            center: hubLoc, zoom: 15, disableDefaultUI: false, zoomControl: true
        });
    }

    if (!mapDirectionsService) mapDirectionsService = new google.maps.DirectionsService();
    if (!mapDirectionsRenderer) {
        mapDirectionsRenderer = new google.maps.DirectionsRenderer({
            map: googleMapObj, suppressMarkers: false
        });
    }

    mapDirectionsService.route({
        origin: hubLoc,
        destination: custLoc,
        travelMode: google.maps.TravelMode.DRIVING
    }, (result, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
            mapDirectionsRenderer.setDirections(result);
            const routeLeg = result.routes[0].legs[0];
            showToast(`📏 Travel Distance: ${routeLeg.distance.text} (${routeLeg.duration.text} travel time)`);
        } else {
            showToast("Unable to calculate driving route.");
        }
    });
}

// --- 5. CUSTOMER PORTAL GPS CAPTURE (?mapcalc=KEY) ---
export function startMapCalcLocationSharing() {
    const urlParams = new URLSearchParams(window.location.search);
    const calcKey = urlParams.get('mapcalc');
    if (!calcKey) return;

    const btn = document.getElementById('mapcalc-cust-btn');
    const statusEl = document.getElementById('mapcalc-cust-status');
    const mapBox = document.getElementById('mapcalc-cust-map-box');

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Capturing GPS...`;

    if (!navigator.geolocation) {
        statusEl.className = "text-xs font-bold text-red-400 bg-red-500/10 p-3 rounded-xl border border-red-500/20";
        statusEl.innerText = "❌ Hindi suportado ang GPS sa browser na ito.";
        return;
    }

    mapBox.classList.remove('hidden');
    let shareCount = 0;

    const watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            shareCount++;
            const custLoc = { lat, lng };

            if (!custGoogleMapObj) {
                const mapEl = document.getElementById('mapcalc-cust-google-map');
                custGoogleMapObj = new google.maps.Map(mapEl, {
                    center: custLoc, zoom: 17, disableDefaultUI: true, zoomControl: true
                });
                custMarkerObj = new google.maps.Marker({
                    position: custLoc, map: custGoogleMapObj, title: "Iyong Lokasyon", animation: google.maps.Animation.DROP
                });
            } else {
                custGoogleMapObj.setCenter(custLoc);
                if (custMarkerObj) custMarkerObj.setPosition(custLoc);
            }

            const mapPinUrl = `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;

            db.ref('mapCalculations/' + calcKey).update({
                lat: lat, lng: lng, custMapPin: mapPinUrl, pinCaptured: true, capturedAt: Date.now()
            });

            statusEl.className = "text-xs font-bold text-emerald-400 bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20";
            statusEl.innerHTML = `📡 Capturing signal accuracy... (${shareCount}/20)<br><span class="text-gray-300 font-normal">Nasa-save na ang iyong lokasyon...</span>`;

            if (shareCount >= 20) {
                navigator.geolocation.clearWatch(watchId);
                statusEl.innerHTML = "🔒 <strong>Pin Permanently Saved (100%)!</strong><br><span class=\"text-gray-300 font-normal\">Nai-save na ang iyong lokasyon. Pwede mo nang isara ang window na ito.</span>";
                btn.innerHTML = `<i class="fa-solid fa-check-double"></i> DISTANCE PINNED`;
            }
        },
        (err) => {
            statusEl.className = "text-xs font-bold text-red-400 bg-red-500/10 p-3 rounded-xl border border-red-500/20";
            statusEl.innerText = "⚠️ Paki-allow ang GPS Location permission sa iyong browser.";
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> RETRY LOCATION CAPTURE`;
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// --- 6. RIDER MAP PIN PICKER ---
export function openMapPicker() {
    switchView('view-map');
    document.getElementById('map-view-title').innerText = "Pick Location Pin";
    document.getElementById('map-center-pin').classList.remove('hidden');
    document.getElementById('map-confirm-btn').classList.remove('hidden');
    document.getElementById('map-nav-app-btn').classList.add('hidden');

    const initOrCenterGoogleMap = (lat, lng) => {
        const mapCenter = { lat: parseFloat(lat), lng: parseFloat(lng) };
        const mapContainer = document.getElementById('google-map-container');

        if (!googleMapObj) {
            googleMapObj = new google.maps.Map(mapContainer, {
                center: mapCenter, zoom: 17, disableDefaultUI: false, zoomControl: true, mapTypeControl: false, streetViewControl: false, fullscreenControl: false
            });
        } else {
            googleMapObj.setCenter(mapCenter);
        }

        appState.lat = lat;
        appState.lon = lng;
    };

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => initOrCenterGoogleMap(pos.coords.latitude, pos.coords.longitude),
            () => initOrCenterGoogleMap(appState.lat || HUB_LOCATION.lat, appState.lon || HUB_LOCATION.lng),
            { enableHighAccuracy: true, timeout: 5000 }
        );
    } else {
        initOrCenterGoogleMap(appState.lat || HUB_LOCATION.lat, appState.lon || HUB_LOCATION.lng);
    }
}

export function confirmGoogleMapPin() {
    if (googleMapObj) {
        const center = googleMapObj.getCenter();
        const lat = center.lat().toFixed(6);
        const lng = center.lng().toFixed(6);
        const mapLink = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

        document.getElementById('form-latlon').value = mapLink;
        appState.lat = center.lat();
        appState.lon = center.lng();
    }
    goBack();
}