/**
 * MAP ↔ WATCH FILTER PARITY (P0b, 2026-11-14).
 *
 * The Opportunity Map's Save button turns the live map filters (FILT) into a saved search. Before this
 * guard, the map had 11 filter keys the saved-search validator refuses, so using any of them failed the
 * whole save (7 of 12 affected users never got their watch). Every map filter key must now be in exactly
 * one of three groups:
 *   - accepted by the server as-is (ALLOWED_SAVED_SEARCH_FILTER_KEYS),
 *   - translated to an accepted key with the same meaning (MAP_TO_WATCH_TRANSLATED),
 *   - excluded only after the customer confirms (MAP_ONLY_WATCH_EXCLUDED).
 * A new map filter that is in none of them fails here, before it can break Save in production.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOWED_SAVED_SEARCH_FILTER_KEYS } from '@/lib/saved-searches/validate-filters';
import { MAP_TO_WATCH_TRANSLATED, MAP_ONLY_WATCH_EXCLUDED, WATCH_FILTER_LABELS } from '@/lib/saved-searches/watch-scope-client';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const FILTERS_LIB = readFileSync(join(__dirname, '..', '..', 'lib', 'opportunities', 'map-filters.ts'), 'utf8');
const ALLOWED = new Set<string>(ALLOWED_SAVED_SEARCH_FILTER_KEYS);

/** Every key declared in a `FILT={ ... }` literal in the map script (initial state and both resets). */
function mapFilterKeys(): Set<string> {
  const keys = new Set<string>();
  const re = /FILT=\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  let literals = 0;
  while ((m = re.exec(MAP))) {
    literals++;
    for (const k of m[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) keys.add(k[1]);
  }
  if (literals < 1) throw new Error('no FILT literal found in route.ts');
  return keys;
}

/** Every key the shared filter parser (viewport API + alert cron) reads. */
function alertEngineKeys(): Set<string> {
  const a = FILTERS_LIB.indexOf('export function parseMapFilters(');
  const body = FILTERS_LIB.slice(a, FILTERS_LIB.indexOf('\n}\n', a));
  return new Set([...body.matchAll(/get\('([A-Za-z]+)'\)/g)].map((x) => x[1]));
}

describe('map ↔ watch filter parity', () => {
  it('every map filter key is accepted, translated, or confirm-excluded', () => {
    const keys = mapFilterKeys();
    expect(keys.size).toBeGreaterThan(20);
    const orphans = [...keys].filter((k) => !ALLOWED.has(k) && !(k in MAP_TO_WATCH_TRANSLATED) && !(k in MAP_ONLY_WATCH_EXCLUDED));
    expect(orphans).toEqual([]);
  });

  it('the three groups do not overlap, and translations land on accepted keys', () => {
    for (const k of Object.keys(MAP_ONLY_WATCH_EXCLUDED)) expect(ALLOWED.has(k)).toBe(false);
    for (const [from, to] of Object.entries(MAP_TO_WATCH_TRANSLATED)) {
      expect(ALLOWED.has(from)).toBe(false);
      expect(k_in(from, MAP_ONLY_WATCH_EXCLUDED)).toBe(false);
      expect(ALLOWED.has(to)).toBe(true);
    }
  });

  it('a translation is only claimed where the map itself sends that merge (same meaning)', () => {
    // _buildOppUrl: setAside=_merge(FILT.setAside, FILT.setAsideMulti), noticeType=_merge(FILT.noticeType, FILT.noticeMulti).
    for (const [from, to] of Object.entries(MAP_TO_WATCH_TRANSLATED)) {
      expect(MAP).toContain(`_merge(FILT.${to}, FILT.${from})`);
    }
  });

  it('nothing excluded is a key the alert engine reads (so excluding never narrows less than the engine could)', () => {
    const engine = alertEngineKeys();
    expect(engine.has('naics')).toBe(true);
    for (const k of Object.keys(MAP_ONLY_WATCH_EXCLUDED)) expect(engine.has(k)).toBe(false);
  });

  it('every key the alert engine reads can be saved (except the q alias "search")', () => {
    const unsaveable = [...alertEngineKeys()].filter((k) => k !== 'search' && !ALLOWED.has(k));
    expect(unsaveable).toEqual([]);
  });

  it('every excluded key has a customer label', () => {
    for (const k of Object.keys(MAP_ONLY_WATCH_EXCLUDED)) expect(WATCH_FILTER_LABELS[k]).toBeTruthy();
  });
});

function k_in(k: string, o: Readonly<Record<string, string>>): boolean { return Object.prototype.hasOwnProperty.call(o, k); }
