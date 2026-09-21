/**
 * The cert backfill cron must run on prod (valid SAM key), be auth-gated, and surface a DEAD KEY as
 * non-2xx so a stale key can't silently record every firm as "no cert" (Eric 2026-07-28).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, '../../src/app/api/cron/backfill-recipient-certs/route.ts'), 'utf8');

describe('backfill-recipient-certs cron', () => {
  it('is auth-gated (x-vercel-cron / CRON_SECRET / admin password)', () => {
    expect(route).toContain("x-vercel-cron");
    expect(route).toContain('CRON_SECRET');
    expect(route).toContain('ADMIN_PASSWORD');
    expect(route).toContain("status: 401");
  });
  it('preview mode shows the queue without hitting SAM; execute drains it', () => {
    expect(route).toContain("mode === 'preview'");
    expect(route).toContain('certBackfillQueue');
    expect(route).toContain('drainCertBackfill');
  });
  it('a run where EVERY SAM call failed (dead key) returns non-2xx (502), never a silent 200', () => {
    expect(route).toContain('result.failed === result.attempted');
    expect(route).toContain('502');
  });
});
