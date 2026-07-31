// src/utils/helpers.js
export function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function copyText(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
    } catch (err) {
        console.error('Fallback: Oops, unable to copy', err);
    }
    document.body.removeChild(textArea);
}

export function getLocalTodayStr() {
    const d = new Date();
    const tzOffsetMs = d.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzOffsetMs)).toISOString().slice(0, 10);
    return localISOTime;
}

// Get the YYYY-W## format for a given timestamp
export function getWeekString(timestamp) {
    const date = new Date(timestamp);
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${date.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

// Get the YYYY-MM format for a given timestamp
export function getMonthString(timestamp) {
    const d = new Date(timestamp);
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${d.getFullYear()}-${m}`;
}

// Get the YYYY-MM-DD format for a given timestamp
export function getDateString(timestamp) {
    const d = new Date(timestamp);
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
}