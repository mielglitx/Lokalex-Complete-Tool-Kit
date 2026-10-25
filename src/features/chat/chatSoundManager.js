// src/features/chat/chatSoundManager.js
import { appState } from '../../store/state.js';
import { unlockAudioContext } from '../../ui/notifications.js';
import { showToast } from '../../ui/notifications.js';
import { toggleBodyScroll } from './chatUtils.js';
import { getSystemNotificationSounds, playSystemSound } from '../../native/nativeBridge.js';

/**
 * ============================================================================
 * CHAT MESSAGE CHIMES & RINGTONES SYSTEM (WEB AUDIO SYNTHESIZER)
 * ============================================================================
 * 
 * Provides built-in acoustic chimes and musical ringtones synthesized via the
 * Web Audio API. Eliminates audio file download latency, works 100% offline,
 * and allows each user/rider to select distinct personalized chimes for
 * Inbox and Catering message notifications.
 * ============================================================================
 */

export const FOLDER_CONFIG = {
    inbox: {
        id: 'inbox',
        name: 'Inbox',
        icon: 'fa-inbox',
        color: 'blue',
        defaultChime: 'crystal_bell',
        desc: 'New customer inquiries and unassigned chats'
    },
    catering: {
        id: 'catering',
        name: 'Catering',
        icon: 'fa-motorcycle',
        color: 'amber',
        defaultChime: 'harmonic_bloom',
        desc: 'Active orders currently being catered by you'
    },
    stores: {
        id: 'stores',
        name: 'Stores',
        icon: 'fa-store',
        color: 'orange',
        defaultChime: 'marimba_pop',
        desc: 'Merchant partner and store order pickup coordination'
    },
    applicant: {
        id: 'applicant',
        name: 'Applicant',
        icon: 'fa-user-plus',
        color: 'emerald',
        defaultChime: 'triple_ping',
        desc: 'Rider applicant inquiries and messages'
    },
    followup: {
        id: 'followup',
        name: 'Follow Up',
        icon: 'fa-bookmark',
        color: 'violet',
        defaultChime: 'golden_marimba',
        desc: 'Flagged customer follow-up conversations'
    },
    done: {
        id: 'done',
        name: 'Done',
        icon: 'fa-circle-check',
        color: 'zinc',
        defaultChime: 'gentle_pulse',
        desc: 'Customer replies on completed or archived orders'
    }
};

export const CHAT_FOLDERS = Object.keys(FOLDER_CONFIG);

export const CHIME_CATALOG = [
    {
        id: 'crystal_bell',
        name: 'Crystal Bell',
        category: 'Bright & Clear',
        icon: 'fa-bell',
        notes: [
            { freq: 1046.50, start: 0, dur: 0.40, type: 'sine', gain: 0.35 },
            { freq: 1318.51, start: 0.08, dur: 0.50, type: 'sine', gain: 0.40 },
            { freq: 2093.00, start: 0.12, dur: 0.25, type: 'sine', gain: 0.15 }
        ]
    },
    {
        id: 'harmonic_bloom',
        name: 'Harmonic Bloom',
        category: '3-Tone Chime',
        icon: 'fa-wand-magic-sparkles',
        notes: [
            { freq: 523.25, start: 0, dur: 0.35, type: 'triangle', gain: 0.30 },
            { freq: 659.25, start: 0.09, dur: 0.35, type: 'triangle', gain: 0.35 },
            { freq: 783.99, start: 0.18, dur: 0.45, type: 'triangle', gain: 0.40 },
            { freq: 1046.50, start: 0.26, dur: 0.60, type: 'sine', gain: 0.30 }
        ]
    },
    {
        id: 'cosmic_arp',
        name: 'Cosmic Arp',
        category: 'Ascending Arpeggio',
        icon: 'fa-rocket',
        notes: [
            { freq: 587.33, start: 0, dur: 0.22, type: 'sine', gain: 0.30 },
            { freq: 739.99, start: 0.06, dur: 0.22, type: 'sine', gain: 0.32 },
            { freq: 880.00, start: 0.12, dur: 0.25, type: 'sine', gain: 0.35 },
            { freq: 1174.66, start: 0.18, dur: 0.50, type: 'sine', gain: 0.40 }
        ]
    },
    {
        id: 'marimba_pop',
        name: 'Marimba Pop',
        category: 'Warm & Organic',
        icon: 'fa-music',
        notes: [
            { freq: 523.25, start: 0, dur: 0.25, type: 'triangle', gain: 0.40 },
            { freq: 783.99, start: 0.09, dur: 0.35, type: 'triangle', gain: 0.45 }
        ]
    },
    {
        id: 'double_ding',
        name: 'Double Ding',
        category: 'Classic Alert',
        icon: 'fa-bullhorn',
        notes: [
            { freq: 659.25, start: 0, dur: 0.30, type: 'sine', gain: 0.35 },
            { freq: 880.00, start: 0.13, dur: 0.45, type: 'sine', gain: 0.40 }
        ]
    },
    {
        id: 'triple_ping',
        name: 'Triple Ping',
        category: 'High Energy',
        icon: 'fa-bolt',
        notes: [
            { freq: 880.00, start: 0, dur: 0.18, type: 'sine', gain: 0.30 },
            { freq: 1046.50, start: 0.08, dur: 0.20, type: 'sine', gain: 0.35 },
            { freq: 1318.51, start: 0.16, dur: 0.40, type: 'sine', gain: 0.40 }
        ]
    },
    {
        id: 'golden_marimba',
        name: 'Golden Chord',
        category: 'Mellow Triad',
        icon: 'fa-certificate',
        notes: [
            { freq: 392.00, start: 0, dur: 0.30, type: 'triangle', gain: 0.30 },
            { freq: 493.88, start: 0.07, dur: 0.30, type: 'triangle', gain: 0.35 },
            { freq: 587.33, start: 0.14, dur: 0.50, type: 'sine', gain: 0.38 }
        ]
    },
    {
        id: 'digital_ping',
        name: 'Digital Ping',
        category: 'Modern Minimalist',
        icon: 'fa-microchip',
        notes: [
            { freq: 1174.66, start: 0, dur: 0.18, type: 'sine', gain: 0.35 },
            { freq: 1396.91, start: 0.06, dur: 0.35, type: 'sine', gain: 0.40 }
        ]
    },
    {
        id: 'electric_bell',
        name: 'Electric Bell',
        category: 'Resonant Bell',
        icon: 'fa-ring',
        notes: [
            { freq: 783.99, start: 0, dur: 0.50, type: 'sine', gain: 0.40 },
            { freq: 1567.98, start: 0, dur: 0.35, type: 'sine', gain: 0.20 }
        ]
    },
    {
        id: 'gentle_pulse',
        name: 'Gentle Pulse',
        category: 'Soft Acoustic',
        icon: 'fa-water',
        notes: [
            { freq: 440.00, start: 0, dur: 0.28, type: 'triangle', gain: 0.30 },
            { freq: 554.37, start: 0.10, dur: 0.45, type: 'sine', gain: 0.35 }
        ]
    },
    {
        id: 'mute',
        name: 'Mute (Silent)',
        category: 'No Sound',
        icon: 'fa-volume-xmark',
        notes: []
    }
];

let sharedAudioCtx = null;
let lastChimePlayedTimestamp = 0;
let lastChimeCategory = null;

function getAudioContext() {
    if (!sharedAudioCtx) {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (AudioCtxClass) {
            sharedAudioCtx = new AudioCtxClass();
        }
    }
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
        sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
}

export function getCurrentUserSoundKey() {
    const raw = (appState.telegramId || localStorage.getItem('telegramId') || appState.riderName || localStorage.getItem('riderName') || 'default').toString().trim().toLowerCase();
    return raw.replace(/[^a-z0-9_-]/g, '_');
}

export function getUserChimeSettings() {
    const userKey = getCurrentUserSoundKey();
    const volumeKey = `lokalex_chime_volume_${userKey}`;
    const muteKey = `lokalex_chime_muted_${userKey}`;

    let volume = parseFloat(localStorage.getItem(volumeKey) || localStorage.getItem('lokalex_chime_volume') || '0.85');
    let isMuted = localStorage.getItem(muteKey) === 'true' || localStorage.getItem('lokalex_chime_muted') === 'true';

    // Verify presets exist
    const isValidChime = (id) => {
        if (!id) return false;
        if (id === 'mute') return true;
        if (id.startsWith('system_')) return true;
        if (id.startsWith('custom_')) return true;
        return CHIME_CATALOG.some(c => c.id === id);
    };

    const folderChimes = {};
    const folderMutes = {};

    CHAT_FOLDERS.forEach(folder => {
        const chimeKey = `lokalex_chime_${folder}_${userKey}`;
        const legacyChimeKey = `lokalex_chime_${folder}`;
        const fMuteKey = `lokalex_mute_${folder}_${userKey}`;
        const legacyMuteKey = `lokalex_mute_${folder}`;

        let chime = localStorage.getItem(chimeKey) || localStorage.getItem(legacyChimeKey);
        // Fallbacks for inbox and catering legacy keys
        if (!chime && folder === 'inbox') chime = localStorage.getItem('lokalex_chime_inbox');
        if (!chime && folder === 'catering') chime = localStorage.getItem('lokalex_chime_catering');
        if (!chime || !isValidChime(chime)) chime = FOLDER_CONFIG[folder].defaultChime;

        let muted = localStorage.getItem(fMuteKey) === 'true' || localStorage.getItem(legacyMuteKey) === 'true';
        if (chime === 'mute') muted = true;

        folderChimes[folder] = chime;
        folderMutes[folder] = muted;
    });

    if (isNaN(volume) || volume < 0) volume = 0.85;

    return {
        folderChimes,
        folderMutes,
        inboxChime: folderChimes.inbox,
        cateringChime: folderChimes.catering,
        volume,
        isMuted
    };
}

export function isFolderMuted(folder = 'inbox', settings = null) {
    const s = settings || getUserChimeSettings();
    if (s.isMuted) return true; // Global mute
    const key = (folder || 'inbox').toLowerCase();
    if (s.folderMutes && s.folderMutes[key]) return true;
    const chime = s.folderChimes ? s.folderChimes[key] : (key === 'catering' ? s.cateringChime : s.inboxChime);
    return !chime || chime === 'mute';
}

export function getFolderChimeId(folder = 'inbox', settings = null) {
    const s = settings || getUserChimeSettings();
    const key = (folder || 'inbox').toLowerCase();
    if (s.folderChimes && s.folderChimes[key]) {
        return s.folderChimes[key];
    }
    if (key === 'catering') return s.cateringChime || 'harmonic_bloom';
    if (key === 'inbox') return s.inboxChime || 'crystal_bell';
    const cfg = FOLDER_CONFIG[key];
    return cfg ? cfg.defaultChime : 'crystal_bell';
}

export function updateFolderMuteIcons(settings = null) {
    const s = settings || getUserChimeSettings();
    CHAT_FOLDERS.forEach(folder => {
        // Find icon elements (e.g. #rider-inbox-mute-icon, #rider-stores-mute-icon)
        const icon = document.getElementById(`rider-${folder}-mute-icon`) || 
                     (folder === 'stores' ? document.getElementById('rider-store-mute-icon') : null);
        if (icon) {
            const muted = isFolderMuted(folder, s);
            if (muted) {
                icon.classList.remove('hidden');
            } else {
                icon.classList.add('hidden');
            }
        }
    });
}

export function saveUserChimeSettings(settings) {
    const userKey = getCurrentUserSoundKey();
    const fChimes = settings.folderChimes || {};
    const fMutes = settings.folderMutes || {};

    // Backward compatibility mappings
    if (settings.inboxChime && !fChimes.inbox) fChimes.inbox = settings.inboxChime;
    if (settings.cateringChime && !fChimes.catering) fChimes.catering = settings.cateringChime;

    CHAT_FOLDERS.forEach(folder => {
        const chime = fChimes[folder];
        if (chime) {
            localStorage.setItem(`lokalex_chime_${folder}_${userKey}`, chime);
            localStorage.setItem(`lokalex_chime_${folder}`, chime);
        }
        if (typeof fMutes[folder] === 'boolean') {
            localStorage.setItem(`lokalex_mute_${folder}_${userKey}`, fMutes[folder].toString());
            localStorage.setItem(`lokalex_mute_${folder}`, fMutes[folder].toString());
        }
    });

    if (fChimes.inbox) {
        localStorage.setItem(`lokalex_chime_inbox_${userKey}`, fChimes.inbox);
        localStorage.setItem('lokalex_chime_inbox', fChimes.inbox);
    }
    if (fChimes.catering) {
        localStorage.setItem(`lokalex_chime_catering_${userKey}`, fChimes.catering);
        localStorage.setItem('lokalex_chime_catering', fChimes.catering);
    }

    if (typeof settings.volume === 'number') {
        localStorage.setItem(`lokalex_chime_volume_${userKey}`, settings.volume.toString());
        localStorage.setItem('lokalex_chime_volume', settings.volume.toString());
    }
    if (typeof settings.isMuted === 'boolean') {
        localStorage.setItem(`lokalex_chime_muted_${userKey}`, settings.isMuted.toString());
        localStorage.setItem('lokalex_chime_muted', settings.isMuted.toString());
    }

    updateFolderMuteIcons(settings);
}

/**
 * Custom Audio Chimes Management (Local Storage + HTML5 Audio)
 */
const CUSTOM_CHIMES_KEY = 'lokalex_custom_chimes_data';
let activeCustomAudio = null;

export function getCustomChimesList() {
    try {
        const raw = localStorage.getItem(CUSTOM_CHIMES_KEY);
        if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) return list;
        }
    } catch (e) {
        console.warn("Failed to parse custom chimes from storage:", e);
    }
    return [];
}

export function saveCustomChimesList(list) {
    try {
        localStorage.setItem(CUSTOM_CHIMES_KEY, JSON.stringify(list || []));
    } catch (e) {
        console.error("Failed to save custom chimes to storage:", e);
        showToast("Storage error: Audio file might be too large.");
    }
}

export function playCustomChimeAudio(chimeId, volumeMultiplier = 0.85) {
    if (!chimeId) return false;
    const list = getCustomChimesList();
    const found = list.find(c => c.id === chimeId);
    if (!found || !found.dataUrl) return false;

    try {
        if (activeCustomAudio) {
            activeCustomAudio.pause();
            activeCustomAudio.currentTime = 0;
            activeCustomAudio = null;
        }
        activeCustomAudio = new Audio(found.dataUrl);
        activeCustomAudio.volume = Math.max(0.01, Math.min(1.0, volumeMultiplier));
        activeCustomAudio.play().catch(err => {
            console.warn("Custom audio playback failed:", err);
        });
        return true;
    } catch (e) {
        console.error("Custom audio chime error:", e);
        return false;
    }
}

export function handleCustomChimeFileSelected(event) {
    const file = event.target?.files?.[0];
    if (event.target) event.target.value = ''; // Reset input to allow re-selection
    if (!file) return;

    // Check size: limit to 4.5MB to protect localStorage quotas
    const MAX_SIZE = 4.5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
        showToast("⚠️ Audio file is too large (max 4.5MB). Please pick a shorter audio clip.");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target?.result;
        if (!dataUrl) {
            showToast("⚠️ Could not read audio file.");
            return;
        }

        // Clean name (strip extension, max 35 chars)
        let cleanName = (file.name || 'Custom Chime').replace(/\.[^/.]+$/, '').trim();
        if (cleanName.length > 35) cleanName = cleanName.substring(0, 32) + '...';

        const customChimes = getCustomChimesList();
        const newChime = {
            id: 'custom_' + Date.now(),
            name: cleanName,
            fileName: file.name,
            size: file.size,
            dataUrl: dataUrl,
            createdAt: Date.now()
        };

        customChimes.push(newChime);
        saveCustomChimesList(customChimes);

        // Update dropdowns & UI
        populateChimeDropdowns();
        renderCustomChimesListUI();

        // Automatically select in sound-select-inbox so user can test or save right away
        const inboxSelect = document.getElementById('sound-select-inbox');
        if (inboxSelect) {
            inboxSelect.value = newChime.id;
        }

        // Play preview immediately
        playCustomChimeAudio(newChime.id, 0.85);

        showToast(`🎵 Custom chime "${cleanName}" added!`);
    };

    reader.onerror = () => {
        showToast("⚠️ Error reading file.");
    };

    reader.readAsDataURL(file);
}

export function renderCustomChimesListUI() {
    const container = document.getElementById('custom-chimes-container');
    if (!container) return;

    const customList = getCustomChimesList();
    if (!customList || customList.length === 0) {
        container.innerHTML = `
            <div class="text-[10px] text-gray-400 italic text-center py-2 bg-white/40 dark:bg-black/20 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                No custom audio chimes. Click "+ Pick Audio File" to add one.
            </div>
        `;
        return;
    }

    let html = '';
    customList.forEach(item => {
        const kbSize = item.size ? Math.round(item.size / 1024) : 0;
        const sizeLabel = kbSize > 1024 ? `${(kbSize / 1024).toFixed(1)} MB` : `${kbSize} KB`;

        html += `
            <div class="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-cardBg border border-purple-200 dark:border-purple-900/40 shadow-2xs gap-2">
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <div class="w-6 h-6 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center text-xs shrink-0">
                        <i class="fa-solid fa-music"></i>
                    </div>
                    <div class="flex flex-col min-w-0 flex-1">
                        <span class="text-[11px] font-bold text-gray-900 dark:text-white truncate" title="${item.name}">${item.name}</span>
                        <span class="text-[9px] text-gray-400 font-mono">${sizeLabel}</span>
                    </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" onclick="window.previewChime && window.previewChime('${item.id}')" class="w-6 h-6 rounded-lg bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/30 dark:hover:bg-purple-800/40 text-purple-600 dark:text-purple-300 flex items-center justify-center text-[10px] transition active:scale-95 cursor-pointer" title="Preview Audio">
                        <i class="fa-solid fa-play"></i>
                    </button>
                    <button type="button" onclick="window.deleteCustomChime && window.deleteCustomChime('${item.id}')" class="w-6 h-6 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-800/40 text-red-600 dark:text-red-400 flex items-center justify-center text-[10px] transition active:scale-95 cursor-pointer" title="Delete Chime">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

export function deleteCustomChime(chimeId) {
    if (!chimeId) return;
    const list = getCustomChimesList();
    const updated = list.filter(c => c.id !== chimeId);
    saveCustomChimesList(updated);

    // If currently active in user settings, revert to defaults
    const settings = getUserChimeSettings();
    let changed = false;
    if (settings.inboxChime === chimeId) {
        settings.inboxChime = 'crystal_bell';
        changed = true;
    }
    if (settings.cateringChime === chimeId) {
        settings.cateringChime = 'harmonic_bloom';
        changed = true;
    }
    if (changed) {
        saveUserChimeSettings(settings);
    }

    populateChimeDropdowns();
    syncModalInputs();
    renderCustomChimesListUI();
    showToast("🗑️ Custom chime removed.");
}

/**
 * Synthesizes and plays a chosen chime with Web Audio API.
 */
export function playChime(chimeId, volumeMultiplier = 0.85) {
    if (!chimeId || chimeId === 'mute') return;

    // 1. Custom Picked Audio file
    if (typeof chimeId === 'string' && chimeId.startsWith('custom_')) {
        const played = playCustomChimeAudio(chimeId, volumeMultiplier);
        if (played) return;
        // Fallback to default if audio missing
        chimeId = 'crystal_bell';
    }

    // 2. Native device system notification / ringtone / alarm
    if (typeof chimeId === 'string' && chimeId.startsWith('system_')) {
        let uri = '';
        try {
            const list = getSystemNotificationSounds();
            const found = list.find(s => s.id === chimeId);
            if (found && found.uri) uri = found.uri;
        } catch (_) {}
        const played = playSystemSound(uri || chimeId);
        if (played) return;
        // Fallback to web synth if not on native device
        chimeId = 'crystal_bell';
    }

    const preset = CHIME_CATALOG.find(c => c.id === chimeId);
    if (!preset || !preset.notes || preset.notes.length === 0) return;

    try {
        unlockAudioContext();
        const ctx = getAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(Math.max(0.01, Math.min(1.0, volumeMultiplier)), now);
        masterGain.connect(ctx.destination);

        preset.notes.forEach(note => {
            const osc = ctx.createOscillator();
            const noteGain = ctx.createGain();

            osc.type = note.type || 'sine';
            osc.frequency.setValueAtTime(note.freq, now + note.start);

            const peakGain = (note.gain || 0.3);
            const startTime = now + note.start;
            const endTime = startTime + note.dur;

            noteGain.gain.setValueAtTime(0.001, startTime);
            noteGain.gain.linearRampToValueAtTime(peakGain, startTime + 0.015);
            noteGain.gain.exponentialRampToValueAtTime(0.0001, endTime);

            osc.connect(noteGain);
            noteGain.connect(masterGain);

            osc.start(startTime);
            osc.stop(endTime + 0.05);
        });
    } catch (e) {
        console.warn("Chime playback error:", e);
    }
}

/**
 * Plays the personalized notification sound for an incoming message.
 * Category can be any folder: 'inbox', 'catering', 'stores', 'applicant', 'followup', 'done'.
 */
export function playChatChime(category = 'inbox') {
    const folder = (category || 'inbox').toLowerCase();
    const now = Date.now();
    // Debounce guard: Prevent double chime bursts within 900ms for the same folder
    if (now - lastChimePlayedTimestamp < 900 && lastChimeCategory === folder) {
        return;
    }

    const settings = getUserChimeSettings();
    if (settings.isMuted) return;
    if (isFolderMuted(folder, settings)) return;

    const targetChimeId = getFolderChimeId(folder, settings);
    if (!targetChimeId || targetChimeId === 'mute') return;

    lastChimePlayedTimestamp = now;
    lastChimeCategory = folder;

    playChime(targetChimeId, settings.volume);

    // Haptic vibration feedback on supported mobile devices
    try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            if (folder === 'catering') {
                navigator.vibrate([70, 50, 90, 50, 70]);
            } else if (folder === 'inbox') {
                navigator.vibrate([60, 40, 60]);
            } else {
                navigator.vibrate([40, 30, 40]);
            }
        }
    } catch (_) {}
}

export function previewChime(chimeId) {
    const settings = getUserChimeSettings();
    playChime(chimeId, settings.volume || 0.85);
}

// ============================================================================
// CHIME SETTINGS MODAL CONTROLLER
// ============================================================================

export function openChatSoundSettingsModal() {
    const modal = document.getElementById('chat-sound-settings-modal');
    if (!modal) return;

    populateChimeDropdowns();
    syncModalInputs();
    renderCustomChimesListUI();

    modal.classList.remove('hidden');
    toggleBodyScroll(true);
}

export function closeChatSoundSettingsModal() {
    const modal = document.getElementById('chat-sound-settings-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
}

export function populateChimeDropdowns() {
    let optionsHtml = '';

    // 0. Mute option at the top
    optionsHtml += `<option value="mute">🔕 Mute (Silent)</option>`;

    // 1. Custom Picked Audio Chimes
    const customList = getCustomChimesList();
    if (customList && customList.length > 0) {
        optionsHtml += `<optgroup label="🎵 Custom Picked Chimes">`;
        customList.forEach(c => {
            optionsHtml += `<option value="${c.id}">${c.name || 'Custom Audio'} (My File)</option>`;
        });
        optionsHtml += `</optgroup>`;
    }

    // 2. Phone System Chimes
    let sysSounds = [];
    try {
        sysSounds = getSystemNotificationSounds() || [];
    } catch (_) {}

    if (sysSounds && sysSounds.length > 0) {
        optionsHtml += `<optgroup label="📱 Phone System Chimes">`;
        sysSounds.forEach(s => {
            optionsHtml += `<option value="${s.id}">${s.name} (Device Sound)</option>`;
        });
        optionsHtml += `</optgroup>`;
    }

    // 3. Built-in Acoustic Chimes
    optionsHtml += `<optgroup label="🔔 Built-in Acoustic Chimes">`;
    CHIME_CATALOG.forEach(c => {
        if (c.id !== 'mute') {
            optionsHtml += `<option value="${c.id}">${c.name} — ${c.category}</option>`;
        }
    });
    optionsHtml += `</optgroup>`;

    CHAT_FOLDERS.forEach(folder => {
        const select = document.getElementById(`sound-select-${folder}`);
        if (select) {
            const currentVal = select.value;
            select.innerHTML = optionsHtml;
            if (currentVal) select.value = currentVal;
        }
    });
}

export function syncModalInputs() {
    const settings = getUserChimeSettings();

    CHAT_FOLDERS.forEach(folder => {
        const select = document.getElementById(`sound-select-${folder}`);
        const muteBox = document.getElementById(`sound-mute-${folder}`);
        if (select) {
            select.value = settings.folderChimes[folder] || FOLDER_CONFIG[folder].defaultChime;
        }
        if (muteBox) {
            muteBox.checked = isFolderMuted(folder, settings);
        }
    });

    const volumeSlider = document.getElementById('sound-volume-slider');
    const volumeText = document.getElementById('sound-volume-text');
    const muteCheckbox = document.getElementById('sound-mute-checkbox');
    const userNameBadge = document.getElementById('sound-user-name-badge');

    if (volumeSlider) volumeSlider.value = Math.round(settings.volume * 100);
    if (volumeText) volumeText.innerText = `${Math.round(settings.volume * 100)}%`;
    if (muteCheckbox) muteCheckbox.checked = settings.isMuted;

    if (userNameBadge) {
        const myName = appState.riderName || localStorage.getItem('riderName') || 'Rider';
        userNameBadge.innerText = myName;
    }
}

export function handleSoundVolumeChange(val) {
    const num = Math.max(0, Math.min(100, parseInt(val, 10) || 0));
    const volumeText = document.getElementById('sound-volume-text');
    if (volumeText) volumeText.innerText = `${num}%`;
}

export function previewSelectedModalChime(category = 'inbox') {
    const folder = (category || 'inbox').toLowerCase();
    const muteBox = document.getElementById(`sound-mute-${folder}`);
    if (muteBox && muteBox.checked) {
        showToast(`🔕 ${FOLDER_CONFIG[folder]?.name || folder} is currently set to Muted.`);
        return;
    }

    const select = document.getElementById(`sound-select-${folder}`);
    const volumeSlider = document.getElementById('sound-volume-slider');
    const volume = volumeSlider ? parseInt(volumeSlider.value, 10) / 100 : 0.85;

    const chimeId = select ? select.value : getFolderChimeId(folder);
    if (!chimeId || chimeId === 'mute') {
        showToast(`🔕 ${FOLDER_CONFIG[folder]?.name || folder} is set to Mute (Silent).`);
        return;
    }

    playChime(chimeId, volume);
}

export function saveChatSoundSettingsFromModal() {
    const folderChimes = {};
    const folderMutes = {};

    CHAT_FOLDERS.forEach(folder => {
        const select = document.getElementById(`sound-select-${folder}`);
        const muteBox = document.getElementById(`sound-mute-${folder}`);
        const chosen = select ? select.value : FOLDER_CONFIG[folder].defaultChime;
        folderChimes[folder] = chosen;
        folderMutes[folder] = muteBox ? muteBox.checked : (chosen === 'mute');
    });

    const volumeSlider = document.getElementById('sound-volume-slider');
    const muteCheckbox = document.getElementById('sound-mute-checkbox');

    const volume = volumeSlider ? (parseInt(volumeSlider.value, 10) / 100) : 0.85;
    const isMuted = muteCheckbox ? muteCheckbox.checked : false;

    saveUserChimeSettings({ 
        folderChimes, 
        folderMutes, 
        inboxChime: folderChimes.inbox,
        cateringChime: folderChimes.catering,
        volume, 
        isMuted 
    });

    closeChatSoundSettingsModal();
    showToast(isMuted ? "🔕 All chat sound alerts muted." : "🔔 Folder chimes & mute settings saved!");
}

if (typeof window !== 'undefined') {
    window.openChatSoundSettingsModal = openChatSoundSettingsModal;
    window.closeChatSoundSettingsModal = closeChatSoundSettingsModal;
    window.saveChatSoundSettingsFromModal = saveChatSoundSettingsFromModal;
    window.previewSelectedModalChime = previewSelectedModalChime;
    window.handleSoundVolumeChange = handleSoundVolumeChange;
    window.playChatChime = playChatChime;
    window.previewChime = previewChime;
    window.handleCustomChimeFileSelected = handleCustomChimeFileSelected;
    window.deleteCustomChime = deleteCustomChime;
    window.renderCustomChimesListUI = renderCustomChimesListUI;
    window.playCustomChimeAudio = playCustomChimeAudio;
    window.updateFolderMuteIcons = updateFolderMuteIcons;
    window.isFolderMuted = isFolderMuted;
    window.getFolderChimeId = getFolderChimeId;
}
