/**
 * Government-Buyer Market Research — the Active Performer rubric.
 *
 * Answers: "Are there enough qualified small businesses in NAICS X /
 * state Y / set-aside Z to justify a set-aside?" — with a performance-
 * weighted count, not a raw registration count.
 *
 * Design (docs/PRD-gov-buyer-market-research.md §4):
 *   - Base list: sam_entities filtered by NAICS + state + set-aside.
 *   - Activity: LEFT-join BigQuery `recipients` by UEI. Registered-but-
 *     never-won firms survive the join (no award row) and score low —
 *     they become Emerging / Registered-Only. They are NEVER dropped
 *     (Eric's fairness rule — don't bury new entrants).
 *   - Score → tier → counts. Emerging is INCLUDED in the headline count
 *     by default (excluding new entrants is a bias we won't bake in
 *     silently); a toggle lets a CO go performers-only.
 */

import { createClient } from '@supabase/supabase-js';
import { BQ_TABLES, bqJobOptions } from '@/lib/bigquery/client';
import { queryCached, bqDegraded, bqDegradedReason } from '@/lib/bigquery/cache';
import { createHash } from 'crypto';
import { kv } from '@vercel/kv';
import {
  ACTIVITY_MAX_BYTES,
  assertBoundedActivityPool,
  evaluationCap,
  sizeStatusForNaics,
  uniqueUeis,
  type SamSizeStatus,
} from '@/lib/gov-buyer/evaluation-bound';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// Verified certs (SBA/VA-vetted) weight higher than self-certified ones.
// Which certifications in our data come from the SBA-CERTIFIED field
// (vetted) vs. the self-certified business-type field. Verified 2026-06-04:
// only 8(a) and HUBZone are sourced from SAM's certified-programs field;
// WOSB/SDVOSB/VOSB are self-certified business types. The rubric weights
// the vetted ones higher (a CO trusts a certified cert more than a
// self-attestation), and the memo footnotes the distinction.
const VERIFIED_CERTS = new Set(['8(a)', 'HUBZone']);

export type Tier = 'active_performer' | 'capable' | 'emerging' | 'registered_only';

export interface ScoredEntity {
  uei: string;
  legalBusinessName: string;
  cageCode: string | null;
  state: string | null;
  /** Physical city — for the outreach list's Location column. */
  city: string | null;
  /** SAM.gov entity page. The buyer completes contact through SAM: the public
   *  API redacts POC email/phone (measured 0/20,000), so a link to the record
   *  is the honest handoff, not a contact field we cannot populate. */
  samUrl: string | null;
  /** Government business POC NAME only — present on ~49% of records. Never an email. */
  pocName: string | null;
  certifications: string[];
  primaryNaics: string | null;
  registrationStatus: string | null;
  registrationExpiry: string | null;
  // activity (from BQ recipients; null if never won)
  totalObligated: number;
  awardCount: number;
  distinctAgencyCount: number;
  lastActionDate: string | null;
  // rubric
  score: number;
  tier: Tier;
  /**
   * SAM per-NAICS size for the queried NAICS only (`Y` / `N` / `E`).
   * null = not stated. Never inferred from name, revenue, awards, or UEI count.
   */
  sizeStatus: SamSizeStatus | null;
  /** NAICS the sizeStatus applies to. Must equal the query NAICS to be usable. */
  sizeStatusNaics: string | null;
  /** Pipeline/snapshot that observed the size status, when SAM supplied one. */
  sizeStatusSource: string | null;
}

export interface MarketResearchParams {
  naics: string;
  state?: string;
  setAside?: string;        // normalized label: '8(a)','HUBZone','SDVOSB','WOSB','EDWOSB','Small Business'
  includeEmerging?: boolean; // default true
  limit?: number;
}

export interface MarketResearchResult {
  query: MarketResearchParams;
  // headline count for the determination (excludes Registered-Only;
  // includes Emerging unless includeEmerging=false)
  marketDepth: number;
  capableDepth: number;      // active_performer + capable ONLY — the Rule-of-Two basis (FM-03)
  /** DEFECT-9A: exhaustive SQL count of the eligible population (NOT sampled). */
  eligiblePopulation: number | null;
  /**
   * Matching UEIs (eligible known performers for this NAICS / set-aside).
   * Distinct from eligiblePopulation and from the evaluated/scored sample.
   * null = the matching census did not run.
   */
  matchingUeiCount: number | null;
  /** How many firms were actually scored (the evaluation sample; ≤ limit). */
  sampleSize: number;
  /**
   * Matching coverage of the eligible population (matchingUeiCount / eligiblePopulation).
   * Distinct from family-resolution coverage (sampleSize / matchingUeiCount).
   * null = unknown. Never treat `limit` as this denominator.
   */
  sampleCoverage: number | null;
  /** Capable (score>=45) among EVALUATED firms. Not a market total unless coverage is 1. */
  capableInSample: number;
  /** Capable + emerging among EVALUATED firms. */
  marketDepthInSample: number;
  /**
   * met = >=2 found (conclusive at any coverage) · not_met = <2 AND exhaustive ·
   * undetermined = <2 and coverage<1, OR the award-history lookup degraded (#1289).
   * Two independent routes to "we do not know", collapsed into ONE non-committal value.
   */
  ruleOfTwoDetermination: 'met' | 'not_met' | 'undetermined';
  ruleOfTwoConclusive: boolean;
  /** DEFECT-10: (Y+N)/total for the requested NAICS. Below 1 = classification incomplete. */
  sizeStatusCoverage: number;
  smallStatusY: number;
  smallStatusN: number;
  /** SBA size-standard exception applies — neither small nor not-small. */
  smallStatusException: number;
  smallStatusUnknown: number;
  /**
   * DEPRECATED. capableDepth >= 2 (NOT emerging-driven).
   * NULL when the award-history lookup degraded (#1289): we could not assess capability,
   * which is not the same as finding none. A CO reading `false` acts on it; `null` asks
   * again. And `false` is itself AMBIGUOUS (DEFECT-9A) — "<2 found", not "fewer than 2
   * exist". Read ruleOfTwoDetermination.
   */
  ruleOfTwoMet: boolean | null;
  /** True when a BQ failure (not an empty market) produced the counts above. */
  dataDegraded?: boolean;
  counts: Record<Tier, number>;
  registeredOnlyCount: number; // shown separately, never inflates marketDepth
  businesses: ScoredEntity[];
  dataAsOf: string;          // latest sam_entities sync — for the memo
  caveats: string[];
}

// ───────────────────────── scoring ─────────────────────────

function monthsSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / (1000 * 60 * 60 * 24 * 30.44);
}

interface Activity {
  totalObligated: number;
  awardCount: number;
  distinctAgencyCount: number;
  lastActionDate: string | null;
  wonTargetNaics: boolean;   // has an award under the target NAICS
}

export function scoreEntity(
  certs: string[],
  primaryNaics: string | null,
  naicsCodes: string[],
  targetNaics: string,
  requiredCert: string | undefined,
  act: Activity | null,
): { score: number; tier: Tier } {
  let score = 0;

  // Recent activity (30)
  const m = act ? monthsSince(act.lastActionDate) : null;
  if (m !== null) {
    if (m <= 12) score += 30;
    else if (m <= 24) score += 20;
    else if (m <= 36) score += 10;
  }

  // Set-aside eligibility (25) — verified certs weighted over self-cert.
  if (requiredCert) {
    if (certs.includes(requiredCert)) score += VERIFIED_CERTS.has(requiredCert) ? 25 : 18;
  } else if (certs.length) {
    score += 10; // qualified as some small-business type even if no specific cert asked
  }

  // NAICS relevance (20): won under target > related-only > registered-not-won
  if (act?.wonTargetNaics) score += 20;
  else if (primaryNaics === targetNaics || naicsCodes.includes(targetNaics)) score += 10;
  else score += 5;

  // Track-record depth (15), capped so a giant doesn't crowd out small firms.
  if (act) {
    const volPts = Math.min(10, Math.log10(Math.max(1, act.totalObligated)) - 4); // ~$10k→0, $100M→4
    const freqPts = Math.min(5, act.awardCount / 4);
    score += Math.max(0, volPts) + Math.max(0, freqPts);
  }

  // Agency breadth (10)
  if (act) {
    if (act.distinctAgencyCount >= 3) score += 10;
    else if (act.distinctAgencyCount === 2) score += 5;
    else if (act.distinctAgencyCount === 1) score += 2;
  }

  score = Math.round(Math.min(100, score));

  let tier: Tier;
  if (score >= 70) tier = 'active_performer';
  else if (score >= 45) tier = 'capable';
  else if (score >= 25) tier = 'emerging';
  else tier = 'registered_only';

  return { score, tier };
}

// ───────────────────────── query ─────────────────────────

/**
 * Batch-fetch activity for a set of UEIs from BQ `recipients` in ONE
 * query (not N). wonTargetNaics is computed with a correlated EXISTS
 * against `awards` partitioned by fiscal_year + clustered by recipient_uei.
 */
interface EntityRow {
  uei: string;
  legal_business_name: string;
  cage_code: string | null;
  physical_state: string | null;
  physical_city: string | null;
  sam_url: string | null;
  points_of_contact: { name?: string; type?: string }[] | null;
  certifications: string[];
  primary_naics: string | null;
  naics_codes: string[];
  /** P0-3: SAM's per-NAICS size representation, {"561720":"Y"|"N"}. Missing key = not stated. */
  naics_small_business?: Record<string, string> | null;
  /** P0-3: indexed Y-projection of the above. Derived, never authoritative. */
  small_business_naics?: string[] | null;
  /** P0-3: which pipeline/snapshot observed the size status. */
  naics_sb_source?: string | null;
  registration_status: string | null;
  registration_expiry: string | null;
}

/**
 * The government-business POC's NAME, when SAM carries one.
 *
 * SAM's public API returns the POC array with empty `email`/`phone` on every
 * record (measured: 0 emails across a 20,000-POC sample), so this deliberately
 * extracts the name ONLY. Anything that renders this value must not label it
 * as contact information.
 */
function pickPocName(pocs: { name?: string; type?: string }[] | null): string | null {
  if (!Array.isArray(pocs)) return null;
  const preferred = pocs.find((p) => p?.type === 'governmentBusinessPOC' && p.name?.trim());
  const any = pocs.find((p) => p?.name?.trim());
  return (preferred?.name || any?.name || '').trim() || null;
}

/**
 * Set by fetchActivity when its BQ lookup degraded (query failed, no stale cache). Read by
 * computeMarketResearch immediately after the await — same request, same tick.
 */
let lastActivityDegraded = false;

async function fetchActivity(ueis: string[], targetNaics: string, evaluationLimit?: number): Promise<Map<string, Activity>> {
  lastActivityDegraded = false;
  const map = new Map<string, Activity>();
  const unique = uniqueUeis(ueis);
  if (!unique.length) return map;
  assertBoundedActivityPool(evaluationLimit ?? unique.length, unique.length);

  const fingerprint = createHash('sha1').update(unique.join(',')).digest('hex').slice(0, 16);
  const cacheKey = `gov-buyer:activity:v2:${targetNaics}:${unique.length}:${fingerprint}`;
  const rows = await queryCached<{
    recipient_uei: string;
    total_obligated: number;
    award_count: number;
    distinct_agency_count: number;
    last_action_date: string;
    won_target_naics: boolean;
  }>({
    cacheKey,
    cacheOnly: false,
    query: `
      SELECT
        r.recipient_uei,
        r.total_obligated,
        r.award_count,
        r.distinct_agency_count,
        CAST(r.last_action_date AS STRING) AS last_action_date,
        EXISTS (
          SELECT 1 FROM ${BQ_TABLES.awards} a
          WHERE a.recipient_uei = r.recipient_uei
            AND a.naics_code = @naics
        ) AS won_target_naics
      FROM ${BQ_TABLES.recipients} r
      WHERE r.recipient_uei IN UNNEST(@ueis)
    `,
    params: { ueis: unique, naics: targetNaics },
    ...bqJobOptions({
      feature: 'mrr',
      tool: 'assess_market_depth',
      queryFamily: 'market-depth-activity',
      maximumBytesBilled: ACTIVITY_MAX_BYTES,
    }),
  });

  // Record whether that lookup was an ABSENCE OF KNOWLEDGE rather than a measured zero.
  lastActivityDegraded = bqDegraded(cacheKey);

  for (const row of rows) {
    map.set(row.recipient_uei, {
      totalObligated: Number(row.total_obligated || 0),
      awardCount: Number(row.award_count || 0),
      distinctAgencyCount: Number(row.distinct_agency_count || 0),
      lastActionDate: row.last_action_date || null,
      wonTargetNaics: Boolean(row.won_target_naics),
    });
  }
  return map;
}

/**
 * RESULT CACHE — the whole determination, not just the BigQuery half.
 *
 * The BQ activity join is already cached for 90 days, but the Supabase candidate
 * pool query runs on EVERY request regardless: ~900ms for a 5,000-row pool, before
 * scoring. A warm run still cost 2-4s end to end.
 *
 * That is fine at a desk and a real risk in front of a contracting officer on
 * conference wifi. So cache the finished MarketResearchResult under the exact
 * query. Identical requirement = instant answer.
 *
 * SAFETY — this caches a DETERMINATION a CO may file, so:
 *   • 6h TTL. SAM registrations and award history move on the order of days;
 *     six hours cannot silently serve a stale set-aside finding into next week.
 *   • dataAsOf rides along in the payload and is rendered, so a reader always
 *     sees WHEN the underlying data was synced — a cached answer is never
 *     mistaken for a fresher one than it is.
 *   • a cache read or write failure NEVER fails the request; it just costs the
 *     live path. Degrade to correct-and-slow, never to wrong-and-fast.
 */
const RESULT_TTL_SECONDS = 6 * 60 * 60;

function resultCacheKey(p: MarketResearchParams): string {
  // Every input that changes the answer, in a fixed order.
  //
  // ⚠️ BUMP THE VERSION whenever ScoredEntity's SHAPE changes, not just when the
  // scoring changes. v1 → v2 because city / samUrl / pocName were added for the
  // outreach list: without a bump, entries written by the previous deploy stay
  // warm for the full 6h TTL and deserialize with those fields undefined, so the
  // export silently ships blank Location and SAM-link columns.
  return [
    // v3 → v4 (Ralph MCP audit, 2026-09-05): matchingUeiCount census + SAM
    // per-NAICS sizeStatus on ScoredEntity. Evaluation pool equals `limit`
    // (no 2,500-UEI activity EXISTS). Without a bump, v3 cache entries would
    // deserialize without matchingUeiCount/size and look like "size unknown"
    // for firms whose SAM status was already on the row.
    'gov-buyer:mr:v4',
    p.naics,
    (p.state || '').toUpperCase(),
    p.setAside || '',
    p.includeEmerging === false ? 'noemerging' : 'emerging',
    String(p.limit ?? 200),
  ].join(':');
}

/**
 * CURRENT 8(a) ELIGIBILITY — 8(a) ONLY, deliberately.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────────────────────
 * `certifications[]` records that a program was ASSERTED; it does not prove the certification
 * is CURRENTLY VALID. Measured against the Aug-2026 extract and the live mirror:
 *
 *   8(a)      5,957 returned by this filter · 4,294 current · **1,542 EXPIRED** · 32 unknown
 *   1,541 of those expired firms have an ACTIVE SAM registration, so nothing else flags them.
 *
 * Real cases: KILIUDA CONSULTING (registration Active, `["8(a)"]`, 8(a) expired 2023-01-11) and
 * ALASKA PROFESSIONAL CONSTRUCTION (Active, `["HUBZone"]`, expired 2024-03-19). Recommending a
 * lapsed firm for a set-aside is a compliance error, not a ranking nuisance.
 *
 * ── WHY 8(a) AND NOTHING ELSE ──────────────────────────────────────────────────────────────
 * Date coverage differs by program, measured not assumed. 8(a) tokens (`A6`, `JT`) are dated
 * 1,740 of 1,752 — so requiring currency is a real improvement in truth.
 *
 * HUBZone is the opposite: only 408 of 4,843 carry a confirmed date and **4,198 are unknown**,
 * because 89% of `XX` tokens have no date in the source. Applying this same rule there would
 * drop 90% of the HUBZone population and convert "we don't know" into "not eligible" — the
 * evidence-as-fact inversion this work exists to prevent. WOSB/SDVOSB/VOSB are SELF-identified
 * and carry no SBA expiry at all.
 *
 * So: 8(a) here, each other program only on its own date-coverage evidence.
 *
 * ── THE THREE STATES ───────────────────────────────────────────────────────────────────────
 *   current  → eligible for current 8(a) filtering
 *   expired  → EXCLUDED from current eligibility; historical 8(a) stays visible in
 *              `certifications[]`, which this change does not touch
 *   unknown  → NOT silently counted as current (32 firms). They are excluded from the
 *              *current-eligibility* filter rather than asserted either way.
 */
const EIGHT_A = '8(a)';

/** PostgREST jsonb-array containment operand: an ARRAY of the objects to match. */
function currentCertFilter(certType: string): string {
  return JSON.stringify([{ certification_type: certType, certification_status: 'current' }]);
}

export async function runMarketResearch(params: MarketResearchParams): Promise<MarketResearchResult> {
  const key = resultCacheKey(params);
  try {
    const hit = await kv.get<MarketResearchResult>(key);
    // SHAPE GUARD (DEFECT-9A): a version bump is a human step and humans forget it —
    // I did, and three live verification runs silently read stale pre-fix entries.
    // Reject any hit missing a field the current shape guarantees, so a forgotten bump
    // costs a recompute instead of serving a stale answer that LOOKS current.
    const shapeOk = hit
      && typeof hit.marketDepth === 'number'
      && 'ruleOfTwoDetermination' in hit
      && 'sampleSize' in hit;
    if (shapeOk) return hit as MarketResearchResult;
    if (hit) console.warn('[gov-buyer/mr] discarding cache entry with stale shape:', key);
  } catch (err) {
    // KV down → run it live. Never fail a determination on a cache read.
    console.warn('[gov-buyer/mr] result cache read failed:', err);
  }

  const result = await computeMarketResearch(params);

  // Only cache a result that actually found a market. Caching an empty answer
  // for six hours would freeze the exact failure mode this engine just had
  // ("capable: 0, Rule of Two NOT met") into something a CO could file.
  if (result.marketDepth > 0) {
    try {
      await kv.set(key, result, { ex: RESULT_TTL_SECONDS });
    } catch (err) {
      console.warn('[gov-buyer/mr] result cache write failed:', err);
    }
  }
  return result;
}

async function computeMarketResearch(params: MarketResearchParams): Promise<MarketResearchResult> {
  const includeEmerging = params.includeEmerging !== false; // default true
  const limit = evaluationCap(params.limit);
  const sb = getSupabase();

  // 1) Base list from the SAM registry cache. Active + non-expired only —
  //    a CO reads this count as a defensibility claim.
  //
  // ⚠️ THE SAMPLING BUG (fixed 2026-08-16). This used a bare `.limit(limit)`
  // with NO ordering, so Postgres returned an ARBITRARY page of the market.
  // Measured on 541512: 44,788 active firms, of which only ~5.6% have any
  // award history — so an arbitrary 50 was ~47 never-won registrants, the BQ
  // join correctly found nothing for them, and EVERY market came back:
  //
  //     active_performer: 0, capable: 0, ruleOfTwoMet: false
  //
  // A CO would read "zero capable firms, Rule of Two NOT met" for a market
  // with hundreds of proven performers — a confident 0 where the truth is the
  // opposite. The join was never broken; the CANDIDATE SELECTION was.
  //
  // Fix: pull a wide candidate pool, resolve activity for ALL of it, and let
  // the SCORE decide who surfaces — rather than letting an arbitrary DB page
  // decide before scoring ever runs. New entrants are still never dropped
  // (the fairness rule above); they simply stop crowding out the performers.
  const select = 'uei, legal_business_name, cage_code, physical_state, physical_city, sam_url, points_of_contact, certifications, primary_naics, naics_codes, registration_status, registration_expiry, naics_small_business, small_business_naics, naics_sb_source';
  // P0-3 (2026-08-24): SIZE and SOCIOECONOMIC PROGRAM are different questions and are now
  // filtered from different columns.
  //
  // The defect this fixes: a general small-business request arrived as
  // set_aside='SBA'/'Small Business' and was matched against certifications[], which holds
  // ONLY socioeconomic program labels (8(a)/HUBZone/SDVOSB/WOSB/VOSB). No such value exists
  // there, so the filter matched ZERO rows and assess_market_depth reported
  // "no small businesses in this market" for NAICS 561720 — against 20,074 firms that SAM
  // represents as small for that code, and 10 known active performers. For a set-aside
  // determination that is the most dangerous possible wrong answer: it argues AGAINST
  // setting the requirement aside.
  //
  // Size now comes from SAM's own per-NAICS representation (assertions.goodsAndServices
  // .naicsList[].sbaSmallBusiness / bulk field 34), stored tri-state as
  // naics_small_business {"561720":"Y"|"N"} with small_business_naics as the indexed
  // Y-projection. A MISSING key means SAM did not say — never "not small".
  /** How deep to read the award mirror for performer seeds. 236220 (the widest measured
 *  market) has 2,072 distinct performers; 5,000 covers it with headroom. Measured cost:
 *  ~1.6s for the full 2,072-UEI fetch, and pool paging is linear (~2s at 5,000 rows). */
const PERFORMER_FETCH_CAP = 5000;
/** Share of the pool RESERVED for non-performing registrants, so discovery keeps a path
 *  for new entrants even in markets where performers alone would fill it. */
const REGISTRANT_RESERVE = 0.25;

const GENERAL_SMALL_BUSINESS = new Set(['small business', 'sba', 'sb', 'small']);
  const setAsideRaw = (params.setAside || '').trim();
  const isGeneralSmallBusiness = GENERAL_SMALL_BUSINESS.has(setAsideRaw.toLowerCase());

  const buildQuery = () => {
    let q = sb
      .from('sam_entities')
      .select(select)
      .contains('naics_codes', [params.naics])
      .eq('registration_status', 'Active')
      .eq('exclusion_flag', false);
    if (params.state) q = q.eq('physical_state', params.state.toUpperCase());
    if (setAsideRaw) {
      if (isGeneralSmallBusiness) {

        // Size test — the GIN-indexed projection of codes SAM marked 'Y' for this NAICS.
        // Deliberately NOT certifications[]: a firm can be small and hold no socioeconomic
        // certification at all, which is true of every known 561720 performer.
        q = q.contains('small_business_naics', [params.naics]);
      } else if (setAsideRaw === EIGHT_A) {
        // 8(a) ONLY: require a CURRENTLY VALID certification, not merely an asserted one.
        // 1,542 of the 5,957 firms this used to return hold an EXPIRED 8(a). See the
        // currentCertFilter doc above for why 8(a) and no other program.
        q = q.filter('certification_records', 'cs', currentCertFilter(EIGHT_A));
      } else {
        // HUBZone / SDVOSB / WOSB / VOSB — DELIBERATELY UNCHANGED. HUBZone is 89% undated, so
        // requiring currency would drop 90% of it; the self-identified programs carry no SBA
        // expiry at all. Each gets its own decision from its own date-coverage evidence.
        q = q.contains('certifications', [setAsideRaw]);
      }
    }
    return q;
  };

  // ── DEFECT-9B: candidate retrieval decides who is CONSIDERED; scoring decides who
  // SURFACES. Retrieval used to be an unordered page of `sam_entities`, so an arbitrary
  // DB slice decided the market before `scoreEntity` ever ran.
  //
  // MEASURED 2026-08-25 — known performers (firms with real award history in the NAICS)
  // reaching the scorer:
  //     541512   0 of 134      541611   2 of 246      561720  10 of 235
  //     236220   4 of 202      541330   3 of 251      541512|VA 9 of 134
  //   ACROSS ALL: 1,395 of 1,437 (97.1%) never reached scoring.
  // The scorer was correct the whole time. It simply never saw them.
  //
  // Fix = SEED the pool with known performers, then TOP UP with registrants. This changes
  // WHO IS RETRIEVED only — scoring, tiering and the 9A determination semantics are
  // untouched. Performers are HIGH-INFORMATION CANDIDATES, not guaranteed winners: they
  // get an opportunity to win on merit, and `scoreEntity` still decides.
  // 2,500 (not 1,000) used to be the activity-join pool so wide performer
  // markets could reach scoring. That EXISTS join is the cost bomb the Ralph
  // audit measured. Evaluation now equals `limit` (the requested sample).
  // Matching UEIs and eligible population are counted separately and MUST NOT
  // be represented as this cap.
  const POOL_TARGET = limit;

  // 1) Known performers first, ordered by award value DESC — a defensible ordering from
  //    existing activity evidence (100% populated on this table), never DB arrival order.
  //    ⚠️ REQUIRED: 5 of 13 measured markets have MORE performers than POOL_TARGET
  //    (236220 = 2,072). Without an explicit ordering we would have replaced "arbitrary
  //    first 1,000 registrants" with "arbitrary first 1,000 performers" — the same defect
  //    wearing a better name.
  const performerUeis: string[] = [];
  let performerSeedFailed = false;
  {
    const seen = new Set<string>();
    for (let from = 0; from < PERFORMER_FETCH_CAP; from += 1000) {
      const { data, error } = await sb
        .from('recompete_opportunities')
        .select('incumbent_uei, potential_total_value')
        .eq('naics_code', params.naics)
        .not('incumbent_uei', 'is', null)
        .order('potential_total_value', { ascending: false })
        .range(from, Math.min(from + 999, PERFORMER_FETCH_CAP - 1));
      if (error) {
        console.error('[market-research] performer seed failed:', error.message);
        performerSeedFailed = true;
        break;
      }
      if (!data?.length) break;
      for (const r of data) if (r.incumbent_uei) seen.add(r.incumbent_uei);
      if (data.length < 1000) break;
    }
    performerUeis.push(...seen);
  }

  // Matching-UEI census: eligible known performers. Counted WITHOUT hydrating
  // them into the BigQuery activity join. Failure stays null, never 0.
  let matchingUeiCount: number | null = performerSeedFailed ? null : 0;
  if (!performerSeedFailed && performerUeis.length > 0) {
    const MATCH_BATCH = 200;
    for (let i = 0; i < performerUeis.length; i += MATCH_BATCH) {
      const batch = performerUeis.slice(i, i + MATCH_BATCH);
      let q = sb
        .from('sam_entities')
        .select('uei', { count: 'exact', head: true })
        .contains('naics_codes', [params.naics])
        .eq('registration_status', 'Active')
        .eq('exclusion_flag', false)
        .in('uei', batch);
      if (params.state) q = q.eq('physical_state', params.state.toUpperCase());
      if (setAsideRaw) {
        q = isGeneralSmallBusiness
          ? q.contains('small_business_naics', [params.naics])
          : setAsideRaw === EIGHT_A
            ? q.filter('certification_records', 'cs', currentCertFilter(EIGHT_A))
            : q.contains('certifications', [setAsideRaw]);
      }
      const { count, error } = await q;
      if (error || count == null) {
        console.error('[market-research] matching-UEI census failed:', error?.message ?? 'null count');
        matchingUeiCount = null;
        break;
      }
      matchingUeiCount = (matchingUeiCount ?? 0) + count;
    }
  }

  // 2) Hydrate performers through the SAME eligibility filter as everyone else, so a
  //    performer that fails the set-aside/state/registration test is still excluded.
  //    Seeding changes reachability, never eligibility.
  const pool: EntityRow[] = [];
  const pooled = new Set<string>();
  for (let i = 0; i < performerUeis.length && pool.length < POOL_TARGET; i += 200) {
    const batch = performerUeis.slice(i, i + 200);
    const { data, error } = await buildQuery().in('uei', batch);
    if (error) throw new Error(`sam_entities performer hydrate failed: ${error.message}`);
    for (const row of (data || []) as EntityRow[]) {
      if (pool.length >= POOL_TARGET) break;
      if (!pooled.has(row.uei)) { pooled.add(row.uei); pool.push(row); }
    }
  }
  const performerSlots = pool.length;

  // 3) Top up with registrants so new / non-performing firms keep a path into discovery.
  //    Deterministic `.order('uei')`: ordering alone never fixed 9B (performers are now
  //    guaranteed entry), but it makes the exploration half reproducible and auditable
  //    instead of dependent on whatever PostgREST happened to return.
  //    RESERVE capacity for them — a market where performers alone fill the pool must not
  //    become performers-only, or discovery stops surfacing anyone new.
  const registrantFloor = Math.floor(POOL_TARGET * REGISTRANT_RESERVE);
  const performerCeiling = POOL_TARGET - registrantFloor;
  if (pool.length > performerCeiling) pool.length = performerCeiling;

  for (let from = 0; pool.length < POOL_TARGET; from += 1000) {
    const { data, error } = await buildQuery()
      .order('uei', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`sam_entities query failed: ${error.message}`);
    if (!data?.length) break;
    for (const row of data as EntityRow[]) {
      if (pool.length >= POOL_TARGET) break;
      if (!pooled.has(row.uei)) { pooled.add(row.uei); pool.push(row); }
    }
    if (data.length < 1000) break;
  }
  console.warn(`[market-research] evaluation pool ${pool.length} (limit=${limit}; ${Math.min(performerSlots, performerCeiling)} performer-seeded + ${pool.length - Math.min(performerSlots, performerCeiling)} registrant; matching UEIs=${matchingUeiCount ?? 'unknown'}; ${performerUeis.length} known performers in market)`);

  const poolUeis = uniqueUeis(pool.map((r) => r.uei));
  const activity = await fetchActivity(poolUeis, params.naics, limit);

  const performers = pool.filter((r) => activity.has(r.uei));
  const rest = pool.filter((r) => !activity.has(r.uei));
  const rows: EntityRow[] = [...performers, ...rest].slice(0, limit);

  // 3) Score + tier.
  const scored: ScoredEntity[] = rows.map((r: EntityRow) => {
    const act = activity.get(r.uei) || null;
    const { score, tier } = scoreEntity(
      r.certifications || [], r.primary_naics, r.naics_codes || [],
      params.naics, params.setAside, act,
    );
    const sizeStatus = sizeStatusForNaics(r.naics_small_business, params.naics);
    return {
      uei: r.uei,
      legalBusinessName: r.legal_business_name,
      cageCode: r.cage_code,
      city: r.physical_city,
      samUrl: r.sam_url,
      pocName: pickPocName(r.points_of_contact),
      state: r.physical_state,
      certifications: r.certifications || [],
      primaryNaics: r.primary_naics,
      registrationStatus: r.registration_status,
      registrationExpiry: r.registration_expiry,
      totalObligated: act?.totalObligated ?? 0,
      awardCount: act?.awardCount ?? 0,
      distinctAgencyCount: act?.distinctAgencyCount ?? 0,
      lastActionDate: act?.lastActionDate ?? null,
      score, tier,
      sizeStatus,
      sizeStatusNaics: sizeStatus ? params.naics : null,
      sizeStatusSource: r.naics_sb_source ?? null,
    };
  });

  // Highest score first — performers surface, Emerging/Registered-Only
  // remain visible below (never hidden).
  scored.sort((a, b) => b.score - a.score);

  const counts: Record<Tier, number> = {
    active_performer: 0, capable: 0, emerging: 0, registered_only: 0,
  };
  for (const s of scored) counts[s.tier]++;

  // marketDepth = the CAPABLE-tier count (active performers + capable), optionally showing emerging as
  // broader context. Emerging = registered aspirants with no proven performance.
  const marketDepth =
    counts.active_performer + counts.capable + (includeEmerging ? counts.emerging : 0);
  // CAPABLE depth = the ONLY basis for the Rule-of-Two headline (Eric/QA FM-03, 2026-07-28). The bug:
  // with include_emerging=true, a market of "200 emerging / 0 capable" gave marketDepth=200 → ruleOfTwoMet
  // =true, i.e. "Rule of Two MET" sitting on ZERO proven performers ("wide but shallow" read as met). The
  // Rule of Two requires ≥2 firms that could ACTUALLY perform at a fair price — emerging registrants don't
  // qualify. So the gate uses capableDepth (active + capable ONLY), never emerging.
  const capableDepth = counts.active_performer + counts.capable;

  // ── DEFECT-9A: measurement integrity ──────────────────────────────────────────────
  // Everything above is computed over the SCORED SAMPLE, not the market. The candidate
  // pool is bounded (POOL_TARGET) and, for 377 of 971 NAICS, the eligible population
  // exceeds it — 20,074 for 561720, 56,744 for 541611 — so `capableDepth` has been
  // reporting the depth of an arbitrary DB page while being named like a market property.
  //
  // capableDepth CANNOT be made exhaustive by a SQL COUNT: 75 of scoreEntity()'s 100
  // points come from per-UEI BigQuery award activity (recency 30, wonTargetNaics 20,
  // track record 15, agency breadth 10). Scoring the full population would mean a BQ
  // fetch over 20k+ UEIs per run, reopening the cost incident documented in this file.
  //
  // So the fix is EPISTEMIC, not brute force. The eligible population IS exhaustively
  // countable, and the Rule of Two is a one-sided question:
  //
  //   Finding >=2 capable firms in a sample PROVES existence — conclusive at any coverage.
  //   Finding <2 in a sample proves NOTHING about absence unless coverage is 100%.
  //
  // Mindy may conclusively assert existence from partial observation.
  // Mindy may assert absence only after exhaustive observation.
  // COUNT-ONLY query, built from scratch. Do NOT reuse buildQuery(): it already carries
  // .select(<column list>), and chaining a second .select() onto it does not reset the
  // row semantics — the first live run returned eligible_population 1000 for a market with
  // 20,074 eligible firms. A bounded count is precisely the defect this field exists to
  // remove, so it gets its own unbounded head:true query with identical filters.
  const countQuery = () => {
    let q = sb
      .from('sam_entities')
      .select('uei', { count: 'exact', head: true })
      .contains('naics_codes', [params.naics])
      .eq('registration_status', 'Active')
      .eq('exclusion_flag', false);
    if (params.state) q = q.eq('physical_state', params.state.toUpperCase());
    if (setAsideRaw) {
      // ⚠️ MUST MIRROR the pool query's predicate exactly. If the count and the pool disagree,
      // eligible_population describes a different population than the firms actually returned.
      q = isGeneralSmallBusiness
        ? q.contains('small_business_naics', [params.naics])
        : setAsideRaw === EIGHT_A
          ? q.filter('certification_records', 'cs', currentCertFilter(EIGHT_A))
          : q.contains('certifications', [setAsideRaw]);
    }
    return q;
  };
  const { count: eligibleCount, error: countError } = await countQuery();
  if (countError) {
    // Do NOT swallow this. A failed count previously fell back to pool.length, which is
    // the POOL SIZE — so the tool reported eligible_population 1000 for a 20,074-firm
    // market and coverage 23.1% instead of 1.2%. A fallback that happens to equal the
    // bound is indistinguishable from a real answer: unknown presented as measurement,
    // the exact defect class this field exists to remove.
    console.error('[market-research] eligible-population count failed:', countError.message);
  }
  // null = the count did not run. Keep it null rather than substituting the pool size,
  // so coverage/exhaustiveness cannot be computed from a number we never measured.
  const eligiblePopulation: number | null = eligibleCount ?? null;
  const sampleSize = scored.length;
  // Matching coverage of the eligible population — NOT evaluation/limit coverage.
  // A failed matching census stays unknown; never substitute sampleSize (that
  // would report 50/39,848 as if it were the matching ratio).
  const sampleCoverage: number | null =
    eligiblePopulation !== null && eligiblePopulation > 0 && matchingUeiCount !== null
      ? Math.min(1, matchingUeiCount / eligiblePopulation)
      : eligiblePopulation === 0 ? 1 : null;
  const exhaustive = sampleCoverage !== null && sampleCoverage >= 1;

  // ── DEFECT-10: SIZE-STATUS COVERAGE — a SECOND, independent completeness dimension ──
  //
  // #1323 taught the parser to persist 'E' (SBA size-standard exception). This is the
  // decision layer catching up: 'E' is now in the database, and the Rule-of-Two gate still
  // ignores it.
  //
  // 9A established that a SAMPLED population cannot prove absence. DEFECT-10 showed the
  // sample can be 100% of a population that was itself CONSTRUCTED incompletely. NAICS
  // 541330 returns sample_coverage 1 over an eligible_population of ZERO — and therefore
  // rule_of_two_conclusive TRUE — because all 44,184 of its exception firms are excluded
  // from the small-business pool by construction.
  //
  //   EXHAUSTIVE PROCESSING OF AN INCOMPLETE POPULATION IS NOT EXHAUSTIVE EVIDENCE.
  //
  // A definitive negative now requires BOTH dimensions at 100%:
  //   retrieval/sample coverage  AND  size-status determination coverage
  const sizeCounts = { y: 0, n: 0, exception: 0, unknown: 0 };
  if (isGeneralSmallBusiness) {
    const { data: comp } = await sb
      .from('sam_entities')
      .select('naics_small_business')
      .contains('naics_codes', [params.naics])
      .eq('registration_status', 'Active')
      .eq('exclusion_flag', false)
      .range(0, 4999);
    for (const r of (comp || []) as Array<{ naics_small_business?: Record<string, string> | null }>) {
      const v = r.naics_small_business?.[params.naics];
      if (v === 'Y') sizeCounts.y++;
      else if (v === 'N') sizeCounts.n++;
      else if (v === 'E') sizeCounts.exception++;
      else sizeCounts.unknown++;
    }
  }
  const sizeStatusTotal = sizeCounts.y + sizeCounts.n + sizeCounts.exception + sizeCounts.unknown;
  // Determined = Y or N only. 'E' and unknown are NOT determinations.
  const sizeStatusCoverage = sizeStatusTotal > 0
    ? (sizeCounts.y + sizeCounts.n) / sizeStatusTotal : 1;
  const unresolvedExceptions = sizeCounts.exception > 0;

  const ruleOfTwoDetermination: 'met' | 'not_met' | 'undetermined' =
    capableDepth >= 2 ? 'met'   // existence proven; neither sampling nor classification undoes it
    // DEFECT-10: 'not_met' needs BOTH completeness dimensions. An unresolved 'E' firm may
    // qualify under its applicable SBA exception, so absence is not established.
    : (exhaustive && !unresolvedExceptions) ? 'not_met'
    : 'undetermined';
  const ruleOfTwoConclusive = ruleOfTwoDetermination !== 'undetermined';

  // data freshness for the memo
  const { data: freshRow } = await sb
    .from('sam_entities').select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle();

  const caveats = [
    'Counts reflect SAM-registered, active entities as of the sync date below.',
    'Certification source matters: 8(a) and HUBZone come from SAM’s SBA-certified field (vetted). WOSB, SDVOSB, and VOSB are self-certified business types in SAM (not independently vetted here). The rubric weights vetted certifications higher; verify self-certified status before a set-aside determination.',
    'Activity (award history, revenue) is sourced from USASpending. "Registered Only" firms have no relevant award history and are shown separately — they do not count toward the Rule-of-Two depth.',
  ];
  // P0-3: state the field lineage in the output. The earlier false zero was hard to spot
  // precisely BECAUSE the answer did not say which field it came from — a size question was
  // being answered from a socioeconomic-certification column. Say it explicitly now.
  // DEFECT-9A: never let a sampled figure read as a market measurement.
  // DEFECT-10: unresolved exceptions must never read as a negative finding.
  // Placed HERE, after sizeCounts is computed — an earlier edit injected this into
  // buildQuery() where the variables did not yet exist, which threw ReferenceError on every
  // call and made the tool return degraded:true for EVERY market. Typecheck and 3,227 tests
  // passed because the block only executes at runtime.
  if (isGeneralSmallBusiness && unresolvedExceptions) {
    caveats.push(
      `SBA SIZE-STANDARD EXCEPTIONS APPLY: ${sizeCounts.exception.toLocaleString()} firms in ` +
      `NAICS ${params.naics} carry an exception flag in SAM, so the ordinary size standard does ` +
      `not determine their status. Mindy has not yet evaluated those exception-specific ` +
      `standards and therefore CANNOT conclusively determine that fewer than two qualifying ` +
      `small businesses exist. Size-status coverage ${(sizeStatusCoverage * 100).toFixed(1)}% ` +
      `(small ${sizeCounts.y.toLocaleString()} · not-small ${sizeCounts.n.toLocaleString()} · ` +
      `exception ${sizeCounts.exception.toLocaleString()} · not stated ${sizeCounts.unknown.toLocaleString()}).`,
    );
  }
  if (sampleCoverage === null || eligiblePopulation === null || matchingUeiCount === null) {
    caveats.push(
      `COVERAGE UNKNOWN: eligible population and/or matching-UEI census could not be established, ` +
      `so Mindy cannot say what fraction of the market was measured. ` +
      `${sampleSize.toLocaleString()} UEIs were evaluated for family resolution. ` +
      `Treat any shortfall below two capable firms as UNDETERMINED, not as a negative finding.`,
    );
  } else if (sampleCoverage < 1) {
    const familyResolutionPct =
      matchingUeiCount > 0
        ? `${((sampleSize / matchingUeiCount) * 100).toFixed(1)}%`
        : 'n/a';
    caveats.push(
      `SAMPLED, NOT EXHAUSTIVE: matching coverage ` +
      `${matchingUeiCount.toLocaleString()} / ${eligiblePopulation.toLocaleString()} ` +
      `(${(sampleCoverage * 100).toFixed(1)}%). Family-resolution coverage ` +
      `${sampleSize.toLocaleString()} / ${matchingUeiCount.toLocaleString()} ` +
      `(${familyResolutionPct}). These are separate ratios — evaluated UEIs are not the ` +
      `eligible population. ` +
      (ruleOfTwoDetermination === 'met'
        ? `Rule of Two is MET on the evaluated sample — finding at least two capable firms proves they exist, so this ` +
          `existence conclusion holds regardless of coverage; a set-aside memo still needs size evidence and sufficient coverage.`
        : `Rule of Two is UNDETERMINED — fewer than two capable firms were found in the evaluated sample, but because ` +
          `matching and family-resolution coverage are incomplete, Mindy CANNOT conclude that fewer ` +
          `than two exist. This is "not determined", not "not met".`),
    );
  } else {
    caveats.push(
      `EXHAUSTIVE matching coverage: all ${eligiblePopulation.toLocaleString()} eligible firms matched.` +
      (sampleSize < matchingUeiCount
        ? ` Family resolution still evaluated only ${sampleSize.toLocaleString()} of ` +
          `${matchingUeiCount.toLocaleString()} matching UEIs.`
        : '') +
      (ruleOfTwoDetermination === 'not_met'
        ? ` Fewer than two met the capability threshold on the available evidence. This is ` +
          `market-research evidence, not a contracting officer's legal determination.`
        : ''),
    );
  }
  if (isGeneralSmallBusiness) {
    const src = rows.find((r) => r.naics_sb_source)?.naics_sb_source;
    caveats.push(
      `Small-business status is SAM's per-NAICS representation for ${params.naics} ` +
      `(sbaSmallBusiness), SELF-CERTIFIED by the entity in its SAM registration — not an SBA ` +
      `size determination and not a socioeconomic certification. ` +
      (src ? `Source: ${src}. ` : '') +
      `Firms where SAM supplied no status for this NAICS are excluded from the small-business ` +
      `pool; that is "not stated", not "not small".`,
    );
  }

  // If the award-history query DEGRADED (BQ failed, no stale cache), every firm scored
  // registered_only for lack of evidence — not because they lack capability. Asserting
  // "Rule of Two NOT met" on that is a set-aside determination made on a quota error, and
  // the comment above records it happening once already: "EVERY market reported capable: 0".
  //
  // null, not false. A contracting officer reading `false` acts on it; `null` asks again.
  const activityDegraded = lastActivityDegraded;
  if (activityDegraded) {
    caveats.push(
      'Award-history lookup was unavailable, so capability could not be assessed. '
      + 'This is NOT a finding that the market lacks capable firms — re-run before relying on it.'
    );
  }

  return {
    query: params,
    marketDepth,
    capableDepth,                     // active + capable ONLY (the honest Rule-of-Two basis)
    dataDegraded: activityDegraded,
    // DEPRECATED. null = could not assess (#1289). `false` is AMBIGUOUS (DEFECT-9A):
    // "<2 capable found", not "fewer than 2 exist" unless sampleCoverage is 1.
    // Read `ruleOfTwoDetermination`.
    ruleOfTwoMet: activityDegraded ? null : capableDepth >= 2,  // FM-03: gate on CAPABLE depth, never emerging
    // ── DEFECT-9A explicit measurement fields ──
    eligiblePopulation,               // EXHAUSTIVE count over the full filter (SQL)
    matchingUeiCount,                 // eligible known performers — not the evaluation sample
    sampleSize,                       // firms actually scored
    sampleCoverage,                   // matching UEIs / eligible population (not limit)
    capableInSample: capableDepth,    // honestly named: capable among those EVALUATED
    marketDepthInSample: marketDepth,
    // A DEGRADED lookup is also 'undetermined' (#1289): every firm scored
    // registered_only for lack of evidence, so <2 capable is an artefact, not a finding.
    // Same principle as sampling, different cause — both mean "we do not know".
    ruleOfTwoDetermination: activityDegraded ? 'undetermined' : ruleOfTwoDetermination,
    ruleOfTwoConclusive: activityDegraded ? false : ruleOfTwoConclusive,
    // DEFECT-10: size-status composition, so a caller can see WHY a market is undetermined.
    sizeStatusCoverage,
    smallStatusY: sizeCounts.y,
    smallStatusN: sizeCounts.n,
    smallStatusException: sizeCounts.exception,
    smallStatusUnknown: sizeCounts.unknown,
    counts,
    registeredOnlyCount: counts.registered_only,
    businesses: scored,
    dataAsOf: freshRow?.synced_at || new Date().toISOString(),
    caveats,
  };
}
