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

let lastPushTime = 0;
const PUSH_TICK_INTERVAL_MS = 6000; // 6 seconds throttled tick

export async function promptStartLiveGpsSession() {
    const activeCustRecord = globalState.rosterMembers ? globalState.rosterMembers.find(m => (m.telegramId || "").toString() === (appState.telegramId || "").toString()) : null;
    const currentCust = (activeCustRecord && activeCustRecord.customerName) ? activeCustRecord.customerName.split(', ')[0] : "Customer";

    const sessionKey = `LIVE_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).substring(2,6).toUpperCase()}`;
    activeSessionKey = sessionKey;
    localStorage.setItem('lokalex_active_live_session', sessionKey);

    const initialData = {
        status: "active",
        riderName: appState.riderName || "Rider",
        customerName: currentCust,
        createdAt: Date.now(),
        users: {}
    };

    await db.ref('liveSessions/' + sessionKey).set(initialData);
    copyLiveGpsLink(currentCust, sessionKey);
    startRiderGpsTracking(sessionKey);
    openLiveGpsManageModal();
}

export function copyLiveGpsLink(custName = "Customer", sessionKey = activeSessionKey) {
    if (!sessionKey) return showToast("Walang active na live GPS session.");

    const fullUrl = `${window.location.origin}${window.location.pathname}?livegps=${sessionKey}`;
    const message = `Magandang araw po ${custName}! 👋\n\nNagsimula na po ang ating Mutual Live GPS Tracking! Pwede niyo pong subaybayan ang aking lokasyon habang papalapit sa inyo at makikita rin natin ang isa't isa sa mapa sa pamamagitan ng link na ito:\n\n${fullUrl}\n\n⚠️ PAALALA:\nKung binuksan nyo po sa Messenger, paki-pindot ang 3 dots (...) at piliin ang "Open in Chrome" o "Open in Safari". Paki-allow din po ang Location Access. Maraming salamat po! 🛵💙`;

    copyText(message);
    showToast("🔗 Live GPS message & link copied!");
}

function startRiderGpsTracking(sessionKey) {
    if (riderGpsWatchId) navigator.geolocation.clearWatch(riderGpsWatchId);
    if (!navigator.geolocation) return;

    riderGpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const now = Date.now();
            if (now - lastPushTime >= PUSH_TICK_INTERVAL_MS) {
                lastPushTime = now;
                db.ref(`liveSessions/${sessionKey}/users/rider`).set({
                    name: appState.riderName || "Rider",
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    updatedAt: now
                });
            }
        },
        (err) => {},
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
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
                        : `<span class="text-amber-400 font-bold bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30 animate-pulse">⏳ Waiting for Customer</span>`}
                </div>
                <div class="text-[10px] text-gray-500 mt-1">Tick interval: 6s (Data Saver Active)</div>
            </div>`;
    });
}

export function promptEndLiveGpsSession() {
    openSlideDeleteModal("I-end na ba ang Live GPS Tracking session?", () => {
        endLiveGpsSession();
    });
}

export async function endLiveGpsSession() {
    if (activeSessionKey) {
        await db.ref('liveSessions/' + activeSessionKey).update({
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
    showToast("🔴 Live GPS Session ended.");
}

export function checkAndInitLiveGpsPortal() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionKey = urlParams.get('livegps');
    if (!sessionKey) return;

    const portal = document.getElementById('livegps-portal');
    const expiredPortal = document.getElementById('livegps-expired-portal');
    if (!portal || !expiredPortal) return;

    db.ref('liveSessions/' + sessionKey).on('value', (snapshot) => {
        const data = snapshot.val();

        if (!data || data.status === 'ended') {
            portal.classList.add('hidden');
            expiredPortal.classList.remove('hidden');
            if (customerGpsWatchId) navigator.geolocation.clearWatch(customerGpsWatchId);
            return;
        }

        expiredPortal.classList.add('hidden');
        portal.classList.remove('hidden');

        // Only render the map with existing data (rider data) if the container is visible
        renderMutualLiveMap(data.users);
    });
}

// Triggered via HTML onclick
export function startMutualCustomerLocationSharing() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionKey = urlParams.get('livegps');
    if (!sessionKey) return;

    const btn = document.getElementById('livegps-share-btn');
    const statusEl = document.getElementById('livegps-status');
    const mapBox = document.getElementById('livegps-map-container-box');
    const step2Pointer = document.getElementById('livegps-step2-pointer');

    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Kumukuha ng GPS...`;

    if (!navigator.geolocation) {
        statusEl.className = "text-xs font-bold text-red-400 bg-red-500/10 p-3 rounded-xl border border-red-500/20";
        statusEl.innerText = "❌ Hindi suportado ang GPS sa browser na ito.";
        return;
    }

    mapBox.classList.remove('hidden');
    if (step2Pointer) step2Pointer.classList.add('hidden'); // Hide bouncing pointer

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

            statusEl.className = "text-xs font-bold text-indigo-400 bg-indigo-500/10 p-2.5 rounded-xl border border-indigo-500/20";
            statusEl.innerHTML = "📡 <strong>Live Tracking Active</strong><br><span class=\"text-gray-300 font-normal\">Updating map every 6 seconds...</span>";
            btn.innerHTML = `<i class="fa-solid fa-check-double"></i> TRACKING ACTIVE`;
        },
        (err) => {
            statusEl.className = "text-xs font-bold text-red-400 bg-red-500/10 p-3 rounded-xl border border-red-500/20";
            statusEl.innerText = "⚠️ Paki-allow ang GPS Location permission sa iyong browser.";
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-satellite-dish"></i> RETRY JOIN LIVE TRACKING`;
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
    );
}

function renderMutualLiveMap(usersData) {
    if (typeof google === 'undefined' || !google.maps) return;

    const container = document.getElementById('livegps-map-container');
    const mapBox = document.getElementById('livegps-map-container-box');
    if (!container || (mapBox && mapBox.classList.contains('hidden'))) return; // Don't render until box is unhidden

    const riderData = usersData && usersData.rider;
    const custData = usersData && usersData.customer;

    const defaultCenter = riderData ? { lat: riderData.lat, lng: riderData.lng } : (custData ? { lat: custData.lat, lng: custData.lng } : { lat: 15.6881, lng: 120.4144 });

    if (!liveMapObj) {
        liveMapObj = new google.maps.Map(container, {
            center: defaultCenter,
            zoom: 16,
            disableDefaultUI: false,
            zoomControl: true
        });
    }

    if (riderData && riderData.lat && riderData.lng) {
        const pos = { lat: riderData.lat, lng: riderData.lng };
        if (!riderMarker) {
            riderMarker = new google.maps.Marker({
                position: pos,
                map: liveMapObj,
                title: `Rider: ${riderData.name || 'Rider'}`,
                icon: { url: "http://maps.google.com/mapfiles/ms/icons/red-dot.png" }
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
                icon: { url: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png" }
            });
        } else {
            customerMarker.setPosition(pos);
        }
    }

    if (riderMarker && customerMarker) {
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(riderMarker.getPosition());
        bounds.extend(customerMarker.getPosition());
        liveMapObj.fitBounds(bounds);
    }
}