import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Supabase client configuration
// These should be set in your environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabaseInstance: SupabaseClient | null = null;

// Create a single supabase client for interacting with your database
// Uses lazy initialization to avoid errors during build when env vars aren't set
export function getSupabase(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    if (typeof window !== 'undefined') {
      console.warn('Supabase environment variables are not set. Please configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
    }
    return null;
  }

  if (!supabaseInstance) {
    // Single auth storage key per browser context. A second createClient() here
    // (the old `supabase` export below) spawned a 2nd GoTrueClient on the SAME
    // localStorage key → "Multiple GoTrueClient instances detected" → the two
    // clients fought over the session token, so a save could send a stale/invalid
    // token and 401 even right after sign-in (Eric QC 2026-06-16: profile wouldn't
    // save). One instance only.
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  }

  return supabaseInstance;
}

// For backward compatibility — REUSES the single instance (no 2nd GoTrueClient).
export const supabase = getSupabase();


