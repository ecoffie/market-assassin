/**
 * Share the main repo's `.env.local` into a git worktree — SAFELY.
 *
 * WHY THIS EXISTS. The ad-hoc recipe was:
 *
 *     cd <worktree> && ln -sfn "<MAIN>/.env.local" .env.local
 *
 * That is correct from a worktree and CATASTROPHIC from the main repo: source and
 * destination become the same path, and `ln -sfn` replaces the real file with a
 * link to itself. Every later read fails with ELOOP, and dotenv does not throw on
 * an unreadable path — it returns an error object almost nobody checks, so callers
 * silently run with ZERO variables. It happened twice (2026-09-05, 2026-09-13).
 *
 * ⚠️ THE CWD IS NOT TRUSTWORTHY, FOR EITHER PATH. An agent tool-call's shell cwd
 * can be reset between commands, so a `cd <worktree> && …` whose `cd` did not
 * stick runs somewhere else entirely. This helper therefore derives BOTH paths
 * from one explicit argument and never reads process.cwd().
 *
 * ⚠️ AND THE SOURCE MUST COME FROM THE TARGET'S OWN REPOSITORY. An earlier draft
 * fixed only the destination and still discovered the main repo from cwd. With cwd
 * reset into a DIFFERENT repository that silently linked one repo's worktree to
 * ANOTHER repo's secrets — no ELOOP, no error, exit 0, wrong credentials. Proven by
 * reproduction. Source is now derived from the target's own git repository, so that
 * state is structurally impossible.
 *
 * Usage:
 *   node scripts/link-env-local.mjs <WORKTREE_PATH>
 *   npm run env:link-worktree -- <WORKTREE_PATH>
 *
 * Exit 0 = linked (or already correct). Exit 1 = refused, nothing mutated.
 * Prints paths and link state only — NEVER file contents or variable values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ENV_NAME = '.env.local';

/** Resolve a path for comparison without requiring it to exist. */
function canonical(p) {
  const abs = path.resolve(p);
  try { return fs.realpathSync(abs); } catch { return abs; }
}

/**
 * Ask git, FROM THE TARGET, for that repository's worktree set.
 * The first entry of `git worktree list` is always the main working tree.
 *
 * @returns {{ok:true, main:string, all:string[]} | {ok:false, reason:string}}
 */
export function repoTopologyFor(targetDir, exec = execFileSync) {
  let out;
  try {
    out = exec('git', ['-C', targetDir, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return { ok: false, reason: `not inside a git repository: ${targetDir}` };
  }
  const all = out.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length).trim());
  if (!all.length) return { ok: false, reason: `git reported no worktrees for ${targetDir}` };
  return { ok: true, main: all[0], all };
}

/**
 * Decide what to do. PURE with respect to the filesystem — no writes — so every
 * refusal is testable.
 * @returns {{action:'link'|'noop'|'refuse', reason:string, source?:string, target?:string, main?:string}}
 */
export function planLink(worktreePath, deps = {}) {
  const fsImpl = deps.fs ?? fs;
  const topology = deps.topology ?? repoTopologyFor;

  if (!worktreePath || !String(worktreePath).trim()) {
    return { action: 'refuse', reason: 'no worktree path given — the destination must be EXPLICIT, never inferred from cwd' };
  }
  const wtAbs = path.resolve(worktreePath);
  if (!fsImpl.existsSync(wtAbs)) {
    return { action: 'refuse', reason: `worktree path does not exist: ${wtAbs}` };
  }

  // 2/3. The TARGET identifies the repository. cwd is never consulted.
  const topo = topology(wtAbs);
  if (!topo.ok) return { action: 'refuse', reason: topo.reason };

  const mainAbs = canonical(topo.main);
  const wtCanon = canonical(wtAbs);

  // 5. the target must be a REGISTERED worktree of that repository — existing as
  // a directory is not membership.
  const registered = topo.all.map(canonical);
  if (!registered.includes(wtCanon)) {
    return { action: 'refuse', reason: `${wtAbs} is not a registered worktree of ${topo.main}` };
  }
  // 6. target must not be the main worktree
  if (wtCanon === mainAbs) {
    return { action: 'refuse', reason: `target IS the main worktree (${topo.main}) — linking it to itself is the exact defect this helper prevents` };
  }

  // 7. source is THAT repository's main .env.local — derived, never supplied.
  const source = path.join(mainAbs, ENV_NAME);
  const target = path.join(wtAbs, ENV_NAME);

  if (path.resolve(source) === path.resolve(target)) {
    return { action: 'refuse', reason: 'source and destination are the same path — refusing to create a self-link' };
  }

  let sourceStat;
  try { sourceStat = fsImpl.lstatSync(source); }
  catch { return { action: 'refuse', reason: `main ${ENV_NAME} not found at ${source} — run \`vercel env pull ${ENV_NAME}\` first` }; }
  if (sourceStat.isSymbolicLink()) {
    return { action: 'refuse', reason: `main ${ENV_NAME} is itself a SYMLINK — repair it before sharing (vercel env pull)` };
  }
  try { fsImpl.accessSync(source, fs.constants.R_OK); }
  catch { return { action: 'refuse', reason: `main ${ENV_NAME} is unreadable — repair it before sharing` }; }

  let targetStat = null;
  try { targetStat = fsImpl.lstatSync(target); } catch { /* absent is fine */ }
  if (targetStat) {
    if (targetStat.isSymbolicLink()) {
      const raw = fsImpl.readlinkSync(target);
      const resolved = path.isAbsolute(raw) ? raw : path.resolve(wtAbs, raw);
      // Compare the LINK TARGET, not canonical(target): realpath on a healthy
      // symlink follows through to the source, which would make a correct link
      // look like a self-link.
      if (path.resolve(resolved) === path.join(wtCanon, ENV_NAME) || path.resolve(resolved) === path.resolve(target)) {
        return { action: 'refuse', reason: `existing ${ENV_NAME} is a SELF-REFERENCING symlink — remove it deliberately, this helper will not silently overwrite it` };
      }
      if (canonical(resolved) === canonical(source)) {
        return { action: 'noop', reason: 'already correctly linked to the main .env.local', source, target, main: topo.main };
      }
      return { action: 'refuse', reason: `existing ${ENV_NAME} points elsewhere (${raw}) — refusing to silently repoint it` };
    }
    return { action: 'refuse', reason: `destination ${ENV_NAME} is a regular file — refusing to replace it` };
  }
  return { action: 'link', reason: `link ${target} -> ${source}`, source, target, main: topo.main };
}

function main() {
  const arg = process.argv[2];
  const plan = planLink(arg);
  console.log(`  target    : ${arg ? path.join(path.resolve(arg), ENV_NAME) : '(none)'}`);
  if (plan.main) console.log(`  main repo : ${plan.main}   (derived from the target, not cwd)`);

  if (plan.action === 'refuse') { console.error(`✗ REFUSED — ${plan.reason}`); process.exit(1); }
  if (plan.action === 'noop') { console.log(`✓ ${plan.reason}`); process.exit(0); }

  fs.symlinkSync(plan.source, plan.target);
  console.log(`✓ linked (worktree ${ENV_NAME} -> main ${ENV_NAME})`);
}

// ⚠️ pathToFileURL, NOT string concatenation: this repo's path contains a space,
// which import.meta.url percent-encodes (%20) while `file://${argv[1]}` does not —
// the naive comparison is always false and the script silently does NOTHING.
// argv[1] is undefined when this file is imported rather than executed.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
