/**
 * GUARD — Absent ≠ unrestricted (repair board P1-A, 2026-09-26).
 *
 * A notice / recompete / forecast with NO set-aside on record rendered as "Open",
 * "Open / unrestricted", "Open (unrestricted)" or a "Full & Open" DNA chip on every Map surface.
 * Measured on prod 2026-09-26: 17,808 active SAM notices carry a NULL set-aside vs 3,847 an
 * explicit "No Set aside used"; 101,694 of 143,532 recompetes are NULL. Worse, recompete
 * VOCABULARY ("SB-Total", "8(a)", "SDVOSB" — 18,000+ rows) fell through `setGroupKey` to NONE, so
 * explicit small-business set-asides were labelled "Open / unrestricted".
 *
 * The contract:
 *   - `mapSetAside(raw)` returns the FILTER bucket and `open` — TRUE only when the source SAYS there
 *     is no set-aside. A filter may keep NULL in the Unrestricted bucket; a LABEL may not.
 *   - Every renderer reads "Open" only from that positive flag, so a payload without it (stale
 *     cache, DLA, grants) degrades to "Not stated", never to the stronger claim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapSetAside } from './map-data';
import { computeGenome } from './genome';
import { classifySetAside } from '@/lib/beginner/labels';
import { toPin as toRecompetePin } from '@/lib/recompete/map-pin';

describe('mapSetAside — missing data can never become Open', () => {
  it.each([null, undefined, '', '   '])('%p → NONE bucket, NOT open', (raw) => {
    expect(mapSetAside(raw as string | null | undefined)).toEqual({ key: 'NONE', open: false });
  });

  it('a placeholder ("TBD") is not a statement of openness', () => {
    expect(mapSetAside('TBD')).toEqual({ key: 'NONE', open: false });
  });

  it.each([
    ['NONE'],
    ['No Set aside used'],
    ['Full & Open'],
    ['Full and Open'],
    ['Full and Open/Unrestricted'],
    ['Other Than Small Business'],
  ])('an EXPLICIT statement (%p) is open', (raw) => {
    expect(mapSetAside(raw)).toEqual({ key: 'NONE', open: true });
  });

  it.each([
    // SAM codes
    ['SBA', 'SB'], ['SDVOSBC', 'SDVOSB'], ['8AN', '8A'], ['HZC', 'HZ'], ['WOSB', 'WOSB'],
    // recompete vocabulary — these all used to fall to NONE and render "Open / unrestricted"
    ['SB-Total', 'SB'], ['SB-Partial', 'SB'], ['8(a)', '8A'], ['SDVOSB', 'SDVOSB'], ['HUBZone', 'HZ'],
    ['EDWOSB', 'WOSB'], ['VOSB', 'SDVOSB'], ['Indian-SB', 'OTHER'],
    // forecast vocabulary
    ['Small Business', 'SB'], ['Small Business Set Aside - Total', 'SB'],
    // an unrecognized restriction is OTHER, never NONE
    ['LAS', 'OTHER'], ['Sole Source', 'OTHER'],
  ])('a set-aside (%p) lands in its group %p and is never open', (raw, key) => {
    expect(mapSetAside(raw)).toEqual({ key, open: false });
  });
});

describe('classifySetAside — the canonical vocabulary the map now shares', () => {
  it('reads the recompete vocabulary', () => {
    expect(classifySetAside('SB-Total')).toBe('sb');
    expect(classifySetAside('Full & Open')).toBe('open');
  });
  it('"Other Than Small Business" is not a small-business set-aside', () => {
    expect(classifySetAside('Other Than Small Business')).toBe('open');
  });
  it('null stays not_stated', () => {
    expect(classifySetAside(null)).toBe('not_stated');
  });
});

describe('Opportunity DNA — "Full & Open" only when the record says so', () => {
  const now = Date.parse('2026-09-26T00:00:00Z');
  const keys = (setOpen?: boolean) =>
    computeGenome({ src: 'SAM', set: 'NONE', setOpen, title: 'Janitorial services' }, now).map((s) => s.key);

  it('a NONE bucket WITHOUT setOpen earns no full_open strand', () => {
    expect(keys(undefined)).not.toContain('full_open');
    expect(keys(false)).not.toContain('full_open');
  });
  it('an explicit no-set-aside still earns it', () => {
    expect(keys(true)).toContain('full_open');
  });
});

describe('Recompete pins carry their real set-aside', () => {
  const base = { contract_id: 'C1', map_lat: 30, map_lng: -90, potential_total_value: 1e6 };
  it('NULL set_aside_type → NONE, not open', () => {
    const p = toRecompetePin({ ...base, set_aside_type: null });
    expect(p.set).toBe('NONE');
    expect(p.setOpen).toBeUndefined();
  });
  it('"SB-Total" is a Small Business pin, not unrestricted', () => {
    const p = toRecompetePin({ ...base, set_aside_type: 'SB-Total' });
    expect(p.set).toBe('SB');
    expect(p.setOpen).toBeUndefined();
  });
  it('"Full & Open" is explicitly open', () => {
    const p = toRecompetePin({ ...base, set_aside_type: 'Full & Open' });
    expect(p.set).toBe('NONE');
    expect(p.setOpen).toBe(true);
  });
});

describe('render sites never turn an absent set-aside into "Open"', () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');
  const mapRoute = read('src', 'app', 'opportunity-map', 'route.ts');
  const template = read('src', 'app', 'opportunity-map', 'template.html');
  const detail = read('src', 'app', 'api', 'app', 'opportunity-detail', 'route.ts');

  it('Map client: no None → Open ternary that ignores setOpen', () => {
    // The exact shapes that shipped (7 sites). Each must now branch on setOpen.
    expect(mapRoute).not.toMatch(/==='None'\)\?'Open \/ unrestricted':/);
    expect(mapRoute).not.toMatch(/==='None'\)\?'Open':/);
    expect(mapRoute).not.toMatch(/==='None'\)\?'To be determined':/);
    expect(mapRoute).not.toMatch(/else tags\.push\('Open \/ unrestricted'\)/);
    expect(mapRoute).not.toMatch(/setAsideLabel\|\|'Open'/);
  });

  it('Map client: an empty set-aside chip is "Not stated", Open only with setAsideOpen', () => {
    // s.setAside falsy → it used to print an unconditional "Open" chip.
    expect(mapRoute).not.toMatch(/:'<span class="sim-sa open">Open<\/span>'\)\s*\n/);
    expect(mapRoute).toMatch(/t\.setAsideOpen\?'<span class="sim-sa open">Open<\/span>':'<span class="sim-sa">Not stated<\/span>'/);
  });

  it('Map client normalizers carry setOpen from the pin payload', () => {
    expect(mapRoute.match(/set:SETMAP\[p\.set\]\|\|'None',setOpen:p\.setOpen===true,/g)?.length).toBe(2);
    expect(mapRoute).toMatch(/set:SETMAP\[u\.set\]\|\|'None',setOpen:u\.setOpen===true,/);
  });

  it('Map template card: None reads "Not stated" unless setOpen', () => {
    expect(template).not.toMatch(/o\.set==='None'\?'Open':o\.set/);
    expect(template).toMatch(/o\.set==='None'\?\(o\.setOpen\?'Open':'Not stated'\):o\.set/);
  });

  it('opportunity-detail Facts: an absent set-aside is "Not stated"', () => {
    expect(detail).not.toMatch(/Open \(unrestricted\)/);
  });
});
