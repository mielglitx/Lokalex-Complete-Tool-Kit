// src/features/auth/authCustomer.js
import { appState } from '../../store/state.js';
import { db, auth } from '../../config/firebase.js';
import { showToast } from '../../ui/notifications.js';
import { listenToCustomerRiderChat } from '../chat/index.js';
import { formatPhoneNumber, validatePhilippineMobile, initRecaptcha } from './authUtils.js';

let confirmationResultObj = null;
let pendingRegUser = null;
let fpConfirmationResult = null;
let fpUserRef = null;
let profileUpdateConfirmationObj = null;
let newPendingPhoneNumber = "";

export async function openEditCustomerProfileModal() {
    const modal = document.getElementById('edit-customer-profile-modal');
    const uid = appState.customerFacebookId || localStorage.getItem('lokalex_customer_fb_id');
    if (!modal || !uid || !db) return;

    try {
        const snap = await db.ref(`customers/${uid}`).once('value');
        const data = snap.val() || {};

        document.getElementById('edit-cust-fullname').value = data.name || appState.customerName || "";
        document.getElementById('edit-cust-phone').value = data.phoneNumber || "";
        document.getElementById('edit-cust-address').value = data.address || "";
        document.getElementById('edit-cust-gps-link').value = data.mapPinLink || "";
        document.getElementById('edit-cust-lat').value = data.lat || "0";
        document.getElementById('edit-cust-lon').value = data.lng || "0";

        document.getElementById('edit-cust-otp-box')?.classList.add('hidden');
        document.getElementById('edit-cust-save-btn')?.classList.remove('hidden');

        modal.classList.remove('hidden');
    } catch (e) {
        showToast("⚠️ Could not load profile details.");
    }
}

export function closeEditCustomerProfileModal() {
    const modal = document.getElementById('edit-customer-profile-modal');
    if (modal) modal.classList.add('hidden');
}

export async function saveCustomerProfile() {
    const uid = appState.customerFacebookId || localStorage.getItem('lokalex_customer_fb_id');
    if (!uid || !db) return showToast("⚠️ Session missing. Please login again.");

    const newName = document.getElementById('edit-cust-fullname')?.value.trim();
    const newAddress = document.getElementById('edit-cust-address')?.value.trim();
    const newGpsLink = document.getElementById('edit-cust-gps-link')?.value.trim();
    const newLat = parseFloat(document.getElementById('edit-cust-lat')?.value) || 0;
    const newLon = parseFloat(document.getElementById('edit-cust-lon')?.value) || 0;
    const rawPhone = document.getElementById('edit-cust-phone')?.value.trim();

    if (!newName) return showToast("⚠️ Please enter your Full Name.");
    if (!newAddress) return showToast("⚠️ Please enter your Delivery Address.");
    if (!rawPhone) return showToast("⚠️ Please enter your Mobile Number.");

    const phoneCheck = validatePhilippineMobile(rawPhone);
    if (!phoneCheck.isValid) {
        return showToast(`⚠️ ${phoneCheck.message}`);
    }

    const formattedNewPhone = phoneCheck.formatted;

    const snap = await db.ref(`customers/${uid}`).once('value');
    const currentData = snap.val() || {};
    const oldPhone = currentData.phoneNumber || "";

    if (formattedNewPhone !== oldPhone) {
        sendProfileUpdateOTP(formattedNewPhone);
        return;
    }

    await executeProfileUpdate(uid, {
        name: newName,
        address: newAddress,
        mapPinLink: newGpsLink,
        lat: newLat,
        lng: newLon,
        phoneNumber: oldPhone
    });
}

async function sendProfileUpdateOTP(formattedPhone) {
    const saveBtn = document.getElementById('edit-cust-save-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending OTP...`;
    }

    try {
        const cleanPhoneKey = formattedPhone.replace(/[^0-9]/g, '');
        const phoneSnap = await db.ref(`phones/${cleanPhoneKey}`).once('value');
        if (phoneSnap.exists()) {
            throw new Error("🚫 The new mobile number is already registered to another account!");
        }

        initRecaptcha();
        profileUpdateConfirmationObj = await auth.signInWithPhoneNumber(formattedPhone, window.recaptchaVerifier);
        newPendingPhoneNumber = formattedPhone;

        showToast("📲 OTP Code sent to your new mobile number!");
        document.getElementById('edit-cust-otp-box')?.classList.remove('hidden');
        document.getElementById('edit-cust-save-btn')?.classList.add('hidden');
    } catch (e) {
        showToast(`❌ ${e.message || "Failed to send OTP"}`);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> SAVE PROFILE CHANGES`;
        }
    }
}

export async function verifyAndUpdatePhoneOTP() {
    const code = document.getElementById('edit-cust-otp-code')?.value.trim();
    if (!code || code.length < 6) return showToast("⚠️ Enter 6-digit OTP code!");
    if (!profileUpdateConfirmationObj || !newPendingPhoneNumber) return showToast("⚠️ Session expired.");

    const verifyBtn = document.getElementById('edit-cust-verify-otp-btn');
    if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying...`;
    }

    try {
        await profileUpdateConfirmationObj.confirm(code);
        const uid = appState.customerFacebookId || localStorage.getItem('lokalex_customer_fb_id');

        const newName = document.getElementById('edit-cust-fullname')?.value.trim();
        const newAddress = document.getElementById('edit-cust-address')?.value.trim();
        const newGpsLink = document.getElementById('edit-cust-gps-link')?.value.trim();
        const newLat = parseFloat(document.getElementById('edit-cust-lat')?.value) || 0;
        const newLon = parseFloat(document.getElementById('edit-cust-lon')?.value) || 0;

        const newCleanPhoneKey = newPendingPhoneNumber.replace(/[^0-9]/g, '');
        await db.ref(`phones/${newCleanPhoneKey}`).set({ uid: uid, phoneNumber: newPendingPhoneNumber });

        await executeProfileUpdate(uid, {
            name: newName,
            address: newAddress,
            mapPinLink: newGpsLink,
            lat: newLat,
            lng: newLon,
            phoneNumber: newPendingPhoneNumber
        });

    } catch (e) {
        showToast("❌ Invalid OTP Code.");
    } finally {
        if (verifyBtn) {
            verifyBtn.disabled = false;
            verifyBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> VERIFY & SAVE`;
        }
    }
}

async function executeProfileUpdate(uid, profileData) {
    if (db) {
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(profileData.name)}&background=10B981&color=fff`;
        profileData.avatarUrl = avatarUrl;

        await db.ref(`customers/${uid}`).update(profileData);
    }

    finalizeCustomerSession(uid, profileData.name, profileData.phoneNumber, profileData.avatarUrl);
    closeEditCustomerProfileModal();
    showToast("✅ Profile updated successfully!");
}

export async function sendCustomerRegisterOTP() {
    const phoneInput = document.getElementById('reg-phone-num')?.value.trim();
    if (!phoneInput) return showToast("⚠️ Paki-lagay ang iyong Mobile Number!");

    const phoneCheck = validatePhilippineMobile(phoneInput);
    if (!phoneCheck.isValid) {
        return showToast(`⚠️ ${phoneCheck.message}`);
    }

    const formattedPhone = phoneCheck.formatted;
    const cleanPhoneKey = phoneCheck.cleanKey;

    const sendBtn = document.getElementById('reg-send-otp-btn');
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking Number...`;
    }

    try {
        if (db) {
            const phoneSnap = await db.ref(`phones/${cleanPhoneKey}`).once('value');
            if (phoneSnap.exists()) {
                throw new Error("🚫 Ang Mobile Number na ito ay nakarehistro na! Paki-login na lamang.");
            }
        }

        if (sendBtn) {
            sendBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending OTP...`;
        }

        initRecaptcha();

        const confirmationResult = await auth.signInWithPhoneNumber(formattedPhone, window.recaptchaVerifier);
        confirmationResultObj = confirmationResult;
        showToast("📲 OTP Code sent via SMS!");
        document.getElementById('reg-otp-box')?.classList.remove('hidden');

    } catch (error) {
        console.error("Reg OTP Error:", error);
        showToast(`❌ Error: ${error.message || "Failed to send SMS"}`);
    } finally {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> SEND OTP CODE`;
        }
    }
}

export function verifyCustomerRegisterOTP() {
    const codeInput = document.getElementById('reg-otp-code')?.value.trim();
    if (!codeInput || codeInput.length < 6) return showToast("⚠️ Paki-lagay ang 6-digit OTP code!");
    if (!confirmationResultObj) return showToast("⚠️ Session expired. Paki-resend ng OTP.");

    const verifyBtn = document.getElementById('reg-verify-otp-btn');
    if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying...`;
    }

    confirmationResultObj.confirm(codeInput)
        .then((result) => {
            pendingRegUser = result.user;
            showToast("✅ OTP Verified! Kumpletuhin ang iyong detalye sa ibaba.");
            document.getElementById('reg-step-1')?.classList.add('hidden');
            document.getElementById('reg-step-2')?.classList.remove('hidden');
        })
        .catch((error) => {
            console.error("Verify OTP error:", error);
            showToast("❌ Mali ang OTP code. Subukan muli.");
            if (verifyBtn) {
                verifyBtn.disabled = false;
                verifyBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> VERIFY OTP CODE`;
            }
        });
}

export async function completeCustomerRegistration() {
    const fullName = document.getElementById('reg-fullname')?.value.trim();
    const address = document.getElementById('reg-address')?.value.trim();
    const email = document.getElementById('reg-email')?.value.trim();
    const password = document.getElementById('reg-password')?.value;
    const confirmPassword = document.getElementById('reg-confirm-password')?.value;
    const gpsLink = document.getElementById('reg-gps-link')?.value.trim();
    const regLat = parseFloat(document.getElementById('reg-lat')?.value) || 0;
    const regLon = parseFloat(document.getElementById('reg-lon')?.value) || 0;

    if (!fullName) return showToast("⚠️ Paki-lagay ang iyong Buong Pangalan!");
    if (!address) return showToast("⚠️ Paki-lagay ang iyong Delivery Address!");
    if (!gpsLink) return showToast("⚠️ Paki-pin ang iyong Exact GPS Location!");
    if (!password) return showToast("⚠️ Paki-lagay ang iyong Password!");
    if (password.length < 6) return showToast("⚠️ Ang Password ay dapat may 6 o higit pang characters!");
    if (password !== confirmPassword) return showToast("⚠️ Hindi nagtutugma ang Password at Ulitin ang Password!");

    if (!pendingRegUser) {
        const currentUser = auth.currentUser;
        if (currentUser) pendingRegUser = currentUser;
        else return showToast("⚠️ Phone verification session missing. Paki-subukan muli.");
    }

    const completeBtn = document.getElementById('reg-complete-btn');
    if (completeBtn) {
        completeBtn.disabled = true;
        completeBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Registering...`;
    }

    try {
        if (email && db) {
            const cleanEmailKey = email.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_');
            const emailSnap = await db.ref(`emails/${cleanEmailKey}`).once('value');
            if (emailSnap.exists()) {
                throw new Error("🚫 Ang Email Address na ito ay nakarehistro na! Gamitin ang ibang Email.");
            }
        }

        const uid = pendingRegUser.uid;
        const phone = pendingRegUser.phoneNumber || "";
        const cleanPhoneKey = phone.replace(/[^0-9]/g, '');
        const syntheticEmail = email || `${cleanPhoneKey}@lokalex.app`;
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=10B981&color=fff`;

        const emailCred = firebase.auth.EmailAuthProvider.credential(syntheticEmail, password);
        try {
            await pendingRegUser.linkWithCredential(emailCred);
        } catch (linkErr) {
            console.warn("Credential link fallback:", linkErr.message);
            if (pendingRegUser.updatePassword) {
                await pendingRegUser.updatePassword(password);
            }
        }

        const customerRecord = {
            type: "customer_account",
            uid: uid,
            name: fullName,
            phoneNumber: phone,
            address: address,
            email: email || "",
            loginEmail: syntheticEmail,
            mapPinLink: gpsLink,
            lat: regLat,
            lng: regLon,
            avatarUrl: avatarUrl,
            registeredAt: Date.now()
        };

        if (db) {
            await db.ref(`customers/${uid}`).set(customerRecord);
            await db.ref(`phones/${cleanPhoneKey}`).set({ uid: uid, phoneNumber: phone, loginEmail: syntheticEmail });
            if (email) {
                const cleanEmailKey = email.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_');
                await db.ref(`emails/${cleanEmailKey}`).set(uid);
            }
        }

        finalizeCustomerSession(uid, fullName, phone, avatarUrl);
        showToast("🎉 Registration Successful! Maligayang pagdating!");

    } catch (err) {
        console.error("Failed to complete registration:", err);
        showToast(`❌ ${err.message || "Failed to save profile"}`);
    } finally {
        if (completeBtn) {
            completeBtn.disabled = false;
            completeBtn.innerHTML = `<i class="fa-solid fa-user-check"></i> REGISTER ACCOUNT`;
        }
    }
}

export async function processCustomerLogin() {
    const phoneInput = document.getElementById('cust-login-phone')?.value.trim();
    const password = document.getElementById('cust-login-pass')?.value;

    if (!phoneInput || !password) {
        return showToast("⚠️ I-enter ang iyong Mobile Number at Password!");
    }

    const phoneCheck = validatePhilippineMobile(phoneInput);
    if (!phoneCheck.isValid) {
        return showToast(`⚠️ ${phoneCheck.message}`);
    }

    const formattedPhone = phoneCheck.formatted;
    const cleanPhoneKey = phoneCheck.cleanKey;

    const btn = document.getElementById('cust-login-submit-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...`;
    }

    try {
        let custData = null;

        if (db) {
            const phoneSnap = await db.ref(`phones/${cleanPhoneKey}`).once('value');
            const phoneRec = phoneSnap.val();
            let uid = phoneRec?.uid;

            if (uid) {
                const custSnap = await db.ref(`customers/${uid}`).once('value');
                custData = custSnap.val();
            } else {
                const snap = await db.ref('customers').orderByChild('phoneNumber').equalTo(formattedPhone).once('value');
                const val = snap.val();
                if (val) {
                    uid = Object.keys(val)[0];
                    custData = val[uid];
                }
            }
        }

        if (!custData) {
            throw new Error("🚫 Hindi nakarehistro ang mobile number na ito. Paki-register muna.");
        }

        const loginEmail = custData.loginEmail || custData.email || `${cleanPhoneKey}@lokalex.app`;
        
        const userCred = await auth.signInWithEmailAndPassword(loginEmail, password);
        finalizeCustomerSession(userCred.user.uid, custData.name, formattedPhone, custData.avatarUrl);

        showToast(`✅ Welcome back, ${custData.name}!`);

    } catch (err) {
        console.error("Login Error:", err);
        showToast(`❌ Login Failed: Mali ang Password o Mobile Number.`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> LOGIN`;
        }
    }
}

export function triggerForgotPassword() {
    const modal = document.getElementById('forgot-password-modal');
    if (modal) {
        modal.classList.remove('hidden');
        backToResetMethod();
    }
}

export function closeForgotPasswordModal() {
    const modal = document.getElementById('forgot-password-modal');
    if (modal) modal.classList.add('hidden');
}

export function backToResetMethod() {
    document.getElementById('fp-step-method')?.classList.remove('hidden');
    document.getElementById('fp-step-phone')?.classList.add('hidden');
    document.getElementById('fp-step-email')?.classList.add('hidden');
    document.getElementById('fp-step-otp')?.classList.add('hidden');
    document.getElementById('fp-step-newpass')?.classList.add('hidden');
}

export function selectResetMethod(method) {
    document.getElementById('fp-step-method')?.classList.add('hidden');
    if (method === 'sms') {
        document.getElementById('fp-step-phone')?.classList.remove('hidden');
    } else {
        document.getElementById('fp-step-email')?.classList.remove('hidden');
    }
}

export function sendResetSMS() {
    const phoneInput = document.getElementById('fp-phone-input')?.value.trim();
    if (!phoneInput) return showToast("⚠️ Paki-lagay ang iyong Mobile Number!");

    const phoneCheck = validatePhilippineMobile(phoneInput);
    if (!phoneCheck.isValid) {
        return showToast(`⚠️ ${phoneCheck.message}`);
    }

    const formattedPhone = phoneCheck.formatted;
    const sendBtn = document.getElementById('fp-send-sms-btn');

    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending SMS...`;
    }

    initRecaptcha();

    auth.signInWithPhoneNumber(formattedPhone, window.recaptchaVerifier)
        .then((confirmationResult) => {
            fpConfirmationResult = confirmationResult;
            showToast("📲 OTP Code sent via SMS!");
            document.getElementById('fp-step-phone')?.classList.add('hidden');
            document.getElementById('fp-step-otp')?.classList.remove('hidden');
        })
        .catch((error) => {
            console.error("Reset SMS error:", error);
            showToast(`❌ Error: ${error.message || "Failed to send SMS"}`);
        })
        .finally(() => {
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> SEND OTP CODE`;
            }
        });
}

export function sendResetEmailLink() {
    const emailInput = document.getElementById('fp-email-input')?.value.trim();
    if (!emailInput || !emailInput.includes('@')) return showToast("⚠️ Valid Email Address required!");

    const sendBtn = document.getElementById('fp-send-email-btn');
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending...`;
    }

    auth.sendPasswordResetEmail(emailInput)
        .then(() => {
            showToast("📧 Password reset link sent to your email!");
            closeForgotPasswordModal();
        })
        .catch((error) => {
            showToast(`❌ Error: ${error.message}`);
        })
        .finally(() => {
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> SEND RESET LINK`;
            }
        });
}

export function verifyResetOTP() {
    const code = document.getElementById('fp-otp-input')?.value.trim();
    if (!code || code.length < 6) return showToast("⚠️ Paki-lagay ang 6-digit OTP code!");

    const verifyBtn = document.getElementById('fp-verify-otp-btn');
    if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying...`;
    }

    if (!fpConfirmationResult) return showToast("⚠️ Session expired. Subukan muli.");

    fpConfirmationResult.confirm(code)
        .then((result) => {
            fpUserRef = result.user;
            showToast("✅ Code verified! Set your new password.");
            document.getElementById('fp-step-otp')?.classList.add('hidden');
            document.getElementById('fp-step-newpass')?.classList.remove('hidden');
        })
        .catch((error) => {
            showToast("❌ Mali ang OTP code.");
        })
        .finally(() => {
            if (verifyBtn) {
                verifyBtn.disabled = false;
                verifyBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> VERIFY CODE`;
            }
        });
}

export async function completePasswordReset() {
    const newPass = document.getElementById('fp-new-pass')?.value;
    const confirmPass = document.getElementById('fp-confirm-pass')?.value;

    if (!newPass || newPass.length < 6) return showToast("⚠️ Ang password ay dapat min 6 characters!");
    if (newPass !== confirmPass) return showToast("⚠️ Hindi nagtutugma ang password!");

    if (!fpUserRef) return showToast("⚠️ Session expired. Paki-subukan muli.");

    const saveBtn = document.getElementById('fp-save-pass-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Updating...`;
    }

    try {
        await fpUserRef.updatePassword(newPass);
        showToast("✅ Password updated successfully! Subukang mag-login.");
        closeForgotPasswordModal();
    } catch (err) {
        showToast(`❌ Error: ${err.message}`);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-lock"></i> UPDATE PASSWORD`;
        }
    }
}

export function finalizeCustomerSession(uid, name, phone, avatarUrl) {
    localStorage.setItem('lokalex_active_role', 'customer');
    localStorage.setItem('lokalex_customer_fb_id', uid);
    localStorage.setItem('lokalex_customer_name', name);
    localStorage.setItem('lokalex_customer_email', phone);
    localStorage.setItem('lokalex_customer_avatar', avatarUrl);

    // Clear conflicting rider and merchant credentials
    const conflictingKeys = [
        'telegramId', 'riderName', 'userType', 'riderPhotoUrl',
        'lokalex_photo_url', 'lokalex_rider_phone',
        'lokalex_merchant_account_id', 'lokalex_merchant_store_id',
        'lokalex_merchant_store_name', 'lokalex_merchant_username',
        'lokalex_merchant_avatar', 'merchantAccountId', 'merchantStoreId'
    ];
    conflictingKeys.forEach(key => localStorage.removeItem(key));

    appState.telegramId = null;
    appState.riderName = null;
    appState.userType = null;
    appState.merchantAccountId = null;
    appState.merchantStoreId = null;

    appState.customerFacebookId = uid;
    appState.customerName = name;

    const avatarImg = document.getElementById('cust-landing-avatar');
    const nameEl = document.getElementById('cust-landing-name');
    const emailEl = document.getElementById('cust-landing-email');

    if (avatarImg) avatarImg.src = avatarUrl;
    if (nameEl) nameEl.innerText = name;
    if (emailEl) emailEl.innerText = phone;

    if (typeof listenToCustomerRiderChat === 'function') {
        listenToCustomerRiderChat();
    }

    if (window.switchView) {
        window.switchView('view-customer-home');
    }
}