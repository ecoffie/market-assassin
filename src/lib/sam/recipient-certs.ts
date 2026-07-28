/**
 * Authoritative set-aside CERTIFICATIONS by UEI, cached from SAM.gov's entity registry (Eric
 * 2026-07-28: "the SAIC bug — can't we pull people's UEI from SAM and cross-reference? SAM.gov has
 * that info"). The map's company chips were INFERRED from award behavior, which mislabeled mega-
 * primes (SAIC = 99.7% full-and-open showed "SDVOSB · 8(a)" off 2% edge-case awards). SAM is the
 * source of truth: getEntityByUEI() returns has8a/hasSDVOSB/hasWOSB/hasHUBZone. We cache those in
 * `recipient_certifications` so the map reads authoritative certs WITHOUT a live (10/min) SAM call
 * per pin — a backfill fills the cache; the map reads it.
 */
import { getWriteClient } from '@/lib/supabase/server-clients';
import { getEntityByUEI } from '@/lib/sam/entity-api';
import { bqQuery, BQ_TABLES } from '@/lib/bigquery/client';

export type RecipientCert = {
  uei: string;
  found: boolean;
  is8a: boolean;
  isSdvosb: boolean;
  isWosb: boolean;
  isHubzone: boolean;
};

/** The map's set-aside bucket keys (match SET_CHIP_LABEL / classifySetAside). */
export type CertBucket = '8A' | 'SDVOSB' | 'WOSB' | 'HZ';

/** Cert flags → the map's chip buckets, ranked (most notable first). Empty ⇒ no chip (SAIC). */
export function certBuckets(c: RecipientCert | undefined | null): CertBucket[] {
  if (!c || !c.found) return [];
  const out: CertBucket[] = [];
  if (c.is8a) out.push('8A');
  if (c.isSdvosb) out.push('SDVOSB');
  if (c.isHubzone) out.push('HZ');
  if (c.isWosb) out.push('WOSB');
  return out;
}

/**
 * Read cached certs for a batch of UEIs. Returns ONLY the UEIs we've resolved (a cache miss is
 * absent from the map — the caller decides the fallback). Pure read; never calls SAM.
 */
export async function getCachedCerts(ueis: string[]): Promise<Map<string, RecipientCert>> {
  const out = new Map<string, RecipientCert>();
  const clean = [...new Set(ueis.filter(Boolean))];
  if (!clean.length) return out;
  const sb = getWriteClient(); // a SELECT, but keep it on primary (reads its own backfill writes)
  const { data, error } = await sb
    .from('recipient_certifications')
    .select('uei, found, is_8a, is_sdvosb, is_wosb, is_hubzone')
    .in('uei', clean);
  if (error) {
    // Table missing (migration not run yet) or a transient error → treat as all-miss, never throw
    // into the map hot path. The caller's award-share fallback covers it.
    console.error('[recipient-certs] cache read failed (falling back):', error.message);
    return out;
  }
  for (const r of data || []) {
    out.set(r.uei as string, {
      uei: r.uei as string,
      found: !!r.found,
      is8a: !!r.is_8a,
      isSdvosb: !!r.is_sdvosb,
      isWosb: !!r.is_wosb,
      isHubzone: !!r.is_hubzone,
    });
  }
  return out;
}

/**
 * Fetch ONE UEI's certs from SAM (live, rate-limited) and upsert into the cache. Used by the
 * backfill script/cron — NOT the map hot path. Returns the resolved cert (found=false if SAM has no
 * record). Never throws: a SAM/DB failure logs and returns null so the backfill can keep draining.
 */
export async function refreshCertForUei(uei: string): Promise<RecipientCert | null> {
  if (!uei) return null;
  let entity;
  try {
    entity = await getEntityByUEI(uei);
  } catch (e) {
    console.error(`[recipient-certs] SAM lookup failed for ${uei}:`, (e as Error).message);
    return null;
  }
  const row = {
    uei,
    found: !!entity,
    legal_name: entity?.legalBusinessName ?? null,
    is_8a: entity ? !!entity.has8a : false,
    is_sdvosb: entity ? !!entity.hasSDVOSB : false,
    is_wosb: entity ? !!entity.hasWOSB : false,
    is_hubzone: entity ? !!entity.hasHUBZone : false,
    sba_business_types: Array.isArray(entity?.certifications?.sbaBusinessTypes)
      ? entity!.certifications!.sbaBusinessTypes!
      : null,
    checked_at: new Date().toISOString(),
  };
  try {
    const sb = getWriteClient();
    const { error } = await sb.from('recipient_certifications').upsert(row, { onConflict: 'uei' });
    if (error) { console.error(`[recipient-certs] upsert failed for ${uei}:`, error.message); return null; }
  } catch (e) {
    console.error(`[recipient-certs] upsert threw for ${uei}:`, (e as Error).message);
    return null;
  }
  return { uei, found: row.found, is8a: row.is_8a, isSdvosb: row.is_sdvosb, isWosb: row.is_wosb, isHubzone: row.is_hubzone };
}

/**
 * Pick the next UEIs to refresh: the biggest firms by $ that we've NEVER checked, then the stalest.
 * Shared by the backfill script AND the prod cron so the queue logic can't drift. Read-only.
 */
export async function certBackfillQueue(limit: number): Promise<string[]> {
  // Seed from BigQuery (where the 317K contractors live) — NOT a Supabase `recipients` table (which
  // doesn't exist; that returned a null count = missing table and an EMPTY queue on the first run,
  // Eric 2026-07-28). Biggest firms by $ first — a wrong set-aside chip most misrepresents a prime.
  // The BigQuery seed error is SURFACED (not swallowed) — an empty queue on prod turned out to be a
  // silent BQ failure, and swallowing it hid the cause (Eric 2026-07-28). The cron's try/catch turns
  // this into a visible response; the local script prints it. Never let it break the MAP (the map
  // never calls this) — only the backfill caller sees it.
  const rows = await bqQuery<{ recipient_uei: string }>({
    query: `SELECT recipient_uei
            FROM ${BQ_TABLES.recipients}
            WHERE recipient_uei IS NOT NULL AND recipient_uei != ''
            ORDER BY total_obligated DESC
            LIMIT 3000`,
  });
  const allSeed = [...new Set(rows.map((r) => r.recipient_uei).filter(Boolean))];
  if (!allSeed.length) return [];
  // Only need to resolve the FRONT of the seed (biggest firms) — bound the .in() list so the
  // PostgREST URL can't blow up on 3000 UEIs. We check a window a few× the limit, enough to skip the
  // already-fresh ones and still fill `limit`.
  const seed = allSeed.slice(0, Math.max(limit * 6, 300));
  const sb = getWriteClient();

  const { data: checked, error: cErr } = await sb
    .from('recipient_certifications')
    .select('uei, checked_at')
    .in('uei', seed);
  if (cErr) { console.error('[recipient-certs] checked read failed:', cErr.message); return []; }
  const checkedAt = new Map((checked || []).map((r) => [r.uei as string, r.checked_at as string]));
  const staleCut = new Date(Date.now() - 30 * 86_400_000).toISOString(); // re-refresh after 30 days

  const never = seed.filter((u) => !checkedAt.has(u));
  const stale = seed
    .filter((u) => checkedAt.has(u) && checkedAt.get(u)! < staleCut)
    .sort((a, b) => (checkedAt.get(a)! < checkedAt.get(b)! ? -1 : 1));
  return [...never, ...stale].slice(0, limit);
}

/**
 * Drain a bounded batch of the cert backfill under a time budget, pacing SAM calls. Fail-soft per
 * UEI. Returns per-UEI outcome tallies. Used by both the cron and the local script.
 */
export async function drainCertBackfill(opts: { limit: number; rateMs?: number; budgetMs?: number }): Promise<{
  attempted: number; certified: number; noCert: number; failed: number; budgetSpent: boolean;
}> {
  const rateMs = opts.rateMs ?? 6500;   // ~9/min, under SAM's 10/min
  const budgetMs = opts.budgetMs ?? 240_000;
  const started = Date.now();
  const queue = await certBackfillQueue(opts.limit);
  let certified = 0, noCert = 0, failed = 0, attempted = 0, budgetSpent = false;
  for (let i = 0; i < queue.length; i++) {
    if (Date.now() - started > budgetMs - rateMs) { budgetSpent = true; break; }
    attempted++;
    const c = await refreshCertForUei(queue[i]);
    if (c === null) failed++;
    else if (!c.found) noCert++;
    else certified++;
    if (i < queue.length - 1) await new Promise((r) => setTimeout(r, rateMs));
  }
  return { attempted, certified, noCert, failed, budgetSpent };
}
