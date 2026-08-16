/**
 * REGRESSION CONTRACT — the map must never open empty. (Eric 2026-08-16, locked before demo day.)
 *
 * THE DEFECT THIS PINS was boot ORDER, not data: `conus()` set the intended arrival zoom (5), then
 * `maybeAutoFit()` ran AFTER it and overrode it — fitting the pins' national bounding box with a
 * `maxZoom` but NO MINIMUM, which Leaflet resolved to 4.5. That is below `PIN_DOT_ZOOM` (5), so
 * the map HID THE MARKERS IT HAD JUST FITTED TO. Measured on prod: 0 markers + "Zoom in to see
 * opportunities" on arrival, 2,970 markers one zoom step in.
 *
 * ⚠️ WHY THIS FILE EXECUTES THE FUNCTION INSTEAD OF GREPPING FOR IT. Every existing guard around
 * this code is a source-string assertion, and EVERY ONE OF THEM PASSED while the map opened empty
 * — the defect was in the ORDER two correct-looking calls ran, which no grep can see. This
 * session alone produced six false verdicts from source tests and three shipped-but-inert
 * features that source tests approved. So the contract runs the real `maybeAutoFit` body against
 * a fake Leaflet and asserts the RESULTING ZOOM.
 *
 * The three checks Eric asked to lock down:
 *   1. arrival at the intended zoom SHOWS markers (autofit cannot land below the threshold)
 *   2. manual zoom-out STILL triggers the intentional low-zoom prompt (Zillow parity, 08-12)
 *   3. maybeAutoFit cannot move the map below marker visibility on initial load
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');

/** Pull the real maybeAutoFit body out of the shipped source and run it. */
function runAutoFit(opts: { fitResolvesTo: number; pinFloor: number; markerCount?: number }) {
  const start = route.indexOf('function maybeAutoFit(){');
  if (start < 0) throw new Error('maybeAutoFit not found — did it get renamed?');
  // Balance braces to the function's real end (never a fixed slice — that has bitten repeatedly).
  const open = route.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = open; i < route.length; i++) {
    if (route[i] === '{') depth++;
    else if (route[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const body = route.slice(start, end);

  let zoom = 4.5;                       // whatever conus() left; irrelevant, fitBounds overwrites
  const calls: string[] = [];
  const map = {
    getSize: () => ({ x: 1440, y: 900 }),
    getZoom: () => zoom,
    // Leaflet resolves the fit to whatever the bounds imply — the national case is 4.5.
    fitBounds: () => { zoom = opts.fitResolvesTo; calls.push('fitBounds->' + opts.fitResolvesTo); },
    setZoom: (z: number) => { zoom = z; calls.push('setZoom->' + z); },
  };
  const markers = { forEach: (f: (m: unknown) => void) => { for (let i = 0; i < (opts.markerCount ?? 3); i++) f({ i }); } };
  const L = { featureGroup: () => ({ getBounds: () => ({ isValid: () => true, pad: () => ({}) }) }) };

  // eslint-disable-next-line no-new-func
  const fn = new Function('map', 'markers', 'L', 'PIN_DOT_ZOOM', '_didAutoFit',
    `${body}; maybeAutoFit(); return null;`);
  fn(map, markers, L, opts.pinFloor, false);
  return { zoom, calls };
}

describe('CONTRACT: the map never opens below marker visibility', () => {
  it('floors a national fit that would land under the pin threshold', () => {
    // THE EXACT PROD FAILURE: fitBounds resolves to 4.5, floor is 5.
    const { zoom, calls } = runAutoFit({ fitResolvesTo: 4.5, pinFloor: 5 });
    expect(zoom).toBeGreaterThanOrEqual(5);
    expect(calls).toContain('setZoom->5');
  });

  it('leaves a fit that already clears the threshold alone', () => {
    // A regional fit must NOT be yanked — the floor is a minimum, not an override.
    const { zoom, calls } = runAutoFit({ fitResolvesTo: 9, pinFloor: 5 });
    expect(zoom).toBe(9);
    expect(calls.some((c) => c.startsWith('setZoom'))).toBe(false);
  });

  it('tracks PIN_DOT_ZOOM rather than a hardcoded 5', () => {
    // If the threshold ever moves, the floor must move with it — not drift into a second constant.
    const { zoom } = runAutoFit({ fitResolvesTo: 3, pinFloor: 7 });
    expect(zoom).toBe(7);
  });

  it('does nothing when there are no markers — never fitBounds([])', () => {
    const { calls } = runAutoFit({ fitResolvesTo: 4.5, pinFloor: 5, markerCount: 0 });
    expect(calls).toEqual([]);
  });
});

describe('CONTRACT: the intentional low-zoom prompt survives', () => {
  it('keeps PIN_DOT_ZOOM as the single visibility threshold', () => {
    // Zooming out manually must still stop drawing pins and show the hint — Eric 2026-08-12,
    // "drop the minzoom, handle like zillow". The arrival floor must never become a global clamp.
    expect(route).toContain('var PIN_DOT_ZOOM=(_EMBCL?0:5);');
    expect(route).toContain('function pinTooFar(map)');
  });

  it('still ships NO minZoom clamp (the zoom-out control stays alive)', () => {
    expect(tmpl).not.toMatch(/minZoom:\s*[\d.]/);
    expect(tmpl).not.toContain('maxBounds:');
  });
});
