/**
 * Is this `.env.local` structurally valid for WHERE it lives?
 *
 * Split out of `verify-env-local.mjs` so tests (and any other caller) can import
 * the rule without executing that script's checks and process.exit.
 *
 * THE CONTRACT:
 *   MAIN worktree    → must be a REGULAR FILE. Never a symlink; the main repo
 *                      holds the real file every linked worktree points at.
 *   LINKED worktree  → a regular file is fine, and the ONLY valid symlink target
 *                      is that SAME repository's main `.env.local`.
 *
 * Everything else fails: a self-reference (the 2026-09-05 ELOOP breakage), another
 * repository's env, a dated backup, any arbitrary readable file.
 *
 * DELIBERATE: a REGULAR `.env.local` inside a linked worktree stays valid (its own
 * `vercel env pull` copy). It is self-contained — no link to point somewhere wrong —
 * so the failure class this rule exists to catch cannot arise from it. The cost is
 * that such a copy drifts from main silently; the helper's link is preferred, but a
 * copy is not an error. (Guarded by TEST 8.)
 *
 * ⚠️ READABILITY IS NOT SUFFICIENT. A wrong-repo env can be readable, populated and
 * carry every required variable family while being catastrophically wrong — runners
 * would load real-looking credentials for the wrong project and fail somewhere that
 * points nowhere near the cause. Family validation cannot see that; only topology can.
 */
import fs from 'node:fs';
import path from 'node:path';
// Reuse the topology helper proven in the creator rather than writing a second one:
// it strips the ambient git environment (GIT_DIR/GIT_WORK_TREE OVERRIDE `git -C`),
// which a re-implementation would almost certainly forget.
import { repoTopologyFor } from './link-env-local.mjs';

/**
 * Validate the STRUCTURE of an .env.local against its git topology.
 *
 * Pure and injectable so the regression tests can drive it over real temporary
 * repositories without touching this checkout.
 *
 * @returns {{ok:true, note?:string} | {ok:false, reason:string}}
 */
export function checkEnvTopology(envPath, deps = {}) {
  const _fs = deps.fs ?? fs;
  const _topology = deps.repoTopologyFor ?? repoTopologyFor;
  const dir = path.dirname(envPath);

  let st;
  try {
    st = _fs.lstatSync(envPath);
  } catch {
    return { ok: false, reason: '.env.local DOES NOT EXIST' };
  }

  if (!st.isSymbolicLink()) return { ok: true };

  const target = _fs.readlinkSync(envPath);
  const resolved = path.resolve(dir, target);

  // Say the 2026-09-05 breakage by name — it is unambiguous and worth calling out.
  if (resolved === envPath) {
    return {
      ok: false,
      reason:
        `.env.local is a SELF-REFERENCING SYMLINK -> ${target}` +
        '\n     This is the 2026-09-05 breakage: every read fails with ELOOP and' +
        '\n     dotenv does not throw — runners silently load ZERO variables.' +
        '\n     Repair with: vercel env pull .env.local',
    };
  }

  const topo = _topology(dir);
  if (!topo.ok) {
    return { ok: false, reason: `.env.local is a symlink but the repo topology is unknown (${topo.reason})` };
  }

  const canon = (p) => { try { return _fs.realpathSync(p); } catch { return path.resolve(p); } };
  const here = canon(dir);
  const main = canon(topo.main);
  const expected = path.join(main, '.env.local');

  if (here === main) {
    return {
      ok: false,
      reason:
        `.env.local in the MAIN worktree is a SYMLINK -> ${target}` +
        '\n     The main repo must hold the REAL file — it is the source every' +
        '\n     linked worktree points at. Repair with: vercel env pull .env.local',
    };
  }

  if (canon(resolved) !== canon(expected)) {
    return {
      ok: false,
      reason:
        `.env.local points OUTSIDE this repository -> ${target}` +
        `\n     Only this repo's main env is valid: ${expected}` +
        '\n     A readable, fully-populated env from another repo or an old backup is' +
        '\n     still the WRONG credentials. Repair with: npm run env:link-worktree -- "' + dir + '"',
    };
  }

  return { ok: true, note: `symlink -> this repository's main .env.local (supported worktree setup)` };
}
