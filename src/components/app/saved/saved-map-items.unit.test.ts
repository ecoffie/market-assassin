import { describe, expect, it } from 'vitest';
import {
  pursuitBodyFor,
  savedRowKind,
  savedRowMapLink,
  summarizeSavedSearchFilters,
  toSavedMapItem,
  toSavedMapItems,
  toSavedSearchItems,
} from './saved-map-items';

const SAM = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('saved map rows → kind + record link', () => {
  it('an open-opportunity heart (no source → manual) links by notice id', () => {
    const row = { notice_id: SAM, source: 'manual', title: 'Janitorial services' };
    expect(savedRowKind(row)).toBe('opportunity');
    expect(savedRowMapLink(row)).toBe(`/opportunity-map?opp=${SAM}`);
  });

  it('a forecast id routes to ?forecast=', () => {
    const row = { notice_id: 'fc-123', source: 'manual' };
    expect(savedRowKind(row)).toBe('forecast');
    expect(savedRowMapLink(row)).toBe('/opportunity-map?forecast=fc-123');
  });

  it('a recompete links by contract_id', () => {
    const row = { notice_id: 'CONT_AWD_W912PL19C0015', source: 'recompete_map' };
    expect(savedRowKind(row)).toBe('recompete');
    expect(savedRowMapLink(row)).toBe('/opportunity-map?recompete=CONT_AWD_W912PL19C0015');
  });

  it('a company links by UEI (from snapshot when present), uppercased', () => {
    expect(savedRowMapLink({ notice_id: 'abc123def456', source: 'company_map' })).toBe('/opportunity-map?company=ABC123DEF456');
    expect(savedRowMapLink({ notice_id: 'x', opportunity_data: { entityType: 'company', uei: 'zz11yy22xx33' } }))
      .toBe('/opportunity-map?company=ZZ11YY22XX33');
  });

  it('a buyer links by contact id; entityType alone is enough to classify', () => {
    const row = { notice_id: '9876', opportunity_data: { entityType: 'buyer' } };
    expect(savedRowKind(row)).toBe('buyer');
    expect(savedRowMapLink(row)).toBe('/opportunity-map?buyer=9876');
  });

  it('record links never carry a reader fact', () => {
    const link = savedRowMapLink({ notice_id: SAM, opportunity_data: { naicsCode: '541512', state: 'FL' } });
    expect(link).toBe(`/opportunity-map?opp=${SAM}`);
  });

  it('a row without an id is dropped (no link to a blank map)', () => {
    expect(toSavedMapItem({ notice_id: '', title: 'x' })).toBeNull();
  });

  it('placeholder title is replaced, and pursuits only for opportunity-like kinds', () => {
    const opp = toSavedMapItem({ notice_id: SAM, title: 'Unknown Opportunity' })!;
    expect(opp.title).toBe(`Notice ${SAM}`);
    expect(opp.canStartPursuit).toBe(true);
    expect(toSavedMapItem({ notice_id: 'C1', source: 'recompete_map', opportunity_data: { solicitationNumber: 'P1' } })!.canStartPursuit).toBe(true);
    expect(toSavedMapItem({ notice_id: 'U1', source: 'company_map' })!.canStartPursuit).toBe(false);
    expect(toSavedMapItem({ notice_id: 'B1', source: 'buyer_map' })!.canStartPursuit).toBe(false);
  });

  it('kind filter keeps only requested kinds', () => {
    const rows = [
      { notice_id: SAM },
      { notice_id: 'U1', source: 'company_map' },
      { notice_id: 'B1', source: 'buyer_map' },
    ];
    expect(toSavedMapItems(rows, ['company', 'buyer']).map((i) => i.kind)).toEqual(['company', 'buyer']);
    expect(toSavedMapItems(rows)).toHaveLength(3);
    expect(toSavedMapItems(null)).toEqual([]);
  });

  it('pursuit body matches /api/pipeline (user_email + title required)', () => {
    const item = toSavedMapItem({ notice_id: SAM, title: 'T', agency: 'VA', response_deadline: '2026-12-01' })!;
    expect(pursuitBodyFor(item, 'a@b.com')).toEqual({
      user_email: 'a@b.com', title: 'T', notice_id: SAM, agency: 'VA', response_deadline: '2026-12-01', source: 'opportunity_map',
    });
  });
});

describe('saved searches', () => {
  it('summarizes known filter keys', () => {
    expect(summarizeSavedSearchFilters({ q: 'cyber', naics: '541512,541519', state: 'FL', fullOpen: 'true', closingDays: '30' }))
      .toBe('"cyber" · NAICS 541512, 541519 · in FL · Full & open · closing in 30 days');
    expect(summarizeSavedSearchFilters({})).toBe('');
    expect(summarizeSavedSearchFilters(null)).toBe('');
  });

  it('maps rows with ?ss= links; an uncounted search is null, never 0', () => {
    const items = toSavedSearchItems(
      [
        { id: 'id-1', name: 'FL cyber', mode: 'open', filters: { state: 'FL' }, alerts_enabled: true },
        { id: 'id-2', name: '', mode: 'recompete', filters: {} },
      ],
      [{ id: 'id-1', count: 4 }],
    );
    expect(items[0]).toMatchObject({ name: 'FL cyber', modeLabel: 'Open opportunities', summary: 'in FL', alertsOn: true, newCount: 4, mapHref: '/opportunity-map?ss=id-1' });
    expect(items[1]).toMatchObject({ name: 'Saved search', modeLabel: 'Recompetes', newCount: null });
  });
});

describe('pursuit key for recompete favorites', () => {
  it('uses the PIID (suffix stripped), not the contract_id', () => {
    const item = toSavedMapItem({ notice_id: 'CONT_AWD_N0018926F0012_9700', source: 'recompete_map', title: 'Base ops', opportunity_data: { entityType: 'recompete', solicitationNumber: 'N0018926F0012 (+3 more)' } })!;
    expect(item.kind).toBe('recompete');
    expect(item.pursuitNoticeId).toBe('N0018926F0012');
    expect(pursuitBodyFor(item, 'a@b.co').notice_id).toBe('N0018926F0012');
  });
  it('offers no Start pursuit for a recompete without a PIID', () => {
    const item = toSavedMapItem({ notice_id: 'CONT_AWD_X', source: 'recompete_map', opportunity_data: { entityType: 'recompete' } })!;
    expect(item.canStartPursuit).toBe(false);
  });
  it('keeps the notice id for opportunities', () => {
    const item = toSavedMapItem({ notice_id: '006d77f604a74dd0a16c99d041e6c032', title: 'Roofs' })!;
    expect(item.pursuitNoticeId).toBe('006d77f604a74dd0a16c99d041e6c032');
    expect(item.canStartPursuit).toBe(true);
  });
});
