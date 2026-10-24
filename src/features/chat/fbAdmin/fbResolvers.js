// src/features/chat/fbAdmin/fbResolvers.js
import { db } from '../../../config/firebase.js';
import { showToast } from '../../../ui/notifications.js';
import { cachedAdminApisMap } from './fbChannels.js';

// In-memory cache & in-flight requests for resolved Facebook customer names
export const fbNameResolutionCache = new Map();
const inFlightFbResolutions = new Map();
let autoResolveDebounceTimer = null;

export function getResolvedFbName(custId) {
    if (!custId) return null;
    const psid = String(custId).replace(/^fb_/, '').trim();
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
    const psid = cleanId.replace(/^fb_/, '').trim();
    if (!psid) return null;

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
                    const convEndpoint = api.pageId 
                        ? `https://graph.facebook.com/v19.0/${api.pageId}/conversations?user_id=${psid}&fields=participants{id,name,picture.type(large)},senders{id,name,picture.type(large)}&access_token=${token}`
                        : `https://graph.facebook.com/v19.0/me/conversations?user_id=${psid}&fields=participants{id,name,picture.type(large)},senders{id,name,picture.type(large)}&access_token=${token}`;
                    let convResp = await fetch(convEndpoint);
                    if (!convResp.ok) {
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

                            // Retrieve real Facebook profile picture
                            let realAvatar = (match.picture?.data && !match.picture.data.is_silhouette) ? match.picture.data.url : null;
                            if (!realAvatar) {
                                try {
                                    const picResp = await fetch(`https://graph.facebook.com/v19.0/${psid}/picture?type=large&redirect=false&access_token=${token}`);
                                    if (picResp.ok) {
                                        const picJson = await picResp.json();
                                        if (picJson?.data?.url && !picJson.data.is_silhouette) {
                                            realAvatar = picJson.data.url;
                                        }
                                    }
                                } catch (_) {}
                            }
                            if (!realAvatar) {
                                try {
                                    const profileResp = await fetch(`https://graph.facebook.com/v19.0/${psid}?fields=profile_pic,picture.type(large)&access_token=${token}`);
                                    if (profileResp.ok) {
                                        const profData = await profileResp.json();
                                        realAvatar = (profData.picture?.data && !profData.picture.data.is_silhouette) ? profData.picture.data.url : (profData.profile_pic || null);
                                    }
                                } catch (_) {}
                            }

                            const avatar = realAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(realName)}&background=0084FF&color=fff`;
                            const resolved = { name: realName, avatarUrl: realAvatar || avatar };
                            fbNameResolutionCache.set(psid, resolved);

                            // Update Firebase in the background
                            if (db) {
                                const updatePayload = {
                                    customerName: realName
                                };
                                if (realAvatar) {
                                    updatePayload.avatarUrl = realAvatar;
                                }
                                await Promise.all([
                                    db.ref(`customerChatMeta/${cleanId}`).update(updatePayload),
                                    db.ref(`customerChats/${cleanId}/metadata`).update(updatePayload)
                                ]).catch(() => {});
                            }
                            return resolved;
                        }
                    }
                } catch (errConv) {
                    console.warn(`[FB Resolver] Conversations lookup error for PSID ${psid}:`, errConv);
                }

                // Method B: Direct PSID Node API (Fallback for app testers / admins with profile picture)
                try {
                    const profileResp = await fetch(
                        `https://graph.facebook.com/v19.0/${psid}?fields=first_name,last_name,name,profile_pic,picture.type(large)&access_token=${token}`
                    );
                    if (profileResp.ok) {
                        const profile = await profileResp.json();
                        const fullName = (profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`).trim();
                        if (fullName) {
                            const realAvatar = (profile.picture?.data && !profile.picture.data.is_silhouette) 
                                ? profile.picture.data.url 
                                : (profile.profile_pic || null);
                            const avatar = realAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=0084FF&color=fff`;
                            const resolved = { name: fullName, avatarUrl: realAvatar || avatar };
                            fbNameResolutionCache.set(psid, resolved);

                            if (db) {
                                const updatePayload = {
                                    customerName: fullName
                                };
                                if (realAvatar) {
                                    updatePayload.avatarUrl = realAvatar;
                                }
                                await Promise.all([
                                    db.ref(`customerChatMeta/${cleanId}`).update(updatePayload),
                                    db.ref(`customerChats/${cleanId}/metadata`).update(updatePayload)
                                ]).catch(() => {});
                            }
                            return resolved;
                        }
                    }
                } catch (errProfile) {
                    console.warn(`[FB Resolver] Profile lookup error for PSID ${psid}:`, errProfile);
                }
            }
        } catch (e) {
            console.error(`[FB Resolver] Failed resolving customer ${cleanId}:`, e);
        } finally {
            inFlightFbResolutions.delete(psid);
        }
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
            const psid = cid.replace(/^fb_/, '').trim();
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
        showToast("🔄 Sinusuri ang mga customer names sa Facebook...");

        const apiSnap = await db.ref('adminSettings/facebookApis').once('value');
        const apis = apiSnap.val() || {};
        const apiList = Object.values(apis).filter(a => a && a.pageAccessToken);
        if (apiList.length === 0) {
            return showToast("⚠️ Walang Facebook API na may Page Access Token.");
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
                            const psid = custId.replace(/^fb_/, '');
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
            showToast(`✅ Na-update ang ${updatedCount} Facebook profile(s)!`);
        } else {
            showToast("ℹ️ Lahat ng Facebook customer profiles ay up-to-date na.");
        }

        // Also sync folder status (inbox vs done vs spam)
        await syncFacebookPageFolderStatus(false);
    } catch (err) {
        console.error("syncAllFacebookCustomerNames error:", err);
        showToast("⚠️ Bigo mag-sync ng FB names: " + (err.message || err));
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
                        if (isCatered) continue; // Never override active roster catering

                        // Check if tagged as applicant in Lokalex (Applicant folder/tag must NEVER be overridden by Facebook sync)
                        const isApplicant = Boolean(
                            existingMeta.isApplicant === true ||
                            (existingMeta.folder && (existingMeta.folder.toLowerCase() === 'applicant' || existingMeta.folder.toLowerCase() === 'followup'))
                        );
                        if (isApplicant) continue;

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

                        // Check if already completed/done in Lokalex (e.g. from Clear Inbox or rider order completion)
                        const isAlreadyDone = Boolean(
                            existingMeta.status === 'completed' ||
                            existingMeta.status === 'done' ||
                            existingMeta.status === 'cancelled' ||
                            (existingMeta.folder && existingMeta.folder.toLowerCase() === 'done')
                        );

                        if (isAlreadyDone) {
                            const completedAt = Number(existingMeta.completedAt) || 0;
                            const fbUpdatedTime = c.updated_time ? new Date(c.updated_time).getTime() : 0;
                            const unreadCount = Number(c.unread_count) || 0;

                            // Only reactivate from Done back to Inbox if Facebook received a genuine NEW incoming message
                            // strictly after the completion timestamp!
                            const hasNewCustomerMsg = completedAt > 0 && fbUpdatedTime > (completedAt + 5000) && unreadCount > 0;
                            if (!hasNewCustomerMsg && (fbFolderParam === 'inbox' || targetFolder === 'inbox')) {
                                // Keep it in done! Do not resurrect to inbox just because Facebook Page didn't mark it done
                                continue;
                            }
                        }

                        const currentFolder = (existingMeta.folder || 'inbox').toLowerCase();
                        const currentStatus = (existingMeta.status || 'active').toLowerCase();

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
                showToast(`✅ Na-sync ang ${updatedFoldersCount} Facebook chat(s) sa Page folders!`);
            }
            if (typeof window.renderRiderCustomerChatFeed === 'function') {
                window.renderRiderCustomerChatFeed();
            }
        } else if (showFeedback) {
            showToast("ℹ️ Lahat ng Facebook chat folders ay tugma na sa Page.");
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
export async function resolveFacebookMessageAttachment(custId, msgId, rawMid) {
    if (!custId || !msgId) return null;
    const cleanMid = rawMid || msgId;
    const cacheKey = `${custId}_${msgId}`;

    // 1. Instant check in memory cache (0ms)
    if (resolvedAttachmentMemoryCache.has(cacheKey)) {
        return resolvedAttachmentMemoryCache.get(cacheKey);
    }
    if (resolvedAttachmentMemoryCache.has(cleanMid)) {
        return resolvedAttachmentMemoryCache.get(cleanMid);
    }

    // 2. Instant check in localStorage (0ms across app sessions)
    try {
        const storedUrl = localStorage.getItem(`fb_att_${cleanMid}`) || localStorage.getItem(`fb_att_${msgId}`);
        if (storedUrl && (storedUrl.startsWith('http://') || storedUrl.startsWith('https://') || storedUrl.startsWith('data:'))) {
            resolvedAttachmentMemoryCache.set(cacheKey, storedUrl);
            resolvedAttachmentMemoryCache.set(cleanMid, storedUrl);
            return storedUrl;
        }
    } catch (_) {}

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
            if (apiList.length === 0) {
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
                const resp = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(cleanMid)}?fields=id,message,attachments&access_token=${encodeURIComponent(cleanToken)}`);
                if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
                const data = await resp.json();
                const attachments = data?.attachments?.data || [];
                let imgUrl = null;
                for (const att of attachments) {
                    imgUrl = att?.image_data?.url || 
                             att?.payload?.url || 
                             att?.media?.image?.src || 
                             att?.file_url || 
                             att?.subattachments?.data?.[0]?.image_data?.url || 
                             att?.subattachments?.data?.[0]?.media?.image?.src || 
                             att?.subattachments?.data?.[0]?.payload?.url;
                    if (imgUrl) break;
                }
                if (!imgUrl) throw new Error("No image found in attachment");
                return imgUrl;
            };

            const promises = apiList
                .map(api => (api.pageAccessToken || '').trim())
                .filter(Boolean)
                .map(token => fetchAttachmentWithToken(token));

            if (promises.length === 0) return null;

            let resolvedUrl = null;
            try {
                resolvedUrl = await Promise.any(promises);
            } catch (_) {
                resolvedUrl = null;
            }

            if (resolvedUrl) {
                // Populate caches immediately
                resolvedAttachmentMemoryCache.set(cacheKey, resolvedUrl);
                resolvedAttachmentMemoryCache.set(cleanMid, resolvedUrl);
                try {
                    localStorage.setItem(`fb_att_${cleanMid}`, resolvedUrl);
                    localStorage.setItem(`fb_att_${msgId}`, resolvedUrl);
                } catch (_) {}

                // Pre-warm browser image cache
                try {
                    const preloader = new Image();
                    preloader.src = resolvedUrl;
                } catch (_) {}

                // Update Firebase RTDB so all clients receive direct URL
                if (db) {
                    db.ref(`customerChats/${custId}/messages/${msgId}`).update({
                        imageUrl: resolvedUrl,
                        type: 'image'
                    }).catch(() => {});
                }
                return resolvedUrl;
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

/**
 * Resolves quoted reply_to message details from Meta Graph API when missing in Firebase
 */
export async function resolveFacebookMessageReplyTo(custId, msgId, rawMid) {
    if (!custId || !msgId) return null;
    const cleanMid = rawMid || msgId;
    const cacheKey = `${custId}_${msgId}`;

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
            if (apiList.length === 0) {
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
                            return replyToObj;
                        }
                    }
                }
            }
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

