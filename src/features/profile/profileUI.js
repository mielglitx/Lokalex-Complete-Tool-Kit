// src/features/profile/profileUI.js
import { profileState, getActiveSessionRole } from './profileState.js';
import { appState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { openMapPicker } from '../maps.js';

export async function openProfileSettingsModal() {
    profileState.activeRole = getActiveSessionRole();
    const modal = document.getElementById('profile-settings-modal');
    if (!modal) return;

    profileState.isPhoneModified = false;
    profileState.isPhoneOtpVerified = false;
    profileState.phoneConfirmationResult = null;

    const roleIcon = document.getElementById('prof-modal-role-icon');
    const modalTitle = document.getElementById('prof-modal-title');
    const modalSubtitle = document.getElementById('prof-modal-subtitle');
    const nameInput = document.getElementById('prof-name-input');
    const usernameWrapper = document.getElementById('prof-username-wrapper');
    const usernameInput = document.getElementById('prof-username-input');
    const phoneLabel = document.getElementById('prof-phone-label');
    const phoneInput = document.getElementById('prof-phone-input');
    const phoneBadge = document.getElementById('prof-phone-status-badge');
    const sendOtpBtn = document.getElementById('prof-send-otp-btn');
    const otpDrawer = document.getElementById('prof-otp-verify-drawer');
    const addressInput = document.getElementById('prof-address-input');
    const locationInput = document.getElementById('prof-location-input');
    const coordsBadge = document.getElementById('prof-coords-badge');
    const passwordInput = document.getElementById('prof-password-input');
    const avatarPreview = document.getElementById('prof-modal-avatar-preview');

    if (passwordInput) passwordInput.value = '';
    if (sendOtpBtn) sendOtpBtn.classList.add('hidden');
    if (otpDrawer) otpDrawer.classList.add('hidden');

    let initialName = '';
    let initialUsername = '';
    let initialPhone = '';
    let initialAddress = '';
    let initialLocation = '';
    let initialAvatar = '';

    if (profileState.activeRole === 'customer') {
        if (roleIcon) roleIcon.innerHTML = `<i class="fa-solid fa-user text-blue-500"></i>`;
        if (modalTitle) modalTitle.innerText = "Customer Account Settings";
        if (modalSubtitle) modalSubtitle.innerText = "Update profile, mobile number & delivery location";
        
        // Hide separate username input for customer accounts
        if (usernameWrapper) usernameWrapper.classList.add('hidden');
        if (phoneLabel) phoneLabel.innerText = "Mobile Number (Login Credential) *";

        const custId = appState.customerFacebookId || localStorage.getItem('lokalex_customer_fb_id') || '';
        initialName = appState.customerName || localStorage.getItem('lokalex_customer_name') || 'Customer';
        initialPhone = localStorage.getItem('lokalex_customer_email') || localStorage.getItem('phoneNumber') || '';
        initialAddress = localStorage.getItem('lokalex_customer_address') || '';
        initialLocation = localStorage.getItem('lokalex_customer_pin_coords') || '';
        initialAvatar = localStorage.getItem('lokalex_customer_avatar') || `https://ui-avatars.com/api/?name=${encodeURIComponent(initialName)}&background=10B981&color=fff&bold=true&size=128`;

        if (db && custId) {
            try {
                const snap = await db.ref(`customers/${custId}`).once('value');
                const val = snap.val();
                if (val) {
                    if (val.name) initialName = val.name;
                    if (val.phone || val.phoneNumber) initialPhone = val.phone || val.phoneNumber;
                    if (val.address) initialAddress = val.address;
                    if (val.location) initialLocation = val.location;
                    if (val.photoUrl) initialAvatar = val.photoUrl;
                }
            } catch (e) {}
        }
        initialUsername = initialPhone;
    } else if (profileState.activeRole === 'merchant') {
        if (roleIcon) roleIcon.innerHTML = `<i class="fa-solid fa-shop text-orange-500"></i>`;
        if (modalTitle) modalTitle.innerText = "Merchant Store Settings";
        if (modalSubtitle) modalSubtitle.innerText = "Manage store name, username, contact, and map pin";
        
        if (usernameWrapper) usernameWrapper.classList.remove('hidden');
        if (phoneLabel) phoneLabel.innerText = "Mobile Number (10 digits) *";

        const accId = appState.merchantAccountId || localStorage.getItem('lokalex_merchant_account_id') || '';
        const storeId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id') || '';
        initialName = appState.merchantStoreName || localStorage.getItem('lokalex_merchant_store_name') || 'My Store';
        initialUsername = appState.merchantUsername || localStorage.getItem('lokalex_merchant_username') || '';
        initialAvatar = localStorage.getItem('lokalex_merchant_avatar') || `https://ui-avatars.com/api/?name=${encodeURIComponent(initialName)}&background=ea580c&color=fff&bold=true&size=128`;

        if (db && (accId || storeId)) {
            try {
                if (accId) {
                    const accSnap = await db.ref(`storeAccounts/${accId}`).once('value');
                    const accVal = accSnap.val();
                    if (accVal) {
                        if (accVal.storeName) initialName = accVal.storeName;
                        if (accVal.username) initialUsername = accVal.username;
                        if (accVal.contact) initialPhone = accVal.contact;
                        if (accVal.photoUrl) initialAvatar = accVal.photoUrl;
                    }
                }
                if (storeId) {
                    const storeSnap = await db.ref(`stores/${storeId}`).once('value');
                    const sVal = storeSnap.val();
                    if (sVal) {
                        if (sVal.address) initialAddress = sVal.address;
                        if (sVal.location || sVal.coords) initialLocation = sVal.location || sVal.coords;
                    }
                }
            } catch (e) {}
        }
    } else {
        // Rider
        if (roleIcon) roleIcon.innerHTML = `<i class="fa-solid fa-motorcycle text-emerald-500"></i>`;
        if (modalTitle) modalTitle.innerText = "Rider Profile Settings";
        if (modalSubtitle) modalSubtitle.innerText = "Manage your rider details, contact, and settings";

        if (usernameWrapper) usernameWrapper.classList.remove('hidden');
        if (phoneLabel) phoneLabel.innerText = "Mobile Number (10 digits) *";

        const riderId = appState.telegramId || localStorage.getItem('telegramId') || '';
        initialName = appState.riderName || localStorage.getItem('riderName') || 'Rider';
        initialUsername = riderId;
        initialPhone = appState.phoneNumber || localStorage.getItem('lokalex_rider_phone') || '';
        initialAvatar = appState.photoUrl || localStorage.getItem('lokalex_photo_url') || `https://ui-avatars.com/api/?name=${encodeURIComponent(initialName)}&background=0284c7&color=fff&bold=true&size=128`;

        if (db && riderId) {
            try {
                const snap = await db.ref(`riders/${riderId}`).once('value');
                const val = snap.val();
                if (val) {
                    if (val.riderName || val.name) initialName = val.riderName || val.name;
                    if (val.phoneNumber || val.phone) initialPhone = val.phoneNumber || val.phone;
                    if (val.address) initialAddress = val.address;
                    if (val.photoUrl) initialAvatar = val.photoUrl;
                }
            } catch (e) {}
        }
    }

    const rawCleanPhone = initialPhone.replace(/\D/g, '');
    let displayPhone = rawCleanPhone;
    if (rawCleanPhone.startsWith('63') && rawCleanPhone.length === 12) {
        displayPhone = rawCleanPhone.substring(2);
    } else if (rawCleanPhone.startsWith('09') && rawCleanPhone.length === 11) {
        displayPhone = rawCleanPhone.substring(1);
    }

    profileState.originalPhoneNumber = displayPhone;
    profileState.currentAvatarUrl = initialAvatar;

    if (nameInput) nameInput.value = initialName;
    if (usernameInput) usernameInput.value = initialUsername;
    if (phoneInput) phoneInput.value = displayPhone;
    if (addressInput) addressInput.value = initialAddress;
    if (locationInput) locationInput.value = initialLocation;
    if (coordsBadge) coordsBadge.innerText = initialLocation ? "GPS Linked" : "Not set";
    if (avatarPreview) avatarPreview.src = initialAvatar;

    if (phoneBadge) {
        phoneBadge.innerText = displayPhone ? "Verified" : "Unverified";
        phoneBadge.className = displayPhone 
            ? "text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30"
            : "text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-500/30";
    }

    modal.classList.remove('hidden');
}

export function closeProfileSettingsModal() {
    const modal = document.getElementById('profile-settings-modal');
    if (modal) modal.classList.add('hidden');
}

export function togglePasswordVisibility(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (!input) return;

    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.className = 'fa-solid fa-eye-slash';
    } else {
        input.type = 'password';
        if (icon) icon.className = 'fa-solid fa-eye';
    }
}

export function openProfileMapPicker() {
    openMapPicker('profile-pin');
}

if (typeof window !== 'undefined') {
    window.addEventListener('mapPickerSelected', (e) => {
        const data = e.detail;
        if (!data) return;

        const locInput = document.getElementById('prof-location-input');
        const addrInput = document.getElementById('prof-address-input');
        const coordsBadge = document.getElementById('prof-coords-badge');

        if (locInput && (data.lat !== undefined && data.lon !== undefined)) {
            locInput.value = `${data.lat.toFixed(6)}, ${data.lon.toFixed(6)}`;
        } else if (locInput && data.link) {
            locInput.value = data.link;
        }

        if (addrInput && data.address && !addrInput.value) {
            addrInput.value = data.address;
        }

        if (coordsBadge) coordsBadge.innerText = "GPS Pinned";
    });
}