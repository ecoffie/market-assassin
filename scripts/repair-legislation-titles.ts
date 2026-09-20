/**
 * PHASE 2 — repair legislative titles from AUTHORITATIVE SOURCE.
 *
 * The tracking path re-decorated an already-decorated title once per run, so titles
 * grew by one ` [HR 5180 — Introduced in House]` per execution. Identity, URL, dates,
 * raw data and attribution were never affected — only `title`.
 *
 * ⚠️ THE CANONICAL TITLE COMES FROM CONGRESS, NOT FROM DELETING REPEATED TEXT.
 * We re-fetch each measure and rebuild the title the same way an insert would. String
 * surgery on the polluted value is the FALLBACK only when the source cannot be
 * reached, and any such row is reported rather than silently accepted.
 *
 * Writes `title` ONLY. Never document_number, source_type, url, dates, raw, agency.
 *
 * DRY RUN BY DEFAULT.
 *   npx tsx scripts/repair-legislation-titles.ts        # enumerate, write nothing
 *   npx tsx scripts/repair-legislation-titles.ts --go   # apply
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { knownMeasures } from '../src/lib/institute/legislation-discovery';
import { collectBillDocuments } from '../src/lib/institute/legislation';

config({ path: '.env.local' });
const GO = process.argv.includes('--go');
const TYPES = ['introduced_bill', 'enacted_law', 'committee_report'];

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: rows, error } = await db
    .from('institute_sources')
    // unranged-ok: bounded by range(); legislative corpus is small.
    .select('id, source_type, document_number, title')
    .in('source_type', TYPES)
    .order('document_number')
    .range(0, 999);
  if (error) { console.error('read failed — refusing to guess:', error.message); process.exit(1); }
  const corpus = rows ?? [];

  // Rebuild every document from AUTHORITATIVE source.
  const { measures, error: kmErr } = await knownMeasures(db, 119);
  if (kmErr) { console.error('knownMeasures failed:', kmErr); process.exit(1); }
  const canonical = new Map<string, string>();
  for (const ref of measures) {
    const { documents } = await collectBillDocuments(ref);
    for (const d of documents) canonical.set(`${d.sourceType}::${d.documentNumber}`, d.title);
  }

  const plan = corpus.map((r) => {
    const key = `${r.source_type}::${r.document_number}`;
    const expected = canonical.get(key) ?? null;
    return {
      document_number: r.document_number as string,
      id: r.id as string,
      current: r.title as string,
      expected,
      needsRepair: expected !== null && expected !== r.title,
      unresolvable: expected === null,
    };
  });

  const hdr = `${'document_number'.padEnd(24)}${'needs repair'.padEnd(14)}cur/exp suffix count`;
  console.log(hdr); console.log('-'.repeat(hdr.length + 20));
  const count = (t: string | null) => (t ? (t.match(/\s\[[^\]]+ — [^\]]+\]/g) ?? []).length : 0);
  for (const p of plan) {
    const flag = p.unresolvable ? 'UNRESOLVABLE' : p.needsRepair ? 'YES' : 'no';
    console.log(`${p.document_number.padEnd(24)}${flag.padEnd(14)}${count(p.current)} -> ${count(p.expected)}`);
  }

  const toRepair = plan.filter((p) => p.needsRepair);
  const unresolvable = plan.filter((p) => p.unresolvable);
  console.log(`\n  corpus rows        : ${plan.length}`);
  console.log(`  need repair        : ${toRepair.length}`);
  console.log(`  already canonical  : ${plan.length - toRepair.length - unresolvable.length}`);
  console.log(`  UNRESOLVABLE       : ${unresolvable.length}  ${unresolvable.length ? '(source unreachable — NOT repaired by string surgery)' : ''}`);

  if (!GO) { console.log('\n  DRY RUN — nothing written.'); return; }

  let updated = 0, failed = 0;
  for (const p of toRepair) {
    // title ONLY — no identity, url, date, raw or attribution column is touched.
    const { error: upd } = await db.from('institute_sources')
      .update({ title: p.expected, updated_at: new Date().toISOString() })
      .eq('id', p.id);
    if (upd) { failed++; console.error(`  FAILED ${p.document_number}: ${upd.message}`); } else updated++;
  }
  console.log(`\n  updated: ${updated}  failed: ${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
