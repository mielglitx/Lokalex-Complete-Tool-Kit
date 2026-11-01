// src/features/cart/cartScroller.js

/**
 * ============================================================================
 * SMART CART SLIDER SCROLLER
 * ============================================================================
 * 
 * Provides a visible vertical slider track with a sleek circular knob
 * that remains permanently visible whenever the cart items list overflows
 * (the screen is full), giving users an effortless way to rapidly scroll
 * through multiple lines of items.
 */

let isDragging = false;
let startY = 0;
let startScrollTop = 0;

export function initCartScroller() {
    const list = document.getElementById('cart-items-list');
    const track = document.getElementById('cart-slider-track');
    const thumb = document.getElementById('cart-slider-thumb');
    if (!list || !track || !thumb) return;

    if (list._hasScrollerListeners) return;
    list._hasScrollerListeners = true;

    const updateThumbPosition = () => {
        const scrollHeight = list.scrollHeight;
        const clientHeight = list.clientHeight;
        const maxScroll = scrollHeight - clientHeight;

        // If screen is not full (does not overflow)
        if (maxScroll <= 15) {
            track.classList.add('opacity-0', 'pointer-events-none');
            track.classList.remove('opacity-100');
            return;
        }

        // Screen is full: ALWAYS VISIBLE
        track.classList.remove('opacity-0', 'pointer-events-none');
        track.classList.add('opacity-100');

        const trackHeight = track.clientHeight - thumb.clientHeight;
        if (trackHeight <= 0) return;
        const ratio = Math.max(0, Math.min(1, list.scrollTop / maxScroll));
        thumb.style.top = `${ratio * trackHeight}px`;
    };

    list.addEventListener('scroll', () => {
        if (!isDragging) {
            updateThumbPosition();
        }
    }, { passive: true });

    // Click anywhere on track rail to jump scroll position
    track.addEventListener('click', (e) => {
        if (e.target === thumb || thumb.contains(e.target)) return;
        const trackRect = track.getBoundingClientRect();
        const thumbHeight = thumb.clientHeight;
        const maxThumbTravel = trackRect.height - thumbHeight;
        if (maxThumbTravel <= 0) return;

        const relY = Math.max(0, Math.min(maxThumbTravel, e.clientY - trackRect.top - (thumbHeight / 2)));
        const ratio = relY / maxThumbTravel;
        const maxScroll = list.scrollHeight - list.clientHeight;
        list.scrollTo({ top: ratio * maxScroll, behavior: 'smooth' });
    });

    // Dragging handlers (Touch & Mouse)
    const onDragStart = (clientY) => {
        isDragging = true;
        startY = clientY;
        startScrollTop = list.scrollTop;
        thumb.classList.add('scale-125', 'shadow-blue-500/90', 'ring-2', 'ring-white/80');
        track.classList.remove('opacity-0');
        track.classList.add('opacity-100');
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
        thumb.classList.remove('scale-125', 'shadow-blue-500/90', 'ring-2', 'ring-white/80');
        updateThumbPosition();
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

    // ResizeObserver to automatically update visibility when items list resizes
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
            updateThumbPosition();
        });
        ro.observe(list);
    }
}

export function updateCartScroller() {
    initCartScroller();
    const list = document.getElementById('cart-items-list');
    const track = document.getElementById('cart-slider-track');
    const thumb = document.getElementById('cart-slider-thumb');
    if (!list || !track || !thumb) return;

    const maxScroll = list.scrollHeight - list.clientHeight;
    if (maxScroll <= 15) {
        track.classList.add('opacity-0', 'pointer-events-none');
        track.classList.remove('opacity-100');
    } else {
        track.classList.remove('opacity-0', 'pointer-events-none');
        track.classList.add('opacity-100');
        const trackHeight = track.clientHeight - thumb.clientHeight;
        if (trackHeight > 0) {
            const ratio = Math.max(0, Math.min(1, list.scrollTop / maxScroll));
            thumb.style.top = `${ratio * trackHeight}px`;
        }
    }
}

if (typeof window !== 'undefined') {
    window.initCartScroller = initCartScroller;
    window.updateCartScroller = updateCartScroller;
}
