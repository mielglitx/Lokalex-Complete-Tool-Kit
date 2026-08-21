// src/features/storeHub/storeAuth.js
import { appState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { showToast } from '../../ui/notifications.js';

export function loadMerchantSession() {
    const savedAccId = localStorage.getItem('lokalex_merchant_account_id');
    const savedStoreId = localStorage.getItem('lokalex_merchant_store_id');
    const savedStoreName = localStorage.getItem('lokalex_merchant_store_name');
    const savedUsername = localStorage.getItem('lokalex_merchant_username');

    if (savedAccId && savedStoreId) {
        appState.merchantAccountId = savedAccId;
        appState.merchantStoreId = savedStoreId;
        appState.merchantStoreName = savedStoreName || "My Store";
        appState.merchantUsername = savedUsername || "";
    }
}

function timeoutPromise(ms) {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error("⚠️ Connection timeout. Check your internet connection or Firebase permissions.")), ms);
    });
}

export async function processMerchantLogin() {
    const userInput = document.getElementById('merch-login-user')?.value.trim().toLowerCase();
    const passInput = document.getElementById('merch-login-pass')?.value;

    if (!userInput || !passInput) {
        return showToast("⚠️ I-enter ang iyong Store Username at Password!");
    }

    const btn = document.getElementById('merch-login-submit-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...`;
    }

    try {
        if (!db) throw new Error("Database offline.");

        let targetAccount = null;

        // 1. ATTEMPT INDEXED QUERY WITH A 7-SECOND TIMEOUT GUARD
        try {
            const queryPromise = db.ref('storeAccounts').orderByChild('username').equalTo(userInput).once('value');
            const snap = await Promise.race([queryPromise, timeoutPromise(7000)]);
            const val = snap.val();

            if (val) {
                const accountId = Object.keys(val)[0];
                targetAccount = val[accountId];
            }
        } catch (queryErr) {
            console.warn("Indexed query failed or timed out, falling back to full scan:", queryErr.message);
        }

        // 2. FALLBACK: DIRECT IN-MEMORY SCAN IF INDEXING IS UNPROPAGATED
        if (!targetAccount) {
            const scanPromise = db.ref('storeAccounts').once('value');
            const snap = await Promise.race([scanPromise, timeoutPromise(7000)]);
            const val = snap.val() || {};

            const found = Object.values(val).find(acc => 
                (acc.username || "").toLowerCase().trim() === userInput
            );

            if (found) {
                targetAccount = found;
            }
        }

        if (!targetAccount) {
            throw new Error("🚫 Hindi nakarehistro ang Store Username na ito.");
        }

        if (targetAccount.password !== passInput) {
            throw new Error("❌ Mali ang Password. Subukan muli.");
        }

        if (targetAccount.status && targetAccount.status !== 'active') {
            throw new Error("🚫 Naka-deactivate ang store account na ito. Kontakin ang Admin.");
        }

        localStorage.setItem('lokalex_merchant_account_id', targetAccount.accountId);
        localStorage.setItem('lokalex_merchant_store_id', targetAccount.assignedStoreId);
        localStorage.setItem('lokalex_merchant_store_name', targetAccount.storeName);
        localStorage.setItem('lokalex_merchant_username', targetAccount.username);

        appState.merchantAccountId = targetAccount.accountId;
        appState.merchantStoreId = targetAccount.assignedStoreId;
        appState.merchantStoreName = targetAccount.storeName;
        appState.merchantUsername = targetAccount.username;

        showToast(`🎉 Maligayang pagdating, ${targetAccount.storeName}!`);

        if (window.switchView) {
            window.switchView('view-store-hub');
        }
    } catch (err) {
        showToast(err.message || "Login failed");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> STORE LOGIN`;
        }
    }
}

export function merchantLogout() {
    localStorage.removeItem('lokalex_merchant_account_id');
    localStorage.removeItem('lokalex_merchant_store_id');
    localStorage.removeItem('lokalex_merchant_store_name');
    localStorage.removeItem('lokalex_merchant_username');

    appState.merchantAccountId = null;
    appState.merchantStoreId = null;
    appState.merchantStoreName = null;
    appState.merchantUsername = null;

    showToast("👋 Merchant session logged out.");
    location.reload();
}

loadMerchantSession();