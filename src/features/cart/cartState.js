// src/features/cart/cartState.js
import { appState, globalState, multiCarts, activeCartSlot, setActiveCartSlot } from '../../store/state.js';

export function getMyCateringCustomers() {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();
    const rosterMembers = globalState.rosterMembers || [];

    const myRecord = rosterMembers.find(m => 
        (myId && m.telegramId && m.telegramId.toString().trim() === myId) ||
        (myName && m.riderName && m.riderName.toString().trim().toLowerCase() === myName)
    );

    if (!myRecord || !myRecord.customerName || myRecord.status !== 'Catering') {
        return [];
    }

    return myRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
}

export function getCurrentCart() {
    if (!multiCarts[activeCartSlot]) {
        multiCarts[activeCartSlot] = { items: [], selectedIds: new Set(), customerName: "", isManual: false, txId: "", receiptSummary: null };
    }
    return multiCarts[activeCartSlot].items;
}

export function saveCartState() {
    try {
        const serializable = {};
        for (let key in multiCarts) {
            serializable[key] = {
                items: multiCarts[key].items || [],
                customerName: multiCarts[key].customerName || "",
                isManual: !!multiCarts[key].isManual,
                txId: multiCarts[key].txId || "",
                receiptSummary: multiCarts[key].receiptSummary || null
            };
        }
        localStorage.setItem('lokalex_multi_carts_v2', JSON.stringify(serializable));
        localStorage.setItem('lokalex_active_cart_slot', activeCartSlot.toString());
        localStorage.setItem('lokalex_cart_locked_state', JSON.stringify(globalState.cartLocked || [false, false, false, false]));
    } catch(e) {}
}

export function loadCartState() {
    try {
        const savedSlot = localStorage.getItem('lokalex_active_cart_slot');
        if (savedSlot) {
            const slotNum = parseInt(savedSlot) || 1;
            setActiveCartSlot(slotNum);
            globalState.activeCartIndex = slotNum - 1;
        }

        const savedData = localStorage.getItem('lokalex_multi_carts_v2');
        if (savedData) {
            const parsed = JSON.parse(savedData);
            for (let key in parsed) {
                multiCarts[key] = {
                    items: parsed[key].items || [],
                    selectedIds: new Set(),
                    customerName: parsed[key].customerName || "",
                    isManual: !!parsed[key].isManual,
                    txId: parsed[key].txId || "",
                    receiptSummary: parsed[key].receiptSummary || null
                };
            }
        }

        const savedLocks = localStorage.getItem('lokalex_cart_locked_state');
        if (savedLocks) {
            globalState.cartLocked = JSON.parse(savedLocks);
        } else if (!globalState.cartLocked) {
            globalState.cartLocked = [false, false, false, false];
        }
    } catch(e) {}
}

export function getEffectiveCartClient(slotIdx) {
    const slotNum = slotIdx + 1;
    const cartObj = multiCarts[slotNum];
    if (cartObj && cartObj.customerName) return cartObj.customerName;

    const myCustomers = getMyCateringCustomers();
    if (myCustomers[slotIdx]) return myCustomers[slotIdx];

    return "Sample";
}