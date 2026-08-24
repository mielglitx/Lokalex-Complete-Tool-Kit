// src/features/wizard.js
import { appState, globalState, wizState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { getLocalTodayStr, copyText, escapeHtml, isSameDate } from '../utils/helpers.js';
import { showToast, showSideNotification } from '../ui/notifications.js';
import { switchView } from '../ui/router.js';
import { saveCartState, getCurrentCart, clearCartSlot, getEffectiveCartClient, renderCartItems, renderCartTabs } from './cart.js';
import { getActiveCateringCustomersWithTimes, saveRosterCache, updateRosterUI } from './roster/index.js';

let currentReceiptTransactionId = "";

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
    let code = ""; let temp = hash;
    for (let j = 0; j < 5; j++) { code += chars[temp % chars.length]; temp = Math.floor(temp / chars.length) + (j * 17); }
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
        hFee = 0; mFee = 0; multistop = 0; dFee = 0;
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

export function executeGenerateFinalReceipt(customerName) {
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
        customerCount: activeCustList.length || 1,
        duration: "Just now",
        totalFees: totalFees,
        fees: receiptPayload.fees
    };

    try {
        if (db) {
            // 1. Save receipt record immediately
            await db.ref('receipts/' + currentReceiptTransactionId).set(receiptPayload);

            // 2. Save catered history record immediately
            await db.ref('cateredHistory/' + currentReceiptTransactionId).set(cateredHistoryItem);

            // 3. Update active roster record fees
            if (appState.telegramId) {
                db.ref('roster/' + appState.telegramId).update({
                    lastReceiptFees: receiptPayload.fees,
                    lastReceiptTotalFees: totalFees
                });

                if (cleanCustKey) {
                    db.ref(`roster/${appState.telegramId}/customerFees/${cleanCustKey}`).set({
                        customerName: cName,
                        totalFees: totalFees,
                        fees: receiptPayload.fees,
                        transactionId: currentReceiptTransactionId
                    });
                }
            }

            // 4. Atomic Daily Summary Ledger Node Update
            const targetSummaryId = (appState.telegramId || cleanRiderKey).toString().trim();
            if (targetSummaryId) {
                const summaryRef = db.ref(`daily_rider_summaries/${todayStr}/${targetSummaryId}`);
                await summaryRef.transaction((current) => {
                    const handling = wizState.finalHFee || 0;
                    const market = wizState.finalMFee || 0;
                    const multistore = wizState.finalMulti || 0;
                    const delivery = wizState.deliveryFee || 0;
                    const discount = wizState.discount || 0;

                    if (!current) {
                        return {
                            riderName: rName,
                            grossIncome: totalFees,
                            deliveryFees: delivery,
                            handlingFees: handling,
                            marketFees: market,
                            multistoreFees: multistore,
                            discounts: discount,
                            completedReceipts: 1,
                            updatedAt: Date.now()
                        };
                    }

                    return {
                        riderName: rName || current.riderName || "",
                        grossIncome: (Number(current.grossIncome) || 0) + totalFees,
                        deliveryFees: (Number(current.deliveryFees) || 0) + delivery,
                        handlingFees: (Number(current.handlingFees) || 0) + handling,
                        marketFees: (Number(current.marketFees) || 0) + market,
                        multistoreFees: (Number(current.multistoreFees) || 0) + multistore,
                        discounts: (Number(current.discounts) || 0) + discount,
                        completedReceipts: (Number(current.completedReceipts) || 0) + 1,
                        updatedAt: Date.now()
                    };
                });
            }
        }

        // 5. Update in-memory state immediately so gross and history reflect without waiting
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

    if (!globalState.cartLocked) globalState.cartLocked = [false, false, false, false];
    globalState.cartLocked[activeCartIdx] = true;

    if (!globalState.cartTxIds) globalState.cartTxIds = ["", "", "", ""];
    globalState.cartTxIds[activeCartIdx] = currentReceiptTransactionId;

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
}
