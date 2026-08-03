// src/features/auth.js
import { appState } from '../store/state.js';
import { CSV_AUTH_URL } from '../config/constants.js';
import { switchView, renderViewUI } from '../ui/router.js';
import { showToast, unlockAudioContext } from '../ui/notifications.js';
import { fetchGCashDetails } from '../ui/modals.js';

export async function processLogin() {
    unlockAudioContext();
    const idInput = document.getElementById('login-id').value.trim();
    if (!idInput) return showToast("Please enter a valid ID");
    const btn = document.getElementById('login-btn');
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Checking GPS & Auth...`; 
    btn.disabled = true;

    try {
        const coords = await getDeviceLocation();
        appState.lat = coords.lat; appState.lon = coords.lon;

        const res = await fetch(CSV_AUTH_URL);
        if (!res.ok) throw new Error("Cannot reach authorization sheet");
        const csvData = await res.text();
        
        let authorized = false;
        for (let line of csvData.split('\n')) {
            const cols = line.split(',');
            if (cols.length >= 3) {
                const cleanType = cols[0].replace(/['"\r\n]+/g, '').trim();
                const cleanId = cols[1].replace(/['"\r\n]+/g, '').trim();
                const cleanName = cols[2].replace(/['"\r\n]+/g, '').trim();
                if (cleanId === idInput) {
                    appState.riderName = cleanName; 
                    appState.telegramId = idInput; 
                    appState.userType = cleanType;
                    authorized = true; break;
                }
            } else if (cols.length >= 2) {
                const cleanId = cols[0].replace(/['"\r\n]+/g, '').trim();
                const cleanName = cols[1].replace(/['"\r\n]+/g, '').trim();
                if (cleanId === idInput) {
                    appState.riderName = cleanName; 
                    appState.telegramId = idInput; 
                    appState.userType = "";
                    authorized = true; break;
                }
            }
        }

        if (authorized) {
            localStorage.setItem('telegramId', appState.telegramId);
            localStorage.setItem('riderName', appState.riderName);
            localStorage.setItem('userType', appState.userType || "");
            showToast("Login Successful!");
            
            // Auto-fetch rider's online GCash records on login
            fetchGCashDetails();

            history.replaceState({ view: 'view-home' }, '', '#view-home');
            renderViewUI('view-home');
            window.dispatchEvent(new CustomEvent('loginSuccess'));
        } else { 
            showToast("Access Denied: ID not found in sheet."); 
        }
    } catch (err) { 
        showToast(err.message || "Error during login"); 
    } finally { 
        btn.innerHTML = "LOGIN & MARK AVAILABLE"; 
        btn.disabled = false; 
    }
}

export function logout() { 
    localStorage.clear(); 
    location.reload(); 
}

export function getDeviceLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve({ lat: 0, lon: 0 });
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
            (err) => {
                navigator.geolocation.getCurrentPosition(
                    (fPos) => resolve({ lat: fPos.coords.latitude, lon: fPos.coords.longitude }),
                    () => resolve({ lat: 0, lon: 0 }),
                    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
                );
            },
            { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }
        );
    });
}

// Auto-sync GCash details on startup if already logged in
if (appState.telegramId) {
    fetchGCashDetails();
}
