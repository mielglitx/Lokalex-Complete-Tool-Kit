// src/native/nativeBridge.js
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';

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
            // Check open modals in order of z-index priority
            const modals = [
                { id: 'chat-sound-settings-modal', closeFn: window.closeChatSoundSettingsModal },
                { id: 'quick-replies-edit-modal', closeFn: window.closeQuickReplyEditModal },
                { id: 'rider-chat-modal', closeFn: window.closeRiderChatModal },
                { id: 'customer-details-modal', closeFn: () => {
                    const el = document.getElementById('customer-details-modal');
                    if (el) el.classList.add('hidden');
                }},
                { id: 'pod-capture-modal', closeFn: () => {
                    const el = document.getElementById('pod-capture-modal');
                    if (el) el.classList.add('hidden');
                }},
                { id: 'rider-sources-filter-modal', closeFn: window.closeRiderChatSourcesModal },
                { id: 'admin-fb-api-modal', closeFn: window.closeAdminFbApiModal },
                { id: 'slide-delete-confirm-modal', closeFn: window.closeSlideDeleteModal }
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
        App.addListener('appStateChange', (state) => {
            if (state.isActive) {
                // Rider returned to the app (from Google Maps / Waze / Screen Unlock)
                window.dispatchEvent(new Event('appResumedFromBackground'));
            } else {
                // Rider switched apps or locked screen
                window.dispatchEvent(new Event('appPausedToBackground'));
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

if (typeof window !== 'undefined') {
    window.isNativePlatform = isNativePlatform;
    window.triggerNativeHaptic = triggerNativeHaptic;
    window.requestNativePermissions = requestNativePermissions;
    window.areNativePermissionsGranted = areNativePermissionsGranted;
    window.openNativeAppSettings = openNativeAppSettings;
}

