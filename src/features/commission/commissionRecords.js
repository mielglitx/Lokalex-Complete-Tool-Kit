// src/features/commission/commissionRecords.js
import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { getLocalTodayStr } from '../../utils/helpers.js';
import { showToast } from '../../ui/notifications.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { isAdmin as checkIsAdmin } from '../roster/rosterUtils.js';
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

    const penaltyRecord = {
        riderName: rName,
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
        }
        if (globalState.globalCommissionPenalties) {
            delete globalState.globalCommissionPenalties[penaltyKey];
        }
        showToast(`✅ Penalty removed for ${riderName}`);
        refreshCommissionView();
    });
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

export function submitAdminAddCommissionRecord() {
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

    const newRecord = {
        type: "receipts",
        transactionId: txId,
        telegramId: "",
        riderName: rNameInput,
        customerName: cNameInput,
        cateringStartTime: timeVal,
        totalFees: grossFee,
        date: dateVal,
        fees: { delivery: grossFee }
    };

    if (!globalState.globalDailyReceipts) globalState.globalDailyReceipts = [];
    globalState.globalDailyReceipts.push(newRecord);

    if (db) db.ref('receipts/' + txId).set(newRecord);

    closeAdminAddCommModal();
    showToast(`✅ Added ₱${grossFee.toFixed(2)} for ${cNameInput} (${rNameInput})`);
    refreshCommissionView();
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

export function executeDeleteCommissionRecord(riderName, customerName, dateVal, txId) {
    const cleanRider = (riderName || "").toLowerCase().trim();
    const cleanCust = (customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '');

    if (globalState.globalDailyReceipts) {
        globalState.globalDailyReceipts = globalState.globalDailyReceipts.filter(rc => {
            if (txId && rc.transactionId === txId) return false;
            const matchRider = (rc.riderName || "").toLowerCase().trim() === cleanRider;
            const matchCust = (rc.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCust;
            const matchDate = (rc.date || rc.completedDate) === dateVal;
            return !(matchRider && matchCust && matchDate);
        });
    }

    if (globalState.globalCateredHistory) {
        globalState.globalCateredHistory = globalState.globalCateredHistory.filter(ch => {
            if (txId && ch.transactionId === txId) return false;
            const matchRider = (ch.riderName || "").toLowerCase().trim() === cleanRider;
            const matchCust = (ch.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCust;
            const matchDate = (ch.completedDate || ch.date) === dateVal;
            return !(matchRider && matchCust && matchDate);
        });
    }

    if (db) {
        db.ref('receipts').once('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                Object.keys(data).forEach(key => {
                    const item = data[key];
                    if (txId && (item.transactionId === txId || key === txId)) {
                        db.ref('receipts/' + key).remove();
                    } else {
                        const matchRider = (item.riderName || "").toLowerCase().trim() === cleanRider;
                        const matchCust = (item.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCust;
                        const matchDate = (item.date || item.completedDate) === dateVal;
                        if (matchRider && matchCust && matchDate) {
                            db.ref('receipts/' + key).remove();
                        }
                    }
                });
            }
        });

        db.ref('cateredHistory').once('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                Object.keys(data).forEach(key => {
                    const item = data[key];
                    if (txId && (item.transactionId === txId || key === txId)) {
                        db.ref('cateredHistory/' + key).remove();
                    } else {
                        const matchRider = (item.riderName || "").toLowerCase().trim() === cleanRider;
                        const matchCust = (item.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCust;
                        const matchDate = (item.completedDate || item.date) === dateVal;
                        if (matchRider && matchCust && matchDate) {
                            db.ref('cateredHistory/' + key).remove();
                        }
                    }
                });
            }
        });
    }

    showToast("🗑️ Record deleted successfully!");
    refreshCommissionView();
}

export function promptAdminEditCustomerFee(riderName, customerName, dateVal, currentGross) {
    if (!checkIsAdmin()) return showToast("⚠️ Admin access required to update fees.");

    const newFeeInput = prompt(`Update Gross Fee for [${customerName}] (${riderName}):`, currentGross || "0.00");
    if (newFeeInput === null) return;

    const parsedFee = parseFloat(newFeeInput);
    if (isNaN(parsedFee) || parsedFee < 0) return showToast("⚠️ Invalid fee amount entered.");

    const cleanCustKey = customerName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanRider = riderName.toLowerCase().trim();

    (globalState.globalDailyReceipts || []).forEach(rc => {
        const matchRider = (rc.riderName || "").toLowerCase().trim() === cleanRider;
        const matchCust = (rc.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCustKey;
        if (matchRider && matchCust) {
            rc.totalFees = parsedFee;
        }
    });

    (globalState.globalCateredHistory || []).forEach(ch => {
        const matchRider = (ch.riderName || "").toLowerCase().trim() === cleanRider;
        const matchCust = (ch.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCustKey;
        if (matchRider && matchCust) {
            ch.totalFees = parsedFee;
        }
    });

    if (db) {
        db.ref('receipts').once('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                Object.keys(data).forEach(key => {
                    const item = data[key];
                    const matchRider = (item.riderName || "").toLowerCase().trim() === cleanRider;
                    const matchCust = (item.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCustKey;
                    if (matchRider && matchCust) {
                        db.ref('receipts/' + key).update({ totalFees: parsedFee });
                    }
                });
            }
        });

        db.ref('cateredHistory').once('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                Object.keys(data).forEach(key => {
                    const item = data[key];
                    const matchRider = (item.riderName || "").toLowerCase().trim() === cleanRider;
                    const matchCust = (item.customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '') === cleanCustKey;
                    if (matchRider && matchCust) {
                        db.ref('cateredHistory/' + key).update({ totalFees: parsedFee });
                    }
                });
            }
        });
    }

    showToast(`✅ Fee updated to ₱${parsedFee.toFixed(2)} for ${customerName}!`);
    refreshCommissionView();
}