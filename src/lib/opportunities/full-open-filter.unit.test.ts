/**
 * Guards the "Full & Open (no set-aside)" filter mapping.
 *
 * Measured against prod (2026-07-26): of 11,239 active opps, 4,801 have set_aside_code IS NULL —
 * the biggest bucket, and one a `.in('set_aside_code', […])` can NEVER reach (PostgREST .in skips
 * NULLs). So Full & Open needs its own IS-NULL predicate, OR'd alongside the group checkboxes.
 *
 * These tests assert the SHAPE of the PostgREST expression applyMapFilters builds (via a stub query
 * builder that records every .or()/.in() call), so a refactor can't silently drop the IS-NULL
 * predicate or AND it against the groups (which would return nothing).
 */
import { describe, it, expect } from 'vitest';
import { parseMapFilters, applyMapFilters } from './map-filters';

// Minimal query-builder stub: records .or() args, ignores everything else chainably.
function stubQuery() {
  const calls: { method: string; arg: string }[] = [];
  const q: Record<string, (...a: unknown[]) => unknown> = {};
  const chain = (method: string) => (...a: unknown[]) => { calls.push({ method, arg: String(a[0] ?? '') }); return q; };
  for (const m of ['or', 'in', 'eq', 'gt', 'lt', 'lte', 'gte', 'not', 'neq', 'ilike', 'imatch', 'select', 'order', 'limit']) q[m] = chain(m);
  return { q, calls };
}

function get(params: Record<string, string>) {
  return (k: string) => params[k] ?? null;
}

describe('Full & Open (no set-aside) filter', () => {
  it('parseMapFilters reads fullOpen from &fullOpen=1', () => {
    expect(parseMapFilters(get({ fullOpen: '1' })).fullOpen).toBe(true);
    expect(parseMapFilters(get({ fullOpen: 'true' })).fullOpen).toBe(true);
    expect(parseMapFilters(get({})).fullOpen).toBe(false);
  });

  it('fullOpen alone → an IS NULL predicate on set_aside_code (the 4,801 bucket)', () => {
    const { q, calls } = stubQuery();
    applyMapFilters(q, parseMapFilters(get({ fullOpen: '1' })));
    const orCalls = calls.filter((c) => c.method === 'or' && c.arg.includes('set_aside_code'));
    expect(orCalls.length).toBe(1);
    expect(orCalls[0].arg).toContain('set_aside_code.is.null');
  });

  it('fullOpen + a group (SB) → ONE OR combining group codes with IS NULL (never AND)', () => {
    const { q, calls } = stubQuery();
    applyMapFilters(q, parseMapFilters(get({ setAside: 'SB', fullOpen: '1' })));
    const saOr = calls.find((c) => c.method === 'or' && c.arg.includes('set_aside_code'));
    expect(saOr, 'a single combined set-aside OR must be emitted').toBeTruthy();
    // Both halves in ONE expression → OR (a payer can bid SB *or* unrestricted work).
    expect(saOr!.arg).toContain('set_aside_code.in.(');
    expect(saOr!.arg).toContain('set_aside_code.is.null');
    // SB expands to its code list, not the literal group key.
    expect(saOr!.arg).toContain('SBA');
  });

  it('a group without fullOpen → an .in() of the expanded codes, no null predicate', () => {
    const { q, calls } = stubQuery();
    applyMapFilters(q, parseMapFilters(get({ setAside: 'WOSB' })));
    const saOr = calls.find((c) => c.method === 'or' && c.arg.includes('set_aside_code'));
    expect(saOr!.arg).toContain('set_aside_code.in.(');
    expect(saOr!.arg).not.toContain('is.null');
    expect(saOr!.arg).toContain('WOSB');
  });

  it('neither → no set_aside_code predicate at all', () => {
    const { q, calls } = stubQuery();
    applyMapFilters(q, parseMapFilters(get({})));
    expect(calls.some((c) => c.arg.includes('set_aside_code'))).toBe(false);
  });
});
