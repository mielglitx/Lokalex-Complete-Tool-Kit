// src/features/cart.js
import { appState, globalState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { showToast } from '../ui/notifications.js';
import { switchView } from '../ui/router.js';
import { escapeHtml } from '../utils/helpers.js';

export function loadCartState() {
    try {
        const saved = localStorage.getItem('lokalex_carts');
        if (saved) {
            globalState.carts = JSON.parse(saved);
        } else {
            globalState.carts = [[], [], [], []];
        }
    } catch(e) {
        console.error("Failed to load cart state", e);
    }
    
    if (globalState.activeCartIndex === undefined) {
        globalState.activeCartIndex = 0;
    }
    
    renderCartTabs();
    renderCartItems();
}

export function saveCartState() {
    try {
        localStorage.setItem('lokalex_carts', JSON.stringify(globalState.carts));
    } catch(e) {
        console.error("Failed to save cart state", e);
    }
}

export function switchCartTab(index) {
    globalState.activeCartIndex = index;
    renderCartTabs();
    renderCartItems();
}

export function renderCartTabs() {
    const container = document.getElementById('cart-tabs-header');
    if (!container) return;
    
    const cartIdx = globalState.activeCartIndex || 0;

    container.innerHTML = [0, 1, 2, 3].map(i => {
        const isActive = cartIdx === i;
        const itemCount = (globalState.carts[i] || []).length;
        const activeClass = isActive 
            ? "bg-blue-600 text-white font-black shadow-lg border-blue-500" 
            : "bg-cardBg text-gray-400 hover:text-white border-gray-800";

        return `
            <button onclick="switchCartTab(${i})" class="${activeClass} py-2 px-1 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 active:scale-95">
                <span>Cart ${i + 1}</span>
                <span class="text-[9px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-blue-500/40 text-white' : 'bg-black/30 text-gray-400'}">${itemCount} items</span>
            </button>
        `;
    }).join('');

    const label = `Cart ${cartIdx + 1}`;
    const slotLabelEl = document.getElementById('cart-slot-label');
    const btnSlotLabelEl = document.getElementById('btn-cart-slot-label');
    if (slotLabelEl) slotLabelEl.innerText = label;
    if (btnSlotLabelEl) btnSlotLabelEl.innerText = label;
}

export function renderCartItems() {
    const container = document.getElementById('cart-items-list');
    if (!container) return;

    const cartIdx = globalState.activeCartIndex || 0;
    const items = globalState.carts[cartIdx] || [];
    renderCartClientSelector();

    if (items.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-500 italic py-16 text-xs flex flex-col items-center gap-2">
                <i class="fa-solid fa-cart-shopping text-3xl opacity-30"></i>
                <span>Walang laman ang Cart ${cartIdx + 1}.</span>
            </div>`;
        updateCartSubtotal(0);
        return;
    }

    let subtotal = 0;

    container.innerHTML = items.map((item, index) => {
        const price = parseFloat(item.price) || 0;
        subtotal += price;

        const isStore = item.type === 'store';
        const isMarket = item.type === 'market';

        return `
            <div class="bg-cardBg border border-gray-800 p-3 rounded-xl flex flex-col gap-2 text-xs shadow-sm">
                <div class="flex justify-between items-center">
                    <span class="font-bold text-white flex items-center gap-1.5">
                        <span class="text-gray-500 text-[10px]">#${index + 1}</span> ${escapeHtml(item.name)}
                    </span>
                    <span class="font-black text-green-400 text-sm">₱${price.toFixed(2)}</span>
                </div>

                <div class="flex justify-between items-center pt-2 border-t border-gray-800/80">
                    <div class="flex gap-1.5">
                        <button onclick="setItemType(${index}, 'store')" class="px-2.5 py-1 rounded-lg font-bold text-[10px] border transition ${isStore ? 'bg-orange-600 text-white border-orange-500' : 'bg-black/30 text-gray-400 border-gray-800 hover:text-white'}">
                            <i class="fa-solid fa-store"></i> Store
                        </button>
                        <button onclick="setItemType(${index}, 'market')" class="px-2.5 py-1 rounded-lg font-bold text-[10px] border transition ${isMarket ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-black/30 text-gray-400 border-gray-800 hover:text-white'}">
                            <i class="fa-solid fa-basket-shopping"></i> Market
                        </button>
                    </div>

                    <div class="flex items-center gap-2">
                        <button onclick="openEditItemModal(${index})" class="text-blue-400 hover:text-blue-300 p-1" title="Edit Item"><i class="fa-solid fa-pen"></i></button>
                        <button onclick="removeCartItem(${index})" class="text-red-400 hover:text-red-300 p-1" title="Delete Item"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    updateCartSubtotal(subtotal);
}

function updateCartSubtotal(subtotal) {
    const display = document.getElementById('cart-subtotal-display');
    if (display) display.innerText = subtotal.toFixed(2);
}

export function setItemType(index, type) {
    const cartIdx = globalState.activeCartIndex || 0;
    const items = globalState.carts[cartIdx];
    if (items && items[index]) {
        items[index].type = type;
        saveCartState();
        renderCartItems();
    }
}

export function removeCartItem(index) {
    const cartIdx = globalState.activeCartIndex || 0;
    const items = globalState.carts[cartIdx];
    if (items) {
        items.splice(index, 1);
        saveCartState();
        renderCartItems();
        showToast("Item removed from cart");
    }
}

export function handleCartActionBtn() {
    const cartIdx = globalState.activeCartIndex || 0;
    if (!globalState.carts[cartIdx] || globalState.carts[cartIdx].length === 0) return;

    if (confirm(`Sigurado ka bang nais burahin ang lahat ng laman ng Cart ${cartIdx + 1}?`)) {
        globalState.carts[cartIdx] = [];
        saveCartState();
        renderCartItems();
        showToast(`Cart ${cartIdx + 1} cleared.`);
    }
}

function renderCartClientSelector() {
    const container = document.getElementById('cart-customer-selector-container');
    if (!container) return;

    const rosterList = globalState.rosterMembers || [];
    const activeCatered = rosterList.filter(r => (r.status || "").toLowerCase() === 'catering');

    if (activeCatered.length === 0) {
        container.innerHTML = `<span class="text-[11px] text-gray-500 italic">Walang active catering client sa roster.</span>`;
        return;
    }

    let options = `<option value="">-- Piliin ang Customer --</option>`;
    activeCatered.forEach(c => {
        const name = c.customerName ? c.customerName.split(',')[0] : "Customer";
        options += `<option value="${escapeHtml(name)}">${escapeHtml(name)} (${escapeHtml(c.name)})</option>`;
    });

    container.innerHTML = `
        <select onchange="assignClientToCart(this.value)" class="w-full bg-darkBg text-xs text-amber-300 font-bold rounded-lg p-1.5 outline-none border border-gray-700">
            ${options}
        </select>
    `;
}

export function assignClientToCart(clientName) {
    if (!clientName) return;
    appState.selectedCateringClient = clientName;
    const cartIdx = globalState.activeCartIndex || 0;
    showToast(`🛒 Cart ${cartIdx + 1} assigned to ${clientName}`);
}

// ============================================================================
// RESTORED: EDIT ITEM MODAL LOGIC
// ============================================================================
export function openEditItemModal(index) {
    const cartIdx = globalState.activeCartIndex || 0;
    const item = globalState.carts[cartIdx][index];
    if (!item) return;

    globalState.editItemIndex = index;
    document.getElementById('edit-name-input').value = item.name;
    document.getElementById('edit-price-input').value = item.price;
    document.getElementById('edit-item-modal').classList.remove('hidden');
}

export function closeEditItemModal() {
    document.getElementById('edit-item-modal').classList.add('hidden');
    globalState.editItemIndex = null;
}

export function saveItemEdit() {
    if (globalState.editItemIndex === null || globalState.editItemIndex === undefined) return;
    
    const cartIdx = globalState.activeCartIndex || 0;
    const name = document.getElementById('edit-name-input').value.trim();
    const price = parseFloat(document.getElementById('edit-price-input').value) || 0;

    if (!name) return showToast("Item name is required.");

    globalState.carts[cartIdx][globalState.editItemIndex].name = name;
    globalState.carts[cartIdx][globalState.editItemIndex].price = price;

    saveCartState();
    renderCartItems();
    closeEditItemModal();
    showToast("Item updated successfully.");
}

// ============================================================================
// RESTORED: BULK ADD LOGIC
// ============================================================================
export function showBulkAddModal() {
    document.getElementById('bulk-input').value = "";
    document.getElementById('bulk-modal').classList.remove('hidden');
}

export function closeBulkModal() {
    document.getElementById('bulk-modal').classList.add('hidden');
}

export function processBulkAdd() {
    const input = document.getElementById('bulk-input').value.trim();
    if (!input) return closeBulkModal();

    const cartIdx = globalState.activeCartIndex || 0;
    const lines = input.split('\n');
    let addedCount = 0;

    lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length === 0 || parts[0] === "") return;

        let price = 0;
        let name = line.trim();

        // Check if the last word is a number (the price)
        const lastPart = parts[parts.length - 1];
        if (!isNaN(parseFloat(lastPart))) {
            price = parseFloat(lastPart);
            name = parts.slice(0, -1).join(' '); // Rejoin the name without the price
        }

        if (name) {
            globalState.carts[cartIdx].push({
                name: name,
                price: price,
                type: 'uncategorized'
            });
            addedCount++;
        }
    });

    if (addedCount > 0) {
        saveCartState();
        renderCartItems();
        showToast(`${addedCount} items added to Cart ${cartIdx + 1}`);
    }
    closeBulkModal();
}

// ============================================================================
// STRICT VALIDATION: Blocks Uncategorized Items
// ============================================================================
export function validateAndProceedToWizard() {
    const cartIdx = globalState.activeCartIndex || 0;
    const cartItems = globalState.carts[cartIdx] || [];
    
    if (cartItems.length === 0) {
        showToast("⚠️ Walang laman ang cart!");
        return;
    }

    const hasUncategorized = cartItems.some(item => !item.type || (item.type !== 'store' && item.type !== 'market'));
    
    if (hasUncategorized) {
        showToast("⚠️ Paki-kategorya (Store o Market) ang lahat ng items bago mag-resibo!");
        return;
    }

    // Call the original proceedToWizard from wizard.js
    if (typeof window.proceedToWizard === 'function') {
        window.proceedToWizard();
    } else {
        switchView('view-wizard');
    }
}