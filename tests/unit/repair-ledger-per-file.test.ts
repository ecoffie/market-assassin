/**
 * Per-file repair ledger (2026-11-22). Every PR used to append a row to the end of
 * docs/REPAIR-LEDGER.md, so each merge conflicted every other open PR. New entries are now one file
 * each in docs/repair-ledger/; the archive is frozen; every reader goes through
 * scripts/lib/ledger-sources.mjs. These tests prove: (1) two entries added on separate branches merge
 * cleanly (and that appending to one shared file does not), (2) the audit still FAILS a recorded fix
 * whose anchor is gone, and malformed entry files, (3) the PR-handoff risk hint.
 *
 * Git fixtures follow docs/agents/release-and-worktrees.md "Rules for any test that CREATES or
 * MUTATES git repositories": scrubbed git env before the first command, a validated empty temp dir,
 * no `cd` (execFileSync `cwd` throws on a missing dir), and every repo resolved back under the temp dir.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
// @ts-expect-error — plain ESM helpers without type declarations
import { isLedgerPath, ENTRY_NAME_RE } from '../../scripts/lib/ledger-sources.mjs';
// @ts-expect-error — plain ESM helpers without type declarations
import { riskHint, overlappingPrs } from '../../scripts/lib/pr-risk.mjs';

const REPO = join(__dirname, '../..');
const AUDIT = join(REPO, 'scripts/audit-repair-ledger.mjs');

// ── git-fixture safety ───────────────────────────────────────────────────────────────────────────
function scrubbedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}
const ENV = scrubbedEnv();
const made: string[] = [];
function freshTmp(): string {
  const raw = mkdtempSync(join(tmpdir(), 'ledger-fixture-'));
  const dir = realpathSync(raw);
  // Validate the anchor itself: non-empty path, expected shape, outside the repo, and EMPTY.
  if (!dir || !/ledger-fixture-[A-Za-z0-9]{6}$/.test(dir) || !existsSync(dir)) throw new Error('bad temp dir');
  if (dir === realpathSync(REPO) || dir.startsWith(realpathSync(REPO) + sep)) throw new Error('temp dir inside repo');
  if (readdirSync(dir).length !== 0) throw new Error('temp dir not empty');
  made.push(dir);
  return dir;
}
afterAll(() => { for (const d of made) if (d.includes('ledger-fixture-')) rmSync(d, { recursive: true, force: true }); });

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, env: ENV, encoding: 'utf8' });
}
function initRepo(dir: string) {
  git(dir, 'init', '-q', '-b', 'main');
  const top = realpathSync(git(dir, 'rev-parse', '--show-toplevel').trim());
  if (top !== dir) throw new Error(`fixture repo resolved outside its temp dir: ${top}`);
}
const write = (dir: string, rel: string, body: string) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), body); };

const HEADER = '| Date | Area | Fix | Proof anchor | Verified | Status |\n|---|---|---|---|---|---|\n';
const row = (anchor: string, file: string) => `| 2026-11-22 | Area | A fix | \`${anchor}\` → \`${file}\` | test | PR |\n`;

// ── 1. merge behaviour ───────────────────────────────────────────────────────────────────────────
describe('per-file ledger entries merge without conflicts', () => {
  it('two entries added on separate branches merge cleanly; two archive appends conflict', () => {
    const dir = freshTmp();
    initRepo(dir);
    write(dir, 'docs/REPAIR-LEDGER.md', `# Archive\n\n${HEADER}${row('base', 'src/a.ts')}`);
    write(dir, 'docs/repair-ledger/README.md', '# entries\n');
    write(dir, 'src/a.ts', 'base\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'seed');

    // New convention: each branch adds its own entry file.
    git(dir, 'checkout', '-q', '-b', 'a');
    write(dir, 'docs/repair-ledger/2026-11-22-pr-1.md', HEADER + row('base', 'src/a.ts'));
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'entry 1');
    git(dir, 'checkout', '-q', 'main'); git(dir, 'checkout', '-q', '-b', 'b');
    write(dir, 'docs/repair-ledger/2026-11-22-pr-2.md', HEADER + row('base', 'src/a.ts'));
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'entry 2');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'merge', '-q', '--no-edit', 'a');
    const second = spawnSync('git', ['-c', 'user.name=f', '-c', 'user.email=f@example.com', '-c', 'core.hooksPath=/dev/null', 'merge', '--no-edit', 'b'], { cwd: dir, env: ENV, encoding: 'utf8' });
    expect(second.status, second.stdout + second.stderr).toBe(0);
    expect(readdirSync(join(dir, 'docs/repair-ledger')).sort()).toEqual(['2026-11-22-pr-1.md', '2026-11-22-pr-2.md', 'README.md']);

    // Old convention, for contrast: both branches append a row at the end of the archive.
    git(dir, 'checkout', '-q', '-b', 'c');
    write(dir, 'docs/REPAIR-LEDGER.md', `# Archive\n\n${HEADER}${row('base', 'src/a.ts')}${row('c', 'src/a.ts')}`);
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'archive c');
    git(dir, 'checkout', '-q', 'main'); git(dir, 'checkout', '-q', '-b', 'd');
    write(dir, 'docs/REPAIR-LEDGER.md', `# Archive\n\n${HEADER}${row('base', 'src/a.ts')}${row('d', 'src/a.ts')}`);
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'archive d');
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'merge', '-q', '--no-edit', 'c');
    const conflict = spawnSync('git', ['-c', 'user.name=f', '-c', 'user.email=f@example.com', '-c', 'core.hooksPath=/dev/null', 'merge', '--no-edit', 'd'], { cwd: dir, env: ENV, encoding: 'utf8' });
    expect(conflict.status).not.toBe(0);
  });
});

// ── 2. the audit keeps failing what it must ──────────────────────────────────────────────────────
function auditFixture(entries: Record<string, string>, src = 'export const FIXED = 1;\n') {
  const dir = freshTmp();
  write(dir, 'docs/REPAIR-LEDGER.md', `# Archive\n\n${HEADER}${row('export const FIXED', 'src/fixed.ts')}`);
  write(dir, 'src/fixed.ts', src);
  for (const [name, body] of Object.entries(entries)) write(dir, `docs/repair-ledger/${name}`, body);
  return spawnSync('node', [AUDIT, '--root', dir], { encoding: 'utf8', env: ENV });
}

describe('audit over archive + entry files', () => {
  it('passes when every anchor in the archive and the entries is present', () => {
    const r = auditFixture({ '2026-11-22-pr-9.md': HEADER + row('export const FIXED', 'src/fixed.ts') });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Repair ledger clean — all 2 checked fixes/);
  });

  it('FAILS a recorded fix whose code is gone (anchor in an entry file)', () => {
    const r = auditFixture({ '2026-11-22-pr-9.md': HEADER + row('export const GONE', 'src/fixed.ts') });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/VANISHED/);
    expect(r.stderr).toMatch(/docs\/repair-ledger\/2026-11-22-pr-9\.md/);
  });

  it('FAILS when the archive fix is reverted', () => {
    const r = auditFixture({}, 'export const OTHER = 1;\n');
    expect(r.status).toBe(1);
  });

  it('FAILS an entry file with no proof anchor, or a badly named one', () => {
    expect(auditFixture({ '2026-11-22-pr-9.md': HEADER + '| 2026-11-22 | a | no anchor | none | x | PR |\n' }).status).toBe(1);
    expect(auditFixture({ 'my-entry.md': HEADER + row('export const FIXED', 'src/fixed.ts') }).status).toBe(1);
  });

  it('the real ledger (archive + entries) passes', () => {
    const r = spawnSync('node', [AUDIT], { cwd: REPO, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
  });

  it('isLedgerPath / entry names', () => {
    expect(isLedgerPath('docs/REPAIR-LEDGER.md')).toBe(true);
    expect(isLedgerPath('docs/repair-ledger/2026-11-22-pr-1.md')).toBe(true);
    expect(isLedgerPath('docs/repair-ledger/README.md')).toBe(false);
    expect(isLedgerPath('docs/other.md')).toBe(false);
    expect(ENTRY_NAME_RE.test('2026-11-22-pr-2290.md')).toBe(true);
    expect(ENTRY_NAME_RE.test('2026-11-22-map-legend.md')).toBe(true);
    expect(ENTRY_NAME_RE.test('pr-2290.md')).toBe(false);
  });
});

// ── 3. PR handoff risk hint ──────────────────────────────────────────────────────────────────────
describe('pr-handoff risk hint', () => {
  it('RED for payments, auth, migrations and customer-data paths', () => {
    expect(riskHint(['src/app/api/stripe/webhook/route.ts']).level).toBe('RED');
    expect(riskHint(['src/lib/api-auth.ts']).level).toBe('RED');
    expect(riskHint(['supabase/migrations/20261122_x.sql']).level).toBe('RED');
    expect(riskHint(['src/lib/vault/vault-delete.ts']).level).toBe('RED');
  });
  it('YELLOW for env/flags, cron and release tooling', () => {
    expect(riskHint(['src/lib/feature/flags.ts']).level).toBe('YELLOW');
    expect(riskHint(['src/app/api/cron/sync-x/route.ts']).level).toBe('YELLOW');
    expect(riskHint(['.githooks/pre-push']).level).toBe('YELLOW');
  });
  it('GREEN for ordinary UI / docs', () => {
    expect(riskHint(['src/app/opportunity-map/route.ts', 'docs/agents/platform.md'])).toEqual({ level: 'GREEN', reasons: [] });
  });
  it('lists other open PRs that touch the same files, most overlap first', () => {
    const o = overlappingPrs(1, ['a.ts', 'b.ts'], [
      { number: 1, title: 'self', files: ['a.ts'] },
      { number: 2, title: 'one', files: ['a.ts', 'z.ts'] },
      { number: 3, title: 'two', files: ['a.ts', 'b.ts'] },
      { number: 4, title: 'none', files: ['z.ts'] },
    ]);
    expect(o.map((x: { number: number }) => x.number)).toEqual([3, 2]);
  });
});
