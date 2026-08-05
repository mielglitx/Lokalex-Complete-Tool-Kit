// src/features/auth.js
import { appState, globalState } from '../store/state.js';
import { CSV_AUTH_URL } from '../config/constants.js';
import { switchView, renderViewUI } from '../ui/router.js';
import { showToast, unlockAudioContext } from '../ui/notifications.js';
import { fetchGCashDetails } from '../ui/modals.js';
import { db } from '../config/firebase.js';

let backgroundGpsWatchId = null;
let lastRosterGpsPushTime = 0;
const GPS_ROSTER_PULSE_MS = 30000; // Update roster location every 30 seconds

// HIGH-PRECISION AUTO-GPS CALIBRATION HELPER
export function calibrateGPS(onProgress) {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            return resolve({ lat: 0, lon: 0, accuracy: 999 });
        }

        let bestFix = null;
        let sampleCount = 0;
        const maxSamples = 4;
        const timeoutDuration = 6000;

        const timeoutTimer = setTimeout(() => {
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            if (bestFix) {
                appState.lat = bestFix.coords.latitude;
                appState.lon = bestFix.coords.longitude;
                appState.gpsAccuracy = bestFix.coords.accuracy;
                resolve({
                    lat: bestFix.coords.latitude,
                    lon: bestFix.coords.longitude,
                    accuracy: bestFix.coords.accuracy
                });
            } else {
                resolve({ lat: 0, lon: 0, accuracy: 999 });
            }
        }, timeoutDuration);

        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                sampleCount++;
                const acc = position.coords.accuracy;

                if (!bestFix || acc < bestFix.coords.accuracy) {
                    bestFix = position;
                }

                if (onProgress && typeof onProgress === 'function') {
                    onProgress(acc, sampleCount);
                }

                if (acc <= 15 || sampleCount >= maxSamples) {
                    clearTimeout(timeoutTimer);
                    navigator.geolocation.clearWatch(watchId);
                    appState.lat = bestFix.coords.latitude;
                    appState.lon = bestFix.coords.longitude;
                    appState.gpsAccuracy = bestFix.coords.accuracy;
                    resolve({
                        lat: bestFix.coords.latitude,
                        lon: bestFix.coords.longitude,
                        accuracy: bestFix.coords.accuracy
                    });
                }
            },
            (err) => {},
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    });
}

// CONTINUOUS BACKGROUND GPS TRACKER FOR LOGGED-IN RIDERS
export function startBackgroundRosterGpsTracker() {
    if (!navigator.geolocation || !appState.telegramId) return;
    if (backgroundGpsWatchId !== null) navigator.geolocation.clearWatch(backgroundGpsWatchId);

    backgroundGpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const now = Date.now();
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const acc = pos.coords.accuracy;

            appState.lat = lat;
            appState.lon = lng;
            appState.gpsAccuracy = acc;

            // Throttle background roster updates to every 30 seconds
            if (now - lastRosterGpsPushTime >= GPS_ROSTER_PULSE_MS && db && appState.telegramId) {
                lastRosterGpsPushTime = now;
                db.ref('roster/' + appState.telegramId).update({
                    lat: lat,
                    lng: lng,
                    accuracy: acc,
                    locationUpdatedAt: now
                }).catch(() => {});
            }
        },
        (err) => {},
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
}

export function stopBackgroundRosterGpsTracker() {
    if (backgroundGpsWatchId !== null) {
        navigator.geolocation.clearWatch(backgroundGpsWatchId);
        backgroundGpsWatchId = null;
    }
}

export function getDeviceLocation() {
    return calibrateGPS();
}

export async function processLogin() {
    unlockAudioContext();
    const idInput = document.getElementById('login-id').value.trim();
    if (!idInput) return showToast("Please enter a valid ID");
    
    const btn = document.getElementById('login-btn');
    btn.innerHTML = `<i class="fa-solid fa-satellite-dish fa-spin"></i> Calibrating GPS...`; 
    btn.disabled = true;

    try {
        showToast("📡 Calibrating GPS location...");
        const coords = await calibrateGPS((accuracy) => {
            showToast(`📡 Calibrating GPS: ±${Math.round(accuracy)}m`);
        });

        if (coords.lat === 0 && coords.lon === 0) {
            showToast("⚠️ GPS Signal weak. Turn on location services.");
        } else {
            showToast(`✅ GPS Calibrated: ±${Math.round(coords.accuracy)}m`);
        }

        appState.lat = coords.lat; 
        appState.lon = coords.lon;
        appState.gpsAccuracy = coords.accuracy;

        const res = await fetch(CSV_AUTH_URL);
        if (!res.ok) throw new Error("Cannot reach authorization sheet");
        const csvData = await res.text();
        
        let authorized = false;
        for (let line of csvData.split('\n')) {
            const cols = line.split(',');
            if (cols.length >= 3) {
                const cleanType = cols[0].replace(/['"\r\n]+/g, '').trim();
                const cleanId = cols[1].replace(/['"\r\n]+/g, '').trim();
                const cleanName = cols[2].replace(/['"\r\n]+/g, '').trim();
                if (cleanId === idInput) {
                    appState.riderName = cleanName; 
                    appState.telegramId = idInput; 
                    appState.userType = cleanType;
                    authorized = true; break;
                }
            } else if (cols.length >= 2) {
                const cleanId = cols[0].replace(/['"\r\n]+/g, '').trim();
                const cleanName = cols[1].replace(/['"\r\n]+/g, '').trim();
                if (cleanId === idInput) {
                    appState.riderName = cleanName; 
                    appState.telegramId = idInput; 
                    appState.userType = "";
                    authorized = true; break;
                }
            }
        }

        if (authorized) {
            localStorage.setItem('telegramId', appState.telegramId);
            localStorage.setItem('riderName', appState.riderName);
            localStorage.setItem('userType', appState.userType || "");
            showToast("Login Successful!");
            
            fetchGCashDetails();
            startBackgroundRosterGpsTracker();

            history.replaceState({ view: 'view-home' }, '', '#view-home');
            renderViewUI('view-home');
            window.dispatchEvent(new CustomEvent('loginSuccess'));
        } else { 
            showToast("Access Denied: ID not found in sheet."); 
        }
    } catch (err) { 
        showToast(err.message || "Error during login"); 
    } finally { 
        btn.innerHTML = "LOGIN & MARK AVAILABLE"; 
        btn.disabled = false; 
    }
}

export function logout() { 
    stopBackgroundRosterGpsTracker();
    localStorage.clear(); 
    location.reload(); 
}

if (appState.telegramId) {
    fetchGCashDetails();
    startBackgroundRosterGpsTracker();
}