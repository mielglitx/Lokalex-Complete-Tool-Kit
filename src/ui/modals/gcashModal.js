// src/ui/modals/gcashModal.js
import { appState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { API_URL } from '../../config/constants.js';
import { showToast } from '../notifications.js';
import { openSlideDeleteModal } from './systemModals.js';

let stagedGcashQrPayload = "";
let stagedGcashQrImg = "";
let stagedGcashQrPreviewUrl = "";

function ensureJsQrLoaded() {
    return new Promise((resolve) => {
        if (window.jsQR) return resolve(true);

        const existingScript = document.querySelector('script[src*="jsqr"]');
        if (existingScript) {
            existingScript.addEventListener('load', () => resolve(true));
            setTimeout(() => resolve(!!window.jsQR), 1500);
            return;
        }

        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
    });
}

function ensureQrCodeGeneratorLoaded() {
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

function fileToImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = (err) => reject(err);
            img.src = e.target.result;
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

async function scanCanvasForQr(canvas, offsetX = 0, offsetY = 0) {
    if ('BarcodeDetector' in window) {
        try {
            const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            const barcodes = await detector.detect(canvas);
            if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                const b = barcodes[0].boundingBox;
                return {
                    payload: barcodes[0].rawValue.trim(),
                    bounds: b ? { x: b.x + offsetX, y: b.y + offsetY, width: b.width, height: b.height } : null
                };
            }
        } catch (e) {}
    }

    await ensureJsQrLoaded();
    if (window.jsQR) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        let code = window.jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert"
        });

        if (!code || !code.data) {
            code = window.jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "attemptBoth"
            });
        }

        if (code && code.data) {
            const loc = code.location;
            const minX = Math.min(loc.topLeftCorner.x, loc.bottomLeftCorner.x);
            const maxX = Math.max(loc.topRightCorner.x, loc.bottomRightCorner.x);
            const minY = Math.min(loc.topLeftCorner.y, loc.topRightCorner.y);
            const maxY = Math.max(loc.bottomLeftCorner.y, loc.bottomRightCorner.y);

            return {
                payload: code.data.trim(),
                bounds: {
                    x: minX + offsetX,
                    y: minY + offsetY,
                    width: Math.max(20, maxX - minX),
                    height: Math.max(20, maxY - minY)
                }
            };
        }
    }

    return null;
}

export async function scanQrCodeWithDetails(img) {
    const origW = img.width;
    const origH = img.height;

    // PASS 1: Native 1:1 scan with White Quiet Zone (for cropped QR images)
    const pad = Math.max(30, Math.round(Math.max(origW, origH) * 0.08));
    const paddedCanvas = document.createElement('canvas');
    paddedCanvas.width = origW + (pad * 2);
    paddedCanvas.height = origH + (pad * 2);
    const pCtx = paddedCanvas.getContext('2d', { willReadFrequently: true });
    pCtx.fillStyle = "#ffffff";
    pCtx.fillRect(0, 0, paddedCanvas.width, paddedCanvas.height);
    pCtx.drawImage(img, pad, pad);

    let res = await scanCanvasForQr(paddedCanvas, -pad, -pad);
    if (res) return res;

    // PASS 2: Mobile Screenshot ROI (for full-screen GCash screenshots)
    if (origH > origW * 1.15) {
        const roiCanvas = document.createElement('canvas');
        const qrBoxW = Math.round(origW * 0.78);
        const rx = Math.round((origW - qrBoxW) / 2);
        const ry = Math.round(origH * 0.12);

        roiCanvas.width = qrBoxW;
        roiCanvas.height = qrBoxW;
        const rCtx = roiCanvas.getContext('2d', { willReadFrequently: true });
        rCtx.imageSmoothingEnabled = false;
        rCtx.drawImage(img, rx, ry, qrBoxW, qrBoxW, 0, 0, qrBoxW, qrBoxW);

        res = await scanCanvasForQr(roiCanvas, rx, ry);
        if (res) return res;
    }

    // PASS 3: Native 1:1 Full-Resolution Scan
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = origW;
    fullCanvas.height = origH;
    const fCtx = fullCanvas.getContext('2d', { willReadFrequently: true });
    fCtx.imageSmoothingEnabled = false;
    fCtx.drawImage(img, 0, 0, origW, origH);

    return await scanCanvasForQr(fullCanvas, 0, 0);
}

export function cropQrByBounds(img, bounds) {
    const cropCanvas = document.createElement('canvas');
    const outSize = 340;
    cropCanvas.width = outSize;
    cropCanvas.height = outSize;
    const ctx = cropCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outSize, outSize);

    const pad = Math.round(Math.max(bounds.width, bounds.height) * 0.05);
    const sx = Math.max(0, bounds.x - pad);
    const sy = Math.max(0, bounds.y - pad);
    const sw = Math.min(img.width - sx, bounds.width + (pad * 2));
    const sh = Math.min(img.height - sy, bounds.height + (pad * 2));
    const side = Math.max(sw, sh);

    ctx.drawImage(img, sx, sy, Math.min(side, img.width - sx), Math.min(side, img.height - sy), 10, 10, outSize - 20, outSize - 20);
    return cropCanvas.toDataURL('image/png');
}

export function extractCleanQrSquareCrop(img) {
    const origW = img.width;
    const origH = img.height;

    const cropCanvas = document.createElement('canvas');
    const outSize = 340;
    cropCanvas.width = outSize;
    cropCanvas.height = outSize;
    const ctx = cropCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outSize, outSize);

    if (origH > origW * 1.15) {
        const qrSize = Math.round(origW * 0.74);
        const sx = Math.round((origW - qrSize) / 2);
        const sy = Math.round(origH * 0.135);
        ctx.drawImage(img, sx, sy, qrSize, qrSize, 8, 8, outSize - 16, outSize - 16);
    } else {
        const minSide = Math.min(origW, origH);
        const sx = Math.round((origW - minSide) / 2);
        const sy = Math.round((origH - minSide) / 2);
        ctx.drawImage(img, sx, sy, minSide, minSide, 8, 8, outSize - 16, outSize - 16);
    }

    return cropCanvas.toDataURL('image/png');
}

export async function generateQrDataUrl(text) {
    if (!text) return "";
    await ensureQrCodeGeneratorLoaded();

    if (!window.QRCode) return "";

    return new Promise((resolve) => {
        const tempCanvas = document.createElement('canvas');
        const size = 280;

        window.QRCode.toCanvas(tempCanvas, text, {
            width: size,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        }, (err) => {
            if (err) {
                console.warn("Vector QR generation error, using crop:", err);
                return resolve("");
            }

            const tCtx = tempCanvas.getContext('2d');
            tCtx.save();

            const badgeW = Math.round(size * 0.28);
            const badgeH = Math.round(size * 0.20);
            const bx = Math.round((size - badgeW) / 2);
            const by = Math.round((size - badgeH) / 2);

            tCtx.fillStyle = '#ffffff';
            tCtx.strokeStyle = '#e2e8f0';
            tCtx.lineWidth = 1.5;
            tCtx.beginPath();
            tCtx.roundRect(bx, by, badgeW, badgeH, 4);
            tCtx.fill();
            tCtx.stroke();

            tCtx.textAlign = "center";
            tCtx.textBaseline = "middle";

            tCtx.fillStyle = '#005bb7';
            tCtx.font = "800 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
            tCtx.fillText("insta", size / 2, by + (badgeH * 0.35));

            tCtx.fillStyle = '#da291c';
            tCtx.font = "900 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
            tCtx.fillText("Pay", size / 2, by + (badgeH * 0.72));

            tCtx.restore();
            resolve(tempCanvas.toDataURL('image/png'));
        });
    });
}

export function updateGcashQrModalPreview(qrDataUrl, isVector = true) {
    const previewImg = document.getElementById('gcash-qr-preview-img');
    const previewCard = document.getElementById('gcash-qr-preview-card');
    const placeholder = document.getElementById('gcash-qr-placeholder');
    const statusBadge = document.getElementById('gcash-qr-status-badge');
    const typeLabel = document.getElementById('gcash-qr-type-label');
    const uploadBtnTxt = document.getElementById('gcash-qr-upload-btn-txt');
    const clearBtn = document.getElementById('gcash-qr-clear-btn');

    if (qrDataUrl) {
        if (previewImg) previewImg.src = qrDataUrl;
        if (previewCard) previewCard.classList.remove('hidden');
        if (placeholder) placeholder.classList.add('hidden');
        if (clearBtn) clearBtn.classList.remove('hidden');

        if (statusBadge) {
            statusBadge.innerText = "Active QR Ready";
            statusBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30";
        }

        if (typeLabel) {
            typeLabel.innerText = isVector ? "InstaPay Vector QR Ready" : "Clean Cropped QR Matrix Ready";
            typeLabel.className = isVector 
                ? "text-[9.5px] text-emerald-600 dark:text-emerald-400 font-bold" 
                : "text-[9.5px] text-blue-600 dark:text-blue-400 font-bold";
        }

        if (uploadBtnTxt) uploadBtnTxt.innerText = "Replace Screenshot";
    } else {
        if (previewImg) previewImg.src = '';
        if (previewCard) previewCard.classList.add('hidden');
        if (placeholder) placeholder.classList.remove('hidden');
        if (clearBtn) clearBtn.classList.add('hidden');

        if (statusBadge) {
            statusBadge.innerText = "No QR Code";
            statusBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-bold bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
        }

        if (uploadBtnTxt) uploadBtnTxt.innerText = "Upload Screenshot";
    }
}

export async function fetchGCashDetails() {
    const riderId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const riderName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    localStorage.removeItem('lokalex_gcash_qr');
    delete appState.gcashQrUrl;

    if (!riderId && !riderName) return;

    let foundName = "";
    let foundNo = "";
    let foundPayload = "";
    let foundImg = "";

    if (db) {
        try {
            const snap = await db.ref('gcash').once('value');
            const data = snap.val();
            if (data) {
                Object.values(data).forEach(item => {
                    const itemTId = (item.telegramId || "").toString().trim();
                    const itemRName = (item.riderName || "").toString().trim().toLowerCase();
                    if ((riderId && itemTId === riderId) || (riderName && itemRName === riderName)) {
                        if (item.gcashName) foundName = item.gcashName;
                        if (item.gcashNo) foundNo = item.gcashNo;
                        if (item.qrPayload) foundPayload = item.qrPayload;
                        if (item.qrImg) foundImg = item.qrImg;
                    }
                });
            }
        } catch(e) {}
    }

    if (!foundName || !foundNo || (!foundPayload && !foundImg)) {
        try {
            const res = await fetch(`${API_URL}?type=all`);
            if (res.ok) {
                const json = await res.json();
                if (json && json.gcash) {
                    for (let key in json.gcash) {
                        const rec = json.gcash[key];
                        const recTId = (rec.telegramId || "").toString().trim();
                        const recRName = (rec.riderName || "").toString().trim().toLowerCase();
                        if ((riderId && recTId === riderId) || (riderName && recRName === riderName)) {
                            if (rec.gcashName) foundName = rec.gcashName;
                            if (rec.gcashNo) foundNo = rec.gcashNo;
                            if (rec.qrPayload) foundPayload = rec.qrPayload;
                            if (rec.qrImg) foundImg = rec.qrImg;
                            break;
                        }
                    }
                }
            }
        } catch(e) {}
    }

    if (foundName || foundNo || foundPayload || foundImg) {
        if (foundName) {
            appState.gcashName = foundName;
            localStorage.setItem('lokalex_gcash_name', foundName);
        }
        if (foundNo) {
            appState.gcashNo = foundNo;
            localStorage.setItem('lokalex_gcash_no', foundNo);
        }
        if (foundPayload) {
            appState.gcashQrPayload = foundPayload;
            localStorage.setItem('lokalex_gcash_qr_payload', foundPayload);
            stagedGcashQrPayload = foundPayload;

            try {
                stagedGcashQrPreviewUrl = await generateQrDataUrl(foundPayload);
            } catch(e) {}
        }
        if (foundImg) {
            appState.gcashQrImg = foundImg;
            localStorage.setItem('lokalex_gcash_qr_img', foundImg);
            stagedGcashQrImg = foundImg;
            if (!stagedGcashQrPreviewUrl) {
                stagedGcashQrPreviewUrl = foundImg;
            }
        }

        const nameInput = document.getElementById('gcash-name-input');
        const noInput = document.getElementById('gcash-no-input');
        if (nameInput && foundName) nameInput.value = foundName;
        if (noInput && foundNo) noInput.value = foundNo;

        updateGcashQrModalPreview(stagedGcashQrPreviewUrl, !!stagedGcashQrPayload && stagedGcashQrPreviewUrl !== stagedGcashQrImg);
    }
}

export async function handleGcashQrFileSelected(event) {
    const file = event.target?.files?.[0];
    if (!file) return;

    showToast("⏳ Kinukuha at sinusuri ang GCash QR Code...");

    try {
        const img = await fileToImage(file);
        
        // 1. Generate clean cropped matrix fallback immediately
        let cleanCrop = extractCleanQrSquareCrop(img);

        // 2. Scan for QR payload and exact pixel boundaries
        const scanResult = await scanQrCodeWithDetails(img);

        if (scanResult && scanResult.bounds) {
            cleanCrop = cropQrByBounds(img, scanResult.bounds);
        }

        stagedGcashQrPayload = scanResult?.payload || "";
        stagedGcashQrImg = cleanCrop; // Preserved as fallback

        // 3. Attempt vector QR generation from payload
        let previewUrl = "";
        if (stagedGcashQrPayload) {
            try {
                previewUrl = await generateQrDataUrl(stagedGcashQrPayload);
            } catch (e) {
                console.warn("Vector generation failed:", e);
            }
        }

        // 4. Default to clean crop if vector generation was skipped or empty
        if (!previewUrl) {
            previewUrl = cleanCrop;
        }

        stagedGcashQrPreviewUrl = previewUrl;

        updateGcashQrModalPreview(stagedGcashQrPreviewUrl, !!stagedGcashQrPayload && previewUrl !== cleanCrop);
        
        if (stagedGcashQrPayload) {
            showToast("✅ Matagumpay na na-extract ang InstaPay QR Data!");
        } else {
            showToast("✅ Na-crop ang QR matrix! Handa na para sa resibo.");
        }
    } catch (err) {
        console.error("QR processing error:", err);
        showToast("❌ Hindi ma-process ang QR Code photo.");
    } finally {
        event.target.value = '';
    }
}

export function clearGcashQr() {
    stagedGcashQrPayload = '';
    stagedGcashQrImg = '';
    stagedGcashQrPreviewUrl = '';
    updateGcashQrModalPreview('');
    showToast("🗑️ QR Code cleared. Click 'Save Details' to apply.");
}

export async function openGCashModal() {
    const modal = document.getElementById('gcash-modal');
    if (modal) {
        const nameInput = document.getElementById('gcash-name-input');
        const noInput = document.getElementById('gcash-no-input');
        
        const localName = appState.gcashName || localStorage.getItem('lokalex_gcash_name') || "";
        const localNo = appState.gcashNo || localStorage.getItem('lokalex_gcash_no') || "";
        stagedGcashQrPayload = appState.gcashQrPayload || localStorage.getItem('lokalex_gcash_qr_payload') || "";
        stagedGcashQrImg = appState.gcashQrImg || localStorage.getItem('lokalex_gcash_qr_img') || "";

        localStorage.removeItem('lokalex_gcash_qr');
        delete appState.gcashQrUrl;

        if (nameInput) nameInput.value = localName;
        if (noInput) noInput.value = localNo;

        let previewUrl = "";
        if (stagedGcashQrPayload) {
            try {
                previewUrl = await generateQrDataUrl(stagedGcashQrPayload);
            } catch(e) {}
        }
        if (!previewUrl && stagedGcashQrImg) {
            previewUrl = stagedGcashQrImg;
        }

        stagedGcashQrPreviewUrl = previewUrl;
        updateGcashQrModalPreview(stagedGcashQrPreviewUrl, !!stagedGcashQrPayload && previewUrl !== stagedGcashQrImg);

        modal.classList.remove('hidden');
        await fetchGCashDetails();
    }
}

export function closeGCashModal() {
    const modal = document.getElementById('gcash-modal');
    if (modal) modal.classList.add('hidden');
}

export function saveGCashDetails() {
    const nameInput = document.getElementById('gcash-name-input');
    const noInput = document.getElementById('gcash-no-input');
    
    const gName = nameInput ? nameInput.value.trim() : "";
    const gNo = noInput ? noInput.value.trim() : "";

    if (!gName || !gNo) {
        showToast("⚠️ Paki-kumpleto ang GCash Name at Number!");
        return;
    }

    const hasQrAttached = !!(stagedGcashQrPayload || stagedGcashQrImg);

    openSlideDeleteModal(
        "Confirm GCash Details?",
        `I-drag pakanan para kumpirmahin ang pag-update ng iyong GCash details:\n👤 Name: ${gName}\n📱 Number: ${gNo}${hasQrAttached ? '\n📷 QR Code Active & Attached' : ''}`,
        () => {
            executeSaveGCashDetails(gName, gNo, stagedGcashQrPayload, stagedGcashQrImg);
        }
    );
}

export function executeSaveGCashDetails(gName, gNo, qrPayload = "", qrImg = "") {
    appState.gcashName = gName;
    appState.gcashNo = gNo;
    appState.gcashQrPayload = qrPayload || "";
    appState.gcashQrImg = qrImg || "";

    localStorage.setItem('lokalex_gcash_name', gName);
    localStorage.setItem('lokalex_gcash_no', gNo);

    localStorage.removeItem('lokalex_gcash_qr');
    delete appState.gcashQrUrl;

    if (qrPayload) {
        localStorage.setItem('lokalex_gcash_qr_payload', qrPayload);
    } else {
        localStorage.removeItem('lokalex_gcash_qr_payload');
    }

    if (qrImg) {
        localStorage.setItem('lokalex_gcash_qr_img', qrImg);
    } else {
        localStorage.removeItem('lokalex_gcash_qr_img');
    }

    if (db) {
        const riderKey = (appState.telegramId || appState.riderName || localStorage.getItem('telegramId') || localStorage.getItem('riderName') || "rider").toString().replace(/[^a-zA-Z0-9_-]/g, '_');
        db.ref('gcash/' + riderKey).set({
            riderName: appState.riderName || "",
            telegramId: appState.telegramId || "",
            gcashName: gName,
            gcashNo: gNo,
            qrPayload: qrPayload || null,
            qrImg: qrImg || null,
            updatedAt: Date.now()
        });
    }

    try {
        fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({
                type: "gcash",
                telegramId: appState.telegramId,
                riderName: appState.riderName,
                gcashName: gName,
                gcashNo: gNo
            })
        });
    } catch(e) {}

    closeGCashModal();
    showToast("✅ Na-save na ang iyong GCash Details & QR Code!");
}

if (typeof window !== 'undefined') {
    window.fetchGCashDetails = fetchGCashDetails;
    window.openGCashModal = openGCashModal;
    window.closeGCashModal = closeGCashModal;
    window.saveGCashDetails = saveGCashDetails;
    window.executeSaveGCashDetails = executeSaveGCashDetails;
    window.handleGcashQrFileSelected = handleGcashQrFileSelected;
    window.clearGcashQr = clearGcashQr;
    window.generateQrDataUrl = generateQrDataUrl;
    window.scanQrCodeWithDetails = scanQrCodeWithDetails;
    window.updateGcashQrModalPreview = updateGcashQrModalPreview;
}