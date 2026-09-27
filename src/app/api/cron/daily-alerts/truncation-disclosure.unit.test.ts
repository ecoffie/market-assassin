import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE REAL CRON HANDLER, the mail sender intercepted.
 *
 * POST /api/cron/daily-alerts (CRON_SECRET, testEmail, skipTimezoneCheck, forceResend) runs
 * the real runDailyAlertJob → real fetchSamOpportunitiesFromCache → real ranking → real
 * sendDailyAlertEmail. Only the EDGES are replaced:
 *   - Supabase (both the route's client and the SAM read client) → one in-memory fake
 *     whose sam_opportunities market is larger than MAX_PREFER_SCAN_ROWS;
 *   - sendEmail → captures the outgoing message (no email is sent);
 *   - grants.gov, Today's Lens, Coming Back, retries, telemetry → inert stubs.
 *
 * The market's ONLY keyword match sits past the 4,000-row scan bound. The captured email
 * must disclose incomplete coverage and must NOT claim there were no keyword matches.
 */

const USER = 'truncation-test@example.com';
const SCAN_BOUND = 4000;
const MARKET_SIZE = SCAN_BOUND + 500;
const ONLY_MATCH_AT = SCAN_BOUND + 10;

type Row = Record<string, unknown>;
const future = (d: number) => new Date(Date.now() + d * 864e5).toISOString();
function baseRow(i: number): Row {
  return {
    notice_id: `n${String(i).padStart(5, '0')}`,
    title: `Routine IT support ${i}`,
    description: '',
    solicitation_number: `SOL-${i}`,
    naics_code: '541511',
    psc_code: 'DA01',
    department: 'GENERAL SERVICES ADMINISTRATION',
    sub_tier: 'FEDERAL ACQUISITION SERVICE',
    office: '',
    posted_date: future(-3),
    response_deadline: future(2 + i / 100), // ascending: row order == deadline order
    archive_date: null,
    set_aside_code: null,
    set_aside_description: null,
    notice_type: 'Solicitation',
    active: true,
    ui_link: null,
    last_modified: future(-3),
  };
}
/** A market of `size` rows; `titleAt` get a title keyword hit, `bodyAt` a description hit. */
function buildMarket(size: number, titleAt: number[] = [], bodyAt: (i: number) => boolean = () => false): Row[] {
  return Array.from({ length: size }, (_, i) => ({
    ...baseRow(i),
    ...(titleAt.includes(i) ? { title: 'Enterprise Artificial Intelligence Support Services' } : {}),
    ...(bodyAt(i) ? { description: 'Tasks include artificial intelligence pilots for field offices.' } : {}),
  }));
}
let MARKET: Row[] = buildMarket(MARKET_SIZE, [ONLY_MATCH_AT]);

const USER_ROW: Row = {
  id: 'u1', user_email: USER, naics_codes: ['541511'], keywords: ['artificial intelligence'], agencies: [],
  business_type: null, alerts_enabled: true, alert_frequency: 'daily', is_active: true, timezone: 'America/New_York',
  aggregated_profile: {}, naics_source: 'user_confirmed', psc_codes: [], location_states: [], set_aside_preferences: [],
  total_alerts_sent: 0,
};

const WRITES: Array<{ table: string; op: string }> = [];
const ALERT_LOG: Row[] = []; // the route re-reads its own alert_log write to verify it

function fakeClient() {
  return {
    from(table: string) {
      let from = 0;
      let to = Number.POSITIVE_INFINITY;
      let head = false;
      let write: string | null = null;
      let payload: unknown = null;
      const data = () => {
        if (table === 'sam_opportunities') return MARKET.slice(from, to + 1);
        if (table === 'user_notification_settings') return from === 0 ? [USER_ROW] : [];
        if (table === 'alert_log') return ALERT_LOG;
        return [];
      };
      const result = () => {
        if (write) {
          WRITES.push({ table, op: write });
          const rows = (Array.isArray(payload) ? payload : [payload]) as Row[];
          if (table === 'alert_log' && write !== 'delete') ALERT_LOG.push(...rows.filter(Boolean));
          return { data: rows, error: null, count: rows.length };
        }
        const d = data();
        return { data: head ? null : d, error: null, count: table === 'sam_opportunities' ? MARKET.length : d.length };
      };
      const b: Record<string, unknown> = {};
      const self = () => b;
      for (const m of ['eq', 'neq', 'or', 'gte', 'lte', 'gt', 'lt', 'in', 'is', 'not', 'like', 'ilike', 'order', 'contains', 'overlaps', 'filter', 'match', 'textSearch']) b[m] = self;
      b.select = (_c?: string, opts?: { head?: boolean }) => { if (opts?.head) head = true; return b; };
      b.limit = (n: number) => { to = Math.min(to, from + n - 1); return b; };
      b.range = (a: number, z: number) => { from = a; to = z; return b; };
      for (const op of ['insert', 'update', 'upsert', 'delete']) b[op] = (p?: unknown) => { write = op; payload = p ?? null; return b; };
      b.maybeSingle = async () => { const r = result(); return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }; };
      b.single = b.maybeSingle;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
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
  const noop = () => new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : async () => undefined) });
  class IntelligenceMetrics { constructor() { return new Proxy(this, { get: (_t, p) => (p === 'getSnapshot' ? () => ({}) : () => undefined) }); } }
  class GuardrailMonitor { constructor() { return new Proxy(this, { get: (_t, p) => (p === 'check' ? () => ({ continue: true }) : p === 'getStats' ? () => ({}) : async () => undefined) }); } }
  class CircuitBreaker { async isOpen() { return false; } async record() { return undefined; } }
  return { IntelligenceMetrics, GuardrailMonitor, CircuitBreaker, logIntelligenceDelivery: async () => undefined, postSendValidation: async () => ({ ok: true }), noop };
});
vi.mock('@/lib/briefings/pipelines/grants-gov', async (orig) => ({
  ...(await orig<typeof import('@/lib/briefings/pipelines/grants-gov')>()),
  searchGrantsByNAICS: async () => ({ grants: [], totalRecords: 0 }),
}));
vi.mock('@/lib/dashboard/todays-lens', () => ({ computeTodaysLens: async () => null }));
vi.mock('@/lib/alerts/coming-back-to-market', async (orig) => ({
  ...(await orig<typeof import('@/lib/alerts/coming-back-to-market')>()),
  loadComingBackSection: async () => ({ kind: 'omit', reason: 'none_qualify' }),
}));
// The retry LOOP is covered by retry-failed-daily.unit.test.ts. Here, when a test queues a
// stored failed alert, the stub hands it to the ROUTE's own `send` mapping — the code under test.
const RETRY_QUEUE: Array<{ alert: Row; user: Row }> = [];
vi.mock('@/lib/alerts/retry-failed-daily', () => ({
  retryFailedDailyAlerts: async (deps: { send: (alert: Row, user: Row) => Promise<unknown> }) => {
    let succeeded = 0;
    for (const { alert, user } of RETRY_QUEUE.splice(0)) { if (await deps.send(alert, user)) succeeded++; }
    return { retried: succeeded, succeeded, skipped: 0, skipReasons: {} };
  },
}));
vi.mock('@/lib/market/vault-eligibility', () => ({ loadVaultEligibility: async () => new Map() }));
vi.mock('@/lib/tool-errors', async (orig) => ({ ...(await orig<typeof import('@/lib/tool-errors')>()), logToolError: async () => undefined }));
vi.mock('@/lib/engagement', async (orig) => ({
  ...(await orig<typeof import('@/lib/engagement')>()),
  createEmailTrackingToken: async () => ({ success: true, token: 'tok' }),
}));

let POST: typeof import('./route').POST;
let GET: typeof import('./route').GET;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.ADMIN_PASSWORD = 'admin-test-password'; // read at module load by the route's fixture path
  process.env.EMAIL_ACTION_SECRET = 'test-email-action-secret'; // real link signer runs; value is test-only
  delete process.env.ENABLE_HIDDEN_MATCH;
  delete process.env.ENABLE_DAILY_ALERT_AI_TIPS;
  delete process.env.ENABLE_MINDY_INSIGHTS;
  ({ POST, GET } = await import('./route'));
  const { MAX_PREFER_SCAN_ROWS } = await import('@/lib/briefings/pipelines/sam-gov');
  expect(MAX_PREFER_SCAN_ROWS).toBe(SCAN_BOUND); // the fixture is built around the real bound
});

beforeEach(() => { SENT.length = 0; WRITES.length = 0; ALERT_LOG.length = 0; RETRY_QUEUE.length = 0; MARKET = buildMarket(MARKET_SIZE, [ONLY_MATCH_AT]); });

const textOf = (html: string) => html
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&mdash;/g, '—').replace(/&middot;/g, '·').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ')
  .replace(/\s+/g, ' ');

describe('daily-alerts cron — a truncated keyword scan is disclosed in the email itself', () => {
  it('only match beyond row 4,000: the sent email says coverage was incomplete and never claims "no keyword matches"', async () => {
    const res = await POST(new NextRequest('http://x/api/cron/daily-alerts', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ testEmail: USER, skipTimezoneCheck: true, forceResend: true }),
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results).toMatchObject({ sent: 1, failed: 0 });
    expect(SENT).toHaveLength(1);
    const { html, to } = SENT[0];
    const text = textOf(html);
    expect(to).toBe(USER);

    // The premise: the match past the bound is not in the email.
    expect(html).not.toMatch(/Enterprise Artificial Intelligence Support Services/);

    // The disclosure is present — as HTML and as read text.
    expect(text).toMatch(/Your market is larger than Mindy checked today: it looked at the first 4,000 open notices \(soonest deadlines first\) and found no keyword match among them\./);
    expect(text).toMatch(/Matches may exist further out — this is not a finding that none exist\./);

    // No market-level "no matches" claim anywhere.
    expect(text).not.toMatch(/No keyword hits in your market/i);
    expect(text).not.toMatch(/no (keyword )?match(es)? (were )?found/i);
    expect(text).not.toMatch(/nothing (new )?matched/i);

    // Rows that ARE shown are labelled as market rows, never as keyword matches.
    expect(text).not.toMatch(/Keyword “artificial intelligence”/);
    expect(text).toMatch(/No keyword match — in your NAICS market/);
  });
});

async function runCron(): Promise<{ html: string; text: string; body: { results: Record<string, unknown> } }> {
  const res = await POST(new NextRequest('http://x/api/cron/daily-alerts', {
    method: 'POST',
    headers: { authorization: 'Bearer cron-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ testEmail: USER, skipTimezoneCheck: true, forceResend: true }),
  }));
  expect(res.status).toBe(200);
  const body = await res.json();
  const mine = SENT.filter((m) => m.to === USER);
  expect(mine.length).toBeGreaterThan(0);
  const html = mine[mine.length - 1].html;
  return { html, text: textOf(html), body };
}

describe('daily-alerts cron — scan-bound edges', () => {
  it('EXACTLY 4,000 rows with the match at row 3,990: shown as a keyword match; NO truncation disclosure', async () => {
    MARKET = buildMarket(SCAN_BOUND, [3990]);
    const { text, body } = await runCron();
    expect(body.results).toMatchObject({ sent: 1, failed: 0 });
    expect(text).toMatch(/Enterprise Artificial Intelligence Support Services/);
    expect(text).toMatch(/Keyword “artificial intelligence” in title/);
    expect(text).not.toMatch(/Your market is larger than Mindy checked/);
  });

  it('EXACTLY 4,000 rows and no match anywhere: the complete scan may say "no keyword hits" (it is true)', async () => {
    MARKET = buildMarket(SCAN_BOUND);
    const { text } = await runCron();
    expect(text).toMatch(/No keyword hits in your market\./);
    expect(text).not.toMatch(/Your market is larger than Mindy checked/);
  });

  it('MORE than 4,000 rows (4,001) and no match in the first 4,000: incomplete coverage is disclosed', async () => {
    MARKET = buildMarket(SCAN_BOUND + 1, [SCAN_BOUND]);
    const { text } = await runCron();
    expect(text).toMatch(/looked at the first 4,000 open notices/);
    expect(text).toMatch(/not a finding that none exist/);
    expect(text).not.toMatch(/No keyword hits in your market/);
  });
});

describe('daily-alerts cron — more than 200 keyword matches: ranking happens before the final cut', () => {
  it('the only TITLE match, 250th by deadline among 300 matches, leads the email', async () => {
    // 300 description-only matches (rows 0..299); the one title match is row 249.
    MARKET = buildMarket(1200, [249], (i) => i < 300);
    const { html, text, body } = await runCron();
    expect(body.results).toMatchObject({ sent: 1, failed: 0 });
    expect(text).toMatch(/Enterprise Artificial Intelligence Support Services/);
    // First opportunity card in the email is the title match.
    const firstCard = html.indexOf('Enterprise Artificial Intelligence Support Services');
    const firstRoutine = html.search(/Routine IT support \d+/);
    expect(firstCard).toBeGreaterThan(-1);
    expect(firstCard).toBeLessThan(firstRoutine);
    expect(text).toMatch(/Keyword “artificial intelligence” in title/);
  });
});

describe('daily-alerts — fixture and retry emails carry the evidence and stage', () => {
  it('admin fixture send renders a reason line and a stage label on every card', async () => {
    const res = await GET(new NextRequest(`http://x/api/cron/daily-alerts?password=admin-test-password&fixture=true&email=${encodeURIComponent(USER)}`));
    expect(res.status).toBe(200);
    const text = textOf(SENT[SENT.length - 1].html);
    expect(text).toMatch(/Bid · Solicitation/);
    // The fixture's sample rows are outside the fixture profile's market, so a reason line
    // appears but claims NO market (claiming "PSC market" here was the bug this caught).
    expect(text).toMatch(/No keyword match/);
    expect(text).not.toMatch(/in your (PSC|NAICS) market/);
  });

  it('a retried failed alert renders the STORED evidence, stage and fields', async () => {
    RETRY_QUEUE.push({
      user: USER_ROW,
      alert: {
        id: 'failed-1', user_email: USER, retry_count: 0,
        opportunities_data: [{
          noticeId: 'r1', title: 'Records Management Modernization', agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
          naics: '541511', deadline: future(9), postedDate: future(-2), noticeType: 'Special Notice', setAside: null,
          evidence: {
            naics: 'exact', keywords: { title: ['records management'], body: [], weak: [] }, agencies: [],
            basis: 'keyword', stage: { label: 'Special Notice', respondability: 'none' },
          },
        }],
      },
    });
    await runCron();
    const retry = textOf(SENT[0].html); // the retry is sent before the day's run
    expect(retry).toMatch(/Records Management Modernization/);
    expect(retry).toMatch(/Keyword “records management” in title/);
    expect(retry).toMatch(/Heads-up only, nothing to submit · Special Notice/);
    expect(retry).toMatch(/VETERANS AFFAIRS/); // department mapped back from the stored `agency`
  });
});
