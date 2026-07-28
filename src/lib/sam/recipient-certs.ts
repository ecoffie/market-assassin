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
