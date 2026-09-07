// src/app/appMonitors.js

export function updateNetworkStatus(forcedState = null) {
    const container = document.getElementById('network-status-pill');
    if (!container) return;

    let status = 'online';

    if (forcedState === 'connecting') {
        status = 'connecting';
    } else if (forcedState === true) {
        status = 'online';
    } else if (forcedState === false) {
        status = navigator.onLine ? 'connecting' : 'offline';
    } else {
        if (!navigator.onLine) {
            status = 'offline';
        } else if (document.visibilityState !== 'visible') {
            status = 'connecting';
        } else {
            status = 'online';
        }
    }

    if (status === 'online') {
        container.className = "flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/40 shadow-xs transition-all duration-300 shrink-0";
        container.title = "Network: Online";
        container.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>`;
    } else if (status === 'connecting') {
        container.className = "flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/10 border border-amber-500/40 animate-pulse shadow-xs transition-all duration-300 shrink-0";
        container.title = "Network: Connecting...";
        container.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.8)]"></span>`;
    } else {
        container.className = "flex items-center justify-center w-7 h-7 rounded-full bg-red-500/10 border border-red-500/40 shadow-xs transition-all duration-300 shrink-0";
        container.title = "Network: Offline";
        container.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span>`;
    }
}

export function initBatteryMonitor() {
    if (!('getBattery' in navigator)) return;

    navigator.getBattery().then((battery) => {
        function renderBatteryState() {
            const level = Math.round(battery.level * 100);
            const isCharging = battery.charging;

            const targets = [
                {
                    pill: document.getElementById('header-battery-pill'),
                    icon: document.getElementById('header-battery-icon'),
                    text: document.getElementById('header-battery-text')
                },
                {
                    pill: document.getElementById('header-cust-battery-pill'),
                    icon: document.getElementById('header-cust-battery-icon'),
                    text: document.getElementById('header-cust-battery-text')
                }
            ];

            targets.forEach(({ pill, icon, text }) => {
                if (!pill || !icon || !text) return;

                pill.classList.remove('hidden');
                text.innerText = `${level}%`;

                if (isCharging) {
                    icon.className = "fa-solid fa-bolt text-amber-400 animate-pulse text-[11px]";
                    pill.className = "flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 px-2 py-1 rounded-xl text-[10px] font-mono font-bold text-amber-600 dark:text-amber-300 transition-all select-none shrink-0";
                } else if (level <= 20) {
                    icon.className = "fa-solid fa-battery-quarter text-red-500 text-[11px]";
                    pill.className = "flex items-center gap-1 bg-red-500/10 border border-red-500/30 px-2 py-1 rounded-xl text-[10px] font-mono font-bold text-red-600 dark:text-red-400 transition-all select-none shrink-0";
                } else {
                    let batIcon = "fa-battery-full";
                    if (level <= 40) batIcon = "fa-battery-quarter";
                    else if (level <= 70) batIcon = "fa-battery-half";
                    else if (level <= 90) batIcon = "fa-battery-three-quarters";

                    icon.className = `fa-solid ${batIcon} text-emerald-500 text-[11px]`;
                    pill.className = "flex items-center gap-1 bg-gray-100 dark:bg-black/40 border border-gray-300 dark:border-gray-700/60 px-2 py-1 rounded-xl text-[10px] font-mono font-bold text-gray-700 dark:text-gray-300 transition-all select-none shrink-0";
                }
            });
        }

        renderBatteryState();
        battery.addEventListener('levelchange', renderBatteryState);
        battery.addEventListener('chargingchange', renderBatteryState);
    }).catch(() => {});
}