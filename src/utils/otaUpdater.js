// src/utils/otaUpdater.js
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { isNativePlatform } from '../native/nativeBridge.js';
import { showToast } from '../ui/notifications.js';

/**
 * ============================================================================
 * LOKALEX GITHUB OTA (OVER-THE-AIR) LIVE UPDATER
 * ============================================================================
 * Repository: https://github.com/mielglitx/LokalexOTAUpdate
 * 
 * Flow:
 * 1. Checks https://raw.githubusercontent.com/mielglitx/LokalexOTAUpdate/main/version.json
 * 2. Compares semantic / build versions against active bundle.
 * 3. Downloads dist.zip directly from GitHub releases or main branch.
 * 4. Hot-swaps the active web assets without requiring a full APK reinstall.
 * 5. Calls notifyAppReady() on startup to confirm boot integrity & avoid rollback.
 * ============================================================================
 */

const OTA_MANIFEST_URL = 'https://raw.githubusercontent.com/mielglitx/LokalexOTAUpdate/main/version.json';
const CURRENT_BUILT_IN_VERSION = '1.0.6';
let isCheckingUpdate = false;

/**
 * Safely compares two version strings (e.g. "1.0.2" vs "1.0.1").
 * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 */
function compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;
    const parts1 = v1.toString().replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const parts2 = v2.toString().replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const maxLen = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLen; i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;
        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }
    return 0;
}

/**
 * Retrieves the currently running version (from Capgo bundle or default).
 */
export async function getCurrentAppVersion() {
    if (isNativePlatform()) {
        try {
            const current = await CapacitorUpdater.current();
            if (current?.bundle?.version) {
                return current.bundle.version;
            }
        } catch (_) {}
    }
    return localStorage.getItem('lokalex_ota_version') || CURRENT_BUILT_IN_VERSION;
}

/**
 * Synchronizes all version tracker elements in the UI.
 */
export async function syncVersionTrackerElements() {
    try {
        const version = await getCurrentAppVersion();
        const els = document.querySelectorAll('.app-version-tracker');
        els.forEach(el => {
            el.textContent = `v${version}`;
        });
        const fullEls = document.querySelectorAll('.app-version-full-tracker');
        fullEls.forEach(el => {
            el.textContent = `Lokalex Hub v${version}`;
        });
    } catch (_) {}
}

/**
 * Initializes the OTA update engine on app boot.
 */
export async function initOtaUpdater() {
    syncVersionTrackerElements().catch(() => {});
    if (!isNativePlatform()) return;

    try {
        // 1. Confirm bundle boot was successful to prevent auto-rollback
        await CapacitorUpdater.notifyAppReady().catch(() => {});
        console.log("🚀 [OTA] Notified app ready to CapacitorUpdater");

        // 2. Check for updates automatically in the background (silent)
        setTimeout(() => {
            checkForOtaUpdate(false).catch(() => {});
        }, 5000);
    } catch (e) {
        console.warn("[OTA] Initialization warning:", e);
    }
}

/**
 * Checks GitHub for an OTA update.
 * @param {boolean} isManual - true when triggered by user button click
 */
export async function checkForOtaUpdate(isManual = false) {
    if (!navigator.onLine) {
        if (isManual) showToast("⚠️ Walang internet connection.");
        return;
    }

    if (isCheckingUpdate) return;
    isCheckingUpdate = true;

    if (isManual) {
        showToast("🔍 Sinusuri ang updates mula sa GitHub...");
    }

    try {
        // Fetch version.json from GitHub with cache-busting timestamp
        const manifestRes = await fetch(`${OTA_MANIFEST_URL}?t=${Date.now()}`, {
            cache: 'no-store'
        });

        if (!manifestRes.ok) {
            if (isManual) showToast("ℹ️ Hindi ma-access ang OTA update repository.");
            return;
        }

        const manifest = await manifestRes.json();
        const remoteVersion = manifest.version;
        const downloadUrl = manifest.url;
        const checksum = manifest.checksum;
        const releaseNotes = manifest.notes || "Bug fixes at performance improvements";

        if (!remoteVersion || !downloadUrl) {
            if (isManual) showToast("ℹ️ Walang bagong bersyon sa kasalukuyan.");
            return;
        }

        const currentVersion = await getCurrentAppVersion();
        const hasUpdate = compareVersions(remoteVersion, currentVersion) > 0;

        if (!hasUpdate) {
            if (isManual) {
                const force = confirm(`✅ Lokalex Hub is up to date (v${currentVersion}).\n\nNais mo bang i-force re-download at i-apply muli ang update mula sa server?`);
                if (!force) return;
            } else {
                return;
            }
        } else {
            // Update is available!
            if (isManual) {
                const proceed = confirm(`🚀 May bagong update na available!\n\nBersyon: v${remoteVersion}\nKasalukuyan: v${currentVersion}\n\nUpdates:\n${releaseNotes}\n\nI-download at i-apply na ba ngayon?`);
                if (!proceed) return;
            }
        }

        showToast(`⏳ Dina-download ang v${remoteVersion} update...`);

        if (isNativePlatform()) {
            console.log(`[OTA] Initiating download from ${downloadUrl} (version ${remoteVersion}, checksum ${checksum || 'none'})...`);
            const downloadOpts = {
                url: downloadUrl,
                version: remoteVersion
            };
            if (checksum) {
                downloadOpts.checksum = checksum;
            }

            const bundle = await CapacitorUpdater.download(downloadOpts);

            console.log("[OTA] Download completed successfully, bundle info:", bundle);

            if (bundle && bundle.id) {
                localStorage.setItem('lokalex_ota_version', remoteVersion);
                showToast(`🎉 Na-download ang v${remoteVersion}! Inilalapat ang update...`);

                try {
                    await CapacitorUpdater.set({ id: bundle.id });
                } catch (setErr) {
                    console.warn("[OTA] CapacitorUpdater.set error, attempting reload:", setErr);
                }

                // If native webview hasn't already reloaded itself, force reload
                setTimeout(() => {
                    window.location.reload();
                }, 800);
            } else {
                throw new Error("No bundle ID returned from updater");
            }
        } else {
            // In web browser mode, service worker handles assets, but we still store version
            localStorage.setItem('lokalex_ota_version', remoteVersion);
            showToast(`✅ Bagong bersyon v${remoteVersion} na-detect! Nagre-refresh...`);
            setTimeout(() => window.location.reload(), 1500);
        }
    } catch (err) {
        console.error("[OTA] Update check error:", err);
        showToast(`⚠️ Hindi ma-update: ${err.message || 'Subukan muli mamaya'}`);
    } finally {
        isCheckingUpdate = false;
    }
}

// Bind to window for HTML button onclick
if (typeof window !== 'undefined') {
    window.checkForOtaUpdate = checkForOtaUpdate;
    window.getCurrentAppVersion = getCurrentAppVersion;
    window.syncVersionTrackerElements = syncVersionTrackerElements;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { syncVersionTrackerElements(); });
    } else {
        syncVersionTrackerElements();
    }
}

