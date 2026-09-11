// src/features/roster/actions/rosterStatusSlider.js
import { db } from '../../../config/firebase.js';
import { appState, globalState, multiCarts, activeCartSlot } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { openSlideDeleteModal, openRiderPasswordSetupModal } from '../../../ui/modals.js';
import { calibrateGPS } from '../../auth/index.js';
import { switchView } from '../../../ui/router.js';
import { endLiveGpsSession } from '../../liveTracker.js';
import { 
    parseQueueTime, 
    getActiveCateringCustomersWithTimes, 
    hasReceiptForActiveSession 
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
            const pMins = parseInt(myRecord.pendingPenaltyMinutes) || 10;
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
            showToast("📡 Kinukuha ang GPS Location bago mag-Time In...");
            const coords = await calibrateGPS((acc, count) => {
                showToast(`📡 Calibrating GPS: ±${Math.round(acc)}m (Fix ${count}/4)`);
            });

            if (!coords || !coords.lat || !coords.lon || coords.accuracy > 500) {
                showToast("❌ Bigo ang GPS. Paki-enable ang Location Access bago mag-Time In!");
                return;
            }

            appState.lat = coords.lat;
            appState.lon = coords.lon;
            appState.gpsAccuracy = coords.accuracy;
            showToast(`✅ GPS Calibrated: ±${Math.round(coords.accuracy)}m`);
        }

        // Capture exact Available queue time and GPS coordinates
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

    } else if (targetStatus === 'End') {
        openSlideDeleteModal(`Sigurado ka bang mag-End Shift?`, async () => {
            dismissQueueAlarm();
            endLiveGpsSession();
            if (db && myId) {
                db.ref(`roster/${myId}/forcedCaters`).remove().catch(() => {});
                db.ref(`roster/${myId}`).update({
                    forcedBy: null,
                    isForcedCater: false
                }).catch(() => {});
            }
            if (myRecord) {
                myRecord.forcedCaters = null;
                myRecord.forcedBy = null;
                myRecord.isForcedCater = false;
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