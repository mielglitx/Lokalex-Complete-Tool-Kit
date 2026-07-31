// src/features/cart.js
import { multiCarts, activeCartSlot, setActiveCartSlot, wizState, appState, globalState } from '../store/state.js';
import { escapeHtml } from '../utils/helpers.js';
import { showToast } from '../ui/notifications.js';
import { switchView } from '../ui/router.js';
import { openSlideDeleteModal, closeBulkModal, closeEditItemModal } from '../ui/modals.js';
import { initWizardForCart } from './wizard.js';

let editItemIndex = -1;

// --- STATE PERSISTENCE ---
export function saveCartState() {
    try {
        const serializable = {};
        Object.keys(multiCarts).forEach(s => {
            serializable[s] = {
                items: multiCarts[s].items || [],
                selectedIds: Array.from(multiCarts[s].selectedIds || []),
                customerName: multiCarts[s].customerName || "",
                isManual: multiCarts[s].isManual || false,
                txId: multiCarts[s].txId || ""
            };
        });
        localStorage.setItem('lokalex_carts', JSON.stringify(serializable));
    } catch(e) {}
}

export function loadCartState() {
    const saved = localStorage.getItem('lokalex_carts');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            const slots = Object.keys(parsed);
            if (slots.length > 0) {
                // Clear initial default keys
                Object.keys(multiCarts).forEach(k => delete multiCarts[k]);
                
                slots.forEach(s => {
                    multiCarts[s] = {
                        items: parsed[s].items || [],
                        selectedIds: new Set(parsed[s].selectedIds || []),
                        customerName: parsed[s].customerName || "",
                        isManual: parsed[s].isManual || false,
                        txId: parsed[s].txId || ""
                    };
                });
            }
        } catch(e) {}
    }
}

export function getCurrentCart() { 
    return multiCarts[activeCartSlot] || multiCarts[1]; 
}

// --- DYNAMIC CART ADD / REMOVE ---
export function addNewCartSlot() {
    const existingSlots = Object.keys(multiCarts).map(Number);
    const newSlot = existingSlots.length > 0 ? Math.max(...existingSlots) + 1 : 1;

    multiCarts[newSlot] = {
        items: [],
        selectedIds: new Set(),
        customerName: "",
        isManual: false,
        txId: ""
    };

    setActiveCartSlot(newSlot);
    autoAssignCateringCustomersToCarts();
    saveCartState();
    renderCartTabs();
    renderCartCustomerSelector();
    renderCart();
    showToast(`Added Cart ${newSlot}`);
}

export function removeCartSlot(slotNum, event) {
    if (event) event.stopPropagation();
    const slots = Object.keys(multiCarts).map(Number);
    if (slots.length <= 1) {
        showToast("Maximum of 1 cart required.");
        return;
    }

    openSlideDeleteModal(`Burahin ang Cart ${slotNum}?`, () => {
        delete multiCarts[slotNum];
        
        // If active slot was deleted, switch to lowest available slot
        if (activeCartSlot === Number(slotNum)) {
            const remaining = Object.keys(multiCarts).map(Number);
            setActiveCartSlot(Math.min(...remaining));
        }

        autoAssignCateringCustomersToCarts();
        saveCartState();
        renderCartTabs();
        renderCartCustomerSelector();
        renderCart();
        showToast(`Cart ${slotNum} removed`);
    });
}

// --- RIDER ROSTER DATA & AUTO-ASSIGNMENT QUEUE ---
export function getActiveCateringCustomersWithTimes() {
    const myRecord = globalState.rosterMembers ? globalState.rosterMembers.find(m => m.telegramId.toString() === appState.telegramId.toString()) : null;
    if (!myRecord || myRecord.status !== 'Catering' || !myRecord.customerName) return [];

    const custs = myRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
    const times = myRecord.startTime ? myRecord.startTime.split(', ').map(t => t.trim()) : [];

    return custs.map((c, idx) => ({
        name: c,
        startTime: times[idx] || times[0] || ""
    }));
}

export function autoAssignCateringCustomersToCarts() {
    const activeCustList = getActiveCateringCustomersWithTimes();
    const slots = Object.keys(multiCarts).map(Number);

    if (activeCustList.length > 0) {
        const assignedNames = new Set();

        // Pass 1: Retain valid customer assignments
        slots.forEach(s => {
            const curr = multiCarts[s].customerName;
            const isManual = multiCarts[s].isManual;

            if (curr && curr !== "Sample") {
                const isStillActive = activeCustList.some(i => i.name === curr);
                if ((isStillActive || isManual) && !assignedNames.has(curr)) {
                    assignedNames.add(curr);
                } else if (!isManual) {
                    multiCarts[s].customerName = "";
                }
            }
        });

        // Pass 2: Auto-assign remaining roster customers to unassigned carts
        slots.forEach(s => {
            if (!multiCarts[s].customerName && !multiCarts[s].isManual) {
                const nextAvail = activeCustList.find(i => !assignedNames.has(i.name));
                if (nextAvail) {
                    multiCarts[s].customerName = nextAvail.name;
                    assignedNames.add(nextAvail.name);
                } else {
                    // Fallback to Sample if all active clients are distributed
                    multiCarts[s].customerName = "Sample";
                }
            }
        });
    } else {
        // No active catering clients on roster: set default to "Sample" for non-manual carts
        slots.forEach(s => {
            if (!multiCarts[s].isManual && (!multiCarts[s].customerName || multiCarts[s].customerName !== "Sample")) {
                multiCarts[s].customerName = "Sample";
            }
        });
    }
    saveCartState();
}

// --- CART CLEARING & QUEUE REPLACEMENT ---
export function clearCartSlot(slot = activeCartSlot) {
    if (multiCarts[slot]) {
        multiCarts[slot].items = [];
        multiCarts[slot].selectedIds = new Set();
        multiCarts[slot].customerName = "";
        multiCarts[slot].isManual = false;
        multiCarts[slot].txId = "";
    }
    saveCartState();
    autoAssignCateringCustomersToCarts(); // Automatically fills cart with next unassigned client or "Sample"
    renderCartTabs();
    renderCartCustomerSelector();
    renderCart();
}

// --- UI RENDERING & SELECTOR CONTROL ---
export function switchCartSlot(slotNum) {
    setActiveCartSlot(slotNum);
    autoAssignCateringCustomersToCarts();
    renderCartTabs();
    renderCartCustomerSelector();
    renderCart();
}

export function renderCartTabs() {
    const header = document.getElementById('cart-tabs-header');
    if (!header) return;

    // Convert container to smooth scrollable flex bar
    header.className = "bg-cardBg border-b border-gray-800 p-2 flex items-center gap-1.5 overflow-x-auto shrink-0";

    const slots = Object.keys(multiCarts).map(Number).sort((a, b) => a - b);
    let html = "";

    slots.forEach(s => {
        const cart = multiCarts[s];
        const isActive = s === activeCartSlot;
        const itemCount = cart.items.length;
        let badgeTxt = cart.customerName ? cart.customerName : (itemCount > 0 ? `${itemCount} items` : "Empty");

        html += `
        <div class="relative group shrink-0">
            <button onclick="switchCartSlot(${s})" class="flex flex-col items-center justify-center px-4 py-2 rounded-xl transition min-w-[80px] ${isActive ? 'bg-emerald-600 text-white shadow-lg ring-2 ring-emerald-400' : 'bg-inputBg text-gray-400 hover:text-white hover:bg-gray-800'} active:scale-95">
                <span class="text-xs font-black">Cart ${s}</span>
                <span class="text-[9px] truncate max-w-[70px] font-semibold mt-0.5 ${isActive ? 'text-emerald-100' : 'text-gray-400'}">${escapeHtml(badgeTxt)}</span>
            </button>
            ${slots.length > 1 ? `
                <button onclick="removeCartSlot(${s}, event)" class="absolute -top-1 -right-1 w-4 h-4 bg-red-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center opacity-80 hover:opacity-100 shadow transition" title="Remove Cart">×</button>
            ` : ''}
        </div>`;
    });

    // Add Cart (+) Button
    html += `
    <button onclick="addNewCartSlot()" class="flex items-center justify-center gap-1 px-3 py-3 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/40 text-xs font-bold shrink-0 transition active:scale-95" title="Add New Cart">
        <i class="fa-solid fa-plus"></i> <span class="text-[10px]">Add Cart</span>
    </button>`;

    header.innerHTML = html;
    document.getElementById('cart-slot-label').innerText = `Cart ${activeCartSlot}`;
    document.getElementById('btn-cart-slot-label').innerText = `Cart ${activeCartSlot}`;
}

export function toggleCartManualInput(isManual) {
    const currentCart = getCurrentCart();
    if (currentCart) {
        currentCart.isManual = isManual;
        if (!isManual) {
            currentCart.customerName = "";
            autoAssignCateringCustomersToCarts();
        } else if (!currentCart.customerName || currentCart.customerName === "Sample") {
            currentCart.customerName = "";
        }
        saveCartState();
        renderCartTabs();
        renderCartCustomerSelector();
    }
}

export function renderCartCustomerSelector() {
    const container = document.getElementById('cart-customer-selector-container');
    if (!container) return;

    const currentCart = getCurrentCart();
    const isManual = currentCart.isManual || false;
    const activeCustList = getActiveCateringCustomersWithTimes();

    let controlHtml = "";

    if (isManual) {
        // Manual Text Mode
        controlHtml = `
            <input type="text" id="cart-customer-text-input" placeholder="Type Client Name..." 
                oninput="multiCarts[activeCartSlot].customerName = this.value; saveCartState(); renderCartTabs();" 
                class="flex-1 bg-darkBg text-xs rounded-lg p-2 outline-none border border-amber-500/50 text-white font-semibold" 
                value="${escapeHtml(currentCart.customerName === 'Sample' ? '' : (currentCart.customerName || ''))}">
        `;
    } else if (activeCustList.length > 0) {
        // Dropdown Auto-Assign Mode from Catering Roster
        const assignedInOtherCarts = Object.keys(multiCarts)
            .map(Number)
            .filter(s => s !== activeCartSlot)
            .map(s => multiCarts[s].customerName)
            .filter(n => n && n !== "Sample");

        const availableCusts = activeCustList.filter(i => !assignedInOtherCarts.includes(i.name));
        let currentAssigned = currentCart.customerName;

        let optionsHtml = "";
        availableCusts.forEach(item => {
            const isSelected = item.name === currentAssigned;
            optionsHtml += `<option value="${escapeHtml(item.name)}" ${isSelected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`;
        });

        if (currentAssigned && !availableCusts.some(i => i.name === currentAssigned)) {
            optionsHtml += `<option value="${escapeHtml(currentAssigned)}" selected>${escapeHtml(currentAssigned)}</option>`;
        }

        controlHtml = `
            <select id="cart-customer-select" onchange="assignCustomerToCurrentCart(this.value)" class="flex-1 bg-darkBg text-xs rounded-lg p-2 outline-none border border-gray-700 text-white font-semibold">
                ${optionsHtml || `<option value="Sample" selected>Sample (No active client available)</option>`}
            </select>
        `;
    } else {
        // No Active Catering Customers on Roster -> Default to "Sample"
        controlHtml = `
            <div class="flex items-center justify-between flex-1 bg-darkBg/80 px-3 py-1.5 rounded-lg border border-gray-700/60">
                <span class="text-xs font-bold text-gray-300">Sample <span class="text-[9px] text-amber-400 font-normal">(No active catering client)</span></span>
                <span class="text-[9px] text-gray-500 italic">Not recorded in commission</span>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="flex items-center gap-2 flex-1">
            <label class="flex items-center gap-1.5 cursor-pointer shrink-0 bg-darkBg px-2.5 py-1.5 rounded-lg border border-gray-700 hover:border-amber-500/50 transition">
                <input type="checkbox" onchange="toggleCartManualInput(this.checked)" ${isManual ? 'checked' : ''} class="w-4 h-4 accent-amber-500 cursor-pointer">
                <span class="text-xs text-amber-400 font-bold">Manual Name</span>
            </label>
            ${controlHtml}
        </div>
    `;
}

export function assignCustomerToCurrentCart(custName) {
    multiCarts[activeCartSlot].customerName = custName.trim();
    saveCartState();
    renderCartTabs();
    renderCartCustomerSelector();
    if (custName) showToast(`Cart ${activeCartSlot} assigned to: ${custName}`);
}

// --- CART ITEM ACTIONS ---
export function processBulkAdd() {
    const raw = document.getElementById('bulk-input').value.trim();
    if(!raw) return closeBulkModal();

    const currentCart = getCurrentCart();
    raw.split('\n').forEach(line => {
        line = line.trim(); if(!line) return;
        let price = 0.0; let name = line;
        const match = line.match(/[\s\-:]+([\d\.,]+)$/);
        if(match) { price = parseFloat(match[1].replace(/,/g, '')) || 0.0; name = line.substring(0, match.index).trim(); }
        currentCart.items.push({ id: Math.random().toString(36).substr(2,9), item: name, price: price, category: null });
    });
    saveCartState();
    closeBulkModal(); 
    renderCartTabs();
    renderCart();
}

export function handleCartActionBtn() {
    const currentCart = getCurrentCart();
    if (currentCart.selectedIds.size > 0) {
        openSlideDeleteModal(`Burahin ang ${currentCart.selectedIds.size} na napiling item(s) sa Cart ${activeCartSlot}?`, () => {
            currentCart.items = currentCart.items.filter(i => !currentCart.selectedIds.has(i.id));
            currentCart.selectedIds.clear();
            saveCartState();
            renderCartTabs();
            renderCart();
        });
    } else {
        if (currentCart.items.length === 0) return;
        openSlideDeleteModal(`Sigurado ka bang gusto mong i-clear ang Cart ${activeCartSlot}?`, () => {
            clearCartSlot(activeCartSlot);
        });
    }
}

export function toggleSelectCartItem(id) {
    const currentCart = getCurrentCart();
    if (currentCart.selectedIds.has(id)) {
        currentCart.selectedIds.delete(id);
    } else {
        currentCart.selectedIds.add(id);
    }
    saveCartState();
    renderCartActionBtnState();
}

export function removeCartItem(id) {
    openSlideDeleteModal("Tanggalin ang item na ito?", () => {
        const currentCart = getCurrentCart();
        currentCart.items = currentCart.items.filter(i => i.id !== id);
        currentCart.selectedIds.delete(id);
        saveCartState();
        renderCartTabs();
        renderCart();
    });
}

export function setItemCategory(id, cat) { 
    const currentCart = getCurrentCart();
    const item = currentCart.items.find(i => i.id === id); 
    if(item && item.price > 0) { 
        item.category = cat; 
        saveCartState(); 
        renderCart(); 
    } else if(item && item.price === 0) { 
        showToast("Set price before categorizing!"); 
    } 
}

export function promptEditItem(id) {
    const currentCart = getCurrentCart();
    editItemIndex = currentCart.items.findIndex(i => i.id === id);
    if(editItemIndex === -1) return;
    document.getElementById('edit-name-input').value = currentCart.items[editItemIndex].item || "";
    document.getElementById('edit-price-input').value = currentCart.items[editItemIndex].price || "";
    document.getElementById('edit-item-modal').classList.remove('hidden'); 
    document.getElementById('edit-name-input').focus();
}

export function saveItemEdit() {
    const newName = document.getElementById('edit-name-input').value.trim();
    const newPrice = parseFloat(document.getElementById('edit-price-input').value) || 0.0;
    if (!newName) return showToast("Item name cannot be empty!");
    
    const currentCart = getCurrentCart();
    if(editItemIndex !== -1 && currentCart.items[editItemIndex]) { 
        currentCart.items[editItemIndex].item = newName;
        currentCart.items[editItemIndex].price = newPrice; 
        saveCartState();
    }
    closeEditItemModal(); 
    renderCart();
}

export function renderCartActionBtnState() {
    const btn = document.getElementById('cart-action-btn');
    if (!btn) return;
    const currentCart = getCurrentCart();
    if (currentCart.selectedIds.size > 0) {
        btn.innerHTML = `<i class="fa-solid fa-trash-can"></i> Delete Selected (${currentCart.selectedIds.size})`;
        btn.className = "flex-1 bg-red-600 text-white text-xs font-bold py-2 rounded-lg border border-red-500 transition active:scale-95";
    } else {
        btn.innerHTML = `<i class="fa-solid fa-trash-can"></i> Clear Cart ${activeCartSlot}`;
        btn.className = "flex-1 bg-red-600/20 text-red-400 text-xs font-bold py-2 rounded-lg border border-red-600/30 transition active:scale-95";
    }
}

export function renderCart() {
    const container = document.getElementById('cart-items-list');
    if (!container) return;

    const currentCart = getCurrentCart();
    let subtotal = 0;

    if (currentCart.items.length === 0) {
        container.innerHTML = `<div class="text-center py-10 text-gray-500">Cart ${activeCartSlot} is empty. Paste a list!</div>`;
        currentCart.selectedIds.clear();
    } else {
        container.innerHTML = currentCart.items.map((item, index) => {
            subtotal += item.price;
            const isTask = item.price === 0.0;
            const catM = item.category === 'Market';
            const catS = item.category === 'Store';
            const isChecked = currentCart.selectedIds.has(item.id);

            return `
            <div class="bg-cardBg border ${isTask ? 'border-orange-500/50' : 'border-gray-800'} p-3 rounded-xl shadow-sm flex items-center gap-3 relative">
                <input type="checkbox" onchange="toggleSelectCartItem('${item.id}')" ${isChecked ? 'checked' : ''} class="w-4 h-4 accent-blue-500 cursor-pointer">
                <div class="flex-1 flex flex-col gap-1">
                    <div class="font-bold text-sm ${isTask ? 'text-orange-400' : 'text-white'}">${index + 1}. ${escapeHtml(item.item)}</div>
                    <div class="flex justify-between items-end">
                        <div class="flex gap-2">
                            <button onclick="setItemCategory('${item.id}', 'Market')" class="text-[10px] px-2.5 py-0.5 rounded-full font-bold border transition ${catM ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-600 text-gray-400'}">Market</button>
                            <button onclick="setItemCategory('${item.id}', 'Store')" class="text-[10px] px-2.5 py-0.5 rounded-full font-bold border transition ${catS ? 'bg-orange-600 border-orange-600 text-white' : 'border-gray-600 text-gray-400'}">Store</button>
                        </div>
                        <div class="text-right">
                            <div class="text-xs font-bold ${isTask ? 'text-orange-400' : 'text-green-400'} mb-0.5">${isTask ? 'Kulang Presyo' : '₱'+item.price.toFixed(2)}</div>
                        </div>
                    </div>
                </div>
                <div class="flex flex-col gap-2 items-end pl-2 border-l border-gray-800">
                    <button onclick="removeCartItem('${item.id}')" class="text-red-400 hover:text-red-500 p-1 text-xs"><i class="fa-solid fa-trash"></i></button>
                    <button onclick="promptEditItem('${item.id}')" class="text-blue-400 hover:text-blue-300 p-1 text-xs"><i class="fa-solid fa-pen"></i></button>
                </div>
            </div>`;
        }).join('');
    }
    document.getElementById('cart-subtotal-display').innerText = subtotal.toFixed(2);
    renderCartActionBtnState();
}

export function proceedToWizard() {
    const currentCart = getCurrentCart();
    if (!currentCart || currentCart.items.length === 0) return showToast(`Cart ${activeCartSlot} is empty!`);
    if (currentCart.items.some(i => i.price === 0.0 || (i.price > 0 && !i.category))) return showToast("Fix prices and categories first!");

    document.getElementById('header-title').innerText = `Fee Wizard (Cart ${activeCartSlot})`;
    initWizardForCart();
    switchView('view-wizard');
}