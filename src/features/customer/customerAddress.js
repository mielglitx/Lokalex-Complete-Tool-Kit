// src/features/customer/customerAddress.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { openMapPicker } from '../maps.js';

export let savedAddressesCache = {};
export let selectedAddressId = null;
let activeAddressPreset = 'Home'; // 'Home' | 'Work' | 'Others'
let stagedPinData = { lat: null, lon: null, link: '', address: '' };

export function getSavedAddressesCache() {
    return savedAddressesCache;
}

export function setSavedAddressesCache(data) {
    savedAddressesCache = data || {};
    try {
        localStorage.setItem('lokalex_customer_saved_addresses', JSON.stringify(savedAddressesCache));
    } catch(e) {}
    updateAddressCountBadge();
}

function getCleanCustomerId() {
    const rawId = appState.customerFacebookId || 
                  localStorage.getItem('lokalex_customer_fb_id') || 
                  localStorage.getItem('customerId') || '';
    return rawId ? rawId.toString().replace(/[.#$[\]]/g, '_') : '';
}

export function updateAddressCountBadge() {
    const countEl = document.getElementById('cust-saved-addr-count');
    if (!countEl) return;
    const total = Object.keys(savedAddressesCache).length;
    countEl.innerText = total.toString();
}

export function openAddressBookModal() {
    const modal = document.getElementById('cust-address-book-modal');
    if (!modal) return;

    resetNewAddressForm();
    renderSavedAddressesList();
    modal.classList.remove('hidden');
}

export function closeAddressBookModal() {
    const modal = document.getElementById('cust-address-book-modal');
    if (modal) modal.classList.add('hidden');
}

export function setAddressLabelPreset(preset) {
    activeAddressPreset = preset;
    const btnHome = document.getElementById('addr-preset-home');
    const btnWork = document.getElementById('addr-preset-work');
    const btnOthers = document.getElementById('addr-preset-others');
    const customLabelWrapper = document.getElementById('new-addr-custom-label-wrapper');
    const labelInput = document.getElementById('new-addr-label');

    const activeClass = "bg-emerald-600 text-white border-emerald-500 shadow-xs";
    const inactiveClass = "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-emerald-500";

    if (btnHome) btnHome.className = `py-1.5 rounded-xl border text-[10px] font-bold transition ${preset === 'Home' ? activeClass : inactiveClass}`;
    if (btnWork) btnWork.className = `py-1.5 rounded-xl border text-[10px] font-bold transition ${preset === 'Work' ? activeClass : inactiveClass}`;
    if (btnOthers) btnOthers.className = `py-1.5 rounded-xl border text-[10px] font-bold transition ${preset === 'Others' ? activeClass : inactiveClass}`;

    if (preset === 'Others') {
        if (customLabelWrapper) customLabelWrapper.classList.remove('hidden');
        if (labelInput) {
            labelInput.value = '';
            labelInput.placeholder = "Enter custom name (e.g. Mom's House, Dorm, Gym)";
            labelInput.focus();
        }
    } else {
        if (customLabelWrapper) customLabelWrapper.classList.add('hidden');
        if (labelInput) labelInput.value = preset;
    }
}

export function openAddressMapPicker() {
    openMapPicker('customer-address');
}

export function renderSavedAddressesList() {
    const container = document.getElementById('cust-saved-addresses-list');
    if (!container) return;

    const list = Object.values(savedAddressesCache || {});
    updateAddressCountBadge();

    if (list.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-400 dark:text-gray-500 italic py-8 text-xs flex flex-col items-center gap-1.5">
                <i class="fa-solid fa-map-location-dot text-2xl opacity-40"></i>
                <span>No saved delivery addresses yet. Add your Home, Work, or custom location below!</span>
            </div>
        `;
        return;
    }

    // Sort default to top, then newest
    list.sort((a, b) => {
        if (a.isDefault) return -1;
        if (b.isDefault) return 1;
        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    container.innerHTML = list.map(item => {
        const isSelected = selectedAddressId === item.id;
        let iconHtml = '<i class="fa-solid fa-location-dot text-emerald-500"></i>';
        if (item.preset === 'Home' || item.label === 'Home') iconHtml = '<i class="fa-solid fa-house text-blue-500"></i>';
        else if (item.preset === 'Work' || item.label === 'Work') iconHtml = '<i class="fa-solid fa-briefcase text-purple-500"></i>';

        const defaultBadge = item.isDefault 
            ? `<span class="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 text-[9px] font-black px-1.5 py-0.2 rounded font-mono">DEFAULT</span>` 
            : '';

        const selectedBadge = isSelected
            ? `<span class="bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30 text-[9px] font-black px-1.5 py-0.2 rounded font-mono">SELECTED</span>`
            : '';

        const gpsBadge = (item.lat && item.lon) || item.link
            ? `<span class="text-[9px] text-emerald-600 dark:text-emerald-400 font-mono font-bold flex items-center gap-1"><i class="fa-solid fa-satellite-dish text-[8px]"></i> GPS Pinned</span>`
            : `<span class="text-[9px] text-gray-400 font-mono">No GPS link</span>`;

        const landmarkText = item.landmark 
            ? `<p class="text-[10px] text-gray-500 dark:text-gray-400 italic truncate"><i class="fa-solid fa-thumbtack text-[8px] mr-1 text-amber-500"></i>${escapeText(item.landmark)}</p>` 
            : '';

        return `
        <div class="bg-white dark:bg-cardBg border ${isSelected ? 'border-blue-500 dark:border-blue-500' : 'border-gray-200 dark:border-gray-800'} p-3 rounded-2xl flex flex-col gap-2 shadow-xs transition hover:border-emerald-500/50">
            <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <div class="w-8 h-8 rounded-xl bg-gray-100 dark:bg-black/40 flex items-center justify-center text-xs shrink-0">
                        ${iconHtml}
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="font-black text-xs text-gray-900 dark:text-white truncate">${escapeText(item.label || 'Saved Address')}</span>
                            ${defaultBadge}
                            ${selectedBadge}
                        </div>
                        <p class="text-[11px] text-gray-700 dark:text-gray-300 font-medium truncate mt-0.5">${escapeText(item.address || '')}</p>
                    </div>
                </div>

                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" onclick="window.deleteSavedAddress && window.deleteSavedAddress('${item.id}')" class="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-xs transition" title="Delete Address">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>

            ${landmarkText}

            <div class="flex items-center justify-between gap-2 pt-1 border-t border-gray-100 dark:border-gray-800/80">
                ${gpsBadge}
                
                <div class="flex items-center gap-1.5">
                    ${!item.isDefault ? `
                        <button type="button" onclick="window.setDefaultAddress && window.setDefaultAddress('${item.id}')" class="text-[10px] text-gray-500 dark:text-gray-400 hover:text-emerald-500 font-bold underline transition">
                            Make Default
                        </button>
                    ` : ''}

                    <button type="button" onclick="window.selectAddressForCheckout && window.selectAddressForCheckout('${item.id}')" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-600/20 dark:hover:bg-emerald-600/30 dark:text-emerald-300 dark:border-emerald-500/40 text-[10px] font-bold px-2.5 py-1 rounded-lg transition active:scale-95 flex items-center gap-1">
                        <i class="fa-solid fa-check text-[9px]"></i> Deliver Here
                    </button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

export function selectAddressForCheckout(addrId) {
    const addr = savedAddressesCache[addrId];
    if (!addr) return;

    selectedAddressId = addrId;
    updateCheckoutSelectedAddressUI();
    renderSavedAddressesList();
    closeAddressBookModal();
    showToast(`📍 Selected delivery pin: [${addr.label || 'Saved Address'}]`);
}

export function updateCheckoutSelectedAddressUI() {
    const box = document.getElementById('checkout-selected-address-box');
    if (!box) return;

    let addr = selectedAddressId ? savedAddressesCache[selectedAddressId] : null;

    if (!addr) {
        const list = Object.values(savedAddressesCache);
        addr = list.find(a => a.isDefault) || list[0] || null;
        if (addr) selectedAddressId = addr.id;
    }

    if (addr) {
        let icon = 'fa-location-dot text-red-500';
        if (addr.preset === 'Home' || addr.label === 'Home') icon = 'fa-house text-blue-500';
        else if (addr.preset === 'Work' || addr.label === 'Work') icon = 'fa-briefcase text-purple-500';

        box.innerHTML = `
            <div class="flex items-center justify-between gap-1.5">
                <span class="font-bold text-gray-900 dark:text-white flex items-center gap-1.5 truncate">
                    <i class="fa-solid ${icon}"></i> <span>${escapeText(addr.label)}:</span> 
                    <span class="font-normal text-gray-700 dark:text-gray-300 truncate">${escapeText(addr.address)}</span>
                </span>
                ${addr.landmark ? `<span class="text-[9px] text-amber-500 font-mono truncate">(${escapeText(addr.landmark)})</span>` : ''}
            </div>
        `;
    } else {
        box.innerHTML = `<span class="text-gray-400 italic">No address selected. Tap Change to pick or add one.</span>`;
    }
}

export async function submitSaveNewAddress() {
    const labelInput = document.getElementById('new-addr-label');
    const textInput = document.getElementById('new-addr-text');
    const landmarkInput = document.getElementById('new-addr-landmark');
    const saveBtn = document.getElementById('save-new-addr-btn');

    let label = (labelInput?.value || '').trim();
    if (!label) {
        if (activeAddressPreset === 'Others') {
            return showToast("⚠️ Paki-lagay ang pangalan ng custom address (hal. Mom's House)!");
        }
        label = activeAddressPreset;
    }

    const address = (textInput?.value || '').trim();
    if (!address) {
        return showToast("⚠️ Paki-lagay ang Street / Barangay / Municipality!");
    }

    const landmark = (landmarkInput?.value || '').trim();
    const custId = getCleanCustomerId();

    if (!custId) {
        return showToast("⚠️ Mangyaring mag-log in muna bilang customer!");
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        const addrId = `ADDR_${Date.now().toString(36).toUpperCase()}`;
        const isFirst = Object.keys(savedAddressesCache).length === 0;

        const payload = {
            id: addrId,
            label,
            preset: activeAddressPreset,
            address,
            landmark,
            lat: stagedPinData.lat,
            lon: stagedPinData.lon,
            link: stagedPinData.link || (stagedPinData.lat && stagedPinData.lon ? `https://maps.google.com/?q=${stagedPinData.lat},${stagedPinData.lon}` : ''),
            isDefault: isFirst,
            createdAt: Date.now()
        };

        if (db) {
            await db.ref(`customers/${custId}/savedAddresses/${addrId}`).set(payload);
        }

        savedAddressesCache[addrId] = payload;
        setSavedAddressesCache(savedAddressesCache);

        if (isFirst || !selectedAddressId) {
            selectedAddressId = addrId;
        }

        resetNewAddressForm();
        renderSavedAddressesList();
        updateCheckoutSelectedAddressUI();

        showToast(`✅ Saved [${label}] to your Delivery Address Book!`);
        showSideNotification("ADDRESS SAVED", `[${label}] ready for delivery selection`, "fa-location-dot", "text-emerald-400", "border-emerald-500");
    } catch(err) {
        showToast(`❌ Error: ${err.message || 'Failed to save address'}`);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Address`;
        }
    }
}

export function setDefaultAddress(addrId) {
    const custId = getCleanCustomerId();
    if (!savedAddressesCache[addrId] || !custId) return;

    Object.keys(savedAddressesCache).forEach(k => {
        savedAddressesCache[k].isDefault = (k === addrId);
    });

    setSavedAddressesCache(savedAddressesCache);

    if (db) {
        db.ref(`customers/${custId}/savedAddresses`).set(savedAddressesCache).catch(() => {});
    }

    selectedAddressId = addrId;
    renderSavedAddressesList();
    updateCheckoutSelectedAddressUI();
    showToast(`⭐ Set [${savedAddressesCache[addrId].label}] as default address!`);
}

export function deleteSavedAddress(addrId) {
    const addr = savedAddressesCache[addrId];
    if (!addr) return;

    openSlideDeleteModal(
        "Delete Delivery Address?",
        `Sigurado ka bang nais mong burahin ang [${addr.label || 'Saved Address'}]?`,
        async () => {
            const custId = getCleanCustomerId();
            delete savedAddressesCache[addrId];

            if (selectedAddressId === addrId) {
                const remaining = Object.values(savedAddressesCache);
                selectedAddressId = remaining.length > 0 ? remaining[0].id : null;
            }

            setSavedAddressesCache(savedAddressesCache);

            if (db && custId) {
                await db.ref(`customers/${custId}/savedAddresses/${addrId}`).remove().catch(() => {});
            }

            renderSavedAddressesList();
            updateCheckoutSelectedAddressUI();
            showToast("🗑️ Delivery address deleted.");
        }
    );
}

export function resetNewAddressForm() {
    setAddressLabelPreset('Home');
    stagedPinData = { lat: null, lon: null, link: '', address: '' };

    const textInput = document.getElementById('new-addr-text');
    const landmarkInput = document.getElementById('new-addr-landmark');
    const pinBadge = document.getElementById('new-addr-pin-badge');

    if (textInput) textInput.value = '';
    if (landmarkInput) landmarkInput.value = '';
    if (pinBadge) {
        pinBadge.innerText = "No pin set";
        pinBadge.className = "text-[9px] font-mono text-gray-400";
    }
}

function escapeText(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Global window event listener for Map Picker integration
if (typeof window !== 'undefined') {
    window.addEventListener('mapPickerSelected', (e) => {
        const data = e.detail;
        if (!data) return;

        const pinBadge = document.getElementById('new-addr-pin-badge');
        const textInput = document.getElementById('new-addr-text');

        if (data.lat !== undefined && data.lon !== undefined) {
            stagedPinData.lat = data.lat;
            stagedPinData.lon = data.lon;
            stagedPinData.link = `https://maps.google.com/?q=${data.lat.toFixed(6)},${data.lon.toFixed(6)}`;
            if (pinBadge) {
                pinBadge.innerText = `GPS: ${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}`;
                pinBadge.className = "text-[9px] font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30";
            }
        } else if (data.link) {
            stagedPinData.link = data.link;
            if (pinBadge) {
                pinBadge.innerText = "GPS Link Set";
                pinBadge.className = "text-[9px] font-mono font-bold text-emerald-600 dark:text-emerald-400";
            }
        }

        if (data.address && textInput && !textInput.value.trim()) {
            textInput.value = data.address;
        }
    });

    // Window attachments for inline HTML onclick attributes
    window.openAddressBookModal = openAddressBookModal;
    window.closeAddressBookModal = closeAddressBookModal;
    window.setAddressLabelPreset = setAddressLabelPreset;
    window.openAddressMapPicker = openAddressMapPicker;
    window.selectAddressForCheckout = selectAddressForCheckout;
    window.submitSaveNewAddress = submitSaveNewAddress;
    window.setDefaultAddress = setDefaultAddress;
    window.deleteSavedAddress = deleteSavedAddress;
}