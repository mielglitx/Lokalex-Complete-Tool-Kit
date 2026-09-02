// src/features/auth/authRider.js
import { appState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { showToast, unlockAudioContext } from '../../ui/notifications.js';
import { fetchGCashDetails, openRiderPasswordSetupModal } from '../../ui/modals.js';
import { renderViewUI } from '../../ui/router.js';
import { calibrateGPS, startBackgroundRosterGpsTracker, stopBackgroundRosterGpsTracker } from './authGps.js';
import { isUserBlocked } from './authAdmin.js';

let deferredPwaPrompt = null;

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPwaPrompt = e;
    });
}

export function installPwaApp() {
    if (deferredPwaPrompt) {
        deferredPwaPrompt.prompt();
        deferredPwaPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                showToast("🎉 Salamat sa pag-install ng Lokalex App!");
            }
            deferredPwaPrompt = null;
        });
    } else {
        const modal = document.getElementById('pwa-install-modal');
        if (modal) modal.classList.remove('hidden');
    }
}

export function closePwaInstallModal() {
    const modal = document.getElementById('pwa-install-modal');
    if (modal) modal.classList.add('hidden');
}

export async function processLogin() {
    unlockAudioContext();
    const idInput = document.getElementById('login-id')?.value.trim();
    const passInput = document.getElementById('login-pass')?.value.trim() || '';

    if (!idInput) return showToast("Please enter a valid Rider ID");

    if (isUserBlocked(idInput)) {
        return showToast("🚫 Access Denied: Your account is blocked by Admin.");
    }

    const btn = document.getElementById('login-btn');
    if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking Account...`;
        btn.disabled = true;
    }

    try {
        let riderRecord = null;

        if (db) {
            const snap = await db.ref(`riders/${idInput}`).once('value');
            riderRecord = snap.val();

            if (!riderRecord) {
                const rosterSnap = await db.ref(`roster/${idInput}`).once('value');
                riderRecord = rosterSnap.val();
            }
        }

        if (!riderRecord) {
            throw new Error("Access Denied: Rider ID not found in database.");
        }

        const cleanName = riderRecord.name || riderRecord.riderName || idInput;
        const cleanUserType = (riderRecord.userType || riderRecord.type || "rider").toLowerCase().trim();

        if (isUserBlocked(cleanName)) {
            throw new Error("🚫 Access Denied: Account blocked.");
        }

        const existingPassword = riderRecord.password || riderRecord.pass || null;
        const isSkipped = localStorage.getItem(`lokalex_skip_pass_${idInput}`) === 'true' || riderRecord.skipPasswordSetup === true;

        if (!existingPassword) {
            if (!isSkipped) {
                if (btn) {
                    btn.innerHTML = "LOGIN";
                    btn.disabled = false;
                }
                openRiderPasswordSetupModal(idInput, cleanName, async () => {
                    await executeRiderLoginSequence(idInput, cleanName, cleanUserType, riderRecord);
                });
                return;
            }
        } else {
            if (!passInput) {
                throw new Error("⚠️ Paki-lagay ang iyong Rider Password.");
            }

            if (passInput !== existingPassword.toString()) {
                throw new Error("❌ Mali ang iyong Rider Password. Paki-ulit.");
            }
        }

        await executeRiderLoginSequence(idInput, cleanName, cleanUserType, riderRecord);
    } catch (err) {
        showToast(err.message || "Error during login");
        if (btn) {
            btn.innerHTML = "LOGIN";
            btn.disabled = false;
        }
    }
}

export async function executeRiderLoginSequence(idInput, cleanName, cleanUserType, riderRecord = {}) {
    const btn = document.getElementById('login-btn');
    if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-satellite-dish fa-spin"></i> Calibrating GPS...`;
        btn.disabled = true;
    }

    try {
        appState.riderName = cleanName;
        appState.telegramId = idInput;
        appState.userType = cleanUserType;
        if (riderRecord.photoUrl) {
            appState.photoUrl = riderRecord.photoUrl;
            localStorage.setItem('lokalex_photo_url', riderRecord.photoUrl);
            localStorage.setItem('riderPhotoUrl', riderRecord.photoUrl);
        }
        if (riderRecord.phoneNumber) {
            appState.phoneNumber = riderRecord.phoneNumber;
            localStorage.setItem('lokalex_rider_phone', riderRecord.phoneNumber);
        }

        showToast("📡 Calibrating GPS location...");
        const coords = await calibrateGPS((accuracy) => {
            showToast(`📡 Calibrating GPS: ±${Math.round(accuracy)}m`);
        });

        if (coords.lat === 0 && coords.lon === 0) {
            showToast("⚠️ GPS Signal weak. Turn on location services.");
        } else {
            showToast(`✅ GPS Calibrated: ±${Math.round(coords.accuracy)}m`);
        }

        appState.lat = coords.lat;
        appState.lon = coords.lon;
        appState.gpsAccuracy = coords.accuracy;

        localStorage.setItem('telegramId', appState.telegramId);
        localStorage.setItem('riderName', appState.riderName);
        localStorage.setItem('userType', appState.userType || "");
        showToast("Login Successful!");

        fetchGCashDetails();
        startBackgroundRosterGpsTracker();

        history.replaceState({ view: 'view-home' }, '', '#view-home');
        renderViewUI('view-home');
        window.dispatchEvent(new CustomEvent('loginSuccess'));
    } catch (err) {
        showToast(err.message || "Error during login");
    } finally {
        if (btn) {
            btn.innerHTML = "LOGIN";
            btn.disabled = false;
        }
    }
}

export function logout() { 
    stopBackgroundRosterGpsTracker();
    localStorage.clear(); 
    location.reload(); 
}