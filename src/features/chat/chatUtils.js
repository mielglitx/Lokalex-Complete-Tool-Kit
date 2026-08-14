// src/features/chat/chatUtils.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';
import { showToast } from '../../ui/notifications.js';
import { escapeHtml } from '../../utils/helpers.js';

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