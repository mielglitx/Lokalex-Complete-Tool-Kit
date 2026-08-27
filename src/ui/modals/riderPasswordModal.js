// src/ui/modals/riderPasswordModal.js
import { appState } from '../../store/state.js';
import { db, auth } from '../../config/firebase.js';
import { showToast, showSideNotification } from '../notifications.js';
import { escapeHtml } from '../../utils/helpers.js';
import { formatPhoneNumber, initRecaptcha } from '../../features/auth/authUtils.js';

let riderPasswordSuccessCallback = null;
let riderSetupConfirmationResult = null;
let riderPhoneVerified = false;
let riderSetupVerifiedPhone = "";

export async function openRiderPasswordSetupModal(targetId = null, targetName = null, onSuccessCallback = null) {
    if (typeof targetId === 'function') {
        onSuccessCallback = targetId;
        targetId = null;
    }

    riderPasswordSuccessCallback = onSuccessCallback;
    riderPhoneVerified = false;
    riderSetupConfirmationResult = null;
    riderSetupVerifiedPhone = "";

    const modal = document.getElementById('rider-password-setup-modal');
    const phoneInput = document.getElementById('rider-setup-phone-input');
    const otpBox = document.getElementById('rider-setup-otp-box');
    const otpCode = document.getElementById('rider-setup-otp-code');
    const verifiedBadge = document.getElementById('rider-phone-verified-badge');
    const passStep = document.getElementById('rider-setup-step-pass');
    const p1 = document.getElementById('rider-new-pass-1');
    const p2 = document.getElementById('rider-new-pass-2');
    const errBox = document.getElementById('rider-pass-error-msg');
    const saveBtn = document.getElementById('rider-setup-save-btn');

    if (phoneInput) phoneInput.value = '';
    if (otpBox) otpBox.classList.add('hidden');
    if (otpCode) otpCode.value = '';
    if (verifiedBadge) verifiedBadge.classList.add('hidden');
    if (passStep) {
        passStep.classList.add('opacity-50', 'pointer-events-none');
    }
    if (p1) p1.value = '';
    if (p2) p2.value = '';
    if (errBox) errBox.classList.add('hidden');
    if (saveBtn) saveBtn.disabled = true;

    const myId = (targetId || appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    if (myId && db) {
        try {
            const snap = await db.ref(`riders/${myId}`).once('value');
            const rData = snap.val();
            if (rData && rData.phoneNumber) {
                if (phoneInput) phoneInput.value = rData.phoneNumber;
            }
        } catch(e) {}
    }

    if (modal) {
        modal.classList.remove('hidden');
        if (phoneInput) phoneInput.focus();
    }
}

export function closeRiderPasswordSetupModal() {
    const modal = document.getElementById('rider-password-setup-modal');
    if (modal) modal.classList.add('hidden');
    riderPasswordSuccessCallback = null;
}

export function toggleRiderPassVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const icon = btn ? btn.querySelector('i') : null;
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) {
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        }
    } else {
        input.type = 'password';
        if (icon) {
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    }
}

export function handleSkipRiderPasswordSetup() {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    if (myId) {
        localStorage.setItem(`lokalex_skip_pass_${myId}`, 'true');
        if (db) {
            db.ref(`riders/${myId}`).update({ skipPasswordSetup: true }).catch(() => {});
        }
    }

    showToast("ℹ️ Na-skip ang password setup.");
    showSideNotification(
        "MANUAL SETUP GUIDE",
        "Pindutin ang iyong Profile Picture sa Header anumang oras para mag-set ng password at mobile number.",
        "fa-user-gear",
        "text-amber-400",
        "border-amber-500"
    );

    const cb = riderPasswordSuccessCallback;
    closeRiderPasswordSetupModal();

    if (cb && typeof cb === 'function') {
        cb();
    }
}

export async function sendRiderSetupOTP() {
    const phoneInput = document.getElementById('rider-setup-phone-input');
    const rawPhone = phoneInput ? phoneInput.value.trim() : '';

    if (!rawPhone) {
        showToast("⚠️ Paki-lagay ang iyong Mobile Number!");
        if (phoneInput) phoneInput.focus();
        return;
    }

    const formattedPhone = formatPhoneNumber(rawPhone);

    if (!/^\+639\d{9}$/.test(formattedPhone)) {
        showToast("⚠️ Maling mobile number format. Dapat 11 digits (hal. 09123456789).");
        if (phoneInput) phoneInput.focus();
        return;
    }

    const sendBtn = document.getElementById('rider-setup-send-otp-btn');
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending...`;
    }

    try {
        const verifier = initRecaptcha('rider-recaptcha-container');
        if (!verifier) {
            throw new Error("reCAPTCHA initialization failed. Please refresh the page.");
        }

        const confirmationResult = await auth.signInWithPhoneNumber(formattedPhone, verifier);
        riderSetupConfirmationResult = confirmationResult;
        riderSetupVerifiedPhone = formattedPhone;

        const otpBox = document.getElementById('rider-setup-otp-box');
        const otpCode = document.getElementById('rider-setup-otp-code');

        if (otpBox) otpBox.classList.remove('hidden');
        if (otpCode) {
            otpCode.value = '';
            otpCode.focus();
        }

        showToast(`📲 OTP Code sent to ${formattedPhone}!`);
    } catch(err) {
        console.error("Rider OTP Error:", err);
        if (window.recaptchaVerifiers && window.recaptchaVerifiers['rider-recaptcha-container']) {
            try { window.recaptchaVerifiers['rider-recaptcha-container'].clear(); } catch(e) {}
            delete window.recaptchaVerifiers['rider-recaptcha-container'];
        }

        if (err.code === 'auth/too-many-requests' || (err.message && err.message.includes('blocked all requests'))) {
            showToast("🚫 Naka-block pansamantala ang device dahil sa sunod-sunod na OTP. Pindutin ang Skip o maghintay bago mag-retry.");
            showSideNotification("OTP RATE LIMIT", "Device temporarily blocked by Firebase. You can click 'Skip' to continue.", "fa-ban", "text-red-400", "border-red-500");
        } else if (err.code === 'auth/invalid-phone-number') {
            showToast("⚠️ Maling phone number format. Paki-check (hal. 09123456789).");
        } else if (err.code === 'auth/captcha-check-failed' || err.code === 'auth/invalid-app-credential') {
            showToast("⚠️ Bigo ang reCAPTCHA check. Paki-pindot muli ang Send OTP.");
        } else {
            showToast(`❌ ${err.message || "Failed to send SMS OTP"}`);
        }
    } finally {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Send OTP`;
        }
    }
}

export async function verifyRiderSetupOTP() {
    const otpCode = document.getElementById('rider-setup-otp-code');
    const code = otpCode ? otpCode.value.trim() : '';

    if (!code || code.length < 6) {
        showToast("⚠️ Paki-lagay ang 6-digit OTP code!");
        return;
    }

    if (!riderSetupConfirmationResult) {
        showToast("⚠️ Session expired. Paki-send muli ang OTP.");
        return;
    }

    const verifyBtn = document.getElementById('rider-setup-verify-otp-btn');
    if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying...`;
    }

    try {
        await riderSetupConfirmationResult.confirm(code);
        riderPhoneVerified = true;

        const otpBox = document.getElementById('rider-setup-otp-box');
        const verifiedBadge = document.getElementById('rider-phone-verified-badge');
        const passStep = document.getElementById('rider-setup-step-pass');
        const saveBtn = document.getElementById('rider-setup-save-btn');
        const p1 = document.getElementById('rider-new-pass-1');

        if (otpBox) otpBox.classList.add('hidden');
        if (verifiedBadge) verifiedBadge.classList.remove('hidden');
        if (passStep) {
            passStep.classList.remove('opacity-50', 'pointer-events-none');
        }
        if (saveBtn) saveBtn.disabled = false;
        if (p1) p1.focus();

        showToast("✅ Mobile number verified! Paki-lagay ang iyong password.");
    } catch(err) {
        console.error("Verify rider OTP error:", err);
        showToast("❌ Mali ang OTP code. Paki-ulit.");
    } finally {
        if (verifyBtn) {
            verifyBtn.disabled = false;
            verifyBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> Verify`;
        }
    }
}

export async function handleSaveRiderPassword() {
    if (!riderPhoneVerified) {
        showToast("⚠️ Paki-verify muna ang iyong Mobile Number gamit ang OTP!");
        return;
    }

    const p1 = document.getElementById('rider-new-pass-1');
    const p2 = document.getElementById('rider-new-pass-2');
    const errBox = document.getElementById('rider-pass-error-msg');
    const errTxt = document.getElementById('rider-pass-error-text');

    const pass1 = p1 ? p1.value.trim() : '';
    const pass2 = p2 ? p2.value.trim() : '';

    if (!pass1 || pass1.length < 4) {
        if (errBox && errTxt) {
            errTxt.innerText = "Dapat hindi bababa sa 4 characters ang password.";
            errBox.classList.remove('hidden');
        } else {
            showToast("⚠️ Dapat hindi bababa sa 4 characters ang password.");
        }
        if (p1) p1.focus();
        return;
    }

    if (pass1 !== pass2) {
        if (errBox && errTxt) {
            errTxt.innerText = "Hindi magkatugma ang dalawang password. Paki-ulit.";
            errBox.classList.remove('hidden');
        } else {
            showToast("❌ Hindi magkatugma ang dalawang password.");
        }
        if (p2) p2.focus();
        return;
    }

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    if (!myId) {
        showToast("⚠️ Missing Rider ID.");
        return;
    }

    if (errBox) errBox.classList.add('hidden');

    try {
        if (db) {
            await db.ref(`riders/${myId}`).update({ 
                password: pass1,
                phoneNumber: riderSetupVerifiedPhone,
                hasPassword: true,
                skipPasswordSetup: false,
                passwordUpdatedAt: Date.now()
            });
            await db.ref(`roster/${myId}`).update({
                hasPassword: true
            }).catch(() => {});
        }

        appState.phoneNumber = riderSetupVerifiedPhone;
        localStorage.setItem(`lokalex_pass_${myId}`, pass1);
        localStorage.setItem('lokalex_rider_phone', riderSetupVerifiedPhone);
        localStorage.removeItem(`lokalex_skip_pass_${myId}`);

        showToast("✅ Matagumpay na nai-save ang iyong Mobile & Password!");
        showSideNotification("SECURITY SETUP COMPLETE", "Account verified & password set", "fa-shield-check", "text-emerald-400", "border-emerald-500");

        const cb = riderPasswordSuccessCallback;
        closeRiderPasswordSetupModal();

        if (cb && typeof cb === 'function') {
            cb();
        }
    } catch(e) {
        console.error("Save password error:", e);
        showToast("❌ Bigo sa pag-save ng password. Subukan muli.");
    }
}