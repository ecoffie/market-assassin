#!/usr/bin/env -S npx tsx
/**
 * SBLO refresh importer — CLI wrapper. All logic lives in src/lib/gov-contacts/sblo-refresh.ts.
 *
 *   npx tsx scripts/import-sblo-refresh.ts --csv data/imports/sblo-refresh-<YYYY-MM>.csv
 *       → DIFF ONLY (default): per-company, per-field report (readable + JSON). Writes nothing.
 *   npx tsx scripts/import-sblo-refresh.ts --csv <path> --write --out src/data/sblo-roster-<YYYY-MM>.json
 *       → writes a NEW roster file (never the base). Refused while any field is rejected.
 *   ... --write --out <path> --merge-prime-db
 *       → also applies the same rules to matched rows of prime-contractors-database.json.
 *
 * There is NO default CSV. This tool does not research anything; it applies a hand-researched
 * CSV under rules that never make the data less verified (see sblo-refresh.ts header).
 * Do NOT run ~/Bootcamp/compile-sblo-list.py — superseded regex scraper.
 * (Replaces scripts/import-sblo-refresh.js, which hardcoded data/imports/sblo-refresh-2026-06.csv.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { runSbloImport } from '../src/lib/gov-contacts/sblo-refresh';

const ROOT = path.join(__dirname, '..');
const abs = (p: string) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

process.exitCode = runSbloImport(process.argv.slice(2), {
  readFile: (p) => fs.readFileSync(abs(p), 'utf8'),
  writeFile: (p, c) => fs.writeFileSync(abs(p), c),
  exists: (p) => fs.existsSync(abs(p)),
  resolve: (p) => path.resolve(abs(p)),
  log: (l) => console.log(l),
  error: (l) => console.error(l),
});
