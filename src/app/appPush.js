// src/app/appPush.js
import { appState } from '../store/state.js';
import { db, messaging } from '../config/firebase.js';
import { notifyUser } from '../ui/notifications.js';

export function registerServiceWorker() {
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('/sw.js').then((reg) => {
            initFCMNotifications(reg);

            reg.onupdatefound = () => {
                const installingWorker = reg.installing;
                if (installingWorker) {
                    installingWorker.onstatechange = () => {
                        if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('⚡ Lokalex App updated in background.');
                        }
                    };
                }
            };
        }).catch((err) => {
            console.warn('SW registration warning:', err);
        });
    }
}

export async function initFCMNotifications(registration) {
    if (!('Notification' in window) || !messaging) return;

    try {
        let permission = Notification.permission;
        if (permission === 'default') {
            permission = await Notification.requestPermission();
        }

        if (permission === 'granted') {
            const currentToken = await messaging.getToken({
                serviceWorkerRegistration: registration
            });

            if (currentToken) {
                syncDeviceFcmToken(currentToken);
            }

            messaging.onMessage((payload) => {
                const title = payload.notification?.title || payload.data?.title || 'Lokalex Alert';
                const body = payload.notification?.body || payload.data?.body || 'New notification received.';
                
                notifyUser(title, body, {
                    icon: 'fa-bell',
                    textColor: 'text-amber-400',
                    borderColor: 'border-amber-500'
                });

                if (typeof window.playLineAlarm === 'function') {
                    window.playLineAlarm();
                }
            });
        }
    } catch (err) {
        console.warn('FCM setup warning:', err);
    }
}

export function syncDeviceFcmToken(token) {
    if (!db || !token) return;

    const myRiderId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    const myCustId = (appState.customerFacebookId || localStorage.getItem('lokalex_customer_fb_id') || '').toString().trim();

    if (myRiderId) {
        db.ref(`riders/${myRiderId}/fcmToken`).set(token).catch(() => {});
        db.ref(`roster/${myRiderId}/fcmToken`).set(token).catch(() => {});
    }
    if (myCustId) {
        db.ref(`customers/${myCustId}/fcmToken`).set(token).catch(() => {});
    }
}