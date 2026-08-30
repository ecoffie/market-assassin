/* eslint-disable @typescript-eslint/no-explicit-any -- vitest mocks + history fixtures */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Route-integration for GET /api/app/contractors/sales-history.
 *
 * Phase 1 contract: when `uei` is present, the shared UEI-history service is the
 * sole award-history authority. The legacy JSON path must not load. Name/slug
 * without UEI keeps the prior behavior.
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

/** Fixture UEIs from history-by-uei.unit.test.ts (no live DB). */
const NS_UEI = 'FCJCDUZV7RM3';
const TANAQ_SUPPORT = 'UM53UXL5QNF5';
const TANAQ_GLOBAL = 'WDMBF2J6EML3';
const UNKNOWN_UEI = 'ZZZZZZZZZZZZ';

const authOk = () => vi.mocked(requireMIAuthSession).mockReturnValue({ ok: true, session: {} } as any);
const authFail = () =>
  vi.mocked(requireMIAuthSession).mockReturnValue({
    ok: false,
    response: NextResponse.json({ success: false, error: 'Missing two-factor session' }, { status: 401 }),
  } as any);

function call(qs: string) {
  return GET(new NextRequest(`http://localhost/api/app/contractors/sales-history?${qs}`));
}

function sharedResult(
  partial: Partial<ContractorHistoryByUeiResult> & Pick<ContractorHistoryByUeiResult, 'resolution'>,
): ContractorHistoryByUeiResult {
  return {
    uei: partial.uei ?? '',
    resolution: partial.resolution,
    name: partial.name ?? null,
    history: partial.history ?? null,
    source: partial.source ?? null,
    asOf: partial.asOf ?? null,
    aggregates_cover: partial.aggregates_cover ?? null,
    degraded: partial.degraded ?? false,
    cache: partial.cache ?? 'none',
    detail: partial.detail,
  };
}

const sharedHistoryNotFound = sharedResult({ resolution: 'not_found', uei: UNKNOWN_UEI });

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
    expect(getContractorSalesHistory).not.toHaveBeenCalled();
    expect(getContractorHistoryByUei).not.toHaveBeenCalled();
    expect(getBqContractorHistory).not.toHaveBeenCalled();
  });

  it('proceeds past the gate when the session is valid (name-only)', async () => {
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

describe('sales-history — Phase 1 UEI path (JSON never consulted)', () => {
  it('never calls the JSON loader when a UEI is present', async () => {
    authOk();
    const sharedHistory = {
      series: [{ fiscalYear: 2024, totalObligations: 1_000_000 }],
      source: 'bigquery_normalized',
      summary: { awardCount: 3, totalObligations: 1_000_000 },
    };
    vi.mocked(getContractorHistoryByUei).mockResolvedValue(
      sharedResult({
        uei: NS_UEI,
        resolution: 'found',
        name: 'NORTH STAR GOVERNMENT SERVICES',
        history: sharedHistory as any,
        source: 'bigquery_normalized',
        asOf: '2026-01-01',
        aggregates_cover: 'bq_ingest',
        cache: 'warm',
      }),
    );

    const res = await call(`email=u@x.com&company=North+Star&uei=${NS_UEI}`);
    expect(res.status).toBe(200);
    expect(getContractorSalesHistory).not.toHaveBeenCalled();
    expect(getBqContractorHistory).not.toHaveBeenCalled();
    expect(getContractorHistoryByUei).toHaveBeenCalledWith({
      uei: NS_UEI,
      coldPolicy: 'always',
      actor: 'u@x.com',
    });
  });

  it('JSON conflicting series cannot override shared UEI history', async () => {
    authOk();
    const jsonConflict = {
      series: [{ fiscalYear: 1999, totalObligations: 99 }],
      source: 'contractor_database',
      summary: { awardCount: 1, totalObligations: 99 },
    };
    vi.mocked(getContractorSalesHistory).mockResolvedValue(jsonConflict as any);

    const sharedHistory = {
      series: [{ fiscalYear: 2024, totalObligations: 5_000_000 }],
      source: 'bigquery_normalized',
      summary: { awardCount: 12, totalObligations: 5_000_000 },
    };
    vi.mocked(getContractorHistoryByUei).mockResolvedValue(
      sharedResult({
        uei: NS_UEI,
        resolution: 'found',
        name: 'NORTH STAR GOVERNMENT SERVICES',
        history: sharedHistory as any,
        source: 'bigquery_normalized',
        cache: 'warm',
        aggregates_cover: 'bq_ingest',
      }),
    );

    const res = await call(`email=u@x.com&company=Fake+Json+Name&uei=${NS_UEI}`);
    expect(res.status).toBe(200);
    expect(getContractorSalesHistory).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual(sharedHistory);
  });

  it("North Star's UEI resolves through the shared service despite JSON absence", async () => {
    authOk();
    vi.mocked(getContractorSalesHistory).mockResolvedValue(null as any);
    const sharedHistory = {
      series: [{ fiscalYear: 2025, totalObligations: 2_000_000 }],
      source: 'bigquery_normalized',
      contractor: { company: 'NORTH STAR GOVERNMENT SERVICES' },
      summary: { awardCount: 8, totalObligations: 2_000_000 },
    };
    vi.mocked(getContractorHistoryByUei).mockResolvedValue(
      sharedResult({
        uei: NS_UEI,
        resolution: 'found',
        name: 'NORTH STAR GOVERNMENT SERVICES',
        history: sharedHistory as any,
        source: 'bigquery_normalized',
        cache: 'cold_bq',
        aggregates_cover: 'bq_ingest',
      }),
    );

    const res = await call(`email=u@x.com&company=North+Star+Government+Services&uei=${NS_UEI}`);
    expect(res.status).toBe(200);
    expect(getContractorSalesHistory).not.toHaveBeenCalled();
    expect(getContractorHistoryByUei).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual(sharedHistory);
  });

  it('Tanaq Support resolves through the shared service despite JSON absence', async () => {
    authOk();
    vi.mocked(getContractorSalesHistory).mockResolvedValue(null as any);
    const sharedHistory = {
      series: [{ fiscalYear: 2023, totalObligations: 750_000 }],
      source: 'bigquery_normalized',
      contractor: { company: 'TANAQ SUPPORT SERVICES' },
      summary: { awardCount: 4, totalObligations: 750_000 },
    };
    vi.mocked(getContractorHistoryByUei).mockResolvedValue(
      sharedResult({
        uei: TANAQ_SUPPORT,
        resolution: 'found',
        name: 'TANAQ SUPPORT SERVICES',
        history: sharedHistory as any,
        source: 'bigquery_normalized',
        cache: 'warm',
        aggregates_cover: 'bq_ingest',
      }),
    );

    const res = await call(`email=u@x.com&company=Tanaq+Support&uei=${TANAQ_SUPPORT}`);
    expect(res.status).toBe(200);
    expect(getContractorSalesHistory).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual(sharedHistory);
  });

  it('Tanaq Global returns registered-zero history rather than false 404', async () => {
    authOk();
    const zeroHistory = {
      success: true,
      source: 'local_registry',
      coverage: 'none',
      series: [],
      summary: { awardCount: 0, totalObligations: 0 },
      contractor: { company: 'TANAQ GLOBAL LLC', contractCount: 0 },
      message: 'Registered entity with no awards in the BigQuery warehouse ingest.',
    };
    vi.mocked(getContractorHistoryByUei).mockResolvedValue(
      sharedResult({
        uei: TANAQ_GLOBAL,
        resolution: 'registered_zero',
        name: 'TANAQ GLOBAL LLC',
        history: zeroHistory as any,
        source: 'local_registry',
        cache: 'registry',
        aggregates_cover: 'bq_ingest',
      }),
    );

    const res = await call(`email=u@x.com&company=Tanaq+Global&uei=${TANAQ_GLOBAL}`);
    expect(res.status).toBe(200);
    expect(getContractorSalesHistory).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.source).toBe('local_registry');
    expect(body.summary.awardCount).toBe(0);
  });

  it('malformed UEI preserves validation failure (400), not not-found', async () => {
    authOk();
    vi.mocked(getContractorHistoryByUei).mockResolvedValue(
      sharedResult({
        uei: 'SHORT',
        resolution: 'malformed',
        detail: 'UEI must be exactly 12 alphanumeric characters',
      }),
    );

    const res = await call('email=u@x.com&company=ACME&uei=SHORT');
    expect(res.status).toBe(400);
    expect(getContractorSalesHistory).not.toHaveBeenCalled();
    expect(getBqContractorHistory).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/UEI|12 alphanumeric/i);
  });

  it('valid unknown UEI preserves not-found (404)', async () => {
    authOk();
    vi.mocked(getContractorHistoryByUei).mockResolvedValue(
      sharedResult({
        uei: UNKNOWN_UEI,
        resolution: 'not_found',
        detail: 'No BigQuery award profile and no local SAM registry row',
      }),
    );

    const res = await call(`email=u@x.com&company=Nobody&uei=${UNKNOWN_UEI}`);
    expect(res.status).toBe(404);
    expect(getContractorSalesHistory).not.toHaveBeenCalled();
    expect(getContractorHistoryByUei).toHaveBeenCalledWith({
      uei: UNKNOWN_UEI,
      coldPolicy: 'always',
      actor: 'u@x.com',
    });
  });

  it('shared-service unavailable does not become confirmed zero or not-found', async () => {
    authOk();
    vi.mocked(getContractorHistoryByUei).mockResolvedValue(
      sharedResult({
        uei: NS_UEI,
        resolution: 'unavailable',
        degraded: true,
        detail: 'BigQuery query failed and no warm history was available',
      }),
    );

    const res = await call(`email=u@x.com&company=North+Star&uei=${NS_UEI}`);
    expect(res.status).toBe(503);
    expect(getContractorSalesHistory).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.success).toBe(false);
    expect(res.status).not.toBe(404);
    expect(body.summary?.awardCount).not.toBe(0);
  });

  it('does not invoke live USASpending or nested MCP (only shared UEI + auth mocks)', async () => {
    authOk();
    vi.mocked(getContractorHistoryByUei).mockResolvedValue(
      sharedResult({
        uei: NS_UEI,
        resolution: 'found',
        history: { series: [{ fiscalYear: 2024 }], source: 'bigquery_normalized' } as any,
        source: 'bigquery_normalized',
        cache: 'warm',
        aggregates_cover: 'bq_ingest',
      }),
    );

    await call(`email=u@x.com&company=North+Star&uei=${NS_UEI}`);
    expect(getContractorHistoryByUei).toHaveBeenCalledTimes(1);
    expect(getContractorSalesHistory).not.toHaveBeenCalled();
    expect(getBqContractorHistory).not.toHaveBeenCalled();
    // Route module graph under test only wires the four mocked deps above.
  });
});

describe('sales-history — name/slug path unchanged (no UEI)', () => {
  it('name-only still uses the legacy JSON sales-history path', async () => {
    authOk();
    const legacy = { series: [{ fiscalYear: 2025 }], source: 'contractor_database' };
    vi.mocked(getContractorSalesHistory).mockResolvedValue(legacy as any);

    const res = await call('email=u@x.com&company=ACME');
    expect(res.status).toBe(200);
    expect(getContractorSalesHistory).toHaveBeenCalledWith({
      company: 'ACME',
      publicView: false,
      awardLimit: 50,
    });
    expect(getContractorHistoryByUei).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual(legacy);
  });

  it('slug fallback still uses getBqContractorHistory when legacy has no series', async () => {
    authOk();
    vi.mocked(getContractorSalesHistory).mockResolvedValue({ summary: true, series: [] } as any);
    const bq = { series: [{ fiscalYear: 2024 }], source: 'bigquery_normalized' };
    vi.mocked(getBqContractorHistory).mockResolvedValue(bq as any);

    const res = await call('email=u@x.com&company=ACME&slug=acme-inc');
    expect(res.status).toBe(200);
    expect(getContractorHistoryByUei).not.toHaveBeenCalled();
    expect(getBqContractorHistory).toHaveBeenCalledWith({ slug: 'acme-inc', liveBq: true });
    await expect(res.json()).resolves.toEqual(bq);
  });

  it('404s when name-only has no legacy and no slug hit', async () => {
    authOk();
    const res = await call('email=u@x.com&company=NOBODY');
    expect(res.status).toBe(404);
    expect(getContractorSalesHistory).toHaveBeenCalled();
    expect(getContractorHistoryByUei).not.toHaveBeenCalled();
  });
});
