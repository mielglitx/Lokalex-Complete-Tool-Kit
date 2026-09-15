// src/utils/storageEngine.js

const DB_NAME = 'lokalex_idb_v1';
const DB_VERSION = 1;
const MEDIA_CACHE_NAME = 'lokalex-media-v1';

const STORES = ['directory', 'stores', 'menus', 'customers', 'chats', 'roster', 'meta'];

let dbPromise = null;

export function getDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
            console.warn('IndexedDB not supported on this platform.');
            return resolve(null);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            STORES.forEach(storeName => {
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName);
                }
            });
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            console.warn('IndexedDB open error:', request.error);
            resolve(null);
        };
    });

    return dbPromise;
}

export async function idbGet(storeName, key) {
    const db = await getDB();
    if (!db) return null;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        } catch (err) {
            resolve(null);
        }
    });
}

export async function idbSet(storeName, key, value) {
    const db = await getDB();
    if (!db) return false;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(value, key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        } catch (err) {
            resolve(false);
        }
    });
}

export async function idbGetAll(storeName) {
    const db = await getDB();
    if (!db) return [];

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        } catch (err) {
            resolve([]);
        }
    });
}

export async function idbClear(storeName) {
    const db = await getDB();
    if (!db) return false;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.clear();
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        } catch (err) {
            resolve(false);
        }
    });
}

export async function idbSetBatch(storeName, keyValueMap) {
    const db = await getDB();
    if (!db || !keyValueMap) return false;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);

            Object.entries(keyValueMap).forEach(([k, v]) => {
                store.put(v, k);
            });

            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (err) {
            resolve(false);
        }
    });
}

// CACHESTORAGE ASSET PIPELINE (AVATARS, MENUS, LOGOS, MAP THUMBNAILS)
export async function cacheMediaAsset(url) {
    if (!url || typeof url !== 'string') return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return;
    if (!('caches' in window)) return;

    try {
        const cache = await caches.open(MEDIA_CACHE_NAME);
        const match = await cache.match(url);
        if (match) return;

        fetch(url, { mode: 'no-cors' }).then(res => {
            if (res && (res.status === 200 || res.type === 'opaque')) {
                cache.put(url, res);
            }
        }).catch(() => {});
    } catch (_) {}
}

export async function prefetchMediaBatch(urlList) {
    if (!Array.isArray(urlList) || urlList.length === 0) return;
    const cleanUrls = [...new Set(urlList.filter(u => u && typeof u === 'string' && u.startsWith('http')))];

    const workerQueue = cleanUrls.slice(0, 40);
    workerQueue.forEach(url => {
        cacheMediaAsset(url);
    });
}

if (typeof window !== 'undefined') {
    window.idbGet = idbGet;
    window.idbSet = idbSet;
    window.idbGetAll = idbGetAll;
    window.idbSetBatch = idbSetBatch;
    window.cacheMediaAsset = cacheMediaAsset;
    window.prefetchMediaBatch = prefetchMediaBatch;
}