/**
 * MRR corporate-family resolver — explicit USASpending `parent_uei` edges only.
 *
 * Name / amount / keyword MUST NEVER create a parent match. Ambiguous or failed
 * lookups fail closed (unresolved, Rule-of-Two ineligible). Never invent an
 * empty family from a lookup error.
 *
 * Forbidden source: the name-merge recipient rollup table (MRR RoT uses awards.parent_uei only).
 */
import { BQ_TABLES, bqJobOptions, bqQuery } from '@/lib/bigquery/client';
import { isWellFormedUei } from '@/lib/sam/resolve-uei';
import type {
  CorporateFamilyEvidence,
  CorporateFamilyResolution,
  FamilyResolveMethod,
  ParentEdgeLookup,
  ParentEdgeLookupResult,
} from './types';

type EvidenceSource = CorporateFamilyEvidence['source'];

/**
 * Bounded cost containment for the demo parent-edge BATCH only.
 *
 * A clustered `recipient_uei IN UNNEST(@ueis)` over ≤50 unique children still
 * processes ~1.355 GiB of awards (auditor dry-run 2026-09-05: 1,454,734,807
 * bytes). The previous 1 GiB guard refused that valid bounded batch. 2 GiB is
 * a safety ceiling for one batched, cached, no-retry query — not proof the
 * awards scan is optimized, not a quota restore, and not a license to enlarge
 * the UEI set. Long-term follow-up: replace the awards scan with a
 * clustered/rollup parent-edge source.
 */
export const PARENT_EDGE_BATCH_MAX_UEIS = 50;
export const PARENT_EDGE_BATCH_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** Single-UEI parent lookup stays on the tighter 1 GiB ceiling. */
export const PARENT_EDGE_SINGLE_MAX_BYTES = 1024 * 1024 * 1024;
const PARENT_EDGE_CACHE_MAX = 1_000;
const DEFAULT_PARENT_EDGE_CACHE = new Map<string, Promise<ParentEdgeLookupResult>>();

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeUei(raw: string): string {
  return String(raw ?? '').trim().toUpperCase();
}

/** Dedup well-formed UEIs; malformed strings are dropped before the awards scan. */
export function uniqueWellFormedUeis(ueis: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ueis) {
    const uei = normalizeUei(raw);
    if (!isWellFormedUei(uei) || seen.has(uei)) continue;
    seen.add(uei);
    out.push(uei);
  }
  return out;
}

/** Refuse >50 unique UEIs before constructing the parent-edge awards query. */
export function assertBoundedParentBatch(ueis: readonly string[]): string[] {
  const unique = uniqueWellFormedUeis(ueis);
  if (unique.length > PARENT_EDGE_BATCH_MAX_UEIS) {
    throw new Error(
      `parent-edge batch ${unique.length} unique UEIs exceeds the ${PARENT_EDGE_BATCH_MAX_UEIS}-UEI bound — refusing the awards scan`,
    );
  }
  return unique;
}

/** Keep body/evidence reasons short — full provider text stays in lookup diagnostics. */
function shortenLookupError(message: string): string {
  const r = (message || '').trim();
  if (/QueryUsagePerDay|Custom quota exceeded/i.test(r)) {
    return 'BigQuery QueryUsagePerDay quota exceeded';
  }
  if (r.length > 160) return `${r.slice(0, 157)}…`;
  return r || 'parent-edge lookup failed';
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
      shortenLookupError(err instanceof Error ? err.message : String(err)),
      emptyEvidence(source, { recipient_uei: uei }, retrievedAt),
      null,
    );
  }

  // 3) lookup !ok → never invent an empty family
  if (!result.ok) {
    return unresolved(
      uei,
      'lookup_failed',
      shortenLookupError(result.error ?? 'parent-edge lookup failed'),
      evidenceFromLookup(source, uei, result),
      result.asOf,
    );
  }

  const parents = result.parents ?? [];
  const evidence = evidenceFromLookup(source, uei, result);
  const supported: typeof parents = [];
  const malformed: typeof parents = [];
  const selfParents: typeof parents = [];
  const seenSupported = new Set<string>();
  const seenMalformed = new Set<string>();

  for (const parent of parents) {
    const parentUei = normalizeUei(parent.parentUei);
    if (!isWellFormedUei(parentUei)) {
      if (!seenMalformed.has(parentUei)) {
        seenMalformed.add(parentUei);
        malformed.push({ ...parent, parentUei });
      }
      continue;
    }
    if (parentUei === uei) {
      selfParents.push({ ...parent, parentUei });
      continue;
    }
    if (!seenSupported.has(parentUei)) {
      seenSupported.add(parentUei);
      supported.push({ ...parent, parentUei });
    }
  }

  // Invalid parent format must never become a high-confidence family key.
  if (malformed.length > 0 && supported.length === 0) {
    const labels = malformed.map((p) => p.parentUei).join(', ');
    return unresolved(
      uei,
      'malformed_uei',
      `parent_uei is not a well-formed UEI: ${labels}`,
      evidence,
      result.asOf,
    );
  }

  if (supported.length >= 2 || (supported.length === 1 && malformed.length > 0)) {
    const labels = [
      ...supported.map((p) => p.parentUei),
      ...malformed.map((p) => p.parentUei),
    ].join(', ');
    return unresolved(
      uei,
      'conflicting_parent_uei',
      `ambiguous parent_uei: ${labels}`,
      evidence,
      result.asOf,
    );
  }

  // Exactly one valid supported parent → that parent is the family key.
  if (supported.length === 1) {
    const parent = supported[0];
    const familyKey = parent.parentUei;
    const members =
      result.members && result.members.length > 0
        ? [...new Set(result.members.map(normalizeUei).filter((m) => isWellFormedUei(m)))]
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
      evidence,
      asOf: result.asOf,
      rawUei: uei,
      ruleOfTwoEligible: true,
    };
  }

  // Explicit self-parent (parent_uei === child) → documented self result.
  if (selfParents.length > 0) {
    const displayName =
      selfParents[0].parentName
      ?? result.memberNames?.[uei]
      ?? null;
    return {
      canonical: { familyKey: uei, displayName },
      memberUeis: result.members && result.members.length > 0
        ? [...new Set(result.members.map(normalizeUei).filter((m) => isWellFormedUei(m)))]
        : [uei],
      method: 'self_null_or_absent_parent',
      confidence: 'medium',
      evidence,
      asOf: result.asOf,
      rawUei: uei,
      ruleOfTwoEligible: true,
    };
  }

  // Missing parent_uei → unresolved. Independent firms are not a high-confidence
  // family until a well-formed parent edge (including self-parent) exists.
  return unresolved(
    uei,
    'not_found',
    'parent_uei missing — corporate family unresolved',
    evidence,
    result.asOf,
  );
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
  const normalized = assertBoundedParentBatch(ueis);
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
        ...bqJobOptions({
          feature: 'mrr',
          tool: 'corporate-family',
          queryFamily: 'parent-edge-batch',
          maximumBytesBilled: PARENT_EDGE_BATCH_MAX_BYTES,
        }),
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
      // Awards failure (including quotaExceeded) stays lookup_failed.
      // A weaker recipients/ANY_VALUE fallback must never upgrade an ambiguous
      // or failed parent edge into a high-confidence parent.
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
    cache = map;
    return map;
  }

  return async (uei: string): Promise<ParentEdgeLookupResult> => {
    const key = normalizeUei(uei);
    const map = await load();
    const hit = map.get(key);
    if (hit) return hit;
    // UEI not in the batch set — do not fire a second per-UEI awards scan.
    return {
      ok: false,
      error: 'UEI was not included in the bounded parent-edge batch — refusing a second awards scan',
      asOf: null,
      parents: [],
      retrievedAt: nowIso(),
    };
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
    const normalized = normalizeUei(uei);
    let pending = DEFAULT_PARENT_EDGE_CACHE.get(normalized);
    if (pending) return pending;

    pending = queryDefaultParentEdge(normalized);
    if (DEFAULT_PARENT_EDGE_CACHE.size >= PARENT_EDGE_CACHE_MAX) {
      const oldest = DEFAULT_PARENT_EDGE_CACHE.keys().next().value;
      if (oldest !== undefined) DEFAULT_PARENT_EDGE_CACHE.delete(oldest);
    }
    DEFAULT_PARENT_EDGE_CACHE.set(normalized, pending);
    return pending;
  };
}

async function queryDefaultParentEdge(normalized: string): Promise<ParentEdgeLookupResult> {
  const retrievedAt = nowIso();
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
      ...bqJobOptions({
        feature: 'mrr',
        tool: 'corporate-family',
        queryFamily: 'parent-edge-single',
        maximumBytesBilled: PARENT_EDGE_SINGLE_MAX_BYTES,
      }),
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
}

/** Test-only reset for deterministic process-cache assertions. */
export function resetParentEdgeCacheForTests(): void {
  DEFAULT_PARENT_EDGE_CACHE.clear();
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
