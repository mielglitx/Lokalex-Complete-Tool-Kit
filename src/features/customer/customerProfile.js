// src/features/customer/customerProfile.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';
import { openSlideDeleteModal } from '../../ui/modals.js';

export let savedAddressesCache = {};
export let selectedAddressId = localStorage.getItem('lokalex_selected_address_id') || null;
export let checkoutPaymentMode = 'cod';
export let stagedCustomerAvatarData = '';

export function setSavedAddressesCache(data) {
    savedAddressesCache = data || {};
}

export function cleanFirebasePathKey(key) {
    return String(key || '').replace(/^#+/, '').replace(/[.#$\[\]\/]/g, '_').trim();
}

export function compressAvatarImageFile(file, maxDim = 250, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxDim) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    }
                } else {
                    if (height > maxDim) {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = (err) => reject(err);
            img.src = e.target.result;
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

// -------------------------------------------------------------
// PROFILE HEADER & EDIT MODAL
// -------------------------------------------------------------
export function renderCustomerHeaderProfile() {
    const custName = localStorage.getItem('customerName') || localStorage.getItem('lokalex_customer_name') || appState.customerName || "Customer";
    const custPhone = localStorage.getItem('customerPhone') || localStorage.getItem('lokalex_customer_email') || "No Contact";
    const avatarUrl = localStorage.getItem('customerAvatarUrl') || localStorage.getItem('lokalex_customer_avatar') || "";

    const nameEl = document.getElementById('cust-landing-name');
    const phoneEl = document.getElementById('cust-landing-email');
    const avatarImg = document.getElementById('cust-landing-avatar');
    const initialsEl = document.getElementById('cust-landing-initials');

    if (nameEl) nameEl.innerText = custName;
    if (phoneEl) phoneEl.innerText = custPhone;

    if (avatarImg && initialsEl) {
        if (avatarUrl) {
            avatarImg.src = avatarUrl;
            avatarImg.classList.remove('hidden');
            initialsEl.classList.add('hidden');
        } else {
            const initials = custName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            initialsEl.innerText = initials || "CU";
            initialsEl.classList.remove('hidden');
            avatarImg.classList.add('hidden');
        }
    }
}

export function openEditCustomerProfileModal() {
    const modal = document.getElementById('edit-customer-profile-modal');
    const nameInput = document.getElementById('cust-edit-name-input');
    const phoneInput = document.getElementById('cust-edit-phone-input');
    const urlInput = document.getElementById('cust-edit-avatar-url-input');
    const fileInput = document.getElementById('cust-avatar-file-input');

    const custName = localStorage.getItem('customerName') || localStorage.getItem('lokalex_customer_name') || appState.customerName || "";
    const custPhone = localStorage.getItem('customerPhone') || localStorage.getItem('lokalex_customer_email') || "";
    stagedCustomerAvatarData = localStorage.getItem('customerAvatarUrl') || localStorage.getItem('lokalex_customer_avatar') || "";

    if (nameInput) nameInput.value = custName;
    if (phoneInput) phoneInput.value = custPhone;
    if (urlInput) urlInput.value = stagedCustomerAvatarData.startsWith('data:image') ? '' : stagedCustomerAvatarData;
    if (fileInput) fileInput.value = '';

    updateCustomerAvatarModalPreview(stagedCustomerAvatarData, custName);

    if (modal) modal.classList.remove('hidden');
}

export function closeEditCustomerProfileModal() {
    const modal = document.getElementById('edit-customer-profile-modal');
    if (modal) modal.classList.add('hidden');
}

export function updateCustomerAvatarModalPreview(urlOrBase64, name = "") {
    const previewImg = document.getElementById('cust-modal-avatar-preview');
    const initialsEl = document.getElementById('cust-modal-avatar-initials');
    if (!previewImg || !initialsEl) return;

    if (urlOrBase64) {
        previewImg.src = urlOrBase64;
        previewImg.classList.remove('hidden');
        initialsEl.classList.add('hidden');
    } else {
        const initials = (name || "Customer").split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        initialsEl.innerText = initials;
        initialsEl.classList.remove('hidden');
        previewImg.classList.add('hidden');
    }
}

export async function handleCustomerAvatarFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    showToast("⏳ Processing image...");

    try {
        const compressedBase64 = await compressAvatarImageFile(file, 250, 0.85);
        stagedCustomerAvatarData = compressedBase64;

        const urlInput = document.getElementById('cust-edit-avatar-url-input');
        if (urlInput) urlInput.value = '';

        updateCustomerAvatarModalPreview(stagedCustomerAvatarData);
        showToast("✅ Photo selected!");
    } catch(e) {
        showToast("❌ Failed to process image.");
    }
}

export function onCustomerAvatarUrlInput(url) {
    stagedCustomerAvatarData = (url || '').trim();
    updateCustomerAvatarModalPreview(stagedCustomerAvatarData);
}

export function clearCustomerAvatar() {
    stagedCustomerAvatarData = '';
    const urlInput = document.getElementById('cust-edit-avatar-url-input');
    const fileInput = document.getElementById('cust-avatar-file-input');

    if (urlInput) urlInput.value = '';
    if (fileInput) fileInput.value = '';

    updateCustomerAvatarModalPreview('');
    showToast("🗑️ Photo cleared.");
}

export async function submitSaveCustomerProfile() {
    let rawCustId = localStorage.getItem('lokalex_customer_fb_id') || localStorage.getItem('customerId') || appState.customerFacebookId || appState.customerId;
    if (!rawCustId) {
        rawCustId = `CUST_${Date.now().toString(36).toUpperCase()}`;
        localStorage.setItem('lokalex_customer_fb_id', rawCustId);
        appState.customerFacebookId = rawCustId;
    }

    const name = document.getElementById('cust-edit-name-input')?.value.trim();
    const phone = document.getElementById('cust-edit-phone-input')?.value.trim();

    if (!name) return showToast("⚠️ Name is required!");
    if (!phone) return showToast("⚠️ Contact number is required!");

    const saveBtn = document.getElementById('cust-save-profile-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        localStorage.setItem('customerName', name);
        localStorage.setItem('lokalex_customer_name', name);
        localStorage.setItem('customerPhone', phone);
        localStorage.setItem('lokalex_customer_email', phone);
        localStorage.setItem('customerAvatarUrl', stagedCustomerAvatarData || '');
        localStorage.setItem('lokalex_customer_avatar', stagedCustomerAvatarData || '');

        appState.customerName = name;

        if (db && rawCustId) {
            const custId = cleanFirebasePathKey(rawCustId);
            await db.ref(`customers/${custId}`).update({
                name,
                phoneNumber: phone,
                avatarUrl: stagedCustomerAvatarData || null,
                updatedAt: Date.now()
            });

            await db.ref(`customerChats/${custId}/metadata`).update({
                customerName: name,
                avatarUrl: stagedCustomerAvatarData || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0084FF&color=fff`
            }).catch(() => {});
        }

        renderCustomerHeaderProfile();
        closeEditCustomerProfileModal();
        showToast("✅ Profile updated successfully!");
    } catch(e) {
        showToast("❌ Failed to update profile.");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> SAVE PROFILE`;
        }
    }
}

// -------------------------------------------------------------
// SAVED MULTI-ADDRESS BOOK & CHECKOUT SELECTOR
// -------------------------------------------------------------
export function openAddressBookModal() {
    const modal = document.getElementById('cust-address-book-modal');
    if (modal) modal.classList.remove('hidden');
    renderSavedAddressesList();
}

export function closeAddressBookModal() {
    const modal = document.getElementById('cust-address-book-modal');
    if (modal) modal.classList.add('hidden');
}

export function setAddressLabelPreset(label) {
    const input = document.getElementById('new-addr-label');
    if (input) input.value = label;
}

export function renderSavedAddressesList() {
    const container = document.getElementById('cust-saved-addresses-list');
    if (!container) return;

    const entries = Object.entries(savedAddressesCache || {});
    if (entries.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-400 italic py-6 text-xs">No saved addresses yet. Add one below!</div>`;
        return;
    }

    container.innerHTML = entries.map(([id, addr]) => {
        const isSelected = selectedAddressId === id;
        return `
        <div onclick="window.selectAddressForCheckout('${id}')" class="p-2.5 rounded-2xl border ${isSelected ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20' : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-cardBg'} flex items-start justify-between gap-2 cursor-pointer transition active:scale-[0.99] shadow-xs">
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 font-black text-xs text-gray-900 dark:text-white">
                    <i class="fa-solid fa-location-dot text-emerald-500 text-[10px]"></i>
                    <span class="truncate">${escapeHtml(addr.label || 'Address')}</span>
                    ${isSelected ? '<span class="bg-emerald-600 text-white text-[8px] font-black px-1.5 py-0.2 rounded-full">ACTIVE</span>' : ''}
                </div>
                <div class="text-[11px] text-gray-700 dark:text-gray-300 font-medium mt-0.5 truncate">${escapeHtml(addr.addressText || '')}</div>
                ${addr.landmark ? `<div class="text-[9.5px] text-gray-500 dark:text-gray-400 italic mt-0.5">Note: "${escapeHtml(addr.landmark)}"</div>` : ''}
            </div>
            <button type="button" onclick="event.stopPropagation(); window.deleteSavedAddress('${id}', '${escapeHtml(addr.label || 'Address')}')" class="text-gray-400 hover:text-red-500 p-1 text-xs" title="Delete Address">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>`;
    }).join('');
}

export function selectAddressForCheckout(id) {
    selectedAddressId = id;
    localStorage.setItem('lokalex_selected_address_id', id);
    renderSavedAddressesList();
    updateCheckoutSelectedAddressUI();
    closeAddressBookModal();
    showToast("📍 Delivery address selected!");
}

export function updateCheckoutSelectedAddressUI() {
    const box = document.getElementById('checkout-selected-address-box');
    if (!box) return;

    if (selectedAddressId && savedAddressesCache[selectedAddressId]) {
        const addr = savedAddressesCache[selectedAddressId];
        box.innerHTML = `
            <div class="font-bold text-gray-900 dark:text-white flex items-center gap-1">
                <span>${escapeHtml(addr.label || 'Delivery Address')}</span>
            </div>
            <div class="text-[10px] text-gray-600 dark:text-gray-300 truncate">${escapeHtml(addr.addressText || '')}</div>
        `;
    } else {
        const firstAddr = Object.values(savedAddressesCache)[0];
        if (firstAddr) {
            box.innerHTML = `
                <div class="font-bold text-gray-900 dark:text-white">${escapeHtml(firstAddr.label || 'Address')}</div>
                <div class="text-[10px] text-gray-600 dark:text-gray-300 truncate">${escapeHtml(firstAddr.addressText || '')}</div>
            `;
        } else {
            box.innerHTML = `<span class="text-gray-400 italic">No address selected. Tap Change to pick.</span>`;
        }
    }
}

export async function submitSaveNewAddress() {
    const label = document.getElementById('new-addr-label')?.value.trim() || "Address";
    const addressText = document.getElementById('new-addr-text')?.value.trim();
    const landmark = document.getElementById('new-addr-landmark')?.value.trim();

    if (!addressText) return showToast("⚠️ Address description is required!");

    let rawCustId = localStorage.getItem('lokalex_customer_fb_id') || localStorage.getItem('customerId') || appState.customerFacebookId;
    const custId = cleanFirebasePathKey(rawCustId);
    const addrId = `ADDR_${Date.now().toString(36).toUpperCase()}`;

    const newAddrObj = {
        id: addrId,
        label,
        addressText,
        landmark: landmark || "",
        lat: appState.lat || 15.6881,
        lng: appState.lon || 120.4144,
        createdAt: Date.now()
    };

    if (db && custId) {
        await db.ref(`customers/${custId}/savedAddresses/${addrId}`).set(newAddrObj);
    }

    selectedAddressId = addrId;
    localStorage.setItem('lokalex_selected_address_id', addrId);

    const lInput = document.getElementById('new-addr-label');
    const aInput = document.getElementById('new-addr-text');
    const lmInput = document.getElementById('new-addr-landmark');
    if (lInput) lInput.value = '';
    if (aInput) aInput.value = '';
    if (lmInput) lmInput.value = '';

    showToast("✅ Delivery Address saved!");
    renderSavedAddressesList();
    updateCheckoutSelectedAddressUI();
}

export function deleteSavedAddress(id, label) {
    let rawCustId = localStorage.getItem('lokalex_customer_fb_id') || localStorage.getItem('customerId') || appState.customerFacebookId;
    const custId = cleanFirebasePathKey(rawCustId);

    openSlideDeleteModal(`Delete address [${label}]?`, async () => {
        if (db && custId) {
            await db.ref(`customers/${custId}/savedAddresses/${id}`).remove();
        }
        if (selectedAddressId === id) {
            selectedAddressId = null;
            localStorage.removeItem('lokalex_selected_address_id');
        }
        showToast("🗑️ Address removed.");
        renderSavedAddressesList();
        updateCheckoutSelectedAddressUI();
    });
}

export function setCheckoutPaymentMode(mode) {
    checkoutPaymentMode = mode;
    const codBtn = document.getElementById('pay-mode-cod');
    const gcashBtn = document.getElementById('pay-mode-gcash');

    if (mode === 'cod') {
        if (codBtn) codBtn.className = "px-2.5 py-1 rounded-lg font-bold text-[10px] bg-blue-600 text-white transition shadow-xs";
        if (gcashBtn) gcashBtn.className = "px-2.5 py-1 rounded-lg font-bold text-[10px] text-gray-500 dark:text-gray-400 hover:text-white transition";
    } else {
        if (gcashBtn) gcashBtn.className = "px-2.5 py-1 rounded-lg font-bold text-[10px] bg-blue-600 text-white transition shadow-xs";
        if (codBtn) codBtn.className = "px-2.5 py-1 rounded-lg font-bold text-[10px] text-gray-500 dark:text-gray-400 hover:text-white transition";
    }
}