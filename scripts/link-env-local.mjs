/**
 * Share the main repo's `.env.local` into a git worktree — SAFELY.
 *
 * WHY THIS EXISTS. The ad-hoc recipe was:
 *
 *     cd <worktree> && ln -sfn "<MAIN>/.env.local" .env.local
 *
 * That is correct from a worktree and CATASTROPHIC from the main repo: source
 * and destination become the same path, and `ln -sfn` replaces the real file
 * with a link to itself. Every later read fails with ELOOP, and dotenv does not
 * throw on an unreadable path — it returns an error object almost nobody checks,
 * so callers silently run with ZERO variables.
 *
 * It has happened twice (2026-09-05, 2026-09-13 ~19:13). The second time it broke
 * mid-way through read-only pre-flight for a five-stage NASA migration.
 *
 * ⚠️ THE CWD IS NOT TRUSTWORTHY. Agent tool-calls can have their shell cwd reset
 * back to the main repo between commands, so a `cd <worktree> && ln -sfn …` whose
 * `cd` did not stick executes in the main repo. THAT is the real failure mode.
 * This helper therefore takes the worktree as an EXPLICIT ARGUMENT and never
 * infers the destination from process.cwd().
 *
 * Usage:
 *   node scripts/link-env-local.mjs <WORKTREE_PATH>
 *   npm run env:link-worktree -- <WORKTREE_PATH>
 *
 * Exit 0 = linked (or already correct). Exit 1 = refused, nothing mutated.
 *
 * Prints paths and link state only — NEVER file contents or variable values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ENV_NAME = '.env.local';

/** The main working tree, per git itself — not an assumption about cwd. */
export function mainRepoRoot(fromDir = process.cwd()) {
  const out = execFileSync('git', ['-C', fromDir, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  // The FIRST entry of `git worktree list` is always the main working tree.
  const first = out.split('\n').find((l) => l.startsWith('worktree '));
  if (!first) throw new Error('cannot determine main worktree');
  return first.slice('worktree '.length).trim();
}

/** Resolve a path for comparison without requiring it to exist. */
function canonical(p) {
  const abs = path.resolve(p);
  try { return fs.realpathSync(abs); } catch { return abs; }
}

/**
 * Decide what to do. PURE — no filesystem writes, so every refusal is testable.
 * @returns {{action:'link'|'noop'|'refuse', reason:string}}
 */
export function planLink(mainRoot, worktreePath, fsImpl = fs) {
  if (!worktreePath || !String(worktreePath).trim()) {
    return { action: 'refuse', reason: 'no worktree path given — the destination must be EXPLICIT, never inferred from cwd' };
  }
  const mainAbs = path.resolve(mainRoot);
  const wtAbs = path.resolve(worktreePath);
  const source = path.join(mainAbs, ENV_NAME);
  const target = path.join(wtAbs, ENV_NAME);

  // ⚠️ COMPARE CANONICAL PATHS. On macOS /var is a symlink to /private/var, and
  // git reports the resolved form while a caller may pass the unresolved one.
  // A textual comparison would silently MISS the main-repo case — the very
  // situation this helper exists to refuse.
  // B. destination is the main repo itself
  if (canonical(wtAbs) === canonical(mainAbs)) {
    return { action: 'refuse', reason: `target IS the main repo (${mainAbs}) — linking it to itself is the exact defect this helper prevents` };
  }
  // C. same LITERAL path either way.
  // ⚠️ Compare the paths themselves, NOT their realpaths. A correctly linked
  // worktree .env.local realpath-resolves to the main file by design, so a
  // canonical comparison here would reject the healthy topology as a self-link.
  // The genuine self-link case is caught by the main-repo check above and by the
  // symlink inspection below.
  if (path.resolve(source) === path.resolve(target)) {
    return { action: 'refuse', reason: 'source and destination are the same path — refusing to create a self-link' };
  }
  // A. worktree must exist
  if (!fsImpl.existsSync(wtAbs)) {
    return { action: 'refuse', reason: `worktree path does not exist: ${wtAbs}` };
  }
  // F/G. source must exist, be readable, and be a real file (never a link itself)
  let sourceStat;
  try { sourceStat = fsImpl.lstatSync(source); }
  catch { return { action: 'refuse', reason: `main ${ENV_NAME} not found at ${source} — run \`vercel env pull ${ENV_NAME}\` first` }; }
  if (sourceStat.isSymbolicLink()) {
    return { action: 'refuse', reason: `main ${ENV_NAME} is itself a SYMLINK — repair it before sharing (vercel env pull)` };
  }
  try { fsImpl.accessSync(source, fs.constants.R_OK); }
  catch { return { action: 'refuse', reason: `main ${ENV_NAME} is unreadable — repair it before sharing` }; }

  // Destination inspection
  let targetStat = null;
  try { targetStat = fsImpl.lstatSync(target); } catch { /* absent is fine */ }
  if (targetStat) {
    if (targetStat.isSymbolicLink()) {
      const raw = fsImpl.readlinkSync(target);
      const resolved = path.isAbsolute(raw) ? raw : path.resolve(wtAbs, raw);
      // ⚠️ Compare the LINK TARGET, not canonical(target): realpath on a healthy
      // symlink follows through to the source file, which would make a correct
      // link look like a self-link. Resolve the target's own path textually and
      // canonicalise only what it POINTS AT.
      const selfPath = path.join(canonical(wtAbs), ENV_NAME);
      // E. self / circular
      if (path.resolve(resolved) === selfPath || path.resolve(resolved) === path.resolve(target)) {
        return { action: 'refuse', reason: `existing ${ENV_NAME} is a SELF-REFERENCING symlink — remove it deliberately, this helper will not silently overwrite it` };
      }
      if (canonical(resolved) === canonical(source)) {
        return { action: 'noop', reason: 'already correctly linked to the main .env.local' };
      }
      // A link to a DIFFERENT real file: visible refusal, never a silent repoint.
      // Stale/other target: visible failure, never a silent repoint.
      return { action: 'refuse', reason: `existing ${ENV_NAME} points elsewhere (${raw}) — refusing to silently repoint it` };
    }
    // D. a real file is never replaced
    return { action: 'refuse', reason: `destination ${ENV_NAME} is a regular file — refusing to replace it` };
  }
  return { action: 'link', reason: `link ${target} -> ${source}` };
}

function main() {
  const arg = process.argv[2];
  // MAIN_REPO_ROOT lets a caller (notably the tests) pin the main repo instead of
  // relying on cwd discovery — the whole point of this helper is that cwd is not
  // trustworthy, so its own tests must not depend on it either.
  let mainRoot = process.env.MAIN_REPO_ROOT;
  if (!mainRoot) {
    try { mainRoot = mainRepoRoot(); }
    catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
  }

  const plan = planLink(mainRoot, arg);
  const target = arg ? path.join(path.resolve(arg), ENV_NAME) : '(none)';
  console.log(`  main repo : ${mainRoot}`);
  console.log(`  target    : ${target}`);

  if (plan.action === 'refuse') { console.error(`✗ REFUSED — ${plan.reason}`); process.exit(1); }
  if (plan.action === 'noop') { console.log(`✓ ${plan.reason}`); process.exit(0); }

  fs.symlinkSync(path.join(mainRoot, ENV_NAME), target);
  console.log(`✓ linked (worktree ${ENV_NAME} -> main ${ENV_NAME})`);
}

// ⚠️ USE pathToFileURL, NOT string concatenation. This repo's path contains a
// space ("Market Assasin"), which import.meta.url percent-encodes (%20) while
// `file://${process.argv[1]}` does not — so the naive comparison is always false
// and the script silently does NOTHING. Caught by the regression tests.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
