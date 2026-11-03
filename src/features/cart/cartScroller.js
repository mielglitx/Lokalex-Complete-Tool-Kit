// src/features/cart/cartScroller.js

/**
 * ============================================================================
 * SMART CART SLIDER SCROLLER
 * ============================================================================
 * 
 * Provides a visible vertical slider track with a sleek circular knob
 * that remains permanently visible whenever the cart items list overflows
 * or has items, giving users an effortless way to rapidly scroll through
 * multiple lines of items.
 */

let isDragging = false;
let startY = 0;
let hasBoundGlobalListeners = false;

function getScrollContext() {
    const viewCart = document.getElementById('view-cart');
    const isCartVisible = viewCart && !viewCart.classList.contains('hidden');
    const list = document.getElementById('cart-items-list');
    const track = document.getElementById('cart-slider-track');
    const thumb = document.getElementById('cart-slider-thumb');

    if (!isCartVisible || !list || !track || !thumb) {
        return null;
    }

    const itemCount = list.children ? list.children.length : 0;
    const listMaxScroll = list.scrollHeight - list.clientHeight;

    if (listMaxScroll > 6) {
        return {
            target: list,
            maxScroll: listMaxScroll,
            scrollTop: list.scrollTop,
            setScroll: (val) => { list.scrollTop = val; },
            itemCount,
            track,
            thumb,
            isList: true
        };
    }

    // Fallback: document / window scrolling
    const doc = document.documentElement;
    const body = document.body;
    const docScrollTop = window.scrollY || window.pageYOffset || (doc ? doc.scrollTop : 0) || (body ? body.scrollTop : 0) || 0;
    const docScrollHeight = Math.max(doc ? doc.scrollHeight : 0, body ? body.scrollHeight : 0);
    const docMaxScroll = Math.max(0, docScrollHeight - window.innerHeight);

    return {
        target: window,
        maxScroll: docMaxScroll,
        scrollTop: docScrollTop,
        setScroll: (val) => { window.scrollTo({ top: val, behavior: 'auto' }); },
        itemCount,
        track,
        thumb,
        isList: false
    };
}

export function updateCartScroller() {
    initCartScroller();
    const track = document.getElementById('cart-slider-track');
    const thumb = document.getElementById('cart-slider-thumb');
    if (!track || !thumb) return;

    const ctx = getScrollContext();
    if (!ctx) {
        track.classList.add('opacity-0', 'pointer-events-none');
        track.classList.remove('opacity-100');
        return;
    }

    const { maxScroll, scrollTop, itemCount } = ctx;
    const shouldShow = maxScroll > 8 || itemCount >= 3;

    if (!shouldShow) {
        track.classList.add('opacity-0', 'pointer-events-none');
        track.classList.remove('opacity-100');
        return;
    }

    track.classList.remove('opacity-0', 'pointer-events-none');
    track.classList.add('opacity-100');

    const trackHeight = track.clientHeight - thumb.clientHeight;
    if (trackHeight <= 0) return;
    const ratio = maxScroll > 0 ? Math.max(0, Math.min(1, scrollTop / maxScroll)) : 0;
    thumb.style.top = `${ratio * trackHeight}px`;
}

export function initCartScroller() {
    const list = document.getElementById('cart-items-list');
    const track = document.getElementById('cart-slider-track');
    const thumb = document.getElementById('cart-slider-thumb');
    if (!list || !track || !thumb) return;

    if (list._hasScrollerListeners) {
        return;
    }
    list._hasScrollerListeners = true;

    // Scroll listeners on both list and window
    list.addEventListener('scroll', () => {
        if (!isDragging) updateCartScroller();
    }, { passive: true });

    if (!hasBoundGlobalListeners) {
        hasBoundGlobalListeners = true;

        window.addEventListener('scroll', () => {
            if (!isDragging) updateCartScroller();
        }, { passive: true });

        window.addEventListener('resize', () => {
            updateCartScroller();
        });

        window.addEventListener('viewChanged', (e) => {
            if (e && e.detail === 'view-cart') {
                setTimeout(updateCartScroller, 50);
                setTimeout(updateCartScroller, 200);
            } else {
                const tr = document.getElementById('cart-slider-track');
                if (tr) {
                    tr.classList.add('opacity-0', 'pointer-events-none');
                    tr.classList.remove('opacity-100');
                }
            }
        });
    }

    // Click anywhere on track rail to jump scroll position
    track.addEventListener('click', (e) => {
        if (e.target === thumb || thumb.contains(e.target)) return;
        const ctx = getScrollContext();
        if (!ctx || ctx.maxScroll <= 0) return;

        const trackRect = track.getBoundingClientRect();
        const thumbHeight = thumb.clientHeight;
        const maxThumbTravel = trackRect.height - thumbHeight;
        if (maxThumbTravel <= 0) return;

        const relY = Math.max(0, Math.min(maxThumbTravel, e.clientY - trackRect.top - (thumbHeight / 2)));
        const ratio = relY / maxThumbTravel;
        ctx.setScroll(ratio * ctx.maxScroll);
    });

    // Dragging handlers (Touch & Mouse)
    const onDragStart = (clientY) => {
        isDragging = true;
        startY = clientY;
        thumb.classList.add('scale-125', 'shadow-blue-500/90', 'ring-2', 'ring-white/80');
        track.classList.remove('opacity-0');
        track.classList.add('opacity-100');
    };

    const onDragMove = (clientY) => {
        if (!isDragging) return;
        const ctx = getScrollContext();
        if (!ctx) return;

        const trackRect = track.getBoundingClientRect();
        const thumbHeight = thumb.clientHeight;
        const maxThumbTravel = trackRect.height - thumbHeight;
        if (maxThumbTravel <= 0) return;

        const relY = Math.max(0, Math.min(maxThumbTravel, clientY - trackRect.top - (thumbHeight / 2)));
        const ratio = relY / maxThumbTravel;

        thumb.style.top = `${relY}px`;
        if (ctx.maxScroll > 0) {
            ctx.setScroll(ratio * ctx.maxScroll);
        }
    };

    const onDragEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        thumb.classList.remove('scale-125', 'shadow-blue-500/90', 'ring-2', 'ring-white/80');
        updateCartScroller();
    };

    // Touch events on thumb
    thumb.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches[0]) {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            onDragStart(e.touches[0].clientY);
        }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (isDragging && e.touches && e.touches[0]) {
            if (e.cancelable) e.preventDefault();
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
            updateCartScroller();
        });
        ro.observe(list);
    }
}

if (typeof window !== 'undefined') {
    window.initCartScroller = initCartScroller;
    window.updateCartScroller = updateCartScroller;
}
