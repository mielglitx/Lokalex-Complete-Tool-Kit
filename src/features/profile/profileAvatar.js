// src/features/profile/profileAvatar.js
import { profileState } from './profileState.js';
import { showToast } from '../../ui/notifications.js';

export function handleProfileAvatarFile(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        return showToast("⚠️ Please select a valid image file!");
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxSize = 256;
            let width = img.width;
            let height = img.height;

            if (width > height && width > maxSize) {
                height = Math.round((height * maxSize) / width);
                width = maxSize;
            } else if (height > maxSize) {
                width = Math.round((width * maxSize) / height);
                height = maxSize;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const compressed = canvas.toDataURL('image/jpeg', 0.85);
            profileState.currentAvatarUrl = compressed;

            const preview = document.getElementById('prof-modal-avatar-preview');
            if (preview) preview.src = compressed;

            showToast("✅ Profile photo selected!");
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

export function resetProfileAvatarToInitials() {
    const nameInput = document.getElementById('prof-name-input');
    const name = (nameInput?.value || '').trim() || 'User';
    profileState.currentAvatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0284c7&color=fff&bold=true&size=128`;

    const preview = document.getElementById('prof-modal-avatar-preview');
    if (preview) preview.src = profileState.currentAvatarUrl;
    showToast("🔄 Avatar reset to initials.");
}