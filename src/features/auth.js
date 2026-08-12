// src/features/auth.js
import { appState, globalState } from '../store/state.js';
import { CSV_AUTH_URL, ADMIN_IDS } from '../config/constants.js';
import { switchView, renderViewUI } from '../ui/router.js';
import { showToast, unlockAudioContext } from '../ui/notifications.js';
import { fetchGCashDetails } from '../ui/modals.js';
import { db, auth } from '../config/firebase.js';
import { listenToCustomerRiderChat } from './chat.js';

let backgroundGpsWatchId = null;
let lastRosterGpsPushTime = 0;
const GPS_ROSTER_PULSE_MS = 30000;
let confirmationResultObj = null;

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

function formatPhoneNumber(phone) {
    let clean = (phone || '').replace(/[^0-9+]/g, '').trim();
    if (clean.startsWith('09')) {
        clean = '+63' + clean.substring(1);
    } else if (clean.startsWith('9') && clean.length === 10) {
        clean = '+63' + clean;
    } else if (!clean.startsWith('+')) {
        clean = '+' + clean;
    }
    return clean;
}

export function sendCustomerPhoneOTP() {
    const phoneInput = document.getElementById('cust-phone-num')?.value.trim();

    if (!phoneInput) return showToast("⚠️ Paki-lagay ang iyong Phone Number!");

    const formattedPhone = formatPhoneNumber(phoneInput);
    if (formattedPhone.length < 12) {
        return showToast("⚠️ Format ng phone number ay hindi valid (hal. 09123456789)");
    }

    const sendBtn = document.getElementById('send-otp-btn');
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending SMS OTP...`;
    }

    if (!window.recaptchaVerifier) {
        try {
            window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
                'size': 'invisible',
                'callback': () => {}
            });
        } catch (e) {
            console.error("Recaptcha init error:", e);
        }
    }

    const appVerifier = window.recaptchaVerifier;

    auth.signInWithPhoneNumber(formattedPhone, appVerifier)
        .then((confirmationResult) => {
            confirmationResultObj = confirmationResult;
            showToast("📲 OTP Code sent via SMS!");

            document.getElementById('phone-auth-step-1')?.classList.add('hidden');
            document.getElementById('phone-auth-step-2')?.classList.remove('hidden');
        })
        .catch((error) => {
            console.error("Error sending OTP:", error);
            showToast(`❌ Error: ${error.message || "Failed to send SMS OTP"}`);
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> SEND OTP CODE`;
            }
            if (window.recaptchaVerifier) {
                window.recaptchaVerifier.render().then(widgetId => {
                    if (window.grecaptcha) grecaptcha.reset(widgetId);
                });
            }
        });
}

export function verifyCustomerPhoneOTP() {
    const codeInput = document.getElementById('cust-otp-code')?.value.trim();
    if (!codeInput || codeInput.length < 6) {
        return showToast("⚠️ Paki-lagay ang 6-digit OTP code!");
    }

    if (!confirmationResultObj) {
        return showToast("⚠️ Session expired. Paki-resend ng OTP code.");
    }

    const verifyBtn = document.getElementById('verify-otp-btn');
    if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verifying...`;
    }

    const custName = document.getElementById('cust-phone-name')?.value.trim() || "Customer";

    confirmationResultObj.confirm(codeInput)
        .then((result) => {
            const user = result.user;
            handleCustomerPhoneLoginSuccess(user, custName);
        })
        .catch((error) => {
            console.error("Error verifying OTP:", error);
            showToast("❌ Mali ang OTP code. Paki-subukan muli.");
            if (verifyBtn) {
                verifyBtn.disabled = false;
                verifyBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> VERIFY & LOGIN`;
            }
        });
}

export function resetPhoneAuthStep() {
    confirmationResultObj = null;
    document.getElementById('phone-auth-step-2')?.classList.add('hidden');
    document.getElementById('phone-auth-step-1')?.classList.remove('hidden');
    const sendBtn = document.getElementById('send-otp-btn');
    if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> SEND OTP CODE`;
    }
}

function handleCustomerPhoneLoginSuccess(user, custName) {
    const uid = user.uid || `PHONE_${Date.now()}`;
    const phone = user.phoneNumber || "";
    const displayName = custName || "Customer (" + phone.slice(-4) + ")";
    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0084FF&color=fff`;

    if (isUserBlocked(uid) || isUserBlocked(displayName) || isUserBlocked(phone)) {
        showToast(`🚫 Account Blocked! Contact Lokalex Admin.`);
        return;
    }

    const customerRecord = {
        type: "customer_account",
        uid: uid,
        phoneNumber: phone,
        name: displayName,
        avatarUrl: avatarUrl,
        registeredAt: Date.now()
    };

    localStorage.setItem('lokalex_customer_fb_id', uid);
    localStorage.setItem('lokalex_customer_name', displayName);
    localStorage.setItem('lokalex_customer_email', phone);
    localStorage.setItem('lokalex_customer_avatar', avatarUrl);

    appState.customerFacebookId = uid;
    appState.customerName = displayName;

    if (db && uid) {
        db.ref(`customers/${uid}`).set(customerRecord);
    }

    const avatarImg = document.getElementById('cust-landing-avatar');
    const nameEl = document.getElementById('cust-landing-name');
    const emailEl = document.getElementById('cust-landing-email');

    if (avatarImg) avatarImg.src = avatarUrl;
    if (nameEl) nameEl.innerText = displayName;
    if (emailEl) emailEl.innerText = phone;

    showToast(`✅ Welcome, ${displayName}!`);

    if (typeof listenToCustomerRiderChat === 'function') {
        listenToCustomerRiderChat();
    }

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
    window.sendCustomerPhoneOTP = sendCustomerPhoneOTP;
    window.verifyCustomerPhoneOTP = verifyCustomerPhoneOTP;
    window.resetPhoneAuthStep = resetPhoneAuthStep;
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