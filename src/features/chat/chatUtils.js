// src/features/chat/chatUtils.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml, copyText } from '../../utils/helpers.js';

export let isHdMode = false;

// ============================================================================
// 1. BODY SCROLL LOCK HELPER
// ============================================================================
export function toggleBodyScroll(lock) {
    if (typeof document !== 'undefined') {
        if (lock) {
            document.body.classList.add('overflow-hidden', 'touch-none');
        } else {
            const activeModals = document.querySelectorAll('.fixed.inset-0:not(.hidden):not(.pointer-events-none)');
            if (activeModals.length === 0) {
                document.body.classList.remove('overflow-hidden', 'touch-none');
            }
        }
    }
}

// ============================================================================
// 2. CATERING DROPDOWN POPULATOR (FIXED ROBUST MATCHING)
// ============================================================================
export function populateCateringCustomerDropdown() {
    const selectEl = document.getElementById('catering-customer-select');
    if (!selectEl || !db) return;

    db.ref('customerChats').once('value', (snapshot) => {
        const data = snapshot.val();
        let optionsHtml = '<option value="">-- Select Active Customer --</option>';

        if (data) {
            const uniqueNames = new Set();

            Object.keys(data).forEach(key => {
                const item = data[key] || {};
                const meta = item.metadata || item || {};
                
                // Case-insensitive folder & status normalization
                const folder = (meta.folder || 'inbox').toString().trim().toLowerCase();
                const status = (meta.status || 'active').toString().trim().toLowerCase();
                
                // Robust customer name resolution across multiple metadata schemas
                const rawName = meta.customerName || meta.name || item.customerName || item.name || "";
                const name = rawName ? rawName.trim() : "";

                if ((folder === 'inbox') && status !== 'cancelled' && status !== 'done' && name && !uniqueNames.has(name.toLowerCase())) {
                    uniqueNames.add(name.toLowerCase());
                    optionsHtml += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
                }
            });
        }

        selectEl.innerHTML = optionsHtml;
    });
}

// ============================================================================
// 3. HD MODE TOGGLE & IMAGE COMPRESSION ENGINE
// ============================================================================
export function toggleHdMode() {
    isHdMode = !isHdMode;

    const chatHdBtn = document.getElementById('chat-hd-toggle-btn');
    const chatHdIcon = document.getElementById('chat-hd-icon');
    const editorHdBtn = document.getElementById('editor-hd-toggle-btn');
    const editorHdIcon = document.getElementById('editor-hd-icon');
    const editorHdLabel = document.getElementById('editor-hd-label');

    if (isHdMode) {
        showToast("🌟 HD Mode Enabled (High Quality)");
        if (chatHdBtn) chatHdBtn.className = "p-2 bg-emerald-600 text-white rounded-xl border border-emerald-400 transition active:scale-95 text-xs font-black shadow-lg";
        if (chatHdIcon) chatHdIcon.className = "fa-solid fa-high-definition text-white";

        if (editorHdBtn) editorHdBtn.className = "px-3 py-2.5 rounded-xl bg-emerald-600 text-white border border-emerald-400 transition active:scale-95 flex items-center gap-1.5 text-xs font-black shadow-lg";
        if (editorHdIcon) editorHdIcon.className = "fa-solid fa-high-definition text-white";
        if (editorHdLabel) editorHdLabel.innerText = "HD On";
    } else {
        showToast("⚡ Standard Mode (Data Saver & High Compression)");
        if (chatHdBtn) chatHdBtn.className = "p-2 bg-inputBg text-gray-400 rounded-xl border border-gray-700 hover:text-white transition active:scale-95 text-xs font-bold";
        if (chatHdIcon) chatHdIcon.className = "fa-solid fa-compress text-gray-400";

        if (editorHdBtn) editorHdBtn.className = "px-3 py-2.5 rounded-xl bg-inputBg text-gray-400 border border-gray-700 hover:text-white transition active:scale-95 flex items-center gap-1.5 text-xs font-bold";
        if (editorHdIcon) editorHdIcon.className = "fa-solid fa-compress text-gray-400";
        if (editorHdLabel) editorHdLabel.innerText = "HD Off";
    }
}

export function compressAndResizeImage(file, isHd, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            const maxDim = isHd ? 1920 : 600;

            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const quality = isHd ? 0.85 : 0.45;
            callback(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// ============================================================================
// 4. CAMERA VS FILE ATTACHMENT PICKER
// ============================================================================
export function promptImageAttachmentSource() {
    const modal = document.getElementById('chat-image-picker-modal');
    if (modal) {
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
    }
}

export function closeImagePickerModal() {
    const modal = document.getElementById('chat-image-picker-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
}

export function triggerImageCapture(sourceType) {
    closeImagePickerModal();
    if (sourceType === 'camera') {
        document.getElementById('chat-camera-input')?.click();
    } else {
        document.getElementById('chat-file-input')?.click();
    }
}

export function handleChatImageUpload(inputEl) {
    const files = Array.from(inputEl?.files || []);
    if (files.length === 0) return;

    if (files.length > 1) {
        showToast(`📸 Sending ${files.length} images (${isHdMode ? 'HD' : 'Data Saver'})...`);
        let sentCount = 0;

        files.forEach((file) => {
            compressAndResizeImage(file, isHdMode, (base64Img) => {
                if (window.sendRiderToCustomerChat && typeof window.sendRiderToCustomerChat === 'function') {
                    window.sendRiderToCustomerChat("", base64Img);
                } else if (window.sendCustomerToRiderChat && typeof window.sendCustomerToRiderChat === 'function') {
                    window.sendCustomerToRiderChat("", base64Img);
                }
                sentCount++;
                if (sentCount === files.length) {
                    showToast(`✅ ${files.length} images sent successfully!`);
                }
            });
        });
    } else {
        showToast(isHdMode ? "📸 Processing HD Image..." : "⚡ Compressing Image (Data Saver)...");
        compressAndResizeImage(files[0], isHdMode, (base64Img) => {
            if (window.sendRiderToCustomerChat && typeof window.sendRiderToCustomerChat === 'function') {
                window.sendRiderToCustomerChat("", base64Img);
            } else if (window.sendCustomerToRiderChat && typeof window.sendCustomerToRiderChat === 'function') {
                window.sendCustomerToRiderChat("", base64Img);
            }
        });
    }

    inputEl.value = "";
}

// ============================================================================
// 5. MESSAGE ACTION POPOVER (REPLY, COPY, EMOJI REACTIONS) WITH ULTRA HIGH Z-INDEX
// ============================================================================
export function closeMessageActionPopover() {
    const existing = document.getElementById('chat-msg-action-popover-container');
    if (existing) existing.remove();
}

export function openMessageActionPopover(event, msgId, chatContext, rawEncodedText = '', rawEncodedSender = '') {
    if (event) {
        event.stopPropagation();
    }

    closeMessageActionPopover();

    const decodedText = decodeURIComponent(rawEncodedText || '');
    const decodedSender = decodeURIComponent(rawEncodedSender || 'User');

    const clickX = event?.clientX || (window.innerWidth / 2);
    const clickY = event?.clientY || (window.innerHeight / 2);

    const popoverContainer = document.createElement('div');
    popoverContainer.id = 'chat-msg-action-popover-container';
    popoverContainer.className = 'fixed inset-0 select-none';
    popoverContainer.style.cssText = 'z-index: 9999999 !important;';

    // Backdrop layer to close on outside click
    const backdrop = document.createElement('div');
    backdrop.className = 'absolute inset-0 bg-black/20 backdrop-blur-[1px]';
    backdrop.onclick = (e) => {
        e.stopPropagation();
        closeMessageActionPopover();
    };

    // Popover box
    const popover = document.createElement('div');
    popover.className = 'absolute bg-white dark:bg-cardBg border border-gray-200 dark:border-gray-700 shadow-2xl rounded-2xl p-2 flex flex-col gap-1.5 animate-in fade-in zoom-in-95 duration-100 min-w-[180px] max-w-[240px] text-xs';
    popover.style.cssText = 'z-index: 10000000 !important;';

    // Emoji reaction row
    const emojis = ['👍', '❤️', '🔥', '😂', '🛵', '📍'];
    const emojiRowHtml = emojis.map(emoji => `
        <button type="button" onclick="event.stopPropagation(); window.handlePopoverReaction('${msgId}', '${emoji}', '${chatContext}')" class="w-7 h-7 rounded-xl hover:bg-gray-100 dark:hover:bg-black/50 text-base flex items-center justify-center transition active:scale-125">
            ${emoji}
        </button>
    `).join('');

    popover.innerHTML = `
        <div class="flex items-center justify-around border-b border-gray-100 dark:border-gray-800 pb-1.5 mb-0.5">
            ${emojiRowHtml}
        </div>
        <div class="flex flex-col gap-0.5">
            <button type="button" onclick="event.stopPropagation(); window.handlePopoverReply('${msgId}', '${escapeHtml(decodedSender)}', '${encodeURIComponent(decodedText)}', '${chatContext}')" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold flex items-center gap-2 transition active:scale-95">
                <i class="fa-solid fa-reply text-xs w-4"></i> Reply
            </button>
            ${decodedText ? `
            <button type="button" onclick="event.stopPropagation(); window.handlePopoverCopy('${encodeURIComponent(decodedText)}')" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-black/40 text-gray-700 dark:text-gray-200 font-bold flex items-center gap-2 transition active:scale-95">
                <i class="fa-solid fa-copy text-xs w-4"></i> Copy Text
            </button>` : ''}
        </div>
    `;

    popoverContainer.appendChild(backdrop);
    popoverContainer.appendChild(popover);
    document.body.appendChild(popoverContainer);

    // Calculate smart positioning within viewport boundaries
    requestAnimationFrame(() => {
        const popRect = popover.getBoundingClientRect();
        let left = clickX - (popRect.width / 2);
        let top = clickY - popRect.height - 12;

        if (left < 12) left = 12;
        if (left + popRect.width > window.innerWidth - 12) {
            left = window.innerWidth - popRect.width - 12;
        }

        if (top < 12) {
            top = clickY + 16;
        }

        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    });
}

export function handlePopoverReaction(msgId, emoji, chatContext) {
    closeMessageActionPopover();

    if (chatContext === 'rider-cust' && typeof window.toggleRiderMessageReaction === 'function') {
        window.toggleRiderMessageReaction(msgId, emoji);
    } else if (chatContext === 'cust-rider' && typeof window.toggleCustomerMessageReaction === 'function') {
        window.toggleCustomerMessageReaction(msgId, emoji);
    } else if (chatContext === 'store-rider' && typeof window.toggleStoreRiderReaction === 'function') {
        window.toggleStoreRiderReaction(msgId, emoji);
    }
}

export function handlePopoverReply(msgId, senderName, encodedText, chatContext) {
    closeMessageActionPopover();
    const text = decodeURIComponent(encodedText || '');

    if (chatContext === 'rider-cust' && typeof window.setRiderReply === 'function') {
        window.setRiderReply(msgId, senderName, text);
    } else if (chatContext === 'cust-rider' && typeof window.setCustomerReply === 'function') {
        window.setCustomerReply(msgId, senderName, text);
    } else if (chatContext === 'store-rider' && typeof window.setStoreRiderReply === 'function') {
        window.setStoreRiderReply(msgId, senderName, text);
    } else if (chatContext === 'store-rider' && typeof window.setStoreReply === 'function') {
        window.setStoreReply(msgId, senderName, text);
    }
}

export function handlePopoverCopy(encodedText) {
    closeMessageActionPopover();
    const text = decodeURIComponent(encodedText || '');
    if (text) {
        copyText(text);
        showToast("📋 Message copied to clipboard!");
    }
}

// Scroll bubble helper for replying to specific messages
export function scrollToBubble(msgId) {
    const bubble = document.getElementById(`msg-bubble-${msgId}`);
    if (bubble) {
        bubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
        bubble.classList.add('ring-2', 'ring-amber-400', 'transition-all');
        setTimeout(() => {
            bubble.classList.remove('ring-2', 'ring-amber-400');
        }, 1500);
    }
}

if (typeof window !== 'undefined') {
    window.toggleBodyScroll = toggleBodyScroll;
    window.populateCateringCustomerDropdown = populateCateringCustomerDropdown;
    window.toggleHdMode = toggleHdMode;
    window.compressAndResizeImage = compressAndResizeImage;
    window.promptImageAttachmentSource = promptImageAttachmentSource;
    window.closeImagePickerModal = closeImagePickerModal;
    window.triggerImageCapture = triggerImageCapture;
    window.handleChatImageUpload = handleChatImageUpload;

    window.openMessageActionPopover = openMessageActionPopover;
    window.closeMessageActionPopover = closeMessageActionPopover;
    window.handlePopoverReaction = handlePopoverReaction;
    window.handlePopoverReply = handlePopoverReply;
    window.handlePopoverCopy = handlePopoverCopy;
    window.scrollToBubble = scrollToBubble;
}