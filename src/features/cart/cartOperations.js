// src/features/cart/cartOperations.js
import { globalState, multiCarts, activeCartSlot } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { proceedToWizard } from '../wizard.js';
import { getCurrentCart, saveCartState } from './cartState.js';
import { renderCartTabs, renderCartItems, resetToCartOne } from './cartUI.js';

let editingItemIndex = null;

export function handleCartActionBtn() {
    const currentCart = getCurrentCart();
    if (currentCart.length === 0) return;

    const isLocked = globalState.cartLocked && globalState.cartLocked[activeCartSlot - 1];
    if (isLocked) {
        return showToast("⚠️ I-slide muna ang lock sa overlay screen upang i-unlock ang cart.");
    }

    openSlideDeleteModal(
        `Linisin ang Cart ${activeCartSlot}?`,
        `Sigurado ka bang nais mong burahin ang lahat ng items sa Cart ${activeCartSlot}?`,
        () => {
            multiCarts[activeCartSlot].items = [];
            multiCarts[activeCartSlot].selectedIds.clear();
            multiCarts[activeCartSlot].receiptSummary = null;
            saveCartState();
            renderCartItems();
            renderCartTabs();
            showToast(`Cart ${activeCartSlot} cleared.`);
        }
    );
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
    
    openSlideDeleteModal(
        `Burahin ang ${count} napiling item(s)?`,
        `Sigurado ka bang nais mong burahin ang ${count} na napiling item sa Cart ${activeCartSlot}?`,
        () => {
            cartObj.items = cartObj.items.filter((_, idx) => !cartObj.selectedIds.has(idx));
            cartObj.selectedIds.clear();

            saveCartState();
            renderCartItems();
            renderCartTabs();
            showToast(`Deleted ${count} selected item(s).`);
        }
    );
}

export function deleteSingleCartItem(index) {
    const currentCart = getCurrentCart();
    const item = currentCart[index];
    if (!item) return;

    openSlideDeleteModal(
        `Burahin ang item?`,
        `Sigurado ka bang nais mong burahin ang item na "${item.name}"?`,
        () => {
            currentCart.splice(index, 1);
            if (multiCarts[activeCartSlot].selectedIds) {
                multiCarts[activeCartSlot].selectedIds.delete(index);
            }
            saveCartState();
            renderCartItems();
            renderCartTabs();
            showToast("Item deleted.");
        }
    );
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

export function validateAndProceedToWizard() {
    const currentCart = getCurrentCart();
    if (!currentCart || currentCart.length === 0) {
        return showToast("⚠️ Empty cart! Add items first.");
    }

    const isLocked = globalState.cartLocked && globalState.cartLocked[activeCartSlot - 1];
    if (isLocked) {
        return showToast("⚠️ I-slide muna ang lock sa overlay screen upang i-unlock ang cart.");
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
        multiCarts[activeCartSlot].receiptSummary = null;
        saveCartState();
        renderCartItems();
        renderCartTabs();
    }
}

export function clearAllCartSlots() {
    for (let slot = 1; slot <= 4; slot++) {
        multiCarts[slot] = {
            items: [],
            selectedIds: new Set(),
            customerName: "",
            isManual: false,
            txId: "",
            receiptSummary: null
        };
    }
    globalState.cartLocked = [false, false, false, false];
    if (globalState.cartTxIds) globalState.cartTxIds = ["", "", "", ""];
    saveCartState();
    resetToCartOne();
}