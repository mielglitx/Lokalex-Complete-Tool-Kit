// src/features/storeHub/ui/storeOrdersKDS.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { showToast, showSideNotification } from '../../../ui/notifications.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { 
    storeHubState, 
    cleanFirebasePathKey, 
    sanitizeForFirebase, 
    calculateDistanceInKm 
} from './storeHubState.js';
import { 
    stopRepeatingKitchenAlarm 
} from './storeAudio.js';

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

export function generateThermalPackingSlipText(order) {
    const storeName = (storeHubState.currentStoreData?.storeName || appState.merchantStoreName || "STORE HUB").toUpperCase();
    const orderIdClean = cleanFirebasePathKey(order.orderId || order.id);
    const custName = (order.customerName || "Customer").toUpperCase();
    const riderName = (order.riderName || "Unassigned").toUpperCase();
    const dateStr = order.timestamp ? new Date(order.timestamp).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : new Date().toLocaleString();

    let text = `================================\n`;
    text += `       ${storeName}\n`;
    text += `     KITCHEN PACKING SLIP\n`;
    text += `================================\n`;
    text += `ORDER: #${orderIdClean}\n`;
    text += `DATE : ${dateStr}\n`;
    text += `CUST : ${custName}\n`;
    text += `RIDER: ${riderName}\n`;
    text += `--------------------------------\n`;
    text += `QTY  ITEM                 PRICE\n`;
    text += `--------------------------------\n`;

    (order.items || []).forEach(it => {
        const qty = `${it.quantity || 1}x`.padEnd(5);
        const name = (it.name || 'Item').slice(0, 18).padEnd(18);
        const price = `₱${(parseFloat(it.totalPrice || it.subtotal || 0)).toFixed(2)}`.padStart(9);
        text += `${qty}${name}${price}\n`;

        if (it.size && it.size.name) {
            text += `  > Size: ${it.size.name}\n`;
        }
        if (it.addons && it.addons.length > 0) {
            text += `  > Extras: ${it.addons.map(a => a.name).join(', ')}\n`;
        }
        if (it.instructions) {
            text += `  * NOTE: "${it.instructions}"\n`;
        }
    });

    text += `--------------------------------\n`;
    text += `TOTAL ITEMS AMOUNT: ₱${parseFloat(order.totalAmount || 0).toFixed(2)}\n`;
    text += `================================\n`;
    text += `     LOKALEX DELIVERY HUB\n\n\n`;

    return text;
}

export function printStoreOrderSlip(orderId) {
    const cleanOrderId = cleanFirebasePathKey(orderId);
    const order = storeHubState.currentOrdersData[cleanOrderId] || Object.values(storeHubState.currentOrdersData).find(o => cleanFirebasePathKey(o.orderId || o.id) === cleanOrderId);

    if (!order) {
        return showToast("⚠️ Order data not found for printing.");
    }

    const storeName = storeHubState.currentStoreData?.storeName || appState.merchantStoreName || "Store Hub";
    const custName = order.customerName || "Customer";
    const riderName = order.riderName || "Unassigned Rider";
    const dateStr = order.timestamp ? new Date(order.timestamp).toLocaleString() : new Date().toLocaleString();
    const totalAmount = parseFloat(order.totalAmount || 0).toFixed(2);

    const itemsRows = (order.items || []).map(it => {
        let details = [];
        if (it.size && it.size.name) details.push(`Size: ${escapeHtml(it.size.name)}`);
        if (it.addons && it.addons.length > 0) details.push(`Addons: ${it.addons.map(a => escapeHtml(a.name)).join(', ')}`);
        if (it.instructions) details.push(`<strong>NOTE: "${escapeHtml(it.instructions)}"</strong>`);

        return `
            <tr>
                <td style="vertical-align: top; font-weight: bold; width: 25px;">${it.quantity || 1}x</td>
                <td style="vertical-align: top;">
                    <div>${escapeHtml(it.name || 'Item')}</div>
                    ${details.length > 0 ? `<div style="font-size: 10px; margin-top: 2px;">${details.join('<br>')}</div>` : ''}
                </td>
                <td style="vertical-align: top; text-align: right; font-family: monospace;">₱${(parseFloat(it.totalPrice || it.subtotal || 0)).toFixed(2)}</td>
            </tr>
        `;
    }).join('');

    const printWindow = window.open('', '_blank', 'width=380,height=550');
    if (!printWindow) {
        return showToast("⚠️ Pop-up blocked! Please allow pop-ups to print slips.");
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Slip #${cleanOrderId}</title>
            <style>
                @page { size: auto; margin: 0mm; }
                body {
                    font-family: 'Courier New', Courier, monospace;
                    width: 58mm;
                    max-width: 80mm;
                    margin: 0 auto;
                    padding: 8px;
                    color: #000;
                    background: #fff;
                    font-size: 11px;
                    line-height: 1.25;
                }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .bold { font-weight: bold; }
                .divider { border-top: 1px dashed #000; margin: 6px 0; }
                .double-divider { border-top: 2px solid #000; margin: 6px 0; }
                table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 4px 0; }
                @media print {
                    body { width: 100%; margin: 0; padding: 4px; }
                }
            </style>
        </head>
        <body>
            <div class="text-center bold" style="font-size: 14px;">${escapeHtml(storeName)}</div>
            <div class="text-center bold" style="font-size: 10px; margin-bottom: 4px;">KITCHEN PACKING SLIP</div>
            <div class="double-divider"></div>
            <div><strong>ORDER #:</strong> ${cleanOrderId}</div>
            <div><strong>DATE   :</strong> ${dateStr}</div>
            <div><strong>CUST   :</strong> ${escapeHtml(custName)}</div>
            <div><strong>RIDER  :</strong> ${escapeHtml(riderName)}</div>
            <div class="divider"></div>
            <table>
                <thead>
                    <tr style="border-bottom: 1px dashed #000;">
                        <th style="text-align: left;">QTY</th>
                        <th style="text-align: left;">ITEM</th>
                        <th style="text-align: right;">PRICE</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsRows}
                </tbody>
            </table>
            <div class="divider"></div>
            <div class="text-right bold" style="font-size: 12px;">
                TOTAL: ₱${totalAmount}
            </div>
            <div class="double-divider"></div>
            <div class="text-center" style="font-size: 9px; margin-top: 6px;">LOKALEX DELIVERY HUB</div>
            <script>
                window.onload = function() {
                    window.focus();
                    window.print();
                    setTimeout(function() { window.close(); }, 500);
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

export async function printStoreOrderBluetooth(orderId) {
    if (!navigator.bluetooth) {
        return showToast("⚠️ Web Bluetooth is not supported on this browser. Opening print window...");
    }

    const cleanOrderId = cleanFirebasePathKey(orderId);
    const order = storeHubState.currentOrdersData[cleanOrderId] || Object.values(storeHubState.currentOrdersData).find(o => cleanFirebasePathKey(o.orderId || o.id) === cleanOrderId);

    if (!order) return showToast("⚠️ Order data not found.");

    showToast("📡 Connecting to Bluetooth Printer...");

    try {
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
            optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455']
        });

        const server = await device.gatt.connect();
        const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
        const characteristics = await service.getCharacteristics();
        const writeChar = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);

        if (!writeChar) throw new Error("Writable Bluetooth characteristic not found.");

        const slipText = generateThermalPackingSlipText(order);
        const encoder = new TextEncoder();
        
        const initCmd = new Uint8Array([0x1B, 0x40]);
        const cutCmd = new Uint8Array([0x1D, 0x56, 0x00]);
        const dataBytes = encoder.encode(slipText);

        await writeChar.writeValue(initCmd);
        
        const chunkSize = 128;
        for (let i = 0; i < dataBytes.length; i += chunkSize) {
            const chunk = dataBytes.slice(i, i + chunkSize);
            await writeChar.writeValue(chunk);
        }

        await writeChar.writeValue(cutCmd);
        showToast("✅ Printed to Bluetooth thermal printer!");
    } catch(err) {
        console.warn("Bluetooth Print failed:", err);
        showToast("⚠️ Bluetooth pairing cancelled or failed. Using standard print dialog.");
        printStoreOrderSlip(orderId);
    }
}

export function updateLiveCountdownTimers() {
    const timerElements = document.querySelectorAll('[id^="prep-timer-"]');
    const now = Date.now();

    timerElements.forEach(el => {
        const prepUntil = parseInt(el.getAttribute('data-prep-until') || 0);
        if (!prepUntil || prepUntil <= 0) return;

        const diffMs = prepUntil - now;
        if (diffMs > 0) {
            const totalSecs = Math.floor(diffMs / 1000);
            const mins = Math.floor(totalSecs / 60);
            const secs = totalSecs % 60;
            const formattedTime = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
            el.innerHTML = `<i class="fa-solid fa-stopwatch animate-pulse"></i> <span>Prep: ${formattedTime}</span>`;
            el.className = "flex items-center gap-1.5 text-xs font-mono font-black text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 rounded-xl border border-blue-200 dark:border-blue-500/30";
        } else {
            const overdueSecs = Math.floor(Math.abs(diffMs) / 1000);
            const mins = Math.floor(overdueSecs / 60);
            const secs = overdueSecs % 60;
            const formattedTime = `+${mins}:${secs < 10 ? '0' : ''}${secs}`;
            el.innerHTML = `<i class="fa-solid fa-triangle-exclamation animate-bounce text-red-500"></i> <span class="text-red-600 dark:text-red-400">Overdue: ${formattedTime}</span>`;
            el.className = "flex items-center gap-1.5 text-xs font-mono font-black text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-3 py-2 rounded-xl border border-red-300 dark:border-red-500/40 animate-pulse";
        }
    });
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

export async function acceptStoreOrderWithPrepTime(orderId, prepMinutes) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(orderId);

    if (!storeId || !cleanOrderId || !db) return;

    storeHubState.acknowledgedOrders.add(cleanOrderId);
    stopRepeatingKitchenAlarm();

    const now = Date.now();
    const prepUntil = now + (parseInt(prepMinutes) * 60000);

    try {
        await db.ref(`storeOrders/${storeId}/${cleanOrderId}`).update({
            status: 'preparing',
            prepMinutes: parseInt(prepMinutes),
            prepUntil: prepUntil,
            acceptedAt: now,
            updatedAt: now
        });

        await db.ref(`orders/${cleanOrderId}`).update({
            status: 'preparing',
            prepUntil: prepUntil,
            [`milestones/preparing`]: {
                timestamp: now,
                updatedBy: 'Merchant Kitchen',
                prepMinutes: parseInt(prepMinutes)
            }
        }).catch(() => {});

        const storeName = appState.merchantStoreName || "Store";
        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}/messages`).push(sanitizeForFirebase({
            sender: 'store',
            senderType: 'store',
            senderName: storeName,
            text: `⏳ Order accepted! Kitchen is preparing the order (~${prepMinutes} mins estimated).`,
            timestamp: now
        })).catch(() => {});

        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}`).update(sanitizeForFirebase({
            lastMessage: `⏳ Preparing (~${prepMinutes}m)`,
            lastTimestamp: now,
            unreadForRider: true
        })).catch(() => {});

        showToast(`🍳 Order accepted! Prep timer set to ${prepMinutes} mins.`);
        showSideNotification("ORDER ACCEPTED", `Kitchen set to ${prepMinutes}m prep for #${cleanOrderId}`, "fa-kitchen-set", "text-blue-400", "border-blue-500");
    } catch(e) {
        showToast("❌ Failed to accept order.");
    }
}

export function promptCustomPrepTime(orderId) {
    const customTime = prompt("Enter preparation time in minutes (e.g. 20):", "20");
    const parsed = parseInt(customTime);
    if (!isNaN(parsed) && parsed > 0) {
        acceptStoreOrderWithPrepTime(orderId, parsed);
    }
}

export async function markStoreOrderReadyForPickup(orderId) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(orderId);

    if (!storeId || !cleanOrderId || !db) return;

    const now = Date.now();

    try {
        await db.ref(`storeOrders/${storeId}/${cleanOrderId}`).update({
            status: 'ready',
            readyAt: now,
            updatedAt: now
        });

        await db.ref(`orders/${cleanOrderId}`).update({
            status: 'ready_for_pickup',
            [`milestones/ready_for_pickup`]: {
                timestamp: now,
                updatedBy: 'Merchant Kitchen'
            }
        }).catch(() => {});

        const storeName = appState.merchantStoreName || "Store";
        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}/messages`).push(sanitizeForFirebase({
            sender: 'store',
            senderType: 'store',
            senderName: storeName,
            text: `✅ Order is packed and READY for pickup!`,
            timestamp: now
        })).catch(() => {});

        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}`).update(sanitizeForFirebase({
            lastMessage: `✅ READY FOR PICKUP!`,
            lastTimestamp: now,
            unreadForRider: true
        })).catch(() => {});

        showToast("✅ Order marked Ready for Pickup! Rider notified.");
        showSideNotification("READY FOR PICKUP", `Order #${cleanOrderId} is ready!`, "fa-check-double", "text-emerald-400", "border-emerald-500");
    } catch(e) {
        showToast("❌ Failed to mark order ready.");
    }
}

export async function updateStoreOrderStatus(orderId, newStatus) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(orderId);

    if (!storeId || !cleanOrderId || !db) return;

    try {
        const updatePayload = {
            status: newStatus,
            updatedAt: Date.now()
        };

        if (newStatus === 'done' || newStatus === 'picked_up' || newStatus === 'completed') {
            updatePayload.isDone = true;
        }

        await db.ref(`storeOrders/${storeId}/${cleanOrderId}`).update(updatePayload);

        await db.ref(`orders/${cleanOrderId}/stores/${storeId}`).update({
            status: newStatus,
            updatedAt: Date.now()
        }).catch(() => {});

        showToast(`✅ Order marked as ${newStatus.toUpperCase()}`);
    } catch(e) {
        showToast("❌ Failed to update order status.");
    }
}

export function openSubstitutionModal(orderId, itemIdx, itemName, customerName, riderName) {
    storeHubState.activeSubstitutionTarget = { orderId, itemIdx, itemName, customerName, riderName };

    let modal = document.getElementById('item-substitution-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'item-substitution-modal';
        modal.className = 'fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-white dark:bg-cardBg border border-red-500/40 w-full max-w-sm rounded-3xl p-5 shadow-2xl flex flex-col gap-3.5">
                <div class="flex justify-between items-center border-b border-gray-200 dark:border-gray-800 pb-2.5">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center text-sm font-bold">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                        </div>
                        <div>
                            <h3 class="text-sm font-black text-gray-900 dark:text-white">Item Substitution (86)</h3>
                            <p class="text-[10px] text-gray-500 dark:text-gray-400">Unavailable dish resolution</p>
                        </div>
                    </div>
                    <button onclick="window.closeSubstitutionModal && window.closeSubstitutionModal()" class="text-gray-400 hover:text-gray-700 dark:hover:text-white p-1 text-sm transition">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="flex flex-col gap-2 text-xs">
                    <div class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 p-2.5 rounded-2xl">
                        <div class="text-[10px] text-red-600 dark:text-red-400 font-bold uppercase">Unavailable Item:</div>
                        <div id="sub-item-name-display" class="font-black text-gray-900 dark:text-white text-xs mt-0.5">Item Name</div>
                    </div>

                    <div>
                        <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase">Suggested Replacement / Alternative *</label>
                        <input type="text" id="sub-replacement-input" placeholder="e.g. Taro Milk Tea / Large Size without pearls" class="w-full bg-inputBg text-xs rounded-xl p-3 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white font-bold mt-1">
                    </div>

                    <div>
                        <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase">Notes for Rider & Customer</label>
                        <textarea id="sub-notes-input" rows="2" placeholder="e.g. Naubusan po ng brown sugar pearls, pwede po bang nata de coco?" class="w-full bg-inputBg text-xs rounded-xl p-2.5 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white mt-1"></textarea>
                    </div>

                    <button id="sub-submit-btn" onclick="window.submitItemSubstitution && window.submitItemSubstitution()" class="w-full bg-red-600 hover:bg-red-500 text-white font-black py-3 rounded-xl shadow-md transition active:scale-95 flex items-center justify-center gap-1.5 mt-1">
                        <i class="fa-solid fa-paper-plane"></i> DISPATCH SUBSTITUTION REQUEST
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    const displayEl = document.getElementById('sub-item-name-display');
    const replaceInput = document.getElementById('sub-replacement-input');
    const notesInput = document.getElementById('sub-notes-input');

    if (displayEl) displayEl.innerText = itemName;
    if (replaceInput) replaceInput.value = '';
    if (notesInput) notesInput.value = '';

    modal.classList.remove('hidden');
}

export function closeSubstitutionModal() {
    const modal = document.getElementById('item-substitution-modal');
    if (modal) modal.classList.add('hidden');
    storeHubState.activeSubstitutionTarget = null;
}

export async function submitItemSubstitution() {
    if (!storeHubState.activeSubstitutionTarget) return;

    const { orderId, itemIdx, itemName, customerName, riderName } = storeHubState.activeSubstitutionTarget;
    const replacement = document.getElementById('sub-replacement-input')?.value.trim();
    const notes = document.getElementById('sub-notes-input')?.value.trim();

    if (!replacement) {
        return showToast("⚠️ Paki-lagay ang iminumungkahing kapalit o alternatibo!");
    }

    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const storeName = appState.merchantStoreName || "Store";
    const now = Date.now();

    closeSubstitutionModal();

    const alertMessage = `⚠️ [OUT OF STOCK / SUBSTITUTION REQUIRED]\n• Item: ${itemName}\n• Suggested Replacement: ${replacement}${notes ? `\n• Kitchen Note: "${notes}"` : ''}\n\nPaki-kumpirma po kay customer kung pumapayag sa kapalit. Salamat!`;

    try {
        if (db && orderId && storeId) {
            await db.ref(`storeRiderChats/${orderId}_${storeId}/messages`).push(sanitizeForFirebase({
                sender: 'store',
                senderType: 'store',
                senderName: storeName,
                text: alertMessage,
                timestamp: now
            }));

            await db.ref(`storeRiderChats/${orderId}_${storeId}`).update(sanitizeForFirebase({
                lastMessage: `⚠️ Substitution Alert: ${itemName}`,
                lastTimestamp: now,
                unreadForRider: true
            }));

            await db.ref(`storeOrders/${storeId}/${orderId}`).update({
                substitutionAlert: {
                    itemIndex: itemIdx,
                    itemName,
                    replacement,
                    notes: notes || "",
                    timestamp: now
                }
            });
        }

        showToast("⚠️ Substitution alert sent to rider!");
        showSideNotification("SUBSTITUTION ALERT", `Item: ${itemName} -> ${replacement}`, "fa-triangle-exclamation", "text-red-400", "border-red-500");
    } catch(e) {
        showToast("❌ Failed to dispatch substitution alert.");
    }
}