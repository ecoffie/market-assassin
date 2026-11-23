/**
 * Production 2026-11-22 (get_sba_goaling_share VA FY2026, #2366 live): one set-aside bucket came back null
 * (prime null, meets null: correct) but the result read result_state 'results'. Every spending_by_category
 * call was a single fetch with no retry. Now: one bounded retry on a transient failure, and a bucket that
 * still fails makes the answer 'partial' via _meta.incomplete_reason in BOTH tools. Billing is unchanged.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { annotateResultContract } from '@/lib/mcp/result-contract';
import { classifyBillingOutcome } from '@/lib/mcp/credit-integrity';
import { isRetryableUsaspendingError, UsaspendingHttpError, setAsideIncompleteReason } from './agency-spending-detail';

vi.mock('@/lib/utils/agency-list-builder', () => ({
  fetchAllUSASpendingAgencies: vi.fn(async () => [{ name: 'Department of Veterans Affairs', toptierCode: '036', abbreviation: 'VA' }]),
}));
const logged = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/tool-errors', async (orig) => ({
  ...(await orig<object>()),
  logToolError: vi.fn(async (p: Record<string, unknown>) => { logged.calls.push(p); return null; }),
}));

const TOTAL = 90_000_000_000;
type Plan = (codes: string[] | undefined, attempt: number) => Response | Error;
function stub(plan: Plan) {
  const attempts = new Map<string, number>();
  const f = vi.fn(async (_url: string, init: { body: string }) => {
    const b = JSON.parse(init.body) as { filters: { set_aside_type_codes?: string[]; recipient_type_names?: string[] }; category: string };
    const key = `${b.category}|${b.filters.set_aside_type_codes?.join(',') ?? ''}|${b.filters.recipient_type_names?.join(',') ?? ''}`;
    const n = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, n);
    const out = plan(b.filters.set_aside_type_codes, n);
    if (out instanceof Error) throw out;
    return out;
  });
  vi.stubGlobal('fetch', f);
  return { attemptsFor: (codesKey: string) => attempts.get(`awarding_agency|${codesKey}|`) ?? 0 };
}
const ok = (codes: string[] | undefined) =>
  new Response(JSON.stringify({ results: [{ name: 'Department of Veterans Affairs', amount: codes ? 1_000_000_000 : TOTAL }] }), { status: 200 });

afterEach(() => { vi.unstubAllGlobals(); logged.calls.length = 0; });

describe('retry classification', () => {
  it('network error, 5xx and 429 retry; 4xx, timeout and abort do not', () => {
    expect(isRetryableUsaspendingError(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryableUsaspendingError(new UsaspendingHttpError(503, 'x'))).toBe(true);
    expect(isRetryableUsaspendingError(new UsaspendingHttpError(429, 'x'))).toBe(true);
    expect(isRetryableUsaspendingError(new UsaspendingHttpError(400, 'x'))).toBe(false);
    expect(isRetryableUsaspendingError(new UsaspendingHttpError(422, 'x'))).toBe(false);
    expect(isRetryableUsaspendingError(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe(false);
    expect(isRetryableUsaspendingError(Object.assign(new Error('a'), { name: 'AbortError' }))).toBe(false);
  });
});

describe('getAgencySpendingDetail bucket retry', () => {
  it('transient failure then success: the bucket is filled, nothing logged, no partial', async () => {
    const s = stub((codes, n) => (codes?.includes('WOSB') && n === 1 ? new Response('busy', { status: 503 }) : ok(codes)));
    const { getAgencySpendingDetail } = await import('./agency-spending-detail');
    const r = await getAgencySpendingDetail({ agency: 'Department of Veterans Affairs', fiscalYear: 2026 });
    expect(s.attemptsFor('WOSB,WOSBSS,EDWOSB,EDWOSBSS')).toBe(2);
    expect(r.set_aside_breakdown.find((b) => b.label === 'WOSB / EDWOSB')!.amount).toBe(1_000_000_000);
    expect(r.set_aside_share).not.toBeNull();
    expect(setAsideIncompleteReason(r.set_aside_breakdown)).toBeNull();
    expect(logged.calls).toHaveLength(0);
  });

  it('a network error is retried once too', async () => {
    const s = stub((codes, n) => (codes?.includes('HZC') && n === 1 ? new TypeError('fetch failed') : ok(codes)));
    const { getAgencySpendingDetail } = await import('./agency-spending-detail');
    const r = await getAgencySpendingDetail({ agency: 'Department of Veterans Affairs', fiscalYear: 2026 });
    expect(s.attemptsFor('HZC,HZS')).toBe(2);
    expect(r.set_aside_breakdown.find((b) => b.label === 'HUBZone')!.amount).toBe(1_000_000_000);
  });

  it('persistent failure: exactly 2 attempts, bucket null, share null, incomplete reason names it, failure persisted', async () => {
    const s = stub((codes) => (codes?.includes('WOSB') ? new Response('down', { status: 502 }) : ok(codes)));
    const { getAgencySpendingDetail } = await import('./agency-spending-detail');
    const r = await getAgencySpendingDetail({ agency: 'Department of Veterans Affairs', fiscalYear: 2026 });
    expect(s.attemptsFor('WOSB,WOSBSS,EDWOSB,EDWOSBSS')).toBe(2);
    expect(r.set_aside_breakdown.find((b) => b.label === 'WOSB / EDWOSB')!.amount).toBeNull();
    expect(r.set_aside_share).toBeNull();
    expect(r.degraded).toBe(false);
    expect(setAsideIncompleteReason(r.set_aside_breakdown)).toBe(
      'Set-aside bucket WOSB / EDWOSB unavailable from USASpending; the combined set-aside share is unknown (not zero).',
    );
    expect(logged.calls).toHaveLength(1);
    expect(logged.calls[0]).toMatchObject({ tool: 'agency_spending_detail', errorType: 'api_error' });
    expect((logged.calls[0].requestParams as { failed_buckets: string[] }).failed_buckets).toEqual(['WOSB/WOSBSS/EDWOSB/EDWOSBSS']);
  });

  it('a 4xx is not retried', async () => {
    const s = stub((codes) => (codes?.includes('HZC') ? new Response('bad', { status: 400 }) : ok(codes)));
    const { getAgencySpendingDetail } = await import('./agency-spending-detail');
    const r = await getAgencySpendingDetail({ agency: 'Department of Veterans Affairs', fiscalYear: 2026 });
    expect(s.attemptsFor('HZC,HZS')).toBe(1);
    expect(r.set_aside_breakdown.find((b) => b.label === 'HUBZone')!.amount).toBeNull();
  });
});

describe('both MCP tools: one failed bucket → result_state partial, grounded/degraded unchanged, billing unchanged', () => {
  const failWosb: Plan = (codes) => (codes?.includes('WOSB') ? new Response('down', { status: 502 }) : ok(codes));

  it('get_agency_spending_detail', async () => {
    stub(failWosb);
    const { getAgencySpendingDetailTool } = await import('@/mcp/tools/agency-spending-detail');
    const r = annotateResultContract(await getAgencySpendingDetailTool({ agency: 'Department of Veterans Affairs', fiscal_year: 2026 }), {}, null);
    expect(r._meta).toMatchObject({ grounded: true, degraded: false, result_state: 'partial' });
    expect((r._meta as { incomplete_reason?: string }).incomplete_reason).toMatch(/WOSB \/ EDWOSB unavailable/);
    expect(classifyBillingOutcome(r)).toBe('billable_success');
  });

  it('get_sba_goaling_share', async () => {
    stub(failWosb);
    const { getSbaGoalingShare } = await import('@/mcp/tools/sba-goaling');
    const r = annotateResultContract(await getSbaGoalingShare({ agency: 'Department of Veterans Affairs', fiscal_year: 2026 }), {}, null);
    expect(r._meta).toMatchObject({ grounded: true, degraded: false, result_state: 'partial', meets_small_business_goal: null });
    expect((r._meta as { incomplete_reason?: string }).incomplete_reason).toMatch(/combined set-aside share is unknown \(not zero\)/);
    expect(classifyBillingOutcome(r)).toBe('billable_success');
  });

  it('every bucket answered: no incomplete_reason, result_state results', async () => {
    stub((codes) => ok(codes));
    const { getSbaGoalingShare } = await import('@/mcp/tools/sba-goaling');
    const r = annotateResultContract(await getSbaGoalingShare({ agency: 'Department of Veterans Affairs', fiscal_year: 2026 }), {}, null);
    expect(r._meta).toMatchObject({ result_state: 'results' });
    expect((r._meta as { incomplete_reason?: string }).incomplete_reason).toBeUndefined();
  });
});
