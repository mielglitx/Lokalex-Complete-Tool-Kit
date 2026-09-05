// src/features/wizard/wizardCore.js
import { appState, globalState, wizState, multiCarts } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { getLocalTodayStr } from '../../utils/helpers.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { switchView } from '../../ui/router.js';
import { saveCartState, renderCartItems, renderCartTabs } from '../cart.js';
import { getActiveCateringCustomersWithTimes, calculateSplitDuration, saveRosterCache, updateRosterUI } from '../roster/index.js';
import { calculateGrandTotal, updateDiscountTypeUI } from './wizardCalc.js';
import { renderFinalReceiptText } from './wizardTextReceipt.js';
import { renderReceiptCanvas } from './wizardImageReceipt.js';

export function isRiderActivelyCatering() {
    const myId = (appState.telegramId || "").toString();
    const myRecord = globalState.rosterMembers ? globalState.rosterMembers.find(m => (m.telegramId || "").toString() === myId) : null;
    return myRecord && myRecord.status === 'Catering';
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

export async function saveReceiptToDatabase(customerName) {
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

    const generatedTxId = `RCPT_${cleanRiderKey}_${cleanCustKey}_${todayClean}_${cleanTimeKey || '1'}`;
    wizState.currentReceiptTransactionId = generatedTxId;

    const activeCartIdx = globalState.activeCartIndex || 0;
    if (!globalState.cartTxIds) globalState.cartTxIds = ["", "", "", ""];
    globalState.cartTxIds[activeCartIdx] = generatedTxId;

    const receiptPayload = {
        id: generatedTxId,
        key: generatedTxId,
        type: "receipts",
        transactionId: generatedTxId,
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
        id: generatedTxId,
        key: generatedTxId,
        transactionId: generatedTxId,
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
            await db.ref('receipts/' + generatedTxId).set(receiptPayload);
            await db.ref('cateredHistory/' + generatedTxId).set(cateredHistoryItem);

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
                    transactionId: generatedTxId
                });
            }
        }

        if (!globalState.globalDailyReceipts) globalState.globalDailyReceipts = [];
        const rIdx = globalState.globalDailyReceipts.findIndex(r => (r.transactionId === generatedTxId || r.id === generatedTxId));
        if (rIdx !== -1) globalState.globalDailyReceipts[rIdx] = receiptPayload;
        else globalState.globalDailyReceipts.push(receiptPayload);

        if (!globalState.globalCateredHistory) globalState.globalCateredHistory = [];
        const cIdx = globalState.globalCateredHistory.findIndex(h => (h.transactionId === generatedTxId || h.id === generatedTxId));
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

export function completeReceiptDone() {
    const activeCartIdx = globalState.activeCartIndex || 0;
    const activeSlot = activeCartIdx + 1;

    if (!globalState.cartLocked) globalState.cartLocked = [false, false, false, false];
    globalState.cartLocked[activeCartIdx] = true;

    const currentTx = wizState.currentReceiptTransactionId || "";

    if (!globalState.cartTxIds) globalState.cartTxIds = ["", "", "", ""];
    globalState.cartTxIds[activeCartIdx] = currentTx;

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
        txId: currentTx,
        timestamp: Date.now()
    };

    saveCartState();

    wizState.currentReceiptTransactionId = "";
    
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

    if (handlingEl) handlingEl.value = "";
    if (marketEl) marketEl.value = "";
    if (multistopEl) multistopEl.value = "0";
    if (deliveryEl) deliveryEl.value = "";
    if (discountEl) discountEl.value = "";
    if (freeDelivEl) freeDelivEl.checked = false;
    
    updateDiscountTypeUI();
}