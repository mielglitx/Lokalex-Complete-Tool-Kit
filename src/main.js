// src/main.js

/**
 * ============================================================================
 * LOKALEX APPLICATION CORE (FACADE BARREL MODULE)
 * ============================================================================
 * 
 * MODULE ARCHITECTURE & RESPONSIBILITIES:
 * 
 * 1. app/appPush.js
 *    - Service Worker registration & Web Push notification lifecycle.
 *    - `registerServiceWorker`: Registers /sw.js with background update listeners.
 *    - `initFCMNotifications`: Requests notification permissions and wires up messaging.
 *    - `syncDeviceFcmToken`: Associates device push tokens with rider/customer profiles in Firebase.
 * 
 * 2. app/appMonitors.js
 *    - System diagnostic and hardware state listeners.
 *    - `updateNetworkStatus`: Drives the header network indicator (green=online, orange=connecting, red=offline).
 *    - `initBatteryMonitor`: Reads device battery level & charging state via the Battery Status API.
 * 
 * 3. app/appSync.js
 *    - Persistence, reconnection engine, and synchronization daemon.
 *    - `runBackgroundPersistenceSync`: Syncs stores, menus, chats, and pre-fetches avatars to CacheStorage.
 *    - `forceReconnectFirebase`: Re-establishes RTDB WebSockets on resume, online, or visibility changes.
 *    - `initSyncWatchdog`: Guards against timer drift when devices wake from deep sleep.
 * 
 * 4. app/appListeners.js
 *    - Real-time Firebase Realtime Database subscriptions.
 *    - `initRealtimeFirebaseListeners`: Binds live events across .info/connected, riders, roster,
 *      blocked accounts, receipts, chat rooms, advanced orders, and distance calculations.
 * 
 * 5. app/appBootstrap.js
 *    - Application bootstrap, global window bridge, and routing coordinator.
 *    - `initGlobalWindowBridge`: Attaches module functions to the window object for HTML onclick compatibility.
 *    - `bootApp`: Coordinates Tier-1 local cache hydration, Tier-2 live socket bootstrap,
 *      deep-link URL parameter handling (?track, ?mapcalc, ?livegps), and role-based view routing.
 * ============================================================================
 */

import { registerServiceWorker, initFCMNotifications, syncDeviceFcmToken } from './app/appPush.js';
import { updateNetworkStatus, initBatteryMonitor } from './app/appMonitors.js';
import { runBackgroundPersistenceSync, forceReconnectFirebase, initSyncWatchdog } from './app/appSync.js';
import { initRealtimeFirebaseListeners } from './app/appListeners.js';
import { initGlobalWindowBridge, bootApp, initAppLifecycleEvents } from './app/appBootstrap.js';
import { registerSW } from 'virtual:pwa-register';

registerSW({
  immediate: true,
  onNeedRefresh() {
    console.log("New content available; reload to update.");
  },
  onOfflineReady() {
    console.log("Lokalex is fully ready to work offline.");
  }
});

// Re-export all core members for system-wide imports
export * from './app/appPush.js';
export * from './app/appMonitors.js';
export * from './app/appSync.js';
export * from './app/appListeners.js';
export * from './app/appBootstrap.js';

// 1. Initialize global window bindings for HTML onclick compatibility
initGlobalWindowBridge();

// 2. Initialize connectivity & sleep watchdog listeners
initSyncWatchdog();

// 3. Initialize application lifecycle & session change events
initAppLifecycleEvents();

// 4. Run application boot sequence
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootApp);
} else {
    bootApp();
}