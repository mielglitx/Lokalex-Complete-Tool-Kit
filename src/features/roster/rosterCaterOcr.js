// src/features/roster/rosterCaterOcr.js

/**
 * ============================================================================
 * ROSTER CATERING SCREENSHOT OCR ENGINE
 * ============================================================================
 * 
 * Description:
 * High-accuracy multi-script OCR extractor for Messenger chat screenshots:
 * - Multi-language engine loading English, Japanese, and Arabic trained models.
 * - Forces Page Segmentation Mode 6 (PSM 6) for single uniform text block parsing.
 * - Targeted horizontal and vertical crop bounding that isolates the customer name
 *   while excluding status bar icons, the back button, the customer avatar, the
 *   three-dots menu icon, and the ad_id subtitle.
 * - Dominant script isolation: prevents cross-alphabet pollution (e.g. stops the
 *   Arabic model from hallucinating Arabic words like 'فته' from Japanese dots
 *   or menu icons).
 * - Multi-line header accumulator: collects full customer names (First + Last)
 *   while repairing spurious OCR whitespace between Japanese syllables.
 * ============================================================================
 */

import { showToast, showSideNotification } from '../../ui/notifications.js';

const TESSDATA_FAST_CDN = 'https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0_fast';

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

/**
 * Identifies the dominant script family in the extracted text.
 */
function detectDominantScript(text) {
    const jpnMatches = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g) || [];
    const araMatches = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) || [];
    const latMatches = text.match(/[a-zA-Z]/g) || [];

    if (jpnMatches.length > 0 && jpnMatches.length >= araMatches.length) {
        return 'japanese';
    }
    if (araMatches.length > 0 && araMatches.length > jpnMatches.length) {
        return 'arabic';
    }
    return 'latin';
}

/**
 * Extracts the full customer name from raw Messenger OCR text.
 * Enforces dominant script isolation to prevent icon noise from being
 * interpreted as words from a different language.
 */
export function extractFirstNameFromOcrText(rawText) {
    if (!rawText) return "";

    const noiseWords = [
        // English system & subtitle noise
        "assign", "conversation", "see contact", "contact", "active", "now",
        "messenger", "message", "messages", "chat", "direct", "meta", "business",
        "suite", "facebook", "today", "yesterday", "reply", "inbox", "search",
        "unread", "done", "spam", "follow up", "sent by", "transfer", "completed",
        "details", "view", "edit", "call", "video", "profile", "thursday", "friday",
        "saturday", "sunday", "monday", "tuesday", "wednesday", "thu", "fri", "sat",
        "sun", "mon", "tue", "wed", "reply in messenger", "this is a reply", "an ad",
        "ad_id", "ad id", "transfer requested", "how much", "total price", "sent a photo",
        "volte", "kb/s", "mb/s", "tap to fill", "suggested reply",
        
        // Japanese subtitle noise
        "オンライン中", "アクティブ", "メッセージ", "連絡先", "チャット", "検索", "プロフィール", 
        "広告への返信", "詳細を見る", "送金リクエスト", "支払い", "写真",
        
        // Arabic subtitle noise
        "نشط الآن", "رسالة", "بحث", "مكالمة", "عرض التفاصيل", "هذا رد على إعلان", 
        "طلب تحويل", "ملف شخصي", "جهات الاتصال"
    ];

    const lines = rawText
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0);

    const nameParts = [];

    for (const line of lines) {
        const lower = line.toLowerCase();
        
        // Skip status bar clock, network speeds, or battery percentages
        if (/^\d{1,2}:\d{2}/.test(line)) continue;
        if (/\b(?:kb\/s|mb\/s|volte|\d+%\b)/i.test(line)) continue;
        if (/^\d+$/.test(line)) continue;
        if (!/[\p{L}]/u.test(line)) continue;

        // If line contains known subtitle/ad keywords, stop accumulating
        if (noiseWords.some(w => lower.includes(w))) {
            if (nameParts.length > 0) {
                break;
            }
            continue;
        }

        // Clean leading navigation icons/bullets and trailing badge indicators
        let cleaned = line
            .replace(/^[<«‹●•\s\d\-:_|]+/u, '')
            .replace(/\s*\+\d+$/, '')
            .replace(/[^\p{L}\p{N}\sー・'-]/gu, ' ')
            .trim();

        if (cleaned.length < 1) continue;

        nameParts.push(cleaned);

        if (nameParts.length >= 2) break;
    }

    if (nameParts.length === 0) return "";

    const combinedRaw = nameParts.join(' ').trim();
    const dominantScript = detectDominantScript(combinedRaw);

    // 1. JAPANESE SCRIPT MODE
    if (dominantScript === 'japanese') {
        // Discard any tokens containing foreign scripts (e.g., stray Arabic hallucinations)
        const rawTokens = combinedRaw.split(/\s+/).filter(Boolean);
        const validTokens = rawTokens.filter(token => {
            return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\w]/.test(token) &&
                   !/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(token);
        });

        // Reconnect Katakana syllables separated by OCR whitespace
        const mergedWords = [];
        let singleCharBuffer = "";

        for (const token of validTokens) {
            const cleanToken = token.replace(/[^\p{L}\p{N}ー・]/gu, '').trim();
            if (!cleanToken) continue;

            if (cleanToken.length === 1 && /[\u3040-\u309F\u30A0-\u30FF]/.test(cleanToken)) {
                singleCharBuffer += cleanToken;
            } else {
                if (singleCharBuffer) {
                    mergedWords.push(singleCharBuffer);
                    singleCharBuffer = "";
                }
                mergedWords.push(cleanToken);
            }
        }
        if (singleCharBuffer) {
            mergedWords.push(singleCharBuffer);
        }

        return mergedWords.join(' ').trim();
    }

    // 2. ARABIC SCRIPT MODE
    if (dominantScript === 'arabic') {
        const arabicWords = combinedRaw
            .split(/\s+/)
            .map(w => w.replace(/[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/gu, '').trim())
            .filter(Boolean)
            .filter(w => !/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(w));

        return arabicWords.slice(0, 3).join(' ').trim();
    }

    // 3. LATIN & STANDARD INTERNATIONAL ALPHABETS
    const words = combinedRaw
        .split(/\s+/)
        .map(w => w.replace(/[^\p{L}\p{N}'-]/gu, '').trim())
        .filter(Boolean)
        .filter(w => !/[\u0600-\u06FF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(w));

    const formattedWords = words.slice(0, 3).map(w => {
        if (/[a-zA-Z]/.test(w)) {
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        }
        return w;
    });

    return formattedWords.join(' ').trim();
}

export async function handleCaterScreenshotSelected(event, targetInputId = 'catering-customer-name', targetSelectId = 'catering-customer-select', statusElId = 'cater-ocr-status') {
    const file = event.target?.files?.[0];
    if (!file) return;

    const statusEl = document.getElementById(statusElId);
    const nameInput = document.getElementById(targetInputId);
    const selectEl = document.getElementById(targetSelectId);

    if (statusEl) statusEl.classList.remove('hidden');
    showToast("⏳ Sinusuri ang Messenger header (English, Japanese, Arabic)...");

    try {
        await ensureTesseractLoaded();
        if (!window.Tesseract) {
            throw new Error("Tesseract OCR engine unavailable.");
        }

        const img = await fileToImage(file);

        const isMobilePortrait = img.height > img.width * 1.3;
        let startY, cropH, startX, cropW;

        if (isMobilePortrait) {
            // Precise header name bounding box:
            // startX = 0.20: Skips back arrow (<) and profile avatar
            // cropW  = 0.64: Safely terminates before the 3-dots menu icon on the right
            // startY = 0.046: Starts below the status bar icons
            // cropH  = 0.044: Bounded to the title line; stops before ad_id subtitle
            startY = Math.round(img.height * 0.046);
            cropH = Math.round(img.height * 0.044);
            startX = Math.round(img.width * 0.20);
            cropW = Math.round(img.width * 0.64);
        } else {
            startY = 0;
            cropH = Math.round(img.height * 0.12);
            startX = Math.round(img.width * 0.12);
            cropW = Math.round(img.width * 0.72);
        }

        const upscale = 2.5;
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

        // Theme brightness evaluation
        let darkPixelCount = 0;
        const totalPixels = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
            const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            if (gray < 128) darkPixelCount++;
        }
        const isDarkTheme = darkPixelCount > totalPixels * 0.5;

        // Diacritic-preserving contrast stretch: keeps Katakana dakuten and Arabic dots intact
        for (let i = 0; i < d.length; i += 4) {
            let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            if (isDarkTheme) {
                gray = 255 - gray;
            }
            const contrast = Math.min(255, Math.max(0, (gray - 30) * (255 / 195)));
            d[i] = contrast;
            d[i + 1] = contrast;
            d[i + 2] = contrast;
        }
        ctx.putImageData(imgData, 0, 0);

        let rawText = "";

        // Multi-language OCR execution with PSM 6 (single uniform text block)
        let worker = null;
        try {
            if (typeof window.Tesseract.createWorker === 'function') {
                worker = await window.Tesseract.createWorker(['eng', 'jpn', 'ara'], 1, {
                    langPath: TESSDATA_FAST_CDN,
                    logger: () => {}
                });
                await worker.setParameters({
                    tessedit_pageseg_mode: '6'
                });
                const ret = await worker.recognize(roiCanvas);
                rawText = ret?.data?.text || "";
            } else {
                const ret = await window.Tesseract.recognize(roiCanvas, 'eng+jpn+ara', {
                    langPath: TESSDATA_FAST_CDN,
                    logger: () => {}
                });
                rawText = ret?.data?.text || "";
            }
        } catch (workerErr) {
            console.warn("Primary PSM 6 multi-lang worker failed, using fallback recognize:", workerErr);
            const ret = await window.Tesseract.recognize(roiCanvas, 'eng+jpn+ara', {
                langPath: TESSDATA_FAST_CDN,
                logger: () => {}
            });
            rawText = ret?.data?.text || "";
        } finally {
            if (worker) {
                await worker.terminate().catch(() => {});
            }
        }

        const detectedName = extractFirstNameFromOcrText(rawText);

        if (detectedName) {
            if (nameInput) {
                nameInput.value = detectedName;
                nameInput.focus();
            }

            if (selectEl && selectEl.options) {
                const cleanDetected = detectedName.toLowerCase().trim();
                for (let i = 0; i < selectEl.options.length; i++) {
                    const optVal = (selectEl.options[i].value || "").toLowerCase().trim();
                    if (optVal && (optVal.includes(cleanDetected) || cleanDetected.includes(optVal))) {
                        selectEl.selectedIndex = i;
                        break;
                    }
                }
            }

            showToast(`✅ Customer detected: ${detectedName}`);
            showSideNotification("NAME DETECTED", `Customer: ${detectedName}`, "fa-user-check", "text-emerald-400", "border-emerald-500");
        } else {
            showToast("⚠️ Hindi matukoy ang buong pangalan. Paki-type nang manual.");
        }
    } catch (err) {
        console.error("Catering screenshot OCR failed:", err);
        showToast("❌ Bigo ang OCR scan. Paki-type nang manual.");
    } finally {
        if (statusEl) statusEl.classList.add('hidden');
        event.target.value = '';
    }
}