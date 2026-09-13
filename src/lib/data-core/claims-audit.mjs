/**
 * C2 — CLAIM / LITERAL GATE, as an IMPORTABLE module.
 *
 * ⚠️ WHY THIS FILE EXISTS. The logic below used to live only at module scope inside
 * `scripts/audit-data-claims.mjs`, so the only way to obtain it was to spawn the
 * script as a process. Platform Health did exactly that:
 *     execFileSync('node', [join(process.cwd(), 'scripts', script), '--json'])
 * Turbopack cannot statically resolve that path and FAILED THE PRODUCTION BUILD —
 * correctly, because a bundled server module reaching into repo CLI files is not a
 * stable production dependency boundary.
 *
 * The fix is the boundary, not the bundler. ONE implementation, TWO consumers:
 *     computeClaimFindings()  ├── src/lib/data-core/integrity-report.ts imports it
 *                             └── scripts/audit-data-claims.mjs is a thin CLI adapter
 *
 * The original principle is PRESERVED and is the whole point of extracting rather
 * than copying: Platform Health must never become a second source of truth, and two
 * classifiers must never be able to drift. There is still exactly one classifier —
 * it simply no longer requires a subprocess to reach it.
 *
 * ⚠️ FAILURE SEMANTICS ARE LOAD-BEARING. When the registry cannot be read, this
 * returns `null` and the caller reports `unmeasured` — never `[]`, never "aligned",
 * never zero. A refactor that turns an unreadable source into an empty-but-happy
 * result is the exact swallowed-default this codebase gates against.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';



const REGISTRY = 'src/lib/data-sources/registry.ts';

/** Strip comments so a fix that QUOTES a literal while explaining it never flags. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Measure live coverage from an in-repo artifact. null when unmeasurable. */
function measureContractorContactCoverage(root) {
  const p = join(root, 'src/data/contractors.json');
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
 * Claims we can mechanically check, each tied to a census finding. Adding an entry
 * requires naming the artifact that measures it — a claim with no measurable source
 * belongs in `unfalsifiable`, not here.
 */
const CHECKS = [
  {
    id: 'contractors-coverage',
    file: REGISTRY,
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

/**
 * THE single C2 classifier.
 *
 * @returns the findings, or `null` when the registry could not be read at all —
 *          which the caller MUST surface as `unmeasured`, never as "no findings".
 */
export function computeClaimFindings(root = process.cwd()) {
  const registryPath = join(root, REGISTRY);
  if (!existsSync(registryPath)) return null;

  let src;
  try {
    src = readFileSync(registryPath, 'utf8');
  } catch {
    return null;   // unreadable source -> unmeasured, NOT an empty pass
  }

  const findings = [];
  const clean = stripComments(src);

  for (const check of CHECKS) {
    const found = check.locate(clean);
    if (!found) continue;
    const measured = check.measure(root);
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

  return findings;
}


const keyOf = (f) => `${f.file}:${f.id}`;

/**
 * Ratchet classification — which findings are NEW debt. Extracted with the
 * classifier so the CLI's exit semantics and Platform Health share one definition.
 */
export function selectNewFindings(findings, baselineFindings) {
  const known = new Map(baselineFindings.map((f) => [keyOf(f), f]));
  const isNew = (f) => !known.has(keyOf(f));
  const worsened = (f) => {
    const prev = known.get(keyOf(f));
    if (!prev) return false;
    // (a) classification got worse
    if (prev.kind !== 'contradicted' && f.kind === 'contradicted') return true;
    // (b) an ALREADY-contradicted claim drifted FURTHER from measurement. Without
    // this, baselining 95%-vs-2.6% would license raising it to 99% for free.
    if (f.kind === 'contradicted' && prev.measured !== null && f.measured !== null) {
      const prevDelta = Math.abs((prev.claimed ?? 0) - prev.measured);
      const nowDelta = Math.abs((f.claimed ?? 0) - f.measured);
      if (nowDelta > prevDelta) return true;
    }
    // (c) the claimed value changed at all on a contradicted entry.
    if (f.kind === 'contradicted' && prev.claimed !== f.claimed) return true;
    return false;
  };
  return findings.filter((f) => isNew(f) || worsened(f));
}
