import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Separate Supabase client for the Action Planner
// Uses its own Supabase project to keep planner data isolated
const plannerUrl = process.env.NEXT_PUBLIC_PLANNER_SUPABASE_URL;
const plannerAnonKey = process.env.NEXT_PUBLIC_PLANNER_SUPABASE_ANON_KEY;

let plannerInstance: SupabaseClient | null = null;

export function getPlannerSupabase(): SupabaseClient | null {
  // Fall back to the main Supabase client env vars if planner-specific ones aren't set
  const url = plannerUrl || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = plannerAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (typeof window !== 'undefined') {
      console.warn('Planner Supabase environment variables are not set.');
    }
    return null;
  }

  if (!plannerInstance) {
    plannerInstance = createClient(url, key);
  }

  return plannerInstance;
}

/**
 * Admin client for the planner Supabase project (server-side only).
 * Uses the service role key to bypass RLS — needed for listing users
 * and querying across all accounts (e.g., weekly digest cron).
 */
let plannerAdminInstance: SupabaseClient | null = null;

export function getPlannerSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_PLANNER_SUPABASE_URL;
  const serviceKey = process.env.PLANNER_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) return null;

  if (!plannerAdminInstance) {
    plannerAdminInstance = createClient(url, serviceKey);
  }

  return plannerAdminInstance;
}
