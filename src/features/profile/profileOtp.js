// src/features/profile/profileOtp.js
import { profileState } from './profileState.js';
import { auth as firebaseAuth } from '../../config/firebase.js';
import { showToast } from '../../ui/notifications.js';
import { validatePhilippineMobile, initRecaptcha } from '../auth/authUtils.js';

export function handleProfilePhoneInput(input) {
    const clean = (input.value || '').replace(/\D/g, '').substring(0, 10);
    input.value = clean;

    const sendOtpBtn = document.getElementById('prof-send-otp-btn');
    const phoneBadge = document.getElementById('prof-phone-status-badge');
    const otpDrawer = document.getElementById('prof-otp-verify-drawer');

    if (clean !== profileState.originalPhoneNumber && clean.length === 10) {
        profileState.isPhoneModified = true;
        profileState.isPhoneOtpVerified = false;
        if (sendOtpBtn) sendOtpBtn.classList.remove('hidden');
        if (phoneBadge) {
            phoneBadge.innerText = "Needs OTP";
            phoneBadge.className = "text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-500/30";
        }
    } else {
        profileState.isPhoneModified = false;
        if (sendOtpBtn) sendOtpBtn.classList.add('hidden');
        if (otpDrawer) otpDrawer.classList.add('hidden');
        if (phoneBadge) {
            phoneBadge.innerText = "Verified";
            phoneBadge.className = "text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30";
        }
    }
}

export async function sendProfilePhoneChangeOTP() {
    const phoneInput = document.getElementById('prof-phone-input');
    const sendOtpBtn = document.getElementById('prof-send-otp-btn');
    const otpDrawer = document.getElementById('prof-otp-verify-drawer');

    const check = validatePhilippineMobile(phoneInput?.value || '');
    if (!check.isValid) {
        return showToast("⚠️ Maglagay ng wastong 10-digit mobile number na nagsisimula sa 9!");
    }

    if (sendOtpBtn) {
        sendOtpBtn.disabled = true;
        sendOtpBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    }

    try {
        const verifier = initRecaptcha('prof-recaptcha-container', () => {});
        profileState.phoneConfirmationResult = await firebaseAuth.signInWithPhoneNumber(check.formatted, verifier);

        showToast(`📲 Naipadala ang OTP code sa ${check.formatted}!`);
        if (otpDrawer) otpDrawer.classList.remove('hidden');

        const otpInput = document.getElementById('prof-otp-input');
        if (otpInput) {
            otpInput.value = '';
            otpInput.focus();
        }
    } catch (err) {
        showToast(`❌ OTP Error: ${err.message || 'Nabigong ipadala ang code'}`);
    } finally {
        if (sendOtpBtn) {
            sendOtpBtn.disabled = false;
            sendOtpBtn.innerHTML = `Send OTP`;
        }
    }
}

export async function verifyProfilePhoneChangeOTP() {
    const otpInput = document.getElementById('prof-otp-input');
    const verifyBtn = document.getElementById('prof-verify-otp-btn');
    const phoneBadge = document.getElementById('prof-phone-status-badge');
    const otpDrawer = document.getElementById('prof-otp-verify-drawer');
    const sendOtpBtn = document.getElementById('prof-send-otp-btn');

    const code = (otpInput?.value || '').trim();
    if (code.length !== 6) {
        return showToast("⚠️ I-type ang kumpletong 6-digit verification code!");
    }

    if (!profileState.phoneConfirmationResult) {
        return showToast("⚠️ Mangyaring mag-request muna ng OTP bago mag-verify.");
    }

    if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying...`;
    }

    try {
        await profileState.phoneConfirmationResult.confirm(code);
        profileState.isPhoneOtpVerified = true;
        profileState.isPhoneModified = false;

        showToast("✅ Mobile number verified successfully!");
        if (phoneBadge) {
            phoneBadge.innerText = "Verified";
            phoneBadge.className = "text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-500/30";
        }
        if (otpDrawer) otpDrawer.classList.add('hidden');
        if (sendOtpBtn) sendOtpBtn.classList.add('hidden');
    } catch (err) {
        showToast("❌ Maling OTP code o nag-expire na. Pakisubukang muli.");
    } finally {
        if (verifyBtn) {
            verifyBtn.disabled = false;
            verifyBtn.innerHTML = `Verify OTP`;
        }
    }
}