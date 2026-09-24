#!/usr/bin/env node
/**
 * DETECT a drifted core.hooksPath. Never repairs it.
 *
 * THE SUPPORTED CONFIG is the RELATIVE value
 *
 *     core.hooksPath = .githooks
 *
 * (what `npm run hooks:install` and the npm `prepare` script write). Git
 * resolves a relative hooksPath against the top of the working tree being
 * operated on, so every linked worktree runs ITS OWN hook code.
 *
 * WHY AN ABSOLUTE PATH IS WRONG: `.git/config` is SHARED by the primary
 * checkout and every linked worktree (~30 live here). An absolute value such as
 *
 *     /Users/ericcoffie/Projects/market-assassin/.githooks
 *
 * pins EVERY worktree to the primary checkout's hook code. From a worktree the
 * resolver (.githooks/resolve-checkout.sh) refuses the push; from the primary it
 * passes SILENTLY, so the drift goes unnoticed until another session trips on
 * it. It was found set by hand three times on 2026-09-23 — nothing in this repo
 * writes it. This check reports it early, from the primary too.
 *
 * DETECTION, NOT REPAIR (Eric, 2026-09-23): "Don't have the gate automatically
 * rewrite Git configuration. Detection is safer than a tool silently changing
 * developer state." This file only READS config. The fix is printed, not run.
 *
 * Verdicts:
 *   PASS  (exit 0) — every local/worktree value is approved, and the effective
 *                    value is approved.
 *   PASS with WARNING — the effective value is a ONE-SHOT command-line override
 *                    naming THIS checkout's .githooks (the documented emergency
 *                    escape `git -c core.hooksPath="$PWD/.githooks" push`), so
 *                    this push is gated by this checkout's code; any shared
 *                    drift underneath is reported loudly but does not block.
 *   FAIL  (exit 1) — unset (the gate never runs), or any local/worktree value
 *                    that is not approved, or an unapproved effective value.
 *   ERROR (exit 2) — not inside a git checkout / git unavailable.
 *
 * Usage:
 *   node scripts/check-hooks-path.mjs [--repo <dir>] [--quiet]
 *   npm run verify:hooks
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';

/** The ONE place the approved set is defined. */
const APPROVED_HOOKS_PATHS = Object.freeze(['.githooks']);

const args = process.argv.slice(2);
const repoIdx = args.indexOf('--repo');
const repoDir = repoIdx >= 0 ? args[repoIdx + 1] : process.cwd();
const quiet = args.includes('--quiet');

// Ask about THIS directory, not about whatever inherited pointers name. Git
// sets GIT_DIR & friends for hooks; left in place they make `git config`
// answer for them instead of for --repo. GIT_CONFIG_PARAMETERS / GIT_CONFIG_COUNT
// are deliberately KEPT: they carry `git -c` one-shot overrides, which this
// check must be able to see (and name as such).
const env = { ...process.env };
for (const k of [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'GIT_NAMESPACE',
]) delete env[k];

function git(argv) {
  const r = spawnSync('git', ['-C', repoDir, ...argv], { env, encoding: 'utf8' });
  return { status: r.status, stdout: (r.stdout || '').replace(/\n$/, ''), stderr: r.stderr || '' };
}

function physical(p) {
  try { return realpathSync(p); } catch { return null; }
}

const out = [];
const say = (s = '') => out.push(s);

const top = git(['rev-parse', '--show-toplevel']);
if (top.status !== 0 || !top.stdout) {
  console.error(`check-hooks-path: not inside a git checkout: ${repoDir}\n${top.stderr}`);
  process.exit(2);
}
const toplevel = physical(top.stdout) || top.stdout;
const ownHooks = path.join(toplevel, '.githooks');

// Every definition, in precedence order (last wins), with scope + origin.
const all = git(['config', '--show-scope', '--show-origin', '--get-all', 'core.hooksPath']);
// status 1 = key not set anywhere; anything else non-zero is a real error.
if (all.status !== 0 && all.status !== 1) {
  console.error(`check-hooks-path: git config failed (exit ${all.status}): ${all.stderr}`);
  process.exit(2);
}
const entries = all.status === 1 || !all.stdout ? [] : all.stdout.split('\n').map((line) => {
  const [scope, origin, ...rest] = line.split('\t');
  return { scope, origin, value: rest.join('\t') };
});

const approved = (v) => APPROVED_HOOKS_PATHS.includes(v);
const isOwnCheckoutHooks = (v) => {
  if (!path.isAbsolute(v)) return false;
  const a = physical(v);
  const b = physical(ownHooks);
  return a !== null && b !== null && a === b; // two unresolvable paths are NOT a match
};
const describe = (e) => `${e.value}   [${e.scope}: ${e.origin}]`;

const effective = entries.length ? entries[entries.length - 1] : null;
const shared = entries.filter((e) => e.scope === 'local' || e.scope === 'worktree');
const badShared = shared.filter((e) => !approved(e.value));
const outer = entries.filter((e) => e.scope === 'global' || e.scope === 'system');
const oneShot = effective && effective.scope === 'command'
  && (approved(effective.value) || isOwnCheckoutHooks(effective.value));

const FIX = [
  'Fix (restores the supported RELATIVE value; run it yourself — this check never writes config):',
  '    npm run hooks:install          # = git config core.hooksPath .githooks',
  'Emergency, one push only (does NOT change shared config):',
  '    git -c core.hooksPath="$PWD/.githooks" push',
  'Never set an absolute core.hooksPath: .git/config is shared by every worktree, so an',
  "absolute path pins ALL of them to one checkout's hook code (from a worktree the gate",
  'refuses; from the primary it passes silently).',
];

let verdict = 'PASS';
const reasons = [];

if (!effective) {
  verdict = 'FAIL';
  reasons.push('core.hooksPath is UNSET — git falls back to .git/hooks and the pre-push gate never runs.');
} else if (oneShot) {
  // The documented escape: this push is gated by THIS checkout's code.
  if (badShared.length) {
    verdict = 'WARN';
    reasons.push('one-shot command-line override in effect for THIS push; shared config is still drifted:');
    for (const e of badShared) reasons.push(`  ${describe(e)}`);
  }
} else {
  if (!approved(effective.value)) {
    verdict = 'FAIL';
    const kind = path.isAbsolute(effective.value) ? 'an ABSOLUTE (session-specific) path' : 'not an approved value';
    reasons.push(`effective core.hooksPath is ${kind}:`);
    reasons.push(`  ${describe(effective)}`);
  }
  for (const e of badShared) {
    if (e === effective) continue;
    verdict = 'FAIL';
    reasons.push(`a ${e.scope}-level core.hooksPath is not approved (shadowed now, but it is shared state):`);
    reasons.push(`  ${describe(e)}`);
  }
}

const notes = [];
const wt = entries.filter((e) => e.scope === 'worktree');
if (wt.length) notes.push(`worktree-level core.hooksPath is set (applies to this worktree only): ${wt.map(describe).join('; ')}`);
for (const e of outer) {
  notes.push(`core.hooksPath is also set at ${e.scope} level: ${describe(e)}${approved(e.value) ? '' : '  ← not approved; it takes effect in any repo without a local value'}`);
}

if (verdict === 'PASS') {
  if (!quiet) {
    say(`✓ core.hooksPath OK: ${describe(effective)}`);
    for (const n of notes) say(`  note: ${n}`);
  }
} else if (verdict === 'WARN') {
  say(`⚠ core.hooksPath: this push uses a one-shot override (${describe(effective)}).`);
  for (const r of reasons) say(`  ${r}`);
  for (const n of notes) say(`  note: ${n}`);
  say('');
  for (const f of FIX) say(`  ${f}`);
} else {
  say('✗ core.hooksPath is not the supported configuration.');
  say(`  approved: ${APPROVED_HOOKS_PATHS.map((v) => JSON.stringify(v)).join(', ')} (relative — git resolves it per working tree)`);
  for (const r of reasons) say(`  ${r}`);
  for (const n of notes) say(`  note: ${n}`);
  say('');
  for (const f of FIX) say(`  ${f}`);
}

if (out.length) (verdict === 'PASS' ? console.log : console.error)(out.join('\n'));
process.exit(verdict === 'FAIL' ? 1 : 0);
