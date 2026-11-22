#!/usr/bin/env node
/**
 * Print the combined repair ledger: per-entry files in docs/repair-ledger/ (newest first), then the
 * frozen archive docs/REPAIR-LEDGER.md. Output goes to stdout and is NOT committed.
 *   npm run ledger:render            # combined markdown
 *   npm run ledger:render -- --rows  # table rows only (one per line), newest entries first
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLedger } from './lib/ledger-sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { archive, entries } = readLedger(ROOT);
const newestFirst = [...entries].reverse();
const isRow = (l) => l.startsWith('|') && !/^\|\s*Date\s*\|/.test(l) && !/^\|[-\s|]+\|$/.test(l);

if (process.argv.includes('--rows')) {
  for (const e of newestFirst) for (const l of e.md.split('\n')) if (isRow(l)) console.log(l);
  for (const l of archive.split('\n')) if (isRow(l)) console.log(l);
} else {
  console.log(`# Repair ledger (combined view — generated, not committed)\n`);
  console.log(`## Entries (docs/repair-ledger/, newest first) — ${entries.length}\n`);
  for (const e of newestFirst) console.log(`<!-- ${e.path} -->\n${e.md.trim()}\n`);
  console.log(`## Archive (docs/REPAIR-LEDGER.md, frozen)\n`);
  console.log(archive);
}
