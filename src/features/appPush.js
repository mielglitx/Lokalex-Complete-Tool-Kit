// src/features/appPush.js
export async function initPushNotifications() {
    if (!('serviceWorker' in navigator)) return;

    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    // In local development, bypass /sw.js registration to prevent MIME text/html errors
    if (isLocalhost) {
        console.info("ℹ️ Localhost detected: Service Worker registration bypassed in development.");
        return;
    }

    try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        // Proceed with PushManager subscription...
    } catch (err) {
        console.warn("SW registration warning:", err);
    }
}