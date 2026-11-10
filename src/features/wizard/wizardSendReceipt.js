// src/features/wizard/wizardSendReceipt.js

/**
 * ============================================================================
 * SEND RECEIPT TO CUSTOMER DISPATCH ENGINE
 * ============================================================================
 * 
 * Description:
 * Directly delivers generated image receipts to the target customer's chat thread
 * and Facebook Messenger conversation:
 * - Smart Recipient Resolver: Automatically matches the active catered customer
 *   name against live chat threads (supports in-memory cache, Supabase, and RTDB).
 * - Direct Dispatch with Webhook Relay: Uploads receipt to Firebase Storage and
 *   relays to Facebook Messenger via Cloudflare webhook worker if thread is from Messenger.
 * - Interactive Recipient Picker Modal: If the customer name is ambiguous or Sample,
 *   allows instant one-tap recipient selection from active deliveries and recent threads.
 * ============================================================================
 */

import { db } from '../../config/firebase.js';
import { appState, globalState, wizState, multiCarts } from '../../store/state.js';
import { uploadImage } from '../../utils/imageUpload.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';
import { currentReceiptDataUrl, currentReceiptCanvas, formatShortRef, renderReceiptCanvas } from './wizardImageReceipt.js';
import { renderFinalReceiptText } from './wizardTextReceipt.js';
import { saveReceiptToDatabase, completeReceiptDone } from './wizardCore.js';
import { calculateGrandTotal } from './wizardCalc.js';
import { forwardRiderReplyToMessenger } from '../chat/riderChat.js';
import { getActiveCateringCustomersWithTimes } from '../roster/index.js';
import { isCustomerMatch } from '../roster/rosterUtils.js';

let cachedRecipientsList = [];

function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

function createLightweightReceiptPreview(dataUrl, maxWidth = 540, quality = 0.48) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
        return Promise.resolve(dataUrl);
    }
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                let w = img.width;
                let h = img.height;
                if (w > maxWidth) {
                    h = Math.round((h * maxWidth) / w);
                    w = maxWidth;
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            } catch (_) {
                resolve(dataUrl);
            }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

/**
 * Directly validates, generates, and delivers the receipt from the Wizard screen.
 * Immediately closes the wizard modal while receipt rendering and dispatch run in the background.
 */
export async function sendReceiptDirectlyFromWizard() {
    calculateGrandTotal();

    const freeDeliveryEl = document.getElementById('wiz-free-delivery');
    const isFree = freeDeliveryEl ? freeDeliveryEl.checked : false;
    const deliveryVal = document.getElementById('wiz-delivery')?.value.trim() || "";

    if (!isFree && (deliveryVal === "" || isNaN(parseFloat(deliveryVal)) || parseFloat(deliveryVal) <= 0)) {
        showToast("⚠️ Please enter Rider Delivery Fee before sending receipt!");
        const deliveryInput = document.getElementById('wiz-delivery');
        if (deliveryInput) deliveryInput.focus();
        return;
    }

    const rcptNameInput = document.getElementById('rcpt-name');
    let customerName = rcptNameInput ? rcptNameInput.value.trim() : "";
    if (!customerName || customerName.toLowerCase() === 'sample') {
        const activeCartIdx = globalState.activeCartIndex || 0;
        customerName = (multiCarts && multiCarts[activeCartIdx + 1]?.customerName) || appState.selectedCateringClient || "";
    }
    if (!customerName || customerName.toLowerCase() === 'sample') {
        const activeCusts = (typeof getActiveCateringCustomersWithTimes === 'function') ? getActiveCateringCustomersWithTimes() : [];
        if (activeCusts && activeCusts.length === 1 && activeCusts[0]?.name) {
            customerName = activeCusts[0].name.trim();
            if (rcptNameInput) rcptNameInput.value = customerName;
            appState.selectedCateringClient = customerName;
        }
    }

    if (!customerName) {
        showToast("⚠️ Please enter customer name or select catered client first!");
        if (rcptNameInput) rcptNameInput.focus();
        return;
    }

    // 1. Start saving receipt & commission record toward the rider (synchronously sets wizState.currentReceiptTransactionId)
    const savePromise = saveReceiptToDatabase(customerName);
    const snapshotTxId = wizState.currentReceiptTransactionId || `E37FG-${Date.now().toString(36).toUpperCase()}`;

    // 2. Start rendering text and canvas (synchronously snapshots wizState & cart before first await)
    renderFinalReceiptText();
    const canvasPromise = renderReceiptCanvas();

    // 3. Close the wizard modal & lock the cart immediately (0ms UI transition)
    completeReceiptDone(customerName);
    showToast(`🧾 Sending receipt to ${customerName} in background...`);

    // 4. Finish rendering & dispatching in the background without blocking the user
    (async () => {
        try {
            await Promise.all([savePromise, canvasPromise]);
            await sendReceiptToRecipient(null, customerName, { alreadyClosedModal: true, rawTxIdSnapshot: snapshotTxId });
        } catch (bgErr) {
            console.error("[SendReceiptDirectly] Background dispatch error:", bgErr);
        }
    })();
}

/**
 * Main entry point: Sends the created receipt to the target recipient
 */
export async function sendReceiptToRecipient(targetCustId = null, targetCustName = null, options = {}) {
    const explicitName = document.getElementById('rcpt-name')?.value?.trim() || "";
    const activeCartIdx = globalState.activeCartIndex || 0;
    const cartCustName = (multiCarts && multiCarts[activeCartIdx + 1]?.customerName) || "";
    const customerName = (targetCustName || explicitName || cartCustName || appState.selectedCateringClient || "").trim();

    // Ensure image receipt canvas is rendered if not yet ready
    if (!currentReceiptDataUrl && !currentReceiptCanvas) {
        if (!options?.alreadyClosedModal) {
            showToast("⏳ Rendering receipt image...");
        }
        try {
            renderFinalReceiptText();
            await renderReceiptCanvas();
        } catch (e) {
            console.warn("Failed generating receipt canvas:", e);
        }
    }

    if (!currentReceiptDataUrl && !currentReceiptCanvas) {
        showToast("⚠️ Image receipt is still generating. Please try again in a moment.");
        return;
    }

    if (targetCustId) {
        await executeSendReceiptToCustId(targetCustId, customerName || targetCustName, options);
        return;
    }

    if (!db) {
        showToast("⚠️ Database not connected. Please save image instead.");
        return;
    }

    // Attempt automatic recipient resolution
    if (customerName && customerName.toLowerCase() !== 'sample') {
        try {
            const matchedThread = await resolveMatchingCustomerThread(customerName);
            if (matchedThread && matchedThread.custId) {
                await executeSendReceiptToCustId(matchedThread.custId, matchedThread.customerName || customerName, options);
                return;
            }
        } catch (err) {
            console.warn("Auto-resolve recipient error:", err);
        }
    }

    // If ambiguous, sample, or not found, open the recipient selection modal
    await openReceiptRecipientModal(customerName);
}

/**
 * Automatically looks up a unique customer thread matching the given customer name
 */
async function resolveMatchingCustomerThread(targetName) {
    if (!targetName) return null;
    const cleanTarget = targetName.trim().toLowerCase();
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").trim().toLowerCase();

    // 1. Check in-memory cached threads first (instant, 0ms latency)
    let allChats = {};
    if (typeof window !== 'undefined' && typeof window.getCachedCustomerThreadsMap === 'function') {
        const map = window.getCachedCustomerThreadsMap();
        if (map && map.size > 0) {
            for (const [k, v] of map.entries()) {
                allChats[k] = v;
            }
        }
    }

    // 2. Fallback to DB query if memory cache is empty
    if (Object.keys(allChats).length === 0 && db) {
        try {
            const snap = await db.ref('customerChatMeta').once('value');
            allChats = snap.val() || {};
        } catch (e) {
            console.warn("customerChatMeta query fallback warning:", e);
        }
    }

    const matches = [];
    Object.entries(allChats).forEach(([cId, metaItem]) => {
        if (!metaItem) return;
        const meta = metaItem.metadata || metaItem;
        let cName = (meta.customerName || meta.name || "").trim().toLowerCase();

        if (cId.startsWith('fb_') && typeof window.getResolvedFbName === 'function') {
            const fbInfo = window.getResolvedFbName(cId);
            if (fbInfo && fbInfo.name) {
                cName = fbInfo.name.trim().toLowerCase();
            }
        }
        if (!cName) return;

        const isExact = cName === cleanTarget;
        const isFuzzy = isCustomerMatch(cName, targetName);

        if (isExact || isFuzzy) {
            const rId = (meta.cateredByRiderId || "").toString().trim();
            const rName = (meta.cateredByRiderName || meta.cateredBy || "").trim().toLowerCase();
            const isMine = (myId && rId === myId) || (myName && rName === myName) || meta.folder === 'catering';

            matches.push({
                custId: cId,
                customerName: meta.customerName || meta.name || targetName,
                isMine: isMine,
                isExact: isExact,
                lastUpdated: meta.lastUpdated || 0,
                ...meta
            });
        }
    });

    if (matches.length === 0) return null;

    // Prioritize threads currently catered by the logged-in rider
    const myMatches = matches.filter(m => m.isMine);
    if (myMatches.length === 1) return myMatches[0];
    if (myMatches.length > 1) {
        // Return most recently active
        myMatches.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
        return myMatches[0];
    }

    // Otherwise if there's an exact match
    const exactMatches = matches.filter(m => m.isExact);
    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1) {
        exactMatches.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
        return exactMatches[0];
    }

    // If exactly one match in total
    if (matches.length === 1) return matches[0];

    return null;
}

/**
 * Opens modal for selecting the target customer to receive the receipt
 */
export async function openReceiptRecipientModal(suggestedName = "") {
    const modal = document.getElementById('receipt-recipient-modal');
    const listEl = document.getElementById('receipt-recipients-list');
    const subtitleEl = document.getElementById('receipt-recipient-modal-subtitle');
    const searchInput = document.getElementById('receipt-recipient-search');

    if (!modal) return;

    modal.classList.remove('hidden');

    const rawTxId = wizState.currentReceiptTransactionId || Date.now().toString(36);
    const shortRef = formatShortRef(rawTxId);
    if (subtitleEl) {
        subtitleEl.innerText = suggestedName && suggestedName.toLowerCase() !== 'sample'
            ? `Recipient for ${suggestedName} (#${shortRef})`
            : `Select recipient for Receipt #${shortRef}`;
    }

    if (searchInput) {
        searchInput.value = suggestedName && suggestedName.toLowerCase() !== 'sample' ? suggestedName : "";
    }

    if (listEl) {
        listEl.innerHTML = `
        <div class="text-center text-blue-500 text-xs font-bold py-8 flex flex-col items-center gap-2">
            <i class="fa-solid fa-spinner fa-spin text-xl"></i>
            <span>Loading recipients...</span>
        </div>`;
    }

    try {
        const recipients = await fetchRecipientsList(suggestedName);
        cachedRecipientsList = recipients;
        renderReceiptRecipientsList(recipients);
    } catch (e) {
        console.error("Error loading recipients:", e);
        if (listEl) {
            listEl.innerHTML = `<div class="text-red-500 text-xs text-center py-6">Failed to load customer recipients.</div>`;
        }
    }
}

export function closeReceiptRecipientModal() {
    const modal = document.getElementById('receipt-recipient-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Builds candidate recipient list prioritizing active catered customers
 */
async function fetchRecipientsList(suggestedName = "") {
    const list = [];
    const seenCustIds = new Set();
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").trim().toLowerCase();

    // 1. Current rider's active catering deliveries
    const activeCateringList = (typeof getActiveCateringCustomersWithTimes === 'function')
        ? getActiveCateringCustomersWithTimes()
        : [];

    let chatMeta = {};
    if (typeof window !== 'undefined' && typeof window.getCachedCustomerThreadsMap === 'function') {
        const map = window.getCachedCustomerThreadsMap();
        if (map && map.size > 0) {
            for (const [k, v] of map.entries()) {
                chatMeta[k] = v;
            }
        }
    }

    if (Object.keys(chatMeta).length === 0 && db) {
        try {
            const snap = await db.ref('customerChatMeta').once('value');
            chatMeta = snap.val() || {};
        } catch (_) {}
    }

    // Match active deliveries to chat threads
    activeCateringList.forEach(act => {
        const cleanName = (act.name || "").trim();
        if (!cleanName || cleanName.toLowerCase() === 'sample') return;

        let matchedId = null;
        let matchedMeta = null;

        for (const [cId, metaItem] of Object.entries(chatMeta)) {
            if (!metaItem) continue;
            const meta = metaItem.metadata || metaItem;
            let cName = meta.customerName || meta.name || "";
            if (cId.startsWith('fb_') && typeof window.getResolvedFbName === 'function') {
                const fbInfo = window.getResolvedFbName(cId);
                if (fbInfo && fbInfo.name) cName = fbInfo.name;
            }

            if (isCustomerMatch(cName, cleanName)) {
                if (cId.startsWith('fb_') || !matchedId) {
                    matchedId = cId;
                    matchedMeta = meta;
                    if (cId.startsWith('fb_')) break;
                }
            }
        }

        const effectiveId = matchedId || `cust_${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        seenCustIds.add(effectiveId);

        list.push({
            custId: effectiveId,
            customerName: cleanName,
            isDelivery: true,
            isMine: true,
            channel: matchedMeta?.channel || (effectiveId.startsWith('fb_') ? 'messenger' : 'web'),
            apiId: matchedMeta?.apiId || matchedMeta?.channelId || null,
            apiName: matchedMeta?.apiName || null,
            avatarUrl: matchedMeta?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanName)}&background=10B981&color=fff`,
            lastUpdated: Date.now() + 1000000 // Float to top
        });
    });

    // 2. Recent threads in customerChatMeta
    Object.entries(chatMeta).forEach(([cId, metaItem]) => {
        if (!metaItem || seenCustIds.has(cId)) return;
        const meta = metaItem.metadata || metaItem;
        let cName = (meta.customerName || meta.name || "").trim();
        if (cId.startsWith('fb_') && typeof window.getResolvedFbName === 'function') {
            const fbInfo = window.getResolvedFbName(cId);
            if (fbInfo && fbInfo.name) cName = fbInfo.name;
        }
        if (!cName || cName.toLowerCase() === 'sample') return;

        const rId = (meta.cateredByRiderId || "").toString().trim();
        const rName = (meta.cateredByRiderName || meta.cateredBy || "").trim().toLowerCase();
        const isMine = (myId && rId === myId) || (myName && rName === myName) || meta.folder === 'catering';

        list.push({
            custId: cId,
            customerName: cName,
            isDelivery: false,
            isMine: isMine,
            channel: meta.channel || (cId.startsWith('fb_') ? 'messenger' : 'web'),
            apiId: meta.apiId || meta.channelId || null,
            apiName: meta.apiName || null,
            avatarUrl: meta.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(cName)}&background=0084FF&color=fff`,
            lastUpdated: meta.lastUpdated || 0,
            lastMessage: meta.lastMessage || ""
        });
    });

    // Sort: My Active Deliveries first, then most recently active threads
    list.sort((a, b) => {
        if (a.isDelivery && !b.isDelivery) return -1;
        if (!a.isDelivery && b.isDelivery) return 1;
        if (a.isMine && !b.isMine) return -1;
        if (!a.isMine && b.isMine) return 1;
        return (b.lastUpdated || 0) - (a.lastUpdated || 0);
    });

    return list;
}

function renderReceiptRecipientsList(recipients) {
    const listEl = document.getElementById('receipt-recipients-list');
    if (!listEl) return;

    if (!recipients || recipients.length === 0) {
        listEl.innerHTML = `<div class="text-center text-gray-500 italic text-xs py-8">No matching recipients found.</div>`;
        return;
    }

    listEl.innerHTML = recipients.map(r => {
        const channelBadge = r.channel === 'messenger' || String(r.custId).startsWith('fb_')
            ? `<span class="bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-[9px] font-black px-1.5 py-0.2 rounded flex items-center gap-1"><i class="fa-brands fa-facebook-messenger"></i> Messenger</span>`
            : `<span class="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[9px] font-black px-1.5 py-0.2 rounded flex items-center gap-1"><i class="fa-solid fa-globe"></i> Web</span>`;

        const deliveryBadge = r.isDelivery
            ? `<span class="bg-emerald-600 text-white text-[9px] font-black px-1.5 py-0.2 rounded-full flex items-center gap-0.5"><i class="fa-solid fa-motorcycle"></i> Active Delivery</span>`
            : (r.isMine ? `<span class="bg-amber-600/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-[9px] font-bold px-1.5 py-0.2 rounded">Catered</span>` : '');

        return `
        <div class="bg-gray-50 dark:bg-zinc-900 hover:bg-gray-100 dark:hover:bg-zinc-800 border border-gray-200 dark:border-zinc-800 p-2.5 rounded-2xl flex items-center justify-between gap-2.5 transition shadow-2xs">
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
                <img src="${escapeHtml(r.avatarUrl)}" class="w-9 h-9 rounded-full object-cover border border-gray-200 dark:border-zinc-700 shrink-0" onerror="this.src='https://ui-avatars.com/api/?name=User&background=0084FF&color=fff'">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="font-bold text-xs text-gray-900 dark:text-white truncate">${escapeHtml(r.customerName)}</span>
                        ${deliveryBadge}
                    </div>
                    <div class="flex items-center gap-1.5 mt-0.5 text-[10px] text-gray-500 dark:text-gray-400 truncate">
                        ${channelBadge}
                        ${r.lastMessage ? `<span class="truncate">${escapeHtml(r.lastMessage)}</span>` : ''}
                    </div>
                </div>
            </div>
            <button 
                data-cust-id="${escapeHtml(r.custId)}"
                data-cust-name="${escapeHtml(r.customerName)}"
                onclick="window.executeSendReceiptToCustId && window.executeSendReceiptToCustId(this.getAttribute('data-cust-id'), this.getAttribute('data-cust-name'))" 
                class="bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 shadow-sm shrink-0 cursor-pointer">
                <i class="fa-solid fa-paper-plane text-[10px]"></i> Send
            </button>
        </div>`;
    }).join('');
}

export function filterReceiptRecipients(query) {
    const clean = (query || "").trim().toLowerCase();
    if (!clean) {
        renderReceiptRecipientsList(cachedRecipientsList);
        return;
    }

    const filtered = cachedRecipientsList.filter(r => {
        const name = (r.customerName || "").toLowerCase();
        const id = (r.custId || "").toLowerCase();
        return name.includes(clean) || id.includes(clean);
    });

    renderReceiptRecipientsList(filtered);
}

/**
 * Performs actual message dispatch into Firebase Realtime Database and Facebook Messenger
 */
export async function executeSendReceiptToCustId(targetCustId, recipientName, options = {}) {
    if (!targetCustId) return;

    // 0. Close recipient modal immediately
    closeReceiptRecipientModal();

    const btn = document.getElementById('send-receipt-to-cust-btn');
    const oldBtnHtml = btn ? btn.innerHTML : "";
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-xs shrink-0"></i><span class="text-[11px] leading-tight">Sending...</span>`;
    }

    if (!options?.alreadyClosedModal) {
        showToast(`📤 Sending receipt to ${recipientName || 'customer'}...`);
    }

    try {
        const activeCartIdx = globalState.activeCartIndex || 0;
        const finalCustomerName = (
            recipientName ||
            document.getElementById('rcpt-name')?.value?.trim() ||
            (multiCarts && multiCarts[activeCartIdx + 1]?.customerName) ||
            appState.selectedCateringClient ||
            ""
        ).trim();

        const rawTxId = options?.rawTxIdSnapshot || wizState.currentReceiptTransactionId || (multiCarts?.[activeCartIdx + 1]?.receiptSummary?.txId) || Date.now().toString(36);
        const shortRef = formatShortRef(rawTxId);
        const riderName = appState.riderName || localStorage.getItem('riderName') || "Lokalex Rider";
        const now = Date.now();

        // Ensure receipt & commission are recorded toward the rider for this customer (skip duplicate if already triggered)
        if (!options?.alreadyClosedModal && finalCustomerName && finalCustomerName.toLowerCase() !== 'sample') {
            saveReceiptToDatabase(finalCustomerName).catch(() => {});
        }

        // If modal wasn't already closed by sendReceiptDirectlyFromWizard, close it right after canvas is ready
        let finalImageUrl = currentReceiptDataUrl;
        if (!finalImageUrl && currentReceiptCanvas) {
            try {
                finalImageUrl = currentReceiptCanvas.toDataURL('image/jpeg', 0.94);
            } catch (_) {}
        }
        if (!finalImageUrl) {
            renderFinalReceiptText();
            await renderReceiptCanvas();
            finalImageUrl = currentReceiptDataUrl || (currentReceiptCanvas ? currentReceiptCanvas.toDataURL('image/jpeg', 0.94) : null);
        }

        if (!options?.alreadyClosedModal) {
            completeReceiptDone(finalCustomerName || recipientName);
        }

        if (!finalImageUrl) {
            throw new Error("Receipt image generation failed. Please try saving image manually.");
        }

        // 2. Resolve metadata from thread cache or DB
        let targetMeta = null;
        if (typeof window !== 'undefined' && typeof window.getCachedCustomerThreadsMap === 'function') {
            const threadMap = window.getCachedCustomerThreadsMap();
            if (threadMap && threadMap.has(targetCustId)) {
                targetMeta = threadMap.get(targetCustId);
            }
        }
        if (!targetMeta && db) {
            try {
                const snap = await db.ref(`customerChatMeta/${targetCustId}`).once('value');
                targetMeta = snap.val()?.metadata || snap.val() || null;
            } catch (_) {}
        }

        const cachedRecipient = (cachedRecipientsList || []).find(r => r.custId === targetCustId);
        const isFbTarget = String(targetCustId).startsWith('fb_') || targetMeta?.channel === 'messenger' || cachedRecipient?.channel === 'messenger';
        const targetChannel = isFbTarget ? 'messenger' : (targetMeta?.channel || cachedRecipient?.channel || 'messenger');
        const targetApiId = targetMeta?.apiId || targetMeta?.channelId || cachedRecipient?.apiId || null;
        const targetApiName = targetMeta?.apiName || cachedRecipient?.apiName || 'Facebook';

        // 3. Upload image to Storage (or preserve crisp high-resolution base64 data URL)
        let hostedImageUrl = finalImageUrl;
        if (finalImageUrl.startsWith('data:')) {
            try {
                hostedImageUrl = await uploadImage(finalImageUrl, `chats/${targetCustId}/receipt_${now}.jpg`, { isReceipt: true }, { isReceipt: true });
            } catch (upErr) {
                console.warn("[Receipt] Storage upload fallback to data URL:", upErr);
                hostedImageUrl = finalImageUrl;
            }
        }

        const newMsg = {
            sender: riderName,
            senderType: 'rider',
            text: `🧾 Official Delivery Receipt #${shortRef}`,
            imageUrl: hostedImageUrl || finalImageUrl,
            type: 'image',
            timestamp: now,
            isRider: true,
            status: 'sent',
            channel: targetChannel,
            apiId: targetApiId,
            deliveredAt: null,
            seenAt: null
        };

        const metaUpdate = sanitizeForFirebase({
            lastMessage: `You: 🧾 Official Delivery Receipt #${shortRef}`,
            lastUpdated: now,
            customerName: recipientName || targetMeta?.customerName || (targetCustId.startsWith('cust_') ? targetCustId.replace(/^cust_/, '').replace(/_/g, ' ') : null),
            channel: targetChannel,
            apiId: targetApiId,
            apiName: targetApiName,
            unreadForRider: false
        });

        // 4. Parallel write to Database (store lightweight compressed preview in DB while sending full-res to Messenger)
        let dbImageUrl = hostedImageUrl || finalImageUrl;
        if (typeof dbImageUrl === 'string' && dbImageUrl.startsWith('data:image') && dbImageUrl.length > 55000) {
            try {
                dbImageUrl = await createLightweightReceiptPreview(dbImageUrl, 540, 0.48);
            } catch (_) {}
        }
        const dbMsg = { ...newMsg, imageUrl: dbImageUrl };

        let newMsgKey = null;
        if (db) {
            const pushRef = db.ref(`customerChats/${targetCustId}/messages`).push();
            newMsgKey = pushRef ? pushRef.key : null;
            if (pushRef) {
                await pushRef.set(sanitizeForFirebase(dbMsg));
            }
            await db.ref(`customerChatMeta/${targetCustId}`).update(metaUpdate)
                .catch(err => console.warn("Firebase receipt write warning:", err));
        }

        // 5. Relay directly to Facebook Messenger webhook if customer is from Facebook
        if (targetChannel === 'messenger' || isFbTarget) {
            try {
                if (typeof forwardRiderReplyToMessenger === 'function') {
                    await forwardRiderReplyToMessenger({
                        custId: targetCustId,
                        apiId: targetApiId,
                        text: "", // Never send text alongside image receipt to Messenger
                        imageUrl: hostedImageUrl || finalImageUrl,
                        riderName: riderName,
                        newMsgKey: newMsgKey,
                        skipSeparateCaption: true,
                        suppressToast: true
                    });
                }
            } catch (fbErr) {
                console.warn("Forwarding receipt to Messenger warning:", fbErr);
            }
        }

        // 6. Update in-memory chat cache if function is available
        if (newMsgKey && typeof window !== 'undefined' && typeof window.appendSingleChatMessageToCache === 'function') {
            window.appendSingleChatMessageToCache(targetCustId, { id: newMsgKey, ...newMsg });
        }

        // 7. Background delivery completion notification
        showToast(`✅ Receipt sent to ${finalCustomerName || recipientName || 'customer'} & commission recorded!`);
        showSideNotification("RECEIPT SENT", `Delivered to ${finalCustomerName || recipientName || 'customer'}`, "fa-paper-plane", "text-blue-400", "border-blue-500");

        if (btn) {
            btn.disabled = false;
            btn.className = "bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-1.5 rounded-xl shadow-lg flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 transition active:scale-95 text-center cursor-pointer";
            btn.innerHTML = `<i class="fa-solid fa-check text-xs shrink-0"></i><span class="text-[11px] leading-tight">Sent to ${escapeHtml(finalCustomerName || recipientName || 'Customer')}!</span>`;
        }
    } catch (e) {
        console.error("Failed to send receipt to customer:", e);
        showToast(`❌ Failed to send receipt: ${e.message || 'Network error'}`);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = oldBtnHtml || `<i class="fa-solid fa-paper-plane text-xs shrink-0"></i><span class="text-[11px] leading-tight">Send to Customer</span>`;
        }
    }
}

// Global window registration
if (typeof window !== 'undefined') {
    window.sendReceiptDirectlyFromWizard = sendReceiptDirectlyFromWizard;
    window.sendReceiptToRecipient = sendReceiptToRecipient;
    window.openReceiptRecipientModal = openReceiptRecipientModal;
    window.closeReceiptRecipientModal = closeReceiptRecipientModal;
    window.filterReceiptRecipients = filterReceiptRecipients;
    window.executeSendReceiptToCustId = executeSendReceiptToCustId;
}
