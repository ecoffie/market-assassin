/**
 * GAO collector OUTCOME TRUTH — driven through the real GET handler (execute mode).
 * The feed, oversight.gov, the database, ingest and derivation are faked; the outcome
 * decision, reason summary and instance clock patch are real.
 *
 * Defect (2026-11-23): a run cut by the budget (`partial`) self-reported `success`,
 * answered 200 with success:true and cron_job_runs.error NULL, while the instance was
 * stamped content_stale and Slack fired "Verified ingest incomplete".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const outcomes: Array<{ job: string; outcome: string; reason?: string }> = [];
const instancePatches: Record<string, unknown>[] = [];
const alerts: Array<{ subject: string; html: string }> = [];
let ingestError: string | null = null;
let reconcileThrows: Error | null = null;

function builder(table: string) {
  let isUpdate = false;
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, in: () => b, not: () => b, order: () => b, limit: () => b,
    maybeSingle: async () => ({ data: null, error: null }),
    update: (patch: Record<string, unknown>) => {
      isUpdate = true;
      if (table === 'data_source_instances') instancePatches.push(patch);
      return b;
    },
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve(isUpdate ? { data: null, error: null } : { data: [], count: 10, error: null }).then(res),
  };
  return b;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/cron-self-report', async (orig) => ({
  ...(await orig<typeof import('@/lib/cron-self-report')>()),
  reportCronOutcome: async (job: string, outcome: string, reason?: string) => { outcomes.push({ job, outcome, reason }); },
}));
vi.mock('@/lib/ops-alert', () => ({ sendOpsAlert: async (a: { subject: string; html: string }) => { alerts.push(a); } }));
vi.mock('@/lib/ops-alert-dedup', () => ({ shouldSendAlert: async () => ({ send: true }), fingerprint: (p: string[]) => p.join('|') }));
vi.mock('@/lib/institute/sources', () => ({
  fetchGaoReports: async () => [
    { documentNumber: 'GAO-26-000001', title: 'One', url: 'https://www.gao.gov/products/gao-26-000001', publicationDate: '2026-11-20', agencyText: null, raw: {} },
    { documentNumber: 'GAO-26-000002', title: 'Two', url: 'https://www.gao.gov/products/gao-26-000002', publicationDate: '2026-11-21', agencyText: null, raw: {} },
  ],
  ingestInstituteDocument: async () => ({
    documentNumber: 'x', instituteSourceId: ingestError ? null : 'id', inserted: false,
    resolution: { resolved: true }, ...(ingestError ? { error: ingestError } : {}),
  }),
  reconcileUnresolvedGaoAgencies: async () => {
    if (reconcileThrows) throw reconcileThrows;
    return { checked: 0, newlyResolved: 0, details: [] };
  },
}));
vi.mock('@/lib/strategic-intel/derive', () => ({
  deriveFromInstituteSource: async () => ({ outcome: 'evidence_only_no_claim' }),
  deriveAcquiredPainPoint: async () => ({ outcome: 'evidence_only_no_claim' }),
}));
vi.mock('@/lib/institute/acquired-pain-points', async (orig) => ({
  ...(await orig<typeof import('@/lib/institute/acquired-pain-points')>()),
  collectOpenRecommendations: async () => ({ documents: [], pagesFetched: 1, stop: 'page_fully_held', httpStatus: 200, error: null, heldSkipped: 0, deferredOverCap: 0 }),
  fetchTextSource: async () => ({ ok: true, status: 200, body: '' }),
  laneFromFetch: (name: string) => ({ name, ok: true, httpStatus: 200, error: null, documents: [] }),
}));

async function run(qs = '') {
  process.env.CRON_SECRET = 'test-secret';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  const { GET } = await import('./route');
  const req = new NextRequest(`http://localhost/api/cron/institute-gao-sync${qs}`, {
    headers: { authorization: 'Bearer test-secret' },
  });
  const res = await GET(req);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  outcomes.length = 0; instancePatches.length = 0; alerts.length = 0;
  ingestError = null; reconcileThrows = null;
});

describe('institute-gao-sync outcome truth', () => {
  it('a clean run reports success with no error text', async () => {
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, partial: false, verifiedComplete: true, reason: null });
    expect(outcomes).toEqual([{ job: 'institute-gao-sync', outcome: 'success', reason: undefined }]);
  });

  it('a budget-cut run is partial everywhere — outcome, success, status, HTTP, instance', async () => {
    const { status, body } = await run('?budgetMs=-1');
    expect(body.partial).toBe(true);
    expect(body.success).toBe(false);
    expect(body.verifiedComplete).toBe(false);
    expect(body.status).toBe('degraded');
    expect(status).toBe(503);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('partial');
    expect(outcomes[0].reason).toMatch(/^budget=1 \[GAO RSS cut at 0\/2 after -1ms budget\]/);
    expect(instancePatches.at(-1)).toMatchObject({ source_state: 'content_stale' });
    expect(instancePatches.at(-1)).not.toHaveProperty('last_verified_ingest');
    const alert = alerts.find((a) => a.subject.includes('Verified ingest incomplete'));
    expect(alert?.html).toContain('Reason: budget=1');
  });

  it('ingest errors are reported with their messages, not dropped', async () => {
    ingestError = 'duplicate key value violates unique constraint';
    const { body } = await run();
    expect(body.failed).toBe(2);
    expect(outcomes[0].outcome).toBe('partial');
    expect(outcomes[0].reason).toBe(
      'ingest_failed=2 [GAO-26-000001: duplicate key value violates unique constraint | GAO-26-000002: duplicate key value violates unique constraint]',
    );
  });

  it('a reconcile exception is reconcile_failed with its message — never blocked history', async () => {
    reconcileThrows = new Error('reconcileUnresolvedGaoAgencies: canceling statement due to statement timeout');
    const { body } = await run();
    expect(body.blockedNoHistory).toBe(0);
    expect(body.reconcileFailed).toBe(1);
    expect(body.success).toBe(false);
    expect(outcomes[0]).toEqual({
      job: 'institute-gao-sync',
      outcome: 'partial',
      reason: 'reconcile_failed=1 [reconcileUnresolvedGaoAgencies: canceling statement due to statement timeout]',
    });
  });
});
