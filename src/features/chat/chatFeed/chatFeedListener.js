// src/features/chat/chatFeed/chatFeedListener.js
import { db } from '../../../config/firebase.js';
import { globalState } from '../../../store/state.js';
import { showToast, showNativeNotification } from '../../../ui/notifications.js';
import { isCustomerMatch } from '../../roster/rosterUtils.js';
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
import { playChatChime } from '../chatSoundManager.js';
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
    isMyCustomerThread,
    getActiveRosterCaterer,
    isMessengerSource,
    isThreadFromSelectedSource,
    getSourceBadgeName
} from './chatFeedState.js';
import { renderRiderCustomerChatFeed } from './chatFeedRender.js';

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
    if (!isInitialCustomerChatMetaLoad && !isFromCache && data) {
        let shouldPlayInboxChime = false;
        let shouldPlayCateringChime = false;

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
                if (isNewer && isDifferent) {
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
                    newlyArrivedThreadKeys.add(key);
                    // Check if thread belongs to currently selected chat sources
                    if (!isThreadFromSelectedSource(meta, key)) {
                        return;
                    }

                    const isCatered = !!(meta.cateredByRiderName || meta.cateredByRiderId || meta.cateredBy || (meta.folder || '').toLowerCase() === 'catering');
                    let isEligible = false;

                    if (isCatered) {
                        const isMine = isMyCustomerThread({ custId: key, ...meta });
                        if (isMine) {
                            shouldPlayCateringChime = true;
                            isEligible = true;
                        }
                    } else if ((meta.folder || 'inbox').toLowerCase() === 'inbox' || (meta.folder || '').toLowerCase() === 'done') {
                        shouldPlayInboxChime = true;
                        isEligible = true;
                    }

                    if (isEligible) {
                        // Check if the chat modal for this customer is currently open and visible
                        const activeId = (typeof getActiveRiderChatCustId === 'function' ? getActiveRiderChatCustId() : null) || (typeof window !== 'undefined' ? window.activeRiderChatCustId : null);
                        const isChatOpenAndVisible = (activeId === key) && !document.hidden;

                        if (!isChatOpenAndVisible) {
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

        if (shouldPlayCateringChime) {
            playChatChime('catering');
        } else if (shouldPlayInboxChime) {
            playChatChime('inbox');
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
        if (key.startsWith('fb_')) {
            const cached = (typeof getResolvedFbName === 'function') ? getResolvedFbName(key) : null;
            if (cached && cached.name && (!displayName || displayName.startsWith('FB Customer (') || displayName === 'Customer')) {
                displayName = cached.name;
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
        if (!key.startsWith('fb_') && !key.startsWith('messenger_')) {
            const hasRealFbThread = Object.keys(data).some(otherKey => {
                if (!otherKey.startsWith('fb_') && !otherKey.startsWith('messenger_')) return false;
                const otherMeta = (data[otherKey]?.metadata || data[otherKey] || {});
                const otherName = (otherMeta.customerName || otherMeta.name || '').trim();
                return otherName && isCustomerMatch(otherName, displayName);
            });
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
            if (typeof syncFacebookPageFolderStatus === 'function') {
                syncFacebookPageFolderStatus(false).catch(() => {});
            }
            if (typeof autoResolvePendingFacebookThreads === 'function') {
                autoResolvePendingFacebookThreads(allThreads);
            }
        }
    }

    updateInboxUnreadBadge();
    updateDoneUnreadBadge();

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

export function updateInboxUnreadBadge() {
    const inboxBadge = document.getElementById('rider-inbox-unread-badge');
    if (!inboxBadge) return;

    const isAllSources = (typeof isAllSourcesSelected === 'function') ? isAllSourcesSelected() : true;
    const allThreads = Array.from(cachedCustomerThreadsMap.values());

    const unreadInboxCount = allThreads.filter(t => {
        // 1. Must be marked unread
        if (!t.isUnread) return false;

        // 2. Outgoing rider messages can NEVER be unread
        if (t.lastMessage && t.lastMessage.startsWith('You:')) return false;

        // 3. Exclude completed / done / cancelled threads
        const isDone = t.status === 'completed' || t.status === 'done' || t.status === 'cancelled';
        if (isDone) return false;

        // 4. Must be in inbox folder and not catered
        const folder = (t.folder || 'inbox').toLowerCase();
        const isCatered = !!(t.cateredByRiderName || t.cateredByRiderId || t.cateredBy);
        if (folder !== 'inbox' || isCatered) return false;

        // 5. Must match active chat sources filter
        if (typeof isSourceSelected === 'function' && !isAllSources) {
            if (t.channel === 'messenger') {
                const threadFbId = t.apiId || t.channelId || t.fbApiId;
                if (threadFbId) {
                    if (!isSourceSelected(threadFbId)) return false;
                } else {
                    if (!isSourceSelected('messenger') && !hasAnyFbSourceSelected()) return false;
                }
            } else {
                if (!isSourceSelected('web')) return false;
            }
        }

        // 6. Exclude placeholder names without real messages
        const name = (t.customerName || '').trim().toLowerCase();
        if (!name || name === 'customer' || name === 'customer name' || name === 'unknown') return false;

        return true;
    }).length;

    if (unreadInboxCount > 0) {
        inboxBadge.innerText = unreadInboxCount.toString();
        inboxBadge.classList.remove('hidden');
    } else {
        inboxBadge.classList.add('hidden');
    }
}

export function updateDoneUnreadBadge() {
    const doneBadge = document.getElementById('rider-done-unread-badge');
    if (!doneBadge) return;

    const isAllSources = (typeof isAllSourcesSelected === 'function') ? isAllSourcesSelected() : true;
    const allThreads = Array.from(cachedCustomerThreadsMap.values());

    const unreadDoneCount = allThreads.filter(t => {
        // 1. Must be marked unread
        if (!t.isUnread) return false;

        // 2. Outgoing rider messages can NEVER be unread
        if (t.lastMessage && t.lastMessage.startsWith('You:')) return false;

        // 3. Must be in done folder or marked completed/done
        const folder = (t.folder || '').toLowerCase();
        const isDone = folder === 'done' || t.status === 'completed' || t.status === 'done' || t.status === 'cancelled';
        if (!isDone) return false;

        // 4. Must match active chat sources filter
        if (typeof isSourceSelected === 'function' && !isAllSources) {
            if (t.channel === 'messenger') {
                const threadFbId = t.apiId || t.channelId || t.fbApiId;
                if (threadFbId) {
                    if (!isSourceSelected(threadFbId)) return false;
                } else {
                    if (!isSourceSelected('messenger') && !hasAnyFbSourceSelected()) return false;
                }
            } else {
                if (!isSourceSelected('web')) return false;
            }
        }

        // 5. Exclude placeholder names without real messages
        const name = (t.customerName || '').trim().toLowerCase();
        if (!name || name === 'customer' || name === 'customer name' || name === 'unknown') return false;

        return true;
    }).length;

    if (unreadDoneCount > 0) {
        doneBadge.innerText = unreadDoneCount.toString();
        doneBadge.classList.remove('hidden');
    } else {
        doneBadge.classList.add('hidden');
    }
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

    updateInboxUnreadBadge();
    updateDoneUnreadBadge();
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

    updateInboxUnreadBadge();
    updateDoneUnreadBadge();
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

