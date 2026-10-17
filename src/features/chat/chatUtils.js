// src/features/chat/chatUtils.js
import { db } from '../../config/firebase.js';
import { appState, globalState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml, copyText } from '../../utils/helpers.js';

export let isHdMode = typeof localStorage !== 'undefined' 
    ? localStorage.getItem('lokalex_hd_mode') !== 'false' 
    : true;

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
// 1.5. TIMESTAMP & DATE FORMATTING HELPERS
// ============================================================================
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatChatDate(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const timeVal = date.getTime();
    if (isNaN(timeVal)) return "";

    const nowYear = new Date().getFullYear();
    const dYear = date.getFullYear();
    const month = SHORT_MONTHS[date.getMonth()];
    const day = date.getDate();

    return dYear === nowYear ? `${month} ${day}` : `${month} ${day}, ${dYear}`;
}

export function formatChatDateTime(timestamp) {
    if (!timestamp) return "";
    const { dateStr, timeStr } = formatChatDateParts(timestamp);
    return dateStr ? `${dateStr}, ${timeStr}` : timeStr;
}

export function formatChatDateParts(timestamp) {
    if (!timestamp) return { dateStr: "", timeStr: "" };
    const date = new Date(timestamp);
    const timeVal = date.getTime();
    if (isNaN(timeVal)) return { dateStr: "", timeStr: "" };

    const nowYear = new Date().getFullYear();
    const dYear = date.getFullYear();
    const month = SHORT_MONTHS[date.getMonth()];
    const day = date.getDate();
    const dateStr = dYear === nowYear ? `${month} ${day}` : `${month} ${day}, ${dYear}`;

    let hours = date.getHours();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    const minutes = date.getMinutes();
    const minsStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
    const timeStr = `${hours}:${minsStr} ${ampm}`;

    return { dateStr, timeStr };
}

// ============================================================================
// 2. CATERING DROPDOWN POPULATOR (ACTIVE INBOX CHATS + DIRECTORY)
// ============================================================================
export function populateCateringCustomerDropdown(targetSelectIdOrMeta = null) {
    const selectElements = [];

    // If specific element ID was passed, include it
    if (typeof targetSelectIdOrMeta === 'string' && targetSelectIdOrMeta.trim()) {
        const specificEl = document.getElementById(targetSelectIdOrMeta.trim());
        if (specificEl) selectElements.push(specificEl);
    }

    // Always ensure BOTH Cater Order and Admin Force Cater selects are included
    const caterSelect = document.getElementById('catering-customer-select');
    const adminSelect = document.getElementById('admin-cater-customer-select');
    if (caterSelect && !selectElements.includes(caterSelect)) selectElements.push(caterSelect);
    if (adminSelect && !selectElements.includes(adminSelect)) selectElements.push(adminSelect);

    if (selectElements.length === 0) return;

    function renderOptions(activeCustomerList) {
        let optionsHtml = '<option value="">-- Select Active Customer --</option>';
        const seenNames = new Set();

        if (Array.isArray(activeCustomerList) && activeCustomerList.length > 0) {
            let hasInboxOptgroup = false;
            activeCustomerList.forEach(item => {
                const name = (typeof item === 'string' ? item : (item.customerName || item.name || '')).trim();
                const cleanLower = name.toLowerCase();
                if (!name || cleanLower === 'customer' || cleanLower === 'customer name' || cleanLower === 'unknown' || seenNames.has(cleanLower)) {
                    return;
                }
                seenNames.add(cleanLower);

                if (!hasInboxOptgroup) {
                    optionsHtml += '<optgroup label="--- Active Inbox Chats ---">';
                    hasInboxOptgroup = true;
                }

                const channel = typeof item === 'object' ? (item.apiName || (item.channel === 'messenger' ? 'Camiling FB' : (item.channel === 'web' ? 'Web' : ''))) : '';
                const channelBadge = channel ? ` (${channel})` : '';
                const custId = typeof item === 'object' ? (item.custId || '') : '';
                optionsHtml += `<option value="${escapeHtml(name)}" data-cust-id="${escapeHtml(custId)}">${escapeHtml(name)}${escapeHtml(channelBadge)}</option>`;
            });
            if (hasInboxOptgroup) {
                optionsHtml += '</optgroup>';
            }
        }

        selectElements.forEach(el => {
            const currentVal = el.value;
            el.innerHTML = optionsHtml;
            if (currentVal && Array.from(el.options).some(o => o.value === currentVal)) {
                el.value = currentVal;
            }
        });
    }

    // 1. First priority: Pull directly from active Inbox threads in memory
    let activeInboxThreads = [];
    if (typeof window !== 'undefined' && typeof window.getActiveInboxCustomerThreads === 'function') {
        activeInboxThreads = window.getActiveInboxCustomerThreads();
    }
    if (activeInboxThreads.length > 0) {
        renderOptions(activeInboxThreads);
        return;
    }

    // Helper to parse metadata object
    function parseMetadataObj(data) {
        if (!data || typeof data !== 'object') return [];
        const results = [];
        const seen = new Set();

        Object.keys(data).forEach(key => {
            const item = data[key] || {};
            const meta = item.metadata || item || {};
            const folder = (meta.folder || 'inbox').toString().trim().toLowerCase();
            const status = (meta.status || 'active').toString().trim().toLowerCase();
            const isCatered = !!(meta.cateredByRiderName || meta.cateredByRiderId || meta.cateredBy);

            if (folder !== 'inbox' || isCatered || status === 'cancelled' || status === 'done' || status === 'completed') {
                return;
            }

            let name = (meta.customerName || meta.name || item.customerName || item.name || '').trim();
            if (key.startsWith('fb_')) {
                const fbResolved = (typeof window !== 'undefined' && typeof window.getResolvedFbName === 'function') 
                    ? window.getResolvedFbName(key) 
                    : null;
                if (fbResolved && fbResolved.name && (!name || name.startsWith('FB Customer ('))) {
                    name = fbResolved.name;
                }
            }
            if (meta.linkedDirectoryName && (!name || name.startsWith('FB Customer ('))) {
                name = meta.linkedDirectoryName;
            }

            if (name && name.toLowerCase() !== 'customer' && name.toLowerCase() !== 'customer name' && !seen.has(name.toLowerCase())) {
                seen.add(name.toLowerCase());
                results.push({
                    custId: key,
                    customerName: name,
                    apiName: meta.apiName || (key.startsWith('fb_') ? 'Camiling FB' : 'Web'),
                    channel: meta.channel || (key.startsWith('fb_') ? 'messenger' : 'web')
                });
            }
        });
        return results;
    }

    // 2. Second priority: If metadata object passed
    if (targetSelectIdOrMeta && typeof targetSelectIdOrMeta === 'object') {
        const parsed = parseMetadataObj(targetSelectIdOrMeta);
        renderOptions(parsed);
        return;
    }

    // 3. Fallback: Query Firebase customerChatMeta
    if (db) {
        db.ref('customerChatMeta').once('value', (snapshot) => {
            const parsed = parseMetadataObj(snapshot.val());
            renderOptions(parsed);
        });
    } else {
        renderOptions([]);
    }
}

// ============================================================================
// 3. HD MODE TOGGLE & IMAGE COMPRESSION ENGINE
// ============================================================================
export function syncChatHdButtonUI() {
    const chatHdBtn = document.getElementById('chat-hd-toggle-btn');
    const chatHdLabel = document.getElementById('chat-hd-label');
    if (!chatHdBtn) return;

    if (isHdMode) {
        chatHdBtn.className = "px-2.5 py-1.5 bg-emerald-600 text-white rounded-xl border border-emerald-400 transition active:scale-95 text-xs font-black flex items-center justify-center shrink-0 min-w-[36px] shadow-sm";
        if (chatHdLabel) {
            chatHdLabel.className = "text-[11px] font-black tracking-tight text-white";
            chatHdLabel.innerText = "HD";
        }
    } else {
        chatHdBtn.className = "px-2.5 py-1.5 bg-inputBg text-gray-700 dark:text-gray-300 rounded-xl border border-gray-300 dark:border-gray-700 hover:text-gray-900 dark:hover:text-white transition active:scale-95 text-xs font-black flex items-center justify-center shrink-0 min-w-[36px]";
        if (chatHdLabel) {
            chatHdLabel.className = "text-[11px] font-black tracking-tight text-gray-700 dark:text-gray-300";
            chatHdLabel.innerText = "HD";
        }
    }
}

export function toggleHdMode() {
    isHdMode = !isHdMode;
    try {
        localStorage.setItem('lokalex_hd_mode', isHdMode ? 'true' : 'false');
    } catch (_) {}

    const editorHdBtn = document.getElementById('editor-hd-toggle-btn');
    const editorHdIcon = document.getElementById('editor-hd-icon');
    const editorHdLabel = document.getElementById('editor-hd-label');

    syncChatHdButtonUI();

    if (isHdMode) {
        showToast("🌟 HD Mode Enabled (High Quality Photos)");
        if (editorHdBtn) editorHdBtn.className = "px-3 py-2.5 rounded-xl bg-emerald-600 text-white border border-emerald-400 transition active:scale-95 flex items-center gap-1.5 text-xs font-black shadow-lg";
        if (editorHdIcon) editorHdIcon.className = "fa-solid fa-camera text-white";
        if (editorHdLabel) editorHdLabel.innerText = "HD On";
    } else {
        showToast("⚡ Standard Mode (Data Saver & Faster Upload)");
        if (editorHdBtn) editorHdBtn.className = "px-3 py-2.5 rounded-xl bg-inputBg text-gray-400 border border-gray-700 hover:text-white transition active:scale-95 flex items-center gap-1.5 text-xs font-bold";
        if (editorHdIcon) editorHdIcon.className = "fa-solid fa-camera text-gray-400";
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
            // 1200 maxDim provides crisp HD while drastically reducing encoding latency & upload failure
            const maxDim = isHd ? 1200 : 720;

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

            const quality = isHd ? 0.70 : 0.45;
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

export async function handleChatImageUpload(inputEl) {
    const files = Array.from(inputEl?.files || []);
    if (files.length === 0) return;

    const total = files.length;
    try {
        if (total > 1) {
            showToast(`📸 Sending 1 of ${total} images (${isHdMode ? 'HD' : 'Data Saver'})...`);
            for (let i = 0; i < total; i++) {
                const file = files[i];
                if (i > 0) {
                    showToast(`📸 Sending ${i + 1} of ${total} images...`);
                    // Ensure slight timestamp separation so messages appear in sequential order
                    await new Promise(r => setTimeout(r, 150));
                }

                const base64Img = await new Promise((resolve) => {
                    compressAndResizeImage(file, isHdMode, (dataUrl) => {
                        resolve(dataUrl);
                    });
                });

                if (base64Img) {
                    const activeCustId = (typeof window.getActiveRiderChatCustId === 'function') ? window.getActiveRiderChatCustId() : null;
                    if (activeCustId || (window.sendRiderToCustomerChat && typeof window.sendRiderToCustomerChat === 'function')) {
                        await window.sendRiderToCustomerChat("", base64Img);
                    } else if (window.sendCustomerToRiderChat && typeof window.sendCustomerToRiderChat === 'function') {
                        await window.sendCustomerToRiderChat("", base64Img);
                    }
                }
            }
            showToast(`✅ All ${total} images sent successfully!`);
        } else {
            showToast(isHdMode ? "📸 Processing HD Image..." : "⚡ Compressing Image (Data Saver)...");
            const base64Img = await new Promise((resolve) => {
                compressAndResizeImage(files[0], isHdMode, (dataUrl) => {
                    resolve(dataUrl);
                });
            });

            if (base64Img) {
                const activeCustId = (typeof window.getActiveRiderChatCustId === 'function') ? window.getActiveRiderChatCustId() : null;
                if (activeCustId || (window.sendRiderToCustomerChat && typeof window.sendRiderToCustomerChat === 'function')) {
                    await window.sendRiderToCustomerChat("", base64Img);
                } else if (window.sendCustomerToRiderChat && typeof window.sendCustomerToRiderChat === 'function') {
                    await window.sendCustomerToRiderChat("", base64Img);
                }
                showToast("✅ Image sent!");
            }
        }
    } catch (err) {
        console.error("[ChatUpload] Error uploading chat images:", err);
        showToast("⚠️ Failed to send some images. Please try again.");
    } finally {
        if (inputEl) inputEl.value = "";
    }
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
            <button type="button" onclick="event.stopPropagation(); window.handlePopoverReply('${msgId}', '${encodeURIComponent(decodedSender)}', '${encodeURIComponent(decodedText)}', '${chatContext}')" class="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold flex items-center gap-2 transition active:scale-95">
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

export function handlePopoverReply(msgId, encodedSender, encodedText, chatContext) {
    closeMessageActionPopover();
    let senderName = decodeURIComponent(encodedSender || 'User');
    if (senderName.includes('%')) {
        try { senderName = decodeURIComponent(senderName); } catch (_) {}
    }
    let text = decodeURIComponent(encodedText || '');
    if (text.includes('%')) {
        try { text = decodeURIComponent(text); } catch (_) {}
    }

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
    window.syncChatHdButtonUI = syncChatHdButtonUI;
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
    window.formatChatDate = formatChatDate;
    window.formatChatDateTime = formatChatDateTime;
    window.formatChatDateParts = formatChatDateParts;
}