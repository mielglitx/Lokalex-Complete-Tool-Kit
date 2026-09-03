// src/features/roster/rosterCaterOcr.js
import { showToast, showSideNotification } from '../../ui/notifications.js';

export function ensureTesseractLoaded() {
    return new Promise((resolve) => {
        if (window.Tesseract) return resolve(true);

        const existingScript = document.querySelector('script[src*="tesseract"]');
        if (existingScript) {
            existingScript.addEventListener('load', () => resolve(true));
            setTimeout(() => resolve(!!window.Tesseract), 2500);
            return;
        }

        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
    });
}

export function fileToImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = (err) => reject(err);
            img.src = e.target.result;
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

export function extractFirstNameFromOcrText(rawText) {
    if (!rawText) return "";

    const noiseWords = [
        "assign", "conversation", "see contact", "contact", "active", "now",
        "messenger", "message", "messages", "chat", "direct", "meta", "business",
        "suite", "facebook", "today", "yesterday", "reply", "inbox", "search",
        "unread", "done", "spam", "follow up", "sent by", "transfer", "completed",
        "details", "view", "edit", "call", "video", "profile", "thursday", "friday",
        "saturday", "sunday", "monday", "tuesday", "wednesday", "thu", "fri", "sat",
        "sun", "mon", "tue", "wed", "reply in messenger", "this is a reply", "an ad"
    ];

    const lines = rawText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0);

    for (const line of lines) {
        const lower = line.toLowerCase();
        
        if (noiseWords.some(w => lower.includes(w))) continue;
        if (!/[a-zA-Z]/.test(line)) continue;
        if (/^\d{1,2}:\d{2}/.test(line)) continue;
        if (/^\d+$/.test(line)) continue;

        const cleanedLine = line.replace(/^[^a-zA-Z0-9]+/, '').trim();
        if (cleanedLine.length < 2) continue;

        const words = cleanedLine
            .split(/\s+/)
            .map(w => w.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, ''))
            .filter(Boolean);

        if (words.length > 0) {
            let chosenWord = "";

            if (words.length >= 2 && words[0].length <= 2 && words[1].length >= 3) {
                chosenWord = words[1];
            } else if (words.length >= 3 && words[0].length <= 2) {
                chosenWord = words[1];
            } else {
                chosenWord = words[0];
            }

            if (chosenWord && chosenWord.length >= 2) {
                return chosenWord.charAt(0).toUpperCase() + chosenWord.slice(1).toLowerCase();
            }
        }
    }

    return "";
}

export async function handleCaterScreenshotSelected(event, targetInputId = 'catering-customer-name', targetSelectId = 'catering-customer-select', statusElId = 'cater-ocr-status') {
    const file = event.target?.files?.[0];
    if (!file) return;

    const statusEl = document.getElementById(statusElId);
    const nameInput = document.getElementById(targetInputId);
    const selectEl = document.getElementById(targetSelectId);

    if (statusEl) statusEl.classList.remove('hidden');
    showToast("⏳ Sinusuri ang Messenger header para sa pangalan...");

    try {
        await ensureTesseractLoaded();
        if (!window.Tesseract) {
            throw new Error("Tesseract OCR engine unavailable.");
        }

        const img = await fileToImage(file);

        const isMobilePortrait = img.height > img.width * 1.3;
        let startY, cropH, startX, cropW;

        if (isMobilePortrait) {
            startY = Math.round(img.height * 0.052);
            cropH = Math.round(img.height * 0.063);
            startX = Math.round(img.width * 0.24);
            cropW = Math.round(img.width * 0.60);
        } else {
            startY = 0;
            cropH = Math.round(img.height * 0.12);
            startX = Math.round(img.width * 0.08);
            cropW = Math.round(img.width * 0.80);
        }

        const upscale = 2;
        const roiCanvas = document.createElement('canvas');
        roiCanvas.width = Math.round(cropW * upscale);
        roiCanvas.height = Math.round(cropH * upscale);
        
        const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, roiCanvas.width, roiCanvas.height);
        ctx.drawImage(img, startX, startY, cropW, cropH, 0, 0, roiCanvas.width, roiCanvas.height);

        const imgData = ctx.getImageData(0, 0, roiCanvas.width, roiCanvas.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
            const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const val = gray < 110 ? 0 : 255;
            d[i] = val;
            d[i + 1] = val;
            d[i + 2] = val;
        }
        ctx.putImageData(imgData, 0, 0);

        let rawText = "";
        if (window.Tesseract && typeof window.Tesseract.recognize === 'function') {
            const ret = await window.Tesseract.recognize(roiCanvas, 'eng', {
                logger: () => {}
            });
            rawText = ret?.data?.text || "";
        } else if (window.Tesseract && typeof window.Tesseract.createWorker === 'function') {
            const worker = await window.Tesseract.createWorker('eng');
            const ret = await worker.recognize(roiCanvas);
            await worker.terminate();
            rawText = ret?.data?.text || "";
        }

        const detectedName = extractFirstNameFromOcrText(rawText);

        if (detectedName) {
            if (nameInput) {
                nameInput.value = detectedName;
                nameInput.focus();
            }

            if (selectEl && selectEl.options) {
                for (let i = 0; i < selectEl.options.length; i++) {
                    const optVal = (selectEl.options[i].value || "").toLowerCase();
                    if (optVal && (optVal.includes(detectedName.toLowerCase()) || detectedName.toLowerCase().includes(optVal))) {
                        selectEl.selectedIndex = i;
                        break;
                    }
                }
            }

            showToast(`✅ Customer detected: ${detectedName}`);
            showSideNotification("NAME DETECTED", `Customer: ${detectedName}`, "fa-user-check", "text-emerald-400", "border-emerald-500");
        } else {
            showToast("⚠️ Hindi matukoy ang pangalan. Paki-type nang manual.");
        }
    } catch (err) {
        console.error("Catering screenshot OCR failed:", err);
        showToast("❌ Bigo ang OCR scan. Paki-type nang manual.");
    } finally {
        if (statusEl) statusEl.classList.add('hidden');
        event.target.value = '';
    }
}