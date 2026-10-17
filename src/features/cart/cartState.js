// src/features/cart/cartState.js
import { appState, globalState, multiCarts, activeCartSlot, setActiveCartSlot } from '../../store/state.js';
import { isCustomerMatch } from '../roster/rosterUtils.js';

export function getMyCateringCustomers() {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();
    const rosterMembers = globalState.rosterMembers || [];

    const myRecord = rosterMembers.find(m => 
        (myId && (m.telegramId || m.id) && (m.telegramId || m.id).toString().trim() === myId) ||
        (myName && (m.riderName || m.name) && (m.riderName || m.name).toString().trim().toLowerCase() === myName)
    );

    if (!myRecord || myRecord.status !== 'Catering') {
        return [];
    }

    const list = [];
    const addValidCustomer = (name) => {
        const trimmed = (name || '').trim();
        const lc = trimmed.toLowerCase();
        if (trimmed && lc !== 'customer' && lc !== 'customer name' && lc !== 'undefined' && lc !== 'null') {
            if (!list.includes(trimmed)) list.push(trimmed);
        }
    };

    if (myRecord.customerName) {
        myRecord.customerName.split(/\s*,\s*/).forEach(addValidCustomer);
    }

    if (myRecord.forcedCaters && typeof myRecord.forcedCaters === 'object') {
        Object.entries(myRecord.forcedCaters).forEach(([fKey, fVal]) => {
            const fName = (fVal && typeof fVal === 'object' && fVal.customerName) ? fVal.customerName : fKey;
            addValidCustomer(fName);
        });
    }

    return list;
}

export function getMaxCartSlots() {
    const myCustomers = getMyCateringCustomers();
    let maxSlots = Math.max(1, myCustomers.length);

    // If any higher cart has items in it or receipt summary, keep it visible
    for (const slotKey in multiCarts) {
        const num = Number(slotKey);
        if (!isNaN(num) && num > maxSlots) {
            const cart = multiCarts[slotKey];
            if (cart && ((cart.items && cart.items.length > 0) || (cart.receiptSummary && Object.keys(cart.receiptSummary).length > 0))) {
                maxSlots = num;
            }
        }
    }

    // Never clip the currently active cart slot while user is viewing it
    if (activeCartSlot > maxSlots) {
        maxSlots = activeCartSlot;
    }

    return maxSlots;
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
                items: (multiCarts[key].items || []).map(item => ({
                    name: item.name || "",
                    price: item.price !== undefined ? item.price : 0,
                    category: item.category || "",
                    type: item.type || item.category || "",
                    isPaid: !!item.isPaid,
                    isBought: !!item.isBought,
                    isUnavailable: !!item.isUnavailable
                })),
                customerName: multiCarts[key].customerName || "",
                isManual: !!multiCarts[key].isManual,
                txId: multiCarts[key].txId || "",
                receiptSummary: multiCarts[key].receiptSummary || null
            };
        }
        localStorage.setItem('lokalex_multi_carts_v2', JSON.stringify(serializable));
        localStorage.setItem('lokalex_active_cart_slot', activeCartSlot.toString());
        localStorage.setItem('lokalex_cart_locked_state', JSON.stringify(globalState.cartLocked || []));
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
                    items: (parsed[key].items || []).map(item => ({
                        name: item.name || "",
                        price: item.price !== undefined ? item.price : 0,
                        category: item.category || "",
                        type: item.type || item.category || "",
                        isPaid: !!item.isPaid,
                        isBought: !!item.isBought,
                        isUnavailable: !!item.isUnavailable
                    })),
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
            globalState.cartLocked = [];
        }
    } catch(e) {}
}

export function getEffectiveCartClient(slotIdx) {
    const slotNum = slotIdx + 1;
    const cartObj = multiCarts[slotNum];
    if (cartObj && cartObj.customerName && cartObj.customerName !== "Sample") return cartObj.customerName;

    const myCustomers = getMyCateringCustomers();
    if (myCustomers[slotIdx]) return myCustomers[slotIdx];

    return "Sample";
}

/**
 * Ensures that cart slots map 1:1 to active catering customers and eliminates duplicate names.
 */
export function syncSmartCartsWithCateringCustomers() {
    const myCustomers = getMyCateringCustomers();
    if (!myCustomers || myCustomers.length === 0) return;

    // Set of customer names (lowercase) already claimed by a slot
    const assignedLowerSet = new Set();

    // Map each customer to a dedicated slot 1:1
    for (let slot = 1; slot <= myCustomers.length; slot++) {
        if (!multiCarts[slot]) {
            multiCarts[slot] = { items: [], selectedIds: new Set(), customerName: "", isManual: false, txId: "", receiptSummary: null };
        }

        const expectedCust = myCustomers[slot - 1];
        const currentCust = (multiCarts[slot].customerName || "").trim();
        const currentLower = currentCust.toLowerCase();

        // Check if current slot's name is invalid, duplicated, or belongs to another slot
        const isDuplicate = currentCust && assignedLowerSet.has(currentLower);
        const isUnrecognized = currentCust && currentCust !== "Sample" && !multiCarts[slot].isManual && !myCustomers.some(c => c.toLowerCase() === currentLower || isCustomerMatch(c, currentCust));

        if (!currentCust || currentCust === "Sample" || isDuplicate || isUnrecognized || (!multiCarts[slot].isManual && currentLower !== expectedCust.toLowerCase())) {
            multiCarts[slot].customerName = expectedCust;
            multiCarts[slot].isManual = false;
        }

        if (multiCarts[slot].customerName) {
            assignedLowerSet.add(multiCarts[slot].customerName.toLowerCase());
        }
    }

    // Clean up any remaining slots > myCustomers.length that might have duplicate catering names
    for (const slotKey in multiCarts) {
        const slot = Number(slotKey);
        if (slot > myCustomers.length) {
            const extraCart = multiCarts[slot];
            if (extraCart && extraCart.customerName && !extraCart.isManual) {
                const cLower = extraCart.customerName.trim().toLowerCase();
                if (assignedLowerSet.has(cLower)) {
                    extraCart.customerName = "Sample";
                }
            }
        }
    }

    saveCartState();
}

/**
 * Finds the specific cart slot (1-indexed) belonging to a customer name.
 * If not yet assigned, intelligently binds it to an available slot.
 */
export function getCartSlotForCustomer(custName) {
    if (!custName) return activeCartSlot || 1;
    const cleanTarget = custName.trim().toLowerCase();
    const myCustomers = getMyCateringCustomers();

    // Ensure 1:1 sync first
    syncSmartCartsWithCateringCustomers();

    // 1. Check in myCustomers order on roster
    const custIdx = myCustomers.findIndex(c => c.toLowerCase() === cleanTarget || isCustomerMatch(c, cleanTarget));
    if (custIdx !== -1) {
        const targetSlot = custIdx + 1;
        if (!multiCarts[targetSlot]) {
            multiCarts[targetSlot] = { items: [], selectedIds: new Set(), customerName: myCustomers[custIdx], isManual: false, txId: "", receiptSummary: null };
        } else {
            multiCarts[targetSlot].customerName = myCustomers[custIdx];
            multiCarts[targetSlot].isManual = false;
        }
        saveCartState();
        return targetSlot;
    }

    // 2. Direct match in multiCarts
    for (const slotKey in multiCarts) {
        const slot = Number(slotKey);
        const cName = (multiCarts[slot]?.customerName || "").trim().toLowerCase();
        if (cName && (cName === cleanTarget || isCustomerMatch(cName, cleanTarget))) {
            return slot;
        }
    }

    return activeCartSlot || 1;
}

if (typeof window !== 'undefined') {
    window.syncSmartCartsWithCateringCustomers = syncSmartCartsWithCateringCustomers;
    window.getCartSlotForCustomer = getCartSlotForCustomer;
    window.saveCartState = saveCartState;
    window.loadCartState = loadCartState;
}