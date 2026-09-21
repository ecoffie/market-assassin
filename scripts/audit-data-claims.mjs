#!/usr/bin/env node
/**
 * C2 — CLAIM / LITERAL GATE (Data Core Controls, Phase 1)
 *
 * Census trace: Phase 0B class 15 — `src/lib/data-sources/registry.ts:203` hardcodes
 * `coveragePercent: 95` for the Contractors dataset while measured contact coverage
 * in `src/data/contractors.json` is 1.2-2.6%. Phase 0C measured all 32 literals in
 * that file: 18 match live exactly, 5 are contradicted, 9 are unfalsifiable (no
 * defined denominator). Phase 0B class 13: the /contractors page title claims
 * "290,000+" while its body renders ~2,710 from a static JSON fallback.
 *
 * ROOT CAUSE (established in the controls plan): registry.ts's own header says
 * "Update coverage: Run /api/admin/data-health to recalculate" — that route only
 * READS the registry and never assigns coveragePercent. The literal cannot
 * self-correct and the file claims it can.
 *
 * WHAT THIS GATE DOES: classifies each numeric dataset claim as
 *   derived        — computed from live data at runtime (ideal; never flagged)
 *   pinned         — static but carries evidence (a measured-on date / source note)
 *   unfalsifiable  — no defined denominator, so no measurement could confirm it
 *   contradicted   — measurably wrong against an artifact in-repo
 *
 * SCOPE (deliberately narrow, per the controls plan): only literals that are BOTH
 * a numeric claim about a dataset AND reachable by customer-visible or
 * decision-relevant behaviour. Comments, docs, tests, fixtures, timestamps and UI
 * constants are NOT flagged — noise is what makes a ratchet get rubber-stamped.
 *
 * Ratchet model matches the sibling gates (audit-supabase-errors, audit-rank-then-filter):
 * existing debt is baselined and visible; anything NEW fails the push. A KNOWN
 * CONTRADICTION IS NEVER SILENTLY BASELINED — contradicted findings are always
 * printed, and the baseline records them as acknowledged debt with their measured
 * delta, so "green" never means "nothing is wrong here."
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── THIN CLI ADAPTER ────────────────────────────────────────────────────────
// The classifier itself now lives in src/lib/data-core/claims-audit.ts so that
// Platform Health can IMPORT it instead of spawning this file as a subprocess.
// That subprocess call (execFileSync on a dynamic scripts/ path) broke the
// production Turbopack build — a bundled server module must not reach into repo
// CLI files. ONE implementation, TWO consumers; this file is now consumer #2.
import { computeClaimFindings, selectNewFindings } from '../src/lib/data-core/claims-audit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'tests/fixtures/data-claims-baseline.json');

const args = process.argv.slice(2);
const LIST = args.includes('--list');
const UPDATE = args.includes('--update-baseline');
const JSON_OUT = args.includes('--json');

const findings = computeClaimFindings(ROOT);

// An unreadable source is UNMEASURED, never an empty pass.
if (findings === null) {
  if (JSON_OUT) { console.log(JSON.stringify({ findings: null, newFindings: [], contradicted: [], state: 'unmeasured' }, null, 2)); process.exit(1); }
  console.error('[data-claims] UNMEASURED — could not read src/lib/data-sources/registry.ts');
  process.exit(1);
}

const baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8'))
  : { findings: [] };

const newFindings = selectNewFindings(findings, baseline.findings || []);
const contradicted = findings.filter((f) => f.kind === 'contradicted');

if (JSON_OUT) {
  console.log(JSON.stringify({ findings, newFindings, contradicted }, null, 2));
  process.exit(newFindings.length ? 1 : 0);
}

if (LIST) {
  for (const f of findings) {
    console.log(`${f.kind.toUpperCase().padEnd(14)} ${f.file}:${f.line}  ${f.id}`);
    console.log(`               ${f.detail}`);
    console.log(`               census: ${f.census}`);
  }
}

if (UPDATE) {
  writeFileSync(BASELINE, `${JSON.stringify({
    note: 'C2 claim/literal gate baseline. Contradicted entries are ACKNOWLEDGED DEBT, '
      + 'not accepted truth — they are always printed and must be resolved by a product '
      + 'decision, never by re-baselining.',
    updated: new Date().toISOString().slice(0, 10),
    findings: findings.map((f) => ({ file: f.file, id: f.id, kind: f.kind, claimed: f.claimed, measured: f.measured })),
  }, null, 2)}\n`);
  console.log(`[data-claims] baseline updated — ${findings.length} finding(s) recorded.`);
  process.exit(0);
}

// A contradicted claim is ALWAYS reported, baselined or not.
for (const f of contradicted) {
  console.log(`\x1b[33m[data-claims] CONTRADICTED\x1b[0m ${f.file}:${f.line} — ${f.detail}`);
  console.log(`               ${f.census}`);
}

if (newFindings.length) {
  console.error(`\x1b[31m[data-claims] ${newFindings.length} NEW claim finding(s) — push blocked.\x1b[0m`);
  for (const f of newFindings) console.error(`  ${f.kind} ${f.file}:${f.line} ${f.detail}`);
  console.error('  Fix the claim (derive it from live data), or --update-baseline deliberately.');
  process.exit(1);
}

console.log(`[data-claims] OK — no new claim drift (${findings.length} baseline-known, `
  + `${contradicted.length} contradicted and acknowledged).`);
