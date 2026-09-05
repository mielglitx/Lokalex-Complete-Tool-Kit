// src/features/storeHub/ui/storeHubState.js
import { appState } from '../../../store/state.js';
import { escapeHtml } from '../../../utils/helpers.js';

export const storeHubState = {
    currentStoreData: null,
    currentMenuData: { categories: {}, items: {} },
    currentOrdersData: {},
    selectedCategoryId: 'ALL',
    selectedSubCategory: 'ALL',
    selectedOrdersTab: 'active', // 'active' | 'done'
    stagedLogoData: '',
    activeChatOrderId: null,
    activeChatRiderId: null,
    activeChatRiderName: null,
    activeStoreReplyTarget: null,
    activeSubstitutionTarget: null,
    acknowledgedOrders: new Set(),
    kitchenAudioInterval: null,
    kitchenAudioCtx: null,
    isKitchenAudioMuted: false,
    countdownTimerInterval: null,
    ridersLocationMap: {}
};

export function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

export function cleanFirebasePathKey(key) {
    return String(key || '').replace(/^#+/, '').replace(/[.#$\[\]\/]/g, '_').trim();
}

export function compressImageFile(file, maxWidth = 320, maxHeight = 320, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl);
            };
            img.onerror = (err) => reject(err);
            img.src = e.target.result;
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

export function calculateDistanceInKm(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export function renderStoreReactionsHtml(reactions, msgId) {
    if (!reactions || typeof reactions !== 'object') return '';
    const reactionEntries = Object.entries(reactions);
    if (reactionEntries.length === 0) return '';

    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id') || 'store';
    const storeId = cleanFirebasePathKey(rawStoreId);

    const badges = reactionEntries.map(([emoji, usersMap]) => {
        if (!usersMap || typeof usersMap !== 'object') return '';
        const count = Object.keys(usersMap).length;
        if (count === 0) return '';
        const hasReacted = storeId && usersMap[storeId];

        return `
        <button onclick="event.stopPropagation(); window.toggleStoreRiderReaction('${msgId}', '${emoji}')" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] ${hasReacted ? 'bg-orange-600/30 border border-orange-400 text-white' : 'bg-gray-100 dark:bg-black/60 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'} transition active:scale-90">
            <span>${emoji}</span>
            <span class="font-bold text-[9px]">${count}</span>
        </button>`;
    }).join('');

    return badges ? `<div class="flex flex-wrap gap-1 mt-1">${badges}</div>` : '';
}

export function renderReplyPreviewInsideMessage(replyTo) {
    if (!replyTo || !replyTo.text) return '';
    const clickHandler = replyTo.id ? `event.stopPropagation(); window.scrollToBubble('${replyTo.id}')` : '';
    return `
    <div ${clickHandler ? `onclick="${clickHandler}"` : ''} class="bg-black/10 dark:bg-black/40 border-l-2 border-amber-400 px-2 py-1 rounded-r-lg mb-1.5 text-[10px] opacity-90 truncate max-w-full cursor-pointer hover:opacity-100 transition">
        <div class="font-bold text-amber-600 dark:text-amber-300 truncate flex items-center gap-1">
            <i class="fa-solid fa-reply text-[8px]"></i>
            <span>${escapeHtml(replyTo.sender || 'Reply')}</span>
        </div>
        <div class="text-gray-700 dark:text-gray-200 truncate">${escapeHtml(replyTo.text)}</div>
    </div>`;
}