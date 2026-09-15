// src/features/cart/cartGestures.js
import { deleteSingleCartItem } from './cartOperations.js';

let touchStartX = 0;
let touchCurrentX = 0;
let activeSwipingCard = null;

export function handleCardTouchStart(e, cardEl) {
    if (e.touches && e.touches[0]) {
        touchStartX = e.touches[0].clientX;
        touchCurrentX = touchStartX;
        activeSwipingCard = cardEl;
        cardEl.style.transition = 'none';
    }
}

export function handleCardTouchMove(e, cardEl) {
    if (!activeSwipingCard || activeSwipingCard !== cardEl || !e.touches || !e.touches[0]) return;
    touchCurrentX = e.touches[0].clientX;
    const diffX = touchCurrentX - touchStartX;

    let translateX = diffX;
    if (Math.abs(diffX) > 120) {
        const sign = diffX > 0 ? 1 : -1;
        translateX = sign * (120 + (Math.abs(diffX) - 120) * 0.2);
    }

    cardEl.style.transform = `translateX(${translateX}px)`;
    
    if (Math.abs(diffX) > 80) {
        cardEl.style.borderColor = '#ef4444';
    } else {
        cardEl.style.borderColor = '';
    }
}

export function handleCardTouchEnd(e, index) {
    if (!activeSwipingCard) return;
    const cardEl = activeSwipingCard;
    const diffX = touchCurrentX - touchStartX;

    cardEl.style.transition = 'transform 0.2s ease-out, border-color 0.2s ease-out';

    if (Math.abs(diffX) >= 80) {
        deleteSingleCartItem(index);
        cardEl.style.transform = 'translateX(0px)';
        cardEl.style.borderColor = '';
    } else {
        cardEl.style.transform = 'translateX(0px)';
        cardEl.style.borderColor = '';
    }

    activeSwipingCard = null;
    touchStartX = 0;
    touchCurrentX = 0;
}