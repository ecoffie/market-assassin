/**
 * Default source "all" is acceptable ONLY if award history stays unmistakably separate and can
 * never satisfy an open-topic request. Drives the REAL library through the tool wrapper (no mock of
 * @/lib/sbir/search): open-topic sources unavailable, NIH returns awards.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SbirDeps } from '@/lib/sbir/search';

vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: { aiHint: false } }));
import { sbirSearch } from './sbir';

const AWARD_END = '2027-05-31';
const MULTISITE_END = '2027-04-30T00:00:00+00:00';

function deps(): SbirDeps {
  return {
    fetch: (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{
        project_num: '1R43EY000001-01', project_title: 'Zero Trust Telemetry for Clinical Devices', activity_code: 'R43',
        project_start_date: '2026-06-01', project_end_date: AWARD_END, abstract_text: 'zero trust', agency_ic_admin: { abbreviation: 'NEI' },
      }] }),
    })) as unknown as typeof fetch,
    db: {
      // The real corpus: every multisite sbir row is an NIH project page whose close_date is its END.
      multisite: async () => ({ data: [{ id: 'm1', title: 'Zero Trust Records Platform', agency: 'NIH', source: 'nih_reporter', source_url: 'https://reporter.nih.gov/project-details/1', posted_date: '2026-07-01', close_date: MULTISITE_END }], error: null }),
      dodTopics: async () => ({ data: [], error: null }),
      dodOpenCount: async () => ({ count: 0, error: null }), // empty cache → unavailable
    },
    now: () => new Date('2026-09-26T12:00:00Z'),
    sleep: async () => {},
    nihTimeoutMs: 2_000,
    nihRetryDelayMs: 0,
    nihMinAttemptMs: 0,
    dbTimeoutMs: 2_000,
  };
}

describe('open-topic request with the default source', () => {
  it('awards found + open sources unavailable → coverage UNAVAILABLE, nothing presented as open, no end date as a deadline', async () => {
    const r = await sbirSearch({ keyword: 'zero trust' }, deps()); // no source → default "all"
    expect(r.queried.source).toBe('all');

    // Awards exist and are returned — separately.
    expect(r.award_history.length).toBe(2);
    expect(r._meta.grounded).toBe(true);

    // …but they cannot satisfy the open-topic question.
    expect(r.open_topics).toEqual([]);
    expect(r.opportunities).toEqual([]);
    expect(r._meta.open_topic_count).toBe(0);
    expect(r._meta.open_topics_established).toBe(false);
    expect(r.coverage.open_topics_established).toBe(false);
    expect(r.coverage.statement).toMatch(/could NOT be established/);
    expect(r.coverage.statement).toMatch(/none of them can be proposed to/);
    expect(r.sources.find((s) => s.source === 'dod_sbir_topics')?.status).toBe('unavailable');

    // No award end date appears anywhere as a deadline.
    for (const a of r.award_history) {
      expect(a.record_kind).toBe('award_history');
      expect(a.status).toBe('awarded');
      expect(a.close_date).toBeUndefined();
      expect((a as unknown as Record<string, unknown>).endDate).toBeUndefined();
    }
    expect(r.award_history.map((a) => a.project_end_date).sort()).toEqual(['2027-04-30', AWARD_END]);
    const openSide = JSON.stringify({ open_topics: r.open_topics, opportunities: r.opportunities });
    expect(openSide).not.toContain('2027-');
    // No key named like a deadline carries an award date anywhere in the payload.
    const deadlineKeys = JSON.stringify(r).match(/"(close_date|endDate|deadline|response_date)":"[^"]*"/g) ?? [];
    expect(deadlineKeys).toEqual([]);
  });

  it('explicit source="nih" also reports open topics as not established', async () => {
    const r = await sbirSearch({ keyword: 'zero trust', source: 'nih' }, deps());
    expect(r.award_history.length).toBe(1);
    expect(r.opportunities).toEqual([]);
    expect(r.coverage.open_topics_established).toBe(false);
    expect(r.coverage.statement).toMatch(/could NOT be established/);
  });
});
