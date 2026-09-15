// src/features/storeHub/ui/storeOrdersPrint.js
import { appState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { storeHubState, cleanFirebasePathKey } from './storeHubState.js';

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