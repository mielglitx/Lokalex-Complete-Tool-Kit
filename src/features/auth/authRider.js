// src/features/auth/authRider.js
import { appState } from '../../store/state.js';
import { db, auth } from '../../config/firebase.js';
import { showToast, unlockAudioContext } from '../../ui/notifications.js';
import { fetchGCashDetails, openRiderPasswordSetupModal } from '../../ui/modals.js';
import { renderViewUI } from '../../ui/router.js';
import { calibrateGPS, startBackgroundRosterGpsTracker, stopBackgroundRosterGpsTracker } from './authGps.js';
import { isUserBlocked } from './authAdmin.js';
import { finalizeCustomerSession } from './authCustomer.js';

let deferredPwaPrompt = null;

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPwaPrompt = e;
    });
}

export function installPwaApp() {
    if (deferredPwaPrompt) {
        deferredPwaPrompt.prompt();
        deferredPwaPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                showToast("🎉 Thank you for installing the Lokalex App!");
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

export async function processUnifiedLogin() {
    unlockAudioContext();
    const identInput = document.getElementById('unified-login-identifier') || document.getElementById('login-id');
    const passInput = document.getElementById('unified-login-password') || document.getElementById('login-pass');
    const btn = document.getElementById('unified-login-btn') || document.getElementById('login-btn');

    const identifier = (identInput?.value || '').trim();
    const password = passInput?.value || '';

    if (!identifier) {
        showToast("⚠️ Please enter your Rider ID, Mobile Number, or Store Username.");
        if (identInput) identInput.focus();
        return;
    }

    if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking Account...`;
        btn.disabled = true;
    }

    try {
        if (!db) throw new Error("Database connection unavailable.");

        // 1. Check Rider Database First (Rider portal priority)
        let riderRecord = null;
        const snap = await db.ref(`riders/${identifier}`).once('value');
        riderRecord = snap.val();

        if (!riderRecord) {
            const rosterSnap = await db.ref(`roster/${identifier}`).once('value');
            riderRecord = rosterSnap.val();
        }

        if (riderRecord) {
            const cleanName = riderRecord.name || riderRecord.riderName || identifier;
            const cleanUserType = (riderRecord.userType || riderRecord.type || "rider").toLowerCase().trim();

            if (isUserBlocked(cleanName) || isUserBlocked(identifier)) {
                throw new Error("🚫 Access Denied: Your account is blocked by Admin.");
            }

            const existingPassword = riderRecord.password || riderRecord.pass || null;
            const isSkipped = localStorage.getItem(`lokalex_skip_pass_${identifier}`) === 'true' || riderRecord.skipPasswordSetup === true;

            // If admin removed the password or no password is set yet:
            if (!existingPassword) {
                if (!isSkipped) {
                    if (btn) {
                        btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> LOGIN`;
                        btn.disabled = false;
                    }
                    openRiderPasswordSetupModal(identifier, cleanName, async () => {
                        await executeRiderLoginSequence(identifier, cleanName, cleanUserType, riderRecord);
                    });
                    return;
                }
            } else {
                if (!password) {
                    showToast("⚠️ Please enter your Password.");
                    if (passInput) passInput.focus();
                    if (btn) {
                        btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> LOGIN`;
                        btn.disabled = false;
                    }
                    return;
                }
                if (password !== existingPassword.toString()) {
                    throw new Error("❌ Incorrect Rider Password. Please try again.");
                }
            }

            await executeRiderLoginSequence(identifier, cleanName, cleanUserType, riderRecord);
            return;
        }

        // Non-rider accounts (Customers & Stores) strictly require a password
        if (!password) {
            showToast("⚠️ Please enter your Password.");
            if (passInput) passInput.focus();
            if (btn) {
                btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> LOGIN`;
                btn.disabled = false;
            }
            return;
        }

        // 2. Check Customer Account (Phone Number / Email)
        const isPotentialPhone = /^(?:09|\+639|639|9)\d{8,9}$/.test(identifier.replace(/[\s-]/g, ''));
        if (isPotentialPhone && auth) {
            let phoneVal = identifier.replace(/[^0-9]/g, '');
            if (phoneVal.startsWith('6309') && phoneVal.length >= 4) phoneVal = '9' + phoneVal.substring(4);
            else if (phoneVal.startsWith('639') && phoneVal.length >= 3) phoneVal = '9' + phoneVal.substring(3);
            else if (phoneVal.startsWith('09') && phoneVal.length >= 2) phoneVal = '9' + phoneVal.substring(2);
            else if (phoneVal.startsWith('0')) phoneVal = phoneVal.substring(1);

            const cleanPhoneKey = '63' + phoneVal;
            const formattedPhone = '+63' + phoneVal;

            let custData = null;
            let uid = null;

            const phoneSnap = await db.ref(`phones/${cleanPhoneKey}`).once('value');
            const phoneRec = phoneSnap.val();
            uid = phoneRec?.uid;

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

            if (custData && uid) {
                const loginEmail = custData.loginEmail || custData.email || `${cleanPhoneKey}@lokalex.app`;
                const userCred = await auth.signInWithEmailAndPassword(loginEmail, password);
                finalizeCustomerSession(userCred.user.uid, custData.name, formattedPhone, custData.avatarUrl);
                showToast(`✅ Welcome back, ${custData.name}!`);
                history.replaceState({ view: 'view-customer-home' }, '', '#view-customer-home');
                renderViewUI('view-customer-home');
                return;
            }
        }

        // 3. Check Store Merchant Account
        const storeSnap = await db.ref('storeAccounts').orderByChild('username').equalTo(identifier.toLowerCase()).once('value');
        const storeVal = storeSnap.val();
        if (storeVal) {
            const accId = Object.keys(storeVal)[0];
            const targetAccount = storeVal[accId];
            if (targetAccount.password !== password) {
                throw new Error("❌ Incorrect password for Store Account.");
            }

            localStorage.setItem('lokalex_merchant_account_id', accId);
            localStorage.setItem('lokalex_merchant_store_id', targetAccount.storeId);
            localStorage.setItem('lokalex_merchant_store_name', targetAccount.storeName);
            localStorage.setItem('lokalex_merchant_username', targetAccount.username);
            localStorage.setItem('lokalex_active_role', 'merchant');

            appState.merchantAccountId = accId;
            appState.merchantStoreId = targetAccount.storeId;
            appState.merchantStoreName = targetAccount.storeName;
            appState.merchantUsername = targetAccount.username;

            showToast(`✅ Store Login Successful! Welcome ${targetAccount.storeName}`);
            history.replaceState({ view: 'view-store-hub' }, '', '#view-store-hub');
            renderViewUI('view-store-hub');
            return;
        }

        throw new Error("🚫 Account not found. Please check your Rider ID, Mobile No., or Username.");
    } catch (err) {
        showToast(err.message || "❌ Login failed.");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> LOGIN`;
        }
    }
}

export async function processLogin() {
    unlockAudioContext();
    const idInput = document.getElementById('login-id')?.value.trim();
    const passInput = document.getElementById('login-pass')?.value.trim() || '';

    if (!idInput) return showToast("Please enter a valid Rider ID");

    if (isUserBlocked(idInput)) {
        return showToast("🚫 Access Denied: Your account is blocked by Admin.");
    }

    const btn = document.getElementById('login-btn');
    if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking Account...`;
        btn.disabled = true;
    }

    try {
        let riderRecord = null;

        if (db) {
            const snap = await db.ref(`riders/${idInput}`).once('value');
            riderRecord = snap.val();

            if (!riderRecord) {
                const rosterSnap = await db.ref(`roster/${idInput}`).once('value');
                riderRecord = rosterSnap.val();
            }
        }

        if (!riderRecord) {
            throw new Error("Access Denied: Rider ID not found in database.");
        }

        const cleanName = riderRecord.name || riderRecord.riderName || idInput;
        const cleanUserType = (riderRecord.userType || riderRecord.type || "rider").toLowerCase().trim();

        if (isUserBlocked(cleanName)) {
            throw new Error("🚫 Access Denied: Account blocked.");
        }

        const existingPassword = riderRecord.password || riderRecord.pass || null;
        const isSkipped = localStorage.getItem(`lokalex_skip_pass_${idInput}`) === 'true' || riderRecord.skipPasswordSetup === true;

        if (!existingPassword) {
            if (!isSkipped) {
                if (btn) {
                    btn.innerHTML = "LOGIN";
                    btn.disabled = false;
                }
                openRiderPasswordSetupModal(idInput, cleanName, async () => {
                    await executeRiderLoginSequence(idInput, cleanName, cleanUserType, riderRecord);
                });
                return;
            }
        } else {
            if (!passInput) {
                throw new Error("⚠️ Please enter your Rider Password.");
            }

            if (passInput !== existingPassword.toString()) {
                throw new Error("❌ Incorrect Rider Password. Please try again.");
            }
        }

        await executeRiderLoginSequence(idInput, cleanName, cleanUserType, riderRecord);
    } catch (err) {
        showToast(err.message || "Error during login");
        if (btn) {
            btn.innerHTML = "LOGIN";
            btn.disabled = false;
        }
    }
}

export async function executeRiderLoginSequence(idInput, cleanName, cleanUserType, riderRecord = {}) {
    const btn = document.getElementById('login-btn');
    if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Logging in...`;
        btn.disabled = true;
    }

    try {
        appState.riderName = cleanName;
        appState.telegramId = idInput;
        appState.userType = cleanUserType;
        const rawLoginPhoto = riderRecord.photoUrl || riderRecord.avatar || riderRecord.profilePic || "";
        const isDeadLoginPhoto = rawLoginPhoto && (rawLoginPhoto.includes('litterbox.catbox.moe') || rawLoginPhoto.includes('litter.'));
        if (rawLoginPhoto && !isDeadLoginPhoto) {
            appState.photoUrl = rawLoginPhoto;
            localStorage.setItem('lokalex_photo_url', rawLoginPhoto);
            localStorage.setItem('riderPhotoUrl', rawLoginPhoto);
        } else {
            appState.photoUrl = "";
            localStorage.removeItem('lokalex_photo_url');
            localStorage.removeItem('riderPhotoUrl');
        }
        if (riderRecord.phoneNumber) {
            appState.phoneNumber = riderRecord.phoneNumber;
            localStorage.setItem('lokalex_rider_phone', riderRecord.phoneNumber);
        }

        // Set active role explicitly
        localStorage.setItem('lokalex_active_role', 'rider');
        localStorage.setItem('telegramId', appState.telegramId);
        localStorage.setItem('riderName', appState.riderName);
        localStorage.setItem('userType', appState.userType || "");

        // Purge any lingering customer or merchant credentials
        const lingeringKeys = [
            'lokalex_customer_fb_id', 'customerId', 'customerFacebookId',
            'customerName', 'customerPhone', 'customerAvatarUrl',
            'lokalex_customer_name', 'lokalex_customer_email', 'lokalex_customer_avatar',
            'lokalex_customer_address', 'lokalex_customer_pin_coords',
            'lokalex_merchant_account_id', 'lokalex_merchant_store_id',
            'lokalex_merchant_store_name', 'lokalex_merchant_username',
            'lokalex_merchant_avatar', 'merchantAccountId', 'merchantStoreId'
        ];
        lingeringKeys.forEach(k => localStorage.removeItem(k));

        appState.customerFacebookId = null;
        appState.customerName = null;
        appState.merchantAccountId = null;
        appState.merchantStoreId = null;

        showToast("Login Successful!");

        fetchGCashDetails();

        history.replaceState({ view: 'view-home' }, '', '#view-home');
        renderViewUI('view-home');
        window.dispatchEvent(new CustomEvent('loginSuccess'));
    } catch (err) {
        showToast(err.message || "Error during login");
    } finally {
        if (btn) {
            btn.innerHTML = "LOGIN";
            btn.disabled = false;
        }
    }
}

export function logout() { 
    stopBackgroundRosterGpsTracker();

    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.classList.remove('instant-session-home', 'instant-session-customer', 'instant-session-merchant');
    }

    if (auth && typeof auth.signOut === 'function') {
        auth.signOut().catch(() => {});
    }

    if (typeof window !== 'undefined' && typeof window.syncRiderSession === 'function') {
        try {
            window.syncRiderSession('', '');
        } catch (_) {}
    }

    const sessionKeysToClear = [
        'lokalex_active_role',
        'telegramId', 'riderName', 'userType', 'riderPhotoUrl', 'lokalex_photo_url', 'lokalex_rider_phone',
        'lokalex_customer_fb_id', 'customerId', 'customerFacebookId', 'customerName', 'customerPhone', 'customerAvatarUrl',
        'lokalex_customer_name', 'lokalex_customer_email', 'lokalex_customer_avatar', 'lokalex_customer_address', 'lokalex_customer_pin_coords',
        'lokalex_merchant_account_id', 'lokalex_merchant_store_id', 'lokalex_merchant_store_name', 'lokalex_merchant_username', 'lokalex_merchant_avatar',
        'merchantAccountId', 'merchantStoreId'
    ];
    sessionKeysToClear.forEach(key => localStorage.removeItem(key));

    appState.telegramId = null;
    appState.riderName = null;
    appState.userType = null;
    appState.customerFacebookId = null;
    appState.customerName = null;
    appState.merchantAccountId = null;
    appState.merchantStoreId = null;

    localStorage.clear(); 
    location.reload(); 
}

export function showRiderForgotPassHelp() {
    showSideNotification(
        "RIDER FORGOT PASSWORD",
        "Please contact an Admin to clear your password using the Rider Accounts Manager. Once cleared, you can log in immediately and set a new password.",
        "fa-key",
        "text-amber-400",
        "border-amber-500"
    );
    showToast("ℹ️ Please request an Admin to clear your password in Rider Accounts Manager.");
}

if (typeof window !== 'undefined') {
    window.showRiderForgotPassHelp = showRiderForgotPassHelp;
}