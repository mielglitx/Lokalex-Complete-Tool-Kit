// src/features/storeHub/ui/storeAudio.js
import { storeHubState } from './storeHubState.js';
import { showToast } from '../../../ui/notifications.js';

export function playKitchenChime() {
    if (storeHubState.isKitchenAudioMuted) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!storeHubState.kitchenAudioCtx && AudioContext) {
            storeHubState.kitchenAudioCtx = new AudioContext();
        }
        if (storeHubState.kitchenAudioCtx && storeHubState.kitchenAudioCtx.state === 'suspended') {
            storeHubState.kitchenAudioCtx.resume();
        }
        if (!storeHubState.kitchenAudioCtx) return;

        const now = storeHubState.kitchenAudioCtx.currentTime;

        const osc1 = storeHubState.kitchenAudioCtx.createOscillator();
        const osc2 = storeHubState.kitchenAudioCtx.createOscillator();
        const gain = storeHubState.kitchenAudioCtx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, now);
        osc1.frequency.exponentialRampToValueAtTime(440, now + 0.4);

        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(1760, now + 0.05);
        osc2.frequency.exponentialRampToValueAtTime(880, now + 0.5);

        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(storeHubState.kitchenAudioCtx.destination);

        osc1.start(now);
        osc2.start(now + 0.05);
        osc1.stop(now + 0.7);
        osc2.stop(now + 0.7);
    } catch(e) {}
}

export function startRepeatingKitchenAlarm() {
    if (storeHubState.kitchenAudioInterval) return;
    playKitchenChime();
    storeHubState.kitchenAudioInterval = setInterval(() => {
        playKitchenChime();
    }, 3500);
}

export function stopRepeatingKitchenAlarm() {
    if (storeHubState.kitchenAudioInterval) {
        clearInterval(storeHubState.kitchenAudioInterval);
        storeHubState.kitchenAudioInterval = null;
    }
}

export function toggleKitchenMute() {
    storeHubState.isKitchenAudioMuted = !storeHubState.isKitchenAudioMuted;
    const btn = document.getElementById('merch-mute-chime-btn');
    if (btn) {
        btn.innerHTML = storeHubState.isKitchenAudioMuted 
            ? `<i class="fa-solid fa-volume-xmark text-red-400"></i>` 
            : `<i class="fa-solid fa-bell text-emerald-400 animate-pulse"></i>`;
        btn.title = storeHubState.isKitchenAudioMuted ? "Unmute Kitchen Chime" : "Mute Kitchen Chime";
    }
    if (storeHubState.isKitchenAudioMuted) {
        stopRepeatingKitchenAlarm();
    }
    showToast(storeHubState.isKitchenAudioMuted ? "🔇 Kitchen chime muted." : "🔔 Kitchen chime enabled.");
}