import { describe, it, expect } from 'vitest';
import {
  gatewayCsvPlanIsSemanticallySane,
  gatewayCsvPlanReconciles,
  listingIdFromGatewayExternalId,
  parseGatewayCsvRecordsForAgency,
  planGatewayCsvReconciliation,
} from './gateway-csv-reconcile';
import { gatewayExternalId, parseGatewayRow } from './gateway-forecast';
import { planFromRecords } from './gateway-csv-ingest';

/** Minimal Gateway-shaped record with critical headers. */
function rec(partial: Record<string, string>): Record<string, string> {
  return {
    'Listing ID': 'FY27_000158',
    Title: 'Trail maintenance services',
    Description: 'Maintain trails on public lands',
    'Funding Department / Ind. Agency': 'Department of the Interior',
    'Funding Organization': 'National Park Service',
    'Funding Office': 'Intermountain Region',
    'NAICS Code': '561730',
    'Point of Contact (Email)': 'poc@example.gov',
    ChangedDate: '2026-10-01',
    'Solicitation Link': 'https://example.gov/forecast/1',
    'Place of Performance State': 'CO',
    'Estimated Contract Value': '$100,000 - $250,000',
    'Estimated Award FY Qtr': 'FY 2027 Q2',
    ...partial,
  };
}

describe('gateway CSV identity', () => {
  it('stamps GW-L: with underscore normalized to hyphen', () => {
    const parsed = parseGatewayRow(rec({}));
    expect(parsed).not.toBeNull();
    expect(gatewayExternalId(parsed!)).toBe('GW-L:FY27-000158');
  });

  it('listingIdFromGatewayExternalId strips the prefix', () => {
    expect(listingIdFromGatewayExternalId('GW-L:FY27-000158')).toBe('FY27-000158');
  });
});

describe('planGatewayCsvReconciliation', () => {
  it('plans insert for a new GW-L id', () => {
    const { plan } = planFromRecords('DOI', [rec({})], new Map());
    expect(gatewayCsvPlanReconciles(plan).ok).toBe(true);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toInsert[0].external_id).toBe('GW-L:FY27-000158');
    expect(plan.toInsert[0].source_agency).toBe('DOI');
    expect(plan.matchedExisting).toBe(0);
  });

  it('plans update when a source-owned field changes', () => {
    const held = new Map([
      [
        'GW-L:FY27-000158',
        {
          title: 'OLD TITLE',
          naics_code: '561730',
          poc_email: 'poc@example.gov',
        },
      ],
    ]);
    const { plan } = planFromRecords('DOI', [rec({ Title: 'NEW TITLE' })], held);
    expect(gatewayCsvPlanReconciles(plan).ok).toBe(true);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].changedFields).toContain('title');
    expect(plan.toInsert).toHaveLength(0);
  });

  it('counts unchanged when fields match', () => {
    const row = parseGatewayCsvRecordsForAgency([rec({})], 'DOI').upstream[0]!;
    expect(row).not.toBeNull();
    const heldFields = Object.fromEntries(
      Object.entries(row!).filter(([k]) => k !== 'external_id' && k !== 'source_agency' && k !== 'raw' && k !== 'source_changed_at'),
    );
    const held = new Map([[row!.external_id, heldFields]]);
    const plan = planGatewayCsvReconciliation({
      agency: 'DOI',
      upstream: [row],
      heldCsv: held,
    });
    expect(gatewayCsvPlanReconciles(plan).ok).toBe(true);
    expect(plan.unchanged).toBe(1);
    expect(plan.toUpdate).toHaveLength(0);
  });

  it('reports absent_upstream without deleting', () => {
    const held = new Map([
      ['GW-L:OLD-1', { title: 'Gone' }],
      ['GW-L:FY27-000158', { title: 'Trail maintenance services' }],
    ]);
    const { plan } = planFromRecords('DOI', [rec({})], held);
    expect(plan.absentUpstream).toContain('GW-L:OLD-1');
    expect(plan.absentUpstream).not.toContain('GW-L:FY27-000158');
  });

  it('reports api twin overlap without mutating twins', () => {
    const held = new Map([['GW-L:FY27-000158', { title: 'Trail maintenance services' }]]);
    const other = new Set(['FY27-000158']);
    const { plan } = planFromRecords('DOI', [rec({})], held, other);
    expect(plan.twinApiOverlap).toContain('GW-L:FY27-000158');
  });

  it('filters off-agency rows out of the plan', () => {
    const usda = rec({
      'Listing ID': 'USDA-1',
      'Funding Department / Ind. Agency': 'Department of Agriculture',
      Title: 'Farm support',
    });
    const { plan, wrongAgency } = planFromRecords('DOI', [rec({}), usda], new Map());
    expect(wrongAgency).toBe(1);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toInsert[0].source_agency).toBe('DOI');
  });

  it('refuses semantic gate when held corpus matches zero upstream', () => {
    const held = new Map([['GW-L:OTHER', { title: 'x' }]]);
    const { plan } = planFromRecords(
      'DOI',
      [rec({ 'Listing ID': 'BRAND-NEW-99' })],
      held,
    );
    // Every upstream is NEW and every held is absent — identity failure.
    const sane = gatewayCsvPlanIsSemanticallySane(plan, held.size);
    expect(sane.ok).toBe(false);
  });
});
