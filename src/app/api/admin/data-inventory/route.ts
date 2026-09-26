/**
 * Mindy Data Core — the ADMIN TRUTH SURFACE for what Mindy holds.
 *
 * GET /api/admin/data-inventory?password=$ADMIN_PASSWORD
 *
 * This route MEASURES (live head-counts, control-plane rows, cron runs). What the
 * measurements mean — kinds, the unique-record headline, freshness states, upstream
 * publisher counting — lives in the pure model `src/lib/data-core/inventory-model.ts`,
 * where it is unit-tested.
 *
 * Rewritten 2026-09-26 against tasks/data-inventory-audit-2026-09-26.md. The page it
 * replaced had exact arithmetic over real counts and was still wrong about what they
 * meant: it counted SAM rows twice (once as "semantic-indexed", including 55,328
 * empty-array sentinels), counted recompete rows the product never serves, called
 * vendor POCs "decision makers", presented 1993-2000 GAO testimonies as current
 * exclusive intelligence, omitted the living legislation and GAO corpora, and listed
 * IG / CRS / NDAA as feeds that do not exist.
 *
 * RULES THIS FILE KEEPS:
 *   - a count that could not be measured is null ("unmeasured"), never 0;
 *   - the control plane's own counts are shown as DEBT when they disagree, never adopted;
 *   - no hand-typed vanity metric (formats / agencies / LOC / commits) — they went stale
 *     (3,013 commits displayed against 4,346) and could not be derived at request time.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCountClient } from '@/lib/supabase/server-clients';
import { bqQuery, BQ_TABLES } from '@/lib/bigquery/client';
import { FORECAST_SOURCE_AGENCY_CODES } from '@/lib/forecasts/agency-identity';
import { CONTACT_KIND_GOVERNMENT, CONTACT_KIND_VENDOR } from '@/lib/gov-contacts/contact-kind';
import {
  computeTotals,
  countUpstreamPublishers,
  inventoryViolations,
  mapSourceState,
  registryDebt,
  scheduleTruth,
  STATIC_FILE_AS_OF,
  UPSTREAM_PUBLISHERS,
  summarizeStates,
  timestampState,
  worstState,
  type Freshness,
  type InstanceFreshness,
  type InventoryDataset,
  type ScheduleTruth,
  type ScheduledRun,
} from '@/lib/data-core/inventory-model';
import painPointsData from '@/data/agency-pain-points.json';
import budgetData from '@/data/agency-budget-data.json';

export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Legislative source types held in institute_sources. */
const LEGISLATIVE_TYPES = ['introduced_bill', 'enacted_law', 'committee_report', 'appropriation', 'ndaa_provision'] as const;

/** Every cron job a dataset's freshness reads. One query fetches their latest runs. */
const CRON_JOBS = {
  sam: ['sync-sam-opportunities-full', 'sync-sam-opportunities-delta', 'sync-sam-opportunities-resume'],
  embed: ['embed-sow-corpus'],
  decisionMakers: ['sync-decision-makers'],
  recompetes: ['sync-recompete-contracts'],
  forecasts: ['sync-forecasts', 'doj-forecast-sync', 'nasa-forecast-sync', 'hhs-forecast-sync'],
  events: ['extract-sam-events'],
  dibbs: ['sync-dibbs'],
  grants: ['sync-grants'],
  research: ['snapshot-multisite-nih', 'snapshot-multisite-darpa', 'snapshot-multisite-nsf'],
  gao: ['institute-gao-sync'],
  legislation: ['institute-legislation-sync'],
  dodSbir: ['sync-dod-sbir'],
  usaspendingAwards: ['sync-usaspending-awards'],
  samEntities: ['sync-gov-buyer-data'],
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

/** Exact head-count. null on any error — unknown, never zero (Bug Prevention Rule #11). */
async function headCount(sb: Sb, table: string, filter?: (q: Sb) => Sb): Promise<number | null> {
  try {
    let q = sb.from(table).select('*', { count: 'exact', head: true });
    if (filter) q = filter(q);
    const { count, error } = await q;
    if (error) return null;
    return count ?? null;
  } catch {
    return null;
  }
}

/** Newest (or oldest) non-null value of one column. null when unmeasurable. */
async function edgeValue(
  sb: Sb, table: string, col: string, opts: { asc?: boolean; filter?: (q: Sb) => Sb } = {},
): Promise<string | null> {
  try {
    let q = sb.from(table).select(col).not(col, 'is', null);
    if (opts.filter) q = opts.filter(q);
    const { data, error } = await q.order(col, { ascending: !!opts.asc }).limit(1);
    if (error) return null;
    const v = data?.[0]?.[col];
    return v == null ? null : String(v);
  } catch {
    return null;
  }
}

async function bqCount(table: string): Promise<number | null> {
  try {
    const rows = await bqQuery<{ n: number }>({ query: `SELECT COUNT(*) AS n FROM ${table}` });
    const n = rows?.[0]?.n;
    return n == null ? null : Number(n);
  } catch {
    return null;
  }
}

/** Pain points + priorities + prose attributions from the curated static JSON. */
function staticClaims() {
  const ag = ((painPointsData as { agencies?: Record<string, { painPoints?: unknown[]; priorities?: unknown[] }> })
    .agencies) || {};
  const painPoints: string[] = [];
  const priorities: string[] = [];
  for (const a of Object.values(ag)) {
    for (const p of a?.painPoints || []) painPoints.push(typeof p === 'string' ? p : JSON.stringify(p));
    for (const p of a?.priorities || []) priorities.push(typeof p === 'string' ? p : JSON.stringify(p));
  }
  const mentions = (arr: string[], re: RegExp) => arr.filter((s) => re.test(s)).length;
  const patterns = {
    gao: /\bGAO\b/,
    ig: /\b(OIG|IG|Inspector General)\b/,
    crs: /\bCRS\b|Congressional Research/,
    ndaa: /NDAA|National Defense Authorization/,
    url: /https?:\/\//,
  };
  return {
    agencies: Object.keys(ag).length,
    painPoints: painPoints.length,
    priorities: priorities.length,
    pp: Object.fromEntries(Object.entries(patterns).map(([k, re]) => [k, mentions(painPoints, re)])) as Record<keyof typeof patterns, number>,
    pr: Object.fromEntries(Object.entries(patterns).map(([k, re]) => [k, mentions(priorities, re)])) as Record<keyof typeof patterns, number>,
  };
}

export async function GET(request: NextRequest) {
  if (!ADMIN_PASSWORD || request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
  // Head-counts only — the replica 400s every HEAD, so this must be the primary.
  const sb = getCountClient();
  const now = new Date();
  const hc = (t: string, f?: (q: Sb) => Sb) => headCount(sb, t, f);

  // ── Measure (all best-effort, all in parallel) ────────────────────────────────
  const allCronJobs = Object.values(CRON_JOBS).flat() as string[];
  const [
    counts, forecastByAgency, edges, legislativeRows, controlPlane, cronRows, runRows, bq,
  ] = await Promise.all([
    // counts
    (async () => {
      const entries: Array<[string, Promise<number | null>]> = [
        ['samTotal', hc('sam_opportunities')],
        ['samActive', hc('sam_opportunities', (q) => q.eq('active', true))],
        ['embSow', hc('sam_opportunities', (q) => q.eq('embedding_source', 'sow'))],
        ['embDesc', hc('sam_opportunities', (q) => q.eq('embedding_source', 'description'))],
        ['embNone', hc('sam_opportunities', (q) => q.eq('embedding_source', 'none'))],
        ['embPending', hc('sam_opportunities', (q) => q.is('sow_embedding', null))],
        ['contactsTotal', hc('federal_contacts')],
        ['contactsGov', hc('federal_contacts', (q) => q.eq('contact_kind', CONTACT_KIND_GOVERNMENT))],
        ['contactsVendor', hc('federal_contacts', (q) => q.eq('contact_kind', CONTACT_KIND_VENDOR))],
        ['contactsUnclassified', hc('federal_contacts', (q) => q.is('contact_kind', null))],
        ['rcTotal', hc('recompete_opportunities')],
        ['rcServed', hc('recompete_opportunities', (q) => q.is('quality_flag', null))],
        ['rcExpired', hc('recompete_opportunities', (q) => q.eq('quality_flag', 'expired'))],
        ['rcSynthetic', hc('recompete_opportunities', (q) => q.eq('quality_flag', 'grouped_synthetic'))],
        ['rcPlaceholder', hc('recompete_opportunities', (q) => q.eq('quality_flag', 'placeholder_value'))],
        ['rcSentinel', hc('recompete_opportunities', (q) => q.eq('quality_flag', 'sentinel_value'))],
        ['rcImplausible', hc('recompete_opportunities', (q) => q.eq('quality_flag', 'implausible_value'))],
        ['forecasts', hc('agency_forecasts')],
        ['events', hc('sam_events')],
        ['dodaac', hc('dodaac_directory')],
        ['dibbs', hc('dibbs_rfqs')],
        ['grants', hc('grants_cache')],
        ['grantsPosted', hc('grants_cache', (q) => q.eq('status', 'posted'))],
        ['grantsForecasted', hc('grants_cache', (q) => q.eq('status', 'forecasted'))],
        ['research', hc('aggregated_opportunities')],
        ['resNih', hc('aggregated_opportunities', (q) => q.eq('source', 'nih_reporter'))],
        ['resDarpa', hc('aggregated_opportunities', (q) => q.eq('source', 'darpa_baa'))],
        ['resGrantsGov', hc('aggregated_opportunities', (q) => q.eq('source', 'grants_gov'))],
        ['resNsf', hc('aggregated_opportunities', (q) => q.eq('source', 'nsf_sbir'))],
        ['resTypeGrant', hc('aggregated_opportunities', (q) => q.eq('opportunity_type', 'grant'))],
        ['resTypeSbir', hc('aggregated_opportunities', (q) => q.eq('opportunity_type', 'sbir_sttr'))],
        ['resTypeBaa', hc('aggregated_opportunities', (q) => q.eq('opportunity_type', 'baa'))],
        ['ragDocs', hc('mindy_rag_documents')],
        ['ragChunks', hc('mindy_rag_chunks')],
        ['gaoLiving', hc('institute_sources', (q) => q.eq('source_type', 'gao_report'))],
        ['gaoLivingWithUrl', hc('institute_sources', (q) => q.eq('source_type', 'gao_report').not('source_url', 'is', null))],
        ['igDocs', hc('institute_sources', (q) => q.eq('source_type', 'ig_report'))],
        ['crsDocs', hc('institute_sources', (q) => q.eq('source_type', 'crs_report'))],
        ['budgetJustDocs', hc('institute_sources', (q) => q.eq('source_type', 'budget_justification'))],
        ['strategicPlanDocs', hc('institute_sources', (q) => q.eq('source_type', 'strategic_plan'))],
        ['sourcedClaims', hc('agency_pain_points_db')],
        ['sourcedClaimsBacked', hc('agency_pain_points_db', (q) => q.not('institute_source_ids', 'is', null))],
        ['intelChanges', hc('intelligence_changes')],
        ['histGao', hc('agency_intelligence', (q) => q.eq('intelligence_type', 'gao_high_risk'))],
        ['contractPatterns', hc('agency_intelligence', (q) => q.eq('intelligence_type', 'contract_pattern'))],
        ['agencyIntelTotal', hc('agency_intelligence')],
        ['samEntities', hc('sam_entities')],
        ['dodSbir', hc('dod_sbir_topics')],
        ['usaspendingAwards', hc('usaspending_awards')],
      ];
      const vals = await Promise.all(entries.map(([, p]) => p));
      return Object.fromEntries(entries.map(([k], i) => [k, vals[i]])) as Record<string, number | null>;
    })(),
    // forecasts per issuing agency (closed vocabulary → head-counts, no row paging)
    Promise.all(FORECAST_SOURCE_AGENCY_CODES.map(async (code) =>
      [code, await hc('agency_forecasts', (q) => q.eq('source_agency', code))] as const)),
    // data clocks
    (async () => {
      const e: Array<[string, Promise<string | null>]> = [
        ['sam', edgeValue(sb, 'sam_opportunities', 'created_at')],
        ['contacts', edgeValue(sb, 'federal_contacts', 'updated_at')],
        ['recompetes', edgeValue(sb, 'recompete_opportunities', 'last_synced_at')],
        ['forecasts', edgeValue(sb, 'agency_forecasts', 'updated_at')],
        ['events', edgeValue(sb, 'sam_events', 'extracted_at')],
        ['dibbs', edgeValue(sb, 'dibbs_rfqs', 'synced_at')],
        ['grants', edgeValue(sb, 'grants_cache', 'synced_at')],
        ['dodaac', edgeValue(sb, 'dodaac_directory', 'updated_at')],
        ['resNih', edgeValue(sb, 'aggregated_opportunities', 'updated_at', { filter: (q) => q.eq('source', 'nih_reporter') })],
        ['resDarpa', edgeValue(sb, 'aggregated_opportunities', 'updated_at', { filter: (q) => q.eq('source', 'darpa_baa') })],
        ['resGrantsGov', edgeValue(sb, 'aggregated_opportunities', 'updated_at', { filter: (q) => q.eq('source', 'grants_gov') })],
        ['ragIngested', edgeValue(sb, 'mindy_rag_documents', 'ingested_at')],
        ['gaoPubMin', edgeValue(sb, 'institute_sources', 'publication_date', { asc: true, filter: (q) => q.eq('source_type', 'gao_report') })],
        ['gaoPubMax', edgeValue(sb, 'institute_sources', 'publication_date', { filter: (q) => q.eq('source_type', 'gao_report') })],
        ['gaoDiscovered', edgeValue(sb, 'institute_sources', 'discovered_at', { filter: (q) => q.eq('source_type', 'gao_report') })],
        ['claimsEvidence', edgeValue(sb, 'agency_pain_points_db', 'last_evidence_at')],
        ['samEntities', edgeValue(sb, 'sam_entities', 'synced_at')],
        ['usaspendingAwards', edgeValue(sb, 'usaspending_awards', 'synced_at')],
        ['histGaoMin', edgeValue(sb, 'agency_intelligence', 'publication_date', { asc: true, filter: (q) => q.eq('intelligence_type', 'gao_high_risk') })],
        ['histGaoMax', edgeValue(sb, 'agency_intelligence', 'publication_date', { filter: (q) => q.eq('intelligence_type', 'gao_high_risk') })],
      ];
      const vals = await Promise.all(e.map(([, p]) => p));
      return Object.fromEntries(e.map(([k], i) => [k, vals[i]])) as Record<string, string | null>;
    })(),
    // the whole legislative corpus is small (tens of rows) — read it to derive FY coverage
    (async () => {
      try {
        const { data, error } = await sb.from('institute_sources')
          .select('source_type, document_number, publication_date, raw')
          .in('source_type', LEGISLATIVE_TYPES as unknown as string[])
          .limit(2000);
        return error ? null : (data as Array<{ source_type: string; document_number: string; publication_date: string | null; raw: Record<string, unknown> | null }>);
      } catch { return null; }
    })(),
    // control plane
    (async () => {
      try {
        const [ds, dsi] = await Promise.all([
          sb.from('data_sources').select('key, record_count, last_built'),
          sb.from('data_source_instances').select('dataset_key, source_key, source_state, intervention_state, held_population, last_data_advance, last_poll'),
        ]);
        return {
          sources: ds.error ? null : (ds.data as Array<{ key: string; record_count: number | null; last_built: string | null }>),
          instances: dsi.error ? null : (dsi.data as Array<{ dataset_key: string; source_key: string; source_state: string | null; intervention_state: string | null; held_population: number | null; last_data_advance: string | null; last_poll: string | null }>),
        };
      } catch { return { sources: null, instances: null }; }
    })(),
    (async () => {
      try {
        const { data, error } = await sb.from('cron_jobs').select('job_name, cron_expr, enabled').in('job_name', allCronJobs);
        return error ? null : (data as Array<{ job_name: string; cron_expr: string | null; enabled: boolean | string | null }>);
      } catch { return null; }
    })(),
    (async () => {
      try {
        const { data, error } = await sb.from('cron_job_runs')
          .select('job_name, started_at, status, http_status')
          .in('job_name', allCronJobs)
          .gte('started_at', new Date(now.getTime() - 21 * 86_400_000).toISOString())
          .order('started_at', { ascending: false })
          .limit(1000);
        return error ? null : (data as Array<{ job_name: string; started_at: string; status: string | null; http_status: number | null }>);
      } catch { return null; }
    })(),
    Promise.all([bqCount(BQ_TABLES.recipientsRollup), bqCount(BQ_TABLES.recipients), bqCount(BQ_TABLES.awards)]),
  ]);
  const c = counts;
  const e = edges;
  const [contractorCompanies, contractorUeis, bqAwards] = bq;
  const bqAwardsBuilt = controlPlane.sources?.find((s) => s.key === 'bq_awards')?.last_built ?? null;

  // ── Control-plane helpers ─────────────────────────────────────────────────────
  const instances = controlPlane.instances ?? [];
  const instanceFreshness = (datasetKey: string): InstanceFreshness[] =>
    instances.filter((i) => i.dataset_key === datasetKey).map((i) => ({
      sourceKey: i.source_key,
      state: mapSourceState(i.source_state),
      sourceState: i.source_state,
      interventionState: i.intervention_state,
      heldPopulation: i.held_population,
      lastDataAdvance: i.last_data_advance,
    }));
  const instance = (sourceKey: string) => instances.find((i) => i.source_key === sourceKey) ?? null;

  const latestRun = (job: string): ScheduledRun | null => {
    const r = (runRows ?? []).find((x) => x.job_name === job);
    return r ? { at: r.started_at, status: r.status, httpStatus: r.http_status } : null;
  };
  const schedule = (job: string, lastPoll: string | null = null): ScheduleTruth => {
    const row = (cronRows ?? []).find((x) => x.job_name === job);
    return scheduleTruth({
      job,
      cron: row?.cron_expr ?? null,
      enabled: row ? row.enabled === true || row.enabled === 'true' : null,
      lastScheduledRun: latestRun(job),
      lastPoll,
      now,
    });
  };
  const schedules = (jobs: readonly string[]) => jobs.map((j) => schedule(j));

  /** Instance state when the control plane measures it; otherwise the data clock. */
  const fresh = (o: {
    instanceKey?: string;
    asOf: string | null;
    cadenceHours: number | null;
    basis: string;
    jobs?: readonly string[];
    detail?: string;
  }): Freshness => {
    const inst = o.instanceKey ? instance(o.instanceKey) : null;
    const instState = inst ? mapSourceState(inst.source_state) : null;
    const useInstance = instState != null && instState !== 'UNKNOWN';
    return {
      state: useInstance ? instState! : timestampState(o.asOf, o.cadenceHours, now),
      asOf: o.asOf,
      basis: useInstance ? `control plane ${o.instanceKey} (${inst!.source_state}); data clock ${o.basis}` : o.basis,
      detail: o.detail,
      schedules: o.jobs ? schedules(o.jobs) : undefined,
    };
  };

  // ── Derived facts ─────────────────────────────────────────────────────────────
  const sc = staticClaims();
  const forecastIssuers = forecastByAgency.filter(([, n]) => (n ?? 0) > 0).map(([code]) => code as string);
  const forecastInstances = instanceFreshness('forecast_intelligence');
  const researchInstances = instanceFreshness('research_multisite');

  const embIndexed = c.embSow == null || c.embDesc == null ? null : c.embSow + c.embDesc;
  const rcSyntheticKnown = c.rcSynthetic ?? null;
  const rcUnderlying = c.rcTotal == null || rcSyntheticKnown == null ? null : c.rcTotal - rcSyntheticKnown;
  const rcOtherFlag = [c.rcTotal, c.rcServed, c.rcExpired, c.rcSynthetic, c.rcPlaceholder, c.rcSentinel, c.rcImplausible].some((x) => x == null)
    ? null
    : c.rcTotal! - c.rcServed! - c.rcExpired! - c.rcSynthetic! - c.rcPlaceholder! - c.rcSentinel! - c.rcImplausible!;

  // Legislation breakdown from the rows themselves.
  const leg = legislativeRows ?? [];
  const legBy = (t: string) => (legislativeRows ? leg.filter((r) => r.source_type === t).length : null);
  const legErrata = legislativeRows ? leg.filter((r) => /ERRATA/i.test(r.document_number)).length : null;
  const legFys = legislativeRows
    ? [...new Set(leg.map((r) => Number((r.raw as { fiscalYear?: unknown } | null)?.fiscalYear)).filter((n) => Number.isFinite(n) && n > 2000))].sort()
    : [];
  const legPubDates = leg.map((r) => r.publication_date).filter((d): d is string => !!d).sort();
  const legInst = instance('institute_legislation');
  const legSchedule = schedule('institute-legislation-sync', legInst?.last_poll ?? null);

  const gaoInst = instance('institute_gao');
  const budgetAsOf = (budgetData as { lastUpdated?: string }).lastUpdated ?? null;
  const budgetAgencies = Object.keys((budgetData as { agencies?: Record<string, unknown> }).agencies || {}).length;
  const budgetFys = (budgetData as { fiscalYears?: number[] }).fiscalYears ?? [];
  const painAsOf = STATIC_FILE_AS_OF['src/data/agency-pain-points.json'];

  const researchUpstreams = [
    (c.resNih ?? 0) > 0 ? 'nih_reporter' : null,
    (c.resDarpa ?? 0) > 0 ? 'darpa' : null,
    (c.resGrantsGov ?? 0) > 0 ? 'grants_gov' : null,
    (c.resNsf ?? 0) > 0 ? 'nsf_sbir' : null,
  ].filter((x): x is string => !!x);

  const attribution = (label: string, claims: number, livingRecords: number | null) => ({ label, claims, livingRecords });

  // ── The inventory ─────────────────────────────────────────────────────────────
  const datasets: InventoryDataset[] = [
    // ─── OWNED SOURCE CORPORA ───────────────────────────────────────────────────
    {
      key: 'sam_opps', label: 'SAM.gov opportunities', kind: 'source_corpus',
      stored: c.samTotal, unit: 'notices',
      served: { count: c.samActive, label: 'active / currently open', excluded: [
        { label: 'archived / closed (kept as history — lookup, recompete + incumbent evidence)', count: c.samTotal == null || c.samActive == null ? null : c.samTotal - c.samActive },
      ] },
      uniqueContribution: c.samTotal,
      freshness: fresh({ instanceKey: 'sam_opportunities_sam_gov', asOf: e.sam, cadenceHours: 24, basis: 'MAX(sam_opportunities.created_at)', jobs: CRON_JOBS.sam }),
      surface: { state: 'customer_readable', tools: ['find_opportunities', 'search_sam_opportunities', 'lookup_solicitation'], app: ['Opportunity Map', 'Daily alerts'] },
      upstreams: ['sam_gov'], provenance: 'Mirror of the SAM.gov Opportunities API — active AND historical notices. Only the active slice is "open".',
    },
    {
      key: 'bq_awards', label: 'Federal award transactions (USASpending warehouse)', kind: 'source_corpus',
      stored: bqAwards, unit: 'award transactions',
      uniqueContribution: bqAwards,
      freshness: fresh({ asOf: bqAwardsBuilt, cadenceHours: 24 * 7, basis: 'data_sources.bq_awards.last_built (weekly ingest; recency guarded by verify:oracles freshness)' }),
      surface: { state: 'customer_readable', tools: ['get_contractor_award_history', 'find_capable_contractors'], app: ['/awards pages', 'Contractor pages'] },
      upstreams: ['usaspending'], provenance: 'USASpending contract award TRANSACTIONS in BigQuery — transaction grain (each modification is a row, keyed by txn_id), so this is not a count of distinct awards. Contractor companies and the buying-office directory are derived from it.',
    },
    {
      key: 'sam_entities', label: 'SAM entity registrations', kind: 'source_corpus',
      stored: c.samEntities, unit: 'entity records',
      uniqueContribution: c.samEntities,
      freshness: fresh({ asOf: e.samEntities, cadenceHours: null, basis: 'MAX(sam_entities.synced_at) — sync-gov-buyer-data has no registered schedule', jobs: CRON_JOBS.samEntities }),
      surface: { state: 'customer_readable', tools: ['lookup_sam_entity'], note: 'local-first entity lookup; live SAM only for gaps' },
      upstreams: ['sam_gov'], provenance: 'SAM.gov entity export (UEI, CAGE, NAICS, certifications). Overlaps the award-derived contractor companies — different record type, not deduplicated.',
    },
    {
      key: 'usaspending_awards_mirror', label: 'USASpending awards mirror (legacy, Supabase)', kind: 'source_corpus',
      stored: c.usaspendingAwards, unit: 'award rows',
      uniqueContribution: 0,
      uniqueNote: 'excluded from the headline — a small subset of the award warehouse above',
      freshness: fresh({ asOf: e.usaspendingAwards, cadenceHours: 24 * 7, basis: 'MAX(usaspending_awards.synced_at)', jobs: CRON_JOBS.usaspendingAwards }),
      surface: { state: 'customer_readable', tools: ['get_contractor_award_history'], note: 'name-search sales-history path reads this mirror' },
      upstreams: ['usaspending'], provenance: 'Weekly USASpending API pull into Supabase. The same award population as the BigQuery warehouse.',
    },
    {
      key: 'forecasts', label: 'Agency procurement forecasts', kind: 'source_corpus',
      stored: c.forecasts, unit: 'forecast records',
      breakdown: [
        ...forecastByAgency.filter(([, n]) => (n ?? 0) > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
          .map(([code, n]) => ({ label: code as string, count: n })),
        ...(() => {
          const known = forecastByAgency.reduce((s, [, n]) => s + (n ?? 0), 0);
          const rest = c.forecasts == null ? null : c.forecasts - known;
          return rest ? [{ label: 'outside the closed source_agency vocabulary', count: rest }] : [];
        })(),
      ],
      uniqueContribution: c.forecasts,
      freshness: {
        state: forecastInstances.length ? worstState(forecastInstances.map((i) => i.state)) : timestampState(e.forecasts, 24, now),
        asOf: e.forecasts,
        basis: `worst of ${forecastInstances.length} registered feeds (data_source_instances); aggregate clock MAX(agency_forecasts.updated_at)`,
        detail: `${forecastIssuers.length} issuing agencies hold rows; ${forecastInstances.length} have a registered feed in the control plane (${summarizeStates(forecastInstances.map((i) => i.state))}). Agencies without a registered feed are not health-monitored.`,
        instances: forecastInstances,
        schedules: schedules(CRON_JOBS.forecasts),
      },
      surface: { state: 'customer_readable', tools: ['get_agency_forecasts', 'find_opportunities'], app: ['Forecasts panel', 'Opportunity Map'] },
      upstreams: [], // issuers are counted from the measured source_agency values
      provenance: 'Scraped / imported from agency forecast portals (own sites, GSA Acquisition Gateway, spreadsheets, PDFs), unified to one schema.',
    },
    {
      key: 'recompetes', label: 'Expiring contracts (recompetes)', kind: 'source_corpus',
      stored: c.rcTotal, unit: 'contract rows',
      served: { count: c.rcServed, label: 'served / eligible (quality_flag IS NULL)', excluded: [
        { label: 'expired', count: c.rcExpired },
        { label: 'grouped_synthetic (legacy Recipient+Agency+NAICS groups — not contracts)', count: c.rcSynthetic },
        { label: 'placeholder_value', count: c.rcPlaceholder },
        { label: 'sentinel_value', count: c.rcSentinel },
        { label: 'implausible_value', count: c.rcImplausible },
        ...(rcOtherFlag ? [{ label: 'other quality flags', count: rcOtherFlag }] : []),
      ] },
      uniqueContribution: rcUnderlying,
      uniqueNote: 'stored minus grouped_synthetic rows, which are aggregates of other contracts rather than contracts',
      freshness: fresh({ asOf: e.recompetes, cadenceHours: 1, basis: 'MAX(recompete_opportunities.last_synced_at)', jobs: CRON_JOBS.recompetes }),
      surface: { state: 'customer_readable', tools: ['get_expiring_contracts', 'find_opportunities'], app: ['Recompetes panel', 'Briefings'] },
      upstreams: ['usaspending'], provenance: 'Per-contract rows from the USASpending Awards API. Only unflagged rows reach customers.',
      note: 'Contracts overlap the contractor population\'s award history (same USASpending population) — different record types, not deduplicated.',
    },
    {
      key: 'dibbs', label: 'DLA small-buy RFQs (DIBBS)', kind: 'source_corpus',
      stored: c.dibbs, unit: 'RFQs',
      uniqueContribution: c.dibbs,
      freshness: fresh({ instanceKey: 'dibbs_dla_flat_files', asOf: e.dibbs, cadenceHours: 24, basis: 'MAX(dibbs_rfqs.synced_at)', jobs: CRON_JOBS.dibbs,
        detail: 'Stored total, not currently-open: dibbs_rfqs.status is not populated, so an open/closed split cannot be measured.' }),
      surface: { state: 'customer_readable', tools: [], app: ['DIBBS panel', 'Opportunity Map', 'Opportunity detail'] },
      upstreams: ['dla_dibbs'], provenance: 'DLA DIBBS solicitations mirrored nightly — defense buys below the SAM.gov posting threshold.',
    },
    {
      key: 'grants', label: 'Federal grants', kind: 'source_corpus',
      stored: c.grants, unit: 'grant opportunities',
      breakdown: [{ label: 'posted', count: c.grantsPosted }, { label: 'forecasted', count: c.grantsForecasted }],
      uniqueContribution: c.grants,
      freshness: fresh({ instanceKey: 'grants_gov_api', asOf: e.grants, cadenceHours: 24, basis: 'MAX(grants_cache.synced_at)', jobs: CRON_JOBS.grants }),
      surface: { state: 'customer_readable', tools: ['search_grants'], app: ['Opportunity Map grants layer'] },
      upstreams: ['grants_gov'], provenance: 'Grants.gov mirrored nightly into grants_cache.',
      note: 'The research corpus below also holds a small Grants.gov slice from a different producer. Not deduplicated.',
    },
    {
      key: 'research_funding', label: 'Research & Lab Funding Opportunities', kind: 'source_corpus',
      stored: c.research, unit: 'opportunities',
      breakdown: [
        { label: 'NIH RePORTER', count: c.resNih, note: e.resNih ? `last advanced ${e.resNih.slice(0, 10)}` : undefined },
        { label: 'Grants.gov research slice', count: c.resGrantsGov, note: e.resGrantsGov ? `last advanced ${e.resGrantsGov.slice(0, 10)}` : undefined },
        { label: 'DARPA BAA', count: c.resDarpa, note: e.resDarpa ? `last advanced ${e.resDarpa.slice(0, 10)}` : undefined },
        { label: 'NSF SBIR/STTR', count: c.resNsf, note: (c.resNsf ?? 0) === 0 ? 'contributes 0 rows — never written' : undefined },
        { label: 'view: SBIR / STTR (opportunity_type) — what search_sbir reads', count: c.resTypeSbir, note: 'subset of the above, not additive' },
        { label: 'view: grant-type', count: c.resTypeGrant, note: 'subset, not additive' },
        { label: 'view: BAA', count: c.resTypeBaa, note: 'subset, not additive' },
      ],
      uniqueContribution: c.research,
      freshness: {
        state: researchInstances.length ? worstState(researchInstances.map((i) => i.state)) : timestampState(e.resNih, 24, now),
        asOf: e.resNih,
        basis: `worst of ${researchInstances.length} registered feeds; asOf = newest NIH advance`,
        detail: summarizeStates(researchInstances.map((i) => i.state)),
        instances: researchInstances,
        schedules: schedules(CRON_JOBS.research),
      },
      surface: { state: 'customer_readable', tools: ['search_sbir'], app: ['Market scan'] },
      upstreams: researchUpstreams, provenance: 'Research/lab funding that never posts to SAM.gov, mirrored into one store. Only sources with rows count as contributing.',
    },
    {
      key: 'dod_sbir_topics', label: 'DoD SBIR/STTR topics', kind: 'source_corpus',
      stored: c.dodSbir, unit: 'topics',
      uniqueContribution: c.dodSbir,
      freshness: {
        state: 'UNKNOWN',
        asOf: null,
        basis: 'no data clock — the table holds no rows',
        detail: (c.dodSbir ?? 0) === 0
          ? 'EMPTY. The collector reports HTTP 200 while sbir.gov is unreachable (reachability gate, #604) — a green run here is NOT evidence of data.'
          : undefined,
        schedules: schedules(CRON_JOBS.dodSbir),
      },
      surface: { state: 'customer_readable', tools: ['search_sbir'], note: (c.dodSbir ?? 0) === 0 ? 'wired to search_sbir, currently contributes nothing' : undefined },
      upstreams: ['sbir_gov'], provenance: 'SBIR.gov DoD topics API mirrored into dod_sbir_topics.',
    },
    {
      key: 'legislation', label: 'Legislation (NDAA / defense acquisition measures)', kind: 'source_corpus',
      stored: legislativeRows ? leg.length : null, unit: 'source records',
      breakdown: [
        { label: 'bill versions', count: legBy('introduced_bill'), note: 'one record per text version (IS/IH/RS/RH/ES/EH/…)' },
        { label: 'enacted-law records', count: legBy('enacted_law'), note: 'law status (becameLaw / lawNumber) held per record' },
        { label: 'committee reports', count: legBy('committee_report'), note: legErrata ? `includes ${legErrata} errata` : undefined },
        { label: 'appropriation records', count: legBy('appropriation') },
        { label: 'NDAA provision records', count: legBy('ndaa_provision') },
      ],
      uniqueContribution: legislativeRows ? leg.length : null,
      freshness: {
        state: legInst ? mapSourceState(legInst.source_state) : 'UNKNOWN',
        asOf: legInst?.last_data_advance ?? null,
        basis: 'control plane institute_legislation (last_data_advance); schedule from cron_jobs + cron_job_runs',
        detail: [
          legInst ? `coverage state: ${legInst.source_state} / intervention: ${legInst.intervention_state}` : 'no control-plane instance',
          legSchedule.recurrence === 'proven' ? 'scheduled recurrence: proven' : `scheduled recurrence: ${legSchedule.recurrence.replace(/_/g, ' ').toUpperCase()}`,
        ].join(' · '),
        schedules: [legSchedule],
      },
      surface: { state: 'customer_readable', tools: ['get_legislation_status', 'get_agency_intel'], note: 'get_agency_intel carries a legislation section per department' },
      upstreams: ['congress_gov'],
      provenance: `Congress.gov API: bill-version, law and committee-report METADATA with links (titles, dates, law status, fiscal year). Bill TEXT is not held. FY coverage: ${legFys.length ? legFys.map((y) => `FY${y}`).join(', ') : 'unmeasured'}${legPubDates.length ? `; published ${legPubDates[0]} → ${legPubDates[legPubDates.length - 1]}` : ''}.`,
    },
    {
      key: 'gao_living', label: 'GAO reports (living)', kind: 'source_corpus',
      stored: c.gaoLiving, unit: 'reports',
      breakdown: [{ label: 'with a source URL', count: c.gaoLivingWithUrl }],
      uniqueContribution: c.gaoLiving,
      freshness: fresh({ instanceKey: 'institute_gao', asOf: gaoInst?.last_data_advance ?? e.gaoDiscovered, cadenceHours: 24, basis: 'MAX(institute_sources.discovered_at) for gao_report', jobs: CRON_JOBS.gao,
        detail: e.gaoPubMin && e.gaoPubMax ? `publication range ${e.gaoPubMin} → ${e.gaoPubMax}` : undefined }),
      surface: { state: 'customer_readable', tools: ['get_agency_intel', 'understand_customer'], note: 'reached as cited evidence behind sourced pain points' },
      upstreams: ['gao'], provenance: 'GAO reports RSS → institute_sources. Every row carries the GAO document number and URL.',
    },
    {
      key: 'gao_historical', label: 'GAO testimonies — historical (1993–2000)', kind: 'source_corpus',
      stored: c.histGao, unit: 'testimonies',
      uniqueContribution: c.histGao,
      freshness: {
        state: 'STATIC', asOf: e.histGaoMax, basis: 'agency_intelligence.publication_date (government date)',
        detail: `frozen GovInfo collection, published ${e.histGaoMin ?? '?'} → ${e.histGaoMax ?? '?'}; fetcher quarantined. NOT current GAO intelligence.`,
      },
      surface: { state: 'withheld', tools: [], note: 'withheld from customers as historical (legacy-gao-currency.ts, 5-year ceiling); admin/historical research only' },
      upstreams: ['govinfo'], provenance: 'GovInfo GAOREPORTS collection. Rows are stamped FY2026 by the old fetcher (fetch year) — that is Mindy\'s clock, not the government\'s.',
    },
    {
      key: 'knowledge_base', label: 'Knowledge base (teaching + podcast + proposals)', kind: 'source_corpus',
      stored: c.ragDocs, unit: 'documents',
      uniqueContribution: c.ragDocs,
      freshness: { state: 'MANUAL', asOf: e.ragIngested, basis: 'MAX(mindy_rag_documents.ingested_at) — ingested by script, no scheduled producer' },
      surface: { state: 'customer_readable', tools: ['get_winning_playbook', 'search_podcast_lessons'], app: ['Mindy Chat', 'Proposal Assist'] },
      upstreams: ['govcon_giants'], provenance: 'Internal GovCon Giants corpus (8 yrs teaching, podcast interviews, winning proposals). Ours — not an upstream publisher.',
    },

    // ─── DERIVED / CURATED INTELLIGENCE ─────────────────────────────────────────
    {
      key: 'contacts', label: 'Contacts (government buyers + vendor POCs)', kind: 'derived_intelligence',
      stored: c.contactsTotal, unit: 'contact rows',
      served: { count: c.contactsGov, label: 'government buying-office contacts (contact_kind = government_buyer)', excluded: [
        { label: 'vendor entity POCs (contact_kind = vendor_entity_poc) — contractor-side, not decision makers', count: c.contactsVendor },
        { label: 'unclassified (contact_kind IS NULL) — fail closed, never served as buyers', count: c.contactsUnclassified },
      ] },
      uniqueContribution: 0,
      freshness: fresh({ instanceKey: 'decision_makers_sam_contacts', asOf: e.contacts, cadenceHours: 2, basis: 'MAX(federal_contacts.updated_at)', jobs: CRON_JOBS.decisionMakers }),
      surface: { state: 'customer_readable', tools: ['search_federal_contacts'], app: ['Contacts map', 'Office rosters'], note: 'customer buyer queries require contact_kind = government_buyer' },
      upstreams: ['sam_gov'], provenance: 'Extracted from SAM notice POCs (government) and the SAM entity export (vendors). Rows, not people.',
    },
    {
      key: 'contractors', label: 'Contractor companies', kind: 'derived_intelligence',
      stored: contractorCompanies, unit: 'companies',
      breakdown: [{ label: 'registered UEIs behind those companies (recipients)', count: contractorUeis, note: 'one company can hold several UEIs — not additive' }],
      uniqueContribution: 0,
      uniqueNote: 'canonical contractor population (recipients_rollup_merged — contractor-corpus.ts P0 decision); rolled up from the award warehouse',
      freshness: fresh({ asOf: bqAwardsBuilt, cadenceHours: 24 * 7, basis: 'follows the weekly award ingest (data_sources.bq_awards.last_built)' }),
      surface: { state: 'customer_readable', tools: ['search_contractors', 'find_capable_contractors', 'get_contractor_profile'], app: ['Contractor pages'] },
      upstreams: ['usaspending'], provenance: 'One row per company, rolled up from USASpending award recipients in BigQuery.',
    },
    {
      key: 'events', label: 'Event Radar', kind: 'derived_intelligence',
      stored: c.events, unit: 'events',
      uniqueContribution: 0,
      freshness: fresh({ asOf: e.events, cadenceHours: 24, basis: 'MAX(sam_events.extracted_at)', jobs: CRON_JOBS.events }),
      surface: { state: 'customer_readable', tools: ['search_federal_events', 'get_federal_event_series'] },
      upstreams: ['sam_gov'], provenance: 'Industry days / sources-sought extracted from SAM notices, DoDAAC-decoded to the buying office.',
    },
    {
      key: 'dodaac_dir', label: 'Buying-office directory', kind: 'derived_intelligence',
      stored: c.dodaac, unit: 'offices',
      uniqueContribution: 0,
      freshness: { state: 'UNKNOWN', asOf: e.dodaac, basis: 'MAX(dodaac_directory.updated_at) — no registered producer cadence' },
      surface: { state: 'internal_only', tools: [], note: 'anchors office rosters, events and opportunity office names' },
      upstreams: ['usaspending'], provenance: 'Contracting offices decoded from award DoDAACs (USASpending/FPDS in BigQuery).',
    },
    {
      key: 'sourced_pain_points', label: 'Source-backed pain points', kind: 'derived_intelligence',
      stored: c.sourcedClaims, unit: 'claims',
      breakdown: [
        { label: 'tied to a held Institute source document', count: c.sourcedClaimsBacked },
        { label: 'change-log events (intelligence_changes)', count: c.intelChanges, note: 'history of these claims, not additional claims' },
      ],
      uniqueContribution: 0,
      freshness: { state: 'UNKNOWN', asOf: e.claimsEvidence, basis: 'MAX(agency_pain_points_db.last_evidence_at) — derived alongside the GAO collector; no independent clock' },
      surface: { state: 'customer_readable', tools: ['get_agency_intel', 'understand_customer'], note: 'preferred over legacy claims; served with citations' },
      upstreams: ['gao'], provenance: 'Claims derived from the living GAO corpus, each citing its institute_sources document.',
    },
    {
      key: 'contract_patterns', label: 'Agency contract patterns', kind: 'derived_intelligence',
      stored: c.contractPatterns, unit: 'patterns',
      uniqueContribution: 0,
      freshness: { state: 'STATIC', asOf: null, basis: 'agency_intelligence (contract_pattern) — one-off build, no scheduled producer' },
      surface: { state: 'internal_only', tools: [], note: 'loaded by getUnifiedAgencyIntelligence; not rendered by a customer tool' },
      upstreams: ['usaspending'], provenance: 'USASpending spending-pattern summaries per agency.',
    },

    // ─── STATIC / MANUAL ────────────────────────────────────────────────────────
    {
      key: 'pain_points', label: 'Agency pain points (curated, static)', kind: 'static_manual',
      stored: sc.painPoints, unit: 'claims',
      uniqueContribution: 0,
      freshness: { state: 'STATIC', asOf: painAsOf, basis: 'last change to src/data/agency-pain-points.json (git)' },
      surface: { state: 'customer_readable', tools: ['get_agency_intel', 'understand_customer'], note: 'served as LEGACY (labelled) when no source-backed claim exists' },
      upstreams: [],
      provenance: `Hand-written claims for ${sc.agencies} agencies in a bundled JSON file. ${sc.pp.url} of ${sc.painPoints} carry a source URL. Source names below are PROSE ATTRIBUTIONS inside claims, not held source documents.`,
      proseAttributions: [
        attribution('GAO', sc.pp.gao, c.gaoLiving),
        attribution('IG / OIG', sc.pp.ig, c.igDocs),
        attribution('CRS', sc.pp.crs, c.crsDocs),
        attribution('NDAA', sc.pp.ndaa, legislativeRows ? leg.length : null),
      ],
      note: 'A held GAO or NDAA corpus exists, but these claims are not linked to its records — the living corpus count is shown for contrast, not as backing.',
    },
    {
      key: 'priorities', label: 'Agency spending priorities (curated, static)', kind: 'static_manual',
      stored: sc.priorities, unit: 'claims',
      uniqueContribution: 0,
      freshness: { state: 'STATIC', asOf: painAsOf, basis: 'last change to src/data/agency-pain-points.json (git)' },
      surface: { state: 'customer_readable', tools: ['get_agency_intel'] },
      upstreams: [],
      provenance: `Hand-written funded-program claims in the same bundled file. ${sc.pr.url} carry a source URL.`,
      proseAttributions: [
        attribution('GAO', sc.pr.gao, c.gaoLiving),
        attribution('IG / OIG', sc.pr.ig, c.igDocs),
        attribution('CRS', sc.pr.crs, c.crsDocs),
        attribution('NDAA', sc.pr.ndaa, legislativeRows ? leg.length : null),
        attribution('Budget justifications', 0, c.budgetJustDocs),
        attribution('Strategic plans', 0, c.strategicPlanDocs),
      ].filter((a) => a.claims > 0 || a.label === 'IG / OIG' || a.label === 'CRS'),
    },
    {
      key: 'budget_authority', label: 'Budget authority (static file)', kind: 'static_manual',
      stored: budgetAgencies, unit: 'toptier agencies',
      uniqueContribution: 0,
      freshness: { state: 'STATIC', asOf: budgetAsOf, basis: 'agency-budget-data.json lastUpdated', detail: `fiscal years ${budgetFys.join(', ') || '?'} — FY2025 enacted, FY2026 President's request` },
      surface: { state: 'customer_readable', tools: ['get_agency_budget_trends'] },
      upstreams: ['omb'], provenance: 'Built once from the OMB FY2026 discretionary request + agency CBJs. Not a living budget feed.',
    },

    // ─── DERIVED INDEX / REPRESENTATION ─────────────────────────────────────────
    {
      key: 'semantic_index', label: 'Semantic index over SAM notices', kind: 'derived_index',
      stored: embIndexed, unit: 'SAM notices with a vector',
      breakdown: [
        { label: 'SOW / PWS text indexed', count: c.embSow },
        { label: 'description indexed (fallback)', count: c.embDesc },
        { label: 'skipped — under 80 chars of text (empty-array sentinel, NOT a vector)', count: c.embNone, note: 'not counted as indexed' },
        { label: 'not yet processed', count: c.embPending },
      ],
      uniqueContribution: 0,
      uniqueNote: 'these are SAM notices already counted above — a representation, not more records',
      freshness: fresh({ asOf: null, cadenceHours: null, basis: 'embed-sow-corpus schedule (no per-row clock read here)', jobs: CRON_JOBS.embed }),
      surface: { state: 'internal_only', tools: [], note: 'internal enrichment: powers hidden-match alerts and match_recompete_sow ranking; vectors are never returned' },
      upstreams: ['sam_gov'], provenance: 'OpenAI text-embedding-3-small over SAM SOW text (preferred) or description. OpenAI is a processing step, not a source.',
    },
    {
      key: 'knowledge_chunks', label: 'Knowledge-base passages (RAG chunks)', kind: 'derived_index',
      stored: c.ragChunks, unit: 'passages',
      uniqueContribution: 0,
      uniqueNote: 'searchable slices of the knowledge-base documents above',
      freshness: { state: 'MANUAL', asOf: e.ragIngested, basis: 'follows knowledge-base ingestion' },
      surface: { state: 'internal_only', tools: [], note: 'retrieval layer behind get_winning_playbook / Chat' },
      upstreams: ['govcon_giants'], provenance: 'Chunked + embedded knowledge-base documents.',
    },

    // ─── LIVE PASSTHROUGH ───────────────────────────────────────────────────────
    {
      key: 'usaspending_live', label: 'USASpending API (live queries)', kind: 'passthrough', stored: null, unit: '—',
      uniqueContribution: null,
      freshness: { state: 'PASSTHROUGH', asOf: null, basis: 'fetched live per call (spending_by_award / spending_by_category)' },
      surface: { state: 'passthrough', tools: ['search_past_contracts', 'get_keyword_coverage', 'generate_market_report'] },
      upstreams: ['usaspending'], provenance: 'Live USASpending search API. Distinct from the persisted award warehouse above; keyword coverage is a derived MEASUREMENT computed per call, not a held dataset.',
    },
    {
      key: 'pricing_intel', label: 'GSA CALC+ labor rates', kind: 'passthrough', stored: null, unit: '—',
      uniqueContribution: null,
      freshness: { state: 'PASSTHROUGH', asOf: null, basis: 'fetched live per call; 12h response cache (mcp_external_cache)' },
      surface: { state: 'passthrough', tools: ['get_pricing_intel'] },
      upstreams: ['gsa_calc'], provenance: 'Live GSA CALC+ API. Nothing persisted beyond a short-TTL response cache; its population is GSA\'s, not ours.',
    },
    {
      key: 'incumbent_financials', label: 'SEC EDGAR financials', kind: 'passthrough', stored: null, unit: '—',
      uniqueContribution: null,
      freshness: { state: 'PASSTHROUGH', asOf: null, basis: 'fetched live per call; 6–24h response cache' },
      surface: { state: 'passthrough', tools: ['get_incumbent_financials'] },
      upstreams: ['sec_edgar'], provenance: 'Live SEC EDGAR companyfacts. Public filers only.',
    },
    {
      key: 'regulatory_demand', label: 'Federal Register documents', kind: 'passthrough', stored: null, unit: '—',
      uniqueContribution: null,
      freshness: { state: 'PASSTHROUGH', asOf: null, basis: 'fetched live per call; 1h response cache' },
      surface: { state: 'passthrough', tools: ['get_regulatory_demand'] },
      upstreams: ['federal_register'], provenance: 'Live Federal Register API. No NAICS tagging.',
    },
  ];

  const totals = computeTotals(datasets);
  const upstreams = countUpstreamPublishers(datasets, forecastIssuers);
  const violations = inventoryViolations(datasets);

  // Control-plane counts that disagree with what we just measured — shown as debt.
  const dsRec = (k: string) => controlPlane.sources?.find((s) => s.key === k)?.record_count ?? null;
  const held = (k: string) => instance(k)?.held_population ?? null;
  const debt = registryDebt([
    { where: 'data_sources.sam_opportunities.record_count', claimed: dsRec('sam_opportunities'), measured: c.samTotal },
    { where: 'data_sources.forecast_intelligence.record_count', claimed: dsRec('forecast_intelligence'), measured: c.forecasts },
    { where: 'data_sources.agency_pain_points.record_count', claimed: dsRec('agency_pain_points'), measured: sc.painPoints },
    { where: 'data_sources.gsa_calc_pricing.record_count (passthrough — should hold no count)', claimed: dsRec('gsa_calc_pricing'), measured: 0 },
    { where: 'data_source_instances.sam_opportunities_sam_gov.held_population', claimed: held('sam_opportunities_sam_gov'), measured: c.samTotal },
    { where: 'data_source_instances.dibbs_dla_flat_files.held_population', claimed: held('dibbs_dla_flat_files'), measured: c.dibbs },
    { where: 'data_source_instances.grants_gov_api.held_population', claimed: held('grants_gov_api'), measured: c.grants },
    { where: 'data_source_instances.institute_gao.held_population', claimed: held('institute_gao'), measured: c.gaoLiving },
    { where: 'data_source_instances.institute_legislation.held_population', claimed: held('institute_legislation'), measured: legislativeRows ? leg.length : null },
    { where: 'data_source_instances.decision_makers_sam_contacts.held_population', claimed: held('decision_makers_sam_contacts'), measured: c.contactsGov },
    { where: 'data_source_instances.decision_makers_vendor_entity_pocs.held_population', claimed: held('decision_makers_vendor_entity_pocs'), measured: c.contactsVendor },
    { where: 'data_source_instances.research_nih_reporter.held_population', claimed: held('research_nih_reporter'), measured: c.resNih },
  ]);

  return NextResponse.json(
    {
      success: true,
      name: 'Mindy Data Core',
      generatedAt: now.toISOString(),
      datasets,
      totals,
      upstreams: {
        ...upstreams,
        definition: 'An upstream is the publisher / authoritative feed whose data we persist. One publisher counts once however many datasets use it. Processing steps (DoDAAC decode, embeddings) and prose attributions are not sources. Forecast issuing agencies each count as a publisher.',
        names: Object.fromEntries(
          [...upstreams.persisted, ...upstreams.passthroughOnly, ...upstreams.internal]
            .map((k) => [k, UPSTREAM_PUBLISHERS[k]?.name ?? k]),
        ),
        registeredFeeds: instances.length,
      },
      registryDebt: debt,
      violations,
      provenanceLimits: {
        igSourceDocuments: c.igDocs,
        crsSourceDocuments: c.crsDocs,
        budgetJustificationDocuments: c.budgetJustDocs,
        strategicPlanDocuments: c.strategicPlanDocs,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
