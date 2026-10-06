import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE REAL CRON HANDLER — a failed Open search is a FAILURE, never "no opportunities".
 *
 * THE BUG (match-health audit, 2026-10-06): fetchSamOpportunitiesFromCache returned
 * `{ opportunities: [] }` when PostgREST answered with an error. Seven keyword-only
 * profiles (0 NAICS, 4–11 keywords) hit `57014 canceling statement due to statement
 * timeout` on every attempt, serial and unloaded. The cron could not tell that apart
 * from an empty market, so it logged
 *   delivery_status='skipped', error_message='no_new_or_active_opportunities'
 * and marked the user processed for the day — no retry, and a false market claim in
 * every report that reads alert_log.
 *
 * POST /api/cron/daily-alerts runs the real runDailyAlertJob → real
 * fetchSamOpportunitiesFromCache. Only the EDGES are replaced: Supabase (one in-memory
 * fake whose sam_opportunities read can be made to fail), sendEmail (captured),
 * grants / Today's Lens / Coming Back / cross-day retries / telemetry (inert).
 */

const USER = 'keyword-only@example.com';
const TODAY = new Date().toISOString().split('T')[0];

type Row = Record<string, unknown>;
const future = (d: number) => new Date(Date.now() + d * 864e5).toISOString();

const OPEN_ROW: Row = {
  notice_id: 'n-janitorial-1',
  title: 'Janitorial Services — Federal Building',
  description: 'Janitorial and custodial services.',
  solicitation_number: 'SOL-JAN-1',
  naics_code: '561720',
  psc_code: 'S201',
  department: 'GENERAL SERVICES ADMINISTRATION',
  sub_tier: 'PUBLIC BUILDINGS SERVICE',
  office: '',
  posted_date: future(-0.2),
  response_deadline: future(10),
  archive_date: null,
  set_aside_code: null,
  set_aside_description: null,
  notice_type: 'Solicitation',
  active: true,
  ui_link: null,
  last_modified: future(-0.2),
};

const USER_ROW: Row = {
  id: 'u1', user_email: USER, naics_codes: [], keywords: ['janitorial services', 'custodial', 'floor care', 'carpet cleaning'],
  agencies: [], business_type: null, alerts_enabled: true, alert_frequency: 'daily', is_active: true,
  timezone: 'America/New_York', aggregated_profile: {}, naics_source: null, psc_codes: [], location_states: [],
  set_aside_preferences: [], total_alerts_sent: 0,
};

const TIMEOUT = { code: '57014', details: null, hint: null, message: 'canceling statement due to statement timeout' };

/** 'error' = every sam_opportunities read fails; 'empty' = a measured zero; 'rows' = one open match. */
let SAM_MODE: 'error' | 'empty' | 'rows' = 'error';
/** Per-test profile changes (Coming Back loads only for a NAICS/PSC market). */
let USER_OVERRIDES: Row = {};
let SAM_READS = 0;
/** alert_log keyed like the real unique constraint (user_email, alert_date, alert_type). */
const ALERT_LOG = new Map<string, Row>();
const logKey = (r: Row) => `${r.user_email}|${r.alert_date}|${r.alert_type}`;

function fakeClient() {
  return {
    from(table: string) {
      let write: string | null = null;
      let payload: unknown = null;
      const result = () => {
        if (write) {
          const rows = (Array.isArray(payload) ? payload : [payload]).filter(Boolean) as Row[];
          if (table === 'alert_log' && (write === 'upsert' || write === 'insert')) {
            for (const r of rows) ALERT_LOG.set(logKey(r), { ...(ALERT_LOG.get(logKey(r)) || {}), ...r });
          }
          return { data: rows, error: null, count: rows.length };
        }
        if (table === 'sam_opportunities') {
          SAM_READS++;
          if (SAM_MODE === 'error') return { data: null, error: TIMEOUT, count: null };
          const d = SAM_MODE === 'rows' ? [OPEN_ROW] : [];
          return { data: d, error: null, count: d.length };
        }
        if (table === 'user_notification_settings') return { data: [{ ...USER_ROW, ...USER_OVERRIDES }], error: null, count: 1 };
        if (table === 'alert_log') { const d = [...ALERT_LOG.values()]; return { data: d, error: null, count: d.length }; }
        return { data: [], error: null, count: 0 };
      };
      let ranged = false;
      const b: Record<string, unknown> = {};
      const self = () => b;
      for (const m of ['eq', 'neq', 'or', 'gte', 'lte', 'gt', 'lt', 'in', 'is', 'not', 'like', 'ilike', 'order', 'contains', 'overlaps', 'filter', 'match', 'textSearch', 'limit', 'select']) b[m] = self;
      // fetchAllPaged pages with .range(); the fake returns everything on the first page only.
      b.range = (a: number) => { ranged = true; if (a > 0) { write = null; (b as { _empty?: boolean })._empty = true; } return b; };
      for (const op of ['insert', 'update', 'upsert', 'delete']) b[op] = (p?: unknown) => { write = op; payload = p ?? null; return b; };
      const settle = () => ((b as { _empty?: boolean })._empty && ranged ? { data: [], error: null, count: 0 } : result());
      b.maybeSingle = async () => { const r = settle(); return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }; };
      b.single = b.maybeSingle;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(settle()).then(res, rej);
      return b;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

const SENT: Array<{ to: string; subject: string; html: string }> = [];

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient() }));
vi.mock('@/lib/supabase/server-clients', () => ({ getReadClient: () => fakeClient() }));
vi.mock('@/lib/send-email', () => ({
  sendEmail: async (m: { to: string; subject: string; html: string }) => { SENT.push(m); return true; },
}));
vi.mock('@/lib/intelligence', () => {
  class IntelligenceMetrics { constructor() { return new Proxy(this, { get: (_t, p) => (p === 'getSnapshot' ? () => ({}) : () => undefined) }); } }
  class GuardrailMonitor { constructor() { return new Proxy(this, { get: (_t, p) => (p === 'check' ? () => ({ continue: true }) : p === 'getStats' ? () => ({}) : async () => undefined) }); } }
  class CircuitBreaker { async isOpen() { return false; } async record() { return undefined; } }
  return { IntelligenceMetrics, GuardrailMonitor, CircuitBreaker, logIntelligenceDelivery: async () => undefined, postSendValidation: async () => ({ ok: true }) };
});
let GRANTS: Row[] = [];
vi.mock('@/lib/briefings/pipelines/grants-gov', async (orig) => ({
  ...(await orig<typeof import('@/lib/briefings/pipelines/grants-gov')>()),
  searchGrantsByNAICS: async () => ({ grants: GRANTS, totalRecords: GRANTS.length }),
  scoreGrant: () => 100,
}));
vi.mock('@/lib/dashboard/todays-lens', () => ({ computeTodaysLens: async () => null }));
let COMING_BACK: Row = { kind: 'omit', reason: 'no_naics_market' };
vi.mock('@/lib/alerts/coming-back-to-market', async (orig) => ({
  ...(await orig<typeof import('@/lib/alerts/coming-back-to-market')>()),
  loadComingBackSection: async () => COMING_BACK,
}));
vi.mock('@/lib/alerts/retry-failed-daily', async (orig) => ({
  ...(await orig<typeof import('@/lib/alerts/retry-failed-daily')>()),
  retryFailedDailyAlerts: async () => ({ retried: 0, succeeded: 0, skipped: 0, failed: 0, skipReasons: {} }),
}));
vi.mock('@/lib/market/vault-eligibility', () => ({ loadVaultEligibility: async () => new Map() }));
vi.mock('@/lib/tool-errors', async (orig) => ({ ...(await orig<typeof import('@/lib/tool-errors')>()), logToolError: async () => undefined }));
vi.mock('@/lib/engagement', async (orig) => ({
  ...(await orig<typeof import('@/lib/engagement')>()),
  createEmailTrackingToken: async () => ({ success: true, token: 'tok' }),
}));

let POST: typeof import('./route').POST;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.ADMIN_PASSWORD = 'admin-test-password';
  process.env.EMAIL_ACTION_SECRET = 'test-email-action-secret';
  delete process.env.SAM_API_KEY; // no live-API fallback in a unit test
  delete process.env.ENABLE_HIDDEN_MATCH;
  delete process.env.ENABLE_DAILY_ALERT_AI_TIPS;
  delete process.env.ENABLE_MINDY_INSIGHTS;
  ({ POST } = await import('./route'));
});

beforeEach(() => { SENT.length = 0; ALERT_LOG.clear(); SAM_MODE = 'error'; SAM_READS = 0; GRANTS = []; COMING_BACK = { kind: 'omit', reason: 'no_naics_market' }; USER_OVERRIDES = {}; });

/** A scheduled-style run scoped to the one user. NOT forceResend: the same-day guard must be exercised. */
async function run() {
  const res = await POST(new NextRequest('http://x/api/cron/daily-alerts', {
    method: 'POST',
    headers: { authorization: 'Bearer cron-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ testEmail: USER, skipTimezoneCheck: true }),
  }));
  expect(res.status).toBe(200);
  return res.json();
}
const todayRow = () => ALERT_LOG.get(`${USER}|${TODAY}|daily`);

describe('daily-alerts cron — a failed Open search is recorded as a failure, not as an empty market', () => {
  it('timeout on a keyword-only profile: no "no opportunities" row, recorded failed with the reason, no email', async () => {
    const body = await run();
    expect(body.results).toMatchObject({ openSearchFailed: 1, noOpps: 0, failed: 0, sent: 0 });
    const row = todayRow();
    expect(row, 'the run must leave an alert_log record for the user').toBeTruthy();
    expect(row!.error_message).not.toBe('no_new_or_active_opportunities');
    expect(row!.delivery_status).toBe('failed');
    expect(String(row!.error_message)).toMatch(/^open_search_failed:57014/);
    expect(SENT).toHaveLength(0); // no email that could state or imply a zero
  });

  it('the failed user stays eligible for a retry later the same day, and recovers when the search succeeds', async () => {
    await run();
    const readsAfterFirst = SAM_READS;
    SAM_MODE = 'rows';
    const second = await run();
    expect(second.message).not.toBe('All users already processed today');
    expect(SAM_READS).toBeGreaterThan(readsAfterFirst); // the search actually ran again
    expect(todayRow()!.delivery_status).toBe('sent');
    expect(SENT).toHaveLength(1);
    expect(SENT[0].html).toMatch(/Janitorial Services/);
  });

  it('same-day retries are bounded: after 3 failed attempts the user is not re-searched today', async () => {
    await run(); await run(); await run();
    expect(todayRow()!.retry_count).toBe(2); // attempts 1..3 → retry_count 0..2
    const reads = SAM_READS;
    const fourth = await run();
    expect(SAM_READS).toBe(reads);
    expect(fourth.message).toBe('All users already processed today');
    expect(todayRow()!.delivery_status).toBe('failed'); // still an honest failure, never re-labelled
  });

  it('a NON-FINAL failed attempt sends NO email even when other sections (grants) have content — no "Nothing new matched" claim', async () => {
    // Production shape: a keyword-only timeout user had alerts logged "sent" with 0 Open rows.
    // On main the grants section made the email sendable and the Open section rendered the
    // quiet-day line "Nothing new matched your filters today" — a zero nobody measured.
    GRANTS = [{
      oppNumber: 'G-1', title: 'Community Facilities Grant', agency: 'USDA', closeDate: future(20),
      awardCeiling: 50000, oppId: 'g1', link: 'https://grants.gov/g1',
    }];
    await run();
    expect(SENT.map((m) => m.html).join('\n')).not.toMatch(/Nothing new matched your filters today/);
    expect(SENT).toHaveLength(0);
    expect(todayRow()).toMatchObject({ delivery_status: 'failed' });
  });

  it('control: a SUCCESSFUL search with zero rows is still the honest "no opportunities" skip', async () => {
    SAM_MODE = 'empty';
    await run();
    expect(todayRow()).toMatchObject({ delivery_status: 'skipped', error_message: 'no_new_or_active_opportunities' });
    const again = await run();
    expect(again.message).toBe('All users already processed today'); // a real zero is final for the day
  });
});

const GRANT: Row = {
  oppNumber: 'G-1', title: 'Community Facilities Grant', agency: 'USDA', closeDate: future(20),
  awardCeiling: 50000, oppId: 'g1', link: 'https://grants.gov/g1',
};
const PARTIAL_LINE = 'Open opportunities could not be checked today.';

describe('daily-alerts cron — Open stays unavailable after the same-day budget: useful partial email, never a zero claim', () => {
  it('final attempt fails + grants exist → ONE email with the grants and the exact "could not be checked" line; logged as a partial send', async () => {
    GRANTS = [GRANT];
    await run(); await run();            // attempts 1, 2: failed, no email (retry-eligible)
    expect(SENT).toHaveLength(0);
    const third = await run();           // attempt 3 = final
    expect(SENT).toHaveLength(1);
    const html = SENT[0].html;
    expect(html).toContain(PARTIAL_LINE);
    expect(html).toContain('Community Facilities Grant');
    expect(html).not.toMatch(/Nothing new matched your filters today/);
    expect(html).not.toMatch(/\b0 new opportunit/);
    expect(SENT[0].subject).not.toMatch(/\b0 new|new opportunit/i);
    const row = todayRow()!;
    expect(row.delivery_status).toBe('sent');
    expect(String(row.error_message)).toMatch(/^open_unavailable_partial:57014/);
    expect(third.results).toMatchObject({ sent: 1, openUnavailablePartial: 1, noOpps: 0 });
  });

  it('final attempt fails + Coming Back has cards (NAICS profile) → partial email with Coming Back, no Open rows, no zero claim', async () => {
    // Coming Back is evaluated only for a NAICS/PSC market, so this case is a NAICS profile whose
    // Open search fails — keyword-only profiles can only ever be partial through grants.
    USER_OVERRIDES = { naics_codes: ['561720'] };
    COMING_BACK = {
      kind: 'show', matchedNaics: [], starterMarket: false,
      rows: [{
        contract_id: 'C-1', incumbent: 'Acme Custodial LLC', agency: 'GENERAL SERVICES ADMINISTRATION', naics: '561720', psc: 'S201',
        value: 1200000, valueKind: 'obligated', obligated: 1200000, popEnd: future(200).slice(0, 10), leadMonths: 7,
        window: 'lead_6_18', codeState: 'primary_confirmed', codeProvenance: 'test', censusTitle: 'Janitorial Services',
        fit: 'prime', nuclearMo: false, why: 'Same NAICS as your profile',
      }],
    };
    const r1 = await run(); const r2 = await run(); const r3 = await run();
    void r1; void r2; expect(r3.results).toMatchObject({ sent: 1, openUnavailablePartial: 1 });
    expect(SENT).toHaveLength(1);
    expect(SENT[0].html).toContain(PARTIAL_LINE);
    expect(SENT[0].html).not.toMatch(/Nothing new matched your filters today/);
    expect(SENT[0].html).toContain('Acme Custodial LLC');
    expect(todayRow()!.delivery_status).toBe('sent');
    expect(String(todayRow()!.error_message)).toMatch(/sections=coming_back/);
  });

  it('(a) after a partial send, later runs the same day send nothing and do not search again', async () => {
    GRANTS = [GRANT];
    await run(); await run(); await run();
    expect(SENT).toHaveLength(1);
    const reads = SAM_READS;
    const fourth = await run();
    const fifth = await run();
    expect(SENT).toHaveLength(1);
    expect(SAM_READS).toBe(reads);
    expect(fourth.message).toBe('All users already processed today');
    expect(fifth.message).toBe('All users already processed today');
  });

  it('final attempt fails + nothing useful → recorded failure, NO email (never an empty email), never "no opportunities"', async () => {
    await run(); await run(); await run();
    expect(SENT).toHaveLength(0);
    const row = todayRow()!;
    expect(row.delivery_status).toBe('failed');
    expect(String(row.error_message)).toMatch(/^open_search_failed:57014/);
    expect(row.retry_count).toBe(2);
  });

  it('(c) Open succeeds on attempt 2 → exactly one NORMAL email (with grants), no partial line, no duplicate', async () => {
    GRANTS = [GRANT];
    await run();                         // attempt 1 fails, no email
    SAM_MODE = 'rows';
    await run();                         // attempt 2 succeeds
    await run();                         // later run: already processed
    expect(SENT).toHaveLength(1);
    expect(SENT[0].html).toMatch(/Janitorial Services/);
    expect(SENT[0].html).not.toContain(PARTIAL_LINE);
    expect(todayRow()!.error_message ?? null).toBeNull();
  });
});
