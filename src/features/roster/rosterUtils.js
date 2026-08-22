// src/features/roster/rosterUtils.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { ADMIN_IDS } from '../../config/constants.js';
import { showToast, unlockAudioContext } from '../../ui/notifications.js';
import { getLocalTodayStr, isSameDate } from '../../utils/helpers.js';

export let lineAlarmInterval = null;
export let lineAlarmConfirmed = false;

export function setLineAlarmConfirmed(val) {
    lineAlarmConfirmed = val;
}

const ROSTER_CACHE_KEY = 'lokalex_roster_cache';
const LOGINS_CACHE_KEY = 'lokalex_logins_cache';
const CATERED_CACHE_KEY = 'lokalex_catered_cache';

export function saveRosterCache() {
    try {
        localStorage.setItem(ROSTER_CACHE_KEY, JSON.stringify(globalState.rosterMembers || []));
        localStorage.setItem(LOGINS_CACHE_KEY, JSON.stringify(globalState.globalLogins || []));
        localStorage.setItem(CATERED_CACHE_KEY, JSON.stringify(globalState.globalCateredHistory || []));
    } catch(e) {}
}

export function loadRosterCache() {
    try {
        const savedRoster = localStorage.getItem(ROSTER_CACHE_KEY);
        if (savedRoster && (!globalState.rosterMembers || globalState.rosterMembers.length === 0)) {
            globalState.rosterMembers = JSON.parse(savedRoster);
        }
        const savedLogins = localStorage.getItem(LOGINS_CACHE_KEY);
        if (savedLogins && (!globalState.globalLogins || globalState.globalLogins.length === 0)) {
            globalState.globalLogins = JSON.parse(savedLogins);
        }
        const savedCatered = localStorage.getItem(CATERED_CACHE_KEY);
        if (savedCatered && (!globalState.globalCateredHistory || globalState.globalCateredHistory.length === 0)) {
            globalState.globalCateredHistory = JSON.parse(savedCatered);
        }
    } catch(e) {}
}

export function getUserType() {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    if (globalState.userTypesMap) {
        if (myId && globalState.userTypesMap[myId]) {
            return globalState.userTypesMap[myId].toString().trim().toLowerCase();
        }
        if (myName && globalState.userTypesMap[myName]) {
            return globalState.userTypesMap[myName].toString().trim().toLowerCase();
        }
    }

    if (globalState.rosterMembers && myId) {
        const myRosterRec = globalState.rosterMembers.find(m => (m.telegramId || "").toString().trim() === myId);
        if (myRosterRec && myRosterRec.userType) {
            return myRosterRec.userType.toString().trim().toLowerCase();
        }
    }

    return (appState.userType || localStorage.getItem('userType') || "rider").toString().trim().toLowerCase();
}

export function isAdmin() {
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    if (myId && ADMIN_IDS.some(id => id.toString().trim() === myId)) return true;
    if (myName && ADMIN_IDS.some(id => id.toString().toLowerCase().trim() === myName)) return true;

    const t = getUserType();
    return t === "admin" || t === "owner" || t === "manager" || t.includes("admin");
}

export function isTL() {
    const t = getUserType();
    return t === "tl" || t === "lead" || t.includes("tl") || t.includes("lead") || t.includes("leader");
}

export function canManageRoster() {
    return isAdmin() || isTL();
}

export function canForceCaterTarget(targetType) {
    if (isAdmin()) return true;
    if (isTL()) {
        const t = (targetType || "").toString().toLowerCase().trim();
        return !t.includes("admin") && !t.includes("owner") && !t.includes("manager");
    }
    return false;
}

export function parseQueueTime(val) {
    if (!val) return 0;
    const clean = val.toString().replace(/,/g, '').trim();
    return parseFloat(clean) || 0;
}

export function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const clean = timeStr.trim();
    const match = clean.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3] ? match[3].toUpperCase() : null;

    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    return hours * 60 + minutes;
}

export function calculateSplitDuration(startTimeStr, completedTimeStr, customerCount = 1) {
    const startMins = parseTimeToMinutes(startTimeStr);
    const endMins = parseTimeToMinutes(completedTimeStr);

    if (startMins === null || endMins === null) return "";

    let totalMins = endMins - startMins;
    if (totalMins < 0) totalMins += 24 * 60;

    const count = Math.max(1, customerCount);
    const splitMins = Math.round(totalMins / count);

    const hrs = Math.floor(splitMins / 60);
    const mins = splitMins % 60;

    let durationText = "";
    if (hrs > 0) {
        durationText = `${hrs}h ${mins}m`;
    } else {
        durationText = `${mins}m`;
    }

    if (count > 1) {
        durationText += ` (${totalMins}m ÷ ${count})`;
    }

    return durationText;
}

// -------------------------------------------------------------
// LOWEST GROSS INCOME LINEUP CALCULATOR
// -------------------------------------------------------------
export function getRiderTodayGross(riderName, telegramId) {
    const todayStr = getLocalTodayStr();
    const rName = (riderName || "").trim().toLowerCase();
    const tId = (telegramId || "").toString().trim();

    let totalGross = 0;
    const countedTx = new Set();

    if (globalState.globalDailyReceipts) {
        globalState.globalDailyReceipts.forEach(rc => {
            if (!rc) return;
            const rcDate = rc.date || rc.completedDate;
            if (!isSameDate(rcDate, todayStr)) return;

            const rcRiderName = (rc.riderName || "").trim().toLowerCase();
            const rcTelegramId = (rc.telegramId || "").toString().trim();

            const isMatch = (tId && rcTelegramId && tId === rcTelegramId) || (rName && rcRiderName && rName === rcRiderName);
            if (isMatch) {
                const txId = rc.transactionId || `${rcRiderName}_${rc.customerName}_${rc.totalFees}_${rcDate}`;
                if (!countedTx.has(txId)) {
                    countedTx.add(txId);
                    totalGross += (parseFloat(rc.totalFees) || 0);
                }
            }
        });
    }

    if (globalState.globalCateredHistory) {
        globalState.globalCateredHistory.forEach(ch => {
            if (!ch) return;
            const chDate = ch.completedDate || ch.date;
            if (!isSameDate(chDate, todayStr)) return;

            const chRiderName = (ch.riderName || "").trim().toLowerCase();
            const chTelegramId = (ch.telegramId || "").toString().trim();

            const isMatch = (tId && chTelegramId && tId === chTelegramId) || (rName && chRiderName && rName === chRiderName);
            if (isMatch) {
                const txId = ch.transactionId || `${chRiderName}_${ch.customerName}_${ch.totalFees}_${chDate}`;
                if (!countedTx.has(txId)) {
                    countedTx.add(txId);
                    totalGross += (parseFloat(ch.totalFees) || 0);
                }
            }
        });
    }

    return totalGross;
}

export function sortAvailableRidersByGross(availableList) {
    return (availableList || []).slice().sort((a, b) => {
        const grossA = getRiderTodayGross(a.riderName || a.name, a.telegramId);
        const grossB = getRiderTodayGross(b.riderName || b.name, b.telegramId);

        if (grossA !== grossB) {
            return grossA - grossB; // Lowest gross income first (Ascending)
        }

        // Tie-breaker: FIFO queueTime (earlier queue time first)
        return parseQueueTime(a.queueTime) - parseQueueTime(b.queueTime);
    });
}

// ROBUST ARCHIVING WITH RECEIPT LOOKUP FALLBACK
export async function archiveRiderCateringIfNeeded(targetRecord) {
    if (!targetRecord || targetRecord.status !== 'Catering' || !targetRecord.customerName) return;

    const custs = targetRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
    const times = targetRecord.startTime ? targetRecord.startTime.split(', ').map(t => t.trim()) : [];
    const custCount = custs.length || 1;
    const completedTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const tId = (targetRecord.telegramId || "").toString().trim();
    const tName = targetRecord.riderName || targetRecord.name || "Rider";
    const todayStr = getLocalTodayStr();

    if (db && custs.length > 0) {
        db.ref('customerChats').once('value', (snapshot) => {
            const chats = snapshot.val();
            if (chats) {
                Object.keys(chats).forEach(custId => {
                    const chatMeta = chats[custId]?.metadata || chats[custId] || {};
                    const chatCustName = (chatMeta.customerName || chatMeta.name || "").trim().toLowerCase();
                    
                    if (chatCustName && custs.some(c => c.toLowerCase() === chatCustName)) {
                        db.ref(`customerChats/${custId}/metadata`).update({
                            folder: 'done',
                            cateredByRiderId: null,
                            cateredByRiderName: null,
                            cateredBy: null,
                            lastUpdated: Date.now()
                        });
                    }
                });
            }
        });
    }

    let firebaseReceiptsList = [];
    if (db) {
        try {
            const rcptSnap = await db.ref('receipts').once('value');
            const rcptVal = rcptSnap.val();
            if (rcptVal) {
                firebaseReceiptsList = Object.values(rcptVal);
            }
        } catch(e) {}
    }

    for (let i = 0; i < custs.length; i++) {
        const cName = custs[i];
        const cleanCustKey = cName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const sTime = times[i] || times[0] || 'N/A';
        const splitDuration = calculateSplitDuration(sTime, completedTimeStr, custCount);

        let finalFees = 0;
        let finalFeeDetails = null;

        if (targetRecord.customerFees && cleanCustKey && targetRecord.customerFees[cleanCustKey]) {
            finalFees = parseFloat(targetRecord.customerFees[cleanCustKey].totalFees) || 0;
            finalFeeDetails = targetRecord.customerFees[cleanCustKey].fees || null;
        }

        if (finalFees <= 0 && globalState.globalDailyReceipts) {
            const matchReceipt = globalState.globalDailyReceipts.find(rc => {
                const rMatch = (rc.riderName || "").trim().toLowerCase() === tName.toLowerCase();
                const cMatch = (rc.customerName || "").trim().toLowerCase() === cName.toLowerCase() ||
                              (rc.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCustKey;
                const dMatch = isSameDate(rc.date || rc.completedDate, todayStr);
                return rMatch && cMatch && dMatch;
            });

            if (matchReceipt) {
                finalFees = parseFloat(matchReceipt.totalFees) || 0;
                finalFeeDetails = matchReceipt.fees || null;
            }
        }

        if (finalFees <= 0 && firebaseReceiptsList.length > 0) {
            const fbMatch = firebaseReceiptsList.find(rc => {
                const rMatch = (rc.riderName || "").trim().toLowerCase() === tName.toLowerCase();
                const cMatch = (rc.customerName || "").trim().toLowerCase() === cName.toLowerCase() ||
                              (rc.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCustKey;
                const dMatch = isSameDate(rc.date || rc.completedDate, todayStr);
                return rMatch && cMatch && dMatch;
            });

            if (fbMatch) {
                finalFees = parseFloat(fbMatch.totalFees) || 0;
                finalFeeDetails = fbMatch.fees || null;
            }
        }

        if (finalFees <= 0 && targetRecord.lastReceiptTotalFees) {
            finalFees = parseFloat(targetRecord.lastReceiptTotalFees) || 0;
            finalFeeDetails = targetRecord.lastReceiptFees || null;
        }

        const hItem = {
            riderName: tName,
            telegramId: tId,
            customerName: cName,
            startTime: sTime,
            completedTime: completedTimeStr,
            completedDate: todayStr,
            customerCount: custCount,
            duration: splitDuration,
            totalFees: finalFees,
            fees: finalFeeDetails
        };

        if (db) db.ref('cateredHistory').push(hItem);

        if (!globalState.globalCateredHistory) globalState.globalCateredHistory = [];
        globalState.globalCateredHistory.push(hItem);
    }

    if (db && tId) {
        db.ref(`roster/${tId}/customerFees`).remove().catch(() => {});
        db.ref(`roster/${tId}/lastReceiptTotalFees`).remove().catch(() => {});
        db.ref(`roster/${tId}/lastReceiptFees`).remove().catch(() => {});
    }

    saveRosterCache();
    window.dispatchEvent(new CustomEvent('cateredUpdated'));
    window.dispatchEvent(new CustomEvent('receiptsUpdated'));
}

export function getElapsedCateringTime(startTimeStr) {
    if (!startTimeStr) return "";
    
    const firstTime = startTimeStr.split(',')[0].trim();
    if (!firstTime) return "";

    const match = firstTime.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
    if (!match) return ` • ${firstTime}`;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3] ? match[3].toUpperCase() : null;

    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);

    let diffMs = now - start;
    if (diffMs < 0) {
        diffMs += 24 * 60 * 60 * 1000;
    }

    const totalMins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;

    let durationStr = "";
    if (hrs > 0) {
        durationStr = `${hrs}h ${mins}m`;
    } else {
        durationStr = `${mins}m`;
    }

    return ` • ${firstTime} [${durationStr}]`;
}

export function getActiveCateringCustomersWithTimes() {
    const myId = (appState.telegramId || "").toString();
    const myRecord = globalState.rosterMembers ? globalState.rosterMembers.find(m => (m.telegramId || "").toString() === myId) : null;
    if (!myRecord || myRecord.status !== 'Catering' || !myRecord.customerName) return [];

    const custs = myRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
    const times = myRecord.startTime ? myRecord.startTime.split(', ').map(t => t.trim()) : [];

    return custs.map((c, idx) => ({
        name: c,
        startTime: times[idx] || times[0] || ""
    }));
}

export function hasReceiptForActiveSession(custName, custStartTime) {
    if (!custName || custName.toLowerCase() === 'sample') return true;
    const rName = (appState.riderName || "").trim().toLowerCase();
    const cName = custName.trim().toLowerCase();
    const cleanCName = cName.replace(/[^a-z0-9]/g, '');
    const sTime = (custStartTime || "").trim();
    const todayStr = getLocalTodayStr();

    const keyWithTime = `receipt_done_${rName}_${cName}_${sTime}_${todayStr}`;
    const keyTypo = `receipt_done_${rName}_${cName}__${todayStr}`;
    const keyWithoutTime = `receipt_done_${rName}_${cName}_${todayStr}`;

    if (localStorage.getItem(keyWithTime) === 'true' ||
        localStorage.getItem(keyTypo) === 'true' ||
        localStorage.getItem(keyWithoutTime) === 'true') {
        return true;
    }

    const receipts = globalState.globalDailyReceipts || [];
    const hasReceiptRecord = receipts.some(rc => {
        const rcRider = (rc.riderName || "").trim().toLowerCase();
        const rcCust = (rc.customerName || "").trim().toLowerCase();
        const cleanRcCust = rcCust.replace(/[^a-z0-9]/g, '');
        const rcDate = rc.date || rc.completedDate;

        return rcRider === rName && 
               (rcCust === cName || cleanRcCust === cleanCName) && 
               isSameDate(rcDate, todayStr);
    });

    if (hasReceiptRecord) return true;

    const myRecord = globalState.rosterMembers ? globalState.rosterMembers.find(m => (m.telegramId || "").toString() === (appState.telegramId || "").toString()) : null;
    if (myRecord && myRecord.customerFees && cleanCName && myRecord.customerFees[cleanCName]) {
        return true;
    }

    return false;
}

export function checkFirstInLineAlarm(availableRiders) {
    const myId = (appState.telegramId || "").toString();
    const firstRiderId = (availableRiders[0]?.telegramId || "").toString();
    const isFirst = availableRiders.length > 0 && firstRiderId === myId && myId !== "";
    
    const modal = document.getElementById('first-line-modal') || document.getElementById('first-in-line-modal');
    const goldenBox = document.getElementById('golden-first-line-border');

    if (isFirst) {
        if (goldenBox) goldenBox.classList.remove('hidden');

        if (!lineAlarmConfirmed) {
            if (modal && modal.classList.contains('hidden')) {
                modal.classList.remove('hidden');
            }
            if (!lineAlarmInterval) {
                lineAlarmInterval = setInterval(playLineBeep, 1200);
            }
        }
    } else {
        stopLineAlarm();
        if (modal) modal.classList.add('hidden');
        if (goldenBox) goldenBox.classList.add('hidden');
    }
}

export function confirmFirstInLineAlarm() {
    lineAlarmConfirmed = true;
    stopLineAlarm();
    const modal = document.getElementById('first-line-modal') || document.getElementById('first-in-line-modal');
    if (modal) modal.classList.add('hidden');
    showToast("✅ Confirmed! Alarm stopped.");
}

export function stopLineAlarm() {
    if (lineAlarmInterval) {
        clearInterval(lineAlarmInterval);
        lineAlarmInterval = null;
    }
}

export function playLineBeep() {
    try {
        unlockAudioContext();
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const audioCtx = new AudioContext();
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.4);
    } catch(e) {}
}

export const playLineAlarm = playLineBeep;