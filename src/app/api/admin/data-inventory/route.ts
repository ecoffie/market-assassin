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
import { getReadClient } from '@/lib/supabase/server-clients';
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
}

// The "recreate cost" story — breadth, not a copy-paste recipe. Static (changes
// slowly); the exact source list lives in docs/MINDY-DATA-CORE-SOURCES.md.
const RECREATE_COST = {
  distinctSources: 34,         // +knowledge base (teaching corpus, podcasts, winning proposals) +OMB budget +NIH RePORTER +SBIR Multisite
  formats: 6,                  // REST · Excel · CSV · PDF · scraped HTML · BigQuery
  formatList: ['REST API', 'Excel', 'CSV', 'PDF', 'Scraped HTML', 'BigQuery bulk'],
  agencies: '300+',
  // Whole repo (~975K). Breakdown: ~344K application code + ~333K curated data
  // (the databases) + ~217K assets + ~81K docs. NOT just code — counting "what it
  // took to get the databases" too (Eric, Jun 24).
  linesOfCode: 975000,
  linesBreakdown: { code: 343753, curatedData: 333223, assets: 217438, docs: 81486 },
  commits: 1846,
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
  // Pure read-only inventory counts (GET, no writes) → read replica.
  const supabase = getReadClient();

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
    { key: 'pain_points', label: 'Agency pain points', source: 'Hand-curated from GAO / IG / CRS', provenance: 'exclusive', count: pp.painPoints, note: `${pp.agencies} agencies`, sources: ['GAO reports', 'IG audits', 'CRS analyses', 'Budget justifications', 'Strategic plans', 'GovInfo API'] },
    { key: 'priorities', label: 'Agency spending priorities', source: 'Hand-curated funded programs', provenance: 'exclusive', count: pp.priorities, note: 'where the money is going', sources: ['Budget justifications', 'GAO reports', 'Strategic plans', 'USASpending patterns'] },
    // The KNOWLEDGE moat — 8 yrs of teaching + 743 interviews + winning proposals.
    // Counted by DOCUMENTS (conservative); ragChunks is the searchable-passage depth.
    // Powers Mindy Chat AND Proposal Assist's winning-proposal style corpus.
    { key: 'knowledge_base', label: 'Knowledge base (RAG)', source: '8 yrs teaching corpus + 743 podcast interviews + winning proposals', provenance: 'exclusive', count: ragDocs, note: `${(ragChunks ?? 0).toLocaleString()} searchable passages · powers Mindy Chat + Proposal Assist`, sources: ['GovCon Giants teaching corpus (8 yrs)', '743 podcast interviews', 'Winning proposal / cap-statement corpus', 'OpenAI embeddings'] },
    { key: 'events', label: 'Event Radar', source: 'SAM Special Notices, decoded to buying office', provenance: 'curated', count: events, note: 'industry days + sources sought, DoDAAC-decoded to the real command', sources: ['SAM.gov Special Notices', 'DoDAAC office decode'] },
    { key: 'agency_intel', label: 'Agency intelligence', source: 'GAO high-risk + contract patterns', provenance: 'exclusive', count: agencyIntel, note: 'GAO/GovInfo high-risk + USASpending contract patterns', sources: ['GovInfo API', 'GAO high-risk reports', 'USASpending contract patterns'] },
    { key: 'dodaac_dir', label: 'Buying-office directory', source: 'DoDAAC decode from FPDS/BigQuery', provenance: 'curated', count: dodaacDir, note: 'decoded DoD/agency contracting offices behind the codes', sources: ['FPDS awards (BigQuery)', 'DoDAAC decode'] },
    { key: 'budget_authority', label: 'Budget authority', source: 'OMB / USASpending toptier budgets', provenance: 'curated', count: budgetAgencies, note: 'toptier agency budget trends (winners/losers)', sources: ['OMB budget data', 'USASpending toptier accounts'] },
    { key: 'grants', label: 'Federal grants', source: 'Grants.gov API (live)', provenance: 'passthrough', count: null, note: 'queried live per search', sources: ['Grants.gov API'] },
    { key: 'sbir', label: 'SBIR / STTR', source: 'NIH RePORTER + SBIR Multisite (live)', provenance: 'passthrough', count: null, note: 'queried live per search', sources: ['NIH RePORTER API', 'SBIR.gov Multisite'] },
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
      recreateCost: RECREATE_COST,
      // Source-level "trace back" — forecasts broken down by the agency they were
      // scraped from (the registry's per-source record counts).
      sourceTrace: { forecastsByAgency: getRegistrySummary() },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
