/**
 * Corporate-family member expansion for recipient-rollup consumers.
 *
 * The awards table is clustered by recipient_uei. Never expand a family with
 * `COALESCE(parent_uei, recipient_uei) = @familyKey`: that predicate scanned
 * 3.807 GiB per family on 2026-09-05. The derived recipient rollup already
 * stores the authoritative bounded child_ueis array.
 */
import { BQ_TABLES, bqJobOptions, bqQuery } from './client';

const FAMILY_LOOKUP_MAX_BYTES = 64 * 1024 * 1024; // measured dry-run: 18,937,050 bytes
const FAMILY_CACHE_MAX = 1_000;

export type FamilyMemberLookupResult =
  | {
      ok: true;
      familyKey: string;
      rollupUei: string;
      rollupName: string | null;
      memberUeis: string[];
      asOf: string | null;
    }
  | {
      ok: false;
      familyKey: string;
      memberUeis: [];
      reason: 'malformed_family_key' | 'rollup_not_found' | 'lookup_failed';
      error: string;
    };

interface RollupFamilyRow {
  rollup_uei: string;
  rollup_name: string | null;
  child_ueis: string[] | null;
  as_of: string | null;
}

const FAMILY_CACHE = new Map<string, Promise<FamilyMemberLookupResult>>();

function normalizeFamilyKey(value: string): string {
  return String(value ?? '').trim().toUpperCase();
}

function wellFormedFamilyKey(value: string): boolean {
  return /^[A-Z0-9]{12}$/.test(value);
}

function setCached(key: string, value: Promise<FamilyMemberLookupResult>): void {
  if (FAMILY_CACHE.size >= FAMILY_CACHE_MAX) {
    const oldest = FAMILY_CACHE.keys().next().value;
    if (oldest !== undefined) FAMILY_CACHE.delete(oldest);
  }
  FAMILY_CACHE.set(key, value);
}

function failed(
  familyKey: string,
  reason: Extract<FamilyMemberLookupResult, { ok: false }>['reason'],
  error: string,
): FamilyMemberLookupResult {
  return { ok: false, familyKey, memberUeis: [], reason, error };
}

async function loadFamilyBatch(
  familyKeys: string[],
): Promise<Map<string, FamilyMemberLookupResult>> {
  const out = new Map<string, FamilyMemberLookupResult>();
  try {
    const rows = await bqQuery<RollupFamilyRow>({
      query: `
        SELECT
          rollup_uei,
          rollup_name,
          child_ueis,
          CAST(last_action_date AS STRING) AS as_of
        FROM ${BQ_TABLES.recipientsRollup}
        WHERE rollup_uei IN UNNEST(@familyKeys)
      `,
      params: { familyKeys },
      ...bqJobOptions({
        feature: 'recipient-rollup',
        tool: 'family-member-expansion',
        queryFamily: 'rollup-child-ueis-batch',
        maximumBytesBilled: FAMILY_LOOKUP_MAX_BYTES,
      }),
    });

    for (const row of rows) {
      const familyKey = normalizeFamilyKey(row.rollup_uei);
      const memberUeis = [...new Set(
        [familyKey, ...(row.child_ueis ?? [])]
          .map(normalizeFamilyKey)
          .filter(wellFormedFamilyKey),
      )];
      out.set(familyKey, {
        ok: true,
        familyKey,
        rollupUei: familyKey,
        rollupName: row.rollup_name ?? null,
        memberUeis,
        asOf: row.as_of ?? null,
      });
    }

    for (const key of familyKeys) {
      if (!out.has(key)) {
        // The rollup is derived and may lag awards. Missing is unknown, not an
        // authoritative empty family and never a zero-member success.
        out.set(key, failed(
          key,
          'rollup_not_found',
          'corporate-family rollup is unavailable for this family key',
        ));
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const key of familyKeys) {
      out.set(key, failed(key, 'lookup_failed', message));
    }
  }
  return out;
}

/**
 * Resolve many family keys in one bounded rollup query.
 *
 * Keys are normalized and deduplicated before the query. Each result promise
 * is retained for this Node process so repeated callers cannot recreate the
 * per-family scan storm that exhausted QueryUsagePerDay.
 */
export async function lookupFamilyMembersBatch(
  rawFamilyKeys: string[],
): Promise<Map<string, FamilyMemberLookupResult>> {
  const normalized = [...new Set(rawFamilyKeys.map(normalizeFamilyKey))];
  const valid = normalized.filter(wellFormedFamilyKey);
  const missing = valid.filter((key) => !FAMILY_CACHE.has(key));

  if (missing.length > 0) {
    const batch = loadFamilyBatch(missing);
    for (const key of missing) {
      setCached(
        key,
        batch.then((results) =>
          results.get(key)
          ?? failed(key, 'lookup_failed', 'family lookup returned no result')),
      );
    }
  }

  const out = new Map<string, FamilyMemberLookupResult>();
  for (const key of normalized) {
    if (!wellFormedFamilyKey(key)) {
      out.set(key, failed(
        key,
        'malformed_family_key',
        'family key must be exactly 12 alphanumeric characters',
      ));
      continue;
    }
    const result = await FAMILY_CACHE.get(key);
    out.set(
      key,
      result ?? failed(key, 'lookup_failed', 'family lookup cache was not populated'),
    );
  }
  return out;
}

/** Resolve one family through the same process cache and bounded batch path. */
export async function lookupFamilyMembers(
  familyKey: string,
): Promise<FamilyMemberLookupResult> {
  const normalized = normalizeFamilyKey(familyKey);
  const results = await lookupFamilyMembersBatch([normalized]);
  return results.get(normalized)
    ?? failed(normalized, 'lookup_failed', 'family lookup returned no result');
}

/** Test-only reset for deterministic process-cache assertions. */
export function resetFamilyMemberCacheForTests(): void {
  FAMILY_CACHE.clear();
}
