/**
 * Mindy Ambassadors — storage.
 *
 * Kept in Vercel KV (the same store as access codes), not a Postgres table: the program had to work
 * the moment it deployed, and new tables here need a hand-run migration (owner, 2026-11-13: "do it
 * on your own ... use whatever work around u need"). Volume is tiny (applications, by hand).
 *
 *   ambassador:app:<email>  → AmbassadorRow (JSON)
 *   ambassador:index        → set of every applicant email
 *
 * Lifecycle: pending → approved | rejected; approved → removed. Approving grants free Pro
 * (member-grants, the same path as a staff grant) and the metered MCP edge charges an approved
 * ambassador 0 credits (src/lib/mcp/metered.ts). The program document promises "a generous monthly
 * credit allowance" with "a stated fair-use limit that no normal user reaches"; no such limit is
 * enforced in code yet.
 */
import { kv } from '@vercel/kv';
import type { AmbassadorApplication } from './application';

export type AmbassadorStatus = 'pending' | 'approved' | 'rejected' | 'removed';

export interface AmbassadorRow {
  email: string;
  name: string;
  company: string | null;
  /** Section 9 of the program document (applications from 2026-11-13 on). */
  post_url?: string | null;
  uei?: string | null;
  last_event?: string | null;
  pursuit?: string | null;
  want_to_find?: string | null;
  /** When they ticked "I meet all six requirements and will disclose on every post." */
  attested_at?: string | null;
  /** First-version form fields. Kept so rows saved before 2026-11-13 still read and render. */
  role?: string | null;
  linkedin_url?: string | null;
  website_url?: string | null;
  audience?: string | null;
  why?: string | null;
  promote_plan?: string | null;
  status: AmbassadorStatus;
  referral_code: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

const norm = (e: string) => e.trim().toLowerCase();
const KEY = (email: string) => `ambassador:app:${norm(email)}`;
const INDEX = 'ambassador:index';

/** The link an ambassador shares. RefCapture (root layout) parks ?ref= in the mindy_ref cookie, and
 *  /pricing is where a new visitor starts the 14-day trial. Tracked by src/lib/mcp/referrals.ts. */
export const ambassadorReferralLink = (code: string) => `https://getmindy.ai/pricing?ref=${encodeURIComponent(code)}`;

export async function getAmbassador(email: string): Promise<AmbassadorRow | null> {
  try {
    return (await kv.get<AmbassadorRow>(KEY(email))) ?? null;
  } catch (err) {
    throw new Error(`ambassadors read failed: ${(err as Error).message}`);
  }
}

async function put(row: AmbassadorRow): Promise<void> {
  try {
    await kv.set(KEY(row.email), row);
    await kv.sadd(INDEX, row.email);
  } catch (err) {
    throw new Error(`ambassadors write failed: ${(err as Error).message}`);
  }
  ambassadorCache.delete(row.email);
}

/**
 * Save an application. A new applicant, or one previously rejected/removed, becomes `pending`.
 * An approved ambassador's row is never downgraded by re-applying; a pending one is refreshed.
 */
export async function saveApplication(a: AmbassadorApplication): Promise<{ status: 'saved' | 'already_ambassador' }> {
  const existing = await getAmbassador(a.email);
  if (existing?.status === 'approved') return { status: 'already_ambassador' };
  const now = new Date().toISOString();
  await put({
    email: norm(a.email),
    name: a.name,
    company: a.company || null,
    post_url: a.postUrl,
    uei: a.uei,
    last_event: a.lastEvent,
    pursuit: a.pursuit,
    want_to_find: a.wantToFind,
    attested_at: now,
    status: 'pending',
    referral_code: existing?.referral_code ?? null,
    decided_at: null,
    decided_by: null,
    decision_note: null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  });
  return { status: 'saved' };
}

/** Every application of one status (or all), newest first. */
export async function listAmbassadors(status?: AmbassadorStatus): Promise<AmbassadorRow[]> {
  let emails: string[];
  try {
    emails = ((await kv.smembers(INDEX)) as string[]) ?? [];
  } catch (err) {
    throw new Error(`ambassadors list failed: ${(err as Error).message}`);
  }
  const rows: AmbassadorRow[] = [];
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100);
    const got = chunk.length ? await kv.mget<AmbassadorRow[]>(...chunk.map(KEY)) : [];
    for (const r of got) if (r) rows.push(r);
  }
  return rows
    .filter((r) => !status || r.status === status)
    .sort((x, y) => (y.created_at || '').localeCompare(x.created_at || ''));
}

export async function setDecision(email: string, status: Exclude<AmbassadorStatus, 'pending'>, by: string, note: string | null, referralCode?: string | null): Promise<AmbassadorRow> {
  const row = await getAmbassador(email);
  if (!row) throw new Error(`no ambassador application for ${norm(email)}`);
  const now = new Date().toISOString();
  const next: AmbassadorRow = {
    ...row,
    status,
    decided_at: now,
    decided_by: by,
    decision_note: note,
    updated_at: now,
    ...(referralCode !== undefined ? { referral_code: referralCode } : {}),
  };
  await put(next);
  return next;
}

// ── Is this caller an approved ambassador? (read on every metered MCP call) ────────────────
// Cached per instance for 60s so the billing path adds at most one small read a minute per user.
// On a read error it answers false (cached too): the call is billed normally, never given away.
const AMBASSADOR_CACHE_MS = 60_000;
const ambassadorCache = new Map<string, { value: boolean; expires: number }>();

export async function isApprovedAmbassador(email: string | null | undefined): Promise<boolean> {
  const key = norm(email || '');
  if (!key) return false;
  const hit = ambassadorCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value = false;
  try {
    const row = await kv.get<AmbassadorRow>(KEY(key));
    value = row?.status === 'approved';
  } catch (err) {
    console.error('[ambassadors] status read failed, billing normally:', (err as Error).message);
  }
  ambassadorCache.set(key, { value, expires: Date.now() + AMBASSADOR_CACHE_MS });
  return value;
}

/** Test hook. */
export function clearAmbassadorCache(): void {
  ambassadorCache.clear();
}
