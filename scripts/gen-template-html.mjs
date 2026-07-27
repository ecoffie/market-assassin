#!/usr/bin/env node
/**
 * Generate src/app/opportunity-map/template-html.ts from template.html.
 *
 * The map route serves template-html.ts (OPPORTUNITY_MAP_TEMPLATE), NOT template.html directly —
 * so the two MUST stay byte-identical or template.html edits silently never ship (they were found
 * out of sync at HEAD on 2026-07-27, the .ts missing content). This is the single source of the
 * escaped string: run it after any template.html edit. `--check` verifies sync (for the pre-push
 * gate) without writing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/app/opportunity-map');
const HTML = join(DIR, 'template.html');
const TS = join(DIR, 'template-html.ts');
const CHECK = process.argv.includes('--check');

const html = readFileSync(HTML, 'utf8');
const header =
  '// AUTO-GENERATED from template.html — Eric\'s evc-opportunity-map, served verbatim with live data.\n'
  + '// To edit the map UI, edit template.html then run: node scripts/gen-template-html.mjs\n'
  + '// Contains an __OPPS_JSON__ placeholder. DO NOT hand-edit this file — the pre-push gate checks sync.\n';
const out = `${header}export const OPPORTUNITY_MAP_TEMPLATE = ${JSON.stringify(html)};\n`;

if (CHECK) {
  const cur = readFileSync(TS, 'utf8');
  if (cur.trimEnd() === out.trimEnd()) { console.log('✓ template-html.ts in sync with template.html'); process.exit(0); }
  console.error('✗ template-html.ts is OUT OF SYNC with template.html.');
  console.error('  The map serves the .ts, so template.html edits will NOT ship until you run:');
  console.error('    node scripts/gen-template-html.mjs');
  process.exit(1);
}

writeFileSync(TS, out);
console.log(`✓ wrote template-html.ts (${out.length} bytes) from template.html`);
