// src/features/wizard.js
import { appState, globalState, wizState, multiCarts, activeCartSlot } from '../store/state.js';
import { db } from '../config/firebase.js';
import { getLocalTodayStr, copyText, escapeHtml, isSameDate } from '../utils/helpers.js';
import { showToast, showSideNotification } from '../ui/notifications.js';
import { switchView } from '../ui/router.js';
import { saveCartState, getCurrentCart, clearCartSlot, getEffectiveCartClient, renderCartItems, renderCartTabs } from './cart.js';
import { getActiveCateringCustomersWithTimes, calculateSplitDuration, saveRosterCache, updateRosterUI } from './roster/index.js';

let currentReceiptTransactionId = "";
let currentReceiptCanvas = null;
let currentReceiptDataUrl = "";

function isRiderActivelyCatering() {
    const myId = (appState.telegramId || "").toString();
    const myRecord = globalState.rosterMembers ? globalState.rosterMembers.find(m => (m.telegramId || "").toString() === myId) : null;
    return myRecord && myRecord.status === 'Catering';
}

export function getDailyRiderId() {
    const rName = (appState.riderName || appState.telegramId || "RIDER").replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const dateClean = getLocalTodayStr().replace(/-/g, '');
    const seed = `${rName}_${dateClean}_LOKALEX_RID`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let code = ""; 
    let temp = hash;
    for (let j = 0; j < 5; j++) { 
        code += chars[temp % chars.length]; 
        temp = Math.floor(temp / chars.length) + (j * 17); 
    }
    return `RID-${code}`;
}

export function proceedToWizard() {
    switchView('view-wizard');
    initWizardForCart();
}

export function initWizardForCart() {
    const currentCart = getCurrentCart();
    if (!currentCart || currentCart.length === 0) return;

    const activeCartIdx = globalState.activeCartIndex || 0;

    if (globalState.cartTxIds && globalState.cartTxIds[activeCartIdx]) {
        currentReceiptTransactionId = globalState.cartTxIds[activeCartIdx];
    } else {
        currentReceiptTransactionId = getDailyRiderId() + "-" + Date.now().toString(36).toUpperCase();
        if (!globalState.cartTxIds) globalState.cartTxIds = ["", "", "", ""];
        globalState.cartTxIds[activeCartIdx] = currentReceiptTransactionId;
    }

    const marketSum = currentCart
        .filter(i => (i.category || i.type || '').toLowerCase() === 'market' && !i.isPaid)
        .reduce((s, i) => s + Math.max(0, parseFloat(i.price) || 0), 0);

    const storeSum = currentCart
        .filter(i => (i.category || i.type || '').toLowerCase() === 'store' && !i.isPaid)
        .reduce((s, i) => s + Math.max(0, parseFloat(i.price) || 0), 0);

    wizState.subtotal = Math.max(0, marketSum + storeSum);
    wizState.discountType = wizState.discountType || 'amount';

    const autoMarket = marketSum > 0 ? Math.ceil(marketSum / 500) * 15 : 0;
    const autoHandling = storeSum > 0 ? Math.ceil(storeSum / 500) * 10 : 0;
    
    if (!wizState.storeCount) wizState.storeCount = 1;

    const handlingEl = document.getElementById('wiz-handling');
    const marketEl = document.getElementById('wiz-market');
    const multistopEl = document.getElementById('wiz-multistop');

    if (handlingEl) handlingEl.value = autoHandling;
    if (marketEl) marketEl.value = autoMarket;
    if (multistopEl && !multistopEl.value) multistopEl.value = 0;

    setupWizardClientDetails();
    updateDiscountTypeUI();
    calculateGrandTotal();
}

function setupWizardClientDetails() {
    const btnBox = document.getElementById('catered-client-buttons');
    const rcptInput = document.getElementById('rcpt-name');
    const toggleManual = document.getElementById('manual-client-toggle');

    if (!rcptInput || !btnBox || !toggleManual) return;

    const activeCartIdx = globalState.activeCartIndex || 0;
    const currentClient = getEffectiveCartClient(activeCartIdx);
    appState.selectedCateringClient = currentClient;

    rcptInput.value = currentClient;

    if (currentClient.toLowerCase() === 'sample') {
        rcptInput.disabled = false;
        toggleManual.checked = true;
    } else {
        rcptInput.disabled = true;
        toggleManual.checked = false;
    }

    const cartSlotDisplay = activeCartIdx + 1;
    btnBox.innerHTML = `
        <button onclick="selectCateredClientName('${escapeHtml(currentClient)}')" class="bg-blue-600 border border-blue-400 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow transition active:scale-95">
            <i class="fa-solid fa-user"></i> ${escapeHtml(currentClient)} (Cart ${cartSlotDisplay})
        </button>`;
}

export function selectCateredClientName(cName) {
    const rcptInput = document.getElementById('rcpt-name');
    if (rcptInput) {
        rcptInput.value = cName;
        rcptInput.disabled = true;
    }
    const manualToggle = document.getElementById('manual-client-toggle');
    if (manualToggle) manualToggle.checked = false;
    
    appState.selectedCateringClient = cName;
    showToast(`Selected: ${cName}`);
}

export function toggleManualClientInput(isManual) {
    const rcptInput = document.getElementById('rcpt-name');
    if (rcptInput) {
        rcptInput.disabled = !isManual;
        if (isManual) {
            rcptInput.focus();
            appState.selectedCateringClient = "";
        }
    }
}

export function adjustStoreCount(delta) {
    const freeDeliveryEl = document.getElementById('wiz-free-delivery');
    if (freeDeliveryEl && freeDeliveryEl.checked) return;

    wizState.storeCount = Math.max(1, (wizState.storeCount || 1) + delta);
    const multistopInput = document.getElementById('wiz-multistop');
    if (multistopInput) {
        multistopInput.value = wizState.storeCount > 1 ? (wizState.storeCount - 1) * 10 : 0;
    }
    calculateGrandTotal();
}

export function toggleDiscountType(type) {
    if (type) {
        wizState.discountType = type;
    } else {
        wizState.discountType = wizState.discountType === 'percent' ? 'amount' : 'percent';
    }

    updateDiscountTypeUI();
    calculateGrandTotal();
}

export function updateDiscountTypeUI() {
    const isPercent = wizState.discountType === 'percent';

    const btnAmount = document.getElementById('wiz-discount-type-amount');
    const btnPercent = document.getElementById('wiz-discount-type-percent');
    const discountIcon = document.getElementById('wiz-discount-icon');
    const discountInput = document.getElementById('wiz-discount');

    if (btnAmount && btnPercent) {
        if (isPercent) {
            btnPercent.className = "px-2 py-1 bg-red-600 text-white font-bold rounded-md text-[10px] shadow transition";
            btnAmount.className = "px-2 py-1 bg-gray-800 text-gray-400 font-bold rounded-md text-[10px] hover:text-white transition";
        } else {
            btnAmount.className = "px-2 py-1 bg-red-600 text-white font-bold rounded-md text-[10px] shadow transition";
            btnPercent.className = "px-2 py-1 bg-gray-800 text-gray-400 font-bold rounded-md text-[10px] hover:text-white transition";
        }
    }

    if (discountIcon) {
        discountIcon.innerText = isPercent ? "%" : "₱";
    }

    if (discountInput) {
        discountInput.placeholder = isPercent ? "0%" : "0";
    }
}

export function calculateGrandTotal() {
    const freeDeliveryEl = document.getElementById('wiz-free-delivery');
    const isFree = freeDeliveryEl ? freeDeliveryEl.checked : false;

    let hFee = Math.max(0, parseFloat(document.getElementById('wiz-handling')?.value) || 0);
    let mFee = Math.max(0, parseFloat(document.getElementById('wiz-market')?.value) || 0);
    let multistop = Math.max(0, parseFloat(document.getElementById('wiz-multistop')?.value) || 0);
    let dFee = Math.max(0, parseFloat(document.getElementById('wiz-delivery')?.value) || 0);
    let rawDiscountInput = Math.max(0, parseFloat(document.getElementById('wiz-discount')?.value) || 0);

    if (isFree) {
        hFee = 0; 
        mFee = 0; 
        multistop = 0; 
        dFee = 0;
    }

    const subtotal = Math.max(0, wizState.subtotal || 0);
    const totalFeesBeforeDiscount = hFee + mFee + multistop + dFee;

    let calculatedDiscount = 0;
    if (wizState.discountType === 'percent') {
        calculatedDiscount = (totalFeesBeforeDiscount * Math.min(100, rawDiscountInput)) / 100;
    } else {
        calculatedDiscount = rawDiscountInput;
    }

    calculatedDiscount = Math.min(totalFeesBeforeDiscount, Math.max(0, calculatedDiscount));

    const netFees = Math.max(0, totalFeesBeforeDiscount - calculatedDiscount);
    let codTotal = Math.max(0, subtotal + netFees);

    let epayFee = 0;
    if (codTotal > 0) {
        epayFee = codTotal <= 1000 ? 15 : 15 + Math.ceil((codTotal - 1000) / 500) * 5;
    }
    let gcashTotal = codTotal + epayFee;

    const storeCountEl = document.getElementById('wiz-store-count');
    const grandTotalEl = document.getElementById('wiz-grand-total');

    if (storeCountEl) storeCountEl.innerText = isFree ? "0" : (wizState.storeCount || 1);
    if (grandTotalEl) grandTotalEl.innerText = codTotal.toFixed(2);

    wizState.finalHFee = hFee;
    wizState.finalMFee = mFee;
    wizState.finalMulti = multistop;
    wizState.deliveryFee = dFee;
    wizState.rawDiscountVal = rawDiscountInput;
    wizState.discount = calculatedDiscount;
    wizState.finalEpay = epayFee;
    wizState.codTotal = codTotal;
    wizState.gcashTotal = gcashTotal;
    wizState.finalTotal = codTotal;
}

export function generateFinalReceipt() {
    const rcptNameInput = document.getElementById('rcpt-name');
    const customerName = rcptNameInput ? rcptNameInput.value.trim() : "";

    if (!customerName) {
        const sampleModal = document.getElementById('sample-receipt-modal');
        if (sampleModal) sampleModal.classList.remove('hidden');
        return;
    }

    executeGenerateFinalReceipt(customerName);
}

export function confirmSampleReceiptProceed() {
    const sampleModal = document.getElementById('sample-receipt-modal');
    if (sampleModal) sampleModal.classList.add('hidden');

    const rcptNameInput = document.getElementById('rcpt-name');
    if (rcptNameInput) rcptNameInput.value = "Sample";

    appState.selectedCateringClient = "Sample";
    executeGenerateFinalReceipt("Sample");
}

export async function executeGenerateFinalReceipt(customerName) {
    calculateGrandTotal();

    const freeDeliveryEl = document.getElementById('wiz-free-delivery');
    const isFree = freeDeliveryEl ? freeDeliveryEl.checked : false;
    const deliveryVal = document.getElementById('wiz-delivery')?.value.trim() || "";

    if (!isFree && (deliveryVal === "" || isNaN(parseFloat(deliveryVal)) || parseFloat(deliveryVal) <= 0)) {
        showToast("⚠️ Paki-lagay ang Rider Delivery Fee bago mag-generate ng resibo!");
        const deliveryInput = document.getElementById('wiz-delivery');
        if (deliveryInput) deliveryInput.focus();
        return;
    }

    const headerTitle = document.getElementById('header-title');
    if (headerTitle) headerTitle.innerText = "Official Receipt";

    if (customerName.toLowerCase() !== 'sample') {
        showSideNotification("SAVING RECEIPT", `Updating receipt for ${customerName}`, "fa-receipt", "text-emerald-400", "border-emerald-500");
    }

    saveReceiptToDatabase(customerName);

    switchView('view-receipt-final');
    renderFinalReceiptText();
    await renderReceiptCanvas();
}

async function saveReceiptToDatabase(customerName) {
    if (!customerName || customerName.trim().toLowerCase() === "sample") {
        showToast("ℹ️ Sample Receipt generated (Not saved to commission/catered list).");
        return;
    }

    const cName = customerName.trim();
    const cleanCustKey = cName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const rName = (appState.riderName || "").trim();
    const cleanRiderKey = rName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const todayStr = getLocalTodayStr();
    const todayClean = todayStr.replace(/-/g, '');
    const currentTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const activeCustList = getActiveCateringCustomersWithTimes();
    const match = activeCustList.find(i => i.name.trim().toLowerCase() === cName.toLowerCase());
    const sTime = match ? match.startTime.trim() : currentTimeStr;
    const cleanTimeKey = sTime.replace(/[^a-z0-9]/gi, '');
    const custCount = Math.max(1, activeCustList.length || 1);
    const splitDuration = calculateSplitDuration(sTime, currentTimeStr, custCount);

    const sessionKey = `receipt_done_${cleanRiderKey}_${cleanCustKey}_${sTime}_${todayStr}`;
    localStorage.setItem(sessionKey, 'true');
    localStorage.setItem(`receipt_done_${cleanRiderKey}_${cleanCustKey}_${todayStr}`, 'true');

    const totalFees = Math.max(0, (wizState.finalHFee || 0) + (wizState.finalMFee || 0) + (wizState.finalMulti || 0) + (wizState.deliveryFee || 0) - (wizState.discount || 0));

    currentReceiptTransactionId = `RCPT_${cleanRiderKey}_${cleanCustKey}_${todayClean}_${cleanTimeKey || '1'}`;

    const activeCartIdx = globalState.activeCartIndex || 0;
    if (!globalState.cartTxIds) globalState.cartTxIds = ["", "", "", ""];
    globalState.cartTxIds[activeCartIdx] = currentReceiptTransactionId;

    const receiptPayload = {
        id: currentReceiptTransactionId,
        key: currentReceiptTransactionId,
        type: "receipts",
        transactionId: currentReceiptTransactionId,
        telegramId: (appState.telegramId || "").toString().trim(),
        riderName: rName,
        customerName: cName,
        cateringStartTime: sTime,
        startTime: sTime,
        completedTime: currentTimeStr,
        customerCount: custCount,
        duration: splitDuration,
        fees: {
            handling: wizState.finalHFee || 0,
            market: wizState.finalMFee || 0,
            multistore: wizState.finalMulti || 0,
            delivery: wizState.deliveryFee || 0,
            discount: wizState.discount || 0,
            discountType: wizState.discountType || 'amount',
            rawDiscountVal: wizState.rawDiscountVal || 0
        },
        totalFees: totalFees,
        date: todayStr
    };

    const cateredHistoryItem = {
        id: currentReceiptTransactionId,
        key: currentReceiptTransactionId,
        transactionId: currentReceiptTransactionId,
        riderName: rName,
        telegramId: (appState.telegramId || "").toString().trim(),
        customerName: cName,
        startTime: sTime,
        completedTime: currentTimeStr,
        completedDate: todayStr,
        customerCount: custCount,
        duration: splitDuration,
        totalFees: totalFees,
        fees: receiptPayload.fees
    };

    try {
        if (db) {
            await db.ref('receipts/' + currentReceiptTransactionId).set(receiptPayload);
            await db.ref('cateredHistory/' + currentReceiptTransactionId).set(cateredHistoryItem);

            const riderKey = (appState.telegramId || appState.riderName || "rider").toString().replace(/[^a-zA-Z0-9_-]/g, '_');
            db.ref('roster/' + riderKey).update({
                lastReceiptFees: receiptPayload.fees,
                lastReceiptTotalFees: totalFees
            });

            if (cleanCustKey) {
                db.ref(`roster/${riderKey}/customerFees/${cleanCustKey}`).set({
                    customerName: cName,
                    totalFees: totalFees,
                    fees: receiptPayload.fees,
                    transactionId: currentReceiptTransactionId
                });
            }
        }

        if (!globalState.globalDailyReceipts) globalState.globalDailyReceipts = [];
        const rIdx = globalState.globalDailyReceipts.findIndex(r => (r.transactionId === currentReceiptTransactionId || r.id === currentReceiptTransactionId));
        if (rIdx !== -1) globalState.globalDailyReceipts[rIdx] = receiptPayload;
        else globalState.globalDailyReceipts.push(receiptPayload);

        if (!globalState.globalCateredHistory) globalState.globalCateredHistory = [];
        const cIdx = globalState.globalCateredHistory.findIndex(h => (h.transactionId === currentReceiptTransactionId || h.id === currentReceiptTransactionId));
        if (cIdx !== -1) globalState.globalCateredHistory[cIdx] = cateredHistoryItem;
        else globalState.globalCateredHistory.push(cateredHistoryItem);

        saveRosterCache();
        updateRosterUI();

        window.dispatchEvent(new CustomEvent('cateredUpdated'));
        window.dispatchEvent(new CustomEvent('receiptsUpdated'));
        window.dispatchEvent(new CustomEvent('rosterUpdated'));
    } catch (e) {
        console.error("Firebase write error:", e);
    }
}

function ensureQrCodeLibraryLoaded() {
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

async function generatePureQrImage(payload, size = 480) {
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

function loadImageAsync(src) {
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

// -------------------------------------------------------------
// HIGH DEFINITION (2x RETINA) IMAGE RECEIPT ENGINE
// -------------------------------------------------------------
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
    const customerName = document.getElementById('rcpt-name')?.value.trim() || appState.selectedCateringClient || "Customer";
    const riderName = appState.riderName || localStorage.getItem('riderName') || "Rider";

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

    const gcashName = appState.gcashName || localStorage.getItem('lokalex_gcash_name') || "";
    const gcashNo = appState.gcashNo || localStorage.getItem('lokalex_gcash_no') || "";
    const gcashQrPayload = appState.gcashQrPayload || localStorage.getItem('lokalex_gcash_qr_payload') || "";
    const gcashQrImg = appState.gcashQrImg || localStorage.getItem('lokalex_gcash_qr_img') || "";

    // Dual-Tier HD QR resolution: Tier 1 (Vector QR) or Tier 2 (Cropped Matrix)
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

    // Standard logical canvas width
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

    // Allocate ample height for the enlarged HD QR Card (180px QR + padding)
    const gcashBoxHeight = hasQrDrawn ? 224 : 88;
    if (hasGcashDetails) {
        estimatedHeight += gcashBoxHeight + 24;
    }
    estimatedHeight += 110;

    // 2x Retina Super-Sampling for crystal-clear HD export
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

    // Accent Top Bar
    ctx.fillStyle = "#2563eb";
    ctx.fillRect(0, 0, width, 12);

    let y = 46;

    // Header Title
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

    // Meta Badge
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
    ctx.fillText(`#${currentReceiptTransactionId.slice(-14)}`, width - 50, y + 54);

    y += 98;

    // Table Header
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

            ctx.textAlign = "left";
            ctx.fillStyle = isPaid ? "#64748b" : "#1e293b";
            ctx.font = isPaid ? "600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" : "700 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

            ctx.fillText(`•  ${item.name || 'Item'}`, 44, y);

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

    // 1. COD Cash Total Card
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

    // 2. GCash Total Card
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

    // GCash Payment Block & Large HD QR Code
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
            // Enlarged HD QR Code (180px x 180px)
            const qrSize = 180;
            const qrX = 50;
            const qrY = y + 22;

            // Crisp white background & border
            ctx.fillStyle = "#FFFFFF";
            ctx.strokeStyle = "#cbd5e1";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, 12);
            ctx.fill();
            ctx.stroke();

            ctx.drawImage(preloadedQrImage, qrX, qrY, qrSize, qrSize);

            // Adjacent Account Details (vertically balanced)
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

export function downloadReceiptImage() {
    if (!currentReceiptDataUrl) {
        return showToast("⚠️ Image receipt not ready yet.");
    }

    const a = document.createElement('a');
    a.href = currentReceiptDataUrl;
    const txId = currentReceiptTransactionId || Date.now().toString(36);
    a.download = `Lokalex_Receipt_${txId}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("💾 High Definition receipt saved to device!");
}

export function renderFinalReceiptText() {
    const dateStr = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const currentCart = getCurrentCart() || [];
    const dailyRiderId = getDailyRiderId();

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

    let itemsTxt = (currentCart.length > 0)
        ? currentCart.map(i => {
            const isPaid = !!i.isPaid || (parseFloat(i.price) || 0) <= 0;
            if (isPaid) {
                return `🔸 ${i.name || 'Item'} - PAID (₱0.00)`;
            }
            return `🔸 ${i.name || 'Item'} - ₱${Math.max(0, parseFloat(i.price) || 0).toFixed(2)}`;
        }).join("\n")
        : "🔸 (Walang items)";

    let feesTxt = "";
    if (finalHFee > 0) feesTxt += `🔹 Handling Fee: ₱${finalHFee.toFixed(2)}\n`;
    if (finalMFee > 0) feesTxt += `🔹 Market Fee: ₱${finalMFee.toFixed(2)}\n`;
    if (finalMulti > 0) feesTxt += `🔹 Multistore Fee: ₱${finalMulti.toFixed(2)}\n`;
    if (deliveryFee > 0) feesTxt += `🔹 Delivery Fee: ₱${deliveryFee.toFixed(2)}\n`;
    if (discount > 0) {
        if (isPercent) {
            feesTxt += `🔻 Discount (${rawDiscVal}%): -₱${discount.toFixed(2)}\n`;
        } else {
            feesTxt += `🔻 Discount: -₱${discount.toFixed(2)}\n`;
        }
    }

    if (!feesTxt) feesTxt = "🔹 Wala pong karagdagang fees.\n";

    const gcashName = appState.gcashName || localStorage.getItem('lokalex_gcash_name') || "";
    const gcashNo = appState.gcashNo || localStorage.getItem('lokalex_gcash_no') || "";

    let gcashTxt = "";
    if (gcashName || gcashNo) {
        gcashTxt = 
`\n📱 **GCASH PAYMENT DETAILS:**
👤 Account Name: ${gcashName || 'N/A'}
📱 GCash Number: \`${gcashNo || 'N/A'}\`
➖➖➖➖➖➖➖➖➖➖➖➖\n`;
    }

    const receiptEl = document.getElementById('final-receipt-text');
    if (receiptEl) {
        receiptEl.innerText = 
`🧾 **LOKALEX OFFICIAL RECEIPT** 🧾

📅 **Date:** ${dateStr}
🛵 **Rider:** ${appState.riderName || 'Rider'}
🔑 **Rider ID:** \`${dailyRiderId}\`
➖➖➖➖➖➖➖➖➖➖➖➖
🛍️ **ITEMS:**
${itemsTxt}

💵 **Subtotal:** ₱${subtotal.toFixed(2)}
➖➖➖➖➖➖➖➖➖➖➖➖
📋 **FEES:**
${feesTxt}➖➖➖➖➖➖➖➖➖➖➖➖
💰 **COD TOTAL (Cash): ₱${codTotal.toFixed(2)}**
📱 **GCASH TOTAL (+₱${epayFee.toFixed(2)} Fee): ₱${gcashTotal.toFixed(2)}**
➖➖➖➖➖➖➖➖➖➖➖➖${gcashTxt}
💙 Salamat sa pagtitiwala sa Lokalex!`;
    }
}

export function completeReceiptDone() {
    const activeCartIdx = globalState.activeCartIndex || 0;
    const activeSlot = activeCartIdx + 1;

    if (!globalState.cartLocked) globalState.cartLocked = [false, false, false, false];
    globalState.cartLocked[activeCartIdx] = true;

    if (!globalState.cartTxIds) globalState.cartTxIds = ["", "", "", ""];
    globalState.cartTxIds[activeCartIdx] = currentReceiptTransactionId;

    if (!multiCarts[activeSlot]) {
        multiCarts[activeSlot] = { items: [], selectedIds: new Set(), customerName: "", isManual: false, txId: "" };
    }

    const totalFees = Math.max(0, (wizState.finalHFee || 0) + (wizState.finalMFee || 0) + (wizState.finalMulti || 0) + (wizState.deliveryFee || 0) - (wizState.discount || 0));

    multiCarts[activeSlot].receiptSummary = {
        subtotal: wizState.subtotal || 0,
        totalFees: totalFees,
        deliveryFee: wizState.deliveryFee || 0,
        codTotal: wizState.codTotal || wizState.finalTotal || 0,
        gcashTotal: wizState.gcashTotal || 0,
        customerName: document.getElementById('rcpt-name')?.value.trim() || appState.selectedCateringClient || "Customer",
        txId: currentReceiptTransactionId,
        timestamp: Date.now()
    };

    saveCartState();

    currentReceiptTransactionId = "";
    
    switchView('view-home');
    
    renderCartTabs();
    renderCartItems();

    showToast("✅ Resibo naisumite na! Naka-lock ang Cart barrier protection.");

    wizState.subtotal = 0;
    wizState.storeCount = 1;
    wizState.discountType = 'amount';
    wizState.rawDiscountVal = 0;
    appState.selectedCateringClient = "";

    const handlingEl = document.getElementById('wiz-handling');
    const marketEl = document.getElementById('wiz-market');
    const multistopEl = document.getElementById('wiz-multistop');
    const deliveryEl = document.getElementById('wiz-delivery');
    const discountEl = document.getElementById('wiz-discount');
    const freeDelivEl = document.getElementById('wiz-free-delivery');

    if(handlingEl) handlingEl.value = "";
    if(marketEl) marketEl.value = "";
    if(multistopEl) multistopEl.value = "0";
    if(deliveryEl) deliveryEl.value = "";
    if(discountEl) discountEl.value = "";
    if(freeDelivEl) freeDelivEl.checked = false;
    
    updateDiscountTypeUI();
}

export function copyFinalReceipt() {
    const textEl = document.getElementById('final-receipt-text');
    if (textEl && textEl.innerText) {
        copyText(textEl.innerText);
    }
}

if (typeof window !== 'undefined') {
    window.proceedToWizard = proceedToWizard;
    window.selectCateredClientName = selectCateredClientName;
    window.toggleManualClientInput = toggleManualClientInput;
    window.adjustStoreCount = adjustStoreCount;
    window.toggleDiscountType = toggleDiscountType;
    window.updateDiscountTypeUI = updateDiscountTypeUI;
    window.calculateGrandTotal = calculateGrandTotal;
    window.generateFinalReceipt = generateFinalReceipt;
    window.confirmSampleReceiptProceed = confirmSampleReceiptProceed;
    window.completeReceiptDone = completeReceiptDone;
    window.copyFinalReceipt = copyFinalReceipt;
    window.renderReceiptCanvas = renderReceiptCanvas;
    window.downloadReceiptImage = downloadReceiptImage;
}