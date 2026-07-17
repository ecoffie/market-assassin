#!/usr/bin/env node
/**
 * audit-tool-catalog-drift — "one fix = every surface", ENFORCED.
 *
 * The MCP tool catalog exists on four surfaces. CLAUDE.md has said since June
 * that changing one means changing all four in the same pass. It kept drifting
 * anyway — on 2026-07-17 the live registry had 49 tools while the artifact said
 * 46, the changelog 41 and the whitepaper 40. Four surfaces, four numbers.
 *
 * A written rule did not stop it. The rule was read, and violated, by the same
 * session that had just quoted it. So it is a gate now:
 *
 *   listMcpTools() is the SOURCE OF TRUTH (not a grep — tools register on two
 *   paths, and a grep has already made live tools look missing).
 *
 * The artifact lives on claude.ai and cannot be linted from here, so its count
 * is mirrored in docs/mcp-tool-catalog.json — the one file a human must touch
 * when they update the artifact. That mirror is what this checks. It is a
 * promise you have to keep by hand, but a BROKEN promise now fails the push
 * instead of shipping a wrong number to a customer.
 *
 * Exit 0 = every surface agrees. 1 = drift → BLOCKS the push.
 *   node scripts/audit-tool-catalog-drift.mjs            (gate)
 *   node scripts/audit-tool-catalog-drift.mjs --list     (show the live names)
 *   node scripts/audit-tool-catalog-drift.mjs --update   (sync the mirror + docs)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const MIRROR = 'docs/mcp-tool-catalog.json';

/** Surfaces that state a tool COUNT in prose. Each regex must capture the number in $1. */
const PROSE_SURFACES = [
  { file: 'docs/marketing/MCP-WHITEPAPER.md', re: /(\d+) tools/g },
  { file: 'docs/MCP-CHANGELOG.md', re: /artifact \(`[^`]*`\) — (\d+) tools/g },
];

function liveTools() {
  // Run through tsx: the registry is TS with path aliases. listMcpTools() is the
  // authority — it reflects BOTH registration paths.
  const out = execSync(
    `npx tsx -e "(async()=>{const m=await import('./src/lib/mcp/tool-registry');const r=m.default??m;console.log(JSON.stringify(r.listMcpTools().map(t=>t.function?.name).filter(Boolean).sort()))})()"`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], cwd: process.cwd() },
  );
  const line = out.split('\n').find((l) => l.trim().startsWith('['));
  if (!line) throw new Error('could not read listMcpTools() output');
  return JSON.parse(line);
}

const live = liveTools();
const liveCount = live.length;

if (process.argv.includes('--list')) {
  console.log(`[tool-catalog] ${liveCount} live tools:`);
  live.forEach((n) => console.log('  ' + n));
  process.exit(0);
}

const problems = [];

// ── 1. the artifact mirror ───────────────────────────────────────────────────
let mirror = null;
if (existsSync(MIRROR)) {
  try {
    mirror = JSON.parse(readFileSync(MIRROR, 'utf8'));
  } catch {
    problems.push(`${MIRROR} is not valid JSON`);
  }
}
if (mirror) {
  const missing = live.filter((n) => !mirror.tools.includes(n));
  const extra = mirror.tools.filter((n) => !live.includes(n));
  if (missing.length || extra.length) {
    problems.push(
      `${MIRROR} (mirrors the claude.ai Tool Map artifact) is out of sync — ` +
        `live=${liveCount} mirror=${mirror.tools.length}` +
        (missing.length ? `\n      MISSING from the artifact: ${missing.join(', ')}` : '') +
        (extra.length ? `\n      in the artifact but NOT live: ${extra.join(', ')}` : '') +
        `\n      → update the artifact at ${mirror.artifact_url}, THEN run --update`,
    );
  }
}

// ── 2. prose counts ──────────────────────────────────────────────────────────
for (const { file, re } of PROSE_SURFACES) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, 'utf8');
  const found = [...text.matchAll(re)].map((m) => Number(m[1]));
  const wrong = [...new Set(found.filter((n) => n !== liveCount))];
  if (wrong.length) {
    problems.push(`${file} claims ${wrong.join('/')} tools — live is ${liveCount}`);
  }
}

if (process.argv.includes('--update')) {
  writeFileSync(
    MIRROR,
    JSON.stringify(
      {
        _comment:
          'Mirror of the claude.ai Tool Map artifact. Update the artifact FIRST, then run: node scripts/audit-tool-catalog-drift.mjs --update. The gate fails if this disagrees with listMcpTools().',
        artifact_url: mirror?.artifact_url ?? 'https://claude.ai/code/artifact/31ec6de1-1dcf-4a04-aa43-30289bfc6c7c',
        count: liveCount,
        tools: live,
      },
      null,
      2,
    ) + '\n',
  );
  for (const { file, re } of PROSE_SURFACES) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace(re, (m, n) => m.replace(n, String(liveCount))));
  }
  console.log(`[tool-catalog] synced every surface to ${liveCount} tools.`);
  process.exit(0);
}

if (!problems.length) {
  console.log(`[tool-catalog] OK — all surfaces agree (${liveCount} tools).`);
  process.exit(0);
}

console.error(`\n[tool-catalog] ✗ CATALOG DRIFT — the live registry has ${liveCount} tools:\n`);
problems.forEach((p) => console.error('    ' + p));
console.error(
  `\n  Why this blocks: the catalog lives on FOUR surfaces (tool-registry.ts, the whitepaper,\n` +
    `  its .docx, and the claude.ai artifact). CLAUDE.md's "one fix = every surface" rule was\n` +
    `  READ AND VIOLATED, which is why it is a gate and not a paragraph. A wrong tool count\n` +
    `  goes to customers.\n\n` +
    `  Fix: update the artifact + docs, then: node scripts/audit-tool-catalog-drift.mjs --update\n` +
    `  (The .docx is generated — rerun scripts/build-whitepaper-docx.mjs after the .md changes.)\n`,
);
process.exit(1);
