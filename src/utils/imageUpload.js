// src/utils/imageUpload.js

/**
 * ============================================================================
 * FIREBASE STORAGE BINARY UPLOADER & IMAGE OPTIMIZER
 * ============================================================================
 * 
 * Description:
 * Replaces high-bandwidth Base64 strings stored directly in Realtime Database
 * with lightweight HTTPS download URLs hosted on Firebase Storage.
 * 
 * Features:
 * - Automatically uploads Files, Blobs, and data:image Base64 strings to Storage.
 * - Sets long-lived HTTP Cache-Control headers (30 days) so client devices cache
 *   photos locally, consuming 0 Firebase bandwidth on repeat views.
 * - Returns a clean ~80-byte HTTPS download URL instead of an 800 KB base64 payload.
 * - Graceful fallback with high-efficiency canvas compression if Storage is unreachable.
 * ============================================================================
 */

import { storage } from '../config/firebase.js';
import { getSupabase } from '../config/supabaseClient.js';

/**
 * Converts a data URL to a binary Blob.
 */
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
        console.warn('[ImageUpload] Failed to convert dataUrl to Blob:', e);
        return null;
    }
}

let isStorageAvailable = true;

/**
 * Downsamples and compresses an image (File, Blob, or DataURL) via an offscreen canvas
 * ensuring the resulting JPEG payload never exceeds mobile data budgets (~35KB-50KB).
 */
export async function compressImageToDataUrl(fileOrBlobOrDataUrl, maxDim = 720, quality = 0.45) {
    if (!fileOrBlobOrDataUrl || typeof window === 'undefined') return fileOrBlobOrDataUrl;

    if (typeof fileOrBlobOrDataUrl === 'string' && (fileOrBlobOrDataUrl.startsWith('http://') || fileOrBlobOrDataUrl.startsWith('https://'))) {
        return fileOrBlobOrDataUrl;
    }

    return new Promise((resolve) => {
        let rawDataUrl = null;
        if (typeof fileOrBlobOrDataUrl === 'string' && fileOrBlobOrDataUrl.startsWith('data:')) {
            rawDataUrl = fileOrBlobOrDataUrl;
            processImage(rawDataUrl);
        } else {
            const reader = new FileReader();
            reader.onload = (e) => processImage(e.target.result);
            reader.onerror = () => resolve("");
            reader.readAsDataURL(fileOrBlobOrDataUrl);
        }

        function processImage(src) {
            if (!src) return resolve("");
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                const isTallDocument = (height / width) >= 1.6;

                if (isTallDocument) {
                    // For tall documents/receipts, never crush width below 900px
                    const targetWidth = Math.min(Math.max(width, 920), 1200);
                    if (width > targetWidth) {
                        height = Math.round((height * targetWidth) / width);
                        width = targetWidth;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    return resolve(canvas.toDataURL('image/jpeg', Math.max(quality, 0.90)));
                }

                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => resolve(src);
            img.src = src;
        }
    });
}

/**
 * Uploads an image (File, Blob, or base64 DataURL) to Firebase Storage
 * and returns the public HTTPS download URL.
 * 
 * @param {File|Blob|string} fileOrBlobOrDataUrl 
 * @param {string} storagePath - Destination path in bucket (e.g. 'chat/img_123.jpg')
 * @param {Object} metadata - Optional custom metadata
 * @param {Object} options - Optional upload options (e.g. { isReceipt: true })
 * @returns {Promise<string>} Download URL (or fallback data URL if storage is unavailable)
 */
export async function uploadImage(fileOrBlobOrDataUrl, storagePath, metadata = {}, options = {}) {
    if (!fileOrBlobOrDataUrl) return "";

    // If it's already an HTTP / HTTPS URL, no need to upload
    if (typeof fileOrBlobOrDataUrl === 'string' && (fileOrBlobOrDataUrl.startsWith('http://') || fileOrBlobOrDataUrl.startsWith('https://'))) {
        return fileOrBlobOrDataUrl;
    }

    const isReceipt = options?.isReceipt === true || 
                      (metadata && metadata.isReceipt === true) ||
                      (typeof storagePath === 'string' && storagePath.toLowerCase().includes('receipt'));

    // SPECIAL HANDLING FOR OFFICIAL RECEIPTS & TRANSACTION INVOICES:
    // If it's an official receipt and already rendered to a base64 data URL,
    // preserve the crisp high-resolution image without downscaling when storage is null/unavailable.
    if (isReceipt && typeof fileOrBlobOrDataUrl === 'string' && fileOrBlobOrDataUrl.startsWith('data:image')) {
        if (!storage || !isStorageAvailable) {
            return fileOrBlobOrDataUrl;
        }
    }

    let blob = fileOrBlobOrDataUrl;
    if (typeof fileOrBlobOrDataUrl === 'string' && fileOrBlobOrDataUrl.startsWith('data:')) {
        blob = dataUrlToBlob(fileOrBlobOrDataUrl);
    }

    // 1. Primary: Direct Supabase Cloud Storage Upload
    const supabase = getSupabase();
    if (supabase && supabase.storage && blob) {
        try {
            const cleanPath = (storagePath || `uploads/${Date.now()}_${Math.random().toString(36).substring(2, 6)}.jpg`).replace(/^\/+/, '');
            const bucket = cleanPath.startsWith('menus/') ? 'store-menus' 
                         : (cleanPath.startsWith('avatars/') ? 'avatars' : 'chat-media');
            const subPath = cleanPath.replace(/^(menus|avatars|chat-media|chats)\//, '');

            const { data: upData, error: upErr } = await supabase.storage.from(bucket).upload(subPath, blob, {
                cacheControl: '2592000',
                upsert: true,
                contentType: blob.type || 'image/jpeg'
            });

            if (!upErr && upData) {
                const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(subPath);
                if (urlData && urlData.publicUrl) {
                    return urlData.publicUrl;
                }
            }
        } catch (sbErr) {
            console.warn('[ImageUpload] Supabase Storage upload skipped/failed:', sbErr?.message || sbErr);
        }
    }

    // 2. Secondary: Firebase Storage Legacy Fallback
    if (isStorageAvailable && storage && blob) {
        try {
            const cleanPath = (storagePath || `uploads/${Date.now()}_${Math.random().toString(36).substring(2, 6)}.jpg`).replace(/^\/+/, '');
            const storageRef = storage.ref(cleanPath);
            const uploadPromise = storageRef.put(blob, {
                contentType: blob.type || 'image/jpeg',
                cacheControl: 'public,max-age=2592000,immutable', // Cache for 30 days
                customMetadata: metadata
            });
            // 2.5s timeout prevents Firebase Storage hanging indefinitely when bucket is 404/disabled
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Storage upload timeout (bucket unavailable)')), 2500)
            );
            const uploadTask = await Promise.race([uploadPromise, timeoutPromise]);
            const downloadUrl = await uploadTask.ref.getDownloadURL();
            return downloadUrl;
        } catch (err) {
            console.warn('[ImageUpload] Firebase Storage upload failed/timed out, falling back to base64:', err.message || err);
            isStorageAvailable = false;
        }
    }

    // Receipts are already rendered with optimal typography and QR modules: preserve them directly
    if (isReceipt && typeof fileOrBlobOrDataUrl === 'string') {
        return fileOrBlobOrDataUrl;
    }

    // Fallback: Return a lightweight compressed base64 JPEG (<45KB)
    // Ensures heavy 5MB photos never congest Supabase or waste mobile data
    try {
        const isHd = (typeof localStorage !== 'undefined') && localStorage.getItem('lokalex_hd_mode') === 'true';
        const maxDim = isHd ? 1080 : 720;
        const quality = isHd ? 0.70 : 0.45;
        const compressed = await compressImageToDataUrl(fileOrBlobOrDataUrl, maxDim, quality);
        if (compressed) return compressed;
    } catch (compErr) {
        console.warn('[ImageUpload] Compression error, fallback to raw reader:', compErr);
    }

    if (typeof fileOrBlobOrDataUrl === 'string') {
        return fileOrBlobOrDataUrl;
    }

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result || "");
        reader.onerror = () => resolve("");
        reader.readAsDataURL(blob);
    });
}

