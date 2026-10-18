// src/utils/imageSaver.js
import { showToast } from '../ui/notifications.js';

export function dataUrlToBlob(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        return null;
    }
    try {
        const parts = dataUrl.split(',');
        const mimeMatch = parts[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    } catch (e) {
        return null;
    }
}

export function blobToDataUrl(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result || "");
        reader.onerror = () => resolve("");
        reader.readAsDataURL(blob);
    });
}

/**
 * Downloads or saves an image directly to the device Gallery/Photos or local storage.
 * Supports:
 * 1. Native Android Capacitor App (via NativePermissionsBridge -> MediaStore Pictures/Gallery)
 * 2. Mobile Web Share API (Save to Photos / Gallery)
 * 3. Desktop / Browser anchor download
 */
export async function saveImageToDevice(imageSrc, filename = 'lokalex_image.png', showNativeToast = true) {
    if (!imageSrc) {
        if (showNativeToast) showToast("⚠️ Walang litrato na mase-save.");
        return false;
    }

    try {
        let dataUrl = imageSrc;
        let blob = null;

        if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
            try {
                const resp = await fetch(imageSrc, { mode: 'cors' });
                blob = await resp.blob();
                dataUrl = await blobToDataUrl(blob);
            } catch (fetchErr) {
                console.warn("[ImageSaver] CORS fetch failed, trying via image element canvas:", fetchErr);
                dataUrl = await new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "anonymous";
                    img.onload = () => {
                        try {
                            const canvas = document.createElement('canvas');
                            canvas.width = img.naturalWidth || img.width;
                            canvas.height = img.naturalHeight || img.height;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0);
                            resolve(canvas.toDataURL('image/png'));
                        } catch (_) {
                            resolve(imageSrc);
                        }
                    };
                    img.onerror = () => resolve(imageSrc);
                    img.src = imageSrc;
                });
                if (dataUrl && dataUrl.startsWith('data:')) {
                    blob = dataUrlToBlob(dataUrl);
                }
            }
        } else if (imageSrc.startsWith('data:')) {
            blob = dataUrlToBlob(imageSrc);
        }

        // 1. Native Android Bridge (Direct to Gallery / Pictures with auto-overwrite)
        if (window.NativePermissionsBridge && typeof window.NativePermissionsBridge.saveImageToDevice === 'function') {
            const ok = window.NativePermissionsBridge.saveImageToDevice(dataUrl, filename, showNativeToast);
            if (ok) {
                if (showNativeToast) showToast("💾 Litrato na-save sa Gallery / Pictures!");
                return true;
            }
        }

        // 2. Web Share API (Mobile browsers where user can tap 'Save Image' / 'Photos')
        if (navigator.canShare && blob && showNativeToast) {
            try {
                const file = new File([blob], filename, { type: blob.type || 'image/png' });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Save Image',
                        text: filename
                    });
                    showToast("✅ Litrato naibahagi / nai-save!");
                    return true;
                }
            } catch (shareErr) {
                if (shareErr.name === 'AbortError') return false;
                console.warn("[ImageSaver] Web Share cancelled or failed:", shareErr);
            }
        }

        // 3. Direct Anchor Download (Desktop browsers)
        const downloadUrl = blob ? URL.createObjectURL(blob) : dataUrl;
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        if (blob) setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000);
        if (showNativeToast) showToast("💾 Na-download ang litrato!");
        return true;
    } catch (err) {
        console.error("[ImageSaver] Error saving image:", err);
        if (showNativeToast) showToast("⚠️ Hindi mai-save ang litrato. Subukang i-screenshot.");
        return false;
    }
}

if (typeof window !== 'undefined') {
    window.saveImageToDevice = saveImageToDevice;
}

