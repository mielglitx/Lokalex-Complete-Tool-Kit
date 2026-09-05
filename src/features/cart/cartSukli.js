// src/features/cart/cartSukli.js
import { multiCarts, activeCartSlot } from '../../store/state.js';

let activeSukliSlot = 1;

export function openSukliCalculatorModal(slot = activeCartSlot) {
    activeSukliSlot = slot;
    const modal = document.getElementById('sukli-calculator-modal');
    const labelEl = document.getElementById('sukli-cart-label');
    const totalDisplay = document.getElementById('sukli-order-total-display');
    const cashInput = document.getElementById('sukli-cash-input');

    const cartObj = multiCarts[slot] || {};
    const summary = cartObj.receiptSummary || {};
    
    let codTotal = parseFloat(summary.codTotal) || 0;
    if (codTotal <= 0 && cartObj.items) {
        codTotal = cartObj.items.reduce((s, it) => s + (it.isPaid ? 0 : (parseFloat(it.price) || 0)), 0);
    }

    if (labelEl) labelEl.innerText = `Cart ${slot} (${cartObj.customerName || 'Customer'})`;
    if (totalDisplay) totalDisplay.innerText = `₱${codTotal.toFixed(2)}`;
    if (cashInput) cashInput.value = '';

    calculateSukli();

    if (modal) {
        modal.classList.remove('hidden');
        if (cashInput) setTimeout(() => cashInput.focus(), 80);
    }
}

export function closeSukliCalculatorModal() {
    const modal = document.getElementById('sukli-calculator-modal');
    if (modal) modal.classList.add('hidden');
}

export function calculateSukli() {
    const cartObj = multiCarts[activeSukliSlot] || {};
    const summary = cartObj.receiptSummary || {};

    let codTotal = parseFloat(summary.codTotal) || 0;
    if (codTotal <= 0 && cartObj.items) {
        codTotal = cartObj.items.reduce((s, it) => s + (it.isPaid ? 0 : (parseFloat(it.price) || 0)), 0);
    }

    const cashInput = document.getElementById('sukli-cash-input');
    const tendered = parseFloat(cashInput?.value) || 0;

    const change = tendered - codTotal;
    const displayEl = document.getElementById('sukli-amount-display');
    const shortageEl = document.getElementById('sukli-shortage-msg');
    const resultBox = document.getElementById('sukli-result-box');

    if (!displayEl) return;

    if (tendered <= 0) {
        displayEl.innerText = `₱0.00`;
        if (shortageEl) shortageEl.classList.add('hidden');
        if (resultBox) {
            resultBox.className = "bg-gray-100 dark:bg-darkBg border border-gray-200 dark:border-gray-800 p-3 rounded-2xl flex flex-col items-center justify-center text-center";
        }
    } else if (change >= 0) {
        displayEl.innerText = `₱${change.toFixed(2)}`;
        if (shortageEl) shortageEl.classList.add('hidden');
        if (resultBox) {
            resultBox.className = "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/40 p-3 rounded-2xl flex flex-col items-center justify-center text-center";
        }
    } else {
        displayEl.innerText = `-₱${Math.abs(change).toFixed(2)}`;
        if (shortageEl) shortageEl.classList.remove('hidden');
        if (resultBox) {
            resultBox.className = "bg-red-50 dark:bg-red-950/40 border border-red-500/40 p-3 rounded-2xl flex flex-col items-center justify-center text-center";
        }
    }
}

export function setQuickTendered(val) {
    const cashInput = document.getElementById('sukli-cash-input');
    if (!cashInput) return;

    if (val === 'clear') {
        cashInput.value = '';
    } else if (val === 'exact') {
        const cartObj = multiCarts[activeSukliSlot] || {};
        const summary = cartObj.receiptSummary || {};
        let codTotal = parseFloat(summary.codTotal) || 0;
        if (codTotal <= 0 && cartObj.items) {
            codTotal = cartObj.items.reduce((s, it) => s + (it.isPaid ? 0 : (parseFloat(it.price) || 0)), 0);
        }
        cashInput.value = codTotal > 0 ? codTotal.toFixed(2) : '0';
    } else {
        cashInput.value = parseFloat(val).toFixed(2);
    }

    calculateSukli();
}