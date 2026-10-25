// src/features/chat/chatEngine/chatPresence.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { escapeHtml } from '../../../utils/helpers.js';

let activePresenceCustId = null;
let presenceHeartbeatInterval = null;
let typingDebounceTimeout = null;
let activeTypingCustId = null;
let activeTypingListenerCustId = null;

let presenceRefListener = null;
let typingRefListener = null;
let threadSeenListener = null;
let activeSeenCustId = null;

// Global maps for the chat feed cards
export const globalThreadTypingMap = new Map();
export const globalThreadViewingMap = new Map();
export const globalThreadSeenMap = new Map();
let isGlobalPresenceFeedListenerActive = false;

export function getCleanCustKey(custId) {
    if (!custId) return "";
    return String(custId).trim().replace(/[.#$\[\]\/]/g, '_');
}

function getMyRiderInfo() {
    let riderId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const riderName = (appState.riderName || localStorage.getItem('riderName') || localStorage.getItem('lokalex_customer_name') || "Rider").toString().trim();
    if (!riderId) {
        riderId = riderName ? riderName.replace(/[^a-zA-Z0-9_-]/g, '_') : 'rider_' + Date.now().toString(36);
    }
    return { riderId, riderName };
}

/**
 * Records that the current rider has opened and seen the chat thread.
 */
export function markChatThreadSeen(custId) {
    if (!custId || !db) return;
    const cleanCustKey = getCleanCustKey(custId);
    const { riderId, riderName } = getMyRiderInfo();
    if (!cleanCustKey || !riderId) return;

    const now = Date.now();
    const payload = {
        riderId,
        riderName,
        seenAt: now
    };

    // Save to both metadata and root threadSeenBy paths
    db.ref(`customerChats/${cleanCustKey}/metadata/threadSeenBy/${riderId}`).set(payload).catch(() => {});
    db.ref(`customerChats/${cleanCustKey}/threadSeenBy/${riderId}`).set(payload).catch(() => {});
    db.ref(`customerChatMeta/${cleanCustKey}/threadSeenBy/${riderId}`).set(payload).catch(() => {});
}

/**
 * Listens to who has seen the active chat thread and updates the UI.
 */
export function startThreadSeenListener(custId) {
    if (!custId || !db) return;
    stopThreadSeenListener();

    const cleanCustKey = getCleanCustKey(custId);
    if (!cleanCustKey) return;
    activeSeenCustId = cleanCustKey;

    const seenRef = db.ref(`customerChats/${cleanCustKey}/threadSeenBy`);
    threadSeenListener = seenRef.on('value', (snap) => {
        const val = snap.val() || {};
        const { riderId } = getMyRiderInfo();
        const otherSeen = [];

        Object.values(val).forEach(s => {
            if (s && s.riderId && s.riderId.toString() !== riderId.toString()) {
                const sTime = s.seenAt ? new Date(s.seenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
                otherSeen.push({ name: s.riderName || "Rider", time: sTime, seenAt: s.seenAt });
            }
        });

        // Store globally on window so message bubble renderers can access it anytime
        window.activeThreadSeenMap = val;

        updateChatSeenHeaderPill(otherSeen);

        // Update the seen indicators inside the messages list
        const container = document.getElementById('rider-chat-messages-container') || document.getElementById('rider-cust-chat-messages');
        if (container && typeof window.updateRiderChatSeenAvatar === 'function') {
            window.updateRiderChatSeenAvatar(container, window.getActiveCustData ? window.getActiveCustData() : null);
        }
    });
}

export function stopThreadSeenListener() {
    if (threadSeenListener && db && activeSeenCustId) {
        db.ref(`customerChats/${activeSeenCustId}/threadSeenBy`).off('value');
        threadSeenListener = null;
    }
    activeSeenCustId = null;
    updateChatSeenHeaderPill([]);
}

function updateChatPresenceBanner() {
    const banner = document.getElementById('rider-chat-presence-banner');
    const viewersBar = document.getElementById('rider-chat-viewers-bar');
    const seenBar = document.getElementById('rider-chat-seen-bar');
    if (!banner) return;

    const hasViewers = viewersBar && !viewersBar.classList.contains('hidden') && viewersBar.innerText.trim() !== '';
    const hasSeen = seenBar && !seenBar.classList.contains('hidden') && seenBar.innerText.trim() !== '';

    if (hasViewers || hasSeen) {
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }
}

function updateChatSeenHeaderPill(seenList = []) {
    const seenBar = document.getElementById('rider-chat-seen-bar');
    const seenText = document.getElementById('rider-chat-seen-text');
    const pill = document.getElementById('rider-chat-seen-pill');

    if (!seenList || seenList.length === 0) {
        if (seenBar) seenBar.classList.add('hidden');
        if (seenText) seenText.innerText = '';
        if (pill) {
            pill.classList.add('hidden');
            pill.innerText = '';
        }
        updateChatPresenceBanner();
        return;
    }

    const names = seenList.map(s => s.name);
    let label = '';
    if (names.length === 1) {
        label = `Seen by ${names[0]}${seenList[0]?.time ? ` • ${seenList[0].time}` : ''}`;
    } else if (names.length === 2) {
        label = `Seen by ${names[0]} & ${names[1]}`;
    } else {
        label = `Seen by ${names[0]} +${names.length - 1}`;
    }

    if (seenText) seenText.innerText = label;
    if (seenBar) seenBar.classList.remove('hidden');
    if (pill) {
        pill.innerText = `👁️ ${label}`;
        pill.classList.remove('hidden');
    }
    updateChatPresenceBanner();
}

/**
 * Broadcasts viewing presence for this customer thread and listens for other riders viewing it.
 */
export function startChatPresence(custId) {
    if (!custId || !db) return;
    stopChatPresence(); // Clean up any previous session

    const cleanCustKey = getCleanCustKey(custId);
    const { riderId, riderName } = getMyRiderInfo();
    if (!cleanCustKey || !riderId) return;

    activePresenceCustId = cleanCustKey;

    // Record that I opened and have seen this thread
    markChatThreadSeen(custId);
    startThreadSeenListener(custId);

    const myPresenceRef = db.ref(`chatPresence/${cleanCustKey}/${riderId}`);
    const presenceData = {
        riderId,
        riderName,
        openedAt: Date.now(),
        lastActive: Date.now()
    };

    // 1. Set presence and guarantee cleanup on disconnect
    myPresenceRef.set(presenceData).catch(() => {});
    myPresenceRef.onDisconnect().remove().catch(() => {});

    // 2. Keepalive heartbeat every 15 seconds
    presenceHeartbeatInterval = setInterval(() => {
        if (activePresenceCustId === cleanCustKey && navigator.onLine) {
            myPresenceRef.update({ lastActive: Date.now() }).catch(() => {});
        }
    }, 15000);

    // 3. Listen to all viewers of this thread
    const allPresenceRef = db.ref(`chatPresence/${cleanCustKey}`);
    presenceRefListener = allPresenceRef.on('value', (snap) => {
        const val = snap.val() || {};
        const otherViewers = [];
        const now = Date.now();

        Object.values(val).forEach(p => {
            if (p && p.riderId && p.riderId.toString() !== riderId.toString()) {
                // Active within 45s
                const lastTs = p.lastActive || p.openedAt || 0;
                if (now - lastTs < 45000) {
                    otherViewers.push(p.riderName || "Rider");
                }
            }
        });

        updateChatViewersUi(otherViewers);
    });
}

/**
 * Cleans up viewing presence when exiting the chat thread.
 */
export function stopChatPresence() {
    if (presenceHeartbeatInterval) {
        clearInterval(presenceHeartbeatInterval);
        presenceHeartbeatInterval = null;
    }

    if (activePresenceCustId && db) {
        const { riderId } = getMyRiderInfo();
        if (riderId) {
            db.ref(`chatPresence/${activePresenceCustId}/${riderId}`).remove().catch(() => {});
        }
        if (presenceRefListener) {
            db.ref(`chatPresence/${activePresenceCustId}`).off('value');
            presenceRefListener = null;
        }
    }

    activePresenceCustId = null;
    updateChatViewersUi([]);
    clearMyTypingStatus();
    stopChatTypingListener();
    stopThreadSeenListener();
}

function updateChatViewersUi(otherViewers = []) {
    const viewersBar = document.getElementById('rider-chat-viewers-bar');
    const viewersText = document.getElementById('rider-chat-viewers-text');
    const pill = document.getElementById('rider-chat-viewers-pill');

    if (!otherViewers || otherViewers.length === 0) {
        if (viewersBar) viewersBar.classList.add('hidden');
        if (viewersText) viewersText.innerText = '';
        if (pill) {
            pill.classList.add('hidden');
            pill.innerText = '';
        }
        updateChatPresenceBanner();
        return;
    }

    let label = '';
    if (otherViewers.length === 1) {
        label = `${otherViewers[0]} is viewing`;
    } else if (otherViewers.length === 2) {
        label = `${otherViewers[0]} & ${otherViewers[1]} are viewing`;
    } else {
        label = `${otherViewers[0]} & ${otherViewers.length - 1} others viewing`;
    }

    if (viewersText) viewersText.innerText = label;
    if (viewersBar) viewersBar.classList.remove('hidden');
    if (pill) {
        pill.innerText = `👀 ${label}`;
        pill.classList.remove('hidden');
    }
    updateChatPresenceBanner();
}

/**
 * Broadcasts typing activity when the rider types in the message input.
 */
export function handleChatTyping(custId, isTyping = true) {
    if (!custId || !db) return;
    const cleanCustKey = getCleanCustKey(custId);
    const { riderId, riderName } = getMyRiderInfo();
    if (!cleanCustKey || !riderId) return;

    activeTypingCustId = cleanCustKey;

    if (isTyping) {
        const myTypingRef = db.ref(`chatTyping/${cleanCustKey}/${riderId}`);
        myTypingRef.set({
            riderId,
            riderName,
            timestamp: Date.now()
        }).catch(() => {});
        myTypingRef.onDisconnect().remove().catch(() => {});

        // Reset auto-clear debounce timeout (3.5 seconds)
        if (typingDebounceTimeout) clearTimeout(typingDebounceTimeout);
        typingDebounceTimeout = setTimeout(() => {
            clearMyTypingStatus();
        }, 3500);
    } else {
        clearMyTypingStatus();
    }
}

export function clearMyTypingStatus() {
    if (typingDebounceTimeout) {
        clearTimeout(typingDebounceTimeout);
        typingDebounceTimeout = null;
    }

    if (activeTypingCustId && db) {
        const { riderId } = getMyRiderInfo();
        if (riderId) {
            db.ref(`chatTyping/${activeTypingCustId}/${riderId}`).remove().catch(() => {});
        }
    }
    activeTypingCustId = null;
}

/**
 * Listens for other riders typing a reply in the active chat modal.
 */
export function startChatTypingListener(custId) {
    if (!custId || !db) return;
    stopChatTypingListener();

    const cleanCustKey = getCleanCustKey(custId);
    const { riderId } = getMyRiderInfo();
    if (!cleanCustKey) return;
    activeTypingListenerCustId = cleanCustKey;

    const allTypingRef = db.ref(`chatTyping/${cleanCustKey}`);
    typingRefListener = allTypingRef.on('value', (snap) => {
        const val = snap.val() || {};
        const now = Date.now();
        const activeTypers = [];

        Object.values(val).forEach(t => {
            if (t && t.riderId && t.riderId.toString() !== riderId.toString()) {
                // Ignore stale typing (> 5 seconds)
                if (now - (t.timestamp || 0) < 5000) {
                    activeTypers.push(t.riderName || "Rider");
                }
            }
        });

        updateChatTypingBarUi(activeTypers);
    });
}

export function stopChatTypingListener() {
    if (typingRefListener && db && activeTypingListenerCustId) {
        db.ref(`chatTyping/${activeTypingListenerCustId}`).off('value');
        typingRefListener = null;
    }
    activeTypingListenerCustId = null;
    updateChatTypingBarUi([]);
}

function updateChatTypingBarUi(activeTypers = []) {
    const bar = document.getElementById('rider-chat-typing-bar');
    const container = document.getElementById('rider-chat-messages-container') || document.getElementById('rider-cust-chat-messages');

    if (!activeTypers || activeTypers.length === 0) {
        if (bar) {
            bar.classList.add('hidden');
            bar.innerHTML = '';
        }
        const existingBubble = document.getElementById('chat-messages-typing-bubble');
        if (existingBubble) existingBubble.remove();
        return;
    }

    const text = activeTypers.length === 1 
        ? `${activeTypers[0]} is typing a reply...` 
        : `${activeTypers.join(', ')} are typing...`;

    // 1. Update bottom typing bar above textarea
    if (bar) {
        bar.innerHTML = `
            <span class="inline-flex items-center gap-1.5 text-amber-500 dark:text-amber-400 font-bold animate-pulse text-[11px]">
                <i class="fa-solid fa-pen-nib"></i> ✍️ ${escapeHtml(text)}
            </span>
        `;
        bar.classList.remove('hidden');
    }

    // 2. Render or update chat messages typing bubble directly in the thread
    if (container) {
        let bubble = document.getElementById('chat-messages-typing-bubble');
        if (!bubble) {
            bubble = document.createElement('div');
            bubble.id = 'chat-messages-typing-bubble';
            bubble.className = 'flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-zinc-800 rounded-2xl w-fit shadow-xs my-1 select-none animate-in fade-in duration-150';
            container.appendChild(bubble);
        }
        bubble.innerHTML = `
            <div class="flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce"></span>
                <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce [animation-delay:0.2s]"></span>
                <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce [animation-delay:0.4s]"></span>
            </div>
            <span class="text-xs font-bold text-gray-700 dark:text-gray-300">
                ${escapeHtml(text)}
            </span>
        `;
        // Scroll to bottom if near bottom
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
        if (isNearBottom) {
            container.scrollTop = container.scrollHeight;
        }
    }
}

/**
 * Global feed listener that tracks typing and viewing across threads for live cards in Live Chats.
 */
export function initGlobalChatTypingAndPresenceFeedListener() {
    if (isGlobalPresenceFeedListenerActive || !db) return;
    isGlobalPresenceFeedListenerActive = true;

    const { riderId } = getMyRiderInfo();

    // Listen to all typing activity across all threads
    db.ref('chatTyping').on('value', (snap) => {
        const val = snap.val() || {};
        const now = Date.now();
        globalThreadTypingMap.clear();

        Object.entries(val).forEach(([tKey, riders]) => {
            if (riders && typeof riders === 'object') {
                const names = [];
                Object.values(riders).forEach(r => {
                    if (r && r.riderId && r.riderId.toString() !== riderId.toString()) {
                        if (now - (r.timestamp || 0) < 5000) {
                            names.push(r.riderName || "Rider");
                        }
                    }
                });
                if (names.length > 0) {
                    globalThreadTypingMap.set(tKey, names);
                }
            }
        });

        // Trigger feed re-render if visible
        if (typeof window.renderRiderCustomerChatFeed === 'function') {
            window.renderRiderCustomerChatFeed();
        }
    });

    // Listen to all viewing presence across all threads
    db.ref('chatPresence').on('value', (snap) => {
        const val = snap.val() || {};
        const now = Date.now();
        globalThreadViewingMap.clear();

        Object.entries(val).forEach(([tKey, riders]) => {
            if (riders && typeof riders === 'object') {
                const names = [];
                Object.values(riders).forEach(r => {
                    if (r && r.riderId && r.riderId.toString() !== riderId.toString()) {
                        if (now - (r.lastActive || r.openedAt || 0) < 45000) {
                            names.push(r.riderName || "Rider");
                        }
                    }
                });
                if (names.length > 0) {
                    globalThreadViewingMap.set(tKey, names);
                }
            }
        });

        // Trigger feed re-render if visible
        if (typeof window.renderRiderCustomerChatFeed === 'function') {
            window.renderRiderCustomerChatFeed();
        }
    });
}
