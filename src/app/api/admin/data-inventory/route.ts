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
  source: string;        // raw origin
  provenance: Provenance;
  count: number | null;  // null = couldn't measure
  note?: string;
}

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

  const datasets: DatasetEntry[] = [
    { key: 'contractors', label: 'Contractor database', source: 'USASpending recipients (BigQuery) + SBLO contacts', provenance: 'curated', count: contractors, note: 'who you compete with / team with' },
    { key: 'decision_makers', label: 'Decision makers', source: 'SAM POCs (daily sync) + DoDAAC office rostering', provenance: 'curated', count: decisionMakers, note: 'contracting officers + buying-office rosters' },
    { key: 'sam_opps', label: 'SAM opportunities (cache)', source: 'SAM.gov Opportunities API', provenance: 'cache', count: samOpps, note: 'live open-opportunity corpus' },
    { key: 'embedded_opps', label: 'Semantic-indexed opportunities', source: 'Our SOW embeddings on the SAM cache', provenance: 'exclusive', count: embeddedOpps, note: 'powers hidden-match (beats keyword/NAICS filters)' },
    { key: 'forecasts', label: 'Forecasts (upcoming buys)', source: 'Scraped + unified from 12 agencies', provenance: 'exclusive', count: forecasts, note: '6-18 months before solicitation' },
    { key: 'recompetes', label: 'Recompetes (expiring contracts)', source: 'USASpending awards, our identify/score/resolve', provenance: 'curated', count: recompetes },
    { key: 'pain_points', label: 'Agency pain points', source: 'Hand-curated from GAO / IG / CRS', provenance: 'exclusive', count: pp.painPoints, note: `${pp.agencies} agencies` },
    { key: 'priorities', label: 'Agency spending priorities', source: 'Hand-curated funded programs', provenance: 'exclusive', count: pp.priorities, note: 'where the money is going' },
    { key: 'grants', label: 'Federal grants', source: 'Grants.gov API (live)', provenance: 'passthrough', count: null, note: 'queried live per search' },
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
      // Source-level "trace back" — forecasts broken down by the agency they were
      // scraped from (the registry's per-source record counts).
      sourceTrace: { forecastsByAgency: getRegistrySummary() },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
