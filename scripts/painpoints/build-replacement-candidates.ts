/**
 * Build PROPOSED replacement pain points from current GAO evidence.
 * DRY-RUN BY DEFAULT. Never writes the served JSON, never writes the database.
 *
 *   npx tsx scripts/painpoints/build-replacement-candidates.ts           # dry-run summary
 *   npx tsx scripts/painpoints/build-replacement-candidates.ts --write   # also writes the proposal file
 *        → tasks/painpoints-replacement-candidates-2026-11-17.json (default; --out=<path> to change;
 *          any path under src/ or equal to the served JSON is refused)
 *
 * Sources: (a) data/gao/high-risk-list-GAO-25-107743.json (curated area→agency table);
 *          (b) institute_sources GAO reports (SELECT only).
 * Also reads agency_pain_points_db (SELECT only) to mark candidates that the
 * shared sourced reader ALREADY serves, so they are not counted as new gains.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertProposedOutputPath,
  highRiskCandidates,
  instituteCandidates,
  partitionCandidates,
  type HighRiskList,
  type InstituteGaoRow,
} from '../../src/lib/strategic-intel/painpoint-replacement';

const ROOT = resolve(__dirname, '../..');
config({ path: resolve(ROOT, '.env.local'), quiet: true });

const DEFAULT_OUT = 'tasks/painpoints-replacement-candidates-2026-11-17.json';

async function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const outArg = argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? DEFAULT_OUT;
  const outPath = assertProposedOutputPath(outArg, ROOT); // fail fast even on a dry run

  const list = JSON.parse(readFileSync(resolve(ROOT, 'data/gao/high-risk-list-GAO-25-107743.json'), 'utf8')) as HighRiskList;
  const hr = highRiskCandidates(list);

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: inst, error: instErr } = await sb
    .from('institute_sources')
    .select('id,source_org,source_type,document_number,title,source_url,publication_date,canonical_agency,resolution_method')
    .eq('source_org', 'GAO')
    .order('publication_date', { ascending: false })
    .limit(5000);
  if (instErr) throw new Error(`institute_sources read failed: ${instErr.message}`);
  const instRows = (inst ?? []) as InstituteGaoRow[];

  const { data: living, error: livErr } = await sb
    .from('agency_pain_points_db')
    .select('agency,source,source_url,institute_source_ids')
    .eq('source', 'gao')
    .limit(5000);
  if (livErr) throw new Error(`agency_pain_points_db read failed: ${livErr.message}`);
  const livingIds = new Set((living ?? []).flatMap((r: { institute_source_ids: string[] | null }) => r.institute_source_ids ?? []));

  const all = [...hr.candidates, ...instituteCandidates(instRows)];
  const { accepted, rejected } = partitionCandidates(all);
  const annotated = accepted.map((c) => ({
    ...c,
    already_served_living: !!c.institute_source_id && livingIds.has(c.institute_source_id),
  }));

  const count = <T>(xs: T[], k: (x: T) => string) =>
    xs.reduce<Record<string, number>>((m, x) => { m[k(x)] = (m[k(x)] ?? 0) + 1; return m; }, {});
  const summary = {
    mode: write ? 'write-proposal' : 'dry-run',
    high_risk: {
      document_number: list._about.document_number,
      areas: list.areas.length,
      mapped_candidates: hr.candidates.length,
      unmapped_areas: hr.unmappedAreas.length,
      unmapped_by_basis: count(hr.unmappedAreas, (a) => a.mapping_basis),
    },
    institute: {
      gao_rows_read: instRows.length,
      by_resolution_method: count(instRows, (r) => r.resolution_method ?? 'null'),
      earliest: instRows.map((r) => r.publication_date).filter(Boolean).sort()[0] ?? null,
      latest: instRows.map((r) => r.publication_date).filter(Boolean).sort().slice(-1)[0] ?? null,
    },
    accepted: annotated.length,
    accepted_by_origin: count(annotated, (c) => c.origin),
    accepted_requires_review: annotated.filter((c) => c.requires_review).length,
    accepted_already_served_living: annotated.filter((c) => c.already_served_living).length,
    accepted_agencies: new Set(annotated.map((c) => c.agency)).size,
    rejected: rejected.length,
    rejected_by_reason: count(rejected, (r) => r.reason),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (write) {
    const doc = {
      _about: {
        what: 'PROPOSED replacement pain points — NOT SERVED, NOT ADOPTED. Adoption into src/data/agency-pain-points.json requires Eric\'s separate approval.',
        generated_by: 'npx tsx scripts/painpoints/build-replacement-candidates.ts --write',
        generated_at: new Date().toISOString().slice(0, 10),
        guards: 'no pre-2001 source · https URL required · GAO document number required · agency must resolve exactly to a canonical toptier name; substring-derived agencies refused',
      },
      summary,
      unmapped_high_risk_areas: hr.unmappedAreas,
      candidates: annotated,
      rejected,
    };
    writeFileSync(outPath, JSON.stringify(doc, null, 1) + '\n');
    console.error(`wrote proposal → ${outPath}`);
  } else {
    console.error(`dry-run: nothing written (pass --write to emit ${outArg})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
