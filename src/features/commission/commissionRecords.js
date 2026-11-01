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

let penaltyRiderMode = 'single'; // 'single' | 'multi' | 'all'
let penaltyDateMode = 'single';   // 'single' | 'range'
let selectedPenaltyRiders = new Set();
let pendingPenaltyPlan = null;

export function getDatesInRange(startStr, endStr) {
    const dates = [];
    if (!startStr) return dates;
    if (!endStr || endStr < startStr) endStr = startStr;
    
    let curr = new Date(startStr + 'T00:00:00');
    const end = new Date(endStr + 'T00:00:00');
    
    let safety = 0;
    while (curr <= end && safety < 60) {
        const y = curr.getFullYear();
        const m = String(curr.getMonth() + 1).padStart(2, '0');
        const d = String(curr.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${d}`);
        curr.setDate(curr.getDate() + 1);
        safety++;
    }
    return dates;
}

export function openAdminPenaltyModal() {
    const modal = document.getElementById('admin-penalty-modal');
    if (!modal) return;

    // Reset to step 1
    const formStep = document.getElementById('penalty-modal-step-form');
    const reviewStep = document.getElementById('penalty-modal-step-review');
    if (formStep) formStep.classList.remove('hidden');
    if (reviewStep) reviewStep.classList.add('hidden');

    const cleanRiders = getCleanRiderList();
    
    // 1. Populate Single Rider Select
    const riderSelect = document.getElementById('penalty-rider-select');
    if (riderSelect) {
        let optionsHtml = '<option value="">-- Select Rider --</option>';
        cleanRiders.forEach(name => {
            optionsHtml += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
        });
        riderSelect.innerHTML = optionsHtml;
    }

    // 2. Populate Multi Rider Checkbox List
    selectedPenaltyRiders.clear();
    const checkboxList = document.getElementById('penalty-riders-checkbox-list');
    if (checkboxList) {
        checkboxList.innerHTML = cleanRiders.map((name, idx) => {
            const uid = `penalty-rider-chk-${idx}`;
            return `
            <label class="flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer text-xs select-none">
                <input type="checkbox" id="${uid}" value="${escapeHtml(name)}" onchange="window.togglePenaltyRiderCheckbox('${escapeHtml(name)}', this.checked)" class="rounded text-red-600 focus:ring-red-500 w-4 h-4 cursor-pointer">
                <span class="font-bold text-gray-900 dark:text-gray-200 flex items-center gap-1.5">
                    <i class="fa-solid fa-motorcycle text-gray-400 text-[10px]"></i>
                    ${escapeHtml(name)}
                </span>
            </label>`;
        }).join('');
    }

    // 3. Dates
    const defaultDate = viewSettings.dateValue || getLocalTodayStr();
    const dateInput = document.getElementById('penalty-date-input');
    const startDateInput = document.getElementById('penalty-start-date-input');
    const endDateInput = document.getElementById('penalty-end-date-input');
    if (dateInput) dateInput.value = defaultDate;
    if (startDateInput) startDateInput.value = defaultDate;
    if (endDateInput) endDateInput.value = defaultDate;
    updatePenaltyDateRangeSummary();

    // 4. Rate & Reason
    const rateInput = document.getElementById('penalty-rate-input');
    const reasonInput = document.getElementById('penalty-reason-input');
    if (rateInput) rateInput.value = "10";
    if (reasonInput) reasonInput.value = "";

    // 5. Reset modes
    setPenaltyRiderMode('single');
    setPenaltyDateMode('single');

    pendingPenaltyPlan = null;
    modal.classList.remove('hidden');
}

export function closeAdminPenaltyModal() {
    const modal = document.getElementById('admin-penalty-modal');
    if (modal) modal.classList.add('hidden');
    pendingPenaltyPlan = null;
}

export function setPenaltyRiderMode(mode) {
    penaltyRiderMode = mode;
    ['single', 'multi', 'all'].forEach(m => {
        const tab = document.getElementById(`penalty-rider-tab-${m}`);
        if (tab) {
            if (m === mode) {
                tab.className = "py-1.5 rounded-lg bg-red-600 text-white font-bold transition shadow cursor-pointer";
            } else {
                tab.className = "py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-bold transition cursor-pointer";
            }
        }
    });

    const singleContainer = document.getElementById('penalty-single-rider-container');
    const multiContainer = document.getElementById('penalty-multi-rider-container');
    const allContainer = document.getElementById('penalty-all-riders-container');
    const countBadge = document.getElementById('penalty-rider-count-badge');

    if (singleContainer) singleContainer.classList.toggle('hidden', mode !== 'single');
    if (multiContainer) {
        multiContainer.classList.toggle('hidden', mode !== 'multi');
        if (mode === 'multi') multiContainer.classList.add('flex');
        else multiContainer.classList.remove('flex');
    }
    if (allContainer) allContainer.classList.toggle('hidden', mode !== 'all');

    if (countBadge) {
        if (mode === 'multi') {
            countBadge.classList.remove('hidden');
            countBadge.innerText = `${selectedPenaltyRiders.size} Selected`;
        } else if (mode === 'all') {
            countBadge.classList.remove('hidden');
            countBadge.innerText = `All Active`;
        } else {
            countBadge.classList.add('hidden');
        }
    }
}

export function setPenaltyDateMode(mode) {
    penaltyDateMode = mode;
    ['single', 'range'].forEach(m => {
        const tab = document.getElementById(`penalty-date-tab-${m}`);
        if (tab) {
            if (m === mode) {
                tab.className = "py-1.5 rounded-lg bg-red-600 text-white font-bold transition shadow cursor-pointer";
            } else {
                tab.className = "py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-bold transition cursor-pointer";
            }
        }
    });

    const singleContainer = document.getElementById('penalty-single-date-container');
    const rangeContainer = document.getElementById('penalty-date-range-container');

    if (singleContainer) singleContainer.classList.toggle('hidden', mode !== 'single');
    if (rangeContainer) {
        rangeContainer.classList.toggle('hidden', mode !== 'range');
        if (mode === 'range') rangeContainer.classList.add('flex');
        else rangeContainer.classList.remove('flex');
    }
    updatePenaltyDateRangeSummary();
}

export function togglePenaltyRiderCheckbox(name, checked) {
    if (checked) {
        selectedPenaltyRiders.add(name);
    } else {
        selectedPenaltyRiders.delete(name);
    }
    updatePenaltyMultiStatus();
}

export function selectAllPenaltyRiders(checked) {
    const list = document.getElementById('penalty-riders-checkbox-list');
    if (!list) return;
    const inputs = list.querySelectorAll('input[type="checkbox"]');
    inputs.forEach(input => {
        const parentLabel = input.closest('label');
        if (!parentLabel || parentLabel.style.display !== 'none') {
            input.checked = checked;
            if (checked) selectedPenaltyRiders.add(input.value);
            else selectedPenaltyRiders.delete(input.value);
        }
    });
    updatePenaltyMultiStatus();
}

export function filterPenaltyRidersList(query) {
    const list = document.getElementById('penalty-riders-checkbox-list');
    if (!list) return;
    const q = (query || "").toLowerCase().trim();
    const labels = list.querySelectorAll('label');
    labels.forEach(label => {
        const text = label.innerText.toLowerCase();
        if (!q || text.includes(q)) {
            label.style.display = 'flex';
        } else {
            label.style.display = 'none';
        }
    });
}

function updatePenaltyMultiStatus() {
    const statusText = document.getElementById('penalty-multi-status-text');
    const countBadge = document.getElementById('penalty-rider-count-badge');
    const count = selectedPenaltyRiders.size;
    if (statusText) statusText.innerText = `${count} selected`;
    if (countBadge && penaltyRiderMode === 'multi') countBadge.innerText = `${count} Selected`;
}

export function setPenaltyRatePreset(rate) {
    const rateInput = document.getElementById('penalty-rate-input');
    if (rateInput) rateInput.value = rate;
}

export function setPenaltyReasonPreset(reason) {
    const reasonInput = document.getElementById('penalty-reason-input');
    if (reasonInput) reasonInput.value = reason;
}

export function updatePenaltyDateRangeSummary() {
    const startInput = document.getElementById('penalty-start-date-input');
    const endInput = document.getElementById('penalty-end-date-input');
    const summary = document.getElementById('penalty-date-range-summary');
    if (!startInput || !endInput || !summary) return;

    const startVal = startInput.value;
    const endVal = endInput.value || startVal;

    if (!startVal) {
        summary.innerText = "Select start date";
        return;
    }

    const dates = getDatesInRange(startVal, endVal);
    const count = dates.length;
    summary.innerText = `${count} day${count === 1 ? '' : 's'} selected (${startVal}${startVal !== endVal ? ' to ' + endVal : ''})`;
}

export function reviewAdminPenalty() {
    const cleanRiders = getCleanRiderList();
    let targetRiders = [];

    if (penaltyRiderMode === 'single') {
        const riderSelect = document.getElementById('penalty-rider-select');
        const rName = riderSelect ? riderSelect.value.trim() : "";
        if (!rName) return showToast("⚠️ Please select a rider from the dropdown.");
        targetRiders = [rName];
    } else if (penaltyRiderMode === 'multi') {
        targetRiders = Array.from(selectedPenaltyRiders);
        if (targetRiders.length === 0) return showToast("⚠️ Please select at least one rider.");
    } else if (penaltyRiderMode === 'all') {
        targetRiders = [...cleanRiders];
        if (targetRiders.length === 0) return showToast("⚠️ No active riders found to penalize.");
    }

    let targetDates = [];
    if (penaltyDateMode === 'single') {
        const dateInput = document.getElementById('penalty-date-input');
        const dVal = dateInput ? dateInput.value : "";
        if (!dVal) return showToast("⚠️ Please select a target date.");
        targetDates = [dVal];
    } else {
        const startInput = document.getElementById('penalty-start-date-input');
        const endInput = document.getElementById('penalty-end-date-input');
        const startVal = startInput ? startInput.value : "";
        const endVal = endInput ? endInput.value : "";
        if (!startVal || !endVal) return showToast("⚠️ Please select both start and end dates.");
        if (startVal > endVal) return showToast("⚠️ Start date cannot be after end date.");
        targetDates = getDatesInRange(startVal, endVal);
        if (targetDates.length === 0) return showToast("⚠️ Invalid date range.");
    }

    const rateInput = document.getElementById('penalty-rate-input');
    const penaltyRate = rateInput ? parseFloat(rateInput.value) : 0;
    if (isNaN(penaltyRate) || penaltyRate <= 0 || penaltyRate > 100) {
        return showToast("⚠️ Please enter a valid penalty percentage between 1% and 100%.");
    }

    const reasonInput = document.getElementById('penalty-reason-input');
    const reason = reasonInput && reasonInput.value.trim() ? reasonInput.value.trim() : "Admin Penalty";

    const totalRecords = targetRiders.length * targetDates.length;

    pendingPenaltyPlan = {
        targetRiders,
        targetDates,
        penaltyRate,
        reason,
        totalRecords
    };

    // Populate Step 2 Review UI
    const ridersDisplay = document.getElementById('penalty-review-riders-display');
    const datesDisplay = document.getElementById('penalty-review-dates-display');
    const rateDisplay = document.getElementById('penalty-review-rate-display');
    const countDisplay = document.getElementById('penalty-review-count-display');
    const reasonDisplay = document.getElementById('penalty-review-reason-display');

    if (ridersDisplay) {
        if (targetRiders.length <= 4) {
            ridersDisplay.innerText = targetRiders.join(', ');
        } else {
            ridersDisplay.innerText = `${targetRiders.slice(0, 3).join(', ')} + ${targetRiders.length - 3} more (${targetRiders.length} riders total)`;
        }
    }

    if (datesDisplay) {
        if (targetDates.length === 1) {
            datesDisplay.innerText = `${targetDates[0]} (Single Day)`;
        } else {
            datesDisplay.innerText = `${targetDates[0]} to ${targetDates[targetDates.length - 1]} (${targetDates.length} days)`;
        }
    }

    if (rateDisplay) rateDisplay.innerText = `+${penaltyRate}% Commission Surcharge`;
    if (countDisplay) countDisplay.innerText = `${totalRecords} record${totalRecords === 1 ? '' : 's'} (${targetRiders.length} rider${targetRiders.length === 1 ? '' : 's'} × ${targetDates.length} day${targetDates.length === 1 ? '' : 's'})`;
    if (reasonDisplay) reasonDisplay.innerText = `"${escapeHtml(reason)}"`;

    // Switch to step 2 review
    const formStep = document.getElementById('penalty-modal-step-form');
    const reviewStep = document.getElementById('penalty-modal-step-review');
    if (formStep) formStep.classList.add('hidden');
    if (reviewStep) reviewStep.classList.remove('hidden');
}

export function penaltyBackToForm() {
    const formStep = document.getElementById('penalty-modal-step-form');
    const reviewStep = document.getElementById('penalty-modal-step-review');
    if (reviewStep) reviewStep.classList.add('hidden');
    if (formStep) formStep.classList.remove('hidden');
}

export async function executeAdminPenaltySubmission() {
    if (!pendingPenaltyPlan) return showToast("⚠️ No pending penalty to apply.");
    const { targetRiders, targetDates, penaltyRate, reason, totalRecords } = pendingPenaltyPlan;

    const penaltyEntries = [];
    const createdBy = (appState.riderName || "Admin").toString().trim();
    const now = Date.now();

    if (!globalState.globalCommissionPenalties) globalState.globalCommissionPenalties = {};

    targetRiders.forEach(rName => {
        const safeName = String(rName || '').toLowerCase().trim().replace(/[.#$\[\]\/]/g, '_');
        const rosterMem = (globalState.rosterMembers || []).find(m => 
            isRiderMatch(rName, m.riderName || m.name || "", "", m.telegramId || m.id)
        );
        const rId = rosterMem ? (rosterMem.telegramId || rosterMem.id || "").toString().trim() : "";

        targetDates.forEach(dStr => {
            const safeDate = String(dStr || '').trim().replace(/[.#$\[\]\/]/g, '_');
            const penaltyKey = `${safeName}_${safeDate}`;
            const record = {
                riderName: String(rName || '').trim(),
                telegramId: String(rId || '').trim(),
                date: String(dStr || '').trim(),
                penaltyPercentage: Number(penaltyRate) || 0,
                reason: String(reason || 'Admin Penalty').trim(),
                createdBy: createdBy || 'Admin',
                createdAt: now
            };

            penaltyEntries.push({ key: penaltyKey, record });
            globalState.globalCommissionPenalties[penaltyKey] = record;
        });
    });

    try {
        if (db) {
            const writePromises = penaltyEntries.map(({ key, record }) => 
                db.ref('commissionPenalties').child(key).set(record)
            );
            await Promise.all(writePromises);
        }
        closeAdminPenaltyModal();
        showToast(`⚖️ Confirmed! Applied +${penaltyRate}% penalty to ${targetRiders.length} rider(s) for ${targetDates.length} day(s) (${totalRecords} record${totalRecords === 1 ? '' : 's'})!`);
        refreshCommissionView();
    } catch (err) {
        console.error("Failed to save penalties:", err);
        showToast(`❌ Failed to apply penalties: ${err.message || "Database error"}`);
    }
}

export function submitAdminPenalty() {
    reviewAdminPenalty();
}

export function removeAdminPenaltyByKey(penaltyKey, riderName, targetDate) {
    const safeKey = String(penaltyKey || '').replace(/[.#$\[\]\/]/g, '_');
    const rec = (globalState.globalCommissionPenalties || {})[penaltyKey] || (globalState.globalCommissionPenalties || {})[safeKey];
    const rName = riderName || (rec ? rec.riderName : "Rider");
    const dStr = targetDate || (rec ? rec.date : "");
    const perc = rec ? rec.penaltyPercentage : "";

    openSlideDeleteModal(
        `Remove Penalty?`,
        `Are you sure you want to remove the +${perc}% commission penalty for ${rName} on ${dStr}?`,
        async () => {
            if (db) {
                await db.ref('commissionPenalties').child(safeKey).remove().catch(() => {});
                if (safeKey !== penaltyKey) {
                    await db.ref('commissionPenalties').child(penaltyKey).remove().catch(() => {});
                }
            }
            if (globalState.globalCommissionPenalties) {
                delete globalState.globalCommissionPenalties[safeKey];
                delete globalState.globalCommissionPenalties[penaltyKey];
            }
            showToast(`✅ Penalty removed for ${rName} on ${dStr}`);
            refreshCommissionView();
        }
    );
}

export function removeAdminPenalty(riderName, targetDate) {
    const safeName = String(riderName || '').toLowerCase().trim().replace(/[.#$\[\]\/]/g, '_');
    const penaltyKey = `${safeName}_${targetDate}`;
    removeAdminPenaltyByKey(penaltyKey, riderName, targetDate);
}

/**
 * Waives an automated early shift-out penalty surcharge for a rider on a given date.
 */
export async function waiveEarlyShiftPenalty(riderName, riderId, targetDate) {
    if (!checkIsAdmin()) return showToast("⚠️ Admin access required to waive penalty.");

    openSlideDeleteModal(
        `Waive Early Shift Penalty?`,
        `Are you sure you want to waive the early shift penalty for [${riderName}] on ${targetDate}?`,
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
        `Are you sure you want to delete the record for [${customerName}] (${riderName}) on ${dateVal}?`,
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

    const cleanCustKey = (customerName || "").toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetRoster = (globalState.rosterMembers || []).find(m => isRiderMatch(cleanRider, m.riderName || m.name));
    if (targetRoster && (targetRoster.telegramId || targetRoster.id) && cleanCustKey) {
        const tId = targetRoster.telegramId || targetRoster.id;
        if (targetRoster.customerFees && targetRoster.customerFees[cleanCustKey]) {
            delete targetRoster.customerFees[cleanCustKey];
        }
        if (db) {
            db.ref(`roster/${tId}/customerFees/${cleanCustKey}`).remove().catch(() => {});
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
    window.setPenaltyRiderMode = setPenaltyRiderMode;
    window.setPenaltyDateMode = setPenaltyDateMode;
    window.togglePenaltyRiderCheckbox = togglePenaltyRiderCheckbox;
    window.selectAllPenaltyRiders = selectAllPenaltyRiders;
    window.filterPenaltyRidersList = filterPenaltyRidersList;
    window.setPenaltyRatePreset = setPenaltyRatePreset;
    window.setPenaltyReasonPreset = setPenaltyReasonPreset;
    window.updatePenaltyDateRangeSummary = updatePenaltyDateRangeSummary;
    window.reviewAdminPenalty = reviewAdminPenalty;
    window.penaltyBackToForm = penaltyBackToForm;
    window.executeAdminPenaltySubmission = executeAdminPenaltySubmission;
    window.submitAdminPenalty = submitAdminPenalty;
    window.removeAdminPenalty = removeAdminPenalty;
    window.removeAdminPenaltyByKey = removeAdminPenaltyByKey;
    window.waiveEarlyShiftPenalty = waiveEarlyShiftPenalty;
    window.promptAdminAddCommissionRecord = promptAdminAddCommissionRecord;
    window.closeAdminAddCommModal = closeAdminAddCommModal;
    window.submitAdminAddCommissionRecord = submitAdminAddCommissionRecord;
    window.promptAdminDeleteCommissionRecord = promptAdminDeleteCommissionRecord;
    window.executeDeleteCommissionRecord = executeDeleteCommissionRecord;
    window.promptAdminEditCustomerFee = promptAdminEditCustomerFee;
}
// REMARKS: COMMISSION_RECORDS_EARLY_SHIFT_WAIVE_MUTATOR_V1_COMPLETE