// src/features/roster/actions/rosterCustomerClaim.js
import { appState } from '../../../store/state.js';
import { showToast } from '../../../ui/notifications.js';
import { openSlideDeleteModal } from '../../../ui/modals.js';
import { requestClaimCustomer } from '../rosterSwap.js';
import { canRiderTakeMoreBookings } from '../rosterStatusLimits.js';

export function claimCustomerFromRider(fromRiderId, fromRiderName, custName) {
    const currentId = (appState.telegramId || localStorage.getItem('telegramId') || localStorage.getItem('riderId') || "").toString().trim();
    const currentName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim();

    const myId = currentId || currentName;
    const myName = currentName || "Rider";

    if (!myId) return showToast("⚠️ Rider ID missing.");
    if (fromRiderId.toString().trim() === myId || fromRiderName.toLowerCase().trim() === myName.toLowerCase()) {
        return showToast("⚠️ Iyo na ang customer na ito.");
    }

    const limitCheck = canRiderTakeMoreBookings(myId, myName);
    if (!limitCheck.allowed) {
        const modeLabel = limitCheck.isAuto ? " (Auto Income Tier)" : "";
        return showToast(`⚠️ Hindi mo ma-claim: Naabot mo na ang limit na ${limitCheck.maxAllowed} active booking(s)${modeLabel}.`);
    }

    openSlideDeleteModal(
        `Request Customer: ${custName}?`,
        `Hihingin mo ba si ${custName} mula kay ${fromRiderName}?\nMagpapadala ng request para sa kanyang pag-apruba.`,
        () => {
            requestClaimCustomer(fromRiderId, fromRiderName, custName);
        }
    );
}