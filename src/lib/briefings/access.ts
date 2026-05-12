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
