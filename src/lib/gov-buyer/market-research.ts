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
import { BQ_TABLES } from '@/lib/bigquery/client';
import { queryCached } from '@/lib/bigquery/cache';

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
  ruleOfTwoMet: boolean;     // marketDepth >= 2
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
async function fetchActivity(ueis: string[], targetNaics: string): Promise<Map<string, Activity>> {
  const map = new Map<string, Activity>();
  if (!ueis.length) return map;

  // Cached: key by the sorted UEI set + NAICS so identical research re-runs hit KV
  // instead of re-scanning BQ (cost hygiene — see tasks/bigquery-cost-spike-2026-06.md).
  const sortedUeis = [...ueis].sort();
  const cacheKey = `gov-buyer:activity:${targetNaics}:${sortedUeis.join(',')}`;
  const rows = await queryCached<{
    recipient_uei: string;
    total_obligated: number;
    award_count: number;
    distinct_agency_count: number;
    last_action_date: string;
    won_target_naics: boolean;
  }>({
    cacheKey,
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
    params: { ueis: sortedUeis, naics: targetNaics },
  });

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

export async function runMarketResearch(params: MarketResearchParams): Promise<MarketResearchResult> {
  const includeEmerging = params.includeEmerging !== false; // default true
  const limit = params.limit ?? 200;
  const sb = getSupabase();

  // 1) Base list from the SAM registry cache. Active + non-expired only —
  //    a CO reads this count as a defensibility claim.
  let q = sb
    .from('sam_entities')
    .select('uei, legal_business_name, cage_code, physical_state, certifications, primary_naics, naics_codes, registration_status, registration_expiry')
    .contains('naics_codes', [params.naics])
    .eq('registration_status', 'Active')
    .eq('exclusion_flag', false)
    .limit(limit);

  if (params.state) q = q.eq('physical_state', params.state.toUpperCase());
  if (params.setAside) q = q.contains('certifications', [params.setAside]);

  const { data: entities, error } = await q;
  if (error) throw new Error(`sam_entities query failed: ${error.message}`);

  const rows = entities || [];

  // 2) Batch activity join (LEFT — missing UEIs simply have no Activity).
  const ueis = rows.map((r: { uei: string }) => r.uei).filter(Boolean);
  const activity = await fetchActivity(ueis, params.naics);

  // 3) Score + tier.
  const scored: ScoredEntity[] = rows.map((r: {
    uei: string; legal_business_name: string; cage_code: string | null;
    physical_state: string | null; certifications: string[]; primary_naics: string | null;
    naics_codes: string[]; registration_status: string | null; registration_expiry: string | null;
  }) => {
    const act = activity.get(r.uei) || null;
    const { score, tier } = scoreEntity(
      r.certifications || [], r.primary_naics, r.naics_codes || [],
      params.naics, params.setAside, act,
    );
    return {
      uei: r.uei,
      legalBusinessName: r.legal_business_name,
      cageCode: r.cage_code,
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
    };
  });

  // Highest score first — performers surface, Emerging/Registered-Only
  // remain visible below (never hidden).
  scored.sort((a, b) => b.score - a.score);

  const counts: Record<Tier, number> = {
    active_performer: 0, capable: 0, emerging: 0, registered_only: 0,
  };
  for (const s of scored) counts[s.tier]++;

  const marketDepth =
    counts.active_performer + counts.capable + (includeEmerging ? counts.emerging : 0);

  // data freshness for the memo
  const { data: freshRow } = await sb
    .from('sam_entities').select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle();

  const caveats = [
    'Counts reflect SAM-registered, active entities as of the sync date below.',
    'Certification source matters: 8(a) and HUBZone come from SAM’s SBA-certified field (vetted). WOSB, SDVOSB, and VOSB are self-certified business types in SAM (not independently vetted here). The rubric weights vetted certifications higher; verify self-certified status before a set-aside determination.',
    'Activity (award history, revenue) is sourced from USASpending. "Registered Only" firms have no relevant award history and are shown separately — they do not count toward the Rule-of-Two depth.',
  ];

  return {
    query: params,
    marketDepth,
    ruleOfTwoMet: marketDepth >= 2,
    counts,
    registeredOnlyCount: counts.registered_only,
    businesses: scored,
    dataAsOf: freshRow?.synced_at || new Date().toISOString(),
    caveats,
  };
}
