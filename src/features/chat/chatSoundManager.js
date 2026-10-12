// src/features/chat/chatSoundManager.js
import { appState } from '../../store/state.js';
import { unlockAudioContext } from '../../ui/notifications.js';
import { showToast } from '../../ui/notifications.js';
import { toggleBodyScroll } from './chatUtils.js';

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
    const inboxKey = `lokalex_chime_inbox_${userKey}`;
    const cateringKey = `lokalex_chime_catering_${userKey}`;
    const volumeKey = `lokalex_chime_volume_${userKey}`;
    const muteKey = `lokalex_chime_muted_${userKey}`;

    let inboxChime = localStorage.getItem(inboxKey) || localStorage.getItem('lokalex_chime_inbox') || 'crystal_bell';
    let cateringChime = localStorage.getItem(cateringKey) || localStorage.getItem('lokalex_chime_catering') || 'harmonic_bloom';
    let volume = parseFloat(localStorage.getItem(volumeKey) || localStorage.getItem('lokalex_chime_volume') || '0.85');
    let isMuted = localStorage.getItem(muteKey) === 'true' || localStorage.getItem('lokalex_chime_muted') === 'true';

    // Verify presets exist
    if (!CHIME_CATALOG.some(c => c.id === inboxChime)) inboxChime = 'crystal_bell';
    if (!CHIME_CATALOG.some(c => c.id === cateringChime)) cateringChime = 'harmonic_bloom';
    if (isNaN(volume) || volume < 0) volume = 0.85;

    return { inboxChime, cateringChime, volume, isMuted };
}

export function saveUserChimeSettings({ inboxChime, cateringChime, volume, isMuted }) {
    const userKey = getCurrentUserSoundKey();
    if (inboxChime) {
        localStorage.setItem(`lokalex_chime_inbox_${userKey}`, inboxChime);
        localStorage.setItem('lokalex_chime_inbox', inboxChime);
    }
    if (cateringChime) {
        localStorage.setItem(`lokalex_chime_catering_${userKey}`, cateringChime);
        localStorage.setItem('lokalex_chime_catering', cateringChime);
    }
    if (typeof volume === 'number') {
        localStorage.setItem(`lokalex_chime_volume_${userKey}`, volume.toString());
        localStorage.setItem('lokalex_chime_volume', volume.toString());
    }
    if (typeof isMuted === 'boolean') {
        localStorage.setItem(`lokalex_chime_muted_${userKey}`, isMuted.toString());
        localStorage.setItem('lokalex_chime_muted', isMuted.toString());
    }
}

/**
 * Synthesizes and plays a chosen chime with Web Audio API.
 */
export function playChime(chimeId, volumeMultiplier = 0.85) {
    if (!chimeId || chimeId === 'mute') return;

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
 * Category must be 'inbox' or 'catering'.
 */
export function playChatChime(category = 'inbox') {
    const now = Date.now();
    // Debounce guard: Prevent double chime bursts within 900ms
    if (now - lastChimePlayedTimestamp < 900 && lastChimeCategory === category) {
        return;
    }

    const settings = getUserChimeSettings();
    if (settings.isMuted) return;

    const targetChimeId = category === 'catering' ? settings.cateringChime : settings.inboxChime;
    if (!targetChimeId || targetChimeId === 'mute') return;

    lastChimePlayedTimestamp = now;
    lastChimeCategory = category;

    playChime(targetChimeId, settings.volume);

    // Haptic vibration feedback on supported mobile devices
    try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            if (category === 'catering') {
                navigator.vibrate([70, 50, 90, 50, 70]);
            } else {
                navigator.vibrate([60, 40, 60]);
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
    const inboxSelect = document.getElementById('sound-select-inbox');
    const cateringSelect = document.getElementById('sound-select-catering');
    if (!inboxSelect || !cateringSelect) return;

    const optionsHtml = CHIME_CATALOG.map(c => {
        return `<option value="${c.id}">${c.name} — ${c.category}</option>`;
    }).join('');

    inboxSelect.innerHTML = optionsHtml;
    cateringSelect.innerHTML = optionsHtml;
}

export function syncModalInputs() {
    const settings = getUserChimeSettings();

    const inboxSelect = document.getElementById('sound-select-inbox');
    const cateringSelect = document.getElementById('sound-select-catering');
    const volumeSlider = document.getElementById('sound-volume-slider');
    const volumeText = document.getElementById('sound-volume-text');
    const muteCheckbox = document.getElementById('sound-mute-checkbox');
    const userNameBadge = document.getElementById('sound-user-name-badge');

    if (inboxSelect) inboxSelect.value = settings.inboxChime;
    if (cateringSelect) cateringSelect.value = settings.cateringChime;
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

export function previewSelectedModalChime(category) {
    const select = document.getElementById(category === 'catering' ? 'sound-select-catering' : 'sound-select-inbox');
    const volumeSlider = document.getElementById('sound-volume-slider');
    const volume = volumeSlider ? parseInt(volumeSlider.value, 10) / 100 : 0.85;

    const chimeId = select ? select.value : (category === 'catering' ? 'harmonic_bloom' : 'crystal_bell');
    playChime(chimeId, volume);
}

export function saveChatSoundSettingsFromModal() {
    const inboxSelect = document.getElementById('sound-select-inbox');
    const cateringSelect = document.getElementById('sound-select-catering');
    const volumeSlider = document.getElementById('sound-volume-slider');
    const muteCheckbox = document.getElementById('sound-mute-checkbox');

    const inboxChime = inboxSelect ? inboxSelect.value : 'crystal_bell';
    const cateringChime = cateringSelect ? cateringSelect.value : 'harmonic_bloom';
    const volume = volumeSlider ? (parseInt(volumeSlider.value, 10) / 100) : 0.85;
    const isMuted = muteCheckbox ? muteCheckbox.checked : false;

    saveUserChimeSettings({ inboxChime, cateringChime, volume, isMuted });
    closeChatSoundSettingsModal();
    showToast(isMuted ? "🔕 Sound alerts muted." : "🔔 Chime preferences saved!");
}

if (typeof window !== 'undefined') {
    window.openChatSoundSettingsModal = openChatSoundSettingsModal;
    window.closeChatSoundSettingsModal = closeChatSoundSettingsModal;
    window.saveChatSoundSettingsFromModal = saveChatSoundSettingsFromModal;
    window.previewSelectedModalChime = previewSelectedModalChime;
    window.handleSoundVolumeChange = handleSoundVolumeChange;
    window.playChatChime = playChatChime;
    window.previewChime = previewChime;
}
