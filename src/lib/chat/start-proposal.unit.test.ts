import { describe, it, expect, vi } from 'vitest';
import { startProposalFromNotice, proposalHref } from './start-proposal';

const NID = '6ba812a7e0284f79bc44c4932777c340';
const N = { notice_id: NID, title: 'Janitorial, USCG Key West', deadline: '2026-12-04T17:00:00Z' };
function fetcher(first: { status: number; body?: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === '/api/pipeline') return { ok: first.status < 300, status: first.status, json: async () => first.body ?? {} };
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  });
  return { f, calls };
}

describe('startProposalFromNotice', () => {
  it('new pursuit: one pipeline POST (which schedules the docs fetch itself), then the Proposals link', async () => {
    const { f, calls } = fetcher({ status: 200, body: { success: true, opportunity: { id: 'p-1' } } });
    const r = await startProposalFromNotice(f, 'u@example.com', N);
    expect(r).toEqual({ ok: true, pursuitId: 'p-1', href: '/app?panel=proposals&pursuit_id=p-1', created: true, docsRequested: false });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ user_email: 'u@example.com', title: N.title, notice_id: NID, source: 'ask_mindy', response_deadline: N.deadline });
  });
  it('already tracked without documents: reuses the row and asks for its documents once', async () => {
    const { f, calls } = fetcher({ status: 409, body: { opportunity: { id: 'p-2', docs_status: 'failed' } } });
    const r = await startProposalFromNotice(f, 'u@example.com', N);
    expect(r).toMatchObject({ ok: true, pursuitId: 'p-2', created: false, docsRequested: true });
    expect(calls[1].url).toBe('/api/app/proposal/pursuit-docs?email=u%40example.com&pipeline_id=p-2');
    expect(calls[1].init.method).toBe('POST');
  });
  it('already tracked with documents ready or fetching: no second fetch', async () => {
    for (const s of ['ready', 'loaded', 'fetching']) {
      const { f, calls } = fetcher({ status: 409, body: { opportunity: { id: 'p-3', docs_status: s } } });
      expect(await startProposalFromNotice(f, 'u@example.com', N)).toMatchObject({ ok: true, docsRequested: false });
      expect(calls).toHaveLength(1);
    }
  });
  it('fails honestly: bad id, a failed save, or no row id never navigates', async () => {
    expect(await startProposalFromNotice(fetcher({ status: 200 }).f, 'u@example.com', { ...N, notice_id: 'W912PL26Q0042' })).toEqual({ ok: false, reason: 'invalid_notice' });
    expect(await startProposalFromNotice(fetcher({ status: 500 }).f, 'u@example.com', N)).toEqual({ ok: false, reason: 'save_failed' });
    expect(await startProposalFromNotice(fetcher({ status: 200, body: {} }).f, 'u@example.com', N)).toEqual({ ok: false, reason: 'no_pursuit_id' });
  });
  it('the link encodes the id', () => {
    expect(proposalHref('a b')).toBe('/app?panel=proposals&pursuit_id=a%20b');
  });
});
