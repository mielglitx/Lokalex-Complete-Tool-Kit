// src/features/chat/fullBookingMode.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { toggleBodyScroll } from './chatUtils.js';
import { forwardRiderReplyToMessenger } from './riderChat.js';
import { isAdmin } from '../roster/rosterUtils.js';

export const DEFAULT_FULL_BOOKING_MESSAGE = "Paumanhin po, Full Booking na po kami sa ngayon. Mag-a-update po kami kapag available na ulit ang aming delivery service. Maraming salamat po sa pag-unawa! 🛵🙏";

export const fullBookingState = {
    enabled: false,
    message: DEFAULT_FULL_BOOKING_MESSAGE,
    updatedBy: "Admin",
    updatedAt: 0
};

let isFullBookingListening = false;

function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

export function initFullBookingListener() {
    // 1. Initial local cache check
    try {
        const cached = localStorage.getItem('lokalex_full_booking_settings');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && typeof parsed.enabled === 'boolean') {
                Object.assign(fullBookingState, parsed);
                updateFullBookingUI();
            }
        }
    } catch (e) {}

    updateFullBookingUI();

    if (isFullBookingListening || !db) return;
    isFullBookingListening = true;

    db.ref('settings/fullBooking').on('value', (snap) => {
        const val = snap.val();
        if (val) {
            fullBookingState.enabled = Boolean(val.enabled);
            if (val.message) fullBookingState.message = String(val.message);
            fullBookingState.updatedBy = val.updatedBy || 'Admin';
            fullBookingState.updatedAt = val.updatedAt || 0;
        } else {
            fullBookingState.enabled = false;
        }

        try {
            localStorage.setItem('lokalex_full_booking_settings', JSON.stringify(fullBookingState));
        } catch (e) {}

        updateFullBookingUI();

        // If Full Booking Mode is newly turned on, immediately auto-reply to unreplied inbox threads
        if (fullBookingState.enabled) {
            scanAndAutoReplyWaitingInboxCustomers();
        }
    }, (err) => {
        console.warn("Full booking settings listener error:", err);
    });
}

export function updateFullBookingUI() {
    const banner = document.getElementById('full-booking-active-banner');
    const triggerBtn = document.getElementById('btn-full-booking-trigger');
    const adminActions = document.getElementById('full-booking-admin-actions');
    const toggle = document.getElementById('admin-full-booking-toggle');
    const msgInput = document.getElementById('admin-full-booking-message-input');

    const isAdminUser = typeof isAdmin === 'function' ? isAdmin() : false;

    // Trigger button in chat channel bar
    if (triggerBtn) {
        if (isAdminUser) {
            triggerBtn.classList.remove('hidden');
            if (fullBookingState.enabled) {
                triggerBtn.className = "bg-rose-600 hover:bg-rose-500 text-white border border-rose-500 text-[9px] font-black px-2.5 py-1 rounded-lg transition active:scale-95 flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs animate-pulse";
                triggerBtn.innerHTML = `<i class="fa-solid fa-ban text-[9px]"></i> Full Booking: ON`;
            } else {
                triggerBtn.className = "bg-white dark:bg-cardBg hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-gray-300 dark:border-gray-700 text-[9px] font-bold px-2 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 shrink-0 cursor-pointer shadow-2xs";
                triggerBtn.innerHTML = `<i class="fa-solid fa-ban text-rose-500 text-[8px]"></i> Full Booking`;
            }
        } else {
            triggerBtn.classList.add('hidden');
        }
    }

    // Active banner in chat feed area
    if (banner) {
        if (fullBookingState.enabled) {
            banner.classList.remove('hidden');
            if (adminActions) {
                if (isAdminUser) adminActions.classList.remove('hidden');
                else adminActions.classList.add('hidden');
            }
        } else {
            banner.classList.add('hidden');
        }
    }

    // Modal fields sync
    if (toggle) toggle.checked = fullBookingState.enabled;
    if (msgInput && document.activeElement !== msgInput) {
        msgInput.value = fullBookingState.message || DEFAULT_FULL_BOOKING_MESSAGE;
    }
}

export function openFullBookingModal() {
    if (!isAdmin()) {
        showToast("⚠️ Unauthorized: Only Admins can manage Full Booking Mode.");
        return;
    }
    const modal = document.getElementById('admin-full-booking-modal');
    if (!modal) return;

    const toggle = document.getElementById('admin-full-booking-toggle');
    const msgInput = document.getElementById('admin-full-booking-message-input');

    if (toggle) toggle.checked = fullBookingState.enabled;
    if (msgInput) msgInput.value = fullBookingState.message || DEFAULT_FULL_BOOKING_MESSAGE;

    modal.classList.remove('hidden');
    toggleBodyScroll(true);
}

export function closeFullBookingModal() {
    const modal = document.getElementById('admin-full-booking-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
}

export function resetFullBookingMessageDefault() {
    const msgInput = document.getElementById('admin-full-booking-message-input');
    if (msgInput) {
        msgInput.value = DEFAULT_FULL_BOOKING_MESSAGE;
    }
}

export async function saveFullBookingSettings() {
    if (!isAdmin()) {
        showToast("⚠️ Unauthorized: Only Admins can customize Full Booking.");
        return;
    }
    const toggle = document.getElementById('admin-full-booking-toggle');
    const msgInput = document.getElementById('admin-full-booking-message-input');

    const enabled = toggle ? toggle.checked : fullBookingState.enabled;
    const message = (msgInput ? msgInput.value.trim() : "") || DEFAULT_FULL_BOOKING_MESSAGE;

    const myName = appState.riderName || localStorage.getItem('riderName') || 'Admin';
    const payload = {
        enabled,
        message,
        updatedBy: myName,
        updatedAt: Date.now()
    };

    closeFullBookingModal();

    if (db) {
        try {
            await db.ref('settings/fullBooking').set(payload);
            showToast(enabled ? "🛑 Full Booking Mode activated!" : "✅ Full Booking Mode disabled.");
        } catch (e) {
            console.error("Save full booking error:", e);
            showToast("❌ Error saving Full Booking settings: " + e.message);
        }
    } else {
        Object.assign(fullBookingState, payload);
        updateFullBookingUI();
        showToast("✅ Settings saved locally.");
    }
}

export async function toggleFullBookingMode(forceState = null) {
    if (!isAdmin()) {
        showToast("⚠️ Unauthorized: Only Admins can toggle Full Booking Mode.");
        return;
    }
    const newState = forceState !== null ? Boolean(forceState) : !fullBookingState.enabled;
    const myName = appState.riderName || localStorage.getItem('riderName') || 'Admin';
    const payload = {
        enabled: newState,
        message: fullBookingState.message || DEFAULT_FULL_BOOKING_MESSAGE,
        updatedBy: myName,
        updatedAt: Date.now()
    };

    if (db) {
        try {
            await db.ref('settings/fullBooking').set(payload);
            showToast(newState ? "🛑 Full Booking Mode is now ON!" : "✅ Full Booking Mode turned OFF.");
        } catch (e) {
            console.error("Toggle full booking error:", e);
            showToast("❌ Failed to toggle: " + e.message);
        }
    } else {
        fullBookingState.enabled = newState;
        updateFullBookingUI();
        showToast("Updated locally.");
    }
}

export async function sendFullBookingAutoReply(custId, meta = {}) {
    if (!custId || !db) return false;
    if (!fullBookingState.enabled) return false;

    // Strict category filtering: inbox only (NEVER catering or followup)
    const folder = (meta.folder || 'inbox').toLowerCase();
    if (folder !== 'inbox') return false;
    if (meta.cateredByRiderId || meta.cateredByRiderName) return false;

    const rawLastMsg = (meta.lastMessage || '').trim();
    if (!rawLastMsg || rawLastMsg.startsWith('You:') || rawLastMsg.toLowerCase() === 'no messages yet') {
        return false;
    }

    const replyText = fullBookingState.message || DEFAULT_FULL_BOOKING_MESSAGE;
    const now = Date.now();

    // Perform atomic transaction on metadata to ensure only ONE client dispatches the auto-reply!
    let committed = false;
    try {
        const tx = await db.ref(`customerChats/${custId}/metadata`).transaction((current) => {
            if (!current) return current;
            const curFolder = (current.folder || 'inbox').toLowerCase();
            if (curFolder !== 'inbox') return;
            if (current.cateredByRiderId || current.cateredByRiderName) return;

            const curLastMsg = (current.lastMessage || '').trim();
            if (curLastMsg.startsWith('You:')) return;

            const lastReplied = current.fullBookingRepliedAt || 0;
            const lastUpdated = current.lastUpdated || 0;
            if (lastReplied && lastReplied >= lastUpdated) return;

            // Commit atomic update
            current.fullBookingRepliedAt = now;
            current.unreadForRider = false;
            current.lastMessage = `You: ${replyText}`;
            return current;
        });
        committed = Boolean(tx && tx.committed && tx.snapshot.val());
    } catch (txErr) {
        console.warn("Full booking metadata tx error for " + custId, txErr);
    }

    if (!committed) {
        return false;
    }

    const targetChannel = meta.channel || (custId.startsWith('fb_') || custId.startsWith('messenger_') ? 'messenger' : 'web');
    const targetApiId = meta.apiId || meta.channelId || meta.fbApiId || null;

    const newMsg = {
        sender: "Lokalex Auto-Reply",
        senderType: 'system',
        text: replyText,
        timestamp: now,
        isRider: true,
        status: 'sent',
        channel: targetChannel,
        apiId: targetApiId,
        isAutoReply: true,
        deliveredAt: null,
        seenAt: null
    };

    try {
        await db.ref(`customerChats/${custId}/messages`).push(sanitizeForFirebase(newMsg));
        await db.ref(`customerChatMeta/${custId}`).update(sanitizeForFirebase({
            lastMessage: `You: ${replyText}`,
            lastUpdated: now,
            unreadForRider: false,
            fullBookingRepliedAt: now
        }));

        if (targetChannel === 'messenger' || String(custId).startsWith('fb_')) {
            forwardRiderReplyToMessenger({
                custId: custId,
                apiId: targetApiId,
                text: replyText,
                riderName: "Lokalex Auto-Reply"
            });
        }
        return true;
    } catch (e) {
        console.error("Failed pushing full booking auto-reply message to " + custId, e);
        return false;
    }
}

export async function scanAndAutoReplyWaitingInboxCustomers() {
    if (!fullBookingState.enabled || !db) return;
    try {
        const snap = await db.ref('customerChatMeta').once('value');
        const data = snap.val() || {};
        const entries = Object.entries(data);

        for (const [id, item] of entries) {
            const meta = item.metadata || item;
            const folder = (meta.folder || 'inbox').toLowerCase();
            if (folder === 'inbox' && !meta.cateredByRiderId && !meta.cateredByRiderName) {
                const lastMsg = (meta.lastMessage || '').trim();
                if (lastMsg && !lastMsg.startsWith('You:') && lastMsg.toLowerCase() !== 'no messages yet') {
                    await sendFullBookingAutoReply(id, meta);
                }
            }
        }
    } catch (e) {
        console.warn("Scan waiting inbox for full booking error:", e);
    }
}

if (typeof window !== 'undefined') {
    window.openFullBookingModal = openFullBookingModal;
    window.closeFullBookingModal = closeFullBookingModal;
    window.saveFullBookingSettings = saveFullBookingSettings;
    window.toggleFullBookingMode = toggleFullBookingMode;
    window.resetFullBookingMessageDefault = resetFullBookingMessageDefault;
    window.initFullBookingListener = initFullBookingListener;
    window.updateFullBookingUI = updateFullBookingUI;
}

