// src/features/auth/authUtils.js

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
    const merchForm = document.getElementById('portal-form-merchant');

    if (riderForm) riderForm.classList.add('hidden');
    if (custForm) custForm.classList.add('hidden');
    if (merchForm) merchForm.classList.add('hidden');

    if (mode === 'rider' && riderForm) {
        riderForm.classList.remove('hidden');
    } else if (mode === 'merchant' && merchForm) {
        merchForm.classList.remove('hidden');
    } else if (custForm) {
        custForm.classList.remove('hidden');
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

export function formatPhoneNumber(phone) {
    let clean = (phone || '').replace(/[^0-9]/g, '').trim();
    if (!clean) return '';

    // Handle 639XXXXXXXXX (12 digits)
    if (clean.startsWith('63') && clean.length === 12) {
        return '+' + clean;
    }
    // Handle 09XXXXXXXXX (11 digits)
    if (clean.startsWith('09') && clean.length === 11) {
        return '+63' + clean.substring(1);
    }
    // Handle 9XXXXXXXXX (10 digits)
    if (clean.startsWith('9') && clean.length === 10) {
        return '+63' + clean;
    }
    // Handle generic leading 0
    if (clean.startsWith('0')) {
        return '+63' + clean.substring(1);
    }
    // Handle cases where 63 was passed without plus
    if (clean.startsWith('63')) {
        return '+' + clean;
    }

    return '+' + clean;
}

export function initRecaptcha(containerId = 'recaptcha-container') {
    if (typeof firebase === 'undefined' || !firebase.auth) return null;

    if (!window.recaptchaVerifiers) {
        window.recaptchaVerifiers = {};
    }

    // 1. Clear previous verifier instance for this container if present
    if (window.recaptchaVerifiers[containerId]) {
        try {
            window.recaptchaVerifiers[containerId].clear();
        } catch (e) {}
        delete window.recaptchaVerifiers[containerId];
    }

    // 2. Cleanly reset the container DOM element to clear previous grecaptcha iframe state
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = '';
    }

    // 3. Initialize fresh RecaptchaVerifier
    try {
        const verifier = new firebase.auth.RecaptchaVerifier(containerId, {
            size: 'invisible',
            callback: () => {}
        });

        window.recaptchaVerifiers[containerId] = verifier;
        window.recaptchaVerifier = verifier;
        return verifier;
    } catch (e) {
        console.error("Recaptcha init error:", e);
        return null;
    }
}