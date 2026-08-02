// src/features/cart.js
import { appState, globalState } from '../store/state.js';
import { db } from '../config/firebase.js';
import { showToast } from '../ui/notifications.js';
import { switchView } from '../ui/router.js';
import { escapeHtml } from '../utils/helpers.js';
import { openSlideDeleteModal } from '../ui/modals.js';

export function loadCartState() {
    try {
        const savedCarts = localStorage.getItem('lokalex_carts');
        if (savedCarts) {
            const parsed = JSON.parse(savedCarts);
            if (Array.isArray(parsed) && parsed.length === 4 && Array.isArray(parsed[0])) {
                globalState.carts = parsed;
            } else {
                globalState.carts = [[], [], [], []];
            }
        } else {
            globalState.carts = [[], [], [], []];
        }

        const savedClients = localStorage.getItem('lokalex_cart_clients');
        globalState.cartClients = savedClients ? JSON.parse(savedClients) : ["", "", "", ""];

        const savedManuals = localStorage.getItem('lokalex_cart_manuals');
        globalState.cartManualFlags = savedManuals ? JSON.parse(savedManuals) : [false, false, false, false];

        const savedLocked = localStorage.getItem('lokalex_cart_locked');
        globalState.cartLocked = savedLocked ? JSON.parse(savedLocked) : [false, false, false, false];

        const savedTxIds = localStorage.getItem('lokalex_cart_txids');
        globalState.cartTxIds = savedTxIds ? JSON.parse(savedTxIds) : ["", "", "", ""];

    } catch(e) {
        console.error("Failed to load cart state", e);
        globalState.carts = [[], [], [], []];
        globalState.cartClients = ["", "", "", ""];
        globalState.cartManualFlags = [false, false, false, false];
        globalState.cartLocked = [false, false, false, false];
        globalState.cartTxIds = ["", "", "", ""];
    }
    
    if (globalState.activeCartIndex === undefined || globalState.activeCartIndex === null) {
        globalState.activeCartIndex = 0;
    }
    
    renderCartTabs();
    renderCartItems();
}

export function saveCartState() {
    try {
        if (!Array.isArray(globalState.carts)) {
            globalState.carts = [[], [], [], []];
        }
        localStorage.setItem('lokalex_carts', JSON.stringify(globalState.carts));
        localStorage.setItem('lokalex_cart_locked', JSON.stringify(globalState.cartLocked || [false, false, false, false]));
        localStorage.setItem('lokalex_cart_txids', JSON.stringify(globalState.cartTxIds || ["", "", "", ""]));
    } catch(e) {
        console.error("Failed to save cart state", e);
    }
}

export function saveCartClientsState() {
    try {
        localStorage.setItem('lokalex_cart_clients', JSON.stringify(globalState.cartClients || ["", "", "", ""]));
        localStorage.setItem('lokalex_cart_manuals', JSON.stringify(globalState.cartManualFlags || [false, false, false, false]));
    } catch(e) {}
}

export function switchCartTab(index) {
    globalState.activeCartIndex = index;
    renderCartTabs();
    renderCartItems();
}

export function renderCartTabs() {
    const container = document.getElementById('cart-tabs-header');
    if (!container) return;

    const cartIdx = globalState.activeCartIndex ?? 0;

    container.innerHTML = [0, 1, 2, 3].map(i => {
        const isActive = cartIdx === i;
        const itemCount = (globalState.carts && globalState.carts[i]) ? globalState.carts[i].length : 0;
        const isLocked = !!(globalState.cartLocked && globalState.cartLocked[i]);
        
        let activeClass = isActive 
            ? "bg-blue-600 text-white font-black shadow-lg border-blue-500" 
            : "bg-cardBg text-gray-400 hover:text-white border-gray-800";

        if (isLocked) {
            activeClass += " ring-1 ring-emerald-500/80";
        }

        return `
            <button onclick="switchCartTab(${i})" class="${activeClass} py-2 px-1 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 active:scale-95">
                <span class="flex items-center gap-1">Cart ${i + 1} ${isLocked ? '<i class="fa-solid fa-lock text-[10px] text-emerald-400"></i>' : ''}</span>
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

    const cartIdx = globalState.activeCartIndex ?? 0;
    const isLocked = !!(globalState.cartLocked && globalState.cartLocked[cartIdx]);

    renderCartClientSelector();
    renderCartActionsToolbar();

    const items = (globalState.carts && globalState.carts[cartIdx]) ? globalState.carts[cartIdx] : [];
    let subtotal = 0;

    let itemsHtml = "";
    if (items.length === 0) {
        itemsHtml = `
            <div class="text-center text-gray-500 italic py-16 text-xs flex flex-col items-center gap-2">
                <i class="fa-solid fa-cart-shopping text-3xl opacity-30"></i>
                <span>Walang laman ang Cart ${cartIdx + 1}.</span>
            </div>`;
    } else {
        itemsHtml = items.map((item, index) => {
            let price = parseFloat(item.price) || 0;
            if (price < 0) {
                price = 0;
                item.price = 0;
                item.isPaid = true;
            }

            const isPaid = !!item.isPaid;
            const itemCost = isPaid ? 0 : Math.max(0, price);
            subtotal += itemCost;

            const cat = item.type || item.category || '';
            const isStore = cat.toLowerCase() === 'store';
            const isMarket = cat.toLowerCase() === 'market';
            const isSelected = !!item.selectedForDelete;

            return `
                <div class="bg-cardBg border ${isSelected ? 'border-red-500/60 bg-red-950/10' : 'border-gray-800'} p-3 rounded-xl flex items-center gap-2.5 text-xs shadow-sm transition ${isLocked ? 'pointer-events-none' : ''}">
                    
                    <input type="checkbox" ${isSelected ? 'checked' : ''} ${isLocked ? 'disabled' : ''} onchange="toggleItemSelectForDelete(${index}, this.checked)" class="accent-red-500 w-4 h-4 cursor-pointer my-auto shrink-0" title="Select to delete">

                    <div class="flex-1 flex flex-col gap-2 min-w-0">
                        <div class="flex justify-between items-center gap-2">
                            <span class="font-bold text-white flex items-center gap-1.5 truncate">
                                <span class="text-gray-500 text-[10px]">#${index + 1}</span> ${escapeHtml(item.name)}
                            </span>
                            
                            ${isPaid ? `
                                <span class="font-black text-emerald-400 text-xs bg-emerald-500/20 px-2 py-0.5 rounded-md border border-emerald-500/40 shrink-0">
                                    <i class="fa-solid fa-check"></i> PAID (₱0.00)
                                </span>
                            ` : `
                                <span class="font-black text-green-400 text-sm shrink-0">₱${itemCost.toFixed(2)}</span>
                            `}
                        </div>

                        <div class="flex justify-between items-center pt-2 border-t border-gray-800/80 flex-wrap gap-2">
                            <div class="flex gap-1.5">
                                <button ${isLocked ? 'disabled' : ''} onclick="setItemType(${index}, 'store')" class="px-2.5 py-1 rounded-lg font-bold text-[10px] border transition ${isStore ? 'bg-orange-600 text-white border-orange-500' : 'bg-black/30 text-gray-400 border-gray-800 hover:text-white'}">
                                    <i class="fa-solid fa-store"></i> Store
                                </button>
                                <button ${isLocked ? 'disabled' : ''} onclick="setItemType(${index}, 'market')" class="px-2.5 py-1 rounded-lg font-bold text-[10px] border transition ${isMarket ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-black/30 text-gray-400 border-gray-800 hover:text-white'}">
                                    <i class="fa-solid fa-basket-shopping"></i> Market
                                </button>
                            </div>

                            <div class="flex items-center gap-3">
                                <label class="flex items-center gap-1 cursor-pointer text-[10px] font-bold ${isPaid ? 'text-emerald-400' : 'text-gray-400'} bg-black/40 px-2 py-1 rounded-lg border border-gray-800">
                                    <input type="checkbox" ${isPaid ? 'checked' : ''} ${isLocked ? 'disabled' : ''} onchange="toggleItemPaid(${index}, this.checked)" class="accent-emerald-500 w-3.5 h-3.5">
                                    <span>Paid</span>
                                </label>

                                <div class="flex items-center gap-2">
                                    <button ${isLocked ? 'disabled' : ''} onclick="openEditItemModal(${index})" class="text-blue-400 hover:text-blue-300 p-1" title="Edit Item"><i class="fa-solid fa-pen"></i></button>
                                    <button ${isLocked ? 'disabled' : ''} onclick="promptRemoveCartItem(${index})" class="text-red-400 hover:text-red-300 p-1" title="Delete Item"><i class="fa-solid fa-trash"></i></button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    updateCartSubtotal(subtotal);

    // RENDER ABSOLUTE OVERLAY BARRIER OVER BLURRED CART ITEMS WHEN LOCKED
    if (isLocked) {
        const clientName = globalState.cartClients?.[cartIdx] || "Customer";
        
        container.innerHTML = `
            <div class="relative w-full min-h-[280px] flex flex-col gap-2 rounded-2xl overflow-hidden">
                
                <!-- ABSOLUTE OVERLAY BARRIER SCREEN -->
                <div class="absolute inset-0 z-20 bg-darkBg/85 backdrop-blur-md border border-emerald-500/50 p-5 rounded-2xl flex flex-col items-center justify-center text-center gap-3 shadow-2xl animate-fade-in">
                    <div class="w-12 h-12 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center text-2xl">
                        <i class="fa-solid fa-file-circle-check"></i>
                    </div>
                    <div>
                        <h3 class="text-sm font-black text-emerald-400 uppercase tracking-wide">Receipt Already Recorded</h3>
                        <p class="text-[11px] text-gray-300 mt-1 leading-relaxed">
                            Ang resibo para kay <strong>"${escapeHtml(clientName)}"</strong> ay naitala na. I-slide ang bar sa ibaba para ma-unlock at ma-edit.
                        </p>
                    </div>

                    <!-- SLIDE TO UNLOCK PROTECTION BARRIER -->
                    <div class="w-full max-w-xs relative h-12 bg-black/60 rounded-full border border-emerald-500/40 flex items-center px-2 overflow-hidden mt-1 shadow-inner">
                        <span class="absolute inset-0 flex items-center justify-center text-[10px] text-emerald-400/80 font-bold tracking-widest pointer-events-none">
                            &gt;&gt;&gt;&gt; SLIDE TO UNLOCK & EDIT &gt;&gt;&gt;&gt;
                        </span>
                        <input type="range" min="0" max="100" value="0"
                               oninput="handleCartBarrierProgress(this.value)"
                               onmouseup="handleCartBarrierEnd(this)"
                               ontouchend="handleCartBarrierEnd(this)"
                               class="w-full accent-emerald-500 cursor-pointer z-10 opacity-80 h-10">
                    </div>
                </div>

                <!-- BLURRED CART ITEMS BEHIND OVERLAY -->
                <div class="flex flex-col gap-2 blur-[4px] pointer-events-none select-none opacity-40">
                    ${itemsHtml}
                </div>
            </div>
        `;

        const createBtn = document.querySelector('#view-cart button[onclick="validateAndProceedToWizard()"]');
        if (createBtn) createBtn.classList.add('hidden');
        return;
    }

    // Normal Unlocked View
    container.innerHTML = itemsHtml;

    const createBtn = document.querySelector('#view-cart button[onclick="validateAndProceedToWizard()"]');
    if (createBtn) createBtn.classList.remove('hidden');
}

export function handleCartBarrierProgress(val) {
    if (val >= 90) {
        const cartIdx = globalState.activeCartIndex ?? 0;
        if (!globalState.cartLocked) globalState.cartLocked = [false, false, false, false];
        globalState.cartLocked[cartIdx] = false;
        
        saveCartState();
        renderCartTabs();
        renderCartItems();
        showToast("🔓 Cart unlocked! Maaari mo nang baguhin ang mga items.");
    }
}

export function handleCartBarrierEnd(rangeEl) {
    if (rangeEl && rangeEl.value < 90) {
        rangeEl.value = 0;
    }
}

function renderCartActionsToolbar() {
    const container = document.getElementById('delete-selected-btn-container');
    if (!container) return;

    const cartIdx = globalState.activeCartIndex ?? 0;
    const isLocked = !!(globalState.cartLocked && globalState.cartLocked[cartIdx]);
    if (isLocked) {
        container.innerHTML = '';
        return;
    }

    const items = (globalState.carts && globalState.carts[cartIdx]) ? globalState.carts[cartIdx] : [];
    const selectedCount = items.filter(i => !!i.selectedForDelete).length;

    if (selectedCount > 0) {
        container.innerHTML = `
            <button onclick="promptDeleteSelectedItems()" class="flex-1 bg-red-600 hover:bg-red-500 text-white text-xs font-bold py-2 rounded-lg border border-red-500 transition active:scale-95 flex items-center justify-center gap-1.5 shadow-md">
                <i class="fa-solid fa-trash-can"></i> Delete Selected (${selectedCount})
            </button>
        `;
    } else {
        container.innerHTML = '';
    }
}

function updateCartSubtotal(subtotal) {
    const display = document.getElementById('cart-subtotal-display');
    const safeSubtotal = Math.max(0, subtotal || 0);
    if (display) display.innerText = safeSubtotal.toFixed(2);
}

export function toggleItemPaid(index, isPaid) {
    const cartIdx = globalState.activeCartIndex ?? 0;
    if (globalState.carts && globalState.carts[cartIdx] && globalState.carts[cartIdx][index]) {
        globalState.carts[cartIdx][index].isPaid = isPaid;
        if (isPaid) {
            globalState.carts[cartIdx][index].price = 0;
        }
        saveCartState();
        renderCartItems();
    }
}

export function toggleItemSelectForDelete(index, isChecked) {
    const cartIdx = globalState.activeCartIndex ?? 0;
    if (globalState.carts && globalState.carts[cartIdx] && globalState.carts[cartIdx][index]) {
        globalState.carts[cartIdx][index].selectedForDelete = isChecked;
        renderCartActionsToolbar();
    }
}

export function promptDeleteSelectedItems() {
    const cartIdx = globalState.activeCartIndex ?? 0;
    const items = (globalState.carts && globalState.carts[cartIdx]) ? globalState.carts[cartIdx] : [];
    const selectedCount = items.filter(i => !!i.selectedForDelete).length;

    if (selectedCount === 0) {
        showToast("⚠️ Walang napiling item na buburahin!");
        return;
    }

    openSlideDeleteModal(
        `Delete ${selectedCount} Item(s)?`,
        `I-drag pakanan para burahin ang ${selectedCount} na napiling item.`,
        () => {
            deleteSelectedItems();
        }
    );
}

export function deleteSelectedItems() {
    const cartIdx = globalState.activeCartIndex ?? 0;
    if (globalState.carts && globalState.carts[cartIdx]) {
        globalState.carts[cartIdx] = globalState.carts[cartIdx].filter(i => !i.selectedForDelete);
        saveCartState();
        renderCartItems();
        showToast("✅ Napiling items ay nabura na!");
    }
}

export function promptRemoveCartItem(index) {
    const cartIdx = globalState.activeCartIndex ?? 0;
    const item = globalState.carts?.[cartIdx]?.[index];
    const itemName = item ? item.name : "item";

    openSlideDeleteModal(
        "Delete Item?",
        `I-drag pakanan para burahin ang "${itemName}".`,
        () => {
            removeCartItem(index);
        }
    );
}

export function removeCartItem(index) {
    const cartIdx = globalState.activeCartIndex ?? 0;
    if (globalState.carts && globalState.carts[cartIdx]) {
        globalState.carts[cartIdx].splice(index, 1);
        saveCartState();
        renderCartItems();
        showToast("Item removed from cart");
    }
}

export function setItemType(index, type) {
    const cartIdx = globalState.activeCartIndex ?? 0;
    if (globalState.carts && globalState.carts[cartIdx] && globalState.carts[cartIdx][index]) {
        const strictType = type.toLowerCase();
        globalState.carts[cartIdx][index].type = strictType;
        globalState.carts[cartIdx][index].category = strictType;
        saveCartState();
        renderCartItems();
    }
}

export function setItemCategory(index, category) {
    setItemType(index, category);
}

export function handleCartActionBtn() {
    const cartIdx = globalState.activeCartIndex ?? 0;
    if (!globalState.carts || !globalState.carts[cartIdx] || globalState.carts[cartIdx].length === 0) return;

    openSlideDeleteModal(
        `Clear Cart ${cartIdx + 1}?`,
        `I-drag pakanan para burahin ang lahat ng laman ng Cart ${cartIdx + 1}.`,
        () => {
            globalState.carts[cartIdx] = [];
            saveCartState();
            renderCartItems();
            showToast(`Cart ${cartIdx + 1} cleared.`);
        }
    );
}

export function getRiderActiveCateringClients() {
    const myId = (appState.telegramId || "").toString().trim();
    const myName = (appState.riderName || "").toString().trim().toLowerCase();
    const roster = globalState.rosterMembers || [];

    const myRecord = roster.find(r => {
        const rId = (r.telegramId || "").toString().trim();
        const rName = (r.riderName || r.name || "").toString().trim().toLowerCase();
        const isMatch = (myId && rId === myId) || (myName && rName === myName);
        return isMatch && (r.status || "").toLowerCase() === 'catering';
    });

    if (!myRecord || !myRecord.customerName) return [];

    return myRecord.customerName.split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

window.addEventListener('rosterUpdated', () => {
    const cartSection = document.getElementById('view-cart');
    if (cartSection && !cartSection.classList.contains('hidden')) {
        renderCartItems();
    }
});

window.addEventListener('viewChanged', (e) => {
    if (e.detail === 'view-cart') {
        renderCartItems();
    }
});

export function getEffectiveCartClient(cartIndex) {
    if (!globalState.cartClients || !Array.isArray(globalState.cartClients)) {
        globalState.cartClients = ["", "", "", ""];
    }
    if (!globalState.cartManualFlags || !Array.isArray(globalState.cartManualFlags)) {
        globalState.cartManualFlags = [false, false, false, false];
    }

    const isManual = globalState.cartManualFlags[cartIndex];
    let val = (globalState.cartClients[cartIndex] || "").trim();

    if (isManual) {
        return val || "Sample";
    }

    const activeClients = getRiderActiveCateringClients();

    const takenByOthers = globalState.cartClients
        .map((c, idx) => ({ client: (c || "").trim(), idx }))
        .filter(item => item.idx !== cartIndex && item.client && item.client.toLowerCase() !== 'sample')
        .map(item => item.client.toLowerCase());

    if (val && val.toLowerCase() !== 'sample' && !takenByOthers.includes(val.toLowerCase())) {
        const existsInActive = activeClients.some(c => c.toLowerCase() === val.toLowerCase());
        if (existsInActive) return val;
    }

    const availableAuto = activeClients.filter(c => !takenByOthers.includes(c.toLowerCase()));

    if (availableAuto.length > 0) {
        const preferred = activeClients[cartIndex];
        if (preferred && !takenByOthers.includes(preferred.toLowerCase())) {
            globalState.cartClients[cartIndex] = preferred;
            saveCartClientsState();
            return preferred;
        } else {
            globalState.cartClients[cartIndex] = availableAuto[0];
            saveCartClientsState();
            return availableAuto[0];
        }
    }

    globalState.cartClients[cartIndex] = "Sample";
    saveCartClientsState();
    return "Sample";
}

function renderCartClientSelector() {
    const container = document.getElementById('cart-customer-selector-container');
    if (!container) return;

    const cartIdx = globalState.activeCartIndex ?? 0;
    const isManual = (globalState.cartManualFlags && globalState.cartManualFlags[cartIdx]) || false;

    const existingInput = document.getElementById('cart-manual-client-input');
    if (existingInput && document.activeElement === existingInput) {
        return;
    }

    const currentClient = getEffectiveCartClient(cartIdx);
    appState.selectedCateringClient = currentClient;

    const activeClients = getRiderActiveCateringClients();

    const takenByOthers = (globalState.cartClients || [])
        .map((c, idx) => ({ client: (c || "").trim(), idx }))
        .filter(item => item.idx !== cartIdx && item.client && item.client.toLowerCase() !== 'sample')
        .map(item => item.client.toLowerCase());

    let availableOptions = ["Sample"];

    activeClients.forEach(c => {
        if (!takenByOthers.includes(c.toLowerCase())) {
            if (!availableOptions.map(o => o.toLowerCase()).includes(c.toLowerCase())) {
                availableOptions.push(c);
            }
        }
    });

    if (!isManual && currentClient && currentClient.toLowerCase() !== 'sample') {
        if (!availableOptions.map(o => o.toLowerCase()).includes(currentClient.toLowerCase())) {
            availableOptions.push(currentClient);
        }
    }

    let optionsHtml = availableOptions.map(opt => {
        const isSelected = opt.toLowerCase() === currentClient.toLowerCase();
        return `<option value="${escapeHtml(opt)}" ${isSelected ? 'selected' : ''}>${escapeHtml(opt)}</option>`;
    }).join('');

    const inputValue = (currentClient === 'Sample' || !currentClient) ? '' : currentClient;

    container.innerHTML = `
        <div class="flex items-center gap-2 w-full text-xs">
            <label class="flex items-center gap-1 cursor-pointer shrink-0 text-[10px] text-gray-400 hover:text-white bg-black/30 px-2 py-1 rounded-lg border border-gray-800">
                <input type="checkbox" ${isManual ? 'checked' : ''} onchange="toggleCartManualClient(this.checked)" class="accent-amber-500 w-3.5 h-3.5">
                <span>Manual</span>
            </label>

            ${isManual ? `
                <input type="text" id="cart-manual-client-input" value="${escapeHtml(inputValue)}" placeholder="Type Client Name (or leave for Sample)" oninput="updateCartClientName(this.value)" class="w-full bg-darkBg text-xs text-amber-300 font-bold rounded-lg p-1.5 outline-none border border-gray-700 focus:border-amber-500">
            ` : `
                <select onchange="updateCartClientName(this.value)" class="w-full bg-darkBg text-xs text-amber-300 font-bold rounded-lg p-1.5 outline-none border border-gray-700 focus:border-amber-500">
                    ${optionsHtml}
                </select>
            `}
        </div>
    `;
}

export function toggleCartManualClient(isManual) {
    const cartIdx = globalState.activeCartIndex ?? 0;
    if (!globalState.cartManualFlags) globalState.cartManualFlags = [false, false, false, false];
    globalState.cartManualFlags[cartIdx] = isManual;

    if (!isManual) {
        globalState.cartClients[cartIdx] = "";
    }
    
    saveCartClientsState();
    renderCartItems();
}

export function updateCartClientName(val) {
    const cartIdx = globalState.activeCartIndex ?? 0;
    if (!globalState.cartClients) globalState.cartClients = ["", "", "", ""];
    
    globalState.cartClients[cartIdx] = val;
    appState.selectedCateringClient = val.trim() || "Sample";

    saveCartClientsState();
}

export function assignClientToCart(clientName) {
    updateCartClientName(clientName);
}

export function openEditItemModal(index) {
    const cartIdx = globalState.activeCartIndex ?? 0;
    const item = globalState.carts[cartIdx][index];
    if (!item) return;

    globalState.editItemIndex = index;
    document.getElementById('edit-name-input').value = item.name;
    document.getElementById('edit-price-input').value = item.price;
    const paidInput = document.getElementById('edit-paid-input');
    if (paidInput) paidInput.checked = !!item.isPaid;

    document.getElementById('edit-item-modal').classList.remove('hidden');
}

export function closeEditItemModal() {
    document.getElementById('edit-item-modal').classList.add('hidden');
    globalState.editItemIndex = null;
}

export function saveItemEdit() {
    if (globalState.editItemIndex === null || globalState.editItemIndex === undefined) return;
    
    const cartIdx = globalState.activeCartIndex ?? 0;
    const name = document.getElementById('edit-name-input').value.trim();
    let price = parseFloat(document.getElementById('edit-price-input').value) || 0;
    let isPaid = document.getElementById('edit-paid-input')?.checked || false;

    if (price < 0) {
        price = 0;
        isPaid = true;
    }

    if (!name) return showToast("Item name is required.");

    globalState.carts[cartIdx][globalState.editItemIndex].name = name;
    globalState.carts[cartIdx][globalState.editItemIndex].price = price;
    globalState.carts[cartIdx][globalState.editItemIndex].isPaid = isPaid;

    saveCartState();
    renderCartItems();
    closeEditItemModal();
    showToast("Item updated successfully.");
}

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

    const cartIdx = globalState.activeCartIndex ?? 0;
    
    if (!Array.isArray(globalState.carts)) globalState.carts = [[], [], [], []];
    if (!Array.isArray(globalState.carts[cartIdx])) globalState.carts[cartIdx] = [];

    const lines = input.split('\n');
    let addedCount = 0;

    lines.forEach(line => {
        const cleanLine = line.trim();
        if (!cleanLine) return;

        const parts = cleanLine.split(/\s+/);
        let price = 0;
        let isPaid = false;
        let name = cleanLine;

        const lastPartRaw = parts[parts.length - 1];
        const lastPartClean = lastPartRaw.replace(/,/g, '');
        
        if (!isNaN(lastPartClean) && lastPartClean !== "") {
            let parsedPrice = parseFloat(lastPartClean);
            if (parsedPrice < 0) {
                price = 0;
                isPaid = true;
            } else {
                price = parsedPrice;
            }

            if (parts.length > 1) {
                name = parts.slice(0, -1).join(' ');
            } else {
                name = "Item";
            }
        }

        if (name) {
            globalState.carts[cartIdx].push({
                name: name,
                price: price,
                isPaid: isPaid,
                type: '',
                category: '',
                selectedForDelete: false
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

export function validateAndProceedToWizard() {
    const cartIdx = globalState.activeCartIndex ?? 0;
    const cartItems = (globalState.carts && globalState.carts[cartIdx]) ? globalState.carts[cartIdx] : [];
    
    if (cartItems.length === 0) {
        showToast("⚠️ Walang laman ang cart!");
        return;
    }

    const hasUncategorized = cartItems.some(item => {
        const cat = item.category || item.type || '';
        return cat.toLowerCase() !== 'store' && cat.toLowerCase() !== 'market';
    });
    
    if (hasUncategorized) {
        showToast("⚠️ Paki-kategorya (Store o Market) ang lahat ng items bago mag-resibo!");
        return;
    }

    cartItems.forEach(item => {
        const currentCat = item.category || item.type || '';
        item.type = currentCat.toLowerCase();
        item.category = currentCat.toLowerCase();
        
        if ((item.price || 0) < 0) {
            item.price = 0;
            item.isPaid = true;
        }
    });
    saveCartState();

    const hasPaidItems = cartItems.some(i => !!i.isPaid || (i.price || 0) <= 0);

    if (hasPaidItems) {
        const paidModal = document.getElementById('paid-item-confirm-modal');
        if (paidModal) {
            paidModal.classList.remove('hidden');
            return;
        }
    }

    executeProceedToWizard();
}

export function closePaidItemModal() {
    const paidModal = document.getElementById('paid-item-confirm-modal');
    if (paidModal) paidModal.classList.add('hidden');
}

export function confirmPaidItemProceed() {
    closePaidItemModal();
    executeProceedToWizard();
}

function executeProceedToWizard() {
    if (typeof window.proceedToWizard === 'function') {
        window.proceedToWizard();
    } else {
        switchView('view-wizard');
    }
}

if (typeof window !== 'undefined') {
    window.closePaidItemModal = closePaidItemModal;
    window.confirmPaidItemProceed = confirmPaidItemProceed;
    window.toggleItemPaid = toggleItemPaid;
    window.toggleItemSelectForDelete = toggleItemSelectForDelete;
    window.promptDeleteSelectedItems = promptDeleteSelectedItems;
    window.promptRemoveCartItem = promptRemoveCartItem;
    window.handleCartActionBtn = handleCartActionBtn;
    window.setItemType = setItemType;
    window.openEditItemModal = openEditItemModal;
    window.closeEditItemModal = closeEditItemModal;
    window.saveItemEdit = saveItemEdit;
    window.showBulkAddModal = showBulkAddModal;
    window.closeBulkModal = closeBulkModal;
    window.processBulkAdd = processBulkAdd;
    window.switchCartTab = switchCartTab;
    window.validateAndProceedToWizard = validateAndProceedToWizard;
    window.toggleCartManualClient = toggleCartManualClient;
    window.updateCartClientName = updateCartClientName;
    window.handleCartBarrierProgress = handleCartBarrierProgress;
    window.handleCartBarrierEnd = handleCartBarrierEnd;
}

export function getCurrentCart() {
    const cartIdx = globalState.activeCartIndex ?? 0;
    return (globalState.carts && globalState.carts[cartIdx]) ? globalState.carts[cartIdx] : [];
}

export function clearCartSlot() {
    const cartIdx = globalState.activeCartIndex ?? 0;
    if (!Array.isArray(globalState.carts)) globalState.carts = [[], [], [], []];
    globalState.carts[cartIdx] = [];
    
    if (globalState.cartClients) globalState.cartClients[cartIdx] = "";
    if (globalState.cartManualFlags) globalState.cartManualFlags[cartIdx] = false;
    if (globalState.cartLocked) globalState.cartLocked[cartIdx] = false;
    if (globalState.cartTxIds) globalState.cartTxIds[cartIdx] = "";
    
    saveCartState();
    saveCartClientsState();
    renderCartItems();
}