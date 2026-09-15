// src/features/advancedOrders/advancedOrdersUI.js
import { db } from '../../config/firebase.js';
import { globalState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml, getLocalTodayStr } from '../../utils/helpers.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { checkScheduledDeliveryAlerts } from './advancedOrdersAlerts.js';
import { 
    editingAdvancedOrderId, 
    setEditingAdvancedOrderId 
} from './advancedOrdersActions.js';

export let selectedOrderIds = new Set();

export function resetAddTabButtonState() {
    const addBtn = document.getElementById('adv-tab-btn-add');
    if (addBtn) {
        addBtn.innerHTML = '+ Schedule New';
    }

    const submitBtn = document.getElementById('adv-submit-btn') || 
                      document.querySelector('#adv-tab-add-content button[onclick*="submitNewAdvancedOrder"]') ||
                      document.querySelector('#adv-tab-add-content button.bg-amber-600') ||
                      document.querySelector('#adv-tab-add-content button');

    if (submitBtn) {
        const origHtml = submitBtn.getAttribute('data-original-html');
        if (origHtml) {
            submitBtn.innerHTML = origHtml;
        } else {
            submitBtn.innerHTML = '<i class="fa-solid fa-calendar-plus mr-1"></i> Schedule Advance Order';
        }
        submitBtn.classList.remove('bg-amber-600', 'hover:bg-amber-500');
        submitBtn.classList.add('bg-purple-600', 'hover:bg-purple-500');
    }
}

export function switchAdvTab(tab) {
    const listBtn = document.getElementById('adv-tab-btn-list');
    const addBtn = document.getElementById('adv-tab-btn-add');
    const listContent = document.getElementById('adv-tab-list-content');
    const addContent = document.getElementById('adv-tab-add-content');

    if (tab === 'list') {
        setEditingAdvancedOrderId(null);
        resetAddTabButtonState();

        if (listBtn) listBtn.className = "flex-1 py-1.5 rounded-lg bg-purple-600 text-white font-bold transition shadow";
        if (addBtn) addBtn.className = "flex-1 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-bold transition";
        if (listContent) listContent.classList.remove('hidden'); 
        if (addContent) addContent.classList.add('hidden');
        renderAdvancedOrdersList();
    } else {
        if (!editingAdvancedOrderId) {
            resetAddTabButtonState();
            const nameEl = document.getElementById('adv-cust-name');
            const recEl = document.getElementById('adv-receiver');
            const addrEl = document.getElementById('adv-address');
            const conEl = document.getElementById('adv-contact');
            const timeEl = document.getElementById('adv-receive-time');
            const dateEl = document.getElementById('adv-receive-date');

            if (nameEl) nameEl.value = "";
            if (recEl) recEl.value = "";
            if (addrEl) addrEl.value = "";
            if (conEl) conEl.value = "";
            if (timeEl) timeEl.value = "";
            if (dateEl) dateEl.value = getLocalTodayStr();
        }

        if (addBtn) addBtn.className = "flex-1 py-1.5 rounded-lg bg-purple-600 text-white font-bold transition shadow";
        if (listBtn) listBtn.className = "flex-1 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-bold transition";
        if (addContent) addContent.classList.remove('hidden'); 
        if (listContent) listContent.classList.add('hidden');

        const dateInput = document.getElementById('adv-receive-date');
        if (dateInput && !dateInput.value) {
            dateInput.value = getLocalTodayStr();
        }
    }
}

export function toggleSelectAdvancedOrder(orderId, isChecked) {
    const id = (orderId || "").toString();
    if (isChecked) {
        selectedOrderIds.add(id);
    } else {
        selectedOrderIds.delete(id);
    }
    updateBulkSelectionToolbarUI();
}

export function toggleSelectAllAdvancedOrders(isChecked) {
    const orders = globalState.globalAdvancedOrders || [];
    if (isChecked) {
        orders.forEach(o => {
            const id = (o.id || o.key || "").toString();
            if (id) selectedOrderIds.add(id);
        });
    } else {
        selectedOrderIds.clear();
    }
    renderAdvancedOrdersList();
}

function updateBulkSelectionToolbarUI() {
    const countSpan = document.getElementById('adv-selected-count');
    const selectAllCb = document.getElementById('adv-select-all-checkbox');
    const deleteBtn = document.getElementById('adv-bulk-delete-btn');
    const total = (globalState.globalAdvancedOrders || []).length;
    const count = selectedOrderIds.size;

    if (countSpan) countSpan.innerText = count.toString();
    if (selectAllCb) selectAllCb.checked = total > 0 && count === total;

    if (deleteBtn) {
        if (count > 0) {
            deleteBtn.disabled = false;
            deleteBtn.removeAttribute('disabled');
            deleteBtn.className = "bg-red-600 hover:bg-red-500 text-white px-2.5 py-1 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow transition active:scale-95 cursor-pointer";
            deleteBtn.innerHTML = `<i class="fa-solid fa-trash"></i> Delete Selected (${count})`;
        } else {
            deleteBtn.disabled = true;
            deleteBtn.setAttribute('disabled', 'true');
            deleteBtn.className = "opacity-40 cursor-not-allowed bg-red-500/10 text-red-400 border border-red-500/20 px-2.5 py-1 rounded-lg font-bold text-xs flex items-center gap-1.5";
            deleteBtn.innerHTML = `<i class="fa-solid fa-trash"></i> Delete Selected`;
        }
    }
}

export function promptDeleteSingleAdvancedOrder(orderId, custName) {
    openSlideDeleteModal(
        `Delete Scheduled Order?`,
        `Sigurado ka bang nais burahin ang scheduled order ni [${custName || 'Customer'}]?`,
        async () => {
            await executeDeleteSingleAdvancedOrder(orderId, custName);
        }
    );
}

export async function executeDeleteSingleAdvancedOrder(orderId, custName = "") {
    const targetId = (orderId || "").toString();
    if (!targetId) return;

    if (db) {
        await db.ref(`advancedOrders/${targetId}`).remove().catch((err) => {
            console.error("Firebase single delete error:", err);
        });
    }

    if (globalState.globalAdvancedOrders) {
        globalState.globalAdvancedOrders = globalState.globalAdvancedOrders.filter(
            o => (o.id || o.key || "").toString() !== targetId
        );
    }

    selectedOrderIds.delete(targetId);
    renderAdvancedOrdersList();
    checkScheduledDeliveryAlerts();
    showToast(`🗑️ Nabura na ang scheduled order ni ${custName || 'Customer'}.`);
}

export function promptDeleteSelectedAdvancedOrders() {
    if (selectedOrderIds.size === 0) {
        return showToast("⚠️ Pumili muna ng order na nais burahin.");
    }

    const count = selectedOrderIds.size;
    openSlideDeleteModal(
        `Delete ${count} Scheduled Orders?`,
        `Sigurado ka bang nais burahin ang ${count} napiling scheduled order(s)? Hindi na ito maibabalik.`,
        async () => {
            await executeDeleteSelectedAdvancedOrders();
        }
    );
}

export async function executeDeleteSelectedAdvancedOrders() {
    if (selectedOrderIds.size === 0) return;

    const idsToDelete = Array.from(selectedOrderIds);
    const count = idsToDelete.length;

    if (db) {
        try {
            await Promise.all(
                idsToDelete.map(id => db.ref(`advancedOrders/${id}`).remove())
            );
        } catch (err) {
            console.warn("Direct child remove encountered an issue, trying scoped child update:", err);
            const updates = {};
            idsToDelete.forEach(id => {
                updates[id] = null;
            });
            await db.ref('advancedOrders').update(updates).catch((updateErr) => {
                console.error("Scoped update error:", updateErr);
            });
        }
    }

    const idsSet = new Set(idsToDelete);
    if (globalState.globalAdvancedOrders) {
        globalState.globalAdvancedOrders = globalState.globalAdvancedOrders.filter(o => {
            const id = (o.id || o.key || "").toString();
            return !idsSet.has(id);
        });
    }

    selectedOrderIds.clear();
    renderAdvancedOrdersList();
    checkScheduledDeliveryAlerts();
    showToast(`🗑️ Matagumpay na nabura ang ${count} scheduled order(s).`);
}

function attachSwipeGesturesToCards(container) {
    const items = container.querySelectorAll('.adv-swipe-item');

    items.forEach(item => {
        const card = item.querySelector('.adv-swipe-card');
        const bgEl = item.querySelector('.adv-swipe-bg');
        const orderId = item.dataset.id;
        const custName = item.dataset.custName || 'Customer';
        if (!card) return;

        let startX = 0;
        let startY = 0;
        let isSwiping = false;
        let isHorizontal = false;

        const handleStart = (clientX, clientY) => {
            startX = clientX;
            startY = clientY;
            isSwiping = true;
            isHorizontal = false;
            card.style.transition = 'none';
        };

        const handleMove = (clientX, clientY, e) => {
            if (!isSwiping) return;

            const deltaX = clientX - startX;
            const deltaY = clientY - startY;

            if (!isHorizontal) {
                if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
                    if (Math.abs(deltaX) > Math.abs(deltaY)) {
                        isHorizontal = true;
                    } else {
                        isSwiping = false;
                        return;
                    }
                }
            }

            if (isHorizontal) {
                if (e.cancelable) e.preventDefault();
                if (deltaX < 0) {
                    if (bgEl) bgEl.style.opacity = '1';
                    const moveDist = Math.min(0, Math.max(-140, deltaX));
                    card.style.transform = `translateX(${moveDist}px)`;
                } else {
                    card.style.transform = 'translateX(0px)';
                    if (bgEl) bgEl.style.opacity = '0';
                }
            }
        };

        const handleEnd = () => {
            if (!isSwiping && !isHorizontal) return;
            isSwiping = false;

            const finalDelta = parseFloat((card.style.transform || '').replace(/[^0-9.-]/g, '')) || 0;
            card.style.transition = 'transform 0.2s cubic-bezier(0.25, 1, 0.5, 1)';

            if (finalDelta <= -75) {
                card.style.transform = 'translateX(0px)';
                if (bgEl) {
                    setTimeout(() => { if (bgEl) bgEl.style.opacity = '0'; }, 200);
                }
                promptDeleteSingleAdvancedOrder(orderId, custName);
            } else {
                card.style.transform = 'translateX(0px)';
                if (bgEl) {
                    setTimeout(() => { if (bgEl) bgEl.style.opacity = '0'; }, 200);
                }
            }
        };

        card.addEventListener('touchstart', (e) => {
            if (e.target.closest('button, input, select, a, label')) return;
            handleStart(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });

        card.addEventListener('touchmove', (e) => {
            if (!isSwiping) return;
            handleMove(e.touches[0].clientX, e.touches[0].clientY, e);
        }, { passive: false });

        card.addEventListener('touchend', handleEnd);
        card.addEventListener('touchcancel', handleEnd);

        card.addEventListener('mousedown', (e) => {
            if (e.target.closest('button, input, select, a, label')) return;
            handleStart(e.clientX, e.clientY);

            const onMouseMove = (moveEvent) => {
                handleMove(moveEvent.clientX, moveEvent.clientY, moveEvent);
            };

            const onMouseUp = () => {
                handleEnd();
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    });
}

export function renderAdvancedOrdersList() {
    const container = document.getElementById('adv-tab-list-content');
    if (!container) return;

    container.classList.add('overflow-y-auto', 'flex-1', 'pr-1');

    const orders = globalState.globalAdvancedOrders || [];

    if (orders.length === 0) {
        selectedOrderIds.clear();
        container.innerHTML = `<div class="text-center text-gray-500 italic py-8 text-xs">No scheduled advanced orders found.</div>`;
        return;
    }

    const validKeys = new Set(orders.map(o => (o.id || o.key || "").toString()));
    selectedOrderIds.forEach(id => {
        if (!validKeys.has(id)) selectedOrderIds.delete(id);
    });

    const isAllSelected = orders.length > 0 && selectedOrderIds.size === orders.length;
    const selectedCount = selectedOrderIds.size;

    const toolbarHtml = `
    <div class="flex items-center justify-between bg-gray-100 dark:bg-black/40 border border-gray-200 dark:border-gray-800/80 px-3 py-2 rounded-2xl mb-2.5 text-xs shadow-xs shrink-0 w-full">
        <label class="inline-flex items-center gap-2 cursor-pointer select-none font-bold text-gray-700 dark:text-gray-300">
            <input type="checkbox" id="adv-select-all-checkbox" class="w-4 h-4 accent-purple-600 rounded cursor-pointer"
                ${isAllSelected ? 'checked' : ''}
                onchange="window.toggleSelectAllAdvancedOrders && window.toggleSelectAllAdvancedOrders(this.checked)">
            <span>Select All (<span id="adv-selected-count">${selectedCount}</span>/${orders.length})</span>
        </label>
        
        <button type="button" id="adv-bulk-delete-btn" onclick="window.promptDeleteSelectedAdvancedOrders && window.promptDeleteSelectedAdvancedOrders()"
            ${selectedCount === 0 ? 'disabled class="opacity-40 cursor-not-allowed bg-red-500/10 text-red-400 border border-red-500/20 px-2.5 py-1 rounded-lg font-bold text-xs flex items-center gap-1.5"' : 'class="bg-red-600 hover:bg-red-500 text-white px-2.5 py-1 rounded-lg font-bold text-xs flex items-center gap-1.5 shadow transition active:scale-95 cursor-pointer"'}>
            <i class="fa-solid fa-trash"></i> Delete Selected${selectedCount > 0 ? ` (${selectedCount})` : ''}
        </button>
    </div>`;

    const cardsHtml = orders.slice().reverse().map(ord => {
        const ordId = (ord.id || ord.key || "").toString();
        const status = ord.status || "Pending";
        const displayDate = ord.dateToReceive || getLocalTodayStr();
        const cateredBy = ord.cateredBy || "Unassigned";
        const isChecked = selectedOrderIds.has(ordId);

        let statusBadge = ""; 
        let actionBtns = "";

        if (status === 'Pending') {
            statusBadge = `<span class="bg-amber-50 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-200 dark:border-amber-500/30">⏳ Pending</span>`;
            actionBtns = `
                <div class="flex gap-1 items-center flex-wrap">
                    <button type="button" onclick="window.addOrderToPhoneCalendar && window.addOrderToPhoneCalendar('${escapeHtml(ordId)}')" class="bg-blue-50 hover:bg-blue-100 dark:bg-blue-600/30 dark:hover:bg-blue-600/50 border border-blue-200 dark:border-blue-500/50 text-blue-700 dark:text-blue-300 text-[10px] font-bold px-2 py-1 rounded-lg transition active:scale-95" title="Add to Calendar / Alarm"><i class="fa-solid fa-bell"></i> Alarm</button>
                    <button type="button" onclick="window.takeAdvancedOrder && window.takeAdvancedOrder('${escapeHtml(ordId)}')" class="bg-purple-600 hover:bg-purple-500 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95 shadow"><i class="fa-solid fa-motorcycle"></i> Being Catered</button>
                    <button type="button" onclick="window.markAdvancedOrderDone && window.markAdvancedOrderDone('${escapeHtml(ordId)}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95 shadow"><i class="fa-solid fa-check"></i> Done</button>
                    <button type="button" onclick="window.changeAdvOrderStatus && window.changeAdvOrderStatus('${escapeHtml(ordId)}', 'Cancelled')" class="bg-red-50 hover:bg-red-100 dark:bg-red-900/40 dark:hover:bg-red-900/60 border border-red-200 dark:border-red-700/50 text-red-600 dark:text-red-400 font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95"><i class="fa-solid fa-ban"></i> Cancel</button>
                    <button type="button" onclick="window.editAdvancedOrder && window.editAdvancedOrder('${escapeHtml(ordId)}')" class="bg-amber-50 hover:bg-amber-100 dark:bg-amber-600/30 dark:hover:bg-amber-600/50 border border-amber-200 dark:border-amber-500/50 text-amber-700 dark:text-amber-300 font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95" title="Edit Scheduled Order"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
                </div>`;
        } else if (status === 'Catering') {
            statusBadge = `<span class="bg-orange-50 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400 text-[10px] font-bold px-2 py-0.5 rounded border border-orange-200 dark:border-orange-500/30 animate-pulse">🛵 Being Catered: ${escapeHtml(cateredBy)}</span>`;
            actionBtns = `
                <div class="flex gap-1 items-center flex-wrap">
                    <button type="button" onclick="window.takeAdvancedOrder && window.takeAdvancedOrder('${escapeHtml(ordId)}')" class="bg-purple-50 hover:bg-purple-100 dark:bg-purple-600/30 border border-purple-200 dark:border-purple-500/50 text-purple-700 dark:text-purple-300 font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95" title="Reassign Rider"><i class="fa-solid fa-user-pen"></i> Reassign</button>
                    <button type="button" onclick="window.markAdvancedOrderDone && window.markAdvancedOrderDone('${escapeHtml(ordId)}')" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95 shadow"><i class="fa-solid fa-check"></i> Done</button>
                    <button type="button" onclick="window.changeAdvOrderStatus && window.changeAdvOrderStatus('${escapeHtml(ordId)}', 'Cancelled')" class="bg-red-50 hover:bg-red-100 dark:bg-red-900/40 dark:hover:bg-red-900/60 border border-red-200 dark:border-red-700/50 text-red-600 dark:text-red-400 font-bold text-[10px] px-2 py-1 rounded-lg transition active:scale-95"><i class="fa-solid fa-ban"></i> Cancel</button>
                    <button type="button" onclick="window.editAdvancedOrder && window.editAdvancedOrder('${escapeHtml(ordId)}')" class="bg-amber-50 hover:bg-amber-100 dark:bg-amber-600/30 dark:hover:bg-amber-600/50 border border-amber-200 dark:border-amber-500/50 text-amber-700 dark:text-amber-300 font-bold text-[10px] px-2.5 py-1 rounded-lg transition active:scale-95" title="Edit Scheduled Order"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
                </div>`;
        } else if (status === 'Catered') {
            statusBadge = `<span class="bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30"><i class="fa-solid fa-check-double"></i> Done by ${escapeHtml(cateredBy)}</span>`;
            actionBtns = `
                <div class="flex items-center gap-2">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 font-bold">Finished</span>
                    <button type="button" onclick="window.changeAdvOrderStatus && window.changeAdvOrderStatus('${escapeHtml(ordId)}', 'Pending')" class="text-blue-500 hover:text-blue-400 text-[10px] font-bold underline transition">Reopen</button>
                </div>`;
        } else if (status === 'Cancelled') {
            statusBadge = `<span class="bg-red-50 dark:bg-red-500/20 text-red-700 dark:text-red-400 text-[10px] font-bold px-2 py-0.5 rounded border border-red-200 dark:border-red-500/30"><i class="fa-solid fa-xmark"></i> Cancelled</span>`;
            actionBtns = `
                <div class="flex items-center gap-2">
                    <span class="text-[10px] text-gray-400 italic">Cancelled</span>
                    <button type="button" onclick="window.changeAdvOrderStatus && window.changeAdvOrderStatus('${escapeHtml(ordId)}', 'Pending')" class="text-blue-500 hover:text-blue-400 text-[10px] font-bold underline transition">Restore</button>
                </div>`;
        }

        return `
        <div class="adv-swipe-item relative overflow-hidden rounded-2xl mb-2.5 select-none shadow-xs shrink-0 w-full" style="min-height: fit-content;" data-id="${escapeHtml(ordId)}" data-cust-name="${escapeHtml(ord.custName)}">
            <!-- Background Swipe Reveal -->
            <div class="adv-swipe-bg absolute inset-0 bg-red-600 text-white flex items-center justify-between px-4 rounded-2xl opacity-0 transition-opacity duration-150">
                <span class="text-xs font-bold flex items-center gap-1.5"><i class="fa-solid fa-trash"></i> Release to delete</span>
                <span class="text-xs font-bold flex items-center gap-1.5"><i class="fa-solid fa-trash"></i></span>
            </div>

            <!-- Foreground Swipable Card -->
            <div class="adv-swipe-card relative z-10 w-full bg-white dark:bg-cardBg border ${status === 'Pending' ? 'border-purple-300 dark:border-purple-500/40' : status === 'Catering' ? 'border-orange-300 dark:border-orange-500/50' : 'border-gray-200 dark:border-gray-800'} p-3 rounded-2xl flex flex-col gap-1.5 text-xs">
                <div class="flex justify-between items-center font-bold gap-2">
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                        <input type="checkbox"
                            class="w-4 h-4 accent-purple-600 rounded cursor-pointer shrink-0"
                            ${isChecked ? 'checked' : ''}
                            onclick="event.stopPropagation()"
                            onchange="window.toggleSelectAdvancedOrder && window.toggleSelectAdvancedOrder('${escapeHtml(ordId)}', this.checked)">
                        <span class="text-purple-700 dark:text-purple-300 text-sm font-black flex items-center gap-1.5 truncate">
                            <i class="fa-solid fa-user text-[11px] shrink-0"></i>
                            <span class="truncate">${escapeHtml(ord.custName)}</span>
                        </span>
                    </div>
                    <span class="text-emerald-700 dark:text-emerald-400 font-mono font-bold shrink-0 text-right">
                        <i class="fa-solid fa-calendar-day"></i> ${escapeHtml(displayDate)} 
                        <i class="fa-solid fa-clock ml-1"></i> ${escapeHtml(ord.timeToReceive)}
                    </span>
                </div>
                ${ord.receiver ? `<div class="text-[10px] text-gray-600 dark:text-gray-400 font-medium">Receiver: <span class="text-gray-900 dark:text-gray-200 font-bold">${escapeHtml(ord.receiver)}</span></div>` : ''}
                ${ord.address ? `<div class="text-[10px] text-gray-700 dark:text-gray-300 font-medium flex items-center gap-1"><i class="fa-solid fa-location-dot text-red-500 text-[9px]"></i> ${escapeHtml(ord.address)}</div>` : ''}
                <div class="flex justify-between items-center mt-1 pt-1.5 border-t border-gray-100 dark:border-gray-800">
                    ${statusBadge} ${actionBtns}
                </div>
            </div>
        </div>`;
    }).join('');

    container.innerHTML = toolbarHtml + cardsHtml;
    attachSwipeGesturesToCards(container);
}

// Global window attachments
if (typeof window !== 'undefined') {
    window.switchAdvTab = switchAdvTab;
    window.renderAdvancedOrdersList = renderAdvancedOrdersList;
    window.toggleSelectAdvancedOrder = toggleSelectAdvancedOrder;
    window.toggleSelectAllAdvancedOrders = toggleSelectAllAdvancedOrders;
    window.promptDeleteSingleAdvancedOrder = promptDeleteSingleAdvancedOrder;
    window.executeDeleteSingleAdvancedOrder = executeDeleteSingleAdvancedOrder;
    window.promptDeleteSelectedAdvancedOrders = promptDeleteSelectedAdvancedOrders;
    window.executeDeleteSelectedAdvancedOrders = executeDeleteSelectedAdvancedOrders;
}