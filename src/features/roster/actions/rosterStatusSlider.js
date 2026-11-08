// src/features/roster/actions/rosterStatusSlider.js

/**
 * ============================================================================
 * ROSTER STATUS SLIDER & EARLY SHIFT PENALTY ENGINE (CUSTOM HOURS & EXEMPTIONS)
 * ============================================================================
 * 
 * Description:
 * Controls rider status transitions initiated by the rider UI dock:
 * - Available: Handles shift time-in restrictions, single-shot silent GPS
 *   calibration, queue time anchoring, and live tracking session termination.
 * - Queue Preservation: Safeguards riders who are already Available from losing
 *   their position or restarting their cooldown when tapping Available again.
 * - End Shift: Evaluates shift duration against rider-specific daily targets
 *   (or global 8h default) minus consumed break time.
 * ============================================================================
 */

import { db } from '../../../config/firebase.js';
import { appState, globalState, multiCarts, activeCartSlot } from '../../../store/state.js';
import { showToast, showSideNotification } from '../../../ui/notifications.js';
import { openSlideDeleteModal, openRiderPasswordSetupModal } from '../../../ui/modals.js';
import { switchView } from '../../../ui/router.js';
import { getLocalTodayStr } from '../../../utils/helpers.js';
import { 
    parseQueueTime, 
    getActiveCateringCustomersWithTimes, 
    hasReceiptForActiveSession,
    parseTimeToMinutes,
    isSameDateStr 
} from '../rosterUtils.js';
import { checkRiderTimeInAllowed } from '../rosterStatusLimits.js';
import { updateRosterStatus, clockOutRider } from '../rosterStatusCore.js';
import { dismissQueueAlarm } from './rosterAlarms.js';
import { completeSingleCateringCustomer } from './rosterCateringCompletion.js';
import { openRiderBreakModal } from '../rosterBreakSettings.js';



export function setStatusActionSyncingState(statusName, isSyncing, customLabel = null) {
    const statusMap = {
        'Available': ['modern-btn-status-avail', 'btn-status-avail'],
        'Catering': ['modern-btn-status-cater', 'btn-status-cater'],
        'Break': ['modern-btn-status-break', 'btn-status-break'],
        'End': ['modern-btn-status-end', 'btn-status-end']
    };

    const targetIds = statusMap[statusName] || [];
    targetIds.forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;

        if (isSyncing) {
            if (!btn._originalHtml) btn._originalHtml = btn.innerHTML;
            btn.setAttribute('data-syncing', 'true');
            btn.disabled = true;
            btn.style.opacity = '0.75';
            btn.style.cursor = 'wait';
            btn.innerHTML = `<span class="inline-block animate-spin mr-1 text-[10px]">⏳</span><span>${customLabel || 'Syncing...'}</span>`;
        } else {
            btn.disabled = false;
            btn.removeAttribute('data-syncing');
            btn.style.opacity = '';
            btn.style.cursor = '';
            if (btn._originalHtml) {
                btn.innerHTML = btn._originalHtml;
                delete btn._originalHtml;
            }
        }
    });

    const allIds = [
        'modern-btn-status-avail', 'modern-btn-status-cater', 'modern-btn-status-break', 'modern-btn-status-end',
        'btn-status-avail', 'btn-status-cater', 'btn-status-break', 'btn-status-end'
    ];
    allIds.forEach(id => {
        if (!targetIds.includes(id)) {
            const peerBtn = document.getElementById(id);
            if (peerBtn && !peerBtn.hasAttribute('data-syncing')) {
                peerBtn.disabled = isSyncing;
                peerBtn.style.pointerEvents = isSyncing ? 'none' : '';
                peerBtn.style.opacity = isSyncing ? '0.5' : '';
            }
        }
    });
}

/**
 * Evaluates whether the rider has fulfilled their required shift duration.
 */
async function evaluateEarlyShiftPenalty(riderId, myRecord = null) {
    const config = globalState.earlyShiftPenaltyConfig || {
        enabled: true,
        targetHours: 8,
        penaltyPerMissingHour: 2.5,
        capEnabled: true,
        maxPenaltyPercentage: 10,
        gracePeriodMinutes: 15,
        riderTargets: {},
        exemptions: {}
    };

    if (!config.enabled) {
        return { hasPenalty: false, netWorkedMins: 0, deficitHours: 0, penaltyPercent: 0 };
    }

    const todayStr = getLocalTodayStr();

    const exemption = config.exemptions && config.exemptions[riderId];
    if (exemption && isSameDateStr(exemption.date, todayStr)) {
        return { 
            hasPenalty: false, 
            isExempted: true, 
            netWorkedMins: 0, 
            totalBreakMins: 0, 
            deficitHours: 0, 
            penaltyPercent: 0 
        };
    }

    let loginTimestamp = null;
    let loginTimeStr = "";
    let totalBreakMins = 0;

    if (db && riderId) {
        try {
            const loginSnap = await db.ref(`logins/${riderId}`).once('value');
            const data = loginSnap.val();
            if (data && (data.date === todayStr || !data.date)) {
                loginTimeStr = data.firstLoginTime || data.loginTime || "";
                if (data.firstLoginTimestamp || data.loginTimestamp) {
                    loginTimestamp = data.firstLoginTimestamp || data.loginTimestamp;
                }
                if (data.totalBreakMinutes !== undefined) {
                    totalBreakMins = parseInt(data.totalBreakMinutes, 10) || 0;
                }
            }
        } catch(e) {}
    }

    if (!loginTimestamp && loginTimeStr) {
        const parsedMins = parseTimeToMinutes(loginTimeStr);
        if (parsedMins !== null) {
            const d = new Date();
            d.setHours(Math.floor(parsedMins / 60), parsedMins % 60, 0, 0);
            loginTimestamp = d.getTime();
        }
    }

    if (!loginTimestamp) {
        return { hasPenalty: false, netWorkedMins: 0, deficitHours: 0, penaltyPercent: 0 };
    }

    const now = Date.now();

    if (myRecord) {
        if (myRecord.totalBreakMinutes !== undefined) {
            totalBreakMins = Math.max(totalBreakMins, parseInt(myRecord.totalBreakMinutes, 10) || 0);
        }
        if (myRecord.status === 'Break' && myRecord.breakTimestamp) {
            const activeBreakSession = Math.max(0, Math.floor((now - myRecord.breakTimestamp) / 60000));
            totalBreakMins += activeBreakSession;
        }
    }

    const grossElapsedMins = Math.max(0, Math.floor((now - loginTimestamp) / 60000));
    const netWorkedMins = Math.max(0, grossElapsedMins - totalBreakMins);

    let assignedTargetHours = config.targetHours || 8;
    if (config.riderTargets && config.riderTargets[riderId] !== undefined && config.riderTargets[riderId] !== "") {
        const customTarget = parseFloat(config.riderTargets[riderId]);
        if (!isNaN(customTarget) && customTarget > 0) {
            assignedTargetHours = customTarget;
        }
    }

    const targetMins = Math.round(assignedTargetHours * 60);
    const graceMins = config.gracePeriodMinutes !== undefined ? config.gracePeriodMinutes : 15;

    if (netWorkedMins >= (targetMins - graceMins)) {
        return { 
            hasPenalty: false, 
            netWorkedMins, 
            totalBreakMins, 
            deficitHours: 0, 
            penaltyPercent: 0,
            assignedTargetHours 
        };
    }

    const missingMins = targetMins - netWorkedMins;
    const deficitHours = Math.max(1, Math.ceil(missingMins / 60));
    const rawPenalty = deficitHours * (config.penaltyPerMissingHour || 2.5);

    let finalPenalty = rawPenalty;
    if (config.capEnabled && config.maxPenaltyPercentage) {
        finalPenalty = Math.min(rawPenalty, config.maxPenaltyPercentage);
    }

    return {
        hasPenalty: true,
        isExempted: false,
        netWorkedMins,
        totalBreakMins,
        deficitHours,
        penaltyPercent: finalPenalty,
        assignedTargetHours,
        workedHoursText: `${Math.floor(netWorkedMins / 60)}h ${netWorkedMins % 60}m`,
        breakHoursText: `${Math.floor(totalBreakMins / 60)}h ${totalBreakMins % 60}m`
    };
}

export async function triggerStatusWithSlide(targetStatus) {
    const rosterMembers = globalState.rosterMembers || [];
    const currentId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const currentName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    let myRecord = rosterMembers.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        if (currentId && mId && mId === currentId) return true;
        if (currentName && mName && mName === currentName) return true;
        return false;
    });

    const myId = myRecord ? (myRecord.telegramId || myRecord.id || currentId) : currentId;
    const myName = myRecord ? (myRecord.riderName || myRecord.name || appState.riderName || "Rider") : (appState.riderName || "Rider");

    if (myRecord && myRecord.status === 'End' && targetStatus !== 'Available') {
        showToast("⚠️ You are on End Shift. Only the Available button can be clicked.");
        return;
    }

    if (targetStatus === 'Available') {
        // IDEMPOTENCY GUARD: Do not touch Firebase or recalculate queue position if already Available
        let currentStatus = myRecord?.status;
        if (!currentStatus && db && myId) {
            try {
                const snap = await db.ref(`roster/${myId}/status`).once('value');
                currentStatus = snap.val();
            } catch(e) {}
        }

        if (currentStatus === 'Available') {
            showToast("ℹ️ You are already Available in the queue (Queue position preserved).");
            return;
        }

        const isStartingShift = !myRecord || !myRecord.status || myRecord.status === 'End';
        if (isStartingShift && db && myId) {
            const isSkippedLocal = localStorage.getItem(`lokalex_skip_pass_${myId}`) === 'true';
            if (!isSkippedLocal) {
                try {
                    const passSnap = await db.ref(`riders/${myId}`).once('value');
                    const rVal = passSnap.val() || {};
                    const hasPass = !!(rVal.password || rVal.pass);
                    const dbSkipped = !!rVal.skipPasswordSetup;

                    if (!hasPass && !dbSkipped) {
                        openRiderPasswordSetupModal(myId, myName, () => {
                            triggerStatusWithSlide('Available');
                        });
                        return;
                    }
                } catch(e) {}
            }
        }

        const timeCheck = checkRiderTimeInAllowed(myId, myName);
        if (!timeCheck.allowed) {
            showToast(`🚫 Time-In not yet allowed: Your scheduled time-in is ${timeCheck.allowedTime}. Request an Early Time-In pass from Admin.`);
            return;
        }

        if (myRecord && myRecord.status === 'Cooldown' && myRecord.cooldownUntil && Date.now() < myRecord.cooldownUntil) {
            const remMins = Math.ceil((myRecord.cooldownUntil - Date.now()) / 60000);
            showToast(`⚠️ You are on penalty cooldown. Please wait ${remMins} min(s) before becoming Available.`);
            return;
        }

        if (myRecord && myRecord.pendingPenaltyMinutes && myRecord.pendingPenaltyMinutes > 0) {
            const pMins = parseInt(myRecord.pendingPenaltyMinutes, 10) || 10;
            const cdUntil = Date.now() + (pMins * 60000);

            if (db && myId) {
                db.ref('roster/' + myId).update({
                    status: 'Cooldown',
                    cooldownUntil: cdUntil,
                    pendingPenaltyMinutes: 0,
                    forcedCaters: null,
                    forcedBy: null,
                    isForcedCater: false,
                    lastUpdated: new Date().toLocaleTimeString(),
                    lastActiveTimestamp: Date.now()
                });
            }

            showToast(`⚠️ Penalized! You are on cooldown for ${pMins} mins. You will be set to Available automatically afterward.`);
            return;
        }

        const activeCustList = getActiveCateringCustomersWithTimes();
        if (activeCustList.length > 0) {
            let missingReceiptCust = null;
            for (let item of activeCustList) {
                if (!hasReceiptForActiveSession(item.name, item.startTime)) {
                    missingReceiptCust = item;
                    break;
                }
            }

            if (missingReceiptCust) {
                showToast(`⚠️ Please create a receipt for ${missingReceiptCust.name} (or void if cancelled) before going Available!`);
                
                if (typeof window.syncSmartCartsWithCateringCustomers === 'function') {
                    window.syncSmartCartsWithCateringCustomers();
                }
                let targetSlot = activeCartSlot || 1;
                if (typeof window.getCartSlotForCustomer === 'function') {
                    targetSlot = window.getCartSlotForCustomer(missingReceiptCust.name);
                }
                if (typeof window.switchCartTab === 'function') {
                    window.switchCartTab(targetSlot);
                }
                switchView('view-cart');
                return;
            }

            // All active catering deliveries have verified receipts:
            // Complete each customer properly so fees, receipts, and catered history records are permanently credited
            showToast("⏳ Completing delivery records and switching to Available...");
            for (const item of activeCustList) {
                await completeSingleCateringCustomer(myId, myName, item.name);
            }
            return;
        }

        if (!navigator.onLine) {
            showToast("⚠️ Cannot go Available: You are offline. Check internet connection and try again.");
            return;
        }

        const availableTimestamp = Date.now();
        const availableTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const currentRoster = globalState.rosterMembers || [];
        const availableRiders = currentRoster.filter(m => m.status === 'Available' && (m.telegramId || m.id || "").toString() !== myId);
        let maxTime = new Date().getTime();
        availableRiders.forEach(r => {
            const t = parseQueueTime(r.queueTime);
            if (t > maxTime) maxTime = t;
        });
        const lockedQueueTime = maxTime + 1000;

        dismissQueueAlarm();

        // Release any lingering catering customer chat threads assigned to this rider using memory map (zero table download)
        const threadMap = (typeof window.getCachedCustomerThreadsMap === 'function') ? window.getCachedCustomerThreadsMap() : null;
        if (threadMap && threadMap.size > 0 && db && myId) {
            const releaseUpdates = {};
            const now = Date.now();
            for (const [cId, meta] of threadMap.entries()) {
                const rId = (meta.cateredByRiderId || '').toString();
                const rName = (meta.cateredByRiderName || meta.cateredBy || '').trim().toLowerCase();
                if ((rId === myId || (myName && rName === myName.toLowerCase())) && meta.folder === 'catering') {
                    const releasePayload = {
                        folder: 'done',
                        status: 'completed',
                        completedAt: now,
                        cateredByRiderId: null,
                        cateredByRiderName: null,
                        cateredBy: null,
                        forcedBy: null,
                        isForcedCater: false,
                        unreadForRider: false,
                        lastUpdated: now
                    };
                    releaseUpdates[`customerChats/${cId}/metadata`] = releasePayload;
                    releaseUpdates[`customerChatMeta/${cId}`] = releasePayload;
                }
            }
            if (Object.keys(releaseUpdates).length > 0) {
                db.ref().update(releaseUpdates).catch(() => {});
            }
        }

        // Lock button into visual syncing state and wait for server confirmation
        setStatusActionSyncingState('Available', true, 'Connecting...');
        try {
            await updateRosterStatus('Available', myId, myName, lockedQueueTime);

            if (window.clearAllCartSlots) {
                window.clearAllCartSlots();
            } else if (window.clearCartSlot) {
                window.clearCartSlot();
            }

            showToast("✅ Now Available!");
        } catch (err) {
            console.error('[triggerStatusWithSlide] Available sync error:', err);
            try {
                if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
            } catch (_) {}
            showToast(`⚠️ Connection Failed: ${err.message || 'Server did not confirm status update.'} Check signal and tap again.`);
        } finally {
            setStatusActionSyncingState('Available', false);
        }

    } else if (targetStatus === 'End') {
        const penaltyInfo = await evaluateEarlyShiftPenalty(myId, myRecord);

        let promptTitle = "Are you sure you want to End Shift?";
        let promptDesc = "You will go off duty for today.";

        if (penaltyInfo.isExempted) {
            promptTitle = "Are you sure you want to End Shift?";
            promptDesc = "You have an Admin Early Out Pass for today. No penalty will be applied to your commission.";
        } else if (penaltyInfo.hasPenalty) {
            promptTitle = `⚠️ EARLY SHIFT OUT DETECTED!`;
            promptDesc = `You have only worked for ${penaltyInfo.workedHoursText} (Break: ${penaltyInfo.breakHoursText}, Target: ${penaltyInfo.assignedTargetHours}h).\nShort by ${penaltyInfo.deficitHours} hour(s) because break time is excluded from duty.\n\nA +${penaltyInfo.penaltyPercent}% penalty will be added to your commission today.\n\nDo you still want to proceed with End Shift?`;
        }

        openSlideDeleteModal(promptTitle, promptDesc, async () => {
            if (!navigator.onLine) {
                showToast("⚠️ Cannot end shift: You are offline. Please check your signal and try again.");
                return;
            }

            dismissQueueAlarm();
            setStatusActionSyncingState('End', true, 'Ending Shift...');
            try {
                if (db && myId) {
                    const updates = {
                        forcedBy: null,
                        isForcedCater: false
                    };

                    if (penaltyInfo.hasPenalty && !penaltyInfo.isExempted) {
                        updates.commissionSurcharge = penaltyInfo.penaltyPercent;
                        updates.earlyShiftDeficitHours = penaltyInfo.deficitHours;

                        db.ref(`logins/${myId}`).update({
                            earlyShiftPenaltyPercent: penaltyInfo.penaltyPercent,
                            deficitHours: penaltyInfo.deficitHours,
                            workedMinutes: penaltyInfo.netWorkedMins,
                            totalBreakMinutes: penaltyInfo.totalBreakMins
                        }).catch(() => {});

                        showSideNotification("EARLY OUT PENALTY", `+${penaltyInfo.penaltyPercent}% penalty applied to commission (Break excluded)`, "fa-triangle-exclamation", "text-red-400", "border-red-500");
                    } else if (penaltyInfo.isExempted) {
                        updates.commissionSurcharge = 0;
                        updates.earlyShiftDeficitHours = 0;

                        db.ref(`logins/${myId}`).update({
                            earlyShiftPenaltyPercent: 0,
                            deficitHours: 0,
                            isExemptedEarlyOut: true
                        }).catch(() => {});
                    }

                    db.ref(`roster/${myId}`).update(updates).catch(() => {});
                }

                await clockOutRider(myId);
                showToast("👋 Shift ended successfully.");
            } catch (err) {
                console.error('[triggerStatusWithSlide] End shift sync error:', err);
                try {
                    if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
                } catch (_) {}
                showToast(`⚠️ Connection Failed: ${err.message || 'Could not end shift.'} Check signal and tap again.`);
            } finally {
                setStatusActionSyncingState('End', false);
            }
        });
    } else if (targetStatus === 'Break') {
        openRiderBreakModal();
    } else {
        openSlideDeleteModal(`Are you sure you want to change status to [${targetStatus}]?`, async () => {
            if (!navigator.onLine) {
                showToast("⚠️ You are offline. Check internet connection and try again.");
                return;
            }
            dismissQueueAlarm();
            setStatusActionSyncingState(targetStatus, true);
            try {
                await updateRosterStatus(targetStatus, myId, myName);
                showToast(`✅ Status changed to ${targetStatus}`);
            } catch (err) {
                console.error('[triggerStatusWithSlide] Error:', err);
                showToast(`⚠️ Connection Failed: ${err.message || 'Server did not confirm status update.'}`);
            } finally {
                setStatusActionSyncingState(targetStatus, false);
            }
        });
    }
}

// REMARKS: ROSTER_STATUS_SLIDER_IDEMPOTENT_AVAILABLE_GUARD_V2_COMPLETE