// src/features/storeHub/ui/storeOrdersSubstitution.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { showToast, showSideNotification } from '../../../ui/notifications.js';
import { 
    storeHubState, 
    cleanFirebasePathKey, 
    sanitizeForFirebase 
} from './storeHubState.js';

export function openSubstitutionModal(orderId, itemIdx, itemName, customerName, riderName) {
    storeHubState.activeSubstitutionTarget = { orderId, itemIdx, itemName, customerName, riderName };

    let modal = document.getElementById('item-substitution-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'item-substitution-modal';
        modal.className = 'fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-white dark:bg-cardBg border border-red-500/40 w-full max-w-sm rounded-3xl p-5 shadow-2xl flex flex-col gap-3.5">
                <div class="flex justify-between items-center border-b border-gray-200 dark:border-gray-800 pb-2.5">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center text-sm font-bold">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                        </div>
                        <div>
                            <h3 class="text-sm font-black text-gray-900 dark:text-white">Item Substitution (86)</h3>
                            <p class="text-[10px] text-gray-500 dark:text-gray-400">Unavailable dish resolution</p>
                        </div>
                    </div>
                    <button onclick="window.closeSubstitutionModal && window.closeSubstitutionModal()" class="text-gray-400 hover:text-gray-700 dark:hover:text-white p-1 text-sm transition">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div class="flex flex-col gap-2 text-xs">
                    <div class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 p-2.5 rounded-2xl">
                        <div class="text-[10px] text-red-600 dark:text-red-400 font-bold uppercase">Unavailable Item:</div>
                        <div id="sub-item-name-display" class="font-black text-gray-900 dark:text-white text-xs mt-0.5">Item Name</div>
                    </div>

                    <div>
                        <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase">Suggested Replacement / Alternative *</label>
                        <input type="text" id="sub-replacement-input" placeholder="e.g. Taro Milk Tea / Large Size without pearls" class="w-full bg-inputBg text-xs rounded-xl p-3 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white font-bold mt-1">
                    </div>

                    <div>
                        <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase">Notes for Rider & Customer</label>
                        <textarea id="sub-notes-input" rows="2" placeholder="e.g. Naubusan po ng brown sugar pearls, pwede po bang nata de coco?" class="w-full bg-inputBg text-xs rounded-xl p-2.5 border border-gray-300 dark:border-gray-700 outline-none text-gray-900 dark:text-white mt-1"></textarea>
                    </div>

                    <button id="sub-submit-btn" onclick="window.submitItemSubstitution && window.submitItemSubstitution()" class="w-full bg-red-600 hover:bg-red-500 text-white font-black py-3 rounded-xl shadow-md transition active:scale-95 flex items-center justify-center gap-1.5 mt-1">
                        <i class="fa-solid fa-paper-plane"></i> DISPATCH SUBSTITUTION REQUEST
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    const displayEl = document.getElementById('sub-item-name-display');
    const replaceInput = document.getElementById('sub-replacement-input');
    const notesInput = document.getElementById('sub-notes-input');

    if (displayEl) displayEl.innerText = itemName;
    if (replaceInput) replaceInput.value = '';
    if (notesInput) notesInput.value = '';

    modal.classList.remove('hidden');
}

export function closeSubstitutionModal() {
    const modal = document.getElementById('item-substitution-modal');
    if (modal) modal.classList.add('hidden');
    storeHubState.activeSubstitutionTarget = null;
}

export async function submitItemSubstitution() {
    if (!storeHubState.activeSubstitutionTarget) return;

    const { orderId, itemIdx, itemName, customerName, riderName } = storeHubState.activeSubstitutionTarget;
    const replacement = document.getElementById('sub-replacement-input')?.value.trim();
    const notes = document.getElementById('sub-notes-input')?.value.trim();

    if (!replacement) {
        return showToast("⚠️ Paki-lagay ang iminumungkahing kapalit o alternatibo!");
    }

    const rawStoreId = appState.merchantStoreId || localStorage.getItem('lokalex_merchant_store_id');
    const storeId = cleanFirebasePathKey(rawStoreId);
    const storeName = appState.merchantStoreName || "Store";
    const now = Date.now();

    closeSubstitutionModal();

    const alertMessage = `⚠️ [OUT OF STOCK / SUBSTITUTION REQUIRED]\n• Item: ${itemName}\n• Suggested Replacement: ${replacement}${notes ? `\n• Kitchen Note: "${notes}"` : ''}\n\nPaki-kumpirma po kay customer kung pumapayag sa kapalit. Salamat!`;

    try {
        if (db && orderId && storeId) {
            await db.ref(`storeRiderChats/${orderId}_${storeId}/messages`).push(sanitizeForFirebase({
                sender: 'store',
                senderType: 'store',
                senderName: storeName,
                text: alertMessage,
                timestamp: now
            }));

            await db.ref(`storeRiderChats/${orderId}_${storeId}`).update(sanitizeForFirebase({
                lastMessage: `⚠️ Substitution Alert: ${itemName}`,
                lastTimestamp: now,
                unreadForRider: true
            }));

            await db.ref(`storeOrders/${storeId}/${orderId}`).update({
                substitutionAlert: {
                    itemIndex: itemIdx,
                    itemName,
                    replacement,
                    notes: notes || "",
                    timestamp: now
                }
            });
        }

        showToast("⚠️ Substitution alert sent to rider!");
        showSideNotification("SUBSTITUTION ALERT", `Item: ${itemName} -> ${replacement}`, "fa-triangle-exclamation", "text-red-400", "border-red-500");
    } catch(e) {
        showToast("❌ Failed to dispatch substitution alert.");
    }
}