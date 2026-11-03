// src/features/cart/cartGestures.js
import { deleteSingleCartItem } from './cartOperations.js';

let touchStartX = 0;
let touchStartY = 0;
let touchCurrentX = 0;
let touchCurrentY = 0;
let activeSwipingCard = null;
let gestureDirection = null; // 'horizontal' | 'vertical' | null

export function handleCardTouchStart(e, cardEl) {
    const interactive = e.target && e.target.closest('button, input, select, textarea, a');
    if (interactive && interactive !== cardEl) {
        // Direct interactive controls inside the card must receive tap/click without gesture interference
        activeSwipingCard = null;
        gestureDirection = null;
        return;
    }

    if (e.touches && e.touches[0]) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchCurrentX = touchStartX;
        touchCurrentY = touchStartY;
        activeSwipingCard = cardEl;
        gestureDirection = null;
    }
}

export function handleCardTouchMove(e, cardEl) {
    if (!activeSwipingCard || activeSwipingCard !== cardEl || !e.touches || !e.touches[0]) return;

    // If already determined as vertical scroll, do not interfere with native scrolling
    if (gestureDirection === 'vertical') return;

    touchCurrentX = e.touches[0].clientX;
    touchCurrentY = e.touches[0].clientY;
    const diffX = touchCurrentX - touchStartX;
    const diffY = touchCurrentY - touchStartY;

    // Detect gesture orientation with threshold
    if (!gestureDirection) {
        if (Math.abs(diffY) > 8 && Math.abs(diffY) > Math.abs(diffX)) {
            // Definite vertical scroll - release card immediately
            gestureDirection = 'vertical';
            activeSwipingCard = null;
            cardEl.style.transform = '';
            cardEl.style.borderColor = '';
            return;
        } else if (Math.abs(diffX) > 10 && Math.abs(diffX) > Math.abs(diffY)) {
            // Definite horizontal swipe
            gestureDirection = 'horizontal';
            cardEl.style.transition = 'none';
        } else {
            // Within deadzone, do not update DOM
            return;
        }
    }

    if (gestureDirection === 'horizontal') {
        if (e.cancelable) {
            e.preventDefault();
        }
        let translateX = diffX;
        if (Math.abs(diffX) > 120) {
            const sign = diffX > 0 ? 1 : -1;
            translateX = sign * (120 + (Math.abs(diffX) - 120) * 0.2);
        }

        cardEl.style.transform = `translateX(${translateX}px)`;
        
        if (Math.abs(diffX) > 65) {
            cardEl.style.borderColor = '#ef4444';
        } else {
            cardEl.style.borderColor = '';
        }
    }
}

export function handleCardTouchEnd(e, index) {
    if (!activeSwipingCard) {
        gestureDirection = null;
        return;
    }
    const cardEl = activeSwipingCard;
    const diffX = touchCurrentX - touchStartX;

    if (gestureDirection === 'horizontal') {
        cardEl.style.transition = 'transform 0.2s ease-out, border-color 0.2s ease-out';

        if (Math.abs(diffX) >= 65) {
            deleteSingleCartItem(index);
        }
        cardEl.style.transform = 'translateX(0px)';
        cardEl.style.borderColor = '';
    } else {
        cardEl.style.transform = '';
        cardEl.style.borderColor = '';
    }

    activeSwipingCard = null;
    gestureDirection = null;
    touchStartX = 0;
    touchStartY = 0;
    touchCurrentX = 0;
    touchCurrentY = 0;
}

if (typeof window !== 'undefined') {
    window.handleCardTouchStart = handleCardTouchStart;
    window.handleCardTouchMove = handleCardTouchMove;
    window.handleCardTouchEnd = handleCardTouchEnd;
}
