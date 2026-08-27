// src/ui/modals/gcashModal.js
import { appState } from '../../store/state.js';
import { db } from '../../config/firebase.js';
import { API_URL } from '../../config/constants.js';
import { showToast } from '../notifications.js';
import { openSlideDeleteModal } from './systemModals.js';

export async function fetchGCashDetails() {
    const riderId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const riderName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    if (!riderId && !riderName) return;

    let foundName = "";
    let foundNo = "";

    if (db) {
        try {
            const snap = await db.ref('gcash').once('value');
            const data = snap.val();
            if (data) {
                Object.values(data).forEach(item => {
                    const itemTId = (item.telegramId || "").toString().trim();
                    const itemRName = (item.riderName || "").toString().trim().toLowerCase();
                    if ((riderId && itemTId === riderId) || (riderName && itemRName === riderName)) {
                        if (item.gcashName) foundName = item.gcashName;
                        if (item.gcashNo) foundNo = item.gcashNo;
                    }
                });
            }
        } catch(e) {}
    }

    if (!foundName || !foundNo) {
        try {
            const res = await fetch(`${API_URL}?type=all`);
            if (res.ok) {
                const json = await res.json();
                if (json && json.gcash) {
                    for (let key in json.gcash) {
                        const rec = json.gcash[key];
                        const recTId = (rec.telegramId || "").toString().trim();
                        const recRName = (rec.riderName || "").toString().trim().toLowerCase();
                        if ((riderId && recTId === riderId) || (riderName && recRName === riderName)) {
                            if (rec.gcashName) foundName = rec.gcashName;
                            if (rec.gcashNo) foundNo = rec.gcashNo;
                            break;
                        }
                    }
                }
            }
        } catch(e) {}
    }

    if (foundName || foundNo) {
        appState.gcashName = foundName;
        appState.gcashNo = foundNo;
        localStorage.setItem('lokalex_gcash_name', foundName);
        localStorage.setItem('lokalex_gcash_no', foundNo);

        const nameInput = document.getElementById('gcash-name-input');
        const noInput = document.getElementById('gcash-no-input');
        if (nameInput) nameInput.value = foundName;
        if (noInput) noInput.value = foundNo;
    }
}

export async function openGCashModal() {
    const modal = document.getElementById('gcash-modal');
    if (modal) {
        const nameInput = document.getElementById('gcash-name-input');
        const noInput = document.getElementById('gcash-no-input');
        
        const localName = appState.gcashName || localStorage.getItem('lokalex_gcash_name') || "";
        const localNo = appState.gcashNo || localStorage.getItem('lokalex_gcash_no') || "";

        if (nameInput) nameInput.value = localName;
        if (noInput) noInput.value = localNo;
        
        modal.classList.remove('hidden');
        await fetchGCashDetails();
    }
}

export function closeGCashModal() {
    const modal = document.getElementById('gcash-modal');
    if (modal) modal.classList.add('hidden');
}

export function saveGCashDetails() {
    const nameInput = document.getElementById('gcash-name-input');
    const noInput = document.getElementById('gcash-no-input');
    
    const gName = nameInput ? nameInput.value.trim() : "";
    const gNo = noInput ? noInput.value.trim() : "";

    if (!gName || !gNo) {
        showToast("⚠️ Paki-kumpleto ang GCash Name at Number!");
        return;
    }

    openSlideDeleteModal(
        "Confirm GCash Details?",
        `I-drag pakanan para kumpirmahin ang pag-update ng iyong GCash details:\n👤 Name: ${gName}\n📱 Number: ${gNo}`,
        () => {
            executeSaveGCashDetails(gName, gNo);
        }
    );
}

export function executeSaveGCashDetails(gName, gNo) {
    appState.gcashName = gName;
    appState.gcashNo = gNo;

    localStorage.setItem('lokalex_gcash_name', gName);
    localStorage.setItem('lokalex_gcash_no', gNo);

    if (db && appState.telegramId) {
        db.ref('gcash/' + appState.telegramId).set({
            riderName: appState.riderName,
            telegramId: appState.telegramId,
            gcashName: gName,
            gcashNo: gNo,
            updatedAt: Date.now()
        });
    }

    try {
        fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({
                type: "gcash",
                telegramId: appState.telegramId,
                riderName: appState.riderName,
                gcashName: gName,
                gcashNo: gNo
            })
        });
    } catch(e) {}

    closeGCashModal();
    showToast("✅ Na-save na ang iyong GCash Details!");
}