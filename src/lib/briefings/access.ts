import { kv } from '@vercel/kv';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

export async function hasBriefingsEntitlement(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) return false;

  const supabase = getSupabase();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from('user_profiles')
    .select('access_briefings, briefings_expires_at')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (error || !data?.access_briefings) {
    return false;
  }

  if (data.briefings_expires_at) {
    return new Date(data.briefings_expires_at).getTime() >= Date.now();
  }

  return true;
}

export async function hasBriefingsAccess(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) return false;

  try {
    const kvAccess = await kv.get(`briefings:${normalizedEmail}`);
    if (kvAccess) return true;
  } catch (error) {
    console.warn(`[Briefings Access] KV unavailable for hasBriefingsAccess ${normalizedEmail}; checking Supabase only`, error);
    // Continue to check Supabase entitlement as fallback
  }

  return hasBriefingsEntitlement(normalizedEmail);
}

export async function grantBriefingsAccess(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) return;

  try {
    await kv.set(`briefings:${normalizedEmail}`, 'true');
  } catch (error) {
    console.warn(`[Briefings Access] KV unavailable for grantBriefingsAccess ${normalizedEmail}`, error);
    // Grant operation failed but don't throw - caller can proceed
  }
}

/**
 * Result of a both-sides entitlement write. `ok` is false when EITHER store
 * failed — the caller must not report success on a partial write.
 */
export interface EntitlementWriteResult {
  ok: boolean;
  wroteKv: boolean;
  wroteProfile: boolean;
  failures: string[];
}

/**
 * Clear briefings access from BOTH stores.
 *
 * THE BUG THIS FIXES (TASK-STRIPE-DUP-004 scope item 11): `revokeBriefingsAccess`
 * cleared KV only. `hasBriefingsAccess` falls back to the Supabase entitlement
 * when the KV key is absent, so a revoked customer whose `access_briefings`
 * flag was still true KEPT access — the profile flag stranded it. Symmetric
 * revocation clears both together, and reports honestly when one side fails
 * rather than swallowing it.
 *
 * ⚠️ Call this ONLY when the FINAL qualifying entitlement has ended. When a
 * redundant duplicate subscription lapses while another qualifying
 * subscription survives, revoking would lock out a paying customer — see
 * `repairEntitlement` in lib/supabase/briefings-entitlement.ts, which
 * establishes the surviving set before deciding.
 */
export async function revokeBriefingsAccessBothSides(email: string): Promise<EntitlementWriteResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const failures: string[] = [];
  if (!normalizedEmail) return { ok: false, wroteKv: false, wroteProfile: false, failures: ['no email'] };

  let wroteKv = false;
  try {
    await kv.del(`briefings:${normalizedEmail}`);
    wroteKv = true;
  } catch (error) {
    failures.push(`kv delete failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let wroteProfile = false;
  const supabase = getSupabase();
  if (!supabase) {
    failures.push('supabase not configured — profile entitlement NOT cleared');
  } else {
    const { error } = await supabase
      .from('user_profiles')
      .update({ access_briefings: false, briefings_expires_at: null, updated_at: new Date().toISOString() })
      .eq('email', normalizedEmail);
    if (error) failures.push(`profile update failed: ${error.message}`);
    else wroteProfile = true;
  }

  return { ok: failures.length === 0, wroteKv, wroteProfile, failures };
}

/**
 * KV-only revoke. RETAINED for the existing callers that intentionally touch
 * only the fast gate; prefer `revokeBriefingsAccessBothSides` for a real
 * end-of-entitlement revocation, or the profile flag will strand access.
 */
export async function revokeBriefingsAccess(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) return;

  try {
    await kv.del(`briefings:${normalizedEmail}`);
  } catch (error) {
    console.warn(`[Briefings Access] KV unavailable for revokeBriefingsAccess ${normalizedEmail}`, error);
    // Revoke operation failed but don't throw
  }
}
