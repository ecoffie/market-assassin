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

/** The always-on core (everything before the In-flight section). */
export const ROOT_BUDGET_CHARS = 15_000;
/**
 * Whole root file. The In-flight section (~25K) must stay in the root because the SessionStart hook
 * (~/.claude/hooks/inflight-context.sh) extracts it from there; the core stays under ROOT_BUDGET_CHARS.
 */
export const ROOT_TOTAL_BUDGET_CHARS = 35_000;
export const ROOT_TITLE = '# Market Assassin - Claude Project Context';
export const INFLIGHT_HEADING = '## In-flight work — READ THIS FIRST';

/**
 * Same extraction as the SessionStart hook's awk:
 *   /^## In-flight work — READ THIS FIRST/ {f=1}   f && /^## Unified MI Platform/ {exit}   f {print}
 */
export function extractInflightLikeHook(md) {
  const out = [];
  let f = false;
  for (const line of md.split('\n')) {
    if (line.startsWith(INFLIGHT_HEADING)) f = true;
    if (f && line.startsWith('## Unified MI Platform')) break;
    if (f) out.push(line);
  }
  return out;
}

export function auditClaudeMd({ read, exists }) {
  const failures = [];
  const root = read('CLAUDE.md');
  if (root == null) return ['CLAUDE.md missing'];
  const inflightAt = root.indexOf(`\n${INFLIGHT_HEADING}`);
  const core = inflightAt >= 0 ? root.slice(0, inflightAt) : root;
  if (core.length > ROOT_BUDGET_CHARS) failures.push(`root CLAUDE.md core is ${core.length} chars (budget ${ROOT_BUDGET_CHARS})`);
  if (root.length > ROOT_TOTAL_BUDGET_CHARS) failures.push(`root CLAUDE.md is ${root.length} chars (total budget ${ROOT_TOTAL_BUDGET_CHARS})`);
  if (inflightAt < 0) failures.push(`root CLAUDE.md must contain "${INFLIGHT_HEADING}" (the SessionStart hook extracts it from the root)`);
  const extracted = extractInflightLikeHook(root);
  if (extracted.length < 20) failures.push(`SessionStart hook extraction returns ${extracted.length} lines from root CLAUDE.md (expected the full In-flight section)`);
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
  const root = read('CLAUDE.md');
  const at = root.indexOf(`\n${INFLIGHT_HEADING}`);
  console.log(`✓ CLAUDE.md audit: ${n} anchors present; core ${at >= 0 ? at : root.length}/${ROOT_BUDGET_CHARS} chars; whole root ${root.length}/${ROOT_TOTAL_BUDGET_CHARS}; hook extracts ${extractInflightLikeHook(root).length} lines`);
}
