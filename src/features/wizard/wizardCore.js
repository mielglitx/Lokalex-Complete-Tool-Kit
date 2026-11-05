// src/features/wizard/wizardCore.js
import { appState, globalState, wizState, multiCarts } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { getLocalTodayStr, sanitizeFirebaseKey } from '../../utils/helpers.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { switchView } from '../../ui/router.js';
import { saveCartState, renderCartItems, renderCartTabs } from '../cart.js';
import { getActiveCateringCustomersWithTimes, calculateSplitDuration, saveRosterCache, updateRosterUI } from '../roster/index.js';
import { isCustomerMatch, invalidateRosterGrossCache } from '../roster/rosterUtils.js';
import { calculateGrandTotal, updateDiscountTypeUI } from './wizardCalc.js';
import { renderFinalReceiptText } from './wizardTextReceipt.js';
import { renderReceiptCanvas, formatShortRef } from './wizardImageReceipt.js';

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
        showToast("⚠️ Please enter Rider Delivery Fee before generating receipt!");
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
    const sendBtn = document.getElementById('send-receipt-to-cust-btn');
    if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.className = "bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-1.5 rounded-xl shadow-lg flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 transition active:scale-95 text-center cursor-pointer";
        sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane text-xs shrink-0"></i><span class="text-[11px] leading-tight">Send to Customer</span>`;
    }
    renderFinalReceiptText();
    await renderReceiptCanvas();
}

export async function saveReceiptToDatabase(customerName) {
    if (!customerName || customerName.trim().toLowerCase() === "sample") {
        showToast("ℹ️ Sample Receipt generated (Not saved to commission/catered list).");
        return;
    }

    const cName = customerName.trim();
    const cleanCustKey = sanitizeFirebaseKey(cName);
    let rName = (appState.riderName || localStorage.getItem('riderName') || "").trim();
    let telegramId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const todayStr = getLocalTodayStr();
    const todayClean = todayStr.replace(/-/g, '');
    const currentTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const activeCustList = getActiveCateringCustomersWithTimes();
    let match = activeCustList.find(i => i.name.trim().toLowerCase() === cName.toLowerCase() || isCustomerMatch(i.name, cName));

    if (!match && globalState.rosterMembers && Array.isArray(globalState.rosterMembers)) {
        const cateringMember = globalState.rosterMembers.find(m => {
            if (!m || m.status !== 'Catering') return false;
            if (m.customerName) {
                const names = m.customerName.split(',').map(s => s.trim()).filter(Boolean);
                if (names.some(n => n.toLowerCase() === cName.toLowerCase() || isCustomerMatch(n, cName))) return true;
            }
            if (m.forcedCaters && typeof m.forcedCaters === 'object') {
                for (const [fKey, fVal] of Object.entries(m.forcedCaters)) {
                    const fName = (fVal && typeof fVal === 'object' && fVal.customerName) ? fVal.customerName : fKey;
                    if (fName && (fName.trim().toLowerCase() === cName.toLowerCase() || isCustomerMatch(fName, cName))) return true;
                }
            }
            return false;
        });
        if (cateringMember) {
            rName = (cateringMember.riderName || cateringMember.name || rName).trim();
            telegramId = (cateringMember.telegramId || cateringMember.id || telegramId).toString().trim();
            if (cateringMember.startTime) {
                match = { name: cName, startTime: cateringMember.startTime };
            }
        }
    }

    const cleanRiderKey = rName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const sTime = match && match.startTime ? match.startTime.trim() : currentTimeStr;
    const cleanTimeKey = sTime.replace(/[^a-z0-9]/gi, '');
    const custCount = Math.max(1, activeCustList.length || 1);
    const splitDuration = calculateSplitDuration(sTime, currentTimeStr, custCount);

    const sessionKey = `receipt_done_${cleanRiderKey}_${cleanCustKey}_${sTime}_${todayStr}`;
    localStorage.setItem(sessionKey, 'true');
    localStorage.setItem(`receipt_done_${cleanRiderKey}_${cleanCustKey}_${todayStr}`, 'true');

    const totalFees = Math.max(0, (wizState.finalHFee || 0) + (wizState.finalMFee || 0) + (wizState.finalMulti || 0) + (wizState.deliveryFee || 0) - (wizState.discount || 0));

    const generatedTxId = `RCPT_${cleanRiderKey}_${cleanCustKey}_${todayClean}_${cleanTimeKey || '1'}`;
    wizState.currentReceiptTransactionId = generatedTxId;
    const shortRef = formatShortRef(generatedTxId);
    wizState.shortReceiptRef = shortRef;

    const activeCartIdx = globalState.activeCartIndex || 0;
    if (!globalState.cartTxIds) globalState.cartTxIds = ["", "", "", ""];
    globalState.cartTxIds[activeCartIdx] = generatedTxId;

    const receiptPayload = {
        id: generatedTxId,
        key: generatedTxId,
        type: "receipts",
        transactionId: generatedTxId,
        shortRef: shortRef,
        telegramId: telegramId,
        riderName: rName,
        customerName: cName,
        cateringStartTime: sTime,
        startTime: sTime,
        receiptTime: currentTimeStr,
        completedTime: "",
        doneTime: "",
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

    try {
        if (db) {
            await db.ref('receipts/' + generatedTxId).set(receiptPayload);

            const riderKey = (telegramId || rName || "rider").toString().replace(/[^a-zA-Z0-9_-]/g, '_');
            db.ref('roster/' + riderKey).update({
                lastReceiptFees: receiptPayload.fees,
                lastReceiptTotalFees: totalFees
            });

            if (cleanCustKey) {
                db.ref(`roster/${riderKey}/customerFees/${cleanCustKey}`).set({
                    customerName: cName,
                    totalFees: totalFees,
                    fees: receiptPayload.fees,
                    transactionId: generatedTxId,
                    shortRef: shortRef,
                    receiptTime: currentTimeStr
                });
            }
        }

        if (!globalState.globalDailyReceipts) globalState.globalDailyReceipts = [];
        const rIdx = globalState.globalDailyReceipts.findIndex(r => (r.transactionId === generatedTxId || r.id === generatedTxId));
        if (rIdx !== -1) globalState.globalDailyReceipts[rIdx] = receiptPayload;
        else globalState.globalDailyReceipts.push(receiptPayload);

        invalidateRosterGrossCache();
        saveRosterCache();
        updateRosterUI();

        window.dispatchEvent(new CustomEvent('cateredUpdated'));
        window.dispatchEvent(new CustomEvent('receiptsUpdated'));
        window.dispatchEvent(new CustomEvent('rosterUpdated'));
    } catch (e) {
        console.error("Firebase write error:", e);
    }
}

export function completeReceiptDone(customerNameOverride = null) {
    const activeCartIdx = globalState.activeCartIndex || 0;
    const activeSlot = activeCartIdx + 1;

    if (!globalState.cartLocked) globalState.cartLocked = [];
    globalState.cartLocked[activeCartIdx] = true;

    const currentTx = wizState.currentReceiptTransactionId || "";

    if (!globalState.cartTxIds) globalState.cartTxIds = [];
    globalState.cartTxIds[activeCartIdx] = currentTx;

    if (!multiCarts[activeSlot]) {
        multiCarts[activeSlot] = { items: [], selectedIds: new Set(), customerName: "", isManual: false, txId: "" };
    }

    const totalFees = Math.max(0, (wizState.finalHFee || 0) + (wizState.finalMFee || 0) + (wizState.finalMulti || 0) + (wizState.deliveryFee || 0) - (wizState.discount || 0));
    const resolvedCustName = (customerNameOverride || document.getElementById('rcpt-name')?.value.trim() || appState.selectedCateringClient || multiCarts[activeSlot]?.customerName || "Customer").trim();

    multiCarts[activeSlot].receiptSummary = {
        subtotal: wizState.subtotal || 0,
        totalFees: totalFees,
        deliveryFee: wizState.deliveryFee || 0,
        codTotal: wizState.codTotal || wizState.finalTotal || 0,
        gcashTotal: wizState.gcashTotal || 0,
        customerName: resolvedCustName,
        txId: currentTx,
        shortRef: formatShortRef(currentTx),
        timestamp: Date.now()
    };

    saveCartState();

    wizState.currentReceiptTransactionId = "";
    wizState.shortReceiptRef = "";
    
    switchView('view-home');
    
    renderCartTabs();
    renderCartItems();

    showToast("✅ Receipt submitted! Cart barrier protection is locked.");

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