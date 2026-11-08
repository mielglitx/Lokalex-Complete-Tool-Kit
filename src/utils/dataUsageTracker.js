// src/utils/dataUsageTracker.js

/**
 * ============================================================================
 * LOKALEX REAL-TIME DATA USAGE MONITOR & NETWORK PROFILER
 * ============================================================================
 * Tracks cellular/WiFi data usage across all app features (Fetch, REST, CDNs,
 * WebSockets, and media downloads).
 * Supports rolling analytics for: 10m, 30m, 1h, 5h, 1d, 1w, 1mo.
 * ============================================================================
 */

const STORAGE_KEY = 'lokalex_network_usage_log_v1';
const MAX_LOG_AGE_MS = 31 * 24 * 60 * 60 * 1000; // 31 days retention

export const DATA_CATEGORIES = {
    CHATS: { label: '💬 Customer Chats & Media', key: 'chats', icon: 'fa-comments', color: '#10B981' },
    MENUS: { label: '📖 Restaurant Menus & Photos', key: 'menus', icon: 'fa-book-open', color: '#F59E0B' },
    ROTATIONS: { label: '🚴 Rider Rotations & Status Sync', key: 'rotations', icon: 'fa-motorcycle', color: '#3B82F6' },
    RECEIPTS: { label: '🧾 Receipts & Catering Logs', key: 'receipts', icon: 'fa-receipt', color: '#8B5CF6' },
    DIRECTORY: { label: '📍 Directory & Map Calculations', key: 'directory', icon: 'fa-map-location-dot', color: '#EC4899' },
    UPDATES: { label: '🔄 App Updates (OTA Packages)', key: 'updates', icon: 'fa-cloud-arrow-down', color: '#06B6D4' },
    SYSTEM: { label: '⚙️ System & Auth Configuration', key: 'system', icon: 'fa-server', color: '#64748B' }
};

export const TIME_WINDOWS = {
    '10m': { label: '10 Mins', ms: 10 * 60 * 1000 },
    '30m': { label: '30 Mins', ms: 30 * 60 * 1000 },
    '1h':  { label: '1 Hour',  ms: 60 * 60 * 1000 },
    '5h':  { label: '5 Hours', ms: 5 * 60 * 60 * 1000 },
    '1d':  { label: '1 Day',   ms: 24 * 60 * 60 * 1000 },
    '1w':  { label: '1 Week',  ms: 7 * 24 * 60 * 60 * 1000 },
    '1mo': { label: '1 Month', ms: 30 * 24 * 60 * 60 * 1000 }
};

let inMemoryLogs = null;
let saveDebounceTimer = null;
let currentActiveWindow = '1d';

export function formatBytes(bytes) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '0 KB';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(2)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
}

function loadLogs() {
    if (inMemoryLogs) return inMemoryLogs;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            inMemoryLogs = JSON.parse(raw);
        }
    } catch (_) {}
    if (!Array.isArray(inMemoryLogs)) inMemoryLogs = [];
    return inMemoryLogs;
}

function persistLogs() {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
        try {
            if (!inMemoryLogs) return;
            // Prune entries older than 31 days
            const cutoff = Date.now() - MAX_LOG_AGE_MS;
            inMemoryLogs = inMemoryLogs.filter(entry => entry.t >= cutoff);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(inMemoryLogs));
        } catch (_) {}
    }, 1500);
}

export function classifyNetworkUrl(url = '', body = null) {
    const u = String(url || '').toLowerCase();

    // 1. Customer Chats & Messages
    if (u.includes('customer_chats') || u.includes('customer_chat_meta') || u.includes('customerchats') || u.includes('graph.facebook.com') || u.includes('chat-media') || u.includes('customerchatmeta')) {
        return DATA_CATEGORIES.CHATS.key;
    }
    // 2. Menus & Store Catalog
    if (u.includes('store_menus') || u.includes('store-menus') || u.includes('storemenugalleries') || u.includes('menuimagescache') || u.includes('stores') || u.includes('storehub')) {
        return DATA_CATEGORIES.MENUS.key;
    }
    // 3. Rotations, Roster & Shifts
    if (u.includes('roster') || u.includes('riders') || u.includes('logins') || u.includes('shift_history') || u.includes('shifthistory') || u.includes('ui-avatars.com')) {
        return DATA_CATEGORIES.ROTATIONS.key;
    }
    // 4. Receipts & Commissions
    if (u.includes('receipts') || u.includes('daily_receipts') || u.includes('catered_history') || u.includes('cateredhistory') || u.includes('commission') || u.includes('gcash')) {
        return DATA_CATEGORIES.RECEIPTS.key;
    }
    // 5. Directory, Maps & Geocoding
    if (u.includes('directory') || u.includes('nominatim') || u.includes('openstreetmap') || u.includes('tile.') || u.includes('leaflet') || u.includes('maps.google') || u.includes('googleapis.com/maps')) {
        return DATA_CATEGORIES.DIRECTORY.key;
    }
    // 6. App Updates, Vite Assets & Web Bundles
    if (u.includes('ota-release') || u.includes('dist.zip') || u.includes('github') || u.includes('raw.githubusercontent') || u.includes('.js') || u.includes('/assets/') || u.includes('@vite')) {
        return DATA_CATEGORIES.UPDATES.key;
    }
    // 7. System, Auth & Database Heartbeats
    return DATA_CATEGORIES.SYSTEM.key;
}

export function recordDataTransfer(bytes, categoryKey = 'system', path = '') {
    if (!bytes || bytes <= 0) return;
    const logs = loadLogs();
    const entry = {
        t: Date.now(),
        b: Math.round(bytes),
        c: categoryKey || 'system',
        p: String(path || '').substring(0, 100)
    };
    logs.push(entry);
    persistLogs();
    updateHeaderDataUsagePill();
}

export function getDataUsageSummary(windowKey = '1d') {
    const logs = loadLogs();
    const win = TIME_WINDOWS[windowKey] || TIME_WINDOWS['1d'];
    const now = Date.now();
    const cutoff = now - win.ms;

    // Calculate actual elapsed monitoring time
    const earliestLog = logs.length > 0 ? logs[0].t : now;
    const elapsedTotalMs = Math.max(0, now - earliestLog);
    
    let elapsedFormatted = "Just started";
    if (elapsedTotalMs >= 86400000) {
        const d = Math.floor(elapsedTotalMs / 86400000);
        const h = Math.floor((elapsedTotalMs % 86400000) / 3600000);
        elapsedFormatted = `${d}d ${h}h`;
    } else if (elapsedTotalMs >= 3600000) {
        const h = Math.floor(elapsedTotalMs / 3600000);
        const m = Math.round((elapsedTotalMs % 3600000) / 60000);
        elapsedFormatted = `${h}h ${m}m`;
    } else if (elapsedTotalMs >= 60000) {
        elapsedFormatted = `${Math.round(elapsedTotalMs / 60000)} mins`;
    } else if (logs.length > 0) {
        elapsedFormatted = "< 1 min";
    }

    const startDate = new Date(earliestLog);
    const isToday = startDate.toDateString() === new Date().toDateString();
    const startTimeFormatted = isToday 
        ? `Today at ${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : `${startDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    let totalBytes = 0;
    const categoryBytes = {
        chats: 0,
        menus: 0,
        rotations: 0,
        receipts: 0,
        directory: 0,
        updates: 0,
        system: 0
    };

    const endpointMap = {};

    logs.forEach(entry => {
        if (entry.t >= cutoff) {
            totalBytes += entry.b;
            const cat = categoryBytes[entry.c] !== undefined ? entry.c : 'system';
            categoryBytes[cat] += entry.b;

            // Group by endpoint
            const rawP = entry.p || '';
            let cleanP = rawP.split('?')[0].replace(/^https?:\/\/[^\/]+/, '');
            if (rawP.includes('graph.facebook.com')) cleanP = 'Facebook Messenger Graph API';
            else if (cleanP.includes('/rest/v1/')) cleanP = 'Supabase ' + cleanP.replace('/rest/v1/', '');
            else if (cleanP.includes('/assets/')) cleanP = 'App Web Assets (Vite / PWA)';
            else if (!cleanP || cleanP === '/') cleanP = 'General API Request';
            else if (cleanP.length > 40) cleanP = cleanP.substring(0, 40) + '...';

            endpointMap[cleanP] = (endpointMap[cleanP] || 0) + entry.b;
        }
    });

    const topEndpoints = Object.entries(endpointMap)
        .map(([name, bytes]) => ({ name, bytes, formatted: formatBytes(bytes) }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 5);

    const categoryList = Object.entries(DATA_CATEGORIES).map(([_, catDef]) => {
        const bytes = categoryBytes[catDef.key] || 0;
        const percent = totalBytes > 0 ? (bytes / totalBytes) * 100 : 0;
        return {
            key: catDef.key,
            label: catDef.label,
            icon: catDef.icon,
            color: catDef.color,
            bytes,
            formattedBytes: formatBytes(bytes),
            percent: Math.round(percent * 10) / 10
        };
    }).sort((a, b) => b.bytes - a.bytes);

    const topCategory = categoryList[0]?.bytes > 0 ? categoryList[0] : null;

    // Transfer rate per minute in this active window
    const windowElapsedMs = Math.min(elapsedTotalMs, win.ms);
    const windowElapsedMins = Math.max(0.5, windowElapsedMs / 60000);
    const ratePerMinBytes = totalBytes / windowElapsedMins;

    return {
        windowKey,
        windowLabel: win.label,
        totalBytes,
        formattedTotal: formatBytes(totalBytes),
        categoryList,
        topCategory,
        elapsedTotalMs,
        elapsedFormatted,
        startTimeFormatted,
        transferRateFormatted: `${formatBytes(ratePerMinBytes)}/min`,
        topEndpoints
    };
}

export function clearDataUsageHistory() {
    inMemoryLogs = [];
    localStorage.removeItem(STORAGE_KEY);
    updateHeaderDataUsagePill();
    renderDataUsageModal(currentActiveWindow);
    if (typeof window.showToast === 'function') {
        window.showToast("🗑️ Data usage history cleared.");
    }
}

export function updateHeaderDataUsagePill() {
    const el = document.getElementById('modern-header-data-usage');
    if (!el) return;
    const summary = getDataUsageSummary('1d');
    el.innerText = summary.formattedTotal;
}

// Global Network Interceptor: measures all fetch payload transfers
let isFetchInterceptorInstalled = false;
export function installNetworkDataInterceptor() {
    if (isFetchInterceptorInstalled || typeof window === 'undefined' || !window.fetch) return;
    isFetchInterceptorInstalled = true;

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const input = args[0];
        const init = args[1] || {};
        const url = typeof input === 'string' ? input : (input?.url || '');

        // Estimate outgoing request bytes
        let reqBytes = url.length + 150; // Base headers overhead
        if (init.body) {
            if (typeof init.body === 'string') reqBytes += init.body.length;
            else if (init.body instanceof Blob) reqBytes += init.body.size;
        }

        const category = classifyNetworkUrl(url, init.body);
        recordDataTransfer(reqBytes, category, url);

        try {
            const response = await originalFetch.apply(this, args);
            // Estimate incoming response bytes
            const clone = response.clone();
            const clHeader = response.headers?.get('content-length');
            if (clHeader && !isNaN(parseInt(clHeader, 10))) {
                recordDataTransfer(parseInt(clHeader, 10), category, url);
            } else {
                clone.blob().then(b => {
                    recordDataTransfer(b ? b.size : 200, category, url);
                }).catch(() => {
                    recordDataTransfer(300, category, url);
                });
            }
            return response;
        } catch (err) {
            throw err;
        }
    };
}

// Realtime / CDC Payload recorder
export function recordRealtimeTraffic(bytes, categoryKey = 'chats', desc = 'realtime') {
    recordDataTransfer(bytes, categoryKey, desc);
}

// ============================================================================
// DATA USAGE MONITOR UI MODAL CONTROLLER
// ============================================================================

export function openDataUsageModal(initialWindow = '1d') {
    currentActiveWindow = initialWindow || '1d';
    const modal = document.getElementById('data-usage-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    renderDataUsageModal(currentActiveWindow);
}

export function closeDataUsageModal() {
    const modal = document.getElementById('data-usage-modal');
    if (modal) modal.classList.add('hidden');
}

export function switchDataUsageWindow(windowKey) {
    currentActiveWindow = windowKey;
    renderDataUsageModal(windowKey);
}

export function renderDataUsageModal(windowKey = '1d') {
    currentActiveWindow = windowKey;
    const summary = getDataUsageSummary(windowKey);

    // Update active tab buttons
    Object.keys(TIME_WINDOWS).forEach(k => {
        const btn = document.getElementById(`data-usage-tab-${k}`);
        if (btn) {
            if (k === windowKey) {
                btn.className = "px-2.5 py-1.5 rounded-xl bg-emerald-600 text-white font-black text-xs transition active:scale-95 shadow-sm";
            } else {
                btn.className = "px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs transition active:scale-95";
            }
        }
    });

    // Update Main Banner
    const totalEl = document.getElementById('data-usage-total-display');
    const labelEl = document.getElementById('data-usage-window-label');
    const topEl = document.getElementById('data-usage-top-category');
    const elapsedBadge = document.getElementById('data-usage-elapsed-badge');
    const startTimeEl = document.getElementById('data-usage-start-time');
    const rateEl = document.getElementById('data-usage-transfer-rate');

    if (totalEl) totalEl.innerText = summary.formattedTotal;
    if (labelEl) labelEl.innerText = `Data consumed in the last ${summary.windowLabel}`;
    if (elapsedBadge) elapsedBadge.innerText = `Monitored: ${summary.elapsedFormatted}`;
    if (startTimeEl) startTimeEl.innerText = `Tracking started: ${summary.startTimeFormatted}`;
    if (rateEl) rateEl.innerText = `Rate: ${summary.transferRateFormatted}`;

    if (topEl) {
        if (summary.topCategory) {
            topEl.innerHTML = `🔥 <strong>Most Used:</strong> ${summary.topCategory.label} (${summary.topCategory.formattedBytes} • ${summary.topCategory.percent}%)`;
        } else {
            topEl.innerText = "No network transfer recorded in this window.";
        }
    }

    // Render Categories List
    const listContainer = document.getElementById('data-usage-breakdown-list');
    if (listContainer) {
        listContainer.innerHTML = summary.categoryList.map(cat => {
            return `
            <div class="flex flex-col p-3 rounded-2xl bg-white dark:bg-[#121a1f] border border-slate-200 dark:border-slate-800 gap-2 shadow-xs transition hover:border-slate-300 dark:hover:border-slate-700">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="w-7 h-7 rounded-xl flex items-center justify-center text-xs shrink-0" style="background-color: ${cat.color}20; color: ${cat.color};">
                            <i class="fa-solid ${cat.icon}"></i>
                        </span>
                        <div class="min-w-0">
                            <p class="font-black text-xs text-slate-900 dark:text-white truncate">${cat.label}</p>
                            <p class="text-[10px] text-slate-500 font-mono">${cat.percent}% of total window</p>
                        </div>
                    </div>
                    <span class="text-xs font-mono font-black text-slate-900 dark:text-emerald-400 shrink-0 bg-slate-100 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-emerald-500/30">${cat.formattedBytes}</span>
                </div>
                <!-- Visual Progress Bar -->
                <div class="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div class="h-full rounded-full transition-all duration-500" style="width: ${Math.max(cat.percent, cat.bytes > 0 ? 3 : 0)}%; background-color: ${cat.color};"></div>
                </div>
            </div>`;
        }).join('');
    }

    // Render Top Endpoints Section
    const endpointsContainer = document.getElementById('data-usage-top-endpoints');
    if (endpointsContainer) {
        if (summary.topEndpoints && summary.topEndpoints.length > 0) {
            endpointsContainer.innerHTML = summary.topEndpoints.map((ep, idx) => `
            <div class="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-slate-800 text-[11px]">
                <div class="flex items-center gap-2 min-w-0">
                    <span class="text-slate-400 font-bold shrink-0">${idx + 1}.</span>
                    <span class="text-slate-800 dark:text-slate-200 font-mono truncate" title="${escapeHtml(ep.name)}">${escapeHtml(ep.name)}</span>
                </div>
                <span class="text-emerald-600 dark:text-emerald-400 font-black shrink-0 font-mono">${ep.formatted}</span>
            </div>`).join('');
        } else {
            endpointsContainer.innerHTML = `<div class="text-slate-500 italic text-[11px] py-1 text-center">No endpoint traffic logged yet.</div>`;
        }
    }
}

// Window Attachments
if (typeof window !== 'undefined') {
    window.openDataUsageModal = openDataUsageModal;
    window.closeDataUsageModal = closeDataUsageModal;
    window.switchDataUsageWindow = switchDataUsageWindow;
    window.clearDataUsageHistory = clearDataUsageHistory;
    window.getDataUsageSummary = getDataUsageSummary;
    window.recordRealtimeTraffic = recordRealtimeTraffic;
    window.classifyNetworkUrl = classifyNetworkUrl;
    window.updateHeaderDataUsagePill = updateHeaderDataUsagePill;
}

// Initialize network interception immediately
installNetworkDataInterceptor();
