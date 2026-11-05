// src/features/roster/actions/rosterCateringPrompts.js
import { db } from '../../../config/firebase.js';
import { appState, globalState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { closeCateringModal } from '../../../ui/modals.js';
import { populateCateringCustomerDropdown } from '../../chat/index.js';
import { 
    loadRosterCache,
    parseQueueTime, 
    getRiderTodayGross, 
    sortAvailableRidersByGross, 
    canManageRoster, 
    saveRosterCache,
    sanitizeFirebaseKey,
    isCustomerMatch,
    isRiderMatch
} from '../rosterUtils.js';
import { updateRosterUI } from '../rosterUI.js';
import { canRiderTakeMoreBookings } from '../rosterStatusLimits.js';
import { updateRosterStatusData } from '../rosterStatusCore.js';
import { dismissQueueAlarm } from './rosterAlarms.js';
import { purgeCartSlotForCustomer } from './rosterCateringCompletion.js';

export function promptCateringStatus() {
    if (!globalState.rosterMembers || globalState.rosterMembers.length === 0) {
        loadRosterCache();
    }

    const activeRole = localStorage.getItem('lokalex_active_role');
    const currentId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const currentName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim();
    const isPrivileged = canManageRoster();

    if ((!currentId || !currentName || activeRole !== 'rider') && !isPrivileged) {
        showToast("⚠️ You are not logged in as a rider. Please log in before catering.");
        if (typeof window.switchView === 'function') window.switchView('view-login');
        else if (typeof window.renderViewUI === 'function') window.renderViewUI('view-login');
        return;
    }

    const rosterMembers = globalState.rosterMembers || [];

    const myRecord = rosterMembers.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        if (currentId && mId && mId === currentId) return true;
        if (currentName && mName && mName === currentName.toLowerCase()) return true;
        return false;
    });

    const myId = myRecord ? (myRecord.telegramId || myRecord.id || currentId) : currentId;
    const myName = myRecord ? (myRecord.riderName || myRecord.name || currentName || "Rider") : (currentName || "Rider");

    if (!myId && !myRecord) return showToast("⚠️ Missing Rider identity.");

    if (!isPrivileged) {
        if (!myRecord || myRecord.status === 'End' || !myRecord.status) {
            return showToast("⚠️ You are on End Shift. Please click Available on the roster before catering.");
        }
        if (myRecord.status === 'Cooldown') return showToast("⚠️ You are still on penalty cooldown. Please wait until it ends.");
        if (myRecord.status === 'Break') return showToast("⚠️ You are on Break. Please click Available on the roster before catering.");
    }

    const amIAlreadyCatering = myRecord && myRecord.status === 'Catering';
    const liveAvailableRiders = sortAvailableRidersByGross(rosterMembers.filter(m => m.status === 'Available'));

    if (!canManageRoster() && liveAvailableRiders.length > 0) {
        const firstAvailable = liveAvailableRiders[0];
        const firstId = (firstAvailable?.telegramId || firstAvailable?.id || "").toString().trim();
        const firstGross = getRiderTodayGross(firstAvailable.riderName || firstAvailable.name, firstAvailable.telegramId || firstAvailable.id);
        const firstRiderName = firstAvailable.riderName || firstAvailable.name || 'Rider';

        if (amIAlreadyCatering) {
            showToast(`🚫 There is an available rider in queue: ${firstRiderName} (₱${firstGross.toFixed(0)}) is 1st in line.`);
            openQueueNoticeModal({
                firstRiderName: firstRiderName,
                firstRiderGross: firstGross,
                myPosition: 'Currently Catering (Busy)',
                myGross: getRiderTodayGross(myName, myId),
                amIAlreadyCatering: true,
                reason: `There is an available rider in queue: ${firstRiderName} (₱${firstGross.toFixed(0)}) is 1st in line. Additional bookings cannot be taken while other riders are available.`
            });
            return;
        }
        if (firstId !== myId) {
            const myGross = getRiderTodayGross(myRecord?.riderName || myRecord?.name, myId);
            const myIndex = liveAvailableRiders.findIndex(m => (m.telegramId || m.id || "").toString().trim() === myId);
            showToast(`⚠️ 1st in line: ${firstRiderName} (Gross: ₱${firstGross.toFixed(0)}) vs Yours (₱${myGross.toFixed(0)}).`);
            openQueueNoticeModal({
                firstRiderName: firstRiderName,
                firstRiderGross: firstGross,
                myRank: myIndex !== -1 ? myIndex + 1 : null,
                myGross: myGross,
                reason: `${firstRiderName} is currently 1st in queue to cater customer orders. Please wait for your turn.`
            });
            return;
        }
    }

    const limitCheck = canRiderTakeMoreBookings(myId, myName);
    if (!limitCheck.allowed) {
        const modeLabel = limitCheck.isAuto ? " (Auto Tier based on today's gross income)" : "";
        return showToast(`⚠️ Reached maximum limit of ${limitCheck.maxAllowed} active catering customer(s)${modeLabel}!`);
    }

    try {
        if (typeof populateCateringCustomerDropdown === 'function') {
            populateCateringCustomerDropdown();
        }
    } catch (err) {
        console.warn("Dropdown population error:", err);
    }

    const input = document.getElementById('catering-customer-name') || document.getElementById('admin-cater-cust-name');
    if (input) input.value = "";
    const modal = document.getElementById('catering-modal') || document.getElementById('admin-catering-modal');
    if (modal) modal.classList.remove('hidden');
    if (input) input.focus();
}

export async function confirmCateringStatus(overrideCustName = null, overrideCustId = null) {
    try {
        const activeRole = localStorage.getItem('lokalex_active_role');
        const currentId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
        const currentName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim();
        const isPrivileged = canManageRoster();

        if ((!currentId || !currentName || activeRole !== 'rider') && !isPrivileged) {
            closeCateringModal();
            showToast("⚠️ You are not logged in as a rider. Please log in before catering.");
            if (typeof window.switchView === 'function') window.switchView('view-login');
            else if (typeof window.renderViewUI === 'function') window.renderViewUI('view-login');
            return false;
        }

        const input = document.getElementById('catering-customer-name') || document.getElementById('admin-cater-cust-name');
        const custSelect = document.getElementById('catering-customer-select') || document.getElementById('admin-cater-customer-select');
        const penaltySelect = document.getElementById('catering-penalty-select') || document.getElementById('admin-cater-penalty-select');

        let custName = (typeof overrideCustName === 'string' && overrideCustName.trim() ? overrideCustName.trim() : "") ||
                       (input && input.value ? input.value.trim() : "") || 
                       (custSelect && custSelect.value ? custSelect.value.trim() : "");
        if (!custName || custName.toLowerCase() === 'customer' || custName.toLowerCase() === 'customer name') {
            return showToast("⚠️ Please enter or select a valid customer name.");
        }

        if (!globalState.rosterMembers || globalState.rosterMembers.length === 0) {
            loadRosterCache();
        }
        let liveRoster = globalState.rosterMembers || [];

        let myRecord = liveRoster.find(m => {
            const mId = (m.telegramId || m.id || "").toString().trim();
            const mName = (m.riderName || m.name || "").toString().trim();
            if (currentId && mId && mId === currentId) return true;
            if (currentName && mName && (currentName.toLowerCase() === mName.toLowerCase() || isRiderMatch(currentName, mName, currentId, mId))) return true;
            return false;
        });

        const resolvedId = myRecord ? (myRecord.telegramId || myRecord.id || currentId) : currentId;
        const myName = myRecord ? (myRecord.riderName || myRecord.name || currentName || "Rider") : (currentName || "Rider");

        if (!resolvedId) {
            return showToast("⚠️ Rider identity not found. Please log in first.");
        }

        if (!isPrivileged) {
            if (!myRecord || myRecord.status === 'End' || !myRecord.status) {
                closeCateringModal();
                showToast("⚠️ You are on End Shift. Please click Available on the roster before catering.");
                return false;
            }
            if (myRecord.status === 'Cooldown') {
                closeCateringModal();
                showToast("⚠️ You are still on penalty cooldown.");
                return false;
            }
            if (myRecord.status === 'Break') {
                closeCateringModal();
                showToast("⚠️ You are on Break. Please click Available on the roster before catering.");
                return false;
            }
        }

        let existingCustomers = [];
        let existingTimes = [];

        if (myRecord && myRecord.status === 'Catering' && myRecord.customerName) {
            existingCustomers = myRecord.customerName.split(', ').map(c => c.trim()).filter(Boolean);
            existingTimes = myRecord.startTime ? myRecord.startTime.split(', ').map(t => t.trim()) : [];
        }

        const isAlreadyInList = existingCustomers.some(c => c.toLowerCase() === custName.toLowerCase());

        const amIAlreadyCatering = myRecord && myRecord.status === 'Catering';
        const liveAvailableRiders = sortAvailableRidersByGross(liveRoster.filter(m => m.status === 'Available'));
        const isFirstAvailable = liveAvailableRiders.length > 0 && (liveAvailableRiders[0]?.telegramId || liveAvailableRiders[0]?.id || "").toString().trim() === resolvedId;

        const hasPenalty = penaltySelect && parseInt(penaltySelect.value) > 0;

        const isQueueJump = !isAlreadyInList && liveAvailableRiders.length > 0 && (!isFirstAvailable || amIAlreadyCatering);
        const isBypassingAvailability = !myRecord || (myRecord.status !== 'Available' && !amIAlreadyCatering);
        const isForcedByRole = isPrivileged && (isQueueJump || isBypassingAvailability || hasPenalty);

        if (!isPrivileged && !isAlreadyInList && liveAvailableRiders.length > 0) {
            closeCateringModal();
            const firstAvailable = liveAvailableRiders[0];
            const firstGross = getRiderTodayGross(firstAvailable.riderName || firstAvailable.name, firstAvailable.telegramId || firstAvailable.id);
            const firstRiderName = firstAvailable.riderName || firstAvailable.name || 'Rider';

            if (amIAlreadyCatering) {
                showToast(`🚫 There is an available rider in queue: ${firstRiderName} (₱${firstGross.toFixed(0)}) is 1st in line. Additional bookings cannot be taken while other riders are available.`);
                openQueueNoticeModal({
                    firstRiderName: firstRiderName,
                    firstRiderGross: firstGross,
                    myPosition: 'Currently Catering (Busy)',
                    myGross: getRiderTodayGross(myName, resolvedId),
                    amIAlreadyCatering: true,
                    reason: `There is an available rider in queue: ${firstRiderName} (₱${firstGross.toFixed(0)}) is 1st in line. Additional bookings cannot be taken while other riders are available.`
                });
                return false;
            }

            if (!isFirstAvailable) {
                const myGross = getRiderTodayGross(myName, resolvedId);
                const myIndex = liveAvailableRiders.findIndex(m => (m.telegramId || m.id || "").toString().trim() === resolvedId);
                showToast(`🚫 Someone is ahead of you in queue: ${firstRiderName} (₱${firstGross.toFixed(0)}) is 1st in line.`);
                openQueueNoticeModal({
                    firstRiderName: firstRiderName,
                    firstRiderGross: firstGross,
                    myRank: myIndex !== -1 ? myIndex + 1 : null,
                    myGross: myGross,
                    reason: `${firstRiderName} (₱${firstGross.toFixed(0)}) is currently 1st in line to cater customer orders. Please wait for your turn.`
                });
                return false;
            }
        }

        if (!isAlreadyInList) {
            const limitCheck = canRiderTakeMoreBookings(resolvedId, myName);
            if (!limitCheck.allowed) {
                const modeLabel = limitCheck.isAuto ? " (Auto Income Tier Limit)" : "";
                showToast(`⚠️ Reached maximum limit of ${limitCheck.maxAllowed} active catering customer(s)${modeLabel}!`);
                return false;
            }
        }

        closeCateringModal();
        const modalGeneral = document.getElementById('admin-catering-modal');
        if (modalGeneral) modalGeneral.classList.add('hidden');
        dismissQueueAlarm();

        const startTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (!isAlreadyInList) {
            existingCustomers.push(custName);
            existingTimes.push(startTime);
            // Ensure any previous locked cart from earlier orders for this customer is reset fresh
            purgeCartSlotForCustomer(custName);
        }

        const cleanCustKey = sanitizeFirebaseKey(custName);

        let forcedCatersMap = {};
        if (myRecord && myRecord.forcedCaters && typeof myRecord.forcedCaters === 'object') {
            forcedCatersMap = { ...myRecord.forcedCaters };
        }

        if (isForcedByRole && resolvedId && cleanCustKey) {
            const forcedPayload = {
                customerName: custName,
                forcedBy: myName,
                isSelfForced: true,
                timestamp: Date.now()
            };

            forcedCatersMap[cleanCustKey] = forcedPayload;

            if (myRecord) {
                myRecord.forcedCaters = forcedCatersMap;
                myRecord.forcedBy = myName;
                myRecord.isForcedCater = true;
            }

            if (db) {
                db.ref(`roster/${resolvedId}/forcedCaters/${cleanCustKey}`).set(forcedPayload).catch(() => {});
                db.ref(`roster/${resolvedId}`).update({
                    forcedBy: myName,
                    isForcedCater: true
                }).catch(() => {});
            }
        } else if (!isForcedByRole && resolvedId && cleanCustKey) {
            delete forcedCatersMap[cleanCustKey];

            if (db) {
                db.ref(`roster/${resolvedId}/forcedCaters/${cleanCustKey}`).remove().catch(() => {});
            }
        }

        const hasAnyForcedCaters = Object.keys(forcedCatersMap).length > 0;
        if (!hasAnyForcedCaters && myRecord) {
            myRecord.forcedCaters = null;
            myRecord.forcedBy = null;
            myRecord.isForcedCater = false;
            if (db && resolvedId) {
                db.ref(`roster/${resolvedId}`).update({
                    forcedBy: null,
                    isForcedCater: false
                }).catch(() => {});
            }
        }

        const isStartingShift = !myRecord || !myRecord.status || myRecord.status === 'End';

        if (myRecord) {
            myRecord.status = 'Catering';
            myRecord.customerName = existingCustomers.join(', ');
            myRecord.startTime = existingTimes.join(', ');
            myRecord.forcedCaters = hasAnyForcedCaters ? forcedCatersMap : null;
            myRecord.forcedBy = hasAnyForcedCaters ? (myRecord?.forcedBy || myName) : null;
            myRecord.isForcedCater = hasAnyForcedCaters;
        }

        await updateRosterStatusData(
            'Catering', 
            existingCustomers.join(', '), 
            existingTimes.join(', '), 
            myRecord ? parseQueueTime(myRecord.queueTime) : Date.now(),
            resolvedId,
            myName,
            [],
            isStartingShift,
            "",
            { 
                forcedCaters: hasAnyForcedCaters ? forcedCatersMap : null,
                forcedBy: hasAnyForcedCaters ? (myRecord?.forcedBy || myName) : null,
                isForcedCater: hasAnyForcedCaters
            }
        );

        saveRosterCache();
        updateRosterUI();

        if (db && custName) {
            const cleanSearchName = custName.toLowerCase().trim();
            const applyChatCaterUpdate = (targetChatId) => {
                if (!targetChatId || !db) return;
                if (targetChatId.toString().toLowerCase() === 'customer' || targetChatId.toString().toLowerCase() === 'customer name') return;
                const updateObj = {
                    folder: 'catering',
                    status: 'active',
                    cateredByRiderId: resolvedId,
                    cateredByRiderName: myName,
                    cateredBy: myName,
                    lastUpdated: Date.now()
                };
                if (custName && custName.toLowerCase() !== 'customer') {
                    updateObj.customerName = custName;
                }
                if (isForcedByRole) {
                    updateObj.forcedBy = myName;
                    updateObj.isForcedCater = true;
                } else {
                    updateObj.forcedBy = null;
                    updateObj.isForcedCater = false;
                }
                db.ref(`customerChats/${targetChatId}/metadata`).update(updateObj).catch(() => {});
                db.ref(`customerChatMeta/${targetChatId}`).update(updateObj).catch(() => {});
            };

            const targetChatId = overrideCustId || (custSelect && custSelect.value.trim().toLowerCase() === cleanSearchName ? (custSelect.selectedOptions?.[0]?.dataset?.custId || null) : null);

            if (targetChatId) {
                applyChatCaterUpdate(targetChatId);
                if (typeof window.triggerAutoMessageOnCater === 'function') {
                    window.triggerAutoMessageOnCater(targetChatId, custName, myName);
                }
            } else {
                db.ref('customerChatMeta').once('value', (snapshot) => {
                    const chats = snapshot.val();
                    if (chats) {
                        Object.keys(chats).forEach(custId => {
                            const meta = chats[custId]?.metadata || chats[custId] || {};
                            // If returning customer was previously done or completed, reactivate into catering!
                            if (meta.status === 'voided') {
                                const lastVoid = Number(meta.lastUpdated || meta.completedAt || 0);
                                if (Date.now() - lastVoid < 60000) return;
                            }

                            const chatCustName = (meta.customerName || meta.name || "").toLowerCase().trim();
                            const resolvedFb = typeof window.getResolvedFbName === 'function' ? window.getResolvedFbName(custId) : null;
                            const fbName = (resolvedFb?.name || "").toLowerCase().trim();
                            const hasFbName = Boolean(fbName && fbName !== 'customer');

                            const matchesFb = hasFbName && (fbName === cleanSearchName || isCustomerMatch(fbName, cleanSearchName));
                            const matchesMeta = !hasFbName && (chatCustName === cleanSearchName || isCustomerMatch(chatCustName, cleanSearchName));

                            if (matchesFb || matchesMeta) {
                                applyChatCaterUpdate(custId);
                                if (typeof window.triggerAutoMessageOnCater === 'function') {
                                    window.triggerAutoMessageOnCater(custId, custName, myName);
                                }
                            }
                        });
                    }
                });
            }
        }

        // Switch to the catering filter so rider immediately sees customer thread
        if (typeof window.setRiderChatFilter === 'function') {
            window.setRiderChatFilter('catering');
        }

        if (input) input.value = "";

        if (isForcedByRole) {
            showToast(`⚡ Force Catered ${custName} (Self)`);
        } else {
            showToast(`🛵 Catering: ${custName}`);
        }

        return true;
    } catch (err) {
        console.error("Error in confirmCateringStatus:", err);
        showToast("❌ Failed to Cater: " + (err.message || err));
    }
}

/**
 * ============================================================================
 * QUEUE POSITION NOTICE MODAL (PREVENTS CATERING QUEUE JUMPS)
 * ============================================================================
 * Displays a dedicated notice modal informing the rider that they are not the
 * designated rider to cater this customer, showing the 1st in line rider's info.
 */
export function openQueueNoticeModal(options = {}) {
    let modal = document.getElementById('not-first-in-queue-modal');
    if (!modal) return;

    const liveRoster = globalState.rosterMembers || [];
    const liveAvailableRiders = typeof sortAvailableRidersByGross === 'function'
        ? sortAvailableRidersByGross(liveRoster.filter(m => m.status === 'Available'))
        : liveRoster.filter(m => m.status === 'Available');

    const firstAvailable = liveAvailableRiders.length > 0 ? liveAvailableRiders[0] : null;
    const firstId = (firstAvailable?.telegramId || firstAvailable?.id || "").toString().trim();
    const firstRiderName = options.firstRiderName || (firstAvailable ? (firstAvailable.riderName || firstAvailable.name || "Rider") : "Another Rider");

    let firstGross = options.firstRiderGross;
    if (firstGross === undefined || firstGross === null) {
        firstGross = firstAvailable && typeof getRiderTodayGross === 'function'
            ? getRiderTodayGross(firstRiderName, firstId)
            : 0;
    }

    const currentId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const currentName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim();
    const myRecord = liveRoster.find(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        return (currentId && mId === currentId) || (currentName && mName === currentName.toLowerCase());
    });

    const myIndex = liveAvailableRiders.findIndex(m => {
        const mId = (m.telegramId || m.id || "").toString().trim();
        const mName = (m.riderName || m.name || "").toString().trim().toLowerCase();
        return (currentId && mId === currentId) || (currentName && mName === currentName.toLowerCase());
    });

    let myPosText = options.myPosition;
    if (!myPosText) {
        if (myRecord && myRecord.status === 'Catering') {
            myPosText = "Currently Catering (Busy)";
        } else if (myIndex !== -1) {
            myPosText = `#${myIndex + 1} in Queue`;
        } else if (myRecord && myRecord.status) {
            myPosText = `Status: ${myRecord.status}`;
        } else {
            myPosText = "Not in Queue";
        }
    }

    let myGross = options.myGross;
    if (myGross === undefined || myGross === null) {
        myGross = typeof getRiderTodayGross === 'function'
            ? getRiderTodayGross(currentName, currentId)
            : 0;
    }

    const firstRiderEl = document.getElementById('queue-notice-first-rider');
    const firstGrossEl = document.getElementById('queue-notice-first-gross');
    const myPosEl = document.getElementById('queue-notice-my-position');
    const myGrossEl = document.getElementById('queue-notice-my-gross');
    const reasonEl = document.getElementById('queue-notice-reason');
    const subtitleEl = document.getElementById('queue-notice-subtitle');

    if (firstRiderEl) firstRiderEl.textContent = firstRiderName;
    if (firstGrossEl) {
        firstGrossEl.textContent = typeof firstGross === 'number' ? `₱${firstGross.toFixed(2)}` : firstGross;
    }
    if (myPosEl) myPosEl.textContent = myPosText;
    if (myGrossEl) {
        myGrossEl.textContent = typeof myGross === 'number' ? `₱${myGross.toFixed(2)}` : myGross;
    }

    if (reasonEl) {
        if (options.reason) {
            reasonEl.textContent = options.reason;
        } else if (options.amIAlreadyCatering || (myRecord && myRecord.status === 'Catering')) {
            reasonEl.textContent = `There is an available rider waiting in queue (${firstRiderName}). Additional bookings cannot be taken while other riders are available.`;
        } else {
            reasonEl.textContent = `${firstRiderName} is currently 1st in line to cater customer orders. Please wait for your turn in the lineup.`;
        }
    }

    if (subtitleEl) {
        subtitleEl.textContent = `${firstRiderName} is currently designated to cater incoming orders.`;
    }

    try {
        const hasUserActivation = typeof navigator !== 'undefined' && (
            (navigator.userActivation && navigator.userActivation.hasBeenActive) ||
            (!navigator.userActivation && (document.hasFocus ? document.hasFocus() : true))
        );
        if (hasUserActivation && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate([100, 50, 100]);
        }
    } catch {}

    modal.classList.remove('hidden');
}

export function closeQueueNoticeModal() {
    const modal = document.getElementById('not-first-in-queue-modal');
    if (modal) modal.classList.add('hidden');
}

if (typeof window !== 'undefined') {
    window.openQueueNoticeModal = openQueueNoticeModal;
    window.closeQueueNoticeModal = closeQueueNoticeModal;
}
