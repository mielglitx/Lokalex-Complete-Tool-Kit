// src/features/chat/threadActions/threadMilestonesPod.js
import { db } from '../../../config/firebase.js';
import { showToast, showSideNotification } from '../../../ui/notifications.js';
import { toggleBodyScroll, compressAndResizeImage } from '../chatUtils.js';
import { uploadImage } from '../../../utils/imageUpload.js';
import { cleanFirebasePathKey, sanitizeForFirebase } from './threadUtils.js';
import { executeThreadDone } from './threadLifecycle.js';

let stagedPodImageBase64 = null;

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

    let finalPodUrl = stagedPodImageBase64;
    if (withPhoto && stagedPodImageBase64) {
        showToast("⏳ Uploading POD photo...");
        try {
            finalPodUrl = await uploadImage(stagedPodImageBase64, `pod/${orderId || custId}_${Date.now()}.jpg`);
        } catch (e) {
            console.warn("POD storage upload fallback:", e);
        }
    }

    if (withPhoto && finalPodUrl && db && custId) {
        const podMsg = {
            sender: riderName,
            senderType: 'rider',
            text: "📦 Order has been successfully delivered! [Proof of Delivery Attached]",
            imageUrl: finalPodUrl,
            type: 'image',
            timestamp: now,
            isRider: true,
            status: 'sent'
        };

        await db.ref(`customerChats/${custId}/messages`).push(sanitizeForFirebase(podMsg));
    }

    if (orderId && db) {
        await updateOrderMilestone('delivered', orderId, finalPodUrl);
    }

    executeThreadDone();
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
        updates[`customerChatMeta/${custId}/orderStatus`] = stage;
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
