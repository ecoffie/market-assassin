/**
 * LOCAL SAM REGISTRY FALLBACK — identity should not depend on SAM having a good day.
 *
 * DEFECT-7, traced 2026-08-24 from a live research session. A user asked Mindy to look up a
 * plainly-registered company (active awards visible in the same conversation) and got "SAM
 * registration lookup failed, third try, by UEI and by name both."
 *
 * THE MEASURED CAUSE, in order:
 *   1. Of the four production keys: SAM_API_KEY = 401 API_KEY_INVALID (dead), _1 and _2 = 429
 *      (quota exhausted), _BACKUP = a duplicate. Every usable key was unusable.
 *   2. The 429 fail-over loop broke on `status !== 429`, so landing on the DEAD key looked
 *      like a real answer and it stopped trying.
 *   3. That non-429 error fell into a `return { entities: [] }` — an empty list
 *      INDISTINGUISHABLE from "this company is not registered in SAM".
 *
 * So an outage on our side was reported to a paying user as a fact about the world. That is
 * the same class as `count ?? 0`: an EVIDENCE failure rendered as a WORLD fact.
 *
 * ⚠️ THE ARCHITECTURAL POINT (Eric): local normalized registry FIRST, live SAM only when
 * freshness or detail requires it. We hold ~910K SAM entities locally — the failing lookup had
 * 8 matching rows sitting in `sam_entities` the whole time. Live SAM should ENRICH or REFRESH
 * the record, never be the single point of failure for basic identity.
 *
 * ⚠️ The freshness column is `synced_at`, NOT `updated_at`. The first version of this file
 * named `updated_at`, and PostgREST fails the ENTIRE query on one unknown column — so the
 * fallback reported "nothing found" while the rows were right there. Errors are logged now.
 *
 * ⚠️ HONEST PROVENANCE: a local hit is a CACHED registration, not a live one. Every record
 * returned here is stamped `source:'local'` with its `as_of` date so a caller can say "as of
 * <date>" rather than implying it re-checked SAM this second. Never present cached data as live.
 */
import { createClient } from '@supabase/supabase-js';
import type { SAMEntity } from './entity-api';

export interface LocalEntityHit {
  entity: SAMEntity;
  /** When this row was last refreshed from SAM — the caller must surface this. */
  asOf: string | null;
}

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Shape a `sam_entities` row into the same SAMEntity the live API returns. */
function toSamEntity(r: Record<string, unknown>): SAMEntity {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    ueiSAM: str(r.uei),
    cageCode: str(r.cage_code),
    legalBusinessName: str(r.legal_business_name),
    dbaName: str(r.dba_name) || undefined,
    // The local mirror does not carry a reliable live status, and guessing 'Active' would be
    // fabrication — a caller must not read a cached row as a confirmed active registration.
    registrationStatus: 'Unknown',
    physicalAddress: {
      city: str(r.physical_city) || undefined,
      stateOrProvince: str(r.physical_state) || undefined,
      zipCode: str(r.physical_zip) || undefined,
      countryCode: str(r.physical_country) || undefined,
    },
  } as SAMEntity;
}

/** Look a UEI up in the local mirror. */
export async function localEntityByUEI(uei: string): Promise<LocalEntityHit | null> {
  const sb = db();
  if (!sb || !uei) return null;
  const { data, error } = await sb
    .from('sam_entities')
    .select('uei, cage_code, legal_business_name, dba_name, physical_city, physical_state, physical_zip, physical_country, synced_at')
    .eq('uei', uei.trim().toUpperCase())
    .limit(1);
  // ⚠️ LOG the error rather than swallowing it. A silent `return null` is exactly what hid
  // the first version of this file naming a column that does not exist (`updated_at` — the
  // real one is `synced_at`): PostgREST fails the WHOLE query on one bad column name, so the
  // fallback returned "nothing found" while 8 matching rows sat in the table.
  if (error) { console.error('[sam-local-fallback] uei query failed:', error.message); return null; }
  if (!data?.length) return null;
  const row = data[0] as Record<string, unknown>;
  return { entity: toSamEntity(row), asOf: typeof row.synced_at === 'string' ? row.synced_at : null };
}

/** Look a legal business name up in the local mirror. */
export async function localEntitiesByName(name: string, limit = 10): Promise<LocalEntityHit[]> {
  const sb = db();
  if (!sb || !name.trim()) return [];
  const { data, error } = await sb
    .from('sam_entities')
    .select('uei, cage_code, legal_business_name, dba_name, physical_city, physical_state, physical_zip, physical_country, synced_at')
    .ilike('legal_business_name', `%${name.trim()}%`)
    .limit(Math.min(Math.max(limit, 1), 25));
  if (error) { console.error('[sam-local-fallback] name query failed:', error.message); return []; }
  if (!data?.length) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    entity: toSamEntity(row),
    asOf: typeof row.synced_at === 'string' ? row.synced_at : null,
  }));
}
