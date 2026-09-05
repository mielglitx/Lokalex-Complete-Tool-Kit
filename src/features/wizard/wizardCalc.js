// src/features/wizard/wizardCalc.js
import { appState, globalState, wizState } from '../../store/state.js';
import { getLocalTodayStr, escapeHtml } from '../../utils/helpers.js';
import { showToast } from '../../ui/notifications.js';
import { switchView } from '../../ui/router.js';
import { getCurrentCart, getEffectiveCartClient } from '../cart.js';

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
        wizState.currentReceiptTransactionId = globalState.cartTxIds[activeCartIdx];
    } else {
        wizState.currentReceiptTransactionId = getDailyRiderId() + "-" + Date.now().toString(36).toUpperCase();
        if (!globalState.cartTxIds) globalState.cartTxIds = ["", "", "", ""];
        globalState.cartTxIds[activeCartIdx] = wizState.currentReceiptTransactionId;
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

export function setupWizardClientDetails() {
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