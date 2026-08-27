import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Route-integration for GET /api/app/contractors/sales-history — the EXACT route
 * behind the "Contractors DB error on click" (memory: authed_fetch_401_class). It
 * enforces 2FA, validates params, and falls through to the shared UEI-history
 * service when static has no year series (the "BL Harbert shows no awards" fix).
 * All deps mocked → asserts the route's branching.
 */

vi.mock('@/lib/two-factor-session');
vi.mock('@/lib/contractor-sales-history');
vi.mock('@/lib/bigquery/recipients');
vi.mock('@/lib/contractor/history-by-uei');

import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getContractorSalesHistory } from '@/lib/contractor-sales-history';
import { getBqContractorHistory } from '@/lib/bigquery/recipients';
import {
  getContractorHistoryByUei,
  type ContractorHistoryByUeiResult,
} from '@/lib/contractor/history-by-uei';
import { GET } from '@/app/api/app/contractors/sales-history/route';

const authOk = () => vi.mocked(requireMIAuthSession).mockReturnValue({ ok: true, session: {} } as any);
const authFail = () =>
  vi.mocked(requireMIAuthSession).mockReturnValue({
    ok: false,
    response: NextResponse.json({ success: false, error: 'Missing two-factor session' }, { status: 401 }),
  } as any);

function call(qs: string) {
  return GET(new NextRequest(`http://localhost/api/app/contractors/sales-history?${qs}`));
}

const sharedHistoryNotFound: ContractorHistoryByUeiResult = {
  uei: '',
  resolution: 'not_found',
  name: null,
  history: null,
  source: null,
  asOf: null,
  aggregates_cover: null,
  degraded: false,
  cache: 'none',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getContractorSalesHistory).mockResolvedValue(null as any);
  vi.mocked(getBqContractorHistory).mockResolvedValue(null as any);
  vi.mocked(getContractorHistoryByUei).mockResolvedValue(sharedHistoryNotFound);
});

describe('sales-history — auth gate (the 2FA contract)', () => {
  it('401s when the MI session is missing/expired (before any data work)', async () => {
    authFail();
    const res = await call('email=u@x.com&company=ACME');
    expect(res.status).toBe(401);
    // must short-circuit — no data lib called
    expect(getContractorSalesHistory).not.toHaveBeenCalled();
    expect(getContractorHistoryByUei).not.toHaveBeenCalled();
    expect(getBqContractorHistory).not.toHaveBeenCalled();
  });

  it('proceeds past the gate when the session is valid', async () => {
    authOk();
    vi.mocked(getContractorSalesHistory).mockResolvedValue({ series: [{ fiscalYear: 2025 }] } as any);
    const res = await call('email=u@x.com&company=ACME');
    expect(res.status).toBe(200);
  });
});

describe('sales-history — param validation', () => {
  it('400s when company is missing (even with a valid session)', async () => {
    authOk();
    const res = await call('email=u@x.com');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/company/i);
  });
});

describe('sales-history — UEI shared-history fallback (the "shows no awards" fix)', () => {
  it('uses shared UEI history when static has NO year series and a uei is present', async () => {
    authOk();
    // static returns a summary row but no series → must try shared UEI service
    vi.mocked(getContractorSalesHistory).mockResolvedValue({ summary: true, series: [] } as any);
    const sharedHistory = {
      series: [{ fiscalYear: 2024, obligated: 1_000_000 }],
      source: 'bigquery_normalized',
    };
    vi.mocked(getContractorHistoryByUei).mockResolvedValue({
      uei: 'ABC123',
      resolution: 'found',
      name: 'BL HARBERT',
      history: sharedHistory,
      source: 'bigquery_normalized',
      asOf: '2026-01-01',
      aggregates_cover: 'bq_ingest',
      degraded: false,
      cache: 'warm',
    } as any);

    const res = await call('email=u@x.com&company=BL+HARBERT&uei=ABC123');
    expect(res.status).toBe(200);
    expect(getContractorHistoryByUei).toHaveBeenCalledWith({
      uei: 'ABC123',
      coldPolicy: 'always',
      actor: 'u@x.com',
    });
    // Route must serve the shared history payload — not call BQ (or static JSON) directly.
    expect(getBqContractorHistory).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual(sharedHistory);
  });

  it('does NOT hit shared UEI history when static already has a series (no wasted call)', async () => {
    authOk();
    vi.mocked(getContractorSalesHistory).mockResolvedValue({ series: [{ fiscalYear: 2025 }] } as any);
    await call('email=u@x.com&company=ACME&uei=ABC123');
    expect(getContractorHistoryByUei).not.toHaveBeenCalled();
    expect(getBqContractorHistory).not.toHaveBeenCalled();
  });

  it('404s when neither static nor shared UEI history has the contractor', async () => {
    authOk();
    const res = await call('email=u@x.com&company=NOBODY&uei=ZZZ');
    expect(res.status).toBe(404);
    expect(getContractorHistoryByUei).toHaveBeenCalledWith({
      uei: 'ZZZ',
      coldPolicy: 'always',
      actor: 'u@x.com',
    });
    expect(getBqContractorHistory).not.toHaveBeenCalled();
  });
});
