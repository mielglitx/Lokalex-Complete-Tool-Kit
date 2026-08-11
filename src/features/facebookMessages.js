// src/features/facebookMessages.js
import { db } from '../config/firebase.js';
import { appState, globalState } from '../store/state.js';
import { showToast } from '../ui/notifications.js';
import { escapeHtml } from '../utils/helpers.js';
import { isRiderAdmin } from './commission.js';

let activeThreadId = null;
let conversationsList = [];
let doneConversationsList = [];
let assignedThreadsMap = {};
let liveSyncInterval = null;
let activeInboxFilter = 'all'; // 'all' | 'unread' | 'assigned' | 'done'

let nextPagingCursors = {}; // Stores Graph API next cursors per thread for past messages
let isLoadingOlderMessages = {}; // Guard flag for pagination requests

let isAlarmEnabled = localStorage.getItem('lokalex_fb_alarm_enabled') === 'true';
let knownMessageCountMap = {};
let isInitialFetchDone = false;

// DOM RECONCILIATION SIGNATURE TRACKERS (PREVENT FLICKERING)
let lastRenderedThreadsSignature = "";
let lastRenderedChatThreadId = null;

// HARDCODED PAGE ACCESS TOKEN
const DIRECT_PAGE_ACCESS_TOKEN = "EAAccueEMns0BSGNB50Tuu5qLWEMILzFZBPC32ubnGNoC4pMQWJMAvx6nqsZBPcp1Ne4gVMCetxOl8UPdnZA71weI7B3sag4ynv4ZCFbJAumUbinmOBGWAh3Ey96ZBsOmqA0q3xEB0s51qIpXyoFiybLMKPfmkSlPPGZCekrLkxzqvWNSs64mVD8i3YSUUJ0huehY8LgIhoz1u2ZBxABPVrJ4QZDZD";

const END_MESSAGE = `Hello po! Salamat po sa pagtitiwala sa Lokalex. 🙂

Kung okay lang po, paki-rate or leave a review naman po sa page namin about your delivery experience. Malaking tulong po ito sa amin para mas mapabuti pa ang service namin.

If you have any concern, suggestion or complaints, please send us an email at
lokaledeliver@gmail.com

Maraming salamat po! 🛵💛`;

export function getPageToken() {
    return localStorage.getItem('lokalex_fb_page_token') || DIRECT_PAGE_ACCESS_TOKEN;
}

// SLIDE TO CONFIRM MODAL HELPER FOR BUSINESS SUITE BUTTONS
function requestSlideConfirmation(title, subtext, onConfirmCallback) {
    const modal = document.getElementById('slide-delete-modal');
    const titleEl = document.getElementById('slide-delete-title');
    const subEl = document.getElementById('slide-delete-sub');
    const rangeInput = document.getElementById('slide-delete-range');

    if (modal && titleEl && subEl && rangeInput) {
        titleEl.innerText = title;
        subEl.innerText = subtext;
        rangeInput.value = "0";
        modal.classList.remove('hidden');

        window.onSlideConfirmAction = () => {
            modal.classList.add('hidden');
            if (typeof onConfirmCallback === 'function') {
                onConfirmCallback();
            }
        };
    } else {
        if (confirm(`${title}\n\n${subtext}`)) {
            onConfirmCallback();
        }
    }
}

// SET ACTIVE FILTER TAB (All Messages, Unread, Assigned, Done)
export function setInboxFilter(filterType) {
    activeInboxFilter = filterType;

    const filterBtns = document.querySelectorAll('#fb-filter-tabs button');
    filterBtns.forEach(btn => {
        if (btn.dataset.filter === filterType) {
            btn.className = "bg-[#0084FF] text-white px-3 py-1 rounded-full text-[10px] font-bold shadow-sm transition";
        } else {
            btn.className = "bg-[#3a3b3c] text-gray-300 px-3 py-1 rounded-full text-[10px] font-bold hover:bg-gray-700 transition";
        }
    });

    lastRenderedThreadsSignature = "";

    if (filterType === 'done') {
        fetchMetaDoneConversations();
    } else {
        fetchFacebookConversations();
    }
}

// MOVE CONVERSATION TO "DONE" FOLDER IN OFFICIAL META BUSINESS SUITE
async function markMetaConversationDone(threadId) {
    const token = getPageToken();
    if (!token || !threadId) return;

    try {
        const res = await fetch(`https://graph.facebook.com/v19.0/${threadId}?folder=done&access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: "done" })
        });
        
        if (!res.ok) {
            console.warn("Meta API returned non-OK response when moving thread to done:", await res.text());
        }
    } catch(e) {
        console.error("Failed to update Meta Business Suite folder status:", e);
    }
}

// WEB AUDIO API NEW MESSAGE CHIME (5-SECOND DURATION ALARM)
function playNewMessageAlarmSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        
        const playBeep = (freq, startTime, duration) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
            gain.gain.setValueAtTime(0.25, ctx.currentTime + startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + startTime);
            osc.stop(ctx.currentTime + startTime + duration);
        };

        for (let i = 0; i < 5; i++) {
            const offset = i * 1.0;
            playBeep(523.25, offset, 0.2);        // C5
            playBeep(659.25, offset + 0.25, 0.2);  // E5
            playBeep(783.99, offset + 0.50, 0.35); // G5
        }
    } catch(e) {
        console.warn("Could not play alarm sound:", e);
    }
}

export function toggleFacebookNewMessageAlarm() {
    isAlarmEnabled = !isAlarmEnabled;
    localStorage.setItem('lokalex_fb_alarm_enabled', isAlarmEnabled ? 'true' : 'false');
    
    updateAlarmButtonUI();

    if (isAlarmEnabled) {
        playNewMessageAlarmSound();
        showToast("🔔 New Message Alarm ENABLED (5s Sound)!");
    } else {
        showToast("🔕 New Message Alarm Disabled.");
    }
}

export function updateAlarmButtonUI() {
    const btn = document.getElementById('fb-alarm-toggle-btn');
    const icon = document.getElementById('fb-alarm-icon');
    if (!btn || !icon) return;

    if (isAlarmEnabled) {
        btn.className = "bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/40 p-2 rounded-xl text-xs transition active:scale-95 shadow-md";
        icon.className = "fa-solid fa-bell animate-pulse";
        btn.title = "Alarm Enabled (Click to Mute)";
    } else {
        btn.className = "bg-gray-800 hover:bg-gray-700 text-gray-400 p-2 rounded-xl text-xs transition active:scale-95";
        icon.className = "fa-solid fa-bell-slash";
        btn.title = "Alarm Muted (Click to Enable)";
    }
}

export function openFacebookMessagesModal() {
    const modal = document.getElementById('facebook-messages-modal');
    if (modal) modal.classList.remove('hidden');

    // Prevent background page scrolling
    document.body.classList.add('overflow-hidden');

    if (window.closeWebHubModal) window.closeWebHubModal();

    updateAlarmButtonUI();
    fetchFacebookConversations();
    listenToFirebaseWebhookMessages();

    if (liveSyncInterval) clearInterval(liveSyncInterval);
    liveSyncInterval = setInterval(() => {
        const isModalOpen = modal && !modal.classList.contains('hidden');
        if (isModalOpen) {
            if (activeInboxFilter === 'done') {
                fetchMetaDoneConversations(true);
            } else {
                fetchFacebookConversations(true);
            }
        }
    }, 2000);
}

export function closeFacebookMessagesModal() {
    const modal = document.getElementById('facebook-messages-modal');
    if (modal) modal.classList.add('hidden');

    // Restore background page scrolling
    document.body.classList.remove('overflow-hidden');

    if (liveSyncInterval) {
        clearInterval(liveSyncInterval);
        liveSyncInterval = null;
    }
}

export function isCurrentRiderFirstAvailable() {
    const roster = globalState.rosterMembers || [];
    const availableRiders = roster.filter(m => (m.status || "").toString().toLowerCase() === "available");
    
    if (availableRiders.length === 0) return false;

    const topRider = availableRiders[0];
    const myId = (appState.telegramId || "").toString().trim();
    const myName = (appState.riderName || "").toString().trim().toLowerCase();

    const topId = (topRider.telegramId || topRider.id || "").toString().trim();
    const topName = (topRider.riderName || topRider.name || "").toString().trim().toLowerCase();

    return (myId && topId && myId === topId) || (myName && topName && myName === topName);
}

export function listenToFirebaseWebhookMessages() {
    if (!db) return;
    
    db.ref('facebook_inbox').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            const fbList = Object.keys(data).map(key => ({
                id: key,
                ...data[key]
            }));

            const map = new Map();
            conversationsList.forEach(c => map.set(c.id, c));
            fbList.forEach(c => map.set(c.id, { ...map.get(c.id), ...c }));

            conversationsList = Array.from(map.values());
            checkNewIncomingMessages(conversationsList);
            renderThreadsList();
            if (activeThreadId) {
                renderThreadMessages(activeThreadId, false);
            }
        }
    });

    db.ref('facebook_assignments').on('value', (snapshot) => {
        assignedThreadsMap = snapshot.val() || {};
        renderThreadsList();
        updateAssignmentBanner();
        updateCancelCaterButtonUI(activeThreadId);
    });

    if (appState.telegramId) {
        db.ref(`roster/${appState.telegramId}`).on('value', (snapshot) => {
            const data = snapshot.val();
            if (data && data.status) {
                const st = data.status.toString().toLowerCase();
                if (st === 'available' || st === 'break' || st === 'end' || st === 'end shift') {
                    releaseRiderCateredCustomers(appState.riderName || data.riderName || data.name);
                }
            }
        });
    }
}

export function releaseRiderCateredCustomers(riderName) {
    if (!riderName) return;
    const targetRider = riderName.trim().toLowerCase();
    let releasedAny = false;

    Object.keys(assignedThreadsMap).forEach(threadId => {
        const item = assignedThreadsMap[threadId];
        const rName = typeof item === 'object' ? item.riderName : item;
        const status = typeof item === 'object' ? item.status : (rName ? 'catering' : 'open');

        if (rName && rName.trim().toLowerCase() === targetRider && status === 'catering') {
            delete assignedThreadsMap[threadId];
            if (db) {
                db.ref(`facebook_assignments/${threadId}`).remove();
            }
            releasedAny = true;
        }
    });

    if (releasedAny) {
        renderThreadsList();
        if (activeThreadId) {
            updateAssignmentBanner();
            updateCancelCaterButtonUI(activeThreadId);
        }
    }
}

function checkNewIncomingMessages(threads) {
    let hasNewIncoming = false;
    let newCustomerName = "";

    threads.forEach(conv => {
        const msgCount = conv.messages ? conv.messages.length : 0;
        const prevCount = knownMessageCountMap[conv.id] || 0;

        if (isInitialFetchDone) {
            if (prevCount === 0 && msgCount > 0) {
                hasNewIncoming = true;
                newCustomerName = conv.customerName;
            } else if (msgCount > prevCount) {
                const lastMsg = conv.messages[conv.messages.length - 1];
                if (lastMsg && !lastMsg.isRider) {
                    hasNewIncoming = true;
                    newCustomerName = conv.customerName;
                }
            }
        }

        knownMessageCountMap[conv.id] = msgCount;
    });

    if (!isInitialFetchDone) {
        isInitialFetchDone = true;
        return;
    }

    if (hasNewIncoming && isAlarmEnabled) {
        playNewMessageAlarmSound();
        showToast(`🔔 New message received from ${newCustomerName || 'customer'}!`);
    }
}

// FETCH MAIN INBOX CONVERSATIONS FROM GRAPH API
export async function fetchFacebookConversations(isSilent = false) {
    const refreshIcon = document.getElementById('fb-refresh-icon');
    if (!isSilent && refreshIcon) refreshIcon.classList.add('fa-spin');

    const token = getPageToken();

    if (token) {
        try {
            const res = await fetch(`https://graph.facebook.com/v19.0/me/conversations?folder=inbox&fields=id,updated_time,unread_count,senders{id,name,picture{data{url}}},messages.limit(20){id,message,from,created_time,attachments{id,mime_type,image_data,payload}}&access_token=${token}`);
            if (res.ok) {
                const result = await res.json();
                if (result.data) {
                    const fetchedMap = new Map();

                    result.data.forEach(conv => {
                        const senderObj = conv.senders?.data?.[0] || {};
                        const senderName = senderObj.name || "Facebook Customer";
                        const senderId = senderObj.id || conv.id;
                        const avatarUrl = senderObj.picture?.data?.url || `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName)}&background=0084FF&color=fff`;

                        if (conv.messages?.paging?.next) {
                            nextPagingCursors[conv.id] = conv.messages.paging.next;
                        }

                        const existingThread = conversationsList.find(c => c.id === conv.id);

                        const rawMsgs = (conv.messages?.data || []).map(m => {
                            const isRider = m.from?.id !== senderId;
                            const attach = m.attachments?.data?.[0];
                            const attachImg = attach?.image_data?.url || attach?.payload?.url || attach?.payload?.src || null;
                            
                            const existingMsg = existingThread?.messages?.find(em => em.id === m.id);
                            let senderAttribution = senderName;
                            
                            if (isRider) {
                                if (existingMsg && existingMsg.isLocallySent && existingMsg.sender) {
                                    senderAttribution = existingMsg.sender;
                                } else {
                                    senderAttribution = m.from?.name || "Meta Business Suite";
                                }
                            }

                            return {
                                id: m.id,
                                text: m.message || "",
                                imageUrl: attachImg,
                                sender: senderAttribution,
                                isRider: isRider,
                                isLocallySent: existingMsg?.isLocallySent || false,
                                timestamp: new Date(m.created_time).getTime()
                            };
                        }).reverse();

                        const lastMsgObj = rawMsgs[rawMsgs.length - 1] || {};

                        fetchedMap.set(conv.id, {
                            id: conv.id,
                            customerName: senderName,
                            senderId: senderId,
                            avatarUrl: avatarUrl,
                            messages: rawMsgs,
                            lastMessage: lastMsgObj.imageUrl ? "📷 [Image]" : (lastMsgObj.text || "No messages yet"),
                            lastMessageIsRider: lastMsgObj.isRider || false,
                            lastUpdated: new Date(conv.updated_time).getTime(),
                            unreadCount: conv.unread_count || 0,
                            folder: 'inbox'
                        });
                    });

                    const mergedMap = new Map();
                    conversationsList.forEach(c => mergedMap.set(c.id, c));
                    fetchedMap.forEach((c, id) => {
                        const existing = mergedMap.get(id);
                        if (existing && existing.messages) {
                            const msgMap = new Map();
                            existing.messages.forEach(m => msgMap.set(m.id, m));
                            c.messages.forEach(m => msgMap.set(m.id, m));
                            const mergedMsgs = Array.from(msgMap.values()).sort((a,b) => a.timestamp - b.timestamp);
                            c.messages = mergedMsgs;
                            const lastM = mergedMsgs[mergedMsgs.length - 1];
                            if (lastM) {
                                c.lastMessage = lastM.imageUrl ? "📷 [Image]" : (lastM.text || "No messages yet");
                                c.lastMessageIsRider = lastM.isRider || false;
                                c.lastUpdated = Math.max(c.lastUpdated, lastM.timestamp || 0);
                            }
                        }
                        mergedMap.set(id, c);
                    });

                    conversationsList = Array.from(mergedMap.values());
                    checkNewIncomingMessages(conversationsList);
                }
            }
        } catch (e) {
            console.warn("Graph API error, using local/Firebase fallback...", e);
        }
    }

    renderThreadsList();
    if (activeThreadId) {
        renderThreadMessages(activeThreadId, false);
    }

    if (!isSilent && refreshIcon) {
        setTimeout(() => refreshIcon.classList.remove('fa-spin'), 600);
    }
}

// FETCH DONE FOLDER CONVERSATIONS FROM GRAPH API
export async function fetchMetaDoneConversations(isSilent = false) {
    const refreshIcon = document.getElementById('fb-refresh-icon');
    if (!isSilent && refreshIcon) refreshIcon.classList.add('fa-spin');

    const token = getPageToken();

    if (token) {
        try {
            const res = await fetch(`https://graph.facebook.com/v19.0/me/conversations?folder=done&fields=id,updated_time,unread_count,senders{id,name,picture{data{url}}},messages.limit(20){id,message,from,created_time,attachments{id,mime_type,image_data,payload}}&access_token=${token}`);
            if (res.ok) {
                const result = await res.json();
                if (result.data) {
                    doneConversationsList = result.data.map(conv => {
                        const senderObj = conv.senders?.data?.[0] || {};
                        const senderName = senderObj.name || "Facebook Customer";
                        const senderId = senderObj.id || conv.id;
                        const avatarUrl = senderObj.picture?.data?.url || `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName)}&background=0084FF&color=fff`;

                        if (conv.messages?.paging?.next) {
                            nextPagingCursors[conv.id] = conv.messages.paging.next;
                        }

                        const existingThread = doneConversationsList.find(c => c.id === conv.id);

                        const rawMsgs = (conv.messages?.data || []).map(m => {
                            const isRider = m.from?.id !== senderId;
                            const attach = m.attachments?.data?.[0];
                            const attachImg = attach?.image_data?.url || attach?.payload?.url || attach?.payload?.src || null;

                            const existingMsg = existingThread?.messages?.find(em => em.id === m.id);
                            let senderAttribution = senderName;

                            if (isRider) {
                                if (existingMsg && existingMsg.isLocallySent && existingMsg.sender) {
                                    senderAttribution = existingMsg.sender;
                                } else {
                                    senderAttribution = m.from?.name || "Meta Business Suite";
                                }
                            }

                            return {
                                id: m.id,
                                text: m.message || "",
                                imageUrl: attachImg,
                                sender: senderAttribution,
                                isRider: isRider,
                                isLocallySent: existingMsg?.isLocallySent || false,
                                timestamp: new Date(m.created_time).getTime()
                            };
                        }).reverse();

                        const lastMsgObj = rawMsgs[rawMsgs.length - 1] || {};

                        return {
                            id: conv.id,
                            customerName: senderName,
                            senderId: senderId,
                            avatarUrl: avatarUrl,
                            messages: rawMsgs,
                            lastMessage: lastMsgObj.imageUrl ? "📷 [Image]" : (lastMsgObj.text || "No messages yet"),
                            lastMessageIsRider: lastMsgObj.isRider || false,
                            lastUpdated: new Date(conv.updated_time).getTime(),
                            unreadCount: conv.unread_count || 0,
                            folder: 'done',
                            isMetaDone: true
                        };
                    });
                }
            }
        } catch(e) {
            console.error("Done folder fetch error:", e);
        }
    }

    renderThreadsList();
    if (!isSilent && refreshIcon) {
        setTimeout(() => refreshIcon.classList.remove('fa-spin'), 600);
    }
}

// PAGINATION: LOAD OLDER PAST MESSAGES ON SCROLL UP
export async function loadOlderThreadMessages(threadId) {
    if (!threadId || isLoadingOlderMessages[threadId] || !nextPagingCursors[threadId]) return;

    isLoadingOlderMessages[threadId] = true;

    const container = document.getElementById('fb-chat-messages');
    const oldScrollHeight = container ? container.scrollHeight : 0;

    try {
        const res = await fetch(nextPagingCursors[threadId]);
        if (res.ok) {
            const result = await res.json();
            if (result.data && result.data.length > 0) {
                const sourceList = conversationsList.concat(doneConversationsList);
                const thread = sourceList.find(c => c.id === threadId);

                if (thread) {
                    const senderId = thread.senderId || thread.id;
                    const customerName = thread.customerName || "Customer";

                    const olderMsgs = result.data.map(m => {
                        const isRider = m.from?.id !== senderId;
                        const attach = m.attachments?.data?.[0];
                        const attachImg = attach?.image_data?.url || attach?.payload?.url || attach?.payload?.src || null;

                        let senderAttribution = customerName;
                        if (isRider) {
                            senderAttribution = m.from?.name || "Meta Business Suite";
                        }

                        return {
                            id: m.id,
                            text: m.message || "",
                            imageUrl: attachImg,
                            sender: senderAttribution,
                            isRider: isRider,
                            timestamp: new Date(m.created_time).getTime()
                        };
                    }).reverse();

                    const existingIds = new Set((thread.messages || []).map(m => m.id));
                    const filteredOlder = olderMsgs.filter(m => !existingIds.has(m.id));

                    thread.messages = [...filteredOlder, ...(thread.messages || [])];
                    nextPagingCursors[threadId] = result.paging?.next || null;

                    renderThreadMessages(threadId, false, true);

                    if (container) {
                        const newScrollHeight = container.scrollHeight;
                        container.scrollTop = newScrollHeight - oldScrollHeight;
                    }
                }
            } else {
                nextPagingCursors[threadId] = null;
            }
        }
    } catch(e) {
        console.error("Failed to load older messages:", e);
    } finally {
        isLoadingOlderMessages[threadId] = false;
    }
}

export function filterFacebookThreads() {
    renderThreadsList();
}

// RENDER ACTIVE THREADS LIST STRICTLY ACCORDING TO META INBOX FOLDERS & FILTERS
export function renderThreadsList() {
    const container = document.getElementById('fb-threads-list');
    const searchVal = (document.getElementById('fb-thread-search')?.value || "").toLowerCase().trim();
    if (!container) return;

    let sourceList = conversationsList;
    if (activeInboxFilter === 'done') {
        sourceList = doneConversationsList;
    }

    let activeConversations = sourceList.filter(conv => {
        const assignData = assignedThreadsMap[conv.id] || {};
        const cateringRider = typeof assignData === 'object' ? assignData.riderName : assignData;
        const threadStatus = typeof assignData === 'object' ? assignData.status : (cateringRider ? 'catering' : 'open');
        const myName = (appState.riderName || "").trim();

        // 1. ALL MESSAGES (ONLY ACTIVE META INBOX MESSAGES)
        if (activeInboxFilter === 'all') {
            return conv.folder === 'inbox' || !conv.isMetaDone;
        }

        // 2. UNREAD MESSAGES ONLY
        if (activeInboxFilter === 'unread') {
            return conv.unreadCount > 0;
        }

        // 3. ASSIGNED MESSAGES (CURRENT RIDER CATERING ONLY)
        if (activeInboxFilter === 'assigned') {
            return cateringRider && cateringRider.toLowerCase() === myName.toLowerCase() && threadStatus === 'catering';
        }

        // 4. DONE MESSAGES ONLY (META DONE FOLDER)
        if (activeInboxFilter === 'done') {
            return conv.folder === 'done' || conv.isMetaDone;
        }

        return true;
    });

    if (searchVal) {
        activeConversations = activeConversations.filter(c => 
            (c.customerName || "").toLowerCase().includes(searchVal) ||
            (c.lastMessage || "").toLowerCase().includes(searchVal)
        );
    }

    if (activeConversations.length === 0) {
        const emptyHtml = `<div class="text-center text-gray-500 italic py-12 text-xs">No ${activeInboxFilter} conversations found.</div>`;
        if (container.innerHTML !== emptyHtml) {
            container.innerHTML = emptyHtml;
            lastRenderedThreadsSignature = "";
        }
        return;
    }

    activeConversations.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));

    const currentSignature = activeInboxFilter + "_" + activeThreadId + "_" + searchVal + "_" + activeConversations.map(c => {
        const assignData = assignedThreadsMap[c.id] || {};
        const rName = typeof assignData === 'object' ? assignData.riderName : assignData;
        const status = typeof assignData === 'object' ? assignData.status : '';
        return `${c.id}_${c.lastUpdated}_${c.lastMessage}_${c.unreadCount}_${rName}_${status}_${c.avatarUrl}`;
    }).join('|');

    if (lastRenderedThreadsSignature === currentSignature) return;

    const newHtml = activeConversations.map(conv => {
        const isSelected = activeThreadId === conv.id;
        const activeClass = isSelected ? "bg-[#2d2f31] border-l-4 border-[#0084FF]" : "hover:bg-[#242526]";
        
        let timeStr = "";
        if (conv.lastUpdated) {
            const d = new Date(conv.lastUpdated);
            timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        }

        const prefix = conv.lastMessageIsRider ? "You: " : "";
        const avatar = conv.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(conv.customerName || 'C')}&background=0084FF&color=fff`;

        const assignData = assignedThreadsMap[conv.id] || {};
        const cateringRider = typeof assignData === 'object' ? assignData.riderName : assignData;
        const threadStatus = typeof assignData === 'object' ? assignData.status : (cateringRider ? 'catering' : 'open');

        let statusBadge = '';
        if (threadStatus === 'catering') {
            statusBadge = `<span class="text-[9px] bg-red-600/30 text-red-300 border border-red-500/40 px-1.5 py-0.5 rounded font-bold"><i class="fa-solid fa-lock text-[8px]"></i> ${escapeHtml(cateringRider)}</span>`;
        } else if (conv.isMetaDone || threadStatus === 'done') {
            statusBadge = `<span class="text-[9px] bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded font-bold"><i class="fa-solid fa-check-circle text-[8px]"></i> Done</span>`;
        }

        return `
        <div class="p-3 border-b border-gray-800/60 flex flex-col gap-2 transition ${activeClass}">
            <div onclick="selectFacebookThread('${conv.id}')" class="cursor-pointer flex items-center gap-3">
                <div class="relative shrink-0">
                    <img src="${avatar}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(conv.customerName || 'C')}&background=0084FF&color=fff'" class="w-11 h-11 rounded-full object-cover border border-gray-700 shadow-sm">
                    <div class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#0084FF] text-white flex items-center justify-center text-[9px] border-2 border-[#1c1e21]">
                        <i class="fa-brands fa-facebook-f"></i>
                    </div>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-center mb-0.5">
                        <span class="font-semibold text-xs text-white truncate">${escapeHtml(conv.customerName)}</span>
                        <span class="text-[10px] text-gray-400 font-mono shrink-0">${timeStr}</span>
                    </div>
                    <div class="text-[11px] text-gray-400 truncate font-sans">${escapeHtml(prefix + conv.lastMessage)}</div>
                    <div class="mt-1 flex items-center gap-1.5">${statusBadge}</div>
                </div>
            </div>

            <div class="flex gap-1.5 pt-1 border-t border-gray-800/40">
                <button onclick="caterFacebookCustomer('${conv.id}')" class="flex-1 bg-red-600/20 hover:bg-red-600 text-red-300 hover:text-white border border-red-500/40 py-1.5 rounded-lg text-[10px] font-bold transition active:scale-95 flex items-center justify-center gap-1">
                    <i class="fa-solid fa-motorcycle"></i> CATER
                </button>
                <button onclick="hideFacebookCustomer('${conv.id}')" class="flex-1 bg-gray-700/40 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-600/40 py-1.5 rounded-lg text-[10px] font-bold transition active:scale-95 flex items-center justify-center gap-1">
                    <i class="fa-solid fa-eye-slash"></i> HIDE
                </button>
                <button onclick="doneFacebookCustomer('${conv.id}')" class="flex-1 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 py-1.5 rounded-lg text-[10px] font-bold transition active:scale-95 flex items-center justify-center gap-1">
                    <i class="fa-solid fa-check-circle"></i> DONE
                </button>
            </div>
        </div>`;
    }).join('');

    container.innerHTML = newHtml;
    lastRenderedThreadsSignature = currentSignature;

    if (activeThreadId && !activeConversations.some(c => c.id === activeThreadId)) {
        activeThreadId = activeConversations.length > 0 ? activeConversations[0].id : null;
        if (activeThreadId) renderThreadMessages(activeThreadId, true);
    }
}

export function selectFacebookThread(threadId) {
    if (!threadId) return;

    const assignData = assignedThreadsMap[threadId] || {};
    const cateringRider = typeof assignData === 'object' ? assignData.riderName : assignData;
    const threadStatus = typeof assignData === 'object' ? assignData.status : (cateringRider ? 'catering' : 'open');

    const myName = (appState.riderName || "").trim();
    const myId = (appState.telegramId || "").trim();

    const isAdmin = isRiderAdmin(myName, myId);
    const adminControlsChecked = !!document.getElementById('admin-controls-toggle')?.checked;

    if (threadStatus === 'catering' && cateringRider && cateringRider !== myName) {
        if (!(isAdmin && adminControlsChecked)) {
            showToast(`⚠️ Customer is currently being catered by ${cateringRider}!`);
            return;
        }
    }

    activeThreadId = threadId;

    renderThreadsList();
    renderThreadMessages(threadId, true);
    updateAssignmentBanner();
    updateCancelCaterButtonUI(threadId);

    const threadPanel = document.getElementById('fb-threads-panel');
    const chatPanel = document.getElementById('fb-chat-panel');
    if (window.innerWidth < 768) {
        if (threadPanel) threadPanel.classList.add('hidden');
        if (chatPanel) chatPanel.classList.remove('hidden');
    }
}

export function selectFacebookThreadByCustomerName(customerName, receiptText = "") {
    if (!customerName) return;
    const target = (customerName || "").toLowerCase().trim();

    const sourceList = activeInboxFilter === 'done' ? doneConversationsList : conversationsList;
    const match = sourceList.find(c => 
        (c.customerName || "").toLowerCase().trim() === target || 
        target.includes((c.customerName || "").toLowerCase().trim())
    );

    if (match) {
        selectFacebookThread(match.id);
        if (receiptText) {
            const formattedReceipt = String(receiptText)
                .replace(/\\n/g, '\n')
                .replace(/<br\s*[\/]?>/gi, '\n')
                .replace(/\r\n/g, '\n')
                .replace(/\r/g, '\n');

            const input = document.getElementById('fb-message-input');
            if (input) {
                input.value = formattedReceipt;
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 200) + 'px';
            }
        }
    }
}

// CATER BUTTON ACTION (WITH SLIDE CONFIRMATION MODAL)
export function caterFacebookCustomer(threadId) {
    const sourceList = conversationsList.concat(doneConversationsList);
    const thread = sourceList.find(c => c.id === threadId);
    if (!thread) return;

    const myName = (appState.riderName || "Lokalex Rider").trim();

    const myCateredCount = Object.values(assignedThreadsMap).filter(item => {
        const rName = typeof item === 'object' ? item.riderName : item;
        const status = typeof item === 'object' ? item.status : (rName ? 'catering' : 'open');
        return rName === myName && status === 'catering';
    }).length;

    if (myCateredCount >= 4) {
        showToast("⚠️ Limit reached! You can only cater up to 4 customers at a time.");
        return;
    }

    if (!isCurrentRiderFirstAvailable()) {
        showToast("⚠️ You can only cater if you are #1 on top of the Available list!");
        return;
    }

    const assignData = assignedThreadsMap[threadId] || {};
    const currentCaterer = typeof assignData === 'object' ? assignData.riderName : assignData;
    if (currentCaterer && currentCaterer !== myName) {
        showToast(`⚠️ Customer is already being catered by ${currentCaterer}!`);
        return;
    }

    requestSlideConfirmation(
        "CONFIRM CATER",
        `I-cater si ${thread.customerName}?`,
        () => executeCaterFacebookCustomer(threadId)
    );
}

function executeCaterFacebookCustomer(threadId) {
    const sourceList = conversationsList.concat(doneConversationsList);
    const thread = sourceList.find(c => c.id === threadId);
    if (!thread) return;

    const myName = (appState.riderName || "Lokalex Rider").trim();

    assignedThreadsMap[threadId] = {
        riderName: myName,
        status: 'catering',
        timestamp: Date.now()
    };

    if (db) {
        db.ref(`facebook_assignments/${threadId}`).set({
            riderName: myName,
            status: 'catering',
            timestamp: Date.now()
        });

        if (appState.telegramId) {
            db.ref(`roster/${appState.telegramId}`).update({
                status: 'Catering',
                customerName: thread.customerName,
                cateringStartTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }
    }

    showToast(`🛵 Catering ${thread.customerName}! Added to your active catering list.`);
    selectFacebookThread(threadId);
}

// CANCEL CATER BUTTON ACTION (WITH SLIDE CONFIRMATION MODAL)
export function cancelCaterFacebookCustomer() {
    if (!activeThreadId) return showToast("⚠️ Please select a customer conversation first.");

    const sourceList = conversationsList.concat(doneConversationsList);
    const thread = sourceList.find(c => c.id === activeThreadId);
    if (!thread) return;

    const custName = (thread.customerName || "").toLowerCase().trim();
    const myName = (appState.riderName || "").trim();

    const assignData = assignedThreadsMap[activeThreadId] || {};
    const cateringRider = typeof assignData === 'object' ? assignData.riderName : assignData;

    if (!cateringRider) {
        showToast("⚠️ Customer is not currently being catered.");
        return;
    }

    const isAdmin = isRiderAdmin(myName, appState.telegramId);
    const adminControlsToggle = document.getElementById('admin-controls-toggle');
    const adminControlsChecked = adminControlsToggle ? adminControlsToggle.checked : false;

    if (cateringRider.toLowerCase() !== myName.toLowerCase() && !adminControlsChecked && !isAdmin) {
        showToast(`⚠️ Only ${cateringRider} or an Admin with Admin Controls enabled can cancel catering for this customer.`);
        return;
    }

    const receipts = globalState.globalDailyReceipts || [];
    const hasGeneratedReceipt = receipts.some(r => 
        r.receiptText && (
            (r.customerName && r.customerName.toLowerCase().trim() === custName) ||
            (r.receiptText.toLowerCase().includes(custName))
        )
    );

    if (hasGeneratedReceipt) {
        showToast("⚠️ Cannot cancel catering! A receipt has already been generated for this customer.");
        return;
    }

    requestSlideConfirmation(
        "CONFIRM CANCEL CATER",
        `I-cancel ang catering para kay ${thread.customerName}?`,
        () => executeCancelCaterFacebookCustomer(activeThreadId, cateringRider)
    );
}

function executeCancelCaterFacebookCustomer(threadId, cateringRider) {
    const sourceList = conversationsList.concat(doneConversationsList);
    const thread = sourceList.find(c => c.id === threadId);

    delete assignedThreadsMap[threadId];

    if (db) {
        db.ref(`facebook_assignments/${threadId}`).remove();
    }

    showToast(`🔓 Catering cancelled for ${thread ? thread.customerName : 'Customer'}. Customer is now open again.`);
    renderThreadsList();
    updateAssignmentBanner();
    updateCancelCaterButtonUI(threadId);

    checkAndUpdateRosterAutoAvailable(cateringRider);
}

// UPDATE CANCEL CATER BUTTON VISIBILITY
export function updateCancelCaterButtonUI(threadId = activeThreadId) {
    const cancelBtn = document.getElementById('fb-cancel-cater-btn');
    if (!cancelBtn) return;

    if (!threadId) {
        cancelBtn.classList.add('hidden');
        return;
    }

    const assignData = assignedThreadsMap[threadId] || {};
    const cateringRider = typeof assignData === 'object' ? assignData.riderName : assignData;
    const threadStatus = typeof assignData === 'object' ? assignData.status : (cateringRider ? 'catering' : 'open');

    const myName = (appState.riderName || "").trim();
    const isAdmin = isRiderAdmin(myName, appState.telegramId);
    const adminControlsToggle = document.getElementById('admin-controls-toggle');
    const adminControlsChecked = adminControlsToggle ? adminControlsToggle.checked : false;

    if (threadStatus === 'catering' && cateringRider) {
        if (cateringRider.toLowerCase() === myName.toLowerCase() || adminControlsChecked || isAdmin) {
            cancelBtn.classList.remove('hidden');
        } else {
            cancelBtn.classList.add('hidden');
        }
    } else {
        cancelBtn.classList.add('hidden');
    }
}

export function createReceiptFromChat() {
    if (!activeThreadId) return showToast("⚠️ Please select a customer conversation first.");

    const sourceList = conversationsList.concat(doneConversationsList);
    const thread = sourceList.find(c => c.id === activeThreadId);
    if (!thread) return;

    const custName = thread.customerName;

    closeFacebookMessagesModal();

    if (window.switchView) {
        window.switchView('view-cart');
    }

    const nameInput = document.getElementById('rcpt-name');
    if (nameInput) {
        nameInput.value = custName;
    }

    appState.receiptCustomerName = custName;

    showToast(`🧾 Switched to Smart Cart for ${custName}`);
}

// HIDE BUTTON: MARKS THREAD DONE & MOVES TO META DONE FOLDER WITHOUT SENDING CLOSING MESSAGE
export function hideFacebookCustomer(threadId) {
    const sourceList = conversationsList.concat(doneConversationsList);
    const thread = sourceList.find(c => c.id === threadId);
    if (!thread) return;

    const assignData = assignedThreadsMap[threadId] || {};
    const cateringRider = typeof assignData === 'object' ? assignData.riderName : assignData;

    const myName = (appState.riderName || "").trim();
    const myId = (appState.telegramId || "").trim();
    const isAdmin = isRiderAdmin(myName, myId);
    const adminControlsChecked = !!document.getElementById('admin-controls-toggle')?.checked;

    if (cateringRider && cateringRider !== myName && !(isAdmin && adminControlsChecked)) {
        showToast(`⚠️ Only ${cateringRider} who is catering this customer can click HIDE / DONE!`);
        return;
    }

    requestSlideConfirmation(
        "CONFIRM HIDE / DONE",
        `I-hide at ilipat sa Meta Business Done folder si ${thread.customerName}? (Walang ipapadalang message)`,
        () => executeHideFacebookCustomer(threadId)
    );
}

function executeHideFacebookCustomer(threadId) {
    const sourceList = conversationsList.concat(doneConversationsList);
    const thread = sourceList.find(c => c.id === threadId);
    if (!thread) return;

    const myName = (appState.riderName || "").trim();
    const doneTimestamp = Date.now();

    assignedThreadsMap[threadId] = {
        riderName: null,
        status: 'done',
        doneAt: doneTimestamp,
        timestamp: doneTimestamp
    };

    // Instantly remove thread from active inbox array
    conversationsList = conversationsList.filter(c => c.id !== threadId);

    renderThreadsList();
    showToast(`✅ Customer ${thread.customerName} marked DONE (Moved to Meta Business Done folder without message).`);

    if (db) {
        db.ref(`facebook_assignments/${threadId}`).set({
            riderName: null,
            status: 'done',
            doneAt: doneTimestamp,
            timestamp: doneTimestamp
        });
    }

    markMetaConversationDone(threadId);
    checkAndUpdateRosterAutoAvailable(myName);
}

// DONE BUTTON: MARKS THREAD DONE, MOVES TO META DONE FOLDER, AND SENDS CLOSING MESSAGE
export function doneFacebookCustomer(threadId) {
    const sourceList = conversationsList.concat(doneConversationsList);
    const thread = sourceList.find(c => c.id === threadId);
    if (!thread) return;

    const assignData = assignedThreadsMap[threadId] || {};
    const cateringRider = typeof assignData === 'object' ? assignData.riderName : assignData;
    const threadStatus = typeof assignData === 'object' ? assignData.status : (cateringRider ? 'catering' : 'open');

    const myName = (appState.riderName || "").trim();
    const myId = (appState.telegramId || "").trim();
    const isAdmin = isRiderAdmin(myName, myId);
    const adminControlsChecked = !!document.getElementById('admin-controls-toggle')?.checked;

    if (threadStatus !== 'catering' || !cateringRider) {
        showToast("⚠️ Customer must be catered by a rider before marking as DONE!");
        return;
    }

    if (cateringRider !== myName && !(isAdmin && adminControlsChecked)) {
        showToast(`⚠️ Only ${cateringRider} who is catering this customer can click DONE!`);
        return;
    }

    requestSlideConfirmation(
        "CONFIRM COMPLETE & DONE",
        `I-mark as DONE at magpadala ng thank you message kay ${thread.customerName}?`,
        () => executeDoneFacebookCustomer(threadId)
    );
}

async function executeDoneFacebookCustomer(threadId) {
    const sourceList = conversationsList.concat(doneConversationsList);
    const thread = sourceList.find(c => c.id === threadId);
    if (!thread) return;

    const myName = (appState.riderName || "").trim();
    const doneTimestamp = Date.now();

    assignedThreadsMap[threadId] = {
        riderName: null,
        status: 'done',
        doneAt: doneTimestamp,
        timestamp: doneTimestamp
    };

    const newMsg = {
        id: `MSG_${Date.now()}`,
        text: END_MESSAGE,
        sender: appState.riderName || "Lokalex Admin",
        isRider: true,
        isLocallySent: true,
        timestamp: doneTimestamp
    };

    if (!thread.messages) thread.messages = [];
    thread.messages.push(newMsg);
    thread.lastMessage = END_MESSAGE;
    thread.lastMessageIsRider = true;
    thread.lastUpdated = doneTimestamp;

    // Instantly remove thread from active inbox array
    conversationsList = conversationsList.filter(c => c.id !== threadId);

    renderThreadsList();
    if (activeThreadId === threadId) {
        renderThreadMessages(activeThreadId, true);
    }
    showToast(`✅ Customer ${thread.customerName} marked DONE! Moved to Meta Business Done folder.`);

    if (db) {
        db.ref(`facebook_assignments/${threadId}`).set({
            riderName: null,
            status: 'done',
            doneAt: doneTimestamp,
            timestamp: doneTimestamp
        });
        db.ref(`facebook_inbox/${threadId}/messages`).push(newMsg);
    }

    const token = getPageToken();
    if (token && threadId) {
        try {
            const recipientId = thread?.senderId || threadId;
            await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: { id: recipientId },
                    message: { text: END_MESSAGE }
                })
            });
        } catch(e) {
            console.error("End message send error:", e);
        }
    }

    markMetaConversationDone(threadId);
    checkAndUpdateRosterAutoAvailable(myName);
}

function checkAndUpdateRosterAutoAvailable(riderName) {
    if (!riderName) return;

    const remainingCatered = Object.values(assignedThreadsMap).filter(item => {
        const rName = typeof item === 'object' ? item.riderName : item;
        const status = typeof item === 'object' ? item.status : (rName ? 'catering' : 'open');
        return rName === riderName && status === 'catering';
    });

    if (remainingCatered.length === 0 && db && appState.telegramId) {
        db.ref(`roster/${appState.telegramId}`).update({
            status: 'Available',
            customerName: '',
            cateringStartTime: ''
        });
        showToast("🛵 All catered orders finished! Automatically set to AVAILABLE in roster.");
    }
}

// Quick Button 1: SEND IMAGE
export function triggerSendImage() {
    const input = document.getElementById('fb-image-file-input');
    if (input) input.click();
}

export function handleSendImageFile(event) {
    const file = event.target?.files?.[0];
    if (!file) return;

    if (!activeThreadId) return showToast("⚠️ Please select a customer conversation first.");

    showToast("📸 Processing image...");

    const reader = new FileReader();
    reader.onload = async (e) => {
        const imageDataUrl = e.target.result;
        const sourceList = conversationsList.concat(doneConversationsList);
        const thread = sourceList.find(c => c.id === activeThreadId);
        const senderName = appState.riderName || "Lokalex Admin";

        const newMsg = {
            id: `MSG_${Date.now()}`,
            text: `📷 [Sent Image]`,
            imageUrl: imageDataUrl,
            sender: senderName,
            isRider: true,
            isLocallySent: true,
            timestamp: Date.now()
        };

        if (thread) {
            if (!thread.messages) thread.messages = [];
            thread.messages.push(newMsg);
            thread.lastMessage = "📷 [Sent Image]";
            thread.lastMessageIsRider = true;
            thread.lastUpdated = Date.now();
            renderThreadMessages(activeThreadId, true);
            renderThreadsList();
        }

        if (db) {
            db.ref(`facebook_inbox/${activeThreadId}/messages`).push(newMsg);
        }

        showToast("✅ Image sent!");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
}

// Quick Button 2: SEND COORDINATES
export function sendRiderCoordinates() {
    if (!activeThreadId) return showToast("⚠️ Please select a customer conversation first.");

    if (!navigator.geolocation) {
        return showToast("⚠️ Geolocation is not supported on this device.");
    }

    showToast("📡 Calibrating GPS location... Please wait.");

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const accuracy = pos.coords.accuracy || 999;

            if (accuracy > 100) {
                showToast(`⚠️ GPS signal is too weak (Accuracy: ${Math.round(accuracy)}m). Move to an open area and try again.`);
                return;
            }

            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const googleMapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
            const locationMsg = `📍 Rider Live Google Maps Location Pin:\n${googleMapsUrl}\n(GPS Accuracy: ±${Math.round(accuracy)}m)`;

            const input = document.getElementById('fb-message-input');
            if (input) {
                input.value = locationMsg;
                sendFacebookReply();
            }
        },
        (err) => {
            console.error("GPS Calibration Error:", err);
            showToast("⚠️ Could not calibrate GPS location. Please check phone GPS settings.");
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

// Quick Button 3: SEND RECEIPT
export function sendCurrentReceipt() {
    if (!activeThreadId) return showToast("⚠️ Please select a customer conversation first.");

    const sourceList = conversationsList.concat(doneConversationsList);
    const thread = sourceList.find(c => c.id === activeThreadId);
    const custName = (thread?.customerName || "").toLowerCase().trim();

    const receipts = globalState.globalDailyReceipts || [];
    let matchedReceipt = receipts.find(r => 
        r.receiptText && (
            (r.customerName && r.customerName.toLowerCase().trim() === custName) ||
            (r.receiptText.toLowerCase().includes(custName))
        )
    );

    const currentUiReceipt = document.getElementById('final-receipt-text')?.innerText || document.getElementById('final-receipt-text')?.textContent || "";
    let rawReceiptText = matchedReceipt?.receiptText || currentUiReceipt;

    if (rawReceiptText && rawReceiptText.length > 20) {
        let formattedReceipt = String(rawReceiptText)
            .replace(/\\n/g, '\n')
            .replace(/<br\s*[\/]?>/gi, '\n')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');

        const input = document.getElementById('fb-message-input');
        if (input) {
            input.value = formattedReceipt;
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 200) + 'px';
            input.focus();
            showToast("🧾 Receipt loaded with multi-line layout! Tap Send to deliver.");
        }
    } else {
        showToast("⚠️ Paki-finish at generate muna ang receipt sa Smart Cart bago ipadala.");
    }
}

export function showInboxThreadListMobile() {
    const threadPanel = document.getElementById('fb-threads-panel');
    const chatPanel = document.getElementById('fb-chat-panel');
    if (threadPanel) threadPanel.classList.remove('hidden');
    if (chatPanel) chatPanel.classList.add('hidden');
}

// RENDER STREAM MESSAGES (INCREMENTAL DOM PATCHING, SMART SCROLL POSITION LOCK & PASTAGE FETCH)
export function renderThreadMessages(threadId, forceScrollToBottom = false, isPaginationAppend = false) {
    const container = document.getElementById('fb-chat-messages');
    const headerName = document.getElementById('fb-[#0084FF]-cust-name');
    const headerAvatar = document.getElementById('fb-chat-header-avatar');

    const sourceList = conversationsList.concat(doneConversationsList);
    const thread = sourceList.find(c => c.id === threadId);
    if (!thread) return;

    if (headerName && headerName.innerText !== (thread.customerName || "Customer")) {
        headerName.innerText = thread.customerName || "Customer";
    }
    if (headerAvatar) {
        const newAvatar = thread.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(thread.customerName || 'C')}&background=0084FF&color=fff`;
        if (headerAvatar.src !== newAvatar) {
            headerAvatar.src = newAvatar;
        }
    }

    if (!container) return;

    if (!container.dataset.scrollListenerAttached) {
        container.dataset.scrollListenerAttached = "true";
        container.addEventListener('scroll', () => {
            if (container.scrollTop < 40 && activeThreadId) {
                loadOlderThreadMessages(activeThreadId);
            }
        });
    }

    const messages = thread.messages || [];

    if (messages.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-16 text-xs">No messages in this conversation.</div>`;
        container.dataset.currentThreadId = threadId;
        return;
    }

    const buildMsgHtml = (m) => {
        const isRider = m.isRider;
        
        let timeStr = "";
        if (m.timestamp) {
            timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        const imageMarkup = m.imageUrl ? `<img src="${m.imageUrl}" onerror="this.style.display='none'" class="max-w-[220px] sm:max-w-[280px] w-full min-h-[100px] bg-gray-800/50 rounded-xl mt-1 border border-black/20 object-cover shadow-sm block">` : '';
        const textMarkup = m.text && m.text.trim() ? `<div class="leading-relaxed whitespace-pre-wrap font-sans break-words">${escapeHtml(m.text)}</div>` : '';
        const senderLabel = escapeHtml(m.sender || (isRider ? "Meta Business Suite" : (thread.customerName || "Customer")));

        if (isRider) {
            return `
            <div data-msg-id="${m.id}" class="flex flex-col items-end my-1 self-end max-w-[85%] sm:max-w-[75%]">
                <div class="bg-[#0084FF] text-white p-2.5 px-3.5 rounded-2xl rounded-tr-none text-xs leading-relaxed shadow-sm font-sans w-fit max-w-full break-words">
                    ${textMarkup}
                    ${imageMarkup}
                </div>
                <div class="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1">
                    <span>Sent by <strong class="text-gray-200">${senderLabel}</strong></span>
                    <i class="fa-solid fa-circle-info text-[9px] text-gray-500"></i>
                    <span class="font-mono ml-1">${timeStr}</span>
                </div>
            </div>`;
        } else {
            return `
            <div data-msg-id="${m.id}" class="flex gap-2 my-1 self-start max-w-[85%] sm:max-w-[75%]">
                <img src="${thread.avatarUrl || 'https://img.icons8.com/color/48/user-male-circle--v1.png'}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(thread.customerName || 'C')}&background=0084FF&color=fff'" class="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5 border border-gray-700 shadow-sm">
                <div class="flex flex-col">
                    <div class="bg-[#3a3b3c] text-gray-100 p-2.5 px-3.5 rounded-2xl rounded-tl-none text-xs leading-relaxed shadow-sm font-sans w-fit max-w-full break-words">
                        ${textMarkup}
                        ${imageMarkup}
                    </div>
                    <div class="text-[9px] text-gray-400 mt-0.5 font-mono">${timeStr}</div>
                </div>
            </div>`;
        }
    };

    const isNewThread = container.dataset.currentThreadId !== threadId;

    if (isNewThread || forceScrollToBottom || isPaginationAppend || !container.querySelector('[data-msg-id]')) {
        container.dataset.currentThreadId = threadId;
        container.innerHTML = messages.map(m => buildMsgHtml(m)).join('');
        if (forceScrollToBottom || isNewThread) {
            container.scrollTop = container.scrollHeight;
        }
        return;
    }

    const existingNodeMap = new Map();
    container.querySelectorAll('[data-msg-id]').forEach(node => {
        existingNodeMap.set(node.dataset.msgId, node);
    });

    const newMessages = messages.filter(m => !existingNodeMap.has(String(m.id)));

    if (newMessages.length > 0) {
        const isUserNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 120;
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newMessages.map(m => buildMsgHtml(m)).join('');
        
        while (tempDiv.firstChild) {
            container.appendChild(tempDiv.firstChild);
        }

        if (isUserNearBottom) {
            container.scrollTop = container.scrollHeight;
        }
    }
}

export function updateAssignmentBanner() {
    const banner = document.getElementById('fb-assignment-banner');
    const assignBtnText = document.getElementById('fb-assign-text');
    if (!banner || !activeThreadId) return;

    const assignData = assignedThreadsMap[activeThreadId];
    const assignedRider = typeof assignData === 'object' ? assignData.riderName : assignData;

    if (assignedRider) {
        banner.classList.remove('hidden');
        if (assignBtnText) assignBtnText.innerHTML = `Assigned to <strong class="text-white">${escapeHtml(assignedRider)}</strong>`;
    } else {
        banner.classList.remove('hidden');
        if (assignBtnText) assignBtnText.innerHTML = `Do you want to be assigned to this conversation? <button onclick="assignConversationToMe()" class="text-[#0084FF] underline font-bold ml-1">Assign to me</button>`;
    }
}

export function assignConversationToMe() {
    if (!activeThreadId) return;
    const rider = appState.riderName || "Lokalex Admin";

    assignedThreadsMap[activeThreadId] = {
        riderName: rider,
        status: 'catering',
        timestamp: Date.now()
    };

    if (db) {
        db.ref(`facebook_assignments/${activeThreadId}`).set({
            riderName: rider,
            status: 'catering',
            timestamp: Date.now()
        });
    }

    showToast(`✅ Assigned conversation to ${rider}!`);
    updateAssignmentBanner();
    renderThreadsList();
}

export function dismissAssignmentBanner() {
    const banner = document.getElementById('fb-assignment-banner');
    if (banner) banner.classList.add('hidden');
}

export async function sendFacebookReply() {
    const input = document.getElementById('fb-message-input');
    const text = input ? input.value.trim() : "";

    if (!text) return showToast("⚠️ Please enter a reply message.");
    if (!activeThreadId) return showToast("⚠️ Please select a customer conversation first.");

    const sourceList = conversationsList.concat(doneConversationsList);
    const thread = sourceList.find(c => c.id === activeThreadId);
    const senderName = appState.riderName || "Lokalex Admin";

    const newMsg = {
        id: `MSG_${Date.now()}`,
        text: text,
        sender: senderName,
        isRider: true,
        isLocallySent: true,
        timestamp: Date.now()
    };

    if (thread) {
        if (!thread.messages) thread.messages = [];
        thread.messages.push(newMsg);
        thread.lastMessage = text;
        thread.lastMessageIsRider = true;
        thread.lastUpdated = Date.now();
        renderThreadMessages(activeThreadId, true);
        renderThreadsList();
    }

    if (input) {
        input.value = "";
        input.style.height = 'auto';
    }

    if (db) {
        db.ref(`facebook_inbox/${activeThreadId}/messages`).push(newMsg);
    }

    const token = getPageToken();
    if (token && activeThreadId) {
        try {
            const recipientId = thread?.senderId || activeThreadId;
            await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: { id: recipientId },
                    message: { text: text }
                })
            });
            showToast("✅ Reply sent to Facebook Messenger!");
        } catch(e) {
            console.error("Graph API send error:", e);
        }
    }
}

export function sendThumbsUp() {
    const input = document.getElementById('fb-message-input');
    if (input) {
        input.value = "👍";
        sendFacebookReply();
    }
}

export function promptSaveFacebookPageToken() {
    const currentToken = getPageToken();
    const newToken = prompt("Enter your Facebook Page Access Token for direct messaging:", currentToken);
    if (newToken !== null) {
        localStorage.setItem('lokalex_fb_page_token', newToken.trim());
        showToast("✅ Page Access Token saved!");
        fetchFacebookConversations();
    }
}

if (typeof window !== 'undefined') {
    window.openFacebookMessagesModal = openFacebookMessagesModal;
    window.closeFacebookMessagesModal = closeFacebookMessagesModal;
    window.selectFacebookThread = selectFacebookThread;
    window.selectFacebookThreadByCustomerName = selectFacebookThreadByCustomerName;
    window.setInboxFilter = setInboxFilter;
    window.showInboxThreadListMobile = showInboxThreadListMobile;
    window.filterFacebookThreads = filterFacebookThreads;
    window.caterFacebookCustomer = caterFacebookCustomer;
    window.cancelCaterFacebookCustomer = cancelCaterFacebookCustomer;
    window.updateCancelCaterButtonUI = updateCancelCaterButtonUI;
    window.createReceiptFromChat = createReceiptFromChat;
    window.hideFacebookCustomer = hideFacebookCustomer;
    window.doneFacebookCustomer = doneFacebookCustomer;
    window.sendFacebookReply = sendFacebookReply;
    window.sendThumbsUp = sendThumbsUp;
    window.triggerSendImage = triggerSendImage;
    window.handleSendImageFile = handleSendImageFile;
    window.sendRiderCoordinates = sendRiderCoordinates;
    window.sendCurrentReceipt = sendCurrentReceipt;
    window.assignConversationToMe = assignConversationToMe;
    window.dismissAssignmentBanner = dismissAssignmentBanner;
    window.refreshFacebookInbox = fetchFacebookConversations;
    window.promptSaveFacebookPageToken = promptSaveFacebookPageToken;
    window.toggleFacebookNewMessageAlarm = toggleFacebookNewMessageAlarm;
    window.isCurrentRiderFirstAvailable = isCurrentRiderFirstAvailable;
    window.releaseRiderCateredCustomers = releaseRiderCateredCustomers;
}