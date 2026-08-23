/**
 * Competition Depth — average bidders + single-bid rate for a buyer, from USASpending.gov.
 *
 * ⚠️ SOURCE = USASpending, NOT FPDS. FPDS.gov retired Feb 24, 2026; `number_of_offers_received`
 * now comes from USASpending's per-award detail endpoint. (Older comments called this "the FPDS
 * competition extract" — that labeling is retired; the data is USASpending. This is the metric
 * published as Observatory OBS-009, so the source name has to be exactly right.)
 *
 * The marquee Competition-Health metric a procurement director is graded on, and the number that
 * grounds the Institute's "under-served markets" thesis. Deferred until now because
 * `number_of_offers_received` is NULL on the `spending_by_award` SEARCH endpoint (documented in
 * usaspending-sync.ts). But the PER-AWARD DETAIL endpoint (`/api/v2/awards/<id>/`) DOES carry it.
 *
 * SO — no bulk download, no BigQuery, no schema migration, no touching the awards/pipeline tables:
 * sample a buyer's recent awards, fetch offers-received per award, compute avg + single-bid rate.
 * A ~60-award sample gives a statistically sound average; the result is CACHED (24h) so the
 * dashboard never re-hammers USASpending.
 *
 * HONESTY: awards with no offers field (IDVs, some SAP) are EXCLUDED from the denominator and
 * counted (`sampledWithData` vs `sampled`), never coerced to 0. If the sample is too small to be
 * meaningful, `grounded=false` — the dashboard shows the honest "not enough data", never a fake avg.
 */

import { withCache } from '@/lib/mcp/external-cache';

const SEARCH_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const AWARD_URL = (id: string) => `https://api.usaspending.gov/api/v2/awards/${encodeURIComponent(id)}/`;

// A buyer's dashboard uses the SAM long-form department name; USASpending's agency filter wants the
// toptier name. Map the common ones; fall back to a cleaned form for the rest.
const TOPTIER: Record<string, string> = {
  'VETERANS AFFAIRS, DEPARTMENT OF': 'Department of Veterans Affairs',
  'DEPT OF DEFENSE': 'Department of Defense',
  'HOMELAND SECURITY, DEPARTMENT OF': 'Department of Homeland Security',
  'HEALTH AND HUMAN SERVICES, DEPARTMENT OF': 'Department of Health and Human Services',
  'GENERAL SERVICES ADMINISTRATION': 'General Services Administration',
  'AGRICULTURE, DEPARTMENT OF': 'Department of Agriculture',
  'ENERGY, DEPARTMENT OF': 'Department of Energy',
  'JUSTICE, DEPARTMENT OF': 'Department of Justice',
  'INTERIOR, DEPARTMENT OF THE': 'Department of the Interior',
  'STATE, DEPARTMENT OF': 'Department of State',
  'TRANSPORTATION, DEPARTMENT OF': 'Department of Transportation',
  'TREASURY, DEPARTMENT OF THE': 'Department of the Treasury',
  'ENVIRONMENTAL PROTECTION AGENCY': 'Environmental Protection Agency',
  'NATIONAL AERONAUTICS AND SPACE ADMINISTRATION': 'National Aeronautics and Space Administration',
};
/**
 * Military service branches are SUBTIER agencies under Department of Defense in
 * USASpending, not toptier. Verified 2026-08-17: a toptier filter named
 * "Department of the Navy" returns 0 awards; the same name as a subtier filter
 * returns results. Without this the Navy — the buyer this surface was built for —
 * silently resolved to "unmapped" and competition was withheld.
 */
const SUBTIER_BRANCHES: Record<string, string> = {
  'DEPARTMENT OF THE NAVY': 'Department of the Navy',
  'DEPT OF THE NAVY': 'Department of the Navy',
  'DEPARTMENT OF THE ARMY': 'Department of the Army',
  'DEPT OF THE ARMY': 'Department of the Army',
  'DEPARTMENT OF THE AIR FORCE': 'Department of the Air Force',
  'DEPT OF THE AIR FORCE': 'Department of the Air Force',
  'UNITED STATES MARINE CORPS': 'Department of the Navy',
  'US MARINE CORPS': 'Department of the Navy',
  'MARINE CORPS': 'Department of the Navy',
};

/** A branch resolves to a subtier filter; everything else to a toptier filter. */
function resolveSubtier(agency: string): string | null {
  return SUBTIER_BRANCHES[agency.trim().toUpperCase()] ?? null;
}

// Resolve a SAM long-form name to the USASpending toptier name.
// `resolved` is TRUE only when we KNOW the mapping (a dictionary hit or the "X, DEPARTMENT OF"
// pattern). An unmapped agency yields resolved:FALSE — the caller must NOT sample it, because a
// wrong toptier name would silently pull a DIFFERENT agency's awards (the "how do we know who it
// is" trust hole). We never guess a name and present its competition data as this buyer's.
function resolveToptier(agency: string): { name: string; resolved: boolean } {
  const key = agency.trim().toUpperCase();
  if (TOPTIER[key]) return { name: TOPTIER[key], resolved: true };
  // Known-safe pattern: "X, DEPARTMENT OF" / "X, DEPARTMENT OF THE" -> "Department of [the] X".
  const m = key.match(/^(.*),\s*DEPARTMENT OF( THE)?$/);
  if (m) return { name: `Department of${m[2] ? ' the' : ''} ${m[1].split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')}`, resolved: true };
  // Unmapped — return the raw name but mark it UNRESOLVED so the caller refuses to sample.
  return { name: agency.trim(), resolved: false };
}

export interface CompetitionScope {
  /** Narrow the sample to one NAICS — the requirement's market, not the whole agency. */
  naics?: string;
  /** Narrow to a place of performance (2-letter state). */
  state?: string;
}

export interface CompetitionDepth {
  agency: string;
  /** Echoes the scope actually sampled, so a reader never mistakes a NAICS-level
   *  figure for an agency-wide one (or the reverse). */
  scope: { naics: string | null; state: string | null };
  resolvedAgency: string | null; // the USASpending toptier name we ACTUALLY sampled (proves the buyer); null when unresolved
  grounded: boolean;         // enough real offers data to report a meaningful number
  sampled: number;           // awards pulled
  sampledWithData: number;   // of those, how many carried a real offers count (denominator)
  avgBidders: number | null; // mean offers received (null when not grounded)
  medianBidders: number | null;
  singleBidCount: number;    // awards with ≤1 offer
  singleBidPct: number | null; // % single-bid — the "under-competed" signal
  /** How much weight this number should carry. NOT the same as MIN_SAMPLE (see above). */
  strength: EvidenceStrength;
  /** 95% CI half-width on singleBidPct, in points — why we do not print a decimal. */
  singleBidMoe: number | null;
  /** Executive read: "About half" rather than "47.9%". */
  singleBidPlain: string | null;
  note: string;
}

const MIN_SAMPLE = 12; // below this, the average isn't meaningful — say so, don't fake it.

/**
 * EVIDENCE STRENGTH — separate from MIN_SAMPLE, on purpose.
 *
 * Eric, 2026-08-22: "accuracy and precision aren't the same thing. 47.9% can be
 * mathematically accurate for those 48 observations while still communicating more
 * certainty than the evidence warrants."
 *
 * MIN_SAMPLE stays an EPISTEMIC GUARD: below it we do not report at all. This is a
 * different question — given that we CAN report, how much weight should the number carry?
 * A sample can be valid enough to observe and still too thin for a headline.
 *
 * At n=48, a 47.9% rate carries a 95% CI of roughly ±14 points (34%–62%). Printing one
 * decimal place implies a precision the sample cannot support, which is what made the
 * card read as not credible.
 */
export type EvidenceStrength = 'insufficient' | 'limited' | 'sampled' | 'strong';

export function evidenceStrength(n: number): EvidenceStrength {
  if (n < MIN_SAMPLE) return 'insufficient';
  if (n < 30) return 'limited';
  if (n < 100) return 'sampled';
  return 'strong';
}

/** Half-width of the 95% CI on a proportion, in percentage points. */
export function marginOfErrorPct(pct: number | null, n: number): number | null {
  if (pct == null || n <= 0) return null;
  const p = pct / 100;
  return Math.round(1.96 * Math.sqrt((p * (1 - p)) / n) * 100 * 10) / 10;
}

/**
 * The EXECUTIVE read: a plain-language band, not a decimal.
 * A procurement director should learn how much confidence to place in the number without
 * reading methodology. The exact value stays available underneath for analysts.
 */
export function plainRate(pct: number | null): string | null {
  if (pct == null) return null;
  if (pct < 12) return 'Rare';
  if (pct < 30) return 'About a quarter';
  if (pct < 45) return 'About a third';
  if (pct < 56) return 'About half';
  if (pct < 72) return 'Nearly two thirds';
  if (pct < 88) return 'Most';
  return 'Nearly all';
}

// NOTE ON SAMPLE SIZE FOR SCOPED CALLS: agency-wide, 60 awards yields plenty of
// offer-carrying records. A NAICS+state slice does not — measured 2026-08-17,
// Navy/236220/WA returned only 7 of 60 with an offers count (below MIN_SAMPLE,
// so correctly withheld), while the same scope at 100 returned 27 and grounded
// cleanly. Callers narrowing by NAICS should request ~100.

/**
 * Compute competition depth for one agency. `sampleSize` awards are pulled (default 100 → ~80 with
 * offers data; raised from 60 on 2026-08-22 — at 60 only ~48 carried an offers count, and the code
 * comment below already noted 100 grounds more cleanly. The fetch clamps to 100 either way). CACHED 24h via the shared external cache. Best-effort: any fetch failure yields a
 * grounded=false result (never a fabricated average).
 */
export async function computeCompetitionDepth(
  agency: string,
  sampleSize = 100,
  scope: CompetitionScope = {},
): Promise<CompetitionDepth> {
  const AG = agency.trim();
  const naics = scope.naics?.trim() || undefined;
  const state = scope.state?.trim().toUpperCase() || undefined;
  const empty = (note: string, resolvedAgency: string | null = null): CompetitionDepth => ({
    agency: AG, scope: { naics: naics ?? null, state: state ?? null },
    resolvedAgency, grounded: false, sampled: 0, sampledWithData: 0,
    avgBidders: null, medianBidders: null, singleBidCount: 0, singleBidPct: null, strength: 'insufficient' as EvidenceStrength, singleBidMoe: null, singleBidPlain: null, note,
  });

  // ⚠️ PROVE THE BUYER before sampling. If we can't confidently map the SAM long-name to a
  // USASpending toptier name, refuse — a guessed name would silently pull a DIFFERENT agency's
  // awards and present them as this buyer's competition. Honest "can't resolve" beats wrong data.
  // A service branch is filtered at SUBTIER; everything else at TOPTIER.
  const subtier = resolveSubtier(AG);
  const { name: toptier, resolved } = subtier
    ? { name: subtier, resolved: true }
    : resolveToptier(AG);
  if (!resolved) {
    return empty(`Can't confidently map "${AG}" to a USASpending agency, so competition depth is withheld rather than risk sampling the wrong buyer's awards.`);
  }

  try {
    const { value } = await withCache<CompetitionDepth>(
      // NOTE: cache key kept as-is deliberately — renaming it orphans every live 24h entry and
      // re-triggers a USASpending fetch storm. It's an internal string, never user-visible. The
      // DATA is USASpending (see file header); this legacy key name does NOT imply an FPDS source.
      'fpds_competition_depth',
      { agency: AG, sampleSize, naics: naics ?? '', state: state ?? '' },
      24 * 3600,
      async () => {
        // 1) recent awards for this agency (ids only) — filtered to the RESOLVED toptier name.
        const sinceDays = 365;
        const start = new Date(Date.now() - sinceDays * 86400_000).toISOString().slice(0, 10);
        const searchRes = await fetch(SEARCH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: {
              award_type_codes: ['A', 'B', 'C', 'D'],
              agencies: [{ type: 'awarding', tier: subtier ? 'subtier' : 'toptier', name: toptier }],
              time_period: [{ start_date: start, end_date: new Date().toISOString().slice(0, 10) }],
              // Optional narrowing. USASpending accepts naics_codes and
              // place_of_performance_locations alongside the agency filter —
              // verified 2026-08-17: a DoD + 236220 sample returned 40 of 40
              // awards carrying an offers count, BETTER coverage than the
              // agency-wide sample, because construction records offers more
              // reliably than the IDV-heavy agency mix.
              ...(naics ? { naics_codes: [naics] } : {}),
              ...(state ? { place_of_performance_locations: [{ country: 'USA', state }] } : {}),
            },
            fields: ['Award ID'],
            limit: Math.min(Math.max(sampleSize, 20), 100),
            sort: 'Award ID',
          }),
        });
        if (!searchRes.ok) return empty(`USASpending search returned ${searchRes.status}`, toptier);
        const searchJson = await searchRes.json();
        const ids: string[] = (searchJson.results || []).map((r: { generated_internal_id?: string }) => r.generated_internal_id).filter(Boolean);
        if (ids.length === 0) return empty(`No recent awards found for ${toptier}.`, toptier);

        // 2) offers-received per award, concurrency-limited (8 at a time)
        const offers: number[] = [];
        for (let i = 0; i < ids.length; i += 8) {
          const batch = ids.slice(i, i + 8);
          const res = await Promise.all(batch.map((id) =>
            fetch(AWARD_URL(id))
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => {
                const n = d?.latest_transaction_contract_data?.number_of_offers_received;
                const v = n == null || n === '' ? null : Number(n);
                return v != null && isFinite(v) && v >= 0 ? v : null;
              })
              .catch(() => null),
          ));
          for (const v of res) if (v != null) offers.push(v);
        }

        const sampled = ids.length;
        const withData = offers.length;
        if (withData < MIN_SAMPLE) {
          // Not enough real offers data to report a meaningful average — say so, and PRESERVE the
          // real counts (`sampled`/`sampledWithData`) so the card can disclose "only N of M carried
          // offers", never a fabricated average.
          return {
            ...empty(`Only ${withData} of ${sampled} sampled awards carried an offers count${naics ? ` for NAICS ${naics}` : ''}${state ? ` in ${state}` : ''} — too few to report a meaningful average. (IDVs and some SAP awards don't record offers.)`, toptier),
            sampled,
            sampledWithData: withData,
          };
        }
        offers.sort((a, b) => a - b);
        const avg = Math.round((offers.reduce((s, x) => s + x, 0) / withData) * 10) / 10;
        const median = offers[Math.floor(withData / 2)];
        const single = offers.filter((x) => x <= 1).length;
        const scopeLabel = [naics ? `NAICS ${naics}` : null, state || null]
          .filter(Boolean).join(', ');
        return {
          agency: AG,
          scope: { naics: naics ?? null, state: state ?? null },
          resolvedAgency: toptier,
          grounded: true,
          sampled,
          sampledWithData: withData,
          avgBidders: avg,
          medianBidders: median,
          singleBidCount: single,
          singleBidPct: Math.round((single / withData) * 1000) / 10,
          strength: evidenceStrength(withData),
          singleBidMoe: marginOfErrorPct(Math.round((single / withData) * 1000) / 10, withData),
          singleBidPlain: plainRate(Math.round((single / withData) * 1000) / 10),
          note: `Sampled ${withData} of ${sampled} recent ${toptier}${scopeLabel ? ` (${scopeLabel})` : ''} awards that carried an offers count. IDVs/SAP awards without an offers field are excluded, not counted as zero.`,
        };
      },
    );
    return value;
  } catch (e) {
    // Pass the RESOLVED toptier through even on failure. Without it a transient blip reported
    // `resolvedAgency: null`, which reads as "we couldn't map this buyer" — a different and much
    // more alarming failure than "the fetch hiccuped". That mis-signal cost a real debugging
    // detour on DEPT OF DEFENSE (2026-08-15): the agency had resolved fine and the sampler was
    // healthy (43/60 awards, 2.3 avg bidders), but the null made it look unresolvable.
    // NOTE the catch wraps the CACHE call too, so `fetch failed` here can originate in the cache
    // layer, not USASpending — don't read this message as proof the upstream API is down.
    return empty(`competition depth failed: ${e instanceof Error ? e.message : String(e)}`, toptier);
  }
}
