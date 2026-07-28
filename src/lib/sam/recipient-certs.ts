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
import { getEntityByUEI, transformEntity } from '@/lib/sam/entity-api';
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
 * CACHE-FIRST harvest (Eric's #1 SAM correction, 2026-07-28: "start with the cache"). SAM entity
 * responses we've ALREADY fetched sit in sam_api_cache (api_type='entity') with the certs inside
 * (coreData.businessTypes.sbaBusinessTypeList). Extract them into recipient_certifications with ZERO
 * SAM calls — the backfill then only hits SAM for firms NOT already cached. Reuses transformEntity so
 * the cert extraction matches the live path exactly. Returns how many certs it harvested.
 */
export async function harvestCertsFromCache(): Promise<{ scanned: number; harvested: number }> {
  const sb = getWriteClient();
  const { data, error } = await sb
    .from('sam_api_cache')
    .select('response_data')
    .eq('api_type', 'entity')
    .limit(5000);
  if (error) { console.error('[recipient-certs] cache harvest read failed:', error.message); return { scanned: 0, harvested: 0 }; }

  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const r of data || []) {
    const ed = (r.response_data as { entityData?: Record<string, unknown>[] } | null)?.entityData?.[0];
    if (!ed) continue;
    let e;
    try { e = transformEntity(ed); } catch { continue; }
    const uei = (e.ueiSAM || '').trim();
    if (!uei || seen.has(uei)) continue; // one row per UEI (cache may hold name-search + UEI dupes)
    seen.add(uei);
    rows.push({
      uei, found: true, legal_name: e.legalBusinessName || null,
      is_8a: !!e.has8a, is_sdvosb: !!e.hasSDVOSB, is_wosb: !!e.hasWOSB, is_hubzone: !!e.hasHUBZone,
      sba_business_types: Array.isArray(e.certifications?.sbaBusinessTypes) ? e.certifications!.sbaBusinessTypes! : null,
      checked_at: new Date().toISOString(),
    });
  }
  if (!rows.length) return { scanned: (data || []).length, harvested: 0 };
  // Upsert in chunks (bounded statement size). onConflict=uei so a later live refresh can overwrite.
  let harvested = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error: upErr } = await sb.from('recipient_certifications').upsert(chunk, { onConflict: 'uei' });
    if (upErr) { console.error('[recipient-certs] cache harvest upsert failed:', upErr.message); break; }
    harvested += chunk.length;
  }
  return { scanned: (data || []).length, harvested };
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
  // Seed = the biggest firms by $ first (a wrong set-aside chip most misrepresents a prime). The cap
  // was 3000 — but the hourly cron drains ~35/run, so it resolved the top ~983, then PLATEAUED (nothing
  // new in the 3000 window, nothing stale yet → the queue went empty and just re-confirmed the same set)
  // (Eric 2026-07-28). Raised to 50000 so there's always fresh work for the hourly drain; coverage now
  // climbs from ~983 toward tens of thousands over time (bounded by SAM's ~9/min → ~35/hr, so gradual).
  const rows = await bqQuery<{ recipient_uei: string }>({
    query: `SELECT recipient_uei
            FROM ${BQ_TABLES.recipients}
            WHERE recipient_uei IS NOT NULL AND recipient_uei != ''
            ORDER BY total_obligated DESC
            LIMIT 50000`,
  });
  const allSeed = [...new Set(rows.map((r) => r.recipient_uei).filter(Boolean))];
  if (!allSeed.length) return [];
  // We only need to fill `limit` NEW UEIs per run. Walk the seed in bounded WINDOWS (front-first =
  // biggest-first): query the checked-set for a window, take the never/stale ones, and advance to the
  // next window if this one is exhausted — so a fully-resolved front no longer starves the queue while
  // 49K firms behind it wait. Each window is small enough that the .in() PostgREST URL never blows up.
  const sb = getWriteClient();
  const staleCut = new Date(Date.now() - 30 * 86_400_000).toISOString(); // re-refresh after 30 days
  const WINDOW = Math.max(limit * 8, 400);
  const picked: string[] = [];
  for (let start = 0; start < allSeed.length && picked.length < limit; start += WINDOW) {
    const seed = allSeed.slice(start, start + WINDOW);
    const { data: checked, error: cErr } = await sb
      .from('recipient_certifications')
      .select('uei, checked_at')
      .in('uei', seed);
    if (cErr) { console.error('[recipient-certs] checked read failed:', cErr.message); return picked; }
    const checkedAt = new Map((checked || []).map((r) => [r.uei as string, r.checked_at as string]));
    const never = seed.filter((u) => !checkedAt.has(u));
    const stale = seed
      .filter((u) => checkedAt.has(u) && checkedAt.get(u)! < staleCut)
      .sort((a, b) => (checkedAt.get(a)! < checkedAt.get(b)! ? -1 : 1));
    // Never-checked first (new coverage), then stale (30-day refresh) within this window.
    for (const u of never) { if (picked.length >= limit) break; picked.push(u); }
    for (const u of stale) { if (picked.length >= limit) break; picked.push(u); }
  }
  return picked.slice(0, limit);
}

/**
 * Drain a bounded batch of the cert backfill under a time budget, pacing SAM calls. Fail-soft per
 * UEI. Returns per-UEI outcome tallies. Used by both the cron and the local script.
 */
export async function drainCertBackfill(opts: { limit: number; rateMs?: number; budgetMs?: number }): Promise<{
  harvestedFromCache: number; attempted: number; certified: number; noCert: number; failed: number; budgetSpent: boolean;
}> {
  const rateMs = opts.rateMs ?? 6500;   // ~9/min, under SAM's 10/min
  const budgetMs = opts.budgetMs ?? 240_000;
  const started = Date.now();
  // CACHE-FIRST: harvest every already-cached SAM entity response into the cert table (zero SAM
  // calls) BEFORE queuing live lookups — so the SAM budget is spent only on firms we've never
  // fetched. This is the rule Eric had to keep re-stating; now the code does it by default.
  const { harvested: harvestedFromCache } = await harvestCertsFromCache();
  const queue = await certBackfillQueue(opts.limit); // now excludes the just-harvested (fresh) UEIs
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
  return { harvestedFromCache, attempted, certified, noCert, failed, budgetSpent };
}
