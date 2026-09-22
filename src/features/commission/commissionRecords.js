// src/features/commission/commissionRecords.js

/**
 * ============================================================================
 * COMMISSION RECORDS & ADMINISTRATIVE PENALTY MUTATORS
 * ============================================================================
 * 
 * Description:
 * Manages manual commission records, rate penalty sanctions, and waiver tools:
 * - Admin Date Penalties: adds/removes +X% punitive commission penalties[cite: 45].
 * - Early Shift Penalty Waiver: allows administrators to excuse/waive an early
 *   shift out surcharge, synchronously clearing records in Firebase and state[cite: 45].
 * - Manual Commission Records: injects unlogged delivery fees into ledgers[cite: 45].
 * - Record Deletion & Fee Corrections: targeted mutations without database scans[cite: 45].
 * ============================================================================
 */

import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { getLocalTodayStr, escapeHtml } from '../../utils/helpers.js';
import { showToast } from '../../ui/notifications.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { isAdmin as checkIsAdmin, isCustomerMatch, isSameDateStr, saveRosterCache, isRiderMatch } from '../roster/rosterUtils.js';
import { getCleanRiderList, refreshCommissionView, viewSettings } from './commissionUI.js';

export function openAdminPenaltyModal() {
    const modal = document.getElementById('admin-penalty-modal');
    const riderSelect = document.getElementById('penalty-rider-select');
    const dateInput = document.getElementById('penalty-date-input');
    const rateInput = document.getElementById('penalty-rate-input');
    const reasonInput = document.getElementById('penalty-reason-input');

    if (!modal || !riderSelect) return;

    const cleanRiders = getCleanRiderList();
    let optionsHtml = "";
    cleanRiders.forEach(name => {
        optionsHtml += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
    });
    riderSelect.innerHTML = optionsHtml;

    if (dateInput) dateInput.value = viewSettings.dateValue || getLocalTodayStr();
    if (rateInput) rateInput.value = "10";
    if (reasonInput) reasonInput.value = "";

    modal.classList.remove('hidden');
}

export function closeAdminPenaltyModal() {
    const modal = document.getElementById('admin-penalty-modal');
    if (modal) modal.classList.add('hidden');
}

export function submitAdminPenalty() {
    const riderSelect = document.getElementById('penalty-rider-select');
    const dateInput = document.getElementById('penalty-date-input');
    const rateInput = document.getElementById('penalty-rate-input');
    const reasonInput = document.getElementById('penalty-reason-input');

    const rName = riderSelect ? riderSelect.value.trim() : "";
    const targetDate = dateInput ? dateInput.value : getLocalTodayStr();
    const penaltyRate = rateInput ? parseFloat(rateInput.value) : 0;
    const reason = reasonInput ? reasonInput.value.trim() : "Admin Penalty";

    if (!rName) return showToast("⚠️ Please select a rider.");
    if (isNaN(penaltyRate) || penaltyRate <= 0) return showToast("⚠️ Please enter a valid penalty percentage.");

    const cleanName = rName.toLowerCase().trim();
    const penaltyKey = `${cleanName}_${targetDate}`;

    const rosterMem = (globalState.rosterMembers || []).find(m => 
        isRiderMatch(rName, m.riderName || m.name || "", "", m.telegramId || m.id)
    );
    const rId = rosterMem ? (rosterMem.telegramId || rosterMem.id || "").toString().trim() : "";

    const penaltyRecord = {
        riderName: rName,
        telegramId: rId,
        date: targetDate,
        penaltyPercentage: penaltyRate,
        reason: reason,
        createdBy: appState.riderName || "Admin",
        createdAt: Date.now()
    };

    if (db) {
        db.ref(`commissionPenalties/${penaltyKey}`).set(penaltyRecord);
    }

    if (!globalState.globalCommissionPenalties) globalState.globalCommissionPenalties = {};
    globalState.globalCommissionPenalties[penaltyKey] = penaltyRecord;

    closeAdminPenaltyModal();
    showToast(`⚖️ Added +${penaltyRate}% Commission Penalty for ${rName} on ${targetDate}!`);
    refreshCommissionView();
}

export function removeAdminPenalty(riderName, targetDate) {
    const cleanName = (riderName || "").toLowerCase().trim();
    const penaltyKey = `${cleanName}_${targetDate}`;

    openSlideDeleteModal(`Tanggalin ang Date Penalty?`, `Sigurado ka bang tanggalin ang +commission penalty para kay ${riderName} sa ${targetDate}?`, () => {
        if (db) {
            db.ref(`commissionPenalties/${penaltyKey}`).remove();
            
            db.ref('commissionPenalties')
                .orderByChild('date')
                .equalTo(targetDate)
                .once('value', (snap) => {
                    const val = snap.val() || {};
                    Object.entries(val).forEach(([key, rec]) => {
                        if (isRiderMatch(riderName, rec.riderName || key.split('_')[0])) {
                            db.ref(`commissionPenalties/${key}`).remove();
                        }
                    });
                });
        }
        if (globalState.globalCommissionPenalties) {
            delete globalState.globalCommissionPenalties[penaltyKey];
            Object.keys(globalState.globalCommissionPenalties).forEach(key => {
                const rec = globalState.globalCommissionPenalties[key];
                if (rec && isSameDateStr(rec.date, targetDate) && isRiderMatch(riderName, rec.riderName || key.split('_')[0])) {
                    delete globalState.globalCommissionPenalties[key];
                }
            });
        }
        showToast(`✅ Penalty removed for ${riderName}`);
        refreshCommissionView();
    });
}

/**
 * Waives an automated early shift-out penalty surcharge for a rider on a given date.
 */
export async function waiveEarlyShiftPenalty(riderName, riderId, targetDate) {
    if (!checkIsAdmin()) return showToast("⚠️ Admin access required to waive penalty.");

    openSlideDeleteModal(
        `Waive Early Shift Penalty?`,
        `Sigurado ka bang nais mong tanggalin ang early shift penalty ni [${riderName}] para sa ${targetDate}?`,
        async () => {
            const cleanRider = (riderName || "").toLowerCase().trim();
            const rId = (riderId || "").toString().trim();

            if (db && rId) {
                await db.ref(`logins/${rId}`).update({
                    earlyShiftPenaltyPercent: 0,
                    deficitHours: 0
                }).catch(() => {});

                await db.ref(`roster/${rId}`).update({
                    commissionSurcharge: 0,
                    earlyShiftDeficitHours: 0
                }).catch(() => {});
            }

            if (globalState.globalLogins) {
                globalState.globalLogins.forEach(l => {
                    const idMatch = rId && (l.riderId || l.id || "").toString().trim() === rId;
                    const nameMatch = isRiderMatch(cleanRider, (l.riderName || "").toLowerCase());
                    if (isSameDateStr(l.date, targetDate) && (idMatch || nameMatch)) {
                        l.earlyShiftPenaltyPercent = 0;
                        l.deficitHours = 0;
                    }
                });
            }

            if (globalState.rosterMembers) {
                const rMem = globalState.rosterMembers.find(m => 
                    isRiderMatch(cleanRider, (m.riderName || m.name || "").toLowerCase(), rId, (m.telegramId || m.id || "").toString())
                );
                if (rMem) {
                    rMem.commissionSurcharge = 0;
                    rMem.earlyShiftDeficitHours = 0;
                }
            }

            saveRosterCache();
            showToast(`✅ Early shift penalty waived for ${riderName}!`);
            refreshCommissionView();
            window.dispatchEvent(new CustomEvent('rosterUpdated'));
            window.dispatchEvent(new CustomEvent('loginsUpdated'));
        }
    );
}

export function promptAdminAddCommissionRecord() {
    if (!checkIsAdmin()) return showToast("⚠️ Admin access required.");

    const modal = document.getElementById('admin-add-comm-modal');
    const riderSelect = document.getElementById('manual-comm-rider-select');
    const custInput = document.getElementById('manual-comm-cust-input');
    const feeInput = document.getElementById('manual-comm-fee-input');
    const dateInput = document.getElementById('manual-comm-date-input');

    if (!modal || !riderSelect) return;

    const cleanRiders = getCleanRiderList();
    let optionsHtml = "";
    cleanRiders.forEach(name => {
        optionsHtml += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
    });
    riderSelect.innerHTML = optionsHtml;

    if (custInput) custInput.value = "";
    if (feeInput) feeInput.value = "";
    if (dateInput) dateInput.value = viewSettings.dateValue || getLocalTodayStr();

    modal.classList.remove('hidden');
}

export function closeAdminAddCommModal() {
    const modal = document.getElementById('admin-add-comm-modal');
    if (modal) modal.classList.add('hidden');
}

export async function submitAdminAddCommissionRecord() {
    const riderSelect = document.getElementById('manual-comm-rider-select');
    const custInput = document.getElementById('manual-comm-cust-input');
    const feeInput = document.getElementById('manual-comm-fee-input');
    const dateInput = document.getElementById('manual-comm-date-input');

    const rNameInput = riderSelect ? riderSelect.value.trim() : "";
    const cNameInput = custInput ? custInput.value.trim() : "";
    const grossFee = feeInput ? parseFloat(feeInput.value) : NaN;
    const dateVal = dateInput ? dateInput.value : getLocalTodayStr();

    if (!rNameInput) return showToast("⚠️ Please select a rider.");
    if (!cNameInput) return showToast("⚠️ Please enter customer name.");
    if (isNaN(grossFee) || grossFee <= 0) return showToast("⚠️ Please enter a valid gross fee.");

    const timeVal = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const cleanRiderKey = rNameInput.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanCustKey = cNameInput.toLowerCase().replace(/[^a-z0-9]/g, '');
    const txId = `RCPT_MANUAL_${cleanRiderKey}_${cleanCustKey}_${Date.now()}`;

    const rosterMem = (globalState.rosterMembers || []).find(m => 
        isRiderMatch(rNameInput, m.riderName || m.name || "", "", m.telegramId || m.id)
    );
    const rId = rosterMem ? (rosterMem.telegramId || rosterMem.id || "") : cleanRiderKey;

    const newRecord = {
        id: txId,
        type: "receipts",
        transactionId: txId,
        telegramId: rId,
        riderName: rNameInput,
        customerName: cNameInput,
        cateringStartTime: timeVal,
        totalFees: grossFee,
        date: dateVal,
        fees: { delivery: grossFee }
    };

    if (!globalState.globalDailyReceipts) globalState.globalDailyReceipts = [];
    globalState.globalDailyReceipts.push(newRecord);

    if (db) {
        await db.ref('receipts/' + txId).set(newRecord);
    }

    saveRosterCache();
    closeAdminAddCommModal();
    showToast(`✅ Added ₱${grossFee.toFixed(2)} for ${cNameInput} (${rNameInput})`);
    refreshCommissionView();
    window.dispatchEvent(new CustomEvent('rosterUpdated'));
    window.dispatchEvent(new CustomEvent('receiptsUpdated'));
    window.dispatchEvent(new CustomEvent('cateredUpdated'));
}

export function promptAdminDeleteCommissionRecord(riderName, customerName, dateVal, txId) {
    if (!checkIsAdmin()) return showToast("⚠️ Admin access required.");

    openSlideDeleteModal(
        `Delete Commission Record?`,
        `Sigurado ka bang nais mong burahin ang record ni [${customerName}] (${riderName}) sa ${dateVal}?`,
        () => {
            executeDeleteCommissionRecord(riderName, customerName, dateVal, txId);
        }
    );
}

export async function executeDeleteCommissionRecord(riderName, customerName, dateVal, txId) {
    const cleanRider = (riderName || "").toLowerCase().trim();

    if (txId) {
        if (globalState.globalDailyReceipts) {
            globalState.globalDailyReceipts = globalState.globalDailyReceipts.filter(rc => rc.transactionId !== txId && rc.id !== txId);
        }
        if (globalState.globalCateredHistory) {
            globalState.globalCateredHistory = globalState.globalCateredHistory.filter(ch => ch.transactionId !== txId && ch.id !== txId);
        }

        if (db) {
            await db.ref('receipts/' + txId).remove();
            await db.ref('cateredHistory/' + txId).remove();

            db.ref('receipts').orderByChild('transactionId').equalTo(txId).once('value', (snap) => {
                snap.forEach(child => child.ref.remove());
            });
            db.ref('cateredHistory').orderByChild('transactionId').equalTo(txId).once('value', (snap) => {
                snap.forEach(child => child.ref.remove());
            });
        }
    } else {
        if (globalState.globalDailyReceipts) {
            globalState.globalDailyReceipts = globalState.globalDailyReceipts.filter(rc => {
                const matchRider = (rc.riderName || "").toLowerCase().trim() === cleanRider;
                const matchCust = isCustomerMatch(rc.customerName, customerName);
                const matchDate = isSameDateStr(rc.date || rc.completedDate, dateVal);
                return !(matchRider && matchCust && matchDate);
            });
        }

        if (globalState.globalCateredHistory) {
            globalState.globalCateredHistory = globalState.globalCateredHistory.filter(ch => {
                const matchRider = (ch.riderName || "").toLowerCase().trim() === cleanRider;
                const matchCust = isCustomerMatch(ch.customerName, customerName);
                const matchDate = isSameDateStr(ch.completedDate || ch.date, dateVal);
                return !(matchRider && matchCust && matchDate);
            });
        }

        if (db) {
            const queryDate = dateVal || getLocalTodayStr();
            db.ref('receipts')
                .orderByChild('date')
                .equalTo(queryDate)
                .once('value', (snapshot) => {
                    const data = snapshot.val();
                    if (data) {
                        Object.keys(data).forEach(key => {
                            const item = data[key];
                            const matchRider = (item.riderName || "").toLowerCase().trim() === cleanRider;
                            const matchCust = isCustomerMatch(item.customerName, customerName);
                            if (matchRider && matchCust) {
                                db.ref('receipts/' + key).remove();
                            }
                        });
                    }
                });

            db.ref('cateredHistory')
                .orderByChild('completedDate')
                .equalTo(queryDate)
                .once('value', (snapshot) => {
                    const data = snapshot.val();
                    if (data) {
                        Object.keys(data).forEach(key => {
                            const item = data[key];
                            const matchRider = (item.riderName || "").toLowerCase().trim() === cleanRider;
                            const matchCust = isCustomerMatch(item.customerName, customerName);
                            if (matchRider && matchCust) {
                                db.ref('cateredHistory/' + key).remove();
                            }
                        });
                    }
                });
        }
    }

    saveRosterCache();
    showToast("🗑️ Record deleted successfully!");
    refreshCommissionView();
    window.dispatchEvent(new CustomEvent('rosterUpdated'));
    window.dispatchEvent(new CustomEvent('cateredUpdated'));
    window.dispatchEvent(new CustomEvent('receiptsUpdated'));
}

export function promptAdminEditCustomerFee(riderName, customerName, dateVal, currentGross) {
    if (!checkIsAdmin()) return showToast("⚠️ Admin access required to update fees.");

    const newFeeInput = prompt(`Update Gross Fee for [${customerName}] (${riderName}):`, currentGross || "0.00");
    if (newFeeInput === null) return;

    const parsedFee = parseFloat(newFeeInput);
    if (isNaN(parsedFee) || parsedFee < 0) return showToast("⚠️ Invalid fee amount entered.");

    const cleanRider = riderName.toLowerCase().trim();

    (globalState.globalDailyReceipts || []).forEach(rc => {
        const matchRider = (rc.riderName || "").toLowerCase().trim() === cleanRider;
        const matchCust = isCustomerMatch(rc.customerName, customerName);
        const matchDate = isSameDateStr(rc.date || rc.completedDate, dateVal);
        if (matchRider && matchCust && matchDate) {
            rc.totalFees = parsedFee;
        }
    });

    if (db) {
        const queryDate = dateVal || getLocalTodayStr();
        db.ref('receipts')
            .orderByChild('date')
            .equalTo(queryDate)
            .once('value', (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    Object.keys(data).forEach(key => {
                        const item = data[key];
                        const matchRider = (item.riderName || "").toLowerCase().trim() === cleanRider;
                        const matchCust = isCustomerMatch(item.customerName, customerName);
                        if (matchRider && matchCust) {
                            db.ref('receipts/' + key).update({ totalFees: parsedFee });
                        }
                    });
                }
            });
    }

    saveRosterCache();
    showToast(`✅ Fee updated to ₱${parsedFee.toFixed(2)} for ${customerName}!`);
    refreshCommissionView();
    window.dispatchEvent(new CustomEvent('rosterUpdated'));
    window.dispatchEvent(new CustomEvent('cateredUpdated'));
    window.dispatchEvent(new CustomEvent('receiptsUpdated'));
}

if (typeof window !== 'undefined') {
    window.openAdminPenaltyModal = openAdminPenaltyModal;
    window.closeAdminPenaltyModal = closeAdminPenaltyModal;
    window.submitAdminPenalty = submitAdminPenalty;
    window.removeAdminPenalty = removeAdminPenalty;
    window.waiveEarlyShiftPenalty = waiveEarlyShiftPenalty;
    window.promptAdminAddCommissionRecord = promptAdminAddCommissionRecord;
    window.closeAdminAddCommModal = closeAdminAddCommModal;
    window.submitAdminAddCommissionRecord = submitAdminAddCommissionRecord;
    window.promptAdminDeleteCommissionRecord = promptAdminDeleteCommissionRecord;
    window.executeDeleteCommissionRecord = executeDeleteCommissionRecord;
    window.promptAdminEditCustomerFee = promptAdminEditCustomerFee;
}
// REMARKS: COMMISSION_RECORDS_EARLY_SHIFT_WAIVE_MUTATOR_V1_COMPLETE