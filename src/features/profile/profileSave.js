// src/features/profile/profileSave.js
import { profileState } from './profileState.js';
import { appState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { stopBackgroundRosterGpsTracker } from '../auth/authGps.js';
import { closeProfileSettingsModal } from './profileUI.js';

export async function submitSaveProfileSettings() {
    const name = document.getElementById('prof-name-input')?.value.trim();
    const phone = document.getElementById('prof-phone-input')?.value.trim();
    const address = document.getElementById('prof-address-input')?.value.trim();
    const location = document.getElementById('prof-location-input')?.value.trim();
    const password = document.getElementById('prof-password-input')?.value.trim();
    const saveBtn = document.getElementById('prof-save-btn');

    if (!name) return showToast("⚠️ Name is required!");
    if (!phone) return showToast("⚠️ Mobile Number is required!");

    if (profileState.isPhoneModified && !profileState.isPhoneOtpVerified) {
        return showToast("⚠️ Binago mo ang mobile number. I-verify muna ito gamit ang OTP bago i-save!");
    }

    const formattedPhone = `+63${phone}`;
    let username = document.getElementById('prof-username-input')?.value.trim();

    // Unified username for customer based on verified phone number
    if (profileState.activeRole === 'customer') {
        username = formattedPhone;
    } else {
        if (!username) return showToast("⚠️ Username is required!");
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        if (!db) throw new Error("Database offline.");

        if (profileState.activeRole === 'customer') {
            const custId = appState.customerFacebookId || localStorage.getItem('lokalex_customer_fb_id') || `CUST_${Date.now()}`;
            const updates = {
                name,
                username: formattedPhone,
                phoneNumber: formattedPhone,
                phone: formattedPhone,
                address,
                location,
                photoUrl: profileState.currentAvatarUrl,
                updatedAt: Date.now()
            };
            if (password) updates.password = password;

            await db.ref(`customers/${custId}`).update(updates);

            appState.customerName = name;
            localStorage.setItem('lokalex_customer_name', name);
            localStorage.setItem('lokalex_customer_username', formattedPhone);
            localStorage.setItem('lokalex_customer_email', formattedPhone);
            localStorage.setItem('lokalex_customer_address', address);
            localStorage.setItem('lokalex_customer_pin_coords', location);
            localStorage.setItem('lokalex_customer_avatar', profileState.currentAvatarUrl);
        } else if (profileState.activeRole === 'merchant') {
            const accId = appState.merchantAccountId || localStorage.getItem('lokalex_merchant_account_id');
            const storeId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');

            if (accId) {
                const accUpdates = {
                    storeName: name,
                    username: username.toLowerCase(),
                    contact: formattedPhone,
                    photoUrl: profileState.currentAvatarUrl,
                    updatedAt: Date.now()
                };
                if (password) accUpdates.password = password;
                await db.ref(`storeAccounts/${accId}`).update(accUpdates);
            }

            if (storeId) {
                await db.ref(`stores/${storeId}`).update({
                    storeName: name,
                    address,
                    location,
                    coords: location,
                    contact: formattedPhone,
                    updatedAt: Date.now()
                });
            }

            appState.merchantStoreName = name;
            appState.merchantUsername = username;
            localStorage.setItem('lokalex_merchant_store_name', name);
            localStorage.setItem('lokalex_merchant_username', username);
            localStorage.setItem('lokalex_merchant_avatar', profileState.currentAvatarUrl);
        } else {
            // Rider
            const riderId = appState.telegramId || localStorage.getItem('telegramId');
            const updates = {
                name,
                riderName: name,
                phoneNumber: formattedPhone,
                phone: formattedPhone,
                address,
                photoUrl: profileState.currentAvatarUrl,
                updatedAt: Date.now()
            };
            if (password) updates.password = password;

            if (riderId) {
                await db.ref(`riders/${riderId}`).update(updates);
                await db.ref(`roster/${riderId}`).update({
                    name,
                    riderName: name,
                    photoUrl: profileState.currentAvatarUrl
                }).catch(() => {});
            }

            appState.riderName = name;
            appState.photoUrl = profileState.currentAvatarUrl;
            localStorage.setItem('riderName', name);
            localStorage.setItem('lokalex_photo_url', profileState.currentAvatarUrl);
            localStorage.setItem('lokalex_rider_phone', formattedPhone);
        }

        showToast("✅ Profile settings saved successfully!");
        showSideNotification("PROFILE UPDATED", "Account details successfully saved", "fa-check", "text-emerald-400", "border-emerald-500");

        closeProfileSettingsModal();

        const currentView = document.querySelector('main > section:not(.hidden)')?.id || 'view-home';
        if (window.renderViewUI) {
            window.renderViewUI(currentView);
        }
    } catch (err) {
        showToast(`❌ Error: ${err.message || "Failed to save profile changes"}`);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Changes`;
        }
    }
}

export function executeUniversalLogout() {
    try {
        if (stopBackgroundRosterGpsTracker && typeof stopBackgroundRosterGpsTracker === 'function') {
            stopBackgroundRosterGpsTracker();
        }
    } catch(e) {}

    // Clear Customer session keys
    localStorage.removeItem('lokalex_customer_fb_id');
    localStorage.removeItem('lokalex_customer_name');
    localStorage.removeItem('lokalex_customer_email');
    localStorage.removeItem('lokalex_customer_avatar');
    localStorage.removeItem('lokalex_customer_username');
    localStorage.removeItem('lokalex_customer_address');
    localStorage.removeItem('lokalex_customer_pin_coords');

    // Clear Merchant session keys
    localStorage.removeItem('lokalex_merchant_account_id');
    localStorage.removeItem('lokalex_merchant_store_id');
    localStorage.removeItem('lokalex_merchant_store_name');
    localStorage.removeItem('lokalex_merchant_username');
    localStorage.removeItem('lokalex_merchant_avatar');

    // Clear Rider session keys
    localStorage.removeItem('telegramId');
    localStorage.removeItem('riderName');
    localStorage.removeItem('userType');
    localStorage.removeItem('lokalex_photo_url');
    localStorage.removeItem('riderPhotoUrl');
    localStorage.removeItem('lokalex_rider_phone');

    // Reset runtime state
    appState.telegramId = null;
    appState.riderName = null;
    appState.customerFacebookId = null;
    appState.customerName = null;
    appState.merchantAccountId = null;
    appState.merchantStoreId = null;
    appState.merchantStoreName = null;
    appState.merchantUsername = null;

    closeProfileSettingsModal();
    showToast("👋 Logged out successfully.");

    if (window.switchView) {
        window.switchView('view-login', true, true);
    } else {
        location.reload();
    }
}   