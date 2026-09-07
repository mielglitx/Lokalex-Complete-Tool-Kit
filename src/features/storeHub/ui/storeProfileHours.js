// src/features/storeHub/ui/storeProfileHours.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { showToast, showSideNotification } from '../../../ui/notifications.js';
import { getLocalTodayStr, isSameDate } from '../../../utils/helpers.js';
import { syncHeaderAndWidgets } from '../../../ui/router.js';
import { updateStoreOpenStatus, updateStoreProfile, updateStoreLogo } from '../storeMenu.js';
import { storeHubState, cleanFirebasePathKey, compressImageFile } from './storeHubState.js';

export function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const clean = String(timeStr).trim();
    const match = clean.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3] ? match[3].toUpperCase() : null;

    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    return hours * 60 + minutes;
}

export function checkAndApplyStoreOperatingHours() {
    const storeData = storeHubState.currentStoreData;
    if (!storeData || !storeData.operatingHours || !storeData.operatingHours.enabled) return;

    const { openTime, closeTime } = storeData.operatingHours;
    if (!openTime || !closeTime) return;

    const openTotalMins = parseTimeToMinutes(openTime);
    const closeTotalMins = parseTimeToMinutes(closeTime);

    if (openTotalMins === null || closeTotalMins === null) return;

    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    let shouldBeOpen = false;
    if (openTotalMins <= closeTotalMins) {
        shouldBeOpen = currentMins >= openTotalMins && currentMins < closeTotalMins;
    } else {
        shouldBeOpen = currentMins >= openTotalMins || currentMins < closeTotalMins;
    }

    const currentIsOpen = storeData.isOpen !== false;
    if (shouldBeOpen !== currentIsOpen) {
        storeData.isOpen = shouldBeOpen;
        const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
        const storeId = cleanFirebasePathKey(rawStoreId);
        if (storeId && db) {
            db.ref(`stores/${storeId}`).update({ isOpen: shouldBeOpen }).catch(() => {});
        }
        updateStoreStatusButton(shouldBeOpen);
    }
}

export function openOperatingHoursModal() {
    const modal = document.getElementById('store-hours-modal');
    if (!modal) return;

    const enabledToggle = document.getElementById('hours-auto-schedule-enabled');
    const openInput = document.getElementById('hours-open-time');
    const closeInput = document.getElementById('hours-close-time');

    const config = storeHubState.currentStoreData?.operatingHours || {};
    if (enabledToggle) enabledToggle.checked = !!config.enabled;
    if (openInput) openInput.value = config.openTime || "08:00";
    if (closeInput) closeInput.value = config.closeTime || "21:00";

    modal.classList.remove('hidden');
}

export function closeOperatingHoursModal() {
    const modal = document.getElementById('store-hours-modal');
    if (modal) modal.classList.add('hidden');
}

export async function saveOperatingHoursSettings() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);

    const enabledToggle = document.getElementById('hours-auto-schedule-enabled');
    const openInput = document.getElementById('hours-open-time');
    const closeInput = document.getElementById('hours-close-time');

    const enabled = enabledToggle ? enabledToggle.checked : false;
    const openTime = openInput ? openInput.value : "08:00";
    const closeTime = closeInput ? closeInput.value : "21:00";

    if (!storeId || !db) return;

    try {
        await db.ref(`stores/${storeId}/operatingHours`).set({
            enabled,
            openTime,
            closeTime,
            updatedAt: Date.now()
        });

        if (storeHubState.currentStoreData) {
            storeHubState.currentStoreData.operatingHours = {
                enabled,
                openTime,
                closeTime,
                updatedAt: Date.now()
            };
        }

        closeOperatingHoursModal();
        showToast(`⚙️ Operating Hours saved (${openTime} - ${closeTime})!`);
        showSideNotification("SCHEDULE SAVED", `Hours: ${openTime} - ${closeTime}`, "fa-clock", "text-purple-400", "border-purple-500");
        checkAndApplyStoreOperatingHours();
    } catch(e) {
        showToast("❌ Failed to save operating hours.");
    }
}

export function renderDailySalesSummary() {
    const grossEl = document.getElementById('merch-sales-gross');
    const commEl = document.getElementById('merch-sales-commission');
    const netEl = document.getElementById('merch-sales-net');
    const countEl = document.getElementById('merch-sales-count');
    const rateEl = document.getElementById('merch-comm-rate-badge');

    if (!grossEl && !netEl) return;

    const rawComm = storeHubState.currentStoreData?.commissionRate;
    const commRate = (rawComm !== undefined && rawComm !== null && rawComm !== '' && !isNaN(parseFloat(rawComm)))
        ? parseFloat(rawComm)
        : 10;

    if (rateEl) rateEl.innerText = `${commRate}%`;

    const todayStr = getLocalTodayStr();
    let todayGross = 0;
    let completedOrdersToday = 0;

    Object.values(storeHubState.currentOrdersData || {}).forEach(order => {
        if (!order) return;
        const isDone = order.status === 'picked_up' || order.status === 'delivered' || order.status === 'done' || order.isDone;
        const orderDateStr = order.timestamp ? new Date(order.timestamp).toISOString().split('T')[0] : '';

        if (isDone && (orderDateStr === todayStr || isSameDate(order.date, todayStr))) {
            todayGross += (parseFloat(order.totalAmount) || 0);
            completedOrdersToday++;
        }
    });

    const platformCommission = (todayGross * commRate) / 100;
    const netTakeHome = todayGross - platformCommission;

    if (grossEl) grossEl.innerText = `₱${todayGross.toFixed(2)}`;
    if (commEl) commEl.innerText = `-₱${platformCommission.toFixed(2)}`;
    if (netEl) netEl.innerText = `₱${netTakeHome.toFixed(2)}`;
    if (countEl) countEl.innerText = `${completedOrdersToday} orders completed`;
}

export function updateStoreProfileUI(storeData) {
    const nameEl = document.getElementById('merch-store-display-name');
    const addrEl = document.getElementById('merch-store-address-text');
    const imgEl = document.getElementById('merch-store-avatar-img');
    const iconEl = document.getElementById('merch-store-avatar-icon');

    if (storeData.storeName && nameEl) {
        nameEl.innerText = storeData.storeName;
        appState.merchantStoreName = storeData.storeName;
        localStorage.setItem('lokalex_merchant_store_name', storeData.storeName);
    }

    if (addrEl) {
        addrEl.innerText = storeData.address || "Walang nakatakdang address";
    }

    if (imgEl && iconEl) {
        if (storeData.logoUrl) {
            imgEl.src = storeData.logoUrl;
            imgEl.classList.remove('hidden');
            iconEl.classList.add('hidden');
            localStorage.setItem('lokalex_merchant_avatar', storeData.logoUrl);
        } else {
            imgEl.classList.add('hidden');
            iconEl.classList.remove('hidden');
        }
    }

    syncHeaderAndWidgets('view-store-hub');
}

export function updateStoreStatusButton(isOpen) {
    const btn = document.getElementById('merch-store-status-btn');
    if (!btn) return;

    if (isOpen) {
        btn.className = "px-3 py-1.5 rounded-full text-[10px] font-black border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 transition active:scale-95 shrink-0";
        btn.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>OPEN FOR ORDERS</span>`;
    } else {
        btn.className = "px-3 py-1.5 rounded-full text-[10px] font-black border border-red-500/40 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 flex items-center gap-1.5 transition active:scale-95 shrink-0";
        btn.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span><span>STORE CLOSED</span>`;
    }
}

export function toggleStoreOpenStatus() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const currentIsOpen = storeHubState.currentStoreData ? (storeHubState.currentStoreData.isOpen !== false) : true;
    updateStoreOpenStatus(storeId, !currentIsOpen);
}

export function openEditStoreProfileModal() {
    const modal = document.getElementById('store-profile-modal');
    const nameInput = document.getElementById('store-edit-name');
    const addrInput = document.getElementById('store-edit-address');

    if (nameInput) nameInput.value = storeHubState.currentStoreData?.storeName || appState.merchantStoreName || '';
    if (addrInput) addrInput.value = storeHubState.currentStoreData?.address || '';

    if (modal) modal.classList.remove('hidden');
    if (nameInput) setTimeout(() => nameInput.focus(), 100);
}

export function closeEditStoreProfileModal() {
    const modal = document.getElementById('store-profile-modal');
    if (modal) modal.classList.add('hidden');
}

export async function submitSaveStoreProfile() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const newName = document.getElementById('store-edit-name')?.value.trim();
    const newAddress = document.getElementById('store-edit-address')?.value.trim();

    if (!newName) return showToast("⚠️ I-enter ang pangalan ng Store!");

    const saveBtn = document.getElementById('store-profile-save-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        await updateStoreProfile(storeId, {
            storeName: newName,
            address: newAddress || ""
        });
        closeEditStoreProfileModal();
    } catch (e) {
        showToast("❌ Failed to update store profile.");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> SAVE STORE DETAILS`;
        }
    }
}

export function updateIconModalPreview(urlOrBase64) {
    const previewImg = document.getElementById('store-icon-modal-preview-img');
    const previewIcon = document.getElementById('store-icon-modal-preview-icon');

    if (!previewImg || !previewIcon) return;

    if (urlOrBase64) {
        previewImg.src = urlOrBase64;
        previewImg.classList.remove('hidden');
        previewIcon.classList.add('hidden');
    } else {
        previewImg.src = '';
        previewImg.classList.add('hidden');
        previewIcon.classList.remove('hidden');
    }
}

export function openStoreIconModal() {
    const modal = document.getElementById('store-icon-modal');
    const urlInput = document.getElementById('store-icon-url-input');
    const fileInput = document.getElementById('store-icon-file-input');

    storeHubState.stagedLogoData = storeHubState.currentStoreData?.logoUrl || '';

    if (urlInput) {
        urlInput.value = storeHubState.stagedLogoData.startsWith('data:image') ? '' : storeHubState.stagedLogoData;
    }
    if (fileInput) fileInput.value = '';

    updateIconModalPreview(storeHubState.stagedLogoData);

    if (modal) modal.classList.remove('hidden');
}

export function closeStoreIconModal() {
    const modal = document.getElementById('store-icon-modal');
    if (modal) modal.classList.add('hidden');
}

export async function handleStoreIconFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    showToast("⏳ Processing image...");

    try {
        const compressedBase64 = await compressImageFile(file, 320, 320, 0.85);
        storeHubState.stagedLogoData = compressedBase64;

        const urlInput = document.getElementById('store-icon-url-input');
        if (urlInput) urlInput.value = '';

        updateIconModalPreview(storeHubState.stagedLogoData);
        showToast("✅ Image selected and compressed!");
    } catch (err) {
        showToast("❌ Hindi ma-load ang image file. Subukan muli.");
    }
}

export function onStoreIconUrlInput(urlValue) {
    storeHubState.stagedLogoData = (urlValue || '').trim();
    updateIconModalPreview(storeHubState.stagedLogoData);
}

export function clearStoreIcon() {
    storeHubState.stagedLogoData = '';
    const urlInput = document.getElementById('store-icon-url-input');
    const fileInput = document.getElementById('store-icon-file-input');

    if (urlInput) urlInput.value = '';
    if (fileInput) fileInput.value = '';

    updateIconModalPreview('');
    showToast("🗑️ Logo cleared. Click Save to apply.");
}

export async function submitSaveStoreIcon() {
    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const saveBtn = document.getElementById('store-icon-save-btn');

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        await updateStoreLogo(storeId, storeHubState.stagedLogoData);
        closeStoreIconModal();
    } catch (e) {
        showToast("❌ Failed to update store icon.");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> SAVE LOGO`;
        }
    }
}