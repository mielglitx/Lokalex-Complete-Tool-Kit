import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';
import { initOtaUpdater } from '../utils/otaUpdater.js';
import { startKeepAlive, keepAlivePulse } from '../utils/backgroundKeepAlive.js';

/**
 * ============================================================================
 * LOKALEX CAPACITOR NATIVE BRIDGE
 * ============================================================================
 * Seamless hardware abstraction layer that bridges Lokalex Web PWA with
 * native Android/iOS functionality when running in the native container.
 * ============================================================================
 */

export function isNativePlatform() {
    return Capacitor.isNativePlatform();
}

export function getPlatformName() {
    return Capacitor.getPlatform(); // 'android' | 'ios' | 'web'
}

/**
 * Sets up native mobile listeners: hardware back button handling,
 * status bar colors, and lifecycle wake/sleep handlers.
 */
export async function initNativeBridge() {
    if (!isNativePlatform()) {
        return;
    }

    // Initialize Over-The-Air (OTA) Live Updater
    initOtaUpdater().catch(() => {});

    // Initialize Web & Native Keep-Alive
    startKeepAlive();

    try {
        // 1. Configure Status Bar (Do NOT overlay webview, prevent status bar from blocking top content)
        await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
        await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
        if (Capacitor.getPlatform() === 'android') {
            await StatusBar.setBackgroundColor({ color: '#0f172a' }).catch(() => {});
        }
    } catch (_) {}

    // 2. Hardware Android Back Button Handler
    try {
        App.addListener('backButton', ({ canGoBack }) => {
            // Check open modals in order of z-index priority (topmost child overlays first)
            const modals = [
                { id: 'image-viewer-modal', closeFn: window.closeImageViewerModal },
                { id: 'image-editor-modal', closeFn: window.closeImageEditorModal },
                { id: 'pod-capture-modal', closeFn: () => {
                    const el = document.getElementById('pod-capture-modal');
                    if (el) el.classList.add('hidden');
                }},
                { id: 'customer-details-modal', closeFn: () => {
                    const el = document.getElementById('customer-details-modal');
                    if (el) el.classList.add('hidden');
                }},
                { id: 'chat-sound-settings-modal', closeFn: window.closeChatSoundSettingsModal },
                { id: 'quick-replies-edit-modal', closeFn: window.closeQuickReplyEditModal },
                { id: 'rider-sources-filter-modal', closeFn: window.closeRiderChatSourcesModal },
                { id: 'admin-fb-api-modal', closeFn: window.closeAdminFbApiModal },
                { id: 'ota-update-selector-modal', closeFn: window.closeOtaUpdateSelectorModal },
                { id: 'slide-delete-modal', closeFn: window.closeSlideDeleteModal },
                { id: 'slide-delete-confirm-modal', closeFn: window.closeSlideDeleteModal },
                { id: 'rider-chat-modal', closeFn: window.closeRiderChatModal }
            ];

            for (const m of modals) {
                const el = document.getElementById(m.id);
                if (el && !el.classList.contains('hidden')) {
                    if (typeof m.closeFn === 'function') {
                        m.closeFn();
                    } else {
                        el.classList.add('hidden');
                    }
                    return; // Handled modal close, do not exit app
                }
            }

            // If no modals are open, allow default behavior or minimize
            if (!canGoBack) {
                App.minimizeApp().catch(() => {});
            } else {
                window.history.back();
            }
        });
    } catch (e) {
        console.warn("Back button setup note:", e);
    }

    // 3. Lifecycle state listener (Background / Foreground transition)
    try {
        if (window.NativePermissionsBridge && typeof window.NativePermissionsBridge.startKeepAlive === 'function') {
            window.NativePermissionsBridge.startKeepAlive();
        }

        const cachedRiderId = localStorage.getItem('telegramId') || localStorage.getItem('riderId') || '';
        const cachedRiderName = localStorage.getItem('riderName') || '';
        if (cachedRiderId) {
            syncRiderSession(cachedRiderId, cachedRiderName);
        }

        App.addListener('appStateChange', (state) => {
            if (state.isActive) {
                // Rider returned to the app (from Google Maps / Waze / Screen Unlock)
                window.dispatchEvent(new Event('appResumedFromBackground'));
                keepAlivePulse();
            } else {
                // Rider switched apps or locked screen
                window.dispatchEvent(new Event('appPausedToBackground'));
                keepAlivePulse();
            }
        });
    } catch (e) {
        console.warn("App state listener note:", e);
    }
}

/**
 * Haptic Vibration Feedback
 */
export async function triggerNativeHaptic(type = 'light') {
    if (!isNativePlatform()) {
        try {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                if (type === 'success') navigator.vibrate([60, 40, 60]);
                else if (type === 'warning') navigator.vibrate([80, 50, 100]);
                else navigator.vibrate(40);
            }
        } catch (_) {}
        return;
    }

    try {
        if (type === 'success') {
            await Haptics.notification({ type: NotificationType.Success });
        } else if (type === 'warning') {
            await Haptics.notification({ type: NotificationType.Warning });
        } else if (type === 'error') {
            await Haptics.notification({ type: NotificationType.Error });
        } else if (type === 'heavy') {
            await Haptics.impact({ style: ImpactStyle.Heavy });
        } else if (type === 'medium') {
            await Haptics.impact({ style: ImpactStyle.Medium });
        } else {
            await Haptics.impact({ style: ImpactStyle.Light });
        }
    } catch (_) {}
}

/**
 * Runtime Permissions Bridge (Notifications, GPS, Camera, Storage)
 */
export function requestNativePermissions() {
    if (typeof window !== 'undefined' && window.NativePermissionsBridge && typeof window.NativePermissionsBridge.requestAllPermissions === 'function') {
        window.NativePermissionsBridge.requestAllPermissions();
        return true;
    }
    // Web fallback for permissions
    if (typeof Notification !== 'undefined' && Notification.requestPermission) {
        Notification.requestPermission().catch(() => {});
    }
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(() => {}, () => {});
    }
    return false;
}

export function areNativePermissionsGranted() {
    if (typeof window !== 'undefined' && window.NativePermissionsBridge && typeof window.NativePermissionsBridge.areAllPermissionsGranted === 'function') {
        return window.NativePermissionsBridge.areAllPermissionsGranted();
    }
    return true;
}

export function openNativeAppSettings() {
    if (typeof window !== 'undefined' && window.NativePermissionsBridge && typeof window.NativePermissionsBridge.openAppSettings === 'function') {
        window.NativePermissionsBridge.openAppSettings();
        return true;
    }
    return false;
}

export function requestBatteryOptimizationExemption() {
    if (typeof window !== 'undefined' && window.NativePermissionsBridge && typeof window.NativePermissionsBridge.requestIgnoreBatteryOptimizations === 'function') {
        window.NativePermissionsBridge.requestIgnoreBatteryOptimizations();
        return true;
    }
    return false;
}

export function isBatteryOptimizationIgnored() {
    if (typeof window !== 'undefined' && window.NativePermissionsBridge && typeof window.NativePermissionsBridge.isIgnoringBatteryOptimizations === 'function') {
        return window.NativePermissionsBridge.isIgnoringBatteryOptimizations();
    }
    return true;
}

export function syncRiderSession(riderId, riderName) {
    if (typeof window !== 'undefined' && window.NativePermissionsBridge && typeof window.NativePermissionsBridge.syncRiderSession === 'function') {
        try {
            window.NativePermissionsBridge.syncRiderSession(String(riderId || ''), String(riderName || ''));
            return true;
        } catch (_) {}
    }
    return false;
}

export function getSystemNotificationSounds() {
    if (typeof window !== 'undefined' && window.NativePermissionsBridge && typeof window.NativePermissionsBridge.getSystemNotificationSounds === 'function') {
        try {
            const raw = window.NativePermissionsBridge.getSystemNotificationSounds();
            if (raw) return JSON.parse(raw);
        } catch (e) {
            console.warn("getSystemNotificationSounds parse error:", e);
        }
    }
    return [
        { id: 'system_default', name: 'Device Default Ringtone', uri: 'system_default' }
    ];
}

export function playSystemSound(uriString = '') {
    if (typeof window !== 'undefined' && window.NativePermissionsBridge && typeof window.NativePermissionsBridge.playSystemSound === 'function') {
        try {
            window.NativePermissionsBridge.playSystemSound(uriString || 'system_default');
            return true;
        } catch (e) {
            console.warn("playSystemSound error:", e);
        }
    }
    return false;
}

/**
 * Post notification directly into the Android notification bar / system tray
 */
export function showNativeNotification(title, message, tag = '', custId = '') {
    if (typeof window !== 'undefined' && window.NativePermissionsBridge) {
        if (typeof window.NativePermissionsBridge.showNotificationWithCustId === 'function') {
            try {
                window.NativePermissionsBridge.showNotificationWithCustId(title, message, tag, custId);
                return true;
            } catch (e) {
                console.warn("Native notification with custId error:", e);
            }
        } else if (typeof window.NativePermissionsBridge.showNotification === 'function') {
            try {
                window.NativePermissionsBridge.showNotification(title, message, tag);
                return true;
            } catch (e) {
                console.warn("Native notification error:", e);
            }
        }
    }

    // Web / PWA / Service Worker fallback
    if (typeof window !== 'undefined') {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            try {
                navigator.serviceWorker.controller.postMessage({
                    type: 'SHOW_NATIVE_NOTIFICATION',
                    title: title,
                    body: message,
                    tag: tag || 'lokalex-msg'
                });
                return true;
            } catch (_) {}
        }
        if ('Notification' in window && Notification.permission === 'granted') {
            try {
                new Notification(title, {
                    body: message,
                    tag: tag || 'lokalex-msg',
                    icon: '/Logo.png'
                });
                return true;
            } catch (_) {}
        }
    }
    return false;
}

/**
 * Dismiss a notification from the Android notification bar
 */
export function clearNativeNotification(tag = '') {
    if (typeof window !== 'undefined' && window.NativePermissionsBridge && typeof window.NativePermissionsBridge.clearNotification === 'function') {
        try {
            window.NativePermissionsBridge.clearNotification(tag);
            return true;
        } catch (_) {}
    }
    return false;
}

// Global click handler invoked when user taps notification from notification bar
if (typeof window !== 'undefined') {
    window.handleNativeNotificationClick = function(targetId) {
        if (!targetId) return;

        // Route to Advanced Orders Hub if targetId is an advance order
        if (targetId.startsWith('adv_') || targetId === 'advance_orders') {
            if (typeof window.openAdvancedOrdersModal === 'function') {
                window.openAdvancedOrdersModal();
            } else {
                let retries = 0;
                const retryInterval = setInterval(() => {
                    retries++;
                    if (typeof window.openAdvancedOrdersModal === 'function') {
                        clearInterval(retryInterval);
                        window.openAdvancedOrdersModal();
                    } else if (retries > 25) {
                        clearInterval(retryInterval);
                    }
                }, 150);
            }
            return;
        }

        // Otherwise route to customer chat
        if (typeof window.openRiderCustomerChatModal === 'function') {
            window.openRiderCustomerChatModal(targetId);
        } else {
            let retries = 0;
            const retryInterval = setInterval(() => {
                retries++;
                if (typeof window.openRiderCustomerChatModal === 'function') {
                    clearInterval(retryInterval);
                    window.openRiderCustomerChatModal(targetId);
                } else if (retries > 25) {
                    clearInterval(retryInterval);
                }
            }, 150);
        }
    };

    window.isNativePlatform = isNativePlatform;
    window.triggerNativeHaptic = triggerNativeHaptic;
    window.requestNativePermissions = requestNativePermissions;
    window.areNativePermissionsGranted = areNativePermissionsGranted;
    window.openNativeAppSettings = openNativeAppSettings;
    window.showNativeNotification = showNativeNotification;
    window.clearNativeNotification = clearNativeNotification;
    window.openExternalLink = openExternalLink;
    window.requestBatteryOptimizationExemption = requestBatteryOptimizationExemption;
    window.isBatteryOptimizationIgnored = isBatteryOptimizationIgnored;
    window.syncRiderSession = syncRiderSession;
    window.getSystemNotificationSounds = getSystemNotificationSounds;
    window.playSystemSound = playSystemSound;
}

/**
 * Opens links in the appropriate native app (Facebook, Google Maps, Apple Maps)
 * or external system browser when running in Capacitor or Web.
 */
export async function openExternalLink(rawUrl) {
    if (!rawUrl) return;
    let url = String(rawUrl).trim();
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('geo:') && !url.startsWith('fb:') && !url.startsWith('maps:')) {
        url = 'https://' + url;
    }

    const isNative = Capacitor.isNativePlatform();
    const platform = Capacitor.getPlatform();

    // 1. Google Maps Links
    const isGoogleMaps = /maps\.google\.com|google\.com\/maps|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(url);
    if (isGoogleMaps) {
        if (isNative) {
            try {
                await App.openUrl({ url });
                return;
            } catch (_) {}
        }
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
    }

    // 2. Apple Maps Links
    const isAppleMaps = /maps\.apple\.com/i.test(url);
    if (isAppleMaps) {
        if (isNative && platform === 'ios') {
            try {
                const appleScheme = url.replace(/^https?:\/\//i, 'maps://');
                await App.openUrl({ url: appleScheme });
                return;
            } catch (_) {}
        }
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
    }

    // 3. Facebook Links
    const isFacebook = /(?:facebook\.com|fb\.me|fb\.watch|m\.me|fb\.com)/i.test(url);
    if (isFacebook) {
        if (isNative) {
            try {
                // Try direct Facebook app deep link
                const fbScheme = `fb://facewebmodal/f?href=${encodeURIComponent(url)}`;
                await App.openUrl({ url: fbScheme });
                return;
            } catch (_) {
                try {
                    await App.openUrl({ url });
                    return;
                } catch (_) {}
            }
        }
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
    }

    // 4. Default External Links
    if (isNative) {
        try {
            await App.openUrl({ url });
            return;
        } catch (_) {}
    }
    window.open(url, '_blank', 'noopener,noreferrer');
}

