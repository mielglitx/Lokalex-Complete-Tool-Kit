// src/features/chat/riderChat.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';
import { toggleBodyScroll, populateCateringCustomerDropdown } from './chatUtils.js';
import { openMapPicker } from '../maps.js';

let activeRiderChatCustId = null;
let activeRiderChatListener = null;
let activeRiderChatMetaListener = null;
let currentRiderChatMeta = null;
let activeRiderChatFilter = 'inbox'; // 'inbox', 'catering', 'followup', 'done'
let activeCustData = null;

const MAPS_API_KEY = "AIzaSyBVAwn0UnyHJ926oHeK0k789ncADMzmX80";

// --- PAGINATION & INFINITE SCROLL STATE ---
const RIDER_CHAT_BATCH_SIZE = 25;
let oldestRiderMsgTimestamp = null;
let hasMoreRiderMsgs = true;
let isLoadingRiderHistory = false;
let loadedRiderMsgsMap = new Map();

// Helper to render checkmarks & seen time tooltips for outgoing rider messages
function renderRiderMessageStatusIndicator(msg) {
    const sentTime = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
    const seenTime = msg.seenAt ? new Date(msg.seenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
    
    let iconHtml = '<i class="fa-regular fa-clock text-gray-400" title="Sending..."></i>';
    let titleAttr = `Sent ${sentTime}`;

    if (msg.status === 'sent') {
        iconHtml = '<i class="fa-solid fa-check text-gray-300" title="Sent"></i>';
    } else if (msg.status === 'delivered') {
        iconHtml = '<i class="fa-solid fa-check-double text-gray-300" title="Delivered"></i>';
        titleAttr += ` • Delivered`;
    } else if (msg.status === 'seen') {
        iconHtml = '<i class="fa-solid fa-check-double text-cyan-300" title="Seen"></i>';
        titleAttr += ` • Seen at ${seenTime}`;
    }

    return `<span class="inline-flex items-center gap-1 ml-1 cursor-help" title="${titleAttr}">
        ${iconHtml}
        ${msg.status === 'seen' && seenTime ? `<span class="text-[8px] text-cyan-200 opacity-90 font-mono">Seen ${seenTime}</span>` : ''}
    </span>`;
}

// IN-CHAT TOAST NOTIFICATION (SHOWN WHEN RIDER IS VIEWING PREVIOUS MESSAGES)
function showRiderInChatToast(container, senderName, previewText) {
    let toast = document.getElementById('rider-inchat-newmsg-toast');
    const parent = container.parentElement;

    if (parent && !parent.classList.contains('relative')) {
        parent.classList.add('relative');
    }

    if (!toast && parent) {
        toast = document.createElement('div');
        toast.id = 'rider-inchat-newmsg-toast';
        toast.className = 'absolute bottom-14 left-4 right-4 bg-blue-600/95 backdrop-blur-md text-white text-xs py-2 px-3 rounded-xl shadow-2xl border border-blue-400/60 flex items-center justify-between cursor-pointer z-30 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2';
        parent.appendChild(toast);
    }

    if (toast) {
        toast.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                <i class="fa-solid fa-circle-down text-blue-200 text-sm shrink-0 animate-bounce"></i>
                <span class="truncate font-medium"><strong>${escapeHtml(senderName)}:</strong> ${escapeHtml(previewText)}</span>
            </div>
            <span class="text-[10px] bg-blue-800/80 px-2 py-0.5 rounded-md font-bold uppercase shrink-0">View ↓</span>
        `;

        toast.onclick = () => {
            container.scrollTop = container.scrollHeight;
            toast.classList.add('hidden');
        };

        toast.classList.remove('hidden');
    }
}

function hideRiderInChatToast() {
    const toast = document.getElementById('rider-inchat-newmsg-toast');
    if (toast) toast.classList.add('hidden');
}

export function showCustomerDetails() {
    if (!activeRiderChatCustId) {
        return showToast("⚠️ No active customer thread selected.");
    }

    const modal = document.getElementById('customer-details-modal');
    if (modal && db) {
        db.ref(`customers/${activeRiderChatCustId}`).once('value', (snap) => {
            const data = snap.val() || {};
            activeCustData = data;

            const nameEl = document.getElementById('cust-modal-name');
            const phoneEl = document.getElementById('cust-modal-phone');
            const addrEl = document.getElementById('cust-modal-address');
            const mapEl = document.getElementById('cust-modal-map');

            if (nameEl) nameEl.innerText = data.name || "Customer";
            if (phoneEl) {
                phoneEl.innerText = data.phoneNumber || "N/A";
                phoneEl.href = `tel:${data.phoneNumber || ''}`;
            }
            if (addrEl) addrEl.innerText = data.address || "No address provided.";
            if (mapEl) {
                const mapUrl = data.mapPinLink || (data.lat && data.lng ? `https://www.google.com/maps/search/?api=1&query=${data.lat},${data.lng}` : "#");
                mapEl.href = mapUrl;
            }

            modal.classList.remove('hidden');
            toggleBodyScroll(true);
        });
    }
}

export function closeCustomerDetailsModal() {
    const modal = document.getElementById('customer-details-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
}

export function toggleQuickReplies() {
    document.getElementById('quick-replies-drawer')?.classList.toggle('hidden');
}

export function sendQuickReply(text) {
    if (activeRiderChatCustId) {
        sendRiderToCustomerChat(text);
    } else if (window.sendCustomerToRiderChat && typeof window.sendCustomerToRiderChat === 'function') {
        window.sendCustomerToRiderChat(text);
    }
    toggleQuickReplies();
}

export function markThreadUndone() {
    if (!activeRiderChatCustId) return;

    if (db) {
        db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update({
            folder: 'inbox',
            cateredByRiderId: null,
            cateredByRiderName: null,
            cateredBy: null,
            status: 'active'
        });
    }

    showToast("↩️ Moved thread back to Inbox!");
    closeRiderCustomerChatModal();
}

export function markThreadDone() {
    if (!activeRiderChatCustId) return;

    if (db) {
        db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update({
            cateredByRiderId: null,
            cateredByRiderName: null,
            cateredBy: null,
            folder: 'done'
        });
    }

    if (typeof window.setAvailableStatus === 'function') {
        window.setAvailableStatus();
    }

    document.getElementById('rider-chat-cancel-btn')?.classList.add('hidden');
    showToast("✅ Released lock & moved chat to Done!");
    closeRiderCustomerChatModal();
}

export function markThreadFollowUp() {
    if (!activeRiderChatCustId) return;

    const custName = document.getElementById('rider-chat-cust-name')?.innerText || "";
    const phone = activeCustData?.phoneNumber || "";
    const address = activeCustData?.address || "";

    if (db) {
        db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update({ folder: 'followup' });
    }

    const advModal = document.getElementById('adv-orders-modal');
    if (advModal) {
        advModal.classList.remove('hidden');
        toggleBodyScroll(true);

        if (window.switchAdvTab) window.switchAdvTab('add');

        const nameInput = document.getElementById('adv-cust-name');
        const contactInput = document.getElementById('adv-contact');
        const addrInput = document.getElementById('adv-address');

        if (nameInput) nameInput.value = custName;
        if (contactInput) contactInput.value = phone;
        if (addrInput) addrInput.value = address;
    }

    showToast("📌 Moved chat to Follow Up & loaded Advance Order form!");
}

export function cancelCustomerThread() {
    if (!activeRiderChatCustId) return;

    if (db) {
        db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update({
            cateredByRiderId: null,
            cateredByRiderName: null,
            cateredBy: null,
            folder: 'done',
            status: 'cancelled'
        });
    }

    if (typeof window.setAvailableStatus === 'function') {
        window.setAvailableStatus();
    }

    document.getElementById('rider-chat-cancel-btn')?.classList.add('hidden');
    showToast("🚫 Catering cancelled & released!");
    closeRiderCustomerChatModal();
}

export const undoCustomerThread = markThreadUndone;
export const followUpCustomerOrder = markThreadFollowUp;
export const completeCatering = markThreadDone;
export const cancelCatering = cancelCustomerThread;

export function setRiderChatFilter(filterMode) {
    activeRiderChatFilter = filterMode;

    ['inbox', 'catering', 'followup', 'done'].forEach(f => {
        const btn = document.getElementById(`rider-chat-tab-${f}`);
        if (btn) {
            btn.className = (f === filterMode) 
                ? "flex-1 py-1 rounded-lg bg-blue-600 text-white font-bold text-[10px] transition shadow"
                : "flex-1 py-1 rounded-lg text-gray-400 font-bold text-[10px] hover:text-white transition";
        }
    });

    listenToAllCustomerChatsForRider();
}

export function listenToAllCustomerChatsForRider() {
    if (!db) return;

    db.ref('customerChats').on('value', (snapshot) => {
        const data = snapshot.val();
        const feed = document.getElementById('rider-cust-chats-feed');
        const badge = document.getElementById('rider-cust-chats-badge');

        if (!feed) return;

        if (!data) {
            feed.innerHTML = `<div class="text-gray-500 italic text-center py-4 text-xs">No active customer messages yet.</div>`;
            if (badge) badge.innerText = "0 threads";
            return;
        }

        let threads = Object.keys(data).map(key => {
            const item = data[key];
            const meta = item.metadata || {};
            return {
                custId: key,
                customerName: meta.customerName || "Customer",
                avatarUrl: meta.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(meta.customerName || "Customer")}&background=0084FF&color=fff`,
                lastMessage: meta.lastMessage || "No messages yet",
                lastUpdated: meta.lastUpdated || 0,
                folder: meta.folder || 'inbox',
                cateredByRiderId: meta.cateredByRiderId || null,
                cateredByRiderName: meta.cateredByRiderName || meta.cateredBy || null,
                status: meta.status || 'active',
                messages: item.messages ? Object.values(item.messages) : []
            };
        });

        threads = threads.filter(t => {
            if (activeRiderChatFilter === 'inbox') return (!t.folder || t.folder === 'inbox') && !t.cateredByRiderName;
            if (activeRiderChatFilter === 'catering') return t.folder === 'catering' || !!t.cateredByRiderName;
            if (activeRiderChatFilter === 'followup') return t.folder === 'followup';
            if (activeRiderChatFilter === 'done') return t.folder === 'done';
            return true;
        });

        threads.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));

        if (badge) badge.innerText = `${threads.length} ${threads.length === 1 ? 'thread' : 'threads'}`;

        if (threads.length === 0) {
            feed.innerHTML = `<div class="text-gray-500 italic text-center py-4 text-xs">No ${activeRiderChatFilter} threads found.</div>`;
            return;
        }

        feed.innerHTML = threads.map(t => {
            const timeStr = t.lastUpdated ? new Date(t.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
            const statusBadge = t.cateredByRiderName 
                ? `<span class="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"><i class="fa-solid fa-motorcycle"></i> ${escapeHtml(t.cateredByRiderName)}</span>`
                : "";

            return `
            <div onclick="openRiderCustomerChatModal('${t.custId}', '${escapeHtml(t.customerName)}', '${escapeHtml(t.avatarUrl)}')" class="bg-black/30 hover:bg-black/50 border border-gray-800 p-2.5 rounded-xl flex items-center justify-between cursor-pointer transition active:scale-[0.99]">
                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    <img src="${t.avatarUrl}" class="w-9 h-9 rounded-full object-cover border border-blue-500 shrink-0">
                    <div class="min-w-0 flex-1">
                        <div class="font-bold text-white text-xs truncate flex items-center gap-1.5">
                            <span class="truncate">${escapeHtml(t.customerName)}</span>
                            ${statusBadge}
                        </div>
                        <div class="text-[11px] text-gray-400 truncate mt-0.5">${escapeHtml(t.lastMessage)}</div>
                    </div>
                </div>
                <div class="text-[9px] text-gray-500 font-mono shrink-0 ml-2">${timeStr}</div>
            </div>`;
        }).join('');

        if (typeof populateCateringCustomerDropdown === 'function') {
            populateCateringCustomerDropdown();
        }
    });
}

export function openRiderChatModal(custId, custName) {
    openRiderCustomerChatModal(custId, custName);
}

export function openRiderCustomerChatModal(custId, custName, avatarUrl) {
    activeRiderChatCustId = custId;

    const modal = document.getElementById('rider-customer-chat-modal') || document.getElementById('rider-chat-modal');
    const nameEl = document.getElementById('rider-chat-cust-name');
    const avatarEl = document.getElementById('rider-chat-cust-avatar') || document.getElementById('rider-chat-avatar');

    const resolvedAvatar = avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName || "Customer")}&background=0084FF&color=fff`;

    if (nameEl) nameEl.innerText = custName || "Customer";
    if (avatarEl) {
        if (avatarEl.tagName === 'IMG') {
            avatarEl.src = resolvedAvatar;
        } else {
            avatarEl.innerText = (custName || "CU").split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        }
    }

    if (modal) {
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
    }

    if (activeRiderChatListener) activeRiderChatListener.off();
    if (activeRiderChatMetaListener) activeRiderChatMetaListener.off();

    if (db && custId) {
        db.ref(`customers/${custId}`).once('value', (snap) => {
            activeCustData = snap.val() || {};
        });

        activeRiderChatMetaListener = db.ref(`customerChats/${custId}/metadata`);
        activeRiderChatMetaListener.on('value', (snapshot) => {
            currentRiderChatMeta = snapshot.val() || {};
            evaluateRiderChatLockPermissions();
        });

        listenToRiderChatMessages(custId);
    }
}

export function listenToRiderChatMessages(custId) {
    if (!db || !custId) return;

    const container = document.getElementById('rider-cust-chat-messages') || document.getElementById('rider-chat-messages-container');
    if (!container) return;

    // Reset Pagination State
    oldestRiderMsgTimestamp = null;
    hasMoreRiderMsgs = true;
    isLoadingRiderHistory = false;
    loadedRiderMsgsMap.clear();

    setupRiderScrollPagination(container, custId);

    activeRiderChatListener = db.ref(`customerChats/${custId}/messages`).orderByChild('timestamp').limitToLast(RIDER_CHAT_BATCH_SIZE);

    activeRiderChatListener.on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            container.innerHTML = `<div class="text-center text-gray-500 italic py-10 text-xs">No messages yet.</div>`;
            return;
        }

        const isInitialLoad = loadedRiderMsgsMap.size === 0;
        let newCustMsg = null;

        Object.entries(data).forEach(([key, msg]) => {
            const isNew = !loadedRiderMsgsMap.has(key);
            loadedRiderMsgsMap.set(key, { id: key, ...msg });

            if (isNew && !isInitialLoad && !msg.isRider) {
                newCustMsg = msg;
            }

            // Automatically mark incoming customer messages as 'seen' when viewed by rider in chat modal
            if (!msg.isRider && msg.status !== 'seen') {
                db.ref(`customerChats/${custId}/messages/${key}`).update({
                    status: 'seen',
                    seenAt: Date.now()
                });
            }
        });

        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;

        renderRiderMessages(container, isInitialLoad);

        // Handle new message toast if rider is viewing previous messages
        if (newCustMsg && !isInitialLoad) {
            const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";
            if (!isNearBottom) {
                const preview = newCustMsg.text || (newCustMsg.imageUrl ? "📷 Photo" : "📍 Location");
                showRiderInChatToast(container, newCustMsg.sender || custName, preview);
            } else {
                hideRiderInChatToast();
                requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
            }
        }
    });
}

function setupRiderScrollPagination(container, custId) {
    container.onscroll = () => {
        if (container.scrollTop < 50 && !isLoadingRiderHistory && hasMoreRiderMsgs && oldestRiderMsgTimestamp) {
            loadOlderRiderMessages(container, custId);
        }

        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
        if (isNearBottom) {
            hideRiderInChatToast();
        }
    };
}

async function loadOlderRiderMessages(container, custId) {
    if (isLoadingRiderHistory || !hasMoreRiderMsgs || !oldestRiderMsgTimestamp) return;

    isLoadingRiderHistory = true;
    showRiderTopSpinner(container);

    const oldScrollHeight = container.scrollHeight;

    try {
        const snap = await db.ref(`customerChats/${custId}/messages`)
            .orderByChild('timestamp')
            .endAt(oldestRiderMsgTimestamp - 1)
            .limitToLast(20)
            .once('value');

        const data = snap.val();
        hideRiderTopSpinner();

        if (!data || Object.keys(data).length === 0) {
            hasMoreRiderMsgs = false;
            isLoadingRiderHistory = false;
            renderRiderMessages(container, false, oldScrollHeight);
            return;
        }

        const entries = Object.entries(data);
        if (entries.length < 20) {
            hasMoreRiderMsgs = false;
        }

        entries.forEach(([key, msg]) => {
            loadedRiderMsgsMap.set(key, { id: key, ...msg });
        });

        renderRiderMessages(container, false, oldScrollHeight);
    } catch (e) {
        console.error("Error loading older rider chat messages:", e);
        hideRiderTopSpinner();
    } finally {
        isLoadingRiderHistory = false;
    }
}

function showRiderTopSpinner(container) {
    let spinner = document.getElementById('rider-chat-history-spinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'rider-chat-history-spinner';
        spinner.className = 'flex items-center justify-center py-2 text-blue-400 text-xs gap-2 font-bold shrink-0';
        spinner.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading older messages...`;
    }
    if (container.firstChild) {
        container.insertBefore(spinner, container.firstChild);
    } else {
        container.appendChild(spinner);
    }
}

function hideRiderTopSpinner() {
    const spinner = document.getElementById('rider-chat-history-spinner');
    if (spinner) spinner.remove();
}

function renderRiderMessages(container, isInitialLoad = false, oldScrollHeight = 0) {
    const msgs = Array.from(loadedRiderMsgsMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    if (msgs.length > 0) {
        oldestRiderMsgTimestamp = msgs[0].timestamp || null;
    }

    const riderName = appState.riderName || "Rider";
    const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";
    const custAvatar = activeCustData?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=0084FF&color=fff`;
    const riderAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(riderName)}&background=3B82F6&color=fff`;

    const messagesHtml = msgs.map(m => {
        const isRider = !!m.isRider || m.senderType === 'rider';
        const alignClass = isRider 
            ? "self-end bg-blue-600 text-white rounded-tr-none" 
            : "self-start bg-cardBg border border-gray-700 text-gray-200 rounded-tl-none";
        const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";

        const senderName = m.sender || (isRider ? riderName : custName);
        const senderAvatar = isRider ? riderAvatar : custAvatar;
        const statusIndicator = isRider ? renderRiderMessageStatusIndicator(m) : '';

        const imgHtml = m.imageUrl || (m.type === 'image' ? m.text : null);
        const imageMarkup = imgHtml ? `<img src="${imgHtml}" onclick="window.openImageViewerModal && window.openImageViewerModal('${escapeHtml(imgHtml)}', 'rider')" class="w-52 max-w-full rounded-xl mt-1.5 border border-gray-700 shadow cursor-pointer hover:opacity-90 transition">` : '';
        
        let locationHtml = "";
        let lat = null;
        let lng = null;

        if (m.locationCoords && m.locationCoords.lat && m.locationCoords.lng) {
            lat = m.locationCoords.lat;
            lng = m.locationCoords.lng;
        } else if (m.type === 'location' && m.text) {
            const match = m.text.match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (match) {
                lat = match[1];
                lng = match[2];
            }
        }

        if (lat && lng) {
            const mapUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
            const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&size=400x200&maptype=roadmap&markers=color:red%7C${lat},${lng}&key=${MAPS_API_KEY}`;

            locationHtml = `
            <div class="mt-1.5 flex flex-col gap-1 rounded-xl overflow-hidden border border-emerald-500/40 bg-black/40 p-1">
                <a href="${mapUrl}" target="_blank" class="block relative group overflow-hidden rounded-lg">
                    <img src="${staticMapUrl}" alt="Map Location Preview" class="w-full h-32 object-cover rounded-lg group-hover:scale-105 transition-transform duration-200">
                    <div class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <span class="bg-black/80 text-white text-[10px] font-bold px-2 py-1 rounded-md"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open in Maps</span>
                    </div>
                </a>
                <a href="${mapUrl}" target="_blank" class="bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 font-bold px-2.5 py-1.5 rounded-lg text-[11px] flex items-center justify-center gap-1.5 active:scale-95 transition">
                    <i class="fa-solid fa-map-location-dot text-red-400"></i> View Shared Location
                </a>
            </div>`;
        }

        return `
        <div class="flex items-start gap-1.5 ${isRider ? 'flex-row-reverse' : 'flex-row'} my-0.5">
            <img src="${senderAvatar}" class="w-6 h-6 rounded-full object-cover border border-blue-400/40 shrink-0 mt-1 shadow">
            <div class="max-w-[85%] p-2.5 rounded-2xl flex flex-col gap-0.5 shadow-sm text-xs ${alignClass}">
                <div class="text-[9px] ${isRider ? 'text-blue-200' : 'text-blue-400'} font-bold flex justify-between gap-3">
                    <span>${escapeHtml(senderName)}</span>
                    <div class="flex items-center gap-1 opacity-80 font-mono">
                        <span>${timeStr}</span>
                        ${statusIndicator}
                    </div>
                </div>
                ${(m.text && !imgHtml && !locationHtml) ? `<div class="leading-relaxed whitespace-pre-wrap font-sans break-words">${escapeHtml(m.text)}</div>` : ''}
                ${imageMarkup}
                ${locationHtml}
            </div>
        </div>`;
    }).join('');

    let topHeader = '';
    if (!hasMoreRiderMsgs) {
        topHeader = `<div class="text-center text-gray-500 text-[10px] py-1.5 italic shrink-0">Beginning of message history</div>`;
    }

    container.innerHTML = topHeader + messagesHtml;

    if (isInitialLoad) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 80);
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 250);
        });
    } else if (oldScrollHeight > 0) {
        const newScrollHeight = container.scrollHeight;
        container.scrollTop = newScrollHeight - oldScrollHeight;
    }
}

// EVALUATE LOCK PERMISSIONS WITH ADMIN CONTROLS BYPASS
function evaluateRiderChatLockPermissions() {
    const lockBanner = document.getElementById('rider-chat-lock-banner');
    const inputEl = document.getElementById('rider-cust-chat-input') || document.getElementById('rider-chat-input');
    const sendBtn = document.getElementById('rider-cust-send-btn');
    const actionToolbar = document.getElementById('rider-chat-action-toolbar');

    if (!currentRiderChatMeta) return;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    const cateredRiderId = (currentRiderChatMeta.cateredByRiderId || "").toString().trim();
    const cateredRiderName = (currentRiderChatMeta.cateredByRiderName || currentRiderChatMeta.cateredBy || "").toString().trim().toLowerCase();

    const isCateringRider = (cateredRiderId && cateredRiderId === myId) || (cateredRiderName && cateredRiderName === myName);
    
    // Check Admin Access + Admin Controls Toggle Enabled
    const isAdmin = typeof window.isAdmin === 'function' ? window.isAdmin() : false;
    const canManage = typeof window.canManageRoster === 'function' ? window.canManageRoster() : false;
    const adminControlsActive = globalState.adminControlsEnabled && (isAdmin || canManage);

    const isLocked = (cateredRiderId || cateredRiderName) && !isCateringRider && !adminControlsActive;

    if (isLocked) {
        if (lockBanner) {
            lockBanner.classList.remove('hidden');
            lockBanner.innerHTML = `🔒 Being catered by <strong>${escapeHtml(currentRiderChatMeta.cateredByRiderName || currentRiderChatMeta.cateredBy)}</strong>. View only mode.`;
        }
        if (inputEl) inputEl.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        if (actionToolbar) actionToolbar.classList.add('opacity-50', 'pointer-events-none');
    } else {
        if (lockBanner) {
            if (isCateringRider) {
                lockBanner.classList.remove('hidden');
                lockBanner.innerHTML = `🛵 You are currently catering this customer.`;
            } else if (adminControlsActive && (cateredRiderId || cateredRiderName)) {
                lockBanner.classList.remove('hidden');
                lockBanner.innerHTML = `⚡ Admin Controls Enabled — Replying as Admin (Catered by ${escapeHtml(currentRiderChatMeta.cateredByRiderName || currentRiderChatMeta.cateredBy)}).`;
            } else {
                lockBanner.classList.add('hidden');
            }
        }
        if (inputEl) inputEl.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        if (actionToolbar) actionToolbar.classList.remove('opacity-50', 'pointer-events-none');
    }
}

export function closeRiderChatModal() {
    closeRiderCustomerChatModal();
}

export function closeRiderCustomerChatModal() {
    const modal = document.getElementById('rider-customer-chat-modal') || document.getElementById('rider-chat-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }

    if (activeRiderChatListener) {
        activeRiderChatListener.off();
        activeRiderChatListener = null;
    }
    if (activeRiderChatMetaListener) {
        activeRiderChatMetaListener.off();
        activeRiderChatMetaListener = null;
    }
    activeRiderChatCustId = null;
    currentRiderChatMeta = null;

    oldestRiderMsgTimestamp = null;
    hasMoreRiderMsgs = true;
    isLoadingRiderHistory = false;
    loadedRiderMsgsMap.clear();
}

export function sendRiderChatMessage(content = null, type = 'text') {
    sendRiderToCustomerChat(content, type === 'image' ? content : null);
}

export function sendRiderToCustomerChat(customText = "", customImageUrl = null, customLocationCoords = null) {
    const input = document.getElementById('rider-cust-chat-input') || document.getElementById('rider-chat-input');
    const text = customText || (input ? input.value.trim() : "");

    if ((!text && !customImageUrl && !customLocationCoords) || !activeRiderChatCustId) return;

    const riderName = appState.riderName || "Lokalex Rider";
    const now = Date.now();

    const newMsg = {
        sender: riderName,
        senderType: 'rider',
        text: text,
        timestamp: now,
        isRider: true,
        status: 'sent',
        deliveredAt: null,
        seenAt: null
    };

    if (customImageUrl) {
        newMsg.imageUrl = customImageUrl;
        newMsg.type = 'image';
    }
    if (customLocationCoords) {
        newMsg.locationCoords = customLocationCoords;
        newMsg.type = 'location';
    }

    if (db) {
        db.ref(`customerChats/${activeRiderChatCustId}/messages`).push(newMsg);
        db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update({
            lastMessage: `You: ${text || (customImageUrl ? "📷 Photo" : "📍 Location")}`,
            lastUpdated: now
        });
    }

    if (input && !customText) input.value = "";

    hideRiderInChatToast();

    // Smooth scroll to bottom on message sent
    const container = document.getElementById('rider-cust-chat-messages') || document.getElementById('rider-chat-messages-container');
    if (container) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
        });
    }
}

export function sendChatLocationPin() {
    sendRiderLocation();
}

export function sendRiderLocation() {
    openMapPicker('rider-chat');
}

if (typeof window !== 'undefined') {
    window.showCustomerDetails = showCustomerDetails;
    window.closeCustomerDetailsModal = closeCustomerDetailsModal;
    window.toggleQuickReplies = toggleQuickReplies;
    window.sendQuickReply = sendQuickReply;
    window.markThreadUndone = markThreadUndone;
    window.markThreadDone = markThreadDone;
    window.markThreadFollowUp = markThreadFollowUp;
    window.cancelCustomerThread = cancelCustomerThread;
    window.undoCustomerThread = undoCustomerThread;
    window.followUpCustomerOrder = followUpCustomerOrder;
    window.completeCatering = completeCatering;
    window.cancelCatering = cancelCatering;
    window.setRiderChatFilter = setRiderChatFilter;
    window.listenToAllCustomerChatsForRider = listenToAllCustomerChatsForRider;
    window.openRiderChatModal = openRiderChatModal;
    window.openRiderCustomerChatModal = openRiderCustomerChatModal;
    window.closeRiderChatModal = closeRiderChatModal;
    window.closeRiderCustomerChatModal = closeRiderCustomerChatModal;
    window.sendRiderChatMessage = sendRiderChatMessage;
    window.sendRiderToCustomerChat = sendRiderToCustomerChat;
    window.sendChatLocationPin = sendChatLocationPin;
    window.sendRiderLocation = sendRiderLocation;
}