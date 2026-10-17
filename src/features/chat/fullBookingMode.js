// src/features/chat/fullBookingMode.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { toggleBodyScroll } from './chatUtils.js';
import { forwardRiderReplyToMessenger } from './riderChat.js';
import { isAdmin, isTL, canManageRoster, hasTlPermission } from '../roster/rosterUtils.js';

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

export function canManageFullBooking() {
    if (typeof isAdmin === 'function' && isAdmin()) return true;
    if (typeof canManageRoster === 'function' && canManageRoster()) return true;
    if (typeof hasTlPermission === 'function' && hasTlPermission('canManageFullBooking')) return true;
    if (typeof isTL === 'function' && isTL()) return true;
    if (typeof window !== 'undefined') {
        if (window.isAdmin && window.isAdmin()) return true;
        if (window.canManageRoster && window.canManageRoster()) return true;
    }
    const myType = (appState.userType || localStorage.getItem('userType') || '').toLowerCase().trim();
    if (['admin', 'owner', 'manager', 'dispatcher', 'administrator', 'lead', 'tl'].includes(myType)) return true;
    if (globalState.adminControlsEnabled || localStorage.getItem('adminControlsEnabled') === 'true') return true;
    return false;
}

/**
 * Synchronously checks if any rider on the active roster is in 'Available' status (not on break, not catering, not clocked out).
 */
export function hasAvailableRiderOnRoster() {
    const roster = globalState.rosterMembers;
    if (!roster || !Array.isArray(roster) || roster.length === 0) return false;
    return roster.some(m => {
        if (!m) return false;
        const st = (m.status || '').trim().toLowerCase();
        const isBreak = Boolean(m.isBreak || st === 'break');
        return st === 'available' && !isBreak;
    });
}

/**
 * Asynchronously checks if ALL active riders on the roster are unavailable (Catering, Break, End, or no riders available).
 * If at least ONE rider is 'Available', returns FALSE (suppressing full booking auto-replies).
 * Only returns TRUE when ALL riders are unavailable (permitting full booking auto-replies).
 */
export async function checkAreAllRidersUnavailable() {
    let roster = globalState.rosterMembers;
    if (!roster || !Array.isArray(roster) || roster.length === 0) {
        if (db) {
            try {
                const snap = await db.ref('roster').once('value');
                const val = snap.val();
                if (val && typeof val === 'object') {
                    roster = Object.entries(val).map(([key, item]) => ({
                        ...item,
                        telegramId: (item.telegramId || item.id || key).toString().trim(),
                        id: (item.telegramId || item.id || key).toString().trim()
                    }));
                }
            } catch (_) {}
        }
    }

    if (!roster || !Array.isArray(roster) || roster.length === 0) {
        // No riders on roster -> all unavailable
        return true;
    }

    // Check if there is ANY available rider on the roster
    const hasAvailable = roster.some(m => {
        if (!m) return false;
        const st = (m.status || '').trim().toLowerCase();
        const isBreak = Boolean(m.isBreak || st === 'break');
        return st === 'available' && !isBreak;
    });

    // If there is an available rider, NOT all riders are unavailable -> return false
    return !hasAvailable;
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
    }, (err) => {
        console.warn("Full booking settings listener error:", err);
    });
}

export function updateFullBookingUI() {
    const banner = document.getElementById('full-booking-active-banner');
    const triggerBtn = document.getElementById('btn-full-booking-trigger');
    const adminActionBtn = document.getElementById('admin-full-booking-btn');
    const adminActions = document.getElementById('full-booking-admin-actions');
    const toggle = document.getElementById('admin-full-booking-toggle');
    const msgInput = document.getElementById('admin-full-booking-message-input');

    const canManage = canManageFullBooking();
    const hasAvailableRider = hasAvailableRiderOnRoster();

    // Trigger button in chat channel bar
    if (triggerBtn) {
        if (canManage) {
            triggerBtn.classList.remove('hidden');
            if (fullBookingState.enabled) {
                if (hasAvailableRider) {
                    triggerBtn.className = "bg-amber-600 hover:bg-amber-500 text-white border border-amber-500 text-[9px] font-black px-2.5 py-1 rounded-lg transition active:scale-95 flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs";
                    triggerBtn.innerHTML = `<i class="fa-solid fa-pause text-[9px]"></i> Full Booking: Standby`;
                } else {
                    triggerBtn.className = "bg-rose-600 hover:bg-rose-500 text-white border border-rose-500 text-[9px] font-black px-2.5 py-1 rounded-lg transition active:scale-95 flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs animate-pulse";
                    triggerBtn.innerHTML = `<i class="fa-solid fa-ban text-[9px]"></i> Full Booking: ON`;
                }
            } else {
                triggerBtn.className = "bg-white dark:bg-cardBg hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-gray-300 dark:border-gray-700 text-[9px] font-bold px-2 py-1 rounded-lg transition active:scale-95 flex items-center gap-1 shrink-0 cursor-pointer shadow-2xs";
                triggerBtn.innerHTML = `<i class="fa-solid fa-ban text-rose-500 text-[8px]"></i> Full Booking`;
            }
        } else {
            triggerBtn.classList.add('hidden');
        }
    }

    // Admin quick action button in Admin Controls
    if (adminActionBtn) {
        if (canManage) {
            adminActionBtn.classList.remove('hidden');
            if (fullBookingState.enabled) {
                if (hasAvailableRider) {
                    adminActionBtn.className = "bg-amber-600 text-white border border-amber-500 text-[9px] px-1.5 py-0.5 rounded-lg font-bold transition active:scale-95 flex items-center gap-1 cursor-pointer";
                    adminActionBtn.innerHTML = `<i class="fa-solid fa-pause"></i> Full Booking: Standby`;
                } else {
                    adminActionBtn.className = "bg-rose-600 text-white border border-rose-500 text-[9px] px-1.5 py-0.5 rounded-lg font-bold transition active:scale-95 flex items-center gap-1 cursor-pointer animate-pulse";
                    adminActionBtn.innerHTML = `<i class="fa-solid fa-ban"></i> Full Booking: ON`;
                }
            } else {
                adminActionBtn.className = "bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-600/30 dark:hover:bg-rose-600 dark:text-rose-300 dark:border-rose-500/50 text-[9px] px-1.5 py-0.5 rounded-lg font-bold transition active:scale-95 flex items-center gap-1 cursor-pointer";
                adminActionBtn.innerHTML = `<i class="fa-solid fa-ban"></i> Full Booking`;
            }
        } else {
            adminActionBtn.classList.add('hidden');
        }
    }

    // Active banner in chat feed area
    if (banner) {
        if (fullBookingState.enabled) {
            banner.classList.remove('hidden');
            if (adminActions) {
                if (canManage) adminActions.classList.remove('hidden');
                else adminActions.classList.add('hidden');
            }

            const bannerIconBox = document.getElementById('full-booking-banner-icon-box');
            const bannerIconI = document.getElementById('full-booking-banner-icon-i');
            const bannerTitle = document.getElementById('full-booking-banner-title');
            const bannerSubtext = document.getElementById('full-booking-banner-subtext');

            if (hasAvailableRider) {
                // Standby: Full booking is toggled ON, but there is at least one available rider
                banner.className = "bg-amber-500/10 border-b-2 border-amber-500/80 dark:border-amber-500/60 p-2.5 flex items-center justify-between gap-2 shadow-xs";
                if (bannerIconBox) bannerIconBox.className = "w-6 h-6 rounded-lg bg-amber-600 text-white flex items-center justify-center text-[10px] font-black shrink-0 shadow-xs";
                if (bannerIconI) bannerIconI.className = "fa-solid fa-pause";
                if (bannerTitle) {
                    bannerTitle.className = "text-xs font-black text-amber-700 dark:text-amber-300 flex items-center gap-1";
                    bannerTitle.innerHTML = `<i class="fa-solid fa-circle-pause text-amber-500"></i> Full Booking Standby (Rider Available)`;
                }
                if (bannerSubtext) {
                    bannerSubtext.className = "text-[10px] text-amber-700/90 dark:text-amber-400 font-medium truncate";
                    bannerSubtext.textContent = "Auto-reply paused while riders are available. Auto-replies only when all riders are Catering / Break.";
                }
            } else {
                // Active: All riders are unavailable (catering / break)
                banner.className = "bg-rose-500/10 border-b-2 border-rose-500/80 dark:border-rose-500/60 p-2.5 flex items-center justify-between gap-2 shadow-xs animate-pulse";
                if (bannerIconBox) bannerIconBox.className = "w-6 h-6 rounded-lg bg-rose-600 text-white flex items-center justify-center text-[10px] font-black shrink-0 shadow-xs";
                if (bannerIconI) bannerIconI.className = "fa-solid fa-ban";
                if (bannerTitle) {
                    bannerTitle.className = "text-xs font-black text-rose-700 dark:text-rose-300 flex items-center gap-1";
                    bannerTitle.innerHTML = `🛑 Full Booking Mode Active (All Unavailable)`;
                }
                if (bannerSubtext) {
                    bannerSubtext.className = "text-[10px] text-rose-600/90 dark:text-rose-400 font-medium truncate";
                    bannerSubtext.textContent = "All riders busy/break. Auto-replying to new inbox inquiries (catering & follow-up excluded).";
                }
            }
        } else {
            banner.classList.add('hidden');
        }
    }

    // Modal fields sync
    if (toggle) toggle.checked = Boolean(fullBookingState.enabled);
    if (msgInput && document.activeElement !== msgInput) {
        msgInput.value = fullBookingState.message || DEFAULT_FULL_BOOKING_MESSAGE;
    }
}

export function openFullBookingModal() {
    if (!canManageFullBooking()) {
        showToast("⚠️ Unauthorized: Only Admins can manage Full Booking Mode.");
        return;
    }
    const modal = document.getElementById('admin-full-booking-modal');
    if (!modal) return;

    const toggle = document.getElementById('admin-full-booking-toggle');
    const msgInput = document.getElementById('admin-full-booking-message-input');

    if (toggle) toggle.checked = Boolean(fullBookingState.enabled);
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
    if (!canManageFullBooking()) {
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

    // Optimistically update locally
    Object.assign(fullBookingState, payload);
    try {
        localStorage.setItem('lokalex_full_booking_settings', JSON.stringify(fullBookingState));
    } catch (_) {}
    updateFullBookingUI();

    if (db) {
        try {
            await db.ref('settings/fullBooking').set(payload);
            showToast(enabled ? "🛑 Full Booking Mode activated!" : "✅ Full Booking Mode disabled.");
        } catch (e) {
            console.error("Save full booking error:", e);
            showToast("❌ Error saving Full Booking settings: " + e.message);
        }
    } else {
        showToast("✅ Settings saved locally.");
    }
}

export async function toggleFullBookingMode(forceState = null) {
    if (!canManageFullBooking()) {
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

    // Optimistically update locally
    Object.assign(fullBookingState, payload);
    try {
        localStorage.setItem('lokalex_full_booking_settings', JSON.stringify(fullBookingState));
    } catch (_) {}
    updateFullBookingUI();

    if (db) {
        try {
            await db.ref('settings/fullBooking').set(payload);
            showToast(newState ? "🛑 Full Booking Mode is now ON!" : "✅ Full Booking Mode turned OFF.");
        } catch (e) {
            console.error("Toggle full booking error:", e);
            showToast("❌ Failed to toggle: " + e.message);
        }
    } else {
        showToast("Updated locally.");
    }
}

export async function sendFullBookingAutoReply(custId, meta = {}) {
    if (!custId || !db) return false;
    if (!fullBookingState.enabled) return false;

    // Availability Gate: If full booking is toggled ON but there is an available rider on the roster, DO NOT send!
    // Only send when ALL riders on the roster are unavailable (catering + break mode).
    const areAllUnavailable = await checkAreAllRidersUnavailable();
    if (!areAllUnavailable) {
        console.log(`[FullBooking] Auto-reply suppressed for ${custId}: Available rider(s) on roster.`);
        return false;
    }

    // 1. Strict catering check: If ANY rider is catering the customer, NEVER send full booking message!
    const isCatered = Boolean(
        meta.cateredByRiderId ||
        meta.cateredByRiderName ||
        meta.cateredBy ||
        (meta.folder && meta.folder.toLowerCase() === 'catering') ||
        (meta.folder && meta.folder.toLowerCase() === 'done') ||
        meta.status === 'completed' ||
        meta.status === 'done' ||
        meta.status === 'cancelled'
    );
    if (isCatered) return false;

    // Must be in inbox
    const folder = (meta.folder || 'inbox').toLowerCase();
    if (folder !== 'inbox') return false;

    // 2. Last message must be from customer (never reply to outgoing rider or system messages)
    const rawLastMsg = (meta.lastMessage || '').trim();
    if (!rawLastMsg || rawLastMsg.startsWith('You:') || rawLastMsg.toLowerCase() === 'no messages yet' || meta.unreadForRider === false) {
        return false;
    }

    const now = Date.now();
    const FIVE_MINUTES_MS = 5 * 60 * 1000;
    const preLastReplied = Number(meta.fullBookingRepliedAt) || 0;
    const preLastUpdated = Number(meta.lastUpdated) || 0;

    // 3. Strict 5-Minute Cooldown:
    // If a fullbooking reply was sent in the last 5 minutes, DO NOT reply again!
    if (preLastReplied && (now - preLastReplied < FIVE_MINUTES_MS)) {
        return false;
    }

    // 4. If already replied in the past (> 5 mins ago), the customer must have sent a NEW message AFTER that reply
    if (preLastReplied && preLastUpdated && preLastUpdated <= preLastReplied) {
        return false;
    }

    // 5. Freshness check: Do not auto-reply to stale messages older than 5 minutes
    if (preLastUpdated && (now - preLastUpdated > FIVE_MINUTES_MS)) {
        return false;
    }

    // 6. Fast in-memory check to prevent duplicate firing across concurrent triggers in same client
    if (typeof window !== 'undefined') {
        if (!window._activeFullBookingReplies) window._activeFullBookingReplies = new Set();
        if (window._activeFullBookingReplies.has(custId)) return false;
        window._activeFullBookingReplies.add(custId);
    }

    // 7. DISTRIBUTED ATOMIC TRANSACTION LOCK (Firebase Realtime Database)
    // Ensures across multiple connected devices (riders/admins) that ONLY ONE client acquires the lock and dispatches the reply!
    const lockRef = db.ref(`customerChatMeta/${custId}/fullBookingRepliedAt`);
    let lockAcquired = false;
    try {
        const txResult = await lockRef.transaction((currentVal) => {
            const lastReplied = Number(currentVal) || 0;
            const txNow = Date.now();
            if (lastReplied && (txNow - lastReplied < FIVE_MINUTES_MS)) {
                // Another device or server already replied within the 5-minute cooldown! Abort transaction.
                return undefined;
            }
            // Acquire lock by recording current timestamp
            return txNow;
        });
        lockAcquired = Boolean(txResult.committed && Number(txResult.snapshot?.val()) > 0);
    } catch (txErr) {
        console.warn(`[FullBooking] Transaction lock error for ${custId}:`, txErr);
        if (typeof window !== 'undefined' && window._activeFullBookingReplies) {
            window._activeFullBookingReplies.delete(custId);
        }
        return false;
    }

    if (!lockAcquired) {
        if (typeof window !== 'undefined' && window._activeFullBookingReplies) {
            window._activeFullBookingReplies.delete(custId);
        }
        return false;
    }

    // Final check before dispatch: ensure riders didn't become available during lock transaction
    const stillAllUnavailable = await checkAreAllRidersUnavailable();
    if (!stillAllUnavailable) {
        console.log(`[FullBooking] Auto-reply cancelled for ${custId}: Rider became available before message send.`);
        return false;
    }

    try {
        // Double-check latest live metadata from Firebase to guarantee thread wasn't catered in the last moment
        let liveMeta = meta;
        try {
            const snap = await db.ref(`customerChatMeta/${custId}`).once('value');
            if (snap.exists()) {
                liveMeta = { ...meta, ...snap.val() };
            }
        } catch (_) {}

        const liveIsCatered = Boolean(
            liveMeta.cateredByRiderId ||
            liveMeta.cateredByRiderName ||
            liveMeta.cateredBy ||
            (liveMeta.folder && liveMeta.folder.toLowerCase() === 'catering') ||
            (liveMeta.folder && liveMeta.folder.toLowerCase() === 'done') ||
            liveMeta.status === 'completed' ||
            liveMeta.status === 'done' ||
            liveMeta.status === 'cancelled'
        );
        if (liveIsCatered) return false;

        const liveFolder = (liveMeta.folder || 'inbox').toLowerCase();
        if (liveFolder !== 'inbox') return false;

        const liveLastMsg = (liveMeta.lastMessage || '').trim();
        if (!liveLastMsg || liveLastMsg.startsWith('You:') || liveLastMsg.toLowerCase() === 'no messages yet') {
            return false;
        }

        const replyText = (fullBookingState.message || DEFAULT_FULL_BOOKING_MESSAGE).trim();
        const sentTime = Date.now();
        const targetChannel = liveMeta.channel || (custId.startsWith('fb_') || custId.startsWith('messenger_') ? 'messenger' : 'web');
        const targetApiId = liveMeta.apiId || liveMeta.channelId || liveMeta.fbApiId || null;

        // Atomically commit metadata update in Firebase
        const metaUpdates = {
            fullBookingRepliedAt: sentTime,
            lastMessage: `You: ${replyText}`,
            lastUpdated: sentTime,
            unreadForRider: false
        };

        await Promise.all([
            db.ref(`customerChatMeta/${custId}`).update(metaUpdates),
            db.ref(`customerChats/${custId}/metadata`).update(metaUpdates).catch(() => {})
        ]);

        const newMsg = {
            sender: "Lokalex Auto-Reply",
            senderType: 'system',
            text: replyText,
            timestamp: sentTime,
            isRider: true,
            status: 'sent',
            channel: targetChannel,
            apiId: targetApiId,
            isAutoReply: true,
            deliveredAt: null,
            seenAt: null
        };

        await db.ref(`customerChats/${custId}/messages`).push(sanitizeForFirebase(newMsg));

        if (targetChannel === 'messenger' || String(custId).startsWith('fb_')) {
            await forwardRiderReplyToMessenger({
                custId: custId,
                apiId: targetApiId,
                text: replyText,
                riderName: "Lokalex Auto-Reply"
            });
        }
        console.log(`[FullBooking] Successfully sent single auto-reply to ${custId} (5-min cooldown active)`);
        return true;
    } catch (e) {
        console.error("Failed sending full booking auto-reply to " + custId, e);
        return false;
    } finally {
        setTimeout(() => {
            if (typeof window !== 'undefined' && window._activeFullBookingReplies) {
                window._activeFullBookingReplies.delete(custId);
            }
        }, 15000);
    }
}

export async function scanAndAutoReplyWaitingInboxCustomers() {
    if (!fullBookingState.enabled || !db) return;
    const areAllUnavailable = await checkAreAllRidersUnavailable();
    if (!areAllUnavailable) return;

    try {
        const snap = await db.ref('customerChatMeta').once('value');
        const data = snap.val() || {};
        const entries = Object.entries(data);
        const now = Date.now();

        for (const [id, item] of entries) {
            const meta = item.metadata || item;
            const folder = (meta.folder || 'inbox').toLowerCase();
            const isCatered = Boolean(meta.cateredByRiderId || meta.cateredByRiderName || meta.cateredBy);
            const msgTime = Number(meta.lastUpdated) || 0;

            // Only consider recent, un-catered messages received within the last 2 minutes
            if (folder === 'inbox' && !isCatered && msgTime && (now - msgTime < 2 * 60 * 1000)) {
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
    window.sendFullBookingAutoReply = sendFullBookingAutoReply;
    window.canManageFullBooking = canManageFullBooking;
    window.hasAvailableRiderOnRoster = hasAvailableRiderOnRoster;
    window.checkAreAllRidersUnavailable = checkAreAllRidersUnavailable;

    window.addEventListener('rosterUpdated', () => {
        if (fullBookingState.enabled) {
            updateFullBookingUI();
        }
    });
}

