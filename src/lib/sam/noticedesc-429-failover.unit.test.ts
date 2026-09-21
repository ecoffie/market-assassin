import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fetchNoticeDescriptionWithFailover,
  noticedescRetrievalLimitation,
  type NoticedescFetchDeps,
} from './notice-description';

/**
 * Issue-log #12: get_solicitation_documents used getRotatedSAMKey() alone for
 * noticedesc. On a day that key is 429-exhausted, sol# and UUID both resolve
 * identity but return empty body — even when another key still has quota.
 *
 * Source-string guards stay; execution tests below prove failover + disclosure.
 */

const DESC = readFileSync(join(process.cwd(), 'src/lib/sam/notice-description.ts'), 'utf8');
const DOCS = readFileSync(join(process.cwd(), 'src/lib/sam/solicitation-documents.ts'), 'utf8');

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const descCode = strip(DESC);
const docsCode = strip(DOCS);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

describe('noticedesc: source wiring', () => {
  it('walks getAllDistinctSAMKeys after the rotated key is unusable', () => {
    expect(descCode).toContain('getAllDistinctSAMKeys');
    expect(descCode).toContain('getRotatedSAMKey');
    expect(descCode).toContain('fetchNoticeDescriptionWithFailover');
    expect(descCode).toMatch(/isNoticedescKeyUnusable/);
  });

  it('fails over only on 429/401/403 — stops on ordinary errors and network', () => {
    expect(descCode).toMatch(/status === 429 \|\| status === 401 \|\| status === 403/);
    expect(descCode).toMatch(/non-throttle failure; stopping failover/);
    expect(descCode).toMatch(/network\/timeout failure; stopping failover/);
  });

  it('discloses empty body, mixed credential/quota, and network misses', () => {
    expect(descCode).toContain('noticedescRetrievalLimitation');
    expect(descCode).toMatch(/emptySuccess/);
    expect(descCode).toMatch(/mixed credential and quota/);
    expect(descCode).toMatch(/Absence of description text does not mean the notice has no scope/);
  });

  it('solicitation-documents uses failover + discloses + persists on success', () => {
    expect(docsCode).toContain('fetchNoticeDescriptionWithFailover');
    expect(docsCode).toContain('noticedescRetrievalLimitation');
    expect(docsCode).not.toMatch(/getRotatedSAMKey\(\)/);
    expect(docsCode).toMatch(/description:\s*fetched\.text/);
    expect(docsCode).toMatch(/description_checked_at/);
  });
});

describe('noticedesc: mocked failover execution', () => {
  const keys = { rotated: 'key-rotated', other: 'key-other' };
  let fetchFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchFn = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function deps(overrides: Partial<NoticedescFetchDeps> = {}): NoticedescFetchDeps {
    return {
      fetchFn: fetchFn as unknown as typeof fetch,
      getRotatedKey: () => keys.rotated,
      getAllKeys: () => [keys.rotated, keys.other],
      ...overrides,
    };
  }

  it('fails over from first-key 429 to second-key success', async () => {
    fetchFn
      .mockResolvedValueOnce(jsonResponse({ description: 'nope' }, 429))
      .mockResolvedValueOnce(jsonResponse({ description: '<p>Real synopsis body</p>' }, 200));

    const r = await fetchNoticeDescriptionWithFailover('85a62e9a3f4f4f54b0ade7aa855fcc89', 5000, deps());
    expect(r.text).toContain('Real synopsis body');
    expect(r.keysTried).toBe(2);
    expect(r.outcomes).toEqual([
      { kind: 'http', status: 429 },
      { kind: 'ok', chars: expect.any(Number) },
    ]);
    expect(noticedescRetrievalLimitation(r)).toBeNull();
  });

  it('records all-key unusable outcomes and distinguishes mixed 401+429', async () => {
    fetchFn
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({}, 429));

    const r = await fetchNoticeDescriptionWithFailover('notice-id', 5000, deps());
    expect(r.text).toBe('');
    expect(r.allKeysUnusable).toBe(true);
    expect(r.outcomes).toEqual([
      { kind: 'http', status: 401 },
      { kind: 'http', status: 429 },
    ]);
    const msg = noticedescRetrievalLimitation(r);
    expect(msg).toMatch(/mixed credential and quota/);
    expect(msg).toMatch(/key 1 → 401 \(credentials\)/);
    expect(msg).toMatch(/key 2 → 429 \(quota\)/);
    expect(msg).not.toMatch(/returned 429 on every/);
  });

  it('stops on timeout and discloses without inventing an HTTP status', async () => {
    const timeoutErr = new Error('The operation was aborted due to timeout');
    timeoutErr.name = 'TimeoutError';
    fetchFn.mockRejectedValueOnce(timeoutErr);

    const r = await fetchNoticeDescriptionWithFailover('notice-id', 5, deps());
    expect(r.text).toBe('');
    expect(r.keysTried).toBe(1);
    expect(r.outcomes[0]).toMatchObject({ kind: 'network', reason: 'timeout' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const msg = noticedescRetrievalLimitation(r);
    expect(msg).toMatch(/timeout/i);
    expect(msg).not.toMatch(/returned 429/);
    expect(msg).toMatch(/does not mean the notice has no scope/);
  });

  it('discloses HTTP 200 empty body and does not burn the second key', async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse({ description: '   ' }, 200));

    const r = await fetchNoticeDescriptionWithFailover('notice-id', 5000, deps());
    expect(r.text).toBe('');
    expect(r.emptySuccess).toBe(true);
    expect(r.keysTried).toBe(1);
    expect(r.outcomes).toEqual([{ kind: 'empty' }]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const msg = noticedescRetrievalLimitation(r);
    expect(msg).toMatch(/empty synopsis body/i);
    expect(msg).toMatch(/does not mean the notice has no scope/);
  });

  it('stops on non-throttle HTTP (500) without trying the next key', async () => {
    fetchFn.mockResolvedValueOnce(textResponse('boom', 500));

    const r = await fetchNoticeDescriptionWithFailover('notice-id', 5000, deps());
    expect(r.text).toBe('');
    expect(r.keysTried).toBe(1);
    expect(r.outcomes).toEqual([{ kind: 'http', status: 500 }]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const msg = noticedescRetrievalLimitation(r);
    expect(msg).toMatch(/500/);
  });
});
