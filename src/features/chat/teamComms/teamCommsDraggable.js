// src/features/chat/teamComms/teamCommsDraggable.js
import { teamCommsState } from './teamCommsState.js';

export function restoreBubbleDockedPosition() {
    const container = document.getElementById('floating-chat-container');
    const bubble = document.getElementById('chat-bubble');
    if (!container || !bubble) return;

    container.style.transition = 'top 0.25s ease-out, right 0.25s ease-out';

    const defaultTop = window.innerHeight * 0.75;
    const targetTop = (teamCommsState.savedBubbleTop !== null) ? teamCommsState.savedBubbleTop : defaultTop;
    const maxTop = window.innerHeight - (bubble.offsetHeight + 10);
    const safeTop = Math.max(10, Math.min(targetTop, maxTop));

    container.style.top = `${safeTop}px`;

    if (teamCommsState.savedBubbleSide === 'right') {
        container.style.right = '0px';
        bubble.className = "pointer-events-auto relative bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-l-2xl shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing transition-all border-l-2 border-t-2 border-b-2 border-white/20 select-none touch-none";
    } else {
        const leftOffset = window.innerWidth - bubble.offsetWidth;
        container.style.right = `${leftOffset}px`;
        bubble.className = "pointer-events-auto relative bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-r-2xl shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing transition-all border-r-2 border-t-2 border-b-2 border-white/20 select-none touch-none";
    }
}

export function initDraggableChat() {
    const container = document.getElementById('floating-chat-container');
    const bubble = document.getElementById('chat-bubble');
    const dragHandle = document.getElementById('chat-drag-handle');
    const windowEl = document.getElementById('expanded-chat-window');

    if (!container || !bubble) return;

    // --- A. DRAGGABLE BUBBLE (WHEN CHAT IS CLOSED) ---
    let isDraggingBubble = false;
    let bubbleMoved = false;
    let bubbleStartX = 0, bubbleStartY = 0;
    let initialContainerTop = 0, initialContainerRight = 0;

    const onBubbleDragStart = (e) => {
        if (teamCommsState.isChatOpen) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        isDraggingBubble = true;
        bubbleMoved = false;
        bubbleStartX = clientX;
        bubbleStartY = clientY;

        const rect = container.getBoundingClientRect();
        initialContainerTop = rect.top;
        initialContainerRight = window.innerWidth - rect.right;

        container.style.transition = 'none';
        bubble.style.cursor = 'grabbing';
    };

    const onBubbleDragMove = (e) => {
        if (!isDraggingBubble || teamCommsState.isChatOpen) return;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const dx = clientX - bubbleStartX;
        const dy = clientY - bubbleStartY;

        if (Math.hypot(dx, dy) > 5) {
            bubbleMoved = true;
            if (e.cancelable && e.preventDefault) e.preventDefault();
        }

        if (bubbleMoved) {
            let newTop = initialContainerTop + dy;
            let newRight = initialContainerRight - dx;

            const maxTop = window.innerHeight - (bubble.offsetHeight + 10);
            const minTop = 10;
            const maxRight = window.innerWidth - (bubble.offsetWidth + 10);
            const minRight = 0;

            newTop = Math.max(minTop, Math.min(newTop, maxTop));
            newRight = Math.max(minRight, Math.min(newRight, maxRight));

            container.style.top = `${newTop}px`;
            container.style.right = `${newRight}px`;
            container.style.bottom = 'auto';
            container.style.left = 'auto';
        }
    };

    const onBubbleDragEnd = () => {
        if (!isDraggingBubble) return;
        isDraggingBubble = false;
        bubble.style.cursor = 'grab';

        if (!bubbleMoved) {
            if (window.toggleChatWindow) {
                window.toggleChatWindow(true);
            }
        } else {
            const rect = container.getBoundingClientRect();
            const snapToRight = (rect.left + rect.width / 2) > (window.innerWidth / 2);
            teamCommsState.savedBubbleTop = rect.top;
            teamCommsState.savedBubbleSide = snapToRight ? 'right' : 'left';

            restoreBubbleDockedPosition();
        }
    };

    bubble.addEventListener('mousedown', onBubbleDragStart);
    window.addEventListener('mousemove', onBubbleDragMove, { passive: false });
    window.addEventListener('mouseup', onBubbleDragEnd);

    bubble.addEventListener('touchstart', onBubbleDragStart, { passive: true });
    window.addEventListener('touchmove', onBubbleDragMove, { passive: false });
    window.addEventListener('touchend', onBubbleDragEnd);

    // --- B. DRAGGABLE WINDOW (WHEN CHAT IS OPEN) ---
    if (dragHandle) {
        let isDraggingWindow = false;
        let winStartX = 0, winStartY = 0;
        let winInitialTop = 0, winInitialRight = 0;

        const onWindowDragStart = (e) => {
            if (!teamCommsState.isChatOpen) return;
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;

            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            isDraggingWindow = true;
            winStartX = clientX;
            winStartY = clientY;

            const rect = container.getBoundingClientRect();
            winInitialTop = rect.top;
            winInitialRight = window.innerWidth - rect.right;

            container.style.transition = 'none';
            dragHandle.style.cursor = 'grabbing';
        };

        const onWindowDragMove = (e) => {
            if (!isDraggingWindow || !teamCommsState.isChatOpen) return;

            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const dx = clientX - winStartX;
            const dy = clientY - winStartY;

            if (e.cancelable && e.preventDefault) e.preventDefault();

            let newTop = winInitialTop + dy;
            let newRight = winInitialRight - dx;

            const winWidth = windowEl ? windowEl.offsetWidth : 360;
            const winHeight = windowEl ? windowEl.offsetHeight : 520;

            const maxTop = window.innerHeight - (winHeight + 10);
            const minTop = 10;
            const maxRight = window.innerWidth - (winWidth + 10);
            const minRight = 10;

            newTop = Math.max(minTop, Math.min(newTop, maxTop));
            newRight = Math.max(minRight, Math.min(newRight, maxRight));

            container.style.top = `${newTop}px`;
            container.style.right = `${newRight}px`;
            container.style.bottom = 'auto';
            container.style.left = 'auto';
        };

        const onWindowDragEnd = () => {
            if (!isDraggingWindow) return;
            isDraggingWindow = false;
            dragHandle.style.cursor = 'grab';
        };

        dragHandle.addEventListener('mousedown', onWindowDragStart);
        window.addEventListener('mousemove', onWindowDragMove, { passive: false });
        window.addEventListener('mouseup', onWindowDragEnd);

        dragHandle.addEventListener('touchstart', onWindowDragStart, { passive: true });
        window.addEventListener('touchmove', onWindowDragMove, { passive: false });
        window.addEventListener('touchend', onWindowDragEnd);
    }
}