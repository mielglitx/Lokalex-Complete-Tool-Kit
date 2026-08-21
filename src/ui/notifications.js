// src/ui/notifications.js
import { escapeHtml } from '../utils/helpers.js';

let audioCtxInstance = null;

export function unlockAudioContext() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!audioCtxInstance && AudioContext) {
            audioCtxInstance = new AudioContext();
        }
        if (audioCtxInstance && audioCtxInstance.state === 'suspended') {
            audioCtxInstance.resume();
        }
    } catch(e) {}
}

export function showToast(message, duration = 2500) {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[99999] flex flex-col items-center gap-1.5 pointer-events-none px-3 w-full max-w-xs';
        document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = 'bg-gray-900/95 dark:bg-black/90 text-white text-[10px] font-bold px-3 py-1.5 rounded-full border border-gray-700/80 shadow-lg backdrop-blur-md transition-all duration-200 transform translate-y-2 opacity-0 pointer-events-auto text-center truncate max-w-full';
    toast.innerText = message;

    toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    });

    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-2', 'opacity-0');
        setTimeout(() => toast.remove(), 200);
    }, duration);
}

// ULTRA-COMPACT MICRO SIDE NOTIFICATION (90% SMALLER FOOTPRINT)
export function showSideNotification(title, message, icon = 'fa-bell', textColor = 'text-blue-400', borderColor = 'border-blue-500', duration = 3000) {
    let container = document.getElementById('side-notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'side-notification-container';
        container.className = 'fixed top-3 right-3 z-[99999] flex flex-col gap-1 pointer-events-none max-w-[220px]';
        document.body.appendChild(container);
    }

    const notif = document.createElement('div');
    notif.className = `bg-gray-950/95 text-white border ${borderColor} rounded-xl px-2.5 py-1 shadow-lg backdrop-blur-md flex items-center gap-2 pointer-events-auto transition-all duration-200 transform translate-x-4 opacity-0`;

    const cleanIcon = icon.replace(/^fa-/, '');

    notif.innerHTML = `
        <div class="${textColor} text-xs shrink-0 flex items-center justify-center">
            <i class="fa-solid fa-${cleanIcon}"></i>
        </div>
        <div class="min-w-0 flex-1 leading-tight">
            <div class="font-black text-[9px] ${textColor} uppercase tracking-wider truncate">${escapeHtml(title)}</div>
            <div class="text-[8.5px] text-gray-300 font-medium truncate">${escapeHtml(message)}</div>
        </div>
    `;

    container.appendChild(notif);

    requestAnimationFrame(() => {
        notif.classList.remove('translate-x-4', 'opacity-0');
        notif.classList.add('translate-x-0', 'opacity-100');
    });

    setTimeout(() => {
        notif.classList.remove('translate-x-0', 'opacity-100');
        notif.classList.add('translate-x-4', 'opacity-0');
        setTimeout(() => notif.remove(), 200);
    }, duration);
}

if (typeof window !== 'undefined') {
    window.showToast = showToast;
    window.showSideNotification = showSideNotification;
    window.unlockAudioContext = unlockAudioContext;
}