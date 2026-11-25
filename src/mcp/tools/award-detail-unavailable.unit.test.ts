/**
 * #2432 — get_award_detail returned `no_result` for 36C24823P1623 (VA janitorial, Citadel Federal Solutions LLC,
 * $4,307,059.84) and found it 82 s later with the same args. The readers folded an upstream failure into "no such
 * award", so the customer was told the record did not exist and to hold off. Unknown is never zero.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolvePiidToIdChecked, fetchAwardDetailChecked, resolvePiidToId } from '@/lib/usaspending/award-detail';
import { classifyBillingOutcome } from '@/lib/mcp/credit-integrity';

const PIID = '36C24823P1623';
const GID = 'CONT_AWD_36C24823P1623_3600_-NONE-_-NONE-';
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const hit = json(200, { results: [{ 'Award ID': PIID, generated_internal_id: GID }] });
const empty = json(200, { results: [] });
const DETAIL = json(200, { piid: PIID, recipient: { recipient_name: 'CITADEL FEDERAL SOLUTIONS LLC' }, total_obligation: 4307059.84, period_of_performance: { end_date: '2027-08-31' } });

describe('resolvePiidToIdChecked — a miss is confirmed only when every query answered', () => {
  it('found in the contracts group', async () => {
    const f = vi.fn(async () => hit) as unknown as typeof fetch;
    expect(await resolvePiidToIdChecked(PIID, f)).toEqual({ state: 'found', value: GID });
  });
  it('both groups answered with no match → not_found', async () => {
    const f = vi.fn(async () => empty) as unknown as typeof fetch;
    expect(await resolvePiidToIdChecked(PIID, f)).toEqual({ state: 'not_found' });
  });
  it('the contracts group failed (HTTP 503) and IDVs had no match → unavailable, never not_found', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(empty) as unknown as typeof fetch;
    expect((await resolvePiidToIdChecked(PIID, f)).state).toBe('unavailable');
  });
  it('a network error / timeout is unavailable', async () => {
    const f = vi.fn(async () => { throw new Error('fetch failed'); }) as unknown as typeof fetch;
    expect(await resolvePiidToIdChecked(PIID, f)).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('fetch failed') });
  });
  it('a hit in one group wins even if the other group failed', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(500, {})).mockResolvedValueOnce(hit) as unknown as typeof fetch;
    expect(await resolvePiidToIdChecked(PIID, f)).toEqual({ state: 'found', value: GID });
  });
  it('the search sends a User-Agent (USASpending drops UA-less requests from cloud IPs)', async () => {
    const f = vi.fn(async () => hit);
    await resolvePiidToIdChecked(PIID, f as unknown as typeof fetch);
    const init = (f.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> };
    expect(init.headers['User-Agent']).toMatch(/^Mindy-GovConGiants/);
  });
  it('the back-compat reader still returns null for both a miss and a failure', async () => {
    expect(await resolvePiidToId('')).toBeNull();
  });
});

describe('fetchAwardDetailChecked', () => {
  it('200 → found', async () => {
    const r = await fetchAwardDetailChecked(GID, vi.fn(async () => DETAIL) as unknown as typeof fetch);
    expect(r.state).toBe('found');
    if (r.state === 'found') expect(r.value.recipientName).toBe('CITADEL FEDERAL SOLUTIONS LLC');
  });
  it('404 → not_found; 5xx / throw → unavailable', async () => {
    expect((await fetchAwardDetailChecked(GID, vi.fn(async () => json(404, {})) as unknown as typeof fetch)).state).toBe('not_found');
    expect((await fetchAwardDetailChecked(GID, vi.fn(async () => json(502, {})) as unknown as typeof fetch)).state).toBe('unavailable');
    expect((await fetchAwardDetailChecked(GID, vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch)).state).toBe('unavailable');
  });
});

describe('get_award_detail — the tool result and its billing', () => {
  async function runTool(seq: Response[] | ((n: number) => Response)) {
    vi.resetModules();
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      const r = typeof seq === 'function' ? seq(n) : seq[Math.min(n, seq.length - 1)];
      n += 1;
      return r;
    }));
    const { getAwardDetail } = await import('./award-detail');
    const out = await getAwardDetail({ piid: PIID }, { now: new Date('2026-11-25T00:00:00Z') });
    vi.unstubAllGlobals();
    return { out, calls: n };
  }

  it('upstream down on both tries → degraded, ungrounded, NOT billable as "no result"', async () => {
    const { out } = await runTool(() => json(503, {}));
    expect(out._meta).toMatchObject({ grounded: false, degraded: true });
    expect(classifyBillingOutcome(out)).toBe('nonbillable_system_failure');
  });
  it('a transient failure is retried once and the award is returned (the 82-second case)', async () => {
    // try 1: contracts 503, IDV empty → unavailable; try 2: contracts hit, then detail 200.
    const { out } = await runTool([json(503, {}), empty, hit, DETAIL]);
    expect(out._meta).toMatchObject({ grounded: true, degraded: false });
    expect(out.award?.recipientName).toBe('CITADEL FEDERAL SOLUTIONS LLC');
  });
  it('a confirmed miss is still a billable no_result (the tool did the research)', async () => {
    const { out } = await runTool(() => empty);
    expect(out._meta).toMatchObject({ grounded: false, degraded: false });
    expect(classifyBillingOutcome(out)).toBe('billable_no_result');
  });
});
