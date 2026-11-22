/**
 * STATIC GUARD: a caller-set header can never authorize a scheduled job, and an unset CRON_SECRET can
 * never match. Fails on any source under src/app/api or src/lib that:
 *   - reads x-vercel-cron / x-cron-dispatch (one allowed reader: saved-search-alerts uses x-cron-dispatch
 *     only as a self-report hint, after its own authorization), or
 *   - hand-writes a `Bearer ${CRON_SECRET}` comparison (it matches "Bearer undefined" when the secret is
 *     unset), or compares a token with `=== / !== process.env.CRON_SECRET` without a set-secret guard.
 * Use hasValidCronSecret() / authorizeCronRequest() from src/lib/cron/cron-request-auth.ts instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const HINT_ONLY = new Set(['src/app/api/cron/saved-search-alerts/route.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1');
const files = [...walk(join(ROOT, 'src/app/api')), ...walk(join(ROOT, 'src/lib'))].map((f) => ({ rel: relative(ROOT, f), src: strip(readFileSync(f, 'utf8')) }));

describe('no caller-set header and no unset secret can authorize a job', () => {
  it('nothing reads x-vercel-cron / x-cron-dispatch except the post-auth hint', () => {
    const offenders = files
      .filter((f) => !HINT_ONLY.has(f.rel))
      .filter((f) => /headers\.get\(\s*['"]x-(vercel-cron|cron-dispatch)['"]\s*\)/.test(f.src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('no hand-written `Bearer ${CRON_SECRET}` comparison', () => {
    const offenders = files.filter((f) => /`Bearer \$\{(?:process\.env\.)?CRON_SECRET\}`\s*[;)|&]|(?:===|!==)\s*`Bearer \$\{(?:process\.env\.)?CRON_SECRET\}`/.test(f.src)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('no token compared with process.env.CRON_SECRET unless the secret is checked first', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const line of f.src.split('\n')) {
        if (/(?:===|!==)\s*process\.env\.CRON_SECRET\b/.test(line) && !/(?:!!|Boolean\()\s*process\.env\.CRON_SECRET\)?\s*&&|process\.env\.CRON_SECRET\s*&&/.test(line)) {
          offenders.push(`${f.rel}: ${line.trim()}`);
        }
      }
    }
    // The one known non-bearer form: snapshot-multisite compares a dedicated secret header; null never equals undefined.
    expect(offenders.filter((o) => !o.startsWith('src/app/api/cron/snapshot-multisite/route.ts: const isVercelCron = cronSecret === process.env.CRON_SECRET'))).toEqual([]);
  });
});
