/**
 * /today is a CONTROL PANEL FOR THE MAP, not a homepage (Eric 2026-08-16): every click should
 * hand the user an already-configured map. "Zero blank maps."
 *
 * Before this: of the four Today's-Market stat tiles, THREE were dead ends — ?posted=1,
 * ?posted=7 and ?mode=recompete were emitted and read by nothing, so a user who clicked
 * "1,321 posted today" landed on the same unfiltered 145,467-result national map.
 *
 * Each tile needs a different mechanism, which is why this wasn't one fix:
 *   - posted  → FILT.postedDays, via the #mfPosted <select>. The tile promises ONE day and the
 *               select's shortest option was 3 days, so a "Last 24 hours" option was added
 *               rather than snapping 1→3 (which would show MORE than the number clicked —
 *               the map contradicting the tile that sent you).
 *   - mode=recompete → NOT a filter. Horizons choose WHICH ENDPOINTS get fetched, so this goes
 *               through toggleHorizon, which owns chip sync for both surfaces plus the
 *               "never turn the last one off" guard.
 *   - events  → has NO map representation at all. Events exist only inside an opportunity's
 *               drawer; there is no events page (confirmed with Eric). So the tile is rendered
 *               as a plain number, NOT a link. A stat that doesn't pretend to be a door is
 *               honest; a link to a map that cannot show events is the dead end we're removing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mapSrc = readFileSync(join(__dirname, '..', '..', 'app', 'opportunity-map', 'route.ts'), 'utf8');
const intelSrc = readFileSync(join(__dirname, 'intel.ts'), 'utf8');
const todaySrc = readFileSync(join(__dirname, '..', '..', 'app', 'today', 'route.ts'), 'utf8');

describe('every stat tile that links, links somewhere the map can honour', () => {
  it('the map reads ?posted= and ?mode=', () => {
    expect(mapSrc).toContain("P('posted')");
    expect(mapSrc).toContain("P('mode')");
  });

  it('offers a 24-hour Posted option so ?posted=1 sets a REAL control', () => {
    // Without this the select cannot hold the value: the map would filter to a day while the
    // Filters panel showed "Any time", and Clear-all could not undo what the link applied.
    expect(mapSrc).toContain('<option value="1">Last 24 hours</option>');
  });

  it('routes mode=recompete through toggleHorizon, never a direct __horizons write', () => {
    const h = mapSrc.slice(mapSrc.indexOf('// Deep-link: scope params'));
    const block = h.slice(0, h.indexOf('__applySavedSearch({'));
    expect(block).toContain('toggleHorizon');
    // A raw write skips chip sync + the "never turn the last one off" guard (route.ts:3676).
    expect(block).not.toMatch(/window\.__horizons\s*(\[|\.)\w+\s*=/);
  });

  it('the events tile is a plain number — no href to a map that cannot show events', () => {
    expect(intelSrc).not.toContain('opportunity-map?events=');
    // The renderer must be able to express a non-link stat at all.
    expect(todaySrc).toMatch(/s\.href\s*\?/);
  });

  it('every href /today still emits is one the map actually reads', () => {
    const emitted = [...intelSrc.matchAll(/\/opportunity-map\?([a-zA-Z]+)=/g)].map((m) => m[1]);
    const READ = ['opp', 'agency', 'naics', 'posted', 'mode', 'strategy', 'ss', 'state', 'setAside', 'psc', 'q'];
    for (const p of new Set(emitted)) {
      expect(READ, `/today emits ?${p}= — the map must read it or the click is a dead end`).toContain(p);
    }
  });
});
