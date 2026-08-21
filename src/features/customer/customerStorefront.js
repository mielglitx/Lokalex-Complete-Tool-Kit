// src/features/customer/customerStorefront.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';
import { openSlideDeleteModal } from '../../ui/modals.js';

let storesCache = {};
let menusCache = {};
let activeViewingStoreId = null;
let activeViewingCategoryId = 'ALL';
let activeCustomizingItem = null;
let customizerQty = 1;
let stagedCustomerAvatarData = '';
let activeCustomerOrderListener = null;

// Load cached store state from localStorage immediately
try {
    const cachedStores = localStorage.getItem('lokalex_cached_stores_v1');
    if (cachedStores) storesCache = JSON.parse(cachedStores);
    const cachedMenus = localStorage.getItem('lokalex_cached_menus_v1');
    if (cachedMenus) menusCache = JSON.parse(cachedMenus);
} catch(e) {}

function cleanFirebasePathKey(key) {
    return String(key || '').replace(/^#+/, '').replace(/[.#$\[\]\/]/g, '_').trim();
}

function areItemsMatching(itemA, itemB) {
    if (!itemA || !itemB) return false;
    if (itemA.itemId !== itemB.itemId) return false;
    
    const sizeA = itemA.size?.name || '';
    const sizeB = itemB.size?.name || '';
    if (sizeA !== sizeB) return false;
    
    const notesA = (itemA.instructions || '').trim().toLowerCase();
    const notesB = (itemB.instructions || '').trim().toLowerCase();
    if (notesA !== notesB) return false;
    
    const addonsA = (itemA.addons || []).map(a => `${a.name}:${parseFloat(a.priceDelta || 0).toFixed(2)}`).sort().join('|');
    const addonsB = (itemB.addons || []).map(a => `${a.name}:${parseFloat(a.priceDelta || 0).toFixed(2)}`).sort().join('|');
    if (addonsA !== addonsB) return false;
    
    return true;
}

function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

function compressAvatarImageFile(file, maxDim = 250, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxDim) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    }
                } else {
                    if (height > maxDim) {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = (err) => reject(err);
            img.src = e.target.result;
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

export function initCustomerStorefront() {
    renderCustomerHeaderProfile();

    if (Object.keys(storesCache).length > 0) {
        renderStoresGrid();
    }

    if (!db) {
        renderStoresGrid();
        return;
    }

    db.ref('stores').once('value', (snap) => {
        const data = snap.val();
        if (data && Object.keys(data).length > 0) {
            storesCache = data;
            try { localStorage.setItem('lokalex_cached_stores_v1', JSON.stringify(data)); } catch(e){}
            renderStoresGrid();
        } else {
            db.ref('directory/stores').once('value', (dirSnap) => {
                const dirData = dirSnap.val();
                if (dirData && Object.keys(dirData).length > 0) {
                    storesCache = dirData;
                    try { localStorage.setItem('lokalex_cached_stores_v1', JSON.stringify(dirData)); } catch(e){}
                }
                renderStoresGrid();
            }).catch(() => {
                renderStoresGrid();
            });
        }
    }).catch(() => {
        renderStoresGrid();
    });

    db.ref('stores').on('value', (snap) => {
        const data = snap.val();
        if (data && Object.keys(data).length > 0) {
            storesCache = data;
            try { localStorage.setItem('lokalex_cached_stores_v1', JSON.stringify(data)); } catch(e){}
            renderStoresGrid();
        }
    });

    db.ref('storeMenus').on('value', (snap) => {
        menusCache = snap.val() || {};
        try { localStorage.setItem('lokalex_cached_menus_v1', JSON.stringify(menusCache)); } catch(e){}
        if (activeViewingStoreId) {
            renderStoreMenuItems(activeViewingStoreId);
        }
        renderStoresGrid();
    });

    let custId = localStorage.getItem('lokalex_customer_fb_id') || localStorage.getItem('customerId') || appState.customerFacebookId || appState.customerId;
    if (!custId) {
        custId = `CUST_${Date.now().toString(36).toUpperCase()}`;
        localStorage.setItem('lokalex_customer_fb_id', custId);
        appState.customerFacebookId = custId;
    }

    if (custId) {
        const cleanCustId = cleanFirebasePathKey(custId);
        db.ref(`customers/${cleanCustId}`).on('value', (snap) => {
            const data = snap.val() || {};
            if (data.name) {
                localStorage.setItem('customerName', data.name);
                localStorage.setItem('lokalex_customer_name', data.name);
            }
            if (data.phoneNumber) {
                localStorage.setItem('customerPhone', data.phoneNumber);
                localStorage.setItem('lokalex_customer_email', data.phoneNumber);
            }
            if (data.avatarUrl) {
                localStorage.setItem('customerAvatarUrl', data.avatarUrl);
                localStorage.setItem('lokalex_customer_avatar', data.avatarUrl);
            }
            renderCustomerHeaderProfile();
        });

        listenToActiveCustomerOrderStatus(cleanCustId);
    }

    updateFloatingCartBadge();
}

// -------------------------------------------------------------
// LIVE CUSTOMER ORDER MILESTONE PROGRESS TRACKER
// -------------------------------------------------------------
export function listenToActiveCustomerOrderStatus(custId) {
    if (!db || !custId) return;

    if (activeCustomerOrderListener) activeCustomerOrderListener.off();

    activeCustomerOrderListener = db.ref(`customerChats/${custId}/metadata`);
    activeCustomerOrderListener.on('value', (snap) => {
        const meta = snap.val() || {};
        const latestOrderId = cleanFirebasePathKey(meta.latestOrderId);

        if (!latestOrderId || meta.folder === 'done' || meta.status === 'cancelled') {
            renderCustomerMilestoneCard(null);
            return;
        }

        db.ref(`orders/${latestOrderId}`).on('value', (orderSnap) => {
            const orderData = orderSnap.val();
            if (!orderData || orderData.status === 'delivered') {
                renderCustomerMilestoneCard(null);
            } else {
                renderCustomerMilestoneCard(orderData);
            }
        });
    });
}

function renderCustomerMilestoneCard(orderData) {
    let trackerContainer = document.getElementById('cust-active-order-milestone-dock');
    const customerHome = document.getElementById('view-customer-home');

    if (!orderData) {
        if (trackerContainer) trackerContainer.classList.add('hidden');
        return;
    }

    if (!trackerContainer && customerHome) {
        trackerContainer = document.createElement('div');
        trackerContainer.id = 'cust-active-order-milestone-dock';
        trackerContainer.className = 'w-full px-3 py-1';
        customerHome.insertBefore(trackerContainer, customerHome.firstChild);
    }

    if (!trackerContainer) return;

    const status = orderData.status || 'placed';
    const orderId = orderData.orderId || 'ORD';
    const riderName = orderData.assignedRiderName || 'Assigning Rider...';

    const stages = [
        { key: 'placed', label: 'Placed', icon: 'fa-receipt' },
        { key: 'preparing', label: 'Preparing', icon: 'fa-fire' },
        { key: 'picked_up', label: 'On The Way', icon: 'fa-motorcycle' },
        { key: 'arrived', label: 'Arrived', icon: 'fa-location-dot' }
    ];

    const currentStageIdx = stages.findIndex(s => s.key === status);
    const activeIdx = currentStageIdx !== -1 ? currentStageIdx : 0;

    const stepperHtml = stages.map((st, idx) => {
        const isDone = idx <= activeIdx;
        const isCurrent = idx === activeIdx;

        return `
        <div class="flex flex-col items-center flex-1 min-w-0">
            <div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${isDone ? 'bg-emerald-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-400'} ${isCurrent ? 'ring-2 ring-emerald-400 animate-pulse' : ''}">
                <i class="fa-solid ${st.icon}"></i>
            </div>
            <span class="text-[8.5px] mt-1 font-bold ${isDone ? 'text-gray-900 dark:text-white' : 'text-gray-400'} truncate w-full text-center">${st.label}</span>
        </div>`;
    }).join(`
        <div class="flex-1 h-0.5 bg-gray-200 dark:bg-gray-800 self-center -mt-3"></div>
    `);

    trackerContainer.innerHTML = `
        <div class="bg-cardBg border border-emerald-500/40 rounded-2xl p-3 shadow-md flex flex-col gap-2.5">
            <div class="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-1.5">
                <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span class="font-black text-xs text-gray-900 dark:text-white">Active Order #${escapeHtml(orderId)}</span>
                </div>
                <span class="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold font-mono">🛵 ${escapeHtml(riderName)}</span>
            </div>
            <div class="flex items-center justify-between w-full px-1">
                ${stepperHtml}
            </div>
        </div>
    `;

    trackerContainer.classList.remove('hidden');
}

export function renderCustomerHeaderProfile() {
    const custName = localStorage.getItem('customerName') || localStorage.getItem('lokalex_customer_name') || appState.customerName || "Customer";
    const custPhone = localStorage.getItem('customerPhone') || localStorage.getItem('lokalex_customer_email') || "No Contact";
    const avatarUrl = localStorage.getItem('customerAvatarUrl') || localStorage.getItem('lokalex_customer_avatar') || "";

    const nameEl = document.getElementById('cust-landing-name');
    const phoneEl = document.getElementById('cust-landing-email');
    const avatarImg = document.getElementById('cust-landing-avatar');
    const initialsEl = document.getElementById('cust-landing-initials');

    if (nameEl) nameEl.innerText = custName;
    if (phoneEl) phoneEl.innerText = custPhone;

    if (avatarImg && initialsEl) {
        if (avatarUrl) {
            avatarImg.src = avatarUrl;
            avatarImg.classList.remove('hidden');
            initialsEl.classList.add('hidden');
        } else {
            const initials = custName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            initialsEl.innerText = initials || "CU";
            initialsEl.classList.remove('hidden');
            avatarImg.classList.add('hidden');
        }
    }
}

export function openEditCustomerProfileModal() {
    const modal = document.getElementById('edit-customer-profile-modal');
    const nameInput = document.getElementById('cust-edit-name-input');
    const phoneInput = document.getElementById('cust-edit-phone-input');
    const urlInput = document.getElementById('cust-edit-avatar-url-input');
    const fileInput = document.getElementById('cust-avatar-file-input');

    const custName = localStorage.getItem('customerName') || localStorage.getItem('lokalex_customer_name') || appState.customerName || "";
    const custPhone = localStorage.getItem('customerPhone') || localStorage.getItem('lokalex_customer_email') || "";
    stagedCustomerAvatarData = localStorage.getItem('customerAvatarUrl') || localStorage.getItem('lokalex_customer_avatar') || "";

    if (nameInput) nameInput.value = custName;
    if (phoneInput) phoneInput.value = custPhone;
    if (urlInput) urlInput.value = stagedCustomerAvatarData.startsWith('data:image') ? '' : stagedCustomerAvatarData;
    if (fileInput) fileInput.value = '';

    updateCustomerAvatarModalPreview(stagedCustomerAvatarData, custName);

    if (modal) modal.classList.remove('hidden');
}

export function closeEditCustomerProfileModal() {
    const modal = document.getElementById('edit-customer-profile-modal');
    if (modal) modal.classList.add('hidden');
}

export function updateCustomerAvatarModalPreview(urlOrBase64, name = "") {
    const previewImg = document.getElementById('cust-modal-avatar-preview');
    const initialsEl = document.getElementById('cust-modal-avatar-initials');
    if (!previewImg || !initialsEl) return;

    if (urlOrBase64) {
        previewImg.src = urlOrBase64;
        previewImg.classList.remove('hidden');
        initialsEl.classList.add('hidden');
    } else {
        const initials = (name || "Customer").split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        initialsEl.innerText = initials;
        initialsEl.classList.remove('hidden');
        previewImg.classList.add('hidden');
    }
}

export async function handleCustomerAvatarFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    showToast("⏳ Processing image...");

    try {
        const compressedBase64 = await compressAvatarImageFile(file, 250, 0.85);
        stagedCustomerAvatarData = compressedBase64;

        const urlInput = document.getElementById('cust-edit-avatar-url-input');
        if (urlInput) urlInput.value = '';

        updateCustomerAvatarModalPreview(stagedCustomerAvatarData);
        showToast("✅ Photo selected!");
    } catch(e) {
        showToast("❌ Failed to process image.");
    }
}

export function onCustomerAvatarUrlInput(url) {
    stagedCustomerAvatarData = (url || '').trim();
    updateCustomerAvatarModalPreview(stagedCustomerAvatarData);
}

export function clearCustomerAvatar() {
    stagedCustomerAvatarData = '';
    const urlInput = document.getElementById('cust-edit-avatar-url-input');
    const fileInput = document.getElementById('cust-avatar-file-input');

    if (urlInput) urlInput.value = '';
    if (fileInput) fileInput.value = '';

    updateCustomerAvatarModalPreview('');
    showToast("🗑️ Photo cleared.");
}

export async function submitSaveCustomerProfile() {
    let rawCustId = localStorage.getItem('lokalex_customer_fb_id') || localStorage.getItem('customerId') || appState.customerFacebookId || appState.customerId;
    if (!rawCustId) {
        rawCustId = `CUST_${Date.now().toString(36).toUpperCase()}`;
        localStorage.setItem('lokalex_customer_fb_id', rawCustId);
        appState.customerFacebookId = rawCustId;
    }

    const name = document.getElementById('cust-edit-name-input')?.value.trim();
    const phone = document.getElementById('cust-edit-phone-input')?.value.trim();

    if (!name) return showToast("⚠️ Name is required!");
    if (!phone) return showToast("⚠️ Contact number is required!");

    const saveBtn = document.getElementById('cust-save-profile-btn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        localStorage.setItem('customerName', name);
        localStorage.setItem('lokalex_customer_name', name);
        localStorage.setItem('customerPhone', phone);
        localStorage.setItem('lokalex_customer_email', phone);
        localStorage.setItem('customerAvatarUrl', stagedCustomerAvatarData || '');
        localStorage.setItem('lokalex_customer_avatar', stagedCustomerAvatarData || '');

        appState.customerName = name;

        if (db && rawCustId) {
            const custId = cleanFirebasePathKey(rawCustId);
            await db.ref(`customers/${custId}`).update({
                name,
                phoneNumber: phone,
                avatarUrl: stagedCustomerAvatarData || null,
                updatedAt: Date.now()
            });

            await db.ref(`customerChats/${custId}/metadata`).update({
                customerName: name,
                avatarUrl: stagedCustomerAvatarData || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0084FF&color=fff`
            }).catch(() => {});
        }

        renderCustomerHeaderProfile();
        closeEditCustomerProfileModal();
        showToast("✅ Profile updated successfully!");
    } catch(e) {
        showToast("❌ Failed to update profile.");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> SAVE PROFILE`;
        }
    }
}

export function openCustomerStoresModal() {
    const modal = document.getElementById('cust-stores-popup-modal');
    const searchInput = document.getElementById('cust-store-search-input');
    if (searchInput) searchInput.value = '';

    if (modal) {
        modal.classList.remove('hidden');
    }

    renderStoresGrid('');
    updateFloatingCartBadge();

    if (db) {
        db.ref('stores').once('value', (snap) => {
            const data = snap.val();
            if (data && Object.keys(data).length > 0) {
                storesCache = data;
                try { localStorage.setItem('lokalex_cached_stores_v1', JSON.stringify(data)); } catch(e){}
                renderStoresGrid(searchInput?.value || '');
            } else {
                db.ref('directory/stores').once('value', (dirSnap) => {
                    const dirData = dirSnap.val();
                    if (dirData && Object.keys(dirData).length > 0) {
                        storesCache = dirData;
                        try { localStorage.setItem('lokalex_cached_stores_v1', JSON.stringify(dirData)); } catch(e){}
                    }
                    renderStoresGrid(searchInput?.value || '');
                }).catch(() => {});
            }
        }).catch(() => {});
    }
}

export function closeCustomerStoresModal() {
    const modal = document.getElementById('cust-stores-popup-modal');
    if (modal) modal.classList.add('hidden');
}

export function renderStoresGrid(searchQuery = '') {
    const grid = document.getElementById('cust-stores-grid');
    if (!grid) return;

    let storeEntries = Object.entries(storesCache || {});

    if (storeEntries.length === 0) {
        try {
            const localCached = localStorage.getItem('lokalex_cached_stores_v1');
            if (localCached) {
                storesCache = JSON.parse(localCached);
                storeEntries = Object.entries(storesCache || {});
            }
        } catch(e) {}
    }

    if (storeEntries.length === 0) {
        grid.innerHTML = `
            <div class="text-center text-gray-500 dark:text-gray-400 italic py-6 text-xs bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-800 rounded-xl p-3 flex flex-col items-center gap-1">
                <i class="fa-solid fa-store-slash text-base text-gray-400 dark:text-gray-600"></i>
                <span>No registered local stores available.</span>
            </div>`;
        return;
    }

    const query = (searchQuery || '').trim().toLowerCase();

    const filtered = storeEntries.filter(([id, store]) => {
        if (!store) return false;
        if (!query) return true;
        const nameMatch = (store.storeName || store.name || '').toLowerCase().includes(query);
        const addrMatch = (store.address || store.rate || '').toLowerCase().includes(query);

        const storeMenu = menusCache[id]?.items || {};
        const itemMatch = Object.values(storeMenu).some(i => (i.name || '').toLowerCase().includes(query));

        return nameMatch || addrMatch || itemMatch;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="text-center text-gray-500 dark:text-gray-400 italic py-4 text-xs bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-800 rounded-xl p-2.5">
                No stores match "${escapeHtml(searchQuery)}".
            </div>`;
        return;
    }

    grid.innerHTML = filtered.map(([storeId, store]) => {
        const isOpen = store.isOpen !== false;
        const storeName = store.storeName || store.name || 'Store';
        const address = store.address || store.rate || 'Poblacion';
        const menuItems = Object.values(menusCache[storeId]?.items || {});
        const logoUrl = store.logoUrl || '';

        return `
        <button type="button" onclick="window.openCustomerStoreMenu('${storeId}')" class="w-full bg-gray-50 dark:bg-black/40 hover:bg-orange-50 dark:hover:bg-orange-950/20 border border-gray-200 dark:border-gray-800 hover:border-orange-500/50 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-2 transition active:scale-[0.99] text-left group shadow-xs">
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <div class="w-6 h-6 rounded-lg bg-orange-500/10 border border-orange-500/30 overflow-hidden flex items-center justify-center text-orange-500 dark:text-orange-400 text-[10px] shrink-0">
                    ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" class="w-full h-full object-cover">` : `<i class="fa-solid fa-shop"></i>`}
                </div>
                <div class="min-w-0 flex-1 flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'} shrink-0"></span>
                    <span class="font-bold text-xs text-gray-900 dark:text-white group-hover:text-orange-600 dark:group-hover:text-orange-400 transition">${escapeHtml(storeName)}</span>
                    <span class="text-[9px] text-gray-400 dark:text-gray-500 truncate hidden sm:inline">• ${escapeHtml(address)}</span>
                </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                <span class="text-[9px] font-bold ${isOpen ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10' : 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10'} px-1.5 py-0.5 rounded-md border border-gray-200 dark:border-gray-800">
                    ${isOpen ? 'Open' : 'Closed'}
                </span>
                <span class="text-[9px] text-gray-500 dark:text-gray-400 font-mono font-bold bg-white dark:bg-black/50 border border-gray-200 dark:border-gray-800 px-1.5 py-0.5 rounded-md">
                    ${menuItems.length}
                </span>
                <i class="fa-solid fa-chevron-right text-[8px] text-gray-400 group-hover:text-orange-400 transition"></i>
            </div>
        </button>`;
    }).join('');
}

export function filterCustomerStores(query) {
    renderStoresGrid(query);
}

export function openCustomerStoreMenu(storeId) {
    activeViewingStoreId = storeId;
    activeViewingCategoryId = 'ALL';

    const store = storesCache[storeId] || { storeName: "Store Menu", address: "", isOpen: true };
    const modal = document.getElementById('cust-store-menu-modal');
    const nameEl = document.getElementById('cust-menu-store-name');
    const addrEl = document.getElementById('cust-menu-store-address');
    const statusBadge = document.getElementById('cust-menu-store-status-badge');
    const imgEl = document.getElementById('cust-menu-store-img');
    const iconEl = document.getElementById('cust-menu-store-icon');

    if (nameEl) nameEl.innerText = store.storeName || store.name || "Store";
    if (addrEl) addrEl.innerHTML = `<i class="fa-solid fa-location-dot text-red-500 text-[9px]"></i> <span>${escapeHtml(store.address || store.rate || 'Poblacion')}</span>`;
    
    if (imgEl && iconEl) {
        if (store.logoUrl) {
            imgEl.src = store.logoUrl;
            imgEl.classList.remove('hidden');
            iconEl.classList.add('hidden');
        } else {
            imgEl.classList.add('hidden');
            iconEl.classList.remove('hidden');
        }
    }

    const isOpen = store.isOpen !== false;
    if (statusBadge) {
        statusBadge.className = `mt-1 inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border ${isOpen ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' : 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30'}`;
        statusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}"></span> ${isOpen ? 'OPEN FOR ORDERS' : 'STORE CLOSED'}`;
    }

    renderStoreMenuItems(storeId);
    updateFloatingCartBadge();

    if (modal) modal.classList.remove('hidden');
}

export function closeCustomerStoreMenuModal() {
    const modal = document.getElementById('cust-store-menu-modal');
    if (modal) modal.classList.add('hidden');
    activeViewingStoreId = null;
}

function renderStoreMenuItems(storeId) {
    const pillsContainer = document.getElementById('cust-menu-category-pills');
    const feed = document.getElementById('cust-menu-items-feed');
    if (!feed) return;

    const storeMenu = menusCache[storeId] || { categories: {}, items: {} };
    const categories = Object.values(storeMenu.categories || {});
    let items = Object.values(storeMenu.items || {});

    if (pillsContainer) {
        let pillsHtml = `
            <button onclick="window.selectCustomerMenuCategory('ALL')" class="${activeViewingCategoryId === 'ALL' ? 'bg-orange-600 text-white' : 'bg-cardBg border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-400'} text-xs font-bold px-3 py-1.5 rounded-xl shrink-0 transition">
                All Items
            </button>`;
        categories.forEach(cat => {
            const isSel = activeViewingCategoryId === cat.name;
            pillsHtml += `
                <button onclick="window.selectCustomerMenuCategory('${escapeHtml(cat.name)}')" class="${isSel ? 'bg-orange-600 text-white' : 'bg-cardBg border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-400'} text-xs font-bold px-3 py-1.5 rounded-xl shrink-0 transition">
                    ${escapeHtml(cat.name)}
                </button>`;
        });
        pillsContainer.innerHTML = pillsHtml;
    }

    if (activeViewingCategoryId !== 'ALL') {
        items = items.filter(it => it.category === activeViewingCategoryId);
    }

    if (items.length === 0) {
        feed.innerHTML = `<div class="text-center text-gray-500 dark:text-gray-400 italic py-10 text-xs">Walang paninda sa kategoryang ito.</div>`;
        return;
    }

    const store = storesCache[storeId] || {};
    const isStoreOpen = store.isOpen !== false;

    feed.innerHTML = items.map(item => {
        const isAvail = item.isAvailable !== false && isStoreOpen;
        const basePrice = parseFloat(item.basePrice || 0);

        return `
        <div class="bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-800/80 rounded-2xl p-2.5 flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-xs text-gray-900 dark:text-white">${escapeHtml(item.name)}</span>
                    <span class="text-xs font-mono font-black text-emerald-600 dark:text-emerald-400">₱${basePrice.toFixed(2)}</span>
                </div>
                ${item.description ? `<p class="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">${escapeHtml(item.description)}</p>` : ''}
            </div>

            <button ${!isAvail ? 'disabled' : ''} onclick="window.openItemCustomizerModal('${storeId}', '${item.id}')" class="shrink-0 ${isAvail ? 'bg-orange-600 hover:bg-orange-500 text-white active:scale-95' : 'bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'} text-xs font-bold px-2.5 py-1.5 rounded-xl transition flex items-center gap-1 shadow-xs">
                <i class="fa-solid fa-plus"></i> ${isAvail ? 'Add' : 'Sold Out'}
            </button>
        </div>`;
    }).join('');
}

export function selectCustomerMenuCategory(catName) {
    activeViewingCategoryId = catName;
    if (activeViewingStoreId) {
        renderStoreMenuItems(activeViewingStoreId);
    }
}

export function openItemCustomizerModal(storeId, itemId) {
    const item = menusCache[storeId]?.items?.[itemId];
    if (!item) return;

    activeCustomizingItem = { ...item, storeId };
    customizerQty = 1;

    document.getElementById('customizer-store-id').value = storeId;
    document.getElementById('customizer-item-id').value = itemId;
    document.getElementById('customizer-item-name').innerText = item.name;
    document.getElementById('customizer-item-desc').innerText = item.description || '';
    document.getElementById('customizer-item-base-price').innerText = parseFloat(item.basePrice || 0).toFixed(2);
    document.getElementById('customizer-item-notes').value = '';
    document.getElementById('customizer-qty-display').innerText = '1';

    const sizesWrapper = document.getElementById('customizer-sizes-wrapper');
    const sizesOptions = document.getElementById('customizer-sizes-options');
    const sizes = item.sizes || [];

    if (sizes.length > 0) {
        sizesWrapper.classList.remove('hidden');
        sizesOptions.innerHTML = sizes.map((s, idx) => `
            <label class="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 cursor-pointer hover:border-blue-500/50">
                <div class="flex items-center gap-2">
                    <input type="radio" name="customizer_size_choice" value="${idx}" ${idx === 0 ? 'checked' : ''} onchange="window.recalculateCustomizerPrice()" class="accent-blue-500">
                    <span class="text-xs font-bold text-gray-900 dark:text-white">${escapeHtml(s.name)}</span>
                </div>
                <span class="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">+₱${parseFloat(s.priceDelta || 0).toFixed(2)}</span>
            </label>
        `).join('');
    } else {
        sizesWrapper.classList.add('hidden');
        sizesOptions.innerHTML = '';
    }

    const addonsWrapper = document.getElementById('customizer-addons-wrapper');
    const addonsOptions = document.getElementById('customizer-addons-options');
    const addons = item.addons || [];

    if (addons.length > 0) {
        addonsWrapper.classList.remove('hidden');
        addonsOptions.innerHTML = addons.map((a, idx) => `
            <label class="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-800 cursor-pointer hover:border-amber-500/50">
                <div class="flex items-center gap-2">
                    <input type="checkbox" name="customizer_addon_choice" value="${idx}" onchange="window.recalculateCustomizerPrice()" class="accent-amber-500 rounded">
                    <span class="text-xs font-bold text-gray-900 dark:text-white">${escapeHtml(a.name)}</span>
                </div>
                <span class="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">+₱${parseFloat(a.priceDelta || 0).toFixed(2)}</span>
            </label>
        `).join('');
    } else {
        addonsWrapper.classList.add('hidden');
        addonsOptions.innerHTML = '';
    }

    recalculateCustomizerPrice();

    const modal = document.getElementById('cust-item-customizer-modal');
    if (modal) modal.classList.remove('hidden');
}

export function closeItemCustomizerModal() {
    const modal = document.getElementById('cust-item-customizer-modal');
    if (modal) modal.classList.add('hidden');
    activeCustomizingItem = null;
}

export function adjustCustomizerQty(delta) {
    customizerQty = Math.max(1, customizerQty + delta);
    document.getElementById('customizer-qty-display').innerText = customizerQty.toString();
    recalculateCustomizerPrice();
}

export function recalculateCustomizerPrice() {
    if (!activeCustomizingItem) return;

    let unitPrice = parseFloat(activeCustomizingItem.basePrice || 0);

    const selectedSizeRadio = document.querySelector('input[name="customizer_size_choice"]:checked');
    if (selectedSizeRadio) {
        const sizeIdx = parseInt(selectedSizeRadio.value);
        const sizeObj = activeCustomizingItem.sizes?.[sizeIdx];
        if (sizeObj) unitPrice += parseFloat(sizeObj.priceDelta || 0);
    }

    document.querySelectorAll('input[name="customizer_addon_choice"]:checked').forEach(cb => {
        const addonIdx = parseInt(cb.value);
        const addonObj = activeCustomizingItem.addons?.[addonIdx];
        if (addonObj) unitPrice += parseFloat(addonObj.priceDelta || 0);
    });

    const total = unitPrice * customizerQty;
    const calcTotalEl = document.getElementById('customizer-calc-total');
    if (calcTotalEl) calcTotalEl.innerText = total.toFixed(2);
}

export function submitAddCustomizedItemToCart() {
    if (!activeCustomizingItem) return;

    const rawStoreId = activeCustomizingItem.storeId;
    const storeId = cleanFirebasePathKey(rawStoreId);
    const store = storesCache[rawStoreId] || storesCache[storeId] || { storeName: "Store", address: "Poblacion" };
    let unitPrice = parseFloat(activeCustomizingItem.basePrice || 0);

    let chosenSize = null;
    const selectedSizeRadio = document.querySelector('input[name="customizer_size_choice"]:checked');
    if (selectedSizeRadio) {
        const sizeIdx = parseInt(selectedSizeRadio.value);
        chosenSize = activeCustomizingItem.sizes?.[sizeIdx] || null;
        if (chosenSize) unitPrice += parseFloat(chosenSize.priceDelta || 0);
    }

    const chosenAddons = [];
    document.querySelectorAll('input[name="customizer_addon_choice"]:checked').forEach(cb => {
        const addonIdx = parseInt(cb.value);
        const addonObj = activeCustomizingItem.addons?.[addonIdx];
        if (addonObj) {
            chosenAddons.push({
                name: addonObj.name || "Addon",
                priceDelta: parseFloat(addonObj.priceDelta || 0)
            });
            unitPrice += parseFloat(addonObj.priceDelta || 0);
        }
    });

    const instructions = document.getElementById('customizer-item-notes')?.value.trim() || '';
    const addQty = parseInt(customizerQty) || 1;
    const targetItemId = activeCustomizingItem.id || `ITEM_${Date.now()}`;

    let cart = getCustomerCart();
    if (!cart[storeId]) {
        cart[storeId] = {
            storeId,
            storeName: store.storeName || store.name || "Store",
            storeAddress: store.address || store.rate || "Poblacion",
            items: []
        };
    }

    const newItemPayload = {
        itemId: targetItemId,
        name: activeCustomizingItem.name || "Menu Item",
        size: chosenSize ? { name: chosenSize.name, priceDelta: parseFloat(chosenSize.priceDelta || 0) } : null,
        addons: chosenAddons,
        instructions: instructions || "",
        unitPrice: parseFloat(unitPrice) || 0,
        quantity: addQty,
        totalPrice: (parseFloat(unitPrice) || 0) * addQty
    };

    const existingIndex = (cart[storeId].items || []).findIndex(it => areItemsMatching(it, newItemPayload));

    if (existingIndex !== -1) {
        const existing = cart[storeId].items[existingIndex];
        existing.quantity = (parseInt(existing.quantity) || 0) + addQty;
        existing.totalPrice = (parseFloat(existing.unitPrice) || 0) * existing.quantity;
    } else {
        const cartItemId = `CITEM_${Date.now().toString(36)}_${Math.random().toString(36).slice(-3)}`;
        cart[storeId].items.push({
            cartItemId,
            ...newItemPayload
        });
    }

    saveCustomerCart(cart);
    closeItemCustomizerModal();
    updateFloatingCartBadge();
    showToast(`🛒 Added ${activeCustomizingItem.name} (${addQty}x) to cart!`);
}

export function getCustomerCart() {
    try {
        const data = localStorage.getItem('lokalex_customer_cart_v1');
        const parsed = data ? JSON.parse(data) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
        return {};
    } catch(e) {
        return {};
    }
}

export function saveCustomerCart(cart) {
    localStorage.setItem('lokalex_customer_cart_v1', JSON.stringify(cart || {}));
    updateFloatingCartBadge();
}

export function updateFloatingCartBadge() {
    const cart = getCustomerCart();
    const storeIds = Object.keys(cart).filter(id => cart[id] && Array.isArray(cart[id].items) && cart[id].items.length > 0);

    let totalItems = 0;
    let totalPrice = 0;

    storeIds.forEach(id => {
        (cart[id].items || []).forEach(it => {
            totalItems += (parseInt(it.quantity) || 1);
            totalPrice += (parseFloat(it.totalPrice) || 0);
        });
    });

    const navBadge = document.getElementById('cust-nav-cart-count');
    if (navBadge) navBadge.innerText = totalItems.toString();

    document.querySelectorAll('.cust-modal-cart-count').forEach(el => {
        el.innerText = totalItems.toString();
    });

    const floatingDock = document.getElementById('cust-floating-cart-dock');
    const summaryStores = document.getElementById('floating-cart-stores-summary');
    const summaryItems = document.getElementById('floating-cart-items-count');
    const summaryPrice = document.getElementById('floating-cart-total-price');

    if (totalItems > 0) {
        if (floatingDock) floatingDock.classList.remove('hidden');
        if (summaryStores) summaryStores.innerText = `${storeIds.length} Store${storeIds.length > 1 ? 's' : ''}`;
        if (summaryItems) summaryItems.innerText = `${totalItems} item(s) configured`;
        if (summaryPrice) summaryPrice.innerText = `₱${totalPrice.toFixed(2)}`;
    } else {
        if (floatingDock) floatingDock.classList.add('hidden');
    }
}

export function openCustomerCartModal() {
    const modal = document.getElementById('cust-cart-modal');
    const container = document.getElementById('cust-cart-stores-container');
    if (!container) return;

    const cart = getCustomerCart();
    const storeIds = Object.keys(cart).filter(id => cart[id] && Array.isArray(cart[id].items) && cart[id].items.length > 0);

    if (storeIds.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-500 dark:text-gray-400 italic py-12 text-xs flex flex-col items-center gap-2">
                <i class="fa-solid fa-basket-shopping text-2xl text-gray-400 dark:text-gray-600"></i>
                <span>Empty Cart. Tap "Explore Local Stores" to select items!</span>
            </div>`;
        updateCartCalculations(0);
        if (modal) modal.classList.remove('hidden');
        return;
    }

    let itemsSubtotal = 0;

    container.innerHTML = storeIds.map(storeId => {
        const storeGroup = cart[storeId];
        let storeTotal = 0;

        const itemsHtml = (storeGroup.items || []).map((item, itemIdx) => {
            const itemPrice = parseFloat(item.totalPrice) || 0;
            storeTotal += itemPrice;
            itemsSubtotal += itemPrice;

            let details = [];
            if (item.size && item.size.name) details.push(`Size: ${escapeHtml(item.size.name)}`);
            if (item.addons && item.addons.length > 0) details.push(`Addons: ${item.addons.map(a => escapeHtml(a.name)).join(', ')}`);
            if (item.instructions) details.push(`Note: "${escapeHtml(item.instructions)}"`);

            return `
            <div class="bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800/80 p-2 rounded-xl flex items-start justify-between gap-2 shadow-xs">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between">
                        <span class="font-bold text-xs text-gray-900 dark:text-white">${escapeHtml(item.name || 'Item')}</span>
                        <span class="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">₱${itemPrice.toFixed(2)}</span>
                    </div>
                    ${details.length > 0 ? `<p class="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">${details.join(' • ')}</p>` : ''}
                    <div class="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5 font-mono">
                        ${item.quantity || 1} x ₱${(parseFloat(item.unitPrice) || 0).toFixed(2)}
                    </div>
                </div>

                <div class="flex items-center gap-1 shrink-0 pt-0.5">
                    <button onclick="window.updateCustomerCartItemQty('${storeId}', ${itemIdx}, -1)" class="w-5 h-5 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-bold text-xs flex items-center justify-center active:scale-90">-</button>
                    <span class="w-4 text-center font-bold text-xs text-gray-900 dark:text-white">${item.quantity || 1}</span>
                    <button onclick="window.updateCustomerCartItemQty('${storeId}', ${itemIdx}, 1)" class="w-5 h-5 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-bold text-xs flex items-center justify-center active:scale-90">+</button>
                    <button onclick="window.promptDeleteCartItem('${storeId}', ${itemIdx}, '${escapeHtml(item.name || 'Item')}')" class="text-red-500 hover:text-red-400 p-1 ml-0.5 text-xs active:scale-90" title="Delete Item"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');

        return `
        <div class="bg-cardBg border border-gray-200 dark:border-gray-800 rounded-2xl p-2.5 flex flex-col gap-2 shadow-xs">
            <div class="flex justify-between items-center border-b border-gray-200 dark:border-gray-800 pb-1.5">
                <div class="flex items-center gap-2 min-w-0">
                    <i class="fa-solid fa-store text-orange-500 dark:text-orange-400 text-xs shrink-0"></i>
                    <span class="font-black text-xs text-gray-900 dark:text-white truncate">${escapeHtml(storeGroup.storeName || 'Store')}</span>
                </div>
                <span class="text-[11px] font-mono font-bold text-orange-600 dark:text-orange-300">₱${storeTotal.toFixed(2)}</span>
            </div>
            <div class="flex flex-col gap-1.5">
                ${itemsHtml}
            </div>
        </div>`;
    }).join('');

    updateCartCalculations(itemsSubtotal);

    if (modal) modal.classList.remove('hidden');
}

export function closeCustomerCartModal() {
    const modal = document.getElementById('cust-cart-modal');
    if (modal) modal.classList.add('hidden');
}

export function updateCustomerCartItemQty(storeId, itemIdx, delta) {
    const cart = getCustomerCart();
    if (!cart[storeId]?.items?.[itemIdx]) return;

    const item = cart[storeId].items[itemIdx];
    const newQty = (parseInt(item.quantity) || 1) + delta;

    if (newQty <= 0) {
        promptDeleteCartItem(storeId, itemIdx, item.name || "Item");
        return;
    }

    item.quantity = newQty;
    item.totalPrice = (parseFloat(item.unitPrice) || 0) * item.quantity;

    saveCustomerCart(cart);
    openCustomerCartModal();
}

export function promptDeleteCartItem(storeId, itemIdx, itemName = "Item") {
    openSlideDeleteModal(
        `Remove ${itemName}?`,
        `I-drag pakanan ang slider upang alisin ang [${itemName}] sa iyong Cart.`,
        () => {
            removeCustomerCartItem(storeId, itemIdx);
        }
    );
}

export function removeCustomerCartItem(storeId, itemIdx) {
    const cart = getCustomerCart();
    if (!cart[storeId]?.items) return;

    cart[storeId].items.splice(itemIdx, 1);
    if (cart[storeId].items.length === 0) delete cart[storeId];

    saveCustomerCart(cart);
    openCustomerCartModal();
    showToast("🗑️ Item removed from cart.");
}

function updateCartCalculations(itemsSubtotal) {
    const grandTotalEl = document.getElementById('cust-cart-grand-total');
    if (grandTotalEl) grandTotalEl.innerText = itemsSubtotal.toFixed(2);
}

export async function sendMultiStoreOrderToRiders() {
    const cart = getCustomerCart();
    const storeIds = Object.keys(cart).filter(id => cart[id] && Array.isArray(cart[id].items) && cart[id].items.length > 0);

    if (storeIds.length === 0) return showToast("⚠️ Cart is empty!");

    const custName = localStorage.getItem('customerName') || localStorage.getItem('lokalex_customer_name') || appState.customerName || "Customer";
    let rawCustId = localStorage.getItem('lokalex_customer_fb_id') || localStorage.getItem('customerId') || appState.customerFacebookId || appState.customerId;
    
    if (!rawCustId) {
        rawCustId = `CUST_${Date.now().toString(36).toUpperCase()}`;
        localStorage.setItem('lokalex_customer_fb_id', rawCustId);
        appState.customerFacebookId = rawCustId;
    }

    const custId = cleanFirebasePathKey(rawCustId);
    const orderId = `ORD_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(-3).toUpperCase()}`;

    const sendBtn = document.getElementById('cust-send-order-btn') || document.querySelector('#cust-cart-modal button[onclick*="sendMultiStoreOrderToRiders"]');
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> SENDING ORDER...`;
    }

    let orderSummaryText = `📋 *Order ID:* #${orderId}\n👤 *Customer:* ${custName}\n\n`;
    let grandItemsTotal = 0;
    const now = Date.now();

    const orderStoresPayload = {};

    storeIds.forEach((sId, idx) => {
        const store = cart[sId];
        let storeSubtotal = 0;
        const cleanSId = cleanFirebasePathKey(sId);

        const storeTitle = storeIds.length > 1 ? `🏪 *[Store ${idx + 1}] ${store.storeName || 'Store'}*` : `🏪 *${store.storeName || 'Store'}*`;
        orderSummaryText += `${storeTitle}${store.storeAddress ? ` (${store.storeAddress})` : ''}\n`;

        (store.items || []).forEach(it => {
            const itemPrice = parseFloat(it.totalPrice) || 0;
            storeSubtotal += itemPrice;
            grandItemsTotal += itemPrice;

            orderSummaryText += `  • ${it.quantity || 1}x ${it.name || 'Item'}`;
            if (it.size && it.size.name) orderSummaryText += ` (${it.size.name})`;
            if (it.addons && it.addons.length > 0) orderSummaryText += ` [${it.addons.map(a => a.name).join(', ')}]`;
            if (it.instructions) orderSummaryText += ` - Note: "${it.instructions}"`;
            orderSummaryText += ` = ₱${itemPrice.toFixed(2)}\n`;
        });
        orderSummaryText += `\n`;

        orderStoresPayload[cleanSId] = {
            storeId: cleanSId,
            storeName: store.storeName || "Store",
            storeAddress: store.storeAddress || "Poblacion",
            items: store.items || [],
            storeSubtotal: parseFloat(storeSubtotal) || 0,
            status: 'pending'
        };
    });

    orderSummaryText += `📦 *Items Total:* ₱${grandItemsTotal.toFixed(2)}`;

    try {
        if (db) {
            const chatMsg = {
                sender: custName,
                senderId: custId,
                text: orderSummaryText,
                timestamp: now,
                orderId: orderId,
                storeIds: storeIds.map(s => cleanFirebasePathKey(s)),
                isRider: false,
                status: 'sent'
            };

            await db.ref(`customerChats/${custId}/messages`).push(sanitizeForFirebase(chatMsg));
            await db.ref(`customerChats/${custId}/metadata`).update(sanitizeForFirebase({
                lastMessage: `🛍️ Multi-Store Order #${orderId} (₱${grandItemsTotal.toFixed(2)})`,
                lastUpdated: now,
                customerName: custName,
                customerFbId: custId,
                latestOrderId: orderId,
                orderedStoreIds: storeIds.map(s => cleanFirebasePathKey(s)),
                folder: 'inbox',
                status: 'active',
                orderStatus: 'placed',
                unreadForRider: true
            }));

            for (const sId of storeIds) {
                const storeGroup = cart[sId];
                const storeTotal = (storeGroup.items || []).reduce((sum, item) => sum + (parseFloat(item.totalPrice) || 0), 0);
                const sanitizedStoreId = cleanFirebasePathKey(sId);

                const storeTicket = {
                    orderId: orderId,
                    customerId: custId,
                    customerName: custName,
                    storeId: sanitizedStoreId,
                    storeName: storeGroup.storeName || "Store",
                    storeAddress: storeGroup.storeAddress || "Poblacion",
                    items: storeGroup.items || [],
                    totalAmount: parseFloat(storeTotal) || 0,
                    status: 'pending',
                    riderId: null,
                    riderName: 'Unassigned Rider',
                    timestamp: now,
                    updatedAt: now
                };

                await db.ref(`storeOrders/${sanitizedStoreId}/${orderId}`).set(sanitizeForFirebase(storeTicket)).catch(err => {
                    console.warn(`storeOrders write warning for ${sanitizedStoreId}:`, err);
                });
            }

            const masterOrderPayload = {
                orderId: orderId,
                customerId: custId,
                customerName: custName,
                stores: orderStoresPayload,
                storeIds: storeIds.map(s => cleanFirebasePathKey(s)),
                itemsTotal: parseFloat(grandItemsTotal) || 0,
                grandTotal: parseFloat(grandItemsTotal) || 0,
                status: 'placed',
                milestones: {
                    placed: {
                        timestamp: now,
                        updatedBy: custName
                    }
                },
                assignedRiderId: null,
                assignedRiderName: null,
                timestamp: now
            };

            await db.ref(`orders/${orderId}`).set(sanitizeForFirebase(masterOrderPayload)).catch(err => {
                console.warn("orders master write warning:", err);
            });
        }

        saveCustomerCart({});
        closeCustomerCartModal();
        showToast("🎉 Order sent to Lokalex riders!");
        if (window.showSideNotification) {
            window.showSideNotification("ORDER SENT", `Dispatched #${orderId}`, "fa-bag-shopping", "text-emerald-400", "border-emerald-500");
        }
    } catch(e) {
        console.error("Order dispatch error:", e);
        showToast("❌ Failed to dispatch order: " + (e.message || "Unknown error"));
    } finally {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> SEND ORDER TO RIDERS`;
        }
    }
}

if (typeof window !== 'undefined') {
    window.initCustomerStorefront = initCustomerStorefront;
    window.renderCustomerHeaderProfile = renderCustomerHeaderProfile;
    window.openEditCustomerProfileModal = openEditCustomerProfileModal;
    window.closeEditCustomerProfileModal = closeEditCustomerProfileModal;
    window.updateCustomerAvatarModalPreview = updateCustomerAvatarModalPreview;
    window.handleCustomerAvatarFileSelected = handleCustomerAvatarFileSelected;
    window.onCustomerAvatarUrlInput = onCustomerAvatarUrlInput;
    window.clearCustomerAvatar = clearCustomerAvatar;
    window.submitSaveCustomerProfile = submitSaveCustomerProfile;
    window.openCustomerStoresModal = openCustomerStoresModal;
    window.closeCustomerStoresModal = closeCustomerStoresModal;
    window.renderStoresGrid = renderStoresGrid;
    window.filterCustomerStores = filterCustomerStores;
    window.openCustomerStoreMenu = openCustomerStoreMenu;
    window.closeCustomerStoreMenuModal = closeCustomerStoreMenuModal;
    window.selectCustomerMenuCategory = selectCustomerMenuCategory;
    window.openItemCustomizerModal = openItemCustomizerModal;
    window.closeItemCustomizerModal = closeItemCustomizerModal;
    window.adjustCustomizerQty = adjustCustomizerQty;
    window.recalculateCustomizerPrice = recalculateCustomizerPrice;
    window.submitAddCustomizedItemToCart = submitAddCustomizedItemToCart;
    window.openCustomerCartModal = openCustomerCartModal;
    window.closeCustomerCartModal = closeCustomerCartModal;
    window.updateCustomerCartItemQty = updateCustomerCartItemQty;
    window.promptDeleteCartItem = promptDeleteCartItem;
    window.removeCustomerCartItem = removeCustomerCartItem;
    window.sendMultiStoreOrderToRiders = sendMultiStoreOrderToRiders;
    window.listenToActiveCustomerOrderStatus = listenToActiveCustomerOrderStatus;

    window.addEventListener('viewChanged', (e) => {
        if (e.detail === 'view-customer-home') {
            initCustomerStorefront();
        }
    });

    const currentView = document.getElementById('view-customer-home');
    if (currentView && !currentView.classList.contains('hidden')) {
        initCustomerStorefront();
    }
}