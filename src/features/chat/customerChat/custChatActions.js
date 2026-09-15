// src/features/chat/customerChat/custChatActions.js
import { showToast } from '../../../ui/notifications.js';
import { escapeHtml, copyText } from '../../../utils/helpers.js';
import { 
    toggleCustomerMessageReaction, 
    setCustomerReply 
} from './custChatFeed.js';

export function openMessageActionPopover(event, msgId, context, rawText, rawSender) {
    if (event) event.stopPropagation();

    const text = decodeURIComponent(rawText || '');
    const sender = decodeURIComponent(rawSender || '');

    let modal = document.getElementById('global-chat-bubble-action-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'global-chat-bubble-action-modal';
        modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-3 transition-opacity';
        modal.style.cssText = 'z-index: 9999999 !important;';
        modal.onclick = (e) => {
            if (e.target === modal) closeMessageActionPopover();
        };
        document.body.appendChild(modal);
    } else {
        modal.style.cssText = 'z-index: 9999999 !important;';
    }

    const emojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    const emojiBtnsHtml = emojis.map(em => `
        <button type="button" onclick="event.stopPropagation(); window.dispatchBubbleReaction('${msgId}', '${context}', '${em}')" class="w-9 h-9 text-lg rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-center transition active:scale-125">
            ${em}
        </button>
    `).join('');

    modal.innerHTML = `
        <div onclick="event.stopPropagation()" class="bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-800 w-full max-w-xs rounded-3xl p-3.5 flex flex-col gap-2.5 animate-in fade-in zoom-in-95 duration-150 shadow-2xl" style="z-index: 10000000 !important;">
            <div class="bg-gray-100 dark:bg-black/40 border-l-2 border-blue-500 px-2.5 py-1.5 rounded-r-xl text-xs">
                <div class="text-[10px] font-bold text-blue-600 dark:text-blue-400 truncate">${escapeHtml(sender || 'Message')}</div>
                <div class="text-gray-700 dark:text-gray-300 text-[11px] truncate mt-0.5">${escapeHtml(text || '📷 Attachment / Location')}</div>
            </div>

            <div class="flex items-center justify-between bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800/80 p-1 rounded-2xl">
                ${emojiBtnsHtml}
            </div>

            <div class="flex flex-col gap-1 text-xs font-bold">
                <button type="button" onclick="event.stopPropagation(); window.dispatchBubbleReply('${msgId}', '${context}', '${encodeURIComponent(sender)}', '${encodeURIComponent(text)}')" class="flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200 transition active:scale-98">
                    <i class="fa-solid fa-reply text-blue-500 w-4"></i>
                    <span>Reply to this message</span>
                </button>

                ${text ? `
                <button type="button" onclick="event.stopPropagation(); window.dispatchBubbleCopy('${encodeURIComponent(text)}')" class="flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200 transition active:scale-98">
                    <i class="fa-solid fa-copy text-amber-500 w-4"></i>
                    <span>Copy Text</span>
                </button>` : ''}

                <button type="button" onclick="event.stopPropagation(); window.closeMessageActionPopover()" class="flex items-center gap-2.5 p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition active:scale-98 border-t border-gray-100 dark:border-gray-800/80 mt-1">
                    <i class="fa-solid fa-xmark text-gray-400 w-4"></i>
                    <span>Cancel</span>
                </button>
            </div>
        </div>`;

    modal.classList.remove('hidden');
}

export function closeMessageActionPopover() {
    const modal = document.getElementById('global-chat-bubble-action-modal');
    if (modal) modal.classList.add('hidden');
}

export function dispatchBubbleReaction(msgId, context, emoji) {
    closeMessageActionPopover();
    if (context === 'customer') {
        toggleCustomerMessageReaction(msgId, emoji);
    } else if (context === 'rider-cust' && window.toggleRiderMessageReaction) {
        window.toggleRiderMessageReaction(msgId, emoji);
    } else if (context === 'store-rider' && window.toggleStoreRiderReaction) {
        window.toggleStoreRiderReaction(msgId, emoji);
    }
}

export function dispatchBubbleReply(msgId, context, encodedSender, encodedText) {
    closeMessageActionPopover();
    const sender = decodeURIComponent(encodedSender);
    const text = decodeURIComponent(encodedText);

    if (context === 'customer') {
        setCustomerReply(msgId, sender, text);
    } else if (context === 'rider-cust' && window.setRiderReply) {
        window.setRiderReply(msgId, sender, text);
    } else if (context === 'store-rider' && window.setStoreRiderReply) {
        window.setStoreRiderReply(msgId, sender, text);
    }
}

export function dispatchBubbleCopy(encodedText) {
    closeMessageActionPopover();
    const text = decodeURIComponent(encodedText);
    copyText(text);
    showToast("📋 Message copied to clipboard!");
}