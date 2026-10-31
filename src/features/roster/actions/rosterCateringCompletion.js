// src/features/roster/actions/rosterCateringCompletion.js

/**
 * ============================================================================
 * ROSTER CATERING COMPLETION & DEEP CART RESET ACTION HANDLERS
 * ============================================================================
 * 
 * Description:
 * Manages the conclusion and cancellation of active catering deliveries:
 * - Validates receipt creation prior to marking an order as completed.
 * - Extracts and credits rider service fees to daily gross records.
 * - Deep cart cleanup: when a customer delivery finishes or voids, wipes
 *   items, clears receipt summaries, unlocks slot barriers, and updates UI.
 * - Enforces administrative safety verification for customer order voids.
 * ============================================================================
 */

import { db } from '../../../config/firebase.js';
import { appState, globalState, multiCarts, activeCartSlot, wizState } from '../../../store/state.js';
import { showToast, showSideNotification } from '../../../ui/notifications.js';
import { switchView } from '../../../ui/router.js';
import { openSlideDeleteModal } from '../../../ui/modals.js';
import { getLocalTodayStr } from '../../../utils/helpers.js';
import { idbSet } from '../../../utils/storageEngine.js';
import { 
    parseQueueTime, 
    parseTimeToMinutes,
    resolveOrderDate,
    hasReceiptForActiveSession, 
    parseItemGross, 
    calculateSplitDuration, 
    isRiderMatch, 
    isCustomerMatch, 
    isSameDateStr, 
    saveRosterCache,
    invalidateRosterGrossCache,
    isAdmin,
    canManageRoster,
    hasTlPermission,
    sanitizeFirebaseKey
} from '../rosterUtils.js';
import { updateRosterUI } from '../rosterUI.js';
import { updateRosterStatusData } from '../rosterStatusCore.js';
import { getTopQueueTime } from './rosterAlarms.js';



/**
 * Deeply resets a cart slot across all memory arrays and unlocks barrier states.
 */
export function purgeCartSlotForCustomer(customerName) {
    if (!customerName || !multiCarts) return;
    const cleanTarget = customerName.trim().toLowerCase();

    Object.keys(multiCarts).forEach(slotKey => {
        const cart = multiCarts[slotKey];
        if (cart && cart.customerName) {
            const currentCust = cart.customerName.trim().toLowerCase();
            if (currentCust === cleanTarget || isCustomerMatch(currentCust, cleanTarget)) {
                cart.items = [];
                cart.selectedIds = new Set();
                cart.customerName = "";
                cart.isManual = false;
                cart.txId = "";
                cart.receiptSummary = null;

                const slotIdx = parseInt(slotKey, 10) - 1;
                if (globalState.cartLocked && globalState.cartLocked[slotIdx] !== undefined) {
                    globalState.cartLocked[slotIdx] = false;
                }
                if (globalState.cartTxIds && globalState.cartTxIds[slotIdx] !== undefined) {
                    globalState.cartTxIds[slotIdx] = "";
                }
            }
        }
    });

    if (appState.selectedCateringClient && (appState.selectedCateringClient.trim().toLowerCase() === cleanTarget || isCustomerMatch(appState.selectedCateringClient, cleanTarget))) {
        appState.selectedCateringClient = "";
    }

    if (typeof window.saveCartState === 'function') {
        window.saveCartState();
    }
    if (typeof window.renderCartTabs === 'function') {
        window.renderCartTabs();
    }
    if (typeof window.renderCartItems === 'function') {
        window.renderCartItems();
    }
}

export async function completeSingleCateringCustomer(targetId, targetName, custNameToComplete) {
    const rosterMembers = globalState.rosterMembers || [];
    const cleanTargetId = (targetId || "").toString().trim();
    const cleanTargetName = (targetName || "").toString().trim().toLowerCase();

    let targetRecord = rosterMembers.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        if (cleanTargetId && mId && mId === cleanTargetId) return true;
        if (cleanTargetName && mName && mName === cleanTargetName) return true;
        return false;
    });

    let resolvedTargetId = targetRecord ? (targetRecord.telegramId || targetRecord.id || cleanTargetId) : cleanTargetId;
    let resolvedTargetName = targetRecord ? (targetRecord.riderName || targetRecord.name || targetName) : targetName;

    if (!resolvedTargetId && isMe) {
        resolvedTargetId = myId;
    }
    if (!resolvedTargetId && targetRecord?.key) {
        resolvedTargetId = targetRecord.key;
    }

    if (!resolvedTargetId && !targetRecord) return false;

    let remainingCusts = [];
    let remainingTimes = [];
    let completedStartTime = "";

    if (targetRecord && targetRecord.customerName) {
        const custs = targetRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
        const times = targetRecord.startTime ? targetRecord.startTime.split(', ').map(t => t.trim()) : [];

        custs.forEach((c, idx) => {
            const isTargetCust = (c.toLowerCase().trim() === custNameToComplete.toLowerCase().trim()) || isCustomerMatch(c, custNameToComplete);
            if (!isTargetCust) {
                remainingCusts.push(c);
                remainingTimes.push(times[idx] || times[0] || "");
            } else {
                completedStartTime = times[idx] || times[0] || "";
            }
        });
    }

    const cleanCust = custNameToComplete.toLowerCase().trim();
    const cleanCustKey = sanitizeFirebaseKey(cleanCust);
    const todayStr = getLocalTodayStr();
    const todayClean = todayStr.replace(/-/g, '');
    const endTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. Receipt Verification Gate & Milestone Extraction
    let receiptTimeFound = "";
    let cFeeObj = null;
    let matchedCfKey = null;

    if (targetRecord?.customerFees && typeof targetRecord.customerFees === 'object') {
        if (cleanCustKey && targetRecord.customerFees[cleanCustKey]) {
            cFeeObj = targetRecord.customerFees[cleanCustKey];
            matchedCfKey = cleanCustKey;
        } else {
            for (const [cfK, cfV] of Object.entries(targetRecord.customerFees)) {
                if (!cfV) continue;
                const cfName = (cfV.customerName || cfK || "").trim();
                if (cfK.toLowerCase() === cleanCust.toLowerCase() ||
                    cfName.toLowerCase() === cleanCust.toLowerCase() ||
                    isCustomerMatch(cfName, custNameToComplete)) {
                    cFeeObj = cfV;
                    matchedCfKey = cfK;
                    break;
                }
            }
        }
    }

    if (cFeeObj?.receiptTime) {
        receiptTimeFound = cFeeObj.receiptTime;
    }

    const matchReceipt = (globalState.globalDailyReceipts || []).find(rc => {
        if (!rc) return false;
        const rMatch = isRiderMatch(resolvedTargetName, rc.riderName, resolvedTargetId, rc.telegramId);
        const cMatch = isCustomerMatch(rc.customerName, custNameToComplete) || 
                       (rc.customerName && rc.customerName.trim().toLowerCase() === cleanCust);
        const dMatch = isSameDateStr(rc.date || rc.completedDate, todayStr);
        return (rMatch || !rc.riderName) && cMatch && (dMatch || !rc.date);
    });

    if (!receiptTimeFound && matchReceipt) {
        receiptTimeFound = matchReceipt.receiptTime || matchReceipt.completedTime || "";
    }

    const hasReceipt = hasReceiptForActiveSession(custNameToComplete, completedStartTime) ||
        !!cFeeObj ||
        !!matchReceipt;

    if (!hasReceipt) {
        showToast(`⚠️ Please create a receipt for ${custNameToComplete} before marking as Done!`);
        const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
        if (resolvedTargetId === myId) {
            if (typeof window.syncSmartCartsWithCateringCustomers === 'function') {
                window.syncSmartCartsWithCateringCustomers();
            }
            let targetSlot = activeCartSlot || 1;
            if (typeof window.getCartSlotForCustomer === 'function') {
                targetSlot = window.getCartSlotForCustomer(custNameToComplete);
            }
            if (typeof window.switchCartTab === 'function') {
                window.switchCartTab(targetSlot);
            }
            switchView('view-cart');
        }
        return false;
    }

    // 2. Extract Strict Rider Service Fees (Delivery + Handling + Market + Multi-Stop)
    const cleanRiderKey = resolvedTargetName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanTimeKey = completedStartTime.replace(/[^a-z0-9]/gi, '');
    let targetTxId = `RCPT_${cleanRiderKey}_${cleanCustKey}_${todayClean}_${cleanTimeKey || '1'}`;
    let finalFees = 0;
    let finalFeeDetails = null;

    if (cFeeObj) {
        finalFeeDetails = cFeeObj.fees || null;
        if (cFeeObj.totalFees !== undefined && cFeeObj.totalFees !== null) {
            finalFees = parseFloat(cFeeObj.totalFees) || 0;
        }
        if (cFeeObj.transactionId) {
            targetTxId = cFeeObj.transactionId;
        }
    }

    if (finalFees <= 0 && matchReceipt) {
        finalFeeDetails = finalFeeDetails || matchReceipt.fees || null;
        if (finalFeeDetails && typeof finalFeeDetails === 'object') {
            const parseNum = (v) => {
                if (typeof v === 'number') return v;
                return parseFloat(String(v || '0').replace(/[^0-9.-]/g, '')) || 0;
            };
            const hf = parseNum(finalFeeDetails.handling || finalFeeDetails.handlingFee);
            const mf = parseNum(finalFeeDetails.market || finalFeeDetails.marketFee);
            const ms = parseNum(finalFeeDetails.multistore || finalFeeDetails.multistop || finalFeeDetails.multistoreFees);
            const rdf = parseNum(finalFeeDetails.delivery || finalFeeDetails.deliveryFees || finalFeeDetails.riderFee || finalFeeDetails.deliveryFee);
            finalFees = hf + mf + ms + rdf;
        }

        if (finalFees <= 0) {
            finalFees = parseItemGross(matchReceipt);
        }
        targetTxId = matchReceipt.transactionId || matchReceipt.id || targetTxId;
    }

    if (finalFees <= 0 && targetRecord?.lastReceiptTotalFees) {
        finalFees = parseFloat(targetRecord.lastReceiptTotalFees) || 0;
        if (!finalFeeDetails && targetRecord.lastReceiptFees) {
            finalFeeDetails = targetRecord.lastReceiptFees;
        }
    }

    const splitDuration = calculateSplitDuration(completedStartTime, endTimeStr, 1);

    // 3. Log Completed Order with 3-Stage Milestones (Started, Receipt Created, Marked Done)
    const hItem = {
        id: targetTxId,
        transactionId: targetTxId,
        riderName: resolvedTargetName,
        name: resolvedTargetName,
        telegramId: resolvedTargetId,
        customerName: custNameToComplete,
        startTime: completedStartTime || endTimeStr,
        receiptTime: receiptTimeFound || completedStartTime || endTimeStr,
        doneTime: endTimeStr,
        completedTime: endTimeStr,
        completedDate: todayStr,
        date: todayStr,
        customerCount: 1,
        duration: splitDuration,
        totalFees: finalFees,
        fees: finalFeeDetails,
        timestamp: Date.now()
    };

    if (db) {
        db.ref(`cateredHistory/${targetTxId}`).set(hItem).catch(() => {});
        db.ref(`catered/${todayStr}/${targetTxId}`).set(hItem).catch(() => {});
        if (targetTxId) {
            db.ref(`receipts/${targetTxId}`).update({
                doneTime: endTimeStr,
                completedTime: endTimeStr
            }).catch(() => {});
        }
        if (matchReceipt?.id && matchReceipt.id !== targetTxId) {
            db.ref(`receipts/${matchReceipt.id}`).update({
                doneTime: endTimeStr,
                completedTime: endTimeStr
            }).catch(() => {});
        }
        if (matchReceipt?.transactionId && matchReceipt.transactionId !== targetTxId) {
            db.ref(`receipts/${matchReceipt.transactionId}`).update({
                doneTime: endTimeStr,
                completedTime: endTimeStr
            }).catch(() => {});
        }

        if (db) {
            const markChatCompleted = (targetChatId) => {
                if (!targetChatId) return;
                const now = Date.now();
                const doneUpdate = {
                    folder: 'done',
                    status: 'completed',
                    completedAt: now,
                    completedByRiderId: resolvedTargetId,
                    completedByRiderName: resolvedTargetName,
                    cateredByRiderId: null,
                    cateredByRiderName: null,
                    cateredBy: null,
                    forcedBy: null,
                    isForcedCater: false,
                    unreadForRider: false,
                    lastUpdated: now
                };
                try {
                    const safeKey = sanitizeFirebaseKey(targetChatId);
                    if (safeKey) {
                        db.ref(`customerChats/${safeKey}/metadata`).update(doneUpdate).catch(() => {});
                        db.ref(`customerChatMeta/${safeKey}`).update(doneUpdate).catch(() => {});
                    }
                } catch (_) {}
            };

            // Note: Only real chat thread IDs (from threadMap or customerChatMeta) should be marked completed.
            // Do NOT call markChatCompleted on raw customer name strings as that creates ghost metadata entries.
            let doneAutoMsgSent = false;

            // Immediately synchronize in-memory live chat threads and move matching thread to Done folder
            if (typeof window.getCachedCustomerThreadsMap === 'function') {
                const threadMap = window.getCachedCustomerThreadsMap();
                if (threadMap && threadMap.size > 0) {
                    const targetLower = (custNameToComplete || "").trim().toLowerCase();
                    const now = Date.now();
                    for (const [tId, t] of threadMap.entries()) {
                        const chatName = (t.customerName || t.name || "").trim().toLowerCase();
                        const isCustomerNameMatch = chatName && (chatName === targetLower || isCustomerMatch(chatName, targetLower));
                        const isCustIdMatch = cleanCustKey && (tId.toLowerCase().includes(cleanCustKey) || (t.custId && t.custId.toLowerCase().includes(cleanCustKey)));
                        const isMatch = isCustomerNameMatch || isCustIdMatch;

                        if (isMatch) {
                            t.folder = 'done';
                            t.status = 'completed';
                            t.completedAt = now;
                            t.isUnread = false;
                            t.unreadForRider = false;
                            t.cateredByRiderId = null;
                            t.cateredByRiderName = null;
                            t.cateredBy = null;
                            markChatCompleted(tId);
                            if (!doneAutoMsgSent && typeof window.triggerAutoMessageOnDone === 'function') {
                                doneAutoMsgSent = true;
                                window.triggerAutoMessageOnDone(tId, custNameToComplete, resolvedTargetName, resolvedTargetId, matchReceipt || cFeeObj);
                            }
                        }
                    }
                }
            }

            if (!doneAutoMsgSent && cleanCustKey && typeof window.triggerAutoMessageOnDone === 'function') {
                window.triggerAutoMessageOnDone(cleanCustKey, custNameToComplete, resolvedTargetName, resolvedTargetId, matchReceipt || cFeeObj);
            }

            if (typeof window.renderRiderCustomerChatFeed === 'function') {
                window.renderRiderCustomerChatFeed();
            }

            db.ref('customerChatMeta').once('value', (snapshot) => {
                const chats = snapshot.val() || {};
                const targetLower = (custNameToComplete || "").trim().toLowerCase();
                Object.keys(chats).forEach(custId => {
                    const meta = chats[custId]?.metadata || chats[custId] || {};
                    // If chat is already done, completed, or voided, do not mutate it or update its timestamp
                    if (meta.folder === 'done' || meta.status === 'completed' || meta.status === 'voided') return;

                    const chatCustName = (meta.customerName || meta.name || "").trim().toLowerCase();
                    const isRiderMatch = (meta.cateredByRiderId && meta.cateredByRiderId.toString() === resolvedTargetId.toString()) ||
                                         (meta.cateredByRiderName && meta.cateredByRiderName.trim().toLowerCase() === resolvedTargetName.trim().toLowerCase());

                    if (chatCustName && (chatCustName === targetLower || isCustomerMatch(chatCustName, targetLower))) {
                        markChatCompleted(custId);
                    } else if (isRiderMatch && (cleanCustKey && custId.includes(cleanCustKey))) {
                        markChatCompleted(custId);
                    }
                });
            }).catch(() => {});
        }

        if (resolvedTargetId) {
            try {
                if (cleanCustKey) db.ref(`roster/${resolvedTargetId}/customerFees/${cleanCustKey}`).remove().catch(() => {});
                if (matchedCfKey && matchedCfKey !== cleanCustKey) db.ref(`roster/${resolvedTargetId}/customerFees/${sanitizeFirebaseKey(matchedCfKey)}`).remove().catch(() => {});
                if (cleanCustKey) db.ref(`roster/${resolvedTargetId}/forcedCaters/${cleanCustKey}`).remove().catch(() => {});
            } catch (_) {}
        }
    }

    if (!globalState.globalCateredHistory) globalState.globalCateredHistory = [];
    const exHistIdx = globalState.globalCateredHistory.findIndex(h => h && (h.id === targetTxId || h.transactionId === targetTxId));
    if (exHistIdx !== -1) {
        globalState.globalCateredHistory[exHistIdx] = hItem;
    } else {
        globalState.globalCateredHistory.push(hItem);
    }

    if (matchReceipt) {
        matchReceipt.doneTime = endTimeStr;
        matchReceipt.completedTime = endTimeStr;
    }

    if (targetRecord?.customerFees && cleanCustKey) {
        delete targetRecord.customerFees[cleanCustKey];
    }

    if (targetRecord && targetRecord.forcedCaters) {
        delete targetRecord.forcedCaters[cleanCustKey];
        delete targetRecord.forcedCaters[cleanCust];
        delete targetRecord.forcedCaters[custNameToComplete];

        if (Object.keys(targetRecord.forcedCaters).length === 0) {
            targetRecord.forcedCaters = null;
            targetRecord.isForcedCater = false;
            targetRecord.forcedBy = null;
        }
    }

    // DEEP CART CLEANUP: Purge items, reset receipt summaries, and unlock barrier
    purgeCartSlotForCustomer(custNameToComplete);

    // 4. Update Rotation State
    if (remainingCusts.length > 0) {
        await updateRosterStatusData(
            'Catering', 
            remainingCusts.join(', '), 
            remainingTimes.join(', '), 
            targetRecord ? parseQueueTime(targetRecord.queueTime) : Date.now(), 
            resolvedTargetId, 
            resolvedTargetName,
            [],
            false,
            "",
            { 
                forcedCaters: targetRecord ? targetRecord.forcedCaters : null,
                forcedBy: targetRecord ? targetRecord.forcedBy : null,
                isForcedCater: !!(targetRecord && targetRecord.isForcedCater)
            }
        );
        showToast(`✅ [${custNameToComplete}] Done! (₱${finalFees.toFixed(2)} credited). ${remainingCusts.length} order(s) left.`);
        showSideNotification("DELIVERY DONE", `${custNameToComplete} • ₱${finalFees.toFixed(2)}`, "fa-circle-check", "text-emerald-400", "border-emerald-500");
    } else {
        const topQueueTime = getTopQueueTime();
        const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString();

        const availableTimestamp = Date.now();
        const availableTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (db && resolvedTargetId) {
            db.ref(`roster/${resolvedTargetId}/forcedCaters`).remove().catch(() => {});
            db.ref(`roster/${resolvedTargetId}/customerFees`).remove().catch(() => {});
            db.ref(`roster/${resolvedTargetId}/availableLocation`).remove().catch(() => {});
            const updatePayload = {
                forcedBy: null,
                isForcedCater: false,
                availableTimestamp: availableTimestamp,
                availableTimeStr: availableTimeStr,
                queueTime: availableTimestamp
            };
            db.ref(`roster/${resolvedTargetId}`).update(updatePayload).catch(() => {});
        }
        if (targetRecord) {
            targetRecord.forcedCaters = null;
            targetRecord.forcedBy = null;
            targetRecord.isForcedCater = false;
            targetRecord.customerFees = null;
            targetRecord.availableTimestamp = availableTimestamp;
            targetRecord.availableTimeStr = availableTimeStr;
            targetRecord.queueTime = availableTimestamp;
            targetRecord.availableLocation = null;
        }

        await updateRosterStatusData(
            'Available', 
            '', 
            '', 
            topQueueTime, 
            resolvedTargetId, 
            resolvedTargetName,
            [],
            false,
            "",
            { 
                forcedCaters: null,
                forcedBy: null,
                isForcedCater: false,
                availableTimestamp: availableTimestamp,
                availableTimeStr: availableTimeStr
            }
        );
        showToast(`🎉 All deliveries completed! [${resolvedTargetName}] is now Available (₱${finalFees.toFixed(2)} credited).`);
        showSideNotification("ROTATION UPDATED", `${resolvedTargetName} is now Available`, "fa-motorcycle", "text-blue-400", "border-blue-500");
    }

    invalidateRosterGrossCache();
    saveRosterCache();
    window.dispatchEvent(new CustomEvent('cateredUpdated'));
    window.dispatchEvent(new CustomEvent('receiptsUpdated'));
    window.dispatchEvent(new CustomEvent('rosterUpdated'));
    updateRosterUI();
    if (typeof window.refreshCommissionView === 'function') {
        window.refreshCommissionView();
    }
    return true;
}

export function checkCustomerReceiptExists(custName, riderName = "", riderId = "") {
    if (!custName) return false;
    const cleanCust = custName.trim().toLowerCase();
    const cleanCustKey = sanitizeFirebaseKey(cleanCust);
    const todayStr = getLocalTodayStr();

    // 1. Locate the active roster member catering this customer
    const rosterMembers = globalState.rosterMembers || [];
    const member = rosterMembers.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        if (riderId && mId && mId === riderId.toString().trim()) return true;
        if (riderName && mName && mName === riderName.toString().trim().toLowerCase()) return true;
        return false;
    }) || rosterMembers.find(m => m.status === 'Catering' && m.customerName && (
        m.customerName.toLowerCase().includes(cleanCust) || isCustomerMatch(m.customerName, cleanCust)
    ));

    // Extract this customer's catering start time
    let custStartTime = "";
    if (member?.customerName && member?.startTime) {
        const custs = member.customerName.split(/\s*,\s*/).map(c => c.trim());
        const times = member.startTime.split(/\s*,\s*/).map(t => t.trim());
        const idx = custs.findIndex(c => isCustomerMatch(c, custName) || c.toLowerCase() === cleanCust);
        if (idx !== -1) {
            custStartTime = times[idx] || times[0] || "";
        }
    }

    // 2. Check active customerFees on the rider's roster record
    if (member?.customerFees && typeof member.customerFees === 'object') {
        let activeFeeObj = member.customerFees[cleanCustKey] || member.customerFees[cleanCust];
        if (!activeFeeObj) {
            for (const [k, v] of Object.entries(member.customerFees)) {
                if (isCustomerMatch(k, custName) || (v?.customerName && isCustomerMatch(v.customerName, custName))) {
                    activeFeeObj = v;
                    break;
                }
            }
        }
        if (activeFeeObj && activeFeeObj.transactionId && activeFeeObj.status !== 'voided' && activeFeeObj.voided !== true) {
            const txId = activeFeeObj.transactionId;
            const rc = (globalState.globalDailyReceipts || []).find(r => (r.transactionId || r.id) === txId);
            const isCompleted = rc && (rc.doneTime || rc.completedTime || rc.status === 'completed' || rc.isCompleted === true);
            if (rc && !isCompleted && rc.status !== 'voided' && rc.voided !== true && rc.isVoided !== true) {
                return true;
            }
        }
    }

    // 3. Check for active uncompleted receipt record in globalDailyReceipts
    const completedTxIds = new Set((globalState.globalCateredHistory || []).map(h => (h.transactionId || h.id)));
    const receipts = globalState.globalDailyReceipts || [];
    const hasActiveReceipt = receipts.some(rc => {
        if (!rc) return false;
        if (rc.status === 'voided' || rc.voided === true || rc.isVoided === true) return false;
        if (rc.doneTime || rc.completedTime || rc.status === 'completed' || rc.isCompleted === true) return false;

        const txId = rc.transactionId || rc.id;
        if (txId && completedTxIds.has(txId)) return false; // Already finished past delivery

        const matchRider = isRiderMatch(riderName, rc.riderName, riderId, rc.telegramId);
        const matchCust = isCustomerMatch(rc.customerName, custName) ||
                          (rc.customerName && rc.customerName.trim().toLowerCase() === cleanCust);
        if (!matchCust) return false;
        if (riderName && !matchRider) return false;

        // Verify receipt date is today
        if (rc.date && !isSameDate(rc.date, todayStr)) {
            return false;
        }

        // Verify receipt was created AFTER or within the current ongoing catering session
        if (custStartTime && rc.receiptTime) {
            const rTimeMins = parseTimeToMinutes(rc.receiptTime);
            const sTimeMins = parseTimeToMinutes(custStartTime);
            if (rTimeMins !== null && sTimeMins !== null && rTimeMins < (sTimeMins - 5)) {
                return false;
            }
        }
        return true;
    });
    if (hasActiveReceipt) return true;

    // 4. Specific session key check in localStorage (with exact start time)
    if (custStartTime) {
        const resolvedRiderName = (riderName || member?.riderName || appState.riderName || "").trim().toLowerCase();
        const resolvedOrderDate = resolveOrderDate(custStartTime, todayStr);
        const keyWithTime = `receipt_done_${resolvedRiderName}_${cleanCust}_${custStartTime}_${resolvedOrderDate}`;
        if (localStorage.getItem(keyWithTime) === 'true') {
            return true;
        }
    }

    return false;
}

export async function voidSingleCateringCustomer(targetId, targetName, custNameToVoid) {
    if (!custNameToVoid) return false;

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    const cleanTargetId = (targetId || "").toString().trim();
    const cleanTargetName = (targetName || "").toString().trim().toLowerCase();

    // 1. Authoritative Permission Verification Gate (Admin, Authorized TL, or Self)
    const isMe = (myId && cleanTargetId && myId === cleanTargetId) || (myName && cleanTargetName && myName === cleanTargetName);
    const hasAdminPower = isAdmin() || canManageRoster() || Boolean(globalState.adminControlsEnabled) || (typeof localStorage !== 'undefined' && localStorage.getItem('adminControlsEnabled') === 'true');
    const hasTlVoidPower = hasTlPermission('canVoidCustomer') || hasTlPermission('canVoid') || hasTlPermission('canForceCater');

    if (!isMe && !hasAdminPower && !hasTlVoidPower) {
        showToast("🚫 You do not have permission to void another rider's customer.");
        return false;
    }

    if (!globalState.rosterMembers || globalState.rosterMembers.length === 0) {
        saveRosterCache();
    }
    const rosterMembers = globalState.rosterMembers || [];

    const cleanVoidCust = custNameToVoid.toLowerCase().trim();
    const cleanCustKey = sanitizeFirebaseKey(cleanVoidCust);

    let targetRecord = rosterMembers.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        if (cleanTargetId && mId && mId === cleanTargetId) return true;
        if (cleanTargetName && mName && mName === cleanTargetName) return true;
        return false;
    });

    // Auto-detect rider if targetRecord is missing or does not contain this customer
    if ((!targetRecord || !targetRecord.customerName || (!targetRecord.customerName.toLowerCase().includes(cleanVoidCust) && !isCustomerMatch(targetRecord.customerName, cleanVoidCust))) && cleanVoidCust) {
        const actualRider = rosterMembers.find(m => m.status === 'Catering' && m.customerName && (
            m.customerName.toLowerCase().includes(cleanVoidCust) || isCustomerMatch(m.customerName, cleanVoidCust)
        ));
        if (actualRider) {
            targetRecord = actualRider;
        }
    }

    if (!targetRecord && db && cleanTargetId) {
        try {
            const snap = await db.ref(`roster/${cleanTargetId}`).once('value');
            if (snap.exists()) {
                targetRecord = snap.val();
            }
        } catch(e) {}
    }

    let resolvedTargetId = targetRecord ? (targetRecord.telegramId || targetRecord.id || cleanTargetId) : cleanTargetId;
    let resolvedTargetName = targetRecord ? (targetRecord.riderName || targetRecord.name || targetName) : targetName;

    if (!resolvedTargetId && isMe) {
        resolvedTargetId = myId;
    }
    if (!resolvedTargetId && targetRecord?.key) {
        resolvedTargetId = targetRecord.key;
    }

    if (!resolvedTargetId && !targetRecord) return false;

    // 1B. SAFEGUARD (Ordinary Rider vs Admin/TL):
    if (!hasAdminPower && !hasTlVoidPower) {
        // If the order or chat is already marked as cancelled or done, allow the rider to clear it!
        let isAlreadyCancelled = false;
        if (cleanCustKey) {
            const threadsMap = (typeof window.getCachedCustomerThreadsMap === 'function') ? window.getCachedCustomerThreadsMap() : null;
            if (threadsMap) {
                for (const t of threadsMap.values()) {
                    if (isCustomerMatch(t.customerName, custNameToVoid) || (t.custId && t.custId.toLowerCase().includes(cleanCustKey))) {
                        if (t.status === 'cancelled' || t.status === 'voided' || t.folder === 'done' || t.folder === 'followup') {
                            isAlreadyCancelled = true;
                            break;
                        }
                    }
                }
            }
        }

        if (!isAlreadyCancelled) {
            const hasReceipt = checkCustomerReceiptExists(custNameToVoid, resolvedTargetName, resolvedTargetId);
            if (hasReceipt) {
                showToast("⚠️ Cannot cancel an order that already has a receipt created. Please contact an Admin or Team Lead to void.");
                return false;
            }
        }
    }

    let remainingCusts = [];
    let remainingTimes = [];

    if (targetRecord && targetRecord.customerName) {
        const custs = targetRecord.customerName.split(/\s*,\s*/).map(c => c.trim()).filter(Boolean);
        const times = targetRecord.startTime ? targetRecord.startTime.split(/\s*,\s*/).map(t => t.trim()) : [];

        custs.forEach((c, idx) => {
            const cLower = c.toLowerCase().trim();
            const isMatch = cLower === cleanVoidCust ||
                            isCustomerMatch(c, cleanVoidCust) ||
                            (cleanVoidCust.length >= 3 && cLower.includes(cleanVoidCust)) ||
                            (cLower.length >= 3 && cleanVoidCust.includes(cLower));
            if (!isMatch) {
                remainingCusts.push(c);
                remainingTimes.push(times[idx] || times[0] || "");
            }
        });
    }

    // Purge forced catering metadata
    if (targetRecord && targetRecord.forcedCaters) {
        delete targetRecord.forcedCaters[cleanCustKey];
        delete targetRecord.forcedCaters[cleanVoidCust];
        delete targetRecord.forcedCaters[custNameToVoid];

        if (Object.keys(targetRecord.forcedCaters).length === 0) {
            targetRecord.forcedCaters = null;
            targetRecord.isForcedCater = false;
            targetRecord.forcedBy = null;
        }
    }

    // Purge lingering in-memory fees for the voided customer
    if (targetRecord?.customerFees && cleanCustKey) {
        delete targetRecord.customerFees[cleanCustKey];
    }

    // Explicitly delete forcedCaters and customerFees from Firebase RTDB
    if (db && resolvedTargetId) {
        try {
            if (cleanCustKey) {
                db.ref(`roster/${resolvedTargetId}/customerFees/${cleanCustKey}`).remove().catch(() => {});
                db.ref(`roster/${resolvedTargetId}/forcedCaters/${cleanCustKey}`).remove().catch(() => {});
            }
            if (remainingCusts.length === 0) {
                db.ref(`roster/${resolvedTargetId}/forcedCaters`).remove().catch(() => {});
                db.ref(`roster/${resolvedTargetId}/customerFees`).remove().catch(() => {});
                db.ref(`roster/${resolvedTargetId}/availableLocation`).remove().catch(() => {});
            }
        } catch (dbErr) {
            console.warn("RTDB void cleanup warning:", dbErr);
        }
    }

    // Reset lastReceiptFees if they were set for the voided customer
    if (targetRecord && targetRecord.lastReceiptFees) {
        targetRecord.lastReceiptFees = null;
        targetRecord.lastReceiptTotalFees = 0;
    }

    // Reset wizard state if the voided customer was actively loaded in receipt wizard
    if (wizState && appState.selectedCateringClient && (isCustomerMatch(appState.selectedCateringClient, custNameToVoid) || appState.selectedCateringClient.trim().toLowerCase() === cleanVoidCust)) {
        appState.selectedCateringClient = "";
        wizState.subtotal = 0;
        wizState.currentReceiptTransactionId = "";
        wizState.shortReceiptRef = "";
    }

    // DEEP CART CLEANUP: Purge items, reset receipt summaries, and unlock barrier
    purgeCartSlotForCustomer(custNameToVoid);

    // Purge localStorage receipt completion flags
    try {
        const cleanRiderKey = resolvedTargetName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.includes(cleanCustKey) || k.includes(cleanVoidCust))) {
                if (k.startsWith('receipt_done_')) {
                    keysToRemove.push(k);
                }
            }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch(e) {}

    // 1. PURGE IN-MEMORY RECEIPTS
    if (globalState.globalDailyReceipts) {
        globalState.globalDailyReceipts = globalState.globalDailyReceipts.filter(r => {
            const matchRider = isRiderMatch(resolvedTargetName, r.riderName) || (r.riderId && r.riderId.toString() === resolvedTargetId.toString());
            const matchCust = isCustomerMatch(r.customerName, custNameToVoid) || (r.id && r.id.toLowerCase().includes(cleanCustKey)) || (r.customerName || '').toLowerCase().includes(cleanVoidCust);
            return !(matchRider && matchCust);
        });
    }

    // 2. PURGE IN-MEMORY CATERED HISTORY (COMMISSION SOURCE)
    if (globalState.globalCateredHistory) {
        globalState.globalCateredHistory = globalState.globalCateredHistory.filter(h => {
            const matchRider = isRiderMatch(resolvedTargetName, h.riderName) || (h.riderId && h.riderId.toString() === resolvedTargetId.toString()) || (h.telegramId && h.telegramId.toString() === resolvedTargetId.toString());
            const matchCust = isCustomerMatch(h.customerName, custNameToVoid) || (h.id && h.id.toLowerCase().includes(cleanCustKey)) || (h.customerName || '').toLowerCase().includes(cleanVoidCust);
            return !(matchRider && matchCust);
        });
    }

    // 3. PERSIST PURGED ARRAYS TO LOCAL CACHE & INDEXEDDB
    try {
        idbSet('catered', 'lokalex_catered_idb_cache_v2', globalState.globalCateredHistory || []).catch(() => {});
        idbSet('receipts', 'lokalex_receipts_idb_cache_v2', globalState.globalDailyReceipts || []).catch(() => {});
    } catch(e) {}

    invalidateRosterGrossCache();

    // 4. Update Firebase chat folders, purge receipts & cateredHistory in RTDB
    if (db) {
        const now = Date.now();
        const voidPayload = {
            folder: 'done',
            status: 'cancelled',
            completedAt: now,
            cateredByRiderId: null,
            cateredByRiderName: null,
            cateredBy: null,
            forcedBy: null,
            isForcedCater: false,
            unreadForRider: false,
            lastUpdated: now
        };

        const markChatVoided = (targetChatId) => {
            if (!targetChatId) return;
            try {
                const safeKey = sanitizeFirebaseKey(targetChatId);
                if (safeKey) {
                    db.ref(`customerChats/${safeKey}/metadata`).update(voidPayload).catch(() => {});
                    db.ref(`customerChatMeta/${safeKey}`).update(voidPayload).catch(() => {});
                }
            } catch (_) {}
        };

        // Update customerChats matching cleanCustKey
        if (cleanCustKey) {
            markChatVoided(cleanCustKey);
        }

        // Immediately synchronize in-memory live chat threads and move matching thread to Done/Cancelled
        if (typeof window.getCachedCustomerThreadsMap === 'function') {
            const threadMap = window.getCachedCustomerThreadsMap();
            if (threadMap && threadMap.size > 0) {
                const targetLower = (custNameToVoid || "").trim().toLowerCase();
                for (const [tId, t] of threadMap.entries()) {
                    const chatName = (t.customerName || t.name || "").trim().toLowerCase();
                    const isCustomerNameMatch = chatName && (chatName === targetLower || isCustomerMatch(chatName, targetLower));
                    const isCustIdMatch = cleanCustKey && (tId.toLowerCase().includes(cleanCustKey) || (t.custId && t.custId.toLowerCase().includes(cleanCustKey)));
                    const isRiderMatch = (t.cateredByRiderId && t.cateredByRiderId.toString() === resolvedTargetId.toString()) ||
                                         (t.cateredByRiderName && t.cateredByRiderName.trim().toLowerCase() === resolvedTargetName.trim().toLowerCase());

                    if (isCustomerNameMatch || (isRiderMatch && isCustIdMatch)) {
                        t.folder = 'done';
                        t.status = 'cancelled';
                        t.completedAt = now;
                        t.isUnread = false;
                        t.unreadForRider = false;
                        t.cateredByRiderId = null;
                        t.cateredByRiderName = null;
                        t.cateredBy = null;
                        markChatVoided(tId);
                    }
                }
            }
        }

        if (typeof window.renderRiderCustomerChatFeed === 'function') {
            window.renderRiderCustomerChatFeed();
        }

        // Scan customerChatMeta to cancel any active chat referencing this customer or rider assignment
        db.ref('customerChatMeta').once('value', (snapshot) => {
            const chats = snapshot.val() || {};
            const targetLower = (custNameToVoid || "").trim().toLowerCase();
            Object.keys(chats).forEach(custId => {
                const meta = chats[custId]?.metadata || chats[custId] || {};
                // If chat is already done, completed, or voided, do not mutate it or update its timestamp
                if (meta.folder === 'done' || meta.status === 'completed' || meta.status === 'voided') return;

                const chatCustName = (meta.customerName || meta.name || "").trim().toLowerCase();
                const isRiderMatch = (meta.cateredByRiderId && meta.cateredByRiderId.toString() === resolvedTargetId.toString()) ||
                                     (meta.cateredByRiderName && meta.cateredByRiderName.trim().toLowerCase() === resolvedTargetName.trim().toLowerCase());

                if (chatCustName && (chatCustName === targetLower || isCustomerMatch(chatCustName, targetLower))) {
                    markChatVoided(custId);
                } else if (isRiderMatch && (cleanCustKey && custId.includes(cleanCustKey))) {
                    markChatVoided(custId);
                }
            });
        }).catch(() => {});

        const todayStr = getLocalTodayStr();
        // Purge matching receipts from Firebase receipts node
        db.ref('receipts').orderByChild('date').equalTo(todayStr).once('value', (snap) => {
            const rcpts = snap.val() || {};
            Object.entries(rcpts).forEach(([rId, r]) => {
                const matchRider = isRiderMatch(resolvedTargetName, r.riderName) || (r.riderId && r.riderId.toString() === resolvedTargetId.toString());
                const matchCust = isCustomerMatch(r.customerName, custNameToVoid) || (rId && rId.toLowerCase().includes(cleanCustKey)) || (r.customerName || '').toLowerCase().includes(cleanVoidCust);
                if (matchRider && matchCust) {
                    // 1. Tombstone first so all connected clients immediately zero out fees
                    db.ref(`receipts/${rId}`).update({ status: 'voided', voided: true, isVoided: true, totalFees: 0 }).catch(() => {});
                    setTimeout(() => {
                        db.ref(`receipts/${rId}`).remove().catch(() => {});
                    }, 1200);
                }
            });
        }).catch(() => {});

        // Purge matching entries from Firebase cateredHistory node
        ['completedDate', 'date'].forEach(dateField => {
            db.ref('cateredHistory').orderByChild(dateField).equalTo(todayStr).once('value', (snap) => {
                const hist = snap.val() || {};
                Object.entries(hist).forEach(([hId, h]) => {
                    const matchRider = isRiderMatch(resolvedTargetName, h.riderName) || (h.riderId && h.riderId.toString() === resolvedTargetId.toString()) || (h.telegramId && h.telegramId.toString() === resolvedTargetId.toString());
                    const matchCust = isCustomerMatch(h.customerName, custNameToVoid) || (hId && hId.toLowerCase().includes(cleanCustKey)) || (h.customerName || '').toLowerCase().includes(cleanVoidCust);
                    if (matchRider && matchCust) {
                        // 1. Tombstone first so all connected clients immediately zero out fees
                        db.ref(`cateredHistory/${hId}`).update({ status: 'voided', voided: true, isVoided: true, totalFees: 0 }).catch(() => {});
                        setTimeout(() => {
                            db.ref(`cateredHistory/${hId}`).remove().catch(() => {});
                        }, 1200);
                    }
                });
            }).catch(() => {});
        });
    }

    // 5. ATOMIC STATUS MUTATION (Zero unbundled preliminary writes - completely prevents rubber banding)
    const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const voidTimestamp = Date.now();

    if (remainingCusts.length > 0) {
        await updateRosterStatusData(
            'Catering', 
            remainingCusts.join(', '), 
            remainingTimes.join(', '), 
            targetRecord ? parseQueueTime(targetRecord.queueTime) : Date.now(), 
            resolvedTargetId, 
            resolvedTargetName,
            [],
            false,
            "",
            { 
                forcedCaters: targetRecord?.forcedCaters || null,
                forcedBy: targetRecord?.forcedBy || null,
                isForcedCater: !!(targetRecord && targetRecord.isForcedCater),
                customerFees: targetRecord?.customerFees || null,
                lastReceiptFees: null,
                lastReceiptTotalFees: 0,
                lastVoidedAt: voidTimestamp,
                lastVoidedCust: custNameToVoid
            }
        );
        showToast(`🚫 Order voided for [${custNameToVoid}]. ${remainingCusts.length} active customer(s) remaining for ${resolvedTargetName}.`);
        showSideNotification("ORDER VOIDED", `${custNameToVoid} was cancelled`, "fa-ban", "text-red-400", "border-red-500");
    } else {
        const topQueueTime = getTopQueueTime();
        const availableTimestamp = Date.now();
        const availableTimeStr = nowTimeStr;

        if (targetRecord) {
            targetRecord.forcedCaters = null;
            targetRecord.forcedBy = null;
            targetRecord.isForcedCater = false;
            targetRecord.customerFees = null;
            targetRecord.lastReceiptFees = null;
            targetRecord.lastReceiptTotalFees = 0;
            targetRecord.availableTimestamp = availableTimestamp;
            targetRecord.availableTimeStr = availableTimeStr;
            targetRecord.queueTime = availableTimestamp;
            targetRecord.lastVoidedAt = voidTimestamp;
            targetRecord.lastVoidedCust = custNameToVoid;
        }

        await updateRosterStatusData(
            'Available', 
            '', 
            '', 
            topQueueTime, 
            resolvedTargetId, 
            resolvedTargetName, 
            [],
            false,
            "",
            { 
                forcedCaters: null,
                forcedBy: null,
                isForcedCater: false,
                customerFees: null,
                lastReceiptFees: null,
                lastReceiptTotalFees: 0,
                availableTimestamp: availableTimestamp,
                availableTimeStr: availableTimeStr,
                lastVoidedAt: voidTimestamp,
                lastVoidedCust: custNameToVoid
            }
        );
        showToast(`🚫 Order voided for [${custNameToVoid}]. [${resolvedTargetName}] moved to the Available queue!`);
        showSideNotification("ROTATION UPDATED", `${resolvedTargetName} is now Available`, "fa-motorcycle", "text-blue-400", "border-blue-500");
    }

    saveRosterCache();
    window.dispatchEvent(new CustomEvent('cateredUpdated'));
    window.dispatchEvent(new CustomEvent('receiptsUpdated'));
    window.dispatchEvent(new CustomEvent('rosterUpdated'));
    updateRosterUI();

    if (typeof window.refreshCommissionView === 'function') {
        window.refreshCommissionView();
    }
    if (typeof window.loadGlobalCateredList === 'function') {
        window.loadGlobalCateredList();
    }
}

export function adminVoidSpecificCustomer(targetId, targetName, custName) {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();
    const cleanTargetId = (targetId || "").toString().trim();
    const cleanTargetName = (targetName || "").toString().trim().toLowerCase();
    const isMe = (myId && cleanTargetId && myId === cleanTargetId) || (myName && cleanTargetName && myName === cleanTargetName);

    const hasAdminPower = isAdmin() || canManageRoster() || Boolean(globalState.adminControlsEnabled) || (typeof localStorage !== 'undefined' && localStorage.getItem('adminControlsEnabled') === 'true');
    const hasTlVoidPower = hasTlPermission('canVoidCustomer') || hasTlPermission('canVoid') || hasTlPermission('canForceCater');

    if (!isMe && !hasAdminPower && !hasTlVoidPower) {
        return showToast("🚫 Access Denied: Admin or Team Lead authorization required.");
    }

    if (!custName) return showToast("⚠️ Missing customer name to void.");

    openSlideDeleteModal(
        `Void Order: ${custName}?`,
        `Are you sure you want to void the delivery for ${custName} assigned to ${targetName || 'Rider'}?\nThis will cancel the order and update their rotation.`,
        async () => {
            await voidSingleCateringCustomer(targetId, targetName, custName);
        }
    );
}

if (typeof window !== 'undefined') {
    window.completeSingleCateringCustomer = completeSingleCateringCustomer;
    window.voidSingleCateringCustomer = voidSingleCateringCustomer;
    window.adminVoidSpecificCustomer = adminVoidSpecificCustomer;
    window.checkCustomerReceiptExists = checkCustomerReceiptExists;
}