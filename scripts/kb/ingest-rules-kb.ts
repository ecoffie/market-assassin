#!/usr/bin/env tsx
/**
 * Load the rules KB into kb_rule_claims (migration 20261127_kb_rule_claims.sql). DRY BY DEFAULT.
 *
 *   npx tsx scripts/kb/ingest-rules-kb.ts          # dry run: parse + merge, print counts and a sample row
 *   npx tsx scripts/kb/ingest-rules-kb.ts --go     # upsert by claim_id (16 rows today)
 *
 * Reads only committed files: the rules file and the fetched-sources snapshot. Never re-fetches, never calls SAM.
 * A KB write: show the dry run and get the go-ahead before --go (CLAUDE.md rule 11).
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { buildRegisterRows, parseRulesKb, RULES_KB_DOC, type SourcesSnapshot } from '../../src/lib/knowledge/rules-kb';

const SNAPSHOT = 'docs/knowledge/how-government-buys-now-2026-11-27.sources.json';

async function main() {
  const go = process.argv.includes('--go');
  const entries = parseRulesKb(readFileSync(RULES_KB_DOC, 'utf8'));
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as SourcesSnapshot;
  const rows = buildRegisterRows(entries, snapshot);

  const srcs = rows.flatMap((r) => r.sources);
  const count = (f: (s: (typeof srcs)[number]) => boolean) => srcs.filter(f).length;
  console.log(`rows to upsert: ${rows.length} (claim_id ${rows[0].claim_id}…${rows.at(-1)!.claim_id})`);
  console.log(`  verified=false: ${rows.filter((r) => !r.verified).length} (${rows.filter((r) => !r.verified).map((r) => r.claim_id).join(', ')})`);
  console.log(`  status: ${Object.entries(rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {})).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  legal_status: ${Object.entries(rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.legal_status]: (a[r.legal_status] ?? 0) + 1 }), {})).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  sources: ${srcs.length} (official ok ${count((s) => s.kind !== 'secondary' && s.fetch_status === 'ok')}, fetch_failed ${count((s) => s.fetch_status === 'fetch_failed')}, secondary not fetched ${count((s) => s.fetch_status === 'not_fetched_secondary')})`);
  const sample = rows.find((r) => r.claim_id === 'KB-6')!;
  console.log('\nsample row (KB-6):', JSON.stringify({ ...sample, search_text: `${sample.search_text.length} chars`, sources: sample.sources.map((s) => ({ ...s, passage: s.passage ? `${s.passage.slice(0, 120)}…` : null })) }, null, 2));

  if (!go) { console.log('\nDRY RUN — nothing written. Re-run with --go after approval.'); return; }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  const db = createClient(url, key);
  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    claim_id: r.claim_id, kb_doc: r.kb_doc, entry_no: r.entry_no, part: r.part, claim: r.claim,
    change: r.change, source_text: r.source_text, status_text: r.status_text, affects: r.affects,
    common_mistake: r.common_mistake, how_to_use: r.how_to_use, practice_text: r.practice_text,
    sources: r.sources, legal_status: r.legal_status, effective_date: r.effective_date, verified: r.verified,
    caveats: r.caveats, verified_on: r.verified_on, recheck_interval_days: r.recheck_interval_days, status: r.status,
    supersedes: r.supersedes, superseded_by: r.superseded_by, notes: r.notes, search_text: r.search_text, updated_at: now,
  }));
  const { error } = await db.from('kb_rule_claims').upsert(payload, { onConflict: 'claim_id' });
  if (error) throw new Error(`upsert failed: ${error.message}`);
  // Verify against the table, not the client's "ok".
  const { count: n, error: cErr } = await db.from('kb_rule_claims').select('claim_id', { count: 'exact', head: true }).eq('kb_doc', RULES_KB_DOC);
  if (cErr) throw new Error(`verify read failed: ${cErr.message}`);
  console.log(`\nupserted ${payload.length}; table now holds ${n} rows for ${RULES_KB_DOC}`);
  if (n !== rows.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
