// src/features/storeHub/storeAdmin.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
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
    const contactInput = document.getElementById('store-acc-contact');
    const addrInput = document.getElementById('store-acc-address');
    const commInput = document.getElementById('store-acc-comm');

    if (nameInput) nameInput.value = "";
    if (ownerInput) ownerInput.value = "";
    if (userInput) userInput.value = "";
    if (passInput) passInput.value = "";
    if (contactInput) contactInput.value = "";
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

    const storeName = document.getElementById('store-acc-name')?.value.trim();
    const ownerName = document.getElementById('store-acc-owner')?.value.trim();
    const username = document.getElementById('store-acc-username')?.value.trim().toLowerCase();
    const password = document.getElementById('store-acc-password')?.value.trim();
    const contact = document.getElementById('store-acc-contact')?.value.trim();
    const address = document.getElementById('store-acc-address')?.value.trim();
    const commissionRate = parseFloat(document.getElementById('store-acc-comm')?.value) || 10;

    if (!storeName) return showToast("⚠️ Store Name is required!");
    if (!username || username.length < 4) return showToast("⚠️ Username must be at least 4 characters!");
    if (!password || password.length < 6) return showToast("⚠️ Password must be at least 6 characters!");

    const submitBtn = document.getElementById('store-acc-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Creating Account...`;
    }

    try {
        if (!db) throw new Error("Database offline.");

        const userCheckSnap = await db.ref('storeAccounts').orderByChild('username').equalTo(username).once('value');
        if (userCheckSnap.exists()) {
            throw new Error("🚫 Username already taken. Please choose another username.");
        }

        const accountId = `ACC_${Date.now().toString(36).toUpperCase()}`;
        const storeId = `STORE_${Date.now().toString(36).toUpperCase()}`;

        const accountPayload = {
            accountId,
            username,
            password,
            storeName,
            ownerName: ownerName || "Merchant Owner",
            contact: contact || "",
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
            contact: contact || "",
            commissionRate,
            isOpen: true,
            operatingHours: {
                enabled: false,
                openTime: "08:00",
                closeTime: "21:00"
            },
            createdAt: Date.now()
        };

        const dirCleanKey = storeName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const directoryPayload = {
            name: storeName,
            contact: contact || "",
            address: address || "",
            rate: address || "",
            lat_lon_link: "",
            type: "stores",
            recorded_by: "Store Hub",
            recorded_at: getLocalTodayStr()
        };

        const updates = {};
        updates[`storeAccounts/${accountId}`] = accountPayload;
        updates[`stores/${storeId}`] = storePayload;
        updates[`directory/stores/${dirCleanKey}`] = directoryPayload;

        await db.ref().update(updates);

        showToast(`🎉 Merchant Store account for [${storeName}] created!`);
        showSideNotification("STORE CREATED", `Account created: @${username}`, "fa-store", "text-emerald-400", "border-emerald-500");

        resetAdminStoreAccountForm();
        renderAdminStoreAccountsList();
    } catch (err) {
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
        const list = Object.values(val);

        if (list.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-500 italic py-6 text-xs">No store accounts created yet.</div>`;
            return;
        }

        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        container.innerHTML = list.map(item => `
            <div class="bg-black/40 border border-gray-800 p-3 rounded-2xl flex items-center justify-between gap-2 shadow text-xs">
                <div class="flex flex-col min-w-0 flex-1">
                    <span class="font-bold text-white truncate flex items-center gap-1.5">
                        <i class="fa-solid fa-shop text-orange-400"></i> ${escapeHtml(item.storeName)}
                    </span>
                    <span class="text-[10px] text-gray-400 font-mono">User: @${escapeHtml(item.username)} • Pass: ${escapeHtml(item.password)}</span>
                    <span class="text-[9px] text-gray-500">Owner: ${escapeHtml(item.ownerName || 'N/A')} • Contact: ${escapeHtml(item.contact || 'N/A')}</span>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <button onclick="promptDeleteStoreAccount('${item.accountId}', '${item.assignedStoreId}', '${escapeHtml(item.storeName)}')" class="bg-gray-800 hover:bg-gray-700 text-red-400 p-2 rounded-xl text-xs transition active:scale-95" title="Delete Store Account">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
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
        const updates = {};
        updates[`storeAccounts/${accountId}`] = null;
        updates[`stores/${storeId}`] = null;
        updates[`storeMenus/${storeId}`] = null;

        await db.ref().update(updates);

        showToast(`🗑️ Store account [${storeName}] deleted.`);
        renderAdminStoreAccountsList();
    } catch (e) {
        showToast("❌ Failed to delete store account.");
    }
}