// src/utils/videoUpload.js

/**
 * ============================================================================
 * VIDEO STORAGE UPLOADER & THUMBNAIL PROCESSOR
 * ============================================================================
 * 
 * Handles binary video uploads to Firebase Storage or HTTPS fallback CDN,
 * and extracts first-frame poster thumbnails + duration metadata from video files.
 */

import { storage } from '../config/firebase.js';

let isStorageAvailable = true;

/**
 * Formats a duration in seconds into mm:ss format (e.g. 1:04, 0:15).
 */
export function formatVideoDuration(seconds) {
    if (!seconds || isNaN(seconds) || seconds <= 0) return "0:00";
    const totalSec = Math.round(seconds);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Formats file size in bytes to a human-readable string (KB or MB).
 */
export function formatFileSize(bytes) {
    if (!bytes || isNaN(bytes) || bytes <= 0) return "0 KB";
    if (bytes >= 1048576) {
        return (bytes / 1048576).toFixed(1) + ' MB';
    }
    return Math.round(bytes / 1024) + ' KB';
}

/**
 * Generates a video poster thumbnail (Base64 DataURL) and duration metadata.
 * Uses an offscreen HTML5 video element and canvas capture.
 */
export function generateVideoThumbnail(fileOrBlob) {
    return new Promise((resolve) => {
        if (!fileOrBlob) {
            return resolve({ thumbnail: null, duration: 0, width: 0, height: 0 });
        }

        try {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            video.setAttribute('webkit-playsinline', 'webkit-playsinline');

            const blobUrl = URL.createObjectURL(fileOrBlob);
            video.src = blobUrl;

            // Timeout safety in case video format cannot be decoded by browser
            const safetyTimeout = setTimeout(() => {
                try { URL.revokeObjectURL(blobUrl); } catch (_) {}
                resolve({ thumbnail: null, duration: video.duration || 0, width: 0, height: 0 });
            }, 4000);

            video.onloadeddata = () => {
                // Seek to 0.5s or 15% into the video to avoid a blank black opening frame
                const targetTime = Math.min(0.5, (video.duration || 1) * 0.15);
                video.currentTime = targetTime;
            };

            video.onseeked = () => {
                clearTimeout(safetyTimeout);
                try {
                    const canvas = document.createElement('canvas');
                    const origW = video.videoWidth || 480;
                    const origH = video.videoHeight || 360;
                    const maxDim = 480;
                    let targetW = origW;
                    let targetH = origH;

                    if (origW > maxDim || origH > maxDim) {
                        if (origW > origH) {
                            targetW = maxDim;
                            targetH = Math.round((origH * maxDim) / origW);
                        } else {
                            targetH = maxDim;
                            targetW = Math.round((origW * maxDim) / origH);
                        }
                    }

                    canvas.width = targetW;
                    canvas.height = targetH;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(video, 0, 0, targetW, targetH);
                    const thumbnail = canvas.toDataURL('image/jpeg', 0.65);

                    try { URL.revokeObjectURL(blobUrl); } catch (_) {}
                    resolve({
                        thumbnail: thumbnail,
                        duration: video.duration || 0,
                        width: origW,
                        height: origH
                    });
                } catch (err) {
                    try { URL.revokeObjectURL(blobUrl); } catch (_) {}
                    resolve({ thumbnail: null, duration: video.duration || 0, width: 0, height: 0 });
                }
            };

            video.onerror = () => {
                clearTimeout(safetyTimeout);
                try { URL.revokeObjectURL(blobUrl); } catch (_) {}
                resolve({ thumbnail: null, duration: 0, width: 0, height: 0 });
            };
        } catch (e) {
            resolve({ thumbnail: null, duration: 0, width: 0, height: 0 });
        }
    });
}

/**
 * Uploads a video file or blob to Firebase Storage or Public Fallback CDN.
 * 
 * @param {File|Blob} fileOrBlob 
 * @param {string} storagePath 
 * @param {Function} [onProgress] - Optional callback receiving percent complete (0-100)
 * @returns {Promise<string>} Download URL
 */
export async function uploadVideo(fileOrBlob, storagePath, onProgress = null) {
    if (!fileOrBlob) return "";

    const mimeType = fileOrBlob.type || 'video/mp4';

    // 1. Try Firebase Storage
    if (isStorageAvailable && storage) {
        try {
            const cleanPath = (storagePath || `chat_videos/${Date.now()}_video.mp4`).replace(/^\/+/, '');
            const storageRef = storage.ref(cleanPath);

            const uploadTask = storageRef.put(fileOrBlob, {
                contentType: mimeType,
                cacheControl: 'public,max-age=2592000,immutable' // Cache for 30 days
            });

            if (typeof onProgress === 'function') {
                uploadTask.on('state_changed', (snapshot) => {
                    const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                    onProgress(progress);
                });
            }

            // 2.5-second timeout for video storage: if bucket is 404 or disabled, immediately switch to CDN
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Video storage upload timeout')), 2500)
            );

            await Promise.race([uploadTask, timeoutPromise]);
            const downloadUrl = await uploadTask.snapshot.ref.getDownloadURL();
            return downloadUrl;
        } catch (err) {
            console.warn('[VideoUpload] Firebase Storage upload failed/timed out, attempting public CDN fallback:', err);
            isStorageAvailable = false;
        }
    }

    // 2. High-speed Public HTTPS CDN Fallback (Litterbox Catbox supports videos with progress tracking)
    try {
        const cdnUrl = await new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('reqtype', 'fileupload');
            formData.append('time', '72h');
            const filename = (fileOrBlob instanceof File && fileOrBlob.name) ? fileOrBlob.name : 'video.mp4';
            formData.append('fileToUpload', fileOrBlob, filename);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', 'https://litterbox.catbox.moe/resources/internals/api.php', true);

            if (typeof onProgress === 'function') {
                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
                        onProgress(percent);
                    }
                };
            }

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    const url = xhr.responseText.trim();
                    if (url.startsWith('https://') || url.startsWith('http://')) {
                        if (typeof onProgress === 'function') onProgress(100);
                        resolve(url);
                    } else {
                        reject(new Error(url || 'Invalid response from video host'));
                    }
                } else {
                    reject(new Error(`Video upload failed with status ${xhr.status}`));
                }
            };

            xhr.onerror = () => reject(new Error('Network error during video upload'));
            xhr.ontimeout = () => reject(new Error('Video upload timed out'));
            xhr.timeout = 60000;
            xhr.send(formData);
        });

        if (cdnUrl) {
            return cdnUrl;
        }
    } catch (e) {
        console.warn('[VideoUpload] Public CDN fallback upload failed:', e);
    }

    // 3. Last-resort fallback for tiny clips: Convert to Base64 Data URL if under 4MB
    if (fileOrBlob.size && fileOrBlob.size <= 4194304) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result || "");
            reader.onerror = () => resolve("");
            reader.readAsDataURL(fileOrBlob);
        });
    }

    throw new Error("Unable to upload video. Please check your internet connection.");
}

