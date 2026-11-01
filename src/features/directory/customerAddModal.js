// src/features/directory/customerAddModal.js

/**
 * ============================================================================
 * DEDICATED ADD CUSTOMER MODAL & AUTOMATED GPS ADDRESS SUB-MODAL
 * ============================================================================
 * 
 * Provides a dedicated, streamlined modal specifically for adding new customers
 * to the Customer Directory:
 * - Customer Name
 * - Contact#
 * - Add Address (Button) -> launches Add Address Sub-Modal
 *   - Address field
 *   - GPS Map Location (automatically calibrated and filled in on modal open)
 * - Saved Addresses list management (multiple addresses support)
 * - Auto-linking with active chat thread if triggered from Messenger/Live Chat
 * - Directory Registration Reward Credits Engine (+5 credits)
 */

import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { API_URL } from '../../config/constants.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { getLocalTodayStr } from '../../utils/helpers.js';
import { saveDirectoryCache } from './directoryStorage.js';
import { renderDirectoryList, updateRosterCreditsDisplay } from './directoryUi.js';

let newCustomerAddresses = [];

/**
 * Opens the dedicated Add Customer modal.
 * @param {Object} prefill - Optional prefill fields { name, contact, phone, address, lat_lon_link, locations }
 */
export function openAddCustomerModal(prefill = {}) {
    const modal = document.getElementById('add-customer-modal');
    if (!modal) return;

    newCustomerAddresses = [];

    const nameInput = document.getElementById('new-cust-name-input');
    const contactInput = document.getElementById('new-cust-contact-input');

    if (nameInput) nameInput.value = prefill.name || prefill.customerName || "";
    if (contactInput) contactInput.value = prefill.contact || prefill.phone || "";

    if (Array.isArray(prefill.locations) && prefill.locations.length > 0) {
        newCustomerAddresses = prefill.locations.map((loc, idx) => ({
            label: loc.label || (idx === 0 ? 'Main Address' : `Address ${idx + 1}`),
            address: loc.address || "",
            lat_lon_link: loc.lat_lon_link || loc.mapPinLink || "",
            isPrimary: loc.isPrimary !== undefined ? loc.isPrimary : (idx === 0)
        }));
    } else if (prefill.address || prefill.lat_lon_link) {
        newCustomerAddresses.push({
            label: 'Main Address',
            address: prefill.address || "",
            lat_lon_link: prefill.lat_lon_link || "",
            isPrimary: true
        });
    }

    renderNewCustomerAddressesList();
    modal.classList.remove('hidden');

    if (nameInput && !nameInput.value) {
        setTimeout(() => nameInput.focus(), 150);
    }
}

/**
 * Closes the dedicated Add Customer modal.
 */
export function closeAddCustomerModal() {
    const modal = document.getElementById('add-customer-modal');
    if (modal) modal.classList.add('hidden');
    newCustomerAddresses = [];
}

/**
 * Opens the Add Address sub-modal and automatically initiates GPS calibration.
 */
export async function openAddCustomerAddressModal() {
    const subModal = document.getElementById('add-customer-address-modal');
    if (!subModal) return;

    const labelInput = document.getElementById('new-cust-submodal-label');
    const addrInput = document.getElementById('new-cust-submodal-address');
    const gpsInput = document.getElementById('new-cust-submodal-gps');
    const statusEl = document.getElementById('new-cust-gps-status');

    if (labelInput) {
        labelInput.value = newCustomerAddresses.length === 0 ? "Main Address" : `Address ${newCustomerAddresses.length + 1}`;
    }
    if (addrInput) addrInput.value = "";
    if (gpsInput) gpsInput.value = "";
    if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Auto-detecting GPS...`;

    subModal.classList.remove('hidden');

    // Automatically fill in current GPS coordinates as soon as modal appears
    await calibrateSubmodalGPS();

    if (addrInput) {
        setTimeout(() => addrInput.focus(), 150);
    }
}

/**
 * Closes the Add Address sub-modal.
 */
export function closeAddCustomerAddressModal() {
    const subModal = document.getElementById('add-customer-address-modal');
    if (subModal) subModal.classList.add('hidden');
}

/**
 * Calibrates the rider's exact GPS coordinates and auto-fills the GPS Map Location input field.
 */
export async function calibrateSubmodalGPS() {
    const gpsInput = document.getElementById('new-cust-submodal-gps');
    const statusEl = document.getElementById('new-cust-gps-status');

    if (statusEl) {
        statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Getting GPS...`;
    }

    let lat = appState.lat || null;
    let lon = appState.lon || null;

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
        try {
            const pos = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 5000,
                    maximumAge: 10000
                });
            });
            if (pos && pos.coords) {
                lat = pos.coords.latitude;
                lon = pos.coords.longitude;
                appState.lat = lat;
                appState.lon = lon;
            }
        } catch (e) {
            console.warn('[AddCustomer] Geolocation acquisition error:', e);
        }
    }

    if (lat && lon) {
        const link = `https://maps.google.com/?q=${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
        if (gpsInput) gpsInput.value = link;
        if (statusEl) {
            statusEl.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-500"></i> GPS Auto-Filled`;
        }
        showToast("📍 Exact GPS coordinates auto-filled!");
    } else {
        if (statusEl) {
            statusEl.innerHTML = `<span class="text-amber-500"><i class="fa-solid fa-triangle-exclamation"></i> GPS unavailable</span>`;
        }
    }
}

/**
 * Confirms and adds the address from the submodal to the customer's addresses list.
 */
export function confirmAddCustomerAddress() {
    const labelInput = document.getElementById('new-cust-submodal-label');
    const addrInput = document.getElementById('new-cust-submodal-address');
    const gpsInput = document.getElementById('new-cust-submodal-gps');

    const address = (addrInput?.value || "").trim();
    const gps = (gpsInput?.value || "").trim();
    let label = (labelInput?.value || "").trim();

    if (!address && !gps) {
        showToast("⚠️ Please enter an Address or GPS location.");
        if (addrInput) addrInput.focus();
        return;
    }

    if (!label) {
        label = newCustomerAddresses.length === 0 ? "Main Address" : `Address ${newCustomerAddresses.length + 1}`;
    }

    const isPrimary = newCustomerAddresses.length === 0;

    newCustomerAddresses.push({
        label,
        address: address || (gps ? "GPS Location Pin" : ""),
        lat_lon_link: gps,
        isPrimary
    });

    closeAddCustomerAddressModal();
    renderNewCustomerAddressesList();
    showToast(`📍 Address "${label}" added!`);
}

/**
 * Renders the saved addresses cards in the Add Customer modal.
 */
export function renderNewCustomerAddressesList() {
    const container = document.getElementById('new-cust-addresses-list');
    const countLabel = document.getElementById('new-cust-addresses-count');
    if (!container) return;

    if (countLabel) countLabel.innerText = newCustomerAddresses.length;

    if (newCustomerAddresses.length === 0) {
        container.innerHTML = `
            <div id="new-cust-no-address-hint" class="text-center py-3 px-2 bg-gray-50 dark:bg-black/20 rounded-xl border border-dashed border-gray-300 dark:border-gray-800 text-gray-400 text-[11px]">
                No address added yet. Tap <strong>Add address</strong> below.
            </div>`;
        return;
    }

    container.innerHTML = newCustomerAddresses.map((loc, idx) => {
        const isPrimary = Boolean(loc.isPrimary);
        const hasGps = Boolean(loc.lat_lon_link);
        return `
            <div class="bg-gray-100 dark:bg-darkBg p-2.5 rounded-2xl border border-gray-200 dark:border-gray-800 flex items-start justify-between gap-2 shadow-xs transition">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${isPrimary ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-500/30' : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}">
                            ${loc.label || `Location ${idx + 1}`}
                        </span>
                        ${isPrimary ? '<span class="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-0.5"><i class="fa-solid fa-star text-[8px]"></i> Primary</span>' : ''}
                    </div>
                    <p class="text-xs font-bold text-gray-900 dark:text-white mt-1 break-words leading-tight">
                        ${loc.address || 'GPS Coordinates Pin'}
                    </p>
                    ${hasGps ? `
                    <div class="mt-1 flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 font-mono truncate font-medium">
                        <i class="fa-solid fa-location-crosshairs text-[9px] text-emerald-500 shrink-0"></i>
                        <span class="truncate">${loc.lat_lon_link}</span>
                    </div>` : ''}
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    ${!isPrimary ? `
                    <button type="button" onclick="window.setNewCustomerPrimaryAddress && window.setNewCustomerPrimaryAddress(${idx})" class="p-1.5 rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-bold transition active:scale-90" title="Set as primary address">
                        <i class="fa-regular fa-star"></i>
                    </button>` : ''}
                    <button type="button" onclick="window.removeNewCustomerAddress && window.removeNewCustomerAddress(${idx})" class="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-[10px] transition active:scale-90" title="Remove address">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>`;
    }).join('');
}

/**
 * Removes an address from the temporary new customer addresses list.
 */
export function removeNewCustomerAddress(index) {
    if (newCustomerAddresses[index]) {
        const wasPrimary = newCustomerAddresses[index].isPrimary;
        newCustomerAddresses.splice(index, 1);
        if (wasPrimary && newCustomerAddresses.length > 0) {
            newCustomerAddresses[0].isPrimary = true;
        }
        renderNewCustomerAddressesList();
        showToast("🗑️ Address removed.");
    }
}

/**
 * Sets an address as the primary address.
 */
export function setNewCustomerPrimaryAddress(index) {
    newCustomerAddresses.forEach((loc, idx) => {
        loc.isPrimary = (idx === index);
    });
    renderNewCustomerAddressesList();
    showToast(`⭐ Primary address updated to "${newCustomerAddresses[index]?.label || 'Address'}"`);
}

/**
 * Saves the new customer to Firebase Realtime Database and the local directory cache,
 * awards registration credits, and links back to the originating chat thread if applicable.
 */
export async function submitNewCustomerModal() {
    const nameInput = document.getElementById('new-cust-name-input');
    const contactInput = document.getElementById('new-cust-contact-input');
    const saveBtn = document.getElementById('new-cust-save-btn');

    const name = (nameInput?.value || "").trim();
    const contact = (contactInput?.value || "").trim();

    if (!name) {
        showToast("⚠️ Customer Name is required!");
        if (nameInput) nameInput.focus();
        return;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving Customer...`;
    }

    try {
        const currentDate = getLocalTodayStr();
        const primary = newCustomerAddresses.find(a => a.isPrimary) || newCustomerAddresses[0] || {};
        const persistenceKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');

        const primaryAddress = primary.address || "";
        const primaryGps = primary.lat_lon_link || "";

        const locations = newCustomerAddresses.length > 0 ? newCustomerAddresses : (primaryAddress || primaryGps ? [{
            label: 'Main Address',
            address: primaryAddress,
            lat_lon_link: primaryGps,
            isPrimary: true
        }] : []);

        const recordData = {
            name: name,
            contact: contact,
            address: primaryAddress,
            rate: primaryAddress,
            lat_lon_link: primaryGps,
            ...(locations.length > 0 ? { locations } : {}),
            type: 'customers',
            recorded_by: appState.riderName || localStorage.getItem('riderName') || "Rider",
            recorded_at: currentDate,
            originalName: name,
            compositeKey: persistenceKey
        };

        // Update local state
        if (!globalState.records) globalState.records = [];
        const existingIdx = globalState.records.findIndex(r => r.name.toLowerCase() === name.toLowerCase() && r.type === 'customers');
        if (existingIdx !== -1) {
            globalState.records[existingIdx] = recordData;
        } else {
            globalState.records.push(recordData);
        }

        saveDirectoryCache();

        // Write directly to Firebase
        if (db && persistenceKey) {
            await db.ref(`directory/customers/${persistenceKey}`).set(recordData).catch(e => console.warn('Firebase directory customer set warning:', e));
        }

        // Auto-link to originating chat thread if opened from chat
        const targetChatCustId = window._pendingLinkCustIdFromChat;
        if (targetChatCustId) {
            window._pendingLinkCustIdFromChat = null;
            if (typeof window.linkChatToDirectoryRecord === 'function') {
                window.linkChatToDirectoryRecord(targetChatCustId, recordData).catch(e => console.warn('Chat auto-link warning:', e));
            }
        }

        // Registration credits reward engine (+5 credits)
        const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
        const creditConfig = globalState.directoryCreditsConfig || { enabled: true, rewardCustomerRegistration: 5 };
        if (myId && creditConfig.enabled !== false) {
            const rewardAmt = creditConfig.rewardCustomerRegistration !== undefined ? creditConfig.rewardCustomerRegistration : 5;
            if (rewardAmt > 0) {
                const cur = parseInt(localStorage.getItem('lokalex_rider_credits') || "0", 10);
                const updated = cur + rewardAmt;
                localStorage.setItem('lokalex_rider_credits', updated.toString());
                appState.directoryCredits = updated;
                updateRosterCreditsDisplay(updated);

                if (db) {
                    db.ref(`riders/${myId}/directoryCredits`).transaction(c => (c || 0) + rewardAmt).catch(() => {});
                    db.ref(`roster/${myId}/directoryCredits`).transaction(c => (c || 0) + rewardAmt).catch(() => {});
                }
                showSideNotification("CREDITS REWARD", `+${rewardAmt} Credits for registering ${name}`, "fa-coins", "text-amber-400", "border-amber-500");
                showToast(`🎉 +${rewardAmt} Directory Credits earned! Total: ${updated}`);
            }
        }

        showToast(`✅ Customer "${name}" registered successfully!`);
        showSideNotification("CUSTOMER SAVED", `${name} added to Directory`, "fa-user-check", "text-emerald-400", "border-emerald-500");

        // Sync to backend Google Sheets API asynchronously
        try {
            fetch(API_URL, {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify({
                    type: 'customers',
                    action: 'add',
                    data: recordData
                })
            }).catch(() => {});
        } catch (_) {}

        closeAddCustomerModal();

        // Refresh directory list if active
        if (typeof renderDirectoryList === 'function') {
            renderDirectoryList();
        }

        // If customer details modal in chat is open, refresh it
        if (typeof window.refreshCustomerDetailsModalData === 'function') {
            window.refreshCustomerDetailsModalData(recordData);
        }
    } catch(err) {
        console.error('[AddCustomer] Save error:', err);
        showToast("❌ Failed to save customer: " + (err.message || err));
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> SAVE CUSTOMER`;
        }
    }
}

// Window bindings for seamless onclick attribute access in HTML
if (typeof window !== 'undefined') {
    window.openAddCustomerModal = openAddCustomerModal;
    window.closeAddCustomerModal = closeAddCustomerModal;
    window.openAddCustomerAddressModal = openAddCustomerAddressModal;
    window.closeAddCustomerAddressModal = closeAddCustomerAddressModal;
    window.calibrateSubmodalGPS = calibrateSubmodalGPS;
    window.confirmAddCustomerAddress = confirmAddCustomerAddress;
    window.renderNewCustomerAddressesList = renderNewCustomerAddressesList;
    window.removeNewCustomerAddress = removeNewCustomerAddress;
    window.setNewCustomerPrimaryAddress = setNewCustomerPrimaryAddress;
    window.submitNewCustomerModal = submitNewCustomerModal;
}

