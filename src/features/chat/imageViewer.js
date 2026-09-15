// src/features/chat/imageViewer.js
import { toggleBodyScroll } from './chatUtils.js';
import { showToast } from '../../ui/notifications.js';
import { openImageEditorModal } from './imageEditor.js';

let currentViewerImageUrl = null;
let currentViewerTargetType = 'customer';
let viewerZoomScale = 1;
let isViewerPinchInitialized = false;

export function setViewerZoom(scale) {
    viewerZoomScale = Math.max(0.5, Math.min(4.0, scale));
    const img = document.getElementById('viewer-image');
    const slider = document.getElementById('viewer-zoom-slider');
    const valLabel = document.getElementById('viewer-zoom-val');

    if (img) img.style.transform = `scale(${viewerZoomScale})`;
    if (slider) slider.value = Math.round(viewerZoomScale * 100);
    if (valLabel) valLabel.innerText = `${Math.round(viewerZoomScale * 100)}%`;
}

export function zoomViewerImage(delta) {
    setViewerZoom(viewerZoomScale + delta);
}

export function resetViewerZoom() {
    setViewerZoom(1.0);
}

export function openImageViewerModal(imageUrl, targetType = 'customer') {
    if (!imageUrl) return;
    currentViewerImageUrl = imageUrl;
    currentViewerTargetType = targetType;

    const modal = document.getElementById('image-viewer-modal');
    const img = document.getElementById('viewer-image');
    const downloadBtn = document.getElementById('viewer-download-btn');

    if (img) img.src = imageUrl;
    if (downloadBtn) downloadBtn.href = imageUrl;

    setViewerZoom(1.0);

    if (modal) {
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
    }

    if (!isViewerPinchInitialized) {
        setupImageViewerPinchGestures();
        isViewerPinchInitialized = true;
    }
}

export function closeImageViewerModal() {
    const modal = document.getElementById('image-viewer-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
    currentViewerImageUrl = null;
    viewerZoomScale = 1;
}

export function editViewerImage() {
    if (!currentViewerImageUrl) return;
    const imgUrl = currentViewerImageUrl;
    const targetType = currentViewerTargetType || 'customer';
    closeImageViewerModal();

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
        openImageEditorModal(img, targetType);
    };
    img.onerror = () => {
        showToast("⚠️ Could not load image for editing.");
    };
    img.src = imgUrl;
}

function setupImageViewerPinchGestures() {
    const viewport = document.getElementById('viewer-image-viewport');
    if (!viewport) return;

    let initialPinchDistance = 0;
    let initialZoomScale = 1;

    const getDistance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

    viewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            initialPinchDistance = getDistance(e.touches);
            initialZoomScale = viewerZoomScale;
        }
    }, { passive: false });

    viewport.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialPinchDistance > 0) {
            e.preventDefault();
            setViewerZoom(initialZoomScale * (getDistance(e.touches) / initialPinchDistance));
        }
    }, { passive: false });

    viewport.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) initialPinchDistance = 0;
    });

    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoomViewerImage(e.deltaY < 0 ? 0.15 : -0.15);
    }, { passive: false });
}