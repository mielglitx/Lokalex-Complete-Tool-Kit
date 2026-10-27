// src/features/chat/chatFeed/chatFeedListener.js
import { db } from '../../../config/firebase.js';
import { appState, globalState } from '../../../store/state.js';
import { showToast, showNativeNotification } from '../../../ui/notifications.js';
import { isCustomerMatch, cleanCustomerForMatch } from '../../roster/rosterUtils.js';
import { 
    isAllSourcesSelected,
    isSourceSelected,
    hasAnyFbSourceSelected,
    getResolvedFbName,
    autoResolvePendingFacebookThreads,
    syncFacebookPageFolderStatus
} from '../facebookApiAdmin.js';
import { 
    initFullBookingListener, 
    sendFullBookingAutoReply, 
    fullBookingState,
    hasAvailableRiderOnRoster
} from '../fullBookingMode.js';
import { playChatChime, updateFolderMuteIcons } from '../chatSoundManager.js';
import { listenToGlobalStoreChats } from '../riderStoreChat.js';
import { getActiveRiderChatCustId, closeRiderCustomerChatModal } from '../riderChat.js';
import {
    activeRiderChatFilter,
    cachedCustomerThreadsMap,
    setCachedCustomerThreadsMap,
    isCustomerChatMetaListening,
    setIsCustomerChatMetaListening,
    setRawCustomerChatMetaData,
    isInitialCustomerChatMetaLoad,
    setIsInitialCustomerChatMetaLoad,
    lastKnownMessageStateMap,
    lastAutoResolveFbTime,
    setLastAutoResolveFbTime,
    persistMetaTimeout,
    setPersistMetaTimeout,
    getThreadDedupKey,
    getLoggedInRiderInfo,
    isMyCustomerThread,
    getActiveRosterCaterer,
    isMessengerSource,
    isThreadFromSelectedSource,
    getSourceBadgeName
} from './chatFeedState.js';
import { renderRiderCustomerChatFeed } from './chatFeedRender.js';
import { storeChatState } from '../storeChat/storeChatState.js';

export function schedulePersistMetaCache(data) {
    if (persistMetaTimeout) clearTimeout(persistMetaTimeout);
    const timeout = setTimeout(() => {
        try {
            localStorage.setItem('lokalex_cached_customer_chat_meta', JSON.stringify(data));
        } catch (_) {}
    }, 2500);
    setPersistMetaTimeout(timeout);
}

export function processCustomerChatMetaData(data, isFromCache = false) {
    if (!data || typeof data !== 'object') return;
    setRawCustomerChatMetaData(data);
    if (!isFromCache) {
        schedulePersistMetaCache(data);
    }
    const inboxBadge = document.getElementById('rider-inbox-unread-badge');
    const doneBadge = document.getElementById('rider-done-unread-badge');

    if (Object.keys(data).length === 0) {
        cachedCustomerThreadsMap.clear();
        if (inboxBadge) inboxBadge.classList.add('hidden');
        if (doneBadge) doneBadge.classList.add('hidden');
        if (activeRiderChatFilter !== 'stores') {
            renderRiderCustomerChatFeed();
        }
        return;
    }

    // Acoustic notification chimes & Native Notification Bar alerts for incoming messages
    const newlyArrivedThreadKeys = new Set();
    const arrivedFolders = new Set();
    let latestIncomingFolder = '';
    let latestIncomingSender = '';
    let latestIncomingPreview = '';

    if (!isInitialCustomerChatMetaLoad && !isFromCache && data) {
        const loggedInRider = getLoggedInRiderInfo();
        const activeRole = (localStorage.getItem('lokalex_active_role') || (globalState?.userTypesMap?.[loggedInRider.myId] || appState.userType || '')).toLowerCase();
        const isRiderRole = activeRole === 'rider' || Boolean(loggedInRider.myId || loggedInRider.myName);

        Object.keys(data).forEach(key => {
            const item = data[key] || {};
            const meta = item.metadata || item;
            const curLastMsg = (meta.lastMessage || '').trim();
            const curLastUpdated = meta.lastUpdated || 0;
            const prev = lastKnownMessageStateMap.get(key);

            let isIncomingNew = false;
            if (prev) {
                const isNewer = curLastUpdated > prev.lastUpdated;
                const isDifferent = curLastMsg !== prev.lastMessage;
                if (isNewer || (isDifferent && curLastMsg)) {
                    isIncomingNew = true;
                }
            } else {
                // Newly initiated customer thread arriving after initial app load:
                // Only treat as genuine incoming if message was received within the last 3 minutes!
                const isFresh = curLastUpdated && (Date.now() - curLastUpdated < 3 * 60 * 1000);
                if (isFresh) {
                    isIncomingNew = true;
                }
            }

            // Exclude spam or other folders from audio chime and newlyArrivedThreadKeys
            const curFolder = (meta.folder || 'inbox').toLowerCase();
            const isSpam = curFolder === 'spam' || curFolder === 'other' || meta.status === 'spam' || meta.fbFolder === 'spam' || meta.fbFolder === 'other';
            if (isSpam) {
                return;
            }

            if (isIncomingNew && curLastMsg && curLastMsg.toLowerCase() !== 'no messages yet') {
                // Check if from customer (not outgoing rider message)
                const isFromCustomer = !curLastMsg.startsWith('You:') && meta.unreadForRider !== false;
                if (isFromCustomer) {
                    // Check if thread belongs to currently selected chat sources
                    if (!isThreadFromSelectedSource(meta, key)) {
                        return;
                    }

                    let displayName = (meta.customerName || meta.name || "").trim();
                    if (key.startsWith('fb_') && typeof getResolvedFbName === 'function') {
                        const cached = getResolvedFbName(key);
                        if (cached && cached.name && (!displayName || displayName.startsWith('FB Customer ('))) {
                            displayName = cached.name;
                        }
                    }
                    if (!displayName || displayName.toLowerCase() === 'customer' || displayName.toLowerCase() === 'customer name' || displayName.toLowerCase() === 'unknown') {
                        if (key.startsWith('cust_')) {
                            const raw = key.replace(/^cust_/, '').replace(/_/g, ' ').trim();
                            if (raw) {
                                displayName = raw.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                            }
                        }
                    }
                    if (!displayName) displayName = "Customer";

                    const rawFolder = (meta.folder || 'inbox').toLowerCase();
                    const isDone = rawFolder === 'done' || meta.status === 'completed' || meta.status === 'done' || meta.status === 'cancelled';
                    
                    // Always check live roster catering: active roster catering takes precedence!
                    const activeCaterer = getActiveRosterCaterer(displayName, key, meta);
                    const hasCaterer = Boolean(
                        rawFolder === 'catering' ||
                        meta.cateredByRiderName ||
                        meta.cateredByRiderId ||
                        meta.cateredBy ||
                        meta.caterer ||
                        meta.riderName ||
                        meta.riderId ||
                        activeCaterer
                    );
                    const isCatered = !isDone && hasCaterer;
                    const isApplicant = !isDone && !isCatered && (rawFolder === 'applicant' || meta.isApplicant === true);
                    const isFollowup = !isDone && !isCatered && !isApplicant && (rawFolder === 'followup');

                    let targetFolder = 'inbox';
                    if (isDone) targetFolder = 'done';
                    else if (isCatered) targetFolder = 'catering';
                    else if (isApplicant) targetFolder = 'applicant';
                    else if (isFollowup) targetFolder = 'followup';
                    else targetFolder = 'inbox';

                    const threadForCheck = { custId: key, ...meta, customerName: displayName };
                    if (activeCaterer) {
                        threadForCheck.cateredByRiderId = threadForCheck.cateredByRiderId || (activeCaterer.telegramId || activeCaterer.id || "").toString().trim();
                        threadForCheck.cateredByRiderName = threadForCheck.cateredByRiderName || (activeCaterer.riderName || activeCaterer.name || "Rider").toString().trim();
                        threadForCheck.cateredBy = threadForCheck.cateredBy || threadForCheck.cateredByRiderName;
                    }

                    const isMine = isMyCustomerThread(threadForCheck, loggedInRider);

                    let isEligible = false;
                    if (isCatered || targetFolder === 'catering') {
                        // Strictly only the rider actively catering this customer receives alerts!
                        // Never leak other riders' catered orders to anyone.
                        if (isMine) {
                            arrivedFolders.add('catering');
                            isEligible = true;
                        }
                    } else {
                        // Unassigned customer threads: inbox, applicant, followup, done
                        isEligible = true;
                        // Audio chime: only non-rider dispatchers receive general unassigned chimes
                        // Riders on duty must NOT receive alarm chimes for customers that are not their cater
                        if (!isRiderRole) {
                            arrivedFolders.add(targetFolder);
                        }
                    }

                    if (isEligible) {
                        newlyArrivedThreadKeys.add(key);
                        latestIncomingFolder = targetFolder;
                        latestIncomingSender = displayName;
                        latestIncomingPreview = curLastMsg;

                        // Check if the chat modal for this customer is currently open and visible
                        const activeId = (typeof getActiveRiderChatCustId === 'function' ? getActiveRiderChatCustId() : null) || (typeof window !== 'undefined' ? window.activeRiderChatCustId : null);
                        const isChatOpenAndVisible = (activeId === key) && !document.hidden;

                        if (!isChatOpenAndVisible) {
                            const sourceBadge = getSourceBadgeName(meta, key);
                            const notifTitle = `${displayName} • ${sourceBadge}`;

                            let notifBody = curLastMsg;
                            if (notifBody.includes('[Facebook image]') || notifBody.includes('[Facebook attachment]')) {
                                notifBody = "📷 Sent a photo";
                            } else if (notifBody.includes('[Location]') || notifBody.includes('📍')) {
                                notifBody = "📍 Sent a location pin";
                            }

                            showNativeNotification(notifTitle, notifBody, 'chat_' + key, key);
                        }
                    }
                }
            }
        });

        if (arrivedFolders.size > 0) {
            const priority = ['catering', 'inbox', 'followup', 'applicant', 'done'];
            const chosenFolder = priority.find(f => arrivedFolders.has(f)) || Array.from(arrivedFolders)[0];
            if (chosenFolder) {
                playChatChime(chosenFolder);
            }
        }
    }

    // Cache last seen timestamps & message contents
    if (data) {
        Object.keys(data).forEach(key => {
            const item = data[key] || {};
            const meta = item.metadata || item;
            lastKnownMessageStateMap.set(key, {
                lastUpdated: meta.lastUpdated || 0,
                lastMessage: (meta.lastMessage || '').trim()
            });
        });
    }
    if (!isFromCache) {
        setIsInitialCustomerChatMetaLoad(false);
    }

    const threadsMap = new Map();

    // Pre-index Facebook customer names to eliminate O(N^2) quadratic regex loops on mobile devices
    const fbCustomerExactSet = new Set();
    const fbCustomerCleanSet = new Set();
    const fbCustomerNamesList = [];

    Object.keys(data).forEach(k => {
        if (k.startsWith('fb_') || k.startsWith('messenger_')) {
            const m = data[k]?.metadata || data[k] || {};
            let n = (m.customerName || m.name || '').trim();
            if (k.startsWith('fb_') && (!m.linkedDirectoryKey && !m.linkedDirectoryName)) {
                const cached = (typeof getResolvedFbName === 'function') ? getResolvedFbName(k) : null;
                if (cached && cached.name && (!n || n.startsWith('FB Customer (') || n.toLowerCase() === 'customer')) {
                    n = cached.name;
                }
            }
            if (n && n.toLowerCase() !== 'customer' && n.toLowerCase() !== 'customer name' && n.toLowerCase() !== 'unknown') {
                const lower = n.toLowerCase();
                fbCustomerExactSet.add(lower);
                if (typeof cleanCustomerForMatch === 'function') {
                    const clean = cleanCustomerForMatch(n);
                    if (clean) fbCustomerCleanSet.add(clean);
                }
                fbCustomerNamesList.push(n);
            }
        }
    });

    Object.keys(data).forEach(key => {
        const cleanKey = (key || '').trim().toLowerCase();
        // Automatically purge invalid/ghost customer IDs
        if (!cleanKey || cleanKey === 'customer' || cleanKey === 'customer name' || cleanKey === 'undefined' || cleanKey === 'null') {
            if (db && key && !isFromCache) {
                db.ref(`customerChats/${key}`).remove().catch(() => {});
                db.ref(`customerChatMeta/${key}`).remove().catch(() => {});
            }
            return;
        }

        const item = data[key] || {};
        const meta = item.metadata || item;
        const rawLastMsg = (meta.lastMessage || '').trim();
        const hasValidLastMsg = rawLastMsg !== '' && rawLastMsg.toLowerCase() !== 'no messages yet';

        // FULL BOOKING MODE AUTO-REPLY HOOK:
        // Dispatches automated full booking reply ONLY to genuine NEW incoming customer messages in Inbox
        // AND ONLY when ALL riders are unavailable (if an available rider is on roster, skip auto-reply!)
        if (!isInitialCustomerChatMetaLoad && !isFromCache && fullBookingState && fullBookingState.enabled && !hasAvailableRiderOnRoster() && hasValidLastMsg) {
            if (newlyArrivedThreadKeys.has(key)) {
                const threadFolder = (meta.folder || 'inbox').toLowerCase();
                const isSpam = threadFolder === 'spam' || threadFolder === 'other' || meta.status === 'spam' || meta.fbFolder === 'spam' || meta.fbFolder === 'other';
                const isCatered = Boolean(
                    meta.cateredByRiderId ||
                    meta.cateredByRiderName ||
                    meta.cateredBy ||
                    threadFolder === 'catering' ||
                    threadFolder === 'done' ||
                    threadFolder === 'applicant' ||
                    threadFolder === 'followup' ||
                    meta.isApplicant ||
                    meta.status === 'completed' ||
                    meta.status === 'done' ||
                    meta.status === 'cancelled'
                );
                if (threadFolder === 'inbox' && !isCatered && !isSpam) {
                    if (!rawLastMsg.startsWith('You:') && meta.unreadForRider !== false) {
                        sendFullBookingAutoReply(key, meta);
                    }
                }
            }
        }

        let displayName = (meta.customerName || meta.name || "").trim();
        const hasLinkedDirectory = Boolean(meta.linkedDirectoryKey || meta.linkedDirectoryName);
        if (key.startsWith('fb_') && !hasLinkedDirectory) {
            const cached = (typeof getResolvedFbName === 'function') ? getResolvedFbName(key) : null;
            if (cached && cached.name) {
                if (!displayName || displayName.startsWith('FB Customer (') || displayName.toLowerCase() === 'customer') {
                    displayName = cached.name;
                }
            }
        }

        // Auto-extract customer name from key (e.g. cust_christian -> 'Christian')
        const currentCleanName = displayName.toLowerCase();
        if (!displayName || currentCleanName === 'customer' || currentCleanName === 'customer name' || currentCleanName === 'unknown') {
            if (key.startsWith('cust_')) {
                const rawExtracted = key.replace(/^cust_/, '').replace(/_/g, ' ').trim();
                if (rawExtracted) {
                    displayName = rawExtracted.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                }
            }
            // Check live roster forcedCaters for a mapped name
            if (!displayName || displayName.toLowerCase() === 'customer' || displayName.toLowerCase() === 'customer name') {
                const liveRoster = globalState.rosterMembers || [];
                for (const m of liveRoster) {
                    if (m.forcedCaters && typeof m.forcedCaters === 'object') {
                        for (const [fcKey, fcVal] of Object.entries(m.forcedCaters)) {
                            if (fcKey === key) {
                                const fcName = (fcVal && typeof fcVal === 'object' && fcVal.customerName) ? fcVal.customerName : fcVal;
                                if (fcName && typeof fcName === 'string' && fcName.toLowerCase() !== 'customer') {
                                    displayName = fcName.trim();
                                    break;
                                }
                            }
                        }
                    }
                    if (displayName && displayName.toLowerCase() !== 'customer') break;
                }
            }
        }

        const cleanDisplayName = displayName.toLowerCase();
        const isPlaceholderName = !cleanDisplayName || cleanDisplayName === 'customer' || cleanDisplayName === 'customer name' || cleanDisplayName === 'unknown';

        // 1. Exclude non-existing ghost threads:
        // Must have actual message history, and placeholder "Customer" threads with zero messages are discarded!
        if (!hasValidLastMsg) {
            return;
        }
        if (isPlaceholderName && !hasValidLastMsg) {
            return;
        }

        // If this is a non-FB thread (e.g. cust_... or name), check if a real fb_ thread exists for this customer
        if (!key.startsWith('fb_') && !key.startsWith('messenger_') && fbCustomerNamesList.length > 0) {
            const lowerDisplay = (displayName || '').toLowerCase().trim();
            const cleanDisplay = (typeof cleanCustomerForMatch === 'function') ? cleanCustomerForMatch(displayName) : '';
            let hasRealFbThread = fbCustomerExactSet.has(lowerDisplay) || (cleanDisplay && fbCustomerCleanSet.has(cleanDisplay));
            if (!hasRealFbThread && displayName && !isPlaceholderName) {
                hasRealFbThread = fbCustomerNamesList.some(otherName => isCustomerMatch(otherName, displayName));
            }
            if (hasRealFbThread) {
                // Real Facebook Messenger thread already exists! Suppress the duplicate orphaned card
                return;
            }
        }

        if (!displayName) displayName = "Customer";
        let displayAvatar = meta.avatarUrl;
        if (key.startsWith('fb_')) {
            const cached = (typeof getResolvedFbName === 'function') ? getResolvedFbName(key) : null;
            if (cached && cached.avatarUrl) displayAvatar = cached.avatarUrl;
        }

        const isApplicant = Boolean(meta.isApplicant === true || (meta.folder || '').toLowerCase() === 'applicant');
        const isFollowUp = Boolean(!isApplicant && (meta.folder || '').toLowerCase() === 'followup');
        const isAlreadyDone = (meta.status === 'completed' || meta.status === 'done' || meta.status === 'cancelled' || (meta.folder || '').toLowerCase() === 'done');
        const completedAt = Number(meta.completedAt) || 0;
        const lastMsgTime = Number(meta.lastUpdated) || Number(meta.timestamp) || 0;
        const isNewMessageAfterDone = isAlreadyDone && completedAt > 0 && lastMsgTime > (completedAt + 3000) && meta.unreadForRider === true && rawLastMsg && !rawLastMsg.startsWith('You:');

        let isUnread = false;
        if (rawLastMsg && rawLastMsg.startsWith('You:')) {
            // Outgoing rider messages can NEVER be unread
            isUnread = false;
        } else if (isAlreadyDone && !isNewMessageAfterDone && !isApplicant && !isFollowUp) {
            // Completed threads do not show unread badge for old messages
            isUnread = false;
        } else if (meta.unreadForRider === true) {
            isUnread = true;
        } else if (meta.unreadForRider === false) {
            isUnread = false;
        } else if (!isAlreadyDone && rawLastMsg && rawLastMsg.toLowerCase() !== 'no messages yet') {
            isUnread = true;
        }

        let isCompletedStatus = isAlreadyDone && !isNewMessageAfterDone && !isApplicant && !isFollowUp;
        let threadFolder = (meta.folder || 'inbox').toLowerCase();
        if (isApplicant) {
            threadFolder = 'applicant';
        } else if (isFollowUp) {
            threadFolder = 'followup';
        } else if (isCompletedStatus) {
            threadFolder = 'done';
        }

        // Validate catering against live roster: ACTIVE ROSTER CATERING ALWAYS TAKES PRECEDENCE!
        const activeCaterer = getActiveRosterCaterer(displayName, key, meta);
        const isExplicitlyDoneOrCancelled = !activeCaterer && (isCompletedStatus || meta.status === 'cancelled' || meta.status === 'completed' || meta.folder === 'done');

        if (activeCaterer) {
            isCompletedStatus = false;
            threadFolder = 'catering';
            meta.status = 'active';
            meta.cateredByRiderId = (activeCaterer.telegramId || activeCaterer.id || "").toString().trim();
            meta.cateredByRiderName = (activeCaterer.riderName || activeCaterer.name || "Rider").toString().trim();
            meta.cateredBy = meta.cateredByRiderName;
        } else if (isNewMessageAfterDone) {
            // Customer sent a new message! Automatically reactivate thread back to Inbox (or Catering if catered)
            meta.status = 'active';
            threadFolder = activeCaterer ? 'catering' : (isApplicant ? 'applicant' : 'inbox');
            meta.cateredByRiderId = activeCaterer ? (activeCaterer.telegramId || activeCaterer.id || "").toString().trim() : null;
            meta.cateredByRiderName = activeCaterer ? (activeCaterer.riderName || activeCaterer.name || "Rider").toString().trim() : null;
            meta.cateredBy = meta.cateredByRiderName;
        } else if (isCompletedStatus) {
            threadFolder = 'done';
            meta.cateredByRiderId = null;
            meta.cateredByRiderName = null;
            meta.cateredBy = null;
        } else if (globalState.rosterMembers && globalState.rosterMembers.length > 0) {
            // Roster is loaded and NO rider is actively catering this customer!
            const hadStaleCaterer = !!(meta.cateredByRiderName || meta.cateredByRiderId || meta.cateredBy);
            const wasInCatering = threadFolder === 'catering';

            if (hadStaleCaterer || wasInCatering) {
                meta.cateredByRiderId = null;
                meta.cateredByRiderName = null;
                meta.cateredBy = null;
                const isFinished = isCompletedStatus || meta.completedAt || meta.status === 'completed' || meta.status === 'done' || meta.status === 'cancelled';
                if (wasInCatering) {
                    threadFolder = isFinished ? 'done' : (isApplicant ? 'applicant' : (isFollowUp ? 'followup' : 'inbox'));
                }
            }
        }

        const threadObj = {
            custId: key,
            customerName: displayName,
            avatarUrl: displayAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0084FF&color=fff`,
            lastMessage: rawLastMsg || "No messages yet",
            lastUpdated: meta.lastUpdated || 0,
            completedAt: meta.completedAt || (isCompletedStatus ? (Number(meta.lastUpdated) || Date.now()) : null),
            folder: isApplicant ? 'applicant' : (isFollowUp ? 'followup' : threadFolder),
            isApplicant: isApplicant,
            channel: isMessengerSource(meta, key) ? 'messenger' : (meta.channel || 'web'),
            apiId: meta.apiId || meta.channelId || meta.fbApiId || (isMessengerSource(meta, key) ? 'fb_api_1791648211091' : null),
            apiName: meta.apiName || meta.channelName || (isMessengerSource(meta, key) ? 'Camiling FB' : null),
            cateredByRiderId: isCompletedStatus ? null : (meta.cateredByRiderId || null),
            cateredByRiderName: isCompletedStatus ? null : (meta.cateredByRiderName || meta.cateredBy || null),
            status: isApplicant ? 'active' : (meta.status || (isCompletedStatus ? 'completed' : 'active')),
            isUnread: isUnread,
            unreadForRider: meta.unreadForRider === true && !isCompletedStatus,
            hasRealMessages: hasValidLastMsg
        };

        // Cross-reference with live roster so newly incoming threads immediately transition to catering
        {
            const liveRoster = globalState.rosterMembers || [];
            const activeCateringRider = liveRoster.find(m => {
                if (m.status !== 'Catering') return false;
                const tCustName = displayName.toLowerCase().trim();
                if (!tCustName || tCustName === 'customer' || tCustName === 'customer name') return false;
                if (m.customerName && tCustName) {
                    const custs = m.customerName.split(/\s*,\s*/).map(c => c.trim().toLowerCase()).filter(c => c !== 'customer' && c !== 'customer name');
                    if (custs.some(c => c === tCustName || isCustomerMatch(c, displayName))) return true;
                }
                if (m.forcedCaters && typeof m.forcedCaters === 'object') {
                    for (const [fKey, fVal] of Object.entries(m.forcedCaters)) {
                        if (fKey === key && fKey !== 'customer') return true;
                        const fName = (fVal && typeof fVal === 'object' && fVal.customerName) ? fVal.customerName : fKey;
                        const cleanFName = (fName || '').toLowerCase().trim();
                        if (cleanFName !== 'customer' && cleanFName !== 'customer name' && tCustName && isCustomerMatch(fName, tCustName)) return true;
                    }
                }
                return false;
            });
            if (activeCateringRider) {
                threadObj.folder = 'catering';
                threadObj.status = 'active';
                threadObj.cateredByRiderId = (activeCateringRider.telegramId || activeCateringRider.id || "").toString().trim();
                threadObj.cateredByRiderName = (activeCateringRider.riderName || activeCateringRider.name || "Rider").toString().trim();
            }
        }

        const dedupKey = getThreadDedupKey(key, meta);

        // 2. Deduplicate matching customer accounts: keep active thread with real messages and latest update
        if (threadsMap.has(dedupKey)) {
            const existing = threadsMap.get(dedupKey);
            const currentScore = (threadObj.hasRealMessages ? 10000000000000 : 0) + (threadObj.lastUpdated || 0);
            const existingScore = (existing.hasRealMessages ? 10000000000000 : 0) + (existing.lastUpdated || 0);

            if (currentScore > existingScore) {
                threadObj.isUnread = threadObj.isUnread || existing.isUnread;
                threadObj.isApplicant = threadObj.isApplicant || existing.isApplicant;
                if (threadObj.isApplicant && threadObj.folder !== 'catering') {
                    threadObj.folder = 'applicant';
                }
                if (!threadObj.cateredByRiderName && existing.cateredByRiderName && threadObj.folder !== 'done') {
                    threadObj.cateredByRiderName = existing.cateredByRiderName;
                    threadObj.cateredByRiderId = existing.cateredByRiderId;
                    if (existing.folder === 'catering') threadObj.folder = 'catering';
                }
                threadsMap.set(dedupKey, threadObj);
            } else {
                existing.isUnread = existing.isUnread || threadObj.isUnread;
                existing.isApplicant = existing.isApplicant || threadObj.isApplicant;
                if (existing.isApplicant && existing.folder !== 'catering') {
                    existing.folder = 'applicant';
                }
                if (!existing.cateredByRiderName && threadObj.cateredByRiderName && existing.folder !== 'done') {
                    existing.cateredByRiderName = threadObj.cateredByRiderName;
                    existing.cateredByRiderId = threadObj.cateredByRiderId;
                    if (threadObj.folder === 'catering') existing.folder = 'catering';
                }
            }
        } else {
            threadsMap.set(dedupKey, threadObj);
        }
    });

    setCachedCustomerThreadsMap(threadsMap);

    const allThreads = Array.from(threadsMap.values());
    
    // Auto-resolve Facebook customer names & Page folders in the background (throttled to at most once per 3 minutes)
    if (!isFromCache) {
        const now = Date.now();
        if (now - lastAutoResolveFbTime > 180000) {
            setLastAutoResolveFbTime(now);
            setTimeout(() => {
                if (typeof syncFacebookPageFolderStatus === 'function') {
                    syncFacebookPageFolderStatus(false).catch(() => {});
                }
                if (typeof autoResolvePendingFacebookThreads === 'function') {
                    autoResolvePendingFacebookThreads(allThreads);
                }
            }, 25000);
        }
    }

    updateAllChatFolderBadges();

    if (activeRiderChatFilter !== 'stores') {
        renderRiderCustomerChatFeed();
    }

    // Instant thread sync bridge: If a customer thread is currently open and received a new message, sync it now!
    if (!isFromCache && typeof window !== 'undefined' && window.activeRiderChatCustId && typeof window.syncIncomingMessageFromMeta === 'function') {
        const activeCustId = window.activeRiderChatCustId;
        const matchingThread = allThreads.find(t => t.custId === activeCustId || t.id === activeCustId || isCustomerMatch(t.custId, activeCustId));
        if (matchingThread) {
            window.syncIncomingMessageFromMeta(activeCustId, matchingThread);
        }
    }
}

export function listenToAllCustomerChatsForRider() {
    listenToGlobalStoreChats();
    initFullBookingListener();
    updateFolderMuteIcons();

    // 1. INSTANT LOCAL DISK CACHE (0ms - Facebook & Web customer threads load instantly on screen!)
    try {
        const cached = localStorage.getItem('lokalex_cached_customer_chat_meta');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                processCustomerChatMetaData(parsed, true);
            }
        }
    } catch (_) {}

    // 2. FAST PARALLEL DIRECT REST FETCH (<150ms guaranteed on mobile cellular networks)
    const directRestUrl = `https://lokalexoptimized-rtdb-default-rtdb.asia-southeast1.firebasedatabase.app/customerChatMeta.json?t=${Date.now()}`;
    fetch(directRestUrl, { cache: 'no-store' })
        .then(res => res.json())
        .then(data => {
            if (data && typeof data === 'object') {
                processCustomerChatMetaData(data, false);
            }
        })
        .catch(err => {
            console.warn('[CustomerChatMeta] Direct REST fast-fetch fallback:', err);
        });

    if (!db || isCustomerChatMetaListening) return;
    setIsCustomerChatMetaListening(true);

    // 3. REALTIME WEBSOCKET LISTENER FOR INCOMING LIVE MESSAGES
    let metaRafId = null;
    db.ref('customerChatMeta').on('value', (snapshot) => {
        const data = snapshot.val();
        if (metaRafId) cancelAnimationFrame(metaRafId);
        metaRafId = requestAnimationFrame(() => {
            metaRafId = null;
            processCustomerChatMetaData(data, false);
        });
    }, (error) => {
        console.error("Firebase customerChatMeta listener error:", error);
    });
}

export function updateAllChatFolderBadges() {
    const isAllSources = (typeof isAllSourcesSelected === 'function') ? isAllSourcesSelected() : true;
    const allThreads = cachedCustomerThreadsMap ? Array.from(cachedCustomerThreadsMap.values()) : [];

    const counts = {
        inbox: 0,
        catering: 0,
        applicant: 0,
        followup: 0,
        done: 0,
        stores: 0
    };

    allThreads.forEach(t => {
        // 1. Must be marked unread
        if (!t.isUnread) return;

        // 2. Outgoing rider messages can NEVER be unread
        if (t.lastMessage && t.lastMessage.startsWith('You:')) return;

        // 3. Exclude placeholder names without real messages
        const name = (t.customerName || '').trim().toLowerCase();
        if (!name || name === 'customer' || name === 'customer name' || name === 'unknown') return;

        // 4. Must match active chat sources filter
        if (typeof isSourceSelected === 'function' && !isAllSources) {
            if (t.channel === 'messenger') {
                const threadFbId = t.apiId || t.channelId || t.fbApiId;
                if (threadFbId) {
                    if (!isSourceSelected(threadFbId)) return;
                } else {
                    if (!isSourceSelected('messenger') && !hasAnyFbSourceSelected()) return;
                }
            } else {
                if (!isSourceSelected('web')) return;
            }
        }

        const isAlreadyDone = t.status === 'completed' || t.status === 'done' || t.status === 'cancelled';
        const folder = (t.folder || 'inbox').toLowerCase();

        // Check if spam / other
        if (folder === 'spam' || folder === 'other' || t.status === 'spam' || t.fbFolder === 'spam' || t.fbFolder === 'other') {
            return;
        }

        // Determine destination folder
        if (folder === 'done' || isAlreadyDone) {
            counts.done++;
        } else {
            const isCatered = folder === 'catering' || Boolean(t.cateredByRiderName || t.cateredByRiderId || t.cateredBy);
            if (isCatered) {
                counts.catering++;
            } else if (folder === 'applicant' || t.isApplicant === true) {
                counts.applicant++;
            } else if (folder === 'followup') {
                counts.followup++;
            } else {
                counts.inbox++;
            }
        }
    });

    // 5. Stores count from storeChatState
    try {
        if (storeChatState && storeChatState.cachedStoreChatsData) {
            Object.values(storeChatState.cachedStoreChatsData).forEach(val => {
                if (val && val.unreadForRider && !val.isDone && val.status !== 'done') {
                    counts.stores++;
                }
            });
        }
    } catch (_) {}

    // Update DOM badges
    const badgeMap = {
        inbox: ['rider-inbox-unread-badge'],
        catering: ['rider-catering-unread-badge'],
        applicant: ['rider-applicant-unread-badge'],
        followup: ['rider-followup-unread-badge'],
        done: ['rider-done-unread-badge'],
        stores: ['rider-store-unread-badge', 'rider-stores-unread-badge']
    };

    Object.entries(badgeMap).forEach(([folderKey, elementIds]) => {
        const count = counts[folderKey] || 0;
        elementIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (count > 0) {
                    el.innerText = count > 99 ? '99+' : count.toString();
                    el.classList.remove('hidden');
                } else {
                    el.classList.add('hidden');
                }
            }
        });
    });

    return counts;
}

export function updateInboxUnreadBadge() {
    return updateAllChatFolderBadges();
}

export function updateDoneUnreadBadge() {
    return updateAllChatFolderBadges();
}

export function markCustomerChatAsUnread(targetCustId = null) {
    const custId = targetCustId || (window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null);
    if (!custId) return;

    if (db) {
        const payload = { unreadForRider: true };
        db.ref(`customerChats/${custId}/metadata`).update(payload).catch(() => {});
        db.ref(`customerChatMeta/${custId}`).update(payload).catch(() => {});
    }

    // Optimistically update cached thread
    for (const thread of cachedCustomerThreadsMap.values()) {
        if (thread.custId === custId) {
            thread.isUnread = true;
            break;
        }
    }

    updateAllChatFolderBadges();
    if (activeRiderChatFilter !== 'stores') {
        renderRiderCustomerChatFeed();
    }

    const activeId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    if (!targetCustId || (activeId && targetCustId === activeId)) {
        if (typeof closeRiderCustomerChatModal === 'function') {
            closeRiderCustomerChatModal();
        } else if (window.closeRiderCustomerChatModal) {
            window.closeRiderCustomerChatModal();
        }
    }

    showToast("✉️ Chat marked as unread");
}

export function markCustomerChatAsRead(targetCustId = null) {
    const custId = targetCustId || (window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null);
    if (!custId) return;

    if (db) {
        const payload = { unreadForRider: false };
        db.ref(`customerChats/${custId}/metadata`).update(payload).catch(() => {});
        db.ref(`customerChatMeta/${custId}`).update(payload).catch(() => {});
    }

    // Optimistically update cached thread
    for (const thread of cachedCustomerThreadsMap.values()) {
        if (thread.custId === custId) {
            thread.isUnread = false;
            break;
        }
    }

    updateAllChatFolderBadges();
    if (activeRiderChatFilter !== 'stores') {
        renderRiderCustomerChatFeed();
    }

    showToast("✓ Chat marked as read");
}

export function toggleCustomerChatUnread(targetCustId) {
    if (!targetCustId) return;
    let isCurrentlyUnread = false;
    for (const thread of cachedCustomerThreadsMap.values()) {
        if (thread.custId === targetCustId) {
            isCurrentlyUnread = !!thread.isUnread;
            break;
        }
    }

    if (isCurrentlyUnread) {
        markCustomerChatAsRead(targetCustId);
    } else {
        markCustomerChatAsUnread(targetCustId);
    }
}

/**
 * Force refresh Live Chats Feed on demand via fresh REST query and UI re-render.
 */
export async function forceRefreshLiveChatsFeed(btn = null) {
    const icon = btn ? btn.querySelector('i') : null;
    if (icon) icon.classList.add('fa-spin');
    if (btn) btn.disabled = true;

    try {
        const directRestUrl = `https://lokalexoptimized-rtdb-default-rtdb.asia-southeast1.firebasedatabase.app/customerChatMeta.json?t=${Date.now()}`;
        let chatData = null;
        try {
            const res = await fetch(directRestUrl, { cache: 'no-store' });
            if (res.ok) {
                chatData = await res.json();
            }
        } catch (fetchErr) {
            console.warn('[ForceRefreshChat] REST fetch failed:', fetchErr);
        }

        if (!chatData && db) {
            const snap = await db.ref('customerChatMeta').once('value');
            chatData = snap.val();
        }

        if (chatData && typeof chatData === 'object') {
            processCustomerChatMetaData(chatData, false);
        }

        updateAllChatFolderBadges();
        if (activeRiderChatFilter !== 'stores') {
            renderRiderCustomerChatFeed();
        }

        showToast("✓ Live Chat Feed updated!");
    } catch (err) {
        console.error("Force refresh live chat error:", err);
        showToast("⚠️ Failed to refresh chat feed.");
    } finally {
        if (icon) {
            setTimeout(() => {
                icon.classList.remove('fa-spin');
            }, 400);
        }
        if (btn) {
            setTimeout(() => {
                btn.disabled = false;
            }, 500);
        }
    }
}

if (typeof window !== 'undefined') {
    window.forceRefreshLiveChatsFeed = forceRefreshLiveChatsFeed;
    window.updateAllChatFolderBadges = updateAllChatFolderBadges;
    window.updateInboxUnreadBadge = updateInboxUnreadBadge;
    window.updateDoneUnreadBadge = updateDoneUnreadBadge;
    window.markCustomerChatAsRead = markCustomerChatAsRead;
    window.markCustomerChatAsUnread = markCustomerChatAsUnread;
    window.toggleCustomerChatUnread = toggleCustomerChatUnread;
}

