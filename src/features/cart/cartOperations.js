// src/features/cart/cartOperations.js
import { globalState, multiCarts, activeCartSlot } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { proceedToWizard } from '../wizard.js';
import { getCurrentCart, saveCartState } from './cartState.js';
import { renderCartTabs, renderCartItems, resetToCartOne } from './cartUI.js';

let editingNameIndex = null;
let pricingItemIndex = null;

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
        if (currentCart[index].category === category) {
            currentCart[index].category = '';
            currentCart[index].type = '';
        } else {
            currentCart[index].category = category;
            currentCart[index].type = category;
        }
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

export function toggleItemBought(index) {
    const currentCart = getCurrentCart();
    const item = currentCart[index];
    if (!item) return;

    item.isBought = !item.isBought;
    saveCartState();
    renderCartItems();

    const hasPriceOrPaid = (parseFloat(item.price) || 0) > 0 || !!item.isPaid;

    if (item.isBought && !item.isUnavailable && !hasPriceOrPaid) {
        openAddPriceModal(index);
    }
}

export function toggleItemUnavailable(index) {
    const currentCart = getCurrentCart();
    const item = currentCart[index];
    if (!item) return;

    item.isUnavailable = !item.isUnavailable;
    if (item.isUnavailable) {
        item.isBought = false;
    }
    saveCartState();
    renderCartItems();
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

export function openEditNameModal(index) {
    const currentCart = getCurrentCart();
    const item = currentCart[index];
    if (!item) return;

    editingNameIndex = index;
    const input = document.getElementById('cart-edit-name-input');
    const modal = document.getElementById('cart-edit-name-modal');

    if (input) input.value = item.name || '';
    if (modal) modal.classList.remove('hidden');
    if (input) setTimeout(() => input.focus(), 100);
}

export function closeEditNameModal() {
    const modal = document.getElementById('cart-edit-name-modal');
    if (modal) modal.classList.add('hidden');
    editingNameIndex = null;
}

export function saveItemName() {
    if (editingNameIndex === null) return;
    const currentCart = getCurrentCart();
    const item = currentCart[editingNameIndex];
    if (!item) return;

    const input = document.getElementById('cart-edit-name-input');
    const newName = input ? input.value.trim() : '';

    if (!newName) {
        return showToast("⚠️ Item name cannot be empty.");
    }

    item.name = newName;
    saveCartState();
    renderCartItems();
    closeEditNameModal();
    showToast("✅ Item name updated.");
}

export function openAddPriceModal(index) {
    const currentCart = getCurrentCart();
    const item = currentCart[index];
    if (!item) return;

    pricingItemIndex = index;
    const nameLabel = document.getElementById('price-modal-item-name');
    const input = document.getElementById('cart-item-price-input');
    const modal = document.getElementById('cart-add-price-modal');

    if (nameLabel) nameLabel.innerText = item.name || 'Item Price';
    if (input) input.value = item.price > 0 ? item.price : '';
    if (modal) modal.classList.remove('hidden');
    if (input) setTimeout(() => input.focus(), 100);
}

export function closeAddPriceModal() {
    const modal = document.getElementById('cart-add-price-modal');
    if (modal) modal.classList.add('hidden');
    pricingItemIndex = null;
}

export function saveItemPrice() {
    if (pricingItemIndex === null) return;
    const currentCart = getCurrentCart();
    const item = currentCart[pricingItemIndex];
    if (!item) return;

    const input = document.getElementById('cart-item-price-input');
    const priceVal = input ? parseFloat(input.value) : 0;
    const cleanPrice = isNaN(priceVal) || priceVal < 0 ? 0 : priceVal;

    item.price = cleanPrice;
    if (cleanPrice > 0) {
        item.isPaid = false;
        item.isBought = true;
    }

    saveCartState();
    renderCartItems();
    closeAddPriceModal();
    showToast(`💰 Price set: ₱${cleanPrice.toFixed(2)}`);
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
                category: '',
                type: '',
                isPaid: false,
                isBought: false,
                isUnavailable: false
            });
        } else {
            newItems.push({
                name: clean,
                price: 0,
                category: '',
                type: '',
                isPaid: false,
                isBought: false,
                isUnavailable: false
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

    const activeItems = currentCart.filter(i => !i.isUnavailable);

    if (activeItems.length === 0) {
        return showToast("⚠️ Lahat ng item sa cart ay minarkahang Not Available!");
    }

    const unboughtItems = activeItems.filter(i => !i.isBought);
    if (unboughtItems.length > 0) {
        return showToast(`⚠️ Paki-mark muna bilang Buy/Bought ang ${unboughtItems.length} active item(s)!`);
    }

    const uncategorizedItems = activeItems.filter(i => !i.category || (i.category !== 'store' && i.category !== 'market'));
    if (uncategorizedItems.length > 0) {
        return showToast(`⚠️ Paki-pili kung Store o Market ang ${uncategorizedItems.length} item(s)!`);
    }

    const unpricedUnpaidItems = activeItems.filter(i => (parseFloat(i.price) || 0) <= 0 && !i.isPaid);
    if (unpricedUnpaidItems.length > 0) {
        return showToast(`⚠️ Paki-lagyan ng presyo o i-check ang Paid sa ${unpricedUnpaidItems.length} item na ₱0.00!`);
    }

    const paidItems = activeItems.filter(i => i.isPaid);
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

if (typeof window !== 'undefined') {
    window.handleCartActionBtn = handleCartActionBtn;
    window.toggleItemCategory = toggleItemCategory;
    window.toggleItemPaid = toggleItemPaid;
    window.toggleItemBought = toggleItemBought;
    window.toggleItemUnavailable = toggleItemUnavailable;
    window.toggleItemSelect = toggleItemSelect;
    window.deleteSelectedCartItems = deleteSelectedCartItems;
    window.deleteSingleCartItem = deleteSingleCartItem;
    window.openEditNameModal = openEditNameModal;
    window.closeEditNameModal = closeEditNameModal;
    window.saveItemName = saveItemName;
    window.openAddPriceModal = openAddPriceModal;
    window.closeAddPriceModal = closeAddPriceModal;
    window.saveItemPrice = saveItemPrice;
    window.processBulkAdd = processBulkAdd;
    window.validateAndProceedToWizard = validateAndProceedToWizard;
    window.confirmPaidItemProceed = confirmPaidItemProceed;
    window.closePaidItemModal = closePaidItemModal;
    window.clearCartSlot = clearCartSlot;
    window.clearAllCartSlots = clearAllCartSlots;
}