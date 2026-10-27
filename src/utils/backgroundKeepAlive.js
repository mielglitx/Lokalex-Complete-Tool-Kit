// src/utils/backgroundKeepAlive.js
import { isNativePlatform } from '../native/nativeBridge.js';
import { db, primaryDb } from '../config/firebase.js';

let heartbeatWorker = null;
let keepAliveActive = false;
let userInteractionBound = false;

/**
 * Universal keep-alive pulse: wakes Firebase Realtime Database WebSockets
 * and dispatches background heartbeat ticks across both web and native layers
 */
export function keepAlivePulse() {
    if (db && typeof db.goOnline === 'function' && navigator.onLine) {
        try { db.goOnline(); } catch (_) {}
    }
    if (primaryDb && typeof primaryDb.goOnline === 'function' && navigator.onLine) {
        try { primaryDb.goOnline(); } catch (_) {}
    }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lokalexHeartbeatTick'));
    }
}

if (typeof window !== 'undefined') {
    window.keepAlivePulse = keepAlivePulse;
}

function bindFirstUserInteraction() {
    if (userInteractionBound) return;
    userInteractionBound = true;

    const resumeOnTouch = () => {
        if (window.unlockAudioContext) {
            window.unlockAudioContext();
        }
        window.removeEventListener('touchstart', resumeOnTouch);
        window.removeEventListener('click', resumeOnTouch);
        window.removeEventListener('keydown', resumeOnTouch);
    };

    window.addEventListener('touchstart', resumeOnTouch, { passive: true });
    window.addEventListener('click', resumeOnTouch, { passive: true });
    window.addEventListener('keydown', resumeOnTouch, { passive: true });
}

function initHeartbeatWorker() {
    if (heartbeatWorker) return;
    try {
        const workerCode = `
            let intervalId = null;
            self.onmessage = function(e) {
                if (e.data === 'start') {
                    if (!intervalId) {
                        intervalId = setInterval(function() {
                            self.postMessage('ping');
                        }, 15000);
                    }
                } else if (e.data === 'stop') {
                    if (intervalId) {
                        clearInterval(intervalId);
                        intervalId = null;
                    }
                }
            };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        heartbeatWorker = new Worker(url);

        heartbeatWorker.onmessage = function() {
            keepAlivePulse();
        };

        heartbeatWorker.postMessage('start');
    } catch (e) {
        console.warn('Keep-alive worker setup note:', e);
    }
}

/**
 * Starts continuous background keep-alive across both native Android and web engine
 */
export function startKeepAlive() {
    if (keepAliveActive) return;
    keepAliveActive = true;

    // 1. Start Web Worker un-throttled heartbeat
    initHeartbeatWorker();

    // 2. Trigger native Android keep-alive service
    if (typeof window !== 'undefined' && window.NativePermissionsBridge && typeof window.NativePermissionsBridge.startKeepAlive === 'function') {
        try {
            window.NativePermissionsBridge.startKeepAlive();
        } catch (_) {}
    }

    // 3. Request wake lock if applicable
    if (window.requestWakeLock) {
        window.requestWakeLock().catch(() => {});
    }
}

/**
 * Stops keep-alive
 */
export function stopKeepAlive() {
    keepAliveActive = false;
    if (heartbeatWorker) {
        try {
            heartbeatWorker.postMessage('stop');
            heartbeatWorker.terminate();
        } catch (_) {}
        heartbeatWorker = null;
    }
}

export function isKeepAliveActive() {
    return keepAliveActive;
}

// Auto-start on load if running inside native shell or active session
if (typeof window !== 'undefined') {
    window.startKeepAlive = startKeepAlive;
    window.stopKeepAlive = stopKeepAlive;

    // Start keep alive automatically
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        startKeepAlive();
    } else {
        window.addEventListener('DOMContentLoaded', () => {
            startKeepAlive();
        });
    }

    // When app resumes or pauses, ensure keep-alive remains continuous
    window.addEventListener('appResumedFromBackground', () => {
        keepAlivePulse();
    });

    window.addEventListener('appPausedToBackground', () => {
        keepAlivePulse();
        if (heartbeatWorker) {
            heartbeatWorker.postMessage('start');
        }
    });

    // Also bind user interaction to satisfy mobile audio context policy
    bindFirstUserInteraction();
}
