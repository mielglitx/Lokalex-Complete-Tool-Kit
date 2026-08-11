// src/features/auth.js
import { appState, globalState } from '../store/state.js';
import { CSV_AUTH_URL, ADMIN_IDS, FB_APP_ID } from '../config/constants.js';
import { switchView, renderViewUI } from '../ui/router.js';
import { showToast, unlockAudioContext } from '../ui/notifications.js';
import { fetchGCashDetails } from '../ui/modals.js';
import { db } from '../config/firebase.js';

let backgroundGpsWatchId = null;
let lastRosterGpsPushTime = 0;
const GPS_ROSTER_PULSE_MS = 30000;

export function switchLoginPortalTab(mode) {
    const riderForm = document.getElementById('portal-form-rider');
    const custForm = document.getElementById('portal-form-customer');

    if (mode === 'rider') {
        if (riderForm) riderForm.classList.remove('hidden');
        if (custForm) custForm.classList.add('hidden');
    } else {
        if (custForm) custForm.classList.remove('hidden');
        if (riderForm) riderForm.classList.add('hidden');
    }
}

export function isUserBlocked(idOrName) {
    if (!idOrName || !globalState.blockedUsers) return false;
    const clean = idOrName.toString().toLowerCase().trim();

    return Object.values(globalState.blockedUsers).some(b => {
        if (!b) return false;
        const bId = (b.id || "").toString().toLowerCase().trim();
        const bName = (b.name || "").toString().toLowerCase().trim();
        return (bId && bId === clean) || (bName && bName === clean);
    });
}

export function registerCustomerViaFacebook() {
    const isSecureContext = window.location.protocol === 'https:' || 
                            window.location.hostname === 'localhost' || 
                            window.location.hostname === '127.0.0.1';

    const appIdToUse = FB_APP_ID || '3509728395866188';

    if (typeof FB === 'undefined' || !isSecureContext) {
        if (!isSecureContext && typeof FB !== 'undefined') {
            showToast("⚠️ Facebook Login requires HTTPS or localhost. Test login activated.");
        }
        // Fallback simulation if FB SDK fails to load or running over plain HTTP
        handleCustomerLoginSuccess({
            id: "FB_SIM_" + Date.now(),
            name: "Test Customer (Facebook)",
            email: "customer@lokalex.com",
            picture: { data: { url: "https://ui-avatars.com/api/?name=Customer&background=1877F2&color=fff" } }
        });
        return;
    }

    try {
        if (FB && typeof FB.init === 'function') {
            FB.init({
                appId: appIdToUse,
                cookie: true,
                xfbml: true,
                version: 'v19.0'
            });
        }

        FB.login(function(response) {
            if (response && response.authResponse) {
                FB.api('/me', { fields: 'id, name, email, picture.type(large)' }, function(userInfo) {
                    handleCustomerLoginSuccess(userInfo);
                });
            } else {
                showToast("⚠️ Facebook authentication cancelled or failed.");
            }
        }, { scope: 'public_profile,email' });
    } catch (err) {
        console.warn("FB.login exception captured:", err);
        showToast("⚠️ Facebook login error. Activated test customer account.");
        handleCustomerLoginSuccess({
            id: "FB_SIM_" + Date.now(),
            name: "Test Customer (Facebook)",
            email: "customer@lokalex.com",
            picture: { data: { url: "https://ui-avatars.com/api/?name=Customer&background=1877F2&color=fff" } }
        });
    }
}

function handleCustomerLoginSuccess(userInfo) {
    const fbName = userInfo.name || "Facebook Customer";
    const fbEmail = userInfo.email || "No email shared";
    const fbId = userInfo.id || "";

    if (isUserBlocked(fbId) || isUserBlocked(fbName)) {
        showToast(`🚫 Account Blocked! Contact Lokalex Admin.`);
        return;
    }

    const avatarUrl = userInfo.picture?.data?.url || `https://ui-avatars.com/api/?name=${encodeURIComponent(fbName)}&background=0084FF&color=fff`;

    const customerRecord = {
        type: "customer_account",
        facebookId: fbId,
        name: fbName,
        email: fbEmail,
        avatarUrl: avatarUrl,
        registeredAt: Date.now()
    };

    localStorage.setItem('lokalex_customer_fb_id', fbId);
    localStorage.setItem('lokalex_customer_name', fbName);
    localStorage.setItem('lokalex_customer_email', fbEmail);
    localStorage.setItem('lokalex_customer_avatar', avatarUrl);

    appState.customerFacebookId = fbId;
    appState.customerName = fbName;

    if (db && fbId) {
        db.ref(`customers/${fbId}`).set(customerRecord);
    }

    const profileCard = document.getElementById('customer-profile-card');
    const avatarImg = document.getElementById('cust-fb-avatar');
    const nameEl = document.getElementById('cust-fb-name');
    const emailEl = document.getElementById('cust-fb-email');

    if (avatarImg) avatarImg.src = avatarUrl;
    if (nameEl) nameEl.innerText = fbName;
    if (emailEl) emailEl.innerText = fbEmail;
    if (profileCard) profileCard.classList.remove('hidden');

    showToast(`✅ Welcome, ${fbName}!`);
    
    // Switch to Customer Landing Page
    if (window.switchView) {
        window.switchView('view-customer-home');
    }
}

export function openAdminBlockModal() {
    const modal = document.getElementById('admin-block-user-modal');
    const selectEl = document.getElementById('block-target-select');

    if (modal) {
        if (selectEl) {
            let riderMap = new Map();

            (globalState.rosterMembers || []).forEach(r => {
                const name = (r.riderName || r.name || "").trim();
                const id = (r.telegramId || r.id || name).toString().trim();
                if (name) riderMap.set(name.toLowerCase(), { id: id || name, name: name });
            });

            (globalState.globalLogins || []).forEach(l => {
                const name = (l.riderName || "").trim();
                if (name && !riderMap.has(name.toLowerCase())) {
                    riderMap.set(name.toLowerCase(), { id: name, name: name });
                }
            });

            if (globalState.userTypesMap) {
                Object.keys(globalState.userTypesMap).forEach(key => {
                    if (isNaN(key) && !riderMap.has(key.toLowerCase())) {
                        const cleanName = key.trim();
                        if (cleanName) riderMap.set(cleanName.toLowerCase(), { id: cleanName, name: cleanName });
                    }
                });
            }

            const cleanList = Array.from(riderMap.values()).sort((a,b) => a.name.localeCompare(b.name));

            let optionsHtml = '<option value="" disabled selected>-- Select Rider / User --</option>';
            cleanList.forEach(item => {
                optionsHtml += `<option value="${item.id}">${item.name}</option>`;
            });
            selectEl.innerHTML = optionsHtml;
        }

        modal.classList.remove('hidden');
        renderBlockedUsersList();
    }
}

export function closeAdminBlockModal() {
    const modal = document.getElementById('admin-block-user-modal');
    if (modal) modal.classList.add('hidden');
}

export function submitBlockUser() {
    const targetSelect = document.getElementById('block-target-select');
    const reasonInput = document.getElementById('block-reason-input');

    const targetVal = targetSelect ? targetSelect.value.trim() : "";
    const targetText = targetSelect && targetSelect.selectedIndex >= 0 ? targetSelect.options[targetSelect.selectedIndex].text : targetVal;
    const reason = reasonInput ? reasonInput.value.trim() : "Violation of Terms";

    if (!targetVal) return showToast("⚠️ Please select a user to block.");

    const cleanKey = targetVal.toLowerCase().replace(/[^a-z0-9]/g, '');

    const blockRecord = {
        id: targetVal,
        name: targetText || targetVal,
        reason: reason,
        blockedBy: appState.riderName || "Admin",
        blockedAt: Date.now()
    };

    if (db) {
        db.ref(`blockedUsers/${cleanKey}`).set(blockRecord);
    }

    if (!globalState.blockedUsers) globalState.blockedUsers = {};
    globalState.blockedUsers[cleanKey] = blockRecord;

    if (targetSelect) targetSelect.selectedIndex = 0;
    if (reasonInput) reasonInput.value = "";

    showToast(`🚫 Blocked user: ${targetText || targetVal}`);
    renderBlockedUsersList();
}

export function unblockUser(cleanKey) {
    if (db) {
        db.ref(`blockedUsers/${cleanKey}`).remove();
    }
    if (globalState.blockedUsers) {
        delete globalState.blockedUsers[cleanKey];
    }
    showToast(`✅ User unblocked.`);
    renderBlockedUsersList();
}

export function renderBlockedUsersList() {
    const container = document.getElementById('blocked-users-list');
    if (!container) return;

    const list = globalState.blockedUsers ? Object.entries(globalState.blockedUsers) : [];

    if (list.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 italic py-6 text-xs">No blocked users recorded.</div>`;
        return;
    }

    container.innerHTML = list.map(([key, record]) => `
        <div class="bg-black/40 border border-red-500/30 p-2.5 rounded-xl flex justify-between items-center text-xs">
            <div>
                <div class="font-bold text-red-400">${record.name || record.id}</div>
                <div class="text-[10px] text-gray-400">Reason: ${record.reason || 'N/A'}</div>
            </div>
            <button onclick="unblockUser('${key}')" class="bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 px-2 py-1 rounded text-[10px] font-bold transition active:scale-95">
                Unblock
            </button>
        </div>
    `).join('');
}

export function calibrateGPS(onProgress) {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            return resolve({ lat: 0, lon: 0, accuracy: 999 });
        }

        let bestFix = null;
        let sampleCount = 0;
        const maxSamples = 4;
        const timeoutDuration = 6000;

        const timeoutTimer = setTimeout(() => {
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            if (bestFix) {
                resolve({
                    lat: bestFix.coords.latitude,
                    lon: bestFix.coords.longitude,
                    accuracy: bestFix.coords.accuracy
                });
            } else {
                resolve({ lat: 0, lon: 0, accuracy: 999 });
            }
        }, timeoutDuration);

        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                sampleCount++;
                const acc = position.coords.accuracy;

                if (!bestFix || acc < bestFix.coords.accuracy) {
                    bestFix = position;
                }

                if (onProgress && typeof onProgress === 'function') {
                    onProgress(acc, sampleCount);
                }

                if (acc <= 15 || sampleCount >= maxSamples) {
                    clearTimeout(timeoutTimer);
                    navigator.geolocation.clearWatch(watchId);
                    resolve({
                        lat: bestFix.coords.latitude,
                        lon: bestFix.coords.longitude,
                        accuracy: bestFix.coords.accuracy
                    });
                }
            },
            (err) => {},
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    });
}

export function startBackgroundRosterGpsTracker() {
    if (!navigator.geolocation || !appState.telegramId) return;
    if (backgroundGpsWatchId !== null) navigator.geolocation.clearWatch(backgroundGpsWatchId);

    backgroundGpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const now = Date.now();
            appState.lat = pos.coords.latitude;
            appState.lon = pos.coords.longitude;
            appState.gpsAccuracy = pos.coords.accuracy;

            if (now - lastRosterGpsPushTime >= GPS_ROSTER_PULSE_MS && db && appState.telegramId) {
                lastRosterGpsPushTime = now;
                db.ref('roster/' + appState.telegramId).update({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    locationUpdatedAt: now
                }).catch(() => {});
            }
        },
        () => {},
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
}

export function stopBackgroundRosterGpsTracker() {
    if (backgroundGpsWatchId !== null) {
        navigator.geolocation.clearWatch(backgroundGpsWatchId);
        backgroundGpsWatchId = null;
    }
}

export function getDeviceLocation() {
    return calibrateGPS();
}

export async function processLogin() {
    unlockAudioContext();
    const idInput = document.getElementById('login-id').value.trim();
    if (!idInput) return showToast("Please enter a valid ID");

    if (isUserBlocked(idInput)) {
        return showToast("🚫 Access Denied: Your account is blocked by Admin.");
    }
    
    const btn = document.getElementById('login-btn');
    btn.innerHTML = `<i class="fa-solid fa-satellite-dish fa-spin"></i> Calibrating GPS...`; 
    btn.disabled = true;

    try {
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

        const res = await fetch(CSV_AUTH_URL);
        if (!res.ok) throw new Error("Cannot reach authorization sheet");
        const csvData = await res.text();
        
        let authorized = false;
        for (let line of csvData.split('\n')) {
            const cols = line.split(',');
            if (cols.length >= 2) {
                const cleanId = cols[cols.length >= 3 ? 1 : 0].replace(/['"\r\n]+/g, '').trim();
                const cleanName = cols[cols.length >= 3 ? 2 : 1].replace(/['"\r\n]+/g, '').trim();
                if (cleanId === idInput) {
                    if (isUserBlocked(cleanName)) {
                        throw new Error("🚫 Access Denied: Account blocked.");
                    }
                    appState.riderName = cleanName; 
                    appState.telegramId = idInput; 
                    appState.userType = cols.length >= 3 ? cols[0].replace(/['"\r\n]+/g, '').trim() : "";
                    authorized = true; 
                    break;
                }
            }
        }

        if (authorized) {
            localStorage.setItem('telegramId', appState.telegramId);
            localStorage.setItem('riderName', appState.riderName);
            localStorage.setItem('userType', appState.userType || "");
            showToast("Login Successful!");
            
            fetchGCashDetails();
            startBackgroundRosterGpsTracker();

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
    stopBackgroundRosterGpsTracker();
    localStorage.clear(); 
    location.reload(); 
}

if (appState.telegramId) {
    fetchGCashDetails();
    startBackgroundRosterGpsTracker();
}

if (typeof window !== 'undefined') {
    window.switchLoginPortalTab = switchLoginPortalTab;
    window.registerCustomerViaFacebook = registerCustomerViaFacebook;
    window.processLogin = processLogin;
    window.logout = logout;
    window.openAdminBlockModal = openAdminBlockModal;
    window.closeAdminBlockModal = closeAdminBlockModal;
    window.submitBlockUser = submitBlockUser;
    window.unblockUser = unblockUser;
    window.isUserBlocked = isUserBlocked;
    window.calibrateGPS = calibrateGPS;
    window.getDeviceLocation = getDeviceLocation;
}