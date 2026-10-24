// src/features/chat/videoSender.js

/**
 * ============================================================================
 * VIDEO ATTACHMENT SENDER & RECORDER CONTROLLER
 * ============================================================================
 * 
 * Handles recording or selecting video clips, previewing them in a dedicated modal,
 * uploading to Firebase Storage / CDN with real-time progress, and dispatching to chat.
 */

import { toggleBodyScroll } from './chatUtils.js';
import { showToast } from '../../ui/notifications.js';
import { generateVideoThumbnail, uploadVideo, formatVideoDuration, formatFileSize } from '../../utils/videoUpload.js';

let pendingVideoFile = null;
let pendingVideoMeta = null;
let isUploadingVideo = false;

/**
 * Prompts the rider to select or record a video.
 * If dedicated picker is open, triggers camera or file input.
 */
export function promptVideoAttachmentSource() {
    const picker = document.getElementById('chat-video-picker-modal');
    if (picker) {
        picker.classList.remove('hidden');
        picker.style.zIndex = '999999';
        toggleBodyScroll(true);
    } else {
        // Fallback: Trigger camera/file directly
        triggerVideoInput('camera');
    }
}

/**
 * Closes the video source picker modal.
 */
export function closeVideoPickerModal() {
    const picker = document.getElementById('chat-video-picker-modal');
    if (picker) {
        picker.classList.add('hidden');
        toggleBodyScroll(false);
    }
}

/**
 * Triggers either the camera recorder or video file chooser input.
 * 
 * @param {'camera'|'gallery'} sourceType 
 */
export function triggerVideoInput(sourceType = 'camera') {
    closeVideoPickerModal();
    if (sourceType === 'camera') {
        const camInput = document.getElementById('chat-video-camera-input');
        if (camInput) camInput.click();
    } else {
        const fileInput = document.getElementById('chat-video-file-input');
        if (fileInput) fileInput.click();
    }
}

/**
 * Invoked when rider selects or finishes recording a video file.
 * Generates thumbnail, duration, and opens the preview modal.
 * 
 * @param {HTMLInputElement} inputEl 
 */
export async function handleChatVideoSelected(inputEl) {
    const file = inputEl?.files?.[0];
    if (!file) return;

    // Check MIME type or extension
    const isVideo = file.type?.startsWith('video/') || /\.(mp4|webm|mov|m4v|3gp|mkv)$/i.test(file.name);
    if (!isVideo) {
        showToast("⚠️ Paki-pili ang wastong video file (MP4, WebM, MOV).");
        if (inputEl) inputEl.value = "";
        return;
    }

    // Safety check for size (> 50 MB)
    if (file.size > 52428800) {
        showToast("⚠️ Masyadong malaki ang video (>50MB). Pumili ng mas maikling clip.");
        if (inputEl) inputEl.value = "";
        return;
    }

    pendingVideoFile = file;
    showToast("⏳ Hinahanda ang video preview...");

    try {
        const meta = await generateVideoThumbnail(file);
        pendingVideoMeta = {
            duration: meta.duration || 0,
            thumbnail: meta.thumbnail || null,
            width: meta.width || 0,
            height: meta.height || 0,
            fileSize: file.size,
            fileName: file.name || 'video.mp4'
        };

        openVideoPreviewModal(file, pendingVideoMeta);
    } catch (err) {
        console.error("Video processing error:", err);
        showToast("❌ Nabigo ang pag-proseso ng video.");
    } finally {
        if (inputEl) inputEl.value = "";
    }
}

/**
 * Displays the Video Preview modal with the selected video clip.
 */
export function openVideoPreviewModal(file, meta) {
    const modal = document.getElementById('video-preview-modal');
    const player = document.getElementById('video-preview-player');
    const metaLabel = document.getElementById('video-preview-meta');
    const durLabel = document.getElementById('video-preview-duration');
    const captionInput = document.getElementById('video-preview-caption-input');
    const progressContainer = document.getElementById('video-preview-progress-container');
    const sendBtn = document.getElementById('video-preview-send-btn');

    if (captionInput) captionInput.value = "";
    if (progressContainer) progressContainer.classList.add('hidden');
    if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane text-xs"></i> Send Video';
    }

    const durStr = formatVideoDuration(meta?.duration || 0);
    const sizeStr = formatFileSize(meta?.fileSize || file.size);

    if (durLabel) durLabel.innerText = durStr;
    if (metaLabel) metaLabel.innerText = `${durStr} • ${sizeStr}`;

    if (player) {
        player.src = URL.createObjectURL(file);
        player.currentTime = 0;
    }

    if (modal) {
        modal.classList.remove('hidden');
        modal.style.zIndex = '999999';
        toggleBodyScroll(true);
    }
}

/**
 * Closes the Video Preview modal and cleans up temporary resources.
 */
export function closeVideoPreviewModal() {
    if (isUploadingVideo) {
        if (!confirm("Kasalukuyang nag-a-upload ang video. Nais mo bang kanselahin?")) {
            return;
        }
    }

    const modal = document.getElementById('video-preview-modal');
    const player = document.getElementById('video-preview-player');

    if (player) {
        try {
            player.pause();
            if (player.src && player.src.startsWith('blob:')) {
                URL.revokeObjectURL(player.src);
            }
            player.src = '';
        } catch (_) {}
    }

    pendingVideoFile = null;
    pendingVideoMeta = null;
    isUploadingVideo = false;

    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
}

/**
 * Uploads the confirmed video and dispatches it into active chat conversation.
 */
export async function confirmSendChatVideo() {
    if (!pendingVideoFile || isUploadingVideo) return;

    const targetCustId = (typeof window.getActiveRiderChatCustId === 'function') ? window.getActiveRiderChatCustId() : null;
    const captionInput = document.getElementById('video-preview-caption-input');
    const caption = captionInput ? captionInput.value.trim() : "";

    const progressContainer = document.getElementById('video-preview-progress-container');
    const progressBar = document.getElementById('video-preview-progress-bar');
    const progressPercent = document.getElementById('video-preview-progress-percent');
    const sendBtn = document.getElementById('video-preview-send-btn');

    isUploadingVideo = true;
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-xs"></i> Uploading...';
    }
    if (progressContainer) progressContainer.classList.remove('hidden');
    if (progressBar) progressBar.style.width = '0%';
    if (progressPercent) progressPercent.innerText = '0%';

    try {
        const now = Date.now();
        const ext = pendingVideoFile.name?.split('.').pop() || 'mp4';
        const storagePath = `chat_videos/${targetCustId || 'general'}/${now}_video.${ext}`;

        const videoUrl = await uploadVideo(pendingVideoFile, storagePath, (percent) => {
            if (progressBar) progressBar.style.width = `${percent}%`;
            if (progressPercent) progressPercent.innerText = `${percent}%`;
        });

        if (!videoUrl) {
            throw new Error("Video upload returned empty URL");
        }

        const customVideoPayload = {
            videoUrl: videoUrl,
            videoThumbnail: pendingVideoMeta?.thumbnail || null,
            videoDuration: pendingVideoMeta?.duration || 0,
            videoSize: pendingVideoFile.size || 0,
            videoName: pendingVideoFile.name || 'Video',
            caption: caption
        };

        // Dispatch via active chat send function
        if (targetCustId || (window.sendRiderToCustomerChat && typeof window.sendRiderToCustomerChat === 'function')) {
            await window.sendRiderToCustomerChat(
                caption,
                null,
                null,
                targetCustId,
                null,
                customVideoPayload
            );
        } else if (window.sendCustomerToRiderChat && typeof window.sendCustomerToRiderChat === 'function') {
            await window.sendCustomerToRiderChat(
                caption,
                null,
                null,
                null,
                customVideoPayload
            );
        }

        showToast("✅ Video sent successfully!");
        isUploadingVideo = false;
        closeVideoPreviewModal();
    } catch (err) {
        console.error("Video send error:", err);
        showToast("❌ Nabigo ang pag-send ng video. Pakisubukang muli.");
        isUploadingVideo = false;
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane text-xs"></i> Send Video';
        }
        if (progressContainer) progressContainer.classList.add('hidden');
    }
}

// Bind to window for HTML inline onclick handlers
if (typeof window !== 'undefined') {
    window.promptVideoAttachmentSource = promptVideoAttachmentSource;
    window.closeVideoPickerModal = closeVideoPickerModal;
    window.triggerVideoInput = triggerVideoInput;
    window.handleChatVideoSelected = handleChatVideoSelected;
    window.openVideoPreviewModal = openVideoPreviewModal;
    window.closeVideoPreviewModal = closeVideoPreviewModal;
    window.confirmSendChatVideo = confirmSendChatVideo;
}

