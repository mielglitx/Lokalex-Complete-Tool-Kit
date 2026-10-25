// src/utils/helpers.js
import { appState } from '../store/state.js';
import { showToast } from '../ui/notifications.js';

export function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Escapes strings for safe embedding inside inline HTML onclick single-quoted JavaScript arguments.
 * Prevents unescaped single quotes or special characters from terminating string literals.
 */
export function escapeJsAttr(str) {
    if (!str) return "";
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Generates a Firebase RTDB safe key while preserving full international unicode
 * alphabets (Latin with accents/diacritics, Asian scripts, Arabic, Cyrillic, etc.).
 * Guarantees a non-empty key free from Firebase-forbidden characters: . # $ [ ] /
 */
export function sanitizeFirebaseKey(raw) {
    if (!raw) return 'cust_' + Date.now().toString(36);
    let normalized = "";
    try {
        normalized = String(raw).normalize('NFKC').trim().toLowerCase();
    } catch (e) {
        normalized = String(raw).trim().toLowerCase();
    }
    // Replace characters forbidden by Firebase (. # $ [ ] /), control chars, and whitespace
    let safe = normalized.replace(/[.#$\[\]\/\x00-\x1F\x7F\s]+/g, '_').replace(/^_+|_+$/g, '');
    if (!safe) {
        safe = 'cust_' + Array.from(String(raw)).map(c => c.charCodeAt(0).toString(16)).join('').slice(0, 16) || ('cust_' + Date.now().toString(36));
    }
    return safe;
}

/**
 * Normalizes customer name for unicode-tolerant matching across international scripts.
 */
export function cleanCustomerForMatch(name = "") {
    if (!name) return "";
    let normalized = "";
    try {
        normalized = String(name).normalize('NFKC').trim().toLowerCase();
    } catch (e) {
        normalized = String(name).trim().toLowerCase();
    }
    const cleaned = normalized.replace(/[^\p{L}\p{N}]/gu, '');
    return cleaned || normalized.replace(/\s+/g, '');
}

export function formatTitleCase(str) {
    if (!str) return "";
    return String(str)
        .toLowerCase()
        .trim()
        .replace(/(?:^|\s|-|\/|\.)\S/g, (char) => char.toUpperCase());
}

export function copyText(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
    } catch (err) {
        console.error('Fallback: Oops, unable to copy', err);
    }
    document.body.removeChild(textArea);
}

export function getLocalTodayStr() {
    const d = new Date();
    const tzOffsetMs = d.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzOffsetMs)).toISOString().slice(0, 10);
    return localISOTime;
}

// RESTORED: Required by roster.js to check daily shifts
export function isSameDate(date1, date2) {
    if (!date1 || !date2) return false;
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

// Get the YYYY-W## format for a given timestamp
export function getWeekString(timestamp) {
    const date = new Date(timestamp);
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

// Get the YYYY-MM format for a given timestamp
export function getMonthString(timestamp) {
    const d = new Date(timestamp);
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${d.getFullYear()}-${m}`;
}

// Get the YYYY-MM-DD format for a given timestamp
export function getDateString(timestamp) {
    const d = new Date(timestamp);
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
}

// -------------------------------------------------------------
// HARDWARE / PLATFORM DETECTOR (ANDROID vs iOS vs PC/DESKTOP)
// -------------------------------------------------------------
export function getDevicePlatform() {
    if (typeof navigator === 'undefined') return 'pc';
    const ua = navigator.userAgent || navigator.vendor || window.opera || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) return 'ios';
    if (/android/i.test(ua)) return 'android';
    return 'pc';
}

/**
 * Detects if the current webpage is loaded inside an In-App Browser
 * (Facebook Messenger, Facebook Feed, Instagram, TikTok, Line, etc.)
 */
export function isInAppBrowser() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || navigator.vendor || window.opera || '';
    return /FBAN|FBAV|FB_IAB|Messenger|Instagram|TikTok|Line|WhatsApp/i.test(ua);
}

/**
 * Builds an Android Chrome Intent URL to break out of WebView into standalone Google Chrome.
 */
export function getChromeIntentUrl(targetUrl = window.location.href) {
    const cleanUrl = (targetUrl || window.location.href).replace(/^https?:\/\//i, '');
    return `intent://${cleanUrl}#Intent;scheme=https;package=com.android.chrome;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;S.browser_fallback_url=${encodeURIComponent(targetUrl)};end`;
}

/**
 * Forces the device to launch the link in standalone Google Chrome or external browser.
 */
export function forceOpenExternalBrowser(targetUrl = window.location.href) {
    if (typeof window === 'undefined') return;
    const platform = getDevicePlatform();
    const cleanUrl = targetUrl.replace(/^https?:\/\//i, '');

    if (platform === 'android') {
        const intentUrl = getChromeIntentUrl(targetUrl);
        window.location.href = intentUrl;
    } else if (platform === 'ios') {
        // iOS Google Chrome custom scheme
        window.location.href = `googlechromes://${cleanUrl}`;
        setTimeout(() => {
            window.location.href = targetUrl;
        }, 1200);
    } else {
        window.open(targetUrl, '_blank');
    }
}

// -------------------------------------------------------------
// DYNAMIC COLOR SCHEME / THEME CONTROLLER (LIGHT / DARK / SYSTEM)
// -------------------------------------------------------------
let systemThemeMediaQuery = null;

export function toggleAppTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    const newTheme = isDark ? 'light' : 'dark';
    setTheme(newTheme);
}

export function initTheme() {
    try {
        const v3Flag = localStorage.getItem('lokalex_light_theme_enforced_v3');
        if (!v3Flag) {
            localStorage.setItem('lokalex_theme', 'light');
            localStorage.setItem('lokalex_theme_preference', 'light');
            localStorage.setItem('lokalex_light_theme_enforced_v3', 'true');
        }
    } catch(e) {}

    let preference = localStorage.getItem('lokalex_theme_preference') || localStorage.getItem('lokalex_theme') || 'light';
    if (preference === 'system') preference = 'light';
    applyTheme(preference, false);
}

export function setTheme(preference = 'light') {
    localStorage.setItem('lokalex_theme_preference', preference);
    localStorage.setItem('lokalex_theme', preference);
    appState.themePreference = preference;
    applyTheme(preference, true);
}

export function applyTheme(preference = 'light', notify = false) {
    if (preference === 'system') preference = 'light';
    const isDark = preference === 'dark';
    const root = document.documentElement;

    if (isDark) {
        root.classList.add('dark');
        root.classList.remove('light');
        root.style.backgroundColor = '#0C1814';
        root.style.colorScheme = 'dark';
        if (document.body) {
            document.body.style.backgroundColor = '#0C1814';
            document.body.style.color = '#F8FAFC';
        }
    } else {
        root.classList.remove('dark');
        root.classList.add('light');
        root.style.backgroundColor = '#EDF7F2';
        root.style.colorScheme = 'light';
        if (document.body) {
            document.body.style.backgroundColor = '#EDF7F2';
            document.body.style.color = '#0F172A';
        }
    }

    const metaTheme = document.getElementById('meta-theme-color');
    if (metaTheme) {
        metaTheme.setAttribute('content', isDark ? '#0C1814' : '#EDF7F2');
    }

    updateThemeToggleUI(preference);

    if (notify) {
        const labels = { light: '☀️ Light Mode', dark: '🌙 Dark Mode' };
        showToast(`Theme set to ${labels[preference] || preference}`);
    }
}

export function updateThemeToggleUI(activePref = 'light') {
    const lightBtn = document.getElementById('theme-btn-light');
    const systemBtn = document.getElementById('theme-btn-system');
    const darkBtn = document.getElementById('theme-btn-dark');

    const activeClasses = "bg-blue-600 text-white shadow font-bold";
    const inactiveClasses = "text-gray-400 hover:text-white";

    if (lightBtn) lightBtn.className = `w-6 h-6 rounded-lg flex items-center justify-center transition ${activePref === 'light' ? activeClasses : inactiveClasses}`;
    if (systemBtn) systemBtn.className = `w-6 h-6 rounded-lg flex items-center justify-center transition ${activePref === 'system' ? activeClasses : inactiveClasses}`;
    if (darkBtn) darkBtn.className = `w-6 h-6 rounded-lg flex items-center justify-center transition ${activePref === 'dark' ? activeClasses : inactiveClasses}`;
}

// Auto-run theme initialization
if (typeof window !== 'undefined') {
    window.formatTitleCase = formatTitleCase;
    window.escapeJsAttr = escapeJsAttr;
    window.sanitizeFirebaseKey = sanitizeFirebaseKey;
    window.cleanCustomerForMatch = cleanCustomerForMatch;
    window.getDevicePlatform = getDevicePlatform;
    window.isInAppBrowser = isInAppBrowser;
    window.getChromeIntentUrl = getChromeIntentUrl;
    window.forceOpenExternalBrowser = forceOpenExternalBrowser;
    window.initTheme = initTheme;
    window.setTheme = setTheme;
    window.applyTheme = applyTheme;
    window.toggleAppTheme = toggleAppTheme;
    initTheme();
}