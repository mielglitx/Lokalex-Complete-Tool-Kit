// src/features/chat.js
import { db } from '../config/firebase.js';
import { appState, globalState } from '../store/state.js';
import { showToast } from '../ui/notifications.js';
import { escapeHtml } from '../utils/helpers.js';
import { calibrateGPS } from './auth.js';
import { canManageRoster, isAdmin } from './roster.js';

let isChatOpen = false;
let unreadChatCount = 0;
let lastKnownChatMsgCount = 0;

let activeRiderChatCustId = null;
let activeRiderChatListener = null;
let activeRiderChatMetaListener = null;
let currentRiderChatMeta = null;
let activeRiderChatFilter = 'inbox'; // 'inbox', 'followup', 'done'

// Image Viewer Modal State
let currentViewerImageUrl = null;
let currentViewerTargetType = 'customer';
let viewerZoomScale = 1;
let isViewerPinchInitialized = false;

// Image Editor Canvas Variables
const BRUSH_PRESETS = [
    { name: 'S', lineWidth: 3, dotSize: 6 },
    { name: 'M', lineWidth: 7, dotSize: 12 },
    { name: 'L', lineWidth: 14, dotSize: 18 },
    { name: 'XL', lineWidth: 22, dotSize: 24 }
];
let currentBrushIndex = 0; // Default Small
let currentEditorColor = '#ef4444'; // Default Red

let editorBaseImage = null;
let editorDrawingCanvas = null;
let editorDrawingCtx = null;
let editorTargetType = 'customer'; // 'customer', 'rider', or 'team'
let isDrawingOnCanvas = false;
let isDraggingText = false;
let selectedTextIndex = -1;
let textDragOffsetX = 0;
let textDragOffsetY = 0;
let lastCanvasX = 0;
let lastCanvasY = 0;
let editorTextOverlays = [];

// Touch gesture tracking for text pinch & rotate
let initialPinchDistance = 0;
let initialPinchFontSize = 24;
let initialPinchAngle = 0;
let initialTextRotation = 0;

// ============================================================================
// 1. TEAM COMMS CHAT WIDGET
// ============================================================================
export function initDraggableChat() {
    const bubble = document.getElementById('chat-bubble');
    const container = document.getElementById('floating-chat-container');

    if (!bubble || !container) return;

    let isPointerDown = false;
    let isDragging = false;
    let startY = 0;
    let initialTop = 0;
    let touchStartTime = 0;

    const onStart = (e) => {
        isPointerDown = true;
        isDragging = false;
        touchStartTime = Date.now();
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        const rect = container.getBoundingClientRect();
        initialTop = rect.top;
    };

    const onMove = (e) => {
        if (!isPointerDown) return;

        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const deltaY = clientY - startY;

        if (Math.abs(deltaY) > 10) {
            isDragging = true;
            let newTop = initialTop + deltaY;
            const maxTop = window.innerHeight - 80;
            newTop = Math.max(60, Math.min(newTop, maxTop));
            container.style.top = `${newTop}px`;
        }
    };

    const onEnd = () => {
        if (!isPointerDown) return;
        isPointerDown = false;

        const elapsedTime = Date.now() - touchStartTime;

        if (!isDragging || elapsedTime < 250) {
            toggleChatWindow(!isChatOpen);
        }
        isDragging = false;
    };

    bubble.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);

    bubble.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);

    listenToFirebaseChat();
}

export function toggleChatWindow(show) {
    isChatOpen = show;
    const windowEl = document.getElementById('expanded-chat-window');
    const unreadBadge = document.getElementById('chat-unread-badge');

    if (windowEl) {
        if (show) {
            windowEl.classList.remove('hidden');
            unreadChatCount = 0;
            if (unreadBadge) unreadBadge.classList.add('hidden');
            scrollChatToBottom();
        } else {
            windowEl.classList.add('hidden');
        }
    }
}

export function listenToFirebaseChat() {
    if (!db) return;

    db.ref('chat').on('value', (snapshot) => {
        const data = snapshot.val();
        let msgs = [];
        if (data) {
            msgs = Object.keys(data).map(key => ({
                id: key,
                ...data[key]
            }));
            msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        }

        globalState.chatMessages = msgs;

        if (lastKnownChatMsgCount > 0 && msgs.length > lastKnownChatMsgCount && !isChatOpen) {
            unreadChatCount += (msgs.length - lastKnownChatMsgCount);
            const unreadBadge = document.getElementById('chat-unread-badge');
            if (unreadBadge) {
                unreadBadge.innerText = unreadChatCount;
                unreadBadge.classList.remove('hidden');
            }
        }
        lastKnownChatMsgCount = msgs.length;

        renderBubbleChatMessages(msgs);
    });
}

export function renderBubbleChatMessages(msgs) {
    const container = document.getElementById('bubble-chat-messages');
    if (!container) return;

    if (!msgs || msgs.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-10 text-xs">No team messages yet.</div>`;
        return;
    }

    const myName = (appState.riderName || "").trim();

    container.innerHTML = msgs.map(m => {
        const isMe = (m.sender || "").trim().toLowerCase() === myName.toLowerCase();
        const alignClass = isMe ? "self-end bg-blue-600 text-white rounded-br-none" : "self-start bg-cardBg border border-gray-700 text-gray-200 rounded-bl-none";
        
        let timeStr = "";
        if (m.timestamp) {
            timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        const imageMarkup = m.imageUrl ? `<img src="${m.imageUrl}" onclick="window.openImageViewerModal && window.openImageViewerModal('${escapeHtml(m.imageUrl)}', 'team')" class="w-44 max-w-full rounded-xl mt-1 border border-gray-700 shadow-md cursor-pointer hover:opacity-90 transition">` : '';
        const isEveryoneTagged = m.text && m.text.includes('@everyone');
        const tagHighlight = isEveryoneTagged ? 'ring-2 ring-amber-400 bg-amber-500/20 p-1 rounded-lg' : '';

        return `
        <div class="max-w-[85%] p-2.5 rounded-2xl flex flex-col gap-0.5 shadow-sm text-xs ${alignClass} ${tagHighlight}">
            <div class="text-[9px] ${isMe ? 'text-blue-200' : 'text-blue-400'} font-bold flex justify-between gap-3">
                <span>${escapeHtml(m.sender || "Rider")}</span>
                <span class="opacity-60 font-mono">${timeStr}</span>
            </div>
            <div class="leading-relaxed whitespace-pre-wrap font-sans">${escapeHtml(m.text)}</div>
            ${imageMarkup}
        </div>`;
    }).join('');

    scrollChatToBottom();
}

export function scrollChatToBottom() {
    const container = document.getElementById('bubble-chat-messages');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

export function sendBubbleChatMessage() {
    const input = document.getElementById('bubble-chat-input');
    const text = input ? input.value.trim() : "";

    if (!text) return;

    const senderName = appState.riderName || "Lokalex Rider";
    const isEveryoneTagged = text.includes('@everyone');

    const newMsg = {
        sender: senderName,
        text: text,
        timestamp: Date.now(),
        isEveryoneTagged: isEveryoneTagged
    };

    if (db) {
        db.ref('chat').push(newMsg);
    }

    if (input) input.value = "";

    if (isEveryoneTagged) {
        showToast("📢 Tagged @everyone in Team Comms!");
    }
}

export function triggerTeamChatImage() {
    const input = document.getElementById('team-chat-image-input');
    if (input) input.click();
}

export function handleTeamChatImageFile(event) {
    const file = event.target?.files?.[0];
    if (!file) return;

    showToast("📸 Processing photo...");

    const reader = new FileReader();
    reader.onload = (e) => {
        const imageDataUrl = e.target.result;
        const senderName = appState.riderName || "Lokalex Rider";

        const newMsg = {
            sender: senderName,
            text: "📷 [Shared Image]",
            imageUrl: imageDataUrl,
            timestamp: Date.now()
        };

        if (db) {
            db.ref('chat').push(newMsg);
        }

        showToast("✅ Image sent to Team Comms!");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
}

export function handleChatInput(inputEl) {}

// ============================================================================
// 2. CUSTOMER-SIDE REAL-TIME CHAT WITH RIDERS
// ============================================================================
export function listenToCustomerRiderChat() {
    if (!db) return;

    const custFbId = appState.customerFacebookId || localStorage.getItem('lokalex_customer_fb_id');
    if (!custFbId) return;

    const chatRef = db.ref(`customerChats/${custFbId}/messages`);
    chatRef.off();

    chatRef.on('value', (snapshot) => {
        const data = snapshot.val();
        const container = document.getElementById('cust-rider-chat-messages');
        if (!container) return;

        if (!data) {
            container.innerHTML = `<div class="text-center text-gray-500 italic py-10 text-xs">Pumili o mag-type ng mensahe para sa mga riders...</div>`;
            return;
        }

        const msgs = Object.values(data);
        msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        container.innerHTML = msgs.map(m => {
            const isRider = !!m.isRider;
            const alignClass = isRider 
                ? "self-start bg-cardBg border border-gray-700 text-gray-200 rounded-tl-none" 
                : "self-end bg-blue-600 text-white rounded-tr-none";

            let timeStr = "";
            if (m.timestamp) {
                timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }

            const imgHtml = m.imageUrl ? `<img src="${m.imageUrl}" onclick="window.openImageViewerModal && window.openImageViewerModal('${escapeHtml(m.imageUrl)}', 'customer')" class="w-52 max-w-full rounded-xl mt-1.5 border border-gray-700 shadow cursor-pointer hover:opacity-90 transition">` : '';
            
            let locationHtml = "";
            if (m.locationCoords) {
                const mapUrl = `https://www.google.com/maps/search/?api=1&query=${m.locationCoords.lat},${m.locationCoords.lng}`;
                locationHtml = `<a href="${mapUrl}" target="_blank" class="mt-1 bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 font-bold px-2.5 py-1.5 rounded-lg text-[11px] flex items-center gap-1.5 active:scale-95 transition">
                    <i class="fa-solid fa-map-location-dot text-red-400"></i> View Shared Location
                </a>`;
            }

            return `
            <div class="max-w-[85%] p-2.5 rounded-2xl flex flex-col gap-0.5 shadow-sm text-xs ${alignClass}">
                <div class="text-[9px] ${isRider ? 'text-blue-400' : 'text-blue-200'} font-bold flex justify-between gap-3">
                    <span>${escapeHtml(m.sender || (isRider ? "Lokalex Rider" : "You"))}</span>
                    <span class="opacity-60 font-mono">${timeStr}</span>
                </div>
                ${m.text ? `<div class="leading-relaxed whitespace-pre-wrap font-sans break-words">${escapeHtml(m.text)}</div>` : ''}
                ${imgHtml}
                ${locationHtml}
            </div>`;
        }).join('');

        container.scrollTop = container.scrollHeight;
    });
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
        isRider: false
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
}

export async function sendCustomerLocation() {
    showToast("📡 Calibrating GPS location...");
    const coords = await calibrateGPS();
    if (!coords || (coords.lat === 0 && coords.lon === 0)) {
        return showToast("⚠️ Weak GPS Signal. Turn on Location Services.");
    }

    sendCustomerToRiderChat("📍 Shared Exact Location", null, { lat: coords.lat, lng: coords.lon });
    showToast("📍 Location shared with riders!");
}

// ============================================================================
// 3. RIDER-SIDE CUSTOMER CHAT FEED, FILTERS & DIRECT REPLY MODAL
// ============================================================================
export function setRiderChatFilter(filterMode) {
    activeRiderChatFilter = filterMode;

    ['inbox', 'followup', 'done'].forEach(f => {
        const btn = document.getElementById(`rider-chat-tab-${f}`);
        if (btn) {
            if (f === filterMode) {
                btn.className = "flex-1 py-1 rounded-lg bg-blue-600 text-white font-bold text-[10px] transition shadow";
            } else {
                btn.className = "flex-1 py-1 rounded-lg text-gray-400 font-bold text-[10px] hover:text-white transition";
            }
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
                cateredByRiderName: meta.cateredByRiderName || null,
                status: meta.status || 'active',
                messages: item.messages ? Object.values(item.messages) : []
            };
        });

        threads = threads.filter(t => {
            if (activeRiderChatFilter === 'inbox') return !t.folder || t.folder === 'inbox';
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
            let timeStr = "";
            if (t.lastUpdated) {
                timeStr = new Date(t.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }

            let statusBadge = "";
            if (t.cateredByRiderName) {
                statusBadge = `<span class="bg-purple-600/30 text-purple-300 border border-purple-500/40 text-[9px] font-bold px-1.5 py-0.5 rounded">🛵 ${escapeHtml(t.cateredByRiderName)}</span>`;
            }

            return `
            <div onclick="openRiderCustomerChatModal('${t.custId}', '${escapeHtml(t.customerName)}', '${escapeHtml(t.avatarUrl)}')" class="bg-black/30 hover:bg-black/50 border border-gray-800 p-2.5 rounded-xl flex items-center justify-between cursor-pointer transition active:scale-[0.99]">
                <div class="flex items-center gap-2.5 min-w-0">
                    <img src="${t.avatarUrl}" class="w-9 h-9 rounded-full object-cover border border-blue-500 shrink-0">
                    <div class="min-w-0">
                        <div class="font-bold text-white text-xs truncate flex items-center gap-1.5">
                            <span>${escapeHtml(t.customerName)}</span>
                            ${statusBadge}
                        </div>
                        <div class="text-[11px] text-gray-400 truncate">${escapeHtml(t.lastMessage)}</div>
                    </div>
                </div>
                <div class="text-[9px] text-gray-500 font-mono shrink-0 ml-2">${timeStr}</div>
            </div>`;
        }).join('');
    });
}

export function openRiderCustomerChatModal(custId, custName, avatarUrl) {
    activeRiderChatCustId = custId;

    const modal = document.getElementById('rider-customer-chat-modal');
    const nameEl = document.getElementById('rider-chat-cust-name');
    const avatarEl = document.getElementById('rider-chat-cust-avatar');

    if (nameEl) nameEl.innerText = custName || "Customer";
    if (avatarEl) avatarEl.src = avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=0084FF&color=fff`;

    if (modal) modal.classList.remove('hidden');

    if (activeRiderChatListener) activeRiderChatListener.off();
    if (activeRiderChatMetaListener) activeRiderChatMetaListener.off();

    if (db && custId) {
        activeRiderChatMetaListener = db.ref(`customerChats/${custId}/metadata`);
        activeRiderChatMetaListener.on('value', (snapshot) => {
            currentRiderChatMeta = snapshot.val() || {};
            evaluateRiderChatLockPermissions();
        });

        activeRiderChatListener = db.ref(`customerChats/${custId}/messages`);
        activeRiderChatListener.on('value', (snapshot) => {
            const data = snapshot.val();
            const container = document.getElementById('rider-cust-chat-messages');
            if (!container) return;

            if (!data) {
                container.innerHTML = `<div class="text-center text-gray-500 italic py-10 text-xs">No messages yet.</div>`;
                return;
            }

            const msgs = Object.values(data);
            msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

            const riderName = appState.riderName || "Rider";

            container.innerHTML = msgs.map(m => {
                const isRider = !!m.isRider;
                const alignClass = isRider 
                    ? "self-end bg-blue-600 text-white rounded-tr-none" 
                    : "self-start bg-cardBg border border-gray-700 text-gray-200 rounded-tl-none";

                let timeStr = "";
                if (m.timestamp) {
                    timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }

                const imgHtml = m.imageUrl ? `<img src="${m.imageUrl}" onclick="window.openImageViewerModal && window.openImageViewerModal('${escapeHtml(m.imageUrl)}', 'rider')" class="w-52 max-w-full rounded-xl mt-1.5 border border-gray-700 shadow cursor-pointer hover:opacity-90 transition">` : '';
                
                let locationHtml = "";
                if (m.locationCoords) {
                    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${m.locationCoords.lat},${m.locationCoords.lng}`;
                    locationHtml = `<a href="${mapUrl}" target="_blank" class="mt-1 bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 font-bold px-2.5 py-1.5 rounded-lg text-[11px] flex items-center gap-1.5 active:scale-95 transition">
                        <i class="fa-solid fa-map-location-dot text-red-400"></i> View Shared Location
                    </a>`;
                }

                return `
                <div class="max-w-[85%] p-2.5 rounded-2xl flex flex-col gap-0.5 shadow-sm text-xs ${alignClass}">
                    <div class="text-[9px] ${isRider ? 'text-blue-200' : 'text-blue-400'} font-bold flex justify-between gap-3">
                        <span>${escapeHtml(m.sender || (isRider ? riderName : custName))}</span>
                        <span class="opacity-60 font-mono">${timeStr}</span>
                    </div>
                    ${m.text ? `<div class="leading-relaxed whitespace-pre-wrap font-sans break-words">${escapeHtml(m.text)}</div>` : ''}
                    ${imgHtml}
                    ${locationHtml}
                </div>`;
            }).join('');

            container.scrollTop = container.scrollHeight;
        });
    }
}

function evaluateRiderChatLockPermissions() {
    const lockBanner = document.getElementById('rider-chat-lock-banner');
    const inputEl = document.getElementById('rider-cust-chat-input');
    const sendBtn = document.getElementById('rider-cust-send-btn');
    const actionToolbar = document.getElementById('rider-chat-action-toolbar');

    if (!currentRiderChatMeta) return;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    const cateredRiderId = (currentRiderChatMeta.cateredByRiderId || "").toString().trim();
    const cateredRiderName = (currentRiderChatMeta.cateredByRiderName || "").toString().trim().toLowerCase();

    const isLockedByOther = (cateredRiderId || cateredRiderName) && 
                            (cateredRiderId !== myId && cateredRiderName !== myName);

    const isAdminOverride = (isAdmin() || canManageRoster()) && globalState.adminControlsEnabled;

    if (isLockedByOther && !isAdminOverride) {
        if (lockBanner) {
            lockBanner.classList.remove('hidden');
            lockBanner.innerHTML = `🔒 Catered by <strong>${escapeHtml(currentRiderChatMeta.cateredByRiderName)}</strong>. Thread is locked.`;
        }
        if (inputEl) inputEl.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        if (actionToolbar) actionToolbar.classList.add('opacity-50', 'pointer-events-none');
    } else {
        if (lockBanner) {
            if (isLockedByOther && isAdminOverride) {
                lockBanner.classList.remove('hidden');
                lockBanner.innerHTML = `🔑 Admin Override Active (Catered by <strong>${escapeHtml(currentRiderChatMeta.cateredByRiderName)}</strong>)`;
            } else {
                lockBanner.classList.add('hidden');
            }
        }
        if (inputEl) inputEl.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        if (actionToolbar) actionToolbar.classList.remove('opacity-50', 'pointer-events-none');
    }
}

export function closeRiderCustomerChatModal() {
    const modal = document.getElementById('rider-customer-chat-modal');
    if (modal) modal.classList.add('hidden');

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
}

export function sendRiderToCustomerChat(customText = "", customImageUrl = null, customLocationCoords = null) {
    const input = document.getElementById('rider-cust-chat-input');
    const text = customText || (input ? input.value.trim() : "");

    if ((!text && !customImageUrl && !customLocationCoords) || !activeRiderChatCustId) return;

    const riderName = appState.riderName || "Lokalex Rider";
    const now = Date.now();

    const newMsg = {
        sender: riderName,
        text: text,
        timestamp: now,
        isRider: true
    };

    if (customImageUrl) newMsg.imageUrl = customImageUrl;
    if (customLocationCoords) newMsg.locationCoords = customLocationCoords;

    if (db) {
        db.ref(`customerChats/${activeRiderChatCustId}/messages`).push(newMsg);
        db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update({
            lastMessage: `You: ${text || (customImageUrl ? "📷 Photo" : "📍 Location")}`,
            lastUpdated: now
        });
    }

    if (input && !customText) input.value = "";
}

export async function sendRiderLocation() {
    showToast("📡 Calibrating Rider GPS...");
    const coords = await calibrateGPS();
    if (!coords || (coords.lat === 0 && coords.lon === 0)) {
        return showToast("⚠️ Weak GPS Signal. Turn on Location Services.");
    }

    sendRiderToCustomerChat("📍 Shared Rider Location", null, { lat: coords.lat, lng: coords.lon });
    showToast("📍 Rider location sent!");
}

export function caterCustomerThread() {
    if (!activeRiderChatCustId) return;
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = appState.riderName || "Rider";

    if (db) {
        db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update({
            cateredByRiderId: myId,
            cateredByRiderName: myName,
            folder: 'inbox'
        });
    }

    showToast(`🔒 Locked customer to ${myName}!`);
}

export function markThreadDone() {
    if (!activeRiderChatCustId) return;

    if (db) {
        db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update({
            cateredByRiderId: null,
            cateredByRiderName: null,
            folder: 'done'
        });
    }

    showToast("✅ Moved chat to Done!");
    closeRiderCustomerChatModal();
}

export function markThreadFollowUp() {
    if (!activeRiderChatCustId) return;

    if (db) {
        db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update({
            cateredByRiderId: null,
            cateredByRiderName: null,
            folder: 'followup'
        });
    }

    showToast("📌 Moved chat to Follow Up!");
    closeRiderCustomerChatModal();
}

export function cancelCustomerThread() {
    if (!activeRiderChatCustId) return;

    if (db) {
        db.ref(`customerChats/${activeRiderChatCustId}/metadata`).update({
            cateredByRiderId: null,
            cateredByRiderName: null,
            folder: 'done',
            status: 'cancelled'
        });
    }

    showToast("🚫 Thread cancelled & released!");
    closeRiderCustomerChatModal();
}

// ============================================================================
// 4. IMAGE VIEWER MODAL (PINCH ZOOM, DOWNLOAD, DIRECT EDIT, BOTTOM SLIDER)
// ============================================================================
export function setViewerZoom(scale) {
    viewerZoomScale = Math.max(0.5, Math.min(4.0, scale));
    const img = document.getElementById('viewer-image');
    const slider = document.getElementById('viewer-zoom-slider');
    const valLabel = document.getElementById('viewer-zoom-val');

    if (img) {
        img.style.transform = `scale(${viewerZoomScale})`;
    }
    if (slider) {
        slider.value = Math.round(viewerZoomScale * 100);
    }
    if (valLabel) {
        valLabel.innerText = `${Math.round(viewerZoomScale * 100)}%`;
    }
}

export function zoomViewerImage(delta) {
    setViewerZoom(viewerZoomScale + delta);
}

export function resetViewerZoom() {
    setViewerZoom(1.0);
}

export function openImageViewerModal(imageUrl, targetType = 'customer') {
    if (!imageUrl) return;
    currentViewerImageUrl = imageUrl;
    currentViewerTargetType = targetType;

    const modal = document.getElementById('image-viewer-modal');
    const img = document.getElementById('viewer-image');
    const downloadBtn = document.getElementById('viewer-download-btn');

    if (img) {
        img.src = imageUrl;
    }
    if (downloadBtn) {
        downloadBtn.href = imageUrl;
    }

    setViewerZoom(1.0);

    if (modal) modal.classList.remove('hidden');

    if (!isViewerPinchInitialized) {
        setupImageViewerPinchGestures();
        isViewerPinchInitialized = true;
    }
}

export function closeImageViewerModal() {
    const modal = document.getElementById('image-viewer-modal');
    if (modal) modal.classList.add('hidden');
    currentViewerImageUrl = null;
    viewerZoomScale = 1;
}

export function editViewerImage() {
    if (!currentViewerImageUrl) return;
    const imgUrl = currentViewerImageUrl;
    const targetType = currentViewerTargetType || 'customer';
    closeImageViewerModal();

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
        editorBaseImage = img;
        initCanvasEditor();
        document.getElementById('image-editor-modal')?.classList.remove('hidden');
    };
    img.onerror = () => {
        showToast("⚠️ Could not load image for editing.");
    };
    img.src = imgUrl;
    editorTargetType = targetType;
}

function setupImageViewerPinchGestures() {
    const viewport = document.getElementById('viewer-image-viewport');
    if (!viewport) return;

    let initialPinchDistance = 0;
    let initialZoomScale = 1;

    const getDistance = (touches) => {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    };

    viewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            initialPinchDistance = getDistance(e.touches);
            initialZoomScale = viewerZoomScale;
        }
    }, { passive: false });

    viewport.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialPinchDistance > 0) {
            e.preventDefault();
            const currentDistance = getDistance(e.touches);
            const scaleFactor = currentDistance / initialPinchDistance;
            setViewerZoom(initialZoomScale * scaleFactor);
        }
    }, { passive: false });

    viewport.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
            initialPinchDistance = 0;
        }
    });

    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        zoomViewerImage(delta);
    }, { passive: false });
}

// ============================================================================
// 5. IMAGE EDITOR CANVAS (DRAWING, BRIGHTNESS, ADVANCED DRAGGABLE TEXT)
// ============================================================================
export function cycleBrushSize() {
    currentBrushIndex = (currentBrushIndex + 1) % BRUSH_PRESETS.length;
    updateBrushSizeUI();
}

export function updateBrushSizeUI() {
    const preset = BRUSH_PRESETS[currentBrushIndex];
    const dot = document.getElementById('brush-size-dot');
    const label = document.getElementById('brush-size-label');

    if (dot) {
        dot.style.width = `${preset.dotSize}px`;
        dot.style.height = `${preset.dotSize}px`;
        dot.style.backgroundColor = currentEditorColor;
    }
    if (label) {
        label.innerText = preset.name;
    }
}

export function setEditorColor(colorHex) {
    currentEditorColor = colorHex;
    const hexes = { red: '#ef4444', black: '#000000', white: '#ffffff' };
    
    ['red', 'black', 'white'].forEach(c => {
        const btn = document.getElementById(`color-btn-${c}`);
        if (btn) {
            btn.style.backgroundColor = hexes[c];
            if (hexes[c] === colorHex) {
                btn.className = "w-7 h-7 rounded-full border-2 border-black ring-2 ring-blue-500 scale-110 transition active:scale-95 shadow";
            } else {
                btn.className = `w-7 h-7 rounded-full border-2 ${c === 'black' ? 'border-white' : 'border-black'} opacity-80 transition active:scale-95 shadow`;
            }
        }
    });
    updateBrushSizeUI();
}

export function updateSelectedTextFontSize(newSize) {
    if (selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
        editorTextOverlays[selectedTextIndex].fontSize = parseInt(newSize, 10);
        renderEditorCanvas();
    }
}

export function updateSelectedTextRotation(degVal) {
    if (selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
        const rad = (parseInt(degVal, 10) * Math.PI) / 180;
        editorTextOverlays[selectedTextIndex].rotation = rad;
        renderEditorCanvas();
    }
}

export function deleteSelectedTextOverlay() {
    if (selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
        editorTextOverlays.splice(selectedTextIndex, 1);
        selectedTextIndex = -1;
        updateTextControlsUI();
        renderEditorCanvas();
        showToast("🗑️ Text removed!");
    }
}

function updateTextControlsUI() {
    const controlsContainer = document.getElementById('editor-text-controls');
    const sizeSlider = document.getElementById('editor-text-size-slider');
    const rotateSlider = document.getElementById('editor-text-rotate-slider');
    const sizeLabel = document.getElementById('editor-text-size-val');
    const rotateLabel = document.getElementById('editor-text-rotate-val');

    if (selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
        const item = editorTextOverlays[selectedTextIndex];
        if (controlsContainer) controlsContainer.classList.remove('hidden');

        if (sizeSlider) sizeSlider.value = item.fontSize;
        if (rotateSlider) rotateSlider.value = Math.round(((item.rotation || 0) * 180) / Math.PI);
        if (sizeLabel) sizeLabel.innerText = `${item.fontSize}px`;
        if (rotateLabel) rotateLabel.innerText = `${Math.round(((item.rotation || 0) * 180) / Math.PI)}°`;
    } else {
        if (controlsContainer) controlsContainer.classList.add('hidden');
    }
}

export function openImageEditorModal(file, targetType = 'customer') {
    if (!file) return;
    editorTargetType = targetType;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            editorBaseImage = img;
            initCanvasEditor();
            document.getElementById('image-editor-modal')?.classList.remove('hidden');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function initCanvasEditor() {
    const canvas = document.getElementById('photo-canvas');
    if (!canvas || !editorBaseImage) return;

    const maxDim = 800;
    let width = editorBaseImage.width;
    let height = editorBaseImage.height;

    if (width > maxDim || height > maxDim) {
        if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
        } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
        }
    }

    canvas.width = width;
    canvas.height = height;

    if (!editorDrawingCanvas) {
        editorDrawingCanvas = document.createElement('canvas');
    }
    editorDrawingCanvas.width = width;
    editorDrawingCanvas.height = height;
    editorDrawingCtx = editorDrawingCanvas.getContext('2d');
    editorDrawingCtx.clearRect(0, 0, width, height);

    editorTextOverlays = [];
    selectedTextIndex = -1;
    updateTextControlsUI();

    document.getElementById('editor-brightness').value = 100;

    currentBrushIndex = 0;
    setEditorColor('#ef4444');
    updateBrushSizeUI();

    setupCanvasDrawingEvents(canvas);
    renderEditorCanvas();
}

function getTextOverlayAtPosition(canvas, x, y) {
    const ctx = canvas.getContext('2d');
    for (let i = editorTextOverlays.length - 1; i >= 0; i--) {
        const item = editorTextOverlays[i];
        
        // Transform point into local unrotated coordinates around item.x, item.y
        const rot = item.rotation || 0;
        const dx = x - item.x;
        const dy = y - item.y;

        const localX = dx * Math.cos(-rot) - dy * Math.sin(-rot);
        const localY = dx * Math.sin(-rot) + dy * Math.cos(-rot);

        ctx.font = `bold ${item.fontSize}px sans-serif`;
        const metrics = ctx.measureText(item.text);
        const textWidth = Math.max(metrics.width, 30);
        const textHeight = item.fontSize;

        const left = -textWidth / 2 - 20;
        const right = textWidth / 2 + 20;
        const top = -textHeight - 15;
        const bottom = 20;

        if (localX >= left && localX <= right && localY >= top && localY <= bottom) {
            return i;
        }
    }
    return -1;
}

function promptEditText(idx) {
    if (idx >= 0 && editorTextOverlays[idx]) {
        const currentText = editorTextOverlays[idx].text;
        const edited = prompt("Edit text on photo:", currentText);
        if (edited !== null && edited.trim() !== "") {
            editorTextOverlays[idx].text = edited.trim();
            renderEditorCanvas();
            showToast("✅ Text updated!");
        }
    }
}

function setupCanvasDrawingEvents(canvas) {
    let lastTouchTime = 0;
    let lastTouchIdx = -1;

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientY ? e.clientX : 0;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY ? e.clientY : 0;
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const getTouchDistance = (touches) => {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.hypot(dx, dy);
    };

    const getTouchAngle = (touches) => {
        const dx = touches[1].clientX - touches[0].clientX;
        const dy = touches[1].clientY - touches[0].clientY;
        return Math.atan2(dy, dx);
    };

    canvas.ondblclick = (e) => {
        const pos = getPos(e);
        const hitIdx = getTextOverlayAtPosition(canvas, pos.x, pos.y);
        if (hitIdx !== -1) {
            promptEditText(hitIdx);
        }
    };

    const startDraw = (e) => {
        if (e.touches && e.touches.length === 2 && selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
            // Two-finger gesture start for text pinch & rotate
            initialPinchDistance = getTouchDistance(e.touches);
            initialPinchFontSize = editorTextOverlays[selectedTextIndex].fontSize;
            initialPinchAngle = getTouchAngle(e.touches);
            initialTextRotation = editorTextOverlays[selectedTextIndex].rotation || 0;
            isDrawingOnCanvas = false;
            isDraggingText = false;
            return;
        }

        const pos = getPos(e);
        const hitIdx = getTextOverlayAtPosition(canvas, pos.x, pos.y);
        const now = Date.now();

        if (hitIdx !== -1) {
            if (lastTouchIdx === hitIdx && (now - lastTouchTime) < 350) {
                promptEditText(hitIdx);
                isDraggingText = false;
                selectedTextIndex = -1;
                updateTextControlsUI();
                lastTouchTime = 0;
                lastTouchIdx = -1;
                return;
            }

            lastTouchTime = now;
            lastTouchIdx = hitIdx;
            isDraggingText = true;
            selectedTextIndex = hitIdx;
            updateTextControlsUI();

            textDragOffsetX = pos.x - editorTextOverlays[hitIdx].x;
            textDragOffsetY = pos.y - editorTextOverlays[hitIdx].y;
            isDrawingOnCanvas = false;
        } else {
            lastTouchTime = now;
            lastTouchIdx = -1;
            isDraggingText = false;
            selectedTextIndex = -1;
            updateTextControlsUI();

            isDrawingOnCanvas = true;
            lastCanvasX = pos.x;
            lastCanvasY = pos.y;
        }
        renderEditorCanvas();
    };

    const moveDraw = (e) => {
        if (e.touches && e.touches.length === 2 && selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
            // Two-finger gesture handling: Pinch scale & rotate
            const currentDist = getTouchDistance(e.touches);
            const currentAngle = getTouchAngle(e.touches);

            if (initialPinchDistance > 0) {
                const scale = currentDist / initialPinchDistance;
                const newSize = Math.max(12, Math.min(140, Math.round(initialPinchFontSize * scale)));
                editorTextOverlays[selectedTextIndex].fontSize = newSize;

                const angleDelta = currentAngle - initialPinchAngle;
                editorTextOverlays[selectedTextIndex].rotation = initialTextRotation + angleDelta;

                updateTextControlsUI();
                renderEditorCanvas();
            }
            return;
        }

        const pos = getPos(e);

        if (isDraggingText && selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
            editorTextOverlays[selectedTextIndex].x = pos.x - textDragOffsetX;
            editorTextOverlays[selectedTextIndex].y = pos.y - textDragOffsetY;
            renderEditorCanvas();
            return;
        }

        if (isDrawingOnCanvas && editorDrawingCtx) {
            const color = currentEditorColor;
            const brushSize = BRUSH_PRESETS[currentBrushIndex].lineWidth;

            editorDrawingCtx.beginPath();
            editorDrawingCtx.strokeStyle = color;
            editorDrawingCtx.lineWidth = brushSize;
            editorDrawingCtx.lineCap = 'round';
            editorDrawingCtx.lineJoin = 'round';
            editorDrawingCtx.moveTo(lastCanvasX, lastCanvasY);
            editorDrawingCtx.lineTo(pos.x, pos.y);
            editorDrawingCtx.stroke();

            lastCanvasX = pos.x;
            lastCanvasY = pos.y;

            renderEditorCanvas();
        }
    };

    const stopDraw = () => {
        isDrawingOnCanvas = false;
        isDraggingText = false;
        initialPinchDistance = 0;
    };

    canvas.onmousedown = startDraw;
    canvas.onmousemove = moveDraw;
    canvas.onmouseup = stopDraw;

    canvas.ontouchstart = (e) => { startDraw(e); };
    canvas.ontouchmove = (e) => { moveDraw(e); };
    canvas.ontouchend = stopDraw;
}

export function renderEditorCanvas() {
    const canvas = document.getElementById('photo-canvas');
    if (!canvas || !editorBaseImage) return;
    const ctx = canvas.getContext('2d');

    const brightnessVal = parseInt(document.getElementById('editor-brightness')?.value || '100', 10);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.filter = `brightness(${brightnessVal}%)`;
    ctx.drawImage(editorBaseImage, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';

    if (editorDrawingCanvas) {
        ctx.drawImage(editorDrawingCanvas, 0, 0);
    }

    editorTextOverlays.forEach((item, idx) => {
        ctx.save();
        ctx.translate(item.x, item.y);
        ctx.rotate(item.rotation || 0);

        ctx.font = `bold ${item.fontSize}px sans-serif`;
        ctx.fillStyle = item.color;
        ctx.textAlign = 'center';

        // Outline color logic: White outline if color is Black (#000000), otherwise Black outline
        const cleanColor = (item.color || "").toLowerCase().trim();
        const isBlackText = cleanColor === '#000000' || cleanColor === 'black' || cleanColor === 'rgb(0,0,0)';
        
        ctx.strokeStyle = isBlackText ? '#ffffff' : '#000000';
        ctx.lineWidth = Math.max(2, Math.round(item.fontSize / 9));
        ctx.lineJoin = 'round';

        ctx.strokeText(item.text, 0, 0);
        ctx.fillText(item.text, 0, 0);

        // Highlight selection bounding box for selected text
        if (idx === selectedTextIndex) {
            const metrics = ctx.measureText(item.text);
            const textWidth = Math.max(metrics.width, 30);
            const textHeight = item.fontSize;

            ctx.strokeStyle = '#06b6d4'; // Cyan outline
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(-textWidth / 2 - 12, -textHeight - 10, textWidth + 24, textHeight + 20);
            ctx.setLineDash([]);
        }

        ctx.restore();
    });
}

export function addEditorTextOverlay() {
    const textVal = prompt("Enter text for image:", "Text");
    if (textVal === null || textVal.trim() === "") return;

    const canvas = document.getElementById('photo-canvas');
    if (!canvas) return;

    const newItem = {
        text: textVal.trim(),
        x: canvas.width / 2,
        y: canvas.height / 2,
        fontSize: Math.round(canvas.width / 15),
        color: currentEditorColor,
        rotation: 0
    };

    editorTextOverlays.push(newItem);
    selectedTextIndex = editorTextOverlays.length - 1;
    updateTextControlsUI();

    renderEditorCanvas();
    showToast("✨ Text added! Tap to select, pinch or use sliders to scale/rotate.");
}

export function clearEditorDrawings() {
    if (editorDrawingCtx && editorDrawingCanvas) {
        editorDrawingCtx.clearRect(0, 0, editorDrawingCanvas.width, editorDrawingCanvas.height);
    }
    editorTextOverlays = [];
    selectedTextIndex = -1;
    updateTextControlsUI();
    document.getElementById('editor-brightness').value = 100;
    renderEditorCanvas();
    showToast("🧹 Canvas cleared!");
}

export function closeImageEditorModal() {
    document.getElementById('image-editor-modal')?.classList.add('hidden');
    editorBaseImage = null;
    isDraggingText = false;
    selectedTextIndex = -1;
    updateTextControlsUI();
}

export function exportAndSendEditedImage() {
    const canvas = document.getElementById('photo-canvas');
    if (!canvas) return;

    // Deselect text before saving clean JPEG
    const tempSelected = selectedTextIndex;
    selectedTextIndex = -1;
    renderEditorCanvas();

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const targetType = editorTargetType || 'customer';
    closeImageEditorModal();

    if (targetType === 'customer') {
        sendCustomerToRiderChat("", dataUrl);
    } else if (targetType === 'rider') {
        sendRiderToCustomerChat("", dataUrl);
    } else if (targetType === 'team') {
        const senderName = appState.riderName || "Lokalex Rider";
        const newMsg = {
            sender: senderName,
            text: "📷 [Shared Image]",
            imageUrl: dataUrl,
            timestamp: Date.now()
        };
        if (db) db.ref('chat').push(newMsg);
    }

    showToast("📷 Photo sent!");
}

// BIND TO GLOBAL WINDOW OBJECT
if (typeof window !== 'undefined') {
    window.initDraggableChat = initDraggableChat;
    window.toggleChatWindow = toggleChatWindow;
    window.sendBubbleChatMessage = sendBubbleChatMessage;
    window.triggerTeamChatImage = triggerTeamChatImage;
    window.handleTeamChatImageFile = handleTeamChatImageFile;
    window.handleChatInput = handleChatInput;
    window.sendCustomerToRiderChat = sendCustomerToRiderChat;
    window.listenToCustomerRiderChat = listenToCustomerRiderChat;
    window.sendCustomerLocation = sendCustomerLocation;
    window.listenToAllCustomerChatsForRider = listenToAllCustomerChatsForRider;
    window.setRiderChatFilter = setRiderChatFilter;
    window.openRiderCustomerChatModal = openRiderCustomerChatModal;
    window.closeRiderCustomerChatModal = closeRiderCustomerChatModal;
    window.sendRiderToCustomerChat = sendRiderToCustomerChat;
    window.sendRiderLocation = sendRiderLocation;
    window.caterCustomerThread = caterCustomerThread;
    window.markThreadDone = markThreadDone;
    window.markThreadFollowUp = markThreadFollowUp;
    window.cancelCustomerThread = cancelCustomerThread;
    window.openImageViewerModal = openImageViewerModal;
    window.closeImageViewerModal = closeImageViewerModal;
    window.zoomViewerImage = zoomViewerImage;
    window.setViewerZoom = setViewerZoom;
    window.resetViewerZoom = resetViewerZoom;
    window.editViewerImage = editViewerImage;
    window.cycleBrushSize = cycleBrushSize;
    window.updateBrushSizeUI = updateBrushSizeUI;
    window.setEditorColor = setEditorColor;
    window.updateSelectedTextFontSize = updateSelectedTextFontSize;
    window.updateSelectedTextRotation = updateSelectedTextRotation;
    window.deleteSelectedTextOverlay = deleteSelectedTextOverlay;
    window.openImageEditorModal = openImageEditorModal;
    window.renderEditorCanvas = renderEditorCanvas;
    window.addEditorTextOverlay = addEditorTextOverlay;
    window.clearEditorDrawings = clearEditorDrawings;
    window.closeImageEditorModal = closeImageEditorModal;
    window.exportAndSendEditedImage = exportAndSendEditedImage;
}