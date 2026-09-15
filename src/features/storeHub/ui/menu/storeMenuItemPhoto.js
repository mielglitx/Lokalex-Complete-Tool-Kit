// src/features/storeHub/ui/menu/storeMenuItemPhoto.js
import { showToast } from '../../../../ui/notifications.js';
import { compressImageFile } from '../storeHubState.js';

export async function handleItemPhotoFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
        showToast("⏳ Compressing product image...");
        const compressedBase64 = await compressImageFile(file, 400, 400, 0.82);

        const imgPreview = document.getElementById('item-modal-preview-img');
        const iconPreview = document.getElementById('item-modal-preview-icon');
        const stagedInput = document.getElementById('item-staged-image-data');
        const urlInput = document.getElementById('item-input-image');

        if (imgPreview) {
            imgPreview.src = compressedBase64;
            imgPreview.classList.remove('hidden');
        }
        if (iconPreview) iconPreview.classList.add('hidden');
        if (stagedInput) stagedInput.value = compressedBase64;
        if (urlInput) urlInput.value = '';

        showToast("✅ Photo attached!");
    } catch (e) {
        showToast("❌ Failed to process photo file.");
    }
}

export function onItemImageUrlInput(val) {
    const imgPreview = document.getElementById('item-modal-preview-img');
    const iconPreview = document.getElementById('item-modal-preview-icon');
    const stagedInput = document.getElementById('item-staged-image-data');

    if (val && val.trim()) {
        if (imgPreview) {
            imgPreview.src = val.trim();
            imgPreview.classList.remove('hidden');
        }
        if (iconPreview) iconPreview.classList.add('hidden');
        if (stagedInput) stagedInput.value = '';
    } else {
        clearItemPhoto();
    }
}

export function clearItemPhoto() {
    const fileInput = document.getElementById('item-photo-file-input');
    const imgPreview = document.getElementById('item-modal-preview-img');
    const iconPreview = document.getElementById('item-modal-preview-icon');
    const stagedInput = document.getElementById('item-staged-image-data');
    const urlInput = document.getElementById('item-input-image');

    if (fileInput) fileInput.value = '';
    if (stagedInput) stagedInput.value = '';
    if (urlInput) urlInput.value = '';

    if (imgPreview) {
        imgPreview.src = '';
        imgPreview.classList.add('hidden');
    }
    if (iconPreview) iconPreview.classList.remove('hidden');
}