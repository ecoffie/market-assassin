/**
 * Gateway watch state from the live 2026-11-19 probe:
 * listing.total = 13468, page 0 returned DOI listing 2027_ORWA_10101 changed 2026-11-18.
 * page=1 and page=2 repeated the same nids, then the host 503'd. A partial read
 * is content_stale, not unreachable and not current.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapFcoRow, parseChanged } from './fco-census';
import { gatewayExternalId, parseGatewayRow } from './gateway-forecast';
import { planGatewayCsvReconciliation, toGatewayCsvDbRow } from './gateway-csv-reconcile';
import { gatewayWatchState } from './gateway-watch-state';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/gateway-doi-row.json'), 'utf8'),
) as { listing: { total: number; data: Array<{ render: Record<string, unknown> }> } };

describe('gateway watch against the live DOI row', () => {
  const row = mapFcoRow(fixture.listing.data[0].render);

  it('attributes the row to Interior and the source listing id', () => {
    expect(row.department).toBe('Department of the Interior');
    expect(row.organization).toBe('Bureau of Land Management');
    expect(row.listingId).toBe('2027_ORWA_10101');
    expect(row.title).toMatch(/Western Oregon/);
    expect(row.naics).toBe('115310');
    expect(row.changed).toBe('2026-11-18T11:32:18-05:00');
    expect(parseChanged(fixture.listing.data[0].render.changed)).toBe(row.changed);
  });

  it('dedupes the live DOI listing as GW-L against a held csv row and does not delete absences', () => {
    const render = fixture.listing.data[0].render;
    const text = (v: unknown) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const parsed = parseGatewayRow({
      'Listing ID': text(render.field_source_listing_id),
      Title: text(render.title),
      Description: text(render.body),
      'Funding Department / Ind. Agency': text(render.field_result_id),
      'Funding Organization': text(render.field_funding_organization),
      'NAICS Code': text(render.field_naics_code),
      'Estimated Contract Value': text(render.field_estimated_contract_v_max),
    });
    expect(parsed).not.toBeNull();
    expect(gatewayExternalId(parsed!)).toBe('GW-L:2027-ORWA-10101');
    const upstream = toGatewayCsvDbRow(parsed!, 'DOI');
    expect(upstream?.source_agency).toBe('DOI');
    expect(upstream?.naics_code).toBe('115310');
    expect(upstream?.bureau).toBe('Bureau of Land Management');
    const empty = planGatewayCsvReconciliation({ agency: 'DOI', upstream: [upstream], heldCsv: new Map() });
    expect(empty.toInsert).toHaveLength(1);
    expect(empty.toUpdate).toHaveLength(0);
    expect(empty.absentUpstream).toEqual([]);
    const held = planGatewayCsvReconciliation({
      agency: 'DOI',
      upstream: [upstream],
      heldCsv: new Map([['GW-L:2027-ORWA-10101', { title: 'old title', naics_code: '115310' }]]),
    });
    expect(held.toInsert).toHaveLength(0);
    expect(held.matchedExisting).toBe(1);
    expect(held.toUpdate[0]?.changedFields).toContain('title');
  });

  it('a source that answered with a total is stale when the census is incomplete', () => {
    expect(gatewayWatchState({
      pagesFetched: 1,
      reportedTotal: fixture.listing.total,
      complete: false,
      heldCanonical: 6687,
      uniqueListingIds: 25,
    })).toBe('content_stale');
  });

  it('zero pages read is unreachable, never current', () => {
    expect(gatewayWatchState({
      pagesFetched: 0,
      reportedTotal: 0,
      complete: false,
      heldCanonical: 6687,
      uniqueListingIds: 0,
    })).toBe('unreachable');
  });

  it('current only when the census finished and the held ids cover it', () => {
    expect(gatewayWatchState({
      pagesFetched: 10,
      reportedTotal: 100,
      complete: true,
      heldCanonical: 100,
      uniqueListingIds: 100,
    })).toBe('current');
    expect(gatewayWatchState({
      pagesFetched: 10,
      reportedTotal: 100,
      complete: true,
      heldCanonical: 40,
      uniqueListingIds: 100,
    })).toBe('content_stale');
  });
});
