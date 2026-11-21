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
 *   ambassador:usage:<email>:<YYYY-MM> → credits of free calls used that UTC month (counter)
 *
 * Lifecycle: pending → approved | rejected; approved → removed (by hand) | ended (term over).
 * Approving grants free Pro (member-grants, the same path as a staff grant) and the metered MCP
 * edge charges an approved ambassador 0 credits (src/lib/mcp/metered.ts) up to
 * AMBASSADOR_MONTHLY_CREDIT_CAP a month; past the cap their calls bill like anyone's.
 *
 * Term (owner, 2026-11-16): twelve months from approval (`decided_at`). A notice email goes out at
 * day TERM_NOTICE_DAY, and at day TERM_DAYS the daily job /api/cron/ambassador-terms revokes the
 * Pro grant and marks the row `ended`.
 *
 * The program has NO referral link (owner, 2026-11-16): the referral program is a separate program
 * and is not called "ambassador". `referral_code` stays on the row type only so rows written before
 * that decision still read.
 */
import { kv } from '@vercel/kv';
import type { AmbassadorApplication } from './application';

export type AmbassadorStatus = 'pending' | 'approved' | 'rejected' | 'removed' | 'ended';

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
  /** Legacy: rows approved before 2026-11-16 got a referral code. Never set now. */
  referral_code: string | null;
  /** When the day-TERM_NOTICE_DAY "your term is ending" email went out. */
  term_notice_sent_at?: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

const norm = (e: string) => e.trim().toLowerCase();
const KEY = (email: string) => `ambassador:app:${norm(email)}`;
const INDEX = 'ambassador:index';

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

export async function setDecision(email: string, status: Exclude<AmbassadorStatus, 'pending'>, by: string, note: string | null): Promise<AmbassadorRow> {
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
    // A fresh approval starts a fresh twelve months, so the old term notice no longer applies.
    ...(status === 'approved' ? { term_notice_sent_at: null } : {}),
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

/** Record that the term-ending notice went out (so the daily job sends it once). */
export async function markTermNoticeSent(email: string): Promise<void> {
  const row = await getAmbassador(email);
  if (!row) throw new Error(`no ambassador application for ${norm(email)}`);
  const now = new Date().toISOString();
  await put({ ...row, term_notice_sent_at: now, updated_at: now });
}

// ── The twelve-month term (owner, 2026-11-16: "end at 12") ────────────────────────────────
export const TERM_DAYS = 365;
export const TERM_NOTICE_DAY = 335;
const DAY_MS = 86_400_000;

/** Where an approved ambassador is in their term. `null` when there is no approval date. */
export function termStatus(decidedAt: string | null | undefined, now: Date = new Date()): { day: number; endsAt: Date; due: 'none' | 'notice' | 'end' } | null {
  if (!decidedAt) return null;
  const start = new Date(decidedAt);
  if (Number.isNaN(start.getTime())) return null;
  const day = Math.floor((now.getTime() - start.getTime()) / DAY_MS);
  const endsAt = new Date(start.getTime() + TERM_DAYS * DAY_MS);
  return { day, endsAt, due: day >= TERM_DAYS ? 'end' : day >= TERM_NOTICE_DAY ? 'notice' : 'none' };
}

// ── The monthly fair-use cap (owner, 2026-11-16: "max at 5,000") ──────────────────────────
// An approved ambassador's calls are free until their free usage this UTC month would pass the
// cap; from then on the call bills normally (their own balance, or the usual "out of credits"
// refusal). Usage is counted at each tool's list price on successful free calls only.
export const AMBASSADOR_MONTHLY_CREDIT_CAP = Math.max(0, Number(process.env.AMBASSADOR_MONTHLY_CREDIT_CAP ?? '5000') || 0);
const USAGE_KEY = (email: string, now: Date) => `ambassador:usage:${norm(email)}:${now.toISOString().slice(0, 7)}`;
const USAGE_TTL_S = 40 * 86_400; // a month's counter outlives the month, then expires

/** Free credits this ambassador has used this UTC month. Throws on a read error. */
export async function ambassadorMonthUsage(email: string, now: Date = new Date()): Promise<number> {
  const v = await kv.get<number | string>(USAGE_KEY(email, now));
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Does the ambassador program cover this call? True only for an APPROVED ambassador whose free
 * usage this month plus this call's price stays within the cap. Any read error answers false:
 * the call is billed normally, never given away.
 */
export async function ambassadorCoversCall(email: string | null | undefined, price: number, now: Date = new Date()): Promise<boolean> {
  if (!email || price <= 0) return false;
  if (!(await isApprovedAmbassador(email))) return false;
  try {
    return (await ambassadorMonthUsage(email, now)) + price <= AMBASSADOR_MONTHLY_CREDIT_CAP;
  } catch (err) {
    console.error('[ambassadors] usage read failed, billing normally:', (err as Error).message);
    return false;
  }
}

/** Add a covered call's list price to this month's counter. Best effort, never throws. */
export async function recordAmbassadorUsage(email: string, price: number, now: Date = new Date()): Promise<void> {
  if (!email || price <= 0) return;
  try {
    const key = USAGE_KEY(email, now);
    await kv.incrby(key, price);
    await kv.expire(key, USAGE_TTL_S);
  } catch (err) {
    console.error('[ambassadors] usage write failed:', (err as Error).message);
  }
}
