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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'tests/fixtures/data-claims-baseline.json');
const REGISTRY = 'src/lib/data-sources/registry.ts';

const args = process.argv.slice(2);
const LIST = args.includes('--list');
const UPDATE = args.includes('--update-baseline');
const JSON_OUT = args.includes('--json');

/** Strip comments so a fix that QUOTES a literal while explaining it never flags. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Measure live coverage from an in-repo artifact. Returns null when unmeasurable. */
function measureContractorContactCoverage() {
  const p = join(ROOT, 'src/data/contractors.json');
  if (!existsSync(p)) return null;
  try {
    const rows = JSON.parse(readFileSync(p, 'utf8'));
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const withEmail = rows.filter((r) => (r.email || '').trim()).length;
    const withName = rows.filter((r) => (r.sblo_name || '').trim()).length;
    // The claim is about usable contact coverage; take the most generous field.
    return {
      pct: Math.round((Math.max(withEmail, withName) / rows.length) * 1000) / 10,
      n: rows.length,
      detail: `email ${withEmail}/${rows.length}, sblo_name ${withName}/${rows.length}`,
    };
  } catch { return null; }
}

/**
 * Claims we can mechanically check, each tied to a census finding.
 * Adding an entry requires naming the artifact that measures it — a claim with no
 * measurable source belongs in `unfalsifiable`, not here.
 */
const CHECKS = [
  {
    id: 'contractors-coverage',
    file: REGISTRY,
    // the Contractors DataCategory block
    locate: (src) => {
      const idx = src.indexOf("name: 'Contractors'");
      if (idx === -1) return null;
      const window = src.slice(idx, idx + 400);
      const m = window.match(/coveragePercent:\s*(\d+)/);
      if (!m) return null;
      const line = src.slice(0, idx + window.indexOf(m[0])).split('\n').length;
      return { claimed: Number(m[1]), line };
    },
    measure: measureContractorContactCoverage,
    tolerancePct: 15,
    census: 'Phase 0B class 15 — coveragePercent 95 vs measured 1.2-2.6%',
  },
];

const findings = [];
const src = readFileSync(join(ROOT, REGISTRY), 'utf8');
const clean = stripComments(src);

for (const check of CHECKS) {
  const found = check.locate(clean);
  if (!found) continue;
  const measured = check.measure();
  if (measured === null) {
    findings.push({
      id: check.id, file: check.file, line: found.line, kind: 'unfalsifiable',
      claimed: found.claimed, measured: null,
      detail: 'claim could not be measured against any in-repo artifact',
      census: check.census,
    });
    continue;
  }
  const delta = Math.abs(found.claimed - measured.pct);
  findings.push({
    id: check.id, file: check.file, line: found.line,
    kind: delta > check.tolerancePct ? 'contradicted' : 'pinned',
    claimed: found.claimed, measured: measured.pct,
    detail: `${measured.detail} (n=${measured.n}); claim ${found.claimed}% vs measured ${measured.pct}%`,
    census: check.census,
  });
}

/** Unfalsifiable sweep: coveragePercent literals with no measurable denominator. */
const covMatches = [...clean.matchAll(/coveragePercent:\s*(\d+)/g)];
const checkedLines = new Set(findings.map((f) => f.line));
for (const m of covMatches) {
  const line = clean.slice(0, m.index).split('\n').length;
  if (checkedLines.has(line)) continue;
  findings.push({
    id: `coverage-literal-L${line}`, file: REGISTRY, line, kind: 'unfalsifiable',
    claimed: Number(m[1]), measured: null,
    detail: 'coveragePercent with no defined denominator — no measurement could confirm or refute it',
    census: 'Phase 0C — 9 of 32 literals unfalsifiable by construction',
  });
}

const key = (f) => `${f.file}:${f.id}`;
const baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8'))
  : { findings: [] };
const known = new Map((baseline.findings || []).map((f) => [key(f), f]));

const isNew = (f) => !known.has(key(f));
// A claim that was pinned/unfalsifiable and is now CONTRADICTED is new debt even
// though its key is known — the classification worsened.
const worsened = (f) => {
  const prev = known.get(key(f));
  if (!prev) return false;
  // (a) classification got worse
  if (prev.kind !== 'contradicted' && f.kind === 'contradicted') return true;
  // (b) an ALREADY-contradicted claim drifted FURTHER from measurement. Without
  // this, baselining 95%-vs-2.6% would license raising it to 99% for free —
  // the baseline would become permission to overclaim rather than a record of debt.
  if (f.kind === 'contradicted' && prev.measured !== null && f.measured !== null) {
    const prevDelta = Math.abs((prev.claimed ?? 0) - prev.measured);
    const nowDelta = Math.abs((f.claimed ?? 0) - f.measured);
    if (nowDelta > prevDelta) return true;
  }
  // (c) the claimed value changed at all on a contradicted entry — an edit to a
  // known-false number must be deliberate, never silent.
  if (f.kind === 'contradicted' && prev.claimed !== f.claimed) return true;
  return false;
};

const newFindings = findings.filter((f) => isNew(f) || worsened(f));
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
