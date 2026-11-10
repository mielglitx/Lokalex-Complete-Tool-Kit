// src/utils/errorTracker.js

/**
 * ============================================================================
 * LOKALEX ADVANCED ERROR CAPTURING & DIAGNOSTIC EXTRACTION MODULE (ADMIN)
 * ============================================================================
 * 
 * Captures, buffers, and persists runtime errors across all client devices:
 * 1. Global uncaught exceptions (window.onerror)
 * 2. Unhandled promise rejections (window.onunhandledrejection)
 * 3. Intercepted critical console.error logs
 * 4. Programmatic manual error captures (captureAppError)
 * 
 * Features for Administrators:
 * - Real-time error diagnostic inspection in an Admin UI modal.
 * - One-click "Copy Diagnostic Report" to extract complete Markdown summaries.
 * - One-click "Export JSON" and "Export CSV" for offline debugging and analysis.
 * - Cloud synchronization via Supabase/Firebase adminSettings/appErrorLogs
 *   so administrators can inspect error reports from any rider's device.
 * - Intelligent deduplication to prevent flood loops on repeating errors.
 * ============================================================================
 */

import { db } from '../config/firebase.js';
import { escapeHtml, copyText } from './helpers.js';
import { showToast } from '../ui/notifications.js';
import { isAdmin } from '../features/roster/rosterUtils.js';

const LOCAL_STORAGE_KEY = 'lokalex_error_logs_v1';
const MAX_LOCAL_LOGS = 100;
const MAX_CLOUD_LOGS = 150;
const CURRENT_APP_VERSION = '1.2.16';

let inMemoryLogs = null;
let cloudLogsMap = new Map();
let cloudListenerActive = false;
let syncDebounceTimer = null;
let currentFilterType = 'all'; // 'all' | 'uncaught' | 'rejection' | 'console' | 'app'
let currentSearchQuery = '';
let isTrackerInitialized = false;

/**
 * Loads buffered logs from localStorage.
 */
function loadLocalLogs() {
    if (inMemoryLogs) return inMemoryLogs;
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (raw) {
            inMemoryLogs = JSON.parse(raw);
        }
    } catch (_) {}
    if (!Array.isArray(inMemoryLogs)) inMemoryLogs = [];
    return inMemoryLogs;
}

/**
 * Persists buffered logs to localStorage.
 */
function saveLocalLogs() {
    if (!inMemoryLogs) return;
    try {
        if (inMemoryLogs.length > MAX_LOCAL_LOGS) {
            inMemoryLogs = inMemoryLogs.slice(0, MAX_LOCAL_LOGS);
        }
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(inMemoryLogs));
    } catch (_) {}
}

/**
 * Debounced synchronization of recent errors to cloud storage (admin_settings/appErrorLogs).
 */
function scheduleCloudSync(errorRecord) {
    if (!db || !errorRecord) return;
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
        try {
            const cleanId = String(errorRecord.id || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');
            const sanitizedRecord = {
                id: cleanId,
                timestamp: errorRecord.timestamp || Date.now(),
                timeStr: errorRecord.timeStr || new Date().toLocaleString(),
                type: errorRecord.type || 'AppError',
                message: String(errorRecord.message || '').slice(0, 1000),
                stack: String(errorRecord.stack || '').slice(0, 4000),
                source: String(errorRecord.source || '').slice(0, 500),
                user: errorRecord.user || {},
                app: errorRecord.app || {},
                count: errorRecord.count || 1
            };

            db.ref(`adminSettings/appErrorLogs/${cleanId}`).set(sanitizedRecord).catch(() => {});
        } catch (_) {}
    }, 2500);
}

/**
 * Extracts current user and device context.
 */
function getErrorContext() {
    const riderName = (typeof localStorage !== 'undefined' && (localStorage.getItem('riderName') || localStorage.getItem('lokalex_rider_name') || '')) || 'Guest';
    const riderId = (typeof localStorage !== 'undefined' && (localStorage.getItem('telegramId') || localStorage.getItem('riderId') || '')) || 'None';
    const activeRole = (typeof localStorage !== 'undefined' && localStorage.getItem('lokalex_active_role')) || 'rider';
    const uiMode = (typeof localStorage !== 'undefined' && localStorage.getItem('lokalex_ui_mode')) || 'modern';

    let activeTab = 'home';
    let activeCategory = '';
    let activeChatCustId = '';
    try {
        if (typeof window !== 'undefined') {
            if (typeof window.getModernChatCategory === 'function') activeCategory = window.getModernChatCategory();
            if (typeof window.getActiveRiderChatCustId === 'function') activeChatCustId = window.getActiveRiderChatCustId();
            const tabChats = document.getElementById('modern-panel-chats');
            const tabRot = document.getElementById('modern-panel-rotations');
            if (tabChats && !tabChats.classList.contains('hidden')) activeTab = 'chats';
            else if (tabRot && !tabRot.classList.contains('hidden')) activeTab = 'rotations';
        }
    } catch (_) {}

    return {
        user: {
            name: riderName,
            id: riderId,
            role: activeRole,
            isAdmin: typeof isAdmin === 'function' ? isAdmin() : (activeRole === 'admin')
        },
        app: {
            version: CURRENT_APP_VERSION,
            uiMode: uiMode,
            activeTab: activeTab,
            activeCategory: activeCategory,
            activeChatCustId: activeChatCustId,
            isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
            platform: typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() ? 'Android (Native)' : 'Web/PWA',
            screen: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'N/A',
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'
        }
    };
}

/**
 * Main Capture Method: Records, buffers, and pushes any runtime error.
 */
export function captureAppError(errorOrMsg, customMeta = {}) {
    try {
        const logs = loadLocalLogs();
        const ctx = getErrorContext();

        let message = "";
        let stack = "";
        let type = customMeta.type || "AppError";
        let source = customMeta.source || "";

        if (errorOrMsg instanceof Error) {
            message = errorOrMsg.message || errorOrMsg.toString();
            stack = errorOrMsg.stack || "";
            if (!customMeta.type) type = errorOrMsg.name || "Error";
        } else if (typeof errorOrMsg === 'object' && errorOrMsg !== null) {
            message = errorOrMsg.message || JSON.stringify(errorOrMsg);
            stack = errorOrMsg.stack || "";
        } else {
            message = String(errorOrMsg || "Unknown runtime error");
        }

        // Filter out benign noise
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes('resizeobserver loop') || 
            lowerMsg.includes('canceled') || 
            lowerMsg.includes('network error') && !lowerMsg.includes('critical')) {
            // Harmless transient browser events
        }

        // Deduplication: if identical message occurred in the last 15 seconds, increment count
        const now = Date.now();
        const existing = logs.find(l => l.message === message && (now - l.timestamp < 15000));
        if (existing) {
            existing.count = (existing.count || 1) + 1;
            existing.lastSeen = now;
            existing.timeStr = new Date(now).toLocaleString();
            saveLocalLogs();
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('appErrorLogged', { detail: existing }));
            }
            return existing;
        }

        const newRecord = {
            id: `err_${now}_${Math.random().toString(36).substr(2, 5)}`,
            timestamp: now,
            lastSeen: now,
            timeStr: new Date(now).toLocaleString(),
            type: type,
            message: message,
            stack: stack,
            source: source,
            count: 1,
            user: ctx.user,
            app: ctx.app,
            ...customMeta
        };

        logs.unshift(newRecord);
        saveLocalLogs();

        // Push to Cloud
        scheduleCloudSync(newRecord);

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('appErrorLogged', { detail: newRecord }));
        }

        return newRecord;
    } catch (e) {
        // Must never throw inside the error logger
        return null;
    }
}

/**
 * Initializes global uncaught error listeners and console wrapper.
 */
export function initErrorTracker() {
    if (isTrackerInitialized || typeof window === 'undefined') return;
    isTrackerInitialized = true;

    loadLocalLogs();

    // 1. Global Uncaught Exceptions
    window.addEventListener('error', (event) => {
        try {
            const err = event.error || {};
            const source = event.filename ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}` : '';
            captureAppError(err.message || event.message || 'Uncaught Exception', {
                type: 'UncaughtException',
                stack: err.stack || '',
                source: source
            });
        } catch (_) {}
    });

    // 2. Unhandled Promise Rejections
    window.addEventListener('unhandledrejection', (event) => {
        try {
            const reason = event.reason;
            let msg = 'Unhandled Promise Rejection';
            let stack = '';
            if (reason instanceof Error) {
                msg = reason.message || msg;
                stack = reason.stack || '';
            } else if (typeof reason === 'string') {
                msg = reason;
            } else if (reason) {
                msg = reason.message || JSON.stringify(reason);
            }
            captureAppError(msg, {
                type: 'UnhandledRejection',
                stack: stack
            });
        } catch (_) {}
    });

    // 3. Safe console.error interceptor
    const originalConsoleError = console.error;
    console.error = function (...args) {
        try {
            originalConsoleError.apply(console, args);
            // Check if any argument is an Error or significant error string
            const firstArg = args[0];
            let errorFound = null;
            for (const a of args) {
                if (a instanceof Error) {
                    errorFound = a;
                    break;
                }
            }

            if (errorFound) {
                const combined = `${errorFound.message || ''} ${errorFound.stack || ''}`;
                if (!combined.includes('CapgoUpdater') && !combined.includes('on_premise_app')) {
                    captureAppError(errorFound, { type: 'ConsoleError' });
                }
            } else if (typeof firstArg === 'string' && (firstArg.toLowerCase().includes('error') || firstArg.toLowerCase().includes('failed') || firstArg.toLowerCase().includes('exception'))) {
                const combined = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
                // Exclude internal expected debug notices & 3rd party SDK telemetry
                const isBenignNoise = combined.includes('[Vite]') || 
                                     combined.includes('[CapgoUpdater]') || 
                                     combined.includes('on_premise_app') || 
                                     combined.includes('stats queue') || 
                                     combined.includes('Download the Vue Devtools') || 
                                     combined.includes('favicon.ico');
                if (!isBenignNoise) {
                    captureAppError(combined, { type: 'ConsoleError' });
                }
            }
        } catch (_) {
            originalConsoleError.apply(console, args);
        }
    };

    // 4. Cloud Listener for Admins
    initCloudErrorListener();
}

/**
 * Listens for incoming error reports from all riders if current user is Admin.
 */
export function initCloudErrorListener() {
    if (cloudListenerActive || !db || typeof window === 'undefined') return;
    try {
        const isUserAdmin = typeof isAdmin === 'function' ? isAdmin() : (localStorage.getItem('lokalex_active_role') === 'admin');
        if (!isUserAdmin) return;

        cloudListenerActive = true;
        db.ref('adminSettings/appErrorLogs').limitToLast(MAX_CLOUD_LOGS).on('value', (snapshot) => {
            const data = snapshot.val() || {};
            cloudLogsMap.clear();
            Object.values(data).forEach(entry => {
                if (entry && entry.id) {
                    cloudLogsMap.set(entry.id, entry);
                }
            });

            // If the Error modal is currently open, refresh the view
            const modal = document.getElementById('error-log-modal');
            if (modal && !modal.classList.contains('hidden')) {
                renderErrorLogsList();
            }
        });
    } catch (_) {}
}

/**
 * Retrieves all combined error logs (Local + Cloud deduplicated).
 */
export function getAllErrorLogs() {
    const local = loadLocalLogs();
    const map = new Map();

    // Add local first
    local.forEach(l => {
        if (l && l.id) map.set(l.id, { ...l, isLocal: true });
    });

    // Merge cloud logs
    cloudLogsMap.forEach((cLog, cId) => {
        if (!map.has(cId)) {
            map.set(cId, { ...cLog, isCloud: true });
        } else {
            // Combine occurrence counts
            const existing = map.get(cId);
            existing.count = Math.max(existing.count || 1, cLog.count || 1);
            existing.isCloud = true;
        }
    });

    return Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/**
 * Clears all error logs (Local & Cloud for Admin).
 */
export async function clearAllErrorLogs() {
    if (!confirm("⚠️ Are you sure you want to clear all captured error logs?\n\nThis will wipe both local and cloud error history.")) {
        return false;
    }

    inMemoryLogs = [];
    try {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch (_) {}

    if (db) {
        try {
            await db.ref('adminSettings/appErrorLogs').remove();
        } catch (_) {}
    }

    cloudLogsMap.clear();
    showToast("🧹 All error logs have been cleared!");
    renderErrorLogsList();
    return true;
}

/**
 * Generates and copies a complete formatted Markdown Diagnostic Report.
 */
export function copyErrorDiagnosticReport() {
    const logs = getAllErrorLogs();
    const ctx = getErrorContext();
    const nowStr = new Date().toLocaleString();

    let md = `# 🛠️ LOKALEX APP ERROR & DIAGNOSTIC REPORT\n`;
    md += `*Generated: ${nowStr}*\n\n`;
    md += `## 📱 System & Client Environment\n`;
    md += `- **App Version:** ${CURRENT_APP_VERSION}\n`;
    md += `- **Logged-in User:** ${ctx.user.name} (${ctx.user.id}) — Role: ${ctx.user.role}\n`;
    md += `- **Platform:** ${ctx.app.platform} (${ctx.app.screen})\n`;
    md += `- **Network Status:** ${ctx.app.isOnline ? '🟢 Online' : '🔴 Offline'}\n`;
    md += `- **UI Mode:** ${ctx.app.uiMode.toUpperCase()} | Tab: ${ctx.app.activeTab} | Category: ${ctx.app.activeCategory || 'None'}\n`;
    md += `- **User Agent:** ${ctx.app.userAgent}\n\n`;

    md += `## 📊 Error Summary\n`;
    md += `- **Total Captured Errors:** ${logs.length}\n`;
    
    const countByType = {};
    logs.forEach(l => {
        const t = l.type || 'Other';
        countByType[t] = (countByType[t] || 0) + (l.count || 1);
    });
    Object.entries(countByType).forEach(([t, count]) => {
        md += `- **${t}:** ${count} event(s)\n`;
    });
    md += `\n---\n\n`;

    if (logs.length === 0) {
        md += `*✨ No errors captured. App is running cleanly.*\n`;
    } else {
        md += `## 🚨 Detailed Error Trace Log\n\n`;
        logs.forEach((err, idx) => {
            md += `### #${idx + 1} [${err.type || 'Error'}] — ${err.message}\n`;
            md += `- **Timestamp:** ${err.timeStr || new Date(err.timestamp).toLocaleString()}\n`;
            md += `- **Occurrences:** ${err.count || 1} time(s)\n`;
            md += `- **Reporter:** ${err.user?.name || 'Unknown'} (${err.user?.role || 'user'})\n`;
            if (err.source) md += `- **Source Location:** \`${err.source}\`\n`;
            if (err.app?.activeCategory || err.app?.activeTab) {
                md += `- **Context:** Tab \`${err.app.activeTab || 'N/A'}\` • Cat \`${err.app.activeCategory || 'N/A'}\`\n`;
            }
            if (err.stack) {
                md += `\n\`\`\`javascript\n${err.stack.trim()}\n\`\`\`\n\n`;
            } else {
                md += `*(No stack trace available)*\n\n`;
            }
            md += `---\n\n`;
        });
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).then(() => {
            showToast("📋 Error diagnostic report copied to clipboard!");
        }).catch(() => {
            copyText(md);
            showToast("📋 Error diagnostic report copied to clipboard!");
        });
    } else {
        copyText(md);
        showToast("📋 Error diagnostic report copied to clipboard!");
    }
}

/**
 * Exports all error logs as a downloadable JSON file.
 */
export function exportErrorsAsJson() {
    const logs = getAllErrorLogs();
    const ctx = getErrorContext();
    const payload = {
        exportedAt: new Date().toISOString(),
        system: ctx,
        totalErrors: logs.length,
        errors: logs
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
    const dlAnchor = document.createElement('a');
    const dateStamp = new Date().toISOString().replace(/[:.]/g, '-');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `lokalex-error-logs-${dateStamp}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
    showToast("💾 Error logs downloaded as JSON!");
}

/**
 * Exports all error logs as a CSV spreadsheet.
 */
export function exportErrorsAsCsv() {
    const logs = getAllErrorLogs();
    const headers = ["ID", "Timestamp", "Type", "Count", "Rider", "Role", "Version", "Message", "Source", "Stack"];
    
    const escapeCsv = (val) => {
        const str = String(val === undefined || val === null ? "" : val);
        return `"${str.replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    };

    const rows = logs.map(l => [
        escapeCsv(l.id),
        escapeCsv(l.timeStr || new Date(l.timestamp).toLocaleString()),
        escapeCsv(l.type),
        escapeCsv(l.count || 1),
        escapeCsv(l.user?.name || "Unknown"),
        escapeCsv(l.user?.role || "rider"),
        escapeCsv(l.app?.version || CURRENT_APP_VERSION),
        escapeCsv(l.message),
        escapeCsv(l.source),
        escapeCsv(l.stack)
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `lokalex-errors-${dateStamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("📊 Error logs downloaded as CSV!");
}

/**
 * Copies a single error record's message and stack trace.
 */
export function copySingleErrorStack(errId) {
    const logs = getAllErrorLogs();
    const target = logs.find(l => l.id === errId);
    if (!target) return;

    let text = `Error: ${target.message}\nType: ${target.type}\nTimestamp: ${target.timeStr}\nRider: ${target.user?.name || 'N/A'}\n\nStack Trace:\n${target.stack || 'No stack trace'}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast("📋 Stack trace copied!");
        }).catch(() => {
            copyText(text);
            showToast("📋 Stack trace copied!");
        });
    } else {
        copyText(text);
        showToast("📋 Stack trace copied!");
    }
}

/**
 * Triggers a simulated error to test the tracker and UI.
 */
export function testErrorCapture() {
    try {
        throw new Error(`Test Diagnostic Error triggered by Admin at ${new Date().toLocaleTimeString()}`);
    } catch (err) {
        captureAppError(err, { type: 'TestError' });
        showToast("🧪 Test error captured! Refreshing log view...");
        renderErrorLogsList();
    }
}

/**
 * Modal UI: Opens the Error Log Modal.
 */
export function openErrorLogModal() {
    const modal = document.getElementById('error-log-modal');
    if (!modal) return;
    initCloudErrorListener();
    modal.classList.remove('hidden');
    renderErrorLogsList();
}

/**
 * Modal UI: Closes the Error Log Modal.
 */
export function closeErrorLogModal() {
    const modal = document.getElementById('error-log-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Switches the active category filter pill.
 */
export function switchErrorLogFilter(type) {
    currentFilterType = type;
    const filterTabs = ['all', 'uncaught', 'rejection', 'console', 'app'];
    filterTabs.forEach(f => {
        const btn = document.getElementById(`error-filter-${f}`);
        if (!btn) return;
        if (f === type) {
            btn.className = "px-2.5 py-1 rounded-xl text-xs font-bold transition bg-rose-500/20 text-rose-400 border border-rose-500/40 shadow-xs cursor-pointer";
        } else {
            btn.className = "px-2.5 py-1 rounded-xl text-xs font-bold transition bg-white/5 text-slate-400 hover:text-slate-200 border border-transparent cursor-pointer";
        }
    });
    renderErrorLogsList();
}

/**
 * Handles real-time search input.
 */
export function handleErrorLogSearch(query) {
    currentSearchQuery = (query || '').toLowerCase().trim();
    renderErrorLogsList();
}

/**
 * Toggles accordion expansion of stack trace.
 */
export function toggleErrorCardDetails(errId) {
    const el = document.getElementById(`error-details-${errId}`);
    const icon = document.getElementById(`error-toggle-icon-${errId}`);
    if (!el) return;
    if (el.classList.contains('hidden')) {
        el.classList.remove('hidden');
        if (icon) icon.className = "fa-solid fa-chevron-up text-xs";
    } else {
        el.classList.add('hidden');
        if (icon) icon.className = "fa-solid fa-chevron-down text-xs";
    }
}

/**
 * Renders the error logs list inside the modal.
 */
export function renderErrorLogsList() {
    const listEl = document.getElementById('error-log-list');
    const badgeEl = document.getElementById('error-log-total-count');
    const heroTotalEl = document.getElementById('error-hero-total-count');
    const heroRecentEl = document.getElementById('error-hero-recent-time');
    const heroTopEl = document.getElementById('error-hero-top-message');
    if (!listEl) return;

    let allLogs = getAllErrorLogs();

    // Update Header Badge
    if (badgeEl) {
        badgeEl.innerText = `${allLogs.length} Error${allLogs.length === 1 ? '' : 's'}`;
    }

    // Update Hero Stats
    if (heroTotalEl) heroTotalEl.innerText = allLogs.length.toString();
    if (heroRecentEl) {
        heroRecentEl.innerText = allLogs.length > 0 ? (allLogs[0].timeStr || 'Recent') : 'None recorded';
    }
    if (heroTopEl) {
        heroTopEl.innerText = allLogs.length > 0 ? allLogs[0].message : 'App is running smoothly with 0 errors.';
    }

    // Apply Filter Type
    let filtered = allLogs;
    if (currentFilterType === 'uncaught') {
        filtered = filtered.filter(l => (l.type || '').toLowerCase().includes('uncaught'));
    } else if (currentFilterType === 'rejection') {
        filtered = filtered.filter(l => (l.type || '').toLowerCase().includes('rejection'));
    } else if (currentFilterType === 'console') {
        filtered = filtered.filter(l => (l.type || '').toLowerCase().includes('console'));
    } else if (currentFilterType === 'app') {
        filtered = filtered.filter(l => (l.type || '').toLowerCase().includes('app') || (l.type || '').toLowerCase().includes('error'));
    }

    // Apply Search Query
    if (currentSearchQuery) {
        filtered = filtered.filter(l => {
            const m = (l.message || '').toLowerCase();
            const s = (l.stack || '').toLowerCase();
            const u = (l.user?.name || '').toLowerCase();
            const t = (l.type || '').toLowerCase();
            return m.includes(currentSearchQuery) || s.includes(currentSearchQuery) || u.includes(currentSearchQuery) || t.includes(currentSearchQuery);
        });
    }

    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div class="py-12 px-4 flex flex-col items-center justify-center text-center">
                <div class="w-16 h-16 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center text-2xl mb-3 shadow-lg">
                    <i class="fa-solid fa-shield-heart"></i>
                </div>
                <h4 class="text-sm font-black text-slate-200">No Errors Found!</h4>
                <p class="text-xs text-slate-400 max-w-xs mt-1">
                    ${currentSearchQuery ? 'No errors match your search filter.' : 'The app has not caught any crashes or exceptions. Everything is healthy!'}
                </p>
                <button type="button" onclick="window.testErrorCapture && window.testErrorCapture()" class="mt-4 px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-slate-300 transition active:scale-95 cursor-pointer">
                    <i class="fa-solid fa-flask text-amber-400 mr-1.5"></i> Test Error Capture
                </button>
            </div>
        `;
        return;
    }

    listEl.innerHTML = filtered.map(err => {
        const isRepeated = (err.count || 1) > 1;
        const typeBadgeColor = err.type === 'UncaughtException' 
            ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' 
            : (err.type === 'UnhandledRejection' 
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' 
                : 'bg-blue-500/20 text-blue-400 border-blue-500/30');

        return `
            <div class="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col gap-2 transition hover:border-slate-700 shadow-xs">
                <!-- TOP META ROW -->
                <div class="flex items-center justify-between gap-2 flex-wrap text-[11px]">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="px-2 py-0.5 rounded-lg border text-[10px] font-black uppercase font-mono ${typeBadgeColor}">
                            ${escapeHtml(err.type || 'Error')}
                        </span>
                        ${isRepeated ? `<span class="px-1.5 py-0.5 rounded-md bg-amber-400 text-black font-black font-mono text-[9px] shadow-xs">x${err.count}</span>` : ''}
                        ${err.isCloud ? `<span class="px-1.5 py-0.5 rounded-md bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-bold text-[9px]" title="Received via cloud error bridge"><i class="fa-solid fa-cloud"></i> Cloud</span>` : `<span class="px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-400 font-bold text-[9px]">Local</span>`}
                        <span class="text-slate-400 font-mono text-[10px]">${escapeHtml(err.timeStr || '')}</span>
                    </div>
                    <div class="flex items-center gap-1.5 text-slate-400 text-[10px]">
                        <span class="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 font-bold text-slate-300">
                            <i class="fa-solid fa-user text-slate-400 mr-1 text-[9px]"></i>${escapeHtml(err.user?.name || 'Rider')}
                        </span>
                        <span class="font-mono text-slate-500">v${escapeHtml(err.app?.version || CURRENT_APP_VERSION)}</span>
                    </div>
                </div>

                <!-- ERROR MESSAGE -->
                <div class="font-bold text-xs text-rose-300 leading-snug break-words">
                    ${escapeHtml(err.message)}
                </div>

                <!-- CONTEXT TAGS (IF ANY) -->
                ${err.source || (err.app?.activeTab && err.app?.activeTab !== 'home') ? `
                    <div class="flex items-center gap-2 flex-wrap text-[10px] text-slate-400 font-mono">
                        ${err.source ? `<span class="truncate max-w-[280px]" title="${escapeHtml(err.source)}"><i class="fa-regular fa-file-code text-slate-500 mr-1"></i>${escapeHtml(err.source)}</span>` : ''}
                        ${err.app?.activeTab ? `<span class="bg-white/5 px-1.5 py-0.5 rounded text-[9px]">Tab: ${escapeHtml(err.app.activeTab)}</span>` : ''}
                        ${err.app?.activeCategory ? `<span class="bg-white/5 px-1.5 py-0.5 rounded text-[9px]">Cat: ${escapeHtml(err.app.activeCategory)}</span>` : ''}
                    </div>
                ` : ''}

                <!-- ACTIONS & STACK TOGGLE -->
                <div class="flex items-center justify-between border-t border-slate-800/80 pt-2 mt-0.5">
                    <button type="button" onclick="window.toggleErrorCardDetails('${err.id}')" class="text-[11px] font-bold text-slate-400 hover:text-slate-200 flex items-center gap-1.5 cursor-pointer">
                        <span>Details & Stack</span>
                        <i id="error-toggle-icon-${err.id}" class="fa-solid fa-chevron-down text-xs"></i>
                    </button>
                    <div class="flex items-center gap-1.5">
                        <button type="button" onclick="window.copySingleErrorStack('${err.id}')" class="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-[10px] font-bold transition active:scale-95 cursor-pointer flex items-center gap-1 shadow-xs" title="Copy error and stack trace">
                            <i class="fa-regular fa-copy text-slate-400"></i> Copy
                        </button>
                    </div>
                </div>

                <!-- COLLAPSIBLE STACK TRACE BLOCK -->
                <div id="error-details-${err.id}" class="hidden flex-col gap-2 pt-1 border-t border-slate-800/60 mt-1">
                    <pre class="p-2.5 rounded-xl bg-black/60 border border-slate-800 text-[10px] font-mono text-slate-300 overflow-x-auto whitespace-pre leading-relaxed select-text">${escapeHtml(err.stack || 'No stack trace available for this error.')}</pre>
                    <div class="flex items-center justify-between text-[9px] text-slate-500 font-mono px-1">
                        <span>ID: ${err.id}</span>
                        <span>Platform: ${escapeHtml(err.app?.platform || 'Web')} (${escapeHtml(err.app?.screen || 'N/A')})</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Window Attachments for inline onclick handlers & DevTools
if (typeof window !== 'undefined') {
    window.captureAppError = captureAppError;
    window.initErrorTracker = initErrorTracker;
    window.openErrorLogModal = openErrorLogModal;
    window.closeErrorLogModal = closeErrorLogModal;
    window.copyErrorDiagnosticReport = copyErrorDiagnosticReport;
    window.exportErrorsAsJson = exportErrorsAsJson;
    window.exportErrorsAsCsv = exportErrorsAsCsv;
    window.clearAllErrorLogs = clearAllErrorLogs;
    window.copySingleErrorStack = copySingleErrorStack;
    window.testErrorCapture = testErrorCapture;
    window.switchErrorLogFilter = switchErrorLogFilter;
    window.handleErrorLogSearch = handleErrorLogSearch;
    window.toggleErrorCardDetails = toggleErrorCardDetails;
    window.renderErrorLogsList = renderErrorLogsList;
}
