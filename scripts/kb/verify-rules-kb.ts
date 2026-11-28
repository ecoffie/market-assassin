#!/usr/bin/env tsx
/**
 * Post-ingest verification against the LIVE register (read-only): row count, every official passage present, and the
 * five acceptance queries return the right entry with its source and status.
 *
 *   npx tsx scripts/kb/verify-rules-kb.ts
 */
import { createClient } from '@supabase/supabase-js';
import { searchRuleClaims, readRuleRegister } from '../../src/lib/knowledge/rules-kb-db';

const QUERIES: Array<[string, string]> = [
  ['order of precedence set-aside', 'KB-1'],
  ['simplified acquisition threshold', 'KB-6'],
  ['SDVOSB sole source limit', 'KB-6'],
  ['Portfolio Acquisition Executive', 'KB-11'],
  ['VA Rule of Two Kingdomware', 'KB-4'],
];

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const read = await readRuleRegister(db);
  if (!read.ok) throw new Error(`register unreadable: ${read.error}`);
  let fail = 0;
  console.log(`rows: ${read.rows.length} (expect 41: 16 rules + 24 Fix 1C rows + 1 official statistic)`); if (read.rows.length !== 41) fail++;
  const missing = read.rows.flatMap((r) => r.sources.filter((s) => s.kind !== 'secondary' && !s.passage).map((s) => `${r.claim_id} ${s.url}`));
  console.log(`official sources without a passage: ${missing.length}`); missing.forEach((m) => console.log(`  ${m}`)); if (missing.length) fail++;
  for (const [q, want] of QUERIES) {
    const r = await searchRuleClaims(db, q, 1);
    const top = r.status === 'found' ? r.claims[0] : null;
    const ok = top?.claim_id === want && top.sources.length > 0 && !!top.legal_status;
    console.log(`${ok ? 'PASS' : 'FAIL'}  "${q}" → ${top?.claim_id ?? r.status} (${top?.legal_status ?? '-'}, ${top?.status ?? '-'}, ${top?.sources.length ?? 0} sources)`);
    if (!ok) fail++;
  }
  process.exitCode = fail ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
