// src/features/roster/ui/rosterBadge.js
import { escapeHtml } from '../../../utils/helpers.js';

export function getForcedCaterBadgeHtml(record, customerName, riderName = "") {
    if (!record || !customerName) return "";

    const cleanCustKey = customerName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanCustName = customerName.toLowerCase().trim();
    let forcedInfo = null;

    if (record.forcedCaters) {
        if (typeof record.forcedCaters === 'object') {
            forcedInfo = record.forcedCaters[cleanCustKey] || 
                         record.forcedCaters[cleanCustName] || 
                         record.forcedCaters[customerName];

            if (!forcedInfo) {
                const values = Array.isArray(record.forcedCaters) ? record.forcedCaters : Object.values(record.forcedCaters);
                forcedInfo = values.find(fc => {
                    if (!fc) return false;
                    if (fc === true) return true;
                    const fName = (fc.customerName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    return fName && (fName === cleanCustKey || fName.includes(cleanCustKey) || cleanCustKey.includes(fName));
                });
            }
        } else if (record.forcedCaters === true) {
            forcedInfo = { forcedBy: 'Admin' };
        }
    }

    // Only allow root-level fallback for historical records; active roster cards require per-customer forcedCaters entry
    const isHistoryItem = !!(record.transactionId || record.completedDate || record.completedTime);
    if (!forcedInfo && isHistoryItem && (record.isForcedCater || record.forcedBy)) {
        forcedInfo = { 
            forcedBy: record.forcedBy || 'Admin',
            isSelfForced: !!record.isSelfForced
        };
    }

    if (!forcedInfo) return "";

    let forcedByLabel = "Admin";
    let isSelfForced = false;

    if (typeof forcedInfo === 'object') {
        if (forcedInfo.forcedBy) forcedByLabel = forcedInfo.forcedBy;
        if (forcedInfo.isSelfForced === true) isSelfForced = true;
    } else if (typeof forcedInfo === 'string') {
        forcedByLabel = forcedInfo;
    }

    if (!isSelfForced) {
        const cleanRider = (riderName || record.riderName || record.name || "").trim().toLowerCase();
        const cleanForcedBy = forcedByLabel.trim().toLowerCase();
        if (cleanRider && cleanForcedBy) {
            if (cleanRider === cleanForcedBy || cleanForcedBy.includes(cleanRider) || cleanRider.includes(cleanForcedBy)) {
                isSelfForced = true;
            }
        }
    }

    const badgeText = isSelfForced ? `Force Catered (Self)` : `Force Catered (${escapeHtml(forcedByLabel)})`;

    return `<span class="inline-flex items-center gap-1 text-[9px] font-black bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/40 px-1.5 py-0.5 rounded shrink-0 shadow-xs" title="Force Catered by ${escapeHtml(forcedByLabel)}"><i class="fa-solid fa-bolt text-[8px] text-amber-500"></i> ${badgeText}</span>`;
}