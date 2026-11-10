// src/features/chat/fbAdmin/fbResolvers.js
import { db, isSupabaseSelected } from '../../../config/firebase.js';
import { globalState } from '../../../store/state.js';
import { isCustomerMatch } from '../../roster/rosterUtils.js';
import { showToast } from '../../../ui/notifications.js';
import { cachedAdminApisMap } from './fbChannels.js';

// In-memory cache & in-flight requests for resolved Facebook customer names
export const fbNameResolutionCache = new Map();
const inFlightFbResolutions = new Map();
let autoResolveDebounceTimer = null;

export function getResolvedFbName(custId) {
    if (!custId) return null;
    const psid = String(custId).replace(/^(?:fb_|messenger_)+/i, '').trim();
    return fbNameResolutionCache.get(psid) || null;
}

/**
 * Resolves the real customer name and avatar from Facebook Graph API.
 * Uses targeted Page Conversations API (`user_id=${psid}`) which works for all public
 * Facebook Messenger customers without requiring User Profile Advanced Access permissions.
 */
export async function resolveFacebookCustomerName(custId, force = false) {
    if (!custId) return null;
    const cleanId = String(custId).trim();
    // Strip ALL leading fb_ / messenger_ repetitions (e.g. fb_fb_...)
    const psid = cleanId.replace(/^(?:fb_|messenger_)+/i, '').trim();
    // Facebook Page-Scoped User ID (PSID) MUST be a numeric string (digits only)
    if (!psid || !/^\d+$/.test(psid)) return null;

    if (!force && fbNameResolutionCache.has(psid)) {
        return fbNameResolutionCache.get(psid);
    }
    if (inFlightFbResolutions.has(psid)) {
        return inFlightFbResolutions.get(psid);
    }

    const resolutionPromise = (async () => {
        try {
            // 1. Retrieve configured Facebook APIs with Page Access Token
            let apiList = Array.from(cachedAdminApisMap.values()).filter(a => a && a.pageAccessToken);
            if (apiList.length === 0 && db) {
                const apiSnap = await db.ref('adminSettings/facebookApis').once('value');
                const apis = apiSnap.val() || {};
                apiList = Object.values(apis).filter(a => a && a.pageAccessToken);
            }

            if (apiList.length === 0) {
                return null;
            }

            for (const api of apiList) {
                const pageId = api.pageId || "1098954353295816";
                const token = (api.pageAccessToken || '').trim();
                if (!token) continue;

                // Method A: Targeted Page Conversations API by user_id
                try {
                    const convEndpoint = pageId 
                        ? `https://graph.facebook.com/v19.0/${pageId}/conversations?user_id=${psid}&fields=participants{id,name,picture.type(large)},senders{id,name,picture.type(large)}&access_token=${token}`
                        : `https://graph.facebook.com/v19.0/me/conversations?user_id=${psid}&fields=participants{id,name,picture.type(large)},senders{id,name,picture.type(large)}&access_token=${token}`;
                    let convResp = await fetch(convEndpoint);
                    if (!convResp.ok && convResp.status !== 400 && pageId) {
                        convResp = await fetch(`https://graph.facebook.com/v19.0/me/conversations?user_id=${psid}&fields=participants{id,name,picture.type(large)},senders{id,name,picture.type(large)}&access_token=${token}`);
                    }
                    if (convResp.ok) {
                        const convData = await convResp.json();
                        let match = null;
                        if (Array.isArray(convData.data) && convData.data.length > 0) {
                            for (const conv of convData.data) {
                                const people = [
                                    ...(conv.participants?.data || []),
                                    ...(conv.senders?.data || [])
                                ];
                                const found = people.find(p => String(p.id) === String(psid));
                                if (found && found.name) {
                                    match = found;
                                    break;
                                }
                            }
                        }

                        // Fallback: If not found in user_id query, check recent page conversations
                        if (!match && pageId) {
                            try {
                                const fallbackResp = await fetch(
                                    `https://graph.facebook.com/v19.0/${pageId}/conversations?fields=participants{id,name,picture.type(large)},senders{id,name,picture.type(large)}&limit=30&access_token=${token}`
                                );
                                if (fallbackResp.ok) {
                                    const fbData = await fallbackResp.json();
                                    if (Array.isArray(fbData?.data)) {
                                        for (const conv of fbData.data) {
                                            const people = [
                                                ...(conv.participants?.data || []),
                                                ...(conv.senders?.data || [])
                                            ];
                                            const found = people.find(p => String(p.id) === String(psid));
                                            if (found && found.name) {
                                                match = found;
                                                break;
                                            }
                                        }
                                    }
                                }
                            } catch (_) {}
                        }

                        if (match && match.name) {
                            const realName = match.name.trim();

                            // Retrieve real Facebook profile picture directly from conversations participant/sender data
                            const realAvatar = (match.picture?.data && !match.picture.data.is_silhouette) ? match.picture.data.url : null;
                            const avatar = realAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(realName)}&background=0084FF&color=fff`;
                            const resolved = { name: realName, avatarUrl: realAvatar || avatar };
                            fbNameResolutionCache.set(psid, resolved);
                            fbNameResolutionCache.set(`fb_${psid}`, resolved);

                            if (typeof window !== 'undefined' && typeof window.getCachedCustomerThreadsMap === 'function') {
                                const threadMap = window.getCachedCustomerThreadsMap();
                                if (threadMap) {
                                    for (const thread of threadMap.values()) {
                                        const tId = String(thread.custId || thread.id || '').replace(/^(?:fb_|messenger_)+/i, '').trim();
                                        if (tId && tId === psid) {
                                            thread.customerName = realName;
                                            thread.name = realName;
                                            if (realAvatar) thread.avatarUrl = realAvatar;
                                        }
                                    }
                                }
                            }

                            if (typeof window !== 'undefined' && typeof window.reconcileCustomerThreadsWithRoster === 'function') {
                                window.reconcileCustomerThreadsWithRoster();
                            }

                            // Update database in the background
                            if (db) {
                                const updatePayload = {
                                    customerName: realName
                                };
                                if (realAvatar) {
                                    updatePayload.avatarUrl = realAvatar;
                                }
                                const canonicalId = `fb_${psid}`;
                                const updateOps = [
                                    db.ref(`customerChatMeta/${canonicalId}`).update(updatePayload),
                                    db.ref(`customerChats/${canonicalId}/metadata`).update(updatePayload)
                                ];
                                if (cleanId !== canonicalId) {
                                    updateOps.push(db.ref(`customerChatMeta/${cleanId}`).remove());
                                    updateOps.push(db.ref(`customerChats/${cleanId}`).remove());
                                }
                                await Promise.all(updateOps).catch(() => {});
                            }
                            return resolved;
                        }
                    }
                } catch (errConv) {
                    console.warn(`[FB Resolver] Conversations lookup error for PSID ${psid}:`, errConv);
                }
            }
        } catch (e) {
            console.error(`[FB Resolver] Failed resolving customer ${cleanId}:`, e);
        } finally {
            inFlightFbResolutions.delete(psid);
        }
        // Cache negative lookup to prevent hammering Graph API on repeated sync intervals
        fbNameResolutionCache.set(psid, {
            name: 'Facebook User',
            avatarUrl: `https://ui-avatars.com/api/?name=FB&background=0084FF&color=fff`
        });
        return null;
    })();

    inFlightFbResolutions.set(psid, resolutionPromise);
    return resolutionPromise;
}

/**
 * Automatically inspects the current list of threads and auto-resolves any
 * Facebook threads that are missing real customer names in the background.
 */
export function autoResolvePendingFacebookThreads(threadsList) {
    if (!Array.isArray(threadsList) || threadsList.length === 0) return;

    if (autoResolveDebounceTimer) {
        clearTimeout(autoResolveDebounceTimer);
    }

    autoResolveDebounceTimer = setTimeout(async () => {
        // Detect duplicates among active FB threads to auto-heal cross-contaminated names
        const nameCounts = new Map();
        threadsList.forEach(t => {
            if (t && (t.custId || t.id || '').startsWith('fb_')) {
                const n = (t.customerName || t.name || '').trim().toLowerCase();
                if (n && n !== 'customer') {
                    nameCounts.set(n, (nameCounts.get(n) || 0) + 1);
                }
            }
        });

        const pending = threadsList.filter(t => {
            if (!t) return false;
            const cid = t.custId || t.id || '';
            if (!cid.startsWith('fb_')) return false;
            const psid = cid.replace(/^(?:fb_|messenger_)+/i, '').trim();
            if (!psid || !/^\d+$/.test(psid)) return false;
            const cached = fbNameResolutionCache.get(psid);
            const name = (t.customerName || t.name || '').trim();
            const hasNoName = !name || name.startsWith('FB Customer (') || name.toLowerCase() === 'customer';
            const hasNoAvatar = !t.avatarUrl || t.avatarUrl.includes('ui-avatars.com');
            const isDuplicateName = (nameCounts.get(name.toLowerCase()) || 0) > 1;
            const isNotCached = !cached;
            return hasNoName || hasNoAvatar || isDuplicateName || isNotCached;
        });

        if (pending.length === 0) return;

        // Process at most 4 items per run to prevent network/Firebase write storms
        const batch = pending.slice(0, 4);
        for (const t of batch) {
            const cid = t.custId || t.id;
            try {
                await resolveFacebookCustomerName(cid);
                await new Promise(r => setTimeout(r, 1500));
            } catch (e) {}
        }
    }, 3000);
}

export async function syncAllFacebookCustomerNames() {
    if (!db) return;
    try {
        showToast("🔄 Checking customer names on Facebook...");

        const apiSnap = await db.ref('adminSettings/facebookApis').once('value');
        const apis = apiSnap.val() || {};
        const apiList = Object.values(apis).filter(a => a && a.pageAccessToken);
        if (apiList.length === 0) {
            return showToast("⚠️ No Facebook API found with Page Access Token.");
        }

        const metaSnap = await db.ref('customerChatMeta').once('value');
        const allMeta = metaSnap.val() || {};

        let updatedCount = 0;

        // 1. Process bulk conversations
        for (const api of apiList) {
            const pageId = api.pageId || "1098954353295816";
            const token = api.pageAccessToken.trim();

            try {
                const convResp = await fetch(
                    `https://graph.facebook.com/v19.0/${pageId}/conversations?fields=participants{id,name,picture.type(large)},senders{id,name,picture.type(large)}&limit=100&access_token=${token}`
                );
                if (convResp.ok) {
                    const convData = await convResp.json();
                    if (Array.isArray(convData.data)) {
                        const nameMap = new Map();
                        const photoMap = new Map();
                        convData.data.forEach(c => {
                            const people = [
                                ...(c.participants?.data || []),
                                ...(c.senders?.data || [])
                            ];
                            people.forEach(p => {
                                if (p.id && String(p.id) !== String(pageId) && p.name) {
                                    const psidKey = String(p.id).trim();
                                    nameMap.set(psidKey, p.name.trim());
                                    if (p.picture?.data?.url && !p.picture.data.is_silhouette) {
                                        photoMap.set(psidKey, p.picture.data.url);
                                    }
                                }
                            });
                        });

                        for (const [custId, item] of Object.entries(allMeta)) {
                            if (!custId.startsWith('fb_')) continue;
                            const psid = custId.replace(/^(?:fb_|messenger_)+/i, '').trim();
                            if (!psid || !/^\d+$/.test(psid)) continue;
                            const currentName = item.customerName || item.metadata?.customerName || '';

                            if (nameMap.has(psid)) {
                                const realName = nameMap.get(psid);
                                const realPhoto = photoMap.get(psid);
                                if (realName && (realName !== currentName || currentName.startsWith('FB Customer (') || (realPhoto && !item.avatarUrl?.includes('fbcdn') && !item.avatarUrl?.includes('fbsbx')))) {
                                    const avatar = realPhoto || `https://ui-avatars.com/api/?name=${encodeURIComponent(realName)}&background=0084FF&color=fff`;
                                    fbNameResolutionCache.set(psid, { name: realName, avatarUrl: avatar });
                                    await Promise.all([
                                        db.ref(`customerChatMeta/${custId}`).update({
                                            customerName: realName,
                                            avatarUrl: avatar
                                        }),
                                        db.ref(`customerChats/${custId}/metadata`).update({
                                            customerName: realName,
                                            avatarUrl: avatar
                                        })
                                    ]).catch(() => {});
                                    item.customerName = realName;
                                    item.avatarUrl = avatar;
                                    updatedCount++;
                                }
                            }
                        }
                    }
                }
            } catch (bulkErr) {
                console.warn("Bulk conversations sync error:", bulkErr);
            }
        }

        // 2. Direct resolution fallback for any remaining FB Customer entries or missing avatars
        for (const [custId, item] of Object.entries(allMeta)) {
            if (!custId.startsWith('fb_')) continue;
            const psid = custId.replace(/^(?:fb_|messenger_)+/i, '').trim();
            if (!psid || !/^\d+$/.test(psid)) continue;
            const currentName = item.customerName || item.metadata?.customerName || '';
            const currentAvatar = item.avatarUrl || item.metadata?.avatarUrl || '';
            const needsName = !currentName || currentName.startsWith('FB Customer (');
            const needsAvatar = !currentAvatar || currentAvatar.includes('ui-avatars.com');
            if (needsName || needsAvatar) {
                const resolved = await resolveFacebookCustomerName(custId, true);
                if (resolved && (resolved.name !== currentName || (resolved.avatarUrl && !resolved.avatarUrl.includes('ui-avatars.com')))) {
                    updatedCount++;
                }
            }
        }

        if (updatedCount > 0) {
            showToast(`✅ Updated ${updatedCount} Facebook profile(s)!`);
        } else {
            showToast("ℹ️ All Facebook customer profiles are already up-to-date.");
        }

        // Also sync folder status (inbox vs done vs spam)
        await syncFacebookPageFolderStatus(false);
    } catch (err) {
        console.error("syncAllFacebookCustomerNames error:", err);
        showToast("⚠️ Failed to sync FB names: " + (err.message || err));
    }
}

/**
 * Syncs chat thread folders between Facebook Page and Lokalex Live Chats Feed:
 * - Facebook Page 'inbox' -> Lokalex folder 'inbox' (status 'active')
 * - Facebook Page 'page_done' -> Lokalex folder 'done' (status 'completed')
 * - Facebook Page 'other' / Spam -> Lokalex folder 'spam' (status 'spam')
 */
export async function syncFacebookPageFolderStatus(showFeedback = false) {
    if (!db) return;
    try {
        const apiSnap = await db.ref('adminSettings/facebookApis').once('value');
        const apis = apiSnap.val() || {};
        const apiList = Object.values(apis).filter(a => a && a.pageAccessToken);
        if (apiList.length === 0) return;

        const metaSnap = await db.ref('customerChatMeta').once('value');
        const allMeta = metaSnap.val() || {};

        let updatedFoldersCount = 0;
        const foldersToQuery = ['inbox', 'page_done', 'other'];
        const batchFolderUpdates = {};

        for (const api of apiList) {
            const pageId = api.pageId || "1098954353295816";
            const token = api.pageAccessToken.trim();

            for (const fbFolderParam of foldersToQuery) {
                try {
                    const convResp = await fetch(
                        `https://graph.facebook.com/v19.0/${pageId}/conversations?folder=${fbFolderParam}&fields=participants,senders,folder,tags,updated_time,unread_count&limit=100&access_token=${token}`
                    );
                    if (!convResp.ok) continue;
                    const convData = await convResp.json();
                    if (!Array.isArray(convData.data)) continue;

                    for (const c of convData.data) {
                        const people = [
                            ...(c.participants?.data || []),
                            ...(c.senders?.data || [])
                        ];
                        const custPerson = people.find(p => p.id && String(p.id) !== String(pageId));
                        if (!custPerson || !custPerson.id) continue;

                        const psid = String(custPerson.id).trim();
                        const custId = `fb_${psid}`;
                        const existingMeta = allMeta[custId] || allMeta[custId]?.metadata;

                        if (!existingMeta) continue;

                        // Check if actively catered by a rider on roster
                        const isCatered = Boolean(
                            existingMeta.cateredByRiderId ||
                            existingMeta.cateredByRiderName ||
                            existingMeta.cateredBy ||
                            (existingMeta.folder && existingMeta.folder.toLowerCase() === 'catering')
                        );
                        const isRosterCatered = (globalState.rosterMembers || []).some(m => {
                            if (m.status !== 'Catering') return false;
                            const custName = (existingMeta.customerName || existingMeta.name || '').trim().toLowerCase();
                            if (m.customerName && custName && custName !== 'customer' && custName !== 'customer name') {
                                const custs = m.customerName.split(/\s*,\s*/).map(c => c.trim().toLowerCase());
                                if (custs.some(c => c === custName || isCustomerMatch(c, custName))) return true;
                            }
                            if (m.forcedCaters && typeof m.forcedCaters === 'object') {
                                if (m.forcedCaters[custId]) return true;
                            }
                            return false;
                        });
                        if (isCatered || isRosterCatered) continue; // Never override active roster catering

                        // Check if tagged as applicant in Lokalex (Applicant folder/tag must NEVER be overridden by Facebook sync)
                        const isApplicant = Boolean(
                            existingMeta.isApplicant === true ||
                            (existingMeta.folder && (existingMeta.folder.toLowerCase() === 'applicant' || existingMeta.folder.toLowerCase() === 'followup'))
                        );
                        if (isApplicant) continue;

                        const isBeingCatered = (existingMeta.folder || '').toLowerCase() === 'catering' || Boolean(existingMeta.cateredByRiderId || existingMeta.cateredByRiderName || existingMeta.cateredBy);
                        if (isBeingCatered) continue;

                        let targetFolder = 'inbox';
                        let targetStatus = 'active';

                        const tagsList = (c.tags?.data || []).map(t => (t.name || '').toLowerCase());

                        if (fbFolderParam === 'page_done' || c.folder === 'page_done' || tagsList.includes('page_done') || tagsList.includes('done')) {
                            targetFolder = 'done';
                            targetStatus = 'completed';
                        } else if (fbFolderParam === 'other' || c.folder === 'other' || tagsList.includes('spam') || tagsList.includes('other')) {
                            targetFolder = 'spam';
                            targetStatus = 'spam';
                        } else {
                            targetFolder = 'inbox';
                            targetStatus = 'active';
                        }

                        const completedAt = Number(existingMeta.completedAt) || 0;
                        const lastMsgTime = Number(existingMeta.lastUpdated) || 0;
                        const rawLastMsg = (existingMeta.lastMessage || '').trim();
                        const hasNewCustomerMsg = Boolean(rawLastMsg && !rawLastMsg.startsWith('You:') && (completedAt <= 0 || lastMsgTime > completedAt || existingMeta.unreadForRider === true));

                        // Check if already completed/done in Lokalex (e.g. from Clear Inbox or rider order completion)
                        const isAlreadyDone = !hasNewCustomerMsg && Boolean(
                            existingMeta.status === 'completed' ||
                            existingMeta.status === 'done' ||
                            existingMeta.status === 'cancelled' ||
                            (existingMeta.folder && existingMeta.folder.toLowerCase() === 'done') ||
                            existingMeta.completedAt ||
                            existingMeta.completedByRiderId ||
                            existingMeta.completedByRiderName
                        );

                        if (isAlreadyDone && (fbFolderParam === 'inbox' || targetFolder === 'inbox')) {
                            // Never resurrect a completed Lokalex thread back to Inbox during a Facebook Page folder poll.
                            // Facebook's /conversations endpoint retains stale unread_count values for app-replied threads
                            // and bumps updated_time on outbound Page/system events. Genuine new customer messages are
                            // handled directly by the real-time webhook and chatFeedListener.
                            continue;
                        }

                        const currentFolder = (existingMeta.folder || 'inbox').toLowerCase();
                        const currentStatus = (existingMeta.status || 'active').toLowerCase();

                        // Safeguard against Facebook Page sync dragging actively messaged or resurrected threads back to Done:
                        if (targetFolder === 'done') {
                            const isCurrentlyActiveInLokalex = (currentFolder === 'inbox' || currentFolder === 'catering') && currentStatus === 'active';
                            if (isCurrentlyActiveInLokalex && (hasNewCustomerMsg || existingMeta.unreadForRider === true)) {
                                continue;
                            }
                        }

                        if (currentFolder !== targetFolder || currentStatus !== targetStatus) {
                            const now = Date.now();
                            // Granular child path updates to prevent wiping customerName, avatarUrl & lastMessage!
                            batchFolderUpdates[`customerChatMeta/${custId}/folder`] = targetFolder;
                            batchFolderUpdates[`customerChatMeta/${custId}/status`] = targetStatus;
                            batchFolderUpdates[`customerChatMeta/${custId}/fbFolder`] = fbFolderParam;
                            batchFolderUpdates[`customerChatMeta/${custId}/lastUpdated`] = existingMeta.lastUpdated || now;

                            batchFolderUpdates[`customerChats/${custId}/metadata/folder`] = targetFolder;
                            batchFolderUpdates[`customerChats/${custId}/metadata/status`] = targetStatus;
                            batchFolderUpdates[`customerChats/${custId}/metadata/fbFolder`] = fbFolderParam;
                            batchFolderUpdates[`customerChats/${custId}/metadata/lastUpdated`] = existingMeta.lastUpdated || now;

                            if (targetFolder === 'done') {
                                const cAt = existingMeta.completedAt || now;
                                batchFolderUpdates[`customerChatMeta/${custId}/completedAt`] = cAt;
                                batchFolderUpdates[`customerChatMeta/${custId}/unreadForRider`] = false;
                                batchFolderUpdates[`customerChats/${custId}/metadata/completedAt`] = cAt;
                                batchFolderUpdates[`customerChats/${custId}/metadata/unreadForRider`] = false;
                            } else if (targetFolder === 'inbox' && isAlreadyDone) {
                                batchFolderUpdates[`customerChatMeta/${custId}/completedAt`] = null;
                                batchFolderUpdates[`customerChatMeta/${custId}/unreadForRider`] = true;
                                batchFolderUpdates[`customerChats/${custId}/metadata/completedAt`] = null;
                                batchFolderUpdates[`customerChats/${custId}/metadata/unreadForRider`] = true;
                            }

                            existingMeta.folder = targetFolder;
                            existingMeta.status = targetStatus;
                            updatedFoldersCount++;
                        }
                    }
                } catch (folderFetchErr) {
                    console.warn(`[FB Sync] Error fetching FB folder ${fbFolderParam}:`, folderFetchErr);
                }
            }
        }

        if (Object.keys(batchFolderUpdates).length > 0 && db) {
            await db.ref().update(batchFolderUpdates).catch(() => {});
        }

        if (updatedFoldersCount > 0) {
            console.log(`[FB Sync] Synchronized ${updatedFoldersCount} Facebook thread(s) with Page folders.`);
            if (showFeedback) {
                showToast(`✅ Synced ${updatedFoldersCount} Facebook chat(s) with Page folders!`);
            }
            if (typeof window.renderRiderCustomerChatFeed === 'function') {
                window.renderRiderCustomerChatFeed();
            }
        } else if (showFeedback) {
            showToast("ℹ️ All Facebook chat folders are already in sync with the Page.");
        }
    } catch (err) {
        console.error("syncFacebookPageFolderStatus error:", err);
        if (showFeedback) showToast("⚠️ Error syncing Facebook Page folders.");
    }
}

const inFlightAttachmentResolutions = new Map();
const resolvedAttachmentMemoryCache = new Map();

/**
 * Resolves a missing image attachment URL from Meta Graph API for a Facebook message
 */
export async function resolveFacebookMessageAttachment(custId, msgId, rawMid, forceFresh = false) {
    if (!custId || !msgId) return null;
    let cleanMid = rawMid || msgId;

    // If cleanMid does not look like a Meta MID, attempt to retrieve the actual Meta MID
    if (typeof cleanMid === 'string' && !cleanMid.startsWith('m_') && !cleanMid.startsWith('mid.') && !cleanMid.startsWith('m_mid.')) {
        if (db && custId) {
            try {
                const snap = await db.ref(`customerChats/${custId}/messages/${msgId}`).once('value');
                const val = snap.val();
                if (val && (val.metaMid || val.mid)) {
                    cleanMid = val.metaMid || val.mid;
                }
            } catch (_) {}
        }
    }

    if (typeof cleanMid === 'string') {
        if (cleanMid.startsWith('m_mid_')) cleanMid = 'm_mid.' + cleanMid.slice(6);
        else if (cleanMid.startsWith('mid_')) cleanMid = 'mid.' + cleanMid.slice(4);
    }
    if (typeof cleanMid !== 'string' || (!cleanMid.startsWith('m_') && !cleanMid.startsWith('mid.') && !cleanMid.startsWith('m_mid.'))) {
        return null;
    }
    const cacheKey = `${custId}_${msgId}`;

    if (forceFresh) {
        resolvedAttachmentMemoryCache.delete(cacheKey);
        resolvedAttachmentMemoryCache.delete(cleanMid);
        try {
            localStorage.removeItem(`fb_att_${cleanMid}`);
            localStorage.removeItem(`fb_att_${msgId}`);
        } catch (_) {}
    } else {
        // 1. Instant check in memory cache (0ms)
        if (resolvedAttachmentMemoryCache.has(cacheKey)) {
            return resolvedAttachmentMemoryCache.get(cacheKey);
        }
        if (resolvedAttachmentMemoryCache.has(cleanMid)) {
            return resolvedAttachmentMemoryCache.get(cleanMid);
        }

        // 2. Instant check in localStorage (0ms across app sessions)
        try {
            const stored = localStorage.getItem(`fb_att_${cleanMid}`) || localStorage.getItem(`fb_att_${msgId}`);
            if (stored) {
                let parsed = null;
                if (stored.startsWith('{')) {
                    try { parsed = JSON.parse(stored); } catch (_) {}
                }
                const res = parsed || stored;
                resolvedAttachmentMemoryCache.set(cacheKey, res);
                resolvedAttachmentMemoryCache.set(cleanMid, res);
                return res;
            }
        } catch (_) {}
    }

    // 3. Deduplicate in-flight network requests
    if (inFlightAttachmentResolutions.has(cacheKey)) {
        return inFlightAttachmentResolutions.get(cacheKey);
    }

    const promise = (async () => {
        try {
            let apiList = Array.from(cachedAdminApisMap.values()).filter(a => a && a.pageAccessToken);
            if (apiList.length === 0 && db) {
                try {
                    const apiSnap = await db.ref('adminSettings/facebookApis').once('value');
                    const apis = apiSnap.val() || {};
                    apiList = Object.values(apis).filter(a => a && a.pageAccessToken);
                } catch (_) {}
            }
            if (apiList.length === 0 && !isSupabaseSelected()) {
                try {
                    const directRestUrl = `https://lokalexoptimized-rtdb-default-rtdb.asia-southeast1.firebasedatabase.app/adminSettings/facebookApis.json?t=${Date.now()}`;
                    const res = await fetch(directRestUrl);
                    if (res.ok) {
                        const val = await res.json();
                        if (val && typeof val === 'object') {
                            apiList = Object.values(val).filter(a => a && a.pageAccessToken);
                            Object.entries(val).forEach(([id, data]) => {
                                if (data) cachedAdminApisMap.set(id, { id, ...data });
                            });
                        }
                    }
                } catch (_) {}
            }
            if (apiList.length === 0) return null;

            // Query tokens in parallel for immediate resolution
            const fetchAttachmentWithToken = async (token) => {
                const cleanToken = (token || '').trim();
                if (!cleanToken) throw new Error("No token");
                const resp = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(cleanMid)}?fields=id,message,attachments{id,mime_type,name,size,file_url,image_data,video_data,payload,subattachments},shares&access_token=${encodeURIComponent(cleanToken)}`);
                if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
                const data = await resp.json();
                const attachments = data?.attachments?.data || (data?.attachments?.id ? [data.attachments] : []);
                const images = [];
                let audioUrl = null;
                let videoUrl = null;
                let docUrl = null;

                const inspect = (att) => {
                    if (!att) return;
                    const attType = (att.type || '').toLowerCase();
                    const mime = (att.mime_type || '').toLowerCase();
                    const u = att?.image_data?.url || 
                              att?.video_data?.url || 
                              att?.audio_data?.url || 
                              att?.payload?.url || 
                              att?.media?.image?.src || 
                              att?.file_url;
                    
                    if (attType === 'audio' || attType === 'voice' || mime.includes('audio') || (typeof u === 'string' && (/\.(aac|mp3|m4a|wav|ogg|opus)(\?|$)/i.test(u) || u.includes('audioclip')))) {
                        if (u && !audioUrl) audioUrl = u;
                        return;
                    }
                    if (attType === 'video' || mime.includes('video') || (typeof u === 'string' && (/\.(mp4|mov|webm|3gp|mkv)(\?|$)/i.test(u) || u.includes('video.xx.fbcdn.net') || u.includes('/m483/') || u.includes('/v/t2/')))) {
                        if (u && !videoUrl) videoUrl = u;
                        return;
                    }
                    if (attType === 'file' || (typeof u === 'string' && /\.(pdf|docx?|xlsx?|csv|zip|rar|txt)(\?|$)/i.test(u))) {
                        if (u && !docUrl) docUrl = u;
                        return;
                    }

                    // Check subattachments for multiple images sent in a single batch
                    if (att.subattachments?.data && Array.isArray(att.subattachments.data)) {
                        for (const sub of att.subattachments.data) {
                            const subUrl = sub?.image_data?.url || sub?.video_data?.url || sub?.audio_data?.url || sub?.media?.image?.src || sub?.payload?.url || sub?.file_url;
                            if (subUrl && !images.includes(subUrl)) images.push(subUrl);
                        }
                    }

                    if (u && !images.includes(u)) {
                        images.push(u);
                    }
                };

                for (const att of attachments) {
                    inspect(att);
                }

                if (images.length === 0 && !audioUrl && !videoUrl && !docUrl) {
                    if (data?.message && typeof data.message === 'string' && data.message.trim() && !data.message.includes('[Message unavailable')) {
                        return {
                            text: data.message.trim(),
                            type: 'text'
                        };
                    }
                    throw new Error("No attachments found");
                }

                return {
                    images: images,
                    imageUrl: images[0] || null,
                    audioUrl: audioUrl || null,
                    videoUrl: videoUrl || null,
                    fileUrl: docUrl || null,
                    type: audioUrl ? 'audio' : (videoUrl ? 'video' : (docUrl ? 'file' : 'image'))
                };
            };

            const promises = apiList
                .map(api => (api.pageAccessToken || '').trim())
                .filter(Boolean)
                .map(token => fetchAttachmentWithToken(token));

            if (promises.length === 0) return null;

            let resolvedResult = null;
            try {
                resolvedResult = await Promise.any(promises);
            } catch (_) {
                resolvedResult = null;
            }

            if (resolvedResult) {
                // Populate caches immediately
                resolvedAttachmentMemoryCache.set(cacheKey, resolvedResult);
                resolvedAttachmentMemoryCache.set(cleanMid, resolvedResult);
                try {
                    localStorage.setItem(`fb_att_${cleanMid}`, JSON.stringify(resolvedResult));
                    localStorage.setItem(`fb_att_${msgId}`, JSON.stringify(resolvedResult));
                } catch (_) {}

                // Pre-warm browser image cache
                if (resolvedResult.images && resolvedResult.images.length > 0) {
                    resolvedResult.images.forEach(imgUrl => {
                        try {
                            const preloader = new Image();
                            preloader.src = imgUrl;
                        } catch (_) {}
                    });
                }

                // Update Firebase RTDB so all clients receive direct URLs
                if (db) {
                    const rtdbUpdate = {
                        type: resolvedResult.type
                    };
                    if (resolvedResult.text) rtdbUpdate.text = resolvedResult.text;
                    if (resolvedResult.imageUrl) rtdbUpdate.imageUrl = resolvedResult.imageUrl;
                    if (resolvedResult.images && resolvedResult.images.length > 0) rtdbUpdate.images = resolvedResult.images;
                    if (resolvedResult.audioUrl) rtdbUpdate.audioUrl = resolvedResult.audioUrl;
                    if (resolvedResult.videoUrl) rtdbUpdate.videoUrl = resolvedResult.videoUrl;
                    if (resolvedResult.fileUrl) rtdbUpdate.fileUrl = resolvedResult.fileUrl;

                    db.ref(`customerChats/${custId}/messages/${msgId}`).update(rtdbUpdate).catch(() => {});
                }
                return resolvedResult;
            }
        } catch (e) {
            console.warn(`[FB Attachment] Resolution failed for mid ${cleanMid}:`, e);
        } finally {
            inFlightAttachmentResolutions.delete(cacheKey);
        }
        return null;
    })();

    inFlightAttachmentResolutions.set(cacheKey, promise);
    return promise;
}

const inFlightReplyToResolutions = new Map();
const resolvedReplyToMemoryCache = new Map();

/**
 * Resolves quoted reply_to message details from Meta Graph API when missing in database
 */
export async function resolveFacebookMessageReplyTo(custId, msgId, rawMid) {
    if (!custId || !msgId) return null;
    let cleanMid = rawMid || msgId;
    if (typeof cleanMid === 'string') {
        if (cleanMid.startsWith('m_mid_')) cleanMid = 'm_mid.' + cleanMid.slice(6);
        else if (cleanMid.startsWith('mid_')) cleanMid = 'mid.' + cleanMid.slice(4);
    }
    if (typeof cleanMid !== 'string' || (!cleanMid.startsWith('m_') && !cleanMid.startsWith('mid.') && !cleanMid.startsWith('m_mid.'))) {
        return null;
    }

    const cacheKey = `${custId}_${msgId}`;
    if (resolvedReplyToMemoryCache.has(cacheKey)) {
        return resolvedReplyToMemoryCache.get(cacheKey);
    }

    if (inFlightReplyToResolutions.has(cacheKey)) {
        return inFlightReplyToResolutions.get(cacheKey);
    }

    const promise = (async () => {
        try {
            let apiList = Array.from(cachedAdminApisMap.values()).filter(a => a && a.pageAccessToken);
            if (apiList.length === 0 && db) {
                try {
                    const apiSnap = await db.ref('adminSettings/facebookApis').once('value');
                    const apis = apiSnap.val() || {};
                    apiList = Object.values(apis).filter(a => a && a.pageAccessToken);
                } catch (_) {}
            }
            if (apiList.length === 0 && !isSupabaseSelected()) {
                try {
                    const directRestUrl = `https://lokalexoptimized-rtdb-default-rtdb.asia-southeast1.firebasedatabase.app/adminSettings/facebookApis.json?t=${Date.now()}`;
                    const res = await fetch(directRestUrl);
                    if (res.ok) {
                        const val = await res.json();
                        if (val && typeof val === 'object') {
                            apiList = Object.values(val).filter(a => a && a.pageAccessToken);
                            Object.entries(val).forEach(([id, data]) => {
                                if (data) cachedAdminApisMap.set(id, { id, ...data });
                            });
                        }
                    }
                } catch (_) {}
            }
            if (apiList.length === 0) return null;

            for (const api of apiList) {
                const token = (api.pageAccessToken || '').trim();
                if (!token) continue;

                const resp = await fetch(`https://graph.facebook.com/v19.0/${cleanMid}?fields=id,message,from,reply_to&access_token=${token}`);
                if (resp.ok) {
                    const data = await resp.json();
                    if (data?.reply_to?.mid) {
                        const refMid = data.reply_to.mid;
                        const safeRefMid = refMid.replace(/[.#$\[\]\/]/g, '_');
                        let mappedKey = null;
                        let refText = '';
                        let refSender = 'Rider';

                        // 1. Check midIndex in Firebase
                        if (db) {
                            try {
                                const indexSnap = await db.ref(`customerChats/${custId}/midIndex/${safeRefMid}`).once('value');
                                mappedKey = indexSnap.val();
                                if (mappedKey) {
                                    const origSnap = await db.ref(`customerChats/${custId}/messages/${mappedKey}`).once('value');
                                    const orig = origSnap.val();
                                    if (orig) {
                                        refText = orig.text || (orig.imageUrl ? "📷 Photo" : (orig.locationCoords ? "📍 Location" : "Message"));
                                        refSender = orig.sender || (orig.isRider ? "Rider" : "Customer");
                                    }
                                }
                            } catch (_) {}
                        }

                        // 2. Query Meta directly for the original quoted message text & sender
                        if (!refText) {
                            try {
                                const qResp = await fetch(`https://graph.facebook.com/v19.0/${refMid}?fields=id,message,from,attachments&access_token=${token}`);
                                if (qResp.ok) {
                                    const qData = await qResp.json();
                                    if (qData) {
                                        let rawText = qData.message || (qData.attachments?.data?.[0]?.type ? `📷 ${qData.attachments.data[0].type}` : "Message");
                                        refText = rawText.replace(/^💬 In reply to [^\n]+\n\n/, '');
                                        refSender = qData.from?.name || "Rider";
                                    }
                                }
                            } catch (_) {}
                        }

                        if (refText) {
                            refText = refText.replace(/^💬 In reply to [^\n]+\n\n/, '');
                            const replyToObj = {
                                id: mappedKey || safeRefMid,
                                mid: refMid,
                                text: String(refText).substring(0, 140),
                                sender: refSender
                            };
                            if (db) {
                                db.ref(`customerChats/${custId}/messages/${msgId}`).update({
                                    replyTo: replyToObj
                                }).catch(() => {});
                            }
                            resolvedReplyToMemoryCache.set(cacheKey, replyToObj);
                            return replyToObj;
                        }
                    } else {
                        resolvedReplyToMemoryCache.set(cacheKey, null);
                        return null;
                    }
                }
            }
            resolvedReplyToMemoryCache.set(cacheKey, null);
        } catch (e) {
            console.warn(`[FB ReplyTo] Resolution failed for mid ${cleanMid}:`, e);
        } finally {
            inFlightReplyToResolutions.delete(cacheKey);
        }
        return null;
    })();

    inFlightReplyToResolutions.set(cacheKey, promise);
    return promise;
}

