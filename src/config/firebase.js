// src/config/firebase.js

/**
 * ============================================================================
 * SUPABASE-NATIVE DATABASE ADAPTER EXPORT (ZERO FIREBASE RELIANCE)
 * ============================================================================
 * All 33 database nodes, Store Menu Galleries, and Shift History are 100%
 * hosted on Supabase PostgreSQL & Realtime.
 * ============================================================================
 */

import { supabaseDb } from './supabaseDb.js';

export const db = supabaseDb;
export const primaryDb = supabaseDb;
export const backupDb = null;
export const auth = null;
export const messaging = null;
export const storage = null;

export function isSupabaseSelected() {
    return true;
}

export function queueOfflineMutation(type, id, data, action) {
    if (typeof window !== 'undefined' && typeof window.queueOfflineRosterMutation === 'function') {
        window.queueOfflineRosterMutation(type, id, data, action);
    }
}

export function processOutbox() {
    if (typeof window !== 'undefined' && typeof window.flushOfflineRosterOutbox === 'function') {
        return window.flushOfflineRosterOutbox();
    }
    return Promise.resolve();
}

if (typeof window !== 'undefined') {
    window.db = supabaseDb;
    window.primaryDb = supabaseDb;
    window.supabaseDb = supabaseDb;
    window.activeDbProvider = 'supabase';
    window.switchDatabaseProvider = () => {
        console.log('[Database Provider] 100% Supabase mode is enforced.');
    };
}

export default null;
