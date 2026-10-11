// src/features/auth/authGps.js
import { appState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { openMapPicker } from '../maps.js';

let backgroundGpsWatchId = null;
let lastRosterGpsPushTime = 0;
const GPS_ROSTER_PULSE_MS = 25000;

export function calibrateGPS(onProgress) {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            return resolve({ lat: 0, lon: 0, accuracy: 999, success: false });
        }

        let bestFix = null;
        let sampleCount = 0;
        const maxSamples = 4;
        const timeoutDuration = 8000;

        const timeoutTimer = setTimeout(() => {
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            if (bestFix && bestFix.coords && bestFix.coords.latitude && bestFix.coords.longitude) {
                resolve({
                    lat: bestFix.coords.latitude,
                    lon: bestFix.coords.longitude,
                    accuracy: bestFix.coords.accuracy || 50,
                    success: true
                });
            } else {
                resolve({ lat: 0, lon: 0, accuracy: 999, success: false });
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

                if (acc <= 20 || sampleCount >= maxSamples) {
                    clearTimeout(timeoutTimer);
                    navigator.geolocation.clearWatch(watchId);
                    resolve({
                        lat: bestFix.coords.latitude,
                        lon: bestFix.coords.longitude,
                        accuracy: bestFix.coords.accuracy,
                        success: true
                    });
                }
            },
            (err) => {
                console.warn("GPS Calibration Notice:", err.message || err);
            },
            { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
        );
    });
}

export function updateRiderLiveLocation(lat, lng, accuracy = 0) {
    const telegramId = appState.telegramId || localStorage.getItem('telegramId');
    if (!telegramId || !db) return;
    const now = Date.now();
    if (now - lastRosterGpsPushTime < 45000) return;
    lastRosterGpsPushTime = now;

    // Writes strictly to riderLiveLocations, completely isolated from the roster node
    db.ref(`riderLiveLocations/${telegramId}`).set({
        lat,
        lng,
        accuracy: Math.round(accuracy || 0),
        riderName: appState.riderName || localStorage.getItem('riderName') || '',
        updatedAt: now
    }).catch(() => {});
}

export function clearRiderLiveLocation() {
    const telegramId = appState.telegramId || localStorage.getItem('telegramId');
    if (!telegramId || !db) return;
    db.ref(`riderLiveLocations/${telegramId}`).remove().catch(() => {});
}

export function startBackgroundRosterGpsTracker() {
    if (backgroundGpsWatchId !== null) return;
    if (!navigator.geolocation) return;

    const telegramId = appState.telegramId || localStorage.getItem('telegramId');
    if (!telegramId) return;

    try {
        backgroundGpsWatchId = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude, accuracy } = position.coords;
                if (latitude && longitude) {
                    updateRiderLiveLocation(latitude, longitude, accuracy);
                }
            },
            () => {},
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 30000 }
        );
    } catch (_) {}
}

export function stopBackgroundRosterGpsTracker() {
    if (backgroundGpsWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(backgroundGpsWatchId);
        backgroundGpsWatchId = null;
    }
    clearRiderLiveLocation();
}

export function getDeviceLocation() {
    return calibrateGPS();
}

export function sendCustomerLocation() {
    openMapPicker('chat');
}

export function captureRegistrationGPS() {
    openMapPicker('registration');
}

export function captureEditProfileGPS() {
    openMapPicker('edit-profile');
}