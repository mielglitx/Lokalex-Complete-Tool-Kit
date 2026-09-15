// src/features/roster/rosterQueueSettings.js

/**
 * ============================================================================
 * ROSTER QUEUE LINEUP & COOLDOWN SETTINGS MODULE
 * ============================================================================
 * 
 * Description:
 * Manages administrative configuration for the rider Available queue rotation:
 * - Toggles between FIFO (First Available First) and Lowest Gross Income First.
 * - Manages cooldown buffers (in minutes) for the lowest gross income mode,
 *   placing recently completed riders at the end of the line temporarily.
 * - Synchronizes configuration with Firebase RTDB at 'settings/queueLineup'.
 * - Dynamically mounts the admin modal into the DOM without template dependencies.
 * ============================================================================
 */

import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { isAdmin } from './rosterUtils.js';

const QUEUE_SETTINGS_CACHE_KEY = 'lokalex_queue_lineup_settings';

export function getQueueLineupSettings() {
    if (!globalState.queueLineupSettings) {
        try {
            const cached = localStorage.getItem(QUEUE_SETTINGS_CACHE_KEY);
            if (cached) {
                globalState.queueLineupSettings = JSON.parse(cached);
            }
        } catch (e) {}
    }

    return globalState.queueLineupSettings || {
        mode: 'lowest_gross', // 'lowest_gross' | 'fifo'
        cooldownMinutes: 10
    };
}

function ensureQueueSettingsModal() {
    let modal = document.getElementById('admin-queue-settings-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'admin-queue-settings-modal';
        modal.className = 'hidden fixed inset-0 bg-black/80 backdrop-blur-xs z-[999999] flex items-center justify-center p-4 select-none';
        modal.innerHTML = `
            <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 w-full max-w-sm rounded-3xl p-5 shadow-2xl flex flex-col gap-4 text-gray-900 dark:text-white animate-in fade-in zoom-in-95 duration-150">
                <div class="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold border border-blue-500/20">
                            <i class="fa-solid fa-arrow-down-short-wide"></i>
                        </div>
                        <div>
                            <h3 class="font-black text-xs">Queue Lineup Rules</h3>
                            <p class="text-[10px] text-gray-500 dark:text-gray-400">Available Rotation Engine</p>
                        </div>
                    </div>
                    <button type="button" onclick="window.closeAdminQueueSettingsModal && window.closeAdminQueueSettingsModal()" class="text-gray-400 hover:text-gray-700 dark:hover:text-white text-sm p-1">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="flex flex-col gap-3">
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Sorting Mode</label>
                        <div class="grid grid-cols-2 gap-2 mt-1.5">
                            <label id="queue-mode-lowest-label" class="border border-purple-500/40 bg-purple-500/10 p-2.5 rounded-2xl flex flex-col gap-1 cursor-pointer transition">
                                <div class="flex items-center justify-between">
                                    <span class="text-xs font-black text-purple-700 dark:text-purple-300">Lowest Gross</span>
                                    <input type="radio" name="queue-lineup-mode" value="lowest_gross" class="accent-purple-600" onchange="window.toggleQueueSettingsModeUI && window.toggleQueueSettingsModeUI('lowest_gross')">
                                </div>
                                <span class="text-[9.5px] text-gray-600 dark:text-gray-400">Riders with lowest earnings go first</span>
                            </label>

                            <label id="queue-mode-fifo-label" class="border border-gray-200 dark:border-gray-800 p-2.5 rounded-2xl flex flex-col gap-1 cursor-pointer transition">
                                <div class="flex items-center justify-between">
                                    <span class="text-xs font-black text-blue-700 dark:text-blue-300">First-In First-Out</span>
                                    <input type="radio" name="queue-lineup-mode" value="fifo" class="accent-blue-600" onchange="window.toggleQueueSettingsModeUI && window.toggleQueueSettingsModeUI('fifo')">
                                </div>
                                <span class="text-[9.5px] text-gray-600 dark:text-gray-400">Who turns Available first sits at #1</span>
                            </label>
                        </div>
                    </div>

                    <div id="queue-cooldown-section" class="flex flex-col gap-1.5 p-3 rounded-2xl bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-800">
                        <div class="flex justify-between items-center">
                            <label class="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                                <i class="fa-solid fa-hourglass-half mr-1"></i> Gross Re-sort Cooldown
                            </label>
                            <span id="queue-cooldown-display" class="text-xs font-black font-mono text-purple-600 dark:text-purple-400">10 mins</span>
                        </div>
                        <p class="text-[10px] text-gray-600 dark:text-gray-400 leading-tight">
                            Recently finished riders are placed at the <strong>end of the queue</strong> for this duration before their lowest-gross priority activates.
                        </p>
                        <div class="flex items-center gap-2 mt-1">
                            <input type="range" id="queue-cooldown-range" min="0" max="60" step="5" value="10" class="flex-1 accent-purple-600 cursor-pointer" oninput="window.updateQueueCooldownDisplay && window.updateQueueCooldownDisplay(this.value)">
                        </div>
                        <div class="flex justify-between text-[9px] font-mono text-gray-400">
                            <span>0m (Instant)</span>
                            <span>15m</span>
                            <span>30m</span>
                            <span>60m</span>
                        </div>
                    </div>
                </div>

                <div class="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                    <button type="button" onclick="window.closeAdminQueueSettingsModal && window.closeAdminQueueSettingsModal()" class="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xs transition active:scale-95">Cancel</button>
                    <button type="button" onclick="window.saveAdminQueueSettings && window.saveAdminQueueSettings()" class="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition active:scale-95 shadow-md">Save Settings</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    return modal;
}

export function openAdminQueueSettingsModal() {
    if (!isAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin accounts can configure lineup rules.");
    }

    const modal = ensureQueueSettingsModal();
    const config = getQueueLineupSettings();

    const radios = document.querySelectorAll('input[name="queue-lineup-mode"]');
    radios.forEach(r => {
        r.checked = r.value === (config.mode || 'lowest_gross');
    });

    const range = document.getElementById('queue-cooldown-range');
    if (range) {
        range.value = config.cooldownMinutes !== undefined ? config.cooldownMinutes : 10;
        updateQueueCooldownDisplay(range.value);
    }

    toggleQueueSettingsModeUI(config.mode || 'lowest_gross');
    modal.classList.remove('hidden');
}

export function closeAdminQueueSettingsModal() {
    const modal = document.getElementById('admin-queue-settings-modal');
    if (modal) modal.classList.add('hidden');
}

export function updateQueueCooldownDisplay(val) {
    const display = document.getElementById('queue-cooldown-display');
    const num = parseInt(val, 10) || 0;
    if (display) {
        display.innerText = num === 0 ? "Instant (0 min)" : `${num} min${num === 1 ? '' : 's'}`;
    }
}

export function toggleQueueSettingsModeUI(selectedMode) {
    const lowestLabel = document.getElementById('queue-mode-lowest-label');
    const fifoLabel = document.getElementById('queue-mode-fifo-label');
    const cooldownSection = document.getElementById('queue-cooldown-section');

    if (selectedMode === 'lowest_gross') {
        if (lowestLabel) lowestLabel.className = "border border-purple-500 bg-purple-500/15 p-2.5 rounded-2xl flex flex-col gap-1 cursor-pointer transition shadow-xs";
        if (fifoLabel) fifoLabel.className = "border border-gray-200 dark:border-gray-800 p-2.5 rounded-2xl flex flex-col gap-1 cursor-pointer transition opacity-60";
        if (cooldownSection) cooldownSection.classList.remove('opacity-30', 'pointer-events-none');
    } else {
        if (fifoLabel) fifoLabel.className = "border border-blue-500 bg-blue-500/15 p-2.5 rounded-2xl flex flex-col gap-1 cursor-pointer transition shadow-xs";
        if (lowestLabel) lowestLabel.className = "border border-gray-200 dark:border-gray-800 p-2.5 rounded-2xl flex flex-col gap-1 cursor-pointer transition opacity-60";
        if (cooldownSection) cooldownSection.classList.add('opacity-30', 'pointer-events-none');
    }
}

export async function saveAdminQueueSettings() {
    if (!isAdmin()) {
        return showToast("⚠️ Unauthorized: Only Admin accounts can configure lineup rules.");
    }

    const selectedRadio = document.querySelector('input[name="queue-lineup-mode"]:checked');
    const mode = selectedRadio ? selectedRadio.value : 'lowest_gross';
    const range = document.getElementById('queue-cooldown-range');
    const cooldownMinutes = range ? parseInt(range.value, 10) : 10;

    const payload = {
        mode: mode,
        cooldownMinutes: Math.max(0, cooldownMinutes),
        updatedBy: appState.riderName || "Admin",
        updatedAt: Date.now()
    };

    globalState.queueLineupSettings = payload;
    try {
        localStorage.setItem(QUEUE_SETTINGS_CACHE_KEY, JSON.stringify(payload));
    } catch (e) {}

    try {
        if (db) {
            await db.ref('settings/queueLineup').set(payload);
        }

        closeAdminQueueSettingsModal();
        const modeLabel = mode === 'lowest_gross' ? 'Lowest Gross Income First' : 'First-In First-Out (FIFO)';
        showToast(`⚙️ Queue rules updated: ${modeLabel}`);
        showSideNotification("LINEUP UPDATED", `${modeLabel} (Cooldown: ${cooldownMinutes}m)`, "fa-arrow-down-short-wide", "text-purple-400", "border-purple-500");
        window.dispatchEvent(new CustomEvent('rosterUpdated'));
    } catch (e) {
        console.error("Save queue settings error:", e);
        showToast("❌ Failed to save queue settings.");
    }
}

export function listenToQueueLineupSettings() {
    if (!db) return;

    try {
        const cached = localStorage.getItem(QUEUE_SETTINGS_CACHE_KEY);
        if (cached) globalState.queueLineupSettings = JSON.parse(cached);
    } catch (e) {}

    db.ref('settings/queueLineup').on('value', (snap) => {
        const data = snap.val();
        if (data) {
            globalState.queueLineupSettings = data;
            try {
                localStorage.setItem(QUEUE_SETTINGS_CACHE_KEY, JSON.stringify(data));
            } catch (e) {}
            window.dispatchEvent(new CustomEvent('rosterUpdated'));
        }
    });
}

// Global window registrations
if (typeof window !== 'undefined') {
    window.openAdminQueueSettingsModal = openAdminQueueSettingsModal;
    window.closeAdminQueueSettingsModal = closeAdminQueueSettingsModal;
    window.updateQueueCooldownDisplay = updateQueueCooldownDisplay;
    window.toggleQueueSettingsModeUI = toggleQueueSettingsModeUI;
    window.saveAdminQueueSettings = saveAdminQueueSettings;

    listenToQueueLineupSettings();
}