import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts/assert-no-live-bigquery.mjs');
const dir = mkdtempSync(join(tmpdir(), 'bq-gate-'));

function gate(log: string): { code: number; out: string } {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.log`);
  writeFileSync(file, log);
  try {
    return { code: 0, out: execFileSync('node', [SCRIPT, file], { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) {
    const err = e as { status: number; stderr: string };
    return { code: err.status, out: String(err.stderr) };
  }
}

const OK_BUILD = '✓ Compiled successfully in 10.1s\n  Generating static pages using 17 workers (578/578)\n';

describe('scripts/assert-no-live-bigquery.mjs (CI gate)', () => {
  it('passes a build where the guard blocked every cold miss', () => {
    const r = gate(OK_BUILD + '[bq-guard] blocked bigquery client: next build is cache-only\n');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/zero live BigQuery calls/);
  });

  it('fails when a BigQuery client was created', () => {
    expect(gate(OK_BUILD + '[bq-client] created\n').code).toBe(1);
  });

  it('fails when a query ran ([bq-miss]) — the 2026-09-29 incident signature', () => {
    const r = gate(OK_BUILD + '[bq-miss] bq:v4-2026-08-28:top:state:NJ:50:rollup  (1138ms, 50 rows)\n');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/reached live BigQuery/);
  });

  it('fails when a query was attempted and failed at BigQuery', () => {
    expect(gate(OK_BUILD + '[bq-cache] BQ query failed for bq:x: Could not load the default credentials\n').code).toBe(1);
  });

  it('refuses to certify a log that is not a completed build', () => {
    expect(gate('npm ERR! something broke\n').code).toBe(1);
  });
});
