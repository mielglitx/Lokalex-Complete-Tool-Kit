// src/utils/otaUpdater.js
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { 
    isNativePlatform, 
    getNativeVersionName, 
    getNativeVersionCode,
    downloadAndInstallApk, 
    canInstallApk, 
    openInstallPermissionSettings 
} from '../native/nativeBridge.js';
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
const OTA_CHECKSUMS_URL = 'https://raw.githubusercontent.com/mielglitx/LokalexOTAUpdate/main/checksums.json';
const CURRENT_BUILT_IN_VERSION = '1.0.6';
let isCheckingUpdate = false;
let globalOtaChecksumsMap = {};

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
 * Renders a full-screen progress modal when downloading a base APK update.
 */
export function showApkInstallProgress(percent, message) {
    let modal = document.getElementById('apk-install-progress-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'apk-install-progress-modal';
        modal.className = 'fixed inset-0 z-[99999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-slate-900 border border-slate-700/80 rounded-2xl p-6 max-w-sm w-full shadow-2xl text-center space-y-4">
                <div class="w-14 h-14 mx-auto rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-2xl font-bold animate-pulse">
                    📦
                </div>
                <h3 class="text-lg font-bold text-white">Lokalex Base App Update</h3>
                <p id="apk-install-status-text" class="text-xs text-slate-300">Nagda-download ng bagong APK update...</p>
                <div class="w-full bg-slate-800 rounded-full h-3 overflow-hidden border border-slate-700">
                    <div id="apk-install-progress-bar" class="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-200 rounded-full" style="width: 0%"></div>
                </div>
                <div id="apk-install-percent-text" class="text-xs font-mono font-semibold text-emerald-400">0%</div>
                <p class="text-[10px] text-slate-400 leading-relaxed">Huwag isara ang app habang nagda-download. Kusang lilitaw ang system installer prompt para i-tap ang 'Update'.</p>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.classList.remove('hidden');
    const statusText = document.getElementById('apk-install-status-text');
    const progressBar = document.getElementById('apk-install-progress-bar');
    const percentText = document.getElementById('apk-install-percent-text');
    if (statusText && message) statusText.textContent = message;
    if (progressBar && percent >= 0) progressBar.style.width = `${Math.min(100, percent)}%`;
    if (percentText && percent >= 0) percentText.textContent = `${percent}%`;
    if (percent >= 100) {
        setTimeout(() => {
            if (modal) modal.classList.add('hidden');
        }, 6000);
    }
}

export function hideApkInstallProgress() {
    const modal = document.getElementById('apk-install-progress-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Triggers the native APK download & package installation.
 */
export function installBaseApk(apkUrl, version = 'latest') {
    if (!isNativePlatform()) {
        showToast("ℹ️ Ang Base APK download ay para lamang sa Android app.");
        return;
    }
    const targetUrl = apkUrl || "https://raw.githubusercontent.com/mielglitx/LokalexOTAUpdate/main/app-release.apk";

    if (canInstallApk && !canInstallApk()) {
        const allow = confirm("⚠️ Kailangan ng pahintulot upang mag-install ng updates.\n\nBuksan ang Android Settings upang i-allow ang 'Install unknown apps' para sa Lokalex?");
        if (allow) {
            openInstallPermissionSettings();
            return;
        }
    }

    showApkInstallProgress(0, "Sinisimulan ang pag-download ng Lokalex Base APK...");
    const ok = downloadAndInstallApk(targetUrl);
    if (!ok) {
        hideApkInstallProgress();
        showToast("⚠️ Hindi masimulan ang APK download. Subukan muli.");
    }
}

// Hook global callbacks invoked by Android MainActivity.java
if (typeof window !== 'undefined') {
    window.onApkInstallProgress = function(percent, message) {
        showApkInstallProgress(percent, message);
    };
    window.onApkInstallError = function(error) {
        hideApkInstallProgress();
        showToast(`⚠️ Hindi ma-install ang APK: ${error}`);
    };
    window.installBaseApk = installBaseApk;
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
        if (isManual) showToast("⚠️ No internet connection.");
        return;
    }

    if (isCheckingUpdate) return;
    isCheckingUpdate = true;

    if (isManual) {
        showToast("🔍 Checking for updates from GitHub...");
    }

    try {
        // Fetch version.json bypassing Fastly CDN cache by trying GitHub API first
        let manifest = null;
        try {
            const apiRes = await fetch(`https://api.github.com/repos/mielglitx/LokalexOTAUpdate/contents/version.json?t=${Date.now()}`, {
                headers: { 'Accept': 'application/vnd.github.v3.raw' },
                cache: 'no-store'
            });
            if (apiRes.ok) {
                manifest = await apiRes.json();
            }
        } catch (_) {}

        if (!manifest) {
            const manifestRes = await fetch(`${OTA_MANIFEST_URL}?t=${Date.now()}`, {
                cache: 'no-store'
            });
            if (manifestRes.ok) {
                manifest = await manifestRes.json();
            }
        }

        if (!manifest) {
            if (isManual) showToast("ℹ️ Unable to access the OTA update repository.");
            return;
        }
        const remoteVersion = manifest.version;
        const downloadUrl = manifest.url;
        const checksum = manifest.checksum;
        const releaseNotes = manifest.notes || "Bug fixes and performance improvements";

        if (!remoteVersion || !downloadUrl) {
            if (isManual) showToast("ℹ️ No new version currently available.");
            return;
        }

        // Check if a newer native Base APK is available (for native Android features like Picture-in-Picture)
        const nativeVersion = manifest.nativeVersion;
        const apkUrl = manifest.apkUrl;
        const currentNativeVersion = getNativeVersionName();

        if (isNativePlatform() && nativeVersion && apkUrl && currentNativeVersion) {
            const hasNativeUpdate = compareVersions(nativeVersion, currentNativeVersion) > 0;
            if (hasNativeUpdate) {
                const proceedApk = confirm(
                    `🚀 May Mahalagang Base App Update (APK)!\n\n` +
                    `Bagong Bersyon: v${nativeVersion}\n` +
                    `Kasalukuyang APK: v${currentNativeVersion}\n\n` +
                    `Mga Pagbabago:\n${releaseNotes}\n\n` +
                    `I-download at i-install ang APK ngayon?\n(Hindi mawawala ang iyong login at data)`
                );
                if (proceedApk) {
                    installBaseApk(apkUrl, nativeVersion);
                    return;
                }
            }
        }

        const currentVersion = await getCurrentAppVersion();
        const hasUpdate = compareVersions(remoteVersion, currentVersion) > 0;

        if (!hasUpdate) {
            if (isManual) {
                const force = confirm(`✅ Lokalex Hub is up to date (v${currentVersion}).\n\nWould you like to force re-download and re-apply the update from the server?`);
                if (!force) return;
            } else {
                return;
            }
        } else {
            // Update is available!
            if (isManual) {
                const proceed = confirm(`🚀 New update available!\n\nVersion: v${remoteVersion}\nCurrent: v${currentVersion}\n\nUpdates:\n${releaseNotes}\n\nDownload and apply now?`);
                if (!proceed) return;
            }
        }

        showToast(`⏳ Downloading v${remoteVersion} update...`);

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
                showToast(`🎉 Downloaded v${remoteVersion}! Applying update...`);

                try {
                    await CapacitorUpdater.set({ id: bundle.id });
                } catch (setErr) {
                    console.warn("[OTA] CapacitorUpdater.set error, attempting reload:", setErr);
                }

                if (isManual) {
                    setTimeout(() => {
                        window.location.reload();
                    }, 800);
                } else if (!document.hidden) {
                    const chatOpen = document.getElementById('rider-chat-modal') || document.getElementById('rider-customer-chat-modal');
                    const isChatting = chatOpen && !chatOpen.classList.contains('hidden');
                    if (!isChatting) {
                        showToast(`✨ v${remoteVersion} is ready. Applying update...`);
                        setTimeout(() => {
                            window.location.reload();
                        }, 1200);
                    } else {
                        showToast(`✨ v${remoteVersion} is ready. Will apply on next restart.`);
                    }
                } else {
                    console.log(`[OTA] v${remoteVersion} staged. App is minimized in background, will apply on next restart.`);
                }
            } else {
                throw new Error("No bundle ID returned from updater");
            }
        } else {
            // In web browser mode, service worker handles assets, but we still store version
            localStorage.setItem('lokalex_ota_version', remoteVersion);
            showToast(`✅ New version v${remoteVersion} detected! Refreshing...`);
            setTimeout(() => window.location.reload(), 1500);
        }
    } catch (err) {
        console.error("[OTA] Update check error:", err);
        showToast(`⚠️ Unable to update: ${err.message || 'Try again later'}`);
    } finally {
        isCheckingUpdate = false;
    }
}

/**
 * Fetches all available OTA release zips from GitHub repository.
 */
export async function fetchAvailableOtaVersions() {
    const versions = [];
    try {
        // Fetch checksums manifest in parallel
        try {
            const chkRes = await fetch(`${OTA_CHECKSUMS_URL}?t=${Date.now()}`, { cache: 'no-store' });
            if (chkRes.ok) {
                globalOtaChecksumsMap = await chkRes.json();
            }
        } catch (_) {}

        const res = await fetch(`https://api.github.com/repos/mielglitx/LokalexOTAUpdate/contents?t=${Date.now()}`, {
            headers: { 'Accept': 'application/vnd.github.v3+json' },
            cache: 'no-store'
        });
        if (res.ok) {
            const files = await res.json();
            if (Array.isArray(files)) {
                files.forEach(f => {
                    const match = f.name && f.name.match(/^dist-v(\d+\.\d+\.\d+)\.zip$/);
                    if (match) {
                        const ver = match[1];
                        versions.push({
                            version: ver,
                            fileName: f.name,
                            url: `https://raw.githubusercontent.com/mielglitx/LokalexOTAUpdate/main/${f.name}`,
                            checksum: globalOtaChecksumsMap[ver] || '',
                            size: f.size ? `${(f.size / (1024 * 1024)).toFixed(2)} MB` : ''
                        });
                    }
                });
            }
        }
    } catch (e) {
        console.warn("[OTA] GitHub contents fetch failed:", e);
    }

    // Sort descending by semantic version (e.g. 1.0.50, 1.0.49, ..., 1.0.9)
    versions.sort((a, b) => compareVersions(b.version, a.version));

    // Fallback if GitHub API rate-limits
    if (versions.length === 0) {
        const knownVersions = [
            '1.0.50', '1.0.49', '1.0.48', '1.0.47', '1.0.46', '1.0.45', '1.0.44', '1.0.43', '1.0.42', '1.0.41',
            '1.0.40', '1.0.39', '1.0.38', '1.0.37', '1.0.36', '1.0.35', '1.0.34', '1.0.33', '1.0.32', '1.0.31',
            '1.0.30', '1.0.29', '1.0.28', '1.0.27', '1.0.26', '1.0.25', '1.0.24', '1.0.23', '1.0.22', '1.0.21',
            '1.0.20', '1.0.19', '1.0.18', '1.0.17', '1.0.16', '1.0.15', '1.0.14', '1.0.13', '1.0.12', '1.0.11',
            '1.0.10', '1.0.9'
        ];
        knownVersions.forEach(ver => {
            versions.push({
                version: ver,
                fileName: `dist-v${ver}.zip`,
                url: `https://raw.githubusercontent.com/mielglitx/LokalexOTAUpdate/main/dist-v${ver}.zip`,
                checksum: globalOtaChecksumsMap[ver] || '',
                size: '0.80 MB'
            });
        });
    }

    return versions;
}

/**
 * Installs or rolls back to a specific OTA version.
 */
export async function installSpecificOtaVersion(version, customUrl = null, customChecksum = null) {
    if (!version) return;
    const cleanVer = version.toString().trim().replace(/^v/i, '');
    const currentVersion = await getCurrentAppVersion();
    const isRollback = compareVersions(cleanVer, currentVersion) < 0;
    const isSame = compareVersions(cleanVer, currentVersion) === 0;

    const actionName = isRollback ? "Rollback" : (isSame ? "Reinstall" : "Update");
    const confirmMsg = `${actionName} the app to version v${cleanVer}?\n\nCurrent version: v${currentVersion}\n\nThe bundle will be downloaded and applied from GitHub.`;

    if (!confirm(confirmMsg)) return;

    const downloadUrl = customUrl || `https://raw.githubusercontent.com/mielglitx/LokalexOTAUpdate/main/dist-v${cleanVer}.zip`;

    showToast(`⏳ Downloading v${cleanVer}...`);

    try {
        if (isNativePlatform()) {
            // Resolve checksum required by CapacitorUpdater v8+
            let resolvedChecksum = customChecksum || globalOtaChecksumsMap[cleanVer] || null;
            if (!resolvedChecksum) {
                try {
                    const chkRes = await fetch(`${OTA_CHECKSUMS_URL}?t=${Date.now()}`, { cache: 'no-store' });
                    if (chkRes.ok) {
                        globalOtaChecksumsMap = await chkRes.json();
                        resolvedChecksum = globalOtaChecksumsMap[cleanVer] || null;
                    }
                } catch (_) {}
            }

            const downloadOpts = {
                url: downloadUrl,
                version: cleanVer
            };
            if (resolvedChecksum) {
                downloadOpts.checksum = resolvedChecksum;
            }

            console.log(`[OTA] Installing specific version ${cleanVer} from ${downloadUrl} (checksum: ${resolvedChecksum || 'none'})...`);
            const bundle = await CapacitorUpdater.download(downloadOpts);

            if (bundle && bundle.id) {
                localStorage.setItem('lokalex_ota_version', cleanVer);
                showToast(`🎉 Downloaded v${cleanVer}! Applying bundle...`);

                try {
                    await CapacitorUpdater.set({ id: bundle.id });
                } catch (setErr) {
                    console.warn("[OTA] CapacitorUpdater.set error, attempting reload:", setErr);
                }

                setTimeout(() => {
                    window.location.reload();
                }, 800);
            } else {
                throw new Error("No bundle ID returned from updater");
            }
        } else {
            localStorage.setItem('lokalex_ota_version', cleanVer);
            showToast(`✅ Set to v${cleanVer}! Reloading...`);
            setTimeout(() => window.location.reload(), 1200);
        }
    } catch (err) {
        console.error(`[OTA] Failed to install version ${cleanVer}:`, err);
        showToast(`⚠️ Unable to install v${cleanVer}: ${err.message || 'Error'}`);
    }
}

/**
 * Resets the app back to the built-in factory APK version.
 */
export async function resetToBuiltinVersion() {
    if (!confirm(`⚠️ Reset the app back to the factory APK bundle (v${CURRENT_BUILT_IN_VERSION})?\n\nAll downloaded live updates will be removed.`)) {
        return;
    }

    showToast("⏳ Clearing live updates...");

    try {
        if (isNativePlatform()) {
            await CapacitorUpdater.reset();
        }
        localStorage.setItem('lokalex_ota_version', CURRENT_BUILT_IN_VERSION);
        showToast("✨ Reset to factory APK! Reloading...");
        setTimeout(() => {
            window.location.reload();
        }, 800);
    } catch (err) {
        console.error("[OTA] Reset error:", err);
        showToast(`⚠️ Reset error: ${err.message || 'Error'}`);
    }
}

/**
 * Opens the OTA update selector modal and loads available versions.
 */
export async function openOtaUpdateSelectorModal() {
    const modal = document.getElementById('ota-update-selector-modal');
    if (!modal) return;

    modal.classList.remove('hidden');

    const curVerEl = document.getElementById('ota-current-version-badge');
    const listEl = document.getElementById('ota-versions-list');

    const currentVersion = await getCurrentAppVersion();
    if (curVerEl) curVerEl.textContent = `v${currentVersion}`;

    if (listEl) {
        listEl.innerHTML = `
            <div class="text-center text-gray-500 italic py-10 flex flex-col items-center gap-2 text-xs">
                <i class="fa-solid fa-spinner fa-spin text-emerald-500 text-lg"></i>
                <span>Fetching available updates from GitHub...</span>
            </div>
        `;
    }

    try {
        const versions = await fetchAvailableOtaVersions();
        renderOtaVersionsList(versions, currentVersion);
    } catch (e) {
        if (listEl) {
            listEl.innerHTML = `<div class="text-center text-red-500 py-8 text-xs">Failed to load versions from GitHub. Please try again.</div>`;
        }
    }
}

export function closeOtaUpdateSelectorModal() {
    const modal = document.getElementById('ota-update-selector-modal');
    if (modal) modal.classList.add('hidden');
}

export function applyCustomOtaInput() {
    const input = document.getElementById('ota-custom-version-input');
    const val = input ? input.value.trim() : "";
    if (!val) {
        showToast("⚠️ Please enter the version (e.g. 1.0.28) or zip URL.");
        return;
    }

    if (val.startsWith('http://') || val.startsWith('https://')) {
        const verName = prompt("Enter the label/version name for the custom bundle (e.g. 1.0.28-custom):", "custom");
        if (!verName) return;
        installSpecificOtaVersion(verName, val);
    } else {
        const clean = val.replace(/^v/i, '');
        installSpecificOtaVersion(clean);
    }
}

function renderOtaVersionsList(versions, currentVersion) {
    const listEl = document.getElementById('ota-versions-list');
    if (!listEl) return;

    if (!versions || versions.length === 0) {
        listEl.innerHTML = `<div class="text-center text-gray-500 py-8 text-xs italic">No available updates found.</div>`;
        return;
    }

    const nativeVer = getNativeVersionName();
    let nativeCardHtml = '';
    if (isNativePlatform() && nativeVer) {
        nativeCardHtml = `
            <div class="bg-gradient-to-r from-emerald-950/40 to-teal-950/40 border border-emerald-500/50 rounded-2xl p-3 flex items-center justify-between gap-3 mb-2">
                <div class="flex items-center gap-3 min-w-0 flex-1">
                    <div class="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center shrink-0 text-base">
                        <i class="fa-solid fa-mobile-screen"></i>
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="font-bold text-xs sm:text-sm text-white">Lokalex Base APK</span>
                            <span class="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full">v${nativeVer}</span>
                        </div>
                        <p class="text-[10px] text-slate-300 truncate mt-0.5">
                            Native Android app (Picture-in-Picture & Auto-Updater)
                        </p>
                    </div>
                </div>
                <div class="shrink-0">
                    <button type="button" onclick="window.installBaseApk && window.installBaseApk()" class="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 shadow-xs cursor-pointer">
                        <i class="fa-solid fa-download text-xs"></i> Update APK
                    </button>
                </div>
            </div>
        `;
    }

    const latestVer = versions[0]?.version;

    listEl.innerHTML = nativeCardHtml + versions.map((item) => {
        const isCurrent = compareVersions(item.version, currentVersion) === 0;
        const isLatest = item.version === latestVer;
        const isRollback = compareVersions(item.version, currentVersion) < 0;

        let badgeHtml = '';
        if (isCurrent) {
            badgeHtml = `<span class="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-600/40 text-[9px] font-bold px-2 py-0.5 rounded-full">Active</span>`;
        } else if (isLatest) {
            badgeHtml = `<span class="bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-600/40 text-[9px] font-bold px-2 py-0.5 rounded-full">Latest</span>`;
        } else if (isRollback) {
            badgeHtml = `<span class="bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-600/40 text-[9px] font-bold px-2 py-0.5 rounded-full">Past Release</span>`;
        }

        let actionBtn = '';
        if (isCurrent) {
            actionBtn = `
                <button type="button" onclick="window.installSpecificOtaVersion && window.installSpecificOtaVersion('${item.version}', '${item.url}', '${item.checksum || ''}')" class="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-[11px] font-bold px-3 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 shadow-xs cursor-pointer">
                    <i class="fa-solid fa-rotate text-xs text-emerald-500"></i> Reinstall
                </button>
            `;
        } else if (isRollback) {
            actionBtn = `
                <button type="button" onclick="window.installSpecificOtaVersion && window.installSpecificOtaVersion('${item.version}', '${item.url}', '${item.checksum || ''}')" class="bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 shadow-xs cursor-pointer">
                    <i class="fa-solid fa-clock-rotate-left text-xs"></i> Rollback
                </button>
            `;
        } else {
            actionBtn = `
                <button type="button" onclick="window.installSpecificOtaVersion && window.installSpecificOtaVersion('${item.version}', '${item.url}', '${item.checksum || ''}')" class="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 shadow-xs cursor-pointer">
                    <i class="fa-solid fa-cloud-arrow-down text-xs"></i> Install
                </button>
            `;
        }

        return `
            <div class="bg-white dark:bg-cardBg border ${isCurrent ? 'border-emerald-500/70 shadow-sm' : 'border-gray-200 dark:border-gray-800'} rounded-2xl p-3 flex items-center justify-between gap-3 transition">
                <div class="flex items-center gap-3 min-w-0 flex-1">
                    <div class="w-10 h-10 rounded-xl ${isCurrent ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/50' : 'bg-gray-100 dark:bg-black/30 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-800'} flex items-center justify-center shrink-0">
                        <i class="fa-solid ${isCurrent ? 'fa-circle-check text-base' : 'fa-box-archive text-sm'}"></i>
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="font-bold text-xs sm:text-sm text-gray-900 dark:text-white font-mono">v${item.version}</span>
                            ${badgeHtml}
                        </div>
                        <p class="text-[10px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
                            ${item.fileName} ${item.size ? `• ${item.size}` : ''}
                        </p>
                    </div>
                </div>
                <div class="shrink-0">
                    ${actionBtn}
                </div>
            </div>
        `;
    }).join('');
}

// Bind to window for HTML button onclick
if (typeof window !== 'undefined') {
    window.checkForOtaUpdate = checkForOtaUpdate;
    window.getCurrentAppVersion = getCurrentAppVersion;
    window.syncVersionTrackerElements = syncVersionTrackerElements;
    window.fetchAvailableOtaVersions = fetchAvailableOtaVersions;
    window.installSpecificOtaVersion = installSpecificOtaVersion;
    window.resetToBuiltinVersion = resetToBuiltinVersion;
    window.openOtaUpdateSelectorModal = openOtaUpdateSelectorModal;
    window.closeOtaUpdateSelectorModal = closeOtaUpdateSelectorModal;
    window.applyCustomOtaInput = applyCustomOtaInput;
    window.installBaseApk = installBaseApk;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { syncVersionTrackerElements(); });
    } else {
        syncVersionTrackerElements();
    }
}

