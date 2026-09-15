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

export function sanitize10DigitPhone(inputEl) {
    if (!inputEl) return;
    let val = inputEl.value.replace(/[^0-9]/g, '');

    // Automatically strip accidental pasted prefixes
    if (val.startsWith('6309') && val.length >= 4) {
        val = '9' + val.substring(4);
    } else if (val.startsWith('639') && val.length >= 3) {
        val = '9' + val.substring(3);
    } else if (val.startsWith('09') && val.length >= 2) {
        val = '9' + val.substring(2);
    } else if (val.startsWith('0')) {
        val = val.substring(1);
    }

    if (val.length > 10) {
        val = val.substring(0, 10);
    }

    inputEl.value = val;
}

export function validatePhilippineMobile(phone) {
    if (!phone) {
        return { isValid: false, message: "Paki-lagay ang iyong 10-digit Mobile Number!" };
    }

    let clean = phone.replace(/[^0-9]/g, '').trim();

    // Auto-strip accidental prefixes if passed from unformatted data sources
    if (clean.startsWith('6309') && clean.length === 13) {
        clean = clean.substring(3);
    } else if (clean.startsWith('639') && clean.length === 12) {
        clean = clean.substring(2);
    } else if (clean.startsWith('09') && clean.length === 11) {
        clean = clean.substring(1);
    }

    // Standard 10 digits starting with 9
    if (clean.startsWith('9') && clean.length === 10) {
        return {
            isValid: true,
            formatted: '+63' + clean,
            cleanKey: '63' + clean,
            localTenDigit: clean
        };
    }

    // Informative validation feedback
    if (!clean.startsWith('9')) {
        return { isValid: false, message: "Dapat magsimula sa 9 ang 10-digit mobile number (hal. 9123456789)." };
    }
    if (clean.length < 10) {
        return { isValid: false, message: `Kulang ang numero (${clean.length}/10 digits). Paki-kumpleto ang 10 digits.` };
    }
    if (clean.length > 10) {
        return { isValid: false, message: `Sobra ang numero (${clean.length}/10 digits). Dapat 10 digits lamang.` };
    }

    return { isValid: false, message: "Maling mobile number format. Dapat 10 digits na nagsisimula sa 9." };
}

export function formatPhoneNumber(phone) {
    const validation = validatePhilippineMobile(phone);
    if (validation.isValid) {
        return validation.formatted;
    }

    let clean = (phone || '').replace(/[^0-9]/g, '').trim();
    if (!clean) return '';

    if (clean.startsWith('6309') && clean.length === 13) {
        return '+63' + clean.substring(3);
    }
    if (clean.startsWith('63') && clean.length === 12) {
        return '+' + clean;
    }
    if (clean.startsWith('09') && clean.length === 11) {
        return '+63' + clean.substring(1);
    }
    if (clean.startsWith('9') && clean.length === 10) {
        return '+63' + clean;
    }
    if (clean.startsWith('0')) {
        return '+63' + clean.substring(1);
    }
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

if (typeof window !== 'undefined') {
    window.sanitize10DigitPhone = sanitize10DigitPhone;
    window.validatePhilippineMobile = validatePhilippineMobile;
    window.formatPhoneNumber = formatPhoneNumber;
    window.togglePasswordVisibility = togglePasswordVisibility;
    window.switchLoginPortalTab = switchLoginPortalTab;
    window.switchCustomerAuthTab = switchCustomerAuthTab;
}