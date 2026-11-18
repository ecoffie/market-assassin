import { describe, expect, it } from 'vitest';
import { decideDodSbirExecuteOutcome } from './dod-sbir-outcome';

describe('decideDodSbirExecuteOutcome — false green cannot claim success', () => {
  it('api-down with empty corpus is not success (the 2026-11-18 defect)', () => {
    const o = decideDodSbirExecuteOutcome({ stopped: 'api-down', upserted: 0, heldRows: 0 });
    expect(o.success).toBe(false);
    expect(o.httpStatus).toBe(503);
    expect(o.cronOutcome).toBe('error');
    expect(o.disclosure).toMatch(/empty/);
  });

  it('api-down with historical rows is still not success', () => {
    const o = decideDodSbirExecuteOutcome({ stopped: 'api-down', upserted: 0, heldRows: 42 });
    expect(o.success).toBe(false);
    expect(o.cronOutcome).toBe('error');
    expect(o.disclosure).toMatch(/unchanged/);
  });

  it('empty drain after last-page is not success', () => {
    const o = decideDodSbirExecuteOutcome({ stopped: 'last-page', upserted: 0, heldRows: 0 });
    expect(o.success).toBe(false);
    expect(o.httpStatus).toBe(503);
  });

  it('a real drain with rows held is success', () => {
    const o = decideDodSbirExecuteOutcome({ stopped: 'last-page', upserted: 100, heldRows: 100 });
    expect(o).toEqual({
      success: true,
      httpStatus: 200,
      cronOutcome: 'success',
      disclosure: '',
    });
  });

  it('budget stop with prior held rows (resume) is success', () => {
    const o = decideDodSbirExecuteOutcome({ stopped: 'budget', upserted: 50, heldRows: 150 });
    expect(o.success).toBe(true);
    expect(o.httpStatus).toBe(200);
  });

  it('rate-limit is partial, never green success', () => {
    const o = decideDodSbirExecuteOutcome({ stopped: 'rate-limit', upserted: 10, heldRows: 10 });
    expect(o.success).toBe(false);
    expect(o.cronOutcome).toBe('partial');
  });
});
