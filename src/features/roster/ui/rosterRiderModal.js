// src/features/roster/ui/rosterRiderModal.js

/**
 * ============================================================================
 * RIDER PROFILE INSPECTION & COMPLIANCE MODAL (NET DUTY HOURS)
 * ============================================================================
 * 
 * Description:
 * Detailed profile inspector modal for individual riders:
 * - Real-time duty status, contact phone, and GCash payment credentials[cite: 17].
 * - Daily financial ledger: gross earnings and completed delivery order count[cite: 17].
 * - Directory Credit Balance: live balance display reflecting deductions and rewards[cite: 34].
 * - Shift & Labor Compliance Tracker: computes exact net duty time (gross minus
 *   total consumed break duration) against the 8-hour requirement, displaying
 *   active early shift out penalties when applicable[cite: 35, 44].
 * - Active multi-customer catering orders and scheduled weekly day-off[cite: 17].
 * ============================================================================
 */

import { db } from '../../../config/firebase.js';
import { appState, globalState } from '../../../store/state.js';
import { escapeHtml, getLocalTodayStr } from '../../../utils/helpers.js';
import { showToast } from '../../../ui/notifications.js';
import { isRiderMatch, parseTimeToMinutes, isSameDateStr } from '../rosterUtils.js';

export async function openRiderInfoModal(targetId, targetName = "") {
    const cleanId = (targetId || "").toString().trim();
    const cleanName = (targetName || "").toString().trim();

    if (!cleanId && !cleanName) return;

    const modal = document.getElementById('rider-info-modal');
    if (!modal) return;

    // 1. Locate member in local roster cache
    const roster = globalState.rosterMembers || [];
    let member = roster.find(m => isRiderMatch(cleanName, m.riderName || m.name || "", cleanId, (m.telegramId || m.id || "").toString()));

    const riderId = member ? (member.telegramId || member.id || cleanId).toString() : cleanId;
    const riderName = member ? (member.riderName || member.name || cleanName || "Rider") : (cleanName || "Rider");

    // 2. Fetch latest data from Firebase
    let cloudData = null;
    if (db && riderId) {
        try {
            const snap = await db.ref(`riders/${riderId}`).once('value');
            cloudData = snap.val() || {};
        } catch(e) {}
    }

    // 3. Resolve Profile Fields
    const photoUrl = member?.photoUrl || cloudData?.photoUrl || localStorage.getItem(`lokalex_avatar_${riderId}`) || `https://ui-avatars.com/api/?name=${encodeURIComponent(riderName)}&background=0284c7&color=ffffff&bold=true&size=128`;
    const userType = (member?.userType || cloudData?.userType || "rider").toUpperCase();
    const status = (member?.status || "End").toUpperCase();
    const phone = cloudData?.phone || cloudData?.mobile || member?.phone || "";
    const gcashName = cloudData?.gcashName || member?.gcashName || "";
    const gcashNo = cloudData?.gcashNo || member?.gcashNo || "";
    const dayOffDay = member?.dayOff !== undefined ? member.dayOff : (cloudData?.dayOff !== undefined ? cloudData.dayOff : null);
    const directoryCredits = cloudData?.directoryCredits !== undefined 
        ? parseInt(cloudData.directoryCredits, 10) 
        : (member?.directoryCredits !== undefined ? parseInt(member.directoryCredits, 10) : 20);

    // 4. Performance Today (Gross Total & Deliveries)
    const todayStr = getLocalTodayStr();
    let todayGross = 0;
    let todayDeliveries = 0;

    const allReceipts = globalState.globalDailyReceipts || [];
    const allCatered = globalState.globalCateredHistory || [];
    const countedTxIds = new Set();

    allReceipts.forEach(rc => {
        if (isSameDateStr(rc.date || rc.completedDate, todayStr)) {
            const idMatch = riderId && (rc.telegramId || rc.riderId || "").toString().trim() === riderId;
            const nameMatch = isRiderMatch(riderName, rc.riderName || "");
            if (idMatch || nameMatch) {
                const tx = rc.transactionId || rc.id;
                if (tx && !countedTxIds.has(tx)) {
                    countedTxIds.add(tx);
                    todayGross += parseFloat(rc.totalFees) || 0;
                    todayDeliveries++;
                }
            }
        }
    });

    allCatered.forEach(cat => {
        if (isSameDateStr(cat.completedDate || cat.date, todayStr)) {
            const idMatch = riderId && (cat.telegramId || cat.riderId || "").toString().trim() === riderId;
            const nameMatch = isRiderMatch(riderName, cat.riderName || "");
            if (idMatch || nameMatch) {
                const tx = cat.transactionId || cat.id;
                if (tx && !countedTxIds.has(tx)) {
                    countedTxIds.add(tx);
                    todayGross += parseFloat(cat.totalFees) || 0;
                    todayDeliveries++;
                }
            }
        }
    });

    // 5. Shift & Labor Compliance Evaluation (Break Time Strictly Excluded)
    let shiftDisplayHtml = `<span class="text-gray-400">Not Shifted In</span>`;
    const config = globalState.earlyShiftPenaltyConfig || { targetHours: 8, gracePeriodMinutes: 15 };
    const targetMins = Math.round((config.targetHours || 8) * 60);

    let loginRec = (globalState.globalLogins || []).find(l => 
        isSameDateStr(l.date, todayStr) &&
        isRiderMatch(riderName, l.riderName || "", riderId, (l.riderId || l.id || "").toString())
    );

    if (!loginRec && db && riderId) {
        try {
            const lSnap = await db.ref(`logins/${riderId}`).once('value');
            const lVal = lSnap.val();
            if (lVal && (lVal.date === todayStr || !lVal.date)) {
                loginRec = lVal;
            }
        } catch(e) {}
    }

    if (loginRec && loginRec.loginTime) {
        let grossMins = 0;
        let loginTs = loginRec.loginTimestamp;
        let totalBreakMins = loginRec.totalBreakMinutes || member?.totalBreakMinutes || 0;

        if (!loginTs && loginRec.loginTime) {
            const parsed = parseTimeToMinutes(loginRec.loginTime);
            if (parsed !== null) {
                const d = new Date();
                d.setHours(Math.floor(parsed / 60), parsed % 60, 0, 0);
                loginTs = d.getTime();
            }
        }

        const now = Date.now();

        // If rider is currently on Break, add ongoing break session
        if (status === 'BREAK' && member?.breakTimestamp) {
            const ongoingBreak = Math.max(0, Math.floor((now - member.breakTimestamp) / 60000));
            totalBreakMins += ongoingBreak;
        }

        const breakNote = totalBreakMins > 0 ? ` (Break: ${Math.floor(totalBreakMins / 60)}h ${totalBreakMins % 60}m)` : '';

        if (status === 'END') {
            const clockOutTs = loginRec.clockOutTimestamp || now;
            grossMins = loginTs ? Math.max(0, Math.floor((clockOutTs - loginTs) / 60000)) : 0;
            const netMins = Math.max(0, grossMins - totalBreakMins);
            const netHoursText = `${Math.floor(netMins / 60)}h ${netMins % 60}m`;

            const penaltyPerc = loginRec.earlyShiftPenaltyPercent || member?.commissionSurcharge || 0;
            const deficitHours = loginRec.deficitHours || member?.earlyShiftDeficitHours || 0;

            if (penaltyPerc > 0) {
                shiftDisplayHtml = `
                    <div class="flex flex-col text-right">
                        <span class="text-red-500 font-bold font-mono">Early Out (${netHoursText} / 8h)</span>
                        <span class="text-[9.5px] text-red-400 font-black">+${penaltyPerc}% Penalty (${deficitHours}h deficit)${breakNote}</span>
                    </div>`;
            } else if (netMins >= (targetMins - (config.gracePeriodMinutes || 15))) {
                shiftDisplayHtml = `
                    <div class="flex flex-col text-right">
                        <span class="text-emerald-500 font-bold font-mono">Shift Completed (${netHoursText})</span>
                        <span class="text-[9.5px] text-emerald-400">8h Target Satisfied${breakNote}</span>
                    </div>`;
            } else {
                shiftDisplayHtml = `
                    <div class="flex flex-col text-right">
                        <span class="text-gray-300 font-bold font-mono">Ended Shift (${netHoursText})</span>
                        <span class="text-[9.5px] text-gray-500">Excused Departure${breakNote}</span>
                    </div>`;
            }
        } else {
            // Currently on-duty or on break
            grossMins = loginTs ? Math.max(0, Math.floor((now - loginTs) / 60000)) : 0;
            const netMins = Math.max(0, grossMins - totalBreakMins);
            const netHoursText = `${Math.floor(netMins / 60)}h ${netMins % 60}m`;

            if (netMins >= (targetMins - (config.gracePeriodMinutes || 15))) {
                shiftDisplayHtml = `
                    <div class="flex flex-col text-right">
                        <span class="text-emerald-400 font-bold font-mono">${netHoursText} / 8h</span>
                        <span class="text-[9.5px] text-emerald-400 font-bold">8h Minimum Reached ✅${breakNote}</span>
                    </div>`;
            } else {
                const remMins = targetMins - netMins;
                const remHoursText = `${Math.floor(remMins / 60)}h ${remMins % 60}m`;
                shiftDisplayHtml = `
                    <div class="flex flex-col text-right">
                        <span class="text-amber-400 font-bold font-mono">${netHoursText} / 8h</span>
                        <span class="text-[9.5px] text-gray-400">${remHoursText} remaining${breakNote}</span>
                    </div>`;
            }
        }
    }

    // 6. Day of Week Mapping
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let dayOffText = "None Assigned";
    if (dayOffDay !== null && dayOffDay !== undefined && dayNames[dayOffDay]) {
        dayOffText = dayNames[dayOffDay];
    }

    // 7. Render to DOM Elements
    const avatarEl = document.getElementById('rider-info-avatar');
    const nameEl = document.getElementById('rider-info-name');
    const roleEl = document.getElementById('rider-info-role');
    const statusEl = document.getElementById('rider-info-status');
    const phoneEl = document.getElementById('rider-info-phone');
    const phoneLinkEl = document.getElementById('rider-info-phone-link');
    const gcashNameEl = document.getElementById('rider-info-gcash-name');
    const gcashNoEl = document.getElementById('rider-info-gcash-no');
    const grossEl = document.getElementById('rider-info-gross');
    const deliveriesEl = document.getElementById('rider-info-deliveries');
    const creditsEl = document.getElementById('rider-info-credits');
    const shiftEl = document.getElementById('rider-info-shift');
    const dayOffEl = document.getElementById('rider-info-dayoff');
    const cateringWrapper = document.getElementById('rider-info-active-catering-wrapper');
    const cateringText = document.getElementById('rider-info-active-catering');

    if (avatarEl) avatarEl.src = photoUrl;
    if (nameEl) nameEl.innerText = riderName;

    if (roleEl) {
        roleEl.innerText = userType;
        if (userType === 'ADMIN') roleEl.className = "px-2 py-0.5 rounded-full font-bold text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/40 uppercase";
        else if (userType === 'TL') roleEl.className = "px-2 py-0.5 rounded-full font-bold text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/40 uppercase";
        else roleEl.className = "px-2 py-0.5 rounded-full font-bold text-[9px] bg-gray-500/20 text-gray-400 border border-gray-500/40 uppercase";
    }

    if (statusEl) {
        statusEl.innerText = status;
        if (status === 'AVAILABLE') statusEl.className = "px-2 py-0.5 rounded-full font-bold text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 uppercase";
        else if (status === 'CATERING') statusEl.className = "px-2 py-0.5 rounded-full font-bold text-[9px] bg-red-500/20 text-red-400 border border-red-500/40 uppercase";
        else if (status === 'BREAK') statusEl.className = "px-2 py-0.5 rounded-full font-bold text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/40 uppercase";
        else if (status === 'COOLDOWN') statusEl.className = "px-2 py-0.5 rounded-full font-bold text-[9px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 uppercase";
        else statusEl.className = "px-2 py-0.5 rounded-full font-bold text-[9px] bg-gray-700/40 text-gray-400 border border-gray-600/40 uppercase";
    }

    if (phoneEl) phoneEl.innerText = phone || "Not Set";
    if (phoneLinkEl) {
        if (phone) {
            phoneLinkEl.href = `tel:${phone.replace(/[^0-9+]/g, '')}`;
            phoneLinkEl.classList.remove('hidden');
        } else {
            phoneLinkEl.classList.add('hidden');
        }
    }

    if (gcashNameEl) gcashNameEl.innerText = gcashName || "Not Set";
    if (gcashNoEl) gcashNoEl.innerText = gcashNo || "Not Set";
    if (grossEl) grossEl.innerText = `₱${todayGross.toFixed(2)}`;
    if (deliveriesEl) deliveriesEl.innerText = `${todayDeliveries} order(s)`;
    if (creditsEl) creditsEl.innerText = `${directoryCredits} creds`;
    if (shiftEl) shiftEl.innerHTML = shiftDisplayHtml;
    if (dayOffEl) dayOffEl.innerText = dayOffText;

    if (cateringWrapper && cateringText) {
        if (status === 'CATERING' && member?.customerName) {
            cateringText.innerText = member.customerName;
            cateringWrapper.classList.remove('hidden');
        } else {
            cateringWrapper.classList.add('hidden');
        }
    }

    modal.classList.remove('hidden');
}

export function closeRiderInfoModal() {
    const modal = document.getElementById('rider-info-modal');
    if (modal) modal.classList.add('hidden');
}

if (typeof window !== 'undefined') {
    window.openRiderInfoModal = openRiderInfoModal;
    window.closeRiderInfoModal = closeRiderInfoModal;
}
// REMARKS: ROSTER_RIDER_MODAL_NET_DUTY_HOURS_BREAK_EXCLUSION_V1_COMPLETE