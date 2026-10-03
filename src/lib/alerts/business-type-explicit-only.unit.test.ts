/**
 * INVARIANT: only an explicitly user-selected business type may overwrite the
 * stored business type. More generally: a partial update changes only explicitly
 * submitted fields.
 *
 * Three callers sent a DEFAULTED 'Small Business' into POST /api/alerts/save-profile,
 * which upserted the whole targeting row (business_type, agencies, locations, NAICS):
 *   1. generate-all (Market Research reports) → saveAlertProfile
 *   2. Opportunity Hunter (email gate + every later search)
 *   3. /app/onboarding (auto + manual completion, via /api/app/profile)
 * The route test drives the REAL save-profile handler against an in-memory table.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { buildSaveProfileTargetingPatch, explicitBusinessTypeField } from './save-profile-patch';
import { buildReportAlertProfileBody } from './report-alert-profile-body';

type Row = Record<string, unknown>;
const db: { settings: Row | null; writes: Array<{ op: string; payload: Row }> } = { settings: null, writes: [] };

function builder(table: string) {
  const state: { op: 'select' | 'update' | 'upsert' | 'insert'; payload?: Row } = { op: 'select' };
  const result = () => {
    if (table !== 'user_notification_settings') return { data: null, error: null };
    if (state.op === 'update' || state.op === 'upsert' || state.op === 'insert') {
      db.writes.push({ op: state.op, payload: state.payload! });
      db.settings = { ...(db.settings ?? {}), ...state.payload };
    }
    return { data: db.settings, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    update: (p: Row) => { state.op = 'update'; state.payload = p; return b; },
    upsert: (p: Row) => { state.op = 'upsert'; state.payload = p; return b; },
    insert: (p: Row) => { state.op = 'insert'; state.payload = p; return b; },
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject),
  };
  return b;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => builder(table) }),
}));
vi.mock('@/lib/api-auth', () => ({
  verifyUserOwnsEmail: async (_req: unknown, email: string) => ({ authenticated: true, email }),
}));
vi.mock('@/lib/signup-events', () => ({
  logSignupEvent: async () => {},
  logSignupCompleted: async () => {},
  logSignupFailed: async () => {},
  SignupEventType: { SIGNUP_STARTED: 'signup_started' },
  SignupStep: { EMAIL: 'email', DELIVERY: 'delivery' },
  extractIpAddress: () => null,
  extractUserAgent: () => null,
}));
vi.mock('@/lib/send-email', () => ({ sendEmail: async () => true }));
vi.mock('@/lib/briefings/pipelines/sam-gov', () => ({
  fetchSamOpportunitiesFromCache: async () => ({ opportunities: [] }),
}));
vi.mock('@/lib/briefings/access', () => ({ grantBriefingsAccess: async () => {} }));
vi.mock('@/lib/mindy/apply-partner-referral', () => ({
  partnerReferralSourceLabel: () => null,
}));

const EMAIL = 'certified@example.com';
const STORED: Row = {
  user_email: EMAIL,
  business_type: 'SDVOSB',
  agencies: ['Department of Veterans Affairs'],
  location_state: 'VA',
  location_states: ['VA', 'MD'],
  location_zip: '22201',
  naics_codes: ['238220', '541330'],
  alerts_enabled: true,
  alert_frequency: 'daily',
  is_active: true,
  briefings_enabled: false,
};

async function post(body: Row) {
  const { POST } = await import('@/app/api/alerts/save-profile/route');
  const req = new NextRequest('http://localhost/api/alerts/save-profile', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, ...body }),
    // A verified owner (the auth mock accepts it). Since the save-profile security fix, an
    // ANONYMOUS request may only create a new row — these cases update an existing one.
    headers: { 'content-type': 'application/json', 'x-mi-auth-token': 'verified-owner' },
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
}

beforeEach(() => {
  db.settings = { ...STORED };
  db.writes = [];
});

describe('POST /api/alerts/save-profile — omitted fields are untouched on an existing row', () => {
  it('Opportunity Hunter search with no type picked keeps SDVOSB, agencies and locations', async () => {
    await post({ naicsCodes: ['238220'], source: 'opportunity-hunter-free' });
    expect(db.settings?.business_type).toBe('SDVOSB');
    expect(db.settings?.agencies).toEqual(['Department of Veterans Affairs']);
    expect(db.settings?.location_states).toEqual(['VA', 'MD']);
    expect(db.settings?.location_state).toBe('VA');
    expect(db.settings?.location_zip).toBe('22201');
  });

  it('a null / blank business type is not a clear', async () => {
    await post({ naicsCodes: ['238220'], businessType: null, source: 'free-signup' });
    expect(db.settings?.business_type).toBe('SDVOSB');
    await post({ naicsCodes: ['238220'], businessType: '   ', source: 'free-signup' });
    expect(db.settings?.business_type).toBe('SDVOSB');
  });

  it('naicsCodes: [] (briefings / market-intelligence signup) does not wipe stored NAICS', async () => {
    // (was source 'paid_existing', which now requires a bound invitation; /briefings sends free_signup)
    await post({ naicsCodes: [], source: 'free_signup' });
    expect(db.settings?.naics_codes).toEqual(['238220', '541330']);
  });

  it('the generate-all body leaves business type, agencies and zip untouched', async () => {
    await post({ ...buildReportAlertProfileBody(EMAIL, { naicsCode: '541512', pscCode: '' }), source: 'free-signup' });
    expect(db.settings?.business_type).toBe('SDVOSB');
    expect(db.settings?.agencies).toEqual(['Department of Veterans Affairs']);
    expect(db.settings?.location_zip).toBe('22201');
    expect(db.settings?.naics_codes).toEqual(['541512']);
  });

  it('an explicitly selected business type IS written', async () => {
    await post({ naicsCodes: ['238220'], businessType: '8(a)', source: 'free-signup' });
    expect(db.settings?.business_type).toBe('8(a)');
  });

  it('an existing row is UPDATED (not upserted with a full default tuple)', async () => {
    await post({ naicsCodes: ['238220'], source: 'opportunity-hunter-free' });
    const w = db.writes.at(-1)!;
    expect(w.op).toBe('update');
    for (const key of ['business_type', 'agencies', 'location_state', 'location_states', 'location_zip']) {
      expect(key in w.payload).toBe(false);
    }
  });

  it('a genuinely new user still gets the defaults (null / [])', async () => {
    db.settings = null;
    await post({ naicsCodes: ['238220'], source: 'opportunity-hunter-free' });
    const w = db.writes.at(-1)!;
    expect(w.op).toBe('upsert');
    expect(w.payload).toMatchObject({ business_type: null, agencies: [], location_states: [], location_state: null, location_zip: null });
  });
});

describe('buildSaveProfileTargetingPatch', () => {
  it('existing row + nothing submitted → empty patch', () => {
    expect(buildSaveProfileTargetingPatch({ rowExists: true, expandedNaics: [] })).toEqual({});
  });
  it('existing row + NAICS → NAICS and a stale embedding stamp only', () => {
    expect(buildSaveProfileTargetingPatch({ rowExists: true, expandedNaics: ['541512'], targetAgencies: [] }))
      .toEqual({ naics_codes: ['541512'], capability_embedded_at: null });
  });
});

describe('client payloads never carry a defaulted business type', () => {
  it('explicitBusinessTypeField omits blank / missing values', () => {
    expect(explicitBusinessTypeField('')).toEqual({});
    expect(explicitBusinessTypeField(undefined)).toEqual({});
    expect(explicitBusinessTypeField(null)).toEqual({});
    expect(explicitBusinessTypeField(' women-owned ')).toEqual({ businessType: 'women-owned' });
  });

  it('generate-all forwards only what was researched', () => {
    const body = buildReportAlertProfileBody(EMAIL, { naicsCode: '236, 238320', pscCode: 'Z1DA' });
    expect(body).toEqual({ email: EMAIL, naicsCodes: ['236', '238320'], pscCode: 'Z1DA' });
  });

  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('generate-all builds the save-profile body with the builder', () => {
    const src = read('src/app/api/reports/generate-all/route.ts');
    expect(src).toContain('buildReportAlertProfileBody(email, inputs)');
    expect(src).not.toMatch(/businessType:\s*inputs\.businessType\s*\|\|\s*null/);
  });

  it('Opportunity Hunter never defaults businessFormation to Small Business', () => {
    const src = read('src/app/opportunity-hunter/page.tsx');
    expect(src).not.toMatch(/businessFormation\s*\|\|\s*'Small Business'/);
    expect((src.match(/explicitBusinessTypeField\(/g) || []).length).toBe(2);
  });

  it('onboarding never defaults or clears business type', () => {
    const src = read('src/app/app/onboarding/page.tsx');
    expect(src).not.toMatch(/setAsides\?\.\[0\]\s*\|\|\s*'Small Business'/);
    expect(src).not.toMatch(/businessType:\s*selectedSetAsides\[0\]\s*\|\|\s*null/);
    expect((src.match(/explicitBusinessTypeField\(/g) || []).length).toBe(2);
  });
});
