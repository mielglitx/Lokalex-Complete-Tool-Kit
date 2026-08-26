// src/features/roster/rosterBookingLimits.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { isAdmin } from './rosterUtils.js';
import { sanitizeForFirebase } from './rosterSchedule.js';

export function openAdminBookingLimitsModal() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const modal = document.getElementById('admin-booking-limits-modal');
    const autoToggle = document.getElementById('admin-booking-limits-auto-toggle');
    const input = document.getElementById('admin-max-active-bookings');

    const config = globalState.bookingLimits || { autoEnabled: false, maxActiveBookings: 2 };
    
    if (autoToggle) {
        autoToggle.checked = Boolean(config.autoEnabled);
    }
    if (input) {
        input.value = (config.maxActiveBookings !== undefined && config.maxActiveBookings !== null) 
            ? config.maxActiveBookings 
            : 2;
    }

    toggleBookingLimitsModeUI(Boolean(config.autoEnabled));

    if (modal) modal.classList.remove('hidden');
}

export function closeAdminBookingLimitsModal() {
    const modal = document.getElementById('admin-booking-limits-modal');
    if (modal) modal.classList.add('hidden');
}

export function toggleBookingLimitsModeUI(isAuto) {
    const manualSection = document.getElementById('admin-booking-limits-manual-section');
    const autoSection = document.getElementById('admin-booking-limits-auto-section');
    if (manualSection && autoSection) {
        if (isAuto) {
            manualSection.classList.add('opacity-40', 'pointer-events-none');
            autoSection.classList.remove('opacity-40');
        } else {
            manualSection.classList.remove('opacity-40', 'pointer-events-none');
            autoSection.classList.add('opacity-40');
        }
    }
}

export async function saveAdminBookingLimitsSettings() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const autoToggle = document.getElementById('admin-booking-limits-auto-toggle');
    const input = document.getElementById('admin-max-active-bookings');

    const isAuto = autoToggle ? autoToggle.checked : false;
    const val = input ? parseInt(input.value) || 2 : 2;
    const maxVal = Math.max(1, val);

    const payload = sanitizeForFirebase({
        autoEnabled: Boolean(isAuto),
        maxActiveBookings: maxVal,
        updatedBy: appState.riderName || "Admin",
        updatedAt: Date.now()
    });

    globalState.bookingLimits = payload;
    try {
        localStorage.setItem('lokalex_booking_limits_cache', JSON.stringify(payload));
    } catch(e) {}

    try {
        if (db) {
            await db.ref('settings/bookingLimits').set(payload);
        }

        closeAdminBookingLimitsModal();
        if (isAuto) {
            showToast("⚙️ Auto Dynamic Booking Limits ENABLED (Activates when 3+ active riders are on duty)!");
            showSideNotification("AUTO LIMITS ACTIVE", "Scaled by gross income rank when 3+ riders are on duty", "fa-layer-group", "text-rose-400", "border-rose-500");
        } else {
            showToast(`⚙️ Fixed max active bookings per rider set to ${maxVal}!`);
            showSideNotification("BOOKING LIMIT SAVED", `Riders max simultaneous orders: ${maxVal}`, "fa-layer-group", "text-rose-400", "border-rose-500");
        }
    } catch(e) {
        console.error("Save booking limits error:", e);
        showToast("❌ Failed to save booking limits.");
    }
}

export function listenToBookingLimits() {
    if (!db) return;

    try {
        const cached = localStorage.getItem('lokalex_booking_limits_cache');
        if (cached) globalState.bookingLimits = JSON.parse(cached);
    } catch(e) {}

    db.ref('settings/bookingLimits').on('value', (snap) => {
        const data = snap.val();
        if (data) {
            globalState.bookingLimits = data;
            try {
                localStorage.setItem('lokalex_booking_limits_cache', JSON.stringify(data));
            } catch(e) {}
        }
    });
}