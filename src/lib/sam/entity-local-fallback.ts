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

/**
 * Every column the parity contract needs. Requesting a subset is how NS-1 happened: the
 * select never asked for NAICS or certifications, so the mapper could not have returned
 * them even if it tried.
 */
const LOCAL_ENTITY_COLUMNS =
  'uei, cage_code, legal_business_name, dba_name, physical_city, physical_state, physical_zip, '
  + 'physical_country, primary_naics, naics_codes, certifications, certification_records, '
  + 'registration_status, registration_expiry, exclusion_flag, sam_url, synced_at';

/**
 * Shape a `sam_entities` row into the same SAMEntity the live API returns.
 *
 * ── NS-1 (2026-08-25): SCHEMA PARITY ───────────────────────────────────────────────────
 * This mapper used to return ONLY name/UEI/CAGE/address, with `registrationStatus:'Unknown'`
 * hardcoded. Measured on NORTH STAR GOVERNMENT SERVICES (`FCJCDUZV7RM3`):
 *
 *   fallback returned    status "Unknown"  ·  NAICS none  ·  8a/HUBZone/WOSB undefined
 *   the row actually has status "Active"   ·  12 NAICS    ·  ["8(a)","HUBZone","WOSB"]
 *
 * So the reconciled answer was strictly WORSE than the row we had already stored, and
 * 8(a)/HUBZone — the two facts that most determine what that company should pursue — came
 * back `undefined`. `undefined` is not "no", but a downstream caller will read it as one.
 *
 * ⚠️ WHAT STAYS: registration STATUS still carries honest provenance. A registration can
 * lapse between syncs, so the mirror's status is reported as what it is — the status AS OF
 * the sync date — never as a live confirmation. NAICS codes and SBA certifications do not
 * decay that way, so suppressing them was never justified.
 *
 * ⚠️ TRI-STATE: a decision-bearing flag must distinguish true / false / unknown. Where the
 * mirror genuinely knows (certification_records carries per-program status), we answer
 * true or false. Where it does not, we leave the field ABSENT rather than defaulting to
 * false — a missing fact must never be translated into "not certified".
 */
function toSamEntity(r: Record<string, unknown>): SAMEntity {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

  const certs = arr(r.certifications);
  const records = Array.isArray(r.certification_records)
    ? (r.certification_records as Array<Record<string, unknown>>)
    : [];

  /**
   * Tri-state per program. `true` = the mirror asserts it, `false` = the mirror holds an
   * expired record for it, `undefined` = we do not know. Only the first two are claims.
   */
  const certState = (label: string): boolean | undefined => {
    if (certs.includes(label)) return true;
    const rec = records.find((x) => x.certification_type === label);
    if (rec) return rec.certification_status === 'current';
    // Not in either list: the mirror is silent. Silence is NOT a negative claim, so the
    // field stays undefined and the caller can tell "unknown" from "no".
    return undefined;
  };

  const naics = arr(r.naics_codes);
  const primary = str(r.primary_naics);

  return {
    ueiSAM: str(r.uei),
    cageCode: str(r.cage_code),
    legalBusinessName: str(r.legal_business_name),
    dbaName: str(r.dba_name) || undefined,
    // Honest provenance: this is the status AS OF `synced_at`, not a live re-check. The
    // caller receives `as_of` alongside it and must present it that way.
    registrationStatus: str(r.registration_status) || 'Unknown',
    registrationExpirationDate: str(r.registration_expiry) || undefined,
    ...(typeof r.exclusion_flag === 'boolean' ? { hasExclusions: r.exclusion_flag } : {}),
    physicalAddress: {
      city: str(r.physical_city) || undefined,
      stateOrProvince: str(r.physical_state) || undefined,
      zipCode: str(r.physical_zip) || undefined,
      countryCode: str(r.physical_country) || undefined,
    },
    // Full NAICS list, primary flagged where the row records one.
    naicsList: naics.map((code) => ({ naicsCode: code, isPrimary: code === primary })),
    ...(primary ? { primaryNaics: primary } : {}),
    // Tri-state — an absent key means UNKNOWN, never false.
    ...(certState('8(a)') !== undefined ? { has8a: certState('8(a)') } : {}),
    ...(certState('HUBZone') !== undefined ? { hasHUBZone: certState('HUBZone') } : {}),
    ...(certState('SDVOSB') !== undefined ? { hasSDVOSB: certState('SDVOSB') } : {}),
    ...(certState('WOSB') !== undefined ? { hasWOSB: certState('WOSB') } : {}),
    ...(certs.length ? { businessTypes: certs } : {}),
    ...(str(r.sam_url) ? { samUrl: str(r.sam_url) } : {}),
  } as SAMEntity;
}

/** Look a UEI up in the local mirror. */
export async function localEntityByUEI(uei: string): Promise<LocalEntityHit | null> {
  const sb = db();
  if (!sb || !uei) return null;
  const { data, error } = await sb
    .from('sam_entities')
    .select(LOCAL_ENTITY_COLUMNS)
    .eq('uei', uei.trim().toUpperCase())
    .limit(1);
  // ⚠️ LOG the error rather than swallowing it. A silent `return null` is exactly what hid
  // the first version of this file naming a column that does not exist (`updated_at` — the
  // real one is `synced_at`): PostgREST fails the WHOLE query on one bad column name, so the
  // fallback returned "nothing found" while 8 matching rows sat in the table.
  if (error) { console.error('[sam-local-fallback] uei query failed:', error.message); return null; }
  if (!data?.length) return null;
  const row = data[0] as unknown as Record<string, unknown>;
  return { entity: toSamEntity(row), asOf: typeof row.synced_at === 'string' ? row.synced_at : null };
}

/** Look a legal business name up in the local mirror. */
export async function localEntitiesByName(name: string, limit = 10): Promise<LocalEntityHit[]> {
  const sb = db();
  if (!sb || !name.trim()) return [];
  const { data, error } = await sb
    .from('sam_entities')
    .select(LOCAL_ENTITY_COLUMNS)
    .ilike('legal_business_name', `%${name.trim()}%`)
    .limit(Math.min(Math.max(limit, 1), 25));
  if (error) { console.error('[sam-local-fallback] name query failed:', error.message); return []; }
  if (!data?.length) return [];
  return (data as unknown as Record<string, unknown>[]).map((row) => ({
    entity: toSamEntity(row),
    asOf: typeof row.synced_at === 'string' ? row.synced_at : null,
  }));
}
