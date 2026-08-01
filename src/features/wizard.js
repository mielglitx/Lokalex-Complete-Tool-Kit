// src/features/wizard.js
import { appState, globalState, wizState } from '../store/state.js';
import { getLocalTodayStr, copyText, escapeHtml } from '../utils/helpers.js';
import { showToast, showSideNotification } from '../ui/notifications.js';
import { switchView } from '../ui/router.js';
import { saveCartState, getCurrentCart, clearCartSlot } from './cart.js';
import { getActiveCateringCustomersWithTimes } from './roster.js';
import { API_URL } from '../config/constants.js';

let currentReceiptTransactionId = "";

export function getDailyRiderId() {
    const rName = (appState.riderName || appState.telegramId || "RIDER").replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const dateClean = getLocalTodayStr().replace(/-/g, '');
    const seed = `${rName}_${dateClean}_LOKALEX_RID`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let code = ""; let temp = hash;
    for (let j = 0; j < 5; j++) { code += chars[temp % chars.length]; temp = Math.floor(temp / chars.length) + (j * 17); }
    return `RID-${code}`;
}

export function proceedToWizard() {
    switchView('view-wizard');
    initWizardForCart();
}

export function initWizardForCart() {
    const currentCart = getCurrentCart(); // Returns the raw items array
    if (!currentCart || currentCart.length === 0) return;

    currentReceiptTransactionId = getDailyRiderId() + "-" + Date.now().toString(36).toUpperCase();

    // Map through array and calculate sums, ensuring case-insensitivity
    const marketSum = currentCart.filter(i => (i.category || i.type || '').toLowerCase() === 'market').reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
    const storeSum = currentCart.filter(i => (i.category || i.type || '').toLowerCase() === 'store').reduce((s, i) => s + (parseFloat(i.price) || 0), 0);

    wizState.subtotal = marketSum + storeSum;
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
    calculateGrandTotal();
}

function setupWizardClientDetails() {
    const btnBox = document.getElementById('catered-client-buttons');
    const rcptInput = document.getElementById('rcpt-name');
    const toggleManual = document.getElementById('manual-client-toggle');

    if (!rcptInput || !btnBox || !toggleManual) return;

    // Use appState.selectedCateringClient which was set in the Cart UI
    if (appState.selectedCateringClient && appState.selectedCateringClient !== "") {
        rcptInput.value = appState.selectedCateringClient;
        rcptInput.disabled = true;
        toggleManual.checked = false;
        
        const cartSlotDisplay = (globalState.activeCartIndex || 0) + 1;
        btnBox.innerHTML = `
            <button onclick="selectCateredClientName('${escapeHtml(appState.selectedCateringClient)}')" class="bg-blue-600 border border-blue-400 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow transition active:scale-95">
                <i class="fa-solid fa-user"></i> ${escapeHtml(appState.selectedCateringClient)} (Cart ${cartSlotDisplay})
            </button>`;
    } else {
        const activeCustList = getActiveCateringCustomersWithTimes();
        if (activeCustList.length === 0) {
            rcptInput.value = "Sample";
            rcptInput.disabled = false;
            toggleManual.checked = true;
            btnBox.innerHTML = `<span class="text-amber-400 text-xs font-semibold"><i class="fa-solid fa-user-pen"></i> Type customer name manually below or leave empty for Sample.</span>`;
        } else {
            btnBox.innerHTML = activeCustList.map(i => `
                <button onclick="selectCateredClientName('${escapeHtml(i.name)}')" class="bg-blue-600/30 border border-blue-500 text-blue-300 text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-blue-600 hover:text-white transition active:scale-95">
                    <i class="fa-solid fa-user"></i> ${escapeHtml(i.name)}
                </button>
            `).join('');
            rcptInput.value = activeCustList[0].name || "";
            rcptInput.disabled = true;
            appState.selectedCateringClient = activeCustList[0].name || "";
        }
    }
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
            appState.selectedCateringClient = ""; // Clear state if user wants to type
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

export function calculateGrandTotal() {
    const freeDeliveryEl = document.getElementById('wiz-free-delivery');
    const epaymentEl = document.getElementById('wiz-epayment');
    const isFree = freeDeliveryEl ? freeDeliveryEl.checked : false;
    const isEpay = epaymentEl ? epaymentEl.checked : false;

    let hFee = parseFloat(document.getElementById('wiz-handling')?.value) || 0;
    let mFee = parseFloat(document.getElementById('wiz-market')?.value) || 0;
    let multistop = parseFloat(document.getElementById('wiz-multistop')?.value) || 0;
    let dFee = parseFloat(document.getElementById('wiz-delivery')?.value) || 0;
    let disc = parseFloat(document.getElementById('wiz-discount')?.value) || 0;

    if (isFree) {
        hFee = 0; mFee = 0; multistop = 0; dFee = 0;
    }

    const subtotal = wizState.subtotal || 0;
    let total = subtotal + hFee + mFee + multistop + dFee - disc;

    let epayFee = 0;
    if (isEpay && total > 0) {
        epayFee = total <= 1000 ? 15 : 15 + Math.ceil((total - 1000) / 500) * 5;
        total += epayFee;
    }

    const storeCountEl = document.getElementById('wiz-store-count');
    const epayDisplayEl = document.getElementById('epayment-fee-display');
    const grandTotalEl = document.getElementById('wiz-grand-total');

    if (storeCountEl) storeCountEl.innerText = isFree ? "0" : (wizState.storeCount || 1);
    if (epayDisplayEl) epayDisplayEl.innerText = isEpay ? `Added: ₱${epayFee.toFixed(2)}` : "Magbabayad ng Cash";
    if (grandTotalEl) grandTotalEl.innerText = total.toFixed(2);

    wizState.finalHFee = hFee;
    wizState.finalMFee = mFee;
    wizState.finalMulti = multistop;
    wizState.deliveryFee = dFee;
    wizState.discount = disc;
    wizState.finalEpay = epayFee;
    wizState.finalTotal = total;
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

    await saveReceiptToDatabase(customerName);

    switchView('view-receipt-final');
    renderFinalReceiptText();
}

async function saveReceiptToDatabase(customerName) {
    if (!customerName || customerName.trim().toLowerCase() === "sample") {
        showToast("ℹ️ Sample Receipt generated (Not saved to commission).");
        return;
    }

    const cName = customerName.trim().toLowerCase();
    const rName = (appState.riderName || "").trim().toLowerCase();
    const todayStr = getLocalTodayStr();

    const activeCustList = getActiveCateringCustomersWithTimes();
    const match = activeCustList.find(i => i.name.trim().toLowerCase() === cName);
    const sTime = match ? match.startTime.trim() : "";

    const sessionKey = `receipt_done_${rName}_${cName}_${sTime}_${todayStr}`;
    localStorage.setItem(sessionKey, 'true');

    const totalFees = (wizState.finalHFee || 0) + (wizState.finalMFee || 0) + (wizState.finalMulti || 0) + (wizState.deliveryFee || 0) - (wizState.discount || 0);

    const payload = {
        type: "receipts",
        transactionId: currentReceiptTransactionId,
        telegramId: appState.telegramId,
        riderName: appState.riderName,
        customerName: customerName,
        cateringStartTime: sTime,
        fees: {
            handling: wizState.finalHFee || 0,
            market: wizState.finalMFee || 0,
            multistore: wizState.finalMulti || 0,
            delivery: wizState.deliveryFee || 0,
            discount: wizState.discount || 0
        },
        totalFees: totalFees,
        date: todayStr
    };
    try {
        fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
    } catch(e) {}
}

export function renderFinalReceiptText() {
    const dateStr = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const currentCart = getCurrentCart() || [];
    const dailyRiderId = getDailyRiderId();

    const subtotal = (wizState.subtotal !== undefined ? wizState.subtotal : 0);
    const finalHFee = wizState.finalHFee || 0;
    const finalMFee = wizState.finalMFee || 0;
    const finalMulti = wizState.finalMulti || 0;
    const deliveryFee = wizState.deliveryFee || 0;
    const finalEpay = wizState.finalEpay || 0;
    const discount = wizState.discount || 0;
    const finalTotal = (wizState.finalTotal !== undefined ? wizState.finalTotal : 0);

    // FIX: Using i.name instead of i.item so the actual items print out properly
    let itemsTxt = (currentCart.length > 0)
        ? currentCart.map(i => `🔸 ${i.name || 'Item'} - ₱${(parseFloat(i.price) || 0).toFixed(2)}`).join("\n")
        : "🔸 (Walang items)";

    let feesTxt = "";
    if (finalHFee > 0) feesTxt += `🔹 Handling Fee: ₱${finalHFee.toFixed(2)}\n`;
    if (finalMFee > 0) feesTxt += `🔹 Market Fee: ₱${finalMFee.toFixed(2)}\n`;
    if (finalMulti > 0) feesTxt += `🔹 Multistore Fee: ₱${finalMulti.toFixed(2)}\n`;
    if (deliveryFee > 0) feesTxt += `🔹 Delivery Fee: ₱${deliveryFee.toFixed(2)}\n`;
    if (finalEpay > 0) feesTxt += `🔹 ePayment Processing Fee: ₱${finalEpay.toFixed(2)}\n`;
    if (discount > 0) feesTxt += `🔻 Discount: -₱${discount.toFixed(2)}\n`;

    if (!feesTxt) feesTxt = "🔹 Wala pong karagdagang fees.\n";

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
🔥 **GRAND TOTAL: ₱${finalTotal.toFixed(2)}** 🔥

💙 Salamat sa pagtitiwala sa Lokalex!`;
    }
}

export function completeReceiptDone() {
    clearCartSlot();
    currentReceiptTransactionId = "";
    showToast("✅ Cart cleared and final receipt accepted!");
    switchView('view-home');
    
    // Reset all wizState variables and UI so the next cart starts fresh
    wizState.subtotal = 0;
    wizState.storeCount = 1;
    appState.selectedCateringClient = "";

    const handlingEl = document.getElementById('wiz-handling');
    const marketEl = document.getElementById('wiz-market');
    const multistopEl = document.getElementById('wiz-multistop');
    const deliveryEl = document.getElementById('wiz-delivery');
    const discountEl = document.getElementById('wiz-discount');
    const epaymentEl = document.getElementById('wiz-epayment');
    const freeDelivEl = document.getElementById('wiz-free-delivery');

    if(handlingEl) handlingEl.value = "";
    if(marketEl) marketEl.value = "";
    if(multistopEl) multistopEl.value = "0";
    if(deliveryEl) deliveryEl.value = "";
    if(discountEl) discountEl.value = "";
    if(epaymentEl) epaymentEl.checked = false;
    if(freeDelivEl) freeDelivEl.checked = false;
}

export function copyFinalReceipt() {
    const textEl = document.getElementById('final-receipt-text');
    if (textEl && textEl.innerText) {
        copyText(textEl.innerText);
    }
}