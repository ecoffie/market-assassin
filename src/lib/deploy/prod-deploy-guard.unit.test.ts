/**
 * The production deploy guard must refuse the 2026-09-21 incident shape, and must
 * fail CLOSED on anything it cannot verify.
 *
 * A `vercel --prod` from the freshly-merged FEATURE-BRANCH worktree built the branch
 * tree, went READY, and took the production aliases from the git build of the merge
 * commit — reverting #1595's cron-auth fix while every signal stayed green.
 *
 * These tests pin the decision, not the printing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs guard script, no type declarations by design
import {
  evaluateProdDeployGuard,
  isVercelIgnored,
  EXPECTED_PROJECT,
  EXPECTED_PROJECT_ID,
  EXPECTED_ORG_ID,
  // @ts-expect-error — see above
} from '../../../scripts/guard-prod-deploy.mjs';

const MAIN_SHA = '1262c59ef49453efde80a2a170f8951b58431f41';
const BRANCH_SHA = 'dece7dbae09d1fc9be904ad2a3d487aa8b6841e1';

type Guard = {
  ok: boolean;
  blocking: { code: string; message: string }[];
  waived: { code: string }[];
  warnings: string[];
  overrideAccepted: boolean;
};

const codes = (r: Guard) => r.blocking.map((f) => f.code);

/** A correctly linked, exactly-on-main, clean checkout. */
const HEALTHY = {
  vercelProjectName: EXPECTED_PROJECT,
  vercelProjectId: EXPECTED_PROJECT_ID,
  vercelOrgId: EXPECTED_ORG_ID,
  branch: 'main',
  headSha: MAIN_SHA,
  remoteMainSha: MAIN_SHA,
  behind: 0,
  ahead: 0,
  fetchAttempted: true,
  fetchOk: true,
};

describe('prod deploy guard — the 2026-09-21 incident', () => {
  it('refuses the branch worktree that actually shipped', () => {
    const r: Guard = evaluateProdDeployGuard({
      ...HEALTHY,
      branch: 'fix/cyrus-freshness-provenance',
      headSha: BRANCH_SHA,
      behind: 4,
      ahead: 1,
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('not_on_main');
    expect(codes(r)).toContain('behind_main');
    expect(codes(r)).toContain('ahead_of_main');
  });

  it('refuses a checkout that is merely BEHIND main, even on main', () => {
    const r: Guard = evaluateProdDeployGuard({
      ...HEALTHY,
      headSha: 'b1da5a461035d43baa228d9bbd626ed4b34662e3',
      behind: 1,
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(['behind_main']);
  });

  it('passes a clean checkout that is exactly origin/main', () => {
    const r: Guard = evaluateProdDeployGuard(HEALTHY);
    expect(r.ok).toBe(true);
    expect(r.blocking).toEqual([]);
  });
});

describe('prod deploy guard — fails CLOSED on git verification errors', () => {
  it('refuses when a git command errored, instead of assuming a default', () => {
    // The original bug: errors were swallowed to null/0, which read as "0 behind".
    const r: Guard = evaluateProdDeployGuard({
      vercelProjectName: EXPECTED_PROJECT,
      vercelProjectId: EXPECTED_PROJECT_ID,
      vercelOrgId: EXPECTED_ORG_ID,
      gitErrors: ['rev-parse origin/main: unknown revision'],
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('git_verification_failed');
  });

  it('a git error is NOT waivable by an override reason', () => {
    const r: Guard = evaluateProdDeployGuard({
      vercelProjectName: EXPECTED_PROJECT,
      vercelProjectId: EXPECTED_PROJECT_ID,
      vercelOrgId: EXPECTED_ORG_ID,
      gitErrors: ['status --porcelain: fatal'],
      override: 'emergency rollback, incident 2026-09-21',
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('git_verification_failed');
  });

  it('refuses when git fetch failed — staleness is then unknowable', () => {
    const r: Guard = evaluateProdDeployGuard({ ...HEALTHY, fetchOk: false });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('remote_fetch_failed');
  });

  it('flags --no-fetch as unverified staleness rather than silently passing', () => {
    const r: Guard = evaluateProdDeployGuard({
      ...HEALTHY,
      fetchAttempted: false,
      fetchOk: null,
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('staleness_unverified');
  });

  it('does not emit drift findings it cannot substantiate when git is unreadable', () => {
    const r: Guard = evaluateProdDeployGuard({
      vercelProjectName: EXPECTED_PROJECT,
      vercelProjectId: EXPECTED_PROJECT_ID,
      vercelOrgId: EXPECTED_ORG_ID,
      gitErrors: ['rev-parse HEAD: not a git repository'],
    });
    // "not on main" would be a fabricated claim — we do not know what branch it is.
    expect(codes(r)).not.toContain('not_on_main');
    expect(codes(r)).toContain('git_verification_failed');
  });
});

describe('prod deploy guard — project identity, not just the label', () => {
  it('refuses when there is no .vercel link (Vercel would build a parent checkout)', () => {
    const r: Guard = evaluateProdDeployGuard({
      ...HEALTHY,
      vercelProjectName: null,
      vercelProjectId: null,
      vercelOrgId: null,
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('no_vercel_link');
  });

  it('refuses an unparseable .vercel/project.json', () => {
    const r: Guard = evaluateProdDeployGuard({
      ...HEALTHY,
      vercelProjectName: null,
      vercelProjectId: null,
      vercelOrgId: null,
      vercelLinkError: 'Unexpected token } in JSON at position 42',
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('vercel_link_unreadable');
  });

  it('refuses the RIGHT name with the WRONG projectId', () => {
    // The name is a human label; the id is what the API routes on.
    const r: Guard = evaluateProdDeployGuard({
      ...HEALTHY,
      vercelProjectId: 'prj_someoneElsesProject',
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('wrong_vercel_project_id');
  });

  it('refuses the right project in the WRONG org/team', () => {
    const r: Guard = evaluateProdDeployGuard({ ...HEALTHY, vercelOrgId: 'team_someoneelse' });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('wrong_vercel_org_id');
  });

  it('refuses the wrong project name even with a valid override reason', () => {
    // The `cai-language-guardrails` accident: green build, wrong project.
    const r: Guard = evaluateProdDeployGuard({
      ...HEALTHY,
      vercelProjectName: 'cai-language-guardrails',
      override: 'emergency rollback, incident 2026-09-21',
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('wrong_vercel_project');
  });
});

describe('prod deploy guard — uploadable content nobody reviewed', () => {
  it('refuses modified tracked files (a CLI deploy uploads the working directory)', () => {
    const r: Guard = evaluateProdDeployGuard({
      ...HEALTHY,
      dirtyTracked: ['src/app/api/cron/snapshot-multisite/route.ts'],
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('dirty_worktree');
  });

  it('refuses untracked files that .vercelignore does NOT exclude', () => {
    // .vercelignore records that the CLI does not honour .gitignore, so these ship.
    const r: Guard = evaluateProdDeployGuard({
      ...HEALTHY,
      untrackedDeployable: ['src/app/scratch-draft.tsx'],
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('untracked_deployable');
  });

  it('does not block on untracked paths .vercelignore excludes — warns instead', () => {
    const r: Guard = evaluateProdDeployGuard({
      ...HEALTHY,
      untrackedIgnored: ['.claude/worktrees/'],
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBe(1);
  });
});

describe('isVercelIgnored — conservative by design', () => {
  const patterns = ['# comment', '.claude/', 'node_modules', '.next', '.tmp-probe/'];

  it('matches a directory pattern and everything under it', () => {
    expect(isVercelIgnored('.claude/worktrees/x', patterns)).toBe(true);
    expect(isVercelIgnored('.claude/', patterns)).toBe(true);
  });

  it('matches a bare name and its subtree', () => {
    expect(isVercelIgnored('node_modules', patterns)).toBe(true);
    expect(isVercelIgnored('node_modules/foo/index.js', patterns)).toBe(true);
  });

  it('does not match an unrelated path', () => {
    expect(isVercelIgnored('src/app/page.tsx', patterns)).toBe(false);
  });

  it('refuses to claim a GLOB excludes anything — unproven means it still blocks', () => {
    // Guessing a pattern excludes a file is how unreviewed content reaches prod.
    expect(isVercelIgnored('secret.log', ['*.log'])).toBe(false);
  });

  it('ignores comments and blank lines', () => {
    expect(isVercelIgnored('comment', ['# comment', '', '   '])).toBe(false);
  });

  it('does not let a prefix collision match a sibling', () => {
    expect(isVercelIgnored('.nextgen/thing', ['.next'])).toBe(false);
  });
});

describe('prod deploy guard — the escape hatch must stay deliberate', () => {
  it('waives branch/staleness/cleanliness rules when given a real reason', () => {
    const r: Guard = evaluateProdDeployGuard({
      ...HEALTHY,
      branch: 'hotfix/rollback',
      headSha: BRANCH_SHA,
      behind: 2,
      override: 'rollback to last good build, incident 2026-09-21',
    });
    expect(r.ok).toBe(true);
    expect(r.overrideAccepted).toBe(true);
    expect(r.waived.map((f) => f.code)).toContain('behind_main');
  });

  it('rejects "1" as a reason — a bypass nobody can read later is how this recurs', () => {
    const r: Guard = evaluateProdDeployGuard({ ...HEALTHY, override: '1' });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('override_not_a_reason');
  });

  it('rejects a too-short reason', () => {
    const r: Guard = evaluateProdDeployGuard({
      ...HEALTHY,
      branch: 'feature/x',
      override: 'because',
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('override_not_a_reason');
  });
});

describe('prod deploy guard — refuses to guess', () => {
  it('blocks a 0/0 ahead-behind count whose SHAs disagree', () => {
    const r: Guard = evaluateProdDeployGuard({ ...HEALTHY, headSha: BRANCH_SHA });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('head_sha_mismatch');
  });
});

/**
 * Lifecycle ordering. npm runs a `pre<name>` script AUTOMATICALLY before `<name>`,
 * so a script literally called `predeploy` ran the whole multi-minute check suite
 * BEFORE the guard, and then a second time inside the chain. The guard was never
 * fail-fast and the suite ran twice. Measured, not assumed.
 */
describe('npm lifecycle ordering — the guard must actually run first', () => {
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };

  it('defines no script named "predeploy" (npm would auto-run it before the guard)', () => {
    expect(pkg.scripts.predeploy).toBeUndefined();
  });

  it('defines no implicit pre-hook for any deploy script', () => {
    const hooks = Object.keys(pkg.scripts).filter(
      (k) => k.startsWith('pre') && pkg.scripts[k.slice(3)] !== undefined,
    );
    expect(hooks).toEqual([]);
  });

  it('runs the guard before the check suite', () => {
    const d = pkg.scripts.deploy;
    expect(d.indexOf('guard:prod-deploy')).toBeLessThan(d.indexOf('deploy:checks'));
  });

  it('rechecks immediately before upload — main can move while the suite runs', () => {
    const d = pkg.scripts.deploy;
    expect(d).toContain('--final');
    expect(d.indexOf('--final')).toBeGreaterThan(d.indexOf('deploy:checks'));
    expect(d.indexOf('--final')).toBeLessThan(d.indexOf('vercel --prod'));
  });

  it('still runs the full check suite', () => {
    expect(pkg.scripts['deploy:checks']).toContain('test:unit');
  });
});
