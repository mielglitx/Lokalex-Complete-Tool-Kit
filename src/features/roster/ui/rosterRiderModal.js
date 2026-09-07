// src/features/roster/ui/rosterRiderModal.js
import { globalState } from '../../../store/state.js';
import { escapeHtml, formatTitleCase, getLocalTodayStr } from '../../../utils/helpers.js';
import { db } from '../../../config/firebase.js';
import { 
    getRiderTodayGross, 
    getMergedDeduplicatedCommissionList, 
    isSameDateStr 
} from '../rosterUtils.js';
import { getForcedCaterBadgeHtml } from './rosterBadge.js';

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function openRiderInfoModal(riderId, riderName = '') {
    const modal = document.getElementById('rider-info-modal');
    if (!modal) return;

    const myId = (riderId || '').toString().trim();
    const cleanName = (riderName || 'Rider').trim();

    const rosterMembers = globalState.rosterMembers || [];
    const rosterRec = rosterMembers.find(m => (m.telegramId || m.id || '').toString() === myId || (m.riderName || m.name || '').toLowerCase() === cleanName.toLowerCase()) || {};

    const rawDisplayName = rosterRec.riderName || rosterRec.name || cleanName;
    const displayName = formatTitleCase(rawDisplayName);
    const status = rosterRec.status || 'Offline / End';
    const userType = (rosterRec.userType || globalState.userTypesMap?.[myId] || 'rider').toUpperCase();
    
    // Photo
    const photoUrl = rosterRec.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0284c7&color=ffffff&bold=true&size=128`;
    
    // Day off
    const allDayOffs = globalState.riderDayOffs || {};
    const dayOffRec = allDayOffs[myId] || allDayOffs[cleanName.toLowerCase()] || null;
    const dayOffText = (dayOffRec && dayOffRec.dayOfWeek !== undefined && dayOffRec.dayOfWeek !== null)
        ? `Every ${DAYS_SHORT[parseInt(dayOffRec.dayOfWeek)] || 'N/A'}`
        : 'None Assigned';

    // Gross & Deliveries today
    const gross = getRiderTodayGross(displayName, myId);
    const todayStr = getLocalTodayStr();
    const mergedList = getMergedDeduplicatedCommissionList();
    const todayDeliveries = mergedList.filter(item => {
        const itemDate = item.date || item.completedDate;
        const isToday = itemDate && isSameDateStr(itemDate, todayStr);
        const isRider = (item.riderId && item.riderId.toString() === myId) || 
                        (item.riderName && item.riderName.toLowerCase() === rawDisplayName.toLowerCase());
        return isToday && isRider;
    }).length;

    // Contact Number
    let phone = rosterRec.phoneNumber || rosterRec.phone || '';

    // Elements
    const avatarEl = document.getElementById('rider-info-avatar');
    const nameEl = document.getElementById('rider-info-name');
    const roleEl = document.getElementById('rider-info-role');
    const statusEl = document.getElementById('rider-info-status');
    const phoneEl = document.getElementById('rider-info-phone');
    const phoneLink = document.getElementById('rider-info-phone-link');
    const gcashNameEl = document.getElementById('rider-info-gcash-name');
    const gcashNoEl = document.getElementById('rider-info-gcash-no');
    const dayoffEl = document.getElementById('rider-info-dayoff');
    const grossEl = document.getElementById('rider-info-gross');
    const countEl = document.getElementById('rider-info-deliveries');
    const activeCateringEl = document.getElementById('rider-info-active-catering');
    const cateringWrapper = document.getElementById('rider-info-active-catering-wrapper');

    if (avatarEl) avatarEl.src = photoUrl;
    if (nameEl) nameEl.innerText = displayName;
    if (roleEl) roleEl.innerText = userType;
    if (dayoffEl) dayoffEl.innerText = dayOffText;
    if (grossEl) grossEl.innerText = `₱${gross.toFixed(0)}`;
    if (countEl) countEl.innerText = `${todayDeliveries} order(s)`;

    // Status styling
    if (statusEl) {
        statusEl.innerText = status;
        statusEl.className = 'px-2 py-0.5 rounded-full font-bold text-[9px] uppercase border ' + (
            status === 'Available' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' :
            status === 'Catering' ? 'bg-red-500/20 text-red-400 border-red-500/40' :
            status === 'Break' ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' :
            status === 'Cooldown' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40' :
            'bg-gray-700/40 text-gray-300 border-gray-600'
        );
    }

    // Active catering session orders with forced cater badges
    if (cateringWrapper && activeCateringEl) {
        if (status === 'Catering' && rosterRec.customerName) {
            cateringWrapper.classList.remove('hidden');
            const custs = rosterRec.customerName.split(', ').map(c => c.trim()).filter(Boolean);
            const custItemsHtml = custs.map(c => {
                const badge = getForcedCaterBadgeHtml(rosterRec, c, displayName);
                return `<div class="flex items-center gap-1.5 flex-wrap"><span>👤 ${escapeHtml(formatTitleCase(c))}</span>${badge}</div>`;
            }).join('');
            activeCateringEl.innerHTML = custItemsHtml;
        } else {
            cateringWrapper.classList.add('hidden');
        }
    }

    const setPhoneUI = (val) => {
        if (phoneEl) phoneEl.innerText = val || 'Not Set';
        if (phoneLink) {
            if (val) {
                phoneLink.href = `tel:${val}`;
                phoneLink.classList.remove('hidden');
            } else {
                phoneLink.classList.add('hidden');
            }
        }
    };
    setPhoneUI(phone);

    if (gcashNameEl) gcashNameEl.innerText = 'Checking...';
    if (gcashNoEl) gcashNoEl.innerText = 'Checking...';

    modal.classList.remove('hidden');

    // Fetch live phone & GCash from database
    if (db && myId) {
        try {
            const [riderSnap, gcashSnap] = await Promise.all([
                db.ref(`riders/${myId}`).once('value'),
                db.ref(`gcash/${myId}`).once('value')
            ]);

            const rData = riderSnap.val() || {};
            const gData = gcashSnap.val() || {};

            if (rData.phoneNumber || rData.phone) {
                phone = rData.phoneNumber || rData.phone;
                setPhoneUI(phone);
            }
            if (rData.photoUrl && avatarEl) {
                avatarEl.src = rData.photoUrl;
            }

            const gName = gData.gcashName || rData.gcashName ? formatTitleCase(gData.gcashName || rData.gcashName) : 'Not Set';
            const gNo = gData.gcashNo || rData.gcashNo || 'Not Set';

            if (gcashNameEl) gcashNameEl.innerText = gName;
            if (gcashNoEl) gcashNoEl.innerText = gNo;
        } catch (e) {
            if (gcashNameEl) gcashNameEl.innerText = 'Not Set';
            if (gcashNoEl) gcashNoEl.innerText = 'Not Set';
        }
    } else {
        if (gcashNameEl) gcashNameEl.innerText = 'Not Set';
        if (gcashNoEl) gcashNoEl.innerText = 'Not Set';
    }
}

export function closeRiderInfoModal() {
    const modal = document.getElementById('rider-info-modal');
    if (modal) modal.classList.add('hidden');
}