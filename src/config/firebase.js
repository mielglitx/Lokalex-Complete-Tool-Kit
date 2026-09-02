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
// 2. DUAL-DATABASE PROXY ENGINE (REALTIME DUAL-WRITE & PRIMARY READ)
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

        // --- DUAL-WRITE OPERATIONS (SIMULTANEOUS MIRRORING) ---
        set(value, onComplete) {
            const p = primaryRef.set(value, onComplete);
            if (backupDb && backupRef) {
                backupRef.set(value).catch((err) => {
                    console.warn(`[Backup DB Sync] set error on ${backupRef.toString()}:`, err.message);
                });
            }
            return p;
        },
        update(values, onComplete) {
            const p = primaryRef.update(values, onComplete);
            if (backupDb && backupRef) {
                backupRef.update(values).catch((err) => {
                    console.warn(`[Backup DB Sync] update error on ${backupRef.toString()}:`, err.message);
                });
            }
            return p;
        },
        remove(onComplete) {
            const p = primaryRef.remove(onComplete);
            if (backupDb && backupRef) {
                backupRef.remove().catch((err) => {
                    console.warn(`[Backup DB Sync] remove error on ${backupRef.toString()}:`, err.message);
                });
            }
            return p;
        },
        push(value, onComplete) {
            if (value !== undefined) {
                const newPrimaryRef = primaryRef.push();
                const newKey = newPrimaryRef.key;
                const p = newPrimaryRef.set(value, onComplete);

                if (backupDb && backupRef && newKey) {
                    backupRef.child(newKey).set(value).catch((err) => {
                        console.warn(`[Backup DB Sync] push error on ${backupRef.toString()}:`, err.message);
                    });
                }
                return newPrimaryRef;
            } else {
                const newPrimaryRef = primaryRef.push();
                const newKey = newPrimaryRef.key;
                const newBackupRef = backupDb && backupRef && newKey ? backupRef.child(newKey) : null;
                return createRefWrapper(newPrimaryRef, newBackupRef);
            }
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

// 3. Centralized Database Proxy Export (Zero changes needed across the rest of the application)
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