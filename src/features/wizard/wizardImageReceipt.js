// src/features/wizard/wizardImageReceipt.js
import { appState, wizState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { getCurrentCart } from '../cart.js';
import { getDailyRiderId } from './wizardCalc.js';
import { getDevicePlatform } from '../../utils/helpers.js';

export let currentReceiptCanvas = null;
export let currentReceiptDataUrl = "";

export function toTitleCase(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .toLowerCase()
        .split(' ')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

export function ensureQrCodeLibraryLoaded() {
    return new Promise((resolve) => {
        if (window.QRCode) return resolve(true);

        const existingScript = document.querySelector('script[src*="qrcode"]');
        if (existingScript) {
            existingScript.addEventListener('load', () => resolve(true));
            setTimeout(() => resolve(!!window.QRCode), 1500);
            return;
        }

        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js";
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
    });
}

export async function generatePureQrImage(payload, size = 600) {
    if (!payload) return null;
    await ensureQrCodeLibraryLoaded();

    return new Promise((resolve) => {
        if (!window.QRCode) return resolve(null);

        const tempCanvas = document.createElement('canvas');
        window.QRCode.toCanvas(tempCanvas, payload, {
            width: size,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        }, (err) => {
            if (err) {
                console.warn("QRCode canvas error:", err);
                return resolve(null);
            }

            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = tempCanvas.toDataURL('image/png');
        });
    });
}

export function loadImageAsync(src) {
    return new Promise((resolve) => {
        if (!src) return resolve(null);
        const img = new Image();

        // Only set crossOrigin for external http(s) URLs.
        // Relative and local origin files in public/ must not have crossOrigin set,
        // or local static hosts / GitHub Pages / Service Workers will block with CORS.
        const isExternal = /^https?:\/\//i.test(src) && !src.startsWith(window.location.origin);
        if (isExternal) {
            img.crossOrigin = "anonymous";
        }

        img.onload = () => resolve(img);
        img.onerror = (e) => {
            console.warn("Image load failed for:", src, e);
            resolve(null);
        };
        img.src = src;
    });
}

export async function renderReceiptCanvas() {
    const loadingEl = document.getElementById('receipt-image-loading');
    const previewWrapper = document.getElementById('receipt-image-preview-wrapper');
    const receiptImg = document.getElementById('final-receipt-img');

    if (loadingEl) loadingEl.classList.remove('hidden');
    if (previewWrapper) previewWrapper.classList.add('hidden');

    localStorage.removeItem('lokalex_gcash_qr');
    delete appState.gcashQrUrl;

    const currentCart = (getCurrentCart() || []).filter(item => !item.isUnavailable);
    const dailyRiderId = getDailyRiderId();
    const rawCustomerName = document.getElementById('rcpt-name')?.value.trim() || appState.selectedCateringClient || "Sample";
    const rawRiderName = appState.riderName || localStorage.getItem('riderName') || "Amiel Yalung";

    const customerName = toTitleCase(rawCustomerName);
    const riderName = toTitleCase(rawRiderName);

    const dateStr = new Date().toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const subtotal = Math.max(0, wizState.subtotal || 0);
    const finalHFee = wizState.finalHFee || 0;
    const finalMFee = wizState.finalMFee || 0;
    const finalMulti = wizState.finalMulti || 0;
    const deliveryFee = wizState.deliveryFee || 0;
    const discount = wizState.discount || 0;

    const codTotal = Math.max(0, wizState.codTotal || wizState.finalTotal || 0);
    const epayFee = wizState.finalEpay || (codTotal <= 1000 ? 15 : 15 + Math.ceil((codTotal - 1000) / 500) * 5);
    const gcashTotal = codTotal + epayFee;

    const rawGcashName = appState.gcashName || localStorage.getItem('lokalex_gcash_name') || riderName;
    const gcashName = toTitleCase(rawGcashName);
    const gcashNo = appState.gcashNo || localStorage.getItem('lokalex_gcash_no') || "09120600138";
    const gcashQrPayload = appState.gcashQrPayload || localStorage.getItem('lokalex_gcash_qr_payload') || "";
    const gcashQrImg = appState.gcashQrImg || localStorage.getItem('lokalex_gcash_qr_img') || "";

    // Resolve Vite Base URL for GitHub Pages compatibility
    const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL)
        ? import.meta.env.BASE_URL
        : '/';
    const cleanBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

    const logoCandidates = [
        `${cleanBase}Logo.jpg`,
        `${cleanBase}logo.jpg`,
        `${cleanBase}Logo.png`,
        `${cleanBase}logo.png`,
        './Logo.jpg',
        './logo.jpg',
        '/Logo.jpg',
        '/logo.jpg',
        'Logo.jpg',
        'logo.jpg'
    ];

    let logoImg = null;
    for (const path of logoCandidates) {
        logoImg = await loadImageAsync(path);
        if (logoImg) break;
    }

    // Preload Ultra-HD Vector QR Code
    let preloadedQrImage = null;
    if (gcashQrPayload) {
        try {
            preloadedQrImage = await generatePureQrImage(gcashQrPayload, 600);
        } catch (e) {
            console.warn("Generating QR failed:", e);
        }
    }
    if (!preloadedQrImage && gcashQrImg) {
        try {
            preloadedQrImage = await loadImageAsync(gcashQrImg);
        } catch (e) {
            console.warn("Loading uploaded QR failed:", e);
        }
    }

    const hasQrDrawn = !!preloadedQrImage;
    const hasGcashDetails = !!(gcashName || gcashNo || hasQrDrawn);

    // Canvas Layout Dimensions
    const width = 460;
    let estimatedHeight = 220; // Top padding, logo, and header
    estimatedHeight += 95;      // Metadata box
    estimatedHeight += 35;      // Items header

    // Items list
    estimatedHeight += Math.max(1, currentCart.length) * 20;

    // Subtotal and active fee lines
    let feeLinesCount = 1; // Items Subtotal
    if (finalHFee > 0) feeLinesCount++;
    if (finalMFee > 0) feeLinesCount++;
    if (finalMulti > 0) feeLinesCount++;
    if (deliveryFee > 0) feeLinesCount++;
    if (discount > 0) feeLinesCount++;
    estimatedHeight += (feeLinesCount * 20) + 20;

    // Badges
    estimatedHeight += 44; // COD Total Box
    estimatedHeight += 52; // GCash Box

    // QR & GCash section
    if (hasGcashDetails) {
        estimatedHeight += (hasQrDrawn ? 285 : 70);
    }

    // Footer
    estimatedHeight += 70;

    // 3x Ultra-HD Resolution scale factor for 300+ DPI QR scanning accuracy
    const scaleFactor = 3;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scaleFactor);
    canvas.height = Math.round(estimatedHeight * scaleFactor);

    const ctx = canvas.getContext('2d');
    ctx.scale(scaleFactor, scaleFactor);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Thermal Paper Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, estimatedHeight);

    let y = 24;

    // 1. Centered Circular Logo
    const logoSize = 100;
    if (logoImg) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(width / 2, y + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(logoImg, (width - logoSize) / 2, y, logoSize, logoSize);
        ctx.restore();
        y += logoSize + 16;
    } else {
        y += 10;
    }

    // 2. Header Text
    ctx.fillStyle = "#000000";
    ctx.font = "900 19px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("LOKALEX DELIVERY HUB", width / 2, y);

    y += 20;
    ctx.fillStyle = "#111827";
    ctx.font = "800 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("OFFICIAL DELIVERY RECEIPT", width / 2, y);

    y += 24;

    // 3. Receipt Metadata Section
    const leftMargin = 28;
    const rightMargin = width - 28;
    const metaFont = "600 12.5px 'SF Mono', Consolas, 'Courier New', monospace";
    ctx.font = metaFont;
    ctx.fillStyle = "#111827";
    ctx.textAlign = "left";

    const labelColX = leftMargin;
    const valueColX = leftMargin + 85;

    ctx.fillText("Customer:", labelColX, y);
    ctx.fillText(customerName, valueColX, y);
    y += 18;

    ctx.fillText("Date:", labelColX, y);
    ctx.fillText(dateStr, valueColX, y);
    y += 18;

    ctx.fillText("Rider:", labelColX, y);
    ctx.fillText(`${riderName} (${dailyRiderId})`, valueColX, y);
    y += 18;

    const rawTxId = wizState.currentReceiptTransactionId || `E37FG-${Date.now().toString(36).toUpperCase()}`;
    const cleanRefId = rawTxId.replace(/^RCPT_/, '');
    ctx.fillText("Ref #:", labelColX, y);
    ctx.fillText(`#${cleanRefId}`, valueColX, y);
    y += 18;

    // Helper: Draw Dashed Divider Line
    const drawDashedDivider = (currY) => {
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(leftMargin, currY);
        ctx.lineTo(rightMargin, currY);
        ctx.stroke();
        ctx.setLineDash([]);
    };

    drawDashedDivider(y);
    y += 16;

    // 4. Item Table Headers
    ctx.font = "800 12px 'SF Mono', Consolas, 'Courier New', monospace";
    ctx.fillStyle = "#000000";
    ctx.textAlign = "left";
    ctx.fillText("ITEM DESCRIPTION", leftMargin, y);
    ctx.textAlign = "right";
    ctx.fillText("TOTAL", rightMargin, y);

    y += 16;

    // 5. Items List
    ctx.font = "600 12px 'SF Mono', Consolas, 'Courier New', monospace";
    ctx.fillStyle = "#111827";

    if (currentCart.length === 0) {
        ctx.textAlign = "center";
        ctx.fillText("(No items listed)", width / 2, y);
        y += 18;
    } else {
        currentCart.forEach(item => {
            const isPaid = !!item.isPaid;
            const priceNum = Math.max(0, parseFloat(item.price) || 0);
            const itemName = toTitleCase(item.name || 'Item');

            const leftText = isPaid ? `${itemName} - PAID (P0.00)` : `${itemName} - P${priceNum.toFixed(2)}`;
            const rightText = isPaid ? "PAID" : `P${priceNum.toFixed(2)}`;

            ctx.textAlign = "left";
            ctx.fillText(leftText, leftMargin, y);

            ctx.textAlign = "right";
            ctx.fillText(rightText, rightMargin, y);

            y += 18;
        });
    }

    y += 2;
    drawDashedDivider(y);
    y += 16;

    // 6. Subtotal & Fee Breakdown
    const drawBreakdownRow = (label, amount, isDeduction = false) => {
        ctx.textAlign = "left";
        ctx.font = "600 12px 'SF Mono', Consolas, 'Courier New', monospace";
        ctx.fillStyle = isDeduction ? "#b91c1c" : "#111827";
        ctx.fillText(label, leftMargin, y);

        ctx.textAlign = "right";
        ctx.fillText(`${isDeduction ? '-' : ''}P${amount.toFixed(2)}`, rightMargin, y);
        y += 18;
    };

    drawBreakdownRow("ITEMS SUBTOTAL", subtotal);
    if (finalHFee > 0) drawBreakdownRow("Handling Fee", finalHFee);
    if (finalMFee > 0) drawBreakdownRow("Market Fee", finalMFee);
    if (finalMulti > 0) drawBreakdownRow("Multistore Fee", finalMulti);
    if (deliveryFee > 0) drawBreakdownRow("Delivery Fee", deliveryFee);
    if (discount > 0) drawBreakdownRow("Discount", discount, true);

    y += 6;

    // 7. COD Total Box (Rounded Green Border)
    const boxWidth = width - (leftMargin * 2);
    ctx.save();
    ctx.strokeStyle = "#16a34a";
    ctx.lineWidth = 1.6;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(leftMargin, y, boxWidth, 34, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#15803d";
    ctx.font = "800 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("COD TOTAL (CASH TO COLLECT)", leftMargin + 10, y + 21);

    ctx.font = "800 14.5px 'SF Mono', Consolas, 'Courier New', monospace";
    ctx.textAlign = "right";
    ctx.fillText(`P${codTotal.toFixed(2)}`, rightMargin - 10, y + 21);
    ctx.restore();

    y += 42;

    // 8. GCash Payment Box (Rounded Light Green Tint)
    ctx.save();
    ctx.strokeStyle = "#86efac";
    ctx.lineWidth = 1.4;
    ctx.fillStyle = "#f0fdf4";
    ctx.beginPath();
    ctx.roundRect(leftMargin, y, boxWidth, 42, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#166534";
    ctx.textAlign = "left";
    ctx.font = "800 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("GCASH PAYMENT", leftMargin + 10, y + 19);

    ctx.font = "700 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(`(+P${epayFee.toFixed(2)} Transfer Fee)`, leftMargin + 10, y + 33);

    ctx.textAlign = "right";
    ctx.font = "800 14.5px 'SF Mono', Consolas, 'Courier New', monospace";
    ctx.fillText(`P${gcashTotal.toFixed(2)}`, rightMargin - 10, y + 26);
    ctx.restore();

    y += 56;

    // 9. Scan To Pay Via GCash & High-Scannability QR Code
    if (hasGcashDetails) {
        ctx.fillStyle = "#111827";
        ctx.textAlign = "center";
        ctx.font = "800 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText("SCAN TO PAY VIA GCASH", width / 2, y);
        y += 17;

        ctx.font = "600 11.5px 'SF Mono', Consolas, 'Courier New', monospace";
        ctx.fillText(`Account Name: ${gcashName || riderName}`, width / 2, y);
        y += 16;
        ctx.fillText(`Mobile Number: ${gcashNo || '09120600138'}`, width / 2, y);
        y += 16;

        if (hasQrDrawn) {
            const qrDisplaySize = 176;
            const qrX = Math.round((width - qrDisplaySize) / 2);
            const quietPadding = 10;

            // Dedicated Quiet-Zone Backing with high-contrast border
            ctx.save();
            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = "#cbd5e1";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(
                qrX - quietPadding, 
                y - quietPadding, 
                qrDisplaySize + (quietPadding * 2), 
                qrDisplaySize + (quietPadding * 2), 
                12
            );
            ctx.fill();
            ctx.stroke();

            // Disable smoothing specifically for QR rendering to ensure razor-sharp module edges
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(preloadedQrImage, qrX, y, qrDisplaySize, qrDisplaySize);
            ctx.restore();

            y += qrDisplaySize + 22;
        } else {
            y += 10;
        }
    }

    // 10. Receipt Footer
    ctx.fillStyle = "#111827";
    ctx.textAlign = "center";
    ctx.font = "600 11.5px 'SF Mono', Consolas, 'Courier New', monospace";
    ctx.fillText("Salamat sa pagtitiwala sa Lokalex!", width / 2, y);
    y += 16;

    ctx.font = "500 10.5px 'SF Mono', Consolas, 'Courier New', monospace";
    ctx.fillText("Lokalex Logistics • On-Demand Express Delivery", width / 2, y);

    currentReceiptCanvas = canvas;
    currentReceiptDataUrl = canvas.toDataURL('image/png');

    if (receiptImg) {
        receiptImg.src = currentReceiptDataUrl;
    }
    if (loadingEl) loadingEl.classList.add('hidden');
    if (previewWrapper) previewWrapper.classList.remove('hidden');
}

function triggerDirectAnchorDownload(url, fileName) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("💾 High Definition receipt saved to device!");
}

export async function downloadReceiptImage() {
    if (!currentReceiptDataUrl && !currentReceiptCanvas) {
        return showToast("⚠️ Image receipt not ready yet.");
    }

    const txId = wizState.currentReceiptTransactionId || Date.now().toString(36);
    const fileName = `Lokalex_Receipt_${txId}.png`;
    const platform = getDevicePlatform();

    if (platform === 'android' || platform === 'pc') {
        if (currentReceiptCanvas && typeof currentReceiptCanvas.toBlob === 'function') {
            currentReceiptCanvas.toBlob((blob) => {
                if (!blob) {
                    triggerDirectAnchorDownload(currentReceiptDataUrl, fileName);
                    return;
                }
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
                showToast("💾 High Definition receipt saved to device!");
            }, 'image/png');
            return;
        }

        triggerDirectAnchorDownload(currentReceiptDataUrl, fileName);
        return;
    }

    if (navigator.canShare && currentReceiptCanvas) {
        try {
            const blob = await new Promise(resolve => currentReceiptCanvas.toBlob(resolve, 'image/png'));
            if (blob) {
                const file = new File([blob], fileName, { type: 'image/png' });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Lokalex Receipt',
                        text: `Official Receipt #${txId}`
                    });
                    showToast("✅ Resibo naibahagi / nai-save!");
                    return;
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.warn("Native Web Share failed, attempting fallback:", err);
        }
    }

    if (window.openImageViewerModal && typeof window.openImageViewerModal === 'function') {
        window.openImageViewerModal(currentReceiptDataUrl);
        showToast("ℹ️ Pindutin nang matagal ang resibo at piliin ang 'Save to Photos'.");
        return;
    }

    const newTab = window.open();
    if (newTab) {
        newTab.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${fileName}</title>
                <style>
                    body { margin: 0; background-color: #0f172a; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; box-sizing: border-box; font-family: -apple-system, sans-serif; }
                    img { max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
                    p { color: #94a3b8; font-size: 13px; margin-top: 16px; text-align: center; }
                    strong { color: #38bdf8; }
                </style>
            </head>
            <body>
                <img src="${currentReceiptDataUrl}" alt="Receipt">
                <p>Pindutin nang matagal ang larawan at piliin ang <strong>Save to Photos</strong></p>
            </body>
            </html>
        `);
        showToast("ℹ️ Pindutin nang matagal ang resibo at piliin ang 'Save to Photos'.");
        return;
    }

    triggerDirectAnchorDownload(currentReceiptDataUrl, fileName);
}

if (typeof window !== 'undefined') {
    window.renderReceiptCanvas = renderReceiptCanvas;
    window.downloadReceiptImage = downloadReceiptImage;
}