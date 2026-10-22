// src/features/chat/threadActions/threadUtils.js

/**
 * Sanitizes a Firebase RTDB key by removing leading '#' and replacing invalid characters.
 * @param {string} key 
 * @returns {string}
 */
export function cleanFirebasePathKey(key) {
    return String(key || '').replace(/^#+/, '').replace(/[.#$\[\]\/]/g, '_').trim();
}

/**
 * Strips undefined properties recursively for Firebase compatibility.
 * @param {Object} obj 
 * @returns {Object}
 */
export function sanitizeForFirebase(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        return value === undefined ? null : value;
    }));
}

/**
 * Formats a Google Maps URL from link or GPS coordinates string.
 * @param {string} linkOrCoords 
 * @returns {string}
 */
export function formatMapPinUrl(linkOrCoords) {
    if (!linkOrCoords) return '#';
    const str = String(linkOrCoords).trim();
    if (!str || str === '#') return '#';
    if (str.startsWith('http://') || str.startsWith('https://')) return str;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(str)}`;
}

/**
 * Extracts a clean customer search query by removing FB placeholder boilerplate.
 * @param {string} rawName 
 * @returns {string}
 */
export function extractCleanSearchName(rawName) {
    if (!rawName) return "";
    let s = String(rawName).trim();
    s = s.replace(/\(FB Customer[^)]*\)/gi, '').trim();
    if (s.toLowerCase().startsWith('fb customer') || s.toLowerCase() === 'customer' || s.toLowerCase() === 'customer name') {
        return "";
    }
    return s;
}

