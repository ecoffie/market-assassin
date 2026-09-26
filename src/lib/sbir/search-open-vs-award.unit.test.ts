/**
 * search_sbir: open topics are never award history, every source reports how it ended, and no
 * upstream can hold the request open. Hermetic — fetch and the DB are injected.
 *
 * Fixtures are shaped from rows measured on 2026-09-26: NIH RePORTER answered "cybersecurity" with
 * an eye-occlusion dose monitor; the multisite corpus was 42/42 `nih_reporter` project-detail rows
 * whose close_date is the project END date; dod_sbir_topics held 0 rows.
 */
import { describe, it, expect, vi } from 'vitest';
import { searchSbir, sanitizeForOrFilter, classifyRelevance, type SbirDeps, type SbirDb } from './search';

const NOW = new Date('2026-09-26T12:00:00Z');

const nihProject = (over: Record<string, unknown> = {}) => ({
  project_num: '1R43EY000001-01',
  project_title: "AmblyoGo: a 'Smart' Easy-to-use Occlusion Dose Monitor",
  activity_code: 'R43',
  award_amount: 300000,
  project_start_date: '2026-06-01',
  project_end_date: '2027-05-31',
  abstract_text: 'A connected monitor with cybersecurity safeguards for pediatric amblyopia.',
  agency_ic_admin: { abbreviation: 'NEI' },
  organization: { org_name: 'Eye Co', org_city: 'Boston', org_state: 'MA' },
  ...over,
});
const jsonRes = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

function db(over: Partial<SbirDb> = {}): SbirDb {
  return {
    multisite: async () => ({ data: [], error: null }),
    dodTopics: async () => ({ data: [], error: null }),
    dodOpenCount: async () => ({ count: 0, error: null }),
    ...over,
  };
}
function deps(over: Partial<SbirDeps> = {}): SbirDeps {
  return {
    fetch: vi.fn(async () => jsonRes(200, { results: [nihProject()] })) as unknown as typeof fetch,
    db: db(),
    now: () => NOW,
    sleep: async () => {},
    nihTimeoutMs: 2_000,
    dbTimeoutMs: 2_000,
    ...over,
  };
}
/** A fetch that never answers — resolves only when its AbortSignal fires. */
const hangingFetch = (() => (_url: string, init: RequestInit) =>
  new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
  })) as unknown as () => typeof fetch;

describe('open topics vs award history', () => {
  it('NIH rows are award_history — never open_topics, never a deadline', async () => {
    const r = await searchSbir({ keyword: 'cybersecurity', source: 'nih' }, deps());
    expect(r.open_topics).toEqual([]);
    expect(r.award_history).toHaveLength(1);
    const a = r.award_history[0];
    expect(a.record_kind).toBe('award_history');
    expect(a.status).toBe('awarded');
    expect(a.close_date).toBeUndefined();
    expect(a.project_end_date).toBe('2027-05-31');
    expect(r.open_topics_established).toBe(false);
  });

  it('multisite nih_reporter rows (close_date = project END) are award history, not open', async () => {
    const r = await searchSbir({ source: 'multisite' }, deps({
      db: db({
        multisite: async () => ({
          data: [
            { id: 'a', title: 'OutFlowGen: One-Time CRISPR Therapy for Glaucoma', agency: 'NIH - NEI', source: 'nih_reporter', source_url: 'https://reporter.nih.gov/project-details/11405130', posted_date: '2026-07-17T00:00:00+00:00', close_date: '2027-05-31T00:00:00+00:00' },
            { id: 'b', title: 'Open notice', agency: 'NSF', source: 'nsf', source_url: 'https://nsf.gov/x', posted_date: '2026-09-01', close_date: '2026-10-15' },
            { id: 'c', title: 'Closed notice', agency: 'NSF', source: 'nsf', posted_date: '2026-06-01', close_date: '2026-08-01' },
          ],
          error: null,
        }),
      }),
    }));
    expect(r.award_history.map((x) => x.id)).toEqual(['a']);
    expect(r.award_history[0].close_date).toBeUndefined();
    expect(r.award_history[0].project_end_date).toBe('2027-05-31');
    expect(r.open_topics.map((x) => x.id)).toEqual(['b']);
    expect(r.open_topics[0].close_date).toBe('2026-10-15');
    expect(r.sources[0].detail).toMatch(/1 closed/);
  });

  it('an empty DoD cache is UNAVAILABLE, not "no open topics"', async () => {
    const r = await searchSbir({ keyword: 'zero trust', source: 'dod' }, deps());
    expect(r.sources).toEqual([expect.objectContaining({ source: 'dod_sbir_topics', status: 'unavailable' })]);
    expect(r.open_topics_established).toBe(false);
  });

  it('a null open-topic count is unknown (error), never zero', async () => {
    const r = await searchSbir({ source: 'dod' }, deps({ db: db({ dodOpenCount: async () => ({ count: null, error: null }) }) }));
    expect(r.sources[0].status).toBe('error');
    expect(r.degraded).toBe(true);
  });

  it('DoD topics that answered make open topics established, even with zero matches', async () => {
    const r = await searchSbir({ keyword: 'zero trust', source: 'dod' }, deps({ db: db({ dodOpenCount: async () => ({ count: 12, error: null }) }) }));
    expect(r.sources[0]).toMatchObject({ status: 'empty', detail: '12 open topic(s) cached; none matched' });
    expect(r.open_topics_established).toBe(true);
  });

  it('DoD rows come back as open topics with their close_date', async () => {
    const r = await searchSbir({ keyword: 'cross domain', source: 'dod' }, deps({
      db: db({
        dodOpenCount: async () => ({ count: 3, error: null }),
        dodTopics: async () => ({ data: [{ topic_number: 'AF261-0042', title: 'Cross Domain Solution Analytics', agency: 'DOD', branch: 'Air Force', program: 'SBIR', open_date: '2026-09-01', close_date: '2026-10-21', status: 'open' }], error: null }),
      }),
    }));
    expect(r.open_topics[0]).toMatchObject({ record_kind: 'open_topic', status: 'open', close_date: '2026-10-21', relevance: 'title' });
  });
});

describe('bounded execution, partial failure, retry', () => {
  it('a hung NIH upstream times out inside its budget and is reported as a timeout', async () => {
    const t0 = Date.now();
    const r = await searchSbir({ keyword: 'cybersecurity', source: 'nih' }, deps({ fetch: hangingFetch(), nihTimeoutMs: 150 }));
    expect(Date.now() - t0).toBeLessThan(1_500);
    expect(r.sources[0]).toMatchObject({ source: 'nih_reporter', status: 'timeout' });
    expect(r.degraded).toBe(true);
    expect(r.partial).toBe(false); // nothing else answered
  });

  it('partial: NIH times out while DoD answers — the answered source still ships, flagged partial', async () => {
    const r = await searchSbir({ keyword: 'cross domain', source: 'all' }, deps({
      fetch: hangingFetch(),
      nihTimeoutMs: 100,
      db: db({
        dodOpenCount: async () => ({ count: 1, error: null }),
        dodTopics: async () => ({ data: [{ topic_number: 'N261-007', title: 'Cross Domain Guard', close_date: '2026-11-01', status: 'open' }], error: null }),
      }),
    }));
    expect(r.open_topics).toHaveLength(1);
    expect(r.degraded).toBe(true);
    expect(r.partial).toBe(true);
    expect(r.sources.find((s) => s.source === 'nih_reporter')?.status).toBe('timeout');
  });

  it('retries NIH exactly once on 429, then succeeds', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(jsonRes(429, {}))
      .mockResolvedValueOnce(jsonRes(200, { results: [nihProject()] }));
    const r = await searchSbir({ source: 'nih' }, deps({ fetch: f as unknown as typeof fetch }));
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.sources[0]).toMatchObject({ status: 'ok', attempts: 2 });
  });

  it('two 429s → error carrying the upstream status, not a silent empty', async () => {
    const f = vi.fn(async () => jsonRes(429, {}));
    const r = await searchSbir({ source: 'nih' }, deps({ fetch: f as unknown as typeof fetch }));
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.sources[0]).toMatchObject({ status: 'error', detail: 'HTTP 429', attempts: 2 });
  });

  it('a 400 is not retried', async () => {
    const f = vi.fn(async () => jsonRes(400, {}));
    await searchSbir({ source: 'nih' }, deps({ fetch: f as unknown as typeof fetch }));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('every NIH request carries an abort signal', async () => {
    const f = vi.fn(async () => jsonRes(200, { results: [] }));
    await searchSbir({ source: 'nih' }, deps({ fetch: f as unknown as typeof fetch }));
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('input safety and relevance', () => {
  it('strips PostgREST logic-tree characters (a comma used to make the source error)', () => {
    expect(sanitizeForOrFilter('cybersecurity, AI')).toBe('cybersecurity AI');
    expect(sanitizeForOrFilter('cross-domain (CDS) 100%')).toBe('cross-domain CDS 100');
  });

  it('relevance is word-bounded: "cyber" does not match "cyberbullying"', () => {
    expect(classifyRelevance('cyber', 'Preventing Cyberbullying in Teens')).toBe('upstream_only');
    expect(classifyRelevance('zero trust', 'Zero Trust Telemetry Fusion')).toBe('title');
    expect(classifyRelevance('cybersecurity', 'Occlusion Dose Monitor', 'with cybersecurity safeguards')).toBe('body');
  });

  it('title matches rank ahead of body-only matches', async () => {
    const f = vi.fn(async () => jsonRes(200, { results: [
      nihProject({ project_num: 'A', project_title: 'Occlusion Dose Monitor' }),
      nihProject({ project_num: 'B', project_title: 'Cybersecurity for Infusion Pumps' }),
    ] }));
    const r = await searchSbir({ keyword: 'cybersecurity', source: 'nih' }, deps({ fetch: f as unknown as typeof fetch }));
    expect(r.award_history.map((x) => x.id)).toEqual(['B', 'A']);
  });
});
