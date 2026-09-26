/**
 * search_sbir tool wrapper: the open/awarded split and the coverage statement ship IN BAND
 * (not behind the default-off _ai_hint), and the billing classifier reads the result honestly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SbirSearchResult } from '@/lib/sbir/search';
import { classifyBillingOutcome, isBillable } from '@/lib/mcp/credit-integrity';

const searchSbir = vi.fn<(...a: unknown[]) => Promise<SbirSearchResult>>();
vi.mock('@/lib/sbir/search', () => ({ searchSbir: (...a: unknown[]) => searchSbir(...a) }));
vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: { aiHint: false } }));

import { sbirSearch } from './sbir';

const award = { id: 'x', record_kind: 'award_history', status: 'awarded', title: 'Funded project', agency: 'NEI', relevance: 'body', source: 'NIH RePORTER', project_end_date: '2027-05-31' } as const;
const topic = { id: 'dod-sbir:AF261-1', record_kind: 'open_topic', status: 'open', title: 'AF261-1 — Cross Domain', agency: 'DOD', relevance: 'title', source: 'DoD SBIR', close_date: '2026-10-21' } as const;
const base = (o: Partial<SbirSearchResult>): SbirSearchResult => ({
  open_topics: [], award_history: [], sources: [], degraded: false, partial: false, open_topics_established: false, ...o,
});

beforeEach(() => searchSbir.mockReset());

describe('search_sbir wrapper', () => {
  it('awards-only + DoD cache unavailable: opportunities is EMPTY and coverage says open topics were not established', async () => {
    searchSbir.mockResolvedValue(base({
      award_history: [award],
      sources: [
        { source: 'nih_reporter', kind: 'award_history', status: 'ok', rows: 1, ms: 120 },
        { source: 'dod_sbir_topics', kind: 'open_topic', status: 'unavailable', rows: 0, ms: 40, detail: 'the DoD open-topic cache holds 0 open topics' },
      ],
    }));
    const r = await sbirSearch({ keyword: 'zero trust' });
    expect(r.opportunities).toEqual([]);
    expect(r.award_history).toHaveLength(1);
    expect(r._ai_hint).toBeUndefined();
    expect(r.coverage.open_topics_established).toBe(false);
    expect(r.coverage.statement).toMatch(/could NOT be established/);
    expect(r.coverage.statement).toMatch(/dod_sbir_topics \(unavailable/);
    expect(r._meta).toMatchObject({ grounded: true, open_topic_count: 0, award_history_count: 1 });
  });

  it('default source is all', async () => {
    searchSbir.mockResolvedValue(base({}));
    const r = await sbirSearch({});
    expect(searchSbir).toHaveBeenCalledWith(expect.objectContaining({ source: 'all' }));
    expect(r.queried.source).toBe('all');
  });

  it('open topics present: opportunities aliases open_topics only', async () => {
    searchSbir.mockResolvedValue(base({ open_topics: [topic], award_history: [award], open_topics_established: true }));
    const r = await sbirSearch({ keyword: 'cross domain' });
    expect(r.opportunities).toEqual([topic]);
    expect(r.opportunities.some((o) => o.record_kind === 'award_history')).toBe(false);
    expect(r.coverage.statement).toMatch(/^1 open SBIR\/STTR topic/);
  });

  it('billing: every source failed, nothing returned → not billable', async () => {
    searchSbir.mockResolvedValue(base({ degraded: true, sources: [{ source: 'nih_reporter', kind: 'award_history', status: 'timeout', rows: 0, ms: 8000 }] }));
    const r = await sbirSearch({ keyword: 'cybersecurity', source: 'nih' });
    expect(isBillable(classifyBillingOutcome(r))).toBe(false);
  });

  it('billing: partial result that returned rows is billable under the current rule (see PR: proposal only)', async () => {
    searchSbir.mockResolvedValue(base({ award_history: [award], degraded: true, partial: true }));
    const r = await sbirSearch({ keyword: 'cybersecurity' });
    expect(classifyBillingOutcome(r)).toBe('billable_success');
  });
});
