/**
 * Refuse a production deploy that would ship a stale or wrong checkout.
 *
 * WHY THIS EXISTS: on 2026-09-21T01:47:09Z, 20 seconds after PR #1597 was
 * squash-merged, `vercel --prod` ran from the FEATURE-BRANCH worktree
 * (`fix/cyrus-freshness-provenance` @ dece7dba). Vercel uploads the directory it
 * is invoked from — not "the branch your shell is on" — so it built the branch
 * tree, went READY, and took all four production aliases from the git build of
 * the merge commit that had started 20 seconds earlier.
 *
 * The branch head was not "behind" in any way a human would notice — it was the
 * exact head that had just been reviewed and merged. What it lacked was the work
 * merged AROUND it: #1595, #1596, #1598. One was load-bearing. #1595 had taught
 * `api/cron/snapshot-multisite` to accept the dispatcher's
 * `Authorization: Bearer $CRON_SECRET`, and its migration had already stripped the
 * inline `?password=` workaround out of `cron_jobs.route` in the live database. The
 * branch build predated that fix, so the enabled daily job had NO working auth path
 * left. Measured: correct bearer -> 401 on the branch build, 400 on restored main.
 *
 * Nothing failed loudly. The build was green, the aliases were Ready, and the
 * acceptance suite run against it passed 33/33 — because it only exercised the
 * Cyrus code, which WAS present. A green build proves the tree you uploaded
 * compiles. It cannot tell you that you uploaded the wrong tree.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  THIS GUARD ONLY RUNS IF SOMEONE INVOKES IT. A bare `vercel --prod`,
 *     `vercel deploy --prod` or `vercel promote` BYPASSES IT COMPLETELY.
 *
 *     That is exactly what happened on 2026-09-21 (`source: cli`,
 *     `actor: cursor-cli`). A wrapper is a seatbelt, not a locked door: it
 *     removes the accident, not the capability. Closing the capability is a
 *     CREDENTIAL/PERMISSION change, not a code change — see
 *     `docs/engineering/production-deploy-boundary.md` for the proposed controls.
 *     Until one is adopted, treat this guard as defence-in-depth only.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THE CONTRACT. A production deploy may ship only a checkout that is:
 *
 *   1. LINKED TO THE RIGHT PROJECT — `.vercel/project.json` present in THIS
 *      directory, matching the expected projectName AND projectId AND orgId.
 *      The NAME is a human label and can be stale or hand-edited; the IDs are what
 *      the API actually routes on. Never overridable.
 *   2. GIT-VERIFIABLE — every git fact must be readable. A git command that errors
 *      makes the checkout UNKNOWN, and unknown is not permission. Fails CLOSED.
 *   3. ON main — not a feature branch, not detached.
 *   4. EXACTLY origin/main — 0 behind (missing merged work, the incident above)
 *      and 0 ahead (unpushed commits ship code nobody reviewed).
 *   5. CLEAN — no modified tracked files, and nothing extra that would be uploaded.
 *      `.vercelignore` in this repo records that the CLI "uploads the working
 *      directory and does NOT honour .gitignore", so BOTH ordinary untracked files
 *      AND GITIGNORED ones are deployable content unless `.vercelignore` excludes
 *      them. `git status --porcelain` lists only the first kind — it hides exactly
 *      what .gitignore covers, which is the larger and more sensitive half. On this
 *      repo that hidden half included `.env.local` and two `.env.local.*-backup`
 *      files, none of them excluded by `.vercelignore`. So the enumeration uses
 *      `--ignored`, and "git says clean" is not evidence that nothing extra ships.
 *
 * ESCAPE HATCH. Emergency rollbacks are real. `ALLOW_NONMAIN_PROD_DEPLOY="<reason>"`
 * downgrades 3-5 to loud warnings. The reason must be a real sentence (>= 8 chars):
 * `=1` is not a reason, and a bypass nobody can read later is how this recurs.
 * Rules 1 and 2 are NEVER overridable — a wrong project and an unverifiable
 * checkout are not things a sentence can make safe.
 *
 * CHECK TWICE. `npm run deploy` runs this guard, then a multi-minute check suite,
 * then this guard AGAIN with `--final` immediately before upload. main can move
 * while the suite runs; a gate that only fires at the start of a long pipeline is
 * checking a checkout that no longer exists.
 *
 * PREFER PROMOTION. Re-deploying main to fix a bad alias rebuilds it for no reason.
 * `vercel promote <deployment>` moves the aliases to the existing Ready build of
 * that commit. That is how this incident was actually resolved.
 *
 * Run:
 *   npm run guard:prod-deploy                 # gate
 *   npm run guard:prod-deploy -- --final      # the pre-upload recheck
 *   npm run guard:prod-deploy -- --json
 *   npm run guard:prod-deploy -- --no-fetch   # cannot verify staleness; says so
 *   npm run guard:prod-deploy -- --self-test
 *
 * Exit 0 = safe to deploy. 1 = refused (or self-test failed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const EXPECTED_PROJECT = 'market-assassin';
export const EXPECTED_PROJECT_ID = 'prj_8EXxyyIhcQkBRMMfwiYbxuzYIpVu';
export const EXPECTED_ORG_ID = 'team_w3016JFXskPwzWfNUjFO8fes';
const MIN_REASON_LENGTH = 8;

const normalizePath = (s) => s.trim().replace(/^\.\//, '').replace(/\/+$/, '');

/**
 * Decide whether ONE `.vercelignore` pattern matches a path.
 *
 * Returns `null` for "cannot evaluate" — deliberately distinct from `false`, because
 * the two mean opposite things for a NEGATION. Only a small, precisely-specified
 * subset of gitignore syntax is evaluated; everything else is `null`:
 *
 *   `dir/` or `a/b`   anchored  — the path itself or anything beneath it
 *   `name`            unanchored — that basename at ANY depth (gitignore semantics,
 *                     which is how `.DS_Store` also covers `docs/.DS_Store`)
 *   `**​/name`         same as unanchored `name`
 *   `prefix*`         a single TRAILING star, no slash — any path SEGMENT starting
 *                     with `prefix` (this is what makes `.env.*` cover the
 *                     timestamped `.env.local.*-backup` files)
 *
 * Anything else — an interior `*`, `?`, a character class, a multi-star pattern —
 * returns `null`. Widening this set is fine; guessing is not.
 */
export function matchesVercelPattern(pattern, filePath) {
  const p = normalizePath(filePath);
  let body = pattern.trim();
  if (!body || !p) return null;

  const anchored = body.includes('/') && !body.replace(/\/+$/, '').startsWith('**/');
  if (body.startsWith('**/')) body = body.slice(3);
  const clean = normalizePath(body);
  if (!clean) return null;

  const segments = p.split('/');

  // `prefix*` — one trailing star only, and no path separator.
  if (/^[^*?[\]/]+\*$/.test(clean)) {
    const prefix = clean.slice(0, -1);
    return segments.some((seg) => seg.startsWith(prefix));
  }

  if (/[*?[\]]/.test(clean)) return null; // not in the evaluated subset

  if (anchored) return p === clean || p.startsWith(`${clean}/`);

  // Unanchored literal: matches that name at any depth, and anything beneath it.
  return (
    p === clean ||
    p.startsWith(`${clean}/`) ||
    p.endsWith(`/${clean}`) ||
    p.includes(`/${clean}/`)
  );
}

/**
 * Does `.vercelignore` DEFINITELY exclude this path?
 *
 * "Definitely" is the whole contract. Returning true means the guard will stay
 * silent about a file that ships, so every uncertainty resolves to FALSE (= "not
 * proven excluded" = it still blocks). A false block costs one `.vercelignore`
 * line; a false exclusion is how unreviewed content reaches production.
 *
 * Patterns are evaluated IN ORDER, last match winning, because `.vercelignore`
 * follows .gitignore semantics — and that includes `!` NEGATION, which RE-INCLUDES
 * a path. A negation is an EXCEPTION to an exclusion, and the two must never be
 * confused: given
 *
 *     .claude/
 *     !.claude/keep-me.txt
 *
 * `.claude/keep-me.txt` IS uploaded. Matching only the first line and reporting
 * "excluded" would hide exactly the file that ships. Three conservative rules:
 *
 *   - a negation we CANNOT evaluate (globbed) => never claim exclusion at all;
 *   - a positive pattern we cannot evaluate (globbed) => skip it, claim nothing;
 *   - a negation naming something UNDER this path => this path is not wholly
 *     excluded, so do not claim it is. That matters because git collapses an
 *     untracked/ignored directory into a single entry, so `p` is often a DIRECTORY
 *     and one re-included child is enough to make the directory uploadable.
 */
export function isVercelIgnored(filePath, patterns = []) {
  const p = normalizePath(filePath);
  if (!p) return false;

  let excluded = false;

  for (const raw of patterns) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const negated = line.startsWith('!');
    const body = negated ? line.slice(1).trim() : line;
    if (!body) continue;

    const match = matchesVercelPattern(body, p);

    if (match === null) {
      // An un-evaluatable RE-INCLUDE could resurrect anything under any exclusion,
      // so the honest answer for this file is "unknown" — which must block.
      if (negated) return false;
      continue; // positive pattern we cannot evaluate: claim nothing
    }

    if (match) {
      excluded = !negated;
      continue;
    }

    // A re-included CHILD of a collapsed directory entry: `p` is not WHOLLY excluded,
    // so do not report it as excluded. git collapses an untracked/ignored directory
    // into one entry, so `p` is frequently a directory and one exception is enough.
    if (negated) {
      const child = normalizePath(body);
      if (child.startsWith(`${p}/`)) excluded = false;
    }
  }

  return excluded;
}

/**
 * Pure decision function — all I/O happens in the caller so this is testable.
 *
 * @param {{
 *   vercelProjectName?: string|null,
 *   vercelProjectId?: string|null,
 *   vercelOrgId?: string|null,
 *   vercelLinkError?: string|null,
 *   branch?: string|null,
 *   headSha?: string|null,
 *   remoteMainSha?: string|null,
 *   behind?: number|null,
 *   ahead?: number|null,
 *   dirtyTracked?: string[],
 *   untrackedDeployable?: string[],
 *   gitignoredDeployable?: string[],
 *   untrackedIgnored?: string[],
 *   gitErrors?: string[],
 *   fetchAttempted?: boolean,
 *   fetchOk?: boolean|null,
 *   override?: string|null,
 * }} facts
 */
export function evaluateProdDeployGuard(facts = {}) {
  const {
    vercelProjectName = null,
    vercelProjectId = null,
    vercelOrgId = null,
    vercelLinkError = null,
    branch = null,
    headSha = null,
    remoteMainSha = null,
    behind = null,
    ahead = null,
    dirtyTracked = [],
    untrackedDeployable = [],
    gitignoredDeployable = [],
    untrackedIgnored = [],
    gitErrors = [],
    fetchAttempted = true,
    fetchOk = true,
    override = null,
  } = facts;

  const reason = typeof override === 'string' ? override.trim() : '';
  // "1"/"true"/"yes" are not reasons. A bypass has to say why, for the next reader.
  const overrideAccepted =
    reason.length >= MIN_REASON_LENGTH && !/^(1|true|yes|y|on)$/i.test(reason);
  const overrideRejected = reason.length > 0 && !overrideAccepted;

  /** @type {{code:string,message:string,overridable:boolean}[]} */
  const findings = [];

  /* ── 1. project linkage — identity, not just the label ─────────────────── */
  if (vercelLinkError) {
    findings.push({
      code: 'vercel_link_unreadable',
      message:
        `.vercel/project.json could not be read or parsed (${vercelLinkError}). ` +
        'Without it Vercel walks UP to a parent checkout and builds THAT tree. ' +
        `Run: vercel link --yes --project ${EXPECTED_PROJECT}`,
      overridable: false,
    });
  } else if (!vercelProjectName && !vercelProjectId) {
    findings.push({
      code: 'no_vercel_link',
      message:
        'No .vercel/project.json in this directory. Vercel would walk UP to a parent ' +
        `checkout and build THAT tree. Run: vercel link --yes --project ${EXPECTED_PROJECT}`,
      overridable: false,
    });
  } else {
    if (vercelProjectName !== EXPECTED_PROJECT) {
      findings.push({
        code: 'wrong_vercel_project',
        message:
          `.vercel/project.json names "${vercelProjectName}", expected "${EXPECTED_PROJECT}". ` +
          'A green deploy to the wrong project is not acceptance evidence.',
        overridable: false,
      });
    }
    // The NAME is a human label — it can be stale or hand-edited and still read
    // right. The IDs are what the Vercel API actually routes on, so they decide.
    if (vercelProjectId !== EXPECTED_PROJECT_ID) {
      findings.push({
        code: 'wrong_vercel_project_id',
        message:
          `projectId "${vercelProjectId ?? 'missing'}" != expected ${EXPECTED_PROJECT_ID}. ` +
          'The name can look correct while the id points somewhere else.',
        overridable: false,
      });
    }
    if (vercelOrgId !== EXPECTED_ORG_ID) {
      findings.push({
        code: 'wrong_vercel_org_id',
        message: `orgId "${vercelOrgId ?? 'missing'}" != expected ${EXPECTED_ORG_ID}.`,
        overridable: false,
      });
    }
  }

  /* ── 2. git verifiability — fail CLOSED ────────────────────────────────── */
  if (gitErrors.length > 0) {
    findings.push({
      code: 'git_verification_failed',
      message:
        `git could not be read (${gitErrors.slice(0, 3).join(' | ')}). The checkout is ` +
        'UNKNOWN, and unknown is not permission. Refusing rather than assuming it is main.',
      overridable: false,
    });
  }

  if (fetchAttempted && fetchOk === false) {
    findings.push({
      code: 'remote_fetch_failed',
      message:
        'git fetch origin main FAILED, so origin/main may be stale here — the exact ' +
        'condition this guard exists to detect. A production deploy needs the network ' +
        'anyway, so this is not a reason to proceed offline.',
      overridable: false,
    });
  }

  if (!fetchAttempted) {
    findings.push({
      code: 'staleness_unverified',
      message:
        '--no-fetch was used, so "0 behind" is measured against a possibly stale ' +
        'origin/main and proves nothing about the real remote.',
      overridable: true,
    });
  }

  const gitReadable = gitErrors.length === 0;

  /* ── 3-4. branch and drift ─────────────────────────────────────────────── */
  if (gitReadable) {
    if (branch !== 'main') {
      findings.push({
        code: 'not_on_main',
        message:
          `HEAD is on "${branch ?? 'detached HEAD'}", not main. Vercel uploads THIS ` +
          'directory, not the branch you think you are shipping.',
        overridable: true,
      });
    }

    if (typeof behind === 'number' && behind > 0) {
      findings.push({
        code: 'behind_main',
        message:
          `Checkout is ${behind} commit(s) BEHIND origin/main. Deploying it would revert ` +
          'merged work that is already live (the 2026-09-21 #1595 cron-auth regression).',
        overridable: true,
      });
    }

    if (typeof ahead === 'number' && ahead > 0) {
      findings.push({
        code: 'ahead_of_main',
        message:
          `Checkout is ${ahead} commit(s) AHEAD of origin/main — unpushed code that no ` +
          'review or CI has seen would ship to production.',
        overridable: true,
      });
    }

    // Belt and braces: with a 0/0 count the SHAs must match. A mismatch means the
    // counts were derived against the wrong ref, so refuse rather than guess.
    if (
      behind === 0 &&
      ahead === 0 &&
      headSha &&
      remoteMainSha &&
      headSha !== remoteMainSha
    ) {
      findings.push({
        code: 'head_sha_mismatch',
        message:
          `HEAD ${headSha.slice(0, 10)} != origin/main ${remoteMainSha.slice(0, 10)} despite ` +
          'a 0/0 ahead-behind count. Refusing rather than guessing.',
        overridable: true,
      });
    }
  }

  /* ── 5. uploadable content nobody reviewed ─────────────────────────────── */
  if (dirtyTracked.length > 0) {
    findings.push({
      code: 'dirty_worktree',
      message:
        `${dirtyTracked.length} modified tracked file(s) would be uploaded unreviewed: ` +
        `${dirtyTracked.slice(0, 5).join(', ')}${dirtyTracked.length > 5 ? ', …' : ''}`,
      overridable: true,
    });
  }

  if (untrackedDeployable.length > 0) {
    findings.push({
      code: 'untracked_deployable',
      message:
        `${untrackedDeployable.length} untracked file(s)/dir(s) are NOT excluded by ` +
        '.vercelignore and would be uploaded — the CLI uploads the working directory and ' +
        'does not honour .gitignore: ' +
        `${untrackedDeployable.slice(0, 5).join(', ')}${untrackedDeployable.length > 5 ? ', …' : ''}`,
      overridable: true,
    });
  }

  if (gitignoredDeployable.length > 0) {
    findings.push({
      code: 'gitignored_deployable',
      message:
        `${gitignoredDeployable.length} GITIGNORED path(s) are not excluded by .vercelignore. ` +
        'git hides these from a normal status, but the CLI uploads the working directory and ' +
        'does not honour .gitignore — so "git says clean" does NOT mean "nothing extra ships". ' +
        'Add them to .vercelignore: ' +
        `${gitignoredDeployable.slice(0, 5).join(', ')}${gitignoredDeployable.length > 5 ? ', …' : ''}`,
      overridable: true,
    });
  }

  if (overrideRejected) {
    findings.push({
      code: 'override_not_a_reason',
      message:
        `ALLOW_NONMAIN_PROD_DEPLOY="${reason}" is not a reason. Give a sentence of at least ` +
        `${MIN_REASON_LENGTH} characters, e.g. "rollback to last good build, incident 2026-09-21".`,
      overridable: false,
    });
  }

  const blocking = findings.filter((f) => !(overrideAccepted && f.overridable));
  const waived = findings.filter((f) => overrideAccepted && f.overridable);

  const warnings = [];
  if (untrackedIgnored.length > 0) {
    warnings.push(
      `${untrackedIgnored.length} untracked path(s) excluded by .vercelignore (not uploaded): ` +
        `${untrackedIgnored.slice(0, 3).join(', ')}${untrackedIgnored.length > 3 ? ', …' : ''}`,
    );
  }

  return {
    ok: blocking.length === 0,
    blocking,
    waived,
    warnings,
    overrideAccepted,
    overrideReason: overrideAccepted ? reason : null,
    facts: {
      vercelProjectName,
      vercelProjectId,
      vercelOrgId,
      branch,
      headSha,
      remoteMainSha,
      behind,
      ahead,
      fetchAttempted,
      fetchOk,
      gitErrorCount: gitErrors.length,
    },
  };
}

/* ───────────────────────────── CLI ───────────────────────────── */

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * `git status --porcelain` encodes status in the FIRST TWO COLUMNS, so a modified
 * unstaged file starts with a leading space (" M path"). Trimming the whole output
 * eats that space on the first line only and the path loses its first character —
 * "package.json" printed as "ackage.json". Trim the end only.
 */
function gitPorcelain(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).replace(/\s+$/, '');
}

function readVercelLink(cwd) {
  const file = path.join(cwd, '.vercel', 'project.json');
  if (!fs.existsSync(file)) {
    return { projectName: null, projectId: null, orgId: null, error: null };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      projectName: parsed.projectName ?? null,
      projectId: parsed.projectId ?? null,
      orgId: parsed.orgId ?? null,
      error: null,
    };
  } catch (e) {
    return {
      projectName: null,
      projectId: null,
      orgId: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function readVercelIgnore(cwd) {
  try {
    return fs.readFileSync(path.join(cwd, '.vercelignore'), 'utf8').split('\n');
  } catch {
    return [];
  }
}

function gatherFacts(cwd, { fetch: shouldFetch }) {
  /** @type {string[]} */
  const gitErrors = [];
  let fetchOk = null;

  if (shouldFetch) {
    try {
      git(['fetch', 'origin', 'main', '--quiet'], cwd);
      fetchOk = true;
    } catch (e) {
      // NOT swallowed. Offline means we cannot know whether we are behind, which is
      // precisely the failure this guard exists to catch.
      fetchOk = false;
    }
  }

  /** Record the failure instead of returning a plausible-looking default. */
  const tracked = (label, fn) => {
    try {
      return fn();
    } catch (e) {
      gitErrors.push(`${label}: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`);
      return null;
    }
  };

  let branch = tracked('rev-parse --abbrev-ref HEAD', () =>
    git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
  );
  if (branch === 'HEAD') branch = null; // detached

  const headSha = tracked('rev-parse HEAD', () => git(['rev-parse', 'HEAD'], cwd));
  const remoteMainSha = tracked('rev-parse origin/main', () =>
    git(['rev-parse', 'origin/main'], cwd),
  );

  let behind = null;
  let ahead = null;
  if (headSha && remoteMainSha) {
    const counts = tracked('rev-list --left-right --count', () =>
      git(['rev-list', '--left-right', '--count', 'origin/main...HEAD'], cwd),
    );
    if (counts) {
      const [b, a] = counts.split(/\s+/).map((n) => Number.parseInt(n, 10));
      if (Number.isNaN(b) || Number.isNaN(a)) {
        gitErrors.push(`rev-list --count: unparseable output "${counts}"`);
      } else {
        behind = b;
        ahead = a;
      }
    }
  }

  // `--ignored` is load-bearing, not a detail. A plain `git status --porcelain`
  // lists ONLY ordinary untracked files — it hides everything .gitignore covers.
  // But .vercelignore records that the CLI "uploads the working directory and does
  // NOT honour .gitignore", so gitignored files are uploaded too. Enumerating only
  // the untracked ones inspects the smaller half of what actually ships: measured
  // on this repo, .env.local and two .env.local.*-backup files are gitignored,
  // therefore invisible to the old check, and NOT excluded by .vercelignore.
  const porcelain = tracked('status --porcelain --ignored', () =>
    gitPorcelain(['status', '--porcelain', '--ignored'], cwd),
  );
  const lines = (porcelain ?? '').split('\n').filter(Boolean);
  const dirtyTracked = lines
    .filter((l) => !l.startsWith('??') && !l.startsWith('!!'))
    .map((l) => l.slice(3).trim());
  const untrackedAll = lines.filter((l) => l.startsWith('??')).map((l) => l.slice(3).trim());
  const gitignoredAll = lines.filter((l) => l.startsWith('!!')).map((l) => l.slice(3).trim());

  const ignorePatterns = readVercelIgnore(cwd);
  const excluded = (f) => isVercelIgnored(f, ignorePatterns);
  const untrackedDeployable = untrackedAll.filter((f) => !excluded(f));
  const gitignoredDeployable = gitignoredAll.filter((f) => !excluded(f));
  const untrackedIgnored = [...untrackedAll, ...gitignoredAll].filter(excluded);

  const link = readVercelLink(cwd);

  return {
    vercelProjectName: link.projectName,
    vercelProjectId: link.projectId,
    vercelOrgId: link.orgId,
    vercelLinkError: link.error,
    branch,
    headSha,
    remoteMainSha,
    behind,
    ahead,
    dirtyTracked,
    untrackedDeployable,
    gitignoredDeployable,
    untrackedIgnored,
    gitErrors,
    fetchAttempted: Boolean(shouldFetch),
    fetchOk,
    override: process.env.ALLOW_NONMAIN_PROD_DEPLOY ?? null,
  };
}

/** Pinned regressions: shapes that must refuse, and the one that must pass. */
function selfTest() {
  const linked = {
    vercelProjectName: EXPECTED_PROJECT,
    vercelProjectId: EXPECTED_PROJECT_ID,
    vercelOrgId: EXPECTED_ORG_ID,
  };
  const cases = [
    [
      'incident shape refuses',
      evaluateProdDeployGuard({
        ...linked,
        branch: 'fix/cyrus-freshness-provenance',
        headSha: 'dece7dba'.padEnd(40, '0'),
        remoteMainSha: '1262c59e'.padEnd(40, '0'),
        behind: 4,
        ahead: 1,
      }),
      (r) => !r.ok && r.blocking.some((f) => f.code === 'behind_main'),
    ],
    [
      'git error fails CLOSED',
      evaluateProdDeployGuard({ ...linked, gitErrors: ['rev-parse HEAD: not a git repository'] }),
      (r) => !r.ok && r.blocking.some((f) => f.code === 'git_verification_failed'),
    ],
    [
      'failed fetch fails CLOSED',
      evaluateProdDeployGuard({
        ...linked,
        branch: 'main',
        headSha: 'a'.repeat(40),
        remoteMainSha: 'a'.repeat(40),
        behind: 0,
        ahead: 0,
        fetchOk: false,
      }),
      (r) => !r.ok && r.blocking.some((f) => f.code === 'remote_fetch_failed'),
    ],
    [
      'right name + wrong projectId refuses',
      evaluateProdDeployGuard({
        vercelProjectName: EXPECTED_PROJECT,
        vercelProjectId: 'prj_someoneelse',
        vercelOrgId: EXPECTED_ORG_ID,
        branch: 'main',
        headSha: 'a'.repeat(40),
        remoteMainSha: 'a'.repeat(40),
        behind: 0,
        ahead: 0,
      }),
      (r) => !r.ok && r.blocking.some((f) => f.code === 'wrong_vercel_project_id'),
    ],
    [
      'deployable untracked file refuses',
      evaluateProdDeployGuard({
        ...linked,
        branch: 'main',
        headSha: 'a'.repeat(40),
        remoteMainSha: 'a'.repeat(40),
        behind: 0,
        ahead: 0,
        untrackedDeployable: ['src/app/secret-draft.tsx'],
      }),
      (r) => !r.ok && r.blocking.some((f) => f.code === 'untracked_deployable'),
    ],
    [
      'gitignored file not excluded by .vercelignore refuses',
      evaluateProdDeployGuard({
        ...linked,
        branch: 'main',
        headSha: 'a'.repeat(40),
        remoteMainSha: 'a'.repeat(40),
        behind: 0,
        ahead: 0,
        gitignoredDeployable: ['.env.local'],
      }),
      (r) => !r.ok && r.blocking.some((f) => f.code === 'gitignored_deployable'),
    ],
    [
      'a "!" negation is not mistaken for an exclusion',
      { ok: isVercelIgnored('bundle', ['bundle/', '!bundle/keep.txt']) === false },
      (r) => r.ok,
    ],
    [
      'clean main passes',
      evaluateProdDeployGuard({
        ...linked,
        branch: 'main',
        headSha: 'a'.repeat(40),
        remoteMainSha: 'a'.repeat(40),
        behind: 0,
        ahead: 0,
      }),
      (r) => r.ok,
    ],
  ];

  let failed = 0;
  for (const [label, result, assert] of cases) {
    const pass = assert(result);
    console.log(`${pass ? '✓' : '✗'} ${label}`);
    if (!pass) failed += 1;
  }
  return failed === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());

  const asJson = argv.includes('--json');
  const isFinal = argv.includes('--final');
  const cwd = process.cwd();
  const facts = gatherFacts(cwd, { fetch: !argv.includes('--no-fetch') });
  const result = evaluateProdDeployGuard(facts);

  if (asJson) {
    console.log(JSON.stringify({ cwd, final: isFinal, ...result }, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  const shortHead = facts.headSha ? facts.headSha.slice(0, 10) : 'UNKNOWN';
  const shortMain = facts.remoteMainSha ? facts.remoteMainSha.slice(0, 10) : 'UNKNOWN';
  console.log(
    isFinal ? 'prod-deploy guard — FINAL recheck (immediately before upload)' : 'prod-deploy guard',
  );
  console.log(`  dir      ${cwd}`);
  console.log(`  project  ${facts.vercelProjectName ?? '(no .vercel link)'}`);
  console.log(`  ids      project=${facts.vercelProjectId ?? '-'} org=${facts.vercelOrgId ?? '-'}`);
  console.log(`  branch   ${facts.branch ?? '(detached HEAD)'}`);
  console.log(`  HEAD     ${shortHead}   origin/main ${shortMain}`);
  console.log(
    `  drift    ${facts.behind ?? '?'} behind / ${facts.ahead ?? '?'} ahead` +
      (facts.fetchAttempted ? '' : '   (--no-fetch: NOT verified against the real remote)'),
  );

  for (const w of result.warnings) console.log(`  ! ${w}`);

  if (result.overrideAccepted) {
    console.log(`\n  OVERRIDE ACCEPTED — "${result.overrideReason}"`);
    for (const f of result.waived) console.log(`    waived: ${f.code} — ${f.message}`);
  }

  if (result.ok) {
    console.log(`\n✓ safe to deploy${isFinal ? ' (rechecked at upload time)' : ''}`);
    process.exit(0);
  }

  console.log('\n✗ REFUSED — production deploy blocked\n');
  for (const f of result.blocking) console.log(`  [${f.code}] ${f.message}\n`);
  console.log('  To ship main: deploy from a clean checkout of origin/main.');
  console.log('  To fix a bad alias: prefer `vercel promote <deployment>` over rebuilding.');
  console.log('  Deliberate exception: ALLOW_NONMAIN_PROD_DEPLOY="<why>" (branch/drift/cleanliness only).');
  console.log('  NOTE: a bare `vercel --prod` bypasses this guard entirely —');
  console.log('        docs/engineering/production-deploy-boundary.md.');
  process.exit(1);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]).endsWith('guard-prod-deploy.mjs');
if (invokedDirectly) main();
