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
