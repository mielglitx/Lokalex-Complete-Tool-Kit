// src/features/cart.js
import { appState, globalState, multiCarts, activeCartSlot, setActiveCartSlot } from '../store/state.js';
import { showToast } from '../ui/notifications.js';
import { proceedToWizard } from './wizard.js';
import { escapeHtml } from '../utils/helpers.js';

let editingItemIndex = null;

// HELPER: GET ONLY THE CURRENTLY LOGGED-IN RIDER'S CATERING CUSTOMERS
export function getMyCateringCustomers() {
    const myId = (appState.telegramId || "").toString().trim();
    const myName = (appState.riderName || "").toString().trim().toLowerCase();
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
        multiCarts[activeCartSlot] = { items: [], selectedIds: new Set(), customerName: "", isManual: false, txId: "" };
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
                txId: multiCarts[key].txId || ""
            };
        }
        localStorage.setItem('lokalex_multi_carts_v2', JSON.stringify(serializable));
        localStorage.setItem('lokalex_active_cart_slot', activeCartSlot.toString());
    } catch(e) {}
}

export function loadCartState() {
    try {
        const savedSlot = localStorage.getItem('lokalex_active_cart_slot');
        if (savedSlot) setActiveCartSlot(parseInt(savedSlot) || 1);

        const savedData = localStorage.getItem('lokalex_multi_carts_v2');
        if (savedData) {
            const parsed = JSON.parse(savedData);
            for (let key in parsed) {
                multiCarts[key] = {
                    items: parsed[key].items || [],
                    selectedIds: new Set(),
                    customerName: parsed[key].customerName || "",
                    isManual: !!parsed[key].isManual,
                    txId: parsed[key].txId || ""
                };
            }
        }
    } catch(e) {}
}

export function switchCartTab(slot) {
    setActiveCartSlot(slot);
    saveCartState();
    renderCartTabs();
    renderCartItems();
}

// RENDER CART TABS (CART 1, 2, 3, 4)
export function renderCartTabs() {
    const container = document.getElementById('cart-tabs-header');
    if (!container) return;

    let html = "";
    for (let slot = 1; slot <= 4; slot++) {
        const cart = multiCarts[slot] || { items: [] };
        const isActive = slot === activeCartSlot;
        const count = cart.items ? cart.items.length : 0;
        const isLocked = globalState.cartLocked && globalState.cartLocked[slot - 1];

        let tabColor = isActive 
            ? "bg-blue-600 border-blue-400 text-white shadow-lg shadow-blue-950/50" 
            : "bg-inputBg text-gray-400 border-gray-800 hover:text-white";

        let lockBadge = isLocked ? `<i class="fa-solid fa-lock text-[10px] text-emerald-400 ml-1"></i>` : '';

        html += `
            <button onclick="switchCartTab(${slot})" class="flex-1 py-2 px-1 rounded-xl border flex flex-col items-center justify-center transition active:scale-95 text-xs font-bold ${tabColor}">
                <span>Cart ${slot}${lockBadge}</span>
                <span class="text-[9px] font-normal opacity-80">${count} items</span>
            </button>`;
    }
    container.innerHTML = html;

    const slotLabel = document.getElementById('cart-slot-label');
    const btnSlotLabel = document.getElementById('btn-cart-slot-label');
    if (slotLabel) slotLabel.innerText = `Cart ${activeCartSlot}`;
    if (btnSlotLabel) btnSlotLabel.innerText = `Cart ${activeCartSlot}`;

    renderCartCustomerSelector();
}

// RENDER CLIENT SELECTION DROPDOWN WITH AUTO-FILL AND RIDER ISOLATION
export function renderCartCustomerSelector() {
    const container = document.getElementById('cart-customer-selector-container');
    if (!container) return;

    if (!multiCarts[activeCartSlot]) {
        multiCarts[activeCartSlot] = { items: [], selectedIds: new Set(), customerName: "", isManual: false, txId: "" };
    }

    const currentCartObj = multiCarts[activeCartSlot];
    const myCustomers = getMyCateringCustomers();
    const slotIdx = activeCartSlot - 1; // 0 for Cart 1, 1 for Cart 2, etc.

    // AUTO-FILL: If no customer is assigned yet to this cart slot, auto-assign from rider's catering list
    if (!currentCartObj.customerName && myCustomers[slotIdx]) {
        currentCartObj.customerName = myCustomers[slotIdx];
        currentCartObj.isManual = false;
        saveCartState();
    }

    const selectedVal = currentCartObj.customerName || (myCustomers[slotIdx] ? myCustomers[slotIdx] : "Sample");

    let optionsHtml = `<option value="Sample" ${selectedVal === "Sample" ? "selected" : ""}>Sample Receipt</option>`;

    myCustomers.forEach(clientName => {
        const isSel = selectedVal === clientName ? "selected" : "";
        optionsHtml += `<option value="${escapeHtml(clientName)}" ${isSel}>${escapeHtml(clientName)}</option>`;
    });

    if (currentCartObj.isManual && selectedVal && !myCustomers.includes(selectedVal) && selectedVal !== "Sample") {
        optionsHtml += `<option value="${escapeHtml(selectedVal)}" selected>${escapeHtml(selectedVal)} (Manual)</option>`;
    }

    container.innerHTML = `
        <select onchange="onCartCustomerSelected(this.value)" class="w-full bg-inputBg text-xs text-amber-300 font-bold rounded-lg p-2 outline-none border border-gray-700 focus:border-amber-500">
            ${optionsHtml}
        </select>`;
}

export function onCartCustomerSelected(val) {
    if (!multiCarts[activeCartSlot]) multiCarts[activeCartSlot] = { items: [], selectedIds: new Set(), customerName: "", isManual: false, txId: "" };
    
    const myCustomers = getMyCateringCustomers();
    multiCarts[activeCartSlot].customerName = val;
    multiCarts[activeCartSlot].isManual = (val !== "Sample" && !myCustomers.includes(val));
    saveCartState();
}

export function getEffectiveCartClient(slotIdx) {
    const slotNum = slotIdx + 1;
    const cartObj = multiCarts[slotNum];
    if (cartObj && cartObj.customerName) return cartObj.customerName;

    const myCustomers = getMyCateringCustomers();
    if (myCustomers[slotIdx]) return myCustomers[slotIdx];

    return "Sample";
}

// RENDER CART ITEMS WITH UNPRICED & UNPAID AMBER HIGHLIGHT
export function renderCartItems() {
    const container = document.getElementById('cart-items-list');
    const subtotalDisplay = document.getElementById('cart-subtotal-display');
    const deleteBtnContainer = document.getElementById('delete-selected-btn-container');

    renderCartTabs();

    if (!container) return;

    const currentCart = getCurrentCart();
    const currentCartObj = multiCarts[activeCartSlot];

    let subtotal = 0;
    let selectedCount = currentCartObj.selectedIds ? currentCartObj.selectedIds.size : 0;

    if (currentCart.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-16 text-xs">Empty Cart ${activeCartSlot}. Click "Paste List" or add items.</div>`;
        if (subtotalDisplay) subtotalDisplay.innerText = "0.00";
        if (deleteBtnContainer) deleteBtnContainer.innerHTML = "";
        return;
    }

    container.innerHTML = currentCart.map((item, index) => {
        const itemPrice = parseFloat(item.price) || 0;
        const isPaid = !!item.isPaid;
        const isSelected = currentCartObj.selectedIds && currentCartObj.selectedIds.has(index);
        
        const isUnpricedUnpaid = itemPrice <= 0 && !isPaid;

        if (!isPaid) subtotal += itemPrice;

        const isMarket = (item.category || item.type || '').toLowerCase() === 'market';
        
        const catStoreClass = !isMarket 
            ? "bg-orange-600 text-white font-bold" 
            : "bg-gray-800 text-gray-400 hover:text-white";

        const catMarketClass = isMarket 
            ? "bg-emerald-600 text-white font-bold" 
            : "bg-gray-800 text-gray-400 hover:text-white";

        const paidBtnClass = isPaid 
            ? "bg-emerald-600/30 text-emerald-400 border border-emerald-500/50" 
            : "bg-gray-800 text-gray-400 hover:text-white";

        let cardStyleClass = "bg-cardBg border-gray-800";
        if (isUnpricedUnpaid) {
            cardStyleClass = "bg-amber-950/30 border-amber-500/80 ring-1 ring-amber-500/50 shadow-lg shadow-amber-950/30";
        }

        const priceDisplayClass = isUnpricedUnpaid 
            ? "text-amber-400 font-black animate-pulse" 
            : (isPaid ? "text-gray-500 line-through" : "text-green-400 font-bold");

        const unpricedWarningBadge = isUnpricedUnpaid 
            ? `<span class="bg-amber-500/20 text-amber-400 text-[9px] font-bold px-2 py-0.5 rounded-full border border-amber-500/40 flex items-center gap-1"><i class="fa-solid fa-triangle-exclamation"></i> Set Price or Paid</span>` 
            : '';

        return `
        <div class="${cardStyleClass} border p-3 rounded-xl flex flex-col gap-2 transition-all">
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 flex-1 min-w-0">
                    <input type="checkbox" onchange="toggleItemSelect(${index})" ${isSelected ? "checked" : ""} class="w-4 h-4 accent-blue-500 rounded cursor-pointer shrink-0">
                    <span class="text-[10px] text-gray-500 font-bold shrink-0">#${index + 1}</span>
                    <span class="font-bold text-sm text-white truncate">${escapeHtml(item.name)}</span>
                    ${unpricedWarningBadge}
                </div>
                <div class="text-right shrink-0">
                    <span class="text-sm ${priceDisplayClass}">
                        ${isPaid ? 'PAID (₱0.00)' : `₱${itemPrice.toFixed(2)}`}
                    </span>
                </div>
            </div>

            <div class="flex justify-between items-center pt-1 border-t border-gray-800/60 text-xs">
                <div class="flex gap-1">
                    <button onclick="toggleItemCategory(${index}, 'store')" class="px-2.5 py-1 rounded-lg text-[10px] transition active:scale-95 flex items-center gap-1 ${catStoreClass}">
                        <i class="fa-solid fa-store"></i> Store
                    </button>
                    <button onclick="toggleItemCategory(${index}, 'market')" class="px-2.5 py-1 rounded-lg text-[10px] transition active:scale-95 flex items-center gap-1 ${catMarketClass}">
                        <i class="fa-solid fa-basket-shopping"></i> Market
                    </button>
                </div>

                <div class="flex items-center gap-2">
                    <button onclick="toggleItemPaid(${index})" class="px-2.5 py-1 rounded-lg text-[10px] transition active:scale-95 flex items-center gap-1 ${paidBtnClass}">
                        <i class="fa-solid fa-check"></i> Paid
                    </button>
                    <button onclick="editCartItem(${index})" class="text-blue-400 hover:text-blue-300 p-1 text-xs active:scale-90" title="Edit Item">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button onclick="deleteSingleCartItem(${index})" class="text-red-400 hover:text-red-300 p-1 text-xs active:scale-90" title="Delete Item">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');

    if (subtotalDisplay) subtotalDisplay.innerText = subtotal.toFixed(2);

    if (deleteBtnContainer) {
        if (selectedCount > 0) {
            deleteBtnContainer.innerHTML = `
                <button onclick="deleteSelectedCartItems()" class="bg-red-600 text-white text-xs font-bold px-3 py-2 rounded-lg transition active:scale-95 flex items-center gap-1">
                    <i class="fa-solid fa-trash"></i> Delete (${selectedCount})
                </button>`;
        } else {
            deleteBtnContainer.innerHTML = "";
        }
    }
}

export function handleCartActionBtn() {
    const currentCart = getCurrentCart();
    if (currentCart.length === 0) return;

    if (confirm(`Sigurado ka bang nais mong linisin ang Cart ${activeCartSlot}?`)) {
        multiCarts[activeCartSlot].items = [];
        multiCarts[activeCartSlot].selectedIds.clear();
        saveCartState();
        renderCartItems();
        renderCartTabs();
        showToast(`Cart ${activeCartSlot} cleared.`);
    }
}

export function toggleItemCategory(index, category) {
    const currentCart = getCurrentCart();
    if (currentCart[index]) {
        currentCart[index].category = category;
        currentCart[index].type = category;
        saveCartState();
        renderCartItems();
    }
}

export function toggleItemPaid(index) {
    const currentCart = getCurrentCart();
    if (currentCart[index]) {
        currentCart[index].isPaid = !currentCart[index].isPaid;
        saveCartState();
        renderCartItems();
    }
}

export function toggleItemSelect(index) {
    const cartObj = multiCarts[activeCartSlot];
    if (!cartObj.selectedIds) cartObj.selectedIds = new Set();

    if (cartObj.selectedIds.has(index)) {
        cartObj.selectedIds.delete(index);
    } else {
        cartObj.selectedIds.add(index);
    }
    renderCartItems();
}

export function deleteSelectedCartItems() {
    const cartObj = multiCarts[activeCartSlot];
    if (!cartObj || !cartObj.selectedIds || cartObj.selectedIds.size === 0) return;

    const count = cartObj.selectedIds.size;
    cartObj.items = cartObj.items.filter((_, idx) => !cartObj.selectedIds.has(idx));
    cartObj.selectedIds.clear();

    saveCartState();
    renderCartItems();
    renderCartTabs();
    showToast(`Deleted ${count} selected item(s).`);
}

export function deleteSingleCartItem(index) {
    const currentCart = getCurrentCart();
    if (currentCart[index]) {
        currentCart.splice(index, 1);
        if (multiCarts[activeCartSlot].selectedIds) {
            multiCarts[activeCartSlot].selectedIds.delete(index);
        }
        saveCartState();
        renderCartItems();
        renderCartTabs();
        showToast("Item deleted.");
    }
}

export function editCartItem(index) {
    const currentCart = getCurrentCart();
    const item = currentCart[index];
    if (!item) return;

    editingItemIndex = index;

    const nameInput = document.getElementById('edit-name-input');
    const priceInput = document.getElementById('edit-price-input');
    const paidInput = document.getElementById('edit-paid-input');

    if (nameInput) nameInput.value = item.name || "";
    if (priceInput) priceInput.value = item.price !== undefined ? item.price : "";
    if (paidInput) paidInput.checked = !!item.isPaid;

    const modal = document.getElementById('edit-item-modal');
    if (modal) modal.classList.remove('hidden');
}

export function saveItemEdit() {
    if (editingItemIndex === null) return;

    const currentCart = getCurrentCart();
    const item = currentCart[editingItemIndex];
    if (!item) return;

    const nameInput = document.getElementById('edit-name-input');
    const priceInput = document.getElementById('edit-price-input');
    const paidInput = document.getElementById('edit-paid-input');

    const newName = nameInput ? nameInput.value.trim() : "";
    const newPrice = priceInput ? parseFloat(priceInput.value) || 0 : 0;
    const newPaid = paidInput ? paidInput.checked : false;

    if (!newName) {
        showToast("⚠️ Item name cannot be empty.");
        return;
    }

    item.name = newName;
    item.price = newPaid ? 0 : newPrice;
    item.isPaid = newPaid;

    saveCartState();
    renderCartItems();

    const modal = document.getElementById('edit-item-modal');
    if (modal) modal.classList.add('hidden');
    editingItemIndex = null;
    showToast("Item updated successfully.");
}

export function processBulkAdd() {
    const bulkInput = document.getElementById('bulk-input');
    const rawText = bulkInput ? bulkInput.value.trim() : "";
    if (!rawText) return showToast("Please paste items text");

    const lines = rawText.split('\n');
    const newItems = [];

    lines.forEach(line => {
        const clean = line.trim();
        if (!clean) return;

        const match = clean.match(/^(.*?)\s+(\d+(?:\.\d+)?)$/);
        if (match) {
            newItems.push({
                name: match[1].trim(),
                price: parseFloat(match[2]),
                category: 'store',
                type: 'store',
                isPaid: false
            });
        } else {
            newItems.push({
                name: clean,
                price: 0,
                category: 'store',
                type: 'store',
                isPaid: false
            });
        }
    });

    if (newItems.length > 0) {
        const currentCart = getCurrentCart();
        currentCart.push(...newItems);
        saveCartState();
        renderCartItems();
        renderCartTabs();

        const modal = document.getElementById('bulk-modal');
        if (modal) modal.classList.add('hidden');
        showToast(`Added ${newItems.length} items to Cart ${activeCartSlot}.`);
    }
}

// VALIDATE CART WITH STRICT UNPRICED UNPAID GUARDRAIL
export function validateAndProceedToWizard() {
    const currentCart = getCurrentCart();
    if (!currentCart || currentCart.length === 0) {
        return showToast("⚠️ Empty cart! Add items first.");
    }

    const unpricedUnpaidItems = currentCart.filter(i => (parseFloat(i.price) || 0) <= 0 && !i.isPaid);

    if (unpricedUnpaidItems.length > 0) {
        showToast(`⚠️ Paki-lagyan ng presyo o i-check ang Paid button sa ${unpricedUnpaidItems.length} item na ₱0.00!`);
        renderCartItems();
        return;
    }

    const paidItems = currentCart.filter(i => i.isPaid);
    if (paidItems.length > 0) {
        const paidModal = document.getElementById('paid-item-confirm-modal');
        if (paidModal) {
            paidModal.classList.remove('hidden');
            return;
        }
    }

    proceedToWizard();
}

export function confirmPaidItemProceed() {
    const paidModal = document.getElementById('paid-item-confirm-modal');
    if (paidModal) paidModal.classList.add('hidden');
    proceedToWizard();
}

export function closePaidItemModal() {
    const paidModal = document.getElementById('paid-item-confirm-modal');
    if (paidModal) paidModal.classList.add('hidden');
}

export function clearCartSlot() {
    if (multiCarts[activeCartSlot]) {
        multiCarts[activeCartSlot].items = [];
        multiCarts[activeCartSlot].selectedIds.clear();
        multiCarts[activeCartSlot].customerName = "";
        multiCarts[activeCartSlot].isManual = false;
        saveCartState();
        renderCartItems();
        renderCartTabs();
    }
}

// AUTO-INITIALIZE SMART CART ON LOAD & VIEW LOAD
loadCartState();
setTimeout(() => {
    renderCartTabs();
    renderCartItems();
}, 50);

if (typeof window !== 'undefined') {
    window.switchCartTab = switchCartTab;
    window.onCartCustomerSelected = onCartCustomerSelected;
    window.toggleItemCategory = toggleItemCategory;
    window.toggleItemPaid = toggleItemPaid;
    window.toggleItemSelect = toggleItemSelect;
    window.deleteSelectedCartItems = deleteSelectedCartItems;
    window.deleteSingleCartItem = deleteSingleCartItem;
    window.editCartItem = editCartItem;
    window.saveItemEdit = saveItemEdit;
    window.handleCartActionBtn = handleCartActionBtn;
    window.processBulkAdd = processBulkAdd;
    window.validateAndProceedToWizard = validateAndProceedToWizard;
    window.confirmPaidItemProceed = confirmPaidItemProceed;
    window.closePaidItemModal = closePaidItemModal;
    window.clearCartSlot = clearCartSlot;
}

window.addEventListener('rosterUpdated', renderCartCustomerSelector);