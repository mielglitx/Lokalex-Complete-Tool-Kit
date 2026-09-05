// src/features/chat/riderChatRender.js
import { appState } from '../../store/state.js';
import { escapeHtml } from '../../utils/helpers.js';

const MAPS_API_KEY = "AIzaSyBVAwn0UnyHJ926oHeK0k789ncADMzmX80";

let longPressTimer = null;
let startX = 0;
let startY = 0;

// RAPID CLICK / TAP TRACKER
const tapTrackerMap = new Map();

const FUN_ANIMATIONS = [
    // 1. Jelly Squish & Stretch
    [
        { transform: 'scale(1, 1)' },
        { transform: 'scale(1.22, 0.78)' },
        { transform: 'scale(0.82, 1.18)' },
        { transform: 'scale(1.08, 0.94)' },
        { transform: 'scale(1, 1)' }
    ],
    // 2. Playful Wobble Tilt
    [
        { transform: 'rotate(0deg)' },
        { transform: 'rotate(-14deg)' },
        { transform: 'rotate(12deg)' },
        { transform: 'rotate(-8deg)' },
        { transform: 'rotate(4deg)' },
        { transform: 'rotate(0deg)' }
    ],
    // 3. Elastic Spring Pop
    [
        { transform: 'scale(1)' },
        { transform: 'scale(1.28)' },
        { transform: 'scale(0.92)' },
        { transform: 'scale(1.06)' },
        { transform: 'scale(1)' }
    ],
    // 4. Kinetic Shake
    [
        { transform: 'translate(0, 0)' },
        { transform: 'translate(-8px, 2px) rotate(-3deg)' },
        { transform: 'translate(8px, -2px) rotate(3deg)' },
        { transform: 'translate(-5px, -1px) rotate(-1deg)' },
        { transform: 'translate(5px, 1px) rotate(1deg)' },
        { transform: 'translate(0, 0)' }
    ],
    // 5. Heartbeat Pulse
    [
        { transform: 'scale(1)' },
        { transform: 'scale(1.18)' },
        { transform: 'scale(0.96)' },
        { transform: 'scale(1.12)' },
        { transform: 'scale(1)' }
    ]
];

const FUN_EMOJIS = ['⚡', '🔥', '✨', '🎉', '🚀', '💖', '💥', '⭐'];

function triggerRandomBubbleFun(bubbleEl) {
    if (!bubbleEl) return;

    // Pick random keyframe animation
    const randomKeyframes = FUN_ANIMATIONS[Math.floor(Math.random() * FUN_ANIMATIONS.length)];
    bubbleEl.animate(randomKeyframes, {
        duration: 400,
        easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
    });

    // Floating particle particle burst
    const particle = document.createElement('span');
    particle.className = 'pointer-events-none absolute text-sm select-none z-30';
    particle.innerText = FUN_EMOJIS[Math.floor(Math.random() * FUN_EMOJIS.length)];

    const rect = bubbleEl.getBoundingClientRect();
    const parentRect = bubbleEl.parentElement.getBoundingClientRect();

    particle.style.left = `${(rect.width / 2) + (Math.random() * 30 - 15)}px`;
    particle.style.top = `0px`;

    if (!bubbleEl.style.position || bubbleEl.style.position === 'static') {
        bubbleEl.style.position = 'relative';
    }

    bubbleEl.appendChild(particle);

    particle.animate([
        { transform: 'translateY(0) scale(0.6)', opacity: 1 },
        { transform: `translateY(-40px) translateX(${Math.random() * 30 - 15}px) scale(1.3)`, opacity: 0 }
    ], {
        duration: 650,
        easing: 'ease-out'
    }).onfinish = () => particle.remove();
}

export function handleMsgPointerDown(e, msgId, chatType, text, sender) {
    if (e.button && e.button !== 0) return;
    if (e.target && e.target.closest('a, button, img')) return;

    startX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
    startY = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);

    clearTimeout(longPressTimer);

    longPressTimer = setTimeout(() => {
        if (navigator.vibrate) {
            try { navigator.vibrate(40); } catch (_) {}
        }
        if (window.openMessageActionPopover) {
            window.openMessageActionPopover(e, msgId, chatType, text, sender);
        }
        longPressTimer = null;
    }, 450);
}

export function handleMsgPointerMove(e) {
    if (!longPressTimer) return;
    const currentX = e.clientX ?? (e.touches ? e.touches[0].clientX : 0);
    const currentY = e.clientY ?? (e.touches ? e.touches[0].clientY : 0);

    if (Math.abs(currentX - startX) > 10 || Math.abs(currentY - startY) > 10) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
}

export function handleMsgPointerUp(e, msgId) {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;

        // Rapid click detection
        const now = Date.now();
        const prev = tapTrackerMap.get(msgId) || { count: 0, lastTime: 0 };
        const isRapid = (now - prev.lastTime) < 450;

        const newCount = isRapid ? prev.count + 1 : 1;
        tapTrackerMap.set(msgId, { count: newCount, lastTime: now });

        if (newCount >= 2) {
            const bubbleEl = e?.currentTarget || document.getElementById(`msg-bubble-${msgId}`)?.querySelector('.select-none');
            triggerRandomBubbleFun(bubbleEl);
        }
    }
}

export function handleMsgContextMenu(e, msgId, chatType, text, sender) {
    e.preventDefault();
    e.stopPropagation();
    if (window.openMessageActionPopover) {
        window.openMessageActionPopover(e, msgId, chatType, text, sender);
    }
}

export function renderRiderMessageStatusIndicator(msg) {
    const sentTime = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
    const seenTime = msg.seenAt ? new Date(msg.seenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
    
    let iconHtml = '<i class="fa-regular fa-clock text-blue-200" title="Sending..."></i>';
    let titleAttr = `Sent ${sentTime}`;

    if (msg.status === 'sent') {
        iconHtml = '<i class="fa-solid fa-check text-blue-200" title="Sent"></i>';
    } else if (msg.status === 'delivered') {
        iconHtml = '<i class="fa-solid fa-check-double text-blue-200" title="Delivered"></i>';
        titleAttr += ` • Delivered`;
    } else if (msg.status === 'seen') {
        iconHtml = '<i class="fa-solid fa-check-double text-cyan-200" title="Seen"></i>';
        titleAttr += ` • Seen at ${seenTime}`;
    }

    return `<span class="inline-flex items-center gap-1 ml-1 cursor-help" title="${titleAttr}">
        ${iconHtml}
        ${msg.status === 'seen' && seenTime ? `<span class="text-[8px] text-cyan-200 opacity-90 font-mono">Seen ${seenTime}</span>` : ''}
    </span>`;
}

export function renderReactionsHtml(reactions, msgId) {
    if (!reactions || typeof reactions !== 'object') return '';
    const reactionEntries = Object.entries(reactions);
    if (reactionEntries.length === 0) return '';

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || 'rider').toString();

    const badges = reactionEntries.map(([emoji, usersMap]) => {
        if (!usersMap || typeof usersMap !== 'object') return '';
        const count = Object.keys(usersMap).length;
        if (count === 0) return '';
        const hasReacted = myId && usersMap[myId];

        return `
        <button onclick="event.stopPropagation(); window.toggleRiderMessageReaction('${msgId}', '${emoji}')" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] ${hasReacted ? 'bg-blue-600/30 border border-blue-400 text-white' : 'bg-gray-100 dark:bg-black/60 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300'} transition active:scale-90">
            <span>${emoji}</span>
            <span class="font-bold text-[9px]">${count}</span>
        </button>`;
    }).join('');

    return badges ? `<div class="flex flex-wrap gap-1 mt-1">${badges}</div>` : '';
}

export function renderReplyPreviewInsideMessage(replyTo) {
    if (!replyTo || !replyTo.text) return '';
    const clickHandler = replyTo.id ? `event.stopPropagation(); window.scrollToBubble('${replyTo.id}')` : '';
    return `
    <div ${clickHandler ? `onclick="${clickHandler}"` : ''} class="bg-black/10 dark:bg-black/40 border-l-2 border-amber-400 px-2 py-1 rounded-r-lg mb-1.5 text-[10px] opacity-90 truncate max-w-full cursor-pointer hover:opacity-100 transition">
        <div class="font-bold text-amber-600 dark:text-amber-300 truncate flex items-center gap-1">
            <i class="fa-solid fa-reply text-[8px]"></i>
            <span>${escapeHtml(replyTo.sender || 'Reply')}</span>
        </div>
        <div class="text-gray-700 dark:text-gray-200 truncate">${escapeHtml(replyTo.text)}</div>
    </div>`;
}

export function showRiderInChatToast(container, senderName, previewText) {
    let toast = document.getElementById('rider-inchat-newmsg-toast');
    const parent = container.parentElement;

    if (parent && !parent.classList.contains('relative')) {
        parent.classList.add('relative');
    }

    if (!toast && parent) {
        toast = document.createElement('div');
        toast.id = 'rider-inchat-newmsg-toast';
        toast.className = 'absolute bottom-14 left-4 right-4 bg-blue-600 text-white text-xs py-2 px-3 rounded-xl border border-blue-400 flex items-center justify-between cursor-pointer z-30 transition-all duration-200';
        parent.appendChild(toast);
    }

    if (toast) {
        toast.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                <i class="fa-solid fa-circle-down text-blue-200 text-sm shrink-0 animate-bounce"></i>
                <span class="truncate font-medium"><strong>${escapeHtml(senderName)}:</strong> ${escapeHtml(previewText)}</span>
            </div>
            <span class="text-[10px] bg-blue-800/80 px-2 py-0.5 rounded-md font-bold uppercase shrink-0">View ↓</span>
        `;

        toast.onclick = () => {
            container.scrollTop = container.scrollHeight;
            toast.classList.add('hidden');
        };

        toast.classList.remove('hidden');
    }
}

export function hideRiderInChatToast() {
    const toast = document.getElementById('rider-inchat-newmsg-toast');
    if (toast) toast.classList.add('hidden');
}

export function showRiderTopSpinner(container) {
    let spinner = document.getElementById('rider-chat-history-spinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'rider-chat-history-spinner';
        spinner.className = 'flex items-center justify-center py-2 text-blue-600 dark:text-blue-400 text-xs gap-2 font-bold shrink-0';
        spinner.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading older messages...`;
    }
    if (container.firstChild) {
        container.insertBefore(spinner, container.firstChild);
    } else {
        container.appendChild(spinner);
    }
}

export function hideRiderTopSpinner() {
    const spinner = document.getElementById('rider-chat-history-spinner');
    if (spinner) spinner.remove();
}

export function renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, isInitialLoad = false, oldScrollHeight = 0, activeCustData = null) {
    const msgs = Array.from(loadedRiderMsgsMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const riderName = appState.riderName || "Rider";
    const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";
    const custAvatar = activeCustData?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=0084FF&color=fff`;
    const riderAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(riderName)}&background=3B82F6&color=fff`;

    const messagesHtml = msgs.map(m => {
        const isRider = !!m.isRider || m.senderType === 'rider';
        const alignClass = isRider 
            ? "self-end bg-blue-600 text-white rounded-tr-none" 
            : "self-start bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-200 rounded-tl-none";
        const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";

        const senderName = m.sender || (isRider ? riderName : custName);
        const senderAvatar = isRider ? riderAvatar : custAvatar;
        const statusIndicator = isRider ? renderRiderMessageStatusIndicator(m) : '';
        const replyBlockHtml = renderReplyPreviewInsideMessage(m.replyTo);
        const reactionsHtml = renderReactionsHtml(m.reactions, m.id);

        const imgHtml = m.imageUrl || (m.type === 'image' ? m.text : null);
        const imageMarkup = imgHtml ? `<img src="${imgHtml}" onclick="event.stopPropagation(); window.openImageViewerModal && window.openImageViewerModal('${escapeHtml(imgHtml)}', 'rider')" class="w-52 max-w-full rounded-xl mt-1.5 border border-gray-200 dark:border-gray-700 cursor-pointer hover:opacity-90 transition">` : '';
        
        let locationHtml = "";
        let lat = null;
        let lng = null;

        if (m.locationCoords && m.locationCoords.lat && m.locationCoords.lng) {
            lat = m.locationCoords.lat;
            lng = m.locationCoords.lng;
        } else if (m.type === 'location' && m.text) {
            const match = m.text.match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (match) {
                lat = match[1];
                lng = match[2];
            }
        }

        if (lat && lng) {
            const mapUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
            const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&size=400x200&maptype=roadmap&markers=color:red%7C${lat},${lng}&key=${MAPS_API_KEY}`;

            locationHtml = `
            <div class="mt-1.5 flex flex-col gap-1 rounded-xl overflow-hidden border border-emerald-500/40 bg-gray-50 dark:bg-black/40 p-1">
                <a href="${mapUrl}" target="_blank" onclick="event.stopPropagation()" class="block relative group overflow-hidden rounded-lg">
                    <img src="${staticMapUrl}" alt="Map Location Preview" class="w-full h-32 object-cover rounded-lg group-hover:scale-105 transition-transform duration-200">
                    <div class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <span class="bg-black/80 text-white text-[10px] font-bold px-2 py-1 rounded-md"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open in Maps</span>
                    </div>
                </a>
                <a href="${mapUrl}" target="_blank" onclick="event.stopPropagation()" class="bg-emerald-600/20 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 font-bold px-2.5 py-1.5 rounded-lg text-[11px] flex items-center justify-center gap-1.5 active:scale-95 transition">
                    <i class="fa-solid fa-map-location-dot text-red-400"></i> View Shared Location
                </a>
            </div>`;
        }

        const encodedText = encodeURIComponent(m.text || '');
        const encodedSender = encodeURIComponent(senderName);

        return `
        <div id="msg-bubble-${m.id}" class="flex items-start gap-1.5 ${isRider ? 'flex-row-reverse' : 'flex-row'} my-0.5">
            <img src="${senderAvatar}" class="w-6 h-6 rounded-full object-cover border border-blue-400/40 shrink-0 mt-1 pointer-events-none">
            <div 
                onpointerdown="window.handleMsgPointerDown(event, '${m.id}', 'rider-cust', '${encodedText}', '${encodedSender}')"
                onpointermove="window.handleMsgPointerMove(event)"
                onpointerup="window.handleMsgPointerUp(event, '${m.id}')"
                onpointercancel="window.handleMsgPointerUp(event, '${m.id}')"
                oncontextmenu="window.handleMsgContextMenu(event, '${m.id}', 'rider-cust', '${encodedText}', '${encodedSender}')"
                class="max-w-[85%] p-2.5 rounded-2xl flex flex-col gap-0.5 text-xs ${alignClass} cursor-pointer transition active:scale-[0.98] select-none shadow-xs">
                <div class="text-[9px] ${isRider ? 'text-blue-100' : 'text-blue-600 dark:text-blue-400'} font-bold flex justify-between gap-3 pointer-events-none">
                    <span>${escapeHtml(senderName)}</span>
                    <div class="flex items-center gap-1 opacity-80 font-mono">
                        <span>${timeStr}</span>
                        ${statusIndicator}
                    </div>
                </div>
                ${replyBlockHtml}
                ${(m.text && !imgHtml && !locationHtml) ? `<div class="leading-relaxed whitespace-pre-wrap font-sans break-words pointer-events-none">${escapeHtml(m.text)}</div>` : ''}
                ${imageMarkup}
                ${locationHtml}
                ${reactionsHtml}
            </div>
        </div>`;
    }).join('');

    let topHeader = '';
    if (!hasMoreRiderMsgs) {
        topHeader = `<div class="text-center text-gray-500 dark:text-gray-400 text-[10px] py-1.5 italic shrink-0">Beginning of message history</div>`;
    }

    container.innerHTML = topHeader + messagesHtml;

    if (isInitialLoad) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 80);
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 250);
        });
    } else if (oldScrollHeight > 0) {
        const newScrollHeight = container.scrollHeight;
        container.scrollTop = newScrollHeight - oldScrollHeight;
    }
}

if (typeof window !== 'undefined') {
    window.handleMsgPointerDown = handleMsgPointerDown;
    window.handleMsgPointerMove = handleMsgPointerMove;
    window.handleMsgPointerUp = handleMsgPointerUp;
    window.handleMsgContextMenu = handleMsgContextMenu;
}