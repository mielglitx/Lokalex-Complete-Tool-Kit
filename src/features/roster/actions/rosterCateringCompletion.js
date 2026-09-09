// src/features/roster/actions/rosterCateringCompletion.js
import { db } from '../../../config/firebase.js';
import { appState, globalState, multiCarts, activeCartSlot } from '../../../store/state.js';
import { showToast, showSideNotification } from '../../../ui/notifications.js';
import { switchView } from '../../../ui/router.js';
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
    saveRosterCache 
} from '../rosterUtils.js';
import { updateRosterUI } from '../rosterUI.js';
import { updateRosterStatusData } from '../rosterStatusCore.js';
import { getTopQueueTime } from './rosterAlarms.js';

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

    // 1. Receipt Verification Gate
    const hasReceipt = hasReceiptForActiveSession(custNameToComplete, completedStartTime) ||
        (targetRecord?.customerFees && cleanCustKey && !!targetRecord.customerFees[cleanCustKey]) ||
        (globalState.globalDailyReceipts || []).some(rc => {
            const rMatch = isRiderMatch(resolvedTargetName, rc.riderName, resolvedTargetId, rc.telegramId);
            const cMatch = isCustomerMatch(rc.customerName, custNameToComplete);
            const dMatch = isSameDateStr(rc.date || rc.completedDate, todayStr);
            return rMatch && cMatch && dMatch;
        });

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

    // 2. Extract Strict Rider Service Fees (Delivery + Handling + Market + Multi-Stop)
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

    if (finalFees <= 0 && globalState.globalDailyReceipts) {
        const matchReceipt = globalState.globalDailyReceipts.find(rc => {
            const rMatch = isRiderMatch(resolvedTargetName, rc.riderName, resolvedTargetId, rc.telegramId);
            const cMatch = isCustomerMatch(rc.customerName, custNameToComplete);
            const dMatch = isSameDateStr(rc.date || rc.completedDate, todayStr);
            return rMatch && cMatch && dMatch;
        });

        if (matchReceipt) {
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
    }

    const splitDuration = calculateSplitDuration(completedStartTime, endTimeStr, 1);

    // 3. Log Completed Order to Catered List
    const hItem = {
        id: targetTxId,
        transactionId: targetTxId,
        riderName: resolvedTargetName,
        name: resolvedTargetName,
        telegramId: resolvedTargetId,
        customerName: custNameToComplete,
        startTime: completedStartTime || endTimeStr,
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

        db.ref('customerChats').once('value', (snapshot) => {
            const chats = snapshot.val() || {};
            Object.keys(chats).forEach(custId => {
                const meta = chats[custId]?.metadata || chats[custId] || {};
                const chatCustName = (meta.customerName || meta.name || "").toLowerCase().trim();
                if (chatCustName && chatCustName === cleanCust) {
                    db.ref(`customerChats/${custId}/metadata`).update({
                        folder: 'done',
                        status: 'completed',
                        completedAt: Date.now(),
                        lastUpdated: Date.now()
                    });
                }
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

    // 4. Update Status (Remaining vs Available)
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
        if (db && resolvedTargetId) {
            db.ref(`roster/${resolvedTargetId}/forcedCaters`).remove().catch(() => {});
            db.ref(`roster/${resolvedTargetId}`).update({
                forcedBy: null,
                isForcedCater: false
            }).catch(() => {});
        }
        if (targetRecord) {
            targetRecord.forcedCaters = null;
            targetRecord.forcedBy = null;
            targetRecord.isForcedCater = false;
        }

        const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString();
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
                isForcedCater: false
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

    if (db) {
        db.ref('customerChats').once('value', (snapshot) => {
            const chats = snapshot.val() || {};
            Object.keys(chats).forEach(custId => {
                const meta = chats[custId]?.metadata || chats[custId] || {};
                const chatCustName = (meta.customerName || meta.name || "").toLowerCase().trim();
                if (chatCustName && chatCustName === cleanVoidCust) {
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
                }
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
        showToast(`🚫 Voided [${custNameToVoid}]. ${remainingCusts.length} active customer(s) remaining.`);
    } else {
        const topQueueTime = getTopQueueTime();
        if (db && resolvedTargetId) {
            db.ref(`roster/${resolvedTargetId}/forcedCaters`).remove().catch(() => {});
            db.ref(`roster/${resolvedTargetId}`).update({
                forcedBy: null,
                isForcedCater: false
            }).catch(() => {});
        }
        if (targetRecord) {
            targetRecord.forcedCaters = null;
            targetRecord.forcedBy = null;
            targetRecord.isForcedCater = false;
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
                isForcedCater: false
            }
        );
        showToast(`🚫 Voided [${custNameToVoid}]. Moved to Available queue!`);
    }
}