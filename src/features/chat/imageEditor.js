// src/features/chat/imageEditor.js
import { db } from '../../config/firebase.js';
import { appState } from '../../store/state.js';
import { toggleBodyScroll, isHdMode } from './chatUtils.js';
import { showToast } from '../../ui/notifications.js';

const BRUSH_PRESETS = [
    { name: 'S', lineWidth: 3, dotSize: 6 },
    { name: 'M', lineWidth: 7, dotSize: 12 },
    { name: 'L', lineWidth: 14, dotSize: 18 },
    { name: 'XL', lineWidth: 22, dotSize: 24 }
];
let currentBrushIndex = 0;
let currentEditorColor = '#ef4444';

let editorBaseImage = null;
let editorDrawingCanvas = null;
let editorDrawingCtx = null;
let editorTargetType = 'customer';
let isDrawingOnCanvas = false;
let isDraggingText = false;
let selectedTextIndex = -1;
let textDragOffsetX = 0;
let textDragOffsetY = 0;
let lastCanvasX = 0;
let lastCanvasY = 0;
let editorTextOverlays = [];

// Multi-touch & Gesture Tracking Variables
let initialPinchDistance = 0;
let initialPinchFontSize = 24;
let initialPinchAngle = 0;
let initialTextRotation = 0;

let touchDownTime = 0;
let touchDownPos = { x: 0, y: 0 };
let hasMovedSignificantly = false;

export function cycleBrushSize() {
    currentBrushIndex = (currentBrushIndex + 1) % BRUSH_PRESETS.length;
    updateBrushSizeUI();
}

export function updateBrushSizeUI() {
    const preset = BRUSH_PRESETS[currentBrushIndex];
    const dot = document.getElementById('brush-size-dot');
    const label = document.getElementById('brush-size-label');

    if (dot) {
        dot.style.width = `${preset.dotSize}px`;
        dot.style.height = `${preset.dotSize}px`;
        dot.style.backgroundColor = currentEditorColor;
    }
    if (label) label.innerText = preset.name;
}

export function setEditorColor(colorHex) {
    currentEditorColor = colorHex;
    const hexes = { red: '#ef4444', black: '#000000', white: '#ffffff' };
    
    ['red', 'black', 'white'].forEach(c => {
        const btn = document.getElementById(`color-btn-${c}`);
        if (btn) {
            btn.style.backgroundColor = hexes[c];
            btn.className = (hexes[c] === colorHex)
                ? "w-7 h-7 rounded-full border-2 border-black ring-2 ring-blue-500 scale-110 shadow transition"
                : `w-7 h-7 rounded-full border-2 ${c === 'black' ? 'border-white' : 'border-black'} opacity-80 transition active:scale-95 shadow`;
        }
    });

    if (selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
        editorTextOverlays[selectedTextIndex].color = colorHex;
        const input = document.getElementById('canvas-inline-text-input');
        if (input) input.style.color = colorHex;
        renderEditorCanvas();
    }

    updateBrushSizeUI();
}

export function updateSelectedTextFontSize(newSize) {
    if (selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
        editorTextOverlays[selectedTextIndex].fontSize = parseInt(newSize, 10);
        
        const input = document.getElementById('canvas-inline-text-input');
        const canvas = document.getElementById('photo-canvas');
        if (input && canvas) {
            const rect = canvas.getBoundingClientRect();
            const scaleY = rect.height / canvas.height;
            input.style.fontSize = `${Math.max(14, Math.round(parseInt(newSize, 10) * scaleY))}px`;
        }

        renderEditorCanvas();
    }
}

export function updateSelectedTextRotation(degVal) {
    if (selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
        editorTextOverlays[selectedTextIndex].rotation = (parseInt(degVal, 10) * Math.PI) / 180;
        renderEditorCanvas();
    }
}

export function deleteSelectedTextOverlay() {
    if (selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
        editorTextOverlays.splice(selectedTextIndex, 1);
        selectedTextIndex = -1;
        isDraggingText = false;
        const input = document.getElementById('canvas-inline-text-input');
        if (input) input.classList.add('hidden');
        updateTextControlsUI();
        renderEditorCanvas();
        showToast("🗑️ Text removed!");
    }
}

function updateTextControlsUI() {
    const controlsContainer = document.getElementById('editor-text-controls');
    const sizeSlider = document.getElementById('editor-text-size-slider');
    const rotateSlider = document.getElementById('editor-text-rotate-slider');
    const sizeLabel = document.getElementById('editor-text-size-val');
    const rotateLabel = document.getElementById('editor-text-rotate-val');

    if (selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
        const item = editorTextOverlays[selectedTextIndex];
        if (controlsContainer) controlsContainer.classList.remove('hidden');
        if (sizeSlider) sizeSlider.value = item.fontSize;
        if (rotateSlider) rotateSlider.value = Math.round(((item.rotation || 0) * 180) / Math.PI);
        if (sizeLabel) sizeLabel.innerText = `${item.fontSize}px`;
        if (rotateLabel) rotateLabel.innerText = `${Math.round(((item.rotation || 0) * 180) / Math.PI)}°`;
    } else {
        if (controlsContainer) controlsContainer.classList.add('hidden');
    }
}

export function addEditorTextOverlay() {
    const canvas = document.getElementById('photo-canvas');
    if (!canvas) return;

    commitCanvasInlineText();

    const newTextObj = {
        text: '',
        x: canvas.width / 2,
        y: canvas.height / 2,
        fontSize: Math.round(canvas.width / 15),
        color: currentEditorColor,
        rotation: 0
    };

    editorTextOverlays.push(newTextObj);
    selectedTextIndex = editorTextOverlays.length - 1;
    updateTextControlsUI();
    renderEditorCanvas();

    activateInlineTextEditor(selectedTextIndex);
}

export function activateInlineTextEditor(idx) {
    if (idx < 0 || !editorTextOverlays[idx]) return;
    selectedTextIndex = idx;
    isDraggingText = false;
    isDrawingOnCanvas = false;

    const item = editorTextOverlays[idx];
    const canvas = document.getElementById('photo-canvas');
    const input = document.getElementById('canvas-inline-text-input');
    if (!canvas || !input) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;

    const displayX = item.x * scaleX;
    const displayY = item.y * scaleY;
    const displayFontSize = Math.max(14, Math.round(item.fontSize * scaleY));

    input.style.left = `${displayX}px`;
    input.style.top = `${displayY}px`;
    input.style.fontSize = `${displayFontSize}px`;
    input.style.color = item.color || currentEditorColor;

    const cleanColor = (item.color || currentEditorColor || "").toLowerCase().trim();
    const isBlackText = cleanColor === '#000000' || cleanColor === 'black' || cleanColor === 'rgb(0,0,0)';
    input.style.textShadow = isBlackText ? '0 0 3px #ffffff' : '0 0 3px #000000, 0 0 2px #000000';

    input.value = item.text;
    input.placeholder = "~";
    input.classList.remove('hidden');

    renderEditorCanvas();

    setTimeout(() => {
        input.focus();
        if (item.text) input.select();
    }, 50);
}

export function handleCanvasInlineTextInput(val) {
    if (selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
        editorTextOverlays[selectedTextIndex].text = val;
        renderEditorCanvas();
    }
}

export function commitCanvasInlineText() {
    isDraggingText = false;
    isDrawingOnCanvas = false;

    const input = document.getElementById('canvas-inline-text-input');
    if (input) {
        input.classList.add('hidden');
    }

    if (selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
        const item = editorTextOverlays[selectedTextIndex];
        if (!item.text || item.text.trim() === '' || item.text.trim() === '~') {
            editorTextOverlays.splice(selectedTextIndex, 1);
            selectedTextIndex = -1;
            updateTextControlsUI();
        }
    }
    renderEditorCanvas();
}

export function openImageEditorModal(fileOrImg, targetType = 'customer') {
    if (!fileOrImg) return;
    editorTargetType = targetType;

    if (fileOrImg instanceof HTMLImageElement) {
        editorBaseImage = fileOrImg;
        initCanvasEditor();
        const modal = document.getElementById('image-editor-modal');
        if (modal) {
            modal.classList.remove('hidden');
            toggleBodyScroll(true);
        }
    } else {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                editorBaseImage = img;
                initCanvasEditor();
                const modal = document.getElementById('image-editor-modal');
                if (modal) {
                    modal.classList.remove('hidden');
                    toggleBodyScroll(true);
                }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(fileOrImg);
    }
}

function initCanvasEditor() {
    const canvas = document.getElementById('photo-canvas');
    if (!canvas || !editorBaseImage) return;

    const maxDim = 800;
    let width = editorBaseImage.width;
    let height = editorBaseImage.height;

    if (width > maxDim || height > maxDim) {
        if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
        } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
        }
    }

    canvas.width = width;
    canvas.height = height;

    if (!editorDrawingCanvas) {
        editorDrawingCanvas = document.createElement('canvas');
    }
    editorDrawingCanvas.width = width;
    editorDrawingCanvas.height = height;
    editorDrawingCtx = editorDrawingCanvas.getContext('2d');
    editorDrawingCtx.clearRect(0, 0, width, height);

    editorTextOverlays = [];
    selectedTextIndex = -1;
    isDraggingText = false;
    isDrawingOnCanvas = false;
    updateTextControlsUI();

    const input = document.getElementById('canvas-inline-text-input');
    if (input) input.classList.add('hidden');

    document.getElementById('editor-brightness').value = 100;
    currentBrushIndex = 0;
    setEditorColor('#ef4444');
    updateBrushSizeUI();

    setupCanvasDrawingEvents(canvas);
    renderEditorCanvas();
}

function getTextOverlayAtPosition(canvas, x, y) {
    const ctx = canvas.getContext('2d');
    for (let i = editorTextOverlays.length - 1; i >= 0; i--) {
        const item = editorTextOverlays[i];
        const rot = item.rotation || 0;
        const dx = x - item.x;
        const dy = y - item.y;

        const localX = dx * Math.cos(-rot) - dy * Math.sin(-rot);
        const localY = dx * Math.sin(-rot) + dy * Math.cos(-rot);

        ctx.font = `bold ${item.fontSize}px sans-serif`;
        const metrics = ctx.measureText(item.text || "~");
        const textWidth = Math.max(metrics.width, 30);
        const textHeight = item.fontSize;

        if (localX >= -textWidth / 2 - 25 && localX <= textWidth / 2 + 25 && localY >= -textHeight - 20 && localY <= 25) {
            return i;
        }
    }
    return -1;
}

function setupCanvasDrawingEvents(canvas) {
    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientY ? e.clientX : 0;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY ? e.clientY : 0;
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    };

    const getTouchDistance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const getTouchAngle = (touches) => Math.atan2(touches[1].clientY - touches[0].clientY, touches[1].clientX - touches[0].clientX);

    const stopDraw = () => {
        // If user lifted finger/mouse quickly without moving significantly while a text was selected, trigger SINGLE TAP -> EDIT
        if (isDraggingText && !hasMovedSignificantly && selectedTextIndex !== -1 && (Date.now() - touchDownTime) < 350) {
            activateInlineTextEditor(selectedTextIndex);
        }

        isDrawingOnCanvas = false;
        isDraggingText = false;
        initialPinchDistance = 0;
    };

    window.removeEventListener('mouseup', stopDraw);
    window.removeEventListener('touchend', stopDraw);
    window.removeEventListener('touchcancel', stopDraw);

    window.addEventListener('mouseup', stopDraw);
    window.addEventListener('touchend', stopDraw);
    window.addEventListener('touchcancel', stopDraw);

    const startDraw = (e) => {
        // 2-FINGER PINCH & ROTATION GESTURE
        if (e.touches && e.touches.length === 2) {
            isDrawingOnCanvas = false;
            isDraggingText = false;

            // If no text is selected yet, pick the topmost text item under either touch point
            if (selectedTextIndex === -1 && editorTextOverlays.length > 0) {
                const pos0 = {
                    x: (e.touches[0].clientX - canvas.getBoundingClientRect().left) * (canvas.width / canvas.getBoundingClientRect().width),
                    y: (e.touches[0].clientY - canvas.getBoundingClientRect().top) * (canvas.height / canvas.getBoundingClientRect().height)
                };
                selectedTextIndex = getTextOverlayAtPosition(canvas, pos0.x, pos0.y);
                if (selectedTextIndex === -1) selectedTextIndex = editorTextOverlays.length - 1;
                updateTextControlsUI();
            }

            if (selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
                initialPinchDistance = getTouchDistance(e.touches);
                initialPinchFontSize = editorTextOverlays[selectedTextIndex].fontSize;
                initialPinchAngle = getTouchAngle(e.touches);
                initialTextRotation = editorTextOverlays[selectedTextIndex].rotation || 0;
            }
            return;
        }

        const pos = getPos(e);
        const hitIdx = getTextOverlayAtPosition(canvas, pos.x, pos.y);

        if (hitIdx !== -1) {
            // Commit any active typing session first
            const input = document.getElementById('canvas-inline-text-input');
            if (input && !input.classList.contains('hidden')) {
                commitCanvasInlineText();
            }

            selectedTextIndex = hitIdx;
            updateTextControlsUI();

            isDraggingText = true;
            isDrawingOnCanvas = false;
            touchDownTime = Date.now();
            touchDownPos = { x: pos.x, y: pos.y };
            hasMovedSignificantly = false;

            textDragOffsetX = pos.x - editorTextOverlays[hitIdx].x;
            textDragOffsetY = pos.y - editorTextOverlays[hitIdx].y;
        } else {
            commitCanvasInlineText();
            isDraggingText = false;
            selectedTextIndex = -1;
            updateTextControlsUI();
            isDrawingOnCanvas = true;
            lastCanvasX = pos.x;
            lastCanvasY = pos.y;
        }
        renderEditorCanvas();
    };

    const moveDraw = (e) => {
        // 2-FINGER MULTI-TOUCH SIMULTANEOUS PINCH (SIZE) & ROTATION
        if (e.touches && e.touches.length === 2 && selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
            if (initialPinchDistance > 0) {
                const currentDist = getTouchDistance(e.touches);
                const scale = currentDist / initialPinchDistance;
                
                // Update font size via pinch
                editorTextOverlays[selectedTextIndex].fontSize = Math.max(12, Math.min(160, Math.round(initialPinchFontSize * scale)));
                
                // Update rotation via two-finger angle delta
                const currentAngle = getTouchAngle(e.touches);
                editorTextOverlays[selectedTextIndex].rotation = initialTextRotation + (currentAngle - initialPinchAngle);

                updateTextControlsUI();
                renderEditorCanvas();
            }
            return;
        }

        const pos = getPos(e);

        if (isDraggingText && selectedTextIndex !== -1 && editorTextOverlays[selectedTextIndex]) {
            const moveDist = Math.hypot(pos.x - touchDownPos.x, pos.y - touchDownPos.y);
            if (moveDist > 5) {
                hasMovedSignificantly = true;
            }

            editorTextOverlays[selectedTextIndex].x = pos.x - textDragOffsetX;
            editorTextOverlays[selectedTextIndex].y = pos.y - textDragOffsetY;
            
            const input = document.getElementById('canvas-inline-text-input');
            if (input && !input.classList.contains('hidden')) {
                const rect = canvas.getBoundingClientRect();
                const scaleX = rect.width / canvas.width;
                const scaleY = rect.height / canvas.height;
                input.style.left = `${(pos.x - textDragOffsetX) * scaleX}px`;
                input.style.top = `${(pos.y - textDragOffsetY) * scaleY}px`;
            }

            renderEditorCanvas();
            return;
        }

        if (isDrawingOnCanvas && editorDrawingCtx) {
            editorDrawingCtx.beginPath();
            editorDrawingCtx.strokeStyle = currentEditorColor;
            editorDrawingCtx.lineWidth = BRUSH_PRESETS[currentBrushIndex].lineWidth;
            editorDrawingCtx.lineCap = 'round';
            editorDrawingCtx.lineJoin = 'round';
            editorDrawingCtx.moveTo(lastCanvasX, lastCanvasY);
            editorDrawingCtx.lineTo(pos.x, pos.y);
            editorDrawingCtx.stroke();

            lastCanvasX = pos.x;
            lastCanvasY = pos.y;
            renderEditorCanvas();
        }
    };

    canvas.onmousedown = startDraw;
    canvas.onmousemove = moveDraw;

    canvas.ontouchstart = (e) => { startDraw(e); };
    canvas.ontouchmove = (e) => { moveDraw(e); };
}

export function renderEditorCanvas() {
    const canvas = document.getElementById('photo-canvas');
    if (!canvas || !editorBaseImage) return;
    const ctx = canvas.getContext('2d');
    const brightnessVal = parseInt(document.getElementById('editor-brightness')?.value || '100', 10);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = `brightness(${brightnessVal}%)`;
    ctx.drawImage(editorBaseImage, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';

    if (editorDrawingCanvas) {
        ctx.drawImage(editorDrawingCanvas, 0, 0);
    }

    const input = document.getElementById('canvas-inline-text-input');
    const isInputActive = input && !input.classList.contains('hidden');

    editorTextOverlays.forEach((item, idx) => {
        if (idx === selectedTextIndex && isInputActive) {
            return;
        }

        ctx.save();
        ctx.translate(item.x, item.y);
        ctx.rotate(item.rotation || 0);

        ctx.font = `bold ${item.fontSize}px sans-serif`;
        ctx.fillStyle = item.color;
        ctx.textAlign = 'center';

        const cleanColor = (item.color || "").toLowerCase().trim();
        const isBlackText = cleanColor === '#000000' || cleanColor === 'black' || cleanColor === 'rgb(0,0,0)';
        
        ctx.strokeStyle = isBlackText ? '#ffffff' : '#000000';
        ctx.lineWidth = Math.max(2, Math.round(item.fontSize / 9));
        ctx.lineJoin = 'round';

        const textToDraw = (item.text !== undefined && item.text !== null && item.text !== '') ? item.text : '~';
        ctx.strokeText(textToDraw, 0, 0);
        ctx.fillText(textToDraw, 0, 0);

        if (idx === selectedTextIndex) {
            const metrics = ctx.measureText(textToDraw);
            const textWidth = Math.max(metrics.width, 30);
            const textHeight = item.fontSize;

            ctx.strokeStyle = '#06b6d4';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(-textWidth / 2 - 12, -textHeight - 10, textWidth + 24, textHeight + 20);
            ctx.setLineDash([]);
        }

        ctx.restore();
    });
}

export function clearEditorDrawings() {
    if (editorDrawingCtx && editorDrawingCanvas) {
        editorDrawingCtx.clearRect(0, 0, editorDrawingCanvas.width, editorDrawingCanvas.height);
    }
    editorTextOverlays = [];
    selectedTextIndex = -1;
    isDraggingText = false;
    isDrawingOnCanvas = false;
    const input = document.getElementById('canvas-inline-text-input');
    if (input) input.classList.add('hidden');
    updateTextControlsUI();
    document.getElementById('editor-brightness').value = 100;
    renderEditorCanvas();
    showToast("🧹 Canvas cleared!");
}

export function closeImageEditorModal() {
    commitCanvasInlineText();
    const modal = document.getElementById('image-editor-modal');
    if (modal) {
        modal.classList.add('hidden');
        toggleBodyScroll(false);
    }
    editorBaseImage = null;
    isDraggingText = false;
    isDrawingOnCanvas = false;
    selectedTextIndex = -1;
    updateTextControlsUI();
}

export function exportAndSendEditedImage() {
    commitCanvasInlineText();
    const canvas = document.getElementById('photo-canvas');
    if (!canvas) return;

    selectedTextIndex = -1;
    isDraggingText = false;
    isDrawingOnCanvas = false;
    renderEditorCanvas();

    const dataUrl = canvas.toDataURL('image/jpeg', isHdMode ? 0.85 : 0.45);
    const targetType = editorTargetType || 'customer';
    closeImageEditorModal();

    if (targetType === 'customer') {
        if (window.sendCustomerToRiderChat && typeof window.sendCustomerToRiderChat === 'function') {
            window.sendCustomerToRiderChat("", dataUrl);
        }
    } else if (targetType === 'rider') {
        if (window.sendRiderToCustomerChat && typeof window.sendRiderToCustomerChat === 'function') {
            window.sendRiderToCustomerChat("", dataUrl);
        }
    } else if (targetType === 'team') {
        if (db) {
            db.ref('chat').push({
                sender: appState.riderName || "Lokalex Rider",
                text: "📷 [Shared Image]",
                imageUrl: dataUrl,
                timestamp: Date.now()
            });
        }
    }

    showToast(isHdMode ? "📷 Photo sent in HD!" : "⚡ Compressed photo sent!");
}

// ============================================================================
// BIND ALL FUNCTIONS TO GLOBAL WINDOW OBJECT
// ============================================================================
if (typeof window !== 'undefined') {
    window.cycleBrushSize = cycleBrushSize;
    window.updateBrushSizeUI = updateBrushSizeUI;
    window.setEditorColor = setEditorColor;
    window.updateSelectedTextFontSize = updateSelectedTextFontSize;
    window.updateSelectedTextRotation = updateSelectedTextRotation;
    window.deleteSelectedTextOverlay = deleteSelectedTextOverlay;
    window.openImageEditorModal = openImageEditorModal;
    window.renderEditorCanvas = renderEditorCanvas;
    window.addEditorTextOverlay = addEditorTextOverlay;
    window.activateInlineTextEditor = activateInlineTextEditor;
    window.handleCanvasInlineTextInput = handleCanvasInlineTextInput;
    window.commitCanvasInlineText = commitCanvasInlineText;
    window.clearEditorDrawings = clearEditorDrawings;
    window.closeImageEditorModal = closeImageEditorModal;
    window.exportAndSendEditedImage = exportAndSendEditedImage;
}