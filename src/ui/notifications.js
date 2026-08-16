// src/ui/notifications.js
let audioUnlocked = false;

export function unlockAudioContext() {
    if (audioUnlocked) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            const ctx = new AudioContext();
            ctx.resume().then(() => {
                audioUnlocked = true;
            });
        }
    } catch(e) {}
}

export function showToast(message, duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        // z-[9999999] ensures toasts are always visible on top of all modals
        container.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 z-[9999999] flex flex-col gap-2 items-center pointer-events-none px-4 w-full max-w-sm';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'bg-gray-900/95 text-white border border-gray-700 text-xs font-bold px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md transition-all duration-300 pointer-events-auto transform translate-y-2 opacity-0 flex items-center gap-2 text-center';
    toast.innerHTML = `<span>${message}</span>`;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    });

    // Remove after duration
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-2', 'opacity-0');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }, duration);
}

export function showSideNotification(title, message, iconClass = "fa-bell", textCol = "text-blue-400", borderCol = "border-blue-500") {
    let sideContainer = document.getElementById('side-notification-container');
    if (!sideContainer) {
        sideContainer = document.createElement('div');
        sideContainer.id = 'side-notification-container';
        // z-[9999999] ensures notifications appear above modals
        sideContainer.className = 'fixed top-4 right-4 z-[9999999] flex flex-col gap-2 pointer-events-none max-w-xs w-full px-2';
        document.body.appendChild(sideContainer);
    }

    const card = document.createElement('div');
    card.className = `bg-gray-900/95 border ${borderCol} p-3 rounded-2xl shadow-2xl backdrop-blur-md flex items-start gap-2.5 text-xs pointer-events-auto transition-all duration-300 transform translate-x-4 opacity-0`;
    card.innerHTML = `
        <div class="mt-0.5 text-sm ${textCol} shrink-0">
            <i class="fa-solid ${iconClass}"></i>
        </div>
        <div class="flex-1 flex flex-col">
            <span class="font-black ${textCol} text-[11px] uppercase tracking-wider">${title}</span>
            <span class="text-gray-300 text-[11px] mt-0.5 leading-snug">${message}</span>
        </div>
    `;

    sideContainer.appendChild(card);

    requestAnimationFrame(() => {
        card.classList.remove('translate-x-4', 'opacity-0');
        card.classList.add('translate-x-0', 'opacity-100');
    });

    setTimeout(() => {
        card.classList.remove('translate-x-0', 'opacity-100');
        card.classList.add('translate-x-4', 'opacity-0');
        setTimeout(() => {
            if (card.parentNode) card.parentNode.removeChild(card);
        }, 300);
    }, 4000);
}

if (typeof window !== 'undefined') {
    window.showToast = showToast;
    window.showSideNotification = showSideNotification;
    window.unlockAudioContext = unlockAudioContext;
}