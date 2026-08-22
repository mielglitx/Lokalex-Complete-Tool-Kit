// src/features/chat/riderThreadActions.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { toggleBodyScroll, compressAndResizeImage } from './chatUtils.js';
import { voidSingleCateringCustomer } from '../roster/rosterStatus.js';

let stagedPodImageBase64 = null;

function cleanFirebasePathKey(key) {
    return String(key || '').replace(/^#+/, '').replace(/[.#$\[\]\/]/g, '_').trim();
}

function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

export function showCustomerDetails() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (!custId) {
        return showToast("⚠️ No active customer thread selected.");
    }

    const modal = document.getElementById('customer-details-modal');
    if (modal && db) {
        db.ref(`customers/${custId}`).once('value', (snap) => {
            const data = snap.val() || {};
            if (window.setActiveCustData) window.setActiveCustData(data);

            const nameEl = document.getElementById('cust-modal-name');
            const phoneEl = document.getElementById('cust-modal-phone');
            const addrEl = document.getElementById('cust-modal-address');
            const mapEl = document.getElementById('cust-modal-map');

            if (nameEl) nameEl.innerText = data.name || "Customer";
            if (phoneEl) {
                phoneEl.innerText = data.phoneNumber || "N/A";
                phoneEl.href = `tel:${data.phoneNumber || ''}`;
            }
            if (addrEl) addrEl.innerText = data.address || "No address provided.";
            if (mapEl) {
                const mapUrl = data.mapPinLink || (data.lat && data.lng ? `https://www.google.com/maps/search/?api=1&query=${data.lat},${data.lng}` : "#");
                mapEl.href = mapUrl;
            }

            modal.classList.remove('hidden');
            toggleBodyScroll(true);
        });
    }
}

export function closeCustomerDetailsModal() {
    const modal = document.getElementById('customer-details-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
}

export function toggleQuickReplies() {
    document.getElementById('quick-replies-drawer')?.classList.toggle('hidden');
}

export function sendQuickReply(text) {
    if (window.sendRiderToCustomerChat) {
        window.sendRiderToCustomerChat(text);
    } else if (window.sendCustomerToRiderChat) {
        window.sendCustomerToRiderChat(text);
    }
    toggleQuickReplies();
}

export function markThreadUndone() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (!custId) return;

    if (db) {
        db.ref(`customerChats/${custId}/metadata`).update({
            folder: 'inbox',
            cateredByRiderId: null,
            cateredByRiderName: null,
            cateredBy: null,
            status: 'active'
        });
    }

    showToast("↩️ Moved thread back to Inbox!");
    if (window.closeRiderCustomerChatModal) window.closeRiderCustomerChatModal();
}

// -------------------------------------------------------------
// PROOF OF DELIVERY (POD) MODAL HANDLERS
// -------------------------------------------------------------
export function openPodModal() {
    stagedPodImageBase64 = null;
    const modal = document.getElementById('pod-capture-modal');
    const previewImg = document.getElementById('pod-preview-img');
    const placeholder = document.getElementById('pod-placeholder-ui');

    if (previewImg) {
        previewImg.src = "";
        previewImg.classList.add('hidden');
    }
    if (placeholder) {
        placeholder.classList.remove('hidden');
    }

    if (modal) {
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
    }
}

export function closePodModal() {
    const modal = document.getElementById('pod-capture-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
    stagedPodImageBase64 = null;
}

export function handlePodImageSelected(inputEl) {
    const file = inputEl?.files?.[0];
    if (!file) return;

    showToast("⏳ Processing Proof of Delivery photo...");

    compressAndResizeImage(file, false, (base64Img) => {
        stagedPodImageBase64 = base64Img;

        const previewImg = document.getElementById('pod-preview-img');
        const placeholder = document.getElementById('pod-placeholder-ui');

        if (previewImg && placeholder) {
            previewImg.src = base64Img;
            previewImg.classList.remove('hidden');
            placeholder.classList.add('hidden');
        }

        showToast("✅ POD photo ready!");
    });

    inputEl.value = "";
}

export async function submitProofOfDelivery(withPhoto = true) {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    const meta = window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {};
    const orderId = cleanFirebasePathKey(meta?.latestOrderId);
    const riderName = localStorage.getItem('riderName') || "Rider";
    const now = Date.now();

    closePodModal();

    if (withPhoto && stagedPodImageBase64 && db && custId) {
        const podMsg = {
            sender: riderName,
            senderType: 'rider',
            text: "📦 Order has been successfully delivered! [Proof of Delivery Attached]",
            imageUrl: stagedPodImageBase64,
            type: 'image',
            timestamp: now,
            isRider: true,
            status: 'sent'
        };

        await db.ref(`customerChats/${custId}/messages`).push(sanitizeForFirebase(podMsg));
    }

    if (orderId && db) {
        await updateOrderMilestone('delivered', orderId, stagedPodImageBase64);
    }

    executeThreadDone();
}

export function markThreadDone() {
    const meta = window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {};
    const orderId = meta?.latestOrderId;

    if (orderId) {
        openPodModal();
    } else {
        executeThreadDone();
    }
}

export function executeThreadDone() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (!custId) return;

    if (db) {
        db.ref(`customerChats/${custId}/metadata`).update({
            cateredByRiderId: null,
            cateredByRiderName: null,
            cateredBy: null,
            folder: 'done'
        });
    }

    document.getElementById('rider-chat-cancel-btn')?.classList.add('hidden');
    showToast("✅ Released lock & moved chat to Done!");
    if (window.closeRiderCustomerChatModal) window.closeRiderCustomerChatModal();
}

export function markThreadFollowUp() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (!custId) return;

    const custName = document.getElementById('rider-chat-cust-name')?.innerText || "";
    const activeCustData = window.getActiveCustData ? window.getActiveCustData() : null;
    const phone = activeCustData?.phoneNumber || "";
    const address = activeCustData?.address || "";

    if (db) {
        db.ref(`customerChats/${custId}/metadata`).update({ folder: 'followup' });
    }

    const advModal = document.getElementById('adv-orders-modal');
    if (advModal) {
        advModal.classList.remove('hidden');
        toggleBodyScroll(true);

        if (window.switchAdvTab) window.switchAdvTab('add');

        const nameInput = document.getElementById('adv-cust-name');
        const contactInput = document.getElementById('adv-contact');
        const addrInput = document.getElementById('adv-address');

        if (nameInput) nameInput.value = custName;
        if (contactInput) contactInput.value = phone;
        if (addrInput) addrInput.value = address;
    }

    showToast("📌 Moved chat to Follow Up & loaded Advance Order form!");
}

// VOID SPECIFIC CUSTOMER WITHOUT CANCELING OTHER ACTIVE BOOKINGS
export function cancelCustomerThread() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    const meta = window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {};
    const custName = document.getElementById('rider-chat-cust-name')?.innerText?.trim() || meta?.customerName || "";
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = appState.riderName || localStorage.getItem('riderName') || "Rider";

    if (!custId && !custName) return;

    openSlideDeleteModal(
        `Cancel & Void Customer?`,
        `Sigurado ka bang nais i-void si [${custName || 'Customer'}]?\nKung may iba ka pang dalang customer, mananatili ka sa Catering.`,
        async () => {
            if (db && custId) {
                db.ref(`customerChats/${custId}/metadata`).update({
                    cateredByRiderId: null,
                    cateredByRiderName: null,
                    cateredBy: null,
                    folder: 'done',
                    status: 'cancelled',
                    lastUpdated: Date.now()
                });
            }

            if (custName && myId) {
                await voidSingleCateringCustomer(myId, myName, custName);
            }

            document.getElementById('rider-chat-cancel-btn')?.classList.add('hidden');
            if (window.closeRiderCustomerChatModal) window.closeRiderCustomerChatModal();
        }
    );
}

// -------------------------------------------------------------
// ORDER CHECKPOINT MILESTONE TRACKING
// -------------------------------------------------------------
export async function setOrderMilestone(stage) {
    const meta = window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {};
    const orderId = cleanFirebasePathKey(meta?.latestOrderId);

    if (!orderId) {
        return showToast("⚠️ No active order tied to this thread.");
    }

    await updateOrderMilestone(stage, orderId);
}

export async function updateOrderMilestone(stage, orderId, podImageUrl = null) {
    const cleanOrderId = cleanFirebasePathKey(orderId);
    if (!cleanOrderId || !db) return;

    const riderName = localStorage.getItem('riderName') || "Rider";
    const now = Date.now();

    const updates = {};
    updates[`orders/${cleanOrderId}/status`] = stage;
    updates[`orders/${cleanOrderId}/milestones/${stage}`] = {
        timestamp: now,
        updatedBy: riderName
    };

    if (podImageUrl) {
        updates[`orders/${cleanOrderId}/podImageUrl`] = podImageUrl;
    }

    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (custId) {
        updates[`customerChats/${custId}/metadata/orderStatus`] = stage;
    }

    try {
        await db.ref().update(updates);
        highlightActiveMilestoneUI(stage);

        const stageLabels = {
            preparing: "Order is being prepared",
            picked_up: "Order picked up by rider",
            arrived: "Rider arrived at drop-off",
            delivered: "Order delivered"
        };

        const label = stageLabels[stage] || stage.toUpperCase();
        showToast(`📍 Milestone updated: ${label}`);
        if (showSideNotification) {
            showSideNotification("MILESTONE UPDATED", `#${cleanOrderId}: ${label}`, "fa-route", "text-blue-400", "border-blue-500");
        }
    } catch(e) {
        console.error("Milestone update error:", e);
        showToast("❌ Failed to update order milestone.");
    }
}

export function highlightActiveMilestoneUI(activeStage) {
    const stages = ['preparing', 'picked_up', 'arrived', 'delivered'];
    const activeIdx = stages.indexOf(activeStage);

    stages.forEach((stage, idx) => {
        const btn = document.getElementById(`milestone-btn-${stage}`);
        if (btn) {
            if (idx <= activeIdx && activeIdx !== -1) {
                btn.className = "flex-1 min-w-[70px] py-1 px-1.5 rounded-lg bg-emerald-600 text-white font-bold text-[9px] transition active:scale-95 text-center flex flex-col items-center gap-0.5 shadow-sm";
            } else {
                btn.className = "flex-1 min-w-[70px] py-1 px-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 font-bold text-[9px] transition active:scale-95 text-center flex flex-col items-center gap-0.5";
            }
        }
    });
}

export const undoCustomerThread = markThreadUndone;
export const followUpCustomerOrder = markThreadFollowUp;
export const completeCatering = markThreadDone;
export const cancelCatering = cancelCustomerThread;

if (typeof window !== 'undefined') {
    window.showCustomerDetails = showCustomerDetails;
    window.closeCustomerDetailsModal = closeCustomerDetailsModal;
    window.toggleQuickReplies = toggleQuickReplies;
    window.sendQuickReply = sendQuickReply;
    window.markThreadUndone = markThreadUndone;
    window.markThreadDone = markThreadDone;
    window.executeThreadDone = executeThreadDone;
    window.markThreadFollowUp = markThreadFollowUp;
    window.cancelCustomerThread = cancelCustomerThread;
    window.undoCustomerThread = undoCustomerThread;
    window.followUpCustomerOrder = followUpCustomerOrder;
    window.completeCatering = completeCatering;
    window.cancelCatering = cancelCatering;

    window.openPodModal = openPodModal;
    window.closePodModal = closePodModal;
    window.handlePodImageSelected = handlePodImageSelected;
    window.submitProofOfDelivery = submitProofOfDelivery;
    window.setOrderMilestone = setOrderMilestone;
    window.updateOrderMilestone = updateOrderMilestone;
    window.highlightActiveMilestoneUI = highlightActiveMilestoneUI;
}