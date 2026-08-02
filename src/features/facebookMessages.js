// src/features/facebookMessages.js
import { db } from '../config/firebase.js';
import { FB_PAGE_TOKEN } from '../config/constants.js';
import { escapeHtml } from '../utils/helpers.js';

export async function fetchFacebookPageMessages() {
    const feed = document.getElementById('fb-page-messages-feed');
    if (!feed) return;

    feed.innerHTML = `
        <div class="text-center text-gray-500 italic py-16 text-xs">
            <i class="fa-solid fa-spinner fa-spin text-lg text-[#0084FF] mb-2 block"></i> Fetching Facebook Page Inbox...
        </div>`;

    let graphSuccess = false;

    // 1. Try Direct Meta Graph API Fetch
    if (FB_PAGE_TOKEN) {
        try {
            const res = await fetch(`https://graph.facebook.com/v19.0/me/conversations?fields=unread_count,updated_time,senders,messages.limit(1){message,created_time,from}&access_token=${FB_PAGE_TOKEN}`);
            const json = await res.json();

            if (json && json.data) {
                if (json.data.length > 0) {
                    renderGraphConversations(json.data);
                } else {
                    feed.innerHTML = `<div class="text-center text-gray-500 italic py-16 text-xs">No active conversations found on your Facebook Page.</div>`;
                }
                graphSuccess = true;
                return;
            } else if (json && json.error) {
                console.error("Meta Graph API Error:", json.error);
            }
        } catch (e) {
            console.warn("Graph API fetch exception, falling back to Firebase:", e);
        }
    }

    // 2. Fallback to Firebase Webhook Realtime Feed
    if (!graphSuccess && db) {
        db.ref('facebookMessages').once('value', (snapshot) => {
            const data = snapshot.val();
            if (!data) {
                feed.innerHTML = `
                    <div class="text-center text-gray-400 text-xs py-12 px-4 leading-relaxed">
                        <i class="fa-solid fa-inbox text-3xl text-gray-600 mb-3 block"></i>
                        <div class="font-bold text-white mb-1">No Messages Found</div>
                        <div class="text-[11px] text-gray-400">
                            Check Meta Developer settings for <code class="text-amber-400">pages_messaging</code> permission and subscribe your Page to the <code class="text-blue-400">messages</code> webhook field.
                        </div>
                    </div>`;
                return;
            }

            const msgList = Object.values(data);
            renderFirebaseMessages(msgList);
        }, (err) => {
            console.error("Firebase fetch error:", err);
            feed.innerHTML = `<div class="text-center text-red-400 italic py-16 text-xs">Unable to load messages. Check console.</div>`;
        });
    }
}

function renderGraphConversations(conversations) {
    const feed = document.getElementById('fb-page-messages-feed');
    if (!feed) return;

    feed.innerHTML = conversations.map(conv => {
        const sender = (conv.senders && conv.senders.data && conv.senders.data[0]) 
            ? conv.senders.data[0].name 
            : "Customer";
            
        const lastMsgObj = (conv.messages && conv.messages.data && conv.messages.data[0]) 
            ? conv.messages.data[0] 
            : null;
            
        const rawText = lastMsgObj ? lastMsgObj.message : "(Attachment or Media)";
        const safeText = typeof escapeHtml === 'function' ? escapeHtml(rawText) : rawText;
        const safeSender = typeof escapeHtml === 'function' ? escapeHtml(sender) : sender;
        
        let timeStr = "";
        if (conv.updated_time) {
            const dateObj = new Date(conv.updated_time);
            timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        const isUnread = conv.unread_count > 0;

        return `
        <div class="bg-inputBg/90 border ${isUnread ? 'border-[#0084FF]' : 'border-gray-700/60'} p-3 rounded-xl flex flex-col gap-1 shadow-sm">
            <div class="flex justify-between items-center font-bold">
                <span class="text-[#0084FF] flex items-center gap-1.5">
                    <i class="fa-brands fa-facebook-messenger"></i> ${safeSender}
                    ${isUnread ? `<span class="w-2 h-2 rounded-full bg-[#0084FF] animate-pulse"></span>` : ''}
                </span>
                <span class="text-[10px] text-gray-400 font-mono">${typeof escapeHtml === 'function' ? escapeHtml(timeStr) : timeStr}</span>
            </div>
            <div class="text-gray-200 text-xs leading-relaxed mt-0.5">${safeText}</div>
        </div>`;
    }).join('');
}

function renderFirebaseMessages(msgList) {
    const feed = document.getElementById('fb-page-messages-feed');
    if (!feed) return;

    feed.innerHTML = msgList.slice().reverse().map(msg => {
        const sender = msg.senderName || msg.sender || "FB Customer";
        const text = msg.text || msg.message || "(Attachment)";
        const safeSender = typeof escapeHtml === 'function' ? escapeHtml(sender) : sender;
        const safeText = typeof escapeHtml === 'function' ? escapeHtml(text) : text;
        
        let timeStr = msg.timeStr || "";
        if (!timeStr && (msg.timestamp || msg.time)) {
            const dateObj = new Date(msg.timestamp || msg.time);
            timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        return `
        <div class="bg-inputBg/90 border border-gray-700/60 p-3 rounded-xl flex flex-col gap-1 shadow-sm">
            <div class="flex justify-between items-center font-bold">
                <span class="text-[#0084FF] flex items-center gap-1.5"><i class="fa-brands fa-facebook-messenger"></i> ${safeSender}</span>
                <span class="text-[10px] text-gray-400 font-mono">${typeof escapeHtml === 'function' ? escapeHtml(timeStr) : timeStr}</span>
            </div>
            <div class="text-gray-200 text-xs leading-relaxed mt-0.5">${safeText}</div>
        </div>`;
    }).join('');
}

// Explicit window binding
if (typeof window !== 'undefined') {
    window.fetchFacebookPageMessages = fetchFacebookPageMessages;
}