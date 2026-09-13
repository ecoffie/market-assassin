import { createClient, SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';
import { PKCE_VERIFIER_COOKIE } from '@/lib/mindy/oauth-callback';

// Supabase client configuration
// These should be set in your environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabaseInstance: SupabaseClient | null = null;

/**
 * PKCE verifier must reach GET /auth/callback. supabase-js keeps it in
 * localStorage by default — the server cannot see that. Mirror only the
 * `*-code-verifier` key into a first-party SameSite=Lax cookie so the
 * callback can exchange `?code=` without @supabase/ssr.
 *
 * Password login does not use this key. Session tokens stay in localStorage.
 */
function pkceAwareBrowserStorage(): SupportedStorage {
  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => {
      window.localStorage.setItem(key, value);
      if (key.endsWith('-code-verifier')) {
        const secure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `${PKCE_VERIFIER_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=600; SameSite=Lax${secure}`;
      }
    },
    removeItem: (key) => {
      window.localStorage.removeItem(key);
      if (key.endsWith('-code-verifier')) {
        document.cookie = `${PKCE_VERIFIER_COOKIE}=; Path=/; Max-Age=0`;
      }
    },
  };
}

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
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        flowType: 'pkce',
        ...(typeof window !== 'undefined' ? { storage: pkceAwareBrowserStorage() } : {}),
      },
    });
  }

  return supabaseInstance;
}

// For backward compatibility — REUSES the single instance (no 2nd GoTrueClient).
export const supabase = getSupabase();


