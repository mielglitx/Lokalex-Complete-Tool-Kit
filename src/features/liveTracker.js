// src/features/liveTracker.js
import { db } from '../config/firebase.js';
import { appState, globalState } from '../store/state.js';
import { showToast, showSideNotification } from '../ui/notifications.js';
import { copyText, escapeHtml } from '../utils/helpers.js';
import { openSlideDeleteModal } from '../ui/modals.js';

let activeSessionKey = localStorage.getItem('lokalex_active_live_session') || "";
let riderGpsWatchId = null;
let customerGpsWatchId = null;
let liveMapObj = null;
let riderMarker = null;
let customerMarker = null;
let liveDirectionsService = null;
let liveDirectionsRenderer = null;
let lastRouteCalcTime = 0;

let lastPushTime = 0;
const PUSH_TICK_INTERVAL_MS = 15000; // 15 seconds throttled tick for both Rider & Customer
const ROUTE_THROTTLE_MS = 10000;     // 10 seconds throttle for Directions Service API

// --- AUTOMATED BACKGROUND LIVE GPS INITIATOR ---
export async function autoStartLiveGpsSession(custName = "Customer") {
    let existingKey = localStorage.getItem('lokalex_active_live_session');
    
    if (existingKey) {
        activeSessionKey = existingKey;
        startRiderGpsTracking(existingKey);
        return existingKey;
    }

    const sessionKey = `LIVE_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).substring(2,6).toUpperCase()}`;
    activeSessionKey = sessionKey;
    localStorage.setItem('lokalex_active_live_session', sessionKey);

    const initialData = {
        status: "active",
        riderName: appState.riderName || "Rider",
        customerName: custName,
        createdAt: Date.now(),
        users: {}
    };

    try {
        await db.ref('liveSessions/' + sessionKey).set(initialData);
        startRiderGpsTracking(sessionKey);
    } catch(e) {
        console.error("Auto Live GPS initialization error:", e);
    }

    return sessionKey;
}

export async function promptStartLiveGpsSession() {
    const activeCustRecord = globalState.rosterMembers ? globalState.rosterMembers.find(m => (m.telegramId || "").toString() === (appState.telegramId || "").toString()) : null;
    const currentCust = (activeCustRecord && activeCustRecord.customerName) ? activeCustRecord.customerName.split(', ')[0] : "Customer";

    const sessionKey = await autoStartLiveGpsSession(currentCust);
    copyLiveGpsLink(currentCust, sessionKey);
    openLiveGpsManageModal();
}

export function copyLiveGpsLink(custName = "Customer", sessionKey = activeSessionKey) {
    if (!sessionKey) return showToast("Walang active na live GPS session.");

    const fullUrl = `${window.location.origin}${window.location.pathname}?livegps=${sessionKey}`;
    const message = `Magandang araw po ${custName}! 👋\n\nNagsimula na po ang ating Mutual Live GPS Tracking! Pwede niyo pong subaybayan ang aking lokasyon habang papalapit sa inyo at makikita rin natin ang isa't isa sa mapa sa pamamagitan ng link na ito:\n\n${fullUrl}\n\n⚠️ PAALALA:\nKung binuksan nyo po sa Messenger, paki-pindot ang 3 dots (...) at piliin ang "Open in Chrome" o "Open in Safari". Paki-allow din po ang Location Access. Maraming salamat po! 🛵💙`;

    copyText(message);
    showToast("🔗 Live GPS message & link copied!");
}

export function startRiderGpsTracking(sessionKey) {
    if (!sessionKey) return;
    if (riderGpsWatchId) navigator.geolocation.clearWatch(riderGpsWatchId);
    if (!navigator.geolocation) return;

    // Immediately record initial position
    navigator.geolocation.getCurrentPosition((pos) => {
        const now = Date.now();
        lastPushTime = now;
        db.ref(`liveSessions/${sessionKey}/users/rider`).set({
            name: appState.riderName || "Rider",
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            speed: pos.coords.speed || 0,
            updatedAt: now
        });
    }, () => {}, { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });

    riderGpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const now = Date.now();
            if (now - lastPushTime >= PUSH_TICK_INTERVAL_MS) {
                lastPushTime = now;
                db.ref(`liveSessions/${sessionKey}/users/rider`).set({
                    name: appState.riderName || "Rider",
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    speed: pos.coords.speed || 0,
                    updatedAt: now
                });
            }
        },
        (err) => {},
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    );
}

export function openLiveGpsManageModal() {
    const modal = document.getElementById('livegps-manage-modal');
    if (modal) modal.classList.remove('hidden');
    renderLiveGpsManageStatus();
}

export function closeLiveGpsManageModal() {
    const modal = document.getElementById('livegps-manage-modal');
    if (modal) modal.classList.add('hidden');
}

function renderLiveGpsManageStatus() {
    const statusBox = document.getElementById('livegps-manage-status-box');
    if (!statusBox || !activeSessionKey) return;

    db.ref('liveSessions/' + activeSessionKey).on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data || data.status === 'ended') {
            statusBox.innerHTML = `<span class="text-red-400 font-bold text-xs"><i class="fa-solid fa-circle-xmark"></i> Session Inactive / Ended</span>`;
            return;
        }

        const hasCustomer = data.users && data.users.customer;
        statusBox.innerHTML = `
            <div class="flex flex-col gap-1 text-left text-xs">
                <div class="flex justify-between items-center">
                    <span class="text-gray-400">Customer Connected:</span>
                    ${hasCustomer 
                        ? `<span class="text-emerald-400 font-bold bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/30">🟢 Connected</span>` 
                        : `<span class="text-amber-400 font-bold bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30 animate-pulse">⏳ Waiting...</span>`}
                </div>
                <div class="text-[10px] text-gray-500 mt-1">Tick interval: 15s (Data Saver)</div>
            </div>`;
    });
}

// --- RIDER: SHOW / HIDE MAP ---
export function showRiderLiveMap() {
    if (!activeSessionKey) return showToast("No active session.");
    closeLiveGpsManageModal();

    const riderBtn = document.getElementById('livegps-rider-close-btn');
    const custControls = document.getElementById('livegps-customer-controls');

    if (riderBtn) riderBtn.classList.remove('hidden');
    if (custControls) custControls.classList.add('hidden');

    startMutualMapSync(activeSessionKey);
}

export function closeRiderLiveMap() {
    const portal = document.getElementById('livegps-portal');
    if (portal) portal.classList.add('hidden');
    openLiveGpsManageModal();
}

// --- CUSTOMER: INITIALIZE PORTAL ---
export function checkAndInitLiveGpsPortal() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionKey = urlParams.get('livegps');
    if (!sessionKey) return;

    const riderBtn = document.getElementById('livegps-rider-close-btn');
    const custControls = document.getElementById('livegps-customer-controls');

    if (riderBtn) riderBtn.classList.add('hidden');
    if (custControls) custControls.classList.remove('hidden');

    startMutualMapSync(sessionKey);
}

// --- SHARED MAP SYNC LOGIC ---
function startMutualMapSync(sessionKey) {
    const portal = document.getElementById('livegps-portal');
    const expiredPortal = document.getElementById('livegps-expired-portal');
    if (!portal) return;

    db.ref('liveSessions/' + sessionKey).on('value', (snapshot) => {
        const data = snapshot.val();

        if (!data || data.status === 'ended') {
            portal.classList.add('hidden');
            if (expiredPortal) expiredPortal.classList.remove('hidden');
            if (customerGpsWatchId) navigator.geolocation.clearWatch(customerGpsWatchId);
            return;
        }

        if (expiredPortal) expiredPortal.classList.add('hidden');
        portal.classList.remove('hidden');

        renderMutualLiveMap(data.users);
    });
}

// --- CUSTOMER: SHARE GPS LOCATION ---
export function startMutualCustomerLocationSharing() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionKey = urlParams.get('livegps');
    if (!sessionKey) return;

    const btn = document.getElementById('livegps-share-btn');
    const statusEl = document.getElementById('livegps-status');
    const mapBox = document.getElementById('livegps-map-container-box');
    const step2Pointer = document.getElementById('livegps-step2-pointer');

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
    if (step2Pointer) step2Pointer.classList.add('hidden');

    customerGpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const now = Date.now();
            if (now - lastPushTime >= PUSH_TICK_INTERVAL_MS) {
                lastPushTime = now;
                db.ref(`liveSessions/${sessionKey}/users/customer`).set({
                    name: "Customer",
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    updatedAt: now
                });
            }

            if (statusEl) {
                statusEl.className = "text-xs font-bold text-indigo-400 bg-indigo-500/10 p-2.5 rounded-xl border border-indigo-500/20";
                statusEl.innerHTML = "📡 <strong>Live Tracking Active</strong><br><span class=\"text-gray-300 font-normal\">Updating map every 15 seconds...</span>";
            }
            if (btn) btn.innerHTML = `<i class="fa-solid fa-check-double"></i> TRACKING ACTIVE`;
        },
        (err) => {
            if (statusEl) {
                statusEl.className = "text-xs font-bold text-red-400 bg-red-500/10 p-3 rounded-xl border border-red-500/20";
                statusEl.innerText = "⚠️ Paki-allow ang GPS Location permission sa iyong browser.";
            }
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-satellite-dish"></i> RETRY JOIN LIVE TRACKING`;
            }
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    );
}

// --- RENDER MAP, ROUTE POLYLINE & LIVE ETA ---
function renderMutualLiveMap(usersData) {
    if (typeof google === 'undefined' || !google.maps) return;

    const container = document.getElementById('livegps-map-container');
    const mapBox = document.getElementById('livegps-map-container-box');
    const etaHud = document.getElementById('livegps-eta-hud');
    const etaText = document.getElementById('livegps-eta-text');
    const distanceText = document.getElementById('livegps-distance-text');
    
    if (!container || (mapBox && mapBox.classList.contains('hidden') && document.getElementById('livegps-customer-controls')?.classList.contains('hidden') === false)) return;

    const riderData = usersData && usersData.rider;
    const custData = usersData && usersData.customer;

    const defaultCenter = riderData ? { lat: riderData.lat, lng: riderData.lng } : (custData ? { lat: custData.lat, lng: custData.lng } : { lat: 15.6881, lng: 120.4144 });

    if (!liveMapObj) {
        liveMapObj = new google.maps.Map(container, {
            center: defaultCenter,
            zoom: 16,
            disableDefaultUI: false,
            zoomControl: true,
            mapTypeId: 'roadmap'
        });
    }

    if (!liveDirectionsService) {
        liveDirectionsService = new google.maps.DirectionsService();
    }

    if (!liveDirectionsRenderer) {
        liveDirectionsRenderer = new google.maps.DirectionsRenderer({
            map: liveMapObj,
            suppressMarkers: true,
            polylineOptions: {
                strokeColor: '#3B82F6',
                strokeWeight: 5,
                strokeOpacity: 0.85
            }
        });
    }

    if (riderData && riderData.lat && riderData.lng) {
        const pos = { lat: riderData.lat, lng: riderData.lng };
        if (!riderMarker) {
            riderMarker = new google.maps.Marker({
                position: pos,
                map: liveMapObj,
                title: `Rider: ${riderData.name || 'Rider'}`,
                icon: { 
                    url: "https://img.icons8.com/color/48/motorcycle.png", 
                    scaledSize: new google.maps.Size(36, 36)
                }
            });
        } else {
            riderMarker.setPosition(pos);
        }
    }

    if (custData && custData.lat && custData.lng) {
        const pos = { lat: custData.lat, lng: custData.lng };
        if (!customerMarker) {
            customerMarker = new google.maps.Marker({
                position: pos,
                map: liveMapObj,
                title: "Customer Location",
                icon: { 
                    url: "http://maps.google.com/mapfiles/ms/icons/red-dot.png" 
                }
            });
        } else {
            customerMarker.setPosition(pos);
        }
    }

    // Calculate Real-time Polylines & Live ETA between Rider and Customer
    if (riderData && riderData.lat && riderData.lng && custData && custData.lat && custData.lng) {
        const riderPos = { lat: riderData.lat, lng: riderData.lng };
        const custPos = { lat: custData.lat, lng: custData.lng };

        const now = Date.now();
        if (now - lastRouteCalcTime >= ROUTE_THROTTLE_MS || lastRouteCalcTime === 0) {
            lastRouteCalcTime = now;

            liveDirectionsService.route({
                origin: riderPos,
                destination: custPos,
                travelMode: google.maps.TravelMode.DRIVING
            }, (result, status) => {
                if (status === google.maps.DirectionsStatus.OK && result.routes[0]?.legs[0]) {
                    liveDirectionsRenderer.setDirections(result);
                    const leg = result.routes[0].legs[0];

                    if (etaHud) etaHud.classList.remove('hidden');
                    if (etaText) etaText.innerText = `${leg.duration.text} ETA`;
                    if (distanceText) distanceText.innerText = `${leg.distance.text} away`;
                }
            });
        }
    } else {
        if (etaHud) etaHud.classList.add('hidden');
        if (riderMarker && !customerMarker) {
            liveMapObj.setCenter(riderMarker.getPosition());
        } else if (customerMarker && !riderMarker) {
            liveMapObj.setCenter(customerMarker.getPosition());
        }
    }
}

export function promptEndLiveGpsSession() {
    openSlideDeleteModal("I-end na ba ang Live GPS Tracking session?", () => {
        endLiveGpsSession();
    });
}

export async function endLiveGpsSession() {
    let currentKey = activeSessionKey || localStorage.getItem('lokalex_active_live_session');
    if (currentKey && db) {
        await db.ref('liveSessions/' + currentKey).update({
            status: "ended",
            endedAt: Date.now()
        });
    }

    if (riderGpsWatchId) {
        navigator.geolocation.clearWatch(riderGpsWatchId);
        riderGpsWatchId = null;
    }

    activeSessionKey = "";
    localStorage.removeItem('lokalex_active_live_session');
    closeLiveGpsManageModal();
    showSideNotification("GPS SESSION ENDED", "Live GPS session has been closed", "fa-power-off", "text-red-400", "border-red-500");
}

if (typeof window !== 'undefined') {
    window.autoStartLiveGpsSession = autoStartLiveGpsSession;
    window.promptStartLiveGpsSession = promptStartLiveGpsSession;
    window.copyLiveGpsLink = copyLiveGpsLink;
    window.showRiderLiveMap = showRiderLiveMap;
    window.closeRiderLiveMap = closeRiderLiveMap;
    window.checkAndInitLiveGpsPortal = checkAndInitLiveGpsPortal;
    window.startMutualCustomerLocationSharing = startMutualCustomerLocationSharing;
    window.promptEndLiveGpsSession = promptEndLiveGpsSession;
    window.endLiveGpsSession = endLiveGpsSession;
}