/**
 * THE GATE for the map-truth contract (Eric, 2026-09-12):
 *   "If total matching rows > mappable rows, the UI must disclose both."
 *
 * Encoded as a test, not a comment, because the failure is invisible: nothing throws,
 * and the wrong number looks exactly like the right one.
 */
import { describe, it, expect } from 'vitest';
import { buildMapCountDisclosure } from './map-truth-disclosure';

describe('map truth disclosure — matching vs mappable', () => {
  it('THE RULE: matching > mappable forces disclosure of BOTH', () => {
    const d = buildMapCountDisclosure(42, 1);
    expect(d.mustDisclose).toBe(true);
    expect(d.matching).toBe(42);
    expect(d.mappable).toBe(1);
    expect(d.unplaced).toBe(41);
    // Eric's exact shape: "42 matching opportunities · 1 mapped · 41 location unavailable"
    expect(d.headline).toBe('42 matching opportunities · 1 mapped · 41 location unavailable');
  });

  it('reproduces the four real user cases measured 2026-09-12', () => {
    // Each is a real saved search: map showed the left number, truth was the right one.
    expect(buildMapCountDisclosure(31, 0).headline).toContain('31 matching');
    expect(buildMapCountDisclosure(31, 0).unplaced).toBe(31);
    expect(buildMapCountDisclosure(24, 0).unplaced).toBe(24);
    expect(buildMapCountDisclosure(42, 0).unplaced).toBe(42);
    // VA: 1,802 real, 30 mapped — the case that reads most plausibly and is most wrong.
    const va = buildMapCountDisclosure(1802, 30);
    expect(va.mustDisclose).toBe(true);
    expect(va.unplaced).toBe(1772);
    expect(va.headline).toBe('1,802 matching opportunities · 30 mapped · 1,772 location unavailable');
  });

  it('stays silent when everything matching is mapped (no noise)', () => {
    const d = buildMapCountDisclosure(12, 12);
    expect(d.mustDisclose).toBe(false);
    expect(d.headline).toBe('12 opportunities');
  });

  it('SURVIVES GOOD COVERAGE — still discloses at ~95.6% mapped', () => {
    // The whole point: 477 open rows stay legitimately unplaceable after the backfill
    // (APO/FPO + foreign place-of-performance). The disclosure is permanent, not cleanup.
    const d = buildMapCountDisclosure(11004, 10527);
    expect(d.mustDisclose).toBe(true);
    expect(d.unplaced).toBe(477);
  });

  it('UNKNOWN total is not "fully mapped" (Bug Prevention Rule #11)', () => {
    // A null count must never collapse into "matching == mappable" — that is the
    // `count ?? 0` fabrication wearing a different hat.
    const d = buildMapCountDisclosure(null, 30);
    expect(d.headline).toContain('total unknown');
    expect(d.headline).not.toBe('30 opportunities');
  });

  it('never renders a negative "unplaced" if mappable exceeds matching', () => {
    const d = buildMapCountDisclosure(5, 9);
    expect(d.unplaced).toBe(0);
    expect(d.mappable).toBeLessThanOrEqual(d.matching);
  });

  it('works for any horizon noun', () => {
    expect(buildMapCountDisclosure(100, 40, 'recompetes').headline)
      .toBe('100 matching recompetes · 40 mapped · 60 location unavailable');
    expect(buildMapCountDisclosure(90, 55, 'forecasts').headline)
      .toBe('90 matching forecasts · 55 mapped · 35 location unavailable');
  });
});
