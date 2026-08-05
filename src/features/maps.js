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

let trackingHistory = JSON.parse(localStorage.getItem('lokalex_tracking_history') || '{}');

// ============================================================================
// 1. DELIVERY TRACKING SYSTEM (?track=KEY) - FROM CATERING LINEUP
// ============================================================================
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

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Kumukuha ng GPS...`;

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

            if (!custGoogleMapObj && typeof google !== 'undefined' && google.maps) {
                const mapEl = document.getElementById('cust-google-map');
                custGoogleMapObj = new google.maps.Map(mapEl, {
                    center: custLoc, zoom: 17, disableDefaultUI: true, zoomControl: true
                });
                custMarkerObj = new google.maps.Marker({
                    position: custLoc, map: custGoogleMapObj, title: "Iyong Lokasyon", animation: google.maps.Animation.DROP
                });
            } else if (custGoogleMapObj && custMarkerObj) {
                custGoogleMapObj.setCenter(custLoc);
                custMarkerObj.setPosition(custLoc);
            }

            db.ref('liveTracking/' + trackKey).set({
                lat: lat, lng: lng, capturedAt: Date.now()
            });

            statusEl.className = "text-xs font-bold text-blue-400 bg-blue-500/10 p-3 rounded-xl border border-blue-500/20";
            statusEl.innerHTML = `📡 Capturing signal accuracy... (${shareCount}/20)<br><span class="text-gray-300 font-normal">Nasa-save na ang iyong lokasyon...</span>`;

            if (shareCount >= 20) {
                navigator.geolocation.clearWatch(watchId);
                statusEl.innerHTML = "🔒 <strong>Pin Permanently Saved (100%)!</strong><br><span class=\"text-gray-300 font-normal\">Nai-save na ang iyong lokasyon. Ipaalam na ito sa rider.</span>";
                btn.innerHTML = `<i class="fa-solid fa-check-double"></i> LOCATION PINNED`;
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

export async function openLiveCustomerMap(custName) {
    if (!custName) custName = "Customer";

    const rName = (appState.riderName || "RIDER").replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const cleanCust = custName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const todayClean = getLocalTodayStr().replace(/-/g, '');
    const sessionKey = `${rName}_${cleanCust}_${todayClean}`;

    let trackKey = trackingHistory[sessionKey] && trackingHistory[sessionKey].activeKey 
        ? trackingHistory[sessionKey].activeKey 
        : `${rName}_${cleanCust}_${todayClean}`;

    switchView('view-map');
    document.getElementById('map-view-title').innerText = `Tracking: ${custName}`;
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
    if (!mapDirectionsRenderer) mapDirectionsRenderer = new google.maps.DirectionsRenderer({ map: googleMapObj, suppressMarkers: false });

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

// ============================================================================
// 2. MAP CALCULATION SYSTEM (?mapcalc=KEY) - DISTANCE CALCULATION
// ============================================================================
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
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' 
    });

    const newRecord = {
        key: calcKey, custName: custName, custMapPin: "", dateAdded: dateStr,
        createdBy: appState.riderName || "Rider", pinCaptured: false
    };

    db.ref('mapCalculations/' + calcKey).set(newRecord);
    copyMapCalcCustomerMessage(custName, calcKey);
    showToast(`✅ Map Calc link created for ${custName}!`);
    renderMapCalcBoardList();
}

export function copyMapCalcCustomerMessage(custName, calcKey) {
    if (!custName) custName = "Customer";
    const fullUrl = `${window.location.origin}${window.location.pathname}?mapcalc=${calcKey}`;
    const message = `Magandang araw po ${custName}! 👋\n\nIn order for us to calculate your accurate location and delivery fee please click on the link and follow the instructions on the next screen, you can also copy the link below and use google chrome to open the link. please do not use safari:\n\n${fullUrl}\n\n⚠️ PAALALA:\nKung binuksan nyo po sa Messenger, paki-pindot ang 3 dots (...) sa itaas at piliin ang "Open in Chrome". Maraming salamat po! 🛵💙`;
    
    copyText(message);
    showToast(`🔗 Distance calc message & link copied for ${custName}!`);
}

export function checkAndInitMapCalcPortal() {
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.has('mapcalc')) return;
    const portal = document.getElementById('mapcalc-customer-portal');
    if (portal) portal.classList.remove('hidden');
}

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

            if (!custGoogleMapObj && typeof google !== 'undefined' && google.maps) {
                const mapEl = document.getElementById('mapcalc-cust-google-map');
                custGoogleMapObj = new google.maps.Map(mapEl, {
                    center: custLoc, zoom: 17, disableDefaultUI: true, zoomControl: true
                });
                custMarkerObj = new google.maps.Marker({
                    position: custLoc, map: custGoogleMapObj, title: "Iyong Lokasyon", animation: google.maps.Animation.DROP
                });
            } else if (custGoogleMapObj && custMarkerObj) {
                custGoogleMapObj.setCenter(custLoc);
                custMarkerObj.setPosition(custLoc);
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
        googleMapObj = new google.maps.Map(mapContainer, { center: hubLoc, zoom: 15, disableDefaultUI: false, zoomControl: true });
    }

    if (!mapDirectionsService) mapDirectionsService = new google.maps.DirectionsService();
    if (!mapDirectionsRenderer) mapDirectionsRenderer = new google.maps.DirectionsRenderer({ map: googleMapObj, suppressMarkers: false });

    mapDirectionsService.route({
        origin: hubLoc, destination: custLoc, travelMode: google.maps.TravelMode.DRIVING
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

export function deleteMapCalcRecord(key, custName) {
    openSlideDeleteModal(`Sigurado ka bang nais burahin ang Map Calc record para kay [${custName}]?`, () => {
        db.ref('mapCalculations/' + key).remove();
        showToast(`Deleted Map Calc record for ${custName}`);
        fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ type: "delete_map_calc", custName: custName }) }).catch(() => {});
    });
}

// ============================================================================
// 3. RIDER MAP PIN PICKER (MANUAL FORMS)
// ============================================================================
export function openExternalGoogleNav() {
    if (!activeNavTargetCoords) return showToast("No customer GPS pin received yet.");
    const url = `https://www.google.com/maps/dir/?api=1&destination=${activeNavTargetCoords.lat},${activeNavTargetCoords.lng}&travelmode=driving`;
    window.open(url, '_blank');
}

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

// ============================================================================
// 4. FIND MY RIDERS MAP SYSTEM (ACCURATE REALTIME & FRESHNESS AGING)
// ============================================================================
let findRidersMapObj = null;
let findRidersMarkers = [];

export async function openFindRidersModal() {
    const modal = document.getElementById('find-riders-modal');
    if (!modal) {
        showToast("⚠️ find-riders-modal missing from index.html");
        return;
    }
    modal.classList.remove('hidden');
    await fetchLatestRiderPositions();
}

export function closeFindRidersModal() {
    const modal = document.getElementById('find-riders-modal');
    if (modal) modal.classList.add('hidden');
}

export async function refreshFindRidersMap() {
    const icon = document.getElementById('find-riders-refresh-icon');
    if (icon) icon.classList.add('fa-spin');

    await fetchLatestRiderPositions();
    showToast("🔄 Rider locations updated!");

    setTimeout(() => {
        if (icon) icon.classList.remove('fa-spin');
    }, 600);
}

export async function fetchLatestRiderPositions() {
    try {
        const rosterSnap = await db.ref('roster').once('value');
        if (rosterSnap.exists()) {
            globalState.rosterMembers = Object.values(rosterSnap.val());
        }

        const sessionSnap = await db.ref('liveSessions').once('value');
        let activeLiveRiders = {};
        if (sessionSnap.exists()) {
            const sessions = sessionSnap.val();
            Object.values(sessions).forEach(sess => {
                if (sess.status === 'active' && sess.users && sess.users.rider) {
                    const rData = sess.users.rider;
                    if (rData.lat && rData.lng) {
                        activeLiveRiders[(rData.name || '').toLowerCase()] = {
                            lat: rData.lat,
                            lng: rData.lng,
                            updatedAt: rData.updatedAt
                        };
                    }
                }
            });
        }
        
        renderFindRidersMap(activeLiveRiders);
    } catch(e) {
        console.error("Error fetching fresh rider positions:", e);
        renderFindRidersMap({});
    }
}

function getRelativeTimeAgo(timestamp) {
    if (!timestamp) return "Unknown";
    const diffSecs = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diffSecs < 60) return `${diffSecs}s ago`;
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h ago`;
}

export function renderFindRidersMap(activeLiveRiders = {}) {
    if (typeof google === 'undefined' || !google.maps) return;

    const container = document.getElementById('find-riders-google-map');
    if (!container) return;

    findRidersMarkers.forEach(m => m.setMap(null));
    findRidersMarkers = [];

    const roster = globalState.rosterMembers || [];
    const logins = globalState.globalLogins || [];

    const activeRiders = roster.filter(m => ['Available', 'Catering', 'Break'].includes(m.status));

    let countAvail = 0, countCater = 0, countBreak = 0;
    const bounds = new google.maps.LatLngBounds();
    let hasValidCoords = false;

    activeRiders.forEach(r => {
        if (r.status === 'Available') countAvail++;
        else if (r.status === 'Catering') countCater++;
        else if (r.status === 'Break') countBreak++;

        const rNameKey = (r.riderName || r.name || "").toLowerCase();
        let lat = parseFloat(r.lat);
        let lng = parseFloat(r.lng);
        let updatedAt = r.locationUpdatedAt || null;
        let accuracy = r.accuracy || 0;
        let locationSource = "Roster GPS";

        if (activeLiveRiders[rNameKey]) {
            lat = parseFloat(activeLiveRiders[rNameKey].lat);
            lng = parseFloat(activeLiveRiders[rNameKey].lng);
            updatedAt = activeLiveRiders[rNameKey].updatedAt;
            locationSource = "📡 Live Delivery Stream";
        } else if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
            const userLogin = logins.slice().reverse().find(l => {
                const lName = (l.riderName || "").toLowerCase();
                return (lName && lName === rNameKey) && l.location;
            });

            if (userLogin && userLogin.location) {
                const match = userLogin.location.match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);
                if (match) {
                    lat = parseFloat(match[1]);
                    lng = parseFloat(match[2]);
                    locationSource = "⚠️ Initial Shift Login";
                }
            }
        }

        if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
            hasValidCoords = true;
            const pos = { lat, lng };
            bounds.extend(pos);

            let iconUrl = "http://maps.google.com/mapfiles/ms/icons/green-dot.png";
            if (r.status === 'Catering') iconUrl = "http://maps.google.com/mapfiles/ms/icons/red-dot.png";
            else if (r.status === 'Break') iconUrl = "http://maps.google.com/mapfiles/ms/icons/yellow-dot.png";

            const rNameDisplay = r.riderName || r.name || "Rider";
            const custInfo = r.customerName ? ` (${r.customerName})` : "";
            const agoStr = getRelativeTimeAgo(updatedAt);
            const accStr = accuracy ? ` (±${Math.round(accuracy)}m)` : '';

            const marker = new google.maps.Marker({
                position: pos,
                title: `${rNameDisplay} - ${r.status}${custInfo}`,
                icon: { url: iconUrl }
            });

            const infoWindow = new google.maps.InfoWindow({
                content: `<div style="color:black; font-weight:bold; font-size:12px; padding:4px;">
                    <div style="font-size:13px; color:#1e293b;">🛵 ${escapeHtml(rNameDisplay)}</div>
                    <div style="font-size:10px; color:#475569; margin-top:2px;">Status: <strong>${escapeHtml(r.status)}</strong>${escapeHtml(custInfo)}</div>
                    <div style="font-size:10px; color:#2563eb; margin-top:2px;">Source: ${locationSource}</div>
                    <div style="font-size:9px; color:#059669; margin-top:2px;">Freshness: ${agoStr}${accStr}</div>
                </div>`
            });

            marker.addListener('click', () => {
                infoWindow.open(findRidersMapObj, marker);
            });

            findRidersMarkers.push(marker);
        }
    });

    const defaultCenter = HUB_LOCATION || { lat: 15.6881, lng: 120.4144 };

    if (!findRidersMapObj) {
        findRidersMapObj = new google.maps.Map(container, {
            center: defaultCenter,
            zoom: 14,
            disableDefaultUI: false,
            zoomControl: true
        });
    }

    findRidersMarkers.forEach(m => m.setMap(findRidersMapObj));

    if (hasValidCoords) {
        findRidersMapObj.fitBounds(bounds);
        if (findRidersMarkers.length === 1) {
            findRidersMapObj.setZoom(16);
        }
    } else {
        findRidersMapObj.setCenter(defaultCenter);
        findRidersMapObj.setZoom(14);
    }

    const summaryEl = document.getElementById('find-riders-status-summary');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div><span class="text-green-400 font-bold">🟢 Available:</span> ${countAvail}</div>
            <div><span class="text-red-400 font-bold">🔴 Catering:</span> ${countCater}</div>
            <div><span class="text-yellow-400 font-bold">☕ Break:</span> ${countBreak}</div>
        `;
    }
}

if (typeof window !== 'undefined') {
    window.openFindRidersModal = openFindRidersModal;
    window.closeFindRidersModal = closeFindRidersModal;
    window.refreshFindRidersMap = refreshFindRidersMap;
    window.copyMapCalcCustomerMessage = copyMapCalcCustomerMessage;
}