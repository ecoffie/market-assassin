#!/usr/bin/env node
/**
 * audit-persist-expansion — blocks the NAICS-blow-out bug class at its SOURCE.
 *
 * THE BUG: a PERSIST path (code writing a user-owned taxonomy array to their
 * profile) calls a QUERY-TIME expander. Query-time expansion is CORRECT for
 * matching — broad recall finds more opportunities. STORING that expansion is a
 * bug: one click on the "Professional Services" preset (`['541']`) persisted all
 * 51 codes of the 541 family. It ran ~4 months and corrupted 1,144 profiles, and
 * every unit test passed the whole time — the expander was correct, it was just
 * called in the wrong PLACE.
 *
 * THE RULE: a statement writing a user-owned taxonomy field
 * (naics_codes / psc_codes / keywords / agencies) into user_notification_settings
 * or user_business_profiles must take its value from a normalize/persist helper
 * (normalizeNAICSForPersist and friends) — never straight from expandNAICSCodes,
 * expandNaicsPrefixes, or naicsSubsectorPrefixes.
 *
 * WHY A GATE AND NOT A DOC: the persist-vs-query rule is already written in
 * CLAUDE.md and tasks/lessons.md. Rules in prose get re-derived wrong by the next
 * person (or the next session) six months later. The MCP tool-catalog check became
 * a gate for exactly this reason — "one fix = every surface" was read and violated
 * anyway.
 *
 * Baseline-gated like its siblings: pre-existing sites are recorded as "known" and
 * never block a push; only NEW ones fail. Drive the baseline toward zero. Accept an
 * intentional change with --update-baseline.
 *
 * Self-test: `node scripts/audit-persist-expansion.mjs --self-test` reintroduces
 * the original 2026-07 bug in-memory and asserts the gate CATCHES it. The first
 * draft of this script matched line-by-line and silently missed the real bug
 * (a 4-line ternary), so the detector is itself under test.
 *
 * Exit 0 = clean (or only known sites). Exit 1 = a NEW violation → push blocked.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const BASELINE_FILE = join(ROOT, 'scripts/.persist-expansion-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');
const SELF_TEST = process.argv.includes('--self-test');

/** Expanders that are correct for QUERY, wrong for PERSIST. */
const QUERY_EXPANDERS = ['expandNAICSCodes', 'expandNaicsPrefixes', 'naicsSubsectorPrefixes'];

/** User-owned taxonomy fields whose stored value defines what a user is matched on. */
const TAXONOMY_FIELDS = ['naics_codes', 'psc_codes', 'keywords', 'agencies'];

/** Tables holding a user's own targeting config. */
const PROFILE_TABLES = ['user_notification_settings', 'user_business_profiles'];

/**
 * Scan one file's source for persist-path violations.
 * Exported shape so --self-test can drive it without touching disk.
 */
function scanSource(src, rel) {
  const found = [];
  if (!PROFILE_TABLES.some((t) => src.includes(t))) return found;
  if (!QUERY_EXPANDERS.some((e) => src.includes(e))) return found;

  const lines = src.split('\n');
  // Blank comment lines so prose ABOUT an expander can't false-positive — the
  // fixed code explains this very bug in a comment directly above the fix.
  const code = lines
    .map((l) => (l.trim().startsWith('//') || l.trim().startsWith('*') ? '' : l))
    .join('\n');

  // Variables assigned from a query-time expander. MUST be statement-scoped, not
  // line-scoped: the real-world shape spans several lines —
  //     const expandedNaicsCodes = rawNaicsCodes.length === 0
  //       ? []
  //       : precise
  //         ? Array.from(new Set(rawNaicsCodes))
  //         : expandNAICSCodes(rawNaicsCodes, false);   <-- 4 lines below the const
  // A line-by-line matcher misses exactly the bug this gate exists to catch.
  const tainted = new Map(); // varName -> 1-based line of the assignment
  const declRe = /(?:const|let|var)\s+(\w+)\s*=/g;
  let dm;
  while ((dm = declRe.exec(code)) !== null) {
    const varName = dm[1];
    const rest = code.slice(dm.index, dm.index + 800);
    const semi = rest.indexOf(';');
    const stmt = semi === -1 ? rest : rest.slice(0, semi);
    if (QUERY_EXPANDERS.some((e) => new RegExp(`\\b${e}\\s*\\(`).test(stmt))) {
      tainted.set(varName, code.slice(0, dm.index).split('\n').length);
    }
  }
  if (tainted.size === 0) return found;

  const codeLines = code.split('\n');
  codeLines.forEach((line, i) => {
    for (const field of TAXONOMY_FIELDS) {
      // BOTH payload shapes occur in this codebase and both must be caught:
      //   object literal   →  { naics_codes: expandedNaicsCodes }
      //   property assign  →  updateData.naics_codes = expandedNaicsCodes;
      // The first draft matched only the colon form and therefore missed the real
      // /api/app/profile bug, which uses the assignment form.
      const assign =
        line.match(new RegExp(`\\b${field}\\s*:\\s*([^,}]+)`)) ||
        line.match(new RegExp(`\\.${field}\\s*=\\s*([^;]+)`));
      if (!assign) continue;
      const value = assign[1];

      const directCall = QUERY_EXPANDERS.find((e) => value.includes(`${e}(`));
      const taintedVar = [...tainted.keys()].find((v) => new RegExp(`\\b${v}\\b`).test(value));
      if (!directCall && !taintedVar) continue;

      found.push({
        key: `${rel}:${i + 1}`,
        file: rel,
        line: i + 1,
        field,
        via: directCall || `${taintedVar} (assigned line ${tainted.get(taintedVar)})`,
        snippet: lines[i].trim().slice(0, 110),
      });
    }
  });
  return found;
}

// ── self-test: prove the detector catches the ACTUAL historical bug ────────────
if (SELF_TEST) {
  const buggy = `
    import { expandNAICSCodes } from '@/lib/utils/naics-expansion';
    const rawNaicsCodes = body.naicsCodes ?? [];
    const expandedNaicsCodes = rawNaicsCodes.length === 0
      ? []
      : precise
        ? Array.from(new Set(rawNaicsCodes))
        : expandNAICSCodes(rawNaicsCodes, false);
    const updateData = {};
    updateData.naics_codes = expandedNaicsCodes;
    await supabase.from('user_notification_settings').update(updateData);
  `;
  const fixed = buggy.replace('expandNAICSCodes(rawNaicsCodes, false)', 'normalizeNAICSForPersist(rawNaicsCodes)');

  const caught = scanSource(buggy, 'SELFTEST-buggy.ts');
  const clean = scanSource(fixed, 'SELFTEST-fixed.ts');

  let ok = true;
  if (caught.length === 0) {
    console.error('✗ self-test FAILED: gate did NOT catch the original 2026-07 bug');
    ok = false;
  } else {
    console.log(`✓ catches the original bug (${caught.length} site: ${caught[0].field} ← ${caught[0].via})`);
  }
  if (clean.length !== 0) {
    console.error(`✗ self-test FAILED: gate false-positives on the FIXED code (${clean.length})`);
    ok = false;
  } else {
    console.log('✓ no false positive on the fixed code');
  }
  process.exit(ok ? 0 : 1);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry) && !/\.(test|spec)\./.test(entry)) out.push(p);
  }
  return out;
}

const files = [
  ...(existsSync(join(ROOT, 'src')) ? walk(join(ROOT, 'src')) : []),
  ...(existsSync(join(ROOT, 'scripts')) ? walk(join(ROOT, 'scripts')) : []),
];

const violations = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  // This auditor and the expander module itself legitimately name these symbols.
  if (rel.includes('audit-persist-expansion') || rel.includes('naics-expansion.ts')) continue;
  violations.push(...scanSource(readFileSync(file, 'utf8'), rel));
}

const baseline = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  : { known: [] };
const known = new Set(baseline.known || []);

if (UPDATE) {
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify({ known: violations.map((v) => v.key).sort() }, null, 2) + '\n',
  );
  console.log(`Baseline updated: ${violations.length} known site(s).`);
  process.exit(0);
}

const fresh = violations.filter((v) => !known.has(v.key));
if (fresh.length === 0) {
  console.log(`persist-expansion: clean (${violations.length} known, 0 new).`);
  process.exit(0);
}

console.error(`\npersist-expansion: ${fresh.length} NEW site(s) storing a QUERY-TIME expansion\n`);
for (const v of fresh) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.field} ← ${v.via}`);
  console.error(`    ${v.snippet}`);
}
console.error(
  `\n  Query-time expansion is correct for MATCHING, wrong for STORING.\n` +
    `  Persisting it rewrites the user's own choices — one preset click became 51\n` +
    `  NAICS codes on 1,144 profiles (2026-07). Use a persist helper instead:\n\n` +
    `      normalizeNAICSForPersist(codes)   // 6-digit exact, prefixes → curated set, capped\n\n` +
    `  Intentional? Accept it with:\n` +
    `      node scripts/audit-persist-expansion.mjs --update-baseline\n`,
);
process.exit(1);
