// src/ui/notifications.js
let audioCtx = null;
let sideNotifyTimeout = null;

export function unlockAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

export function playNotificationSound(isMention = false) {
    try {
        unlockAudioContext();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        if (isMention) {
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(1320, now + 0.15);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(now); osc.stop(now + 0.35);
        } else {
            osc.frequency.setValueAtTime(600, now);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(now); osc.stop(now + 0.2);
        }
    } catch (e) {}
}

export function showToast(msg) { 
    const toast = document.getElementById('toast'); 
    if(!toast) return;
    toast.innerText = msg; 
    toast.style.opacity = '1'; 
    setTimeout(() => { toast.style.opacity = '0'; }, 2500); 
}
window.addEventListener('showToast', (e) => showToast(e.detail));

export function showSideNotification(title, message, iconClass = "fa-sync fa-spin", colorClass = "text-blue-400", borderClass = "border-blue-500") {
    const banner = document.getElementById('side-notification-banner');
    const icon = document.getElementById('side-notify-icon');
    const titleEl = document.getElementById('side-notify-title');
    const msgEl = document.getElementById('side-notify-msg');

    banner.className = `fixed top-16 right-3 z-[9998] max-w-xs w-72 bg-gray-900/95 border-l-4 ${borderClass} text-white p-3.5 rounded-xl shadow-2xl transition-all duration-300 ease-out side-notify-visible pointer-events-none flex items-start gap-3 backdrop-blur-md`;
    icon.className = `fa-solid ${iconClass}`;
    titleEl.innerText = title;
    titleEl.className = `font-bold text-xs ${colorClass} tracking-wide uppercase`;
    msgEl.innerText = message;

    if (sideNotifyTimeout) clearTimeout(sideNotifyTimeout);
    sideNotifyTimeout = setTimeout(() => {
        banner.classList.remove('side-notify-visible');
        banner.classList.add('side-notify-hidden');
    }, 3500);
}