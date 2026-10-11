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
 *   name against live chat threads (customerChatMeta).
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
import { currentReceiptDataUrl, currentReceiptCanvas, formatShortRef } from './wizardImageReceipt.js';
import { forwardRiderReplyToMessenger } from '../chat/riderChat.js';
import { getActiveCateringCustomersWithTimes } from '../roster/index.js';
import { isCustomerMatch } from '../roster/rosterUtils.js';

let cachedRecipientsList = [];

function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

/**
 * Main entry point: Sends the created receipt to the target recipient
 */
export async function sendReceiptToRecipient(targetCustId = null, targetCustName = null) {
    if (!currentReceiptDataUrl && !currentReceiptCanvas) {
        showToast("⚠️ Image receipt is still generating. Please wait a moment...");
        return;
    }

    const explicitName = document.getElementById('rcpt-name')?.value?.trim() || "";
    const activeCartIdx = globalState.activeCartIndex || 0;
    const cartCustName = (multiCarts && multiCarts[activeCartIdx + 1]?.customerName) || "";
    const customerName = (targetCustName || explicitName || cartCustName || appState.selectedCateringClient || "").trim();

    if (targetCustId) {
        await executeSendReceiptToCustId(targetCustId, customerName || targetCustName);
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
                await executeSendReceiptToCustId(matchedThread.custId, matchedThread.customerName || customerName);
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
    if (!targetName || !db) return null;
    const cleanTarget = targetName.trim().toLowerCase();
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").trim().toLowerCase();

    const snap = await db.ref('customerChatMeta').once('value');
    const allChats = snap.val() || {};

    const matches = [];
    Object.entries(allChats).forEach(([cId, meta]) => {
        if (!meta) return;
        const cName = (meta.customerName || meta.name || "").trim().toLowerCase();
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

    // Otherwise if there's only 1 exact match
    const exactMatches = matches.filter(m => m.isExact);
    if (exactMatches.length === 1) return exactMatches[0];

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
    if (db) {
        const snap = await db.ref('customerChatMeta').limitToLast(60).once('value');
        chatMeta = snap.val() || {};
    }

    // Match active deliveries to chat threads
    activeCateringList.forEach(act => {
        const cleanName = (act.name || "").trim();
        if (!cleanName || cleanName.toLowerCase() === 'sample') return;

        let matchedId = null;
        let matchedMeta = null;

        for (const [cId, meta] of Object.entries(chatMeta)) {
            if (!meta) continue;
            const cName = meta.customerName || meta.name || "";
            if (isCustomerMatch(cName, cleanName)) {
                matchedId = cId;
                matchedMeta = meta;
                break;
            }
        }

        const effectiveId = matchedId || `cust_${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        seenCustIds.add(effectiveId);

        list.push({
            custId: effectiveId,
            customerName: cleanName,
            isDelivery: true,
            isMine: true,
            channel: matchedMeta?.channel || 'messenger',
            avatarUrl: matchedMeta?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanName)}&background=10B981&color=fff`,
            lastUpdated: Date.now() + 1000000 // Float to top
        });
    });

    // 2. Recent threads in customerChatMeta
    Object.entries(chatMeta).forEach(([cId, meta]) => {
        if (!meta || seenCustIds.has(cId)) return;
        const cName = (meta.customerName || meta.name || "").trim();
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
            <button onclick="window.executeSendReceiptToCustId && window.executeSendReceiptToCustId('${escapeHtml(r.custId)}', '${escapeHtml(r.customerName)}')" class="bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 shadow-sm shrink-0 cursor-pointer">
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
export async function executeSendReceiptToCustId(targetCustId, recipientName) {
    if (!targetCustId) return;

    const btn = document.getElementById('send-receipt-to-cust-btn');
    const oldBtnHtml = btn ? btn.innerHTML : "";
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-xs shrink-0"></i><span class="text-[11px] leading-tight">Sending...</span>`;
    }

    showToast(`📤 Sending receipt to ${recipientName || 'customer'}...`);

    try {
        const rawTxId = wizState.currentReceiptTransactionId || Date.now().toString(36);
        const shortRef = formatShortRef(rawTxId);
        const riderName = appState.riderName || localStorage.getItem('riderName') || "Lokalex Rider";
        const now = Date.now();

        // 1. Upload receipt image to Firebase Storage for clean HTTPS download link
        const imgData = currentReceiptDataUrl || (currentReceiptCanvas ? currentReceiptCanvas.toDataURL('image/png') : null);
        let finalImageUrl = imgData;

        if (imgData && imgData.startsWith('data:')) {
            try {
                finalImageUrl = await uploadImage(imgData, `chats/${targetCustId}/receipt_${now}.png`);
            } catch (err) {
                console.warn("Storage upload fallback for receipt:", err);
            }
        }

        // 2. Fetch channel metadata to forward to Messenger if appropriate
        let meta = {};
        if (db) {
            try {
                const metaSnap = await db.ref(`customerChats/${targetCustId}/metadata`).once('value');
                meta = metaSnap.val() || {};
            } catch (e) {}
        }

        const targetChannel = meta.channel || (String(targetCustId).startsWith('fb_') ? 'messenger' : 'web');
        const targetApiId = meta.apiId || meta.channelId || null;
        const receiptText = `🧾 Official Delivery Receipt #${shortRef}`;

        const newMsg = {
            sender: riderName,
            senderType: 'rider',
            text: receiptText,
            imageUrl: finalImageUrl,
            type: 'image',
            timestamp: now,
            isRider: true,
            status: 'sent',
            channel: targetChannel,
            apiId: targetApiId,
            deliveredAt: null,
            seenAt: null
        };

        // 3. Write to Firebase Realtime Database
        if (db) {
            await db.ref(`customerChats/${targetCustId}/messages`).push(sanitizeForFirebase(newMsg));
            const metaUpdate = sanitizeForFirebase({
                lastMessage: `You: 🧾 Official Delivery Receipt #${shortRef}`,
                lastUpdated: now,
                unreadForRider: false
            });
            await db.ref(`customerChats/${targetCustId}/metadata`).update(metaUpdate);
            await db.ref(`customerChatMeta/${targetCustId}`).update(metaUpdate).catch(() => {});
        }

        // 4. Relay directly to Facebook Messenger webhook if customer came from Facebook
        if (targetChannel === 'messenger' || String(targetCustId).startsWith('fb_')) {
            try {
                if (typeof forwardRiderReplyToMessenger === 'function') {
                    await forwardRiderReplyToMessenger({
                        custId: targetCustId,
                        apiId: targetApiId,
                        text: receiptText,
                        imageUrl: finalImageUrl,
                        riderName: riderName
                    });
                }
            } catch (fbErr) {
                console.warn("Forwarding receipt to Messenger warning:", fbErr);
            }
        }

        // 5. Success notifications and UI updates
        closeReceiptRecipientModal();
        showToast(`✅ Resibo matagumpay na naipadala kay ${recipientName || 'customer'}!`);
        showSideNotification("RECEIPT SENT", `Delivered to ${recipientName || 'customer'}`, "fa-paper-plane", "text-blue-400", "border-blue-500");

        if (btn) {
            btn.disabled = false;
            btn.className = "bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-1.5 rounded-xl shadow-lg flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 transition active:scale-95 text-center cursor-pointer";
            btn.innerHTML = `<i class="fa-solid fa-check text-xs shrink-0"></i><span class="text-[11px] leading-tight">Sent to ${escapeHtml(recipientName || 'Customer')}!</span>`;
        }
    } catch (e) {
        console.error("Failed to send receipt to customer:", e);
        showToast(`❌ Hindi naipadala ang resibo: ${e.message || 'Network error'}`);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = oldBtnHtml || `<i class="fa-solid fa-paper-plane text-xs shrink-0"></i><span class="text-[11px] leading-tight">Send to Customer</span>`;
        }
    }
}

// Global window registration
if (typeof window !== 'undefined') {
    window.sendReceiptToRecipient = sendReceiptToRecipient;
    window.openReceiptRecipientModal = openReceiptRecipientModal;
    window.closeReceiptRecipientModal = closeReceiptRecipientModal;
    window.filterReceiptRecipients = filterReceiptRecipients;
    window.executeSendReceiptToCustId = executeSendReceiptToCustId;
}

