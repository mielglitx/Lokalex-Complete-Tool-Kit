// src/features/cart/cartScroller.js

/**
 * ============================================================================
 * SMART CART SLIDER SCROLLER
 * ============================================================================
 * 
 * Provides an invisible vertical slider track with a sleek, futuristic
 * circular knob that allows rapid touch and mouse scrolling through large
 * cart item lists.
 */

let isDragging = false;
let startY = 0;
let startScrollTop = 0;
let fadeTimeout = null;

export function initCartScroller() {
    const list = document.getElementById('cart-items-list');
    const track = document.getElementById('cart-slider-track');
    const thumb = document.getElementById('cart-slider-thumb');
    if (!list || !track || !thumb) return;

    if (list._hasScrollerListeners) return;
    list._hasScrollerListeners = true;

    const updateThumbPosition = (show = true) => {
        const scrollHeight = list.scrollHeight;
        const clientHeight = list.clientHeight;
        const maxScroll = scrollHeight - clientHeight;

        if (maxScroll <= 20) {
            track.classList.add('opacity-0', 'pointer-events-none');
            return;
        }

        track.classList.remove('pointer-events-none');
        if (show) {
            track.classList.remove('opacity-0');
            track.classList.add('opacity-90');
            if (fadeTimeout) clearTimeout(fadeTimeout);
            if (!isDragging) {
                fadeTimeout = setTimeout(() => {
                    if (!isDragging) {
                        track.classList.remove('opacity-90');
                        track.classList.add('opacity-0');
                    }
                }, 1800);
            }
        }

        const trackHeight = track.clientHeight - thumb.clientHeight;
        const ratio = Math.max(0, Math.min(1, list.scrollTop / maxScroll));
        thumb.style.top = `${ratio * trackHeight}px`;
    };

    list.addEventListener('scroll', () => {
        if (!isDragging) {
            updateThumbPosition(true);
        }
    }, { passive: true });

    // Dragging handlers (Touch & Mouse)
    const onDragStart = (clientY) => {
        isDragging = true;
        startY = clientY;
        startScrollTop = list.scrollTop;
        thumb.classList.add('scale-115', 'shadow-blue-500/80');
        track.classList.remove('opacity-0');
        track.classList.add('opacity-100');
        if (fadeTimeout) clearTimeout(fadeTimeout);
    };

    const onDragMove = (clientY) => {
        if (!isDragging) return;
        const trackRect = track.getBoundingClientRect();
        const thumbHeight = thumb.clientHeight;
        const maxThumbTravel = trackRect.height - thumbHeight;
        if (maxThumbTravel <= 0) return;

        const relY = Math.max(0, Math.min(maxThumbTravel, clientY - trackRect.top - (thumbHeight / 2)));
        const ratio = relY / maxThumbTravel;

        thumb.style.top = `${relY}px`;
        const maxScroll = list.scrollHeight - list.clientHeight;
        list.scrollTop = ratio * maxScroll;
    };

    const onDragEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        thumb.classList.remove('scale-115', 'shadow-blue-500/80');
        if (fadeTimeout) clearTimeout(fadeTimeout);
        fadeTimeout = setTimeout(() => {
            track.classList.remove('opacity-100', 'opacity-90');
            track.classList.add('opacity-0');
        }, 1500);
    };

    // Touch events on thumb
    thumb.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches[0]) {
            e.preventDefault();
            e.stopPropagation();
            onDragStart(e.touches[0].clientY);
        }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (isDragging && e.touches && e.touches[0]) {
            e.preventDefault();
            onDragMove(e.touches[0].clientY);
        }
    }, { passive: false });

    window.addEventListener('touchend', onDragEnd);
    window.addEventListener('touchcancel', onDragEnd);

    // Mouse events on thumb
    thumb.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragStart(e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            onDragMove(e.clientY);
        }
    });

    window.addEventListener('mouseup', onDragEnd);
}

export function updateCartScroller() {
    initCartScroller();
    const list = document.getElementById('cart-items-list');
    const track = document.getElementById('cart-slider-track');
    const thumb = document.getElementById('cart-slider-thumb');
    if (!list || !track || !thumb) return;

    const maxScroll = list.scrollHeight - list.clientHeight;
    if (maxScroll <= 20) {
        track.classList.add('opacity-0', 'pointer-events-none');
    } else {
        track.classList.remove('pointer-events-none');
        const trackHeight = track.clientHeight - thumb.clientHeight;
        const ratio = Math.max(0, Math.min(1, list.scrollTop / maxScroll));
        thumb.style.top = `${ratio * trackHeight}px`;
        // Briefly show scroller when cart items change
        track.classList.remove('opacity-0');
        track.classList.add('opacity-90');
        if (fadeTimeout) clearTimeout(fadeTimeout);
        fadeTimeout = setTimeout(() => {
            if (!isDragging) {
                track.classList.remove('opacity-90');
                track.classList.add('opacity-0');
            }
        }, 1500);
    }
}

if (typeof window !== 'undefined') {
    window.initCartScroller = initCartScroller;
    window.updateCartScroller = updateCartScroller;
}

