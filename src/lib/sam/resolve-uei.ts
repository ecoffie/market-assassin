/**
 * UEI RESOLUTION — local SAM mirror is AUTHORITATIVE for existence.
 * Live SAM only ENRICHES. An upstream failure must never render as "invalid UEI".
 *
 * ── THE DEFECT THIS CLOSES (P0, 2026-08-25) ────────────────────────────────────────────
 * `/api/entity-lookup?uei=…` called live SAM only:
 *   • live SAM 404 or empty → null → HTTP 404 `"Entity not found"`
 *   • live SAM down/throttled → throw → HTTP 500
 * Neither consulted the 910,123-row local mirror, which HOLDS the company. During a SAM
 * outage a user typing their OWN UEI is told their company does not exist — an EVIDENCE
 * failure rendered as a WORLD fact, the same class as `count ?? 0` and DEFECT-7.
 *
 * This matters most in a live demo: the audience types their own UEI, and a SAM hiccup
 * tells them Mindy cannot find their company.
 *
 * ── THE CONTRACT ───────────────────────────────────────────────────────────────────────
 *   found       the entity exists (local mirror, optionally enriched with live detail)
 *   not_found   BOTH local and live agree it does not exist — a real, defensible answer
 *   malformed   the string cannot be a UEI (12 alphanumerics) — a CLIENT fact,
 *               knowable without asking anyone, so never an upstream failure
 *   unavailable we could not establish existence. NOT "invalid", NOT "not found".
 *
 * `unavailable` is the whole point: it is the state that used to be reported as absence.
 */
import { getEntityByUEI, type SAMEntity } from './entity-api';
import { localEntityByUEI } from './entity-local-fallback';

export type UeiResolution = 'found' | 'not_found' | 'malformed' | 'unavailable';

export interface ResolvedUei {
  resolution: UeiResolution;
  entity: SAMEntity | null;
  /** 'local' = cached mirror row; 'live' = fresh SAM; null when nothing resolved. */
  source: 'local' | 'live' | null;
  /** When a LOCAL record was last synced. Callers must surface this, never imply live. */
  asOf: string | null;
  /** True when live SAM could not be consulted — the record may be stale. */
  degraded: boolean;
  /** Operator-facing reason. Never rendered as the user's answer. */
  detail: string | null;
}

/** A UEI is exactly 12 alphanumerics. SAM excludes I and O to avoid 1/0 confusion, but we
 *  deliberately do NOT enforce that: rejecting a real UEI is far worse than accepting a
 *  fake one, and existence is settled by lookup, not by our guess at their alphabet. */
export const UEI_PATTERN = /^[A-Za-z0-9]{12}$/;

export function isWellFormedUei(raw: string | null | undefined): boolean {
  return UEI_PATTERN.test(String(raw || '').trim());
}

/**
 * Resolve a UEI. Local first for EXISTENCE, live SAM for FRESHNESS/DETAIL.
 *
 * @param opts.enrich when false, skip live SAM entirely (fast paths, bulk callers)
 */
export async function resolveUei(
  rawUei: string | null | undefined,
  opts: { enrich?: boolean } = {},
): Promise<ResolvedUei> {
  const uei = String(rawUei || '').trim().toUpperCase();
  const base = { entity: null, source: null, asOf: null, degraded: false, detail: null } as const;

  // 1) Shape. Knowable locally, so it is never confused with an upstream failure.
  if (!uei) return { ...base, resolution: 'malformed', detail: 'no UEI supplied' };
  if (!isWellFormedUei(uei)) {
    return { ...base, resolution: 'malformed', detail: `a UEI is 12 alphanumeric characters; got ${uei.length}` };
  }

  // 2) LOCAL FIRST — the mirror is authoritative for existence. It does not depend on
  //    SAM having a good day, and a local hit means we can always answer "yes, exists".
  let local: Awaited<ReturnType<typeof localEntityByUEI>> = null;
  let localFailed: string | null = null;
  try {
    local = await localEntityByUEI(uei);
  } catch (err) {
    // A mirror failure is an EVIDENCE failure too — it must not become "not found".
    localFailed = err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160);
    console.error('[resolveUei] local mirror unavailable', localFailed);
  }

  // 3) LIVE SAM — enrichment only. Never permitted to overturn a local hit.
  let live: SAMEntity | null = null;
  let liveFailed: string | null = null;
  if (opts.enrich !== false) {
    try {
      live = await getEntityByUEI(uei);
    } catch (err) {
      liveFailed = err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160);
      console.warn('[resolveUei] live SAM unavailable, using local', liveFailed);
    }
  }

  // 4) Decide. A local hit ALWAYS establishes existence.
  if (local) {
    return {
      resolution: 'found',
      // Prefer live detail when we have it; fall back to the cached row.
      entity: live || local.entity,
      source: live ? 'live' : 'local',
      asOf: live ? null : local.asOf,
      degraded: !live,
      detail: live ? null : (liveFailed || 'served from local registry'),
    };
  }
  if (live) {
    // Not in our mirror but live SAM has it — a newer registration than our last sync.
    return { resolution: 'found', entity: live, source: 'live', asOf: null, degraded: false, detail: null };
  }

  // 5) Nothing found. Distinguish "genuinely absent" from "could not establish".
  //    ⚠️ THIS IS THE DEFECT. If either source FAILED, we did not establish absence —
  //    we failed to look. Reporting that as not_found is the bug.
  if (localFailed || liveFailed) {
    return {
      ...base,
      resolution: 'unavailable',
      degraded: true,
      detail: localFailed ? `local registry: ${localFailed}` : `live SAM: ${liveFailed}`,
    };
  }
  // Both sources answered, and both say no. A real, defensible not_found.
  if (opts.enrich === false) {
    // Local-only mode never consulted SAM, so it cannot assert global absence.
    return { ...base, resolution: 'unavailable', degraded: true, detail: 'not in local registry; live SAM not consulted' };
  }
  return { ...base, resolution: 'not_found', detail: 'no entity in the local registry or live SAM' };
}

/** The user-facing sentence. Never says "invalid" for an upstream failure. */
export function ueiMessage(r: ResolvedUei): string {
  switch (r.resolution) {
    case 'found':
      return r.degraded && r.asOf
        ? `Found (from our SAM registry, as of ${String(r.asOf).slice(0, 10)} — live SAM is unavailable right now).`
        : 'Found.';
    case 'malformed':
      return 'That does not look like a UEI — it should be 12 letters and numbers.';
    case 'not_found':
      return 'No SAM registration found for that UEI.';
    case 'unavailable':
      // The critical wording: our problem, described as ours.
      return 'We could not check SAM just now, so we cannot confirm this UEI yet. This is a problem on our side, not a problem with your registration. Please try again shortly.';
  }
}
