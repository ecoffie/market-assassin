/**
 * Unit test for the Awarded/Recompete drawer's "Similar recompetes" peer-card filter.
 *
 * `rcSimilarRows(o, pools, limit)` (in route.ts's injected drawer JS) is the cheap client-side
 * filter behind the peer flywheel — same as the open-opp drawer's "Similar opportunities" and
 * the company drawer's "Similar companies", but for recompete rows already loaded in rows/OPPS.
 * It must:
 *   - match on same service line (cat) OR same agency
 *   - EXCLUDE self (by nid AND by sol)
 *   - only consider RECOMPETE rows (never SAM/CONTACT rows in the same pool)
 *   - dedupe by id and cap at `limit`
 *
 * Extracted straight from route.ts and eval'd so the test tracks the SHIPPED source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function extractFn(name: string): string {
  const start = routeSrc.indexOf(`function ${name}(`);
  expect(start, `function ${name} must exist in route.ts`).toBeGreaterThan(-1);
  const open = routeSrc.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < routeSrc.length; i++) {
    const c = routeSrc[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return routeSrc.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rcSimilarRows: (o: any, pools: any[][], limit?: number) => any[] =
  new Function(`${extractFn('rcSimilarRows')}; return rcSimilarRows;`)();

const R = (over: Record<string, unknown>) => ({ src: 'RECOMPETE', ...over });

describe('rcSimilarRows — similar-recompetes filter', () => {
  const self = R({ nid: '1', sol: 'PIID-1', cat: 'Janitorial', agency: 'Army' });

  it('matches peers with the same service line OR the same agency', () => {
    const pool = [
      self,
      R({ nid: '2', sol: 'PIID-2', cat: 'Janitorial', agency: 'Navy' }),  // same cat
      R({ nid: '3', sol: 'PIID-3', cat: 'Roofing', agency: 'Army' }),     // same agency
      R({ nid: '4', sol: 'PIID-4', cat: 'Roofing', agency: 'Navy' }),     // neither → excluded
    ];
    const out = rcSimilarRows(self, [pool], 6);
    const ids = out.map((r) => r.nid).sort();
    expect(ids).toEqual(['2', '3']);
  });

  it('excludes self by nid AND by sol', () => {
    const pool = [
      self,
      R({ nid: 'X', sol: 'PIID-1', cat: 'Janitorial', agency: 'X' }), // shares self's sol → excluded
      R({ nid: '1', sol: 'PIID-Z', cat: 'Janitorial', agency: 'X' }), // shares self's nid → excluded
      R({ nid: '9', sol: 'PIID-9', cat: 'Janitorial', agency: 'X' }), // legit peer
    ];
    const out = rcSimilarRows(self, [pool], 6);
    expect(out.map((r) => r.nid)).toEqual(['9']);
  });

  it('ignores non-recompete rows sharing the pool (SAM / CONTACT)', () => {
    const pool = [
      self,
      { src: 'SAM', nid: '2', sol: 'S-2', cat: 'Janitorial', agency: 'Army' },     // not RECOMPETE
      { src: 'CONTACT', nid: '3', sol: 'C-3', cat: 'Janitorial', agency: 'Army' }, // not RECOMPETE
      R({ nid: '4', sol: 'PIID-4', cat: 'Janitorial', agency: 'Army' }),           // the only real peer
    ];
    const out = rcSimilarRows(self, [pool], 6);
    expect(out.map((r) => r.nid)).toEqual(['4']);
  });

  it('dedupes by id and caps at the limit', () => {
    const pool = [self];
    for (let i = 2; i <= 12; i++) pool.push(R({ nid: String(i), sol: 'PIID-' + i, cat: 'Janitorial', agency: 'Army' }));
    // duplicate the same id across a second pool — must not appear twice
    const dupPool = [R({ nid: '2', sol: 'PIID-2', cat: 'Janitorial', agency: 'Army' })];
    const out = rcSimilarRows(self, [pool, dupPool], 6);
    expect(out).toHaveLength(6);
    expect(new Set(out.map((r) => r.nid)).size).toBe(6); // all unique
  });

  it('returns [] when nothing matches', () => {
    const pool = [self, R({ nid: '2', sol: 'PIID-2', cat: 'Roofing', agency: 'Navy' })];
    expect(rcSimilarRows(self, [pool], 6)).toEqual([]);
  });
});
