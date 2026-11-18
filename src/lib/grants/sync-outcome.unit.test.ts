import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyGrantsSync } from './sync-outcome';

describe('classifyGrantsSync', () => {
  it('a zero fetch is a failure, not a verified empty', () => {
    const o = classifyGrantsSync({ fetched: 0, degraded: false });
    expect(o.success).toBe(false);
    expect(o.httpStatus).toBeGreaterThanOrEqual(400);
    expect(o.disclosure).toMatch(/not a verified empty/);
  });

  it('a partial upstream failure is not success', () => {
    const o = classifyGrantsSync({ fetched: 400, degraded: true });
    expect(o.success).toBe(false);
    expect(o.httpStatus).toBeGreaterThanOrEqual(400);
    expect(o.cronOutcome).toBe('error');
    expect(o.disclosure).toMatch(/Partial/);
  });

  it('a complete fetch is success', () => {
    expect(classifyGrantsSync({ fetched: 1700, degraded: false })).toMatchObject({
      success: true,
      httpStatus: 200,
      cronOutcome: 'success',
    });
  });
});

describe('sync-grants route uses the classifier', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/api/cron/sync-grants/route.ts'), 'utf8');
  it('refuses success until classifyGrantsSync says the run completed', () => {
    expect(src).toContain('classifyGrantsSync');
    expect(src).toContain('if (!outcome.success)');
    const successReturn = src.indexOf('success: true');
    const guard = src.indexOf('if (!outcome.success)');
    expect(guard).toBeGreaterThan(-1);
    expect(successReturn).toBeGreaterThan(guard);
  });
});
