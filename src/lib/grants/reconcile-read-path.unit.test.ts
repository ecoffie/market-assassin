/**
 * Read paths after reconcile — the REAL getGrantsViewportPins and the REAL /api/app/grants-map handler
 * over an in-memory grants_cache. Absent-and-unconfirmed and confirmed-gone rows are hidden (and counted
 * as hidden); a source-confirmed live row is shown with its confirmed status; without the migration the
 * map behaves exactly as before (no error, nothing hidden).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFakeDb, type FakeDb } from './grants-cache-fake';

let DB: FakeDb;
vi.mock('@/lib/supabase/server-clients', () => ({ getReadClient: () => DB }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => DB }));

import { getGrantsViewportPins } from '@/lib/opportunities/map-data';
import { GET } from '@/app/api/app/grants-map/route';

const BBOX = { west: -80, south: 35, east: -70, north: 45 };
const base = (opp: string, extra: Record<string, unknown> = {}) => ({
  opp_number: opp, title: opp, agency: 'NSF', agency_code: 'NSF', status: 'posted', award_ceiling: null,
  close_date: '2099-12-31', posted_date: '2026-09-01', url: `https://www.grants.gov/search-results-detail/1`,
  map_lat: 38.9, map_lng: -77, map_loc_source: 'agency_hq', absent_since: null, source_status: null, ...extra,
});
function seed(columns = true) {
  const rows = [
    base('PRESENT'),
    base('ABSENT-UNCONFIRMED', { absent_since: '2026-09-26T09:00:00Z' }),                       // not looked up / lookup failed
    base('ABSENT-ARCHIVED', { absent_since: '2026-09-26T09:00:00Z', source_status: 'archived' }), // confirmed gone
    base('ABSENT-CLOSED', { absent_since: '2026-09-26T09:00:00Z', source_status: 'closed' }),     // confirmed gone
    base('ABSENT-NOTFOUND', { absent_since: '2026-09-26T09:00:00Z', source_status: 'not_found' }), // AMBIGUOUS
    base('CONFIRMED-LIVE', { status: 'forecasted', close_date: null, absent_since: '2026-09-26T09:00:00Z', source_status: 'posted' }),
    base('SUPERSEDED-OLDNUM', { absent_since: '2026-09-26T09:00:00Z', superseded_by: 'PRESENT' }), // renumbered duplicate
    base('EXPIRED', { close_date: '2020-01-01' }),
  ];
  if (!columns) for (const r of rows) { for (const k of ['absent_since', 'source_status', 'superseded_by']) delete (r as Record<string, unknown>)[k]; }
  DB = makeFakeDb(rows, { columns, runsTable: columns });
}

beforeEach(() => seed(true));

describe('Grants map pins — absence never hides; only confirmed closed/archived and duplicates do', () => {
  it('visible: listed, absent-unverified, ambiguous not_found, confirmed live. Hidden: archived, closed, superseded. Rows preserved', async () => {
    const pins = await getGrantsViewportPins(BBOX);
    expect(pins.map((p) => p.sol).sort()).toEqual(['ABSENT-NOTFOUND', 'ABSENT-UNCONFIRMED', 'CONFIRMED-LIVE', 'PRESENT']);
    expect(DB.tables.grants_cache).toHaveLength(8);
  });

  it('each visible pin carries an honest verification label — never "closed"', async () => {
    const pins = await getGrantsViewportPins(BBOX);
    const v = Object.fromEntries(pins.map((p) => [p.sol, p.verification]));
    expect(v).toEqual({
      PRESENT: 'listed',
      'ABSENT-UNCONFIRMED': 'absent_unverified',
      'ABSENT-NOTFOUND': 'absent_not_found_ambiguous',
      'CONFIRMED-LIVE': 'absent_confirmed_live',
    });
  });

  it('a confirmed-live row is labelled by its CONFIRMED status (was cached as forecasted, source says posted)', async () => {
    const pins = await getGrantsViewportPins(BBOX);
    expect(pins.find((p) => p.sol === 'CONFIRMED-LIVE')!.cat).not.toMatch(/Upcoming/);
  });

  it('migration not applied → exactly the old behaviour (all non-expired rows, no error, no labels)', async () => {
    seed(false);
    const pins = await getGrantsViewportPins(BBOX);
    expect(pins.map((p) => p.sol).sort()).toEqual(['ABSENT-ARCHIVED', 'ABSENT-CLOSED', 'ABSENT-NOTFOUND', 'ABSENT-UNCONFIRMED', 'CONFIRMED-LIVE', 'PRESENT', 'SUPERSEDED-OLDNUM']);
    expect(pins.every((p) => p.verification === undefined)).toBe(true);
  });
});

describe('/api/app/grants-map', () => {
  const req = () => new Request(`http://t/api/app/grants-map?bbox=${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`);
  it('headline counts visible grants; reports hidden and visible-but-uncertain separately', async () => {
    const body = await (await GET(req() as never)).json();
    expect(body).toMatchObject({ success: true, totalForFilters: 4, totalInView: 4 });
    expect(body.hidden).toEqual({ confirmedClosedOrArchived: 2, supersededDuplicates: 1 });
    expect(body.visibleUncertain).toEqual({ absentUnverified: 1, absentNotFoundAmbiguous: 1 });
  });
  it('migration not applied → hidden/visibleUncertain are null (no filter active), counts as before', async () => {
    seed(false);
    const body = await (await GET(req() as never)).json();
    expect(body).toMatchObject({ success: true, totalForFilters: 7, hidden: null, visibleUncertain: null });
  });
});
