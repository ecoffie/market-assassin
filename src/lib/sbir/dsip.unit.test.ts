/**
 * DoD DSIP retrieval — known-positive fixture, genuine zero, failed feed ≠ [].
 *
 * 2026-09-08: search_sbir source=dod returned an unflagged empty while live
 * Open/Pre-Release topics existed at www.dodsbirsttr.mil. sbir.gov is 403;
 * DSIP public topics search is the current authoritative source.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  epochToYmd,
  isLiveTopicStatus,
  normalizeDsipTopic,
  searchDsipTopics,
  type DsipTopicRow,
} from './dsip';

const POSITIVE: DsipTopicRow = {
  topicId: 't-nv028',
  topicCode: 'OSW26BZ06-NV028',
  topicTitle: '5G Signature Tracking Mitigation via Cyber Deception',
  topicStatus: 'Pre-Release',
  program: 'SBIR',
  component: 'OSD',
  solicitationNumber: '26.BZ',
  solicitationTitle: 'DoW SBIR 2026 BAA',
  cycleName: 'DOD_SBIR_2026_P1_CBZ',
  topicStartDate: Date.UTC(2026, 8, 23),
  topicEndDate: Date.UTC(2026, 9, 21),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('normalizeDsipTopic — known-positive OSW26BZ06-NV028', () => {
  it('keeps topic code, close date, component, and provenance', () => {
    const row = normalizeDsipTopic(POSITIVE);
    expect(row).not.toBeNull();
    expect(row!.id).toBe('dod-sbir:OSW26BZ06-NV028');
    expect(row!.title).toContain('OSW26BZ06-NV028');
    expect(row!.title).toContain('5G Signature Tracking Mitigation via Cyber Deception');
    expect(row!.agency).toBe('DOD / OSD');
    expect(row!.phase).toBe('SBIR');
    expect(row!.startDate).toBe('2026-09-23');
    expect(row!.endDate).toBe('2026-10-21');
    expect(row!.source).toBe('DoD DSIP');
    expect(row!.description).toMatch(/DoW SBIR 2026 BAA/);
    expect(row!.description).toMatch(/solicitation 26\.BZ/);
    expect(row!.description).toMatch(/status Pre-Release/);
    expect(row!.description).toMatch(/opens 2026-09-23/);
    expect(row!.description).toMatch(/closes 2026-10-21/);
    expect(row!.url).toBe('https://www.dodsbirsttr.mil/topics-app/');
  });

  it('epochToYmd reads millisecond timestamps as YYYY-MM-DD', () => {
    expect(epochToYmd(Date.UTC(2026, 8, 23))).toBe('2026-09-23');
    expect(epochToYmd(0)).toBeUndefined();
    expect(epochToYmd('2026-09-23')).toBeUndefined();
  });

  it('keeps Open and Pre-Release; drops Closed', () => {
    expect(isLiveTopicStatus('Open')).toBe(true);
    expect(isLiveTopicStatus('Pre-Release')).toBe(true);
    expect(isLiveTopicStatus('Closed')).toBe(false);
    expect(isLiveTopicStatus(undefined)).toBe(false);
  });
});

function jsonResponse(status: number, body: unknown) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('searchDsipTopics — feed vs genuine miss', () => {
  it('returns the known-positive live topic', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { total: 1, data: [POSITIVE] })),
    );
    const res = await searchDsipTopics({ keyword: 'OSW26BZ06-NV028', limit: 5 });
    expect(res.degraded).toBe(false);
    expect(res.total).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].id).toBe('dod-sbir:OSW26BZ06-NV028');
    expect(res.rows[0].endDate).toBe('2026-10-21');
  });

  it('filters Closed out of a mixed page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, {
          total: 2,
          data: [POSITIVE, { ...POSITIVE, topicCode: 'CLOSED-1', topicStatus: 'Closed' }],
        }),
      ),
    );
    const res = await searchDsipTopics({ keyword: 'cyber', limit: 10 });
    expect(res.degraded).toBe(false);
    expect(res.rows.map((r) => r.id)).toEqual(['dod-sbir:OSW26BZ06-NV028']);
  });

  it('a genuine zero-result search is empty and NOT degraded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { total: 0, data: [] })),
    );
    const res = await searchDsipTopics({ keyword: 'xyzzyplughqqqq9999', limit: 5 });
    expect(res.degraded).toBe(false);
    expect(res.total).toBe(0);
    expect(res.rows).toEqual([]);
  });

  it('HTTP 500 is degraded, not a confident []', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: 'nope' })));
    const res = await searchDsipTopics({ keyword: 'cyber', limit: 5 });
    expect(res.degraded).toBe(true);
    expect(res.total).toBeNull();
    expect(res.rows).toEqual([]);
  });

  it('HTTP 403 is degraded, not a confident []', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, { message: 'Forbidden' })));
    const res = await searchDsipTopics({ keyword: 'cyber', limit: 5 });
    expect(res.degraded).toBe(true);
    expect(res.rows).toEqual([]);
  });

  it('a 200 Forbidden body is degraded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { message: 'Forbidden' })));
    const res = await searchDsipTopics({ keyword: 'cyber', limit: 5 });
    expect(res.degraded).toBe(true);
    expect(res.rows).toEqual([]);
  });

  it('a thrown fetch is degraded, not a confident []', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('fetch failed');
    }));
    const res = await searchDsipTopics({ keyword: 'cyber', limit: 5 });
    expect(res.degraded).toBe(true);
    expect(res.rows).toEqual([]);
  });
});
