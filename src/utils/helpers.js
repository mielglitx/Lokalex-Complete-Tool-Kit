// src/utils/helpers.js
export function getLocalTodayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function escapeHtml(str) { 
    return str ? str.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : ""; 
}

export function isSameDate(dateVal, targetDateStr) {
    if (!dateVal) return false;
    let str = dateVal.toString().trim();
    if (str.indexOf("T") !== -1) str = str.split("T")[0];
    str = str.replace(/\//g, '-');
    const parts = str.split('-');
    if (parts.length === 3) {
        let y, m, d;
        if (parts[0].length === 4) {
            y = parts[0]; m = parts[1].padStart(2, '0'); d = parts[2].padStart(2, '0');
        } else if (parts[2].length === 4) {
            m = parts[0].padStart(2, '0'); d = parts[1].padStart(2, '0'); y = parts[2];
        }
        if (y && m && d) return `${y}-${m}-${d}` === targetDateStr;
    }
    return str === targetDateStr;
}

export function copyText(text) { 
    navigator.clipboard.writeText(text); 
    // Dispatch custom event for toast instead of circular dependency
    window.dispatchEvent(new CustomEvent('showToast', { detail: "Copied to clipboard!" }));
}