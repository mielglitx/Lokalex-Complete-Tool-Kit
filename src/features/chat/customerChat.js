// src/features/chat/customerChat.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';

const MAPS_API_KEY = "AIzaSyBVAwn0UnyHJ926oHeK0k789ncADMzmX80";

// --- PAGINATION & INFINITE SCROLL STATE ---
const CUST_CHAT_BATCH_SIZE = 25;
let oldestCustMsgTimestamp = null;
let hasMoreCustMsgs = true;
let isLoadingCustHistory = false;
let loadedCustMsgsMap = new Map();
let custChatListener = null;

// Helper to render checkmarks & seen time tooltips for outgoing customer messages
function renderMessageStatusIndicator(msg) {
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

// IN-CHAT TOAST NOTIFICATION (SHOWN WHEN USER IS VIEWING PREVIOUS MESSAGES)
function showCustInChatToast(container, senderName, previewText) {
    let toast = document.getElementById('cust-inchat-newmsg-toast');
    const parent = container.parentElement;

    if (parent && !parent.classList.contains('relative')) {
        parent.classList.add('relative');
    }

    if (!toast && parent) {
        toast = document.createElement('div');
        toast.id = 'cust-inchat-newmsg-toast';
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

function hideCustInChatToast() {
    const toast = document.getElementById('cust-inchat-newmsg-toast');
    if (toast) toast.classList.add('hidden');
}

export function listenToCustomerRiderChat() {
    if (!db) return;
    const custFbId = appState.customerFacebookId || localStorage.getItem('lokalex_customer_fb_id');
    if (!custFbId) return;

    const container = document.getElementById('cust-rider-chat-messages');
    if (!container) return;

    // Reset Pagination State
    oldestCustMsgTimestamp = null;
    hasMoreCustMsgs = true;
    isLoadingCustHistory = false;
    loadedCustMsgsMap.clear();

    setupCustScrollPagination(container, custFbId);

    if (custChatListener) custChatListener.off();

    // Fetch initial 25 recent messages
    custChatListener = db.ref(`customerChats/${custFbId}/messages`).orderByChild('timestamp').limitToLast(CUST_CHAT_BATCH_SIZE);

    custChatListener.on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            container.innerHTML = `<div class="text-center text-gray-500 italic py-10 text-xs">Pumili o mag-type ng mensahe para sa mga riders...</div>`;
            return;
        }

        const isInitialLoad = loadedCustMsgsMap.size === 0;
        let newRiderMsg = null;

        Object.entries(data).forEach(([key, msg]) => {
            const isNew = !loadedCustMsgsMap.has(key);
            loadedCustMsgsMap.set(key, { id: key, ...msg });

            if (isNew && !isInitialLoad && msg.isRider) {
                newRiderMsg = msg;
            }

            // Automatically mark incoming rider messages as 'seen' when rendered in active customer chat window
            if (msg.isRider && msg.status !== 'seen') {
                db.ref(`customerChats/${custFbId}/messages/${key}`).update({
                    status: 'seen',
                    seenAt: Date.now()
                });
            }
        });

        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;

        renderCustomerMessages(container, isInitialLoad);

        // Handle new message toast if user is viewing previous messages
        if (newRiderMsg && !isInitialLoad) {
            if (!isNearBottom) {
                const preview = newRiderMsg.text || (newRiderMsg.imageUrl ? "📷 Photo" : "📍 Shared Location");
                showCustInChatToast(container, newRiderMsg.sender || "Lokalex Rider", preview);
            } else {
                hideCustInChatToast();
                requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
            }
        }
    });
}

function setupCustScrollPagination(container, custFbId) {
    container.onscroll = () => {
        // Load older history when scrolled near top
        if (container.scrollTop < 50 && !isLoadingCustHistory && hasMoreCustMsgs && oldestCustMsgTimestamp) {
            loadOlderCustMessages(container, custFbId);
        }

        // Hide new message toast when user reaches bottom
        const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;
        if (isNearBottom) {
            hideCustInChatToast();
        }
    };
}

async function loadOlderCustMessages(container, custFbId) {
    if (isLoadingCustHistory || !hasMoreCustMsgs || !oldestCustMsgTimestamp) return;

    isLoadingCustHistory = true;
    showCustTopSpinner(container);

    const oldScrollHeight = container.scrollHeight;

    try {
        const snap = await db.ref(`customerChats/${custFbId}/messages`)
            .orderByChild('timestamp')
            .endAt(oldestCustMsgTimestamp - 1)
            .limitToLast(20)
            .once('value');

        const data = snap.val();
        hideCustTopSpinner();

        if (!data || Object.keys(data).length === 0) {
            hasMoreCustMsgs = false;
            isLoadingCustHistory = false;
            renderCustomerMessages(container, false, oldScrollHeight);
            return;
        }

        const entries = Object.entries(data);
        if (entries.length < 20) {
            hasMoreCustMsgs = false;
        }

        entries.forEach(([key, msg]) => {
            loadedCustMsgsMap.set(key, { id: key, ...msg });
        });

        renderCustomerMessages(container, false, oldScrollHeight);
    } catch (e) {
        console.error("Error loading older customer chat messages:", e);
        hideCustTopSpinner();
    } finally {
        isLoadingCustHistory = false;
    }
}

function showCustTopSpinner(container) {
    let spinner = document.getElementById('cust-chat-history-spinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'cust-chat-history-spinner';
        spinner.className = 'flex items-center justify-center py-2 text-blue-400 text-xs gap-2 font-bold shrink-0';
        spinner.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading older messages...`;
    }
    if (container.firstChild) {
        container.insertBefore(spinner, container.firstChild);
    } else {
        container.appendChild(spinner);
    }
}

function hideCustTopSpinner() {
    const spinner = document.getElementById('cust-chat-history-spinner');
    if (spinner) spinner.remove();
}

function renderCustomerMessages(container, isInitialLoad = false, oldScrollHeight = 0) {
    const msgs = Array.from(loadedCustMsgsMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    if (msgs.length > 0) {
        oldestCustMsgTimestamp = msgs[0].timestamp || null;
    }

    const myAvatar = localStorage.getItem('lokalex_customer_avatar') || `https://ui-avatars.com/api/?name=User&background=0084FF&color=fff`;

    const messagesHtml = msgs.map(m => {
        const isRider = !!m.isRider;
        const alignClass = isRider 
            ? "self-start bg-cardBg border border-gray-700 text-gray-200 rounded-tl-none" 
            : "self-end bg-blue-600 text-white rounded-tr-none";
        const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
        const imgHtml = m.imageUrl ? `<img src="${m.imageUrl}" onclick="window.openImageViewerModal && window.openImageViewerModal('${escapeHtml(m.imageUrl)}', 'customer')" class="w-52 max-w-full rounded-xl mt-1.5 border border-gray-700 shadow cursor-pointer hover:opacity-90 transition">` : '';
        
        const senderName = m.sender || (isRider ? "Lokalex Rider" : "You");
        const senderAvatar = isRider 
            ? `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName)}&background=3B82F6&color=fff`
            : myAvatar;

        const statusIndicator = !isRider ? renderMessageStatusIndicator(m) : '';

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
        <div class="flex items-start gap-1.5 ${isRider ? 'flex-row' : 'flex-row-reverse'} my-0.5">
            <img src="${senderAvatar}" class="w-6 h-6 rounded-full object-cover border border-blue-400/40 shrink-0 mt-1 shadow">
            <div class="max-w-[85%] p-2.5 rounded-2xl flex flex-col gap-0.5 shadow-sm text-xs ${alignClass}">
                <div class="text-[9px] ${isRider ? 'text-blue-400' : 'text-blue-200'} font-bold flex justify-between gap-3">
                    <span>${escapeHtml(senderName)}</span>
                    <div class="flex items-center gap-1 opacity-80 font-mono">
                        <span>${timeStr}</span>
                        ${statusIndicator}
                    </div>
                </div>
                ${(m.text && !imgHtml && !locationHtml) ? `<div class="leading-relaxed whitespace-pre-wrap font-sans break-words">${escapeHtml(m.text)}</div>` : ''}
                ${imgHtml}
                ${locationHtml}
            </div>
        </div>`;
    }).join('');

    let topHeader = '';
    if (!hasMoreCustMsgs) {
        topHeader = `<div class="text-center text-gray-500 text-[10px] py-1.5 italic shrink-0">Beginning of message history</div>`;
    }

    container.innerHTML = topHeader + messagesHtml;

    // SECURE SCROLL POSITION AT BOTTOM ON INITIAL LOAD & NEW MESSAGES
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

export function sendCustomerToRiderChat(customText = "", customImageUrl = null, customLocationCoords = null) {
    const input = document.getElementById('cust-rider-chat-input');
    const text = customText || (input ? input.value.trim() : "");

    if (!text && !customImageUrl && !customLocationCoords) return;

    const custFbId = appState.customerFacebookId || localStorage.getItem('lokalex_customer_fb_id') || `CUST_${Date.now()}`;
    const custName = appState.customerName || localStorage.getItem('lokalex_customer_name') || "Customer";
    const custAvatar = localStorage.getItem('lokalex_customer_avatar') || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=0084FF&color=fff`;
    const now = Date.now();

    const newMsg = {
        sender: custName,
        senderId: custFbId,
        text: text,
        timestamp: now,
        isRider: false,
        status: 'sent',
        deliveredAt: null,
        seenAt: null
    };

    if (customImageUrl) newMsg.imageUrl = customImageUrl;
    if (customLocationCoords) newMsg.locationCoords = customLocationCoords;

    if (db) {
        db.ref(`customerChats/${custFbId}/messages`).push(newMsg);
        db.ref(`customerChats/${custFbId}/metadata`).update({
            lastMessage: text || (customImageUrl ? "📷 Photo" : "📍 Shared Location"),
            lastUpdated: now,
            customerName: custName,
            customerFbId: custFbId,
            avatarUrl: custAvatar,
            folder: 'inbox'
        });
    }

    if (input && !customText) input.value = "";
    showToast("💬 Message sent!");

    hideCustInChatToast();

    // Smooth scroll to bottom on message sent
    const container = document.getElementById('cust-rider-chat-messages');
    if (container) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
        });
    }
}

if (typeof window !== 'undefined') {
    window.listenToCustomerRiderChat = listenToCustomerRiderChat;
    window.sendCustomerToRiderChat = sendCustomerToRiderChat;
}