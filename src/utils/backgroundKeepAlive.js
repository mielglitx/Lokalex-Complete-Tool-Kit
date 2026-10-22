// src/utils/backgroundKeepAlive.js
import { isNativePlatform } from '../native/nativeBridge.js';
import { db, primaryDb } from '../config/firebase.js';

let silentAudioEl = null;
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
    if (silentAudioEl && silentAudioEl.paused) {
        silentAudioEl.play().catch(() => {});
    }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lokalexHeartbeatTick'));
    }
}

if (typeof window !== 'undefined') {
    window.keepAlivePulse = keepAlivePulse;
}

// Minimal inaudible 1-second silent 8kHz 8-bit mono WAV as data URI
const SILENT_WAV_DATA_URI = 'data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YRAAAAAAAAAAAAAAAAAAAAAA';

function initSilentAudio() {
    if (silentAudioEl) return silentAudioEl;
    try {
        silentAudioEl = document.createElement('audio');
        silentAudioEl.setAttribute('playsinline', '');
        silentAudioEl.setAttribute('webkit-playsinline', '');
        silentAudioEl.setAttribute('loop', '');
        silentAudioEl.src = SILENT_WAV_DATA_URI;
        silentAudioEl.volume = 0.001; // virtually silent but recognized by audio sub-system
        silentAudioEl.preload = 'auto';
        silentAudioEl.style.display = 'none';
        document.body.appendChild(silentAudioEl);
    } catch (_) {}
    return silentAudioEl;
}

function playSilentAudio() {
    const audio = initSilentAudio();
    if (audio) {
        audio.play().catch(() => {
            // Autoplay policy may block until first user interaction
            bindFirstUserInteraction();
        });
    }
}

function bindFirstUserInteraction() {
    if (userInteractionBound) return;
    userInteractionBound = true;

    const resumeOnTouch = () => {
        if (silentAudioEl) {
            silentAudioEl.play().catch(() => {});
        }
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

    // 1. Play silent audio loop to prevent Chromium from suspending JavaScript thread & WebSockets
    playSilentAudio();

    // 2. Start Web Worker un-throttled heartbeat
    initHeartbeatWorker();

    // 3. Trigger native Android keep-alive service
    if (typeof window !== 'undefined' && window.NativePermissionsBridge && typeof window.NativePermissionsBridge.startKeepAlive === 'function') {
        try {
            window.NativePermissionsBridge.startKeepAlive();
        } catch (_) {}
    }

    // 4. Request wake lock if applicable
    if (window.requestWakeLock) {
        window.requestWakeLock().catch(() => {});
    }
}

/**
 * Stops keep-alive
 */
export function stopKeepAlive() {
    keepAliveActive = false;
    if (silentAudioEl) {
        try {
            silentAudioEl.pause();
        } catch (_) {}
    }
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
        playSilentAudio();
        keepAlivePulse();
    });

    window.addEventListener('appPausedToBackground', () => {
        playSilentAudio();
        keepAlivePulse();
        if (heartbeatWorker) {
            heartbeatWorker.postMessage('start');
        }
    });

    // Also bind user interaction to satisfy mobile autoplay policies
    bindFirstUserInteraction();
}

