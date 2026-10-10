// src/features/wizard/wizardTextReceipt.js
import { appState, wizState } from '../../store/state.js';
import { copyText } from '../../utils/helpers.js';
import { getCurrentCart } from '../cart.js';
import { getDailyRiderId } from './wizardCalc.js';
import { formatShortRef, cleanItemDescription } from './wizardImageReceipt.js';

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
            const cleanName = cleanItemDescription(i.name || 'Item');
            if (isPaid) {
                return `🔸 ${cleanName} - PAID (₱0.00)`;
            }
            return `🔸 ${cleanName} - ₱${Math.max(0, parseFloat(i.price) || 0).toFixed(2)}`;
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
`\n📱 **ePAYMENT DETAILS:**
👤 Account Name: ${gcashName || 'N/A'}
📱 Mobile / Account No: \`${gcashNo || 'N/A'}\`
➖➖➖➖➖➖➖➖➖➖➖➖\n`;
    }

    const rawTxId = wizState.currentReceiptTransactionId || "";
    const shortRef = formatShortRef(rawTxId);

    const receiptEl = document.getElementById('final-receipt-text');
    if (receiptEl) {
        receiptEl.innerText = 
`🧾 **LOKALEX OFFICIAL RECEIPT** 🧾

🔖 **Ref #:** \`#${shortRef}\`
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
📱 **ePAYMENT TOTAL (+₱${epayFee.toFixed(2)} Fee): ₱${gcashTotal.toFixed(2)}**
➖➖➖➖➖➖➖➖➖➖➖➖${gcashTxt}
💙 Salamat sa pagtitiwala sa Lokalex!`;
    }
}

export function copyFinalReceipt() {
    const textEl = document.getElementById('final-receipt-text');
    if (textEl && textEl.innerText) {
        copyText(textEl.innerText);
    }
}