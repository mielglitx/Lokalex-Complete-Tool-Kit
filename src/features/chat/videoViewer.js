// src/features/chat/videoViewer.js

/**
 * ============================================================================
 * VIDEO VIEWER MODAL CONTROLLER
 * ============================================================================
 * 
 * Provides full-screen video playback in chat with controls:
 * - Play/Pause, Timeline Scrubbing, Volume/Mute, Fullscreen
 * - Playback speed toggling (1.0x, 1.25x, 1.5x, 2.0x, 0.75x)
 * - Video download/saving to local device
 * - Dynamic caption display and responsive aspect ratios
 */

import { toggleBodyScroll } from './chatUtils.js';
import { showToast } from '../../ui/notifications.js';

let currentViewerVideoUrl = null;
let currentPlaybackSpeed = 1.0;
const SPEED_STEPS = [1.0, 1.25, 1.5, 2.0, 0.75];

/**
 * Opens the dedicated Video Viewer modal and plays the specified video URL.
 * 
 * @param {string} videoUrl 
 * @param {string} [title] 
 * @param {string} [senderName] 
 * @param {string} [caption] 
 */
export function openVideoViewerModal(videoUrl, title = 'Video', senderName = '', caption = '') {
    if (!videoUrl) {
        showToast("⚠️ No video URL to play.");
        return;
    }

    currentViewerVideoUrl = videoUrl;
    currentPlaybackSpeed = 1.0;

    const modal = document.getElementById('video-viewer-modal');
    const player = document.getElementById('video-viewer-player');
    const titleEl = document.getElementById('video-viewer-title');
    const subtitleEl = document.getElementById('video-viewer-subtitle');
    const captionEl = document.getElementById('video-viewer-caption');
    const captionContainer = document.getElementById('video-viewer-caption-container');
    const speedBtn = document.getElementById('video-viewer-speed-btn');

    if (titleEl) {
        titleEl.innerText = title || 'Video Player';
    }
    if (subtitleEl) {
        subtitleEl.innerText = senderName ? `Sent by ${senderName}` : 'Lokalex Chat Media';
    }

    if (caption && caption.trim() && caption !== '🎥 Video' && caption !== 'Video') {
        if (captionEl) captionEl.innerText = caption.trim();
        if (captionContainer) captionContainer.classList.remove('hidden');
    } else {
        if (captionContainer) captionContainer.classList.add('hidden');
    }

    if (speedBtn) {
        speedBtn.innerText = '1.0x';
    }

    if (player) {
        player.src = videoUrl;
        player.playbackRate = 1.0;
        player.currentTime = 0;
        try {
            const playPromise = player.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    // Autoplay prevented by browser policy (user can tap play manually)
                });
            }
        } catch (_) {}
    }

    if (modal) {
        modal.classList.remove('hidden');
        modal.style.zIndex = '999999';
        toggleBodyScroll(true);
    }
}

/**
 * Closes the Video Viewer modal and pauses playback.
 */
export function closeVideoViewerModal() {
    const modal = document.getElementById('video-viewer-modal');
    const player = document.getElementById('video-viewer-player');

    if (player) {
        try {
            player.pause();
            player.src = '';
        } catch (_) {}
    }

    currentViewerVideoUrl = null;

    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
}

/**
 * Cycles playback speed through 1.0x -> 1.25x -> 1.5x -> 2.0x -> 0.75x.
 */
export function cycleVideoPlaybackSpeed() {
    const player = document.getElementById('video-viewer-player');
    const speedBtn = document.getElementById('video-viewer-speed-btn');

    const nextIdx = (SPEED_STEPS.indexOf(currentPlaybackSpeed) + 1) % SPEED_STEPS.length;
    currentPlaybackSpeed = SPEED_STEPS[nextIdx];

    if (player) {
        player.playbackRate = currentPlaybackSpeed;
    }
    if (speedBtn) {
        speedBtn.innerText = `${currentPlaybackSpeed}x`;
    }
}

/**
 * Downloads or saves the currently viewed video to the device.
 */
export async function downloadCurrentViewerVideo() {
    if (!currentViewerVideoUrl) {
        showToast("⚠️ No video to save.");
        return;
    }

    showToast("⏳ Downloading video...");
    try {
        const filename = `Lokalex_Video_${Date.now()}.mp4`;

        // If running in browser or webview, trigger anchor download
        const a = document.createElement('a');
        a.href = currentViewerVideoUrl;
        a.download = filename;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        showToast("✅ Download started!");
    } catch (e) {
        console.error("Video download error:", e);
        showToast("❌ Failed to download video.");
    }
}

// Bind to window for HTML inline onclick handlers
if (typeof window !== 'undefined') {
    window.openVideoViewerModal = openVideoViewerModal;
    window.closeVideoViewerModal = closeVideoViewerModal;
    window.cycleVideoPlaybackSpeed = cycleVideoPlaybackSpeed;
    window.downloadCurrentViewerVideo = downloadCurrentViewerVideo;
}

