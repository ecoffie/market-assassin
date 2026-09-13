/**
 * Mindy Data Core — live data inventory.
 *
 * One screen for every dataset that powers Mindy: LIVE count (queried now, not
 * hardcoded), raw source, and a provenance tag so we're honest about what's
 * genuinely ours vs. public data we've curated. Powers the admin dashboard tile
 * and is the source of truth for the onboarding Market Data Map counts.
 *
 * GET /api/admin/data-inventory?password=$ADMIN_PASSWORD
 *
 * provenance: 'exclusive'   — we created it; no public feed (forecasts, pain points)
 *             'curated'      — public base, our scoring/decoding/joins (recompetes, contacts)
 *             'cache'        — our mirror of a public corpus (SAM opps)
 *             'passthrough'  — live public API, no moat alone (grants)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCountClient } from '@/lib/supabase/server-clients';
import { bqQuery, BQ_TABLES } from '@/lib/bigquery/client';
import { getRegistrySummary } from '@/lib/data-sources/registry';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import painPointsData from '@/data/agency-pain-points.json';
import budgetData from '@/data/agency-budget-data.json';

export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

type Provenance = 'exclusive' | 'curated' | 'cache' | 'passthrough';

interface DatasetEntry {
  key: string;
  label: string;
  source: string;        // raw origin (short)
  provenance: Provenance;
  count: number | null;  // null = couldn't measure
  note?: string;
  sources?: string[];    // the physical places this dataset is pulled from
  /**
   * Named VIEWS over this dataset's own population — e.g. SBIR/STTR is a filtered
   * slice of the research corpus, not a separate corpus.
   *
   * These counts are DELIBERATELY NOT added to any total: a view is a subset of the
   * parent `count`, so summing both would double-count it. Surfacing the slice keeps
   * a real product surface visible without inventing a second dataset for it.
   * (Decision: docs/data-core-logical-dataset-decision-sbir.md)
   */
  subtypes?: Array<{ key: string; label: string; count: number | null; note?: string }>;
}

/**
 * Distinct sources, counted from what the page actually lists rather than asserted.
 * Returns null if no dataset carries a `sources[]` array — unknown, never a guess.
 */
function deriveDistinctSources(datasets: DatasetEntry[]): number | null {
  const seen = new Set<string>();
  for (const d of datasets) for (const src of d.sources ?? []) seen.add(src.trim());
  return seen.size > 0 ? seen.size : null;
}

// The "recreate cost" story — breadth, not a copy-paste recipe. Static (changes
// slowly); the exact source list lives in docs/MINDY-DATA-CORE-SOURCES.md.
const RECREATE_COST = {
  // distinctSources is DERIVED at request time from the datasets' own `sources[]`
  // arrays (see deriveDistinctSources below) — it used to be the literal `34`,
  // which no longer matched the listed sources once datasets were added or
  // corrected. A hand-typed count of a thing the code can compute is exactly the
  // hardcoded-claim class the Data Core controls exist to catch (C2/class 15).
  //
  // It is reported as a LOWER BOUND of distinctly-labelled sources: a few labels
  // are near-duplicates of each other ("DoDAAC decode" / "DoDAAC office decode"),
  // and collapsing them by fuzzy match would merge genuinely different agency
  // feeds ("justice.gov (Excel)" vs "nasa.gov (Excel)"). Counting labels is
  // defensible; guessing which labels mean the same upstream is not.
  formats: 6,                  // REST · Excel · CSV · PDF · scraped HTML · BigQuery
  formatList: ['REST API', 'Excel', 'CSV', 'PDF', 'Scraped HTML', 'BigQuery bulk'],
  agencies: '300+',
  // Whole repo (~1.10M). Breakdown: ~535K application code + ~314K curated data
  // (the databases) + ~152K assets + ~100K docs. NOT just code — counting "what it
  // took to get the databases" too (Eric, Jun 24).
  //
  // RECOUNTED 2026-07-30 (was 975K / 1,846 commits, set Jun 24). Measured over
  // `git ls-files`, EXCLUDING binaries (.pptx/.pdf/.png/.xlsx/…) and lockfiles —
  // a 145K-"line" PowerPoint is a byte artifact, not work, and counting it would
  // inflate the headline to 2.24M. Same basis as the original figure, so the
  // growth is real and comparable. Re-run that count before changing this.
  linesOfCode: 1101201,
  linesBreakdown: { code: 534699, curatedData: 314200, assets: 152333, docs: 99969 },
  commits: 3013,
};

/** Supabase exact head-count (no rows pulled). Optional column-not-null filter. */
async function headCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  table: string,
  notNullColumn?: string,
): Promise<number | null> {
  try {
    let q = supabase.from(table).select('*', { count: 'exact', head: true });
    if (notNullColumn) q = q.not(notNullColumn, 'is', null);
    const { count, error } = await q;
    if (error) return null;
    return count ?? null;
  } catch {
    return null;
  }
}

async function bqRecipientsCount(): Promise<number | null> {
  try {
    const rows = await bqQuery<{ n: number }>({
      query: `SELECT COUNT(*) AS n FROM ${BQ_TABLES.recipients}`,
    });
    return rows?.[0]?.n ?? null;
  } catch {
    return null;
  }
}

/** Pain points + priorities from the curated JSON ({ agencies: { name: {...} } }). */
function painPointCounts(): { agencies: number; painPoints: number; priorities: number } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ag = ((painPointsData as any)?.agencies || {}) as Record<string, { painPoints?: unknown[]; priorities?: unknown[] }>;
  let painPoints = 0;
  let priorities = 0;
  const names = Object.keys(ag);
  for (const n of names) {
    painPoints += (ag[n]?.painPoints || []).length;
    priorities += (ag[n]?.priorities || []).length;
  }
  return { agencies: names.length, painPoints, priorities };
}

export async function GET(request: NextRequest) {
  if (!ADMIN_PASSWORD || request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
  // This route is head-counts ONLY (every query here is {count:'exact', head:true}),
  // and the replica 400s every HEAD — so it must use the primary. Previously every
  // count on this page silently rendered null via `if (error) return null`.
  const supabase = getCountClient();

  const pp = painPointCounts();

  // Live counts in parallel — each best-effort (null on failure, never throws).
  const [
    decisionMakers,
    samOpps,
    embeddedOpps,
    recompetes,
    forecasts,
    contractors,
    ragDocs,
    ragChunks,
    events,
    agencyIntel,
    dodaacDir,
    dibbs,
    grantsCached,
    researchTotal,
  ] = await Promise.all([
    headCount(supabase, 'federal_contacts'),
    headCount(supabase, 'sam_opportunities'),
    headCount(supabase, 'sam_opportunities', 'sow_embedding'),
    headCount(supabase, 'recompete_opportunities'),
    headCount(supabase, 'agency_forecasts'),
    bqRecipientsCount(),
    headCount(supabase, 'mindy_rag_documents'),
    headCount(supabase, 'mindy_rag_chunks'),
    headCount(supabase, 'sam_events'),
    headCount(supabase, 'agency_intelligence'),
    headCount(supabase, 'dodaac_directory'),
    // INVENTORY TRUTH (2026-09-13): three customer-serving mirrored corpora were
    // absent or mis-described. See docs/data-core-logical-dataset-decision-sbir.md.
    headCount(supabase, 'dibbs_rfqs'),
    headCount(supabase, 'grants_cache'),
    headCount(supabase, 'aggregated_opportunities'),
  ]);

  // Subtype slices of the research corpus. Measured, never assumed — the SBIR
  // "dataset" on this page used to claim a live passthrough while the product read
  // 42 mirrored rows from aggregated_opportunities.
  const researchSubtype = async (t: string): Promise<number | null> => {
    try {
      const { count, error } = await supabase
        .from('aggregated_opportunities')
        .select('*', { count: 'exact', head: true })
        .eq('opportunity_type', t);
      // A missing count is UNKNOWN, not zero (Bug Prevention Rule #11).
      return error ? null : (count ?? null);
    } catch { return null; }
  };
  const [researchGrants, researchSbir, researchBaa] = await Promise.all([
    researchSubtype('grant'), researchSubtype('sbir_sttr'), researchSubtype('baa'),
  ]);

  // Budget authority is a curated static file (toptier agencies × fiscal years).
  const budgetAgencies = (() => {
    try { return Object.keys((budgetData as { agencies?: Record<string, unknown> }).agencies || {}).length; }
    catch { return null; }
  })();

  // SOW-vs-description embedding split (best-effort — column may be un-migrated).
  const srcCount = async (src: string): Promise<number | null> => {
    try {
      const { count, error } = await supabase
        .from('sam_opportunities')
        .select('*', { count: 'exact', head: true })
        .eq('embedding_source', src);
      return error ? null : (count ?? null);
    } catch { return null; }
  };
  const [sowEmbedded, descEmbedded] = await Promise.all([srcCount('sow'), srcCount('description')]);
  const embedNote = (sowEmbedded != null || descEmbedded != null)
    ? `${(sowEmbedded ?? 0).toLocaleString()} SOW · ${(descEmbedded ?? 0).toLocaleString()} description`
    : 'powers hidden-match (beats keyword/NAICS filters)';

  const datasets: DatasetEntry[] = [
    { key: 'contractors', label: 'Contractor database', source: 'USASpending recipients (BigQuery) + SBLO contacts', provenance: 'curated', count: contractors, note: 'who you compete with / team with', sources: ['USASpending recipients (BigQuery)', 'SBA Prime Directory FY24', 'SAM.gov Entity API'] },
    { key: 'decision_makers', label: 'Decision makers', source: 'SAM POCs (daily sync) + DoDAAC office rostering', provenance: 'curated', count: decisionMakers, note: 'contracting officers + buying-office rosters', sources: ['SAM.gov POCs (daily sync)', 'DoDAAC directory (FPDS/BigQuery)'] },
    { key: 'sam_opps', label: 'SAM opportunities (cache)', source: 'SAM.gov Opportunities API', provenance: 'cache', count: samOpps, note: 'live open-opportunity corpus', sources: ['SAM.gov Opportunities API'] },
    { key: 'embedded_opps', label: 'Semantic-indexed opportunities', source: 'Our SOW embeddings on the SAM cache', provenance: 'exclusive', count: embeddedOpps, note: embedNote, sources: ['SAM.gov SOW text', 'SAM.gov descriptions', 'OpenAI text-embedding-3-small'] },
    { key: 'forecasts', label: 'Forecasts (upcoming buys)', source: 'Scraped + unified from 12 agencies', provenance: 'exclusive', count: forecasts, note: '12 agency feeds · 7 portals · 4 formats', sources: ['justice.gov (Excel)', 'energy.gov (Excel)', 'nasa.gov (Excel)', 'ssa.gov (Excel)', 'nsf.gov (PDF)', 'dhs.gov (scraper)', 'GSA Acquisition Gateway (CSV ×6 agencies)'] },
    { key: 'recompetes', label: 'Recompetes (expiring contracts)', source: 'USASpending awards, our identify/score/resolve', provenance: 'curated', count: recompetes, sources: ['USASpending Awards API'] },
    // NDAA belongs on both lists: scan-ndaa-sections.py feeds merge-agency-intelligence.js,
    // and 47 curated entries are NDAA mandates with statutory deadlines (e.g. the FY2026
    // NIST/CMMC procurement-security framework). It was doing the work without the credit.
    { key: 'pain_points', label: 'Agency pain points', source: 'Hand-curated from GAO / IG / CRS / NDAA', provenance: 'exclusive', count: pp.painPoints, note: `${pp.agencies} agencies`, sources: ['GAO reports', 'IG audits', 'CRS analyses', 'NDAA (annual defense authorization)', 'Budget justifications', 'Strategic plans', 'GovInfo API'] },
    { key: 'priorities', label: 'Agency spending priorities', source: 'Hand-curated funded programs', provenance: 'exclusive', count: pp.priorities, note: 'where the money is going', sources: ['Budget justifications', 'GAO reports', 'NDAA (annual defense authorization)', 'Strategic plans', 'USASpending patterns'] },
    // The KNOWLEDGE moat — 8 yrs of teaching + 743 interviews + winning proposals.
    // Counted by DOCUMENTS (conservative); ragChunks is the searchable-passage depth.
    // Powers Mindy Chat AND Proposal Assist's winning-proposal style corpus.
    { key: 'knowledge_base', label: 'Knowledge base (RAG)', source: '8 yrs teaching corpus + 743 podcast interviews + winning proposals', provenance: 'exclusive', count: ragDocs, note: `${(ragChunks ?? 0).toLocaleString()} searchable passages · powers Mindy Chat + Proposal Assist`, sources: ['GovCon Giants teaching corpus (8 yrs)', '743 podcast interviews', 'Winning proposal / cap-statement corpus', 'OpenAI embeddings'] },
    { key: 'events', label: 'Event Radar', source: 'SAM Special Notices, decoded to buying office', provenance: 'curated', count: events, note: 'industry days + sources sought, DoDAAC-decoded to the real command', sources: ['SAM.gov Special Notices', 'DoDAAC office decode'] },
    { key: 'agency_intel', label: 'Agency intelligence', source: 'GAO high-risk + contract patterns', provenance: 'exclusive', count: agencyIntel, note: 'GAO/GovInfo high-risk + USASpending contract patterns', sources: ['GovInfo API', 'GAO high-risk reports', 'USASpending contract patterns'] },
    { key: 'dodaac_dir', label: 'Buying-office directory', source: 'DoDAAC decode from FPDS/BigQuery', provenance: 'curated', count: dodaacDir, note: 'decoded DoD/agency contracting offices behind the codes', sources: ['FPDS awards (BigQuery)', 'DoDAAC decode'] },
    { key: 'budget_authority', label: 'Budget authority', source: 'OMB / USASpending toptier budgets', provenance: 'curated', count: budgetAgencies, note: 'toptier agency budget trends (winners/losers)', sources: ['OMB budget data', 'USASpending toptier accounts'] },
    // DIBBS — its own logical dataset: it answers a question nothing else here can
    // ("what does DLA buy below the SAM.gov posting threshold?"), FSC/NSN-coded,
    // with its own product surface (/api/app/dibbs) and a place on the map. It was
    // absent from this inventory entirely. Presence only — ingestion reliability is
    // a SEPARATE question and is deliberately not asserted here.
    { key: 'dibbs', label: 'DLA small-buy RFQs (DIBBS)', source: 'DLA DIBBS solicitations, mirrored nightly', provenance: 'curated', count: dibbs, note: 'defense buys under the SAM.gov posting threshold — FSC/NSN-coded', sources: ['DLA DIBBS'] },
    // Grants was described as a live passthrough holding nothing, but sync-grants
    // mirrors Grants.gov into grants_cache nightly. Corrected, NOT added — the row
    // already existed; only its classification and count were wrong.
    //
    // NOTE the deliberate separation: the research corpus below ALSO contains
    // grant-type records (NIH RePORTER + a Grants.gov research slice). These are
    // DIFFERENT physical stores with different producers (sync-grants vs
    // snapshot-multisite-*). They are NOT merged, NOT deduped, and NOT reconciled
    // here; whether they overlap is a future reconciliation question.
    { key: 'grants', label: 'Federal grants', source: 'Grants.gov, mirrored nightly (grants_cache)', provenance: 'curated', count: grantsCached, note: 'mirrored Grants.gov corpus; live query layered on top at search time. Distinct store from the research corpus below.', sources: ['Grants.gov API'] },
    // Research & lab funding — ONE logical dataset over aggregated_opportunities.
    // The store is 96% grant-type NIH/DARPA/NSF records; SBIR/STTR is a filtered
    // VIEW of it (opportunity_type='sbir_sttr'), not a separate corpus, so it is
    // listed as a subtype whose count is NOT added to any total. The old standalone
    // `sbir` row claimed passthrough/count:null while the product read these very
    // rows — removing it is what stops the same 42 records being counted twice.
    // The physical table name is deliberately NOT the product-facing label.
    {
      key: 'research_funding',
      label: 'Research & Lab Funding Opportunities',
      source: 'NIH RePORTER · DARPA BAA · NSF · Grants.gov (research slice)',
      provenance: 'curated',
      count: researchTotal,
      note: 'research/lab funding that never posts to SAM.gov. SBIR/STTR is a filtered view of this corpus, not a separate dataset.',
      sources: ['NIH RePORTER', 'DARPA BAA', 'NSF', 'Grants.gov (research slice)'],
      subtypes: [
        { key: 'research_grant', label: 'Grant-type', count: researchGrants },
        { key: 'research_sbir_sttr', label: 'SBIR / STTR', count: researchSbir, note: 'the SBIR product surface reads exactly this slice' },
        { key: 'research_baa', label: 'BAA', count: researchBaa },
      ],
    },
    // Mindy MCP live-API sources (2026-07-12) — fetched on demand with a short-TTL
    // response cache (mcp_external_cache), NOT a mirrored dataset. count is null
    // because the live upstream count is not ours to claim. See src/lib/edgar,
    // src/lib/federal-register, src/lib/utils/calc-rates.ts.
    { key: 'pricing_intel', label: 'Pricing intel (GSA CALC)', source: 'GSA CALC+ labor rates (live)', provenance: 'passthrough', count: null, note: 'MCP get_pricing_intel · ~240K awarded labor categories · price-to-win p25/p50/p75 · cache 12h', sources: ['GSA CALC+ API (api.gsa.gov)'] },
    { key: 'incumbent_financials', label: 'Incumbent financials (SEC EDGAR)', source: 'SEC EDGAR companyfacts (live)', provenance: 'passthrough', count: null, note: 'MCP get_incumbent_financials · public filers only (private → grounded=false) · cache 24h/6h', sources: ['SEC EDGAR (www.sec.gov / data.sec.gov)'] },
    { key: 'regulatory_demand', label: 'Regulatory demand (Federal Register)', source: 'Federal Register documents (live)', provenance: 'passthrough', count: null, note: 'MCP get_regulatory_demand · "demand before SAM" leading indicator · no NAICS tagging · cache 1h', sources: ['Federal Register API (federalregister.gov)'] },
  ];

  const byProvenance = (p: Provenance) =>
    datasets.filter((d) => d.provenance === p).reduce((s, d) => s + (d.count || 0), 0);

  return NextResponse.json(
    {
      success: true,
      name: 'Mindy Data Core',
      generatedAt: new Date().toISOString(),
      datasets,
      totals: {
        exclusiveRecords: byProvenance('exclusive'),
        curatedRecords: byProvenance('curated'),
        cachedRecords: byProvenance('cache'),
        allMeasured: datasets.reduce((s, d) => s + (d.count || 0), 0),
      },
      // The breadth-of-build story for demo day (counts, not a copy-paste recipe).
      // distinctSources is overridden with the DERIVED value (null if underivable),
      // so the headline can never drift from the sources the page actually lists.
      recreateCost: { ...RECREATE_COST, distinctSources: deriveDistinctSources(datasets) },
      // Source-level "trace back" — forecasts broken down by the agency they were
      // scraped from (the registry's per-source record counts).
      // Pass the counts we ALREADY measured above so the trace can't drift from
      // the dataset numbers on the same page. Without this the summary summed
      // hand-written snapshots and reported 7,731 forecasts next to a live
      // 33,097 (2026-08-04).
      sourceTrace: {
        forecastsByAgency: getRegistrySummary({
          // Keys MUST match DATA_REGISTRY category names exactly or the override
          // is silently ignored and the stale snapshot wins.
          Forecasts: forecasts,
          Recompetes: recompetes,
          Events: events,
          'Agency Intel': agencyIntel,
          Contractors: contractors,
        }),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
