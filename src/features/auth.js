// src/features/auth.js
import { appState, globalState } from '../store/state.js';
import { ADMIN_IDS } from '../config/constants.js';
import { switchView, renderViewUI } from '../ui/router.js';
import { showToast, unlockAudioContext } from '../ui/notifications.js';
import { fetchGCashDetails } from '../ui/modals.js';
import { db, auth } from '../config/firebase.js';
import { listenToCustomerRiderChat } from './chat/index.js';
import { openMapPicker } from './maps.js';

let backgroundGpsWatchId = null;
let lastRosterGpsPushTime = 0;
const GPS_ROSTER_PULSE_MS = 30000;
let confirmationResultObj = null;
let pendingRegUser = null;
let fpConfirmationResult = null;
let fpUserRef = null;
let profileUpdateConfirmationObj = null;
let newPendingPhoneNumber = "";

let deferredPwaPrompt = null;

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPwaPrompt = e;
    });
}

// ============================================================================
// 1. UTILITY & HELPER FUNCTIONS
// ============================================================================
export function togglePasswordVisibility(inputId, iconId) {
    const inputEl = document.getElementById(inputId);
    const iconEl = document.getElementById(iconId);

    if (inputEl && iconEl) {
        if (inputEl.type === 'password') {
            inputEl.type = 'text';
            iconEl.className = 'fa-solid fa-eye-slash text-blue-400';
        } else {
            inputEl.type = 'password';
            iconEl.className = 'fa-solid fa-eye text-gray-400';
        }
    }
}

export function switchLoginPortalTab(mode) {
    const riderForm = document.getElementById('portal-form-rider');
    const custForm = document.getElementById('portal-form-customer');

    if (mode === 'rider') {
        if (riderForm) riderForm.classList.remove('hidden');
        if (custForm) custForm.classList.add('hidden');
    } else {
        if (custForm) custForm.classList.remove('hidden');
        if (riderForm) riderForm.classList.add('hidden');
    }
}

export function switchCustomerAuthTab(tabName) {
    const loginView = document.getElementById('auth-view-login');
    const regView = document.getElementById('auth-view-register');
    const tabLogin = document.getElementById('auth-tab-login');
    const tabReg = document.getElementById('auth-tab-register');

    if (tabName === 'login') {
        if (loginView) loginView.classList.remove('hidden');
        if (regView) regView.classList.add('hidden');
        if (tabLogin) tabLogin.className = "flex-1 py-2 rounded-xl bg-blue-600 text-white transition shadow";
        if (tabReg) tabReg.className = "flex-1 py-2 rounded-xl text-gray-400 hover:text-white transition";
    } else {
        if (regView) regView.classList.remove('hidden');
        if (loginView) loginView.classList.add('hidden');
        if (tabReg) tabReg.className = "flex-1 py-2 rounded-xl bg-emerald-600 text-white transition shadow";
        if (tabLogin) tabLogin.className = "flex-1 py-2 rounded-xl text-gray-400 hover:text-white transition";
    }
}

function formatPhoneNumber(phone) {
    let clean = (phone || '').replace(/[^0-9+]/g, '').trim();
    if (clean.startsWith('+')) return clean;
    if (clean.startsWith('09') && clean.length === 11) return '+63' + clean.substring(1);
    if (clean.startsWith('9') && clean.length === 10) return '+63' + clean;
    return '+' + clean;
}

function initRecaptcha() {
    if (!window.recaptchaVerifier) {
        try {
            window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
                'size': 'invisible',
                'callback': () => {}
            });
        } catch (e) {
            console.error("Recaptcha init error:", e);
        }
    }
}

export function isUserBlocked(idOrName) {
    if (!idOrName || !globalState.blockedUsers) return false;
    const clean = idOrName.toString().toLowerCase().trim();

    return Object.values(globalState.blockedUsers).some(b => {
        if (!b) return false;
        const bId = (b.id || "").toString().toLowerCase().trim();
        const bName = (b.name || "").toString().toLowerCase().trim();
        return (bId && bId === clean) || (bName && bName === clean);
    });
}

// ============================================================================
// 2. PWA INSTALLATION & CHAT LOCATION PIN LAUNCHER
// ============================================================================
export function installPwaApp() {
    if (deferredPwaPrompt) {
        deferredPwaPrompt.prompt();
        deferredPwaPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                showToast("🎉 Salamat sa pag-install ng Lokalex App!");
            }
            deferredPwaPrompt = null;
        });
    } else {
        const modal = document.getElementById('pwa-install-modal');
        if (modal) modal.classList.remove('hidden');
    }
}

export function closePwaInstallModal() {
    const modal = document.getElementById('pwa-install-modal');
    if (modal) modal.classList.add('hidden');
}

export function sendCustomerLocation() {
    openMapPicker('chat');
}

export function captureRegistrationGPS() {
    openMapPicker('registration');
}

export function captureEditProfileGPS() {
    openMapPicker('edit-profile');
}

// ============================================================================
// 3. EDIT CUSTOMER PROFILE & PHONE OTP VERIFICATION
// ============================================================================
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

    const formattedNewPhone = formatPhoneNumber(rawPhone);

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

// ============================================================================
// 4. CUSTOMER REGISTRATION
// ============================================================================
export async function sendCustomerRegisterOTP() {
    const phoneInput = document.getElementById('reg-phone-num')?.value.trim();
    if (!phoneInput) return showToast("⚠️ Paki-lagay ang iyong Mobile Number!");

    const formattedPhone = formatPhoneNumber(phoneInput);
    const cleanPhoneKey = formattedPhone.replace(/[^0-9]/g, '');

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

// ============================================================================
// 5. CUSTOMER LOGIN & FORGOT PASSWORD MODAL
// ============================================================================
export async function processCustomerLogin() {
    const phoneInput = document.getElementById('cust-login-phone')?.value.trim();
    const password = document.getElementById('cust-login-pass')?.value;

    if (!phoneInput || !password) {
        return showToast("⚠️ I-enter ang iyong Mobile Number at Password!");
    }

    const formattedPhone = formatPhoneNumber(phoneInput);
    const cleanPhoneKey = formattedPhone.replace(/[^0-9]/g, '');

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

    const formattedPhone = formatPhoneNumber(phoneInput);
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

function finalizeCustomerSession(uid, name, phone, avatarUrl) {
    localStorage.setItem('lokalex_customer_fb_id', uid);
    localStorage.setItem('lokalex_customer_name', name);
    localStorage.setItem('lokalex_customer_email', phone);
    localStorage.setItem('lokalex_customer_avatar', avatarUrl);

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

// ============================================================================
// 6. BAN & BLOCK LIST MANAGEMENT
// ============================================================================
export function openAdminBlockModal() {
    const modal = document.getElementById('admin-block-user-modal');
    const selectEl = document.getElementById('block-target-select');

    if (modal) {
        if (selectEl) {
            let riderMap = new Map();

            (globalState.rosterMembers || []).forEach(r => {
                const name = (r.riderName || r.name || "").trim();
                const id = (r.telegramId || r.id || name).toString().trim();
                if (name) riderMap.set(name.toLowerCase(), { id: id || name, name: name });
            });

            (globalState.globalLogins || []).forEach(l => {
                const name = (l.riderName || "").trim();
                if (name && !riderMap.has(name.toLowerCase())) {
                    riderMap.set(name.toLowerCase(), { id: name, name: name });
                }
            });

            if (globalState.userTypesMap) {
                Object.keys(globalState.userTypesMap).forEach(key => {
                    if (isNaN(key) && !riderMap.has(key.toLowerCase())) {
                        const cleanName = key.trim();
                        if (cleanName) riderMap.set(cleanName.toLowerCase(), { id: cleanName, name: cleanName });
                    }
                });
            }

            const cleanList = Array.from(riderMap.values()).sort((a,b) => a.name.localeCompare(b.name));

            let optionsHtml = '<option value="" disabled selected>-- Select Rider / User --</option>';
            cleanList.forEach(item => {
                optionsHtml += `<option value="${item.id}">${item.name}</option>`;
            });
            selectEl.innerHTML = optionsHtml;
        }

        modal.classList.remove('hidden');
        renderBlockedUsersList();
    }
}

export function closeAdminBlockModal() {
    const modal = document.getElementById('admin-block-user-modal');
    if (modal) modal.classList.add('hidden');
}

export function submitBlockUser() {
    const targetSelect = document.getElementById('block-target-select');
    const reasonInput = document.getElementById('block-reason-input');

    const targetVal = targetSelect ? targetSelect.value.trim() : "";
    const targetText = targetSelect && targetSelect.selectedIndex >= 0 ? targetSelect.options[targetSelect.selectedIndex].text : targetVal;
    const reason = reasonInput ? reasonInput.value.trim() : "Violation of Terms";

    if (!targetVal) return showToast("⚠️ Please select a user to block.");

    const cleanKey = targetVal.toLowerCase().replace(/[^a-z0-9]/g, '');

    const blockRecord = {
        id: targetVal,
        name: targetText || targetVal,
        reason: reason,
        blockedBy: appState.riderName || "Admin",
        blockedAt: Date.now()
    };

    if (db) {
        db.ref(`blockedUsers/${cleanKey}`).set(blockRecord);
    }

    if (!globalState.blockedUsers) globalState.blockedUsers = {};
    globalState.blockedUsers[cleanKey] = blockRecord;

    if (targetSelect) targetSelect.selectedIndex = 0;
    if (reasonInput) reasonInput.value = "";

    showToast(`🚫 Blocked user: ${targetText || targetVal}`);
    renderBlockedUsersList();
}

export function unblockUser(cleanKey) {
    if (db) {
        db.ref(`blockedUsers/${cleanKey}`).remove();
    }
    if (globalState.blockedUsers) {
        delete globalState.blockedUsers[cleanKey];
    }
    showToast(`✅ User unblocked.`);
    renderBlockedUsersList();
}

export function renderBlockedUsersList() {
    const container = document.getElementById('blocked-users-list');
    if (!container) return;

    const list = globalState.blockedUsers ? Object.entries(globalState.blockedUsers) : [];

    if (list.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-6 text-xs">No blocked users recorded.</div>`;
        return;
    }

    container.innerHTML = list.map(([key, record]) => `
        <div class="bg-black/40 border border-red-500/30 p-2.5 rounded-xl flex justify-between items-center text-xs">
            <div>
                <div class="font-bold text-red-400">${record.name || record.id}</div>
                <div class="text-[10px] text-gray-400">Reason: ${record.reason || 'N/A'}</div>
            </div>
            <button onclick="unblockUser('${key}')" class="bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 px-2 py-1 rounded text-[10px] font-bold transition active:scale-95">
                Unblock
            </button>
        </div>
    `).join('');
}

// ============================================================================
// 7. GPS LOCATION & TRACKER
// ============================================================================
export function calibrateGPS(onProgress) {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            return resolve({ lat: 0, lon: 0, accuracy: 999 });
        }

        let bestFix = null;
        let sampleCount = 0;
        const maxSamples = 4;
        const timeoutDuration = 6000;

        const timeoutTimer = setTimeout(() => {
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            if (bestFix) {
                resolve({
                    lat: bestFix.coords.latitude,
                    lon: bestFix.coords.longitude,
                    accuracy: bestFix.coords.accuracy
                });
            } else {
                resolve({ lat: 0, lon: 0, accuracy: 999 });
            }
        }, timeoutDuration);

        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                sampleCount++;
                const acc = position.coords.accuracy;

                if (!bestFix || acc < bestFix.coords.accuracy) {
                    bestFix = position;
                }

                if (onProgress && typeof onProgress === 'function') {
                    onProgress(acc, sampleCount);
                }

                if (acc <= 15 || sampleCount >= maxSamples) {
                    clearTimeout(timeoutTimer);
                    navigator.geolocation.clearWatch(watchId);
                    resolve({
                        lat: bestFix.coords.latitude,
                        lon: bestFix.coords.longitude,
                        accuracy: bestFix.coords.accuracy
                    });
                }
            },
            (err) => {},
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    });
}

export function startBackgroundRosterGpsTracker() {
    if (!navigator.geolocation || !appState.telegramId) return;
    if (backgroundGpsWatchId !== null) {
        navigator.geolocation.clearWatch(backgroundGpsWatchId);
        backgroundGpsWatchId = null;
    }

    lastRosterGpsPushTime = 0; // Trigger immediate push upon foreground resume

    backgroundGpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const now = Date.now();
            appState.lat = pos.coords.latitude;
            appState.lon = pos.coords.longitude;
            appState.gpsAccuracy = pos.coords.accuracy;

            if (now - lastRosterGpsPushTime >= GPS_ROSTER_PULSE_MS && db && appState.telegramId) {
                lastRosterGpsPushTime = now;
                db.ref('roster/' + appState.telegramId).update({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    locationUpdatedAt: now
                }).catch(() => {});
            }
        },
        () => {},
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
}

export function stopBackgroundRosterGpsTracker() {
    if (backgroundGpsWatchId !== null) {
        navigator.geolocation.clearWatch(backgroundGpsWatchId);
        backgroundGpsWatchId = null;
    }
}

export function getDeviceLocation() {
    return calibrateGPS();
}

// ============================================================================
// 8. RIDER LOGIN & LOGOUT (100% FIREBASE REALTIME DATABASE)
// ============================================================================
export async function processLogin() {
    unlockAudioContext();
    const idInput = document.getElementById('login-id')?.value.trim();
    if (!idInput) return showToast("Please enter a valid Rider ID");

    if (isUserBlocked(idInput)) {
        return showToast("🚫 Access Denied: Your account is blocked by Admin.");
    }

    const btn = document.getElementById('login-btn');
    if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-satellite-dish fa-spin"></i> Calibrating GPS...`;
        btn.disabled = true;
    }

    try {
        showToast("📡 Calibrating GPS location...");
        const coords = await calibrateGPS((accuracy) => {
            showToast(`📡 Calibrating GPS: ±${Math.round(accuracy)}m`);
        });

        if (coords.lat === 0 && coords.lon === 0) {
            showToast("⚠️ GPS Signal weak. Turn on location services.");
        } else {
            showToast(`✅ GPS Calibrated: ±${Math.round(coords.accuracy)}m`);
        }

        appState.lat = coords.lat;
        appState.lon = coords.lon;
        appState.gpsAccuracy = coords.accuracy;

        let authorized = false;
        let riderRecord = null;

        if (db) {
            const snap = await db.ref(`riders/${idInput}`).once('value');
            riderRecord = snap.val();

            if (!riderRecord) {
                const rosterSnap = await db.ref(`roster/${idInput}`).once('value');
                riderRecord = rosterSnap.val();
            }
        }

        if (riderRecord) {
            const cleanName = riderRecord.name || riderRecord.riderName || idInput;
            const cleanUserType = riderRecord.userType || riderRecord.type || "rider";

            if (isUserBlocked(cleanName)) {
                throw new Error("🚫 Access Denied: Account blocked.");
            }

            appState.riderName = cleanName;
            appState.telegramId = idInput;
            appState.userType = cleanUserType;
            authorized = true;
        }

        if (authorized) {
            localStorage.setItem('telegramId', appState.telegramId);
            localStorage.setItem('riderName', appState.riderName);
            localStorage.setItem('userType', appState.userType || "");
            showToast("Login Successful!");

            fetchGCashDetails();
            startBackgroundRosterGpsTracker();

            history.replaceState({ view: 'view-home' }, '', '#view-home');
            renderViewUI('view-home');
            window.dispatchEvent(new CustomEvent('loginSuccess'));
        } else {
            showToast("Access Denied: Rider ID not found in database.");
        }
    } catch (err) {
        showToast(err.message || "Error during login");
    } finally {
        if (btn) {
            btn.innerHTML = "LOGIN & MARK AVAILABLE";
            btn.disabled = false;
        }
    }
}

export function logout() { 
    stopBackgroundRosterGpsTracker();
    localStorage.clear(); 
    location.reload(); 
}

if (appState.telegramId) {
    fetchGCashDetails();
    startBackgroundRosterGpsTracker();
}

if (typeof window !== 'undefined') {
    window.togglePasswordVisibility = togglePasswordVisibility;
    window.switchLoginPortalTab = switchLoginPortalTab;
    window.switchCustomerAuthTab = switchCustomerAuthTab;
    window.installPwaApp = installPwaApp;
    window.closePwaInstallModal = closePwaInstallModal;
    window.sendCustomerLocation = sendCustomerLocation;
    window.captureRegistrationGPS = captureRegistrationGPS;
    window.captureEditProfileGPS = captureEditProfileGPS;
    window.openEditCustomerProfileModal = openEditCustomerProfileModal;
    window.closeEditCustomerProfileModal = closeEditCustomerProfileModal;
    window.saveCustomerProfile = saveCustomerProfile;
    window.verifyAndUpdatePhoneOTP = verifyAndUpdatePhoneOTP;
    window.sendCustomerRegisterOTP = sendCustomerRegisterOTP;
    window.verifyCustomerRegisterOTP = verifyCustomerRegisterOTP;
    window.completeCustomerRegistration = completeCustomerRegistration;
    window.processCustomerLogin = processCustomerLogin;
    window.triggerForgotPassword = triggerForgotPassword;
    window.closeForgotPasswordModal = closeForgotPasswordModal;
    window.selectResetMethod = selectResetMethod;
    window.backToResetMethod = backToResetMethod;
    window.sendResetSMS = sendResetSMS;
    window.sendResetEmailLink = sendResetEmailLink;
    window.verifyResetOTP = verifyResetOTP;
    window.completePasswordReset = completePasswordReset;
    window.processLogin = processLogin;
    window.logout = logout;
    window.openAdminBlockModal = openAdminBlockModal;
    window.closeAdminBlockModal = closeAdminBlockModal;
    window.submitBlockUser = submitBlockUser;
    window.unblockUser = unblockUser;
    window.isUserBlocked = isUserBlocked;
    window.calibrateGPS = calibrateGPS;
    window.getDeviceLocation = getDeviceLocation;
}