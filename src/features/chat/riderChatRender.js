// src/features/chat/riderChatRender.js
import { appState } from '../../store/state.js';
import { escapeHtml } from '../../utils/helpers.js';

const MAPS_API_KEY = "AIzaSyBVAwn0UnyHJ926oHeK0k789ncADMzmX80";

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

        return `
        <div id="msg-bubble-${m.id}" class="flex items-start gap-1.5 ${isRider ? 'flex-row-reverse' : 'flex-row'} my-0.5">
            <img src="${senderAvatar}" class="w-6 h-6 rounded-full object-cover border border-blue-400/40 shrink-0 mt-1">
            <div onclick="window.openMessageActionPopover(event, '${m.id}', 'rider-cust', '${encodeURIComponent(m.text || '')}', '${encodeURIComponent(senderName)}')" class="max-w-[85%] p-2.5 rounded-2xl flex flex-col gap-0.5 text-xs ${alignClass} cursor-pointer transition active:scale-[0.98] select-text shadow-xs">
                <div class="text-[9px] ${isRider ? 'text-blue-100' : 'text-blue-600 dark:text-blue-400'} font-bold flex justify-between gap-3">
                    <span>${escapeHtml(senderName)}</span>
                    <div class="flex items-center gap-1 opacity-80 font-mono">
                        <span>${timeStr}</span>
                        ${statusIndicator}
                    </div>
                </div>
                ${replyBlockHtml}
                ${(m.text && !imgHtml && !locationHtml) ? `<div class="leading-relaxed whitespace-pre-wrap font-sans break-words">${escapeHtml(m.text)}</div>` : ''}
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