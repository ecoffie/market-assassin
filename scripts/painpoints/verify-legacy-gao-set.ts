/**
 * READ-ONLY. Recompute the "(Source: GAO)" legacy pain-point set from the served
 * JSON + `agency_intelligence`, and print/emit the exact list with its GovInfo
 * source (package id, date, URL).
 *
 *   npx tsx scripts/painpoints/verify-legacy-gao-set.ts            # summary
 *   npx tsx scripts/painpoints/verify-legacy-gao-set.ts --list     # every row
 *   npx tsx scripts/painpoints/verify-legacy-gao-set.ts --write-archive
 *       → writes src/data/agency-pain-points-historical-gao-1993-2000.json
 *         (a local file — never the served JSON, never the database)
 *
 * Database access is SELECT only. The served JSON is read, never written.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractLegacyGaoTagged,
  legacySetHash,
  matchLegacyToGovinfo,
  type GovinfoGaoRow,
  type PainPointJson,
} from '../../src/lib/strategic-intel/legacy-gao-painpoints';

const ROOT = resolve(__dirname, '../..');
config({ path: resolve(ROOT, '.env.local'), quiet: true });

const SERVED = resolve(ROOT, 'src/data/agency-pain-points.json');
const ARCHIVE = resolve(ROOT, 'src/data/agency-pain-points-historical-gao-1993-2000.json');

async function loadGovinfoRows(): Promise<GovinfoGaoRow[]> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const rows: GovinfoGaoRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('agency_intelligence')
      .select('agency_name,title,publication_date,source_url,source_document')
      .eq('intelligence_type', 'gao_high_risk')
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`agency_intelligence read failed: ${error.message}`);
    rows.push(...((data ?? []) as GovinfoGaoRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const json = JSON.parse(readFileSync(SERVED, 'utf8')) as PainPointJson;
  const tagged = extractLegacyGaoTagged(json);
  const rows = await loadGovinfoRows();
  const archived = matchLegacyToGovinfo(tagged, rows);

  const years: Record<string, number> = {};
  for (const a of archived) {
    const y = a.source?.publication_date?.slice(0, 4) ?? 'unmatched';
    years[y] = (years[y] ?? 0) + 1;
  }
  const dates = archived.map((a) => a.source?.publication_date).filter((d): d is string => !!d).sort();
  const summary = {
    served_file: 'src/data/agency-pain-points.json',
    tagged_count: tagged.length,
    unique_texts: new Set(tagged.map((t) => t.text)).size,
    agencies: new Set(tagged.map((t) => t.agency)).size,
    set_hash: legacySetHash(tagged),
    govinfo_rows_read: rows.length,
    matched: archived.filter((a) => a.match_method !== 'unmatched').length,
    exact_title: archived.filter((a) => a.match_method === 'exact_title').length,
    title_prefix: archived.filter((a) => a.match_method === 'title_prefix').length,
    ambiguous_multi_document: archived.filter((a) => a.alternate_sources.length > 0).length,
    agency_not_in_source_rows: archived.filter((a) => a.match_method !== 'unmatched' && !a.agency_matches_source_row).length,
    // The upstream extractor filed one report under every agency whose name it found
    // as a substring, so a report under several agencies is a misattribution signal.
    source_filed_under_multiple_agencies: archived.filter((a) => a.source_row_agencies.length > 1).length,
    earliest_publication: dates[0] ?? null,
    latest_publication: dates[dates.length - 1] ?? null,
    by_year: years,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (args.has('--list')) {
    for (const a of archived) {
      console.log([a.agency, a.source?.source_document ?? '-', a.source?.publication_date ?? '-',
        a.source?.source_url ?? '-', a.text].join('\t'));
    }
  }

  if (args.has('--write-archive')) {
    if (ARCHIVE === SERVED) throw new Error('refusing: archive path equals the served file');
    const doc = {
      _about: {
        what: 'HISTORICAL ARCHIVE — NOT SERVED. The pain points in src/data/agency-pain-points.json tagged "(Source: GAO)", each traced to the GovInfo GAOREPORTS document it was copied from.',
        why: 'Data Core audit 2026-11-17: every one is a GAO document published 1993-2000, copied via agency_intelligence (gao_high_risk, mislabeled fiscal_year 2026). Agency attribution is INHERITED from agency_intelligence, whose extractor matched agency names as substrings — so a served agency agreeing with its source row is not evidence the attribution is right (e.g. an NLRB strategic-plan testimony filed under Veterans Affairs in both places). source_row_agencies lists every agency the same document was filed under.',
        status: 'The served JSON still contains these strings unchanged. Retirement requires a separate approval.',
        generated_by: 'npx tsx scripts/painpoints/verify-legacy-gao-set.ts --write-archive',
        generated_at: new Date().toISOString().slice(0, 10),
        current_gao_high_risk_edition: 'GAO-25-107743 (February 2025) — https://www.gao.gov/high-risk-list',
      },
      summary,
      items: archived,
    };
    writeFileSync(ARCHIVE, JSON.stringify(doc, null, 1) + '\n');
    console.error(`wrote ${archived.length} items → ${ARCHIVE}`);
  }

  if (summary.matched !== summary.tagged_count) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
