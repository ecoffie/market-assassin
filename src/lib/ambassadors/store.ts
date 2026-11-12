/**
 * Mindy Ambassadors — storage (table `ambassadors`, migration 20261112_ambassadors.sql).
 *
 * Lifecycle: pending → approved | rejected; approved → removed. Approving grants free Pro
 * (member-grants, the same path as a staff grant) and turns on unlimited use: the metered MCP
 * edge charges an approved ambassador 0 credits (src/lib/mcp/metered.ts).
 */
import { getReadClient, getWriteClient } from '@/lib/supabase/server-clients';
import type { AmbassadorApplication } from './application';

export type AmbassadorStatus = 'pending' | 'approved' | 'rejected' | 'removed';

export interface AmbassadorRow {
  email: string;
  name: string;
  company: string | null;
  role: string | null;
  linkedin_url: string | null;
  website_url: string | null;
  audience: string;
  why: string;
  promote_plan: string | null;
  status: AmbassadorStatus;
  referral_code: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

const norm = (e: string) => e.trim().toLowerCase();

/** The link an ambassador shares. RefCapture (root layout) parks ?ref= in the mindy_ref cookie, and
 *  /pricing is where a new visitor starts the 14-day trial. Tracked by src/lib/mcp/referrals.ts. */
export const ambassadorReferralLink = (code: string) => `https://getmindy.ai/pricing?ref=${encodeURIComponent(code)}`;

export async function getAmbassador(email: string): Promise<AmbassadorRow | null> {
  const { data, error } = await getWriteClient().from('ambassadors').select('*').eq('email', norm(email)).maybeSingle();
  if (error) throw new Error(`ambassadors read failed: ${error.message}`);
  return (data as AmbassadorRow | null) ?? null;
}

/**
 * Save an application. A new applicant, or one previously rejected/removed, becomes `pending`.
 * An approved ambassador's row is never downgraded by re-applying; a pending one is refreshed.
 */
export async function saveApplication(a: AmbassadorApplication): Promise<{ status: 'saved' | 'already_ambassador' }> {
  const existing = await getAmbassador(a.email);
  if (existing?.status === 'approved') return { status: 'already_ambassador' };
  const row = {
    email: norm(a.email),
    name: a.name,
    company: a.company || null,
    role: a.role || null,
    linkedin_url: a.linkedinUrl || null,
    website_url: a.websiteUrl || null,
    audience: `[${a.audienceSize}] ${a.audience}`,
    why: a.why,
    promote_plan: a.promotePlan || null,
    status: 'pending' as const,
    decided_at: null,
    decided_by: null,
    decision_note: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await getWriteClient().from('ambassadors').upsert(row, { onConflict: 'email' });
  if (error) throw new Error(`ambassadors write failed: ${error.message}`);
  return { status: 'saved' };
}

/** Every application of one status (or all), newest first. Paged: PostgREST caps a response at 1,000 rows. */
export async function listAmbassadors(status?: AmbassadorStatus): Promise<AmbassadorRow[]> {
  const out: AmbassadorRow[] = [];
  for (let from = 0; ; from += 1000) {
    let q = getReadClient().from('ambassadors').select('*').order('created_at', { ascending: false }).range(from, from + 999);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw new Error(`ambassadors list failed: ${error.message}`);
    out.push(...((data as AmbassadorRow[]) ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function setDecision(email: string, status: Exclude<AmbassadorStatus, 'pending'>, by: string, note: string | null, referralCode?: string | null): Promise<AmbassadorRow> {
  const patch: Record<string, unknown> = {
    status,
    decided_at: new Date().toISOString(),
    decided_by: by,
    decision_note: note,
    updated_at: new Date().toISOString(),
  };
  if (referralCode !== undefined) patch.referral_code = referralCode;
  const { data, error } = await getWriteClient().from('ambassadors').update(patch).eq('email', norm(email)).select('*').maybeSingle();
  if (error) throw new Error(`ambassadors update failed: ${error.message}`);
  if (!data) throw new Error(`no ambassador application for ${norm(email)}`);
  ambassadorCache.delete(norm(email));
  return data as AmbassadorRow;
}

// ── Is this caller an approved ambassador? (read on every metered MCP call) ────────────────
// Cached per instance for 60s so the billing path adds at most one small read a minute per user.
// On a read error it answers false: the call is billed normally, never given away by accident.
const AMBASSADOR_CACHE_MS = 60_000;
const ambassadorCache = new Map<string, { value: boolean; expires: number }>();

export async function isApprovedAmbassador(email: string | null | undefined): Promise<boolean> {
  const key = norm(email || '');
  if (!key) return false;
  const hit = ambassadorCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const { data, error } = await getReadClient().from('ambassadors').select('status').eq('email', key).maybeSingle();
    if (error) throw new Error(error.message);
    const value = (data as { status?: string } | null)?.status === 'approved';
    ambassadorCache.set(key, { value, expires: Date.now() + AMBASSADOR_CACHE_MS });
    return value;
  } catch (err) {
    // Cache the miss too, so a missing table or a database blip costs one failed read a minute per
    // user, not one per billed call.
    console.error('[ambassadors] status read failed, billing normally:', (err as Error).message);
    ambassadorCache.set(key, { value: false, expires: Date.now() + AMBASSADOR_CACHE_MS });
    return false;
  }
}

/** Test hook. */
export function clearAmbassadorCache(): void {
  ambassadorCache.clear();
}
