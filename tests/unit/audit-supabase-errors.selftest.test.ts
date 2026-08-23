import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE DETECTOR MUST BE ABLE TO FAIL.
 *
 * On 2026-08-23 this gate printed `OK — no new swallowed-error reads (73 baseline-known)` and
 * hard-blocked pushes on that basis — while it could not see:
 *
 *   src/lib/bigquery/    queryCached returns [] on a 2 TiB/day quota failure, which fed a
 *                        "Rule of Two NOT met" set-aside determination
 *   src/lib/send-email   the suppression lookup failed OPEN and mailed unsubscribed people
 *   src/lib/seo/         facets.ts rendered "0 active opportunities · source: SAM.gov"
 *   src/lib/gov-buyer/   the capability scoring that produced capable: 0
 *
 * Three structural blind spots, all now closed. A green light from a detector that only looks
 * at four directories is a FALSE ALL-CLEAR, which is the same class of bug the detector exists
 * to catch — so these tests assert it still catches each shape, using real fixtures rather
 * than reading the script's source.
 */
const ROOT = process.cwd();
const PROBE = join(ROOT, 'src/lib/__selftest_probe__');

function runAuditOn(files: Record<string, string>): string {
  mkdirSync(PROBE, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(PROBE, name), body);
  try {
    // Exits non-zero when it finds something new, so capture either way.
    return execFileSync('node', ['scripts/audit-supabase-errors.mjs'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return (err.stdout || '') + (err.stderr || '');
  } finally {
    rmSync(PROBE, { recursive: true, force: true });
  }
}

describe('audit-supabase-errors — the blind spots stay closed', () => {
  it('catches an unbound count anywhere under src/, not just four directories', () => {
    const out = runAuditOn({
      'unbound.ts': [
        "const { count } = await sb.from('sam_opportunities').select('*', { count: 'exact', head: true });",
        'const n = count ?? 0;',
      ].join('\n'),
    });
    expect(out).toContain('__selftest_probe__/unbound.ts');
  });

  it('catches BOUND-BUT-IGNORED — the shape it used to exempt by construction', () => {
    // Strictly more dangerous than the unbound version: the code LOOKS careful, so a reviewer
    // sees `error` in the destructure and moves on.
    const out = runAuditOn({
      'bound-ignored.ts': [
        "const { count, error } = await sb.from('sam_opportunities').select('*', { count: 'exact', head: true });",
        'const n = count ?? 0;',
      ].join('\n'),
    });
    expect(out).toContain('__selftest_probe__/bound-ignored.ts');
  });

  it('does NOT flag a count whose error is genuinely consulted', () => {
    // The rule has to discriminate, or it becomes noise people learn to baseline away.
    const out = runAuditOn({
      'handled.ts': [
        "const { count, error: countErr } = await sb.from('sam_opportunities').select('*', { count: 'exact', head: true });",
        'let degraded = false;',
        'if (countErr) degraded = true;',
        'const n = countErr ? null : (count ?? 0);',
      ].join('\n'),
    });
    expect(out).not.toContain('__selftest_probe__/handled.ts');
  });

  it('still sees the query when it was built far above the await', () => {
    // The 8-line lookback missed `let q = db.from(...)` … 20 lines … `await q`, which is why
    // all five counts in briefings/profile-stats returned flagged=false.
    const filler = Array.from({ length: 14 }, (_, i) => `  // filler ${i}`).join('\n');
    const out = runAuditOn({
      'far-query.ts': [
        "let q = sb.from('sam_opportunities').select('*', { count: 'exact', head: true });",
        filler,
        'const { count } = await q;',
        'const n = count ?? 0;',
      ].join('\n'),
    });
    expect(out).toContain('__selftest_probe__/far-query.ts');
  });
});

describe('the audited scope covers the directories that shipped real defects', () => {
  const src = readFileSync(join(ROOT, 'scripts/audit-supabase-errors.mjs'), 'utf8');

  it('audits all of src/, not a hand-picked subset', () => {
    expect(src).toMatch(/AUDITED_PATHS\s*=\s*\[\s*'src\/'/);
  });

  it('keeps a lookback generous enough to find the query', () => {
    const m = src.match(/const LOOKBACK = (\d+)/);
    expect(m, 'LOOKBACK must be a named constant').toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(20);
  });
});
