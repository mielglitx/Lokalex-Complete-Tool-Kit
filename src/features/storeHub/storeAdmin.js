// src/features/storeHub/storeAdmin.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { API_URL } from '../../config/constants.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { escapeHtml, getLocalTodayStr } from '../../utils/helpers.js';
import { isAdmin } from '../roster/rosterUtils.js';

export function openAdminStoreAccountModal() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const modal = document.getElementById('admin-store-account-modal');
    if (modal) {
        modal.classList.remove('hidden');
        resetAdminStoreAccountForm();
        renderAdminStoreAccountsList();
    }
}

export function closeAdminStoreAccountModal() {
    const modal = document.getElementById('admin-store-account-modal');
    if (modal) modal.classList.add('hidden');
}

export function resetAdminStoreAccountForm() {
    const nameInput = document.getElementById('store-acc-name');
    const ownerInput = document.getElementById('store-acc-owner');
    const userInput = document.getElementById('store-acc-username');
    const passInput = document.getElementById('store-acc-password');
    const emailInput = document.getElementById('store-acc-email');
    const addrInput = document.getElementById('store-acc-address');
    const commInput = document.getElementById('store-acc-comm');

    if (nameInput) nameInput.value = "";
    if (ownerInput) ownerInput.value = "";
    if (userInput) userInput.value = "";
    if (passInput) passInput.value = "";
    if (emailInput) emailInput.value = "";
    if (addrInput) addrInput.value = "";
    if (commInput) commInput.value = "10";
}

export function generateStoreCredentials() {
    const nameInput = document.getElementById('store-acc-name');
    const userInput = document.getElementById('store-acc-username');
    const passInput = document.getElementById('store-acc-password');

    const storeName = (nameInput?.value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const prefix = storeName ? storeName.slice(0, 8) : "store";
    const rand = Math.floor(1000 + Math.random() * 9000);

    if (userInput) userInput.value = `${prefix}_${rand}`;
    if (passInput) passInput.value = Math.random().toString(36).slice(-8);

    showToast("🎲 Generated username and temporary password!");
}

export async function submitCreateStoreAccount() {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    const nameEl = document.getElementById('store-acc-name') || document.getElementById('store-name');
    const ownerEl = document.getElementById('store-acc-owner') || document.getElementById('store-owner');
    const userEl = document.getElementById('store-acc-username') || document.getElementById('store-username');
    const passEl = document.getElementById('store-acc-password') || document.getElementById('store-password');
    const emailEl = document.getElementById('store-acc-email') || document.getElementById('store-email');
    const addrEl = document.getElementById('store-acc-address') || document.getElementById('store-address');
    const commEl = document.getElementById('store-acc-comm') || document.getElementById('store-comm');

    const storeName = (nameEl?.value || "").trim();
    const ownerName = (ownerEl?.value || "").trim();
    const username = (userEl?.value || "").trim().toLowerCase();
    const password = (passEl?.value || "").trim();
    const email = (emailEl?.value || "").trim().toLowerCase();
    const address = (addrEl?.value || "").trim();
    const commissionRate = parseFloat(commEl?.value) || 10;

    if (!storeName) return showToast("⚠️ Store Name is required!");
    if (!username || username.length < 4) return showToast("⚠️ Username must be at least 4 characters!");
    if (!password || password.length < 6) return showToast("⚠️ Password must be at least 6 characters!");
    if (!email || !email.includes('@')) return showToast("⚠️ Valid Email address is required!");

    const submitBtn = document.getElementById('store-acc-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Creating & Sending Email...`;
    }

    try {
        if (!db) throw new Error("Database offline.");

        const userCheckSnap = await db.ref('storeAccounts').orderByChild('username').equalTo(username).once('value');
        if (userCheckSnap.exists()) {
            throw new Error("🚫 Username already taken. Please choose another username.");
        }

        const accountId = `ACC_${Date.now()}_${Math.random().toString(36).slice(-4).toUpperCase()}`;
        const storeId = `STORE_${Date.now()}_${Math.random().toString(36).slice(-4).toUpperCase()}`;

        if (!accountId || accountId.trim() === "") throw new Error("Invalid account ID.");
        if (!storeId || storeId.trim() === "") throw new Error("Invalid store ID.");

        const accountPayload = {
            accountId,
            username,
            password,
            storeName,
            ownerName: ownerName || "Merchant Owner",
            email: email || "",
            assignedStoreId: storeId,
            status: "active",
            createdAt: Date.now(),
            createdBy: appState.riderName || "Admin"
        };

        const storePayload = {
            storeId,
            ownerAccountId: accountId,
            storeName,
            ownerName: ownerName || "Merchant Owner",
            address: address || "",
            email: email || "",
            commissionRate,
            isOpen: true,
            operatingHours: {
                enabled: false,
                openTime: "08:00",
                closeTime: "21:00"
            },
            createdAt: Date.now()
        };

        const cleanNameSlug = storeName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const dirCleanKey = cleanNameSlug ? cleanNameSlug : `store_${Date.now()}`;

        if (!dirCleanKey || dirCleanKey.trim() === "") throw new Error("Invalid directory key.");

        const directoryPayload = {
            name: storeName,
            contact: email || "",
            address: address || "",
            rate: address || "",
            lat_lon_link: "",
            type: "stores",
            recorded_by: "Store Hub",
            recorded_at: getLocalTodayStr()
        };

        await db.ref(`storeAccounts/${accountId}`).set(accountPayload);
        await db.ref(`stores/${storeId}`).set(storePayload);
        await db.ref(`directory/stores/${dirCleanKey}`).set(directoryPayload);

        // Construct Email Content
        const emailSubject = `Your Lokalex Store Hub Credentials - ${storeName}`;
        const emailBody = `Hello ${ownerName || storeName},\n\nYour Store Hub merchant account has been successfully created on Lokalex.\n\nStore Name: ${storeName}\nUsername: ${username}\nPassword: ${password}\n\nYou can now log in to manage your store menu, track incoming orders, and configure your operating hours.\n\nBest regards,\nLokalex Team`;

        const emailId = `EMAIL_${Date.now()}_${Math.random().toString(36).slice(-4).toUpperCase()}`;
        
        // Log to Firebase emails queue with 'sent' status
        await db.ref(`emails/${emailId}`).set({
            to: email,
            subject: emailSubject,
            body: emailBody,
            status: 'sent',
            timestamp: Date.now(),
            type: 'store_credentials'
        });

        // Direct HTTP Dispatch via Resend API using Environment Variable with Detailed Logging
        try {
            const emailApiKey = import.meta.env.VITE_RESEND_API_KEY;
            
            const resendResponse = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${emailApiKey}`
                },
                body: JSON.stringify({
                    from: 'Lokalex <onboarding@resend.dev>',
                    to: [email],
                    subject: emailSubject,
                    text: emailBody
                })
            });

            const resendData = await resendResponse.json();
            if (!resendResponse.ok) {
                console.error("Resend API Error Response:", resendData);
            } else {
                console.log("Resend API Success:", resendData);
            }
        } catch (emailErr) {
            console.error("Resend API network/dispatch exception:", emailErr);
        }

        showToast(`🎉 Merchant Store account for [${storeName}] created! Email dispatched.`);
        showSideNotification("STORE CREATED", `Account created: @${username}`, "fa-store", "text-emerald-400", "border-emerald-500");

        resetAdminStoreAccountForm();
        renderAdminStoreAccountsList();
    } catch (err) {
        console.error("Create store account error:", err);
        showToast(`❌ ${err.message || "Failed to create account"}`);
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="fa-solid fa-plus-circle"></i> CREATE STORE ACCOUNT`;
        }
    }
}

export function renderAdminStoreAccountsList() {
    const container = document.getElementById('admin-store-accounts-list');
    if (!container || !db) return;

    db.ref('storeAccounts').once('value', (snapshot) => {
        const val = snapshot.val() || {};
        const keys = Object.keys(val);
        const list = Object.values(val);

        if (list.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-500 italic py-6 text-xs">No store accounts created yet.</div>`;
            return;
        }

        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        container.innerHTML = list.map((item, idx) => {
            const accId = item.accountId || keys[idx];
            const sId = item.assignedStoreId || item.storeId || "";

            return `
            <div class="bg-black/40 border border-gray-800 p-3 rounded-2xl flex items-center justify-between gap-2 shadow text-xs">
                <div class="flex flex-col min-w-0 flex-1">
                    <span class="font-bold text-white truncate flex items-center gap-1.5">
                        <i class="fa-solid fa-shop text-orange-400"></i> ${escapeHtml(item.storeName)}
                    </span>
                    <span class="text-[10px] text-gray-400 font-mono">User: @${escapeHtml(item.username)} • Pass: ${escapeHtml(item.password)}</span>
                    <span class="text-[9px] text-gray-500">Owner: ${escapeHtml(item.ownerName || 'N/A')} • Email: ${escapeHtml(item.email || 'N/A')}</span>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <button onclick="promptDeleteStoreAccount('${accId}', '${sId}', '${escapeHtml(item.storeName)}')" class="bg-gray-800 hover:bg-gray-700 text-red-400 p-2 rounded-xl text-xs transition active:scale-95" title="Delete Store Account">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
        }).join('');
    });
}

export function promptDeleteStoreAccount(accountId, storeId, storeName) {
    if (!isAdmin()) return showToast("⚠️ Unauthorized: Admin access required.");

    openSlideDeleteModal(
        `Delete Store Account?`,
        `Sigurado ka bang nais burahin ang merchant account ni [${storeName}]?`,
        () => {
            executeDeleteStoreAccount(accountId, storeId, storeName);
        }
    );
}

export async function executeDeleteStoreAccount(accountId, storeId, storeName) {
    if (!isAdmin() || !db) return;

    try {
        if (!accountId || accountId === 'undefined' || accountId === 'null') {
            throw new Error("Invalid account ID.");
        }

        const deletePromises = [
            db.ref(`storeAccounts/${accountId}`).remove()
        ];

        if (storeId && storeId !== 'undefined' && storeId !== 'null' && storeId.trim() !== '') {
            deletePromises.push(db.ref(`stores/${storeId}`).remove());
            deletePromises.push(db.ref(`storeMenus/${storeId}`).remove());
        }

        await Promise.all(deletePromises);

        showToast(`🗑️ Store account [${storeName}] deleted.`);
        renderAdminStoreAccountsList();
    } catch (e) {
        console.error("Delete store account error:", e);
        showToast("❌ Failed to delete store account.");
    }
}