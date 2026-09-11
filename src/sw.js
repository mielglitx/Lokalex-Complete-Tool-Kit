// src/sw.js
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// 1. Precache all compiled Vite chunks, CSS, HTML, and local assets
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// 2. Cache external CDN scripts (Firebase SDKs, QR library, Tesseract OCR)
registerRoute(
    ({ url }) => url.origin === 'https://www.gstatic.com' || url.origin === 'https://cdn.jsdelivr.net',
    new CacheFirst({
        cacheName: 'external-cdn-scripts',
        plugins: [
            new ExpirationPlugin({
                maxEntries: 40,
                maxAgeSeconds: 60 * 24 * 60 * 60
            })
        ]
    })
);

// 3. Cache external stylesheets and icon fonts (FontAwesome, Google Fonts)
registerRoute(
    ({ url }) => url.origin === 'https://cdnjs.cloudflare.com' || url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
    new CacheFirst({
        cacheName: 'external-fonts-and-styles',
        plugins: [
            new ExpirationPlugin({
                maxEntries: 30,
                maxAgeSeconds: 90 * 24 * 60 * 60
            })
        ]
    })
);

// 4. Firebase Background Messaging & Push Notifications
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

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

async function notifyClients(payload) {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
        client.postMessage({
            type: 'SW_NOTIFICATION_RECEIVED',
            payload: payload
        });
    }
}

try {
    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
        const title = payload.notification?.title || payload.data?.title || 'Lokalex Alert';
        const body = payload.notification?.body || payload.data?.body || 'New update available.';
        const options = {
            body: body,
            icon: payload.notification?.icon || payload.data?.icon || 'Logo.jpg',
            badge: 'Logo.jpg',
            vibrate: [300, 100, 300, 100, 400],
            tag: payload.data?.tag || 'lokalex-alert',
            renotify: true,
            data: {
                url: payload.data?.url || './',
                view: payload.data?.view || 'view-home',
                ...payload.data
            }
        };

        notifyClients({ title, body, ...payload });
        return self.registration.showNotification(title, options);
    });
} catch (e) {
    console.warn('FCM Background messaging initialization:', e);
}

// 5. Native Notification Click Routing
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || './';

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

// 6. In-App Notification Trigger
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NATIVE_NOTIFICATION') {
        const title = event.data.title || 'Lokalex Alert';
        const options = {
            body: event.data.body || '',
            icon: event.data.icon || 'Logo.jpg',
            badge: 'Logo.jpg',
            vibrate: [200, 100, 200],
            tag: event.data.tag || 'lokalex-local-alert',
            renotify: true,
            data: event.data.data || { url: './' }
        };
        self.registration.showNotification(title, options);
    }
});

self.skipWaiting();