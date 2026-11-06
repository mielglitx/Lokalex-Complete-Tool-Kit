// src/features/roster/actions/rosterCateringPrompts.js
import { db } from '../../../config/firebase.js';
import { appState, globalState, multiCarts } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { closeCateringModal } from '../../../ui/modals.js';
import { populateCateringCustomerDropdown } from '../../chat/index.js';
import { syncSmartCartsWithCateringCustomers, getCartSlotForCustomer, saveCartState } from '../../cart/cartState.js';
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
        const mName = (m.riderName || m.name || "").toString().trim();
        if (currentId && mId && mId === currentId) return true;
        if (currentName && mName && (currentName.toLowerCase() === mName.toLowerCase() || isRiderMatch(currentName, mName, currentId, mId))) return true;
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
        const firstName = (firstAvailable?.riderName || firstAvailable?.name || "").toString().trim();
        const firstGross = getRiderTodayGross(firstName, firstId);
        const firstRiderName = firstName || 'Rider';
        const isFirstAvailable = (firstId && myId && firstId === myId) || isRiderMatch(myName, firstName, myId, firstId);

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
        if (!isFirstAvailable) {
            const myGross = getRiderTodayGross(myName, myId);
            const myIndex = liveAvailableRiders.findIndex(m => {
                const mId = (m.telegramId || m.id || "").toString().trim();
                const mName = (m.riderName || m.name || "").toString().trim();
                return (mId && myId && mId === myId) || isRiderMatch(myName, mName, myId, mId);
            });
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
        const firstAvailable = liveAvailableRiders.length > 0 ? liveAvailableRiders[0] : null;
        const firstId = (firstAvailable?.telegramId || firstAvailable?.id || "").toString().trim();
        const firstName = (firstAvailable?.riderName || firstAvailable?.name || "").toString().trim();
        const isFirstAvailable = Boolean(firstAvailable && ((firstId && resolvedId && firstId === resolvedId) || isRiderMatch(myName, firstName, resolvedId, firstId)));

        const hasPenalty = penaltySelect && parseInt(penaltySelect.value) > 0;

        const isQueueJump = !isAlreadyInList && liveAvailableRiders.length > 0 && (!isFirstAvailable || amIAlreadyCatering);
        const isBypassingAvailability = !myRecord || (myRecord.status !== 'Available' && !amIAlreadyCatering);
        const isForcedByRole = isPrivileged && (isQueueJump || isBypassingAvailability || hasPenalty);

        if (!isPrivileged && !isAlreadyInList && liveAvailableRiders.length > 0) {
            closeCateringModal();
            const firstGross = getRiderTodayGross(firstName, firstId);
            const firstRiderName = firstName || 'Rider';

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
                const myIndex = liveAvailableRiders.findIndex(m => {
                    const mId = (m.telegramId || m.id || "").toString().trim();
                    const mName = (m.riderName || m.name || "").toString().trim();
                    return (mId && resolvedId && mId === resolvedId) || isRiderMatch(myName, mName, resolvedId, mId);
                });
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

        if (!navigator.onLine) {
            showToast("⚠️ Cannot cater: You are offline. Check internet connection and try again.");
            return false;
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
        } else if (!isForcedByRole && resolvedId && cleanCustKey) {
            delete forcedCatersMap[cleanCustKey];
        }

        const hasAnyForcedCaters = Object.keys(forcedCatersMap).length > 0;

        try {
            await updateRosterStatusData(
                'Catering', 
                existingCustomers.join(', '), 
                existingTimes.join(', '), 
                myRecord ? parseQueueTime(myRecord.queueTime) : Date.now(),
                resolvedId,
                myName,
                [],
                false,
                "",
                { 
                    forcedCaters: hasAnyForcedCaters ? forcedCatersMap : null,
                    forcedBy: hasAnyForcedCaters ? (myRecord?.forcedBy || myName) : null,
                    isForcedCater: hasAnyForcedCaters
                }
            );
        } catch (err) {
            console.error('[confirmCateringStatus] Server update failed:', err);
            try {
                if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
            } catch (_) {}
            showToast(`⚠️ Connection Failed: ${err.message || 'Server did not confirm catering.'} Check signal and try again.`);
            return false;
        }

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

                // Immediately synchronize in-memory cachedCustomerThreadsMap
                if (typeof window.getCachedCustomerThreadsMap === 'function') {
                    const threadMap = window.getCachedCustomerThreadsMap();
                    if (threadMap) {
                        const t = threadMap.get(targetChatId) || threadMap.get(`fb_${targetChatId}`) || threadMap.get(targetChatId.toString().replace(/^fb_/, ''));
                        if (t) {
                            t.folder = 'catering';
                            t.status = 'active';
                            t.cateredByRiderId = resolvedId;
                            t.cateredByRiderName = myName;
                            t.cateredBy = myName;
                            if (updateObj.customerName) t.customerName = updateObj.customerName;
                            t.lastUpdated = updateObj.lastUpdated;
                        }
                    }
                }
            };

            const targetChatId = overrideCustId || (custSelect && custSelect.value.trim().toLowerCase() === cleanSearchName ? (custSelect.selectedOptions?.[0]?.dataset?.custId || null) : null);

            if (targetChatId) {
                applyChatCaterUpdate(targetChatId);
                if (typeof window.triggerAutoMessageOnCater === 'function') {
                    window.triggerAutoMessageOnCater(targetChatId, custName, myName);
                }
                if (typeof window.renderRiderCustomerChatFeed === 'function') {
                    window.renderRiderCustomerChatFeed();
                }
            } else {
                const threadMap = (typeof window.getCachedCustomerThreadsMap === 'function') ? window.getCachedCustomerThreadsMap() : null;
                if (threadMap && threadMap.size > 0) {
                    for (const [custId, meta] of threadMap.entries()) {
                        if (meta.status === 'voided') {
                            const lastVoid = Number(meta.lastUpdated || meta.completedAt || 0);
                            if (Date.now() - lastVoid < 60000) continue;
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
                    }
                    if (typeof window.renderRiderCustomerChatFeed === 'function') {
                        window.renderRiderCustomerChatFeed();
                    }
                }
            }
        }

        // Switch to the catering filter so rider immediately sees customer thread
        if (typeof window.setRiderChatFilter === 'function') {
            window.setRiderChatFilter('catering');
        }

        // Immediately sync smart carts and bind customer to their dedicated cart slot
        try {
            syncSmartCartsWithCateringCustomers();
            const targetSlot = getCartSlotForCustomer(custName);
            if (multiCarts && multiCarts[targetSlot]) {
                multiCarts[targetSlot].customerName = custName;
                multiCarts[targetSlot].isManual = false;
            }
            appState.selectedCateringClient = custName;
            saveCartState();
        } catch(e) {
            console.warn("Cart sync on cater warning:", e);
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
