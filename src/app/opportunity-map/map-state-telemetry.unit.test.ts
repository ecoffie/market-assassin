/**
 * PHASE 3 — TELEMETRY ONLY. Capture the map state; surface NOTHING yet.
 *
 * "Resume your map" was measured before it was built: over 30 days only 27 users opened a map
 * listing and 8 ran a search (45 map users in 14d). A resume row would be empty for ~99% of
 * visitors — the same math that cut Saved Searches from /today, and the same rule applies:
 * never give homepage real estate to a behaviour that is not a habit yet. So this records the
 * state and waits for the data to prove users create reusable sessions (Eric 2026-08-16).
 *
 * NO NEW TABLE. user_engagement already has a JSONB `metadata` column and the map already fires
 * _track() — authenticated, fire-and-forget, keepalive so it survives a navigation. This extends
 * the payload; it does not add infrastructure.
 *
 * THE SHAPE IS {mode, filters, bbox} — deliberately identical to what __applySavedSearch already
 * accepts and what saved_searches.filters already stores. So if a resume feature is ever built it
 * needs no new apply code, and saved searches / deep links / resume share ONE vocabulary. A
 * different shape here would be a second dictionary — the drift class this repo keeps hitting.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const map = readFileSync(join(__dirname, 'route.ts'), 'utf8');
// The unit under test is the state snapshot + the tracker that sends it — _mapState() is
// defined just above _track(), so slice from there.
const track = map.slice(map.indexOf('function _mapState('), map.indexOf('window.__track=_track'));

describe('_track captures the full map state', () => {
  it('snapshots FILT the same way the saved-search save path does', () => {
    // Same loop shape as the Save-search handler: skip empties and the 'all' sentinel.
    expect(track).toMatch(/for\s*\(\s*var\s+\w+\s+in\s+FILT\s*\)/);
    expect(track).toContain("!=='all'");
  });

  it('captures the horizon chips — they are NOT part of FILT', () => {
    // Horizons pick which endpoints get fetched. A saved search that omitted them restored with
    // every horizon on (Eric 2026-08-13); telemetry that omits them is unusable for the same reason.
    expect(track).toContain('__horizons');
  });

  it('captures strategy strands, viewport and zoom', () => {
    expect(track).toContain('strategy');
    expect(track).toContain('getBounds');
    expect(track).toContain('getZoom');
  });

  it('captures the ENTRY POINT — the question that decides if resume is ever worth building', () => {
    // Which surface sent them here (/today tile, alert email, saved search, direct). Without it
    // the data cannot answer "do /today links actually produce reusable sessions?".
    expect(track).toContain('entry');
  });

  it('uses the {mode, filters, bbox} vocabulary __applySavedSearch already accepts', () => {
    expect(track).toMatch(/\bfilters\b/);
    expect(track).toMatch(/\bbbox\b/);
    expect(track).toContain('mode');
  });

  it('stays fire-and-forget — telemetry must never break the map', () => {
    // Every failure swallowed on purpose; a state snapshot that throws would take the map with it.
    expect(track).toContain('try{');
    expect(track).toContain('keepalive');
    expect(track).toMatch(/catch\(e\)\{\}/);
  });

  it('still refuses to attribute a signed-out session', () => {
    expect(track).toContain('if(!em) return');
  });
});

describe('no dead params are emitted at map links', () => {
  it('?saved= is gone — the map reads ?ss=', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'today', 'ContinueExploring.tsx'), 'utf8');
    expect(src).not.toContain('opportunity-map?saved=');
    expect(src).toContain('opportunity-map?ss=');
  });

  it('?horizon= is gone from forecast alert emails — the map reads ?mode=', () => {
    // This one shipped in a LIVE alert email, not orphaned code: every forecast alert row
    // pointed at ?horizon=forecast, which the map has never read.
    const src = readFileSync(join(__dirname, '..', '..', 'lib', 'alerts', 'forecast-alert-row.ts'), 'utf8');
    // Assert on the URL CONSTANT, not the whole file: the explanatory comment above it names the
    // old param, and a whole-file grep matches its own prose. (Same false-positive shape as the
    // source-grep guard that passed on its own comment earlier — see typeof_guard memory.)
    const url = (src.match(/const FORECAST_URL = '([^']+)'/) || [])[1];
    expect(url).toBe('/opportunity-map?mode=forecast');
  });
});
