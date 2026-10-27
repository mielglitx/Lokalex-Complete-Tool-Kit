// src/features/chat/threadActions/threadLifecycle.js
import { db } from '../../../config/firebase.js';
import { appState, globalState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { openSlideDeleteModal } from '../../../ui/modals.js';
import { toggleBodyScroll } from '../chatUtils.js';
import { voidSingleCateringCustomer } from '../../roster/rosterStatus.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { isCustomerMatch, isAdmin, canManageRoster, hasTlPermission, hasReceiptForActiveSession } from '../../roster/rosterUtils.js';
import { completeSingleCateringCustomer, checkCustomerReceiptExists } from '../../roster/actions/rosterCateringCompletion.js';
import { updateOrderMilestone } from './threadMilestonesPod.js';
import { triggerAutoMessageOnCater } from '../autoMessageManager.js';

let pendingDoneData = null;

export function markThreadUndone() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (!custId) return;

    if (db) {
        const payload = {
            folder: 'inbox',
            cateredByRiderId: null,
            cateredByRiderName: null,
            cateredBy: null,
            status: 'active'
        };
        db.ref(`customerChats/${custId}/metadata`).update(payload).catch(() => {});
        db.ref(`customerChatMeta/${custId}`).update(payload).catch(() => {});
    }

    showToast("↩️ Moved thread back to Inbox!");
    if (window.closeRiderCustomerChatModal) window.closeRiderCustomerChatModal();
}

/**
 * Robust matching to find if a customer is currently being catered by a rider on the roster.
 */
export function findCateringRiderForCustomer(custName, meta = {}) {
    const rosterMembers = globalState.rosterMembers || [];
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    // 1. Check current logged-in rider first
    const myRecord = rosterMembers.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        return (myId && mId === myId) || (myName && mName === myName);
    });

    if (myRecord && myRecord.customerName) {
        const custs = myRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
        if (custName) {
            const match = custs.find(c => isCustomerMatch(c, custName) || c.toLowerCase() === custName.toLowerCase() || c.toLowerCase().includes(custName.toLowerCase()) || custName.toLowerCase().includes(c.toLowerCase()));
            if (match) return { record: myRecord, matchingCustName: match };
        }
        if (custs.length === 1 && meta && (meta.cateredByRiderId === myId || (meta.cateredByRiderName && meta.cateredByRiderName.trim().toLowerCase() === myName))) {
            return { record: myRecord, matchingCustName: custs[0] };
        }
    }

    // 2. Check meta.cateredByRiderId or meta.cateredByRiderName
    if (meta && (meta.cateredByRiderId || meta.cateredByRiderName || meta.cateredBy)) {
        const cId = (meta.cateredByRiderId || "").toString().trim();
        const cName = (meta.cateredByRiderName || meta.cateredBy || "").toString().trim().toLowerCase();
        const found = rosterMembers.find(m => {
            const mId = (m.telegramId || m.id || "").toString().trim();
            const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
            return (cId && mId === cId) || (cName && mName === cName);
        });
        if (found && found.customerName) {
            const custs = found.customerName.split(', ').map(c => c.trim()).filter(Boolean);
            if (custName) {
                const match = custs.find(c => isCustomerMatch(c, custName) || c.toLowerCase() === custName.toLowerCase() || c.toLowerCase().includes(custName.toLowerCase()) || custName.toLowerCase().includes(c.toLowerCase()));
                if (match) return { record: found, matchingCustName: match };
            }
            if (custs.length === 1) {
                return { record: found, matchingCustName: custs[0] };
            }
        }
    }

    // 3. Scan all roster members for matching customer name
    if (custName) {
        for (const m of rosterMembers) {
            if (m.customerName) {
                const custs = m.customerName.split(', ').map(c => c.trim()).filter(Boolean);
                const match = custs.find(c => isCustomerMatch(c, custName) || c.toLowerCase() === custName.toLowerCase() || c.toLowerCase().includes(custName.toLowerCase()) || custName.toLowerCase().includes(c.toLowerCase()));
                if (match) return { record: m, matchingCustName: match };
            }
        }
    }

    return { record: null, matchingCustName: "" };
}

/**
 * Robust helper to resolve thread metadata and customer name across all sources.
 */
export function getThreadMetadataAndCustomerName(targetCustId = null, targetCustName = "") {
    const custId = targetCustId || (window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null);
    if (!custId) return { custId: "", custName: "Customer", meta: {} };

    let meta = {};
    if (typeof window.getCachedCustomerThreadsMap === 'function') {
        const threadMap = window.getCachedCustomerThreadsMap();
        if (threadMap && threadMap.size > 0) {
            if (threadMap.has(custId)) {
                meta = { ...threadMap.get(custId) };
            } else {
                for (const t of threadMap.values()) {
                    if (t.custId === custId || t.id === custId || (t.metadata && t.metadata.custId === custId)) {
                        meta = { ...t };
                        break;
                    }
                }
            }
        }
    }

    if (!targetCustId && typeof window.getCurrentRiderChatMeta === 'function') {
        meta = { ...window.getCurrentRiderChatMeta(), ...meta };
    }

    let custName = (targetCustName || "").trim();

    // 1. From active chat DOM header if chat modal is open
    if (!custName && !targetCustId) {
        custName = (document.getElementById('rider-chat-cust-name')?.innerText || '').trim();
    }

    // 2. From thread metadata
    if (!custName || custName === 'Customer Name' || custName.toLowerCase() === 'customer' || custName.startsWith('FB Customer (')) {
        custName = (meta.customerName || meta.name || "").trim();
    }

    // 3. From thread swipe DOM card in chat feed
    if (!custName || custName === 'Customer Name' || custName.toLowerCase() === 'customer') {
        const wrapper = document.querySelector(`.thread-swipe-wrapper[data-cust-id="${custId}"]`);
        if (wrapper) {
            custName = (wrapper.getAttribute('data-customer-name') || wrapper.dataset.customerName || "").trim();
            if (!custName) {
                const nameSpan = wrapper.querySelector('.truncate.font-black, span.font-black');
                if (nameSpan) {
                    custName = (nameSpan.innerText || nameSpan.textContent || '').trim();
                }
            }
        }
    }

    // 4. From FB cache
    if (!custName || custName === 'Customer Name' || custName.toLowerCase() === 'customer') {
        if (typeof window.getResolvedFbName === 'function') {
            const resolved = window.getResolvedFbName(custId);
            if (resolved && resolved.name && resolved.name.toLowerCase() !== 'customer') {
                custName = resolved.name.trim();
            }
        }
    }

    // 5. From roster catering records
    if (!custName || custName === 'Customer Name' || custName.toLowerCase() === 'customer') {
        const roster = globalState.rosterMembers || [];
        for (const m of roster) {
            if (m.forcedCaters && typeof m.forcedCaters === 'object') {
                for (const [fcKey, fcVal] of Object.entries(m.forcedCaters)) {
                    if (fcKey === custId) {
                        const fName = (fcVal && typeof fcVal === 'object' && fcVal.customerName) ? fcVal.customerName : fcVal;
                        if (fName && typeof fName === 'string' && fName.toLowerCase() !== 'customer') {
                            custName = fName.trim();
                            break;
                        }
                    }
                }
            }
            if (custName && custName.toLowerCase() !== 'customer') break;
            if (m.customerName) {
                const custs = m.customerName.split(', ').map(c => c.trim()).filter(Boolean);
                const match = custs.find(c => isCustomerMatch(c, custId) || c.toLowerCase().includes(custId.toLowerCase()));
                if (match) {
                    custName = match;
                    break;
                }
            }
        }
    }

    if (!custName || custName === 'Customer Name' || custName.toLowerCase() === 'customer') {
        custName = "Customer";
    }

    return { custId, custName, meta };
}

/**
 * Opens the confirmation safeguard modal before marking a customer delivery as done/completed.
 */
export function openConfirmDoneModal(targetCustId = null, targetCustName = "") {
    const { custId, custName: resolvedName, meta } = getThreadMetadataAndCustomerName(targetCustId, targetCustName);
    if (!custId) return;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    const { record: cateringRiderRecord, matchingCustName: matchingCustNameOnRoster } = findCateringRiderForCustomer(resolvedName, meta);

    const isCateredByMe = Boolean(
        cateringRiderRecord && (
            (myId && (cateringRiderRecord.telegramId || cateringRiderRecord.id || "").toString().trim() === myId) ||
            (myName && (cateringRiderRecord.riderName || cateringRiderRecord.name || "").toString().trim().toLowerCase() === myName)
        )
    );

    const isThreadInCatering = (meta?.folder === 'catering') ||
        Boolean(meta?.cateredByRiderId && meta.cateredByRiderId.toString().trim() !== "") ||
        Boolean(meta?.cateredByRiderName && meta.cateredByRiderName.toString().trim() !== "") ||
        Boolean(meta?.cateredBy && meta.cateredBy.toString().trim() !== "") ||
        Boolean(cateringRiderRecord && !isCateredByMe);

    // Rule: "if the chat thread is in catering then just close the window."
    if (!isCateredByMe && isThreadInCatering) {
        showToast("🛵 This customer is being catered by another rider. Chat window closed.");
        if (typeof window.closeRiderCustomerChatModal === 'function') {
            window.closeRiderCustomerChatModal();
        }
        return;
    }

    const finalDisplayName = (resolvedName && resolvedName !== 'Customer')
        ? resolvedName
        : (matchingCustNameOnRoster || meta.customerName || "Customer");

    pendingDoneData = {
        custId,
        custName: finalDisplayName,
        cateringRiderRecord: isCateredByMe ? cateringRiderRecord : null,
        matchingCustNameOnRoster: matchingCustNameOnRoster || finalDisplayName,
        meta,
        isCateredByMe
    };

    const modal = document.getElementById('rider-chat-confirm-done-modal');
    if (!modal) {
        confirmAndExecuteDone();
        return;
    }

    const titleEl = document.getElementById('confirm-done-modal-title');
    const subtitleEl = document.getElementById('confirm-done-modal-subtitle');
    const custNameEl = document.getElementById('confirm-done-cust-name');
    const badgeEl = document.getElementById('confirm-done-status-badge');
    const msgBoxEl = document.getElementById('confirm-done-message-box');
    const receiptNoticeEl = document.getElementById('confirm-done-receipt-notice');
    const receiptTextEl = document.getElementById('confirm-done-receipt-text');

    if (custNameEl) {
        custNameEl.textContent = finalDisplayName;
    }

    if (isCateredByMe) {
        const rName = cateringRiderRecord.riderName || cateringRiderRecord.name || "Rider";
        if (titleEl) titleEl.textContent = "Confirm Delivery Completion";
        if (subtitleEl) subtitleEl.textContent = `Active Catering • Rider: ${rName}`;
        if (badgeEl) {
            badgeEl.className = "px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shrink-0";
            badgeEl.textContent = "Catering";
        }
        if (msgBoxEl) {
            msgBoxEl.innerHTML = `Are you sure delivery is completed for <strong>${escapeHtml(finalDisplayName)}</strong>?<br class="hidden sm:inline"> This will mark it as <strong>Done</strong> on the catering roster, record service fees, and move the chat to the Done folder.`;
        }

        // Receipt verification preview check
        const cleanTarget = (matchingCustNameOnRoster || finalDisplayName).toLowerCase().trim();
        const hasReceipt = (typeof checkCustomerReceiptExists === 'function')
            ? checkCustomerReceiptExists(cleanTarget, myName, myId)
            : (hasReceiptForActiveSession(cleanTarget) || (globalState.globalDailyReceipts || []).some(rc => isCustomerMatch(rc.customerName, cleanTarget)));

        if (receiptNoticeEl) {
            if (!hasReceipt) {
                receiptNoticeEl.classList.remove('hidden');
                if (receiptTextEl) {
                    receiptTextEl.innerHTML = `⚠️ <strong>No receipt found.</strong> If there is no receipt yet, you will be redirected to the Cart to create one before marking as Done.`;
                }
            } else {
                receiptNoticeEl.classList.add('hidden');
            }
        }
    } else {
        if (titleEl) titleEl.textContent = "Move Chat to Done";
        if (subtitleEl) subtitleEl.textContent = "Chat Management";
        if (badgeEl) {
            badgeEl.className = "px-2 py-0.5 rounded-lg text-[10px] font-bold bg-gray-500/15 text-gray-600 dark:text-gray-400 border border-gray-500/30 shrink-0";
            badgeEl.textContent = (meta.folder || "Inbox").toUpperCase();
        }
        if (msgBoxEl) {
            msgBoxEl.innerHTML = `Do you want to move the conversation of <strong>${escapeHtml(finalDisplayName)}</strong> to the <strong>Done</strong> folder?`;
        }
        if (receiptNoticeEl) receiptNoticeEl.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    toggleBodyScroll(true);
}

export function closeConfirmDoneModal() {
    const modal = document.getElementById('rider-chat-confirm-done-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
    pendingDoneData = null;
}

export async function confirmAndExecuteDone() {
    if (!pendingDoneData) return;
    const { custId, custName, cateringRiderRecord, matchingCustNameOnRoster, meta, isCateredByMe } = pendingDoneData;

    closeConfirmDoneModal();

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    // 1. If customer is being catered by the current rider:
    if (isCateredByMe && cateringRiderRecord && matchingCustNameOnRoster && typeof completeSingleCateringCustomer === 'function') {
        const hasReceipt = (typeof checkCustomerReceiptExists === 'function')
            ? checkCustomerReceiptExists(matchingCustNameOnRoster || custName, myName, myId)
            : hasReceiptForActiveSession(matchingCustNameOnRoster || custName);

        if (!hasReceipt) {
            showToast(`⚠️ Please make a receipt for ${matchingCustNameOnRoster || custName} before marking as Done!`);
            if (typeof window.syncSmartCartsWithCateringCustomers === 'function') {
                window.syncSmartCartsWithCateringCustomers();
            }
            let targetSlot = 1;
            if (typeof window.getCartSlotForCustomer === 'function') {
                targetSlot = window.getCartSlotForCustomer(matchingCustNameOnRoster || custName);
            }
            if (typeof window.switchCartTab === 'function') {
                window.switchCartTab(targetSlot);
            }
            if (typeof window.closeRiderCustomerChatModal === 'function') {
                window.closeRiderCustomerChatModal();
            }
            if (typeof window.switchView === 'function') {
                window.switchView('view-cart');
            }
            return;
        }

        const rId = cateringRiderRecord.telegramId || cateringRiderRecord.id || myId;
        const rName = cateringRiderRecord.riderName || cateringRiderRecord.name || myName;

        const success = await completeSingleCateringCustomer(rId, rName, matchingCustNameOnRoster);

        if (success === false) {
            if (typeof window.closeRiderCustomerChatModal === 'function') {
                window.closeRiderCustomerChatModal();
            }
            return;
        }

        if (meta?.latestOrderId && typeof updateOrderMilestone === 'function') {
            updateOrderMilestone('delivered', meta.latestOrderId).catch(() => {});
        }

        if (typeof window.closeRiderCustomerChatModal === 'function') {
            window.closeRiderCustomerChatModal();
        }
        showToast(`✅ Marked ${custName || matchingCustNameOnRoster} as Completed!`);
        return;
    }

    // 2. If customer is in catering but NOT catered by me:
    const isThreadInCatering = (meta?.folder === 'catering') ||
        Boolean(meta?.cateredByRiderId && meta.cateredByRiderId.toString().trim() !== "") ||
        Boolean(meta?.cateredByRiderName && meta.cateredByRiderName.toString().trim() !== "") ||
        Boolean(meta?.cateredBy && meta.cateredBy.toString().trim() !== "");

    if (isThreadInCatering) {
        showToast("🛵 This customer is being catered by another rider. Chat window closed.");
        if (typeof window.closeRiderCustomerChatModal === 'function') {
            window.closeRiderCustomerChatModal();
        }
        return;
    }

    // 3. Customer is in Inbox (not catering):
    await executeThreadDone(custId, custName);
}

export function markThreadDone(targetCustId = null, targetCustName = "") {
    // Confirmation safeguard modal
    openConfirmDoneModal(targetCustId, targetCustName);
}

export async function executeThreadDone(targetCustId = null, targetCustName = "") {
    const { custId, custName: resolvedName, meta } = getThreadMetadataAndCustomerName(targetCustId, targetCustName);
    if (!custId) return;

    let custName = (resolvedName && resolvedName !== 'Customer') ? resolvedName : "";
    const now = Date.now();

    // Move customer thread to Done folder in Firebase
    if (db) {
        const payload = {
            cateredByRiderId: null,
            cateredByRiderName: null,
            cateredBy: null,
            folder: 'done',
            status: 'completed',
            completedAt: now,
            unreadForRider: false,
            lastUpdated: now
        };
        db.ref(`customerChats/${custId}/metadata`).update(payload).catch(() => {});
        db.ref(`customerChatMeta/${custId}`).update(payload).catch(() => {});
    }

    // Immediately synchronize in-memory thread and update feed
    if (typeof window.getCachedCustomerThreadsMap === 'function') {
        const threadMap = window.getCachedCustomerThreadsMap();
        if (threadMap) {
            if (threadMap.has(custId)) {
                const t = threadMap.get(custId);
                t.folder = 'done';
                t.status = 'completed';
                t.completedAt = now;
                t.isUnread = false;
                t.unreadForRider = false;
                t.cateredByRiderId = null;
                t.cateredByRiderName = null;
                t.cateredBy = null;
            }
            if (custName) {
                const cleanTarget = custName.trim().toLowerCase();
                for (const t of threadMap.values()) {
                    const tName = (t.customerName || t.name || "").trim().toLowerCase();
                    if (tName === cleanTarget || isCustomerMatch(tName, cleanTarget)) {
                        t.folder = 'done';
                        t.status = 'completed';
                        t.completedAt = now;
                        t.isUnread = false;
                        t.unreadForRider = false;
                        t.cateredByRiderId = null;
                        t.cateredByRiderName = null;
                        t.cateredBy = null;
                    }
                }
            }
        }
    }

    if (typeof window.renderRiderCustomerChatFeed === 'function') {
        window.renderRiderCustomerChatFeed();
    }

    document.getElementById('rider-chat-cancel-btn')?.classList.add('hidden');
    showToast("✅ Moved chat to Done!");
    if (!targetCustId && window.closeRiderCustomerChatModal) window.closeRiderCustomerChatModal();
}

/**
 * Toggles a customer thread's Applicant status.
 * When enabled: sets isApplicant: true, folder: 'applicant'
 * When disabled: sets isApplicant: false, folder: 'inbox'
 */
export async function toggleThreadApplicant(targetCustId = null) {
    const rawId = targetCustId || (window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null);
    if (!rawId) {
        showToast("⚠️ No active chat selected.");
        return;
    }

    const custId = (rawId || "").replace(/^id_/, '').replace(/^fb_fb_/, 'fb_');
    const threadMap = (typeof window.getCachedCustomerThreadsMap === 'function') 
        ? window.getCachedCustomerThreadsMap() 
        : null;

    let currentMeta = (window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {}) || {};
    let currentThread = null;

    if (threadMap) {
        if (threadMap.has(custId)) currentThread = threadMap.get(custId);
        else if (threadMap.has(`fb_${custId}`)) currentThread = threadMap.get(`fb_${custId}`);
        else if (threadMap.has(rawId)) currentThread = threadMap.get(rawId);
    }

    const currentlyApplicant = Boolean(
        (currentThread && (currentThread.isApplicant || currentThread.folder === 'applicant')) ||
        (currentMeta && (currentMeta.isApplicant || currentMeta.folder === 'applicant'))
    );

    const newApplicantState = !currentlyApplicant;
    const newFolder = newApplicantState ? 'applicant' : 'inbox';
    const now = Date.now();

    const payload = {
        isApplicant: newApplicantState,
        folder: newFolder,
        status: newApplicantState ? 'active' : (currentThread?.status || currentMeta?.status || 'active'),
        lastUpdated: now
    };

    if (currentThread) {
        currentThread.isApplicant = newApplicantState;
        currentThread.folder = newFolder;
        currentThread.status = newApplicantState ? 'active' : (currentThread.status || 'active');
        currentThread.lastUpdated = now;
    }

    if (currentMeta && (window.getActiveRiderChatCustId && window.getActiveRiderChatCustId() === custId)) {
        currentMeta.isApplicant = newApplicantState;
        currentMeta.folder = newFolder;
        currentMeta.status = newApplicantState ? 'active' : (currentMeta.status || 'active');
        currentMeta.lastUpdated = now;
    }

    if (typeof window.syncApplicantUI === 'function') {
        window.syncApplicantUI(payload);
    }

    if (db) {
        try {
            await Promise.all([
                db.ref(`customerChats/${custId}/metadata`).update(payload),
                db.ref(`customerChatMeta/${custId}`).update(payload)
            ]);
            if (custId.startsWith('fb_')) {
                const plain = custId.replace(/^fb_/, '');
                await Promise.all([
                    db.ref(`customerChats/${plain}/metadata`).update(payload).catch(() => {}),
                    db.ref(`customerChatMeta/${plain}`).update(payload).catch(() => {})
                ]);
            }
        } catch (e) {
            console.warn("Failed to update applicant status in RTDB:", e);
        }
    }

    if (typeof window.renderRiderCustomerChatFeed === 'function') {
        window.renderRiderCustomerChatFeed();
    }

    if (newApplicantState) {
        showToast("👔 Thread marked as Applicant!");
    } else {
        showToast("↩️ Applicant tag removed & returned to Inbox.");
    }
}

export async function markThreadFollowUp() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (!custId) return;

    const rawId = custId.toString().replace(/^fb_/, '');
    const threadMap = (typeof window.getCachedCustomerThreadsMap === 'function') ? window.getCachedCustomerThreadsMap() : null;
    let currentMeta = (window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {}) || {};
    let currentThread = null;

    if (threadMap) {
        if (threadMap.has(custId)) currentThread = threadMap.get(custId);
        else if (threadMap.has(`fb_${custId}`)) currentThread = threadMap.get(`fb_${custId}`);
        else if (threadMap.has(rawId)) currentThread = threadMap.get(rawId);
    }

    const currentlyFollowUp = Boolean(
        (currentThread && currentThread.folder === 'followup') ||
        (currentMeta && currentMeta.folder === 'followup')
    );

    const newFollowUpState = !currentlyFollowUp;
    const newFolder = newFollowUpState ? 'followup' : 'inbox';
    const now = Date.now();

    const payload = {
        folder: newFolder,
        isApplicant: false,
        status: newFollowUpState ? 'active' : (currentThread?.status || currentMeta?.status || 'active'),
        lastUpdated: now
    };

    if (currentThread) {
        currentThread.folder = newFolder;
        currentThread.isApplicant = false;
        currentThread.status = newFollowUpState ? 'active' : (currentThread.status || 'active');
        currentThread.lastUpdated = now;
    }

    if (currentMeta && (window.getActiveRiderChatCustId && window.getActiveRiderChatCustId() === custId)) {
        currentMeta.folder = newFolder;
        currentMeta.isApplicant = false;
        currentMeta.status = newFollowUpState ? 'active' : (currentMeta.status || 'active');
        currentMeta.lastUpdated = now;
    }

    if (typeof window.syncApplicantUI === 'function') {
        window.syncApplicantUI(payload);
    }

    if (db) {
        try {
            await Promise.all([
                db.ref(`customerChats/${custId}/metadata`).update(payload),
                db.ref(`customerChatMeta/${custId}`).update(payload)
            ]);
            if (custId.startsWith('fb_')) {
                const plain = custId.replace(/^fb_/, '');
                await Promise.all([
                    db.ref(`customerChats/${plain}/metadata`).update(payload).catch(() => {}),
                    db.ref(`customerChatMeta/${plain}`).update(payload).catch(() => {})
                ]);
            }
        } catch (e) {
            console.warn("Failed to update follow-up status in RTDB:", e);
        }
    }

    if (newFollowUpState) {
        const custName = document.getElementById('rider-chat-cust-name')?.innerText || currentMeta.customerName || "";
        const activeCustData = window.getActiveCustData ? window.getActiveCustData() : null;
        const phone = activeCustData?.phoneNumber || "";
        const address = activeCustData?.address || "";

        const advModal = document.getElementById('adv-orders-modal');
        if (advModal) {
            advModal.classList.remove('hidden');
            if (typeof toggleBodyScroll === 'function') toggleBodyScroll(true);

            if (window.switchAdvTab) window.switchAdvTab('add');

            const nameInput = document.getElementById('adv-cust-name');
            const contactInput = document.getElementById('adv-contact');
            const addrInput = document.getElementById('adv-address');

            if (nameInput) nameInput.value = custName;
            if (contactInput) contactInput.value = phone;
            if (addrInput) addrInput.value = address;
        }

        showToast("📌 Moved chat to Follow Up & loaded Advance Order form!");
    } else {
        showToast("↩️ Follow Up tag removed & returned to Inbox.");
    }

    if (typeof window.renderRiderCustomerChatFeed === 'function') {
        window.renderRiderCustomerChatFeed();
    }
}

// VOID SPECIFIC CUSTOMER WITHOUT CANCELING OTHER ACTIVE BOOKINGS
export function cancelCustomerThread() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    const meta = window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {};
    const custName = document.getElementById('rider-chat-cust-name')?.innerText?.trim() || meta?.customerName || "";
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = appState.riderName || localStorage.getItem('riderName') || "Rider";

    if (!custId && !custName) return;

    const hasAdminPower = isAdmin() || canManageRoster() || Boolean(globalState.adminControlsEnabled) || (typeof localStorage !== 'undefined' && localStorage.getItem('adminControlsEnabled') === 'true');
    const hasTlVoidPower = hasTlPermission('canVoidCustomer') || hasTlPermission('canVoid') || hasTlPermission('canForceCater');

    let targetRiderId = (meta?.cateredByRiderId || "").toString().trim();
    let targetRiderName = (meta?.cateredByRiderName || meta?.cateredBy || "").toString().trim();

    if (!targetRiderId && custName) {
        const roster = globalState.rosterMembers || [];
        const cleanCust = custName.toLowerCase().trim();
        const found = roster.find(m => m.status === 'Catering' && m.customerName && (
            m.customerName.toLowerCase().includes(cleanCust) || (typeof isCustomerMatch === 'function' && isCustomerMatch(m.customerName, cleanCust))
        ));
        if (found) {
            targetRiderId = (found.telegramId || found.id || "").toString().trim();
            targetRiderName = found.riderName || found.name || "";
        }
    }
    if (!targetRiderId) {
        targetRiderId = myId;
        targetRiderName = myName;
    }

    // SAFEGUARD (Ordinary Rider vs Admin/TL):
    if (!hasAdminPower && !hasTlVoidPower) {
        // If the order or chat is already marked cancelled, done, or moved to follow-up, allow the rider to clear it
        const isCancelledOrder = meta?.status === 'cancelled' || meta?.status === 'voided' || meta?.isCancelled === true || meta?.folder === 'done' || meta?.folder === 'followup';
        if (!isCancelledOrder) {
            const receiptExists = (typeof checkCustomerReceiptExists === 'function')
                ? checkCustomerReceiptExists(custName, targetRiderName, targetRiderId)
                : false;
            if (receiptExists) {
                return showToast("⚠️ Cannot cancel an order that already has an existing receipt. Please contact Admin or TL to void it.");
            }
        }
    }

    openSlideDeleteModal(
        `Cancel & Void Customer?`,
        `Are you sure you want to void [${custName || 'Customer'}]?\nIf you have other catered customers, you will remain in Catering.`,
        async () => {
            if (db && custId) {
                const cancelPayload = {
                    cateredByRiderId: null,
                    cateredByRiderName: null,
                    cateredBy: null,
                    folder: 'done',
                    status: 'cancelled',
                    unreadForRider: false,
                    lastUpdated: Date.now()
                };
                db.ref(`customerChats/${custId}/metadata`).update(cancelPayload).catch(() => {});
                db.ref(`customerChatMeta/${custId}`).update(cancelPayload).catch(() => {});
            }

            if (custName && targetRiderId) {
                await voidSingleCateringCustomer(targetRiderId, targetRiderName, custName);
            }

            document.getElementById('rider-chat-cancel-btn')?.classList.add('hidden');
            if (window.closeRiderCustomerChatModal) window.closeRiderCustomerChatModal();
        }
    );
}

export async function caterCurrentChatCustomer() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    const meta = (window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {}) || {};
    const nameEl = document.getElementById('rider-chat-cust-name');
    let custName = nameEl?.innerText?.trim();
    if (!custName || custName === 'Customer Name' || custName === 'Customer' || custName.startsWith('FB Customer (')) {
        custName = meta.customerName || meta.name || custName || "";
    }
    if (!custName || custName === 'Customer Name' || custName.toLowerCase() === 'customer') {
        custName = (meta.customerName || meta.name || "").trim();
    }

    if (!custName || custName.toLowerCase() === 'customer' || custName.toLowerCase() === 'customer name') {
        return showToast("⚠️ Please enter or update the real customer name before catering.");
    }

    if (!custId || custId.toString().toLowerCase() === 'customer') {
        return showToast("⚠️ No active valid customer chat to cater.");
    }

    const activeRole = localStorage.getItem('lokalex_active_role');
    const currentId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const currentName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim();

    const isAdminUser = typeof window.isAdmin === 'function' ? window.isAdmin() : (typeof isAdmin === 'function' ? isAdmin() : false);
    const canManage = typeof window.canManageRoster === 'function' ? window.canManageRoster() : (typeof canManageRoster === 'function' ? canManageRoster() : false);

    if ((!currentId || !currentName || activeRole !== 'rider') && !isAdminUser && !canManage) {
        showToast("⚠️ You are not logged in as a rider. Please log in before catering.");
        if (typeof window.switchView === 'function') window.switchView('view-login');
        else if (typeof window.renderViewUI === 'function') window.renderViewUI('view-login');
        return;
    }

    const liveRoster = globalState.rosterMembers || [];
    const myRecord = liveRoster.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        return (currentId && mId === currentId) || (currentName && mName === currentName.toLowerCase());
    });

    if (!isAdminUser && !canManage) {
        if (!myRecord || myRecord.status === 'End' || !myRecord.status) {
            return showToast("⚠️ You are on End Shift. Please set your status to Available on the roster before catering.");
        }
    }

    const cateredRiderId = (meta.cateredByRiderId || "").toString().trim();
    const cateredRiderName = (meta.cateredByRiderName || meta.cateredBy || "").toString().trim().toLowerCase();

    if ((cateredRiderId && cateredRiderId === currentId) || (cateredRiderName && currentName && cateredRiderName === currentName.toLowerCase())) {
        return showToast("🛵 You are already catering to this customer!");
    }

    if ((cateredRiderId || cateredRiderName) && !isAdminUser && !canManage) {
        return showToast(`⚠️ This customer is already being catered by ${meta.cateredByRiderName || meta.cateredBy}.`);
    }

    if (typeof window.confirmCateringStatus === 'function') {
        const res = await window.confirmCateringStatus(custName, custId);
        if (res && typeof window.setRiderChatFilter === 'function') {
            window.setRiderChatFilter('catering');
        }
        // Trigger Being Catered Auto-Message
        triggerAutoMessageOnCater(custId, custName, currentName).catch(() => {});
    } else {
        showToast("⚠️ Catering system unavailable.");
    }
}

export function clearAllInboxThreads() {
    const isUserAdmin = (typeof isAdmin === 'function' && isAdmin()) ||
                        (typeof canManageRoster === 'function' && canManageRoster()) ||
                        (typeof window.isAdmin === 'function' && window.isAdmin()) ||
                        (typeof isTL === 'function' && isTL()) ||
                        (typeof hasTlPermission === 'function' && hasTlPermission('canClearInbox')) ||
                        Boolean(globalState.adminControlsEnabled);
    if (!isUserAdmin) {
        showToast("⚠️ Admin or authorized TL access required to clear inbox.");
        return;
    }

    const threadMap = (typeof window.getCachedCustomerThreadsMap === 'function') 
        ? window.getCachedCustomerThreadsMap() 
        : null;

    const inboxThreads = [];
    const processedKeys = new Set();

    if (threadMap && threadMap.size > 0) {
        for (const [tId, t] of threadMap.entries()) {
            const folder = (t.folder || 'inbox').toLowerCase();
            const isCompleted = t.status === 'completed' || t.status === 'done' || t.status === 'cancelled';
            const isCatered = Boolean(t.cateredByRiderId || t.cateredByRiderName || t.cateredBy || folder === 'catering');
            const isApplicant = Boolean(t.isApplicant === true || folder === 'applicant' || folder === 'followup');
            if (folder === 'inbox' && !isCompleted && !isCatered && !isApplicant) {
                const realKey = (t.custId || t.id || tId || "").toString().replace(/^id_/, '').replace(/^fb_fb_/, 'fb_');
                if (realKey && !processedKeys.has(realKey)) {
                    processedKeys.add(realKey);
                    inboxThreads.push({ id: realKey, thread: t });
                }
            }
        }
    }

    if (inboxThreads.length === 0) {
        showToast("ℹ️ No chats in Inbox to move to Done.");
        return;
    }

    openSlideDeleteModal(
        `Clear All Inbox Chats?`,
        `All ${inboxThreads.length} active chat(s) in Inbox will be moved to [Done] folder.\nAre you sure?`,
        async () => {
            const now = Date.now();
            const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString();
            const myName = (appState.riderName || localStorage.getItem('riderName') || "Admin").toString();

            const batchUpdates = {};
            inboxThreads.forEach(({ id, thread }) => {
                thread.folder = 'done';
                thread.status = 'completed';
                thread.completedAt = now;
                thread.unreadForRider = false;
                thread.isUnread = false;
                thread.cateredByRiderId = null;
                thread.cateredByRiderName = null;
                thread.cateredBy = null;

                const origLastUpdated = Number(thread.lastUpdated) || Number(thread.timestamp) || (now - 1000);
                const donePayload = {
                    folder: 'done',
                    status: 'completed',
                    completedAt: now,
                    completedByRiderId: myId,
                    completedByRiderName: myName,
                    cateredByRiderId: null,
                    cateredByRiderName: null,
                    cateredBy: null,
                    unreadForRider: false,
                    lastUpdated: origLastUpdated
                };
                batchUpdates[`customerChats/${id}/metadata`] = donePayload;
                batchUpdates[`customerChatMeta/${id}`] = donePayload;
            });

            // Also scan customerChatMeta snapshot directly in Firebase to catch any stray inbox items
            if (db) {
                try {
                    const snap = await db.ref('customerChatMeta').once('value');
                    const allMeta = snap.val() || {};
                    Object.entries(allMeta).forEach(([k, item]) => {
                        const m = item.metadata || item;
                        const f = (m.folder || 'inbox').toLowerCase();
                        const isC = Boolean(m.cateredByRiderId || m.cateredByRiderName || m.cateredBy || f === 'catering');
                        const isFin = m.status === 'completed' || m.status === 'done' || m.status === 'cancelled';
                        const isApp = Boolean(m.isApplicant === true || f === 'applicant' || f === 'followup');
                        if (f === 'inbox' && !isC && !isFin && !isApp) {
                            const origLastUpdated = Number(m.lastUpdated) || Number(m.timestamp) || (now - 1000);
                            const donePayload = {
                                folder: 'done',
                                status: 'completed',
                                completedAt: now,
                                completedByRiderId: myId,
                                completedByRiderName: myName,
                                cateredByRiderId: null,
                                cateredByRiderName: null,
                                cateredBy: null,
                                unreadForRider: false,
                                lastUpdated: origLastUpdated
                            };
                            batchUpdates[`customerChats/${k}/metadata`] = donePayload;
                            batchUpdates[`customerChatMeta/${k}`] = donePayload;
                        }
                    });
                } catch (_) {}
            }

            if (typeof window.renderRiderCustomerChatFeed === 'function') {
                window.renderRiderCustomerChatFeed();
            }

            if (db) {
                try {
                    await db.ref().update(batchUpdates);
                    showToast(`✅ Successfully moved inbox chat(s) to Done!`);
                } catch (e) {
                    console.warn("Clear inbox batch update fallback:", e);
                    for (const fullPath of Object.keys(batchUpdates)) {
                        db.ref(fullPath).update(batchUpdates[fullPath]).catch(() => {});
                    }
                    showToast(`✅ Moved inbox chat(s) to Done.`);
                }

                // Best effort: send mark_seen to Facebook for FB messenger threads so Facebook's unread_count is reset to 0
                db.ref('adminSettings/facebookApis').once('value').then(apiSnap => {
                    const apis = apiSnap.val() || {};
                    const apiList = Object.values(apis).filter(a => a && a.pageAccessToken);
                    if (apiList.length === 0) return;
                    inboxThreads.forEach(({ id }) => {
                        if (id && id.startsWith('fb_')) {
                            const psid = id.replace(/^fb_/, '');
                            for (const api of apiList) {
                                const token = (api.pageAccessToken || '').trim();
                                if (!token) continue;
                                fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        recipient: { id: psid },
                                        sender_action: 'mark_seen'
                                    })
                                }).catch(() => {});
                            }
                        }
                    });
                }).catch(() => {});
            } else {
                showToast(`✅ Moved inbox chat(s) to Done (offline).`);
            }

            if (typeof window.renderRiderCustomerChatFeed === 'function') {
                setTimeout(() => window.renderRiderCustomerChatFeed(), 150);
            }
        }
    );
}

export function goToCustomerCartFromChat() {
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    let meta = (window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {}) || {};
    if (typeof window.getCachedCustomerThreadsMap === 'function' && custId) {
        const threadMap = window.getCachedCustomerThreadsMap();
        if (threadMap && threadMap.has(custId)) meta = { ...threadMap.get(custId), ...meta };
    }
    let custName = (document.getElementById('rider-chat-cust-name')?.innerText || '').trim();
    if (!custName || custName === 'Customer Name' || custName.toLowerCase() === 'customer' || custName.startsWith('FB Customer (')) {
        custName = meta.customerName || meta.name || "";
    }
    const { record: cateringRiderRecord, matchingCustName } = findCateringRiderForCustomer(custName, meta);
    const resolvedName = matchingCustName || custName;
    if (!resolvedName) {
        showToast("⚠️ Customer name not found.");
        return;
    }
    if (typeof window.syncSmartCartsWithCateringCustomers === 'function') {
        window.syncSmartCartsWithCateringCustomers();
    }
    let targetSlot = 1;
    if (typeof window.getCartSlotForCustomer === 'function') {
        targetSlot = window.getCartSlotForCustomer(resolvedName);
    }
    if (typeof window.switchCartTab === 'function') {
        window.switchCartTab(targetSlot);
    }
    if (typeof window.closeRiderCustomerChatModal === 'function') {
        window.closeRiderCustomerChatModal();
    }
    if (typeof window.switchView === 'function') {
        window.switchView('view-cart');
    }
    showToast(`🛒 Opened Cart ${targetSlot} for ${resolvedName}`);
}

export const undoCustomerThread = markThreadUndone;
export const followUpCustomerOrder = markThreadFollowUp;
export const completeCatering = markThreadDone;
export const cancelCatering = cancelCustomerThread;
