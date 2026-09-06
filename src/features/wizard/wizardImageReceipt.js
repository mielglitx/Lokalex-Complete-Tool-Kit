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

export async function generatePureQrImage(payload, size = 480) {
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

            const tCtx = tempCanvas.getContext('2d');
            tCtx.save();

            const badgeW = Math.round(size * 0.28);
            const badgeH = Math.round(size * 0.20);
            const bx = Math.round((size - badgeW) / 2);
            const by = Math.round((size - badgeH) / 2);

            tCtx.fillStyle = '#ffffff';
            tCtx.strokeStyle = '#cbd5e1';
            tCtx.lineWidth = 2;
            tCtx.beginPath();
            tCtx.roundRect(bx, by, badgeW, badgeH, 6);
            tCtx.fill();
            tCtx.stroke();

            tCtx.textAlign = "center";
            tCtx.textBaseline = "middle";

            tCtx.fillStyle = '#005bb7';
            tCtx.font = `800 ${Math.round(size * 0.042)}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
            tCtx.fillText("insta", size / 2, by + (badgeH * 0.35));

            tCtx.fillStyle = '#da291c';
            tCtx.font = `900 ${Math.round(size * 0.052)}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
            tCtx.fillText("Pay", size / 2, by + (badgeH * 0.72));

            tCtx.restore();

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
        if (!src.startsWith('data:') && !src.startsWith('blob:')) {
            img.crossOrigin = "anonymous";
        }
        img.onload = () => resolve(img);
        img.onerror = (e) => {
            console.warn("Image load failed:", e);
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

    const currentCart = getCurrentCart() || [];
    const dailyRiderId = getDailyRiderId();
    const rawCustomerName = document.getElementById('rcpt-name')?.value.trim() || appState.selectedCateringClient || "Customer";
    const rawRiderName = appState.riderName || localStorage.getItem('riderName') || "Rider";

    const customerName = toTitleCase(rawCustomerName);
    const riderName = toTitleCase(rawRiderName);

    const dateStr = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const subtotal = Math.max(0, wizState.subtotal || 0);
    const finalHFee = wizState.finalHFee || 0;
    const finalMFee = wizState.finalMFee || 0;
    const finalMulti = wizState.finalMulti || 0;
    const deliveryFee = wizState.deliveryFee || 0;
    const discount = wizState.discount || 0;
    const isPercent = wizState.discountType === 'percent';
    const rawDiscVal = wizState.rawDiscountVal || 0;

    const codTotal = Math.max(0, wizState.codTotal || wizState.finalTotal || 0);
    const epayFee = wizState.finalEpay || (codTotal <= 1000 ? 15 : 15 + Math.ceil((codTotal - 1000) / 500) * 5);
    const gcashTotal = codTotal + epayFee;

    const rawGcashName = appState.gcashName || localStorage.getItem('lokalex_gcash_name') || "";
    const gcashName = toTitleCase(rawGcashName);
    const gcashNo = appState.gcashNo || localStorage.getItem('lokalex_gcash_no') || "";
    const gcashQrPayload = appState.gcashQrPayload || localStorage.getItem('lokalex_gcash_qr_payload') || "";
    const gcashQrImg = appState.gcashQrImg || localStorage.getItem('lokalex_gcash_qr_img') || "";

    let preloadedQrImage = null;
    if (gcashQrPayload) {
        try {
            preloadedQrImage = await generatePureQrImage(gcashQrPayload, 512);
        } catch (e) {
            console.warn("Generating vector QR failed:", e);
        }
    }

    if (!preloadedQrImage && gcashQrImg) {
        try {
            preloadedQrImage = await loadImageAsync(gcashQrImg);
        } catch (e) {
            console.warn("Loading cropped QR failed:", e);
        }
    }

    const hasQrDrawn = !!preloadedQrImage;
    const hasGcashDetails = !!(gcashName || gcashNo || hasQrDrawn);

    const width = 640;
    let estimatedHeight = 380;
    estimatedHeight += Math.max(1, currentCart.length) * 38;
    
    let activeFeesCount = 0;
    if (finalHFee > 0) activeFeesCount++;
    if (finalMFee > 0) activeFeesCount++;
    if (finalMulti > 0) activeFeesCount++;
    if (deliveryFee > 0) activeFeesCount++;
    if (discount > 0) activeFeesCount++;
    estimatedHeight += Math.max(1, activeFeesCount) * 28;

    const gcashBoxHeight = hasQrDrawn ? 224 : 88;
    if (hasGcashDetails) {
        estimatedHeight += gcashBoxHeight + 24;
    }
    estimatedHeight += 110;

    const scaleFactor = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scaleFactor);
    canvas.height = Math.round(estimatedHeight * scaleFactor);
    
    const ctx = canvas.getContext('2d');
    ctx.scale(scaleFactor, scaleFactor);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, estimatedHeight);

    ctx.fillStyle = "#2563eb";
    ctx.fillRect(0, 0, width, 12);

    let y = 46;

    ctx.fillStyle = "#0f172a";
    ctx.font = "900 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("LOKALEX DELIVERY HUB", width / 2, y);

    y += 24;
    ctx.fillStyle = "#64748b";
    ctx.font = "700 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.letterSpacing = "2px";
    ctx.fillText("OFFICIAL DELIVERY RECEIPT", width / 2, y);
    ctx.letterSpacing = "0px";

    y += 32;

    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(32, y, width - 64, 76, 16);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = "#475569";
    ctx.font = "600 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(`Customer:`, 50, y + 26);
    ctx.fillText(`Rider:`, 50, y + 54);

    ctx.fillStyle = "#0f172a";
    ctx.font = "800 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(customerName, 120, y + 26);
    ctx.fillText(`${riderName} (${dailyRiderId})`, 120, y + 54);

    ctx.textAlign = "right";
    ctx.fillStyle = "#64748b";
    ctx.font = "600 11px 'SF Mono', Consolas, Monaco, monospace";
    ctx.fillText(dateStr, width - 50, y + 26);
    const txIdDisplay = wizState.currentReceiptTransactionId || "";
    ctx.fillText(`#${txIdDisplay.slice(-14)}`, width - 50, y + 54);

    y += 98;

    ctx.fillStyle = "#0f172a";
    ctx.font = "800 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("ITEM DESCRIPTION", 44, y);
    ctx.textAlign = "right";
    ctx.fillText("TOTAL", width - 44, y);

    y += 10;
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(width - 40, y);
    ctx.stroke();
    ctx.setLineDash([]);

    y += 24;

    if (currentCart.length === 0) {
        ctx.textAlign = "center";
        ctx.fillStyle = "#94a3b8";
        ctx.font = "italic 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText("(Walang nakalistang items)", width / 2, y);
        y += 28;
    } else {
        currentCart.forEach(item => {
            const isPaid = !!item.isPaid || (parseFloat(item.price) || 0) <= 0;
            const priceNum = Math.max(0, parseFloat(item.price) || 0);
            const priceStr = isPaid ? "PAID (₱0.00)" : `₱${priceNum.toFixed(2)}`;
            const itemName = toTitleCase(item.name || 'Item');

            ctx.textAlign = "left";
            ctx.fillStyle = isPaid ? "#64748b" : "#1e293b";
            ctx.font = isPaid ? "600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" : "700 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

            ctx.fillText(`•  ${itemName}`, 44, y);

            ctx.textAlign = "right";
            ctx.fillStyle = isPaid ? "#059669" : "#0f172a";
            ctx.font = "700 13px 'SF Mono', Consolas, Monaco, monospace";
            ctx.fillText(priceStr, width - 44, y);

            y += 28;
        });
    }

    y += 4;
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(width - 40, y);
    ctx.stroke();

    y += 24;

    ctx.textAlign = "left";
    ctx.fillStyle = "#475569";
    ctx.font = "700 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("ITEMS SUBTOTAL", 44, y);

    ctx.textAlign = "right";
    ctx.fillStyle = "#0f172a";
    ctx.font = "800 14px 'SF Mono', Consolas, Monaco, monospace";
    ctx.fillText(`₱${subtotal.toFixed(2)}`, width - 44, y);

    y += 22;

    const drawFeeRow = (label, amount, isDeduction = false) => {
        ctx.textAlign = "left";
        ctx.fillStyle = isDeduction ? "#b91c1c" : "#64748b";
        ctx.font = "600 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillText(label, 44, y);

        ctx.textAlign = "right";
        ctx.fillStyle = isDeduction ? "#b91c1c" : "#334155";
        ctx.font = "700 12px 'SF Mono', Consolas, Monaco, monospace";
        ctx.fillText(`${isDeduction ? '-' : ''}₱${amount.toFixed(2)}`, width - 44, y);
        y += 22;
    };

    if (finalHFee > 0) drawFeeRow("Handling Fee", finalHFee);
    if (finalMFee > 0) drawFeeRow("Market Fee", finalMFee);
    if (finalMulti > 0) drawFeeRow("Multistore Fee", finalMulti);
    if (deliveryFee > 0) drawFeeRow("Delivery Fee", deliveryFee);
    if (discount > 0) drawFeeRow(`Discount ${isPercent ? `(${rawDiscVal}%)` : ''}`, discount, true);

    y += 8;

    ctx.fillStyle = "#ecfdf5";
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(36, y, width - 72, 46, 14);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = "#047857";
    ctx.font = "900 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("💵 COD TOTAL (CASH TO COLLECT)", 52, y + 28);

    ctx.textAlign = "right";
    ctx.fillStyle = "#047857";
    ctx.font = "900 18px 'SF Mono', Consolas, Monaco, monospace";
    ctx.fillText(`₱${codTotal.toFixed(2)}`, width - 52, y + 29);

    y += 56;

    ctx.fillStyle = "#eff6ff";
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(36, y, width - 72, 40, 12);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = "#1d4ed8";
    ctx.font = "800 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(`📱 GCASH PAYMENT (+₱${epayFee.toFixed(2)} Transfer Fee)`, 52, y + 25);

    ctx.textAlign = "right";
    ctx.fillStyle = "#1d4ed8";
    ctx.font = "800 15px 'SF Mono', Consolas, Monaco, monospace";
    ctx.fillText(`₱${gcashTotal.toFixed(2)}`, width - 52, y + 26);

    y += 54;

    if (hasGcashDetails) {
        ctx.fillStyle = "#f8fafc";
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        
        ctx.beginPath();
        ctx.roundRect(36, y, width - 72, gcashBoxHeight, 18);
        ctx.fill();
        ctx.stroke();

        ctx.save();
        ctx.textBaseline = "alphabetic";

        if (hasQrDrawn) {
            const qrSize = 180;
            const qrX = 50;
            const qrY = y + 22;

            ctx.fillStyle = "#FFFFFF";
            ctx.strokeStyle = "#cbd5e1";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, 12);
            ctx.fill();
            ctx.stroke();

            ctx.drawImage(preloadedQrImage, qrX, qrY, qrSize, qrSize);

            const textX = qrX + qrSize + 22;
            ctx.textAlign = "left";
            
            ctx.fillStyle = "#0284c7";
            ctx.font = "900 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
            ctx.fillText("SCAN TO PAY VIA GCASH", textX, qrY + 32);

            ctx.fillStyle = "#64748b";
            ctx.font = "600 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
            ctx.fillText("Account Name:", textX, qrY + 68);
            ctx.fillStyle = "#0f172a";
            ctx.font = "800 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
            ctx.fillText(gcashName || "Rider GCash", textX, qrY + 90);

            ctx.fillStyle = "#64748b";
            ctx.font = "600 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
            ctx.fillText("Mobile Number:", textX, qrY + 124);
            ctx.fillStyle = "#0f172a";
            ctx.font = "800 16px 'SF Mono', Consolas, Monaco, monospace";
            ctx.fillText(gcashNo || "Not Specified", textX, qrY + 148);
        } else {
            ctx.textAlign = "center";
            ctx.fillStyle = "#0284c7";
            ctx.font = "900 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
            ctx.fillText("GCASH PAYMENT DETAILS", width / 2, y + 28);

            ctx.fillStyle = "#0f172a";
            ctx.font = "700 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
            ctx.fillText(`${gcashName || 'Rider'} • ${gcashNo || ''}`, width / 2, y + 54);
        }

        ctx.restore();
        y += gcashBoxHeight + 16;
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "#64748b";
    ctx.font = "700 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("Salamat sa pagtitiwala sa Lokalex!", width / 2, y + 14);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 10px 'SF Mono', Consolas, Monaco, monospace";
    ctx.fillText("Lokalex Logistics • On-Demand Express Delivery", width / 2, y + 32);

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

    // 1. ANDROID & PC: INSTANT DIRECT DOWNLOAD WITHOUT SHARE SHEET
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

    // 2. IOS (IPHONE / IPAD): WEB SHARE SHEET OR LONG-PRESS SAVE PROMPT
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
                    img { max-width: 100%; height: auto; border-radius: 16px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
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