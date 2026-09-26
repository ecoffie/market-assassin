/**
 * #1696 — selectViewportFromWalk must reproduce the viewport query exactly:
 *   map_lat/map_lng BETWEEN (inclusive) · ORDER BY response_deadline ASC NULLS LAST · LIMIT.
 */
import { describe, it, expect } from 'vitest';
import { selectViewportFromWalk, deadlineSortKey, type WalkRow } from './maps-open-viewport';
import { mapsOpenRequest, openPlanScansText } from './maps-open-discovery';

const row = (id: string, lat: number | null, lng: number | null, dl: string | null): WalkRow =>
  ({ notice_id: id, solicitation_number: null, map_lat: lat, map_lng: lng, response_deadline: dl });
const BB = { west: -100, south: 30, east: -80, north: 40 };

describe('selectViewportFromWalk', () => {
  it('bbox edges are inclusive, like gte/lte; outside and null coordinates are excluded', () => {
    const r = selectViewportFromWalk([
      row('edge-sw', 30, -100, '2026-10-01T00:00:00+00:00'),
      row('edge-ne', 40, -80, '2026-10-01T00:00:00+00:00'),
      row('out', 40.0000001, -90, '2026-10-01T00:00:00+00:00'),
      row('nolng', 35, null, '2026-10-01T00:00:00+00:00'),
    ], BB, 1000);
    expect(r.ids.sort()).toEqual(['edge-ne', 'edge-sw']);
    expect(r.totalInView).toBe(2);
  });

  it('orders by deadline ascending, NULLS LAST, at microsecond precision', () => {
    const r = selectViewportFromWalk([
      row('null', 35, -90, null),
      row('late', 35, -90, '2026-10-02T00:00:00+00:00'),
      row('us2', 35, -90, '2026-10-01T00:00:00.000002+00:00'),
      row('us1', 35, -90, '2026-10-01T00:00:00.000001+00:00'),
      row('whole', 35, -90, '2026-10-01T00:00:00+00:00'),
      row('offset', 35, -90, '2026-09-30T20:00:00-05:00'), // = 2026-10-01T01:00Z
    ], BB, 1000);
    expect(r.ids).toEqual(['whole', 'us1', 'us2', 'offset', 'late', 'null']);
  });

  it('totalInView is the RAW in-bbox count even when the pins are capped', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`n${i}`, 35, -90, `2026-10-${String(10 + i)}T00:00:00+00:00`));
    const r = selectViewportFromWalk(rows, BB, 5);
    expect(r.ids).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
    expect(r.totalInView).toBe(12);
  });

  it('deadlineSortKey keeps sub-millisecond digits', () => {
    expect(deadlineSortKey('2026-10-01T00:00:00.123456+00:00')).toEqual([Date.parse('2026-10-01T00:00:00.123Z'), 456]);
    expect(deadlineSortKey('2026-10-01T00:00:00+00:00')[1]).toBe(0);
  });
});

describe('openPlanScansText — cost signal only', () => {
  const plan = (p: Record<string, string>) => mapsOpenRequest((k) => (k === 'status' ? 'active' : p[k] ?? null),
    { ctx: { today: '2026-09-26', fiscalYear: 2026 } });
  it('true for free text, a buyer name and an exclusion-scoped query', () => {
    expect(openPlanScansText(plan({ q: 'software license' }))).toBe(true);
    expect(openPlanScansText(plan({ agency: 'Navy' }))).toBe(true);
  });
  it('false when no regex runs (codes only / empty)', () => {
    expect(openPlanScansText(plan({ naics: '541512' }))).toBe(false);
    expect(openPlanScansText(plan({}))).toBe(false);
  });
});
