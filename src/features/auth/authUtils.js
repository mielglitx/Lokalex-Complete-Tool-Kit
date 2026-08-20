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

export function formatPhoneNumber(phone) {
    let clean = (phone || '').replace(/[^0-9+]/g, '').trim();
    if (clean.startsWith('+')) return clean;
    if (clean.startsWith('09') && clean.length === 11) return '+63' + clean.substring(1);
    if (clean.startsWith('9') && clean.length === 10) return '+63' + clean;
    return '+' + clean;
}

export function initRecaptcha() {
    if (!window.recaptchaVerifier && typeof firebase !== 'undefined') {
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