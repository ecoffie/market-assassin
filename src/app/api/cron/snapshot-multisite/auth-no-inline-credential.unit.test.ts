/**
 * SECURITY — no credential in a stored cron route.
 *
 * `snapshot-multisite-nih` stored the live admin password as `?password=...`
 * inside `cron_jobs.route`. A credential in a database column is readable by
 * anything that can SELECT the table, is echoed into dispatcher logs on every
 * run, and appears in any audit of the schedule.
 *
 * ROOT CAUSE: the route accepted only `x-vercel-cron-secret` or `?password=`,
 * while the dispatcher sends `Authorization: Bearer $CRON_SECRET`. Neither
 * matched, so the password was inlined as a workaround. Accepting the
 * dispatcher's own mechanism removes the reason it was ever there.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE = readFileSync(
  join(process.cwd(), 'src/app/api/cron/snapshot-multisite/route.ts'),
  'utf8',
);
const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260921_strip_inline_cron_credentials.sql'),
  'utf8',
);
const BASELINE = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/cron-route-credential-baseline.json'), 'utf8'),
);

describe('the route accepts the dispatcher, so nothing needs inlining', () => {
  it('honours Authorization: Bearer $CRON_SECRET', () => {
    expect(ROUTE).toMatch(/headersList\.get\('authorization'\)/);
    expect(ROUTE).toMatch(/bearer === process\.env\.CRON_SECRET/);
  });

  it('still accepts Vercel-native cron and manual admin invocation', () => {
    expect(ROUTE).toMatch(/x-vercel-cron-secret/);
    expect(ROUTE).toMatch(/isAdmin/);
  });

  it('an empty CRON_SECRET or ADMIN_PASSWORD cannot authenticate by accident', () => {
    // Boolean(...) guards stop an unset env var matching an absent header/param.
    expect(ROUTE).toMatch(/Boolean\(process\.env\.CRON_SECRET\) && bearer === process\.env\.CRON_SECRET/);
    expect(ROUTE).toMatch(/Boolean\(ADMIN_PASSWORD\) && password === ADMIN_PASSWORD/);
  });

  it('unauthenticated requests are still rejected', () => {
    expect(ROUTE).toMatch(/if \(!isVercelCron && !isDispatcher && !isAdmin\)/);
  });
});

describe('the migration never handles the secret', () => {
  it('strips by PATTERN — it neither contains nor compares a credential value', () => {
    expect(MIGRATION).toMatch(/regexp_replace\(route, '\(\[\?&\]\)password=\[\^&\]\*\(&\|\$\)'/);
    // No literal secret. `password=` may appear ONLY inside a regex pattern
    // (followed by `[`), never followed by an actual value.
    const literalValue = /password=(?!\[)[A-Za-z0-9._~-]{6,}/i;
    expect(MIGRATION).not.toMatch(literalValue);
    // A long unbroken token is what a pasted secret looks like; prose has spaces.
    const secretShaped = /'[A-Za-z0-9_-]{20,}'/;
    expect(MIGRATION).not.toMatch(secretShaped);
  });

  it('is scoped to THIS app — cross-application routes are untouched', () => {
    expect(MIGRATION).toMatch(/route LIKE '\/api\/cron\/snapshot-multisite%'/);
    expect(MIGRATION).not.toMatch(/UPDATE[\s\S]*govcongiants\.com/);
  });

  it('changes no scheduling field', () => {
    for (const col of ['cron_expr', 'enabled', 'timeout_ms', 'job_name']) {
      expect(MIGRATION).not.toMatch(new RegExp(`SET[\\s\\S]{0,120}\\b${col}\\s*=`));
    }
  });

  it('tells the operator to rotate the exposed credential', () => {
    expect(MIGRATION).toMatch(/ROTATE/);
  });
});

describe('the guard cannot leak what it finds', () => {
  const GUARD = readFileSync(join(process.cwd(), 'scripts/audit-cron-route-credentials.mjs'), 'utf8');

  it('reports job name and PARAM NAME only, never the value', () => {
    expect(GUARD).toMatch(/param: \$\{m\[1\]\.toLowerCase\(\)\}/);
    expect(GUARD).not.toMatch(/console\.(log|error)\([^)]*row\.route/);
  });

  it('a failed query is UNKNOWN, never reported clean', () => {
    expect(GUARD).toMatch(/query failed[\s\S]*process\.exit\(1\)/);
  });

  it('the baseline records job names only, and says it is debt not acceptance', () => {
    expect(BASELINE.known).toEqual(expect.arrayContaining(['mindy-heads-up', 'mindy-live', 'mindy-morning']));
    expect(BASELINE._why).toMatch(/debt, not acceptance/i);
    // no value ever stored in the baseline
    expect(JSON.stringify(BASELINE)).not.toMatch(/ma-admin-/i);
  });

  it('every credential-ish parameter name is covered, not just `password`', () => {
    for (const p of ['secret', 'token', 'api_key', 'access_token', 'cron_secret']) {
      expect(GUARD).toContain(`'${p}'`);
    }
  });
});
