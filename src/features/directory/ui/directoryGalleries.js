// src/features/directory/ui/directoryGalleries.js
import { db, storage } from '../../../config/firebase.js';
import { appState, globalState } from '../../../store/state.js';
import { showToast, showSideNotification } from '../../../ui/notifications.js';
import { escapeHtml } from '../../../utils/helpers.js';
import { idbGet, idbSet } from '../../../utils/storageEngine.js';
import { checkAdminAccess } from '../directoryPermissions.js';
import { uploadImage } from '../../../utils/imageUpload.js';
import { saveImageToDevice } from '../../../utils/imageSaver.js';
import { sendDirectMenuPhotoToCustomer } from '../../chat/riderChat.js';
import { renderDirectoryList } from './directoryListRender.js';

let activeGalleryStore = null;
let currentGalleryPages = [];
let selectedMenuPageIndices = new Set();
let menuRecipientPickerPendingPages = null;

let activeCameraStream = null;
let activeCameraFacingMode = 'environment';
let isTorchOn = false;
let capturedSnapshotBlob = null;

// Synchronously hydrate menu metadata immediately at module load time to guarantee 0ms instant display
export let storeMenuMetadataMap = (() => {
    try {
        return JSON.parse(localStorage.getItem('lokalex_store_menus_meta_cache') || '{}');
    } catch (e) {
        return {};
    }
})();
let isStoreMenuMetadataListenerActive = false;

export function getStoreMenuMetadataMap() {
    return storeMenuMetadataMap;
}

export function initStoreMenuGalleriesListener() {
    if (!db || isStoreMenuMetadataListenerActive) return;
    isStoreMenuMetadataListenerActive = true;

    try {
        const cached = localStorage.getItem('lokalex_store_menus_meta_cache');
        if (cached) {
            storeMenuMetadataMap = JSON.parse(cached) || {};
        }
    } catch (e) {}

    db.ref('directory/storeMenuMeta').on('value', (snap) => {
        let val = snap.val();
        if (!val || Object.keys(val).length === 0) {
            // One-time fallback migration: seed directory/storeMenuMeta from galleries once
            db.ref('directory/storeMenuGalleries').once('value').then(gSnap => {
                const gVal = gSnap.val() || {};
                const metaBatch = {};
                Object.entries(gVal).forEach(([k, d]) => {
                    if (d) {
                        const pages = d.pages ? Object.values(d.pages) : [];
                        metaBatch[`directory/storeMenuMeta/${k}`] = {
                            pageCount: pages.length,
                            updatedAt: d.updatedAt || 0,
                            storeName: d.storeName || ""
                        };
                    }
                });
                if (Object.keys(metaBatch).length > 0) {
                    db.ref().update(metaBatch).catch(() => {});
                }
            }).catch(() => {});
            return;
        }

        const newMap = {};
        Object.entries(val).forEach(([key, data]) => {
            if (data) {
                const storeMeta = {
                    pageCount: data.pageCount || 0,
                    updatedAt: data.updatedAt || 0,
                    storeName: data.storeName || ""
                };
                newMap[key] = storeMeta;

                // Also index by normalized storeName to guarantee instant matches
                if (data.storeName) {
                    const cleanNameKey = data.storeName.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (cleanNameKey) newMap[cleanNameKey] = storeMeta;
                }
            }
        });

        storeMenuMetadataMap = newMap;

        try {
            localStorage.setItem('lokalex_store_menus_meta_cache', JSON.stringify(newMap));
        } catch (e) {}

        const viewDir = document.getElementById('view-directory');
        if (globalState.currentType === 'stores' && viewDir && !viewDir.classList.contains('hidden')) {
            renderDirectoryList();
        }
    });
}

export function formatMenuUpdatedAt(timestamp) {
    if (!timestamp) return "";
    try {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return "";
        return date.toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    } catch (e) {
        return "";
    }
}

function getOrCreateMenuGalleryModal() {
    let modal = document.getElementById('store-menu-gallery-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'store-menu-gallery-modal';
        modal.className = 'fixed inset-0 z-[100001] flex items-center justify-center bg-black/85 backdrop-blur-md p-2.5 sm:p-5 hidden';
        modal.style.zIndex = '100001';
        modal.innerHTML = `
        <div class="bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-800 rounded-3xl max-w-2xl w-full max-h-[92vh] shadow-2xl flex flex-col overflow-hidden animate-scaleUp">
            <!-- Header -->
            <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800/80 bg-gray-50/60 dark:bg-black/20">
                <div class="flex items-center gap-2 min-w-0 flex-1 pr-2">
                    <div class="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                        <i class="fa-solid fa-book-open text-sm"></i>
                    </div>
                    <div class="min-w-0 flex-1">
                        <h3 id="gallery-store-title" class="font-black text-xs sm:text-sm text-gray-900 dark:text-white truncate">Store Menu</h3>
                        <p id="gallery-store-subtitle" class="text-[9px] sm:text-[10px] text-gray-500 dark:text-gray-400 truncate">Rider-contributed physical restaurant menu</p>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button type="button" id="btn-send-all-menu" onclick="window.sendAllMenuPagesToCustomer && window.sendAllMenuPagesToCustomer()" class="hidden bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] px-2.5 py-1.5 rounded-xl transition active:scale-95 shadow-xs flex items-center gap-1.5 cursor-pointer" title="Send all menu pages to customer">
                        <i class="fa-solid fa-paper-plane"></i> <span class="hidden sm:inline">Send All</span>
                    </button>
                    <button type="button" id="btn-download-all-menu" onclick="window.downloadCompleteMenuToPhone && window.downloadCompleteMenuToPhone()" class="hidden bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] px-2.5 py-1.5 rounded-xl transition active:scale-95 shadow-xs flex items-center gap-1.5 cursor-pointer" title="Save all menu pages one by one (auto overwrite)">
                        <i class="fa-solid fa-cloud-arrow-down"></i> <span class="hidden sm:inline">Save All</span>
                    </button>
                    <button type="button" onclick="window.closeStoreMenuGalleryModal && window.closeStoreMenuGalleryModal()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 text-base cursor-pointer">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>

            <!-- Compact Upload Bar -->
            <div class="px-4 py-2.5 bg-amber-50/60 dark:bg-amber-950/20 border-b border-amber-200/50 dark:border-amber-500/20 flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-1.5 text-[10px] text-amber-900 dark:text-amber-300 font-bold">
                    <i class="fa-solid fa-camera text-amber-600 dark:text-amber-400"></i>
                    <span>Got updated photos?</span>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" onclick="window.openMenuCameraScanner && window.openMenuCameraScanner()" class="bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-black px-2.5 py-1.5 rounded-xl cursor-pointer transition active:scale-95 shadow-xs flex items-center gap-1.5">
                        <i class="fa-solid fa-camera text-[10px]"></i> Take Photo
                    </button>
                    <label class="bg-white hover:bg-gray-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-800 dark:text-gray-200 text-[11px] font-bold px-2.5 py-1.5 rounded-xl cursor-pointer transition active:scale-95 shadow-xs flex items-center gap-1.5 border border-gray-200 dark:border-zinc-700">
                        <i class="fa-solid fa-images text-[10px] text-gray-500 dark:text-gray-400"></i> Gallery
                        <input type="file" id="gallery-upload-input" accept="image/*" multiple class="hidden" onchange="window.handleMenuPhotoUpload && window.handleMenuPhotoUpload(event)">
                    </label>
                    <input type="file" id="gallery-camera-fallback-input" accept="image/*" capture="environment" class="hidden" onchange="window.handleMenuPhotoUpload && window.handleMenuPhotoUpload(event)">
                </div>
            </div>

            <!-- Body: Compact 2-Column Mobile Grid -->
            <div id="gallery-images-container" class="flex-1 overflow-y-auto p-2.5 sm:p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                <div class="col-span-full text-center text-gray-500 italic py-16 text-xs">Loading menu photos...</div>
            </div>

            <!-- Sticky Multi-Selection Action Bar (Shown when 1 or more pages checked) -->
            <div id="gallery-selection-bar" class="hidden px-4 py-2.5 bg-blue-50/95 dark:bg-blue-950/85 border-t border-blue-200 dark:border-blue-800/80 flex items-center justify-between gap-2 z-20 shadow-lg">
                <div class="flex items-center gap-2 min-w-0">
                    <span id="gallery-selected-count-badge" class="bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full shrink-0">0 selected</span>
                    <span class="text-[10px] text-blue-900 dark:text-blue-200 font-medium truncate">Choiced menu pages</span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button type="button" onclick="window.toggleSelectAllMenuPages && window.toggleSelectAllMenuPages()" id="btn-gallery-toggle-all" class="bg-white hover:bg-gray-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-300 text-[10px] font-bold px-2 py-1 rounded-lg border border-gray-200 dark:border-zinc-700 transition active:scale-95 cursor-pointer">
                        Select All
                    </button>
                    <button type="button" onclick="window.clearMenuPageSelections && window.clearMenuPageSelections()" class="bg-gray-200 hover:bg-gray-300 dark:bg-zinc-700 text-gray-700 dark:text-gray-300 text-[10px] font-bold px-2 py-1 rounded-lg transition active:scale-95 cursor-pointer">
                        Clear
                    </button>
                    <button type="button" onclick="window.sendSelectedMenuPagesToCustomer && window.sendSelectedMenuPagesToCustomer()" class="bg-blue-600 hover:bg-blue-500 text-white font-black text-xs px-3 py-1.5 rounded-xl transition active:scale-95 shadow-xs flex items-center gap-1.5 cursor-pointer">
                        <i class="fa-solid fa-paper-plane text-[10px]"></i> Send Selected
                    </button>
                </div>
            </div>
        </div>

        <!-- Lightbox / Preview Layer -->
        <div id="gallery-lightbox" class="fixed inset-0 z-[1000002] bg-black/95 flex flex-col items-center justify-center p-3 hidden" style="z-index: 1000002 !important;" onclick="window.closeGalleryLightbox && window.closeGalleryLightbox()">
            <div class="absolute top-4 right-4 flex items-center gap-2">
                <a id="lightbox-download-single" href="#" download="menu_page.jpg" onclick="event.stopPropagation()" class="bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 backdrop-blur-md">
                    <i class="fa-solid fa-download"></i> Save Image
                </a>
                <button type="button" class="text-white text-xl p-2 cursor-pointer" onclick="window.closeGalleryLightbox && window.closeGalleryLightbox()">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <img id="lightbox-image" src="" alt="Menu Full View" class="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl select-none" onclick="event.stopPropagation()">
            <div id="lightbox-caption" class="text-white text-xs font-bold mt-2 text-center bg-black/60 px-3 py-1 rounded-lg backdrop-blur-xs select-none"></div>
        </div>`;
        document.body.appendChild(modal);
    }
    return modal;
}

function compressImageToBlob(fileOrBlob, maxWidth = 1800, quality = 0.85, enhanceDocument = true) {
    return new Promise((resolve, reject) => {
        let objectUrl = "";
        if (typeof fileOrBlob === 'string' && fileOrBlob.startsWith('data:')) {
            objectUrl = fileOrBlob;
        } else if (fileOrBlob instanceof Blob || fileOrBlob instanceof File) {
            objectUrl = URL.createObjectURL(fileOrBlob);
        } else {
            return reject(new Error("Invalid image source for compression"));
        }

        const img = new Image();
        img.onload = () => {
            if (objectUrl.startsWith('blob:')) {
                URL.revokeObjectURL(objectUrl);
            }

            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');

            if (enhanceDocument && ctx.filter !== undefined) {
                // Subtle document enhancement: darker text, sharper price readability in dim lighting
                ctx.filter = 'contrast(1.08) brightness(1.02) saturate(1.05)';
            }

            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error("Canvas blob compression failed."));
                }
            }, 'image/jpeg', quality);
        };
        img.onerror = (err) => {
            if (objectUrl.startsWith('blob:')) {
                URL.revokeObjectURL(objectUrl);
            }
            reject(err);
        };
        img.src = objectUrl;
    });
}

export function getOrCreateMenuCameraModal() {
    let modal = document.getElementById('store-menu-camera-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'store-menu-camera-modal';
        modal.className = 'fixed inset-0 z-[1000005] bg-black flex flex-col justify-between hidden select-none animate-scaleUp';
        modal.style.zIndex = '1000005';
        modal.innerHTML = `
        <!-- Camera Top Bar -->
        <div class="flex items-center justify-between px-4 py-3 bg-black/85 backdrop-blur-md text-white z-20 border-b border-white/10">
            <button type="button" onclick="window.closeMenuCameraScanner && window.closeMenuCameraScanner()" class="p-2 text-white/80 hover:text-white text-base cursor-pointer">
                <i class="fa-solid fa-arrow-left"></i>
            </button>
            <div class="text-center min-w-0 flex-1 px-2">
                <h4 id="menu-camera-title" class="text-xs sm:text-sm font-black truncate text-white">Menu Document Scanner</h4>
                <p class="text-[9px] sm:text-[10px] text-amber-400 font-medium">Text Clarity & 4:3 High-Res Sensor Mode</p>
            </div>
            <div class="flex items-center gap-2">
                <button type="button" id="menu-camera-torch-btn" onclick="window.toggleMenuCameraTorch && window.toggleMenuCameraTorch()" class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs transition cursor-pointer hidden" title="Toggle Flash / Torch">
                    <i class="fa-solid fa-bolt"></i>
                </button>
                <button type="button" onclick="window.flipMenuCameraFacing && window.flipMenuCameraFacing()" class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs transition cursor-pointer" title="Flip Camera">
                    <i class="fa-solid fa-camera-rotate"></i>
                </button>
            </div>
        </div>

        <!-- Viewfinder Area -->
        <div class="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
            <video id="menu-camera-video" autoplay playsinline muted class="w-full h-full object-cover"></video>
            
            <!-- Framing overlay with document corners -->
            <div id="menu-camera-framing-box" class="absolute inset-4 sm:inset-8 pointer-events-none flex flex-col items-center justify-between border-2 border-white/20 rounded-2xl p-4 shadow-2xl">
                <!-- Top corners -->
                <div class="w-full flex justify-between">
                    <div class="w-6 h-6 border-t-4 border-l-4 border-amber-400 rounded-tl-lg shadow-sm"></div>
                    <div class="w-6 h-6 border-t-4 border-r-4 border-amber-400 rounded-tr-lg shadow-sm"></div>
                </div>
                
                <div class="bg-black/70 backdrop-blur-md px-3.5 py-1.5 rounded-full text-white/95 text-[10px] sm:text-xs font-bold tracking-wide flex items-center gap-1.5 shadow-lg border border-white/10">
                    <i class="fa-solid fa-expand text-amber-400"></i>
                    <span>Align menu page inside box</span>
                </div>

                <!-- Bottom corners -->
                <div class="w-full flex justify-between">
                    <div class="w-6 h-6 border-b-4 border-l-4 border-amber-400 rounded-bl-lg shadow-sm"></div>
                    <div class="w-6 h-6 border-b-4 border-r-4 border-amber-400 rounded-br-lg shadow-sm"></div>
                </div>
            </div>

            <!-- Snap review preview container (hidden until snapshot taken) -->
            <div id="menu-camera-review-container" class="absolute inset-0 bg-black/95 flex flex-col justify-between hidden z-30">
                <div class="px-4 py-2.5 bg-black/85 flex items-center justify-between text-white text-xs font-bold border-b border-white/10">
                    <span class="flex items-center gap-1.5 text-amber-400">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Document Text Enhanced
                    </span>
                    <span id="menu-camera-review-page-label" class="text-[10px] text-gray-300">Page Preview</span>
                </div>
                
                <div class="flex-1 flex items-center justify-center p-3 overflow-hidden">
                    <img id="menu-camera-preview-img" src="" alt="Menu Snapshot" class="max-w-full max-h-full object-contain rounded-xl shadow-2xl border border-white/20">
                </div>

                <div class="p-3 sm:p-4 bg-zinc-900 border-t border-zinc-800 flex flex-col gap-2.5">
                    <div class="flex items-center gap-2">
                        <label for="menu-camera-caption-input" class="text-[11px] font-bold text-gray-300 shrink-0">Caption:</label>
                        <input type="text" id="menu-camera-caption-input" placeholder="e.g. Menu Page 1, Drinks, Snacks" class="flex-1 bg-black/60 border border-zinc-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-500">
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" onclick="window.retakeMenuCameraSnapshot && window.retakeMenuCameraSnapshot()" class="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs py-2.5 rounded-xl transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer">
                            <i class="fa-solid fa-rotate-left"></i> Retake
                        </button>
                        <button type="button" id="menu-camera-confirm-btn" onclick="window.confirmAndUploadMenuSnapshot && window.confirmAndUploadMenuSnapshot()" class="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-black text-xs py-2.5 rounded-xl transition active:scale-95 shadow-md flex items-center justify-center gap-1.5 cursor-pointer">
                            <i class="fa-solid fa-cloud-arrow-up"></i> Save & Add Page
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Camera Bottom Controls Bar -->
        <div id="menu-camera-bottom-bar" class="p-4 sm:p-5 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center gap-2 z-20 border-t border-white/10">
            <div class="flex items-center justify-center w-full">
                <button type="button" onclick="window.takeMenuCameraSnapshot && window.takeMenuCameraSnapshot()" class="w-18 h-18 rounded-full border-4 border-white flex items-center justify-center bg-white/20 active:scale-90 transition p-1 cursor-pointer shadow-2xl focus:outline-none" title="Capture Photo">
                    <div class="w-14 h-14 rounded-full bg-amber-500 hover:bg-amber-400 transition shadow-inner"></div>
                </button>
            </div>
            <p class="text-[10px] text-gray-400 font-medium tracking-wide">
                Hold phone steady • Tap to capture sharp text & prices
            </p>
        </div>`;
        document.body.appendChild(modal);
    }
    return modal;
}

export async function openMenuCameraScanner() {
    if (!activeGalleryStore) {
        showToast("⚠️ Paki-pili muna ang store bago mag-take ng photo.");
        return;
    }

    const modal = getOrCreateMenuCameraModal();
    // Ensure camera modal is at top of DOM stack and z-index above store menu modal
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    } else {
        document.body.appendChild(modal);
    }
    modal.style.zIndex = '1000005';

    const titleEl = document.getElementById('menu-camera-title');
    if (titleEl) titleEl.innerText = `${activeGalleryStore.name} - Camera`;

    const reviewContainer = document.getElementById('menu-camera-review-container');
    if (reviewContainer) reviewContainer.classList.add('hidden');
    const bottomBar = document.getElementById('menu-camera-bottom-bar');
    if (bottomBar) bottomBar.classList.remove('hidden');

    modal.classList.remove('hidden');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast("⚠️ Hindi suportado ang in-app camera sa browser na ito. Bubuksan ang camera...");
        closeMenuCameraScanner();
        const fallbackInput = document.getElementById('gallery-camera-fallback-input');
        if (fallbackInput) fallbackInput.click();
        return;
    }

    await startMenuCameraStream();
}

async function startMenuCameraStream() {
    const video = document.getElementById('menu-camera-video');
    if (!video) return;

    if (activeCameraStream) {
        activeCameraStream.getTracks().forEach(t => t.stop());
        activeCameraStream = null;
    }

    isTorchOn = false;
    updateTorchBtnUi(false);

    // Progressive camera constraints: 4:3 aspect ratio, Ultra-HD / Full-HD ideal resolution
    const constraintSets = [
        {
            audio: false,
            video: {
                facingMode: { ideal: activeCameraFacingMode },
                width: { ideal: 3840, min: 1920 },
                height: { ideal: 2160, min: 1080 },
                aspectRatio: { ideal: 4 / 3 }
            }
        },
        {
            audio: false,
            video: {
                facingMode: { ideal: activeCameraFacingMode },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        },
        {
            audio: false,
            video: { facingMode: activeCameraFacingMode }
        }
    ];

    let stream = null;
    for (const constraints of constraintSets) {
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            if (stream) break;
        } catch(e) {
            // Try next constraint set
        }
    }

    if (!stream) {
        showToast("⚠️ Hindi ma-access ang camera. Gamitin ang native camera...");
        closeMenuCameraScanner();
        const fallbackInput = document.getElementById('gallery-camera-fallback-input');
        if (fallbackInput) fallbackInput.click();
        return;
    }

    activeCameraStream = stream;
    video.srcObject = stream;
    try {
        await video.play();
    } catch(e) {}

    // Track capabilities: Torch and continuous auto-focus
    const track = stream.getVideoTracks()[0];
    if (track) {
        try {
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};
            const torchBtn = document.getElementById('menu-camera-torch-btn');
            if (torchBtn) {
                if (capabilities.torch) {
                    torchBtn.classList.remove('hidden');
                } else {
                    torchBtn.classList.add('hidden');
                }
            }

            const advanced = {};
            if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
                advanced.focusMode = 'continuous';
            }
            if (capabilities.exposureMode && capabilities.exposureMode.includes('continuous')) {
                advanced.exposureMode = 'continuous';
            }
            if (capabilities.whiteBalanceMode && capabilities.whiteBalanceMode.includes('continuous')) {
                advanced.whiteBalanceMode = 'continuous';
            }

            if (Object.keys(advanced).length > 0 && track.applyConstraints) {
                await track.applyConstraints({ advanced: [advanced] });
            }
        } catch(err) {
            console.warn('[MenuCamera] Capability configuration warning:', err);
        }
    }
}

export async function toggleMenuCameraTorch() {
    if (!activeCameraStream) return;
    const track = activeCameraStream.getVideoTracks()[0];
    if (!track) return;

    try {
        const capabilities = track.getCapabilities ? track.getCapabilities() : {};
        if (!capabilities.torch) {
            showToast("ℹ️ Hindi suportado ang flashlight sa camera na ito.");
            return;
        }

        isTorchOn = !isTorchOn;
        await track.applyConstraints({ advanced: [{ torch: isTorchOn }] });
        updateTorchBtnUi(isTorchOn);
    } catch(err) {
        console.warn('[MenuCamera] Torch toggle error:', err);
    }
}

function updateTorchBtnUi(on) {
    const torchBtn = document.getElementById('menu-camera-torch-btn');
    if (!torchBtn) return;
    if (on) {
        torchBtn.classList.remove('bg-white/10', 'text-white');
        torchBtn.classList.add('bg-amber-400', 'text-black', 'shadow-md');
    } else {
        torchBtn.classList.remove('bg-amber-400', 'text-black', 'shadow-md');
        torchBtn.classList.add('bg-white/10', 'text-white');
    }
}

export async function flipMenuCameraFacing() {
    activeCameraFacingMode = activeCameraFacingMode === 'environment' ? 'user' : 'environment';
    await startMenuCameraStream();
}

export function closeMenuCameraScanner() {
    const modal = document.getElementById('store-menu-camera-modal');
    if (modal) modal.classList.add('hidden');

    if (activeCameraStream) {
        activeCameraStream.getTracks().forEach(t => t.stop());
        activeCameraStream = null;
    }

    const video = document.getElementById('menu-camera-video');
    if (video) video.srcObject = null;

    const reviewContainer = document.getElementById('menu-camera-review-container');
    if (reviewContainer) reviewContainer.classList.add('hidden');

    capturedSnapshotBlob = null;
    isTorchOn = false;
    updateTorchBtnUi(false);
}

export function takeMenuCameraSnapshot() {
    const video = document.getElementById('menu-camera-video');
    if (!video || !activeCameraStream) return;

    const vWidth = video.videoWidth || 1920;
    const vHeight = video.videoHeight || 1080;

    const canvas = document.createElement('canvas');
    canvas.width = vWidth;
    canvas.height = vHeight;
    const ctx = canvas.getContext('2d');

    // Document Text Contrast Filter
    if (ctx.filter !== undefined) {
        ctx.filter = 'contrast(1.08) brightness(1.02) saturate(1.05)';
    }
    ctx.drawImage(video, 0, 0, vWidth, vHeight);

    canvas.toBlob(async (blob) => {
        if (!blob) {
            showToast("❌ Nabigo ang pagkuha ng litrato.");
            return;
        }

        capturedSnapshotBlob = blob;

        const previewImg = document.getElementById('menu-camera-preview-img');
        const reviewContainer = document.getElementById('menu-camera-review-container');
        const captionInput = document.getElementById('menu-camera-caption-input');
        const pageLabel = document.getElementById('menu-camera-review-page-label');

        if (previewImg) previewImg.src = URL.createObjectURL(blob);

        let nextIdx = 1;
        if (activeGalleryStore && db) {
            try {
                const snap = await db.ref(`directory/storeMenuGalleries/${activeGalleryStore.key}/pages`).once('value');
                if (snap.exists()) {
                    nextIdx = Object.keys(snap.val()).length + 1;
                }
            } catch(e) {}
        }

        if (captionInput) captionInput.value = `Menu Page ${nextIdx}`;
        if (pageLabel) pageLabel.innerText = `Page ${nextIdx} Preview`;
        if (reviewContainer) reviewContainer.classList.remove('hidden');
    }, 'image/jpeg', 0.92);
}

export function retakeMenuCameraSnapshot() {
    const reviewContainer = document.getElementById('menu-camera-review-container');
    if (reviewContainer) reviewContainer.classList.add('hidden');
    capturedSnapshotBlob = null;
}

export async function confirmAndUploadMenuSnapshot() {
    if (!capturedSnapshotBlob || !activeGalleryStore) return;

    const confirmBtn = document.getElementById('menu-camera-confirm-btn');
    const captionInput = document.getElementById('menu-camera-caption-input');
    const captionText = (captionInput?.value || "").trim() || "Menu Page";

    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    try {
        const optimizedBlob = await compressImageToBlob(capturedSnapshotBlob, 1800, 0.85, true);
        const result = await uploadSingleMenuBlob(optimizedBlob, captionText, activeGalleryStore.key, activeGalleryStore.name);

        showToast(`✅ Na-save ang ${captionText} para sa ${activeGalleryStore.name}!`);
        showSideNotification("MENU PAGE ADDED", `${activeGalleryStore.name} (${captionText})`, "fa-camera", "text-amber-400", "border-amber-500");

        // Return to live camera so rider can capture next page or exit
        retakeMenuCameraSnapshot();
        const nextCaptionInput = document.getElementById('menu-camera-caption-input');
        if (nextCaptionInput) nextCaptionInput.value = `Menu Page ${result.count + 1}`;
        showToast("📸 Kumuha ng susunod na page o i-tap ang Back.");
    } catch(err) {
        console.error('[MenuCamera] Upload error:', err);
        showToast("❌ Hindi na-save ang litrato: " + (err.message || "Upload failed"));
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Save & Add Page`;
        }
    }
}

export function handleOpenMenuGalleryClick(btn) {
    if (!btn) return;
    const storeName = btn.getAttribute('data-store-name') || '';
    const compositeKey = btn.getAttribute('data-composite-key') || '';
    openStoreMenuGalleryModal(storeName, compositeKey);
}

export async function openStoreMenuGalleryModal(storeName, compositeKey) {
    const modal = getOrCreateMenuGalleryModal();
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    } else {
        document.body.appendChild(modal);
    }
    modal.style.zIndex = '100001';

    const cleanName = (storeName || "Store").trim();
    const galleryKey = (compositeKey || cleanName).toLowerCase().replace(/[^a-z0-9]/g, '');

    activeGalleryStore = {
        name: cleanName,
        key: galleryKey
    };

    const titleEl = document.getElementById('gallery-store-title');
    const subEl = document.getElementById('gallery-store-subtitle');
    const dlBtn = document.getElementById('btn-download-all-menu');

    if (titleEl) titleEl.innerText = `${cleanName} - Menu`;
    if (subEl) subEl.innerText = `Complete physical menu for ${cleanName}`;
    if (dlBtn) dlBtn.classList.add('hidden');

    modal.classList.remove('hidden');

    try {
        const cached = await idbGet('storeMenuGalleries', galleryKey);
        if (cached && cached.pages && cached.pages.length > 0) {
            renderMenuPages(cached.pages, cleanName);
        }
    } catch(e) {}

    if (db) {
        db.ref(`directory/storeMenuGalleries/${galleryKey}`).on('value', (snap) => {
            const val = snap.val() || {};
            const pages = val.pages ? Object.values(val.pages) : [];

            pages.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));

            idbSet('storeMenuGalleries', galleryKey, { pages, updatedAt: val.updatedAt || Date.now() }).catch(() => {});
            renderMenuPages(pages, cleanName);
        });
    }
}

export function closeStoreMenuGalleryModal() {
    closeMenuCameraScanner();
    clearMenuPageSelections();
    const modal = document.getElementById('store-menu-gallery-modal');
    if (modal) modal.classList.add('hidden');
    if (db && activeGalleryStore) {
        db.ref(`directory/storeMenuGalleries/${activeGalleryStore.key}`).off();
    }
    activeGalleryStore = null;
    currentGalleryPages = [];
}

function renderMenuPages(pages = [], storeName = "Store") {
    currentGalleryPages = pages || [];
    selectedMenuPageIndices.clear();

    const container = document.getElementById('gallery-images-container');
    const dlBtn = document.getElementById('btn-download-all-menu');
    const sendAllBtn = document.getElementById('btn-send-all-menu');
    updateMenuSelectionBar();

    if (!container) return;

    if (pages.length === 0) {
        if (dlBtn) dlBtn.classList.add('hidden');
        if (sendAllBtn) sendAllBtn.classList.add('hidden');
        container.innerHTML = `
        <div class="col-span-full text-center text-gray-500 dark:text-gray-400 italic py-12 text-xs flex flex-col items-center gap-2">
            <i class="fa-solid fa-camera-retro text-2xl text-amber-500/60"></i>
            <span>Walang naka-save na photo menu para sa restaurant na ito.</span>
            <span class="text-[10px] text-gray-400">Mag-picture ng menu gamit ang high-resolution camera o mag-upload mula gallery.</span>
            <button type="button" onclick="window.openMenuCameraScanner && window.openMenuCameraScanner()" class="mt-2 bg-amber-600 hover:bg-amber-500 text-white font-black text-xs px-4 py-2 rounded-xl transition active:scale-95 shadow-md flex items-center gap-1.5 cursor-pointer">
                <i class="fa-solid fa-camera text-xs"></i> Take Photo Now
            </button>
        </div>`;
        return;
    }

    if (dlBtn) dlBtn.classList.remove('hidden');
    if (sendAllBtn) sendAllBtn.classList.remove('hidden');

    container.innerHTML = pages.map((page, idx) => {
        const pageNum = idx + 1;
        const caption = page.caption || `Page ${pageNum}`;
        const uploader = page.uploaderName || "Rider";
        const uploadedAt = page.uploadedAt ? ` • ${page.uploadedAt}` : "";
        const safeUrl = page.imageUrl || "";

        return `
        <div class="bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-gray-800/80 rounded-xl p-1.5 flex flex-col gap-1.5 shadow-2xs group relative">
            <div class="relative w-full aspect-[4/3] bg-black/60 rounded-lg overflow-hidden cursor-pointer" onclick="window.openGalleryLightbox && window.openGalleryLightbox('${safeUrl}', '${escapeHtml(caption)}')">
                <img src="${safeUrl}" alt="${escapeHtml(caption)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition duration-200">
                <span class="absolute top-1.5 left-1.5 bg-black/75 backdrop-blur-xs text-amber-400 font-mono font-black text-[9px] px-1.5 py-0.5 rounded-md border border-amber-500/30">
                    P${pageNum}
                </span>

                <!-- Choice Checkbox for selective sending -->
                <div class="absolute top-1.5 right-1.5 z-10" onclick="event.stopPropagation()">
                    <input type="checkbox" id="gallery-chk-${idx}" class="gallery-page-checkbox w-4 h-4 rounded text-blue-600 bg-white/95 border-gray-400 focus:ring-0 cursor-pointer shadow-md" onchange="window.handleMenuPageCheckToggle && window.handleMenuPageCheckToggle(${idx})">
                </div>

                <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold gap-1 pointer-events-none">
                    <i class="fa-solid fa-magnifying-glass-plus text-[10px]"></i> View
                </div>
            </div>
            
            <div class="flex items-center justify-between text-xs px-0.5 pt-0.5">
                <div class="flex flex-col min-w-0 pr-1">
                    <span class="font-bold text-[11px] text-gray-900 dark:text-white truncate">${escapeHtml(caption)}</span>
                    <span class="text-[8.5px] text-gray-500 dark:text-gray-400 truncate leading-tight">${escapeHtml(uploader)}${uploadedAt}</span>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" onclick="event.stopPropagation(); window.sendSingleMenuPageToCustomer && window.sendSingleMenuPageToCustomer('${safeUrl}', '${escapeHtml(caption)}')" class="p-1 rounded-md bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 transition active:scale-95 cursor-pointer" title="Send this page to customer">
                        <i class="fa-solid fa-paper-plane text-[9px]"></i>
                    </button>
                    <a href="${safeUrl}" download="${storeName}_Menu_Page_${pageNum}.jpg" class="p-1 rounded-md bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:text-emerald-500 transition active:scale-95" title="Save this page">
                        <i class="fa-solid fa-download text-[9px]"></i>
                    </a>
                    ${checkAdminAccess() ? `
                    <button type="button" onclick="window.deleteMenuGalleryPage && window.deleteMenuGalleryPage('${page.id}')" class="p-1 rounded-md bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 transition active:scale-95" title="Delete page">
                        <i class="fa-solid fa-trash text-[9px]"></i>
                    </button>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
}

export async function uploadSingleMenuBlob(imageBlob, captionText, storeKey, storeName) {
    const riderName = appState.riderName || localStorage.getItem('riderName') || "Rider";
    const riderId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const todayFormatted = new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

    let count = 1;
    if (db) {
        try {
            const snap = await db.ref(`directory/storeMenuGalleries/${storeKey}/pages`).once('value');
            if (snap.exists()) {
                count = Object.keys(snap.val()).length + 1;
            }
        } catch(e) {}
    }

    const pageId = `PAGE_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const storagePath = `menus/${storeKey}/${pageId}.jpg`;

    // Upload directly to Firebase Storage with long-lived Cache-Control
    const finalImageUrl = await uploadImage(imageBlob, storagePath, {
        storeKey: storeKey,
        uploaderId: riderId,
        uploaderName: riderName
    });

    const finalCaption = captionText && captionText.trim() !== "Menu Page" ? captionText.trim() : `Menu Page ${count}`;

    const pagePayload = {
        id: pageId,
        imageUrl: finalImageUrl,
        caption: finalCaption,
        uploaderName: riderName,
        uploaderId: riderId,
        orderIndex: count,
        uploadedAt: todayFormatted
    };

    if (db) {
        await db.ref(`directory/storeMenuGalleries/${storeKey}/pages/${pageId}`).set(pagePayload);

        const nowTs = Date.now();
        await db.ref(`directory/storeMenuGalleries/${storeKey}/updatedAt`).set(nowTs);
        await db.ref(`directory/storeMenuGalleries/${storeKey}/storeName`).set(storeName);
        await db.ref(`directory/storeMenuMeta/${storeKey}`).set({
            pageCount: count,
            updatedAt: nowTs,
            storeName: storeName
        });
    }

    // Instantly update memory and cache to prevent any UI delay
    const nowTs = Date.now();
    storeMenuMetadataMap[storeKey] = {
        pageCount: count,
        updatedAt: nowTs,
        storeName: storeName
    };
    try {
        localStorage.setItem('lokalex_store_menus_meta_cache', JSON.stringify(storeMenuMetadataMap));
    } catch(e) {}

    return { count, pageId, finalImageUrl, caption: finalCaption };
}

export async function handleMenuPhotoUpload(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !activeGalleryStore) return;

    const input = e.target;
    showToast(`⏳ Compressing and uploading ${files.length} menu photo(s)...`);

    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const imageBlob = await compressImageToBlob(file, 1800, 0.85, true);
            await uploadSingleMenuBlob(imageBlob, `Menu Page`, activeGalleryStore.key, activeGalleryStore.name);
        }

        showToast(`✅ Na-upload ang ${files.length} pahina ng menu para sa ${activeGalleryStore.name}!`);
        showSideNotification("MENU UPLOADED", `${activeGalleryStore.name} (+${files.length} pages)`, "fa-book-open", "text-emerald-400", "border-emerald-500");
    } catch(err) {
        console.error("Upload error:", err);
        showToast("❌ Hindi na-save ang litrato: " + (err.message || "Upload failed"));
    } finally {
        if (input) input.value = "";
    }
}

export async function downloadCompleteMenuToPhone() {
    if (!activeGalleryStore || !db) return;

    showToast("📥 Starting sequential menu download...");

    try {
        const snap = await db.ref(`directory/storeMenuGalleries/${activeGalleryStore.key}/pages`).once('value');
        const pages = snap.exists() ? Object.values(snap.val()) : [];

        if (pages.length === 0) {
            showToast("⚠️ Walang naka-save na mga litrato.");
            return;
        }

        pages.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));

        showToast(`📥 Saving ${pages.length} menu pictures one by one (auto-overwrite)...`);

        for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            const pageNum = i + 1;
            const filename = `${activeGalleryStore.name}_Menu_Page_${pageNum}.jpg`;
            showToast(`💾 Saving page ${pageNum} of ${pages.length}...`);
            await saveImageToDevice(p.imageUrl, filename, false);
            await new Promise(r => setTimeout(r, 400));
        }

        showToast(`✅ Successfully saved ${pages.length} menu picture(s) (auto-overwritten)!`);
    } catch(err) {
        console.error("Download error:", err);
        showToast("⚠️ Hindi na-download ang kumpletong menu: " + (err.message || "Error"));
    }
}

export function handleMenuPageCheckToggle(idx) {
    const chk = document.getElementById(`gallery-chk-${idx}`);
    if (!chk) return;
    if (chk.checked) {
        selectedMenuPageIndices.add(idx);
    } else {
        selectedMenuPageIndices.delete(idx);
    }
    updateMenuSelectionBar();
}

export function updateMenuSelectionBar() {
    const bar = document.getElementById('gallery-selection-bar');
    const badge = document.getElementById('gallery-selected-count-badge');
    const toggleBtn = document.getElementById('btn-gallery-toggle-all');
    if (!bar) return;

    const count = selectedMenuPageIndices.size;
    if (count > 0) {
        bar.classList.remove('hidden');
        if (badge) badge.innerText = `${count} selected`;
    } else {
        bar.classList.add('hidden');
    }

    if (toggleBtn) {
        if (currentGalleryPages.length > 0 && count === currentGalleryPages.length) {
            toggleBtn.innerText = "Deselect All";
        } else {
            toggleBtn.innerText = "Select All";
        }
    }
}

export function toggleSelectAllMenuPages() {
    if (selectedMenuPageIndices.size === currentGalleryPages.length) {
        clearMenuPageSelections();
    } else {
        selectedMenuPageIndices.clear();
        currentGalleryPages.forEach((_, idx) => {
            selectedMenuPageIndices.add(idx);
            const chk = document.getElementById(`gallery-chk-${idx}`);
            if (chk) chk.checked = true;
        });
        updateMenuSelectionBar();
    }
}

export function clearMenuPageSelections() {
    selectedMenuPageIndices.clear();
    const checkboxes = document.querySelectorAll('.gallery-page-checkbox');
    checkboxes.forEach(c => c.checked = false);
    updateMenuSelectionBar();
}

export function sendSingleMenuPageToCustomer(imageUrl, caption) {
    dispatchMenuPagesToSend([{ imageUrl, caption: caption || "Menu Page" }]);
}

export function sendSelectedMenuPagesToCustomer() {
    if (selectedMenuPageIndices.size === 0) {
        showToast("⚠️ Paki-pili muna ang mga menu pages na nais ipadala.");
        return;
    }
    const pages = Array.from(selectedMenuPageIndices).sort((a, b) => a - b).map(idx => {
        const p = currentGalleryPages[idx];
        return {
            imageUrl: p.imageUrl,
            caption: p.caption || `Page ${idx + 1}`
        };
    });
    dispatchMenuPagesToSend(pages);
}

export function sendAllMenuPagesToCustomer() {
    if (!currentGalleryPages || currentGalleryPages.length === 0) {
        showToast("⚠️ Walang naka-save na litrato para sa store na ito.");
        return;
    }
    const pages = currentGalleryPages.map((p, idx) => ({
        imageUrl: p.imageUrl,
        caption: p.caption || `Page ${idx + 1}`
    }));
    dispatchMenuPagesToSend(pages);
}

export function dispatchMenuPagesToSend(pagesToSend) {
    if (!pagesToSend || pagesToSend.length === 0) return;

    // Check if rider is currently chatting inside rider-chat-modal
    const chatModal = document.getElementById('rider-chat-modal') || document.getElementById('rider-customer-chat-modal');
    const isChatOpen = chatModal && !chatModal.classList.contains('hidden');
    const activeCustId = (typeof window.getActiveRiderChatCustId === 'function') 
        ? window.getActiveRiderChatCustId() 
        : window.activeRiderChatCustId;

    const validActiveCustId = (activeCustId && activeCustId !== 'undefined' && activeCustId !== 'null') ? String(activeCustId).trim() : null;

    if (isChatOpen && validActiveCustId) {
        const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";
        if (confirm(`Ipadala ang ${pagesToSend.length} menu picture(s) kay ${custName}?`)) {
            executeSendMenuPages(validActiveCustId, pagesToSend, custName);
        }
        return;
    }

    // Otherwise open customer picker modal
    openMenuCustomerRecipientPicker(pagesToSend);
}

export async function executeSendMenuPages(targetCustId, pages, custDisplayName = "Customer") {
    const cleanCustId = String(targetCustId || '').trim();
    if (!cleanCustId || cleanCustId === 'undefined' || cleanCustId === 'null' || !pages || pages.length === 0) {
        showToast("⚠️ Hindi mapili ang customer. Subukang muli.");
        return;
    }

    closeMenuCustomerRecipientPicker();
    const total = pages.length;
    showToast(`📤 Sinisimulan ang pagpapadala ng ${total} menu picture(s) kay ${custDisplayName}...`);

    let sent = 0;
    for (let i = 0; i < total; i++) {
        const p = pages[i];
        const pageNum = i + 1;
        const isLastPage = (i === total - 1);
        let caption = p.caption || `Page ${pageNum} of ${total}`;
        if (isLastPage) {
            caption = p.caption 
                ? `${p.caption} • (Last page of the menu)` 
                : (total > 1 ? `Page ${pageNum} of ${total} • (Last page of the menu)` : `Menu • (Last page of the menu)`);
        }
        showToast(`📤 Sending picture ${pageNum} of ${total} to ${custDisplayName}...`);

        let ok = false;
        try {
            const sendFn = (typeof sendDirectMenuPhotoToCustomer === 'function') 
                ? sendDirectMenuPhotoToCustomer 
                : window.sendDirectMenuPhotoToCustomer;
            if (typeof sendFn === 'function') {
                ok = await sendFn(cleanCustId, p.imageUrl, caption);
            }
        } catch (sendErr) {
            console.error(`[MenuSend] Error sending page ${pageNum}:`, sendErr);
        }

        if (ok) {
            sent++;
        } else {
            console.warn(`[MenuSend] Failed to send menu page ${pageNum} to ${cleanCustId}`);
        }

        if (i < total - 1) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    if (sent === total) {
        showToast(`✅ Matagumpay na naipadala ang ${total} picture(s) kay ${custDisplayName}!`);
    } else if (sent > 0) {
        showToast(`⚠️ Naipadala ang ${sent} sa ${total} menu picture(s) kay ${custDisplayName}.`);
    } else {
        showToast(`❌ Nabigo ang pagpapadala ng menu photos kay ${custDisplayName}.`);
    }

    clearMenuPageSelections();
}

function getOrCreateMenuCustomerRecipientPickerModal() {
    let modal = document.getElementById('menu-recipient-picker-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'menu-recipient-picker-modal';
        modal.className = 'fixed inset-0 z-[1000003] flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 hidden';
        modal.style.zIndex = '1000003';
        modal.innerHTML = `
        <div class="bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-800 rounded-3xl max-w-sm w-full max-h-[85vh] shadow-2xl flex flex-col overflow-hidden animate-scaleUp">
            <!-- Header -->
            <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800/80 bg-gray-50/70 dark:bg-black/30">
                <div class="flex items-center gap-2 min-w-0">
                    <div class="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold shrink-0">
                        <i class="fa-solid fa-paper-plane"></i>
                    </div>
                    <div class="min-w-0">
                        <h3 class="font-black text-xs sm:text-sm text-gray-900 dark:text-white truncate">Send Menu to Customer</h3>
                        <p id="menu-recipient-modal-sub" class="text-[10px] text-gray-500 dark:text-gray-400 truncate">Select customer recipient</p>
                    </div>
                </div>
                <button type="button" onclick="window.closeMenuCustomerRecipientPicker && window.closeMenuCustomerRecipientPicker()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 text-sm cursor-pointer">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <!-- Search Input -->
            <div class="p-2.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-black/10">
                <div class="relative flex items-center">
                    <i class="fa-solid fa-magnifying-glass absolute left-3 text-gray-400 text-xs"></i>
                    <input type="text" id="menu-recipient-search-input" placeholder="Search customer name..." oninput="window.filterMenuCustomerRecipients && window.filterMenuCustomerRecipients()" class="w-full bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 dark:text-white outline-none focus:border-blue-500">
                </div>
            </div>

            <!-- Recipient List Body -->
            <div id="menu-recipient-list" class="flex-1 overflow-y-auto p-2.5 flex flex-col gap-1.5 max-h-[58vh]">
                <div class="text-center text-gray-400 text-xs py-8 italic">Loading customer list...</div>
            </div>
        </div>`;
        document.body.appendChild(modal);
    }
    return modal;
}

export function openMenuCustomerRecipientPicker(pagesToSend) {
    menuRecipientPickerPendingPages = pagesToSend || [];
    const modal = getOrCreateMenuCustomerRecipientPickerModal();
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    } else {
        document.body.appendChild(modal);
    }
    modal.style.zIndex = '1000003';

    const sub = document.getElementById('menu-recipient-modal-sub');
    const storeName = activeGalleryStore?.name || "Store";
    if (sub) {
        sub.innerText = `Sending ${menuRecipientPickerPendingPages.length} page(s) from ${storeName}`;
    }

    const searchInput = document.getElementById('menu-recipient-search-input');
    if (searchInput) searchInput.value = "";

    modal.classList.remove('hidden');
    renderMenuCustomerRecipients("");
}

export function closeMenuCustomerRecipientPicker() {
    const modal = document.getElementById('menu-recipient-picker-modal');
    if (modal) modal.classList.add('hidden');
    menuRecipientPickerPendingPages = null;
}

export function filterMenuCustomerRecipients() {
    const query = document.getElementById('menu-recipient-search-input')?.value || "";
    renderMenuCustomerRecipients(query);
}

export async function renderMenuCustomerRecipients(searchQuery = "") {
    const container = document.getElementById('menu-recipient-list');
    if (!container) return;

    let threads = [];
    if (typeof window.getCachedCustomerThreadsMap === 'function') {
        const map = window.getCachedCustomerThreadsMap();
        if (map && map.size > 0) {
            threads = Array.from(map.values());
        }
    }

    if (threads.length === 0 && db) {
        try {
            const snap = await db.ref('customerChatMeta').limitToLast(40).once('value');
            if (snap.exists()) {
                const val = snap.val();
                threads = Object.entries(val).map(([id, data]) => ({ id, ...data }));
            }
        } catch(e) {}
    }

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();
    const myCateringCusts = (typeof window.getMyCateringCustomers === 'function') ? window.getMyCateringCustomers() : [];

    const isMatchMyCatering = (t) => {
        const cId = (t.cateredByRiderId || "").toString().trim();
        const cName = (t.cateredByRiderName || t.cateredBy || "").toString().trim().toLowerCase();
        const name = (t.customerName || t.name || "").trim().toLowerCase();
        return (cId && cId === myId) || (cName && cName === myName) || myCateringCusts.some(c => c.toLowerCase() === name);
    };

    // Sort: Catering customer first, then by lastUpdated
    threads.sort((a, b) => {
        const catA = isMatchMyCatering(a) ? 1 : 0;
        const catB = isMatchMyCatering(b) ? 1 : 0;
        if (catA !== catB) return catB - catA;
        return (Number(b.lastUpdated) || 0) - (Number(a.lastUpdated) || 0);
    });

    const q = (searchQuery || "").trim().toLowerCase();
    const filtered = threads.filter(t => {
        const targetId = (t.custId || t.id || "").toString().trim();
        const name = (t.customerName || t.name || targetId).toLowerCase();
        if (name === 'unknown' || name === 'customer' || !targetId || targetId === 'undefined') return false;
        return !q || name.includes(q);
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-400 text-xs py-8 italic">Walang nahanap na active customer thread.</div>`;
        return;
    }

    container.innerHTML = filtered.map(t => {
        const targetCustId = (t.custId || t.id || "").toString().trim();
        const name = t.customerName || t.name || "Customer";
        const isCatering = isMatchMyCatering(t);
        const isFb = targetCustId.startsWith('fb_');

        return `
        <div onclick="window.handleSelectMenuCustomerRecipient && window.handleSelectMenuCustomerRecipient('${targetCustId}', '${escapeHtml(name)}')" class="p-2.5 rounded-2xl border ${isCatering ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700/60 ring-1 ring-emerald-500/20' : 'bg-gray-50 hover:bg-gray-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 border-gray-200 dark:border-zinc-700/60'} flex items-center justify-between gap-2 cursor-pointer transition active:scale-[0.98]">
            <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-8 h-8 rounded-full ${isCatering ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'} flex items-center justify-center font-bold text-xs shrink-0">
                    ${escapeHtml(name.charAt(0).toUpperCase())}
                </div>
                <div class="min-w-0">
                    <div class="font-bold text-xs text-gray-900 dark:text-white truncate flex items-center gap-1.5">
                        <span class="truncate">${escapeHtml(name)}</span>
                        ${isFb ? '<i class="fa-brands fa-facebook-messenger text-blue-500 text-[10px]"></i>' : ''}
                    </div>
                    <div class="text-[9.5px] text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
                        ${isCatering 
                            ? '<span class="text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1"><i class="fa-solid fa-circle-check text-[8.5px]"></i> Your Active Catering</span>' 
                            : (t.cateredBy ? `<span>Catered by ${escapeHtml(t.cateredBy)}</span>` : '<span>Inbox Chat</span>')}
                    </div>
                </div>
            </div>
            <button type="button" class="shrink-0 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 cursor-pointer">
                <i class="fa-solid fa-paper-plane text-[9px]"></i> Send
            </button>
        </div>`;
    }).join('');
}

export function handleSelectMenuCustomerRecipient(custId, custName) {
    const cleanId = String(custId || '').trim();
    if (!cleanId || cleanId === 'undefined' || cleanId === 'null') {
        showToast("⚠️ Invalid customer ID. Paki-pili muli ang customer.");
        return;
    }
    if (!menuRecipientPickerPendingPages || menuRecipientPickerPendingPages.length === 0) {
        closeMenuCustomerRecipientPicker();
        return;
    }
    executeSendMenuPages(cleanId, menuRecipientPickerPendingPages, custName);
}

function getOrCreateChatStoreMenuPickerModal() {
    let modal = document.getElementById('chat-store-menu-picker-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'chat-store-menu-picker-modal';
        modal.className = 'fixed inset-0 z-[100000] flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 hidden';
        modal.style.zIndex = '100000';
        modal.innerHTML = `
        <div class="bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-800 rounded-3xl max-w-sm sm:max-w-md w-full max-h-[85vh] shadow-2xl flex flex-col overflow-hidden animate-scaleUp">
            <!-- Header -->
            <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800/80 bg-gray-50/70 dark:bg-black/30">
                <div class="flex items-center gap-2 min-w-0">
                    <div class="w-8 h-8 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400 flex items-center justify-center text-sm font-bold shrink-0">
                        <i class="fa-solid fa-book-open"></i>
                    </div>
                    <div class="min-w-0">
                        <h3 class="font-black text-xs sm:text-sm text-gray-900 dark:text-white truncate">Restaurant Menu Directory</h3>
                        <p class="text-[10px] text-gray-500 dark:text-gray-400 truncate">Pick store to browse & send photos</p>
                    </div>
                </div>
                <button type="button" onclick="window.closeStoreMenuPickerFromChat && window.closeStoreMenuPickerFromChat()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 text-sm cursor-pointer">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <!-- Search Bar -->
            <div class="p-2.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-black/10">
                <div class="relative flex items-center">
                    <i class="fa-solid fa-magnifying-glass absolute left-3 text-gray-400 text-xs"></i>
                    <input type="text" id="chat-store-picker-search" placeholder="Search restaurant / store name..." oninput="window.filterChatStoreMenuPicker && window.filterChatStoreMenuPicker()" class="w-full bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-900 dark:text-white outline-none focus:border-orange-500">
                </div>
            </div>

            <!-- Stores List Body -->
            <div id="chat-store-picker-list" class="flex-1 overflow-y-auto p-2.5 flex flex-col gap-1.5 max-h-[58vh]">
                <div class="text-center text-gray-400 text-xs py-8 italic">Loading store menus...</div>
            </div>
        </div>`;
        document.body.appendChild(modal);
    }
    return modal;
}

export function openStoreMenuPickerFromChat() {
    const modal = getOrCreateChatStoreMenuPickerModal();
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    } else {
        document.body.appendChild(modal);
    }
    modal.style.zIndex = '100000';
    const searchInput = document.getElementById('chat-store-picker-search');
    if (searchInput) searchInput.value = "";
    modal.classList.remove('hidden');
    renderChatStoreMenuPicker("");
}

export function closeStoreMenuPickerFromChat() {
    const modal = document.getElementById('chat-store-menu-picker-modal');
    if (modal) modal.classList.add('hidden');
}

export function filterChatStoreMenuPicker() {
    const query = document.getElementById('chat-store-picker-search')?.value || "";
    renderChatStoreMenuPicker(query);
}

export async function renderChatStoreMenuPicker(searchQuery = "") {
    const container = document.getElementById('chat-store-picker-list');
    if (!container) return;

    let storeList = [];
    try {
        const cached = await idbGet('directory', 'stores');
        if (cached && Array.isArray(cached)) storeList = cached;
    } catch(e) {}

    if (storeList.length === 0 && globalState.directoryCache && globalState.directoryCache.stores) {
        storeList = globalState.directoryCache.stores;
    }

    const knownKeys = new Set(storeList.map(s => (s.compositeKey || s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')));
    Object.entries(storeMenuMetadataMap).forEach(([key, meta]) => {
        if (!knownKeys.has(key) && meta.storeName) {
            storeList.push({
                name: meta.storeName,
                compositeKey: key
            });
            knownKeys.add(key);
        }
    });

    const q = (searchQuery || "").trim().toLowerCase();
    const storesWithMenu = [];
    const storesWithoutMenu = [];

    storeList.forEach(s => {
        const name = (s.name || "").trim();
        if (!name) return;
        if (q && !name.toLowerCase().includes(q)) return;

        const keyByComposite = (s.compositeKey || "").toLowerCase().replace(/[^a-z0-9]/g, '');
        const keyByName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const meta = (keyByComposite && storeMenuMetadataMap[keyByComposite])
            || (keyByName && storeMenuMetadataMap[keyByName])
            || null;

        const pageCount = meta?.pageCount || 0;
        const entry = { ...s, name, pageCount, updatedAt: meta?.updatedAt };

        if (pageCount > 0) {
            storesWithMenu.push(entry);
        } else {
            storesWithoutMenu.push(entry);
        }
    });

    storesWithMenu.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));
    storesWithoutMenu.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));

    const combined = [...storesWithMenu, ...storesWithoutMenu];

    if (combined.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-400 text-xs py-8 italic">Walang nahanap na store.</div>`;
        return;
    }

    container.innerHTML = combined.map(s => {
        const safeName = escapeHtml(s.name);
        const safeCompositeKey = escapeHtml(s.compositeKey || s.name);
        const hasMenu = s.pageCount > 0;

        return `
        <div onclick="window.handleSelectStoreFromChatPicker && window.handleSelectStoreFromChatPicker('${safeName}', '${safeCompositeKey}')" class="p-2.5 rounded-2xl border ${hasMenu ? 'bg-orange-50/60 dark:bg-orange-950/20 border-orange-200 dark:border-orange-500/30' : 'bg-gray-50 hover:bg-gray-100 dark:bg-zinc-800/60 dark:hover:bg-zinc-800 border-gray-200 dark:border-zinc-700/60'} flex items-center justify-between gap-2 cursor-pointer transition active:scale-[0.98]">
            <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-8 h-8 rounded-xl ${hasMenu ? 'bg-orange-500 text-white' : 'bg-gray-200 dark:bg-zinc-700 text-gray-500 dark:text-gray-300'} flex items-center justify-center font-bold text-xs shrink-0">
                    <i class="fa-solid fa-store"></i>
                </div>
                <div class="min-w-0">
                    <div class="font-bold text-xs text-gray-900 dark:text-white truncate">${safeName}</div>
                    <div class="text-[9.5px] mt-0.5">
                        ${hasMenu 
                            ? `<span class="text-emerald-600 dark:text-emerald-400 font-bold"><i class="fa-solid fa-camera"></i> ${s.pageCount} ${s.pageCount === 1 ? 'Page' : 'Pages'}</span>` 
                            : `<span class="text-gray-400">No photos yet</span>`}
                    </div>
                </div>
            </div>
            <button type="button" class="shrink-0 ${hasMenu ? 'bg-orange-600 hover:bg-orange-500 text-white' : 'bg-gray-200 dark:bg-zinc-700 text-gray-600 dark:text-gray-300'} text-[10px] font-bold px-2.5 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 cursor-pointer">
                <i class="fa-solid fa-book-open text-[9px]"></i> View & Send
            </button>
        </div>`;
    }).join('');
}

export function handleSelectStoreFromChatPicker(storeName, compositeKey) {
    closeStoreMenuPickerFromChat();
    openStoreMenuGalleryModal(storeName, compositeKey);
}

export async function deleteMenuGalleryPage(pageId) {
    if (!activeGalleryStore || !pageId || !db) return;
    if (!confirm("Sigurado ka bang nais burahin ang page na ito?")) return;

    try {
        await db.ref(`directory/storeMenuGalleries/${activeGalleryStore.key}/pages/${pageId}`).remove();
        const nowTs = Date.now();
        await db.ref(`directory/storeMenuGalleries/${activeGalleryStore.key}/updatedAt`).set(nowTs);
        if (storage) {
            storage.ref(`menus/${activeGalleryStore.key}/${pageId}.jpg`).delete().catch(() => {});
        }

        if (storeMenuMetadataMap[activeGalleryStore.key]) {
            storeMenuMetadataMap[activeGalleryStore.key].pageCount = Math.max(0, (storeMenuMetadataMap[activeGalleryStore.key].pageCount || 1) - 1);
            storeMenuMetadataMap[activeGalleryStore.key].updatedAt = nowTs;
            try {
                localStorage.setItem('lokalex_store_menus_meta_cache', JSON.stringify(storeMenuMetadataMap));
            } catch(e) {}
        }

        showToast("🗑️ Nabura ang page sa gallery.");
    } catch(e) {
        showToast("❌ Hindi nabura ang page.");
    }
}

export function openGalleryLightbox(url, caption) {
    const lightbox = document.getElementById('gallery-lightbox');
    const img = document.getElementById('lightbox-image');
    const cap = document.getElementById('lightbox-caption');
    const dlBtn = document.getElementById('lightbox-download-single');

    if (img) img.src = url;
    if (cap) cap.innerText = caption;
    if (dlBtn) dlBtn.href = url;
    if (lightbox) lightbox.classList.remove('hidden');
}

export function closeGalleryLightbox() {
    const lightbox = document.getElementById('gallery-lightbox');
    if (lightbox) lightbox.classList.add('hidden');
}

