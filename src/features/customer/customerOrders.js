// src/features/customer/customerOrders.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { 
    savedAddressesCache, 
    selectedAddressId, 
    checkoutPaymentMode, 
    updateCheckoutSelectedAddressUI, 
    cleanFirebasePathKey 
} from './customerProfile.js';
import { storesCache, isStoreCurrentlyOpen } from './customerStoresMenu.js';

let activeCustomerOrderListener = null;
let customerLiveMapObj = null;
let customerRiderMarker = null;
let customerDestMarker = null;
let customerDirectionsService = null;
let customerDirectionsRenderer = null;
let lastCustRouteCalcTime = 0;

export function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

export function areItemsMatching(itemA, itemB) {
    if (!itemA || !itemB) return false;
    if (itemA.itemId !== itemB.itemId) return false;
    
    const sizeA = itemA.size?.name || '';
    const sizeB = itemB.size?.name || '';
    if (sizeA !== sizeB) return false;
    
    const notesA = (itemA.instructions || '').trim().toLowerCase();
    const notesB = (itemB.instructions || '').trim().toLowerCase();
    if (notesA !== notesB) return false;
    
    const addonsA = (itemA.addons || []).map(a => `${a.name}:${parseFloat(a.priceDelta || 0).toFixed(2)}`).sort().join('|');
    const addonsB = (itemB.addons || []).map(a => `${a.name}:${parseFloat(a.priceDelta || 0).toFixed(2)}`).sort().join('|');
    if (addonsA !== addonsB) return false;
    
    return true;
}

// -------------------------------------------------------------
// CART STATE & COMPUTATION
// -------------------------------------------------------------
export function getCustomerCart() {
    try {
        const data = localStorage.getItem('lokalex_customer_cart_v1');
        const parsed = data ? JSON.parse(data) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
        return {};
    } catch(e) {
        return {};
    }
}

export function saveCustomerCart(cart) {
    localStorage.setItem('lokalex_customer_cart_v1', JSON.stringify(cart || {}));
    updateFloatingCartBadge();
}

export function updateFloatingCartBadge() {
    const cart = getCustomerCart();
    const storeIds = Object.keys(cart).filter(id => cart[id] && Array.isArray(cart[id].items) && cart[id].items.length > 0);

    let totalItems = 0;
    let totalPrice = 0;

    storeIds.forEach(id => {
        (cart[id].items || []).forEach(it => {
            totalItems += (parseInt(it.quantity) || 1);
            totalPrice += (parseFloat(it.totalPrice) || 0);
        });
    });

    const navBadge = document.getElementById('cust-nav-cart-count');
    if (navBadge) navBadge.innerText = totalItems.toString();

    document.querySelectorAll('.cust-modal-cart-count').forEach(el => {
        el.innerText = totalItems.toString();
    });

    const floatingDock = document.getElementById('cust-floating-cart-dock');
    const summaryStores = document.getElementById('floating-cart-stores-summary');
    const summaryItems = document.getElementById('floating-cart-items-count');
    const summaryPrice = document.getElementById('floating-cart-total-price');

    if (totalItems > 0) {
        if (floatingDock) floatingDock.classList.remove('hidden');
        if (summaryStores) summaryStores.innerText = `${storeIds.length} Store${storeIds.length > 1 ? 's' : ''}`;
        if (summaryItems) summaryItems.innerText = `${totalItems} item(s) configured`;
        if (summaryPrice) summaryPrice.innerText = `₱${totalPrice.toFixed(2)}`;
    } else {
        if (floatingDock) floatingDock.classList.add('hidden');
    }
}

export function openCustomerCartModal() {
    const modal = document.getElementById('cust-cart-modal');
    const container = document.getElementById('cust-cart-stores-container');
    if (!container) return;

    updateCheckoutSelectedAddressUI();

    const cart = getCustomerCart();
    const storeIds = Object.keys(cart).filter(id => cart[id] && Array.isArray(cart[id].items) && cart[id].items.length > 0);

    if (storeIds.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-500 dark:text-gray-400 italic py-12 text-xs flex flex-col items-center gap-2">
                <i class="fa-solid fa-basket-shopping text-2xl text-gray-400 dark:text-gray-600"></i>
                <span>Empty Cart. Tap "Explore Local Stores" to select items!</span>
            </div>`;
        updateCartCalculations(0);
        if (modal) modal.classList.remove('hidden');
        return;
    }

    let itemsSubtotal = 0;

    container.innerHTML = storeIds.map(storeId => {
        const storeGroup = cart[storeId];
        let storeTotal = 0;

        const itemsHtml = (storeGroup.items || []).map((item, itemIdx) => {
            const itemPrice = parseFloat(item.totalPrice) || 0;
            storeTotal += itemPrice;
            itemsSubtotal += itemPrice;

            let details = [];
            if (item.size && item.size.name) details.push(`Size: ${escapeHtml(item.size.name)}`);
            if (item.addons && item.addons.length > 0) details.push(`Addons: ${item.addons.map(a => escapeHtml(a.name)).join(', ')}`);
            if (item.instructions) details.push(`Note: "${escapeHtml(item.instructions)}"`);

            return `
            <div class="bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800/80 p-2 rounded-xl flex items-start justify-between gap-2 shadow-xs">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-xs text-gray-900 dark:text-white">${escapeHtml(item.name || 'Item')}</span>
                        <span class="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">₱${itemPrice.toFixed(2)}</span>
                    </div>
                    ${details.length > 0 ? `<p class="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">${details.join(' • ')}</p>` : ''}
                    <div class="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5 font-mono">
                        ${item.quantity || 1} x ₱${(parseFloat(item.unitPrice) || 0).toFixed(2)}
                    </div>
                </div>

                <div class="flex items-center gap-1 shrink-0 pt-0.5">
                    <button onclick="window.updateCustomerCartItemQty('${storeId}', ${itemIdx}, -1)" class="w-5 h-5 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-bold text-xs flex items-center justify-center active:scale-90">-</button>
                    <span class="w-4 text-center font-bold text-xs text-gray-900 dark:text-white">${item.quantity || 1}</span>
                    <button onclick="window.updateCustomerCartItemQty('${storeId}', ${itemIdx}, 1)" class="w-5 h-5 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-bold text-xs flex items-center justify-center active:scale-90">+</button>
                    <button onclick="window.promptDeleteCartItem('${storeId}', ${itemIdx}, '${escapeHtml(item.name || 'Item')}')" class="text-red-500 hover:text-red-400 p-1 ml-0.5 text-xs active:scale-90" title="Delete Item"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');

        return `
        <div class="bg-cardBg border border-gray-200 dark:border-gray-800 rounded-2xl p-2.5 flex flex-col gap-2 shadow-xs">
            <div class="flex justify-between items-center border-b border-gray-200 dark:border-gray-800 pb-1.5">
                <div class="flex items-center gap-2 min-w-0">
                    <i class="fa-solid fa-store text-orange-500 dark:text-orange-400 text-xs shrink-0"></i>
                    <span class="font-black text-xs text-gray-900 dark:text-white truncate">${escapeHtml(storeGroup.storeName || 'Store')}</span>
                </div>
                <span class="text-[11px] font-mono font-bold text-orange-600 dark:text-orange-300">₱${storeTotal.toFixed(2)}</span>
            </div>
            <div class="flex flex-col gap-1.5">
                ${itemsHtml}
            </div>
        </div>`;
    }).join('');

    updateCartCalculations(itemsSubtotal);

    if (modal) modal.classList.remove('hidden');
}

export function closeCustomerCartModal() {
    const modal = document.getElementById('cust-cart-modal');
    if (modal) modal.classList.add('hidden');
}

export function updateCustomerCartItemQty(storeId, itemIdx, delta) {
    const cart = getCustomerCart();
    if (!cart[storeId]?.items?.[itemIdx]) return;

    const item = cart[storeId].items[itemIdx];
    const newQty = (parseInt(item.quantity) || 1) + delta;

    if (newQty <= 0) {
        promptDeleteCartItem(storeId, itemIdx, item.name || "Item");
        return;
    }

    item.quantity = newQty;
    item.totalPrice = (parseFloat(item.unitPrice) || 0) * item.quantity;

    saveCustomerCart(cart);
    openCustomerCartModal();
}

export function promptDeleteCartItem(storeId, itemIdx, itemName = "Item") {
    openSlideDeleteModal(
        `Remove ${itemName}?`,
        `I-drag pakanan ang slider upang alisin ang [${itemName}] sa iyong Cart.`,
        () => {
            removeCustomerCartItem(storeId, itemIdx);
        }
    );
}

export function removeCustomerCartItem(storeId, itemIdx) {
    const cart = getCustomerCart();
    if (!cart[storeId]?.items) return;

    cart[storeId].items.splice(itemIdx, 1);
    if (cart[storeId].items.length === 0) delete cart[storeId];

    saveCustomerCart(cart);
    openCustomerCartModal();
    showToast("🗑️ Item removed from cart.");
}

export function updateCartCalculations(itemsSubtotal) {
    const grandTotalEl = document.getElementById('cust-cart-grand-total');
    if (grandTotalEl) grandTotalEl.innerText = itemsSubtotal.toFixed(2);
}

// -------------------------------------------------------------
// DISPATCH MULTI-STORE ORDER WITH SAVED DESTINATION
// -------------------------------------------------------------
export async function sendMultiStoreOrderToRiders() {
    const cart = getCustomerCart();
    const storeIds = Object.keys(cart).filter(id => cart[id] && Array.isArray(cart[id].items) && cart[id].items.length > 0);

    if (storeIds.length === 0) return showToast("⚠️ Cart is empty!");

    const sendBtn = document.getElementById('cust-send-order-btn') || document.querySelector('#cust-cart-modal button[onclick*="sendMultiStoreOrderToRiders"]');

    // Dynamic operating schedule check for every store in cart before dispatch
    for (const sId of storeIds) {
        const cleanSId = cleanFirebasePathKey(sId);
        const store = storesCache[cleanSId] || storesCache[sId] || cart[sId];
        if (!isStoreCurrentlyOpen(store, cleanSId)) {
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> SEND ORDER TO RIDERS`;
            }
            return showToast(`⚠️ Hindi maipadala: Kasalukuyang sarado ang [${store.storeName || store.name || 'Store'}]. Paki-check ang schedule.`);
        }
    }

    const custName = localStorage.getItem('customerName') || localStorage.getItem('lokalex_customer_name') || appState.customerName || "Customer";
    let rawCustId = localStorage.getItem('lokalex_customer_fb_id') || localStorage.getItem('customerId') || appState.customerFacebookId || appState.customerId;
    
    if (!rawCustId) {
        rawCustId = `CUST_${Date.now().toString(36).toUpperCase()}`;
        localStorage.setItem('lokalex_customer_fb_id', rawCustId);
        appState.customerFacebookId = rawCustId;
    }

    const custId = cleanFirebasePathKey(rawCustId);
    const orderId = `ORD_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(-3).toUpperCase()}`;

    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> SENDING ORDER...`;
    }

    let targetAddressObj = selectedAddressId && savedAddressesCache[selectedAddressId] ? savedAddressesCache[selectedAddressId] : Object.values(savedAddressesCache)[0];
    const deliveryAddressStr = targetAddressObj ? `${targetAddressObj.addressText}${targetAddressObj.landmark ? ` (Landmark: ${targetAddressObj.landmark})` : ''}` : "Delivery Location Pinned";

    let orderSummaryText = `📋 *Order ID:* #${orderId}\n👤 *Customer:* ${custName}\n📍 *Deliver To:* ${deliveryAddressStr}\n💳 *Payment:* ${checkoutPaymentMode.toUpperCase()}\n\n`;
    let grandItemsTotal = 0;
    const now = Date.now();

    const orderStoresPayload = {};

    storeIds.forEach((sId, idx) => {
        const store = cart[sId];
        let storeSubtotal = 0;
        const cleanSId = cleanFirebasePathKey(sId);

        const storeTitle = storeIds.length > 1 ? `🏪 *[Store ${idx + 1}] ${store.storeName || 'Store'}*` : `🏪 *${store.storeName || 'Store'}*`;
        orderSummaryText += `${storeTitle}${store.storeAddress ? ` (${store.storeAddress})` : ''}\n`;

        (store.items || []).forEach(it => {
            const itemPrice = parseFloat(it.totalPrice) || 0;
            storeSubtotal += itemPrice;
            grandItemsTotal += itemPrice;

            orderSummaryText += `  • ${it.quantity || 1}x ${it.name || 'Item'}`;
            if (it.size && it.size.name) orderSummaryText += ` (${it.size.name})`;
            if (it.addons && it.addons.length > 0) orderSummaryText += ` [${it.addons.map(a => a.name).join(', ')}]`;
            if (it.instructions) orderSummaryText += ` - Note: "${it.instructions}"`;
            orderSummaryText += ` = ₱${itemPrice.toFixed(2)}\n`;
        });
        orderSummaryText += `\n`;

        orderStoresPayload[cleanSId] = {
            storeId: cleanSId,
            storeName: store.storeName || "Store",
            storeAddress: store.storeAddress || "Poblacion",
            items: store.items || [],
            storeSubtotal: parseFloat(storeSubtotal) || 0,
            status: 'pending'
        };
    });

    orderSummaryText += `📦 *Items Total:* ₱${grandItemsTotal.toFixed(2)}`;

    try {
        if (db) {
            const chatMsg = {
                sender: custName,
                senderId: custId,
                text: orderSummaryText,
                timestamp: now,
                orderId: orderId,
                storeIds: storeIds.map(s => cleanFirebasePathKey(s)),
                isRider: false,
                status: 'sent'
            };

            await db.ref(`customerChats/${custId}/messages`).push(sanitizeForFirebase(chatMsg));
            await db.ref(`customerChats/${custId}/metadata`).update(sanitizeForFirebase({
                lastMessage: `🛍️ Multi-Store Order #${orderId} (₱${grandItemsTotal.toFixed(2)})`,
                lastUpdated: now,
                customerName: custName,
                customerFbId: custId,
                latestOrderId: orderId,
                orderedStoreIds: storeIds.map(s => cleanFirebasePathKey(s)),
                deliveryAddress: deliveryAddressStr,
                folder: 'inbox',
                status: 'active',
                orderStatus: 'placed',
                unreadForRider: true
            }));

            for (const sId of storeIds) {
                const storeGroup = cart[sId];
                const storeTotal = (storeGroup.items || []).reduce((sum, item) => sum + (parseFloat(item.totalPrice) || 0), 0);
                const sanitizedStoreId = cleanFirebasePathKey(sId);

                const storeTicket = {
                    orderId: orderId,
                    customerId: custId,
                    customerName: custName,
                    storeId: sanitizedStoreId,
                    storeName: storeGroup.storeName || "Store",
                    storeAddress: storeGroup.storeAddress || "Poblacion",
                    items: storeGroup.items || [],
                    totalAmount: parseFloat(storeTotal) || 0,
                    status: 'pending',
                    riderId: null,
                    riderName: 'Unassigned Rider',
                    timestamp: now,
                    updatedAt: now
                };

                await db.ref(`storeOrders/${sanitizedStoreId}/${orderId}`).set(sanitizeForFirebase(storeTicket)).catch(err => {
                    console.warn(`storeOrders write warning for ${sanitizedStoreId}:`, err);
                });
            }

            const masterOrderPayload = {
                orderId: orderId,
                customerId: custId,
                customerName: custName,
                deliveryAddress: deliveryAddressStr,
                paymentMode: checkoutPaymentMode,
                destinationCoords: targetAddressObj ? { lat: targetAddressObj.lat, lng: targetAddressObj.lng } : null,
                stores: orderStoresPayload,
                storeIds: storeIds.map(s => cleanFirebasePathKey(s)),
                itemsTotal: parseFloat(grandItemsTotal) || 0,
                grandTotal: parseFloat(grandItemsTotal) || 0,
                status: 'placed',
                milestones: {
                    placed: {
                        timestamp: now,
                        updatedBy: custName
                    }
                },
                assignedRiderId: null,
                assignedRiderName: null,
                timestamp: now
            };

            await db.ref(`orders/${orderId}`).set(sanitizeForFirebase(masterOrderPayload)).catch(err => {
                console.warn("orders master write warning:", err);
            });
        }

        saveCustomerCart({});
        closeCustomerCartModal();
        showToast("🎉 Order sent to Lokalex riders!");
        if (window.showSideNotification) {
            window.showSideNotification("ORDER SENT", `Dispatched #${orderId}`, "fa-bag-shopping", "text-emerald-400", "border-emerald-500");
        }
    } catch(e) {
        console.error("Order dispatch error:", e);
        showToast("❌ Failed to dispatch order: " + (e.message || "Unknown error"));
    } finally {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> SEND ORDER TO RIDERS`;
        }
    }
}

// -------------------------------------------------------------
// LIVE ORDER MILESTONE PROGRESS TRACKER & EMBED MAP
// -------------------------------------------------------------
export function listenToActiveCustomerOrderStatus(custId) {
    if (!db || !custId) return;

    if (activeCustomerOrderListener) activeCustomerOrderListener.off();

    activeCustomerOrderListener = db.ref(`customerChats/${custId}/metadata`);
    activeCustomerOrderListener.on('value', (snap) => {
        const meta = snap.val() || {};
        const latestOrderId = cleanFirebasePathKey(meta.latestOrderId);

        if (!latestOrderId || meta.folder === 'done' || meta.status === 'cancelled') {
            renderCustomerMilestoneCard(null);
            return;
        }

        db.ref(`orders/${latestOrderId}`).on('value', (orderSnap) => {
            const orderData = orderSnap.val();
            if (!orderData || orderData.status === 'delivered') {
                renderCustomerMilestoneCard(null);
            } else {
                renderCustomerMilestoneCard(orderData);
            }
        });
    });
}

export function renderCustomerMilestoneCard(orderData) {
    let trackerContainer = document.getElementById('cust-active-order-milestone-dock');
    const customerHome = document.getElementById('view-customer-home');

    if (!orderData) {
        if (trackerContainer) trackerContainer.classList.add('hidden');
        return;
    }

    if (!trackerContainer && customerHome) {
        trackerContainer = document.createElement('div');
        trackerContainer.id = 'cust-active-order-milestone-dock';
        trackerContainer.className = 'w-full flex flex-col gap-2 shrink-0';
        customerHome.insertBefore(trackerContainer, customerHome.firstChild);
    }

    if (!trackerContainer) return;

    const status = orderData.status || 'placed';
    const orderId = orderData.orderId || 'ORD';
    const riderName = orderData.assignedRiderName || 'Assigning Rider...';
    const riderId = (orderData.assignedRiderId || '').toString().trim();

    const stages = [
        { key: 'placed', label: 'Placed', icon: 'fa-receipt' },
        { key: 'preparing', label: 'Preparing', icon: 'fa-fire' },
        { key: 'picked_up', label: 'On The Way', icon: 'fa-motorcycle' },
        { key: 'arrived', label: 'Arrived', icon: 'fa-location-dot' }
    ];

    const currentStageIdx = stages.findIndex(s => s.key === status);
    const activeIdx = currentStageIdx !== -1 ? currentStageIdx : 0;

    const stepperHtml = stages.map((st, idx) => {
        const isDone = idx <= activeIdx;
        const isCurrent = idx === activeIdx;

        return `
        <div class="flex flex-col items-center flex-1 min-w-0">
            <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${isDone ? 'bg-emerald-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-400'} ${isCurrent ? 'ring-2 ring-emerald-400 animate-pulse' : ''}">
                <i class="fa-solid ${st.icon}"></i>
            </div>
            <span class="text-[8.5px] mt-1 font-bold ${isDone ? 'text-gray-900 dark:text-white' : 'text-gray-400'} truncate w-full text-center">${st.label}</span>
        </div>`;
    }).join(`
        <div class="flex-1 h-0.5 bg-gray-200 dark:bg-gray-800 self-center -mt-3"></div>
    `);

    let subAlertHtml = '';
    if (orderData.stores) {
        Object.values(orderData.stores).forEach(st => {
            if (st.substitutionAlert) {
                const sub = st.substitutionAlert;
                subAlertHtml = `
                <div class="bg-red-500/10 border border-red-500/40 p-2.5 rounded-2xl flex flex-col gap-1.5 animate-bounce">
                    <div class="flex items-center gap-1.5 font-black text-red-500 text-xs">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <span>Item Unavailable: ${escapeHtml(sub.itemName)}</span>
                    </div>
                    <p class="text-[10px] text-gray-300 leading-snug">
                        Store suggested: <strong>${escapeHtml(sub.replacement)}</strong>${sub.notes ? ` ("${escapeHtml(sub.notes)}")` : ''}
                    </p>
                    <div class="flex gap-1.5 mt-1">
                        <button onclick="window.resolveSubstitution('${orderId}', '${st.storeId}', true, '${escapeHtml(sub.replacement)}')" class="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-1 rounded-xl text-[10px] font-bold transition active:scale-95">
                            Accept Swap
                        </button>
                        <button onclick="window.resolveSubstitution('${orderId}', '${st.storeId}', false, '${escapeHtml(sub.itemName)}')" class="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-1 rounded-xl text-[10px] font-bold transition active:scale-95">
                            Decline & Remove
                        </button>
                    </div>
                </div>`;
            }
        });
    }

    trackerContainer.innerHTML = `
        <div class="bg-cardBg border border-emerald-500/40 rounded-3xl p-3 shadow-md flex flex-col gap-2.5">
            <div class="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-1.5">
                <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span class="font-black text-xs text-gray-900 dark:text-white">Active Order #${escapeHtml(orderId)}</span>
                </div>
                <span class="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold font-mono">🛵 ${escapeHtml(riderName)}</span>
            </div>

            ${subAlertHtml}

            <div class="flex items-center justify-between w-full px-1">
                ${stepperHtml}
            </div>

            <div class="w-full h-36 rounded-2xl overflow-hidden border border-emerald-500/30 relative mt-1 shadow-inner">
                <div id="cust-live-embed-map" class="w-full h-full"></div>
                <div id="cust-map-live-eta" class="absolute bottom-2 left-2 right-2 bg-black/80 backdrop-blur-sm border border-emerald-500/40 py-1 px-2.5 rounded-xl flex items-center justify-between text-[10px] text-white font-bold">
                    <span><i class="fa-solid fa-motorcycle text-emerald-400"></i> ${escapeHtml(riderName)}</span>
                    <span id="cust-dynamic-eta-text" class="text-emerald-400 font-mono">Tracking rider GPS...</span>
                </div>
            </div>
        </div>
    `;

    trackerContainer.classList.remove('hidden');

    if (riderId) {
        initCustomerLiveEmbedMap(riderId, orderData);
    }
}

export function initCustomerLiveEmbedMap(riderId, orderData) {
    const mapEl = document.getElementById('cust-live-embed-map');
    if (!mapEl || typeof google === 'undefined' || !google.maps) return;

    const defaultLoc = { lat: 15.6881, lng: 120.4144 };

    if (!customerLiveMapObj) {
        customerLiveMapObj = new google.maps.Map(mapEl, {
            center: defaultLoc,
            zoom: 15,
            disableDefaultUI: true,
            zoomControl: false
        });
    }

    if (!customerDirectionsService) customerDirectionsService = new google.maps.DirectionsService();
    if (!customerDirectionsRenderer) {
        customerDirectionsRenderer = new google.maps.DirectionsRenderer({
            map: customerLiveMapObj,
            suppressMarkers: true,
            polylineOptions: { strokeColor: '#10B981', strokeWeight: 5, strokeOpacity: 0.85 }
        });
    }

    db.ref(`roster/${riderId}`).on('value', (snap) => {
        const rider = snap.val();
        if (!rider || !rider.lat || !rider.lng) return;

        const riderPos = { lat: parseFloat(rider.lat), lng: parseFloat(rider.lng) };
        const destPos = { lat: appState.lat || 15.6881, lng: appState.lon || 120.4144 };

        if (!customerRiderMarker) {
            customerRiderMarker = new google.maps.Marker({
                position: riderPos,
                map: customerLiveMapObj,
                icon: { url: "https://img.icons8.com/color/48/motorcycle.png", scaledSize: new google.maps.Size(32, 32) }
            });
        } else {
            customerRiderMarker.setPosition(riderPos);
        }

        if (!customerDestMarker) {
            customerDestMarker = new google.maps.Marker({
                position: destPos,
                map: customerLiveMapObj,
                icon: { url: "http://maps.google.com/mapfiles/ms/icons/red-dot.png" }
            });
        }

        const now = Date.now();
        if (now - lastCustRouteCalcTime >= 10000 || lastCustRouteCalcTime === 0) {
            lastCustRouteCalcTime = now;
            customerDirectionsService.route({
                origin: riderPos,
                destination: destPos,
                travelMode: google.maps.TravelMode.DRIVING
            }, (res, status) => {
                if (status === google.maps.DirectionsStatus.OK && res.routes[0]?.legs[0]) {
                    customerDirectionsRenderer.setDirections(res);
                    const leg = res.routes[0].legs[0];
                    const etaEl = document.getElementById('cust-dynamic-eta-text');
                    if (etaEl) etaEl.innerText = `${leg.duration.text} (${leg.distance.text})`;
                }
            });
        }
    });
}

export async function resolveSubstitution(orderId, storeId, accepted, itemNameOrReplacement) {
    const custName = localStorage.getItem('customerName') || "Customer";
    const cleanOrderId = cleanFirebasePathKey(orderId);
    const cleanStoreId = cleanFirebasePathKey(storeId);
    const now = Date.now();

    if (!cleanOrderId || !cleanStoreId || !db) return;

    try {
        const statusText = accepted 
            ? `✅ Customer APPROVED substitution: [${itemNameOrReplacement}]` 
            : `🚫 Customer DECLINED substitution for [${itemNameOrReplacement}]. Please remove from order.`;

        await db.ref(`storeRiderChats/${cleanOrderId}_${cleanStoreId}/messages`).push(sanitizeForFirebase({
            sender: custName,
            senderType: 'customer',
            senderName: custName,
            text: statusText,
            timestamp: now
        }));

        await db.ref(`storeOrders/${cleanStoreId}/${cleanOrderId}/substitutionAlert`).remove();
        showToast(accepted ? "✅ Substitution confirmed!" : "🚫 Substitution declined.");
    } catch(e) {
        showToast("❌ Failed to update substitution choice.");
    }
}