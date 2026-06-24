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
import { createClient } from '@supabase/supabase-js';
import { bqQuery, BQ_TABLES } from '@/lib/bigquery/client';
import { getRegistrySummary } from '@/lib/data-sources/registry';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import painPointsData from '@/data/agency-pain-points.json';

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
  distinctSources: 28,
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
  const supabase = createClient(supabaseUrl, supabaseKey);

  const pp = painPointCounts();

  // Live counts in parallel — each best-effort (null on failure, never throws).
  const [
    decisionMakers,
    samOpps,
    embeddedOpps,
    recompetes,
    forecasts,
    contractors,
  ] = await Promise.all([
    headCount(supabase, 'federal_contacts'),
    headCount(supabase, 'sam_opportunities'),
    headCount(supabase, 'sam_opportunities', 'sow_embedding'),
    headCount(supabase, 'recompete_opportunities'),
    headCount(supabase, 'agency_forecasts'),
    bqRecipientsCount(),
  ]);

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
    { key: 'grants', label: 'Federal grants', source: 'Grants.gov API (live)', provenance: 'passthrough', count: null, note: 'queried live per search', sources: ['Grants.gov API'] },
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
