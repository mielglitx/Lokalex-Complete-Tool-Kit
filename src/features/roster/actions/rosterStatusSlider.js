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
 * - End Shift: Evaluates shift duration against rider-specific daily targets
 *   (or global 8h default) minus consumed break time. Inspects temporary daily
 *   exemptions: if granted an early out pass by Admin, early departure penalties
 *   are completely bypassed.
 * - Break / Cooldown: Manages rest transitions and background timer lifecycles.
 * 
 * Update Note:
 * - Fixed import path: moved `isSameDateStr` to `../rosterUtils.js` where it is
 *   properly exported.
 * ============================================================================
 */

import { db } from '../../../config/firebase.js';
import { appState, globalState, multiCarts, activeCartSlot } from '../../../store/state.js';
import { showToast, showSideNotification } from '../../../ui/notifications.js';
import { openSlideDeleteModal, openRiderPasswordSetupModal } from '../../../ui/modals.js';
import { calibrateGPS } from '../../auth/index.js';
import { switchView } from '../../../ui/router.js';
import { endLiveGpsSession } from '../../liveTracker.js';
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

/**
 * Evaluates whether the rider has fulfilled their required shift duration.
 * Accurately deducts break time, checks for 1-day temporary exemptions,
 * and honors per-rider custom daily duty hour configurations.
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

    // 1. TEMPORARY DAILY EXEMPTION CHECK (ADMIN PASS)
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
                loginTimeStr = data.loginTime || "";
                if (data.loginTimestamp) {
                    loginTimestamp = data.loginTimestamp;
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

    // 2. RESOLVE RIDER-SPECIFIC SHIFT TARGET (FALLBACK TO GLOBAL TARGET)
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
        showToast("⚠️ Naka-End Shift ka. Ang Available button lamang ang maaaring pindutin.");
        return;
    }

    if (targetStatus === 'Available') {
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
            showToast(`🚫 Bawal pa mag-Time In: Ang iyong allowed time-in ay ${timeCheck.allowedTime}. Humingi ng Early Time-In pass sa Admin.`);
            return;
        }

        if (myRecord && myRecord.status === 'Cooldown' && myRecord.cooldownUntil && Date.now() < myRecord.cooldownUntil) {
            const remMins = Math.ceil((myRecord.cooldownUntil - Date.now()) / 60000);
            showToast(`⚠️ Naka-penalty cooldown ka pa. Maghintay ng ${remMins} min(s) bago maging Available.`);
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

            showToast(`⚠️ Penalized! Naka-cooldown ka ng ${pMins} mins. Kusa kang gagawing Available pagkatapos.`);
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
                showToast(`⚠️ Paki-gawaan muna ng resibo si ${missingReceiptCust.name} (o i-void kung cancel) bago mag-Available!`);
                
                if (multiCarts && activeCartSlot) {
                    multiCarts[activeCartSlot].customerName = missingReceiptCust.name;
                    multiCarts[activeCartSlot].isManual = false;
                    if (window.saveCartState) window.saveCartState();
                }
                switchView('view-cart');
                return;
            }
        }

        if (isStartingShift) {
            const coords = await calibrateGPS(() => {});

            if (!coords || !coords.lat || !coords.lon || coords.accuracy > 500) {
                showToast("❌ Bigo ang GPS. Paki-enable ang Location Access bago mag-Time In!");
                return;
            }

            appState.lat = coords.lat;
            appState.lon = coords.lon;
            appState.gpsAccuracy = coords.accuracy;
        }

        const locationData = await getDeviceLocationQuick();
        if (locationData && locationData.lat) {
            appState.lat = locationData.lat;
            appState.lon = locationData.lon;
            appState.gpsAccuracy = locationData.accuracy;
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

        endLiveGpsSession();
        dismissQueueAlarm();

        if (db && myId) {
            db.ref(`roster/${myId}/forcedCaters`).remove().catch(() => {});
            db.ref(`roster/${myId}`).update({
                forcedBy: null,
                isForcedCater: false,
                availableTimestamp: availableTimestamp,
                availableTimeStr: availableTimeStr,
                availableLocation: locationData
            }).catch(() => {});
        }
        if (myRecord) {
            myRecord.forcedCaters = null;
            myRecord.forcedBy = null;
            myRecord.isForcedCater = false;
            myRecord.availableTimestamp = availableTimestamp;
            myRecord.availableTimeStr = availableTimeStr;
            myRecord.availableLocation = locationData;
        }

        await updateRosterStatus('Available', myId, myName, lockedQueueTime);

        if (window.clearAllCartSlots) {
            window.clearAllCartSlots();
        } else if (window.clearCartSlot) {
            window.clearCartSlot();
        }

        showToast("✅ Available na! GPS Location recorded.");

    } else if (targetStatus === 'End') {
        const penaltyInfo = await evaluateEarlyShiftPenalty(myId, myRecord);

        let promptTitle = "Sigurado ka bang mag-End Shift?";
        let promptDesc = "Mag-o-off duty ka na para sa araw na ito.";

        if (penaltyInfo.isExempted) {
            promptTitle = "Sigurado ka bang mag-End Shift?";
            promptDesc = "Mayroon kang Admin Early Out Pass para sa araw na ito. Walang penalty na maia-apply sa iyong komisyon.";
        } else if (penaltyInfo.hasPenalty) {
            promptTitle = `⚠️ EARLY SHIFT OUT DETECTED!`;
            promptDesc = `Nakapag-duty ka lamang ng ${penaltyInfo.workedHoursText} (Break: ${penaltyInfo.breakHoursText}, Target: ${penaltyInfo.assignedTargetHours}h).\nKulang ng ${penaltyInfo.deficitHours} oras dahil hindi kasama ang break time sa duty.\n\nMay dagdag na +${penaltyInfo.penaltyPercent}% penalty sa iyong babayarang komisyon ngayong araw.\n\nItuloy pa rin ang pag-End Shift?`;
        }

        openSlideDeleteModal(promptTitle, promptDesc, async () => {
            dismissQueueAlarm();
            endLiveGpsSession();

            if (db && myId) {
                db.ref(`roster/${myId}/forcedCaters`).remove().catch(() => {});
                
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

            if (myRecord) {
                myRecord.forcedCaters = null;
                myRecord.forcedBy = null;
                myRecord.isForcedCater = false;
                if (penaltyInfo.hasPenalty && !penaltyInfo.isExempted) {
                    myRecord.commissionSurcharge = penaltyInfo.penaltyPercent;
                } else {
                    myRecord.commissionSurcharge = 0;
                }
            }

            await clockOutRider(myId);
            await updateRosterStatus('End', myId, myName);
        });
    } else {
        openSlideDeleteModal(`Sigurado ka bang mag-iiba ng status sa [${targetStatus}]?`, async () => {
            dismissQueueAlarm();
            if (targetStatus === 'Break') endLiveGpsSession();
            await updateRosterStatus(targetStatus, myId, myName);
        });
    }
}
// REMARKS: ROSTER_STATUS_SLIDER_FIX_IMPORT_SAME_DATE_STR_V1_COMPLETE