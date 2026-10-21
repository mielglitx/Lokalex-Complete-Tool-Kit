
// src/features/chat/riderChatRender.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { escapeHtml } from '../../utils/helpers.js';
import { isRiderMatch } from '../roster/rosterUtils.js';
import { formatChatDateTime, getMessageTimestamp } from './chatUtils.js';
import { showToast } from '../../ui/notifications.js';
import { openSlideDeleteModal } from '../../ui/modals.js';
import { saveImageToDevice } from '../../utils/imageSaver.js';

const MAPS_API_KEY = "AIzaSyBVAwn0UnyHJ926oHeK0k789ncADMzmX80";

let activeChatSelectedPhone = null;

export function formatChatTextWithPhoneLinks(rawText) {
    if (!rawText) return '';
    const safeText = escapeHtml(rawText);

    // 1. Matches URLs starting with http://, https://, or www.
    const urlRegex = /(https?:\/\/[^\s<>"'{}|\\^`]+|(?:^|[\s(])www\.[^\s<>"'{}|\\^`]+)/gi;

    // 2. Matches phone numbers starting with +63, 09, or 9
    const phoneRegex = /(?:(?:\+63)|(?:\b09)|(?:\b9))[\d\s\-()]{5,20}\b/g;

    // First, linkify web URLs and detect dedicated app intents
    const withLinks = safeText.replace(urlRegex, (fullMatch, urlGroup) => {
        let cleanUrl = urlGroup.trim();
        let prefix = '';
        if (fullMatch.startsWith(' ') || fullMatch.startsWith('(')) {
            prefix = fullMatch[0];
            cleanUrl = cleanUrl.substring(1);
        }

        const fullHref = cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') 
            ? cleanUrl 
            : `https://${cleanUrl}`;

        // Determine appropriate app badge and icon
        let appIcon = '<i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>';
        let badgeClass = 'text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200';
        let appTitle = 'Open Link';

        if (/maps\.google\.com|google\.com\/maps|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(fullHref)) {
            appIcon = '<i class="fa-solid fa-map-location-dot text-emerald-600 dark:text-emerald-400 text-[10px]"></i>';
            badgeClass = 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200';
            appTitle = 'Open in Google Maps';
        } else if (/maps\.apple\.com/i.test(fullHref)) {
            appIcon = '<i class="fa-solid fa-map text-emerald-500 text-[10px]"></i>';
            badgeClass = 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200';
            appTitle = 'Open in Apple Maps';
        } else if (/(?:facebook\.com|fb\.me|fb\.watch|m\.me|fb\.com)/i.test(fullHref)) {
            appIcon = '<i class="fa-brands fa-facebook text-blue-600 dark:text-blue-400 text-[11px]"></i>';
            badgeClass = 'text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200';
            appTitle = 'Open in Facebook';
        }

        const encodedHref = encodeURIComponent(fullHref).replace(/'/g, '%27');
        const linkHtml = `<a href="${fullHref}" onclick="event.stopPropagation(); window.handleChatLinkClick && window.handleChatLinkClick(event, '${encodedHref}')" class="inline-flex items-center gap-1 font-bold underline ${badgeClass} break-all transition active:scale-95 cursor-pointer" title="${appTitle}" target="_blank" rel="noopener noreferrer">${appIcon}<span>${cleanUrl}</span></a>`;

        return prefix + linkHtml;
    });

    // Second, linkify phone numbers in remaining plain text segments
    return withLinks.replace(phoneRegex, (match) => {
        if (match.includes('<a') || match.includes('</a>')) return match;
        const digits = match.replace(/\D/g, '');
        if (digits.length <= 6) return match;

        let normalized = digits;
        if (match.trim().startsWith('+63')) {
            normalized = '+' + digits;
        } else if (match.trim().startsWith('9') && digits.length === 10) {
            normalized = '0' + digits;
        } else if (match.trim().startsWith('09')) {
            normalized = digits;
        }

        return `<button type="button" onclick="event.stopPropagation(); window.handleChatPhoneClick && window.handleChatPhoneClick('${normalized}')" class="inline-flex items-center gap-1 font-bold underline text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 bg-blue-500/10 hover:bg-blue-500/20 px-1.5 py-0.5 rounded transition active:scale-95 cursor-pointer"><i class="fa-solid fa-phone text-[9px]"></i><span>${match}</span></button>`;
    });
}

export async function handleChatLinkClick(event, encodedUrl) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const url = decodeURIComponent(encodedUrl || '');
    if (!url) return;

    if (typeof window.openExternalLink === 'function') {
        await window.openExternalLink(url);
    } else {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

export function formatFileSize(bytes) {
    if (!bytes || isNaN(bytes)) return '';
    const num = Number(bytes);
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

export function isDocumentUrlOrType(msg) {
    if (!msg) return false;
    if (msg.type === 'file' || msg.type === 'document' || msg.fileUrl) return true;
    const url = msg.fileUrl || msg.imageUrl || msg.text || '';
    if (typeof url !== 'string') return false;
    const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase();
    const docExtensions = /\.(pdf|docx?|xlsx?|csv|pptx?|txt|zip|rar|7z|tar|gz|apk|rtf)$/i;
    return docExtensions.test(cleanUrl);
}

export function getDocumentDetails(msg) {
    const rawUrl = msg.fileUrl || msg.imageUrl || (typeof msg.text === 'string' && msg.text.startsWith('http') ? msg.text : '');
    let fileName = msg.fileName || '';
    if (!fileName && rawUrl) {
        try {
            const clean = rawUrl.split('?')[0].split('#')[0];
            const parts = clean.split('/');
            fileName = decodeURIComponent(parts[parts.length - 1] || 'Document');
        } catch (_) {
            fileName = 'Document';
        }
    }
    if (!fileName) fileName = 'Document';

    const extMatch = fileName.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : (msg.fileType ? msg.fileType.toLowerCase() : 'doc');

    let iconHtml = '<i class="fa-solid fa-file text-blue-500 text-xl"></i>';
    let typeLabel = `${ext.toUpperCase()} File`;

    switch (ext) {
        case 'pdf':
            iconHtml = '<i class="fa-solid fa-file-pdf text-rose-500 text-xl"></i>';
            typeLabel = 'PDF Document';
            break;
        case 'doc':
        case 'docx':
            iconHtml = '<i class="fa-solid fa-file-word text-blue-600 text-xl"></i>';
            typeLabel = 'Word Document';
            break;
        case 'xls':
        case 'xlsx':
        case 'csv':
            iconHtml = '<i class="fa-solid fa-file-excel text-emerald-600 text-xl"></i>';
            typeLabel = ext === 'csv' ? 'CSV Spreadsheet' : 'Excel Spreadsheet';
            break;
        case 'ppt':
        case 'pptx':
            iconHtml = '<i class="fa-solid fa-file-powerpoint text-orange-600 text-xl"></i>';
            typeLabel = 'PowerPoint Presentation';
            break;
        case 'zip':
        case 'rar':
        case '7z':
        case 'tar':
        case 'gz':
            iconHtml = '<i class="fa-solid fa-file-zipper text-amber-500 text-xl"></i>';
            typeLabel = 'Compressed Archive';
            break;
        case 'txt':
        case 'rtf':
            iconHtml = '<i class="fa-solid fa-file-lines text-slate-500 text-xl"></i>';
            typeLabel = 'Text Document';
            break;
        case 'apk':
            iconHtml = '<i class="fa-brands fa-android text-emerald-500 text-xl"></i>';
            typeLabel = 'Android Package';
            break;
        default:
            iconHtml = '<i class="fa-solid fa-file text-blue-500 text-xl"></i>';
            typeLabel = `${ext.toUpperCase()} Document`;
            break;
    }

    const fileSizeFormatted = msg.fileSize ? formatFileSize(msg.fileSize) : '';

    return {
        url: rawUrl,
        fileName,
        ext,
        iconHtml,
        typeLabel: fileSizeFormatted ? `${typeLabel} • ${fileSizeFormatted}` : typeLabel
    };
}

export function renderDocumentCardHtml(msg, isRider = false) {
    const details = getDocumentDetails(msg);
    if (!details.url) return '';

    const encodedUrl = encodeURIComponent(details.url).replace(/'/g, '%27');
    const encodedName = encodeURIComponent(details.fileName).replace(/'/g, '%27');

    const cardBg = isRider
        ? 'bg-black/20 hover:bg-black/30 border-white/20 text-white'
        : 'bg-gray-50 dark:bg-black/30 hover:bg-gray-100 dark:hover:bg-black/50 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100';

    const btnClass = isRider
        ? 'bg-white/20 hover:bg-white/30 text-white border-white/30'
        : 'bg-blue-600 hover:bg-blue-700 text-white border-blue-500';

    return `
    <div class="mt-1.5 p-2.5 rounded-xl border ${cardBg} flex items-center justify-between gap-3 transition max-w-sm w-full select-none">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <div class="w-10 h-10 rounded-xl bg-white dark:bg-gray-800 shadow-2xs border border-gray-200 dark:border-gray-700 flex items-center justify-center shrink-0">
                ${details.iconHtml}
            </div>
            <div class="min-w-0 flex-1">
                <div class="font-bold text-xs truncate" title="${escapeHtml(details.fileName)}">${escapeHtml(details.fileName)}</div>
                <div class="text-[10px] opacity-75 truncate">${escapeHtml(details.typeLabel)}</div>
            </div>
        </div>
        <button type="button" onclick="event.stopPropagation(); window.downloadChatDocument && window.downloadChatDocument('${encodedUrl}', '${encodedName}')" class="px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 border flex items-center gap-1.5 shadow-2xs active:scale-95 transition cursor-pointer ${btnClass}" title="Download ${escapeHtml(details.fileName)}">
            <i class="fa-solid fa-download text-[11px]"></i>
            <span>Download</span>
        </button>
    </div>`;
}

export async function downloadChatDocument(encodedUrl, encodedName) {
    const rawUrl = decodeURIComponent(encodedUrl || '');
    const fileName = decodeURIComponent(encodedName || 'document');
    if (!rawUrl) return;

    if (typeof showToast === 'function') {
        showToast(`📥 Downloading ${fileName}...`);
    }

    if (rawUrl.startsWith('data:image/') || rawUrl.match(/\.(png|jpe?g|webp|gif)(\?.*)?$/i) || fileName.match(/\.(png|jpe?g|webp|gif)$/i)) {
        await saveImageToDevice(rawUrl, fileName);
        return;
    }

    if (typeof window.openExternalLink === 'function') {
        await window.openExternalLink(rawUrl);
        return;
    }

    try {
        const link = document.createElement('a');
        link.href = rawUrl;
        link.download = fileName;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => link.remove(), 200);
    } catch (e) {
        window.open(rawUrl, '_blank', 'noopener,noreferrer');
    }
}

export function handleChatPhoneClick(phoneNumber) {
    if (!phoneNumber) return;
    activeChatSelectedPhone = phoneNumber;

    const modal = document.getElementById('chat-phone-action-modal');
    const numEl = document.getElementById('chat-phone-action-number');
    if (numEl) numEl.innerText = phoneNumber;

    if (modal) {
        modal.classList.remove('hidden');
    } else {
        const choice = confirm(`Gusto mo bang tawagan o i-text si ${phoneNumber}?\n\nOK = Tawag\nCancel = Text`);
        if (choice) {
            window.location.href = `tel:${phoneNumber}`;
        } else {
            window.location.href = `sms:${phoneNumber}`;
        }
    }
}

export function closeChatPhoneModal() {
    const modal = document.getElementById('chat-phone-action-modal');
    if (modal) modal.classList.add('hidden');
    activeChatSelectedPhone = null;
}

export function executeChatPhoneAction(actionType) {
    const phone = activeChatSelectedPhone;
    closeChatPhoneModal();
    if (!phone) return;

    if (actionType === 'call') {
        window.location.href = `tel:${phone}`;
    } else if (actionType === 'text') {
        window.location.href = `sms:${phone}`;
    } else if (actionType === 'save_details') {
        saveChatPhoneToCustomerDetails(phone);
    }
}

export function saveChatPhoneToCustomerDetails(phone) {
    if (!phone) return;
    const custId = window.getActiveRiderChatCustId ? window.getActiveRiderChatCustId() : null;
    let meta = (window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {}) || {};
    let custName = (document.getElementById('rider-chat-cust-name')?.innerText || '').trim();
    if (!custName || custName === 'Customer Name' || custName.toLowerCase() === 'customer' || custName.startsWith('FB Customer (')) {
        custName = meta.customerName || meta.name || 'Customer';
    }

    const slideModal = (typeof openSlideDeleteModal === 'function') ? openSlideDeleteModal : window.openSlideDeleteModal;
    if (typeof slideModal === 'function') {
        slideModal(
            `I-save sa Customer Details?`,
            `I-save ang number na [${phone}] para kay [${custName}]?\nI-drag pakanan para kumpirmahin.`,
            async () => {
                await commitChatPhoneToDetails(phone, custId, custName);
            }
        );
    } else {
        commitChatPhoneToDetails(phone, custId, custName);
    }
}

async function commitChatPhoneToDetails(phone, custId, custName) {
    const now = Date.now();
    let meta = (window.getCurrentRiderChatMeta ? window.getCurrentRiderChatMeta() : {}) || {};
    meta.customerPhone = phone;

    if (window.setActiveCustData) {
        const activeData = (window.getActiveCustData ? window.getActiveCustData() : {}) || {};
        activeData.phoneNumber = phone;
        window.setActiveCustData(activeData);
    }

    // Update customer details UI elements directly if loaded/open
    const phoneEl = document.getElementById('cust-details-phone');
    if (phoneEl) {
        phoneEl.innerText = phone;
        phoneEl.href = `tel:${phone.replace(/[^0-9+]/g, '')}`;
        phoneEl.className = "font-bold text-sm text-blue-600 dark:text-blue-400 font-mono mt-0.5 block hover:underline truncate";
    }
    const phoneCallBtn = document.getElementById('cust-details-call-btn');
    if (phoneCallBtn) {
        phoneCallBtn.href = `tel:${phone.replace(/[^0-9+]/g, '')}`;
        phoneCallBtn.classList.remove('hidden');
    }
    const phoneCopyBtn = document.getElementById('cust-details-copy-btn');
    if (phoneCopyBtn) phoneCopyBtn.classList.remove('hidden');

    if (db && custId) {
        try {
            const updates = {};
            updates[`customers/${custId}/phoneNumber`] = phone;
            updates[`customers/${custId}/updatedAt`] = now;
            updates[`customerChats/${custId}/metadata/customerPhone`] = phone;
            updates[`customerChats/${custId}/metadata/lastUpdated`] = now;
            updates[`customerChatMeta/${custId}/customerPhone`] = phone;
            updates[`customerChatMeta/${custId}/lastUpdated`] = now;

            const linkedKey = meta.linkedDirectoryKey;
            if (linkedKey) {
                updates[`directory/customers/${linkedKey}/contact`] = phone;
            }

            await db.ref().update(updates);
        } catch (e) {
            console.warn("Failed to update customer phone in Firebase:", e);
        }
    }

    showToast(`✅ Na-save ang contact number [${phone}] para kay ${custName}!`);
}

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

export function renderRiderMessageStatusIndicator(msg, forceSeen = false) {
    const isSeen = Boolean(forceSeen || msg.status === 'seen' || msg.seenAt);
    const sentTime = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
    const seenTime = msg.seenAt 
        ? new Date(msg.seenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        : (isSeen && msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "");
    
    let iconHtml = '<i class="fa-regular fa-clock text-blue-200" title="Sending..."></i>';
    let titleAttr = `Sent ${sentTime}`;

    if (msg.status === 'failed' || msg.failed) {
        iconHtml = '<i class="fa-solid fa-circle-exclamation text-rose-300 animate-pulse" title="Sending failed"></i>';
        titleAttr = `Sending failed`;
    } else if (isSeen) {
        iconHtml = '<i class="fa-solid fa-check-double text-cyan-200" title="Seen"></i>';
        titleAttr += ` • Seen${seenTime ? ` at ${seenTime}` : ''}`;
    } else if (msg.status === 'delivered') {
        iconHtml = '<i class="fa-solid fa-check-double text-blue-200" title="Delivered"></i>';
        titleAttr += ` • Delivered`;
    } else if (msg.status === 'sent') {
        iconHtml = '<i class="fa-solid fa-check text-blue-200" title="Sent"></i>';
    }

    return `<span class="inline-flex items-center gap-1 ml-1 cursor-help" title="${titleAttr}">
        ${iconHtml}
        ${isSeen && seenTime ? `<span class="text-[8px] text-cyan-200 opacity-90 font-mono">Seen ${seenTime}</span>` : ''}
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

export function scrollToBubble(msgId) {
    if (!msgId) return;
    const bubbleEl = document.getElementById(`msg-bubble-${msgId}`);
    if (!bubbleEl) return;
    bubbleEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    bubbleEl.classList.add('outline', 'outline-2', 'outline-amber-400', 'transition-all', 'duration-300');
    setTimeout(() => {
        bubbleEl.classList.remove('outline', 'outline-2', 'outline-amber-400');
    }, 1600);
}
if (typeof window !== 'undefined') {
    window.scrollToBubble = scrollToBubble;
}

export function renderReplyPreviewInsideMessage(replyTo) {
    if (!replyTo) return '';
    const textPreview = replyTo.text 
        || replyTo.message?.text 
        || (typeof replyTo.message === 'string' ? replyTo.message : null)
        || (replyTo.imageUrl || replyTo.message?.imageUrl ? '📷 Photo' : (replyTo.locationCoords ? '📍 Location' : 'Quoted Message'));
    if (!textPreview) return '';
    const sender = (replyTo.sender && replyTo.sender !== 'Unknown')
        ? replyTo.sender 
        : (replyTo.message?.sender || replyTo.message?.senderName || 'Reply');
    const bubbleId = replyTo.id || replyTo.key || replyTo.mid;
    const clickHandler = bubbleId ? `event.stopPropagation(); window.scrollToBubble && window.scrollToBubble('${bubbleId}')` : '';
    return `
    <div ${clickHandler ? `onclick="${clickHandler}"` : ''} class="bg-black/10 dark:bg-black/40 border-l-2 border-amber-400 px-2 py-1 rounded-r-lg mb-1.5 text-[10px] opacity-90 truncate max-w-full cursor-pointer hover:opacity-100 transition">
        <div class="font-bold text-amber-600 dark:text-amber-300 truncate flex items-center gap-1">
            <i class="fa-solid fa-reply text-[8px]"></i>
            <span>${escapeHtml(sender)}</span>
        </div>
        <div class="text-gray-700 dark:text-gray-200 truncate">${escapeHtml(textPreview)}</div>
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

function getMessageSenderAvatar(m, isRider, custAvatar) {
    if (!isRider) {
        return m.avatarUrl || custAvatar;
    }
    // Check if the message has an explicit avatar/photo attached
    if (m.senderAvatar && typeof m.senderAvatar === 'string' && m.senderAvatar.trim()) {
        return m.senderAvatar.trim();
    }
    if (m.avatarUrl && typeof m.avatarUrl === 'string' && m.avatarUrl.trim()) {
        return m.avatarUrl.trim();
    }
    if (m.photoUrl && typeof m.photoUrl === 'string' && m.photoUrl.trim()) {
        return m.photoUrl.trim();
    }

    const senderName = (m.sender || m.senderName || "").trim();
    if (senderName) {
        // Look up sender in global roster to see if they have an uploaded profile photo
        const roster = globalState.rosterMembers || [];
        const member = roster.find(r => {
            const rName = (r.riderName || r.name || "").trim().toLowerCase();
            return rName && (rName === senderName.toLowerCase() || (typeof isRiderMatch === 'function' && isRiderMatch(rName, senderName.toLowerCase())));
        });
        if (member) {
            const memberPhoto = member.photoUrl || member.avatar || member.profilePic;
            if (memberPhoto && typeof memberPhoto === 'string' && memberPhoto.trim()) {
                return memberPhoto.trim();
            }
        }
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName)}&background=3B82F6&color=fff`;
    }

    const defaultRider = appState.riderName || "Rider";
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(defaultRider)}&background=3B82F6&color=fff`;
}

export function buildSingleMessageHtml(m, activeCustData = null) {
    const isRider = !!m.isRider || m.senderType === 'rider';
    const isFailed = Boolean(m.status === 'failed' || m.failed === true || m.error);
    const dimClass = isFailed ? "opacity-60 saturate-50 border border-rose-500/70 ring-1 ring-rose-500/30" : "shadow-xs";
    const alignClass = isRider 
        ? `self-end bg-[#076B57] text-white rounded-tr-none ${dimClass}` 
        : `self-start bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-200 rounded-tl-none ${dimClass}`;
    const timeStr = formatChatDateTime(m.timestamp);

    const riderName = appState.riderName || "Rider";
    const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";
    const custAvatar = activeCustData?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=0084FF&color=fff`;

    const senderName = m.sender || (isRider ? (m.senderName || riderName) : custName);
    const senderAvatar = getMessageSenderAvatar(m, isRider, custAvatar);

    const meta = (typeof window.getCurrentRiderChatMeta === 'function') ? window.getCurrentRiderChatMeta() : {};
    const customerLastSeenTs = Number(meta?.customerLastSeenTimestamp || activeCustData?.customerLastSeenTimestamp || meta?.watermark || 0) || 0;
    const msgTs = getMessageTimestamp(m);
    const isSeen = !isFailed && (m.status === 'seen' || Boolean(m.seenAt) || (customerLastSeenTs > 0 && msgTs > 0 && msgTs <= customerLastSeenTs));

    const statusIndicator = isRider ? renderRiderMessageStatusIndicator(m, isSeen) : '';
    const replyBlockHtml = renderReplyPreviewInsideMessage(m.replyTo);
    const reactionsHtml = renderReactionsHtml(m.reactions, m.id);

    const isDoc = isDocumentUrlOrType(m);
    const documentMarkup = isDoc ? renderDocumentCardHtml(m, isRider) : '';

    const imgHtml = !isDoc ? (m.imageUrl || (m.type === 'image' && m.text && !m.text.includes('[Facebook') ? m.text : null)) : null;
    const isResolvingFbImage = !isDoc && !imgHtml && m.text && (m.text.includes('[Facebook image]') || m.text.includes('[Facebook attachment]'));
    const isLikeSticker = !isDoc && Boolean(m.isSticker || m.stickerType === 'like' || (imgHtml && (imgHtml.includes('369239') || imgHtml.includes('sticker') || imgHtml.includes('like'))));
    
    const imageMarkup = imgHtml 
        ? (isLikeSticker 
            ? `<div class="p-0.5 select-none flex items-center justify-start"><img src="${imgHtml}" alt="👍" class="w-10 h-10 object-contain hover:scale-110 active:scale-90 transition-transform cursor-pointer" onclick="event.stopPropagation()"></div>`
            : `<img src="${imgHtml}" loading="eager" decoding="async" fetchpriority="high" onerror="window.handleChatImageLoadError && window.handleChatImageLoadError(this, '${m.id}')" onclick="event.stopPropagation(); window.openImageViewerModal && window.openImageViewerModal('${escapeHtml(imgHtml)}', 'rider')" class="w-52 max-w-full rounded-xl mt-1.5 border border-gray-200 dark:border-gray-700 cursor-pointer hover:opacity-95 transition bg-gray-100 dark:bg-gray-800 min-h-[120px] object-cover">`)
        : (isResolvingFbImage 
            ? `<div class="flex items-center gap-2 py-2 px-3 bg-blue-500/10 border border-blue-500/30 rounded-xl text-blue-600 dark:text-blue-400 text-xs mt-1 font-medium animate-pulse"><i class="fa-solid fa-spinner fa-spin text-blue-500"></i><span>Loading photo...</span></div>` 
            : '');
    
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
                <img src="${staticMapUrl}" loading="lazy" decoding="async" alt="Map Location Preview" class="w-full h-32 object-cover rounded-lg group-hover:scale-105 transition-transform duration-200">
                <div class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span class="bg-black/80 text-white text-[10px] font-bold px-2 py-1 rounded-md"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open in Maps</span>
                </div>
            </a>
            <a href="${mapUrl}" target="_blank" onclick="event.stopPropagation()" class="bg-emerald-600/20 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 font-bold px-2.5 py-1.5 rounded-lg text-[11px] flex items-center justify-center gap-1.5 active:scale-95 transition">
                <i class="fa-solid fa-map-location-dot text-red-400"></i> View Shared Location
            </a>
        </div>`;
    }

    const encodedText = encodeURIComponent(m.text || '').replace(/'/g, '%27');
    const encodedSender = encodeURIComponent(senderName).replace(/'/g, '%27');

    const isPlaceholderText = m.text && (m.text.includes('[Facebook image]') || m.text.includes('[Facebook attachment]') || m.text === '📷 Photo' || m.text === 'Facebook Message');
    const isDocFilenameText = isDoc && m.text && (m.text === m.fileName || m.text === m.fileUrl || m.text === m.imageUrl || m.text === '📄 Document' || m.text.startsWith('http'));
    const showText = m.text && (!imgHtml || !isPlaceholderText) && !isResolvingFbImage && !locationHtml && !(isLikeSticker && imgHtml) && !isDocFilenameText;

    const failedTagHtml = isFailed ? `
        <div class="flex items-center gap-1 text-[9.5px] font-black text-rose-500 dark:text-rose-400 mt-0.5 ${isRider ? 'justify-end mr-8' : 'justify-start ml-8'} select-none">
            <i class="fa-solid fa-circle-exclamation text-[9px] text-rose-500"></i>
            <span>Sending failed</span>
            ${isRider && m.id ? `<button type="button" onclick="event.stopPropagation(); window.retryRiderChatMessage && window.retryRiderChatMessage('${m.id}')" class="underline hover:text-rose-700 dark:hover:text-rose-300 ml-1.5 font-bold cursor-pointer">Retry</button>` : ''}
        </div>` : '';

    return `
    <div id="msg-bubble-${m.id}" data-timestamp="${msgTs}" class="flex flex-col ${isRider ? 'items-end' : 'items-start'} my-0.5 w-full">
        <div class="flex items-start gap-1.5 ${isRider ? 'flex-row-reverse' : 'flex-row'} max-w-full">
            <img src="${senderAvatar}" loading="lazy" decoding="async" class="w-6 h-6 rounded-full object-cover border border-blue-400/40 shrink-0 mt-1 pointer-events-none">
            <div 
                onpointerdown="window.handleMsgPointerDown(event, '${m.id}', 'rider-cust', '${encodedText}', '${encodedSender}')"
                onpointermove="window.handleMsgPointerMove(event)"
                onpointerup="window.handleMsgPointerUp(event, '${m.id}')"
                onpointercancel="window.handleMsgPointerUp(event, '${m.id}')"
                oncontextmenu="window.handleMsgContextMenu(event, '${m.id}', 'rider-cust', '${encodedText}', '${encodedSender}')"
                class="max-w-[85%] p-2.5 rounded-2xl flex flex-col gap-0.5 text-xs ${alignClass} cursor-pointer transition active:scale-[0.98] select-none">
                <div class="text-[9px] ${isRider ? 'text-emerald-100' : 'text-teal-700 dark:text-teal-400'} font-bold flex justify-between gap-3 pointer-events-none">
                    <span>${escapeHtml(senderName)}</span>
                    <div class="flex items-center gap-1 opacity-80 font-mono shrink-0">
                        <span>${timeStr}</span>
                        ${statusIndicator}
                    </div>
                </div>
                ${replyBlockHtml}
                ${showText ? `<div class="leading-relaxed whitespace-pre-wrap font-sans break-words">${formatChatTextWithPhoneLinks(m.text)}</div>` : ''}
                ${documentMarkup}
                ${imageMarkup}
                ${locationHtml}
                ${reactionsHtml}
            </div>
        </div>
        ${failedTagHtml}
    </div>`;
}

export function appendOrUpdateSingleRiderMessage(container, msg, activeCustData = null) {
    if (!container || !msg || !msg.id) return;

    // Remove loading skeleton or empty notice if present
    const skeleton = document.getElementById('rider-chat-loading-skeleton');
    if (skeleton) skeleton.remove();

    const emptyNote = container.querySelector('.italic');
    if (emptyNote && container.children.length === 1) emptyNote.remove();

    const existingBubble = document.getElementById(`msg-bubble-${msg.id}`);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = buildSingleMessageHtml(msg, activeCustData).trim();
    const newBubble = tempDiv.firstElementChild;

    if (existingBubble) {
        existingBubble.replaceWith(newBubble);
    } else {
        const newTs = getMessageTimestamp(msg);
        const bubbles = Array.from(container.querySelectorAll('[data-timestamp]'));
        const nextBubble = bubbles.find(b => (Number(b.dataset.timestamp) || 0) > newTs);
        if (nextBubble) {
            container.insertBefore(newBubble, nextBubble);
        } else {
            container.appendChild(newBubble);
        }
    }

    updateRiderChatSeenAvatar(container, activeCustData);
}

export function updateRiderChatSeenAvatar(container, activeCustData = null, msgsMap = null) {
    if (!container) return;

    // Remove any previous seen avatar element in this container
    const oldAvatars = container.querySelectorAll('.chat-seen-avatar-wrapper');
    oldAvatars.forEach(el => el.remove());

    const nameEl = document.getElementById('rider-chat-cust-name');
    let custName = nameEl?.innerText?.trim();
    if (!custName || custName === 'Customer' || custName === 'Customer Name' || custName.startsWith('FB Customer (')) {
        custName = activeCustData?.customerName || activeCustData?.name || (typeof window.getCurrentRiderChatMeta === 'function' ? window.getCurrentRiderChatMeta()?.customerName : null) || "Customer";
    }

    const meta = (typeof window.getCurrentRiderChatMeta === 'function') ? window.getCurrentRiderChatMeta() : {};
    const custAvatar = activeCustData?.avatarUrl 
        || meta?.avatarUrl 
        || document.getElementById('rider-chat-avatar')?.src 
        || `https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=0084FF&color=fff`;

    const customerLastSeenTs = Number(meta?.customerLastSeenTimestamp || activeCustData?.customerLastSeenTimestamp || meta?.watermark || 0) || 0;

    // Get messages map
    const sourceMap = msgsMap || (typeof window.getLoadedRiderMsgsMap === 'function' ? window.getLoadedRiderMsgsMap() : null);
    if (!sourceMap || sourceMap.size === 0) return;

    const msgs = Array.from(sourceMap.values()).sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));

    // Find latest customer reply timestamp
    let latestCustomerReplyTs = 0;
    for (const m of msgs) {
        if (!m.isRider && m.senderType !== 'rider') {
            const ts = getMessageTimestamp(m);
            if (ts > latestCustomerReplyTs) latestCustomerReplyTs = ts;
        }
    }

    // Find the last rider message seen by customer
    let lastSeenMsg = null;
    for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        if (!m) continue;
        const isRider = Boolean(m.isRider || m.senderType === 'rider');
        if (!isRider) continue;
        const isFailed = Boolean(m.status === 'failed' || m.failed === true || m.error);
        if (isFailed) continue;

        const ts = getMessageTimestamp(m);
        const isExplicitSeen = m.status === 'seen' || Boolean(m.seenAt);
        const isSeenByCustomerTs = customerLastSeenTs > 0 && ts > 0 && ts <= customerLastSeenTs;
        const isSeenByReply = latestCustomerReplyTs > 0 && ts > 0 && ts <= latestCustomerReplyTs;

        if (isExplicitSeen || isSeenByCustomerTs || isSeenByReply) {
            lastSeenMsg = m;
        }
    }

    if (!lastSeenMsg || !lastSeenMsg.id) return;

    const targetBubble = document.getElementById(`msg-bubble-${lastSeenMsg.id}`);
    if (!targetBubble) return;

    const seenAtTs = lastSeenMsg.seenAt 
        || (customerLastSeenTs >= getMessageTimestamp(lastSeenMsg) ? customerLastSeenTs : null) 
        || (latestCustomerReplyTs >= getMessageTimestamp(lastSeenMsg) ? latestCustomerReplyTs : null)
        || lastSeenMsg.timestamp;
    const seenTimeStr = seenAtTs ? new Date(seenAtTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";

    const wrapper = document.createElement('div');
    wrapper.className = 'chat-seen-avatar-wrapper flex items-center justify-end gap-1 mt-0.5 mr-8 select-none transition-all duration-200';
    wrapper.title = `Seen by ${custName}${seenTimeStr ? ` at ${seenTimeStr}` : ''}`;
    wrapper.innerHTML = `
        <span class="text-[9px] text-gray-400 dark:text-gray-400 font-medium opacity-0 hover:opacity-100 transition-opacity">Seen ${seenTimeStr}</span>
        <img src="${custAvatar}" alt="${escapeHtml(custName)}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(custName)}&background=0084FF&color=fff'" class="w-3.5 h-3.5 rounded-full border border-white dark:border-gray-800 shadow-xs object-cover pointer-events-none ring-1 ring-blue-500/30">
    `;

    targetBubble.appendChild(wrapper);
}

export function renderRiderMessages(container, loadedRiderMsgsMap, hasMoreRiderMsgs, isInitialLoad = false, oldScrollHeight = 0, activeCustData = null) {
    const msgs = Array.from(loadedRiderMsgsMap.values()).sort((a, b) => {
        const tA = getMessageTimestamp(a);
        const tB = getMessageTimestamp(b);
        if (tA !== tB) return tA - tB;
        return String(a.id || '').localeCompare(String(b.id || ''));
    });
    const messagesHtml = msgs.map(m => buildSingleMessageHtml(m, activeCustData)).join('');

    let topHeader = '';
    if (hasMoreRiderMsgs) {
        topHeader = `
        <div class="flex justify-center my-1.5 shrink-0">
            <button type="button" onclick="window.triggerLoadOlderRiderMessages && window.triggerLoadOlderRiderMessages()" class="px-3 py-1 bg-white dark:bg-cardBg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full text-[11px] font-semibold border border-gray-200 dark:border-gray-700 shadow-2xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer">
                <i class="fa-solid fa-clock-rotate-left text-[10px] text-teal-600 dark:text-teal-400"></i>
                <span>Load older messages</span>
            </button>
        </div>`;
    } else {
        topHeader = `<div class="text-center text-gray-400 dark:text-gray-500 text-[10px] py-1.5 italic shrink-0">Beginning of message history</div>`;
    }

    container.innerHTML = topHeader + messagesHtml;
    updateRiderChatSeenAvatar(container, activeCustData, loadedRiderMsgsMap);

    if (isInitialLoad) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 60);
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 180);
        });
    } else if (oldScrollHeight > 0) {
        const newScrollHeight = container.scrollHeight;
        container.scrollTop = Math.max(0, newScrollHeight - oldScrollHeight);
    }
}

export function handleChatImageLoadError(imgEl, msgId) {
    if (!imgEl || !msgId) return;
    const activeCustId = (typeof window.getActiveRiderChatCustId === 'function') ? window.getActiveRiderChatCustId() : null;
    if (!activeCustId) return;

    if (typeof window.resolveFacebookMessageAttachment === 'function') {
        window.resolveFacebookMessageAttachment(activeCustId, msgId, msgId).then(freshUrl => {
            if (freshUrl && freshUrl !== imgEl.src) {
                imgEl.src = freshUrl;
            }
        }).catch(() => {});
    }
}

if (typeof window !== 'undefined') {
    window.handleMsgPointerDown = handleMsgPointerDown;
    window.handleMsgPointerMove = handleMsgPointerMove;
    window.handleMsgPointerUp = handleMsgPointerUp;
    window.handleMsgContextMenu = handleMsgContextMenu;
    window.handleChatPhoneClick = handleChatPhoneClick;
    window.closeChatPhoneModal = closeChatPhoneModal;
    window.executeChatPhoneAction = executeChatPhoneAction;
    window.saveChatPhoneToCustomerDetails = saveChatPhoneToCustomerDetails;
    window.handleChatImageLoadError = handleChatImageLoadError;
    window.handleChatLinkClick = handleChatLinkClick;
    window.downloadChatDocument = downloadChatDocument;
    window.updateRiderChatSeenAvatar = updateRiderChatSeenAvatar;
}