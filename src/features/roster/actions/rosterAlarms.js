// src/features/roster/actions/rosterAlarms.js
import { appState, globalState } from '../../../store/state.js';
import { 
    parseQueueTime, 
    stopLineAlarm, 
    playLineAlarm, 
    setLineAlarmConfirmed, 
    sortAvailableRidersByGross 
} from '../rosterUtils.js';

export function getTopQueueTime() {
    const rosterMembers = globalState.rosterMembers || [];
    const availableRiders = rosterMembers
        .filter(m => m.status === 'Available')
        .map(m => parseQueueTime(m.queueTime))
        .filter(t => t > 0);

    if (availableRiders.length > 0) {
        const minTime = Math.min(...availableRiders);
        return minTime - 1000;
    }
    return Date.now() - 1000;
}

export function dismissQueueAlarm() {
    setLineAlarmConfirmed(true);
    stopLineAlarm();
    const modal = document.getElementById('first-line-modal') || document.getElementById('first-in-line-modal');
    if (modal) modal.classList.add('hidden');
}

export function checkFirstInLineNotification() {
    const rosterMembers = globalState.rosterMembers || [];
    const availableRiders = sortAvailableRidersByGross(rosterMembers.filter(m => m.status === 'Available'));
    const myId = (appState.telegramId || localStorage.getItem('telegramId') || "").toString().trim();
    const myName = (appState.riderName || localStorage.getItem('riderName') || "").toString().trim().toLowerCase();

    if (availableRiders.length > 0) {
        const first = availableRiders[0];
        const firstId = (first.telegramId || first.id || "").toString().trim();
        const firstName = (first.riderName || first.name || "").toString().trim().toLowerCase();

        const isMe = (myId && firstId && firstId === myId) || (myName && firstName && firstName === myName);
        if (isMe) {
            const modal = document.getElementById('first-line-modal') || document.getElementById('first-in-line-modal');
            if (modal && modal.classList.contains('hidden')) {
                modal.classList.remove('hidden');
                playLineAlarm();
            }
        }
    }
}