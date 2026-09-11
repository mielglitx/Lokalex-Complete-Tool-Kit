// src/config/firebase.js
const firebaseConfig = {
    apiKey: "AIzaSyD2ZbvO60h-udB_iNZ6zVbmXjMwYfbS_2w",
    authDomain: "lokalex-hub.firebaseapp.com",
    databaseURL: "https://lokalex-hub-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "lokalex-hub",
    storageBucket: "lokalex-hub.appspot.com",
    messagingSenderId: "102938475610",
    appId: "1:102938475610:web:abcdef1234567890"
};

const DEFAULT_DB_URL = "https://lokalex-hub-default-rtdb.asia-southeast1.firebasedatabase.app";
const BACKUP_DB_URL = "https://lokalex-hub-backupdatabase.asia-southeast1.firebasedatabase.app";

const fb = window.firebase || (typeof firebase !== 'undefined' ? firebase : null);

if (fb && !fb.apps.length) {
    fb.initializeApp(firebaseConfig);
}

// 1. Initialize distinct instances for Primary and Backup Realtime Databases
export const primaryDb = fb ? fb.app().database(DEFAULT_DB_URL) : null;
export const backupDb = fb ? fb.app().database(BACKUP_DB_URL) : null;
export const auth = fb ? fb.auth() : null;
export const messaging = (fb && typeof fb.messaging === 'function' && fb.messaging.isSupported()) ? fb.messaging() : null;

// ============================================================================
// 2. OPTIMISTIC OFFLINE OUTBOX QUEUE ENGINE
// ============================================================================

const OUTBOX_STORAGE_KEY = 'lokalex_db_outbox';
let isSyncInProgress = false;
let isSocketConnected = navigator.onLine;

function getOutbox() {
    try {
        return JSON.parse(localStorage.getItem(OUTBOX_STORAGE_KEY) || '[]');
    } catch {
        return [];
    }
}

function saveOutbox(queue) {
    try {
        localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(queue));
    } catch (e) {
        console.warn('Failed to save offline outbox queue:', e);
    }
    window.dispatchEvent(new CustomEvent('dbOutboxChanged', {
        detail: { count: queue.length, isOnline: isSocketConnected }
    }));
}

export function queueOfflineMutation(path, method, value) {
    if (!path) return;
    const cleanPath = path.replace(/^\/+/, '');
    const queue = getOutbox();
    queue.push({
        id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        path: cleanPath,
        method: method, // 'set', 'update', or 'remove'
        value: value !== undefined ? value : null,
        timestamp: Date.now()
    });
    saveOutbox(queue);
}

export async function drainOfflineOutbox() {
    if (isSyncInProgress || !navigator.onLine || !primaryDb) return;
    const queue = getOutbox();
    if (queue.length === 0) return;

    isSyncInProgress = true;
    const remaining = [];

    for (const item of queue) {
        try {
            const pRef = primaryDb.ref(item.path);
            const bRef = backupDb ? backupDb.ref(item.path) : null;

            if (item.method === 'set') {
                await pRef.set(item.value);
                if (bRef) bRef.set(item.value).catch(() => {});
            } else if (item.method === 'update') {
                await pRef.update(item.value);
                if (bRef) bRef.update(item.value).catch(() => {});
            } else if (item.method === 'remove') {
                await pRef.remove();
                if (bRef) bRef.remove().catch(() => {});
            }
        } catch (err) {
            console.warn(`[Offline Outbox] Failed to replay mutation for ${item.path}:`, err);
            remaining.push(item);
        }
    }

    saveOutbox(remaining);
    isSyncInProgress = false;

    if (queue.length > 0 && remaining.length === 0) {
        console.log('[Offline Outbox] All pending database mutations synced successfully.');
    }
}

// Monitor real-time connection state for automatic outbox replay
if (primaryDb) {
    primaryDb.ref('.info/connected').on('value', (snap) => {
        isSocketConnected = !!snap.val();
        if (isSocketConnected) {
            drainOfflineOutbox();
        }
    });
}

window.addEventListener('online', () => {
    isSocketConnected = true;
    drainOfflineOutbox();
});

window.addEventListener('offline', () => {
    isSocketConnected = false;
});

function getRelativeRefPath(ref) {
    if (!ref) return '';
    try {
        const rootStr = ref.root.toString().replace(/\/$/, '');
        const fullStr = ref.toString().replace(/\/$/, '');
        return fullStr.replace(rootStr, '').replace(/^\//, '');
    } catch {
        return ref.key || '';
    }
}

// ============================================================================
// 3. DUAL-DATABASE PROXY ENGINE (REALTIME DUAL-WRITE & PRIMARY READ)
// ============================================================================

function createRefWrapper(primaryRef, backupRef) {
    if (!primaryRef) return null;

    const wrapper = {
        get key() {
            return primaryRef.key;
        },
        get parent() {
            return createRefWrapper(primaryRef.parent, backupRef ? backupRef.parent : null);
        },
        get root() {
            return createRefWrapper(primaryRef.root, backupRef ? backupRef.root : null);
        },
        get ref() {
            return wrapper;
        },
        child(childPath) {
            return createRefWrapper(
                primaryRef.child(childPath),
                backupRef ? backupRef.child(childPath) : null
            );
        },

        // --- DUAL-WRITE OPERATIONS WITH OPTIMISTIC OFFLINE OUTBOX ---
        set(value, onComplete) {
            const relPath = getRelativeRefPath(primaryRef);

            if (!navigator.onLine || !isSocketConnected) {
                queueOfflineMutation(relPath, 'set', value);
                if (typeof onComplete === 'function') onComplete(null);
                return Promise.resolve();
            }

            const p = primaryRef.set(value, onComplete).catch((err) => {
                queueOfflineMutation(relPath, 'set', value);
                throw err;
            });

            if (backupDb && backupRef) {
                backupRef.set(value).catch((err) => {
                    console.warn(`[Backup DB Sync] set error on ${backupRef.toString()}:`, err.message);
                });
            }
            return p;
        },
        update(values, onComplete) {
            const relPath = getRelativeRefPath(primaryRef);

            if (!navigator.onLine || !isSocketConnected) {
                queueOfflineMutation(relPath, 'update', values);
                if (typeof onComplete === 'function') onComplete(null);
                return Promise.resolve();
            }

            const p = primaryRef.update(values, onComplete).catch((err) => {
                queueOfflineMutation(relPath, 'update', values);
                throw err;
            });

            if (backupDb && backupRef) {
                backupRef.update(values).catch((err) => {
                    console.warn(`[Backup DB Sync] update error on ${backupRef.toString()}:`, err.message);
                });
            }
            return p;
        },
        remove(onComplete) {
            const relPath = getRelativeRefPath(primaryRef);

            if (!navigator.onLine || !isSocketConnected) {
                queueOfflineMutation(relPath, 'remove', null);
                if (typeof onComplete === 'function') onComplete(null);
                return Promise.resolve();
            }

            const p = primaryRef.remove(onComplete).catch((err) => {
                queueOfflineMutation(relPath, 'remove', null);
                throw err;
            });

            if (backupDb && backupRef) {
                backupRef.remove().catch((err) => {
                    console.warn(`[Backup DB Sync] remove error on ${backupRef.toString()}:`, err.message);
                });
            }
            return p;
        },
        push(value, onComplete) {
            const newPrimaryRef = primaryRef.push();
            const newKey = newPrimaryRef.key;
            const newBackupRef = backupDb && backupRef && newKey ? backupRef.child(newKey) : null;
            const wrappedPush = createRefWrapper(newPrimaryRef, newBackupRef);

            if (value !== undefined) {
                wrappedPush.set(value, onComplete);
                return newPrimaryRef;
            }
            return wrappedPush;
        },
        transaction(transactionUpdate, onComplete, applyLocally) {
            return primaryRef.transaction((currentVal) => {
                return transactionUpdate(currentVal);
            }, (error, committed, snapshot) => {
                if (committed && snapshot && backupDb && backupRef) {
                    backupRef.set(snapshot.val()).catch((err) => {
                        console.warn(`[Backup DB Sync] transaction sync error on ${backupRef.toString()}:`, err.message);
                    });
                }
                if (typeof onComplete === 'function') {
                    onComplete(error, committed, snapshot);
                }
            }, applyLocally);
        },
        onDisconnect() {
            const pDisconnect = primaryRef.onDisconnect();
            const bDisconnect = backupRef ? backupRef.onDisconnect() : null;

            return {
                set(value, onComplete) {
                    const p = pDisconnect.set(value, onComplete);
                    if (bDisconnect) bDisconnect.set(value).catch(() => {});
                    return p;
                },
                update(values, onComplete) {
                    const p = pDisconnect.update(values, onComplete);
                    if (bDisconnect) bDisconnect.update(values).catch(() => {});
                    return p;
                },
                remove(onComplete) {
                    const p = pDisconnect.remove(onComplete);
                    if (bDisconnect) bDisconnect.remove().catch(() => {});
                    return p;
                },
                cancel(onComplete) {
                    const p = pDisconnect.cancel(onComplete);
                    if (bDisconnect) bDisconnect.cancel().catch(() => {});
                    return p;
                }
            };
        },

        // --- READ & LISTENER OPERATIONS (ROUTED TO PRIMARY DB) ---
        on(eventType, callback, cancelCallbackOrContext, context) {
            return primaryRef.on(eventType, callback, cancelCallbackOrContext, context);
        },
        once(eventType, successCallback, failureCallbackOrContext, context) {
            return primaryRef.once(eventType, successCallback, failureCallbackOrContext, context);
        },
        off(eventType, callback, context) {
            return primaryRef.off(eventType, callback, context);
        },

        // --- QUERY BUILDER ATTACHMENTS ---
        orderByChild(path) {
            return createQueryWrapper(primaryRef.orderByChild(path), backupRef);
        },
        orderByKey() {
            return createQueryWrapper(primaryRef.orderByKey(), backupRef);
        },
        orderByValue() {
            return createQueryWrapper(primaryRef.orderByValue(), backupRef);
        },
        orderByPriority() {
            return createQueryWrapper(primaryRef.orderByPriority(), backupRef);
        },
        limitToFirst(limit) {
            return createQueryWrapper(primaryRef.limitToFirst(limit), backupRef);
        },
        limitToLast(limit) {
            return createQueryWrapper(primaryRef.limitToLast(limit), backupRef);
        },
        startAt(value, key) {
            return createQueryWrapper(primaryRef.startAt(value, key), backupRef);
        },
        endAt(value, key) {
            return createQueryWrapper(primaryRef.endAt(value, key), backupRef);
        },
        equalTo(value, key) {
            return createQueryWrapper(primaryRef.equalTo(value, key), backupRef);
        },
        toString() {
            return primaryRef.toString();
        }
    };

    return wrapper;
}

function createQueryWrapper(primaryQuery, backupRef) {
    const queryWrapper = {
        get ref() {
            return createRefWrapper(primaryQuery.ref, backupRef);
        },
        on(eventType, callback, cancelCallbackOrContext, context) {
            return primaryQuery.on(eventType, callback, cancelCallbackOrContext, context);
        },
        once(eventType, successCallback, failureCallbackOrContext, context) {
            return primaryQuery.once(eventType, successCallback, failureCallbackOrContext, context);
        },
        off(eventType, callback, context) {
            return primaryQuery.off(eventType, callback, context);
        },
        orderByChild(path) {
            return createQueryWrapper(primaryQuery.orderByChild(path), backupRef);
        },
        orderByKey() {
            return createQueryWrapper(primaryQuery.orderByKey(), backupRef);
        },
        orderByValue() {
            return createQueryWrapper(primaryQuery.orderByValue(), backupRef);
        },
        orderByPriority() {
            return createQueryWrapper(primaryQuery.orderByPriority(), backupRef);
        },
        limitToFirst(limit) {
            return createQueryWrapper(primaryQuery.limitToFirst(limit), backupRef);
        },
        limitToLast(limit) {
            return createQueryWrapper(primaryQuery.limitToLast(limit), backupRef);
        },
        startAt(value, key) {
            return createQueryWrapper(primaryQuery.startAt(value, key), backupRef);
        },
        endAt(value, key) {
            return createQueryWrapper(primaryQuery.endAt(value, key), backupRef);
        },
        equalTo(value, key) {
            return createQueryWrapper(primaryQuery.equalTo(value, key), backupRef);
        },
        toString() {
            return primaryQuery.toString();
        }
    };

    return queryWrapper;
}

// 4. Centralized Database Proxy Export
export const db = fb ? {
    ref(path = '') {
        const pRef = primaryDb ? primaryDb.ref(path) : null;
        const bRef = backupDb ? backupDb.ref(path) : null;
        return createRefWrapper(pRef, bRef);
    },
    goOnline() {
        if (primaryDb) primaryDb.goOnline();
        if (backupDb) backupDb.goOnline();
    },
    goOffline() {
        if (primaryDb) primaryDb.goOffline();
        if (backupDb) backupDb.goOffline();
    },
    get app() {
        return fb.app();
    }
} : null;

export default fb;