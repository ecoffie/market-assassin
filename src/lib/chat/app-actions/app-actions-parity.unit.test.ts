/** The Map's ES5 MAP_ACTIONS table and filter keys must match the TS registry exactly (names, arg keys). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS, MAP_FILTER_KEYS } from './registry';

const MAP = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');

describe('Map action table parity', () => {
  it('MAP_ACTIONS has exactly the registry map actions with the same arg keys', () => {
    const body = MAP.slice(MAP.indexOf('var MAP_ACTIONS={'), MAP.indexOf('};', MAP.indexOf('var MAP_ACTIONS={')));
    const mapTable: Record<string, string[]> = {};
    for (const m of body.matchAll(/'([a-z_.]+)':\[([^\]]*)\]/g)) mapTable[m[1]] = [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    const ts = Object.fromEntries(Object.entries(ACTIONS).filter(([, d]) => d.surfaces.includes('map')).map(([n, d]) => [n, [...d.args]]));
    expect(mapTable).toEqual(ts);
  });
  it('MAP_FILTER_KEYS match', () => {
    const line = MAP.slice(MAP.indexOf('var MAP_FILTER_KEYS=['), MAP.indexOf('];', MAP.indexOf('var MAP_FILTER_KEYS=[')));
    expect([...line.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1])).toEqual([...MAP_FILTER_KEYS]);
  });
});
