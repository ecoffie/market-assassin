#!/usr/bin/env node
/**
 * Instruction-cleanup guard (2026-11-17).
 *
 * The root CLAUDE.md was split into docs/agents/*. Rules that live only in prose get lost
 * silently, so this check makes the split hold:
 *   - every heading / numbered rule / warning of the previous single-file CLAUDE.md
 *     (docs/agents/claude-md-anchor-manifest.json) is still present at its recorded location;
 *   - reworded anchors carry their recorded replacement text;
 *   - root CLAUDE.md stays under its size budget, keeps the title line the SessionStart hook
 *     detects, and links only to reference files that exist.
 *
 * Run: npm run audit:claude-md      (exit 1 on any failure)
 * Moving a rule? Update the manifest in the same commit. Deleting one needs Eric's sign-off.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_BUDGET_CHARS = 15_000;
export const ROOT_TITLE = '# Market Assassin - Claude Project Context';

export function auditClaudeMd({ read, exists }) {
  const failures = [];
  const root = read('CLAUDE.md');
  if (root == null) return ['CLAUDE.md missing'];
  if (root.length > ROOT_BUDGET_CHARS) failures.push(`root CLAUDE.md is ${root.length} chars (budget ${ROOT_BUDGET_CHARS})`);
  if (!root.startsWith(ROOT_TITLE)) failures.push(`root CLAUDE.md must start with "${ROOT_TITLE}" (SessionStart hook detection)`);
  for (const m of root.matchAll(/`(docs\/[\w./-]+\.(?:md|json))`/g)) {
    if (!exists(m[1])) failures.push(`root links to missing file ${m[1]}`);
  }
  const manifestRaw = read('docs/agents/claude-md-anchor-manifest.json');
  if (manifestRaw == null) return [...failures, 'anchor manifest missing'];
  const { anchors } = JSON.parse(manifestRaw);
  const cache = new Map();
  for (const a of anchors) {
    if (!cache.has(a.location)) cache.set(a.location, read(a.location));
    const body = cache.get(a.location);
    const needle = a.status === 'reworded' ? a.now : a.text;
    if (body == null) failures.push(`${a.location} missing (anchor: ${a.text.slice(0, 70)})`);
    else if (!body.includes(needle)) failures.push(`anchor missing from ${a.location}: ${needle.slice(0, 90)}`);
  }
  return failures;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const base = process.cwd();
  const read = (p) => { try { return fs.readFileSync(path.join(base, p), 'utf8'); } catch { return null; } };
  const exists = (p) => fs.existsSync(path.join(base, p));
  const failures = auditClaudeMd({ read, exists });
  if (failures.length) {
    console.error(`✗ CLAUDE.md audit: ${failures.length} problem(s)`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  const n = JSON.parse(read('docs/agents/claude-md-anchor-manifest.json')).anchors.length;
  console.log(`✓ CLAUDE.md audit: ${n} anchors present; root ${read('CLAUDE.md').length}/${ROOT_BUDGET_CHARS} chars`);
}
