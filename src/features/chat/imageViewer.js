// src/features/chat/imageViewer.js
import { toggleBodyScroll } from './chatUtils.js';
import { showToast } from '../../ui/notifications.js';
import { openImageEditorModal } from './imageEditor.js';
import { saveImageToDevice } from '../../utils/imageSaver.js';

let currentViewerImageUrl = null;
let currentViewerTargetType = 'customer';
let viewerZoomScale = 1.0;
let viewerPanX = 0;
let viewerPanY = 0;
let isViewerGesturesInitialized = false;

// Drag / Pan Tracking State
let isDragging = false;
let startPointerX = 0;
let startPointerY = 0;
let initialPanX = 0;
let initialPanY = 0;
let lastTapTime = 0;

export async function downloadCurrentViewerImage() {
    if (!currentViewerImageUrl) {
        showToast("⚠️ No photo to save.");
        return;
    }
    showToast("⏳ Saving photo...");
    const filename = `Lokalex_Photo_${Date.now()}.jpg`;
    await saveImageToDevice(currentViewerImageUrl, filename);
}

function updateViewerTransform() {
    const img = document.getElementById('viewer-image');
    const viewport = document.getElementById('viewer-image-viewport');
    if (!img) return;

    if (viewerZoomScale <= 1.0) {
        viewerPanX = 0;
        viewerPanY = 0;
    } else if (viewport) {
        // Clamp panning so image cannot be dragged completely off-screen
        const imgWidth = img.offsetWidth || 300;
        const imgHeight = img.offsetHeight || 300;
        const viewWidth = viewport.clientWidth || window.innerWidth;
        const viewHeight = viewport.clientHeight || window.innerHeight;

        const maxPanX = Math.max(20, ((imgWidth * viewerZoomScale) - viewWidth) / 2 + 60);
        const maxPanY = Math.max(20, ((imgHeight * viewerZoomScale) - viewHeight) / 2 + 60);

        viewerPanX = Math.max(-maxPanX, Math.min(maxPanX, viewerPanX));
        viewerPanY = Math.max(-maxPanY, Math.min(maxPanY, viewerPanY));
    }

    img.style.transform = `translate(${viewerPanX}px, ${viewerPanY}px) scale(${viewerZoomScale})`;
    img.style.cursor = viewerZoomScale > 1.0 ? (isDragging ? 'grabbing' : 'grab') : 'default';

    const slider = document.getElementById('viewer-zoom-slider');
    const valLabel = document.getElementById('viewer-zoom-val');
    if (slider) slider.value = Math.round(viewerZoomScale * 100);
    if (valLabel) valLabel.innerText = `${Math.round(viewerZoomScale * 100)}%`;
}

export function setViewerZoom(scale, resetPan = false) {
    viewerZoomScale = Math.max(0.5, Math.min(4.0, scale));
    if (resetPan || viewerZoomScale <= 1.0) {
        viewerPanX = 0;
        viewerPanY = 0;
    }
    updateViewerTransform();
}

export function zoomViewerImage(delta) {
    setViewerZoom(viewerZoomScale + delta, false);
}

export function resetViewerZoom() {
    viewerPanX = 0;
    viewerPanY = 0;
    setViewerZoom(1.0, true);
}

export function openImageViewerModal(imageUrl, targetType = null) {
    if (!imageUrl) return;
    const activeCustId = (typeof window.getActiveRiderChatCustId === 'function') ? window.getActiveRiderChatCustId() : null;
    currentViewerImageUrl = imageUrl;
    currentViewerTargetType = targetType || (activeCustId ? 'rider' : 'customer');

    const modal = document.getElementById('image-viewer-modal');
    const img = document.getElementById('viewer-image');
    const downloadBtn = document.getElementById('viewer-download-btn');

    if (img) img.src = imageUrl;
    if (downloadBtn) downloadBtn.href = imageUrl;

    viewerPanX = 0;
    viewerPanY = 0;
    setViewerZoom(1.0, true);

    if (modal) {
        modal.classList.remove('hidden');
        toggleBodyScroll(true);
    }

    if (!isViewerGesturesInitialized) {
        setupImageViewerGestures();
        isViewerGesturesInitialized = true;
    }
}

export function closeImageViewerModal() {
    const modal = document.getElementById('image-viewer-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
    currentViewerImageUrl = null;
    viewerZoomScale = 1.0;
    viewerPanX = 0;
    viewerPanY = 0;
}

export function editViewerImage() {
    if (!currentViewerImageUrl) return;
    const imgUrl = currentViewerImageUrl;
    const activeCustId = (typeof window.getActiveRiderChatCustId === 'function') ? window.getActiveRiderChatCustId() : null;
    const targetType = currentViewerTargetType || (activeCustId ? 'rider' : 'customer');
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

function setupImageViewerGestures() {
    const viewport = document.getElementById('viewer-image-viewport');
    const img = document.getElementById('viewer-image');
    if (!viewport) return;

    let initialPinchDistance = 0;
    let initialZoomScale = 1;

    const getDistance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

    // Pointer Down (Mouse or Touch Start)
    viewport.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        // Double tap / double click detection
        const now = Date.now();
        if (now - lastTapTime < 280) {
            e.preventDefault();
            if (viewerZoomScale > 1.05) {
                resetViewerZoom();
            } else {
                viewerPanX = 0;
                viewerPanY = 0;
                setViewerZoom(2.0, false);
            }
            lastTapTime = 0;
            return;
        }
        lastTapTime = now;

        if (viewerZoomScale > 1.0) {
            isDragging = true;
            startPointerX = e.clientX;
            startPointerY = e.clientY;
            initialPanX = viewerPanX;
            initialPanY = viewerPanY;
            viewport.setPointerCapture(e.pointerId);
            if (img) img.style.cursor = 'grabbing';
        }
    });

    // Pointer Move (Drag / Pan)
    viewport.addEventListener('pointermove', (e) => {
        if (!isDragging || viewerZoomScale <= 1.0) return;
        e.preventDefault();

        const deltaX = e.clientX - startPointerX;
        const deltaY = e.clientY - startPointerY;

        viewerPanX = initialPanX + deltaX;
        viewerPanY = initialPanY + deltaY;

        updateViewerTransform();
    });

    // Pointer Up & Cancel
    const endDrag = (e) => {
        if (isDragging) {
            isDragging = false;
            try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
            updateViewerTransform();
        }
    };
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    // Pinch-to-zoom (multi-touch)
    viewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            isDragging = false;
            initialPinchDistance = getDistance(e.touches);
            initialZoomScale = viewerZoomScale;
        }
    }, { passive: false });

    viewport.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialPinchDistance > 0) {
            e.preventDefault();
            const currentDist = getDistance(e.touches);
            const newScale = initialZoomScale * (currentDist / initialPinchDistance);
            setViewerZoom(newScale, false);
        }
    }, { passive: false });

    viewport.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
            initialPinchDistance = 0;
        }
    });

    // Desktop Mouse Wheel Zoom
    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoomViewerImage(e.deltaY < 0 ? 0.2 : -0.2);
    }, { passive: false });
}

if (typeof window !== 'undefined') {
    window.openImageViewerModal = openImageViewerModal;
    window.closeImageViewerModal = closeImageViewerModal;
    window.setViewerZoom = setViewerZoom;
    window.zoomViewerImage = zoomViewerImage;
    window.resetViewerZoom = resetViewerZoom;
    window.editViewerImage = editViewerImage;
    window.downloadCurrentViewerImage = downloadCurrentViewerImage;
}
