// src/features/maps/mapCalculation.js
import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { HUB_LOCATION, API_URL } from '../../config/constants.js';
import { showToast } from '../../ui/notifications.js';
import { switchView } from '../../ui/router.js';
import { escapeHtml, copyText } from '../../utils/helpers.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { mapState } from './mapState.js';

export function getMapCalcShareUrl(calcKey) {
    const origin = window.location.origin;
    const pathname = window.location.pathname;
    return `${origin}${pathname}?mapcalc=${calcKey}`;
}

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
    if (!custName) return showToast("⚠️ Paki-lagay ang Customer Name!");

    closeMapCalcNameModal();

    const calcKey = `CALC_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).substring(2,6).toUpperCase()}`;
    const dateStr = new Date().toLocaleDateString('en-US', { 
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' 
    });
    const creator = appState.riderName || localStorage.getItem('riderName') || "Rider";

    const newRecord = {
        id: calcKey,
        key: calcKey,
        custName: custName,
        customerName: custName,
        custMapPin: "",
        mapLink: "",
        lat_lon_link: "",
        dateAdded: dateStr,
        createdAt: Date.now(),
        createdBy: creator,
        riderName: creator,
        status: "Awaiting Pin",
        pinCaptured: false
    };

    if (db) {
        await db.ref('mapCalculations/' + calcKey).set(newRecord).catch(() => {});
    }

    copyMapCalcCustomerMessage(custName, calcKey);
    showToast(`✅ Map Calc link created for ${custName}!`);
    renderMapCalcBoardList();
}

export const startMapCalcForCustomer = confirmGenerateMapCalcLink;

export function copyMapCalcCustomerMessage(custName, calcKey) {
    if (!custName) custName = "Customer";
    const fullUrl = getMapCalcShareUrl(calcKey);
    const message = `Magandang araw po ${custName}! 👋\n\nIn order for us to calculate your accurate location and delivery fee please click on the link and follow the instructions on the next screen, you can also copy the link below and use google chrome to open the link. please do not use safari:\n\n${fullUrl}\n\n⚠️ PAALALA:\nKung binuksan nyo po sa Messenger, paki-pindot ang 3 dots (...) sa itaas at piliin ang "Open in Chrome". Maraming salamat po! 🛵💙`;
    
    copyText(message);
    showToast(`🔗 Distance calc message & link copied for ${custName}!`);
}

export function copyMapCalcLink(id, rawLink, customerName = "") {
    copyMapCalcCustomerMessage(customerName, id);
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

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Capturing GPS...`;
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
            const accuracy = Math.round(pos.coords.accuracy || 0);
            shareCount++;
            const custLoc = { lat, lng };

            if (!mapState.custGoogleMapObj && typeof google !== 'undefined' && google.maps) {
                const mapEl = document.getElementById('mapcalc-cust-google-map');
                if (mapEl) {
                    mapState.custGoogleMapObj = new google.maps.Map(mapEl, {
                        center: custLoc, zoom: 17, disableDefaultUI: true, zoomControl: true
                    });
                    mapState.custMarkerObj = new google.maps.Marker({
                        position: custLoc, map: mapState.custGoogleMapObj, title: "Iyong Lokasyon", animation: google.maps.Animation.DROP
                    });
                }
            } else if (mapState.custGoogleMapObj && mapState.custMarkerObj) {
                mapState.custGoogleMapObj.setCenter(custLoc);
                mapState.custMarkerObj.setPosition(custLoc);
            }

            const mapPinUrl = `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;

            if (db) {
                db.ref('mapCalculations/' + calcKey).update({
                    lat: lat,
                    lng: lng,
                    latitude: lat,
                    longitude: lng,
                    custMapPin: mapPinUrl,
                    mapLink: mapPinUrl,
                    lat_lon_link: mapPinUrl,
                    pinCaptured: true,
                    pinSaved: true,
                    status: "Pin Saved",
                    accuracy: accuracy,
                    capturedAt: Date.now()
                }).catch(() => {});
            }

            if (statusEl) {
                statusEl.className = "text-xs font-bold text-emerald-400 bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20";
                statusEl.innerHTML = `📡 Signal Accuracy: ±${accuracy}m (Fix ${shareCount})<br><span class="text-gray-300 font-normal">Nasa-save na ang iyong lokasyon...</span>`;
            }

            if (accuracy <= 25 || shareCount >= 3) {
                try { navigator.geolocation.clearWatch(watchId); } catch(e) {}
                if (statusEl) {
                    statusEl.innerHTML = `🔒 <strong>Pin Permanently Saved!</strong><br><span class="text-gray-300 font-normal">Nai-save na ang iyong lokasyon (±${accuracy}m). Pwede mo nang isara ang window na ito.</span>`;
                }
                if (btn) {
                    btn.innerHTML = `<i class="fa-solid fa-check-double"></i> DISTANCE PINNED`;
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
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    );
}

export function renderMapCalcBoardList() {
    const container = document.getElementById('mapcalc-board-list') || document.getElementById('mapcalc-list-container');
    if (!container) return;

    const list = globalState.globalMapCalculations || [];

    const topButtonHtml = `
    <button onclick="window.promptMapCalcCustomerName && window.promptMapCalcCustomerName()" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-lg transition active:scale-95 mb-3">
        <i class="fa-solid fa-circle-plus"></i> + Generate Link
    </button>`;

    if (list.length === 0) {
        container.innerHTML = topButtonHtml + `<div class="text-center text-gray-500 italic py-10 text-xs">No map calculations created yet.</div>`;
        return;
    }

    const isAdmin = (appState.userType || "").toLowerCase() === "admin" || ["4547425", "5548562"].includes(appState.telegramId);

    const cardsHtml = list.slice().reverse().map(item => {
        const itemKey = item.key || item.id;
        const custName = item.custName || item.customerName || "Customer";
        const isPinned = !!((item.pinCaptured || item.pinSaved) && item.lat && item.lng);

        const latVal = item.lat || item.latitude || 0;
        const lngVal = item.lng || item.longitude || 0;

        let statusBadge = isPinned 
            ? `<span class="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-500/30">📍 Pin Saved</span>`
            : `<span class="bg-amber-500/20 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-500/30">⏳ Awaiting Pin</span>`;

        let mapBtn = isPinned 
            ? `<button onclick="window.openMapCalcRoute && window.openMapCalcRoute('${latVal}', '${lngVal}', '${escapeHtml(custName)}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95 flex items-center gap-1"><i class="fa-solid fa-route"></i> View Route & Distance</button>`
            : `<span class="text-[10px] text-gray-500 italic">No pin captured yet</span>`;

        let deleteBtn = isAdmin 
            ? `<button onclick="window.deleteMapCalcRecord && window.deleteMapCalcRecord('${itemKey}', '${escapeHtml(custName)}')" class="text-red-400 hover:text-red-500 text-xs p-1" title="Delete Record"><i class="fa-solid fa-trash"></i></button>`
            : ``;

        const creator = item.createdBy || item.riderName || "Rider";
        const dateDisplay = item.dateAdded || (item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "");

        return `
        <div class="bg-cardBg border border-gray-800 p-3 rounded-xl flex flex-col gap-1.5 text-xs shadow-sm mb-2">
            <div class="flex justify-between items-center font-bold">
                <span class="text-blue-300 flex items-center gap-1.5"><i class="fa-solid fa-user"></i> ${escapeHtml(custName)}</span>
                ${deleteBtn}
            </div>
            <div class="text-[10px] text-gray-400">Created by: ${escapeHtml(creator)} ${dateDisplay ? `• ${escapeHtml(dateDisplay)}` : ''}</div>
            <div class="flex justify-between items-center mt-1 pt-1.5 border-t border-gray-800">
                ${statusBadge}
                <div class="flex items-center gap-1">
                    <button onclick="window.copyMapCalcCustomerMessage && window.copyMapCalcCustomerMessage('${escapeHtml(custName)}', '${itemKey}')" class="bg-blue-600/30 border border-blue-500/50 text-blue-300 hover:text-white font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95" title="Copy Message & Link">🔗 Copy Link</button>
                    ${mapBtn}
                </div>
            </div>
        </div>`;
    }).join('');

    container.innerHTML = topButtonHtml + cardsHtml;
}

export const fetchAndRenderMapCalculations = renderMapCalcBoardList;

export function openMapCalcRoute(targetLat, targetLng, custName) {
    closeMapCalcBoardModal();
    switchView('view-map');
    
    const titleEl = document.getElementById('map-view-title');
    if (titleEl) titleEl.innerText = `Map Calc: ${custName || 'Customer'}`;

    const searchBarContainer = document.getElementById('map-search-bar-container');
    if (searchBarContainer) searchBarContainer.classList.add('hidden');
    
    const centerPin = document.getElementById('map-center-pin');
    const confirmBtn = document.getElementById('map-confirm-btn');
    const navBtn = document.getElementById('map-nav-app-btn');

    if (centerPin) centerPin.classList.add('hidden');
    if (confirmBtn) confirmBtn.classList.add('hidden');
    if (navBtn) navBtn.classList.remove('hidden');

    const hubLoc = { lat: HUB_LOCATION.lat, lng: HUB_LOCATION.lng };
    const custLoc = { lat: parseFloat(targetLat), lng: parseFloat(targetLng) };
    mapState.activeNavTargetCoords = custLoc;

    const mapContainer = document.getElementById('google-map-container');
    if (!mapState.googleMapObj) {
        mapState.googleMapObj = new google.maps.Map(mapContainer, { center: hubLoc, zoom: 15, disableDefaultUI: false, zoomControl: true });
    }

    if (!mapState.mapDirectionsService) mapState.mapDirectionsService = new google.maps.DirectionsService();
    if (!mapState.mapDirectionsRenderer) {
        mapState.mapDirectionsRenderer = new google.maps.DirectionsRenderer({ 
            map: mapState.googleMapObj, 
            suppressMarkers: false,
            polylineOptions: {
                strokeColor: '#10B981',
                strokeWeight: 6,
                strokeOpacity: 0.85
            }
        });
    }

    mapState.mapDirectionsService.route({
        origin: hubLoc, destination: custLoc, travelMode: google.maps.TravelMode.DRIVING
    }, (result, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
            mapState.mapDirectionsRenderer.setDirections(result);
            const routeLeg = result.routes[0].legs[0];
            showToast(`📏 Travel Distance: ${routeLeg.distance.text} (${routeLeg.duration.text} travel time)`);
        } else {
            showToast("Unable to calculate driving route.");
        }
    });
}

export function viewMapCalcRoute(id, lat, lng, custName = "Customer") {
    openMapCalcRoute(lat, lng, custName);
}

export function deleteMapCalcRecord(key, custName) {
    openSlideDeleteModal(`Sigurado ka bang nais burahin ang Map Calc record para kay [${custName}]?`, () => {
        if (db && key) {
            db.ref('mapCalculations/' + key).remove();
        }
        showToast(`Deleted Map Calc record for ${custName}`);
        fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ type: "delete_map_calc", custName: custName }) }).catch(() => {});
    });
}

export const deleteMapCalculation = deleteMapCalcRecord;