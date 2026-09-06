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

// -------------------------------------------------------------
// DYNAMIC COLOR SCHEME / THEME CONTROLLER (LIGHT / DARK / SYSTEM)
// -------------------------------------------------------------
let systemThemeMediaQuery = null;

export function initTheme() {
    const preference = localStorage.getItem('lokalex_theme_preference') || 'system';
    applyTheme(preference, false);

    if (!systemThemeMediaQuery) {
        systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        systemThemeMediaQuery.addEventListener('change', () => {
            const currentPref = localStorage.getItem('lokalex_theme_preference') || 'system';
            if (currentPref === 'system') {
                applyTheme('system', false);
            }
        });
    }
}

export function setTheme(preference = 'system') {
    localStorage.setItem('lokalex_theme_preference', preference);
    appState.themePreference = preference;
    applyTheme(preference, true);
}

export function applyTheme(preference = 'system', notify = false) {
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = preference === 'dark' || (preference === 'system' && systemPrefersDark);

    if (isDark) {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
    } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
    }

    const metaTheme = document.getElementById('meta-theme-color');
    if (metaTheme) {
        metaTheme.setAttribute('content', isDark ? '#121212' : '#FFFFFF');
    }

    updateThemeToggleUI(preference);

    if (notify) {
        const labels = { light: '☀️ Light Mode', dark: '🌙 Dark Mode', system: '💻 System Default' };
        showToast(`Theme set to ${labels[preference] || preference}`);
    }
}

export function updateThemeToggleUI(activePref = 'system') {
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
    window.getDevicePlatform = getDevicePlatform;
    window.initTheme = initTheme;
    window.setTheme = setTheme;
    window.applyTheme = applyTheme;
    initTheme();
}