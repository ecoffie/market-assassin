/**
 * MRR corporate-family resolver — explicit USASpending `parent_uei` edges only.
 *
 * Name / amount / keyword MUST NEVER create a parent match. Ambiguous or failed
 * lookups fail closed (unresolved, Rule-of-Two ineligible). Never invent an
 * empty family from a lookup error.
 *
 * Forbidden source: the name-merge recipient rollup table (MRR RoT uses awards.parent_uei only).
 */
import { BQ_TABLES, bqQuery } from '@/lib/bigquery/client';
import { isWellFormedUei } from '@/lib/sam/resolve-uei';
import type {
  CorporateFamilyEvidence,
  CorporateFamilyResolution,
  FamilyResolveMethod,
  ParentEdgeLookup,
  ParentEdgeLookupResult,
} from './types';

type EvidenceSource = CorporateFamilyEvidence['source'];

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeUei(raw: string): string {
  return String(raw ?? '').trim().toUpperCase();
}

function emptyEvidence(
  source: EvidenceSource,
  query: Record<string, unknown>,
  retrievedAt: string,
  warehouseAsOf: string | null = null,
): CorporateFamilyEvidence {
  return {
    source,
    query,
    parentUeiDistinct: [],
    support: [],
    retrievedAt,
    warehouseAsOf,
  };
}

function evidenceFromLookup(
  source: EvidenceSource,
  uei: string,
  result: ParentEdgeLookupResult,
): CorporateFamilyEvidence {
  return {
    source,
    query: { recipient_uei: uei },
    parentUeiDistinct: result.parents.map((p) => p.parentUei),
    support: result.parents.map((p) => ({
      parentUei: p.parentUei,
      awardCount: p.awardCount,
      parentName: p.parentName,
    })),
    retrievedAt: result.retrievedAt,
    warehouseAsOf: result.asOf,
  };
}

function unresolved(
  rawUei: string,
  method: FamilyResolveMethod,
  reason: string,
  evidence: CorporateFamilyEvidence,
  asOf: string | null,
): CorporateFamilyResolution {
  return {
    canonical: null,
    memberUeis: [],
    method,
    confidence: 'unresolved',
    evidence,
    asOf,
    rawUei,
    ruleOfTwoEligible: false,
    ineligibleReason: reason,
  };
}

/**
 * Resolve one UEI to a canonical corporate-family identity.
 * Only explicit `parent_uei` edges create multi-member families.
 */
export async function resolveCorporateFamily(
  uei: string,
  lookup?: ParentEdgeLookup,
): Promise<CorporateFamilyResolution> {
  const source: EvidenceSource = lookup ? 'injected_fixture' : 'bq.usaspending.awards';
  const effective = lookup ?? defaultParentEdgeLookup();
  return resolveWith(uei, effective, source);
}

async function resolveWith(
  raw: string,
  lookup: ParentEdgeLookup,
  source: EvidenceSource,
): Promise<CorporateFamilyResolution> {
  const rawUei = String(raw ?? '');
  const uei = normalizeUei(rawUei);
  const retrievedAt = nowIso();

  // 1) Malformed / empty — client fact, never a lookup miss.
  if (!uei || !isWellFormedUei(uei)) {
    return unresolved(
      rawUei,
      'malformed_uei',
      'UEI must be exactly 12 alphanumeric characters',
      emptyEvidence(source, { uei: rawUei }, retrievedAt),
      null,
    );
  }

  // 2) Parent-edge lookup
  let result: ParentEdgeLookupResult;
  try {
    result = await lookup(uei);
  } catch (err) {
    // A thrown lookup is the same class as ok:false — fail closed.
    return unresolved(
      uei,
      'lookup_failed',
      err instanceof Error ? err.message : String(err),
      emptyEvidence(source, { recipient_uei: uei }, retrievedAt),
      null,
    );
  }

  // 3) lookup !ok → never invent an empty family
  if (!result.ok) {
    return unresolved(
      uei,
      'lookup_failed',
      result.error ?? 'parent-edge lookup failed',
      evidenceFromLookup(source, uei, result),
      result.asOf,
    );
  }

  const parents = result.parents ?? [];

  // 4) Conflicting parents (≥2 distinct) → unresolved / RoT ineligible
  if (parents.length >= 2) {
    return unresolved(
      uei,
      'conflicting_parent_uei',
      `ambiguous parent_uei: ${parents.map((p) => p.parentUei).join(', ')}`,
      evidenceFromLookup(source, uei, result),
      result.asOf,
    );
  }

  // 5) Exactly one parent → that parent is the family key
  if (parents.length === 1) {
    const parent = parents[0];
    const familyKey = parent.parentUei;
    const members =
      result.members && result.members.length > 0
        ? [...new Set(result.members.map(normalizeUei))]
        : [uei];
    const displayName =
      parent.parentName
      ?? result.memberNames?.[familyKey]
      ?? result.memberNames?.[uei]
      ?? null;
    return {
      canonical: { familyKey, displayName },
      memberUeis: members,
      method: 'usaspending_parent_uei',
      confidence: 'high',
      evidence: evidenceFromLookup(source, uei, result),
      asOf: result.asOf,
      rawUei: uei,
      ruleOfTwoEligible: true,
    };
  }

  // 6) No parents → self-family (null/absent parent). NEVER merge by name.
  const displayName = result.memberNames?.[uei] ?? null;
  return {
    canonical: { familyKey: uei, displayName },
    memberUeis: result.members && result.members.length > 0
      ? [...new Set(result.members.map(normalizeUei))]
      : [uei],
    method: 'self_null_or_absent_parent',
    confidence: 'medium',
    evidence: evidenceFromLookup(source, uei, result),
    asOf: result.asOf,
    rawUei: uei,
    ruleOfTwoEligible: true,
  };
}

/**
 * Batch helper: resolve many UEIs; share lookup results when possible.
 */
export async function resolveCorporateFamilies(
  ueis: string[],
  lookup?: ParentEdgeLookup,
): Promise<Map<string, CorporateFamilyResolution>> {
  const source: EvidenceSource = lookup ? 'injected_fixture' : 'bq.usaspending.awards';
  const effective = lookup ?? defaultParentEdgeLookup();

  // Share per-UEI lookup promises so sibling resolutions do not re-hit BQ/fixture.
  const cache = new Map<string, Promise<ParentEdgeLookupResult>>();
  const cachedLookup: ParentEdgeLookup = (uei) => {
    const key = normalizeUei(uei);
    let pending = cache.get(key);
    if (!pending) {
      pending = effective(key);
      cache.set(key, pending);
    }
    return pending;
  };

  const out = new Map<string, CorporateFamilyResolution>();
  for (const uei of ueis) {
    out.set(uei, await resolveWith(uei, cachedLookup, source));
  }
  return out;
}

/**
 * Batch parent-edge lookup for many UEIs in ONE awards query.
 * Same rules as defaultParentEdgeLookup — no name merge, no sibling expansion.
 */
export function batchParentEdgeLookup(ueis: string[]): ParentEdgeLookup {
  const normalized = [...new Set(ueis.map(normalizeUei).filter((u) => isWellFormedUei(u)))];
  let cache: Map<string, ParentEdgeLookupResult> | null = null;

  async function load(): Promise<Map<string, ParentEdgeLookupResult>> {
    if (cache) return cache;
    const retrievedAt = nowIso();
    const map = new Map<string, ParentEdgeLookupResult>();
    for (const u of normalized) {
      map.set(u, {
        ok: true,
        asOf: null,
        parents: [],
        members: [u],
        memberNames: {},
        retrievedAt,
      });
    }
    if (normalized.length === 0) {
      cache = map;
      return map;
    }
    try {
      const rows = await bqQuery<{
        recipient_uei: string;
        parent_uei: string;
        parent_name: string | null;
        award_count: number | string;
        as_of: string | null;
      }>({
        query: `
          SELECT
            recipient_uei,
            parent_uei,
            ANY_VALUE(parent_name) AS parent_name,
            COUNT(*) AS award_count,
            CAST(MAX(action_date) AS STRING) AS as_of
          FROM ${BQ_TABLES.awards}
          WHERE recipient_uei IN UNNEST(@ueis)
            AND parent_uei IS NOT NULL
            AND parent_uei != ''
          GROUP BY recipient_uei, parent_uei
        `,
        params: { ueis: normalized },
        maximumBytesBilled: String(5 * 1024 * 1024 * 1024),
      });

      const byChild = new Map<string, ParentEdgeLookupResult['parents']>();
      const asOfByChild = new Map<string, string | null>();
      for (const r of rows) {
        const child = normalizeUei(String(r.recipient_uei));
        const list = byChild.get(child) ?? [];
        list.push({
          parentUei: String(r.parent_uei),
          awardCount: Number(r.award_count) || 0,
          parentName: r.parent_name ?? null,
        });
        byChild.set(child, list);
        if (r.as_of) {
          const prev = asOfByChild.get(child);
          if (!prev || r.as_of > prev) asOfByChild.set(child, r.as_of);
        }
      }
      for (const u of normalized) {
        map.set(u, {
          ok: true,
          asOf: asOfByChild.get(u) ?? null,
          parents: byChild.get(u) ?? [],
          members: [u],
          memberNames: {},
          retrievedAt,
        });
      }
    } catch (err) {
      // Awards path failed (often daily BQ quota). Fall back to the per-UEI
      // `recipients` profile table — ANY_VALUE(parent_uei), so multi-parent
      // conflicts are NOT detectable here. Record that limitation via method
      // still being usaspending_parent_uei when a parent is present; callers
      // must treat this as current-state only.
      try {
        const recip = await bqQuery<{
          recipient_uei: string;
          parent_uei: string | null;
          parent_name: string | null;
        }>({
          query: `
            SELECT recipient_uei, parent_uei, parent_name
            FROM ${BQ_TABLES.recipients}
            WHERE recipient_uei IN UNNEST(@ueis)
          `,
          params: { ueis: normalized },
          maximumBytesBilled: String(512 * 1024 * 1024),
        });
        for (const r of recip) {
          const child = normalizeUei(String(r.recipient_uei));
          const parent = r.parent_uei ? String(r.parent_uei).trim() : '';
          map.set(child, {
            ok: true,
            asOf: null,
            parents: parent
              ? [{ parentUei: parent, awardCount: 0, parentName: r.parent_name ?? null }]
              : [],
            members: [child],
            memberNames: {},
            retrievedAt,
          });
        }
        cache = map;
        return map;
      } catch {
        const error = err instanceof Error ? err.message : String(err);
        for (const u of normalized) {
          map.set(u, {
            ok: false,
            error,
            asOf: null,
            parents: [],
            retrievedAt,
          });
        }
      }
    }
    cache = map;
    return map;
  }

  return async (uei: string): Promise<ParentEdgeLookupResult> => {
    const key = normalizeUei(uei);
    const map = await load();
    const hit = map.get(key);
    if (hit) return hit;
    // UEI not in the batch set — fall back to single lookup.
    return defaultParentEdgeLookup()(key);
  };
}

/**
 * Default BQ lookup — queries awards for distinct parent_uei for ONE child.
 * NEVER uses the name-merge recipient rollup (forbidden for MRR RoT).
 *
 * Member expansion across the whole corporate family is intentionally NOT
 * performed here (full-family COALESCE scan hangs the Phase 1 runner). Family
 * KEY identity for Rule-of-Two dedup only needs the child's parent edge;
 * members default to `[uei]`.
 */
export function defaultParentEdgeLookup(): ParentEdgeLookup {
  return async (uei: string): Promise<ParentEdgeLookupResult> => {
    const retrievedAt = nowIso();
    const normalized = normalizeUei(uei);

    try {
      const parentRows = await bqQuery<{
        parent_uei: string;
        parent_name: string | null;
        award_count: number | string;
        as_of: string | null;
      }>({
        query: `
          SELECT
            parent_uei,
            ANY_VALUE(parent_name) AS parent_name,
            COUNT(*) AS award_count,
            CAST(MAX(action_date) AS STRING) AS as_of
          FROM ${BQ_TABLES.awards}
          WHERE recipient_uei = @uei
            AND parent_uei IS NOT NULL
            AND parent_uei != ''
          GROUP BY parent_uei
        `,
        params: { uei: normalized },
        maximumBytesBilled: String(2 * 1024 * 1024 * 1024),
      });

      const parents = parentRows.map((r) => ({
        parentUei: String(r.parent_uei),
        awardCount: Number(r.award_count) || 0,
        parentName: r.parent_name ?? null,
      }));

      let asOf: string | null = null;
      for (const r of parentRows) {
        if (r.as_of && (!asOf || r.as_of > asOf)) asOf = r.as_of;
      }

      return {
        ok: true,
        asOf,
        parents,
        members: [normalized],
        memberNames: {},
        retrievedAt,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        asOf: null,
        parents: [],
        retrievedAt,
      };
    }
  };
}

/**
 * Pure helper for Rule-of-Two: count distinct ruleOfTwoEligible familyKeys.
 * Sibling UEIs under one parent count once. Ineligible resolutions are listed,
 * never silently dropped into the eligible set.
 */
export function countEligibleFamilies(resolutions: CorporateFamilyResolution[]): {
  eligibleKeys: string[];
  excluded: Array<{ uei: string; reason: string }>;
} {
  const seen = new Set<string>();
  const eligibleKeys: string[] = [];
  const excluded: Array<{ uei: string; reason: string }> = [];

  for (const r of resolutions) {
    if (r.ruleOfTwoEligible && r.canonical?.familyKey) {
      if (!seen.has(r.canonical.familyKey)) {
        seen.add(r.canonical.familyKey);
        eligibleKeys.push(r.canonical.familyKey);
      }
    } else {
      excluded.push({
        uei: r.rawUei,
        reason: r.ineligibleReason ?? r.method,
      });
    }
  }

  return { eligibleKeys, excluded };
}
