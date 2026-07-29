/**
 * search_past_contracts widen-on-zero (FM-05, Eric/QA 2026-07-28). The default 'pop' (place-of-
 * performance) scope returned EMPTY for a valid code-only query (PSC 1385, EOD tools) even though real
 * awards exist under recipient scope. Fix: when the DEFAULT scope returns 0 and the caller didn't pin a
 * scope, auto-retry the widest scope ('both') and REPORT that we widened — never a misleading empty.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the USASpending search so we control what each scope returns.
const searchMock = vi.fn();
vi.mock('@/lib/usaspending/awards-search', () => ({
  searchAwardsByLocation: (args: unknown) => searchMock(args),
}));
vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: { aiHint: true } }));

import { searchPastContracts } from './past-contracts';

const award = { recipientName: 'ACME EOD', awardAmount: 5_000_000, agency: 'DOD', popState: 'MD', generatedId: 'X' };
const empty = { awards: [], count: 0, totalEstimate: 0, degraded: false, requestsFired: 1 };
const hit = { awards: [award], count: 1, totalEstimate: 1, degraded: false, requestsFired: 2 };

beforeEach(() => searchMock.mockReset());

describe('widen-on-zero', () => {
  it('pop returns 0 (no explicit scope) → auto-retries "both" and surfaces the result + flag', async () => {
    searchMock.mockResolvedValueOnce(empty).mockResolvedValueOnce(hit); // pop empty, both hits
    const r = await searchPastContracts({ psc: '1385' });
    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(searchMock.mock.calls[0][0].stateScope).toBe('pop');
    expect(searchMock.mock.calls[1][0].stateScope).toBe('both'); // widened to the widest scope
    expect(r._meta.grounded).toBe(true);
    expect(r._meta.state_scope).toBe('both');
    expect(r._meta.auto_widened).toBe(true);
    expect(r._ai_hint?.summary).toContain('auto-widened');
  });

  it('pop returns results → NO retry (don\'t widen a working query)', async () => {
    searchMock.mockResolvedValueOnce(hit);
    const r = await searchPastContracts({ psc: '1385' });
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(r._meta.state_scope).toBe('pop');
    expect(r._meta.auto_widened).toBeUndefined();
  });

  it('caller EXPLICITLY pinned pop → respect it, do NOT widen even on 0', async () => {
    searchMock.mockResolvedValueOnce(empty);
    const r = await searchPastContracts({ psc: '1385', state_scope: 'pop' });
    expect(searchMock).toHaveBeenCalledTimes(1); // no auto-widen — the user chose pop
    expect(r._meta.auto_widened).toBeUndefined();
  });

  it('a DEGRADED (errored) first call does NOT auto-widen (don\'t hammer a failing API)', async () => {
    searchMock.mockResolvedValueOnce({ ...empty, degraded: true });
    const r = await searchPastContracts({ psc: '1385' });
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(r._meta.degraded).toBe(true);
    expect(r._meta.auto_widened).toBeUndefined();
  });

  it('still empty after widening → honest empty that says it widened', async () => {
    searchMock.mockResolvedValueOnce(empty).mockResolvedValueOnce(empty);
    const r = await searchPastContracts({ psc: '9999' });
    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(r._meta.grounded).toBe(false);
    expect(r._ai_hint?.summary).toContain('even after auto-widening');
  });
});
