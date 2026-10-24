// src/features/settings/fontSettings.js

const STORAGE_KEY = 'lokalex_font_scales';

const DEFAULT_SCALES = {
    app: 1.0,
    ui: 1.0,
    chat: 1.0,
    roster: 1.0
};

/**
 * Retrieves the persisted font scale configuration from localStorage.
 */
export function getFontScales() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return {
                app: Number(parsed.app) || 1.0,
                ui: Number(parsed.ui) || 1.0,
                chat: Number(parsed.chat) || 1.0,
                roster: Number(parsed.roster) || 1.0
            };
        }
    } catch (_) {}
    return { ...DEFAULT_SCALES };
}

/**
 * Applies the CSS variables and dynamically injects scaling rules into the document.
 */
export function applyFontScales(scales = null) {
    const current = scales || getFontScales();
    const appScale = current.app || 1.0;
    const uiScale = current.ui || 1.0;
    const chatScale = current.chat || 1.0;
    const rosterScale = current.roster || 1.0;

    let styleEl = document.getElementById('lokalex-font-scaling-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'lokalex-font-scaling-style';
        document.head.appendChild(styleEl);
    }

    styleEl.textContent = `
        :root {
            --app-font-scale: ${appScale};
            --ui-font-scale: ${uiScale};
            --chat-font-scale: ${chatScale};
            --roster-font-scale: ${rosterScale};
        }
        html {
            font-size: calc(16px * var(--app-font-scale, 1)) !important;
        }
        body {
            font-size: calc(1rem * var(--ui-font-scale, 1));
        }
        #rider-chat-modal, 
        #rider-customer-chat-modal, 
        #rider-chat-messages-container, 
        #rider-cust-chat-messages, 
        .thread-swipe-wrapper, 
        #feed-container, 
        #chat-feed-list,
        .chat-message-bubble {
            font-size: calc(1rem * var(--chat-font-scale, 1));
        }
        #roster-table, 
        #roster-lineup-container, 
        #roster-active-list, 
        #roster-waiting-list,
        .roster-card {
            font-size: calc(1rem * var(--roster-font-scale, 1));
        }
    `;

    syncFontSettingsUI(current);
}

/**
 * Sets a specific font scale (e.g. module='app' | 'chat' | 'ui' | 'roster', value=1.1)
 */
export function setFontScale(moduleKey, value) {
    const current = getFontScales();
    const numVal = parseFloat(value) || 1.0;
    current[moduleKey] = numVal;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch (_) {}
    applyFontScales(current);
}

/**
 * Resets all font scales back to default 100%.
 */
export function resetFontScales() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SCALES));
    } catch (_) {}
    applyFontScales(DEFAULT_SCALES);
}

/**
 * Synchronizes the active pill button states in the Profile Settings modal.
 */
export function syncFontSettingsUI(scales = null) {
    const current = scales || getFontScales();
    const modules = ['app', 'ui', 'chat', 'roster'];

    modules.forEach(mod => {
        const val = current[mod] || 1.0;
        const groupEl = document.getElementById(`font-scale-group-${mod}`);
        if (!groupEl) return;

        const btns = groupEl.querySelectorAll('[data-scale]');
        btns.forEach(btn => {
            const btnScale = parseFloat(btn.getAttribute('data-scale'));
            if (Math.abs(btnScale - val) < 0.02) {
                btn.className = "px-2.5 py-1.5 rounded-xl border border-blue-500 bg-blue-600 text-white font-extrabold text-[11px] flex items-center justify-center transition active:scale-95 shadow-xs";
            } else {
                btn.className = "px-2.5 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-black/30 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-[11px] flex items-center justify-center transition active:scale-95 shadow-xs cursor-pointer";
            }
        });
    });
}

/**
 * Initializes font settings on application startup.
 */
export function initFontSettings() {
    applyFontScales();

    if (typeof window !== 'undefined') {
        window.setFontScale = setFontScale;
        window.resetFontScales = resetFontScales;
        window.syncFontSettingsUI = syncFontSettingsUI;
    }
}

