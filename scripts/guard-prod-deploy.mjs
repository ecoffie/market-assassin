/**
 * Refuse a production deploy that would ship a stale or wrong checkout.
 *
 * WHY THIS EXISTS: on 2026-09-21T01:47:09Z, 20 seconds after PR #1597 was
 * squash-merged, `vercel --prod` was invoked from the FEATURE-BRANCH worktree
 * (`fix/cyrus-freshness-provenance` @ dece7dba). Vercel uploads the directory it
 * is invoked from — not "the branch main is on" — so it built the branch tree,
 * went READY, and took the production aliases (getmindy.ai, mcp.getmindy.ai,
 * mi.govcongiants.com, tools.govcongiants.org) away from the legitimate git
 * build of the merge commit that had started 20 seconds earlier.
 *
 * The branch head was not "behind" in any way a human would notice — it was the
 * exact head that had just been reviewed and merged. What it lacked was the work
 * merged AROUND it: #1595, #1596, #1598. One of those was load-bearing. #1595 had
 * taught `api/cron/snapshot-multisite` to accept the dispatcher's
 * `Authorization: Bearer $CRON_SECRET`, and its migration had already stripped the
 * inline `?password=` workaround out of `cron_jobs.route` in the live database. The
 * branch build predated that fix, so the enabled daily job had NO working auth path
 * left. Measured on the superseded deployment: correct bearer -> 401. On restored
 * main: correct bearer -> 400 (auth passes, stops before any work).
 *
 * Nothing failed loudly. The deploy was green, the aliases were Ready, and the
 * acceptance suite run against it passed 33/33 — because the acceptance only
 * exercised the Cyrus code, which WAS present. A green build proves the tree you
 * uploaded compiles. It cannot tell you that you uploaded the wrong tree.
 *
 * So the check has to happen BEFORE Vercel is invoked, and it has to compare the
 * checkout against `origin/main` rather than against itself.
 *
 * THE CONTRACT. A production deploy may ship only a checkout that is:
 *
 *   1. LINKED TO THE RIGHT PROJECT — `.vercel/project.json` present in THIS
 *      directory and naming `market-assassin`. Absent, the CLI walks UP to a
 *      parent checkout and silently builds that one instead. Never overridable.
 *   2. ON main — not a feature branch, not detached.
 *   3. EXACTLY origin/main — 0 behind (missing merged work, the incident above)
 *      and 0 ahead (unpushed commits ship code nobody reviewed).
 *   4. CLEAN — no modified tracked files. A CLI deploy uploads the working
 *      directory, so uncommitted edits reach production without review.
 *
 * ESCAPE HATCH. Emergency rollbacks are real. `ALLOW_NONMAIN_PROD_DEPLOY="<reason>"`
 * downgrades 2-4 to loud warnings. The reason must be a real sentence (>= 8 chars):
 * `=1` is not a reason, and a bypass nobody can read later is how this recurs.
 * Rule 1 is NEVER overridable — deploying to the wrong project is never intended.
 *
 * PREFER PROMOTION. Re-deploying main to fix a bad alias rebuilds it for no reason.
 * `vercel promote <deployment>` moves the aliases to the existing Ready build of
 * that commit. That is how this incident was actually resolved.
 *
 * Run:
 *   npm run guard:prod-deploy              # gate (runs first inside `npm run deploy`)
 *   npm run guard:prod-deploy -- --json    # machine-readable
 *   npm run guard:prod-deploy -- --no-fetch
 *   npm run guard:prod-deploy -- --self-test
 *
 * Exit 0 = safe to deploy. 1 = refused (or self-test failed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const EXPECTED_PROJECT = 'market-assassin';
const MIN_REASON_LENGTH = 8;

/**
 * Pure decision function — all I/O happens in the caller so this is testable.
 *
 * @param {{
 *   vercelProjectName?: string|null,
 *   branch?: string|null,
 *   headSha?: string|null,
 *   remoteMainSha?: string|null,
 *   behind?: number,
 *   ahead?: number,
 *   dirtyTracked?: string[],
 *   untracked?: string[],
 *   override?: string|null,
 * }} facts
 */
export function evaluateProdDeployGuard(facts = {}) {
  const {
    vercelProjectName = null,
    branch = null,
    headSha = null,
    remoteMainSha = null,
    behind = 0,
    ahead = 0,
    dirtyTracked = [],
    untracked = [],
    override = null,
  } = facts;

  const reason = typeof override === 'string' ? override.trim() : '';
  // "1"/"true"/"yes" are not reasons. A bypass has to say why, for the next reader.
  const overrideAccepted =
    reason.length >= MIN_REASON_LENGTH && !/^(1|true|yes|y|on)$/i.test(reason);
  const overrideRejected = reason.length > 0 && !overrideAccepted;

  /** @type {{code:string,message:string,overridable:boolean}[]} */
  const findings = [];

  if (!vercelProjectName) {
    findings.push({
      code: 'no_vercel_link',
      message:
        'No .vercel/project.json in this directory. Vercel would walk UP to a parent ' +
        'checkout and build THAT tree. Run: vercel link --yes --project ' +
        `${EXPECTED_PROJECT}`,
      overridable: false,
    });
  } else if (vercelProjectName !== EXPECTED_PROJECT) {
    findings.push({
      code: 'wrong_vercel_project',
      message:
        `.vercel/project.json names "${vercelProjectName}", expected ` +
        `"${EXPECTED_PROJECT}". A green deploy to the wrong project is not acceptance evidence.`,
      overridable: false,
    });
  }

  if (branch !== 'main') {
    findings.push({
      code: 'not_on_main',
      message:
        `HEAD is on "${branch ?? 'detached HEAD'}", not main. Vercel uploads THIS ` +
        'directory, not the branch you think you are shipping.',
      overridable: true,
    });
  }

  if (behind > 0) {
    findings.push({
      code: 'behind_main',
      message:
        `Checkout is ${behind} commit(s) BEHIND origin/main. Deploying it would ` +
        'revert merged work that is already live (the 2026-09-21 #1595 cron-auth regression).',
      overridable: true,
    });
  }

  if (ahead > 0) {
    findings.push({
      code: 'ahead_of_main',
      message:
        `Checkout is ${ahead} commit(s) AHEAD of origin/main — unpushed code that ` +
        'no review or CI has seen would ship to production.',
      overridable: true,
    });
  }

  // Belt and braces: if both counts are 0 the SHAs must match. A mismatch here means
  // the counts were derived against the wrong ref, so refuse rather than guess.
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
        `HEAD ${headSha.slice(0, 10)} != origin/main ${remoteMainSha.slice(0, 10)} ` +
        'despite a 0/0 ahead-behind count. Refusing rather than guessing.',
      overridable: true,
    });
  }

  if (dirtyTracked.length > 0) {
    findings.push({
      code: 'dirty_worktree',
      message:
        `${dirtyTracked.length} modified tracked file(s) would be uploaded unreviewed: ` +
        `${dirtyTracked.slice(0, 5).join(', ')}${dirtyTracked.length > 5 ? ', …' : ''}`,
      overridable: true,
    });
  }

  if (overrideRejected) {
    findings.push({
      code: 'override_not_a_reason',
      message:
        `ALLOW_NONMAIN_PROD_DEPLOY="${reason}" is not a reason. Give a sentence of at ` +
        `least ${MIN_REASON_LENGTH} characters explaining why, e.g. ` +
        '"rollback to last good build, incident 2026-09-21".',
      overridable: false,
    });
  }

  const blocking = findings.filter((f) => !(overrideAccepted && f.overridable));
  const waived = findings.filter((f) => overrideAccepted && f.overridable);

  const warnings = [];
  if (untracked.length > 0) {
    warnings.push(
      `${untracked.length} untracked file(s) present; a CLI deploy uploads the working ` +
        `directory: ${untracked.slice(0, 3).join(', ')}${untracked.length > 3 ? ', …' : ''}`,
    );
  }

  return {
    ok: blocking.length === 0,
    blocking,
    waived,
    warnings,
    overrideAccepted,
    overrideReason: overrideAccepted ? reason : null,
    facts: { vercelProjectName, branch, headSha, remoteMainSha, behind, ahead },
  };
}

/* ───────────────────────────── CLI ───────────────────────────── */

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * `git status --porcelain` encodes the status in the FIRST TWO COLUMNS, so a
 * modified-but-unstaged file starts with a leading space (" M path"). Trimming the
 * whole output eats that space on the first line only, and the path then loses its
 * first character — "package.json" printed as "ackage.json". Trim the end only.
 */
function gitPorcelain(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).replace(/\s+$/, '');
}

function readVercelProjectName(cwd) {
  try {
    const raw = fs.readFileSync(path.join(cwd, '.vercel', 'project.json'), 'utf8');
    return JSON.parse(raw).projectName ?? null;
  } catch {
    return null;
  }
}

function gatherFacts(cwd, { fetch: shouldFetch }) {
  if (shouldFetch) {
    try {
      git(['fetch', 'origin', 'main', '--quiet'], cwd);
    } catch {
      // Offline is not a pass. Fall through: the ahead/behind below will be computed
      // against whatever origin/main we last saw, and a stale ref is itself a refusal
      // risk the operator should see in the printed SHAs.
    }
  }

  let branch = null;
  try {
    const b = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    branch = b === 'HEAD' ? null : b;
  } catch {
    /* not a git checkout */
  }

  const safe = (fn, fallback = null) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  const headSha = safe(() => git(['rev-parse', 'HEAD'], cwd));
  const remoteMainSha = safe(() => git(['rev-parse', 'origin/main'], cwd));

  let behind = 0;
  let ahead = 0;
  if (headSha && remoteMainSha) {
    const counts = safe(
      () => git(['rev-list', '--left-right', '--count', `origin/main...HEAD`], cwd),
      null,
    );
    if (counts) {
      const [b, a] = counts.split(/\s+/).map((n) => Number.parseInt(n, 10) || 0);
      behind = b;
      ahead = a;
    }
  }

  const porcelain = safe(() => gitPorcelain(['status', '--porcelain'], cwd), '') || '';
  const lines = porcelain.split('\n').filter(Boolean);
  const dirtyTracked = lines
    .filter((l) => !l.startsWith('??'))
    .map((l) => l.slice(3).trim());
  const untracked = lines.filter((l) => l.startsWith('??')).map((l) => l.slice(3).trim());

  return {
    vercelProjectName: readVercelProjectName(cwd),
    branch,
    headSha,
    remoteMainSha,
    behind,
    ahead,
    dirtyTracked,
    untracked,
    override: process.env.ALLOW_NONMAIN_PROD_DEPLOY ?? null,
  };
}

/** Pinned regression: the exact 2026-09-21 shape must refuse. */
function selfTest() {
  const incident = evaluateProdDeployGuard({
    vercelProjectName: 'market-assassin',
    branch: 'fix/cyrus-freshness-provenance',
    headSha: 'dece7dbae09d1fc9be904ad2a3d487aa8b6841e1',
    remoteMainSha: '1262c59ef49453efde80a2a170f8951b58431f41',
    behind: 4,
    ahead: 1,
  });
  const healthy = evaluateProdDeployGuard({
    vercelProjectName: 'market-assassin',
    branch: 'main',
    headSha: '1262c59ef49453efde80a2a170f8951b58431f41',
    remoteMainSha: '1262c59ef49453efde80a2a170f8951b58431f41',
  });
  const wrongProjectEvenWithReason = evaluateProdDeployGuard({
    vercelProjectName: 'cai-language-guardrails',
    branch: 'main',
    headSha: 'a'.repeat(40),
    remoteMainSha: 'a'.repeat(40),
    override: 'rollback during incident 2026-09-21',
  });

  const checks = [
    ['incident shape refuses', incident.ok === false],
    ['incident cites not_on_main', incident.blocking.some((f) => f.code === 'not_on_main')],
    ['incident cites behind_main', incident.blocking.some((f) => f.code === 'behind_main')],
    ['clean main passes', healthy.ok === true],
    ['wrong project is never waivable', wrongProjectEvenWithReason.ok === false],
  ];
  let failed = 0;
  for (const [label, pass] of checks) {
    console.log(`${pass ? '✓' : '✗'} ${label}`);
    if (!pass) failed += 1;
  }
  return failed === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());

  const asJson = argv.includes('--json');
  const cwd = process.cwd();
  const facts = gatherFacts(cwd, { fetch: !argv.includes('--no-fetch') });
  const result = evaluateProdDeployGuard(facts);

  if (asJson) {
    console.log(JSON.stringify({ cwd, ...result }, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  const shortHead = facts.headSha ? facts.headSha.slice(0, 10) : 'unknown';
  const shortMain = facts.remoteMainSha ? facts.remoteMainSha.slice(0, 10) : 'unknown';
  console.log('prod-deploy guard');
  console.log(`  dir      ${cwd}`);
  console.log(`  project  ${facts.vercelProjectName ?? '(no .vercel link)'}`);
  console.log(`  branch   ${facts.branch ?? '(detached HEAD)'}`);
  console.log(`  HEAD     ${shortHead}   origin/main ${shortMain}`);
  console.log(`  drift    ${facts.behind} behind / ${facts.ahead} ahead`);

  for (const w of result.warnings) console.log(`  ! ${w}`);

  if (result.overrideAccepted) {
    console.log(`\n  OVERRIDE ACCEPTED — "${result.overrideReason}"`);
    for (const f of result.waived) console.log(`    waived: ${f.code} — ${f.message}`);
  }

  if (result.ok) {
    console.log('\n✓ safe to deploy');
    process.exit(0);
  }

  console.log('\n✗ REFUSED — production deploy blocked\n');
  for (const f of result.blocking) console.log(`  [${f.code}] ${f.message}\n`);
  console.log('  To ship main: deploy from a clean checkout of origin/main.');
  console.log('  To fix a bad alias: prefer `vercel promote <deployment>` over rebuilding.');
  console.log('  Deliberate exception: ALLOW_NONMAIN_PROD_DEPLOY="<why>" (rules 2-4 only).');
  process.exit(1);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]).endsWith('guard-prod-deploy.mjs');
if (invokedDirectly) main();
