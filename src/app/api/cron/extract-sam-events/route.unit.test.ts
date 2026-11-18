/**
 * extract-sam-events, end to end over an in-memory Supabase. These are the route-level halves of
 * T1/T2/T4 (tasks/intelligence-infrastructure-audit-2026-11-09.md §7) and they FAIL against the
 * pre-fix route: it read only `.limit(500)` newest notices, never reconciled a solicitation family,
 * and never wrote `extracted_at`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fixture from '@/lib/events/__fixtures__/event-currency-notices.json';

type Row = Record<string, unknown>;
const db: {
  sam_opportunities: Row[];
  sam_events: Row[];
  cron_logs: Row[];
  cron_job_runs: Row[];
  upserts: Row[][];
  deletes: string[][];
  cronLogInsertError: string | null;
} = {
  sam_opportunities: [], sam_events: [], cron_logs: [], cron_job_runs: [], upserts: [], deletes: [],
  cronLogInsertError: null,
};
type Table = 'sam_opportunities' | 'sam_events' | 'cron_logs' | 'cron_job_runs';

function query(table: Table) {
  const filters: Array<(r: Row) => boolean> = [];
  const orders: Array<{ col: string; asc: boolean }> = [];
  let lo = 0;
  let hi = Infinity;
  let single = false;
  let op: 'select' | 'upsert' | 'delete' | 'insert' = 'select';
  let payload: Row[] = [];
  const b: Record<string, unknown> = {
    select: () => b,
    in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return b; },
    eq: (col: string, v: unknown) => { filters.push((r) => r[col] === v); return b; },
    not: (col: string, o: string, v: string) => {
      const ids = v.replace(/[()]/g, '').split(',');
      filters.push((r) => !ids.includes(String(r[col])));
      return b;
    },
    or: (expr: string) => {
      // Only the shapes the route uses: "event_date >= X (or undated)" and the source filter.
      const gte = /event_date\.gte\.(\d{4}-\d{2}-\d{2})/.exec(expr);
      if (gte) filters.push((r) => !r.event_date || String(r.event_date) >= gte[1]);
      if (expr.includes('source.eq.sam_gov')) filters.push((r) => !r.source || r.source === 'sam_gov');
      return b;
    },
    order: (col: string, o?: { ascending?: boolean }) => { orders.push({ col, asc: o?.ascending !== false }); return b; },
    limit: (n: number) => { hi = lo + n - 1; return b; },
    range: (from: number, to: number) => { lo = from; hi = to; return b; },
    maybeSingle: () => { single = true; return b; },
    upsert: (rows: Row[]) => { op = 'upsert'; payload = rows; return b; },
    delete: () => { op = 'delete'; return b; },
    insert: (row: Row) => { op = 'insert'; payload = [row]; return b; },
    then: (resolve: (v: unknown) => void) => {
      if (op === 'insert') {
        if (table === 'cron_job_runs' && db.cronLogInsertError) {
          return resolve({ data: null, error: { message: db.cronLogInsertError } });
        }
        const dest = table === 'cron_job_runs' ? db.cron_job_runs : db.cron_logs;
        dest.push(...payload);
        return resolve({ data: null, error: null });
      }
      if (op === 'upsert') {
        db.upserts.push(payload);
        for (const p of payload) {
          const i = db.sam_events.findIndex((e) => e.notice_id === p.notice_id);
          if (i >= 0) db.sam_events[i] = { ...db.sam_events[i], ...p };
          else db.sam_events.push({ source: 'sam_gov', extracted_at: new Date().toISOString(), ...p });
        }
        return resolve({ data: payload.map((_, i) => ({ id: i })), error: null });
      }
      let rows = db[table].filter((r) => filters.every((f) => f(r)));
      if (op === 'delete') {
        db.deletes.push(rows.map((r) => String(r.notice_id)));
        db.sam_events = db.sam_events.filter((r) => !rows.includes(r));
        return resolve({ data: null, count: rows.length, error: null });
      }
      for (const o of [...orders].reverse()) {
        rows = [...rows].sort((a, z) => {
          const av = String(a[o.col] ?? ''); const zv = String(z[o.col] ?? '');
          return o.asc ? av.localeCompare(zv) : zv.localeCompare(av);
        });
      }
      rows = rows.slice(lo, hi === Infinity ? undefined : hi + 1);
      resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null });
    },
  };
  return b;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: Table) => query(t) }),
}));
vi.mock('@/lib/cron-self-report', () => ({ reportCronOutcome: vi.fn(async () => undefined) }));
vi.mock('@/lib/gov-contacts/event-office', () => ({
  resolveEventOffice: async () => ({ dodaac: null, office: null, subAgency: null }),
}));

const N = Object.fromEntries(fixture.notices.map((n) => [n.notice_id, n]));
const TSA_ORIGINAL = N.f98693bbb744490cb7920e8b2651c1d7;
const TSA_AMD1 = N.db864acb24374165a33376f5511301c4;
const VA = N.da74fba251794157a586b821fd45573e;
const opp = (n: Row): Row => ({ department: 'DHS', ui_link: null, office: null, sub_tier: null, ...n });
const filler = (i: number, posted: string): Row => opp({
  notice_id: `filler-${String(i).padStart(4, '0')}`, title: `Sources Sought ${i}`, description: 'Sources sought for widgets.',
  notice_type: 'Sources Sought', posted_date: posted, response_deadline: '2026-12-30T00:00:00Z', solicitation_number: `FILL${i}X26`, active: true,
});

async function run(): Promise<{ status: number; body: { stats: Record<string, unknown> } }> {
  const { GET } = await import('./route');
  const res = await GET(new NextRequest('http://localhost/api/cron/extract-sam-events', { headers: { authorization: 'Bearer test-secret' } }));
  return { status: res.status, body: await res.json() };
}
const written = (id: string) => db.upserts.flat().filter((r) => r.notice_id === id);

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
  vi.useFakeTimers({ toFake: ['Date'] });
  db.sam_opportunities = []; db.sam_events = []; db.cron_logs = []; db.cron_job_runs = []; db.upserts = []; db.deletes = [];
  db.cronLogInsertError = null;
  delete process.env.SAM_EVENTS_PRUNE;
});
afterEach(() => { vi.useRealTimers(); delete process.env.SAM_EVENTS_PRUNE; });

describe('extract-sam-events route', () => {
  it('T2: a 30-day-old notice behind an upcoming event is re-read past 600 newer notices and corrected', async () => {
    vi.setSystemTime(new Date('2026-11-20T07:00:00Z'));
    db.sam_opportunities = [opp(VA), ...Array.from({ length: 600 }, (_, i) => filler(i, '2026-11-19T00:00:00+00:00'))];
    // The row the old extractor stored: the response deadline, not the industry day.
    db.sam_events = [{ notice_id: VA.notice_id, event_type: 'industry_day', event_date: '2026-12-05', source: 'sam_gov', extracted_at: '2026-10-22T07:00:00Z', solicitation_number: VA.solicitation_number }];
    const { status } = await run();
    expect(status).toBe(200);
    expect(written(VA.notice_id).map((r) => r.event_date)).toEqual(['2026-12-10']);
  });

  it('T1: TSA original + Amendment 1 (same solicitation number) both store Nov 18 after one pass', async () => {
    vi.setSystemTime(new Date('2026-11-09T07:00:00Z'));
    db.sam_opportunities = [opp(TSA_ORIGINAL), opp(TSA_AMD1)];
    db.sam_events = [{ notice_id: TSA_ORIGINAL.notice_id, event_type: 'industry_day', event_date: '2026-11-13', source: 'sam_gov', extracted_at: '2026-10-17T07:00:00Z', solicitation_number: 'TSA25-04-0644' }];
    await run();
    expect(written(TSA_ORIGINAL.notice_id).map((r) => r.event_date)).toEqual(['2026-11-18']);
    expect(written(TSA_AMD1.notice_id).map((r) => r.event_date)).toEqual(['2026-11-18']);
  });

  it('T1b: the amendment drives the original even when the amendment is no longer an active candidate', async () => {
    vi.setSystemTime(new Date('2026-11-09T07:00:00Z'));
    db.sam_opportunities = [opp(TSA_ORIGINAL), opp({ ...TSA_AMD1, active: false })];
    db.sam_events = [{ notice_id: TSA_ORIGINAL.notice_id, event_type: 'industry_day', event_date: '2026-11-17', source: 'sam_gov', extracted_at: '2026-10-17T07:00:00Z', solicitation_number: 'TSA25-04-0644' }];
    await run();
    expect(written(TSA_ORIGINAL.notice_id).map((r) => r.event_date)).toEqual(['2026-11-18']);
  });

  it('T4: every upserted row carries extracted_at = the run time', async () => {
    vi.setSystemTime(new Date('2026-11-09T07:00:00Z'));
    db.sam_opportunities = [opp(TSA_AMD1), filler(1, '2026-11-08T00:00:00+00:00')];
    await run();
    const rows = db.upserts.flat();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.extracted_at).toBe('2026-11-09T07:00:00.000Z');
  });

  const seedRetirement = () => {
    vi.setSystemTime(new Date('2026-11-09T07:00:00Z'));
    const notEvent = opp({ notice_id: 'not-event', title: 'Draft Solicitation for Crypto Systems', description: 'This is a pre-solicitation notice. The RFP will follow.', notice_type: 'Presolicitation', posted_date: '2026-11-05T00:00:00+00:00', response_deadline: null, solicitation_number: 'N6523627R0004', active: true });
    db.sam_opportunities = [notEvent, ...Array.from({ length: 8 }, (_, i) => filler(i, '2026-11-08T00:00:00+00:00'))];
    db.sam_events = [
      { id: 'row-not-event', notice_id: 'not-event', event_type: 'industry_day', event_date: null, source: 'sam_gov', extracted_at: '2026-11-07T07:00:00Z' },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `row-${i}`, notice_id: `filler-${String(i).padStart(4, '0')}`, event_type: 'rfi', event_date: '2026-12-30', source: 'sam_gov', extracted_at: '2026-11-07T07:00:00Z' })),
      { id: 'row-ai', notice_id: 'ai-1', event_type: 'conference', event_date: '2026-12-01', source: 'ai_web_search', extracted_at: '2026-11-07T07:00:00Z' },
    ];
  };

  it('default (no flag): deletes NOTHING, reports the proposal in the response and durably in cron_job_runs', async () => {
    seedRetirement();
    const { body } = await run();
    expect(db.deletes).toEqual([]);
    expect(db.sam_events.some((r) => r.notice_id === 'not-event')).toBe(true);
    const prune = (body as unknown as { prune: Record<string, unknown> }).prune;
    expect(prune).toMatchObject({ mode: 'report', proposed: 1, deleted: 0, recorded: true });
    expect(prune.proposals).toEqual([{ id: 'row-not-event', notice_id: 'not-event', reason: 'no_event_on_reread', stored_type: 'industry_day', stored_date: null }]);
    expect(db.cron_logs).toHaveLength(0);
    expect(db.cron_job_runs).toHaveLength(1);
    expect(db.cron_job_runs[0]).toMatchObject({ job_name: 'extract-sam-events:prune-report', status: 'report' });
    expect(JSON.parse(String(db.cron_job_runs[0].error)).deleted).toBe(0);
  });

  it('any flag value other than "apply" is still report-only', async () => {
    seedRetirement();
    process.env.SAM_EVENTS_PRUNE = 'true';
    await run();
    expect(db.deletes).toEqual([]);
  });

  it('SAM_EVENTS_PRUNE=apply: deletes exactly the capped proposal; AI rows are never touched', async () => {
    seedRetirement();
    process.env.SAM_EVENTS_PRUNE = 'apply';
    const { body } = await run();
    expect(db.deletes.flat()).toEqual(['not-event']);
    expect(body.stats.retired).toBe(1);
    expect(db.sam_events.some((r) => r.notice_id === 'ai-1')).toBe(true);
    expect(db.cron_job_runs[0]).toMatchObject({ status: 'applied' });
    expect(db.cron_logs).toHaveLength(0);
  });

  it('fails the job (500) when the durable prune report cannot be recorded', async () => {
    seedRetirement();
    db.cronLogInsertError = 'simulated cron_logs insert failure';
    const { status, body } = await run();
    expect(status).toBe(500);
    expect(body).toMatchObject({
      success: false,
      status: 'ingest_broken',
      prune: { recorded: false, proposed: 1 },
    });
    expect(db.deletes).toEqual([]);
    expect(db.cron_job_runs).toHaveLength(0);
    expect(db.cron_logs).toHaveLength(0);
  });
});
