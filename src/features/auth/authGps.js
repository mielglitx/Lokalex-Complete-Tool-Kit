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
            return resolve({ lat: 0, lon: 0, accuracy: 999 });
        }

        let bestFix = null;
        let sampleCount = 0;
        const maxSamples = 4;
        const timeoutDuration = 6000;

        const timeoutTimer = setTimeout(() => {
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            if (bestFix) {
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

export function startBackgroundRosterGpsTracker() {
    if (!navigator.geolocation || !appState.telegramId) return;

    if (backgroundGpsWatchId !== null) {
        navigator.geolocation.clearWatch(backgroundGpsWatchId);
        backgroundGpsWatchId = null;
    }

    // Force an immediate one-shot GPS update upon resume
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const now = Date.now();
            appState.lat = pos.coords.latitude;
            appState.lon = pos.coords.longitude;
            appState.gpsAccuracy = pos.coords.accuracy;
            lastRosterGpsPushTime = now;

            if (db && appState.telegramId) {
                db.ref('roster/' + appState.telegramId).update({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    locationUpdatedAt: now,
                    lastActiveTimestamp: now
                }).catch(() => {});
            }
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    backgroundGpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const now = Date.now();
            appState.lat = pos.coords.latitude;
            appState.lon = pos.coords.longitude;
            appState.gpsAccuracy = pos.coords.accuracy;

            if (now - lastRosterGpsPushTime >= GPS_ROSTER_PULSE_MS && db && appState.telegramId) {
                lastRosterGpsPushTime = now;
                db.ref('roster/' + appState.telegramId).update({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    locationUpdatedAt: now,
                    lastActiveTimestamp: now
                }).catch(() => {});
            }
        },
        () => {},
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
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

export function sendCustomerLocation() {
    openMapPicker('chat');
}

export function captureRegistrationGPS() {
    openMapPicker('registration');
}

export function captureEditProfileGPS() {
    openMapPicker('edit-profile');
}