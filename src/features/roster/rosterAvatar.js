// src/features/roster/rosterAvatar.js
import { appState, globalState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { showToast, showSideNotification } from '../../ui/notifications.js';
import { escapeHtml, formatTitleCase } from '../../utils/helpers.js';

let selectedAvatarUrl = "";

export function getRiderAvatarUrl(rider = null) {
    const photo = rider?.photoUrl || rider?.avatar || rider?.profilePic || appState.photoUrl || localStorage.getItem('lokalex_photo_url') || localStorage.getItem('riderPhotoUrl') || null;
    if (photo && typeof photo === 'string' && photo.trim() !== '') {
        return photo.trim();
    }
    const name = formatTitleCase(rider?.riderName || rider?.name || appState.riderName || localStorage.getItem('riderName') || 'Rider');
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0284c7&color=ffffff&bold=true&size=128`;
}

export function syncHeaderUserProfile() {
    const avatarEl = document.getElementById('header-user-avatar');
    const nameEl = document.getElementById('header-user-name');
    const myName = formatTitleCase(appState.riderName || localStorage.getItem('riderName') || 'Rider');
    const myPhoto = getRiderAvatarUrl();

    if (avatarEl) avatarEl.src = myPhoto;
    if (nameEl) nameEl.innerText = myName;
}

function compressAvatarImage(file, maxSize = 256, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxSize) {
                        height = Math.round((height * maxSize) / width);
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width = Math.round((width * maxSize) / height);
                        height = maxSize;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(compressedDataUrl);
            };
            img.onerror = (err) => reject(err);
            img.src = e.target.result;
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

export function openAvatarPickerModal() {
    const modal = document.getElementById('avatar-picker-modal');
    const previewImg = document.getElementById('avatar-picker-preview');
    const nameBadge = document.getElementById('avatar-picker-rider-name-badge');
    const phoneBadgeText = document.getElementById('avatar-picker-rider-phone-text');
    const nameInput = document.getElementById('rider-profile-name-input');
    const phoneInput = document.getElementById('rider-profile-phone-input');
    const pass1 = document.getElementById('rider-profile-pass-1');
    const pass2 = document.getElementById('rider-profile-pass-2');
    const errBox = document.getElementById('rider-profile-error-msg');
    const labelEl = document.getElementById('avatar-upload-label');
    const fileInput = document.getElementById('avatar-file-input');

    if (fileInput) fileInput.value = "";
    if (labelEl) labelEl.innerText = "Upload Custom Photo / Camera";
    
    // Always leave password fields blank
    if (pass1) pass1.value = "";
    if (pass2) pass2.value = "";
    if (errBox) errBox.classList.add('hidden');

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();
    
    // Synchronous population from app state, local cache, and roster records
    let myName = formatTitleCase(appState.riderName || localStorage.getItem('riderName') || 'Rider');
    let currentAvatar = getRiderAvatarUrl();
    let currentPhone = appState.phoneNumber || localStorage.getItem('lokalex_rider_phone') || localStorage.getItem('phoneNumber') || '';

    if (globalState.rosterMembers && myId) {
        const rosterRec = globalState.rosterMembers.find(m => (m.telegramId || m.id || '').toString() === myId);
        if (rosterRec) {
            if (rosterRec.riderName || rosterRec.name) myName = formatTitleCase(rosterRec.riderName || rosterRec.name);
            if (rosterRec.photoUrl) currentAvatar = rosterRec.photoUrl;
            if (rosterRec.phoneNumber) currentPhone = rosterRec.phoneNumber;
        }
    }

    selectedAvatarUrl = currentAvatar;

    // Display values immediately
    if (previewImg) previewImg.src = currentAvatar;
    if (nameBadge) nameBadge.innerText = myName;
    if (phoneBadgeText) phoneBadgeText.innerText = currentPhone || 'No Contact Number';
    if (nameInput) nameInput.value = myName;
    if (phoneInput) phoneInput.value = currentPhone;

    // Real-time synchronization as the user types
    if (nameInput) {
        nameInput.oninput = () => {
            const typedName = formatTitleCase(nameInput.value.trim()) || 'Rider Name';
            if (nameBadge) nameBadge.innerText = typedName;
        };
    }

    if (phoneInput) {
        phoneInput.oninput = () => {
            const typedPhone = phoneInput.value.trim() || 'No Contact Number';
            if (phoneBadgeText) phoneBadgeText.innerText = typedPhone;
        };
    }

    // Open modal immediately
    if (modal) modal.classList.remove('hidden');

    // Background asynchronous fetch to sync persistent Firebase data
    if (db && myId) {
        db.ref(`riders/${myId}`).once('value').then((snap) => {
            const rData = snap.val();
            if (rData) {
                if (rData.name || rData.riderName) {
                    myName = formatTitleCase(rData.name || rData.riderName);
                    if (nameInput && nameInput.value === '') nameInput.value = myName;
                    if (nameBadge) nameBadge.innerText = myName;
                }
                if (rData.phoneNumber || rData.phone) {
                    currentPhone = rData.phoneNumber || rData.phone;
                    if (phoneInput && phoneInput.value === '') phoneInput.value = currentPhone;
                    if (phoneBadgeText) phoneBadgeText.innerText = currentPhone;
                }
                if (rData.photoUrl || rData.avatar || rData.profilePic) {
                    currentAvatar = rData.photoUrl || rData.avatar || rData.profilePic;
                    selectedAvatarUrl = currentAvatar;
                    if (previewImg) previewImg.src = currentAvatar;
                }
            }
        }).catch(() => {});
    }
}

export function closeAvatarPickerModal() {
    const modal = document.getElementById('avatar-picker-modal');
    if (modal) modal.classList.add('hidden');
}

export async function handleAvatarFileUpload(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast("⚠️ Please select a valid image file.");
        return;
    }

    try {
        showToast("⏳ Processing image...");
        const compressedUrl = await compressAvatarImage(file, 256, 0.85);
        selectedAvatarUrl = compressedUrl;

        const previewImg = document.getElementById('avatar-picker-preview');
        const labelEl = document.getElementById('avatar-upload-label');

        if (previewImg) previewImg.src = compressedUrl;
        if (labelEl) {
            const shortName = file.name.length > 18 ? file.name.substring(0, 15) + '...' : file.name;
            labelEl.innerText = `Photo Ready (${shortName})`;
        }

        showToast("✅ Photo ready to save!");
    } catch (err) {
        console.error("Image process error:", err);
        showToast("❌ Failed to process image.");
    }
}

export async function saveRiderProfileSettings() {
    const nameInput = document.getElementById('rider-profile-name-input');
    const phoneInput = document.getElementById('rider-profile-phone-input');
    const pass1 = document.getElementById('rider-profile-pass-1');
    const pass2 = document.getElementById('rider-profile-pass-2');
    const errBox = document.getElementById('rider-profile-error-msg');
    const errTxt = document.getElementById('rider-profile-error-text');
    const saveBtn = document.getElementById('save-rider-profile-btn');

    const rawName = nameInput ? nameInput.value.trim() : '';
    const newName = formatTitleCase(rawName);
    const newPhone = phoneInput ? phoneInput.value.trim() : '';
    const p1 = pass1 ? pass1.value.trim() : '';
    const p2 = pass2 ? pass2.value.trim() : '';

    if (!newName) {
        showToast("⚠️ Rider Name / Display Name is required.");
        if (nameInput) nameInput.focus();
        return;
    }

    if (p1 || p2) {
        if (p1.length < 4) {
            if (errBox && errTxt) {
                errTxt.innerText = "Password must be at least 4 characters.";
                errBox.classList.remove('hidden');
            } else {
                showToast("⚠️ Password must be at least 4 characters.");
            }
            if (pass1) pass1.focus();
            return;
        }

        if (p1 !== p2) {
            if (errBox && errTxt) {
                errTxt.innerText = "Passwords do not match.";
                errBox.classList.remove('hidden');
            } else {
                showToast("❌ Passwords do not match.");
            }
            if (pass2) pass2.focus();
            return;
        }
    }

    if (errBox) errBox.classList.add('hidden');

    if (!selectedAvatarUrl) {
        selectedAvatarUrl = getRiderAvatarUrl();
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    const myId = (appState.telegramId || localStorage.getItem('telegramId') || '').toString().trim();

    try {
        appState.riderName = newName;
        appState.photoUrl = selectedAvatarUrl;
        if (newPhone) appState.phoneNumber = newPhone;

        localStorage.setItem('riderName', newName);
        localStorage.setItem('lokalex_photo_url', selectedAvatarUrl);
        localStorage.setItem('riderPhotoUrl', selectedAvatarUrl);
        if (newPhone) localStorage.setItem('lokalex_rider_phone', newPhone);

        if (myId && db) {
            const updates = {
                name: newName,
                riderName: newName,
                photoUrl: selectedAvatarUrl,
                updatedAt: Date.now()
            };

            if (newPhone) updates.phoneNumber = newPhone;
            if (p1) {
                updates.password = p1;
                updates.hasPassword = true;
                localStorage.setItem(`lokalex_pass_${myId}`, p1);
            }

            await db.ref(`riders/${myId}`).update(updates);
            await db.ref(`roster/${myId}`).update({
                name: newName,
                riderName: newName,
                photoUrl: selectedAvatarUrl,
                ...(p1 ? { hasPassword: true } : {})
            }).catch(() => {});
        }

        syncHeaderUserProfile();
        if (window.updateRosterUI) window.updateRosterUI();

        closeAvatarPickerModal();
        showToast("✅ Rider Account Settings saved successfully!");
        showSideNotification("SETTINGS SAVED", "Profile, photo, & security updated", "fa-user-check", "text-emerald-400", "border-emerald-500");
    } catch(err) {
        console.error("Save profile error:", err);
        showToast(`❌ Error: ${err.message || 'Failed to save changes'}`);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fa-solid fa-check"></i> Save All Changes`;
        }
    }
}

export async function saveSelectedAvatar() {
    return saveRiderProfileSettings();
}

// Global attachments
if (typeof window !== 'undefined') {
    window.openAvatarPickerModal = openAvatarPickerModal;
    window.closeAvatarPickerModal = closeAvatarPickerModal;
    window.handleAvatarFileUpload = handleAvatarFileUpload;
    window.saveSelectedAvatar = saveSelectedAvatar;
    window.saveRiderProfileSettings = saveRiderProfileSettings;
    window.syncHeaderUserProfile = syncHeaderUserProfile;
}