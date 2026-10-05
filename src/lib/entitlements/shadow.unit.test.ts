import { afterEach, describe, expect, it, vi } from 'vitest';

const afterSpy = vi.fn();
vi.mock('next/server', () => ({ after: (fn: () => unknown) => afterSpy(fn) }));
vi.mock('./sources', () => ({ resolveEntitlementSources: vi.fn() }));

import { shadowEntitlement, shadowEnabled, subjectKey } from './shadow';

const input = { route: 'test', capability: 'target_list.manage' as const, email: 'a@b.co', identityVerified: true, currentAllow: false };

describe('shadowEntitlement — never changes a decision', () => {
  afterEach(() => { delete process.env.ENTITLEMENT_SHADOW; afterSpy.mockReset(); });

  it('is OFF unless ENTITLEMENT_SHADOW is literally "true"', () => {
    for (const v of [undefined, '', '1', 'on', 'yes']) {
      if (v === undefined) delete process.env.ENTITLEMENT_SHADOW; else process.env.ENTITLEMENT_SHADOW = v;
      expect(shadowEnabled()).toBe(false);
      shadowEntitlement(input);
    }
    expect(afterSpy).not.toHaveBeenCalled();
  });

  it('when on, only schedules work after the response and returns nothing', () => {
    process.env.ENTITLEMENT_SHADOW = 'true';
    expect(shadowEntitlement(input)).toBeUndefined();
    expect(afterSpy).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when after() throws outside a request scope', () => {
    process.env.ENTITLEMENT_SHADOW = 'true';
    afterSpy.mockImplementation(() => { throw new Error('outside request scope'); });
    expect(() => shadowEntitlement(input)).not.toThrow();
  });

  it('the scheduled callback swallows resolver failures', async () => {
    process.env.ENTITLEMENT_SHADOW = 'true';
    const { resolveEntitlementSources } = await import('./sources');
    (resolveEntitlementSources as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
    let cb: (() => Promise<void>) | undefined;
    afterSpy.mockImplementation((fn) => { cb = fn; });
    shadowEntitlement(input);
    await expect(cb!()).resolves.toBeUndefined();
  });

  it('logs a keyed hash, never the email', () => {
    process.env.CRON_SECRET = 's3cret';
    const k = subjectKey('Someone@Example.com');
    expect(k).toMatch(/^[0-9a-f]{20}$/);
    expect(k).toBe(subjectKey('someone@example.com'));
    expect(k).not.toContain('someone');
  });
});
