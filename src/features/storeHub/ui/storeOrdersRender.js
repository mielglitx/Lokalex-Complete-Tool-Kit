// src/features/storeHub/ui/storeOrdersRender.js
import { escapeHtml } from '../../../utils/helpers.js';
import { 
    storeHubState, 
    cleanFirebasePathKey, 
    calculateDistanceInKm 
} from './storeHubState.js';
import { updateLiveCountdownTimers } from './storeOrdersActions.js';

export function setStoreOrdersTab(tab) {
    storeHubState.selectedOrdersTab = tab;

    const btnActive = document.getElementById('store-orders-tab-active');
    const btnDone = document.getElementById('store-orders-tab-done');

    if (btnActive && btnDone) {
        if (tab === 'active') {
            btnActive.className = "flex-1 py-1 rounded-lg bg-orange-600 text-white font-bold text-[10px] transition shadow-sm flex items-center justify-center gap-1";
            btnDone.className = "flex-1 py-1 rounded-lg text-gray-600 dark:text-gray-400 font-bold text-[10px] hover:text-gray-900 dark:hover:text-white transition flex items-center justify-center gap-1";
        } else {
            btnDone.className = "flex-1 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[10px] transition shadow-sm flex items-center justify-center gap-1";
            btnActive.className = "flex-1 py-1 rounded-lg text-gray-600 dark:text-gray-400 font-bold text-[10px] hover:text-gray-900 dark:hover:text-white transition flex items-center justify-center gap-1";
        }
    }

    renderStoreOrders();
}

export function renderStoreOrders() {
    const feed = document.getElementById('merch-orders-feed');
    const badge = document.getElementById('merch-live-orders-badge');
    const activeCountEl = document.getElementById('merch-active-count');
    const doneCountEl = document.getElementById('merch-done-count');
    if (!feed) return;

    const orders = Object.entries(storeHubState.currentOrdersData || {}).map(([id, order]) => ({
        orderId: cleanFirebasePathKey(id),
        ...order
    })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const activeOrders = orders.filter(o => 
        o.status !== 'completed' && 
        o.status !== 'cancelled' && 
        o.status !== 'picked_up' && 
        o.status !== 'delivered' &&
        o.status !== 'done' && 
        !o.isDone
    );

    const doneOrders = orders.filter(o => 
        o.status === 'completed' || 
        o.status === 'picked_up' || 
        o.status === 'delivered' ||
        o.status === 'done' || 
        !!o.isDone
    );

    if (activeCountEl) activeCountEl.innerText = activeOrders.length;
    if (doneCountEl) doneCountEl.innerText = doneOrders.length;
    if (badge) badge.innerText = `${activeOrders.length} Active`;

    const targetList = storeHubState.selectedOrdersTab === 'done' ? doneOrders : activeOrders;

    if (targetList.length === 0) {
        feed.innerHTML = `
            <div class="text-center text-gray-400 dark:text-gray-500 italic py-8 text-xs flex flex-col items-center gap-1.5">
                <i class="fa-solid fa-receipt text-xl text-gray-400 dark:text-gray-600"></i>
                <span>${storeHubState.selectedOrdersTab === 'done' ? 'No completed orders in history yet.' : 'No active incoming orders at the moment.'}</span>
            </div>`;
        return;
    }

    feed.innerHTML = targetList.map(order => {
        const items = order.items || [];
        const status = order.status || 'pending';
        const isPending = status === 'pending';
        const isPreparing = status === 'preparing';
        const isReady = status === 'ready' || status === 'ready_for_pickup';
        const riderName = order.riderName || 'Unassigned Rider';
        const riderId = (order.riderId || '').toString().trim();
        const orderIdClean = cleanFirebasePathKey(order.orderId);
        const orderTime = order.timestamp ? new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

        let statusBadge = `<span class="bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40 px-2 py-0.5 rounded-full text-[9px] font-bold animate-pulse">🟡 PENDING ACCEPTANCE</span>`;
        if (isPreparing) {
            statusBadge = `<span class="bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-500/40 px-2 py-0.5 rounded-full text-[9px] font-bold">🔵 PREPARING</span>`;
        } else if (isReady) {
            statusBadge = `<span class="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40 px-2 py-0.5 rounded-full text-[9px] font-bold">🟢 READY FOR PICKUP</span>`;
        } else if (status === 'picked_up' || status === 'delivered' || status === 'done' || order.isDone) {
            statusBadge = `<span class="bg-purple-100 dark:bg-purple-500/20 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-500/40 px-2 py-0.5 rounded-full text-[9px] font-bold">✅ DONE / PICKED UP</span>`;
        }

        const isDoneOrder = storeHubState.selectedOrdersTab === 'done' || status === 'done' || status === 'picked_up' || status === 'delivered' || order.isDone;

        let riderRadarHtml = '';
        if (riderId && storeHubState.ridersLocationMap[riderId] && storeHubState.currentStoreData) {
            const riderLoc = storeHubState.ridersLocationMap[riderId];
            const storeLat = parseFloat(storeHubState.currentStoreData.lat || 15.6881);
            const storeLng = parseFloat(storeHubState.currentStoreData.lng || 120.4144);
            const distKm = calculateDistanceInKm(riderLoc.lat, riderLoc.lng, storeLat, storeLng);

            if (distKm !== null) {
                const estMins = Math.max(1, Math.round(distKm * 2.5));
                riderRadarHtml = `
                    <div class="inline-flex items-center gap-1 text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30 px-2 py-0.5 rounded-full">
                        <i class="fa-solid fa-satellite-dish animate-pulse text-indigo-500"></i>
                        <span>Inbound: ${distKm.toFixed(1)} km (~${estMins}m away)</span>
                    </div>
                `;
            }
        }

        const itemsHtml = items.map((it, idx) => `
            <div class="flex justify-between items-center text-xs py-1 border-b border-gray-100 dark:border-gray-800/60 last:border-0">
                <div class="flex-1 min-w-0 pr-2">
                    <span class="text-gray-900 dark:text-white font-bold">
                        <span class="text-orange-500">${it.quantity}x</span> ${escapeHtml(it.name)}
                        ${it.size ? `<span class="text-[10px] text-gray-500 dark:text-gray-400 font-normal">(${escapeHtml(it.size.name || it.size)})</span>` : ''}
                    </span>
                    ${it.addons && it.addons.length > 0 ? `<div class="text-[9px] text-gray-500 dark:text-gray-400">+ ${it.addons.map(a => escapeHtml(a.name)).join(', ')}</div>` : ''}
                    ${it.instructions ? `<div class="text-[10px] text-amber-600 dark:text-amber-300 italic">Note: "${escapeHtml(it.instructions)}"</div>` : ''}
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <span class="text-gray-500 dark:text-gray-400 font-mono text-xs">₱${parseFloat(it.totalPrice || it.subtotal || 0).toFixed(2)}</span>
                    ${!isDoneOrder ? `
                        <button onclick="window.openSubstitutionModal('${orderIdClean}', ${idx}, '${escapeHtml(it.name)}', '${escapeHtml(order.customerName || 'Customer')}', '${escapeHtml(riderName)}')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 dark:bg-red-950/40 dark:hover:bg-red-900 dark:text-red-300 dark:border-red-700/40 px-1.5 py-0.5 rounded text-[9px] font-bold transition active:scale-95" title="Flag as Out of Stock & Request Substitution">
                            86 / Swap
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('');

        let actionControls = '';
        if (!isDoneOrder) {
            if (isPending) {
                actionControls = `
                <div class="flex flex-col gap-1.5 pt-2 border-t border-gray-200 dark:border-gray-800/80">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">Set Prep Time & Accept:</span>
                    <div class="grid grid-cols-4 gap-1.5">
                        <button onclick="window.acceptStoreOrderWithPrepTime('${orderIdClean}', 10)" class="bg-blue-600 hover:bg-blue-500 text-white font-black text-xs py-2 rounded-xl shadow-xs transition active:scale-95 flex items-center justify-center gap-1">
                            <i class="fa-solid fa-clock"></i> 10m
                        </button>
                        <button onclick="window.acceptStoreOrderWithPrepTime('${orderIdClean}', 15)" class="bg-blue-600 hover:bg-blue-500 text-white font-black text-xs py-2 rounded-xl shadow-xs transition active:scale-95 flex items-center justify-center gap-1">
                            <i class="fa-solid fa-clock"></i> 15m
                        </button>
                        <button onclick="window.acceptStoreOrderWithPrepTime('${orderIdClean}', 25)" class="bg-blue-600 hover:bg-blue-500 text-white font-black text-xs py-2 rounded-xl shadow-xs transition active:scale-95 flex items-center justify-center gap-1">
                            <i class="fa-solid fa-clock"></i> 25m
                        </button>
                        <button onclick="window.promptCustomPrepTime('${orderIdClean}')" class="bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-bold text-xs py-2 rounded-xl transition active:scale-95 flex items-center justify-center">
                            Custom
                        </button>
                    </div>
                </div>`;
            } else if (isPreparing) {
                actionControls = `
                <div class="flex items-center justify-between gap-2 pt-2 border-t border-gray-200 dark:border-gray-800/80">
                    <div id="prep-timer-${orderIdClean}" data-prep-until="${order.prepUntil || 0}" class="flex items-center gap-1.5 text-xs font-mono font-black text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 rounded-xl border border-blue-200 dark:border-blue-500/30">
                        <i class="fa-solid fa-stopwatch animate-pulse"></i> <span>Calculating...</span>
                    </div>
                    <button onclick="window.markStoreOrderReadyForPickup('${orderIdClean}')" class="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs py-2.5 px-3 rounded-xl shadow-md transition active:scale-95 flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-check-double"></i> Ready for Pickup
                    </button>
                </div>`;
            } else if (isReady) {
                actionControls = `
                <div class="flex items-center justify-between gap-2 pt-2 border-t border-gray-200 dark:border-gray-800/80">
                    <span class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <i class="fa-solid fa-circle-check"></i> Waiting for rider pickup
                    </span>
                    <button onclick="window.updateStoreOrderStatus('${orderIdClean}', 'picked_up')" class="bg-gray-800 hover:bg-gray-700 text-white font-bold text-xs py-2 px-3 rounded-xl transition active:scale-95 flex items-center gap-1">
                        <i class="fa-solid fa-box-archive"></i> Mark Done
                    </button>
                </div>`;
            }
        }

        return `
        <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 rounded-2xl p-3 flex flex-col gap-2.5 shadow-xs">
            <div class="flex justify-between items-start">
                <div>
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="font-mono text-xs font-black text-gray-900 dark:text-white">#${escapeHtml(orderIdClean)}</span>
                        ${statusBadge}
                        ${riderRadarHtml}
                    </div>
                    <div class="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                        👤 Customer: <span class="text-gray-900 dark:text-white font-bold">${escapeHtml(order.customerName || 'Customer')}</span>
                    </div>
                    <div class="text-[10px] text-gray-500 dark:text-gray-400">
                        🛵 Rider: <span class="text-blue-600 dark:text-blue-400 font-bold">${escapeHtml(riderName)}</span>
                    </div>
                </div>

                <div class="flex items-center gap-1.5 shrink-0">
                    <span class="text-[9px] text-gray-400 font-mono">${orderTime}</span>
                    
                    <button onclick="window.printStoreOrderSlip('${orderIdClean}')" class="bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 dark:border-gray-700 dark:text-gray-300 px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition active:scale-95 flex items-center gap-1" title="Print Kitchen Packing Slip">
                        <i class="fa-solid fa-print"></i> Slip
                    </button>

                    <button onclick="window.openStoreRiderChatModal('${orderIdClean}', '${riderId}', '${escapeHtml(riderName)}')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-600/30 dark:hover:bg-blue-600 dark:border-blue-500/50 dark:text-blue-300 dark:hover:text-white px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition active:scale-95 flex items-center gap-1">
                        <i class="fa-solid fa-comments"></i> Chat
                    </button>
                </div>
            </div>

            <div class="bg-gray-50 dark:bg-darkBg/60 border border-gray-200 dark:border-gray-800/80 p-2.5 rounded-xl flex flex-col gap-1">
                ${itemsHtml}
                <div class="flex justify-between items-center pt-1.5 border-t border-gray-200 dark:border-gray-800/80 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <span>Store Total:</span>
                    <span class="font-mono">₱${parseFloat(order.totalAmount || 0).toFixed(2)}</span>
                </div>
            </div>

            ${actionControls}
        </div>`;
    }).join('');

    updateLiveCountdownTimers();
}