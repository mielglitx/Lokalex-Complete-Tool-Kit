// sw.js - Service Worker for Lokalex PWA
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const CACHE_NAME = 'lokalex-app-cache-v1';

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/src/main.js',
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-database-compat.js',
    'https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js'
];

// Firebase Background Messaging Initialization
const firebaseConfig = {
    apiKey: "AIzaSyD2ZbvO60h-udB_iNZ6zVbmXjMwYfbS_2w",
    authDomain: "lokalex-hub.firebaseapp.com",
    databaseURL: "https://lokalex-hub-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "lokalex-hub",
    storageBucket: "lokalex-hub.appspot.com",
    messagingSenderId: "102938475610",
    appId: "1:102938475610:web:abcdef1234567890"
};

firebase.initializeApp(firebaseConfig);

try {
    const messaging = firebase.messaging();

    // Background push handler when browser is minimized or screen is locked
    messaging.onBackgroundMessage((payload) => {
        const title = payload.notification?.title || payload.data?.title || 'Lokalex Alert';
        const options = {
            body: payload.notification?.body || payload.data?.body || 'New update available.',
            icon: payload.notification?.icon || payload.data?.icon || '/icons/icon-192x192.png',
            badge: '/icons/icon-192x192.png',
            vibrate: [300, 100, 300, 100, 400],
            tag: payload.data?.tag || 'lokalex-alert',
            renotify: true,
            data: {
                url: payload.data?.url || '/',
                view: payload.data?.view || 'view-home',
                ...payload.data
            }
        };

        return self.registration.showNotification(title, options);
    });
} catch(e) {
    console.warn('FCM Background messaging initialization:', e);
}

// 1. INSTALL: Pre-cache core application shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('SW Pre-cache non-fatal warning:', err);
            });
        }).then(() => self.skipWaiting())
    );
});

// 2. ACTIVATE: Clean up stale legacy caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 3. FETCH: Stale-While-Revalidate strategy for instantaneous loading & background updates
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Bypass Service Worker for realtime websockets, database endpoints, and dynamic Maps tiles
    if (
        request.method !== 'GET' ||
        url.hostname.includes('firebasedatabase.app') ||
        url.hostname.includes('firebaseio.com') ||
        url.pathname.includes('/.lp') ||
        url.hostname.includes('maps.googleapis.com') ||
        url.hostname.includes('google.com/maps')
    ) {
        return;
    }

    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cachedResponse = await cache.match(request);

            // Fetch latest copy in background to update cache
            const fetchPromise = fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    cache.put(request, networkResponse.clone());
                }
                return networkResponse;
            }).catch(() => cachedResponse);

            // Return cached response instantly if available, otherwise wait for network
            return cachedResponse || fetchPromise;
        })
    );
});

// 4. PUSH EVENT FALLBACK: Handle general web push payloads
self.addEventListener('push', (event) => {
    if (!event.data) return;

    try {
        const payload = event.data.json();
        const title = payload.title || payload.notification?.title || 'Lokalex Notification';
        const options = {
            body: payload.body || payload.notification?.body || 'You have a new update.',
            icon: payload.icon || '/icons/icon-192x192.png',
            badge: '/icons/icon-192x192.png',
            vibrate: [250, 100, 250, 100, 350],
            tag: payload.tag || 'lokalex-push',
            renotify: true,
            data: payload.data || { url: '/' }
        };

        event.waitUntil(self.registration.showNotification(title, options));
    } catch(e) {
        event.waitUntil(
            self.registration.showNotification('Lokalex', {
                body: event.data.text(),
                icon: '/icons/icon-192x192.png'
            })
        );
    }
});

// 5. NOTIFICATION CLICK: Focus open tab or launch application window
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (let client of windowClients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    if (event.notification.data?.view && client.navigate) {
                        client.navigate(`${self.location.origin}/#${event.notification.data.view}`);
                    }
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});