/**
 * Email save — SCANNER SAFETY contract (2026-10-06).
 *
 * The daily alert's save link was a GET that wrote user_pipeline. Mail scanners fetch links on
 * delivery: 83% of email saves in 30 days landed within 2 minutes of the send. These tests pin:
 *   - GET / HEAD / OPTIONS on the email link, link previews, repeated fetches, and a scanner that
 *     FOLLOWS the redirect and renders the confirmation page all produce ZERO writes;
 *   - only the confirmation form's POST saves, with a signed, expiring, action-bound token;
 *   - repeated / concurrent submissions never create a duplicate;
 *   - the confirmation is recorded separately (pipeline_save_confirmations, confirmed_by_user).
 *
 * The database is an in-memory fake that enforces the real unique constraints
 * (pipeline_save_confirmations PK; user_pipeline (user_email, notice_id)) and logs every write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { generateEmailToken } from '@/lib/api-auth';

// ── in-memory Supabase fake ───────────────────────────────────────────────────
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  writes: [] as { table: string; op: string; row?: unknown }[],
  failTable: null as string | null,
  clients: 0,
}));

function makeFake() {
  db.clients += 1;
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row | null = null;
    let wantRow = false;
    const rows = () => (db.tables[table] ||= []);
    const matches = (r: Row) => filters.every(([c, v]) => r[c] === v);
    const run = (): { data: unknown; error: { code?: string; message: string } | null } => {
      if (db.failTable === table) return { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } };
      if (op === 'insert') {
        const r = { id: crypto.randomUUID(), ...payload } as Row;
        if (table === 'pipeline_save_confirmations' && rows().some((x) => x.idempotency_key === r.idempotency_key)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "pipeline_save_confirmations_pkey"' } };
        }
        if (table === 'user_pipeline' && r.notice_id != null && rows().some((x) => x.user_email === r.user_email && x.notice_id === r.notice_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "user_pipeline_user_email_notice_id_key"' } };
        }
        rows().push(r);
        db.writes.push({ table, op: 'insert', row: r });
        return { data: wantRow ? r : null, error: null };
      }
      if (op === 'update') {
        const hit = rows().filter(matches);
        hit.forEach((r) => Object.assign(r, payload));
        db.writes.push({ table, op: 'update', row: payload });
        return { data: null, error: null };
      }
      const hit = rows().filter(matches);
      return { data: hit[0] ?? null, error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => { wantRow = true; return chain; },
      insert: (p: Row) => { op = 'insert'; payload = p; return chain; },
      update: (p: Row) => { op = 'update'; payload = p; return chain; },
      upsert: () => { throw new Error('upsert not expected'); },
      delete: () => { throw new Error('delete not expected'); },
      eq: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
      or: () => chain, order: () => chain, limit: () => chain, ilike: () => chain,
      maybeSingle: () => Promise.resolve(run()),
      single: () => Promise.resolve(run()),
      then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => Promise.resolve(run()).then(res, rej),
    };
    return chain;
  };
  return { from };
}

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => makeFake()) }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }));
vi.mock('@/lib/grants/fetch-grant-docs', () => ({ fetchPursuitDocsAuto: vi.fn() }));
vi.mock('@/lib/pipeline/sam-opportunity-lookup', () => ({ lookupSamOpportunityForPipeline: vi.fn(async () => null) }));
vi.mock('@/lib/pipeline/discovered-at', () => ({ resolveDiscoveredAt: vi.fn(async (_sb: unknown, o: { nowIso: string }) => o.nowIso) }));

import { GET as linkGET, HEAD as linkHEAD, OPTIONS as linkOPTIONS } from './route';
import { POST as confirmPOST, GET as confirmGET, HEAD as confirmHEAD } from './confirm/route';
import ConfirmPage from '@/app/pipeline/confirm/page';
import { buildEmailSaveConfirmation } from '@/lib/pipeline/email-save';

const EMAIL = 'buyer@example.org';
const NOTICE = '3814af63cb5a4a18b0cbb5018bc39928';
const BASE = 'https://getmindy.ai';

function emailLink(overrides: Record<string, string> = {}) {
  const { token, ts } = generateEmailToken(EMAIL);
  const p = new URLSearchParams({
    email: EMAIL, notice_id: NOTICE, title: 'Infrared Radiant Heat Maintenance Services',
    agency: 'DEPT OF DEFENSE', stage: 'tracking', source: 'daily_alert', token, ts: String(ts), ...overrides,
  });
  return `${BASE}/api/actions/add-to-pipeline?${p}`;
}

const SCANNER_UAS = [
  'Mozilla/5.0 (compatible; Microsoft Office Protocol Discovery)',          // Safe Links style fetch
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 BarracudaCentral',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',            // link preview
  'facebookexternalhit/1.1',                                               // link preview
  'Mozilla/5.0 (compatible; Googlebot/2.1)',
];

async function confirmationForm(linkUrl: string): Promise<URLSearchParams> {
  const model = await buildEmailSaveConfirmation(makeFake() as never, new URL(linkUrl).searchParams);
  if (model.state !== 'ready') throw new Error(`expected ready, got ${model.state}`);
  const f = model.fields, a = model.action;
  const form = new URLSearchParams();
  const put = (k: string, v: string | null) => { if (v != null) form.set(k, v); };
  put('email', f.email); put('title', f.title); put('notice_id', f.noticeId); put('stage', f.stage);
  put('agency', f.agency); put('source', f.source); put('idempotency_key', a.idempotencyKey);
  put('exp', String(a.exp)); put('sig', a.sig); put('link_ts', String(model.linkIssuedAt));
  return form;
}

const post = (form: URLSearchParams, ua = 'Mozilla/5.0 (Macintosh) Safari/605') =>
  confirmPOST(new NextRequest(`${BASE}/api/actions/add-to-pipeline/confirm`, {
    method: 'POST', body: form.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': ua },
  }));

const pipelineRows = () => db.tables.user_pipeline ?? [];
const writeCount = () => db.writes.length;

beforeEach(() => {
  process.env.EMAIL_ACTION_SECRET = 'test-secret-for-email-actions';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
  db.tables = {}; db.writes = []; db.failTable = null; db.clients = 0;
});

describe('the email link never writes', () => {
  it('GET forwards to the confirmation page (303, same query) without touching the database', async () => {
    const url = emailLink();
    const res = await linkGET(new NextRequest(url));
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/pipeline/confirm');
    expect(loc.search).toBe(new URL(url).search);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(db.clients).toBe(0);
    expect(writeCount()).toBe(0);
  });

  it('HEAD and OPTIONS write nothing', async () => {
    const h = await linkHEAD(new NextRequest(emailLink(), { method: 'HEAD' }));
    expect(h.status).toBe(303);
    const o = await linkOPTIONS();
    expect(o.status).toBe(204);
    expect(writeCount()).toBe(0);
  });

  it('repeated fetches and link previews from scanner user agents write nothing', async () => {
    const url = emailLink();
    for (let i = 0; i < 4; i++) {
      for (const ua of SCANNER_UAS) {
        await linkGET(new NextRequest(url, { headers: { 'user-agent': ua } }));
        await linkHEAD(new NextRequest(url, { method: 'HEAD', headers: { 'user-agent': ua } }));
      }
    }
    expect(writeCount()).toBe(0);
    expect(pipelineRows()).toHaveLength(0);
  });

  it('a scanner that FOLLOWS the redirect and renders the confirmation page writes nothing', async () => {
    const res = await linkGET(new NextRequest(emailLink()));
    const loc = new URL(res.headers.get('location')!);
    for (let i = 0; i < 3; i++) {
      const page = await ConfirmPage({ searchParams: Promise.resolve(Object.fromEntries(loc.searchParams)) });
      expect(page).toBeTruthy();
    }
    expect(db.clients).toBeGreaterThan(0); // the page did read
    expect(writeCount()).toBe(0);          // ...and wrote nothing
  });

  it('GET / HEAD on the confirm endpoint are refused (405) and write nothing', async () => {
    expect((await confirmGET()).status).toBe(405);
    expect((await confirmHEAD()).status).toBe(405);
    expect(writeCount()).toBe(0);
  });
});

describe('only the explicit button POST saves', () => {
  it('a confirmed POST creates exactly one pipeline row and records the confirmation separately', async () => {
    const res = await post(await confirmationForm(emailLink()));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/pipeline/added');
    expect(pipelineRows()).toHaveLength(1);
    expect(pipelineRows()[0]).toMatchObject({ user_email: EMAIL, notice_id: NOTICE, source: 'daily_alert' });
    const conf = db.tables.pipeline_save_confirmations ?? [];
    expect(conf).toHaveLength(1);
    expect(conf[0]).toMatchObject({ confirmed_by_user: true, outcome: 'created', pipeline_id: pipelineRows()[0].id, user_email: EMAIL });
    expect(conf[0].link_issued_at).toBeTruthy();
  });

  it('resubmitting the same form is a replay — no second row', async () => {
    const form = await confirmationForm(emailLink());
    await post(form);
    const again = await post(form);
    expect(new URL(again.headers.get('location')!).pathname).toBe('/pipeline/added');
    expect(pipelineRows()).toHaveLength(1);
    expect(db.tables.pipeline_save_confirmations).toHaveLength(1);
  });

  it('concurrent submissions of the same form create one row', async () => {
    const form = await confirmationForm(emailLink());
    await Promise.all([post(form), post(form), post(form)]);
    expect(pipelineRows()).toHaveLength(1);
  });

  it('a second confirmation page for the same opportunity resolves to already tracking', async () => {
    await post(await confirmationForm(emailLink()));
    // a fresh page load AFTER the save shows "already tracking" instead of a form...
    const model = await buildEmailSaveConfirmation(makeFake() as never, new URL(emailLink()).searchParams);
    expect(model.state).toBe('already_tracking');
    expect(pipelineRows()).toHaveLength(1);
  });

  it('two forms opened BEFORE either save still produce one row (unique index)', async () => {
    const f1 = await confirmationForm(emailLink());
    const f2 = await confirmationForm(emailLink());
    const r1 = await post(f1);
    const r2 = await post(f2);
    expect(new URL(r1.headers.get('location')!).pathname).toBe('/pipeline/added');
    expect(new URL(r2.headers.get('location')!).pathname).toBe('/pipeline/already-tracking');
    expect(pipelineRows()).toHaveLength(1);
  });

  it('a tampered, expired or unsigned form writes nothing', async () => {
    const tampered = await confirmationForm(emailLink());
    tampered.set('notice_id', 'ffffffffffffffffffffffffffffffff');
    const expired = await confirmationForm(emailLink());
    expired.set('exp', String(Math.floor(Date.now() / 1000) - 1));
    const unsigned = await confirmationForm(emailLink());
    unsigned.delete('sig');
    for (const f of [tampered, expired, unsigned]) {
      const res = await post(f);
      expect(new URL(res.headers.get('location')!).pathname).toBe('/pipeline/error');
    }
    expect(writeCount()).toBe(0);
  });

  it('fails CLOSED if the confirmation record cannot be written (no pipeline row)', async () => {
    const form = await confirmationForm(emailLink());
    db.failTable = 'pipeline_save_confirmations';
    const res = await post(form);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/pipeline/error');
    expect(pipelineRows()).toHaveLength(0);
  });
});

describe('the confirmation page verifies the email link before offering a form', () => {
  it('a forged or expired link gets no form', async () => {
    const forged = new URL(emailLink({ token: 'deadbeef'.repeat(4) })).searchParams;
    expect((await buildEmailSaveConfirmation(makeFake() as never, forged)).state).toBe('invalid');
    const old = Math.floor(Date.now() / 1000) - 3 * 86400;
    const crypto = await import('node:crypto');
    const token = crypto.createHmac('sha256', process.env.EMAIL_ACTION_SECRET!).update(`${EMAIL}:${old}`).digest('hex').substring(0, 32);
    const expired = new URL(emailLink({ token, ts: String(old) })).searchParams;
    const m = await buildEmailSaveConfirmation(makeFake() as never, expired);
    expect(m).toEqual({ state: 'invalid', reason: 'link_expired' });
    expect(writeCount()).toBe(0);
  });
});
