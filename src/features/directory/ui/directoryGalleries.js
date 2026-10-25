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
let menuRecipientPickerPendingStoreName = "Store";

let activeCameraStream = null;
let activeCameraFacingMode = 'environment';
let isTorchOn = false;
let capturedSnapshotBlob = null;
let activeCameraOrientation = 'portrait';
let currentCameraZoom = 1;
let cameraZoomCapabilities = null;
let touchStartDistance = 0;
let touchStartZoom = 1;

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
        <div class="flex items-center justify-between px-3 sm:px-4 py-2.5 bg-black/90 backdrop-blur-md text-white z-20 border-b border-white/10">
            <button type="button" onclick="window.closeMenuCameraScanner && window.closeMenuCameraScanner()" class="p-2 text-white/80 hover:text-white text-base cursor-pointer">
                <i class="fa-solid fa-arrow-left"></i>
            </button>
            <div class="text-center min-w-0 flex-1 px-1 sm:px-2">
                <h4 id="menu-camera-title" class="text-xs sm:text-sm font-black truncate text-white">Menu Document Scanner</h4>
                <p id="menu-camera-sub" class="text-[9px] sm:text-[10px] text-amber-400 font-medium truncate">Instant HD Capture • Zoom & Rotate</p>
            </div>
            <div class="flex items-center gap-1.5 sm:gap-2">
                <!-- Native Camera Direct Trigger -->
                <input type="file" id="menu-camera-native-input" accept="image/*" capture="environment" class="hidden" onchange="window.handleNativeMenuCameraCapture && window.handleNativeMenuCameraCapture(event)">
                <button type="button" onclick="document.getElementById('menu-camera-native-input').click()" class="px-2 py-1 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer" title="Switch to Native HD Camera App">
                    <i class="fa-solid fa-camera"></i> <span class="hidden xs:inline">Native</span>
                </button>
                <!-- Orientation Toggle -->
                <button type="button" id="menu-camera-orient-btn" onclick="window.toggleMenuCameraOrientation && window.toggleMenuCameraOrientation()" class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs transition cursor-pointer" title="Toggle Orientation (Portrait / Landscape)">
                    <i class="fa-solid fa-mobile-screen-button"></i>
                </button>
                <!-- Torch Toggle -->
                <button type="button" id="menu-camera-torch-btn" onclick="window.toggleMenuCameraTorch && window.toggleMenuCameraTorch()" class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs transition cursor-pointer hidden" title="Toggle Flash / Torch">
                    <i class="fa-solid fa-bolt"></i>
                </button>
                <!-- Flip Camera -->
                <button type="button" onclick="window.flipMenuCameraFacing && window.flipMenuCameraFacing()" class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs transition cursor-pointer" title="Flip Camera">
                    <i class="fa-solid fa-camera-rotate"></i>
                </button>
            </div>
        </div>

        <!-- Viewfinder Area -->
        <div id="menu-camera-viewfinder" class="relative flex-1 bg-black flex items-center justify-center overflow-hidden touch-none">
            <video id="menu-camera-video" autoplay playsinline muted class="w-full h-full object-cover transition-transform duration-100 ease-out"></video>
            
            <!-- Zoom Controls Pills -->
            <div id="menu-camera-zoom-pills" class="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-2 z-10 pointer-events-auto">
                <button type="button" onclick="window.setMenuCameraZoomLevel && window.setMenuCameraZoomLevel(1)" class="menu-zoom-pill px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur-md transition cursor-pointer bg-amber-400 text-black shadow-md" data-zoom="1">1x</button>
                <button type="button" onclick="window.setMenuCameraZoomLevel && window.setMenuCameraZoomLevel(1.5)" class="menu-zoom-pill px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur-md transition cursor-pointer bg-black/60 text-white/90 border border-white/20 hover:bg-white/20" data-zoom="1.5">1.5x</button>
                <button type="button" onclick="window.setMenuCameraZoomLevel && window.setMenuCameraZoomLevel(2)" class="menu-zoom-pill px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur-md transition cursor-pointer bg-black/60 text-white/90 border border-white/20 hover:bg-white/20" data-zoom="2">2x</button>
                <button type="button" onclick="window.setMenuCameraZoomLevel && window.setMenuCameraZoomLevel(3)" class="menu-zoom-pill px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur-md transition cursor-pointer bg-black/60 text-white/90 border border-white/20 hover:bg-white/20" data-zoom="3">3x</button>
            </div>

            <!-- Framing overlay with document corners -->
            <div id="menu-camera-framing-box" class="absolute inset-4 sm:inset-8 pointer-events-none flex flex-col items-center justify-between border-2 border-white/20 rounded-2xl p-4 shadow-2xl transition-all duration-300">
                <!-- Top corners -->
                <div class="w-full flex justify-between">
                    <div class="w-6 h-6 border-t-4 border-l-4 border-amber-400 rounded-tl-lg shadow-sm"></div>
                    <div class="w-6 h-6 border-t-4 border-r-4 border-amber-400 rounded-tr-lg shadow-sm"></div>
                </div>
                
                <div class="bg-black/70 backdrop-blur-md px-3.5 py-1.5 rounded-full text-white/95 text-[10px] sm:text-xs font-bold tracking-wide flex items-center gap-1.5 shadow-lg border border-white/10">
                    <i class="fa-solid fa-expand text-amber-400"></i>
                    <span id="menu-camera-orient-hint">Pinch or tap zoom • Align page</span>
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
        showToast("⚠️ Please select a store first before taking a photo.");
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
        showToast("⚠️ In-app camera is not supported in this browser. Opening camera...");
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
    currentCameraZoom = 1;
    updateTorchBtnUi(false);
    updateZoomPillsUi(1);

    // Fast, responsive stream negotiation: 1080p ideal (negotiates in <300ms vs 4K stalls)
    const constraintSets = [
        {
            audio: false,
            video: {
                facingMode: { ideal: activeCameraFacingMode },
                width: { ideal: 1920, max: 2560 },
                height: { ideal: 1080, max: 1440 }
            }
        },
        {
            audio: false,
            video: {
                facingMode: { ideal: activeCameraFacingMode },
                width: { ideal: 1280 },
                height: { ideal: 720 }
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
            // Fallback to next constraints
        }
    }

    if (!stream) {
        showToast("⚠️ Cannot access the camera. Use the native camera...");
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

    // Track capabilities: Torch, Zoom, and continuous auto-focus
    const track = stream.getVideoTracks()[0];
    if (track) {
        try {
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};
            cameraZoomCapabilities = capabilities.zoom || null;

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

    // Attach pinch-to-zoom handlers on viewfinder
    attachViewfinderPinchToZoom();

    // Start real-time auto-orientation sensor & screen detection
    startAutoOrientationDetection();
}

function attachViewfinderPinchToZoom() {
    const viewfinder = document.getElementById('menu-camera-viewfinder');
    if (!viewfinder || viewfinder.dataset.pinchBound) return;
    viewfinder.dataset.pinchBound = "true";

    viewfinder.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            touchStartDistance = Math.hypot(dx, dy);
            touchStartZoom = currentCameraZoom;
        }
    }, { passive: true });

    viewfinder.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && touchStartDistance > 0) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const currentDist = Math.hypot(dx, dy);
            const scale = currentDist / touchStartDistance;
            let targetZoom = Math.min(3, Math.max(1, touchStartZoom * scale));
            setMenuCameraZoomLevel(targetZoom, false);
        }
    }, { passive: true });

    viewfinder.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
            touchStartDistance = 0;
        }
    }, { passive: true });
}

export async function setMenuCameraZoomLevel(targetZoom, updatePills = true) {
    currentCameraZoom = Math.max(1, Math.min(3, Number(targetZoom) || 1));
    const video = document.getElementById('menu-camera-video');

    if (activeCameraStream) {
        const track = activeCameraStream.getVideoTracks()[0];
        if (track && cameraZoomCapabilities && track.applyConstraints) {
            try {
                const minZ = cameraZoomCapabilities.min || 1;
                const maxZ = cameraZoomCapabilities.max || 3;
                const clampedHw = Math.min(maxZ, Math.max(minZ, currentCameraZoom));
                await track.applyConstraints({ advanced: [{ zoom: clampedHw }] });
                if (video) video.style.transform = 'scale(1)';
                if (updatePills) updateZoomPillsUi(currentCameraZoom);
                return;
            } catch(e) {}
        }
    }

    // Digital CSS zoom fallback
    if (video) {
        video.style.transform = `scale(${currentCameraZoom})`;
    }
    if (updatePills) updateZoomPillsUi(currentCameraZoom);
}

function updateZoomPillsUi(zoomLevel) {
    const pills = document.querySelectorAll('.menu-zoom-pill');
    pills.forEach(pill => {
        const pZoom = parseFloat(pill.getAttribute('data-zoom'));
        if (Math.abs(pZoom - zoomLevel) < 0.25) {
            pill.className = "menu-zoom-pill px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur-md transition cursor-pointer bg-amber-400 text-black shadow-md";
        } else {
            pill.className = "menu-zoom-pill px-2.5 py-1 rounded-full text-[11px] font-bold backdrop-blur-md transition cursor-pointer bg-black/60 text-white/90 border border-white/20 hover:bg-white/20";
        }
    });
}

let orientationListenerActive = false;
let lastDetectedGamma = 0;

function handleDeviceOrientation(e) {
    if (!e) return;
    if (typeof e.gamma === 'number') lastDetectedGamma = e.gamma;

    // Check system screen orientation if available
    if (window.screen?.orientation?.type) {
        if (window.screen.orientation.type.includes('landscape')) {
            applyCameraOrientationMode('landscape', true);
            return;
        }
        if (window.screen.orientation.type.includes('portrait')) {
            applyCameraOrientationMode('portrait', true);
            return;
        }
    }

    // Check window inner aspect ratio
    if (window.innerWidth > window.innerHeight) {
        applyCameraOrientationMode('landscape', true);
        return;
    }

    // Accelerometer / Gyroscope check (works when screen orientation is locked to portrait)
    const absGamma = Math.abs(e.gamma || 0);
    const absBeta = Math.abs(e.beta || 0);

    // When held sideways horizontally:
    if (absGamma > 45 && absBeta < 65) {
        applyCameraOrientationMode('landscape', true);
    } 
    // When held upright vertically:
    else if (absBeta > 35 && absGamma < 35) {
        applyCameraOrientationMode('portrait', true);
    }
}

function handleScreenOrientationChange() {
    const isLandscape = (window.screen?.orientation?.type?.includes('landscape')) || (window.innerWidth > window.innerHeight);
    applyCameraOrientationMode(isLandscape ? 'landscape' : 'portrait', true);
}

function startAutoOrientationDetection() {
    if (orientationListenerActive) return;
    orientationListenerActive = true;
    window.addEventListener('deviceorientation', handleDeviceOrientation, { passive: true });
    window.addEventListener('resize', handleScreenOrientationChange, { passive: true });
    if (window.screen?.orientation?.addEventListener) {
        window.screen.orientation.addEventListener('change', handleScreenOrientationChange);
    }
    handleScreenOrientationChange();
}

function stopAutoOrientationDetection() {
    if (!orientationListenerActive) return;
    orientationListenerActive = false;
    window.removeEventListener('deviceorientation', handleDeviceOrientation);
    window.removeEventListener('resize', handleScreenOrientationChange);
    if (window.screen?.orientation?.removeEventListener) {
        window.screen.orientation.removeEventListener('change', handleScreenOrientationChange);
    }
}

export function applyCameraOrientationMode(mode, isAuto = false) {
    if (activeCameraOrientation === mode && document.getElementById('menu-camera-framing-box')?.dataset.orient === mode) {
        return;
    }
    activeCameraOrientation = mode;
    const framingBox = document.getElementById('menu-camera-framing-box');
    const orientBtn = document.getElementById('menu-camera-orient-btn');
    const orientHint = document.getElementById('menu-camera-orient-hint');

    if (activeCameraOrientation === 'landscape') {
        if (framingBox) {
            framingBox.dataset.orient = 'landscape';
            framingBox.className = "absolute inset-x-3 sm:inset-x-8 inset-y-16 sm:inset-y-20 pointer-events-none flex flex-col items-center justify-between border-2 border-amber-400 rounded-2xl p-4 shadow-2xl transition-all duration-300";
        }
        if (orientBtn) {
            orientBtn.className = "w-8 h-8 rounded-full bg-amber-400 text-black flex items-center justify-center text-xs transition cursor-pointer shadow-md";
            orientBtn.innerHTML = '<i class="fa-solid fa-mobile-screen-button rotate-90"></i>';
            orientBtn.title = "Orientation: Landscape (Auto-detected)";
        }
        if (orientHint) {
            orientHint.innerHTML = `<span class="text-amber-400 font-bold">🔄 Landscape (Auto)</span> • Fit wide tarpaulin/board`;
        }
        if (!isAuto) showToast("🔄 Landscape Mode: Frame the wide menu");
    } else {
        if (framingBox) {
            framingBox.dataset.orient = 'portrait';
            framingBox.className = "absolute inset-4 sm:inset-8 pointer-events-none flex flex-col items-center justify-between border-2 border-white/20 rounded-2xl p-4 shadow-2xl transition-all duration-300";
        }
        if (orientBtn) {
            orientBtn.className = "w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs transition cursor-pointer";
            orientBtn.innerHTML = '<i class="fa-solid fa-mobile-screen-button"></i>';
            orientBtn.title = "Orientation: Portrait (Auto-detected)";
        }
        if (orientHint) {
            orientHint.innerHTML = `<span class="text-white font-bold">📱 Portrait (Auto)</span> • Standard page framing`;
        }
        if (!isAuto) showToast("📱 Portrait Mode: Standard page framing");
    }
}

export function toggleMenuCameraOrientation() {
    const nextMode = activeCameraOrientation === 'portrait' ? 'landscape' : 'portrait';
    applyCameraOrientationMode(nextMode, false);
}

async function ensurePhotoOrientation(blob, desiredOrientation, tiltGamma) {
    if (!blob) return blob;
    try {
        let w = 0, h = 0, imgSource = null;
        if (typeof createImageBitmap === 'function') {
            try {
                imgSource = await createImageBitmap(blob);
                w = imgSource.width;
                h = imgSource.height;
            } catch(e) {}
        }
        if (!imgSource) {
            imgSource = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = URL.createObjectURL(blob);
            });
            w = imgSource.naturalWidth || imgSource.width;
            h = imgSource.naturalHeight || imgSource.height;
        }

        const isLandscape = w > h;
        const needsRotateToLandscape = (desiredOrientation === 'landscape' && !isLandscape);
        const needsRotateToPortrait = (desiredOrientation === 'portrait' && isLandscape);

        if (!needsRotateToLandscape && !needsRotateToPortrait) {
            if (imgSource.close) imgSource.close();
            return blob;
        }

        const canvas = document.createElement('canvas');
        canvas.width = h;
        canvas.height = w;
        const ctx = canvas.getContext('2d', { alpha: false });

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);

        // Rotation angle
        let angle = 90 * (Math.PI / 180);
        if (typeof tiltGamma === 'number' && tiltGamma < 0) {
            angle = -90 * (Math.PI / 180);
        }

        ctx.rotate(angle);
        ctx.drawImage(imgSource, -w / 2, -h / 2);
        ctx.restore();
        if (imgSource.close) imgSource.close();

        return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    } catch(err) {
        console.warn('[MenuCamera] Orientation adjustment error:', err);
        return blob;
    }
}

export async function handleNativeMenuCameraCapture(event) {
    const file = event?.target?.files?.[0];
    if (!file || !activeGalleryStore) return;

    showToast("📸 Processing native high-res camera photo...");
    try {
        const optimizedBlob = await compressImageToBlob(file, 2400, 0.90, false);
        const pagesSnap = currentGalleryPages || [];
        const nextIdx = pagesSnap.length + 1;
        const caption = `Menu Page ${nextIdx}`;

        await uploadSingleMenuBlob(optimizedBlob, caption, activeGalleryStore.key, activeGalleryStore.name);
        showToast(`✅ High-Res photo saved for ${activeGalleryStore.name}!`);
        showSideNotification("MENU PAGE ADDED", `${activeGalleryStore.name} (${caption})`, "fa-camera", "text-amber-400", "border-amber-500");
        closeMenuCameraScanner();
        openStoreMenuGalleryModal(activeGalleryStore.name, activeGalleryStore.key);
    } catch(err) {
        console.error('[MenuCamera] Native camera upload error:', err);
        showToast("❌ Failed to save: " + (err.message || err));
    } finally {
        if (event.target) event.target.value = "";
    }
}

export async function toggleMenuCameraTorch() {
    if (!activeCameraStream) return;
    const track = activeCameraStream.getVideoTracks()[0];
    if (!track) return;

    try {
        const capabilities = track.getCapabilities ? track.getCapabilities() : {};
        if (!capabilities.torch) {
            showToast("ℹ️ Flashlight is not supported on this camera.");
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
    stopAutoOrientationDetection();

    const modal = document.getElementById('store-menu-camera-modal');
    if (modal) modal.classList.add('hidden');

    if (activeCameraStream) {
        activeCameraStream.getTracks().forEach(t => t.stop());
        activeCameraStream = null;
    }

    const video = document.getElementById('menu-camera-video');
    if (video) {
        video.srcObject = null;
        video.style.transform = 'scale(1)';
    }

    const reviewContainer = document.getElementById('menu-camera-review-container');
    if (reviewContainer) reviewContainer.classList.add('hidden');

    capturedSnapshotBlob = null;
    isTorchOn = false;
    currentCameraZoom = 1;
    updateTorchBtnUi(false);
}

export async function takeMenuCameraSnapshot() {
    const video = document.getElementById('menu-camera-video');
    if (!video || !activeCameraStream) return;

    const track = activeCameraStream.getVideoTracks()[0];
    let capturedBlob = null;

    // 1. Hardware Still Photo Capture (Uncompressed Full-Sensor Capture)
    if (typeof window.ImageCapture === 'function' && track) {
        try {
            const imageCapture = new window.ImageCapture(track);
            capturedBlob = await imageCapture.takePhoto();
        } catch(icErr) {
            console.warn('[MenuCamera] Hardware still capture fallback to canvas:', icErr);
        }
    }

    // 2. High-Clarity Canvas Fallback (With digital zoom crop if CSS zoom active)
    if (!capturedBlob) {
        const vWidth = video.videoWidth || 1920;
        const vHeight = video.videoHeight || 1080;

        const canvas = document.createElement('canvas');
        canvas.width = vWidth;
        canvas.height = vHeight;
        const ctx = canvas.getContext('2d', { alpha: false });

        if (currentCameraZoom > 1 && (!cameraZoomCapabilities || !track.getCapabilities().zoom)) {
            // Crop center based on digital zoom factor
            const cropW = vWidth / currentCameraZoom;
            const cropH = vHeight / currentCameraZoom;
            const cropX = (vWidth - cropW) / 2;
            const cropY = (vHeight - cropH) / 2;
            ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, vWidth, vHeight);
        } else {
            ctx.drawImage(video, 0, 0, vWidth, vHeight);
        }

        capturedBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    }

    if (capturedBlob) {
        // Automatically ensure photo dimensions and orientation match the phone orientation
        capturedBlob = await ensurePhotoOrientation(capturedBlob, activeCameraOrientation, lastDetectedGamma);
    }

    if (!capturedBlob) {
        showToast("❌ Failed to capture photo.");
        return;
    }

    capturedSnapshotBlob = capturedBlob;

    // Instantly display preview with ZERO network latency
    const previewImg = document.getElementById('menu-camera-preview-img');
    const reviewContainer = document.getElementById('menu-camera-review-container');
    const captionInput = document.getElementById('menu-camera-caption-input');
    const pageLabel = document.getElementById('menu-camera-review-page-label');

    if (previewImg) previewImg.src = URL.createObjectURL(capturedBlob);

    const nextIdx = (currentGalleryPages ? currentGalleryPages.length : 0) + 1;
    if (captionInput) captionInput.value = `Menu Page ${nextIdx}`;
    if (pageLabel) pageLabel.innerText = `Page ${nextIdx} Preview`;
    if (reviewContainer) reviewContainer.classList.remove('hidden');
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
        // High-Quality Single-Pass Upload (2400px, 0.90 quality - avoids blurry re-compression)
        const optimizedBlob = await compressImageToBlob(capturedSnapshotBlob, 2400, 0.90, false);
        const result = await uploadSingleMenuBlob(optimizedBlob, captionText, activeGalleryStore.key, activeGalleryStore.name);

        showToast(`✅ Saved ${captionText} for ${activeGalleryStore.name}!`);
        showSideNotification("MENU PAGE ADDED", `${activeGalleryStore.name} (${captionText})`, "fa-camera", "text-amber-400", "border-amber-500");

        // Return to live camera so rider can capture next page or exit
        retakeMenuCameraSnapshot();
        const nextCaptionInput = document.getElementById('menu-camera-caption-input');
        if (nextCaptionInput) nextCaptionInput.value = `Menu Page ${result.count + 1}`;
        showToast("📸 Capture next page or tap Back.");
    } catch(err) {
        console.error('[MenuCamera] Upload error:', err);
        showToast("❌ Failed to save photo: " + (err.message || "Upload failed"));
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
    modal.style.zIndex = '1000010';

    const cleanName = (storeName || "Store").trim();
    const normName = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
    let galleryKey = (compositeKey || cleanName).toLowerCase().replace(/[^a-z0-9]/g, '');

    // Resolve true gallery key if present in metadata or candidate forms
    const candidateKeys = [
        galleryKey,
        normName,
        'stores' + normName,
        'stores_' + normName,
        (compositeKey || '').replace(/^[a-z0-9]+_stores_?/, ''),
        (compositeKey || '').replace(/^[a-z0-9]+_/, '')
    ].map(k => (k || '').trim()).filter(Boolean);

    for (const k of candidateKeys) {
        if (storeMenuMetadataMap[k] && storeMenuMetadataMap[k].pageCount > 0) {
            galleryKey = k;
            break;
        }
    }

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
            <span>No saved photo menu for this restaurant.</span>
            <span class="text-[10px] text-gray-400">Take a photo of the menu using the high-resolution camera or upload from gallery.</span>
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

        showToast(`✅ Uploaded ${files.length} menu page(s) for ${activeGalleryStore.name}!`);
        showSideNotification("MENU UPLOADED", `${activeGalleryStore.name} (+${files.length} pages)`, "fa-book-open", "text-emerald-400", "border-emerald-500");
    } catch(err) {
        console.error("Upload error:", err);
        showToast("❌ Failed to save photo: " + (err.message || "Upload failed"));
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
            showToast("⚠️ No saved photos found.");
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
        showToast("⚠️ Failed to download complete menu: " + (err.message || "Error"));
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
    const storeName = activeGalleryStore?.name || "Store";
    dispatchMenuPagesToSend([{ imageUrl, caption: caption || "Menu Page" }], storeName);
}

export function sendSelectedMenuPagesToCustomer() {
    if (selectedMenuPageIndices.size === 0) {
        showToast("⚠️ Please select the menu pages to send first.");
        return;
    }
    const storeName = activeGalleryStore?.name || "Store";
    const pages = Array.from(selectedMenuPageIndices).sort((a, b) => a - b).map(idx => {
        const p = currentGalleryPages[idx];
        return {
            imageUrl: p.imageUrl || p.url || p.photoUrl || p.downloadUrl || p.image || "",
            caption: p.caption || `Page ${idx + 1}`
        };
    }).filter(p => p.imageUrl);
    dispatchMenuPagesToSend(pages, storeName);
}

export function sendAllMenuPagesToCustomer() {
    if (!currentGalleryPages || currentGalleryPages.length === 0) {
        showToast("⚠️ No saved photos for this store.");
        return;
    }
    const storeName = activeGalleryStore?.name || "Store";
    const pages = currentGalleryPages.map((p, idx) => ({
        imageUrl: p.imageUrl || p.url || p.photoUrl || p.downloadUrl || p.image || "",
        caption: p.caption || `Page ${idx + 1}`
    })).filter(p => p.imageUrl);
    dispatchMenuPagesToSend(pages, storeName);
}

export async function dispatchMenuPagesToSend(pagesToSend, storeName = "") {
    if (!pagesToSend || pagesToSend.length === 0) return;

    const resolvedStoreName = storeName || activeGalleryStore?.name || "Store";

    // Check if rider is currently chatting inside rider-chat-modal
    const chatModal = document.getElementById('rider-chat-modal') || document.getElementById('rider-customer-chat-modal');
    const isChatOpen = chatModal && !chatModal.classList.contains('hidden');
    const activeCustId = (typeof window.getActiveRiderChatCustId === 'function') 
        ? window.getActiveRiderChatCustId() 
        : window.activeRiderChatCustId;

    const validActiveCustId = (activeCustId && activeCustId !== 'undefined' && activeCustId !== 'null') ? String(activeCustId).trim() : null;

    if (isChatOpen && validActiveCustId) {
        const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";
        const confirmed = await askMenuSendConfirmation({
            storeName: resolvedStoreName,
            pageCount: pagesToSend.length,
            custName: custName
        });
        if (confirmed) {
            executeSendMenuPages(validActiveCustId, pagesToSend, custName, resolvedStoreName);
        }
        return;
    }

    // Otherwise open customer picker modal
    openMenuCustomerRecipientPicker(pagesToSend, resolvedStoreName);
}

export async function executeSendMenuPages(targetCustId, pages, custDisplayName = "Customer", storeName = "Store") {
    const cleanCustId = String(targetCustId || '').trim();
    if (!cleanCustId || cleanCustId === 'undefined' || cleanCustId === 'null' || !pages || pages.length === 0) {
        showToast("⚠️ Cannot select customer. Please try again.");
        return;
    }

    closeMenuCustomerRecipientPicker();
    closeStoreMenuGalleryModal();
    closeStoreMenuPickerFromChat();
    const total = pages.length;
    showToast(`📤 Starting to send ${total} menu picture(s) to ${custDisplayName}...`);

    let sent = 0;
    for (let i = 0; i < total; i++) {
        const p = pages[i];
        const pageNum = i + 1;
        const isLastPage = (i === total - 1);
        const imgUrl = p.imageUrl || p.url || p.photoUrl || p.downloadUrl || p.image || "";
        if (!imgUrl) {
            console.warn(`[MenuSend] Skipping page ${pageNum}: Missing image URL`, p);
            continue;
        }

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
                ok = await sendFn(cleanCustId, imgUrl, caption);
            } else if (db) {
                // Direct RTDB fallback
                const riderName = appState.riderName || localStorage.getItem('riderName') || "Rider";
                const now = Date.now();
                const fallbackMsg = {
                    sender: riderName,
                    senderType: 'rider',
                    text: `📋 Menu: ${caption}`,
                    imageUrl: imgUrl,
                    type: 'image',
                    timestamp: now,
                    isRider: true,
                    status: 'sent',
                    channel: cleanCustId.startsWith('fb_') ? 'messenger' : 'web'
                };
                await db.ref(`customerChats/${cleanCustId}/messages`).push(fallbackMsg);
                await db.ref(`customerChats/${cleanCustId}/metadata`).update({
                    lastMessage: `You: 📋 ${caption}`,
                    lastUpdated: now,
                    unreadForRider: false
                });
                ok = true;
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
            await new Promise(r => setTimeout(r, 800));
        }
    }

    if (sent > 0) {
        showToast(`✅ Successfully sent ${sent} of ${total} picture(s) to ${custDisplayName}!`);
        showSideNotification("MENU SENT", `${sent} page(s) sent to ${custDisplayName}`, "fa-paper-plane", "text-emerald-400", "border-emerald-500");
        showMenuSentConfirmationModal(custDisplayName, cleanCustId, sent, storeName);
    } else {
        showToast(`❌ Failed to send menu photos to ${custDisplayName}.`);
    }

    clearMenuPageSelections();
}

export function getOrCreateMenuSendConfirmModal() {
    let modal = document.getElementById('menu-send-confirm-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'menu-send-confirm-modal';
        modal.className = 'fixed inset-0 z-[1000030] flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 hidden';
        modal.style.zIndex = '1000030';
        modal.innerHTML = `
        <div class="bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-800 rounded-3xl max-w-sm w-full p-5 shadow-2xl flex flex-col items-center text-center animate-scaleUp">
            <div class="w-14 h-14 rounded-full bg-orange-500/10 text-orange-600 dark:text-orange-400 flex items-center justify-center text-2xl mb-3 border border-orange-500/20 shadow-sm">
                <i class="fa-solid fa-paper-plane"></i>
            </div>
            
            <h3 id="menu-send-confirm-title" class="font-black text-base text-gray-900 dark:text-white mb-1.5">Send Store Menu?</h3>
            
            <div class="flex items-center gap-1.5 mb-3 flex-wrap justify-center">
                <div id="menu-send-confirm-store" class="inline-flex items-center text-[11px] font-bold text-orange-700 dark:text-orange-400 bg-orange-500/10 border border-orange-500/30 px-2.5 py-1 rounded-full">
                    <i class="fa-solid fa-store mr-1.5 text-orange-500"></i> <span id="menu-send-confirm-store-name">Store</span>
                </div>
                <div id="menu-send-confirm-recipient" class="inline-flex items-center text-[11px] font-bold text-blue-700 dark:text-blue-400 bg-blue-500/10 border border-blue-500/30 px-2.5 py-1 rounded-full">
                    <i class="fa-solid fa-user mr-1.5 text-blue-500"></i> <span id="menu-send-confirm-cust-name">Customer</span>
                </div>
            </div>

            <p id="menu-send-confirm-desc" class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed mb-5">
                Send menu pictures to this customer?
            </p>

            <div class="flex items-center gap-2 w-full">
                <button type="button" id="menu-send-confirm-cancel-btn" class="flex-1 bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-200 font-bold text-xs py-2.5 px-3 rounded-xl transition active:scale-95 cursor-pointer">
                    Cancel
                </button>
                <button type="button" id="menu-send-confirm-proceed-btn" class="flex-1 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-black text-xs py-2.5 px-3 rounded-xl transition active:scale-95 shadow-md flex items-center justify-center gap-1.5 cursor-pointer">
                    <i class="fa-solid fa-paper-plane text-xs"></i> Send Menu
                </button>
            </div>
        </div>`;
        document.body.appendChild(modal);
    }
    return modal;
}

export function askMenuSendConfirmation({ storeName = "Store", pageCount = 1, custName = "Customer" }) {
    return new Promise((resolve) => {
        const modal = getOrCreateMenuSendConfirmModal();
        if (modal.parentElement !== document.body) document.body.appendChild(modal);
        modal.style.zIndex = '1000030';

        const storeEl = document.getElementById('menu-send-confirm-store-name');
        const custEl = document.getElementById('menu-send-confirm-cust-name');
        const descEl = document.getElementById('menu-send-confirm-desc');
        const cancelBtn = document.getElementById('menu-send-confirm-cancel-btn');
        const proceedBtn = document.getElementById('menu-send-confirm-proceed-btn');

        const cleanStore = storeName || "Store";
        const cleanCust = custName || "Customer";
        const pageText = `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`;

        if (storeEl) storeEl.innerText = cleanStore;
        if (custEl) custEl.innerText = cleanCust;
        if (descEl) {
            descEl.innerHTML = `Send all <strong>${pageText}</strong> of <strong>${escapeHtml(cleanStore)}</strong> to <strong>${escapeHtml(cleanCust)}</strong>?`;
        }

        const cleanup = (result) => {
            modal.classList.add('hidden');
            if (cancelBtn) cancelBtn.onclick = null;
            if (proceedBtn) proceedBtn.onclick = null;
            modal.onclick = null;
            resolve(result);
        };

        if (cancelBtn) {
            cancelBtn.onclick = (e) => {
                e.stopPropagation();
                cleanup(false);
            };
        }
        if (proceedBtn) {
            proceedBtn.onclick = (e) => {
                e.stopPropagation();
                cleanup(true);
            };
        }
        modal.onclick = (e) => {
            if (e.target === modal) cleanup(false);
        };

        modal.classList.remove('hidden');
    });
}

export function closeMenuSendConfirmModal() {
    const modal = document.getElementById('menu-send-confirm-modal');
    if (modal) modal.classList.add('hidden');
}

function getOrCreateMenuSentConfirmationModal() {
    let modal = document.getElementById('menu-sent-confirmation-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'menu-sent-confirmation-modal';
        modal.className = 'fixed inset-0 z-[1000020] flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 hidden';
        modal.style.zIndex = '1000020';
        modal.innerHTML = `
        <div class="bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-800 rounded-3xl max-w-sm w-full p-5 shadow-2xl flex flex-col items-center text-center animate-scaleUp">
            <div class="w-14 h-14 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 flex items-center justify-center text-2xl mb-3 border border-emerald-500/20 shadow-sm animate-bounce">
                <i class="fa-solid fa-circle-check"></i>
            </div>
            
            <h3 id="menu-sent-confirm-title" class="font-black text-base text-gray-900 dark:text-white mb-1">Menu Sent to Customer!</h3>
            
            <div id="menu-sent-confirm-recipient" class="inline-flex items-center text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-full mb-3">
                <i class="fa-solid fa-user-check mr-1.5 text-emerald-500"></i> Customer Name
            </div>

            <p id="menu-sent-confirm-desc" class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed mb-5">
                The restaurant menu pictures have been dispatched successfully.
            </p>

            <div class="flex items-center gap-2 w-full">
                <button type="button" id="menu-sent-confirm-open-chat" class="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-xs py-2.5 px-3 rounded-xl transition active:scale-95 shadow-md flex items-center justify-center gap-1.5 cursor-pointer">
                    <i class="fa-solid fa-comments text-xs"></i> View in Chat
                </button>
                <button type="button" onclick="window.closeMenuSentConfirmationModal && window.closeMenuSentConfirmationModal()" class="bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-200 font-bold text-xs py-2.5 px-4 rounded-xl transition active:scale-95 cursor-pointer">
                    Done
                </button>
            </div>
        </div>`;
        document.body.appendChild(modal);
    }
    return modal;
}

export function showMenuSentConfirmationModal(custName, custId, count, storeName) {
    const modal = getOrCreateMenuSentConfirmationModal();
    const descEl = document.getElementById('menu-sent-confirm-desc');
    const recipientBadge = document.getElementById('menu-sent-confirm-recipient');
    const openChatBtn = document.getElementById('menu-sent-confirm-open-chat');

    const cleanCustName = custName || "Customer";
    const cleanStore = storeName || "Store";
    const pageText = `${count} ${count === 1 ? 'page' : 'pages'}`;

    if (descEl) {
        descEl.innerHTML = `Successfully dispatched <strong>${pageText}</strong> of <strong>${escapeHtml(cleanStore)}</strong> to <strong>${escapeHtml(cleanCustName)}</strong>.`;
    }
    if (recipientBadge) {
        recipientBadge.innerHTML = `<i class="fa-solid fa-user-check text-emerald-500 mr-1.5"></i> ${escapeHtml(cleanCustName)}`;
    }
    if (openChatBtn) {
        openChatBtn.onclick = () => {
            closeMenuSentConfirmationModal();
            if (typeof window.openRiderCustomerChatModal === 'function' && custId) {
                window.openRiderCustomerChatModal(custId, cleanCustName);
            }
        };
    }

    if (modal) {
        if (modal.parentElement !== document.body) document.body.appendChild(modal);
        modal.style.zIndex = '1000020';
        modal.classList.remove('hidden');
    }
}

export function closeMenuSentConfirmationModal() {
    const modal = document.getElementById('menu-sent-confirmation-modal');
    if (modal) modal.classList.add('hidden');
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

export function openMenuCustomerRecipientPicker(pagesToSend, storeName = "") {
    menuRecipientPickerPendingPages = pagesToSend || [];
    const modal = getOrCreateMenuCustomerRecipientPickerModal();
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    } else {
        document.body.appendChild(modal);
    }
    modal.style.zIndex = '1000003';

    const sub = document.getElementById('menu-recipient-modal-sub');
    const resolvedStore = storeName || activeGalleryStore?.name || "Store";
    menuRecipientPickerPendingStoreName = resolvedStore;
    if (sub) {
        sub.innerText = `Sending ${menuRecipientPickerPendingPages.length} page(s) from ${resolvedStore}`;
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
        container.innerHTML = `<div class="text-center text-gray-400 text-xs py-8 italic">No active customer thread found.</div>`;
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

export async function handleSelectMenuCustomerRecipient(custId, custName) {
    const cleanId = String(custId || '').trim();
    if (!cleanId || cleanId === 'undefined' || cleanId === 'null') {
        showToast("⚠️ Invalid customer ID. Please reselect the customer.");
        return;
    }
    if (!menuRecipientPickerPendingPages || menuRecipientPickerPendingPages.length === 0) {
        closeMenuCustomerRecipientPicker();
        return;
    }

    const storeName = menuRecipientPickerPendingStoreName || activeGalleryStore?.name || "Store";
    const pages = [...menuRecipientPickerPendingPages];
    const count = pages.length;

    const confirmed = await askMenuSendConfirmation({
        storeName: storeName,
        pageCount: count,
        custName: custName
    });
    if (!confirmed) return;

    closeMenuCustomerRecipientPicker();
    executeSendMenuPages(cleanId, pages, custName, storeName);
}

function getOrCreateChatStoreMenuPickerModal() {
    let modal = document.getElementById('chat-store-menu-picker-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'chat-store-menu-picker-modal';
        modal.className = 'fixed inset-0 z-[1000005] flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 hidden';
        modal.style.zIndex = '1000005';
        modal.innerHTML = `
        <div class="bg-white dark:bg-[#18181b] border border-gray-200 dark:border-gray-800 rounded-3xl max-w-sm sm:max-w-md w-full max-h-[85vh] shadow-2xl flex flex-col overflow-hidden animate-scaleUp">
            <!-- Header -->
            <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800/80 bg-gray-50/70 dark:bg-black/30">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-9 h-9 rounded-2xl bg-orange-500/10 text-orange-600 dark:text-orange-400 flex items-center justify-center text-sm font-bold shrink-0 shadow-2xs border border-orange-500/20">
                        <i class="fa-solid fa-book-open"></i>
                    </div>
                    <div class="min-w-0">
                        <h3 class="font-black text-xs sm:text-sm text-gray-900 dark:text-white truncate">Restaurant Menu Directory</h3>
                        <p id="chat-store-picker-subtitle" class="text-[10px] text-gray-500 dark:text-gray-400 truncate">Pick a store to send menu photos</p>
                    </div>
                </div>
                <button type="button" onclick="window.closeStoreMenuPickerFromChat && window.closeStoreMenuPickerFromChat()" class="w-7 h-7 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center justify-center text-xs transition active:scale-95 cursor-pointer">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>

            <!-- Search Bar -->
            <div class="p-2.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-black/10">
                <div class="relative flex items-center">
                    <i class="fa-solid fa-magnifying-glass absolute left-3 text-gray-400 text-xs"></i>
                    <input type="text" id="chat-store-picker-search" placeholder="Search restaurant or store name..." oninput="window.filterChatStoreMenuPicker && window.filterChatStoreMenuPicker()" class="w-full bg-white dark:bg-black/40 border border-gray-200 dark:border-gray-700 rounded-xl pl-8 pr-3 py-2 text-xs text-gray-900 dark:text-white outline-none focus:border-orange-500">
                </div>
            </div>

            <!-- Stores List Body -->
            <div id="chat-store-picker-list" class="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2 max-h-[58vh]">
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
    }
    modal.style.zIndex = '1000005';
    const subtitle = document.getElementById('chat-store-picker-subtitle');
    const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";
    if (subtitle) {
        subtitle.innerHTML = `Sending menu to <strong class="text-orange-600 dark:text-orange-400">${escapeHtml(custName)}</strong>`;
    }
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
        const cached = await idbGet('directory', 'all_directory_records');
        if (cached && Array.isArray(cached)) {
            storeList = cached.filter(r => (r.type || '').toLowerCase() === 'stores');
        }
    } catch(e) {}

    if (storeList.length === 0 && globalState.records && Array.isArray(globalState.records)) {
        storeList = globalState.records.filter(r => (r.type || '').toLowerCase() === 'stores');
    }

    if (storeList.length === 0) {
        try {
            const raw = localStorage.getItem('lokalex_directory_cache_v2');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    storeList = parsed.filter(r => (r.type || '').toLowerCase() === 'stores');
                }
            }
        } catch(e) {}
    }

    if (storeList.length === 0 && globalState.directoryCache && globalState.directoryCache.stores) {
        storeList = globalState.directoryCache.stores;
    }

    // DEDUPLICATION: Use a unified map keyed by normalized store name!
    // This prevents duplicate cards (e.g. Chowking x2, Chooks To Go x2)
    const storeMap = new Map();
    const normalizeKey = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // 1. Populate from directory store records
    storeList.forEach(s => {
        const name = (s.name || '').trim();
        if (!name) return;
        const normKey = normalizeKey(name);
        if (!storeMap.has(normKey)) {
            storeMap.set(normKey, {
                name: name,
                compositeKey: s.compositeKey || s.key || normKey,
                metaKey: '',
                pageCount: 0
            });
        } else {
            const existing = storeMap.get(normKey);
            if (!existing.compositeKey && s.compositeKey) {
                existing.compositeKey = s.compositeKey;
            }
        }
    });

    // 2. Merge metadata entries from Firebase RTDB (storeMenuMetadataMap)
    Object.entries(storeMenuMetadataMap).forEach(([metaKey, meta]) => {
        if (!meta) return;
        const storeName = (meta.storeName || '').trim();
        if (!storeName) return;
        const normKey = normalizeKey(storeName);
        const pageCount = meta.pageCount || 0;

        if (storeMap.has(normKey)) {
            const existing = storeMap.get(normKey);
            existing.metaKey = metaKey;
            if (pageCount > (existing.pageCount || 0)) {
                existing.pageCount = pageCount;
            }
            if (meta.updatedAt) existing.updatedAt = meta.updatedAt;
        } else {
            storeMap.set(normKey, {
                name: storeName,
                compositeKey: metaKey,
                metaKey: metaKey,
                pageCount: pageCount,
                updatedAt: meta.updatedAt
            });
        }
    });

    // 3. Resolve metadata keys for any stores still missing metaKey
    storeMap.forEach((entry, normKey) => {
        if (!entry.pageCount || !entry.metaKey) {
            const candidateKeys = [
                entry.metaKey,
                normalizeKey(entry.compositeKey),
                normKey,
                'stores' + normKey,
                'stores_' + normKey
            ].filter(Boolean);

            for (const k of candidateKeys) {
                if (storeMenuMetadataMap[k] && storeMenuMetadataMap[k].pageCount > 0) {
                    entry.metaKey = k;
                    entry.pageCount = storeMenuMetadataMap[k].pageCount;
                    if (storeMenuMetadataMap[k].updatedAt) entry.updatedAt = storeMenuMetadataMap[k].updatedAt;
                    break;
                }
            }
        }
    });

    const q = (searchQuery || "").trim().toLowerCase();
    const storesWithMenu = [];
    const storesWithoutMenu = [];

    storeMap.forEach((s) => {
        const name = s.name;
        if (q && !name.toLowerCase().includes(q)) return;

        if (s.pageCount > 0) {
            storesWithMenu.push(s);
        } else {
            storesWithoutMenu.push(s);
        }
    });

    storesWithMenu.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    storesWithoutMenu.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

    const combined = [...storesWithMenu, ...storesWithoutMenu];

    if (combined.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-400 text-xs py-8 italic">No stores found.</div>`;
        return;
    }

    container.innerHTML = combined.map(s => {
        const safeName = escapeHtml(s.name);
        const safeCompositeKey = escapeHtml(s.compositeKey || s.name);
        const safeMetaKey = escapeHtml(s.metaKey || '');
        const hasMenu = s.pageCount > 0;

        return `
        <div class="p-2.5 rounded-2xl border ${hasMenu ? 'bg-orange-50/50 dark:bg-orange-950/20 border-orange-200/80 dark:border-orange-500/30' : 'bg-gray-50/70 hover:bg-gray-100 dark:bg-zinc-800/40 dark:hover:bg-zinc-800 border-gray-200/70 dark:border-zinc-700/50'} flex items-center justify-between gap-2 transition">
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
                <div class="w-8 h-8 rounded-xl ${hasMenu ? 'bg-orange-500 text-white shadow-2xs' : 'bg-gray-200 dark:bg-zinc-700 text-gray-500 dark:text-gray-300'} flex items-center justify-center font-bold text-xs shrink-0">
                    <i class="fa-solid fa-store"></i>
                </div>
                <div class="min-w-0 flex-1">
                    <div class="font-black text-xs text-gray-900 dark:text-white truncate">${safeName}</div>
                    <div class="text-[10px] mt-0.5">
                        ${hasMenu 
                            ? `<span class="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1"><i class="fa-solid fa-images text-[9px]"></i> ${s.pageCount} ${s.pageCount === 1 ? 'Page' : 'Pages'} available</span>` 
                            : `<span class="text-gray-400 italic">No menu photos saved</span>`}
                    </div>
                </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                ${hasMenu ? `
                <button type="button" 
                    data-store-name="${safeName}" 
                    data-composite-key="${safeCompositeKey}" 
                    data-meta-key="${safeMetaKey}" 
                    onclick="window.handleChatStoreMenuQuickSendClick && window.handleChatStoreMenuQuickSendClick(this)" 
                    class="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white text-[10.5px] font-black px-2.5 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 shadow-xs cursor-pointer" title="Send all menu pages to customer instantly">
                    <i class="fa-solid fa-paper-plane text-[9px]"></i> Send All (${s.pageCount})
                </button>
                <button type="button" 
                    data-store-name="${safeName}" 
                    data-composite-key="${safeCompositeKey}" 
                    data-meta-key="${safeMetaKey}" 
                    onclick="window.handleChatStoreMenuViewClick && window.handleChatStoreMenuViewClick(this)" 
                    class="bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-zinc-700 text-[10.5px] font-bold px-2 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 cursor-pointer" title="Preview or select specific pages to send">
                    <i class="fa-solid fa-eye text-[9px]"></i> View
                </button>` : `
                <button type="button" 
                    data-store-name="${safeName}" 
                    data-composite-key="${safeCompositeKey}" 
                    data-meta-key="${safeMetaKey}" 
                    onclick="window.handleChatStoreMenuViewClick && window.handleChatStoreMenuViewClick(this)" 
                    class="bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-zinc-700 text-[10px] font-bold px-2 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1 cursor-pointer" title="Open gallery to add photos">
                    <i class="fa-solid fa-camera text-[9px]"></i> Add Photo
                </button>`}
            </div>
        </div>`;
    }).join('');
}

export function handleChatStoreMenuQuickSendClick(btn) {
    if (!btn) return;
    const storeName = btn.getAttribute('data-store-name') || '';
    const compositeKey = btn.getAttribute('data-composite-key') || '';
    const metaKey = btn.getAttribute('data-meta-key') || '';
    quickSendStoreMenuToActiveChat(storeName, compositeKey, metaKey);
}

export function handleChatStoreMenuViewClick(btn) {
    if (!btn) return;
    const storeName = btn.getAttribute('data-store-name') || '';
    const compositeKey = btn.getAttribute('data-composite-key') || '';
    const metaKey = btn.getAttribute('data-meta-key') || '';
    handleSelectStoreFromChatPicker(storeName, compositeKey, metaKey);
}

export function handleSelectStoreFromChatPicker(storeName, compositeKey, metaKey = '') {
    closeStoreMenuPickerFromChat();
    openStoreMenuGalleryModal(storeName, metaKey || compositeKey);
}

export async function quickSendStoreMenuToActiveChat(storeName, compositeKey, metadataKey = '') {
    const cleanName = (storeName || "Store").trim();

    const chatModal = document.getElementById('rider-chat-modal') || document.getElementById('rider-customer-chat-modal');
    const isChatOpen = chatModal && !chatModal.classList.contains('hidden');
    const activeCustId = (typeof window.getActiveRiderChatCustId === 'function') 
        ? window.getActiveRiderChatCustId() 
        : window.activeRiderChatCustId;
    const validActiveCustId = (activeCustId && activeCustId !== 'undefined' && activeCustId !== 'null') ? String(activeCustId).trim() : null;
    const custName = document.getElementById('rider-chat-cust-name')?.innerText || "Customer";

    if (!isChatOpen || !validActiveCustId) {
        showToast("⚠️ Chat is not active. Please open a customer chat first.");
        return;
    }

    showToast(`⏳ Loading ${cleanName} menu photos...`);

    let pages = [];

    // Check if current active gallery store is already loaded for this store
    if (activeGalleryStore && activeGalleryStore.name === cleanName && Array.isArray(currentGalleryPages) && currentGalleryPages.length > 0) {
        pages = [...currentGalleryPages];
    }

    const normName = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normComposite = (compositeKey || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Try candidate keys
    if (pages.length === 0) {
        const candidateKeys = Array.from(new Set([
            metadataKey,
            'stores' + normName,
            'stores_' + normName,
            normName,
            normComposite,
            compositeKey,
            (compositeKey || '').replace(/^[a-z0-9]+_stores_?/, ''),
            (compositeKey || '').replace(/^[a-z0-9]+_/, '')
        ])).map(k => (k || '').trim()).filter(Boolean);

        // 1. Check IndexedDB across all candidate keys
        for (const k of candidateKeys) {
            try {
                const cached = await idbGet('storeMenuGalleries', k);
                if (cached) {
                    if (Array.isArray(cached) && cached.length > 0) {
                        pages = cached;
                        break;
                    } else if (cached.pages && Array.isArray(cached.pages) && cached.pages.length > 0) {
                        pages = cached.pages;
                        break;
                    }
                }
            } catch(e) {}
        }

        // 2. If not found in IndexedDB, fetch from Firebase RTDB
        if (pages.length === 0 && db) {
            for (const k of candidateKeys) {
                try {
                    const snap = await db.ref(`directory/storeMenuGalleries/${k}/pages`).once('value');
                    const data = snap.val();
                    if (data && typeof data === 'object') {
                        pages = Object.entries(data).map(([id, item]) => ({
                            id,
                            ...(item || {})
                        }));
                        if (pages.length > 0) break;
                    }

                    // Fallback: check root gallery object
                    const fullSnap = await db.ref(`directory/storeMenuGalleries/${k}`).once('value');
                    const fullData = fullSnap.val();
                    if (fullData && fullData.pages && typeof fullData.pages === 'object') {
                        pages = Object.entries(fullData.pages).map(([id, item]) => ({
                            id,
                            ...(item || {})
                        }));
                        if (pages.length > 0) break;
                    }
                } catch(e) {
                    console.error('[QuickSendMenu] Error loading pages from Firebase for key ' + k + ':', e);
                }
            }
        }
    }

    pages.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));

    // Filter valid image URLs
    const validPages = pages.filter(p => p && (p.imageUrl || p.url || p.photoUrl || p.downloadUrl || p.image));

    if (validPages.length === 0) {
        showToast(`⚠️ No saved menu photos found for ${cleanName}.`);
        return;
    }

    const confirmed = await askMenuSendConfirmation({
        storeName: cleanName,
        pageCount: validPages.length,
        custName: custName
    });

    if (!confirmed) {
        return;
    }

    const pagesToSend = validPages.map((p, idx) => ({
        imageUrl: p.imageUrl || p.url || p.photoUrl || p.downloadUrl || p.image,
        caption: p.caption || `${cleanName} Menu • Page ${idx + 1}`
    }));

    closeStoreMenuPickerFromChat();
    executeSendMenuPages(validActiveCustId, pagesToSend, custName, cleanName);
}

export async function deleteMenuGalleryPage(pageId) {
    if (!activeGalleryStore || !pageId || !db) return;
    if (!confirm("Are you sure you want to delete this page?")) return;

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

        showToast("🗑️ Deleted page from gallery.");
    } catch(e) {
        showToast("❌ Failed to delete page.");
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

