// src/features/cart/cartUI.js
import { globalState, multiCarts, activeCartSlot, setActiveCartSlot } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';
import { 
    getMyCateringCustomers, 
    getCurrentCart, 
    saveCartState, 
    getEffectiveCartClient 
} from './cartState.js';

export function switchCartTab(slot) {
    setActiveCartSlot(slot);
    globalState.activeCartIndex = slot - 1;
    saveCartState();
    renderCartTabs();
    renderCartItems();
}

export function resetToCartOne() {
    setActiveCartSlot(1);
    globalState.activeCartIndex = 0;
    saveCartState();
    renderCartTabs();
    renderCartItems();
}

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

export function renderCartCustomerSelector() {
    const container = document.getElementById('cart-customer-selector-container');
    if (!container) return;

    if (!multiCarts[activeCartSlot]) {
        multiCarts[activeCartSlot] = { items: [], selectedIds: new Set(), customerName: "", isManual: false, txId: "", receiptSummary: null };
    }

    const currentCartObj = multiCarts[activeCartSlot];
    const myCustomers = getMyCateringCustomers();
    const slotIdx = activeCartSlot - 1;

    const assignedCustomerForSlot = myCustomers[slotIdx];

    if (assignedCustomerForSlot && !currentCartObj.isManual) {
        if (!currentCartObj.customerName || currentCartObj.customerName === "Sample" || !myCustomers.includes(currentCartObj.customerName)) {
            currentCartObj.customerName = assignedCustomerForSlot;
            saveCartState();
        }
    }

    const selectedVal = currentCartObj.customerName || (assignedCustomerForSlot ? assignedCustomerForSlot : "Sample");

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
    if (!multiCarts[activeCartSlot]) {
        multiCarts[activeCartSlot] = { items: [], selectedIds: new Set(), customerName: "", isManual: false, txId: "", receiptSummary: null };
    }
    
    const myCustomers = getMyCateringCustomers();
    multiCarts[activeCartSlot].customerName = val;
    multiCarts[activeCartSlot].isManual = (val !== "Sample" && !myCustomers.includes(val));
    saveCartState();
}

export function handleOverlaySlideEnd(sliderEl) {
    const val = parseInt(sliderEl.value) || 0;
    if (val >= 90) {
        if (!globalState.cartLocked) globalState.cartLocked = [false, false, false, false];
        globalState.cartLocked[activeCartSlot - 1] = false;
        saveCartState();
        renderCartTabs();
        renderCartItems();
        showToast(`🔓 Unlocked Cart ${activeCartSlot} for editing!`);
    } else {
        sliderEl.value = 0;
    }
}

export function renderCartItems() {
    const container = document.getElementById('cart-items-list');
    const subtotalDisplay = document.getElementById('cart-subtotal-display');
    const deleteBtnContainer = document.getElementById('delete-selected-btn-container');

    renderCartTabs();

    if (!container) return;

    const currentCart = getCurrentCart();
    const currentCartObj = multiCarts[activeCartSlot] || {};
    const isLocked = globalState.cartLocked && globalState.cartLocked[activeCartSlot - 1];

    let subtotal = 0;
    let selectedCount = currentCartObj.selectedIds ? currentCartObj.selectedIds.size : 0;

    if (isLocked) {
        const clientName = getEffectiveCartClient(activeCartSlot - 1);
        const summary = currentCartObj.receiptSummary || {};
        
        const rawSubtotal = currentCart.reduce((sum, item) => sum + (item.isPaid || item.isUnavailable ? 0 : (parseFloat(item.price) || 0)), 0);
        const subtotalItems = summary.subtotal !== undefined ? parseFloat(summary.subtotal) : rawSubtotal;
        const totalFees = summary.totalFees !== undefined ? parseFloat(summary.totalFees) : (parseFloat(summary.deliveryFee) || 0);
        
        let codTotal = summary.codTotal !== undefined ? parseFloat(summary.codTotal) : (subtotalItems + totalFees);
        let gcashTotal = summary.gcashTotal !== undefined ? parseFloat(summary.gcashTotal) : (codTotal + (codTotal <= 1000 ? 15 : 15 + Math.ceil((codTotal - 1000) / 500) * 5));

        container.innerHTML = `
            <div class="bg-cardBg border border-emerald-500/50 rounded-2xl p-4 my-auto text-center shadow-2xl flex flex-col items-center justify-center gap-3">
                <div class="flex items-center gap-2">
                    <div class="w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center text-xl shadow-inner border border-emerald-500/40">
                        <i class="fa-solid fa-lock"></i>
                    </div>
                    <div class="text-left">
                        <h3 class="font-black text-sm text-emerald-400 uppercase tracking-wide">Cart ${activeCartSlot} Finalized</h3>
                        <p class="text-[11px] text-gray-400">
                            Customer: <strong class="text-white">${escapeHtml(clientName)}</strong>
                        </p>
                    </div>
                </div>

                <div class="w-full bg-gray-100 dark:bg-black/50 border border-gray-200 dark:border-gray-800 rounded-2xl p-3 flex flex-col gap-1.5 text-xs text-left shadow-inner">
                    <div class="flex justify-between items-center text-gray-600 dark:text-gray-400 text-[11px]">
                        <span>Items Subtotal:</span>
                        <span class="font-mono font-bold text-gray-900 dark:text-gray-200">₱${subtotalItems.toFixed(2)}</span>
                    </div>
                    <div class="flex justify-between items-center text-gray-600 dark:text-gray-400 text-[11px]">
                        <span>Delivery & Service Fees:</span>
                        <span class="font-mono font-bold text-gray-900 dark:text-gray-200">₱${totalFees.toFixed(2)}</span>
                    </div>
                    
                    <div class="border-t border-gray-200 dark:border-gray-800 my-0.5"></div>
                    
                    <div class="flex justify-between items-center bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 rounded-xl">
                        <span class="font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 text-xs">
                            <i class="fa-solid fa-money-bill-wave"></i> COD Total (Cash):
                        </span>
                        <span class="font-mono font-black text-base text-emerald-600 dark:text-emerald-400">₱${codTotal.toFixed(2)}</span>
                    </div>

                    <div class="flex justify-between items-center bg-blue-500/10 border border-blue-500/30 px-3 py-1.5 rounded-xl">
                        <span class="font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5 text-[11px]">
                            <i class="fa-solid fa-mobile-screen-button"></i> GCash (+Fee):
                        </span>
                        <span class="font-mono font-bold text-xs text-blue-600 dark:text-blue-400">₱${gcashTotal.toFixed(2)}</span>
                    </div>
                </div>

                <button type="button" onclick="window.openSukliCalculatorModal && window.openSukliCalculatorModal(${activeCartSlot})" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 px-4 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-lg transition active:scale-95 ring-2 ring-emerald-400/40">
                    <i class="fa-solid fa-calculator text-sm"></i> 💵 SUKLI / CHANGE CALCULATOR
                </button>

                <div class="w-full flex flex-col items-center gap-1 pt-1 border-t border-gray-200 dark:border-gray-800">
                    <span class="text-[9.5px] text-gray-500 dark:text-gray-400 font-medium">I-slide pakanan kung nais baguhin ang resibo:</span>
                    <div class="relative w-full max-w-xs h-11 bg-black/60 rounded-full border border-emerald-500/50 flex items-center px-2 overflow-hidden shadow-inner">
                        <span class="absolute inset-0 flex items-center justify-center text-[10px] text-emerald-400/60 font-black tracking-widest pointer-events-none select-none">&gt;&gt;&gt;&gt; SLIDE TO UNLOCK &gt;&gt;&gt;&gt;</span>
                        <input type="range" min="0" max="100" value="0" 
                            onmouseup="handleOverlaySlideEnd(this)" 
                            ontouchend="handleOverlaySlideEnd(this)" 
                            class="w-full accent-emerald-500 cursor-pointer z-10 opacity-80 h-9">
                    </div>
                </div>
            </div>`;

        if (subtotalDisplay) subtotalDisplay.innerText = codTotal.toFixed(2);
        if (deleteBtnContainer) deleteBtnContainer.innerHTML = "";
        return;
    }

    if (currentCart.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-16 text-xs">Empty Cart ${activeCartSlot}. Click "Paste List" or add items.</div>`;
        if (subtotalDisplay) subtotalDisplay.innerText = "0.00";
        if (deleteBtnContainer) deleteBtnContainer.innerHTML = "";
        return;
    }

    const activeItems = currentCart.filter(item => !item.isUnavailable);
    const totalActive = activeItems.length;
    const boughtCount = activeItems.filter(item => !!item.isBought).length;
    const progressPercent = totalActive > 0 ? Math.round((boughtCount / totalActive) * 100) : 0;

    const progressBannerHtml = `
        <div class="bg-cardBg border border-gray-200 dark:border-gray-800 p-2.5 rounded-xl flex flex-col gap-1.5 text-xs shrink-0 shadow-xs mb-1">
            <div class="flex justify-between items-center text-[11px] font-bold">
                <span class="text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                    <i class="fa-solid fa-list-check text-blue-500"></i> Shopping Checklist
                </span>
                <span class="${boughtCount === totalActive && totalActive > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-700 dark:text-gray-300'} font-mono text-[10px]">
                    ${boughtCount} of ${totalActive} bought (${progressPercent}%)
                </span>
            </div>
            <div class="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                <div class="bg-emerald-500 h-1.5 rounded-full transition-all duration-300" style="width: ${progressPercent}%"></div>
            </div>
        </div>`;

    const cardsHtml = currentCart.map((item, index) => {
        const itemPrice = parseFloat(item.price) || 0;
        const isPaid = !!item.isPaid;
        const isBought = !!item.isBought;
        const isUnavailable = !!item.isUnavailable;
        const isSelected = currentCartObj.selectedIds && currentCartObj.selectedIds.has(index);
        const hasCategory = !!(item.category === 'store' || item.category === 'market');
        const isUnpricedUnpaid = !isUnavailable && itemPrice <= 0 && !isPaid;

        if (!isPaid && !isUnavailable) {
            subtotal += itemPrice;
        }

        const isStore = (item.category || '').toLowerCase() === 'store';
        const isMarket = (item.category || '').toLowerCase() === 'market';

        const catStoreClass = isStore 
            ? "bg-orange-600 text-white font-bold shadow-xs" 
            : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";

        const catMarketClass = isMarket 
            ? "bg-emerald-600 text-white font-bold shadow-xs" 
            : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";

        const boughtBtnClass = isBought
            ? "bg-emerald-600 text-white font-bold shadow-xs"
            : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";

        const paidBtnClass = isPaid 
            ? "bg-emerald-600/30 text-emerald-400 border border-emerald-500/50 font-bold" 
            : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white";

        const naBtnClass = isUnavailable
            ? "bg-red-600 text-white font-bold shadow-xs"
            : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-red-500";

        let cardStyleClass = "bg-cardBg border-gray-200 dark:border-gray-800";
        if (isUnavailable) {
            cardStyleClass = "bg-gray-100/60 dark:bg-gray-900/40 border-gray-300 dark:border-gray-800 opacity-60";
        } else if (isUnpricedUnpaid) {
            cardStyleClass = "bg-amber-950/30 border-amber-500/80 ring-1 ring-amber-500/50 shadow-lg shadow-amber-950/30";
        } else if (isBought) {
            cardStyleClass = "bg-emerald-50/50 dark:bg-emerald-950/10 border-emerald-500/40";
        }

        let priceDisplay = `₱${itemPrice.toFixed(2)}`;
        let priceDisplayClass = "text-emerald-600 dark:text-green-400 font-bold text-sm font-mono";

        if (isUnavailable) {
            priceDisplay = "N/A (₱0.00)";
            priceDisplayClass = "text-gray-400 line-through text-xs font-mono";
        } else if (isPaid) {
            priceDisplay = "PAID (₱0.00)";
            priceDisplayClass = "text-gray-400 dark:text-gray-500 line-through text-xs";
        } else if (isUnpricedUnpaid) {
            priceDisplayClass = "text-amber-500 dark:text-amber-400 font-black animate-pulse text-sm font-mono";
        }

        let itemNameClass = "break-words text-wrap font-bold text-sm text-gray-900 dark:text-white";
        if (isUnavailable) {
            itemNameClass = "break-words text-wrap font-bold text-sm text-gray-400 dark:text-gray-500 line-through";
        } else if (isBought) {
            itemNameClass = "break-words text-wrap font-bold text-sm text-gray-500 dark:text-gray-400 line-through";
        }

        const naBadge = isUnavailable 
            ? `<span class="bg-red-500/10 text-red-600 dark:text-red-400 text-[9px] font-bold px-1.5 py-0.5 rounded border border-red-500/30 shrink-0">N/A</span>`
            : '';

        const boughtBadge = !isUnavailable && isBought
            ? `<span class="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold px-1.5 py-0.5 rounded border border-emerald-500/30 flex items-center gap-1 shrink-0"><i class="fa-solid fa-check text-[8px]"></i> Bought</span>`
            : '';

        const missingCategoryBadge = !isUnavailable && !hasCategory
            ? `<span class="bg-red-500/10 text-red-500 text-[9px] font-bold px-1.5 py-0.5 rounded border border-red-500/30 flex items-center gap-1 shrink-0"><i class="fa-solid fa-circle-exclamation text-[8px]"></i> No Category</span>`
            : '';

        const unpricedWarningBadge = isUnpricedUnpaid 
            ? `<span class="bg-amber-500/20 text-amber-500 dark:text-amber-400 text-[9px] font-bold px-2 py-0.5 rounded-full border border-amber-500/40 flex items-center gap-1 shrink-0"><i class="fa-solid fa-triangle-exclamation"></i> Set Price</span>` 
            : '';

        return `
        <div ontouchstart="handleCardTouchStart(event, this)" ontouchmove="handleCardTouchMove(event, this)" ontouchend="handleCardTouchEnd(event, ${index})" class="${cardStyleClass} border p-3 rounded-xl flex flex-col gap-2.5 transition-transform duration-75 relative select-none shadow-xs">
            <div class="flex items-start justify-between gap-2">
                <div class="flex items-start gap-1.5 flex-1 min-w-0">
                    <input type="checkbox" onchange="toggleItemSelect(${index})" ${isSelected ? "checked" : ""} class="w-4 h-4 accent-blue-500 rounded cursor-pointer shrink-0 mt-0.5">
                    <span class="text-[10px] text-gray-400 dark:text-gray-500 font-bold shrink-0 mt-0.5">#${index + 1}</span>
                    <div class="flex items-center gap-1 flex-wrap flex-1 min-w-0">
                        <span class="${itemNameClass}">${escapeHtml(item.name)}</span>
                        <button type="button" onclick="window.openEditNameModal && window.openEditNameModal(${index})" class="text-blue-500 hover:text-blue-400 p-1 text-xs active:scale-90 shrink-0" title="Edit Item Name">
                            <i class="fa-solid fa-pen text-[10px]"></i>
                        </button>
                        ${naBadge}
                        ${boughtBadge}
                        ${missingCategoryBadge}
                        ${unpricedWarningBadge}
                    </div>
                </div>

                <!-- PRICE BUTTON PAIRED DIRECTLY BEFORE THE ITEM PRICE -->
                <div class="flex items-center gap-1.5 shrink-0">
                    <button type="button" onclick="window.openAddPriceModal && window.openAddPriceModal(${index})" class="py-1 px-2 rounded-lg text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-600/20 dark:text-blue-300 dark:border-blue-500/30 transition active:scale-95 flex items-center gap-1 font-bold shadow-xs">
                        <i class="fa-solid fa-tag"></i> Price
                    </button>
                    <span class="${priceDisplayClass}">
                        ${priceDisplay}
                    </span>
                </div>
            </div>

            <!-- ACTION CONTROLS ROW -->
            <div class="flex items-center justify-between gap-2 pt-2 border-t border-gray-200 dark:border-gray-800/60 text-xs">
                <!-- Left: Market stacked vertically under Store -->
                <div class="flex flex-col gap-1 shrink-0">
                    <button onclick="toggleItemCategory(${index}, 'store')" class="px-3 py-1 rounded-lg text-[10px] transition active:scale-95 flex items-center gap-1 font-bold ${catStoreClass}">
                        <i class="fa-solid fa-store"></i> Store
                    </button>
                    <button onclick="toggleItemCategory(${index}, 'market')" class="px-3 py-1 rounded-lg text-[10px] transition active:scale-95 flex items-center gap-1 font-bold ${catMarketClass}">
                        <i class="fa-solid fa-basket-shopping"></i> Market
                    </button>
                </div>

                <!-- Right: Buy/Bought, Paid, and N/A Grouped Together -->
                <div class="flex items-center gap-1.5 flex-wrap justify-end">
                    <button onclick="toggleItemBought(${index})" class="py-1.5 px-2.5 rounded-lg text-[10px] transition active:scale-95 flex items-center gap-1 font-bold ${boughtBtnClass}">
                        <i class="fa-solid fa-check"></i> ${isBought ? 'Bought' : 'Bought'}
                    </button>
                    <button onclick="toggleItemPaid(${index})" class="py-1.5 px-2.5 rounded-lg text-[10px] transition active:scale-95 flex items-center gap-1 ${paidBtnClass}">
                        <i class="fa-solid fa-receipt"></i> Paid
                    </button>
                    <button onclick="toggleItemUnavailable(${index})" class="py-1.5 px-2.5 rounded-lg text-[10px] transition active:scale-95 flex items-center gap-1 font-bold ${naBtnClass}" title="Mark as Not Available">
                        <i class="fa-solid fa-ban"></i> N/A
                    </button>
                </div>
            </div>
            
            <div class="text-[9px] text-gray-400 dark:text-gray-600 italic text-right -mt-1 select-none pointer-events-none">
                <i class="fa-solid fa-arrows-left-right"></i> Slide left/right to delete
            </div>
        </div>`;
    }).join('');

    container.innerHTML = progressBannerHtml + cardsHtml;

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

if (typeof window !== 'undefined') {
    window.switchCartTab = switchCartTab;
    window.resetToCartOne = resetToCartOne;
    window.renderCartTabs = renderCartTabs;
    window.renderCartCustomerSelector = renderCartCustomerSelector;
    window.onCartCustomerSelected = onCartCustomerSelected;
    window.handleOverlaySlideEnd = handleOverlaySlideEnd;
    window.renderCartItems = renderCartItems;
}