import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * DIBBS_PROXY_MODE=primary — proxy → direct → paid actor, decided PER FILE.
 * (tasks/dibbs-proxy-spike-2026-10-10.md)
 *
 * The invariants that keep this a cost change and not a coverage change:
 *   1. flag OFF is today's path, byte for byte
 *   2. a later path runs only for files the earlier one did not RESOLVE
 *   3. the paid actor is still reached when both free paths fail (data loss is worse than $)
 *   4. a confirmed-missing window never pays the actor
 *   5. dry-run writes nothing and never bills the actor by accident
 */

vi.mock('./direct', () => ({
  fetchDibbsDirect: vi.fn(),
  fetchDibbsDirectReport: vi.fn(),
  recentIndexFiles: vi.fn(() => ['in261008.txt', 'in261007.txt']),
}));

type Outcome = 'data' | 'missing' | 'blocked' | 'error';
const rfqs = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ solicitationNumber: `${prefix}-26-T-${String(i).padStart(4, '0')}` }));

/** A fetchDibbsDirectReport result for the files it was asked about. */
function report(via: 'proxy' | 'direct', outcomes: Record<string, Outcome>, rowsPerFile = 10) {
  const files = Object.entries(outcomes).map(([file, outcome]) => ({
    file, outcome, rows: outcome === 'data' ? rowsPerFile : 0, bytes: 1, ms: 1,
  }));
  const rows = files.flatMap((f) => (f.outcome === 'data' ? rfqs(`SPE${f.file.slice(2, 8)}`, rowsPerFile) : []));
  const complete = files.every((f) => f.outcome === 'data' || f.outcome === 'missing');
  return { via, files, rows, complete, consentMs: 900, totalMs: 9000, wireBytes: 300_000 };
}

function supabaseSpy() {
  const upsert = vi.fn(async () => ({ error: null }));
  const from = vi.fn(() => ({ upsert }));
  return { client: { from } as never, upsert, from };
}

function stubActor(items: unknown[]) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(items), { status: 200 }) as never);
}

beforeEach(() => {
  vi.resetModules();
  process.env.APIFY_TOKEN = 't';
  delete process.env.DIBBS_PROXY_MODE;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DIBBS_PROXY_MODE;
});

describe('flag OFF — production keeps today\'s path', () => {
  it('never enters the proxy chain when DIBBS_PROXY_MODE is unset', async () => {
    const d = await import('./direct');
    vi.mocked(d.fetchDibbsDirect).mockResolvedValue(rfqs('SPE1', 228) as never);
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(supabaseSpy().client, { maxItems: 2500, daysBack: 2 });
    expect(r.mode).toBe('off');
    expect(r.source).toBe('direct');
    expect(d.fetchDibbsDirectReport).not.toHaveBeenCalled();
  });

  it('treats any value other than the literal "primary" as OFF', async () => {
    for (const v of ['true', '1', 'on', 'PRIMARY']) {
      process.env.DIBBS_PROXY_MODE = v;
      const { dibbsProxyMode } = await import('./apify-proxy');
      expect(dibbsProxyMode()).toBe('off');
    }
  });
});

describe('flag ON — proxy → direct → actor, per file', () => {
  beforeEach(() => { process.env.DIBBS_PROXY_MODE = 'primary'; });

  it('expected case: proxy resolves every file, nothing else runs, $0 actor spend', async () => {
    const d = await import('./direct');
    vi.mocked(d.fetchDibbsDirectReport).mockResolvedValueOnce(report('proxy', { 'in261008.txt': 'data', 'in261007.txt': 'data' }) as never);
    const actor = vi.spyOn(globalThis, 'fetch');
    const sb = supabaseSpy();
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb.client, { maxItems: 2500, daysBack: 2 });
    expect(r.mode).toBe('primary');
    expect(r.source).toBe('proxy');
    expect(r.fetched).toBe(20);
    expect(d.fetchDibbsDirectReport).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.fetchDibbsDirectReport).mock.calls[0][0]).toMatchObject({ proxy: { sessionId: expect.stringMatching(/^dibbs\d{8}a[a-z0-9]+$/) } });
    expect(actor).not.toHaveBeenCalled();
    expect(r.estimatedCostUsd).toBe(0);
    expect(r.files?.every((f) => f.via === 'proxy' && f.outcome === 'data')).toBe(true);
    expect(sb.upsert).toHaveBeenCalledTimes(1);
  });

  it('retries ONLY the unresolved file with a fresh session, then direct, before any actor', async () => {
    const d = await import('./direct');
    vi.mocked(d.fetchDibbsDirectReport)
      .mockResolvedValueOnce(report('proxy', { 'in261008.txt': 'data', 'in261007.txt': 'blocked' }) as never)
      .mockResolvedValueOnce(report('proxy', { 'in261007.txt': 'blocked' }) as never)
      .mockResolvedValueOnce(report('direct', { 'in261007.txt': 'data' }) as never);
    const actor = vi.spyOn(globalThis, 'fetch');
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(supabaseSpy().client, { maxItems: 2500, daysBack: 2 });

    const calls = vi.mocked(d.fetchDibbsDirectReport).mock.calls.map((c) => c[0]);
    expect(calls[1]).toMatchObject({ files: ['in261007.txt'], proxy: { sessionId: expect.stringMatching(/^dibbs\d{8}b[a-z0-9]+$/) } });
    // the retry must NOT reuse the first session (Apify pins a session to one exit IP)
    expect(calls[1]!.proxy!.sessionId).not.toBe(calls[0]!.proxy!.sessionId);
    expect(calls[2]).toEqual({ files: ['in261007.txt'] }); // direct = no proxy option
    expect(actor).not.toHaveBeenCalled();
    expect(r.attempts.map((a) => `${a.path}:${a.outcome}`)).toEqual(['proxy:rows', 'proxy:empty', 'direct:rows']);
    expect(r.files?.find((f) => f.file === 'in261007.txt')).toMatchObject({ outcome: 'data', via: 'direct' });
    expect(r.files?.find((f) => f.file === 'in261008.txt')).toMatchObject({ outcome: 'data', via: 'proxy' });
  });

  it('DATA LOSS IS WORSE THAN COST: both free paths blocked → the existing actor still runs', async () => {
    const d = await import('./direct');
    vi.mocked(d.fetchDibbsDirectReport).mockResolvedValue(report('proxy', { 'in261008.txt': 'blocked', 'in261007.txt': 'blocked' }) as never);
    const actor = stubActor(rfqs('SPEACT', 2500));
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(supabaseSpy().client, { maxItems: 2500, daysBack: 2 });
    expect(actor).toHaveBeenCalledTimes(1);
    const url = String(actor.mock.calls[0][0]);
    expect(url).toContain('build=1.0.40'); // same pinned build
    expect(JSON.parse(String((actor.mock.calls[0][1] as RequestInit).body))).toMatchObject({ maxItems: 2500, daysBack: 2 });
    expect(r.source).toBe('apify');
    expect(r.fetched).toBe(2500);
    const last = r.attempts.at(-1)!;
    expect(last.path).toBe('apify');
    expect(last.reason).toContain('in261008.txt,in261007.txt');
    expect(r.estimatedCostUsd).toBeGreaterThan(30);
  });

  it('a proxy that cannot even start (password lookup / launch) still falls through', async () => {
    const d = await import('./direct');
    vi.mocked(d.fetchDibbsDirectReport)
      .mockResolvedValueOnce({ ...report('proxy', { 'in261008.txt': 'error', 'in261007.txt': 'error' }), error: 'proxy launch failed' } as never)
      .mockResolvedValueOnce({ ...report('proxy', { 'in261008.txt': 'error', 'in261007.txt': 'error' }), error: 'proxy launch failed' } as never)
      .mockResolvedValueOnce(report('direct', { 'in261008.txt': 'data', 'in261007.txt': 'data' }) as never);
    const actor = vi.spyOn(globalThis, 'fetch');
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(supabaseSpy().client, { maxItems: 2500, daysBack: 2 });
    expect(r.attempts[0]).toMatchObject({ path: 'proxy', outcome: 'threw' });
    expect(r.attempts[0].error).toContain('proxy launch failed');
    expect(r.source).toBe('direct');
    expect(actor).not.toHaveBeenCalled();
  });

  it('a CONFIRMED-missing window (holiday / not posted) never pays the actor', async () => {
    const d = await import('./direct');
    vi.mocked(d.fetchDibbsDirectReport).mockResolvedValueOnce(report('proxy', { 'in261008.txt': 'missing', 'in261007.txt': 'missing' }) as never);
    const actor = vi.spyOn(globalThis, 'fetch');
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(supabaseSpy().client, { maxItems: 2500, daysBack: 2 });
    expect(r.noDataConfirmed).toBe(true);
    expect(r.fetched).toBe(0);
    expect(d.fetchDibbsDirectReport).toHaveBeenCalledTimes(1);
    expect(actor).not.toHaveBeenCalled();
  });

  it('a mixed window (one file posted, one not yet) is complete, not a failure', async () => {
    const d = await import('./direct');
    vi.mocked(d.fetchDibbsDirectReport).mockResolvedValueOnce(report('proxy', { 'in261008.txt': 'missing', 'in261007.txt': 'data' }) as never);
    const actor = vi.spyOn(globalThis, 'fetch');
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(supabaseSpy().client, { maxItems: 2500, daysBack: 2 });
    expect(r.noDataConfirmed).toBe(false);
    expect(r.fetched).toBe(10);
    expect(actor).not.toHaveBeenCalled();
  });

  it('a full file above 2,500 rows is kept whole', async () => {
    const d = await import('./direct');
    vi.mocked(d.fetchDibbsDirectReport).mockResolvedValueOnce(report('proxy', { 'in261008.txt': 'missing', 'in261007.txt': 'data' }, 3157) as never);
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(supabaseSpy().client, { maxItems: 2500, daysBack: 2 });
    expect(r.fetched).toBe(3157);
  });
});

describe('dry-run — no production writes, no accidental actor bill', () => {
  it('flag ON: fetches and reports, never upserts, skips the actor unless allowApify', async () => {
    process.env.DIBBS_PROXY_MODE = 'primary';
    const d = await import('./direct');
    vi.mocked(d.fetchDibbsDirectReport).mockResolvedValue(report('proxy', { 'in261008.txt': 'blocked', 'in261007.txt': 'blocked' }) as never);
    const actor = vi.spyOn(globalThis, 'fetch');
    const sb = supabaseSpy();
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb.client, { maxItems: 2500, daysBack: 2, dryRun: true });
    expect(sb.upsert).not.toHaveBeenCalled(); // dry-run may READ (legacy-key lookup), never write
    expect(actor).not.toHaveBeenCalled();
    expect(r.attempts.at(-1)).toMatchObject({ path: 'apify', outcome: 'skipped' });
    expect(r.upserted).toBe(0);
    expect(r.dryRun).toBe(true);
  });

  it('flag OFF: same guarantees on today\'s path', async () => {
    const d = await import('./direct');
    vi.mocked(d.fetchDibbsDirect).mockRejectedValue(new Error('WAF blocked all 2 index file(s)'));
    const actor = vi.spyOn(globalThis, 'fetch');
    const sb = supabaseSpy();
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb.client, { maxItems: 2500, daysBack: 2, dryRun: true });
    expect(sb.upsert).not.toHaveBeenCalled(); // dry-run may READ (legacy-key lookup), never write
    expect(actor).not.toHaveBeenCalled();
    expect(r.attempts.some((a) => a.path === 'apify' && a.outcome === 'skipped')).toBe(true);
  });

  it('only=apify + allowApify exercises the fallback actor in isolation (small maxItems)', async () => {
    const d = await import('./direct');
    const actor = stubActor(rfqs('SPEACT', 5));
    const sb = supabaseSpy();
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb.client, { maxItems: 5, daysBack: 2, dryRun: true, only: 'apify', allowApify: true });
    expect(d.fetchDibbsDirectReport).not.toHaveBeenCalled();
    expect(actor).toHaveBeenCalledTimes(1);
    expect(r.source).toBe('apify');
    expect(r.dryRunIds).toHaveLength(5);
    expect(sb.upsert).not.toHaveBeenCalled(); // dry-run may READ (legacy-key lookup), never write
  });
});

describe('the cron route: dry-run branch writes nothing', () => {
  const ROUTE = readFileSync(join(process.cwd(), 'src/app/api/cron/sync-dibbs/route.ts'), 'utf8');
  const dryBranch = ROUTE.slice(ROUTE.indexOf('if (dryRun) {'), ROUTE.indexOf('const result = await ingestDibbs(supabase, { maxItems, daysBack, forceApify });'));

  it('returns before any cron outcome, alert, or upsert', () => {
    expect(dryBranch.length).toBeGreaterThan(100);
    expect(dryBranch).toContain('dryRun: true');
    expect(dryBranch).toContain('return NextResponse.json');
    expect(dryBranch).not.toContain('reportCronOutcome');
    expect(dryBranch).not.toContain('sendOpsAlert');
    expect(dryBranch).not.toContain('.upsert(');
  });

  it('only lets a DRY run override the flag or opt into the actor', () => {
    expect(dryBranch).toContain('proxyMode');
    expect(dryBranch).toContain('allowApify');
    const liveCall = ROUTE.slice(ROUTE.indexOf('const result = await ingestDibbs(supabase, { maxItems, daysBack, forceApify });'));
    expect(liveCall.split('\n')[0]).not.toMatch(/proxyMode|allowApify|only/);
  });

  it('judges truncation by the actor, never by a whole file', () => {
    expect(ROUTE).toMatch(/a\.path === 'apify' && a\.records >= maxItems/);
    expect(ROUTE).not.toContain('const truncated = result.fetched >= maxItems');
  });
});

describe('proxy credentials are never exposed', () => {
  it('sends the token as a header (not in the URL) and keeps both secrets out of errors', async () => {
    process.env.APIFY_TOKEN = 'SECRET_TOKEN_123';
    delete process.env.APIFY_PROXY_PASSWORD;
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { proxy: { password: 'PW_456' } } })) as never);
    const m = await import('./apify-proxy');
    m.__resetProxyPasswordCacheForTests();
    expect(await m.getApifyProxyPassword()).toBe('PW_456');
    expect(String(f.mock.calls[0][0])).not.toContain('SECRET_TOKEN_123');
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer SECRET_TOKEN_123' });

    m.__resetProxyPasswordCacheForTests();
    f.mockResolvedValue(new Response('nope', { status: 401 }) as never);
    const err = await m.getApifyProxyPassword().catch((e: Error) => e.message);
    expect(err).toContain('401');
    expect(err).not.toContain('SECRET_TOKEN_123');
  });

  it('no source in the DIBBS lib logs or returns the password', () => {
    for (const file of ['direct.ts', 'ingest.ts', 'apify-proxy.ts']) {
      const src = readFileSync(join(process.cwd(), 'src/lib/dibbs', file), 'utf8');
      expect(src).not.toMatch(/console\.\w+\([^)]*[pP]assword/);
    }
  });

  it('two runs on the same day never share a proxy session', async () => {
    process.env.DIBBS_PROXY_MODE = 'primary';
    const d = await import('./direct');
    vi.mocked(d.fetchDibbsDirectReport).mockResolvedValue(report('proxy', { 'in261008.txt': 'data', 'in261007.txt': 'data' }) as never);
    const { ingestDibbs } = await import('./ingest');
    await ingestDibbs(supabaseSpy().client, { daysBack: 2 });
    await ingestDibbs(supabaseSpy().client, { daysBack: 2 });
    const ids = vi.mocked(d.fetchDibbsDirectReport).mock.calls.map((c) => c[0]!.proxy!.sessionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds a residential US username with a sanitized session', async () => {
    const { apifyProxyUsername } = await import('./apify-proxy');
    expect(apifyProxyUsername('dibbs20261010a')).toBe('groups-RESIDENTIAL,country-US,session-dibbs20261010a');
    expect(apifyProxyUsername('bad id!/x')).toBe('groups-RESIDENTIAL,country-US,session-badidx');
  });
});

describe('no NEW twin rows from the id fix', () => {
  function fakeDb(existing: string[], opts: { failLookup?: boolean } = {}) {
    const written: string[][] = [];
    const client = {
      from: () => ({
        select: () => ({
          in: async (_c: string, list: string[]) => (opts.failLookup
            ? { data: null, error: { message: 'boom' } }
            : { data: list.filter((x) => existing.includes(x)).map((solicitation_number) => ({ solicitation_number })), error: null }),
        }),
        upsert: async (rows: Array<{ solicitation_number: string }>) => { written.push(rows.map((r) => r.solicitation_number)); return { error: null }; },
      }),
    } as never;
    return { client, written };
  }

  it('writes onto the legacy undashed key when that is the only stored row', async () => {
    const { upsertDibbsRfqs } = await import('./ingest');
    // Preview dry run, 2026-10-10: 47 of 7,252 ids were stored ONLY undashed.
    const db = fakeDb(['SPE4A526T482J', 'SPE7MC-26-T-252L', 'SPE7MC26T252L']);
    await upsertDibbsRfqs(db.client, [
      { solicitationNumber: 'SPE4A5-26-T-482J' },  // legacy-only  -> adopt legacy key
      { solicitationNumber: 'SPE7MC-26-T-252L' },  // dashed exists -> keep canonical
      { solicitationNumber: 'SPE2DS-26-T-213Q' },  // brand new     -> canonical
      { solicitationNumber: 'SPE2DP-26-T-4251' },  // digit serial  -> never had a twin
    ]);
    expect(db.written[0].sort()).toEqual(['SPE2DP-26-T-4251', 'SPE2DS-26-T-213Q', 'SPE4A526T482J', 'SPE7MC-26-T-252L'].sort());
  });

  it('a failed lookup never blocks ingestion — canonical ids are written', async () => {
    const { upsertDibbsRfqs } = await import('./ingest');
    const db = fakeDb([], { failLookup: true });
    const r = await upsertDibbsRfqs(db.client, [{ solicitationNumber: 'SPE4A5-26-T-482J' }]);
    expect(r.upserted).toBe(1);
    expect(db.written[0]).toEqual(['SPE4A5-26-T-482J']);
  });
});
