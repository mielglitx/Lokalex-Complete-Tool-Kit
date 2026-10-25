// src/features/chat/threadActions/threadQuickReplies.js
import { db } from '../../../config/firebase.js';
import { appState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { toggleBodyScroll } from '../chatUtils.js';
import { escapeHtml } from '../../../utils/helpers.js';

let isQuickRepliesListening = false;
let currentQuickRepliesList = [];
let draggedQuickReplyId = null;
let activeSelectedQuickReplyText = "";
let activeSelectedQuickReplyId = null;

export function initSharedQuickRepliesListener() {
    // 1. Immediately render from local cache if available
    try {
        const cached = localStorage.getItem('lokalex_shared_quick_replies_cache');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && typeof parsed === 'object') {
                renderSharedQuickReplies(parsed);
            }
        }
    } catch(e) {}

    if (isQuickRepliesListening || !db) return;
    isQuickRepliesListening = true;

    db.ref('sharedQuickReplies').on('value', (snapshot) => {
        const data = snapshot.val() || {};
        try {
            localStorage.setItem('lokalex_shared_quick_replies_cache', JSON.stringify(data));
        } catch(e) {}
        renderSharedQuickReplies(data);
    }, (error) => {
        console.warn("Shared quick replies listener error:", error);
        const container = document.getElementById('quick-replies-chips-container');
        if (container && (!container.children.length || container.innerText.includes('Loading'))) {
            let hadCached = false;
            try {
                const cached = localStorage.getItem('lokalex_shared_quick_replies_cache');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (parsed && Object.keys(parsed).length > 0) {
                        renderSharedQuickReplies(parsed);
                        hadCached = true;
                    }
                }
            } catch(e) {}

            if (!hadCached) {
                container.innerHTML = `<span class="text-[10px] text-amber-600 dark:text-amber-400 italic shrink-0 py-1">⚠️ RTDB Permission: Update rules in Firebase Console for 'sharedQuickReplies'.</span>`;
            }
        }
    });
}

export function renderSharedQuickReplies(data) {
    const container = document.getElementById('quick-replies-chips-container');
    const badge = document.getElementById('quick-replies-count-badge');
    if (!container) return;

    const rawEntries = Object.entries(data || {});
    if (rawEntries.length === 0) {
        if (badge) badge.textContent = "0";
        currentQuickRepliesList = [];
        container.innerHTML = `
        <div class="text-center py-6 px-3 flex flex-col items-center gap-2">
            <i class="fa-solid fa-bolt text-2xl text-amber-500/40"></i>
            <span class="text-xs text-gray-500 dark:text-gray-400">No quick replies yet.</span>
            <button type="button" onclick="window.promptAddQuickReply && window.promptAddQuickReply()" class="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold rounded-xl text-xs border border-amber-300 dark:border-amber-700/60 transition active:scale-95 cursor-pointer">
                + Add Quick Reply
            </button>
        </div>`;
        return;
    }

    // Normalize each item with title, text, order, createdAt
    const parsedList = rawEntries.map(([id, item], index) => {
        let text = "";
        let title = "";
        let order = 9999;
        let createdAt = 0;

        if (typeof item === 'string') {
            text = item;
            title = item.length > 26 ? item.substring(0, 24) + '...' : item;
            order = index + 1;
        } else if (item && typeof item === 'object') {
            text = item.text || '';
            title = item.title || (text.length > 26 ? text.substring(0, 24) + '...' : text) || 'Quick Reply';
            order = item.order !== undefined && item.order !== null ? Number(item.order) : (index + 1);
            createdAt = item.createdAt ? Number(item.createdAt) : 0;
        }

        return {
            id,
            title: title.trim(),
            text: text.trim(),
            order: isNaN(order) ? index + 1 : order,
            createdAt: isNaN(createdAt) ? 0 : createdAt,
            raw: item
        };
    }).filter(e => Boolean(e.text));

    // Sort by order ascending; tiebreaker by createdAt ascending
    parsedList.sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.createdAt - b.createdAt;
    });

    currentQuickRepliesList = parsedList;
    if (badge) badge.textContent = String(parsedList.length);

    container.innerHTML = parsedList.map((item, index) => {
        const isFirst = index === 0;
        const isLast = index === parsedList.length - 1;
        const escapedTitle = escapeHtml(item.title);
        const escapedText = escapeHtml(item.text);

        return `
        <div class="quick-reply-card flex items-center justify-between gap-2.5 p-2 bg-white dark:bg-cardBg hover:bg-amber-50/70 dark:hover:bg-amber-950/20 border border-gray-200 dark:border-gray-800 hover:border-amber-400/60 rounded-xl shadow-2xs transition group cursor-pointer" 
             data-id="${item.id}"
             onclick="window.handleQuickReplyChipClick && window.handleQuickReplyChipClick('${item.id}')"
             draggable="true" 
             ondragstart="window.handleQuickReplyDragStart && window.handleQuickReplyDragStart(event, '${item.id}')" 
             ondragover="window.handleQuickReplyDragOver && window.handleQuickReplyDragOver(event)" 
             ondrop="window.handleQuickReplyDrop && window.handleQuickReplyDrop(event, '${item.id}')">
            <!-- REORDER CONTROLS (MOVE TO TOP / UP / DOWN) -->
            <div class="flex items-center gap-0.5 text-gray-400 shrink-0" onclick="event.stopPropagation()">
                <button type="button" onclick="window.moveQuickReplyToTop && window.moveQuickReplyToTop('${item.id}')" ${isFirst ? 'disabled class="opacity-20 cursor-not-allowed w-6 h-6 flex items-center justify-center text-gray-400"' : 'class="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 text-gray-500 hover:text-amber-600 transition active:scale-90 cursor-pointer"'} title="Move to top">
                    <i class="fa-solid fa-angles-up text-[10px]"></i>
                </button>
                <button type="button" onclick="window.moveQuickReplyOrder && window.moveQuickReplyOrder('${item.id}', -1)" ${isFirst ? 'disabled class="opacity-20 cursor-not-allowed w-6 h-6 flex items-center justify-center text-gray-400"' : 'class="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 text-gray-500 hover:text-amber-600 transition active:scale-90 cursor-pointer"'} title="Move up in order">
                    <i class="fa-solid fa-chevron-up text-[10px]"></i>
                </button>
                <button type="button" onclick="window.moveQuickReplyOrder && window.moveQuickReplyOrder('${item.id}', 1)" ${isLast ? 'disabled class="opacity-20 cursor-not-allowed w-6 h-6 flex items-center justify-center text-gray-400"' : 'class="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 text-gray-500 hover:text-amber-600 transition active:scale-90 cursor-pointer"'} title="Move down in order">
                    <i class="fa-solid fa-chevron-down text-[10px]"></i>
                </button>
            </div>

            <!-- TITLE CARD (CLICK TO CHOOSE / SEND) -->
            <div class="flex-1 min-w-0 flex flex-col justify-center select-none py-0.5 pointer-events-none" title="Tap to select reply">
                <div class="flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
                    <span class="font-bold text-xs text-gray-900 dark:text-gray-100 truncate group-hover:text-amber-600 dark:group-hover:text-amber-400">
                        ${escapedTitle}
                    </span>
                </div>
                <p class="text-[10px] text-gray-500 dark:text-gray-400 truncate pl-3 leading-tight pt-0.5">
                    ${escapedText}
                </p>
            </div>

            <!-- ACTION BUTTONS: EDIT & DELETE -->
            <div class="flex items-center gap-1 shrink-0" onclick="event.stopPropagation()">
                <button type="button" onclick="window.promptEditQuickReply && window.promptEditQuickReply('${item.id}')" class="text-gray-400 hover:text-amber-500 dark:hover:text-amber-400 p-1.5 text-xs opacity-60 hover:opacity-100 transition active:scale-90 cursor-pointer" title="Edit template permanently">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button type="button" onclick="window.deleteQuickReply && window.deleteQuickReply('${item.id}')" class="text-gray-400 hover:text-red-500 p-1.5 text-xs opacity-60 hover:opacity-100 transition active:scale-90 cursor-pointer" title="Delete reply">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

export async function moveQuickReplyToTop(id) {
    if (!currentQuickRepliesList || currentQuickRepliesList.length <= 1) return;
    const currentIndex = currentQuickRepliesList.findIndex(item => item.id === id);
    if (currentIndex <= 0) return;

    const reordered = [...currentQuickRepliesList];
    const [movedItem] = reordered.splice(currentIndex, 1);
    reordered.unshift(movedItem);

    await applyQuickRepliesReorder(reordered);
}

export async function moveQuickReplyOrder(id, direction) {
    if (!currentQuickRepliesList || currentQuickRepliesList.length <= 1) return;
    const currentIndex = currentQuickRepliesList.findIndex(item => item.id === id);
    if (currentIndex === -1) return;

    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= currentQuickRepliesList.length) return;

    const reordered = [...currentQuickRepliesList];
    const [movedItem] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, movedItem);

    await applyQuickRepliesReorder(reordered);
}

export function handleQuickReplyDragStart(event, id) {
    draggedQuickReplyId = id;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
    }
}

export function handleQuickReplyDragOver(event) {
    event.preventDefault();
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
    }
}

export async function handleQuickReplyDrop(event, targetId) {
    event.preventDefault();
    if (!draggedQuickReplyId || draggedQuickReplyId === targetId) return;

    const fromIndex = currentQuickRepliesList.findIndex(item => item.id === draggedQuickReplyId);
    const toIndex = currentQuickRepliesList.findIndex(item => item.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const reordered = [...currentQuickRepliesList];
    const [movedItem] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, movedItem);

    draggedQuickReplyId = null;
    await applyQuickRepliesReorder(reordered);
}

async function applyQuickRepliesReorder(reorderedList) {
    if (!Array.isArray(reorderedList) || reorderedList.length === 0) return;
    currentQuickRepliesList = reorderedList;

    const newCache = {};
    const updates = {};
    reorderedList.forEach((item, idx) => {
        const newOrder = idx + 1;
        item.order = newOrder;
        const entry = {
            ...(typeof item.raw === 'object' ? item.raw : { text: item.text }),
            title: item.title,
            text: item.text,
            order: newOrder,
            createdAt: item.createdAt || Date.now(),
            createdBy: item.raw?.createdBy || (appState.riderName || localStorage.getItem('riderName') || 'Rider')
        };
        newCache[item.id] = entry;
        updates[item.id] = entry;
    });

    try {
        localStorage.setItem('lokalex_shared_quick_replies_cache', JSON.stringify(newCache));
    } catch (e) {}

    renderSharedQuickReplies(newCache);

    if (db) {
        try {
            await db.ref('sharedQuickReplies').update(updates);
            showToast("↕️ Quick replies order saved!");
        } catch (err) {
            console.warn("RTDB sharedQuickReplies update error:", err);
            try {
                const promises = Object.entries(updates).map(([k, v]) =>
                    db.ref(`sharedQuickReplies/${k}`).set(v)
                );
                await Promise.all(promises);
                showToast("↕️ Quick replies order saved!");
            } catch (fallbackErr) {
                console.error("RTDB individual set error:", fallbackErr);
                showToast("⚠️ Order updated locally.");
            }
        }
    } else {
        showToast("↕️ Order updated locally.");
    }
}

export function toggleQuickReplies() {
    const drawer = document.getElementById('quick-replies-drawer');
    if (!drawer) return;
    drawer.classList.toggle('hidden');
    if (!drawer.classList.contains('hidden')) {
        initSharedQuickRepliesListener();
    }
}

export function handleQuickReplyChipClick(idOrText, title = "") {
    if (!idOrText) return;

    let text = "";
    let effectiveTitle = title || "";
    activeSelectedQuickReplyId = idOrText;

    // 1. Check in-memory parsed list by ID
    if (Array.isArray(currentQuickRepliesList)) {
        const found = currentQuickRepliesList.find(i => i.id === idOrText);
        if (found) {
            activeSelectedQuickReplyId = found.id;
            text = found.text || "";
            effectiveTitle = found.title || effectiveTitle;
        }
    }

    // 2. Check local storage cache by ID
    if (!text) {
        try {
            const cached = localStorage.getItem('lokalex_shared_quick_replies_cache');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && parsed[idOrText]) {
                    const item = parsed[idOrText];
                    activeSelectedQuickReplyId = idOrText;
                    text = typeof item === 'string' ? item : (item.text || "");
                    effectiveTitle = typeof item === 'object' ? (item.title || "") : effectiveTitle;
                }
            }
        } catch (_) {}
    }

    // 3. Fallback: maybe raw text was passed
    if (!text) {
        text = idOrText;
    }

    if (!text) return;
    activeSelectedQuickReplyText = text;

    const modal = document.getElementById('quick-reply-action-modal');
    const previewEl = document.getElementById('quick-reply-preview-text');
    const editInput = document.getElementById('edit-quick-reply-textarea');
    const choiceView = document.getElementById('quick-reply-choice-view');
    const editView = document.getElementById('quick-reply-edit-view');
    const titleEl = document.getElementById('quick-reply-modal-title');
    const subtitleEl = document.getElementById('quick-reply-modal-subtitle');
    const permCheckbox = document.getElementById('save-quick-reply-permanently-checkbox');
    if (permCheckbox) permCheckbox.checked = false;

    if (previewEl) previewEl.textContent = text;
    if (editInput) editInput.value = text;
    if (choiceView) choiceView.classList.remove('hidden');
    if (editView) editView.classList.add('hidden');
    if (titleEl) titleEl.innerText = effectiveTitle ? `Quick Reply: ${effectiveTitle}` : "Quick Reply";
    if (subtitleEl) subtitleEl.innerText = "Choose to send or edit before sending";

    if (modal) {
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
    }
}

export function openPermanentEditFromActionModal() {
    const idToEdit = activeSelectedQuickReplyId;
    closeQuickReplyActionModal();
    if (idToEdit && window.promptEditQuickReply) {
        window.promptEditQuickReply(idToEdit);
    }
}

export function confirmSendQuickReply() {
    if (!activeSelectedQuickReplyText) return;
    const textToSend = activeSelectedQuickReplyText;
    closeQuickReplyActionModal();
    sendQuickReply(textToSend);
}

export function openEditQuickReplyModal() {
    const choiceView = document.getElementById('quick-reply-choice-view');
    const editView = document.getElementById('quick-reply-edit-view');
    const editInput = document.getElementById('edit-quick-reply-textarea');
    const titleEl = document.getElementById('quick-reply-modal-title');
    const subtitleEl = document.getElementById('quick-reply-modal-subtitle');
    const permCheckbox = document.getElementById('save-quick-reply-permanently-checkbox');
    if (permCheckbox) permCheckbox.checked = false;

    if (choiceView) choiceView.classList.add('hidden');
    if (editView) editView.classList.remove('hidden');
    if (titleEl) titleEl.innerText = "Edit Quick Reply";
    if (subtitleEl) subtitleEl.innerText = "Edit text before sending to customer";

    if (editInput) {
        editInput.value = activeSelectedQuickReplyText;
        setTimeout(() => {
            editInput.focus();
            editInput.setSelectionRange(editInput.value.length, editInput.value.length);
        }, 100);
    }
}

export function backToQuickReplyChoiceView() {
    const choiceView = document.getElementById('quick-reply-choice-view');
    const editView = document.getElementById('quick-reply-edit-view');
    const titleEl = document.getElementById('quick-reply-modal-title');
    const subtitleEl = document.getElementById('quick-reply-modal-subtitle');

    if (choiceView) choiceView.classList.remove('hidden');
    if (editView) editView.classList.add('hidden');
    if (titleEl) titleEl.innerText = "Quick Reply";
    if (subtitleEl) subtitleEl.innerText = "Choose to send or edit before sending";
}

export async function sendEditedQuickReply() {
    const editInput = document.getElementById('edit-quick-reply-textarea');
    const permCheckbox = document.getElementById('save-quick-reply-permanently-checkbox');
    const shouldSavePermanently = permCheckbox ? permCheckbox.checked : false;
    const text = editInput ? editInput.value.trim() : '';
    if (!text) {
        showToast("⚠️ Please enter a message to send.");
        return;
    }

    const currentReplyId = activeSelectedQuickReplyId;
    closeQuickReplyActionModal();
    sendQuickReply(text);

    if (shouldSavePermanently && currentReplyId) {
        const riderName = appState.riderName || localStorage.getItem('riderName') || 'Rider';
        try {
            const cached = localStorage.getItem('lokalex_shared_quick_replies_cache');
            const data = cached ? JSON.parse(cached) : {};
            if (data[currentReplyId]) {
                const existing = data[currentReplyId];
                const updated = {
                    ...(typeof existing === 'object' ? existing : {}),
                    text: text,
                    updatedAt: Date.now(),
                    updatedBy: riderName
                };
                data[currentReplyId] = updated;
                localStorage.setItem('lokalex_shared_quick_replies_cache', JSON.stringify(data));
                renderSharedQuickReplies(data);
            }
        } catch (_) {}

        if (db) {
            try {
                await db.ref(`sharedQuickReplies/${currentReplyId}`).update({
                    text: text,
                    updatedAt: Date.now(),
                    updatedBy: riderName
                });
                showToast("✅ Reply sent & template permanently updated!");
            } catch (e) {
                console.warn("RTDB template update error:", e);
                showToast("✅ Reply sent & template saved locally!");
            }
        } else {
            showToast("✅ Reply sent & template saved locally!");
        }
    }
}

export function closeQuickReplyActionModal() {
    const modal = document.getElementById('quick-reply-action-modal');
    const permCheckbox = document.getElementById('save-quick-reply-permanently-checkbox');
    if (permCheckbox) permCheckbox.checked = false;
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
    activeSelectedQuickReplyText = "";
    activeSelectedQuickReplyId = null;
}

export function sendQuickReply(text) {
    if (!text) return;
    if (window.sendRiderToCustomerChat) {
        window.sendRiderToCustomerChat(text);
    } else if (window.sendCustomerToRiderChat) {
        window.sendCustomerToRiderChat(text);
    }
    const drawer = document.getElementById('quick-replies-drawer');
    if (drawer && !drawer.classList.contains('hidden')) {
        drawer.classList.add('hidden');
    }
}

export function promptAddQuickReply() {
    const modal = document.getElementById('add-quick-reply-modal');
    const editingIdInput = document.getElementById('editing-quick-reply-id');
    const titleInput = document.getElementById('new-quick-reply-title');
    const textInput = document.getElementById('new-quick-reply-input');
    const modalTitle = document.getElementById('add-quick-reply-modal-title');
    const modalSub = document.getElementById('add-quick-reply-modal-subtitle');
    const submitBtn = document.getElementById('submit-save-quick-reply-btn');
    const iconContainer = document.getElementById('add-quick-reply-modal-icon');

    if (editingIdInput) editingIdInput.value = '';
    if (titleInput) titleInput.value = '';
    if (textInput) textInput.value = '';
    if (modalTitle) modalTitle.innerText = "New Quick Reply";
    if (modalSub) modalSub.innerText = "Available to all riders in real time";
    if (submitBtn) submitBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Reply`;
    if (iconContainer) iconContainer.innerHTML = `<i class="fa-solid fa-bolt"></i>`;

    if (modal) {
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
        setTimeout(() => (titleInput || textInput)?.focus(), 150);
    }
}

export function promptEditQuickReply(id) {
    if (!id) return;
    const modal = document.getElementById('add-quick-reply-modal');
    const editingIdInput = document.getElementById('editing-quick-reply-id');
    const titleInput = document.getElementById('new-quick-reply-title');
    const textInput = document.getElementById('new-quick-reply-input');
    const modalTitle = document.getElementById('add-quick-reply-modal-title');
    const modalSub = document.getElementById('add-quick-reply-modal-subtitle');
    const submitBtn = document.getElementById('submit-save-quick-reply-btn');
    const iconContainer = document.getElementById('add-quick-reply-modal-icon');

    let foundItem = null;
    if (Array.isArray(currentQuickRepliesList)) {
        foundItem = currentQuickRepliesList.find(i => i.id === id);
    }
    if (!foundItem) {
        try {
            const cached = localStorage.getItem('lokalex_shared_quick_replies_cache');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && parsed[id]) {
                    const raw = parsed[id];
                    foundItem = {
                        id,
                        title: typeof raw === 'object' ? (raw.title || '') : '',
                        text: typeof raw === 'object' ? (raw.text || '') : raw,
                        order: typeof raw === 'object' ? (raw.order || 0) : 0,
                        createdAt: typeof raw === 'object' ? (raw.createdAt || 0) : 0
                    };
                }
            }
        } catch (_) {}
    }

    if (!foundItem) {
        showToast("⚠️ Cannot find the quick reply to edit.");
        return;
    }

    if (editingIdInput) editingIdInput.value = id;
    if (titleInput) titleInput.value = foundItem.title || '';
    if (textInput) textInput.value = foundItem.text || '';
    if (modalTitle) modalTitle.innerText = "Edit Quick Reply";
    if (modalSub) modalSub.innerText = "Update template permanently for all riders";
    if (submitBtn) submitBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Update Permanently`;
    if (iconContainer) iconContainer.innerHTML = `<i class="fa-solid fa-pen-to-square"></i>`;

    if (modal) {
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
        setTimeout(() => {
            if (textInput) {
                textInput.focus();
                textInput.setSelectionRange(textInput.value.length, textInput.value.length);
            }
        }, 150);
    }
}

export function closeAddQuickReplyModal() {
    const modal = document.getElementById('add-quick-reply-modal');
    const editingIdInput = document.getElementById('editing-quick-reply-id');
    if (editingIdInput) editingIdInput.value = '';
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
}

function saveQuickReplyToLocalCache(id, item) {
    try {
        const cached = localStorage.getItem('lokalex_shared_quick_replies_cache');
        const data = cached ? JSON.parse(cached) : {};
        data[id] = item;
        localStorage.setItem('lokalex_shared_quick_replies_cache', JSON.stringify(data));
        renderSharedQuickReplies(data);
    } catch(e) {}
}

export async function submitSaveQuickReply() {
    const editingIdInput = document.getElementById('editing-quick-reply-id');
    const editingId = editingIdInput ? editingIdInput.value.trim() : '';
    const titleInput = document.getElementById('new-quick-reply-title');
    const textInput = document.getElementById('new-quick-reply-input');
    const text = textInput ? textInput.value.trim() : '';
    if (!text) {
        showToast("⚠️ Please enter the message content before saving!");
        return;
    }

    let title = titleInput ? titleInput.value.trim() : '';
    if (!title) {
        title = text.length > 26 ? text.substring(0, 24) + '...' : text;
    }

    const riderName = appState.riderName || localStorage.getItem('riderName') || 'Rider';

    if (editingId) {
        // PERMANENT EDIT OF EXISTING TEMPLATE
        closeAddQuickReplyModal();

        // 1. Update local cache immediately
        let existingItem = null;
        try {
            const cached = localStorage.getItem('lokalex_shared_quick_replies_cache');
            const data = cached ? JSON.parse(cached) : {};
            existingItem = data[editingId];
            const updatedEntry = {
                ...(typeof existingItem === 'object' ? existingItem : {}),
                title: title,
                text: text,
                updatedAt: Date.now(),
                updatedBy: riderName
            };
            data[editingId] = updatedEntry;
            localStorage.setItem('lokalex_shared_quick_replies_cache', JSON.stringify(data));
            renderSharedQuickReplies(data);
        } catch (e) {
            console.warn("Local cache update error:", e);
        }

        if (!db) {
            showToast("✅ Quick reply updated permanently (locally)!");
            return;
        }

        try {
            const updatePayload = {
                title: title,
                text: text,
                updatedAt: Date.now(),
                updatedBy: riderName
            };
            await db.ref(`sharedQuickReplies/${editingId}`).update(updatePayload);
            showToast("✅ Quick reply updated permanently for all riders!");
        } catch (e) {
            console.error("Update quick reply error:", e);
            if (e.message && e.message.includes('PERMISSION_DENIED')) {
                showToast("⚠️ Updated locally. Please publish updated rules in Firebase Console!");
            } else {
                showToast("⚠️ Updated locally: " + e.message);
            }
        }
        return;
    }

    // CREATE NEW QUICK REPLY (editingId is empty)
    const localId = 'qr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    
    // Find next order number
    const maxOrder = currentQuickRepliesList.reduce((max, item) => Math.max(max, item.order || 0), 0);
    const newEntry = {
        title: title,
        text: text,
        order: maxOrder + 1,
        createdBy: riderName,
        createdAt: Date.now()
    };

    closeAddQuickReplyModal();

    // Immediately cache and display locally so the new reply is usable without round-trip lag
    saveQuickReplyToLocalCache(localId, newEntry);

    if (!db) {
        showToast("✅ Quick reply saved locally!");
        return;
    }

    try {
        const pushed = await db.ref('sharedQuickReplies').push(newEntry);
        if (pushed && pushed.key && pushed.key !== localId) {
            try {
                const cached = localStorage.getItem('lokalex_shared_quick_replies_cache');
                const data = cached ? JSON.parse(cached) : {};
                delete data[localId];
                data[pushed.key] = newEntry;
                localStorage.setItem('lokalex_shared_quick_replies_cache', JSON.stringify(data));
                renderSharedQuickReplies(data);
            } catch (_) {}
        }
        showToast("✅ Quick reply saved! It is now visible to all riders.");
    } catch (e) {
        console.error("Save quick reply error:", e);
        if (e.message && e.message.includes('PERMISSION_DENIED')) {
            showToast("⚠️ Saved locally. Please publish updated database.rules.json in Firebase Console!");
        } else {
            showToast("⚠️ Saved locally: " + e.message);
        }
    }
}

export async function deleteQuickReply(id) {
    if (!id) return;
    if (!confirm("Are you sure you want to delete this quick reply for all riders?")) {
        return;
    }
    try {
        if (db) {
            await db.ref(`sharedQuickReplies/${id}`).remove();
        }
    } catch (e) {
        console.warn("Delete remote quick reply error:", e);
    }
    try {
        const cached = localStorage.getItem('lokalex_shared_quick_replies_cache');
        if (cached) {
            const data = JSON.parse(cached);
            delete data[id];
            localStorage.setItem('lokalex_shared_quick_replies_cache', JSON.stringify(data));
            renderSharedQuickReplies(data);
        }
    } catch(e) {}
    showToast("🗑️ Quick reply deleted.");
}
