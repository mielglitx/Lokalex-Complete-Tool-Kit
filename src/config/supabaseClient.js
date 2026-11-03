// src/config/supabaseClient.js

/**
 * ============================================================================
 * SUPABASE CLIENT CONFIGURATION & INITIALIZATION
 * ============================================================================
 * Connected to Lokalex Supabase Project
 * Project URL: https://brdvugzjhkimcyabptcw.supabase.co
 * ============================================================================
 */

import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = "https://brdvugzjhkimcyabptcw.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_7wn7gV5RvuKWE2kGLRmaTQ_fgIC579K";

export function getSupabaseConfig() {
  const url = (typeof window !== 'undefined' && window.localStorage?.getItem('lokalex_supabase_url')) 
    || import.meta.env?.VITE_SUPABASE_URL 
    || DEFAULT_SUPABASE_URL;

  const anonKey = (typeof window !== 'undefined' && window.localStorage?.getItem('lokalex_supabase_anon_key')) 
    || import.meta.env?.VITE_SUPABASE_ANON_KEY 
    || DEFAULT_SUPABASE_ANON_KEY;

  return { url, anonKey };
}

export function saveSupabaseConfig(url, anonKey) {
  if (typeof window !== 'undefined' && window.localStorage) {
    if (url) window.localStorage.setItem('lokalex_supabase_url', url);
    if (anonKey) window.localStorage.setItem('lokalex_supabase_anon_key', anonKey);
  }
}

let supabaseInstance = null;

export function getSupabase() {
  if (supabaseInstance) return supabaseInstance;
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    return null;
  }
  supabaseInstance = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true
    },
    realtime: {
      params: {
        eventsPerSecond: 10
      }
    }
  });
  return supabaseInstance;
}

export const supabase = getSupabase();
export default supabase;
