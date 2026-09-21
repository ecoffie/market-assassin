/**
 * The production deploy guard must refuse the exact 2026-09-21 incident shape.
 *
 * A `vercel --prod` from the freshly-merged FEATURE-BRANCH worktree built the branch
 * tree, went READY, and took the production aliases from the git build of the merge
 * commit — reverting #1595's cron-auth fix while every signal stayed green.
 *
 * These tests pin the decision, not the printing.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs guard script, no type declarations by design
import { evaluateProdDeployGuard, EXPECTED_PROJECT } from '../../../scripts/guard-prod-deploy.mjs';

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

describe('prod deploy guard — the 2026-09-21 incident', () => {
  it('refuses the branch worktree that actually shipped', () => {
    const r: Guard = evaluateProdDeployGuard({
      vercelProjectName: EXPECTED_PROJECT,
      branch: 'fix/cyrus-freshness-provenance',
      headSha: BRANCH_SHA,
      remoteMainSha: MAIN_SHA,
      behind: 4,
      ahead: 1,
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('not_on_main');
    expect(codes(r)).toContain('behind_main');
    expect(codes(r)).toContain('ahead_of_main');
  });

  it('refuses a checkout that is merely BEHIND main, even on main', () => {
    // The subtle case: right branch, right project, nothing dirty — just stale.
    const r: Guard = evaluateProdDeployGuard({
      vercelProjectName: EXPECTED_PROJECT,
      branch: 'main',
      headSha: 'b1da5a461035d43baa228d9bbd626ed4b34662e3',
      remoteMainSha: MAIN_SHA,
      behind: 1,
      ahead: 0,
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(['behind_main']);
  });

  it('passes a clean checkout that is exactly origin/main', () => {
    const r: Guard = evaluateProdDeployGuard({
      vercelProjectName: EXPECTED_PROJECT,
      branch: 'main',
      headSha: MAIN_SHA,
      remoteMainSha: MAIN_SHA,
    });
    expect(r.ok).toBe(true);
    expect(r.blocking).toEqual([]);
  });
});

describe('prod deploy guard — project linkage is never waivable', () => {
  it('refuses when there is no .vercel link (Vercel would build a parent checkout)', () => {
    const r: Guard = evaluateProdDeployGuard({
      vercelProjectName: null,
      branch: 'main',
      headSha: MAIN_SHA,
      remoteMainSha: MAIN_SHA,
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('no_vercel_link');
  });

  it('refuses the wrong project even with a valid override reason', () => {
    // The `cai-language-guardrails` accident: green build, wrong project.
    const r: Guard = evaluateProdDeployGuard({
      vercelProjectName: 'cai-language-guardrails',
      branch: 'main',
      headSha: MAIN_SHA,
      remoteMainSha: MAIN_SHA,
      override: 'emergency rollback, incident 2026-09-21',
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('wrong_vercel_project');
  });
});

describe('prod deploy guard — uncommitted work', () => {
  it('refuses modified tracked files (a CLI deploy uploads the working directory)', () => {
    const r: Guard = evaluateProdDeployGuard({
      vercelProjectName: EXPECTED_PROJECT,
      branch: 'main',
      headSha: MAIN_SHA,
      remoteMainSha: MAIN_SHA,
      dirtyTracked: ['src/app/api/cron/snapshot-multisite/route.ts'],
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('dirty_worktree');
  });

  it('warns about untracked files without blocking', () => {
    const r: Guard = evaluateProdDeployGuard({
      vercelProjectName: EXPECTED_PROJECT,
      branch: 'main',
      headSha: MAIN_SHA,
      remoteMainSha: MAIN_SHA,
      untracked: ['tasks/evidence/whatever.json'],
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBe(1);
  });
});

describe('prod deploy guard — the escape hatch must stay deliberate', () => {
  it('waives branch/staleness rules when given a real reason', () => {
    const r: Guard = evaluateProdDeployGuard({
      vercelProjectName: EXPECTED_PROJECT,
      branch: 'hotfix/rollback',
      headSha: BRANCH_SHA,
      remoteMainSha: MAIN_SHA,
      behind: 2,
      override: 'rollback to last good build, incident 2026-09-21',
    });
    expect(r.ok).toBe(true);
    expect(r.overrideAccepted).toBe(true);
    expect(r.waived.map((f) => f.code)).toContain('behind_main');
  });

  it('rejects "1" as a reason — a bypass nobody can read later is how this recurs', () => {
    const r: Guard = evaluateProdDeployGuard({
      vercelProjectName: EXPECTED_PROJECT,
      branch: 'main',
      headSha: MAIN_SHA,
      remoteMainSha: MAIN_SHA,
      override: '1',
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('override_not_a_reason');
  });

  it('rejects a too-short reason', () => {
    const r: Guard = evaluateProdDeployGuard({
      vercelProjectName: EXPECTED_PROJECT,
      branch: 'feature/x',
      headSha: BRANCH_SHA,
      remoteMainSha: MAIN_SHA,
      override: 'because',
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('override_not_a_reason');
  });
});

describe('prod deploy guard — refuses to guess', () => {
  it('blocks a 0/0 ahead-behind count whose SHAs disagree', () => {
    const r: Guard = evaluateProdDeployGuard({
      vercelProjectName: EXPECTED_PROJECT,
      branch: 'main',
      headSha: BRANCH_SHA,
      remoteMainSha: MAIN_SHA,
      behind: 0,
      ahead: 0,
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('head_sha_mismatch');
  });
});
