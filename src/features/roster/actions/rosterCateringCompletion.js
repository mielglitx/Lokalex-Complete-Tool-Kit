// src/features/roster/actions/rosterCateringCompletion.js

/**
 * ============================================================================
<<<<<<< HEAD
 * ROSTER CATERING COMPLETION & VOID ACTION HANDLERS
 * ============================================================================
 * 
 * Manages the lifecycle of active catering deliveries per rider:
 * - Receipt verification before allowing delivery completion.
 * - Crediting rider fees and archiving to cateredHistory.
 * - Voiding active customer assignments with state cleanup across roster,
 *   customerFees, multiCarts, and chat metadata.
 * 
 * Update Note:
 * - Enhanced voidSingleCateringCustomer to scrub multiCarts and localStorage
 *   markers to prevent voided customer names from appearing on new receipts.
=======
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
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
 * ============================================================================
 */

import { db } from '../../../config/firebase.js';
import { appState, globalState, multiCarts, activeCartSlot } from '../../../store/state.js';
import { showToast, showSideNotification } from '../../../ui/notifications.js';
import { switchView } from '../../../ui/router.js';
import { openSlideDeleteModal } from '../../../ui/modals.js';
import { endLiveGpsSession } from '../../liveTracker.js';
import { getLocalTodayStr } from '../../../utils/helpers.js';
import { 
    parseQueueTime, 
    hasReceiptForActiveSession, 
    parseItemGross, 
    calculateSplitDuration, 
    isRiderMatch, 
    isCustomerMatch, 
    isSameDateStr, 
    saveRosterCache,
    isAdmin,
    canManageRoster,
    hasTlPermission
} from '../rosterUtils.js';
import { updateRosterUI } from '../rosterUI.js';
import { updateRosterStatusData } from '../rosterStatusCore.js';
import { getTopQueueTime } from './rosterAlarms.js';

function getDeviceLocationQuick() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            return resolve({
                lat: appState.lat || null,
                lon: appState.lon || null,
                accuracy: appState.gpsAccuracy || null
            });
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                resolve({
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                });
            },
            () => {
                resolve({
                    lat: appState.lat || null,
                    lon: appState.lon || null,
                    accuracy: appState.gpsAccuracy || null
                });
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 }
        );
    });
}

<<<<<<< HEAD
=======
/**
 * Deeply resets a cart slot across all memory arrays and unlocks barrier states.
 */
function purgeCartSlotForCustomer(customerName) {
    if (!customerName || !multiCarts) return;
    const cleanTarget = customerName.trim().toLowerCase();

    Object.keys(multiCarts).forEach(slotKey => {
        const cart = multiCarts[slotKey];
        if (cart && cart.customerName) {
            const currentCust = cart.customerName.trim().toLowerCase();
            if (currentCust === cleanTarget) {
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

    if (appState.selectedCateringClient && appState.selectedCateringClient.trim().toLowerCase() === cleanTarget) {
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

>>>>>>> 2dcde05 (Update Lokalex features from new PC)
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

    const resolvedTargetId = targetRecord ? (targetRecord.telegramId || targetRecord.id || cleanTargetId) : cleanTargetId;
    const resolvedTargetName = targetRecord ? (targetRecord.riderName || targetRecord.name || targetName) : targetName;

    if (!resolvedTargetId && !targetRecord) return;

    let remainingCusts = [];
    let remainingTimes = [];
    let completedStartTime = "";

    if (targetRecord && targetRecord.customerName) {
        const custs = targetRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
        const times = targetRecord.startTime ? targetRecord.startTime.split(', ').map(t => t.trim()) : [];

        custs.forEach((c, idx) => {
            if (c.toLowerCase().trim() !== custNameToComplete.toLowerCase().trim()) {
                remainingCusts.push(c);
                remainingTimes.push(times[idx] || times[0] || "");
            } else {
                completedStartTime = times[idx] || times[0] || "";
            }
        });
    }

    const cleanCust = custNameToComplete.toLowerCase().trim();
    const cleanCustKey = cleanCust.replace(/[^a-z0-9]/g, '');
    const todayStr = getLocalTodayStr();
    const todayClean = todayStr.replace(/-/g, '');
    const endTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

<<<<<<< HEAD
    // 1. Receipt Verification Gate & Milestone Extraction
=======
    // 1. Receipt Verification Gate
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
    let receiptTimeFound = "";
    if (targetRecord?.customerFees && cleanCustKey && targetRecord.customerFees[cleanCustKey]?.receiptTime) {
        receiptTimeFound = targetRecord.customerFees[cleanCustKey].receiptTime;
    }

    const matchReceipt = (globalState.globalDailyReceipts || []).find(rc => {
        const rMatch = isRiderMatch(resolvedTargetName, rc.riderName, resolvedTargetId, rc.telegramId);
        const cMatch = isCustomerMatch(rc.customerName, custNameToComplete);
        const dMatch = isSameDateStr(rc.date || rc.completedDate, todayStr);
        return rMatch && cMatch && dMatch;
    });

    if (!receiptTimeFound && matchReceipt) {
        receiptTimeFound = matchReceipt.receiptTime || matchReceipt.completedTime || "";
    }

    const hasReceipt = hasReceiptForActiveSession(custNameToComplete, completedStartTime) ||
        (targetRecord?.customerFees && cleanCustKey && !!targetRecord.customerFees[cleanCustKey]) ||
        !!matchReceipt;

    if (!hasReceipt) {
        showToast(`⚠️ Paki-gawaan muna ng resibo si ${custNameToComplete} bago i-mark as Done!`);
        const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
        if (resolvedTargetId === myId && multiCarts && activeCartSlot) {
            multiCarts[activeCartSlot].customerName = custNameToComplete;
            multiCarts[activeCartSlot].isManual = false;
            if (window.saveCartState) window.saveCartState();
            switchView('view-cart');
        }
        return;
    }

<<<<<<< HEAD
    // 2. Extract Strict Rider Service Fees (Delivery + Handling + Market + Multi-Stop)
=======
    // 2. Extract Service Fees
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
    const cleanRiderKey = resolvedTargetName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanTimeKey = completedStartTime.replace(/[^a-z0-9]/gi, '');
    let targetTxId = `RCPT_${cleanRiderKey}_${cleanCustKey}_${todayClean}_${cleanTimeKey || '1'}`;
    let finalFees = 0;
    let finalFeeDetails = null;

    if (targetRecord?.customerFees && cleanCustKey && targetRecord.customerFees[cleanCustKey]) {
        const cFeeObj = targetRecord.customerFees[cleanCustKey];
        finalFeeDetails = cFeeObj.fees || null;
        if (cFeeObj.totalFees !== undefined && cFeeObj.totalFees !== null) {
            finalFees = parseFloat(cFeeObj.totalFees) || 0;
        }
        if (cFeeObj.transactionId) {
            targetTxId = cFeeObj.transactionId;
        }
    }

    if (finalFees <= 0 && matchReceipt) {
        finalFeeDetails = matchReceipt.fees || null;
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

    const splitDuration = calculateSplitDuration(completedStartTime, endTimeStr, 1);

<<<<<<< HEAD
    // 3. Log Completed Order with 3-Stage Milestones (Started, Receipt Created, Marked Done)
=======
    // 3. Log Completed Order
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
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
        db.ref(`receipts/${targetTxId}`).update({
            doneTime: endTimeStr,
            completedTime: endTimeStr
        }).catch(() => {});

        db.ref('customerChats')
            .orderByChild('metadata/customerName')
            .equalTo(custNameToComplete)
            .once('value', (snapshot) => {
                const chats = snapshot.val() || {};
                Object.keys(chats).forEach(custId => {
                    db.ref(`customerChats/${custId}/metadata`).update({
                        folder: 'done',
                        status: 'completed',
                        completedAt: Date.now(),
                        lastUpdated: Date.now()
                    });
                });
            });

        if (resolvedTargetId && cleanCustKey) {
            db.ref(`roster/${resolvedTargetId}/customerFees/${cleanCustKey}`).remove().catch(() => {});
            db.ref(`roster/${resolvedTargetId}/forcedCaters/${cleanCustKey}`).remove().catch(() => {});
            db.ref(`roster/${resolvedTargetId}/forcedCaters/${cleanCust}`).remove().catch(() => {});
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

<<<<<<< HEAD
    // Clean up active cart slot if it belonged to this customer
    if (multiCarts) {
        Object.keys(multiCarts).forEach(slotKey => {
            if (multiCarts[slotKey] && multiCarts[slotKey].customerName) {
                if (multiCarts[slotKey].customerName.trim().toLowerCase() === cleanCust) {
                    multiCarts[slotKey].customerName = "";
                    multiCarts[slotKey].isManual = false;
                }
            }
        });
        if (typeof window.saveCartState === 'function') window.saveCartState();
    }
    if (appState.selectedCateringClient && appState.selectedCateringClient.trim().toLowerCase() === cleanCust) {
        appState.selectedCateringClient = "";
    }

    // 4. Update Status (Remaining vs Available)
=======
    // DEEP CART CLEANUP: Purge items, reset receipt summaries, and unlock barrier
    purgeCartSlotForCustomer(custNameToComplete);

    // 4. Update Rotation State
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
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

        let locationData = null;
        if (resolvedTargetId === myId) {
            locationData = await getDeviceLocationQuick();
            if (locationData && locationData.lat) {
                appState.lat = locationData.lat;
                appState.lon = locationData.lon;
                appState.gpsAccuracy = locationData.accuracy;
            }
            endLiveGpsSession();
        }

        const availableTimestamp = Date.now();
        const availableTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (db && resolvedTargetId) {
            db.ref(`roster/${resolvedTargetId}/forcedCaters`).remove().catch(() => {});
            db.ref(`roster/${resolvedTargetId}/customerFees`).remove().catch(() => {});
            const updatePayload = {
                forcedBy: null,
                isForcedCater: false,
                availableTimestamp: availableTimestamp,
<<<<<<< HEAD
                availableTimeStr: availableTimeStr
=======
                availableTimeStr: availableTimeStr,
                queueTime: availableTimestamp
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
            };
            if (locationData) {
                updatePayload.availableLocation = locationData;
            }
            db.ref(`roster/${resolvedTargetId}`).update(updatePayload).catch(() => {});
        }
        if (targetRecord) {
            targetRecord.forcedCaters = null;
            targetRecord.forcedBy = null;
            targetRecord.isForcedCater = false;
            targetRecord.customerFees = null;
            targetRecord.availableTimestamp = availableTimestamp;
            targetRecord.availableTimeStr = availableTimeStr;
<<<<<<< HEAD
=======
            targetRecord.queueTime = availableTimestamp;
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
            if (locationData) {
                targetRecord.availableLocation = locationData;
            }
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
<<<<<<< HEAD
                isForcedCater: false
=======
                isForcedCater: false,
                availableTimestamp: availableTimestamp,
                availableTimeStr: availableTimeStr
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
            }
        );
        showToast(`🎉 All deliveries completed! [${resolvedTargetName}] is now Available (₱${finalFees.toFixed(2)} credited).`);
        showSideNotification("ROTATION UPDATED", `${resolvedTargetName} is now Available`, "fa-motorcycle", "text-blue-400", "border-blue-500");
    }

    saveRosterCache();
    window.dispatchEvent(new CustomEvent('cateredUpdated'));
    window.dispatchEvent(new CustomEvent('receiptsUpdated'));
    window.dispatchEvent(new CustomEvent('rosterUpdated'));
    updateRosterUI();
}

export async function voidSingleCateringCustomer(targetId, targetName, custNameToVoid) {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    const cleanTargetId = (targetId || "").toString().trim();
    const cleanTargetName = (targetName || "").toString().trim().toLowerCase();

<<<<<<< HEAD
    // 1. Authoritative Permission Verification Gate (Admin, Authorized TL, or Self)
=======
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
    const isMe = (myId && cleanTargetId && myId === cleanTargetId) || (myName && cleanTargetName && myName === cleanTargetName);
    const hasAdminPower = isAdmin();
    const hasTlVoidPower = hasTlPermission('canVoidCustomer') || hasTlPermission('canVoid') || hasTlPermission('canForceCater') || canManageRoster();

    if (!isMe && !hasAdminPower && !hasTlVoidPower) {
        showToast("🚫 Wala kang pahintulot na mag-void ng customer ng ibang rider.");
        return;
    }

    const rosterMembers = globalState.rosterMembers || [];

    let targetRecord = rosterMembers.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        if (cleanTargetId && mId && mId === cleanTargetId) return true;
        if (cleanTargetName && mName && mName === cleanTargetName) return true;
        return false;
    });

    const resolvedTargetId = targetRecord ? (targetRecord.telegramId || targetRecord.id || cleanTargetId) : cleanTargetId;
    const resolvedTargetName = targetRecord ? (targetRecord.riderName || targetRecord.name || targetName) : targetName;

    if (!resolvedTargetId && !targetRecord) return;

    let remainingCusts = [];
    let remainingTimes = [];

    if (targetRecord && targetRecord.customerName) {
        const custs = targetRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
        const times = targetRecord.startTime ? targetRecord.startTime.split(', ').map(t => t.trim()) : [];

        custs.forEach((c, idx) => {
            if (c.toLowerCase().trim() !== custNameToVoid.toLowerCase().trim()) {
                remainingCusts.push(c);
                remainingTimes.push(times[idx] || times[0] || "");
            }
        });
    }

    const cleanVoidCust = custNameToVoid.toLowerCase().trim();
    const cleanCustKey = cleanVoidCust.replace(/[^a-z0-9]/g, '');

<<<<<<< HEAD
    // Purge forced catering metadata
=======
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
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

<<<<<<< HEAD
    // Purge lingering in-memory fees for the voided customer
=======
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
    if (targetRecord?.customerFees && cleanCustKey) {
        delete targetRecord.customerFees[cleanCustKey];
    }

<<<<<<< HEAD
    // Purge from active cart slots and selected client state
    if (multiCarts) {
        Object.keys(multiCarts).forEach(slotKey => {
            if (multiCarts[slotKey] && multiCarts[slotKey].customerName) {
                if (multiCarts[slotKey].customerName.trim().toLowerCase() === cleanVoidCust) {
                    multiCarts[slotKey].customerName = "";
                    multiCarts[slotKey].isManual = false;
                }
            }
        });
        if (typeof window.saveCartState === 'function') window.saveCartState();
    }

    if (appState.selectedCateringClient && appState.selectedCateringClient.trim().toLowerCase() === cleanVoidCust) {
        appState.selectedCateringClient = "";
    }

    // Purge localStorage receipt session completion keys
=======
    // DEEP CART CLEANUP: Purge items, reset receipt summaries, and unlock barrier
    purgeCartSlotForCustomer(custNameToVoid);

    // Purge localStorage receipt completion flags
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
    try {
        const cleanRiderKey = resolvedTargetName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.includes(`receipt_done_${cleanRiderKey}_${cleanCustKey}`) || k.includes(`receipt_done_${cleanRiderKey}_${cleanVoidCust}`))) {
                keysToRemove.push(k);
            }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch(e) {}

<<<<<<< HEAD
    // Update Firebase chat folders and clear fees
=======
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
    if (db) {
        db.ref('customerChats')
            .orderByChild('metadata/customerName')
            .equalTo(custNameToVoid)
            .once('value', (snapshot) => {
                const chats = snapshot.val() || {};
                Object.keys(chats).forEach(custId => {
                    db.ref(`customerChats/${custId}/metadata`).update({
                        folder: 'done',
                        status: 'cancelled',
                        cateredByRiderId: null,
                        cateredByRiderName: null,
                        cateredBy: null,
                        forcedBy: null,
                        isForcedCater: false,
                        lastUpdated: Date.now()
                    });
                });
            });

        if (resolvedTargetId && cleanCustKey) {
            db.ref(`roster/${resolvedTargetId}/customerFees/${cleanCustKey}`).remove().catch(() => {});
            db.ref(`roster/${resolvedTargetId}/forcedCaters/${cleanCustKey}`).remove().catch(() => {});
            db.ref(`roster/${resolvedTargetId}/forcedCaters/${cleanVoidCust}`).remove().catch(() => {});
        }
    }

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
        showToast(`🚫 Na-void si [${custNameToVoid}]. ${remainingCusts.length} active customer(s) natitira kay ${resolvedTargetName}.`);
        showSideNotification("ORDER VOIDED", `${custNameToVoid} was cancelled`, "fa-ban", "text-red-400", "border-red-500");
    } else {
        const topQueueTime = getTopQueueTime();
<<<<<<< HEAD
=======
        const availableTimestamp = Date.now();
        const availableTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

>>>>>>> 2dcde05 (Update Lokalex features from new PC)
        if (db && resolvedTargetId) {
            db.ref(`roster/${resolvedTargetId}/forcedCaters`).remove().catch(() => {});
            db.ref(`roster/${resolvedTargetId}/customerFees`).remove().catch(() => {});
            db.ref(`roster/${resolvedTargetId}`).update({
                forcedBy: null,
<<<<<<< HEAD
                isForcedCater: false
=======
                isForcedCater: false,
                availableTimestamp: availableTimestamp,
                availableTimeStr: availableTimeStr,
                queueTime: availableTimestamp
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
            }).catch(() => {});
        }
        if (targetRecord) {
            targetRecord.forcedCaters = null;
            targetRecord.forcedBy = null;
            targetRecord.isForcedCater = false;
            targetRecord.customerFees = null;
<<<<<<< HEAD
=======
            targetRecord.availableTimestamp = availableTimestamp;
            targetRecord.availableTimeStr = availableTimeStr;
            targetRecord.queueTime = availableTimestamp;
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
        }

        if (resolvedTargetId === myId) {
            endLiveGpsSession();
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
<<<<<<< HEAD
                isForcedCater: false
=======
                isForcedCater: false,
                availableTimestamp: availableTimestamp,
                availableTimeStr: availableTimeStr
>>>>>>> 2dcde05 (Update Lokalex features from new PC)
            }
        );
        showToast(`🚫 Na-void si [${custNameToVoid}]. Inilipat si [${resolvedTargetName}] sa Available queue!`);
        showSideNotification("ROTATION UPDATED", `${resolvedTargetName} is now Available`, "fa-motorcycle", "text-blue-400", "border-blue-500");
    }

    saveRosterCache();
    window.dispatchEvent(new CustomEvent('cateredUpdated'));
    window.dispatchEvent(new CustomEvent('receiptsUpdated'));
    window.dispatchEvent(new CustomEvent('rosterUpdated'));
    updateRosterUI();
}

export function adminVoidSpecificCustomer(targetId, targetName, custName) {
    if (!isAdmin() && !hasTlPermission('canVoidCustomer') && !hasTlPermission('canVoid') && !canManageRoster()) {
        return showToast("🚫 Access Denied: Admin or Team Lead authorization required.");
    }

    openSlideDeleteModal(
        `Void Order: ${custName}?`,
        `Sigurado ka bang nais mong i-void ang delivery ni ${custName} para kay ${targetName}?\nIto ay magkakansela sa order at mag-a-update sa kanyang rotation.`,
        () => {
            voidSingleCateringCustomer(targetId, targetName, custName);
        }
    );
}

if (typeof window !== 'undefined') {
    window.completeSingleCateringCustomer = completeSingleCateringCustomer;
    window.voidSingleCateringCustomer = voidSingleCateringCustomer;
    window.adminVoidSpecificCustomer = adminVoidSpecificCustomer;
}