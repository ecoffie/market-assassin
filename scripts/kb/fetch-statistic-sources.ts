#!/usr/bin/env tsx
/**
 * Fill the official-statistics register file with each source's own passage (read-only HTTP; no SAM).
 *   npx tsx scripts/kb/fetch-statistic-sources.ts            # fetch + write back into the file
 *   npx tsx scripts/kb/fetch-statistic-sources.ts --check    # fetch, print, write nothing
 * A source is `ok` only when the anchor is found AND every must_contain string is inside the cut passage;
 * otherwise `fetch_failed` with the reason. The row is never dropped.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { cutPassage, fetchDoc } from './fetch-rule-sources';

const FILE = 'docs/knowledge/official-statistics-2026-11-28.json';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function main() {
  const check = process.argv.includes('--check');
  const doc = JSON.parse(readFileSync(FILE, 'utf8'));
  const now = new Date().toISOString();
  for (const row of doc.rows) {
    for (const s of row.sources) {
      const d = await fetchDoc(s.url);
      if (d.error || !d.text) { Object.assign(s, { fetch_status: 'fetch_failed', passage: null, fetched_at: now, fetch_error: d.error ?? 'empty document' }); }
      else {
        const cut = cutPassage(d.text, (s.anchors as string[]).map((a) => new RegExp(esc(a), 'i')));
        const passage = cut[0] ?? null;
        const missing = passage ? (s.must_contain as string[]).filter((m) => !passage.includes(m)) : s.must_contain;
        Object.assign(s, passage && !missing.length
          ? { fetch_status: 'ok', passage, fetched_at: now, fetch_error: null }
          : { fetch_status: 'fetch_failed', passage: null, fetched_at: now, fetch_error: passage ? `passage lacks: ${missing.join(', ')}` : 'anchor not found in the document' });
      }
      console.log(`${row.claim_id} ${s.fetch_status} ${s.url}${s.fetch_error ? ` — ${s.fetch_error}` : ''}`);
    }
  }
  if (check) return;
  doc.checked_on = now.slice(0, 10);
  writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`wrote ${FILE}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
