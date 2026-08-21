// src/features/storeHub/storeUI.js
import { appState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { escapeHtml, copyText, isSameDate, getLocalTodayStr } from '../../utils/helpers.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { 
    fetchStoreMenuData, 
    saveStoreCategory, 
    deleteStoreCategory, 
    saveMenuItem, 
    deleteMenuItem, 
    toggleItemStockStatus, 
    toggleSizeStockStatus,
    toggleAddonStockStatus,
    updateStoreOpenStatus,
    updateStoreProfile,
    updateStoreLogo
} from './storeMenu.js';

let currentStoreData = null;
let currentMenuData = { categories: {}, items: {} };
let currentOrdersData = {};
let selectedCategoryId = 'ALL';
let selectedSubCategory = 'ALL';
let selectedOrdersTab = 'active'; // 'active' | 'done'
let stagedLogoData = '';

let activeChatOrderId = null;
let activeChatRiderId = null;
let activeChatRiderName = null;
let activeStoreReplyTarget = null;

let activeSubstitutionTarget = null; // { orderId, itemIdx, itemName, customerName, riderName }

let acknowledgedOrders = new Set();
let kitchenAudioInterval = null;
let kitchenAudioCtx = null;
let isKitchenAudioMuted = false;
let countdownTimerInterval = null;
let ridersLocationMap = {}; // Real-time GPS coordinates of active assigned riders

function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

function cleanFirebasePathKey(key) {
    return String(key || '').replace(/^#+/, '').replace(/[.#$\[\]\/]/g, '_').trim();
}

function compressImageFile(file, maxWidth = 320, maxHeight = 320, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl);
            };
            img.onerror = (err) => reject(err);
            img.src = e.target.result;
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

function calculateDistanceInKm(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function renderStoreReactionsHtml(reactions, msgId) {
    if (!reactions || typeof reactions !== 'object') return '';
    const reactionEntries = Object.entries(reactions);
    if (reactionEntries.length === 0) return '';

    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id') || 'store';
    const storeId = cleanFirebasePathKey(rawStoreId);

    const badges = reactionEntries.map(([emoji, usersMap]) => {
        if (!usersMap || typeof usersMap !== 'object') return '';
        const count = Object.keys(usersMap).length;
        if (count === 0) return '';
        const hasReacted = storeId && usersMap[storeId];

        return `
        <button onclick="event.stopPropagation(); window.toggleStoreRiderReaction('${msgId}', '${emoji}')" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] ${hasReacted ? 'bg-orange-600/30 border border-orange-400 text-white' : 'bg-gray-100 dark:bg-black/60 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'} transition active:scale-90">
            <span>${emoji}</span>
            <span class="font-bold text-[9px]">${count}</span>
        </button>`;
    }).join('');

    return badges ? `<div class="flex flex-wrap gap-1 mt-1">${badges}</div>` : '';
}

function renderReplyPreviewInsideMessage(replyTo) {
    if (!replyTo || !replyTo.text) return '';
    const clickHandler = replyTo.id ? `event.stopPropagation(); window.scrollToBubble('${replyTo.id}')` : '';
    return `
    <div ${clickHandler ? `onclick="${clickHandler}"` : ''} class="bg-black/10 dark:bg-black/40 border-l-2 border-amber-400 px-2 py-1 rounded-r-lg mb-1.5 text-[10px] opacity-90 truncate max-w-full cursor-pointer hover:opacity-100 transition">
        <div class="font-bold text-amber-600 dark:text-amber-300 truncate flex items-center gap-1">
            <i class="fa-solid fa-reply text-[8px]"></i>
            <span>${escapeHtml(replyTo.sender || 'Reply')}</span>
        </div>
        <div class="text-gray-700 dark:text-gray-200 truncate">${escapeHtml(replyTo.text)}</div>
    </div>`;
}

// KITCHEN AUDIO CHIME GENERATOR (Dual Tone Bell Pulse)
export function playKitchenChime() {
    if (isKitchenAudioMuted) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!kitchenAudioCtx && AudioContext) {
            kitchenAudioCtx = new AudioContext();
        }
        if (kitchenAudioCtx && kitchenAudioCtx.state === 'suspended') {
            kitchenAudioCtx.resume();
        }
        if (!kitchenAudioCtx) return;

        const now = kitchenAudioCtx.currentTime;

        const osc1 = kitchenAudioCtx.createOscillator();
        const osc2 = kitchenAudioCtx.createOscillator();
        const gain = kitchenAudioCtx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(880, now);
        osc1.frequency.exponentialRampToValueAtTime(440, now + 0.4);

        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(1760, now + 0.05);
        osc2.frequency.exponentialRampToValueAtTime(880, now + 0.5);

        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(kitchenAudioCtx.destination);

        osc1.start(now);
        osc2.start(now + 0.05);
        osc1.stop(now + 0.7);
        osc2.stop(now + 0.7);
    } catch(e) {}
}

export function startRepeatingKitchenAlarm() {
    if (kitchenAudioInterval) return;
    playKitchenChime();
    kitchenAudioInterval = setInterval(() => {
        playKitchenChime();
    }, 3500);
}

export function stopRepeatingKitchenAlarm() {
    if (kitchenAudioInterval) {
        clearInterval(kitchenAudioInterval);
        kitchenAudioInterval = null;
    }
}

export function toggleKitchenMute() {
    isKitchenAudioMuted = !isKitchenAudioMuted;
    const btn = document.getElementById('merch-mute-chime-btn');
    if (btn) {
        btn.innerHTML = isKitchenAudioMuted 
            ? `<i class="fa-solid fa-volume-xmark text-red-400"></i>` 
            : `<i class="fa-solid fa-bell text-emerald-400 animate-pulse"></i>`;
        btn.title = isKitchenAudioMuted ? "Unmute Kitchen Chime" : "Mute Kitchen Chime";
    }
    if (isKitchenAudioMuted) {
        stopRepeatingKitchenAlarm();
    }
    showToast(isKitchenAudioMuted ? "🔇 Kitchen chime muted." : "🔔 Kitchen chime enabled.");
}

export function setStoreOrdersTab(tab) {
    selectedOrdersTab = tab;

    const btnActive = document.getElementById('store-orders-tab-active');
    const btnDone = document.getElementById('store-orders-tab-done');

    if (btnActive && btnDone) {
        if (tab === 'active') {
            btnActive.className = "flex-1 py-1 rounded-lg bg-orange-600 text-white font-bold text-[10px] transition shadow-sm flex items-center justify-center gap-1";
            btnDone.className = "flex-1 py-1 rounded-lg text-gray-600 dark:text-gray-400 font-bold text-[10px] hover:text-gray-900 dark:hover:text-white transition flex items-center justify-center gap-1";
        } else {
            btnDone.className = "flex-1 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[10px] transition shadow-sm flex items-center justify-center gap-1";
            btnActive.className = "flex-1 py-1 rounded-lg text-gray-600 dark:text-gray-400 font-bold text-[10px] hover:text-gray-900 dark:hover:text-white transition flex items-center justify-center gap-1";
        }
    }

    renderStoreOrders();
}

export async function renderStoreHub() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const storeName = appState.merchantStoreName || localStorage.getItem('lokalex_merchant_store_name') || "Merchant Store";
    const username = appState.merchantUsername || localStorage.getItem('lokalex_merchant_username') || "merchant";

    const nameEl = document.getElementById('merch-store-display-name');
    const userEl = document.getElementById('merch-store-username');
    const feedEl = document.getElementById('merch-items-feed');

    if (nameEl) nameEl.innerText = storeName;
    if (userEl) userEl.innerText = `@${username}`;

    if (!storeId || !db) {
        if (feedEl) {
            feedEl.innerHTML = `
                <div class="text-center text-amber-500 dark:text-amber-400 italic py-12 text-xs bg-cardBg border border-gray-200 dark:border-gray-800 rounded-2xl p-6 flex flex-col items-center gap-2">
                    <i class="fa-solid fa-triangle-exclamation text-2xl text-amber-500"></i>
                    <span>Store session not found. Please log out and sign in again.</span>
                </div>
            `;
        }
        return;
    }

    if (!countdownTimerInterval) {
        countdownTimerInterval = setInterval(() => {
            updateLiveCountdownTimers();
            checkAndApplyStoreOperatingHours();
        }, 1000);
    }

    // Listen to real-time roster for Inbound Rider Radar
    db.ref('roster').on('value', (snap) => {
        const roster = snap.val() || {};
        ridersLocationMap = {};
        Object.entries(roster).forEach(([id, rider]) => {
            if (rider && rider.lat && rider.lng) {
                ridersLocationMap[id.toString().trim()] = {
                    lat: parseFloat(rider.lat),
                    lng: parseFloat(rider.lng),
                    riderName: rider.riderName || rider.name || "Rider"
                };
            }
        });
        renderStoreOrders();
    });

    const loadTimeout = setTimeout(() => {
        if (!currentMenuData.items || Object.keys(currentMenuData.items).length === 0) {
            renderCategoriesBar();
            renderItemsFeed();
        }
    }, 2500);

    try {
        // 1. STORE PROFILE LISTENER
        db.ref(`stores/${storeId}`).on('value', (snap) => {
            currentStoreData = snap.val() || {};
            updateStoreProfileUI(currentStoreData);
            updateStoreStatusButton(currentStoreData.isOpen !== false);
            renderDailySalesSummary();
            checkAndApplyStoreOperatingHours();
        }, (err) => {
            console.warn("Store profile listener error:", err);
            updateStoreStatusButton(true);
        });

        // 2. STORE MENU & CATEGORIES LISTENER
        db.ref(`storeMenus/${storeId}`).on('value', (snap) => {
            clearTimeout(loadTimeout);
            const val = snap.val();
            currentMenuData = {
                categories: (val && val.categories) ? val.categories : {},
                items: (val && val.items) ? val.items : {}
            };
            renderCategoriesBar();
            renderItemsFeed();
        }, (err) => {
            clearTimeout(loadTimeout);
            console.error("Store menu listener error:", err);
            currentMenuData = { categories: {}, items: {} };
            renderCategoriesBar();
            renderItemsFeed();
        });

        // 3. LIVE KITCHEN TICKETS / ORDERS LISTENER WITH AUDIO TRIGGER
        db.ref(`storeOrders/${storeId}`).on('value', (snap) => {
            currentOrdersData = snap.val() || {};

            let hasPendingUnacknowledged = false;
            Object.entries(currentOrdersData).forEach(([id, ord]) => {
                if (ord && (ord.status === 'pending' || !ord.status) && !acknowledgedOrders.has(id)) {
                    hasPendingUnacknowledged = true;
                }
            });

            if (hasPendingUnacknowledged) {
                startRepeatingKitchenAlarm();
            } else {
                stopRepeatingKitchenAlarm();
            }

            renderStoreOrders();
            renderDailySalesSummary();
        });
    } catch (e) {
        clearTimeout(loadTimeout);
        console.error("renderStoreHub execution error:", e);
        renderCategoriesBar();
        renderItemsFeed();
    }
}

// -------------------------------------------------------------
// AUTOMATED OPERATING HOURS SCHEDULER
// -------------------------------------------------------------
export function checkAndApplyStoreOperatingHours() {
    if (!currentStoreData || !currentStoreData.operatingHours || !currentStoreData.operatingHours.enabled) return;

    const { openTime, closeTime } = currentStoreData.operatingHours;
    if (!openTime || !closeTime) return;

    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    const [openH, openM] = openTime.split(':').map(Number);
    const [closeH, closeM] = closeTime.split(':').map(Number);

    const openTotalMins = openH * 60 + openM;
    const closeTotalMins = closeH * 60 + closeM;

    let shouldBeOpen = false;
    if (openTotalMins <= closeTotalMins) {
        shouldBeOpen = currentMins >= openTotalMins && currentMins < closeTotalMins;
    } else {
        shouldBeOpen = currentMins >= openTotalMins || currentMins < closeTotalMins;
    }

    const currentIsOpen = currentStoreData.isOpen !== false;
    if (shouldBeOpen !== currentIsOpen) {
        const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
        const storeId = cleanFirebasePathKey(rawStoreId);
        if (storeId && db) {
            db.ref(`stores/${storeId}`).update({ isOpen: shouldBeOpen }).catch(() => {});
        }
    }
}

export function openOperatingHoursModal() {
    const modal = document.getElementById('store-hours-modal');
    if (!modal) return;

    const enabledToggle = document.getElementById('hours-auto-schedule-enabled');
    const openInput = document.getElementById('hours-open-time');
    const closeInput = document.getElementById('hours-close-time');

    const config = currentStoreData?.operatingHours || {};
    if (enabledToggle) enabledToggle.checked = !!config.enabled;
    if (openInput) openInput.value = config.openTime || "08:00";
    if (closeInput) closeInput.value = config.closeTime || "21:00";

    modal.classList.remove('hidden');
}

export function closeOperatingHoursModal() {
    const modal = document.getElementById('store-hours-modal');
    if (modal) modal.classList.add('hidden');
}

export async function saveOperatingHoursSettings() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);

    const enabledToggle = document.getElementById('hours-auto-schedule-enabled');
    const openInput = document.getElementById('hours-open-time');
    const closeInput = document.getElementById('hours-close-time');

    const enabled = enabledToggle ? enabledToggle.checked : false;
    const openTime = openInput ? openInput.value : "08:00";
    const closeTime = closeInput ? closeInput.value : "21:00";

    if (!storeId || !db) return;

    try {
        await db.ref(`stores/${storeId}/operatingHours`).set({
            enabled,
            openTime,
            closeTime,
            updatedAt: Date.now()
        });

        closeOperatingHoursModal();
        showToast(`⚙️ Operating Hours saved (${openTime} - ${closeTime})!`);
        showSideNotification("SCHEDULE SAVED", `Hours: ${openTime} - ${closeTime}`, "fa-clock", "text-purple-400", "border-purple-500");
        checkAndApplyStoreOperatingHours();
    } catch(e) {
        showToast("❌ Failed to save operating hours.");
    }
}

// -------------------------------------------------------------
// DAILY SALES & COMMISSION ANALYTICS CALCULATION
// -------------------------------------------------------------
export function renderDailySalesSummary() {
    const grossEl = document.getElementById('merch-sales-gross');
    const commEl = document.getElementById('merch-sales-commission');
    const netEl = document.getElementById('merch-sales-net');
    const countEl = document.getElementById('merch-sales-count');
    const rateEl = document.getElementById('merch-comm-rate-badge');

    if (!grossEl && !netEl) return;

    const commRate = parseFloat(currentStoreData?.commissionRate || 10);
    if (rateEl) rateEl.innerText = `${commRate}%`;

    const todayStr = getLocalTodayStr();
    let todayGross = 0;
    let completedOrdersToday = 0;

    Object.values(currentOrdersData || {}).forEach(order => {
        if (!order) return;
        const isDone = order.status === 'picked_up' || order.status === 'delivered' || order.status === 'done' || order.isDone;
        const orderDateStr = order.timestamp ? new Date(order.timestamp).toISOString().split('T')[0] : '';

        if (isDone && (orderDateStr === todayStr || isSameDate(order.date, todayStr))) {
            todayGross += (parseFloat(order.totalAmount) || 0);
            completedOrdersToday++;
        }
    });

    const platformCommission = (todayGross * commRate) / 100;
    const netTakeHome = todayGross - platformCommission;

    if (grossEl) grossEl.innerText = `₱${todayGross.toFixed(2)}`;
    if (commEl) commEl.innerText = `-₱${platformCommission.toFixed(2)}`;
    if (netEl) netEl.innerText = `₱${netTakeHome.toFixed(2)}`;
    if (countEl) countEl.innerText = `${completedOrdersToday} orders completed`;
}

function updateStoreProfileUI(storeData) {
    const nameEl = document.getElementById('merch-store-display-name');
    const addrEl = document.getElementById('merch-store-address-text');
    const imgEl = document.getElementById('merch-store-avatar-img');
    const iconEl = document.getElementById('merch-store-avatar-icon');

    if (storeData.storeName && nameEl) {
        nameEl.innerText = storeData.storeName;
        appState.merchantStoreName = storeData.storeName;
        localStorage.setItem('lokalex_merchant_store_name', storeData.storeName);
    }

    if (addrEl) {
        addrEl.innerText = storeData.address || "Walang nakatakdang address";
    }

    if (imgEl && iconEl) {
        if (storeData.logoUrl) {
            imgEl.src = storeData.logoUrl;
            imgEl.classList.remove('hidden');
            iconEl.classList.add('hidden');
        } else {
            imgEl.classList.add('hidden');
            iconEl.classList.remove('hidden');
        }
    }
}

function updateStoreStatusButton(isOpen) {
    const btn = document.getElementById('merch-store-status-btn');
    if (!btn) return;

    if (isOpen) {
        btn.className = "px-3 py-1.5 rounded-full text-[10px] font-black border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 transition active:scale-95 shrink-0";
        btn.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>OPEN FOR ORDERS</span>`;
    } else {
        btn.className = "px-3 py-1.5 rounded-full text-[10px] font-black border border-red-500/40 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 flex items-center gap-1.5 transition active:scale-95 shrink-0";
        btn.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span><span>STORE CLOSED</span>`;
    }
}

export function toggleStoreOpenStatus() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const currentIsOpen = currentStoreData ? (currentStoreData.isOpen !== false) : true;
    updateStoreOpenStatus(storeId, !currentIsOpen);
}

// -------------------------------------------------------------
// ESC/POS THERMAL RECEIPT & KITCHEN PACKING SLIP DISPATCH
// -------------------------------------------------------------
export function generateThermalPackingSlipText(order) {
    const storeName = (currentStoreData?.storeName || appState.merchantStoreName || "STORE HUB").toUpperCase();
    const orderIdClean = cleanFirebasePathKey(order.orderId || order.id);
    const custName = (order.customerName || "Customer").toUpperCase();
    const riderName = (order.riderName || "Unassigned").toUpperCase();
    const dateStr = order.timestamp ? new Date(order.timestamp).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : new Date().toLocaleString();

    let text = `================================\n`;
    text += `       ${storeName}\n`;
    text += `     KITCHEN PACKING SLIP\n`;
    text += `================================\n`;
    text += `ORDER: #${orderIdClean}\n`;
    text += `DATE : ${dateStr}\n`;
    text += `CUST : ${custName}\n`;
    text += `RIDER: ${riderName}\n`;
    text += `--------------------------------\n`;
    text += `QTY  ITEM                 PRICE\n`;
    text += `--------------------------------\n`;

    (order.items || []).forEach(it => {
        const qty = `${it.quantity || 1}x`.padEnd(5);
        const name = (it.name || 'Item').slice(0, 18).padEnd(18);
        const price = `₱${(parseFloat(it.totalPrice || it.subtotal || 0)).toFixed(2)}`.padStart(9);
        text += `${qty}${name}${price}\n`;

        if (it.size && it.size.name) {
            text += `  > Size: ${it.size.name}\n`;
        }
        if (it.addons && it.addons.length > 0) {
            text += `  > Extras: ${it.addons.map(a => a.name).join(', ')}\n`;
        }
        if (it.instructions) {
            text += `  * NOTE: "${it.instructions}"\n`;
        }
    });

    text += `--------------------------------\n`;
    text += `TOTAL ITEMS AMOUNT: ₱${parseFloat(order.totalAmount || 0).toFixed(2)}\n`;
    text += `================================\n`;
    text += `     LOKALEX DELIVERY HUB\n\n\n`;

    return text;
}

export function printStoreOrderSlip(orderId) {
    const cleanOrderId = cleanFirebasePathKey(orderId);
    const order = cachedStoreOrders[cleanOrderId] || Object.values(currentOrdersData).find(o => cleanFirebasePathKey(o.orderId || o.id) === cleanOrderId);

    if (!order) {
        return showToast("⚠️ Order data not found for printing.");
    }

    const storeName = currentStoreData?.storeName || appState.merchantStoreName || "Store Hub";
    const custName = order.customerName || "Customer";
    const riderName = order.riderName || "Unassigned Rider";
    const dateStr = order.timestamp ? new Date(order.timestamp).toLocaleString() : new Date().toLocaleString();
    const totalAmount = parseFloat(order.totalAmount || 0).toFixed(2);

    const itemsRows = (order.items || []).map(it => {
        let details = [];
        if (it.size && it.size.name) details.push(`Size: ${escapeHtml(it.size.name)}`);
        if (it.addons && it.addons.length > 0) details.push(`Addons: ${it.addons.map(a => escapeHtml(a.name)).join(', ')}`);
        if (it.instructions) details.push(`<strong>NOTE: "${escapeHtml(it.instructions)}"</strong>`);

        return `
            <tr>
                <td style="vertical-align: top; font-weight: bold; width: 25px;">${it.quantity || 1}x</td>
                <td style="vertical-align: top;">
                    <div>${escapeHtml(it.name || 'Item')}</div>
                    ${details.length > 0 ? `<div style="font-size: 10px; margin-top: 2px;">${details.join('<br>')}</div>` : ''}
                </td>
                <td style="vertical-align: top; text-align: right; font-family: monospace;">₱${(parseFloat(it.totalPrice || it.subtotal || 0)).toFixed(2)}</td>
            </tr>
        `;
    }).join('');

    const printWindow = window.open('', '_blank', 'width=380,height=550');
    if (!printWindow) {
        return showToast("⚠️ Pop-up blocked! Please allow pop-ups to print slips.");
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Slip #${cleanOrderId}</title>
            <style>
                @page { size: auto; margin: 0mm; }
                body {
                    font-family: 'Courier New', Courier, monospace;
                    width: 58mm;
                    max-width: 80mm;
                    margin: 0 auto;
                    padding: 8px;
                    color: #000;
                    background: #fff;
                    font-size: 11px;
                    line-height: 1.25;
                }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .bold { font-weight: bold; }
                .divider { border-top: 1px dashed #000; margin: 6px 0; }
                .double-divider { border-top: 2px solid #000; margin: 6px 0; }
                table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 4px 0; }
                @media print {
                    body { width: 100%; margin: 0; padding: 4px; }
                }
            </style>
        </head>
        <body>
            <div class="text-center bold" style="font-size: 14px;">${escapeHtml(storeName)}</div>
            <div class="text-center bold" style="font-size: 10px; margin-bottom: 4px;">KITCHEN PACKING SLIP</div>
            <div class="double-divider"></div>
            <div><strong>ORDER #:</strong> ${cleanOrderId}</div>
            <div><strong>DATE   :</strong> ${dateStr}</div>
            <div><strong>CUST   :</strong> ${escapeHtml(custName)}</div>
            <div><strong>RIDER  :</strong> ${escapeHtml(riderName)}</div>
            <div class="divider"></div>
            <table>
                <thead>
                    <tr style="border-bottom: 1px dashed #000;">
                        <th style="text-align: left;">QTY</th>
                        <th style="text-align: left;">ITEM</th>
                        <th style="text-align: right;">PRICE</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsRows}
                </tbody>
            </table>
            <div class="divider"></div>
            <div class="text-right bold" style="font-size: 12px;">
                TOTAL: ₱${totalAmount}
            </div>
            <div class="double-divider"></div>
            <div class="text-center" style="font-size: 9px; margin-top: 6px;">LOKALEX DELIVERY HUB</div>
            <script>
                window.onload = function() {
                    window.focus();
                    window.print();
                    setTimeout(function() { window.close(); }, 500);
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// WEB BLUETOOTH ESC/POS DIRECT PRINT PROTOCOL
export async function printStoreOrderBluetooth(orderId) {
    if (!navigator.bluetooth) {
        return showToast("⚠️ Web Bluetooth is not supported on this browser. Opening print window...");
    }

    const cleanOrderId = cleanFirebasePathKey(orderId);
    const order = cachedStoreOrders[cleanOrderId] || Object.values(currentOrdersData).find(o => cleanFirebasePathKey(o.orderId || o.id) === cleanOrderId);

    if (!order) return showToast("⚠️ Order data not found.");

    showToast("📡 Connecting to Bluetooth Printer...");

    try {
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
            optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455']
        });

        const server = await device.gatt.connect();
        const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
        const characteristics = await service.getCharacteristics();
        const writeChar = characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);

        if (!writeChar) throw new Error("Writable Bluetooth characteristic not found.");

        const slipText = generateThermalPackingSlipText(order);
        const encoder = new TextEncoder();
        
        const initCmd = new Uint8Array([0x1B, 0x40]);
        const cutCmd = new Uint8Array([0x1D, 0x56, 0x00]);
        const dataBytes = encoder.encode(slipText);

        await writeChar.writeValue(initCmd);
        
        const chunkSize = 128;
        for (let i = 0; i < dataBytes.length; i += chunkSize) {
            const chunk = dataBytes.slice(i, i + chunkSize);
            await writeChar.writeValue(chunk);
        }

        await writeChar.writeValue(cutCmd);
        showToast("✅ Printed to Bluetooth thermal printer!");
    } catch(err) {
        console.warn("Bluetooth Print failed:", err);
        showToast("⚠️ Bluetooth pairing cancelled or failed. Using standard print dialog.");
        printStoreOrderSlip(orderId);
    }
}

export function renderStoreOrders() {
    const feed = document.getElementById('merch-orders-feed');
    const badge = document.getElementById('merch-live-orders-badge');
    const activeCountEl = document.getElementById('merch-active-count');
    const doneCountEl = document.getElementById('merch-done-count');
    if (!feed) return;

    const orders = Object.entries(currentOrdersData || {}).map(([id, order]) => ({
        orderId: cleanFirebasePathKey(id),
        ...order
    })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const activeOrders = orders.filter(o => 
        o.status !== 'completed' && 
        o.status !== 'cancelled' && 
        o.status !== 'picked_up' && 
        o.status !== 'delivered' &&
        o.status !== 'done' && 
        !o.isDone
    );

    const doneOrders = orders.filter(o => 
        o.status === 'completed' || 
        o.status === 'picked_up' || 
        o.status === 'delivered' ||
        o.status === 'done' || 
        !!o.isDone
    );

    if (activeCountEl) activeCountEl.innerText = activeOrders.length;
    if (doneCountEl) doneCountEl.innerText = doneOrders.length;
    if (badge) badge.innerText = `${activeOrders.length} Active`;

    const targetList = selectedOrdersTab === 'done' ? doneOrders : activeOrders;

    if (targetList.length === 0) {
        feed.innerHTML = `
            <div class="text-center text-gray-400 dark:text-gray-500 italic py-8 text-xs flex flex-col items-center gap-1.5">
                <i class="fa-solid fa-receipt text-xl text-gray-400 dark:text-gray-600"></i>
                <span>${selectedOrdersTab === 'done' ? 'No completed orders in history yet.' : 'No active incoming orders at the moment.'}</span>
            </div>`;
        return;
    }

    feed.innerHTML = targetList.map(order => {
        const items = order.items || [];
        const status = order.status || 'pending';
        const isPending = status === 'pending';
        const isPreparing = status === 'preparing';
        const isReady = status === 'ready' || status === 'ready_for_pickup';
        const riderName = order.riderName || 'Unassigned Rider';
        const riderId = (order.riderId || '').toString().trim();
        const orderIdClean = cleanFirebasePathKey(order.orderId);
        const orderTime = order.timestamp ? new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

        let statusBadge = `<span class="bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40 px-2 py-0.5 rounded-full text-[9px] font-bold animate-pulse">🟡 PENDING ACCEPTANCE</span>`;
        if (isPreparing) {
            statusBadge = `<span class="bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-500/40 px-2 py-0.5 rounded-full text-[9px] font-bold">🔵 PREPARING</span>`;
        } else if (isReady) {
            statusBadge = `<span class="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/40 px-2 py-0.5 rounded-full text-[9px] font-bold">🟢 READY FOR PICKUP</span>`;
        } else if (status === 'picked_up' || status === 'delivered' || status === 'done' || order.isDone) {
            statusBadge = `<span class="bg-purple-100 dark:bg-purple-500/20 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-500/40 px-2 py-0.5 rounded-full text-[9px] font-bold">✅ DONE / PICKED UP</span>`;
        }

        const isDoneOrder = selectedOrdersTab === 'done' || status === 'done' || status === 'picked_up' || status === 'delivered' || order.isDone;

        // INBOUND RIDER PROXIMITY RADAR CALCULATION
        let riderRadarHtml = '';
        if (riderId && ridersLocationMap[riderId] && currentStoreData) {
            const riderLoc = ridersLocationMap[riderId];
            const storeLat = parseFloat(currentStoreData.lat || 15.6881);
            const storeLng = parseFloat(currentStoreData.lng || 120.4144);
            const distKm = calculateDistanceInKm(riderLoc.lat, riderLoc.lng, storeLat, storeLng);

            if (distKm !== null) {
                const estMins = Math.max(1, Math.round(distKm * 2.5));
                riderRadarHtml = `
                    <div class="inline-flex items-center gap-1 text-[9px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30 px-2 py-0.5 rounded-full">
                        <i class="fa-solid fa-satellite-dish animate-pulse text-indigo-500"></i>
                        <span>Inbound: ${distKm.toFixed(1)} km (~${estMins}m away)</span>
                    </div>
                `;
            }
        }

        const itemsHtml = items.map((it, idx) => `
            <div class="flex justify-between items-center text-xs py-1 border-b border-gray-100 dark:border-gray-800/60 last:border-0">
                <div class="flex-1 min-w-0 pr-2">
                    <span class="text-gray-900 dark:text-white font-bold">
                        <span class="text-orange-500">${it.quantity}x</span> ${escapeHtml(it.name)}
                        ${it.size ? `<span class="text-[10px] text-gray-500 dark:text-gray-400 font-normal">(${escapeHtml(it.size.name || it.size)})</span>` : ''}
                    </span>
                    ${it.addons && it.addons.length > 0 ? `<div class="text-[9px] text-gray-500 dark:text-gray-400">+ ${it.addons.map(a => escapeHtml(a.name)).join(', ')}</div>` : ''}
                    ${it.instructions ? `<div class="text-[10px] text-amber-600 dark:text-amber-300 italic">Note: "${escapeHtml(it.instructions)}"</div>` : ''}
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <span class="text-gray-500 dark:text-gray-400 font-mono text-xs">₱${parseFloat(it.totalPrice || it.subtotal || 0).toFixed(2)}</span>
                    ${!isDoneOrder ? `
                        <button onclick="window.openSubstitutionModal('${orderIdClean}', ${idx}, '${escapeHtml(it.name)}', '${escapeHtml(order.customerName || 'Customer')}', '${escapeHtml(riderName)}')" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 dark:bg-red-950/40 dark:hover:bg-red-900 dark:text-red-300 dark:border-red-700/40 px-1.5 py-0.5 rounded text-[9px] font-bold transition active:scale-95" title="Flag as Out of Stock & Request Substitution">
                            86 / Swap
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('');

        let actionControls = '';
        if (!isDoneOrder) {
            if (isPending) {
                actionControls = `
                <div class="flex flex-col gap-1.5 pt-2 border-t border-gray-200 dark:border-gray-800/80">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">Set Prep Time & Accept:</span>
                    <div class="grid grid-cols-4 gap-1.5">
                        <button onclick="window.acceptStoreOrderWithPrepTime('${orderIdClean}', 10)" class="bg-blue-600 hover:bg-blue-500 text-white font-black text-xs py-2 rounded-xl shadow-xs transition active:scale-95 flex items-center justify-center gap-1">
                            <i class="fa-solid fa-clock"></i> 10m
                        </button>
                        <button onclick="window.acceptStoreOrderWithPrepTime('${orderIdClean}', 15)" class="bg-blue-600 hover:bg-blue-500 text-white font-black text-xs py-2 rounded-xl shadow-xs transition active:scale-95 flex items-center justify-center gap-1">
                            <i class="fa-solid fa-clock"></i> 15m
                        </button>
                        <button onclick="window.acceptStoreOrderWithPrepTime('${orderIdClean}', 25)" class="bg-blue-600 hover:bg-blue-500 text-white font-black text-xs py-2 rounded-xl shadow-xs transition active:scale-95 flex items-center justify-center gap-1">
                            <i class="fa-solid fa-clock"></i> 25m
                        </button>
                        <button onclick="window.promptCustomPrepTime('${orderIdClean}')" class="bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-bold text-xs py-2 rounded-xl transition active:scale-95 flex items-center justify-center">
                            Custom
                        </button>
                    </div>
                </div>`;
            } else if (isPreparing) {
                actionControls = `
                <div class="flex items-center justify-between gap-2 pt-2 border-t border-gray-200 dark:border-gray-800/80">
                    <div id="prep-timer-${orderIdClean}" data-prep-until="${order.prepUntil || 0}" class="flex items-center gap-1.5 text-xs font-mono font-black text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-3 py-2 rounded-xl border border-blue-200 dark:border-blue-500/30">
                        <i class="fa-solid fa-stopwatch animate-pulse"></i> <span>Calculating...</span>
                    </div>
                    <button onclick="window.markStoreOrderReadyForPickup('${orderIdClean}')" class="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs py-2.5 px-3 rounded-xl shadow-md transition active:scale-95 flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-check-double"></i> Ready for Pickup
                    </button>
                </div>`;
            } else if (isReady) {
                actionControls = `
                <div class="flex items-center justify-between gap-2 pt-2 border-t border-gray-200 dark:border-gray-800/80">
                    <span class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <i class="fa-solid fa-circle-check"></i> Waiting for rider pickup
                    </span>
                    <button onclick="window.updateStoreOrderStatus('${orderIdClean}', 'picked_up')" class="bg-gray-800 hover:bg-gray-700 text-white font-bold text-xs py-2 px-3 rounded-xl transition active:scale-95 flex items-center gap-1">
                        <i class="fa-solid fa-box-archive"></i> Mark Done
                    </button>
                </div>`;
            }
        }

        return `
        <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 rounded-2xl p-3 flex flex-col gap-2.5 shadow-xs">
            <div class="flex justify-between items-start">
                <div>
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="font-mono text-xs font-black text-gray-900 dark:text-white">#${escapeHtml(orderIdClean)}</span>
                        ${statusBadge}
                        ${riderRadarHtml}
                    </div>
                    <div class="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                        👤 Customer: <span class="text-gray-900 dark:text-white font-bold">${escapeHtml(order.customerName || 'Customer')}</span>
                    </div>
                    <div class="text-[10px] text-gray-500 dark:text-gray-400">
                        🛵 Rider: <span class="text-blue-600 dark:text-blue-400 font-bold">${escapeHtml(riderName)}</span>
                    </div>
                </div>

                <div class="flex items-center gap-1.5 shrink-0">
                    <span class="text-[9px] text-gray-400 font-mono">${orderTime}</span>
                    
                    <!-- ONE-TAP PRINT SLIP BUTTON -->
                    <button onclick="window.printStoreOrderSlip('${orderIdClean}')" class="bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 dark:border-gray-700 dark:text-gray-300 px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition active:scale-95 flex items-center gap-1" title="Print Kitchen Packing Slip">
                        <i class="fa-solid fa-print"></i> Slip
                    </button>

                    <button onclick="window.openStoreRiderChatModal('${orderIdClean}', '${riderId}', '${escapeHtml(riderName)}')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-600/30 dark:hover:bg-blue-600 dark:border-blue-500/50 dark:text-blue-300 dark:hover:text-white px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition active:scale-95 flex items-center gap-1">
                        <i class="fa-solid fa-comments"></i> Chat
                    </button>
                </div>
            </div>

            <div class="bg-gray-50 dark:bg-darkBg/60 border border-gray-200 dark:border-gray-800/80 p-2.5 rounded-xl flex flex-col gap-1">
                ${itemsHtml}
                <div class="flex justify-between items-center pt-1.5 border-t border-gray-200 dark:border-gray-800/80 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <span>Store Total:</span>
                    <span class="font-mono">₱${parseFloat(order.totalAmount || 0).toFixed(2)}</span>
                </div>
            </div>

            ${actionControls}
        </div>`;
    }).join('');

    updateLiveCountdownTimers();
}

// ACCEPT ORDER & SET PREP TIME (+10m, +15m, +25m)
export async function acceptStoreOrderWithPrepTime(orderId, prepMinutes) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(orderId);

    if (!storeId || !cleanOrderId || !db) return;

    acknowledgedOrders.add(cleanOrderId);
    stopRepeatingKitchenAlarm();

    const now = Date.now();
    const prepUntil = now + (parseInt(prepMinutes) * 60000);

    try {
        await db.ref(`storeOrders/${storeId}/${cleanOrderId}`).update({
            status: 'preparing',
            prepMinutes: parseInt(prepMinutes),
            prepUntil: prepUntil,
            acceptedAt: now,
            updatedAt: now
        });

        await db.ref(`orders/${cleanOrderId}`).update({
            status: 'preparing',
            prepUntil: prepUntil,
            [`milestones/preparing`]: {
                timestamp: now,
                updatedBy: 'Merchant Kitchen',
                prepMinutes: parseInt(prepMinutes)
            }
        }).catch(() => {});

        const storeName = appState.merchantStoreName || "Store";
        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}/messages`).push(sanitizeForFirebase({
            sender: 'store',
            senderType: 'store',
            senderName: storeName,
            text: `⏳ Order accepted! Kitchen is preparing the order (~${prepMinutes} mins estimated).`,
            timestamp: now
        })).catch(() => {});

        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}`).update(sanitizeForFirebase({
            lastMessage: `⏳ Preparing (~${prepMinutes}m)`,
            lastTimestamp: now,
            unreadForRider: true
        })).catch(() => {});

        showToast(`🍳 Order accepted! Prep timer set to ${prepMinutes} mins.`);
        showSideNotification("ORDER ACCEPTED", `Kitchen set to ${prepMinutes}m prep for #${cleanOrderId}`, "fa-kitchen-set", "text-blue-400", "border-blue-500");
    } catch(e) {
        showToast("❌ Failed to accept order.");
    }
}

export function promptCustomPrepTime(orderId) {
    const customTime = prompt("Enter preparation time in minutes (e.g. 20):", "20");
    const parsed = parseInt(customTime);
    if (!isNaN(parsed) && parsed > 0) {
        acceptStoreOrderWithPrepTime(orderId, parsed);
    }
}

// ONE-TAP "READY FOR PICKUP" DISPATCH
export async function markStoreOrderReadyForPickup(orderId) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(orderId);

    if (!storeId || !cleanOrderId || !db) return;

    const now = Date.now();

    try {
        await db.ref(`storeOrders/${storeId}/${cleanOrderId}`).update({
            status: 'ready',
            readyAt: now,
            updatedAt: now
        });

        await db.ref(`orders/${cleanOrderId}`).update({
            status: 'ready_for_pickup',
            [`milestones/ready_for_pickup`]: {
                timestamp: now,
                updatedBy: 'Merchant Kitchen'
            }
        }).catch(() => {});

        const storeName = appState.merchantStoreName || "Store";
        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}/messages`).push(sanitizeForFirebase({
            sender: 'store',
            senderType: 'store',
            senderName: storeName,
            text: `✅ Order is packed and READY for pickup!`,
            timestamp: now
        })).catch(() => {});

        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}`).update(sanitizeForFirebase({
            lastMessage: `✅ READY FOR PICKUP!`,
            lastTimestamp: now,
            unreadForRider: true
        })).catch(() => {});

        showToast("✅ Order marked Ready for Pickup! Rider notified.");
        showSideNotification("READY FOR PICKUP", `Order #${cleanOrderId} is ready!`, "fa-check-double", "text-emerald-400", "border-emerald-500");
    } catch(e) {
        showToast("❌ Failed to mark order ready.");
    }
}

export async function updateStoreOrderStatus(orderId, newStatus) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(orderId);

    if (!storeId || !cleanOrderId || !db) return;

    try {
        const updatePayload = {
            status: newStatus,
            updatedAt: Date.now()
        };

        if (newStatus === 'done' || newStatus === 'picked_up' || newStatus === 'completed') {
            updatePayload.isDone = true;
        }

        await db.ref(`storeOrders/${storeId}/${cleanOrderId}`).update(updatePayload);

        await db.ref(`orders/${cleanOrderId}/stores/${storeId}`).update({
            status: newStatus,
            updatedAt: Date.now()
        }).catch(() => {});

        showToast(`✅ Order marked as ${newStatus.toUpperCase()}`);
    } catch(e) {
        showToast("❌ Failed to update order status.");
    }
}

// -------------------------------------------------------------
// ITEM SUBSTITUTION & OUT-OF-STOCK ALERT MODAL FLOW
// -------------------------------------------------------------
export function openSubstitutionModal(orderId, itemIdx, itemName, customerName, riderName) {
    activeSubstitutionTarget = { orderId, itemIdx, itemName, customerName, riderName };

    let modal = document.getElementById('item-substitution-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'item-substitution-modal';
        modal.className = 'fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-white dark:bg-cardBg border border-red-500/40 w-full max-w-sm rounded-3xl p-5 shadow-2xl flex flex-col gap-3.5">
                <div class="flex justify-between items-center border-b border-gray-200 dark:border-gray-800 pb-2.5">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center text-sm font-bold">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                        </div>
                        <div>
                            <h3 class="text-sm font-black text-gray-900 dark:text-white">Item Substitution (86)</h3>
                            <p class="text-[10px] text-gray-500 dark:text-gray-400">Unavailable dish resolution</p>
                        </div>
                    </div>
                    <button onclick="window.closeSubstitutionModal && window.closeSubstitutionModal()" class="text-gray-400 hover:text-gray-700 dark:hover:text-white p-1 text-sm transition">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="flex flex-col gap-2 text-xs">
                    <div class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 p-2.5 rounded-2xl">
                        <div class="text-[10px] text-red-600 dark:text-red-400 font-bold uppercase">Unavailable Item:</div>
                        <div id="sub-item-name-display" class="font-black text-gray-900 dark:text-white text-xs mt-0.5">Item Name</div>
                    </div>

                    <div>
                        <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase">Suggested Replacement / Alternative *</label>
                        <input type="text" id="sub-replacement-input" placeholder="e.g. Taro Milk Tea / Large Size without pearls" class="w-full bg-inputBg text-xs rounded-xl p-3 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white font-bold mt-1">
                    </div>

                    <div>
                        <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase">Notes for Rider & Customer</label>
                        <textarea id="sub-notes-input" rows="2" placeholder="e.g. Naubusan po ng brown sugar pearls, pwede po bang nata de coco?" class="w-full bg-inputBg text-xs rounded-xl p-2.5 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white mt-1"></textarea>
                    </div>

                    <button id="sub-submit-btn" onclick="window.submitItemSubstitution && window.submitItemSubstitution()" class="w-full bg-red-600 hover:bg-red-500 text-white font-black py-3 rounded-xl shadow-md transition active:scale-95 flex items-center justify-center gap-1.5 mt-1">
                        <i class="fa-solid fa-paper-plane"></i> DISPATCH SUBSTITUTION REQUEST
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    const displayEl = document.getElementById('sub-item-name-display');
    const replaceInput = document.getElementById('sub-replacement-input');
    const notesInput = document.getElementById('sub-notes-input');

    if (displayEl) displayEl.innerText = itemName;
    if (replaceInput) replaceInput.value = '';
    if (notesInput) notesInput.value = '';

    modal.classList.remove('hidden');
}

export function closeSubstitutionModal() {
    const modal = document.getElementById('item-substitution-modal');
    if (modal) modal.classList.add('hidden');
    activeSubstitutionTarget = null;
}

export async function submitItemSubstitution() {
    if (!activeSubstitutionTarget) return;

    const { orderId, itemIdx, itemName, customerName, riderName } = activeSubstitutionTarget;
    const replacement = document.getElementById('sub-replacement-input')?.value.trim();
    const notes = document.getElementById('sub-notes-input')?.value.trim();

    if (!replacement) {
        return showToast("⚠️ Paki-lagay ang iminumungkahing kapalit o alternatibo!");
    }

    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const storeName = appState.merchantStoreName || "Store";
    const now = Date.now();

    closeSubstitutionModal();

    const alertMessage = `⚠️ [OUT OF STOCK / SUBSTITUTION REQUIRED]\n• Item: ${itemName}\n• Suggested Replacement: ${replacement}${notes ? `\n• Kitchen Note: "${notes}"` : ''}\n\nPaki-kumpirma po kay customer kung pumapayag sa kapalit. Salamat!`;

    try {
        if (db && orderId && storeId) {
            await db.ref(`storeRiderChats/${orderId}_${storeId}/messages`).push(sanitizeForFirebase({
                sender: 'store',
                senderType: 'store',
                senderName: storeName,
                text: alertMessage,
                timestamp: now
            }));

            await db.ref(`storeRiderChats/${orderId}_${storeId}`).update(sanitizeForFirebase({
                lastMessage: `⚠️ Substitution Alert: ${itemName}`,
                lastTimestamp: now,
                unreadForRider: true
            }));

            await db.ref(`storeOrders/${storeId}/${orderId}`).update({
                substitutionAlert: {
                    itemIndex: itemIdx,
                    itemName,
                    replacement,
                    notes: notes || "",
                    timestamp: now
                }
            });
        }

        showToast("⚠️ Substitution alert sent to rider!");
        showSideNotification("SUBSTITUTION ALERT", `Item: ${itemName} -> ${replacement}`, "fa-triangle-exclamation", "text-red-400", "border-red-500");
    } catch(e) {
        showToast("❌ Failed to dispatch substitution alert.");
    }
}

// -------------------------------------------------------------
// DEDICATED STORE-TO-RIDER LIVE CHAT HANDLERS
// -------------------------------------------------------------
export function openStoreRiderChatModal(orderId, riderId, riderName) {
    activeChatOrderId = cleanFirebasePathKey(orderId);
    activeChatRiderId = riderId;
    activeChatRiderName = riderName || "Assigned Rider";
    window.activeChatOrderId = activeChatOrderId;
    localStorage.setItem('lokalex_active_store_chat_order_id', activeChatOrderId);

    let modal = document.getElementById('store-rider-chat-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'store-rider-chat-modal';
        modal.className = 'fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4';
        modal.innerHTML = `
            <div class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 w-full max-w-md h-[85vh] max-h-[600px] rounded-3xl flex flex-col relative overflow-hidden">
                <div class="p-3.5 bg-gray-50 dark:bg-darkBg/95 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-9 h-9 rounded-xl bg-orange-500/10 text-orange-500 dark:text-orange-400 border border-orange-500/30 flex items-center justify-center text-sm font-black shrink-0">
                            <i class="fa-solid fa-motorcycle"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 id="store-chat-rider-name" class="font-bold text-xs text-gray-900 dark:text-white truncate">Rider Chat</h3>
                            <p id="store-chat-order-id" class="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate">Order #ORD_000</p>
                        </div>
                    </div>
                    <button onclick="window.closeStoreRiderChatModal && window.closeStoreRiderChatModal()" class="text-gray-400 hover:text-gray-700 dark:hover:text-white p-2 text-sm transition">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="bg-gray-100 dark:bg-darkBg/70 border-b border-gray-200 dark:border-gray-800 p-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
                    <button onclick="window.sendStoreRiderQuickPreset('⏳ Preparing: We are now preparing your order.')" class="bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-600/30 border border-gray-300 dark:border-gray-700 text-blue-600 dark:text-blue-300 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95">
                        ⏳ Preparing
                    </button>
                    <button onclick="window.sendStoreRiderQuickPreset('✅ Ready for Pickup: Your order is packed and ready!')" class="bg-white dark:bg-gray-800 hover:bg-emerald-50 dark:hover:bg-emerald-600/30 border border-gray-300 dark:border-gray-700 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95">
                        ✅ Ready for Pickup
                    </button>
                    <button onclick="window.sendStoreRiderQuickPreset('⚠️ Item Replacement: An item is unavailable, please check with customer.')" class="bg-white dark:bg-gray-800 hover:bg-amber-50 dark:hover:bg-amber-600/30 border border-gray-300 dark:border-gray-700 text-amber-600 dark:text-amber-300 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition active:scale-95">
                        ⚠️ Item Replacement
                    </button>
                </div>

                <div id="store-rider-chat-messages" class="flex-1 min-h-0 p-3.5 overflow-y-auto flex flex-col gap-2.5 bg-gray-50 dark:bg-black/40 text-xs">
                    <div class="text-center text-gray-400 dark:text-gray-500 italic py-8 text-xs">Loading chat history...</div>
                </div>

                <!-- QUOTED REPLY BAR -->
                <div id="store-chat-reply-bar" class="hidden bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-500/40 px-3 py-1.5 flex items-center justify-between gap-2 shrink-0">
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                        <i class="fa-solid fa-reply text-orange-500 text-xs shrink-0"></i>
                        <div class="min-w-0 flex-1 text-[11px] leading-tight">
                            <div id="store-reply-sender" class="font-bold text-orange-600 dark:text-orange-400 truncate">Replying to Rider</div>
                            <div id="store-reply-text" class="text-gray-600 dark:text-gray-300 truncate text-[10px]">Message text...</div>
                        </div>
                    </div>
                    <button type="button" onclick="window.cancelStoreReply()" class="text-gray-400 hover:text-red-500 p-1 text-xs transition active:scale-90">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="p-3 bg-white dark:bg-darkBg/95 border-t border-gray-200 dark:border-gray-800 flex items-center gap-2 shrink-0">
                    <input type="text" id="store-rider-chat-input" placeholder="Type message for rider..." onkeydown="if(event.key === 'Enter') window.sendStoreRiderChatMessage && window.sendStoreRiderChatMessage()" class="flex-1 bg-inputBg text-xs rounded-xl p-2.5 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white focus:border-orange-500">
                    <button onclick="window.sendStoreRiderChatMessage && window.sendStoreRiderChatMessage()" class="p-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl transition active:scale-95 text-xs font-bold shrink-0">
                        <i class="fa-solid fa-paper-plane"></i>
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    const nameEl = document.getElementById('store-chat-rider-name');
    const orderEl = document.getElementById('store-chat-order-id');

    if (nameEl) nameEl.innerText = `🛵 ${activeChatRiderName}`;
    if (orderEl) orderEl.innerText = `Order #${activeChatOrderId}`;

    cancelStoreReply();
    listenToStoreRiderChat(activeChatOrderId);

    modal.classList.remove('hidden');
}

export function closeStoreRiderChatModal() {
    const modal = document.getElementById('store-rider-chat-modal');
    if (modal) modal.classList.add('hidden');

    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(activeChatOrderId);

    if (cleanOrderId && storeId && db) {
        db.ref(`storeRiderChats/${cleanOrderId}_${storeId}/messages`).off();
    }

    activeChatOrderId = null;
    activeChatRiderId = null;
    activeChatRiderName = null;
    window.activeChatOrderId = null;
    cancelStoreReply();
}

function listenToStoreRiderChat(orderId) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const cleanOrderId = cleanFirebasePathKey(orderId);
    const container = document.getElementById('store-rider-chat-messages');

    if (!container || !storeId || !cleanOrderId || !db) return;

    db.ref(`storeRiderChats/${cleanOrderId}_${storeId}/messages`).on('value', (snap) => {
        const msgs = snap.val() || {};
        const list = Object.entries(msgs).map(([id, m]) => ({ id, ...m })).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        if (list.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-400 dark:text-gray-500 italic py-8 text-xs">No messages yet. Send a quick update to the rider.</div>`;
            return;
        }

        container.innerHTML = list.map(m => {
            const isStore = m.sender === 'store';
            const reactionsHtml = renderStoreReactionsHtml(m.reactions, m.id);
            const replyBlockHtml = renderReplyPreviewInsideMessage(m.replyTo);

            return `
            <div id="msg-bubble-${m.id}" class="flex flex-col ${isStore ? 'items-end' : 'items-start'} gap-1">
                <span class="text-[9px] text-gray-500 dark:text-gray-400 font-bold">${escapeHtml(m.senderName || (isStore ? 'Store' : 'Rider'))}</span>
                <div onclick="window.openMessageActionPopover(event, '${m.id}', 'store-rider', '${encodeURIComponent(m.text || '')}', '${encodeURIComponent(m.senderName || (isStore ? 'Store' : 'Rider'))}')" class="max-w-[80%] rounded-2xl px-3 py-2 text-xs ${isStore ? 'bg-orange-600 text-white rounded-br-none' : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-none border border-gray-200 dark:border-gray-700'} cursor-pointer active:scale-98 transition shadow-xs">
                    ${replyBlockHtml}
                    <div>${escapeHtml(m.text || '')}</div>
                    ${reactionsHtml}
                </div>
            </div>`;
        }).join('');

        container.scrollTop = container.scrollHeight;
    });
}

export function setStoreReply(msgId, senderName, text) {
    activeStoreReplyTarget = { id: msgId, sender: senderName, text: text };
    
    const replyBar = document.getElementById('store-chat-reply-bar');
    const replySender = document.getElementById('store-reply-sender');
    const replyText = document.getElementById('store-reply-text');
    const input = document.getElementById('store-rider-chat-input');

    if (replyBar && replySender && replyText) {
        replySender.innerText = `Replying to ${senderName || 'Rider'}`;
        replyText.innerText = text || 'Attachment';
        replyBar.classList.remove('hidden');
    }

    if (input) input.focus();
}

export function cancelStoreReply() {
    activeStoreReplyTarget = null;
    const replyBar = document.getElementById('store-chat-reply-bar');
    if (replyBar) replyBar.classList.add('hidden');
}

export async function sendStoreRiderChatMessage() {
    const input = document.getElementById('store-rider-chat-input');
    const text = input ? input.value.trim() : '';
    if (!text) return;

    await postStoreRiderMessage(text);
    if (input) input.value = '';
}

export async function sendStoreRiderQuickPreset(text) {
    if (!text) return;
    await postStoreRiderMessage(text);
}

async function postStoreRiderMessage(text) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id') || currentStoreData?.storeId;
    const storeId = cleanFirebasePathKey(rawStoreId);
    const storeName = appState.merchantStoreName || localStorage.getItem('lokalex_merchant_store_name') || "Store";
    const cleanOrderId = cleanFirebasePathKey(activeChatOrderId || window.activeChatOrderId || localStorage.getItem('lokalex_active_store_chat_order_id'));

    if (!cleanOrderId || !storeId || !db) {
        showToast("⚠️ Missing Order or Store session.");
        return;
    }

    const payload = {
        sender: 'store',
        senderName: storeName,
        text: text.trim(),
        timestamp: Date.now()
    };

    if (activeStoreReplyTarget) {
        payload.replyTo = {
            id: activeStoreReplyTarget.id,
            sender: activeStoreReplyTarget.sender,
            text: activeStoreReplyTarget.text.substring(0, 120)
        };
    }

    try {
        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}/messages`).push(sanitizeForFirebase(payload));
        await db.ref(`storeRiderChats/${cleanOrderId}_${storeId}`).update(sanitizeForFirebase({
            lastMessage: text.trim(),
            lastTimestamp: Date.now(),
            storeName,
            unreadForRider: true
        }));
        cancelStoreReply();
    } catch(e) {
        console.error("postStoreRiderMessage error:", e);
        showToast("❌ Failed to send message: " + (e.message || "Unknown error"));
    }
}

export function openEditStoreProfileModal() {
    const modal = document.getElementById('store-profile-modal');
    const nameInput = document.getElementById('store-edit-name');
    const addrInput = document.getElementById('store-edit-address');

    if (nameInput) nameInput.value = currentStoreData?.storeName || appState.merchantStoreName || '';
    if (addrInput) addrInput.value = currentStoreData?.address || '';

    if (modal) modal.classList.remove('hidden');
    if (nameInput) setTimeout(() => nameInput.focus(), 100);
}

export function closeEditStoreProfileModal() {
    const modal = document.getElementById('store-profile-modal');
    if (modal) modal.classList.add('hidden');
}

export async function submitSaveStoreProfile() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const newName = document.getElementById('store-edit-name')?.value.trim();
    const newAddress = document.getElementById('store-edit-address')?.value.trim();

    if (!newName) return showToast("⚠️ I-enter ang pangalan ng Store!");

    const saveBtn = document.getElementById('store-profile-save-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        await updateStoreProfile(storeId, {
            storeName: newName,
            address: newAddress || ""
        });
        closeEditStoreProfileModal();
    } catch (e) {
        showToast("❌ Failed to update store profile.");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> SAVE STORE DETAILS`;
        }
    }
}

export function updateIconModalPreview(urlOrBase64) {
    const previewImg = document.getElementById('store-icon-modal-preview-img');
    const previewIcon = document.getElementById('store-icon-modal-preview-icon');

    if (!previewImg || !previewIcon) return;

    if (urlOrBase64) {
        previewImg.src = urlOrBase64;
        previewImg.classList.remove('hidden');
        previewIcon.classList.add('hidden');
    } else {
        previewImg.src = '';
        previewImg.classList.add('hidden');
        previewIcon.classList.remove('hidden');
    }
}

export function openStoreIconModal() {
    const modal = document.getElementById('store-icon-modal');
    const urlInput = document.getElementById('store-icon-url-input');
    const fileInput = document.getElementById('store-icon-file-input');

    stagedLogoData = currentStoreData?.logoUrl || '';

    if (urlInput) {
        urlInput.value = stagedLogoData.startsWith('data:image') ? '' : stagedLogoData;
    }
    if (fileInput) fileInput.value = '';

    updateIconModalPreview(stagedLogoData);

    if (modal) modal.classList.remove('hidden');
}

export function closeStoreIconModal() {
    const modal = document.getElementById('store-icon-modal');
    if (modal) modal.classList.add('hidden');
}

export async function handleStoreIconFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    showToast("⏳ Processing image...");

    try {
        const compressedBase64 = await compressImageFile(file, 320, 320, 0.85);
        stagedLogoData = compressedBase64;

        const urlInput = document.getElementById('store-icon-url-input');
        if (urlInput) urlInput.value = '';

        updateIconModalPreview(stagedLogoData);
        showToast("✅ Image selected and compressed!");
    } catch (err) {
        showToast("❌ Hindi ma-load ang image file. Subukan muli.");
    }
}

export function onStoreIconUrlInput(urlValue) {
    stagedLogoData = (urlValue || '').trim();
    updateIconModalPreview(stagedLogoData);
}

export function clearStoreIcon() {
    stagedLogoData = '';
    const urlInput = document.getElementById('store-icon-url-input');
    const fileInput = document.getElementById('store-icon-file-input');

    if (urlInput) urlInput.value = '';
    if (fileInput) fileInput.value = '';

    updateIconModalPreview('');
    showToast("🗑️ Logo cleared. Click Save to apply.");
}

export async function submitSaveStoreIcon() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const saveBtn = document.getElementById('store-icon-save-btn');

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        await updateStoreLogo(storeId, stagedLogoData);
        closeStoreIconModal();
    } catch (e) {
        showToast("❌ Failed to update store icon.");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> SAVE LOGO`;
        }
    }
}

export function openAddCategoryModal() {
    const modal = document.getElementById('store-category-modal');
    const input = document.getElementById('cat-input-name');
    if (input) input.value = '';
    if (modal) modal.classList.remove('hidden');
    if (input) setTimeout(() => input.focus(), 100);
}

export function closeAddCategoryModal() {
    const modal = document.getElementById('store-category-modal');
    if (modal) modal.classList.add('hidden');
}

export async function submitAddCategory() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const input = document.getElementById('cat-input-name');
    const catName = (input?.value || '').trim();

    if (!catName) {
        return showToast("⚠️ I-enter ang pangalan ng Kategorya!");
    }

    const saveBtn = document.getElementById('cat-save-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        await saveStoreCategory(storeId, catName);
        closeAddCategoryModal();
    } catch (err) {
        showToast("❌ Failed to add category.");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-plus-circle"></i> CREATE CATEGORY`;
        }
    }
}

export function promptAddNewCategory() {
    openAddCategoryModal();
}

export function renderCategoriesBar() {
    const pillsContainer = document.getElementById('merch-category-pills');
    const subPillsContainer = document.getElementById('merch-subcategory-pills');
    const catSelect = document.getElementById('item-input-category');
    const totalCatsBadge = document.getElementById('merch-total-cats-badge');

    const categories = Object.values(currentMenuData.categories || {});
    if (totalCatsBadge) totalCatsBadge.innerText = `${categories.length} Categories`;

    if (catSelect) {
        catSelect.innerHTML = categories.length > 0
            ? categories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('')
            : `<option value="General">General</option>`;
    }

    if (!pillsContainer) return;

    let html = `
        <button onclick="window.selectCategoryFilter('ALL')" class="${selectedCategoryId === 'ALL' ? 'bg-orange-600 text-white' : 'bg-cardBg border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300'} text-xs font-bold px-3 py-1.5 rounded-xl shrink-0 transition">
            All Items
        </button>
    `;

    categories.forEach(cat => {
        const isSelected = selectedCategoryId === cat.name;
        html += `
            <div class="shrink-0 flex items-center bg-cardBg border ${isSelected ? 'border-orange-500 text-orange-600 dark:text-orange-400' : 'border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300'} rounded-xl overflow-hidden">
                <button onclick="window.selectCategoryFilter('${escapeHtml(cat.name)}')" class="text-xs font-bold px-3 py-1.5 transition">
                    ${escapeHtml(cat.name)}
                </button>
                <button onclick="window.promptDeleteCategory('${cat.id}', '${escapeHtml(cat.name)}')" class="pr-2 pl-1 text-[10px] text-gray-400 hover:text-red-500 transition" title="Delete Category">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;
    });

    pillsContainer.innerHTML = html;

    const items = Object.values(currentMenuData.items || {});
    const subCats = new Set();
    items.forEach(it => {
        if ((selectedCategoryId === 'ALL' || it.category === selectedCategoryId) && it.subCategory) {
            subCats.add(it.subCategory.trim());
        }
    });

    if (subCats.size > 0 && subPillsContainer) {
        subPillsContainer.classList.remove('hidden');
        let subHtml = `
            <button onclick="window.selectSubCategoryFilter('ALL')" class="${selectedSubCategory === 'ALL' ? 'bg-blue-600 text-white' : 'bg-cardBg border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-400'} text-[10px] font-bold px-2.5 py-1 rounded-lg shrink-0 transition">
                All Subcategories
            </button>
        `;
        subCats.forEach(sub => {
            const isSubSelected = selectedSubCategory === sub;
            subHtml += `
                <button onclick="window.selectSubCategoryFilter('${escapeHtml(sub)}')" class="${isSubSelected ? 'bg-blue-600 text-white' : 'bg-cardBg border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-400'} text-[10px] font-bold px-2.5 py-1 rounded-lg shrink-0 transition">
                    ${escapeHtml(sub)}
                </button>
            `;
        });
        subPillsContainer.innerHTML = subHtml;
    } else if (subPillsContainer) {
        subPillsContainer.classList.add('hidden');
    }
}

export function selectCategoryFilter(catName) {
    selectedCategoryId = catName;
    selectedSubCategory = 'ALL';
    renderCategoriesBar();
    renderItemsFeed();
}

export function selectSubCategoryFilter(subName) {
    selectedSubCategory = subName;
    renderCategoriesBar();
    renderItemsFeed();
}

export function promptDeleteCategory(catId, catName) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    openSlideDeleteModal(
        `Delete Category?`,
        `Sigurado ka bang nais burahin ang kategoryang [${catName}]?`,
        () => {
            deleteStoreCategory(storeId, catId, catName);
        }
    );
}

export function renderItemsFeed() {
    const feed = document.getElementById('merch-items-feed');
    const totalItemsBadge = document.getElementById('merch-total-items-badge');
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);

    if (!feed) return;

    let items = Object.values(currentMenuData.items || {});
    if (totalItemsBadge) totalItemsBadge.innerText = `${items.length} Items`;

    if (selectedCategoryId !== 'ALL') {
        items = items.filter(it => it.category === selectedCategoryId);
    }
    if (selectedSubCategory !== 'ALL') {
        items = items.filter(it => it.subCategory === selectedSubCategory);
    }

    if (items.length === 0) {
        feed.innerHTML = `
            <div class="text-center text-gray-500 dark:text-gray-400 italic py-12 text-xs bg-cardBg border border-gray-200 dark:border-gray-800 rounded-2xl p-6 flex flex-col items-center gap-2">
                <i class="fa-solid fa-utensils text-2xl text-gray-400 dark:text-gray-600"></i>
                <span>No menu items found in this section. Tap "+ Add New Item" to create one.</span>
            </div>
        `;
        return;
    }

    feed.innerHTML = items.map(item => {
        const isAvail = item.isAvailable !== false;
        const sizes = item.sizes || [];
        const addons = item.addons || [];

        let upgradesPreview = '';
        if (sizes.length > 0) {
            const sizesHtml = sizes.map((s, sIdx) => {
                const sAvail = s.isAvailable !== false;
                return `
                    <button onclick="window.toggleSizeStock('${storeId}', '${item.id}', ${sIdx}, ${sAvail})" class="inline-flex items-center gap-1 text-[9.5px] px-1.5 py-0.5 rounded border ${sAvail ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700/40' : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-700/40 line-through'} transition active:scale-95">
                        <span>${escapeHtml(s.name)} (+₱${parseFloat(s.priceDelta || 0).toFixed(0)})</span>
                        <span class="font-black text-[8px]">${sAvail ? '✓' : '86'}</span>
                    </button>
                `;
            }).join('');
            upgradesPreview += `<div class="flex flex-wrap gap-1 items-center mt-1"><span class="text-[9px] font-bold text-gray-400 uppercase">Sizes:</span> ${sizesHtml}</div>`;
        }

        if (addons.length > 0) {
            const addonsHtml = addons.map((a, aIdx) => {
                const aAvail = a.isAvailable !== false;
                return `
                    <button onclick="window.toggleAddonStock('${storeId}', '${item.id}', ${aIdx}, ${aAvail})" class="inline-flex items-center gap-1 text-[9.5px] px-1.5 py-0.5 rounded border ${aAvail ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700/40' : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-700/40 line-through'} transition active:scale-95">
                        <span>${escapeHtml(a.name)} (+₱${parseFloat(a.priceDelta || 0).toFixed(0)})</span>
                        <span class="font-black text-[8px]">${aAvail ? '✓' : '86'}</span>
                    </button>
                `;
            }).join('');
            upgradesPreview += `<div class="flex flex-wrap gap-1 items-center mt-1"><span class="text-[9px] font-bold text-gray-400 uppercase">Extras:</span> ${addonsHtml}</div>`;
        }

        return `
        <div class="bg-cardBg border border-gray-200 dark:border-gray-800 rounded-2xl p-3.5 flex items-start justify-between gap-3 shadow-xs">
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-black text-sm text-gray-900 dark:text-white">${escapeHtml(item.name)}</span>
                    <span class="text-xs font-mono font-black text-emerald-600 dark:text-emerald-400">₱${parseFloat(item.basePrice || 0).toFixed(2)}</span>
                    ${item.subCategory ? `<span class="text-[9px] bg-gray-100 dark:bg-darkBg text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-800 px-1.5 py-0.5 rounded">${escapeHtml(item.subCategory)}</span>` : ''}
                </div>

                ${item.description ? `<p class="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-snug">${escapeHtml(item.description)}</p>` : ''}
                
                <div class="mt-1">
                    ${upgradesPreview}
                </div>
            </div>

            <div class="flex flex-col items-end gap-2 shrink-0">
                <button onclick="window.toggleItemStock('${item.id}', ${isAvail})" class="text-[10px] font-bold px-2 py-1 rounded-lg border transition active:scale-95 ${isAvail ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-700 dark:text-red-400'}">
                    ${isAvail ? '🟢 IN STOCK' : '🔴 SOLD OUT'}
                </button>

                <div class="flex items-center gap-1.5">
                    <button onclick="window.editMenuItemModal('${item.id}')" class="bg-gray-100 hover:bg-gray-200 text-amber-600 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-amber-400 p-2 rounded-xl text-xs transition active:scale-95" title="Edit Item">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button onclick="window.promptDeleteMenuItem('${item.id}', '${escapeHtml(item.name)}')" class="bg-gray-100 hover:bg-gray-200 text-red-600 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-red-400 p-2 rounded-xl text-xs transition active:scale-95" title="Delete Item">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

export function toggleItemStock(itemId, currentStatus) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    toggleItemStockStatus(storeId, itemId, currentStatus);
}

export function toggleSizeStock(storeId, itemId, sizeIdx, currentStatus) {
    toggleSizeStockStatus(storeId, itemId, sizeIdx, currentStatus);
}

export function toggleAddonStock(storeId, itemId, addonIdx, currentStatus) {
    toggleAddonStockStatus(storeId, itemId, addonIdx, currentStatus);
}

export function promptDeleteMenuItem(itemId, itemName) {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    openSlideDeleteModal(
        `Delete Menu Item?`,
        `Sigurado ka bang nais burahin ang panindang [${itemName}]?`,
        () => {
            deleteMenuItem(storeId, itemId, itemName);
        }
    );
}

export function openItemEditorModal(item = null) {
    const modal = document.getElementById('store-item-modal');
    const title = document.getElementById('item-modal-title');
    const idInput = document.getElementById('item-edit-id');
    const nameInput = document.getElementById('item-input-name');
    const priceInput = document.getElementById('item-input-price');
    const catInput = document.getElementById('item-input-category');
    const subCatInput = document.getElementById('item-input-subcategory');
    const descInput = document.getElementById('item-input-desc');
    const imgInput = document.getElementById('item-input-image');
    const sizesContainer = document.getElementById('item-sizes-container');
    const addonsContainer = document.getElementById('item-addons-container');

    if (sizesContainer) sizesContainer.innerHTML = '';
    if (addonsContainer) addonsContainer.innerHTML = '';

    if (item) {
        if (title) title.innerText = "Edit Menu Item";
        if (idInput) idInput.value = item.id;
        if (nameInput) nameInput.value = item.name || '';
        if (priceInput) priceInput.value = item.basePrice || '';
        if (catInput) catInput.value = item.category || 'General';
        if (subCatInput) subCatInput.value = item.subCategory || '';
        if (descInput) descInput.value = item.description || '';
        if (imgInput) imgInput.value = item.imageUrl || '';

        (item.sizes || []).forEach(s => addSizeVariantRow(s.name, s.priceDelta));
        (item.addons || []).forEach(a => addAddonRow(a.name, a.priceDelta));
    } else {
        if (title) title.innerText = "Add Menu Item";
        if (idInput) idInput.value = '';
        if (nameInput) nameInput.value = '';
        if (priceInput) priceInput.value = '';
        if (subCatInput) subCatInput.value = '';
        if (descInput) descInput.value = '';
        if (imgInput) imgInput.value = '';
    }

    if (modal) modal.classList.remove('hidden');
}

export function closeItemEditorModal() {
    const modal = document.getElementById('store-item-modal');
    if (modal) modal.classList.add('hidden');
}

export function editMenuItemModal(itemId) {
    const item = currentMenuData.items ? currentMenuData.items[itemId] : null;
    if (item) openItemEditorModal(item);
}

export function addSizeVariantRow(name = '', priceDelta = 0) {
    const container = document.getElementById('item-sizes-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = "flex items-center gap-2 size-variant-row";
    row.innerHTML = `
        <input type="text" placeholder="Size (e.g. Medium 16oz / Large 22oz)" value="${escapeHtml(name)}" class="flex-1 bg-inputBg text-xs rounded-xl p-2 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white font-bold size-name-input">
        <input type="number" step="0.01" placeholder="+₱ Delta" value="${priceDelta}" class="w-24 bg-inputBg text-xs rounded-xl p-2 border border-gray-300 dark:border-gray-700 outline-none text-blue-600 dark:text-blue-400 font-mono font-bold size-delta-input">
        <button type="button" onclick="this.parentElement.remove()" class="text-gray-400 hover:text-red-500 p-1 text-sm"><i class="fa-solid fa-trash"></i></button>
    `;
    container.appendChild(row);
}

export function addAddonRow(name = '', priceDelta = 0) {
    const container = document.getElementById('item-addons-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = "flex items-center gap-2 addon-row";
    row.innerHTML = `
        <input type="text" placeholder="Add-on (e.g. Boba / Extra Egg)" value="${escapeHtml(name)}" class="flex-1 bg-inputBg text-xs rounded-xl p-2 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white font-bold addon-name-input">
        <input type="number" step="0.01" placeholder="+₱ Price" value="${priceDelta}" class="w-24 bg-inputBg text-xs rounded-xl p-2 border border-gray-300 dark:border-gray-700 outline-none text-amber-600 dark:text-amber-400 font-mono font-bold addon-delta-input">
        <button type="button" onclick="this.parentElement.remove()" class="text-gray-400 hover:text-red-500 p-1 text-sm"><i class="fa-solid fa-trash"></i></button>
    `;
    container.appendChild(row);
}

export async function submitSaveStoreItem() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const id = document.getElementById('item-edit-id')?.value.trim();
    const name = document.getElementById('item-input-name')?.value.trim();
    const basePrice = parseFloat(document.getElementById('item-input-price')?.value);
    const category = document.getElementById('item-input-category')?.value.trim() || 'General';
    const subCategory = document.getElementById('item-input-subcategory')?.value.trim();
    const description = document.getElementById('item-input-desc')?.value.trim();
    const imageUrl = document.getElementById('item-input-image')?.value.trim();

    if (!name) return showToast("⚠️ Item Name is required!");
    if (isNaN(basePrice) || basePrice < 0) return showToast("⚠️ Valid Base Price is required!");

    const sizes = [];
    document.querySelectorAll('.size-variant-row').forEach(row => {
        const sName = row.querySelector('.size-name-input')?.value.trim();
        const sDelta = parseFloat(row.querySelector('.size-delta-input')?.value) || 0;
        if (sName) sizes.push({ name: sName, priceDelta: sDelta, isAvailable: true });
    });

    const addons = [];
    document.querySelectorAll('.addon-row').forEach(row => {
        const aName = row.querySelector('.addon-name-input')?.value.trim();
        const aDelta = parseFloat(row.querySelector('.addon-delta-input')?.value) || 0;
        if (aName) addons.push({ name: aName, priceDelta: aDelta, isAvailable: true });
    });

    const itemPayload = {
        id: id || null,
        name,
        basePrice,
        category,
        subCategory,
        description,
        imageUrl,
        sizes,
        addons,
        isAvailable: true
    };

    const saveBtn = document.getElementById('item-save-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        await saveMenuItem(storeId, itemPayload);
        closeItemEditorModal();
    } catch(e) {
        showToast("❌ Failed to save item.");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> SAVE MENU ITEM`;
        }
    }
}

if (typeof window !== 'undefined') {
    window.renderStoreHub = renderStoreHub;
    window.toggleStoreOpenStatus = toggleStoreOpenStatus;
    window.renderStoreOrders = renderStoreOrders;
    window.setStoreOrdersTab = setStoreOrdersTab;
    window.updateStoreOrderStatus = updateStoreOrderStatus;
    window.openStoreRiderChatModal = openStoreRiderChatModal;
    window.closeStoreRiderChatModal = closeStoreRiderChatModal;
    window.sendStoreRiderChatMessage = sendStoreRiderChatMessage;
    window.sendStoreRiderQuickPreset = sendStoreRiderQuickPreset;
    window.openEditStoreProfileModal = openEditStoreProfileModal;
    window.closeEditStoreProfileModal = closeEditStoreProfileModal;
    window.submitSaveStoreProfile = submitSaveStoreProfile;
    window.openStoreIconModal = openStoreIconModal;
    window.closeStoreIconModal = closeStoreIconModal;
    window.handleStoreIconFileSelected = handleStoreIconFileSelected;
    window.onStoreIconUrlInput = onStoreIconUrlInput;
    window.clearStoreIcon = clearStoreIcon;
    window.submitSaveStoreIcon = submitSaveStoreIcon;
    window.openAddCategoryModal = openAddCategoryModal;
    window.closeAddCategoryModal = closeAddCategoryModal;
    window.submitAddCategory = submitAddCategory;
    window.promptAddNewCategory = promptAddNewCategory;
    window.renderCategoriesBar = renderCategoriesBar;
    window.selectCategoryFilter = selectCategoryFilter;
    window.selectSubCategoryFilter = selectSubCategoryFilter;
    window.promptDeleteCategory = promptDeleteCategory;
    window.renderItemsFeed = renderItemsFeed;
    window.toggleItemStock = toggleItemStock;
    window.toggleSizeStock = toggleSizeStock;
    window.toggleAddonStock = toggleAddonStock;
    window.promptDeleteMenuItem = promptDeleteMenuItem;
    window.openItemEditorModal = openItemEditorModal;
    window.closeItemEditorModal = closeItemEditorModal;
    window.editMenuItemModal = editMenuItemModal;
    window.addSizeVariantRow = addSizeVariantRow;
    window.addAddonRow = addAddonRow;
    window.submitSaveStoreItem = submitSaveStoreItem;
    window.setStoreReply = setStoreReply;
    window.cancelStoreReply = cancelStoreReply;
    window.toggleStoreRiderReaction = toggleStoreRiderReaction;
    window.playKitchenChime = playKitchenChime;
    window.startRepeatingKitchenAlarm = startRepeatingKitchenAlarm;
    window.stopRepeatingKitchenAlarm = stopRepeatingKitchenAlarm;
    window.toggleKitchenMute = toggleKitchenMute;
    window.acceptStoreOrderWithPrepTime = acceptStoreOrderWithPrepTime;
    window.promptCustomPrepTime = promptCustomPrepTime;
    window.markStoreOrderReadyForPickup = markStoreOrderReadyForPickup;
    window.openSubstitutionModal = openSubstitutionModal;
    window.closeSubstitutionModal = closeSubstitutionModal;
    window.submitItemSubstitution = submitItemSubstitution;
    window.renderDailySalesSummary = renderDailySalesSummary;
    window.printStoreOrderSlip = printStoreOrderSlip;
    window.printStoreOrderBluetooth = printStoreOrderBluetooth;
    window.openOperatingHoursModal = openOperatingHoursModal;
    window.closeOperatingHoursModal = closeOperatingHoursModal;
    window.saveOperatingHoursSettings = saveOperatingHoursSettings;
    window.checkAndApplyStoreOperatingHours = checkAndApplyStoreOperatingHours;

    window.addEventListener('viewChanged', (e) => {
        if (e.detail === 'view-store-hub') {
            renderStoreHub();
        }
    });

    if (document.getElementById('view-store-hub') && !document.getElementById('view-store-hub').classList.contains('hidden')) {
        renderStoreHub();
    }
}