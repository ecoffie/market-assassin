/**
 * DashboardPanel — Rules of Hooks guard + best-fit impression semantics.
 *
 * THE HOOKS HALF is the same guard Eric added for TargetingCard after PR #948 crashed
 * /app for every signed-in user (React #310, "rendered more hooks than during the
 * previous render"). That bug was a hook placed AFTER an early return. This file adds
 * the identical static check to DashboardPanel, which has its own
 * `if (!email) return null;` and now carries impression hooks above it.
 *
 * tsc, a green next build, and source-assert tests ALL passed while #310 was live —
 * a hooks-order violation is a runtime error none of them catch. ESLint's
 * react-hooks/rules-of-hooks does catch it; this is the belt to that braces.
 *
 * THE IMPRESSION HALF exists because clicks were tracked and shows were not. 30 days
 * of todays_intel telemetry read: dismiss 57, track_in_pipeline 34, open_source 19,
 * feedback 18 — and zero impressions. 19 opens is excellent against 100 items shown
 * and dead against 10,000, so "is best-fit working?" could not be answered at all.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const rawSrc = readFileSync(join(__dirname, 'DashboardPanel.tsx'), 'utf8');

// Strip comments FIRST. This file documents the #310 incident in prose that names the
// guard line and the hook names, which would otherwise fool a substring scan — the same
// trap Eric's TargetingCard guard calls out. Blank comment lines (preserving line
// numbers) and blank out block comments.
const noBlock = rawSrc.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const src = noBlock
  .split('\n')
  .map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\/\/.*$/, '')))
  .join('\n');

const compStart = src.indexOf('export default function DashboardPanel(');
const body = src.slice(compStart);
const lines = body.split('\n');

describe('every hook runs before the early-return guard (React #310)', () => {
  it('the `if (!email) return null;` guard exists', () => {
    expect(body).toMatch(/if \(!email\) return null;/);
  });

  it('NO hook call sits below that guard', () => {
    const guardLine = lines.findIndex((l) => /if \(!email\) return null;/.test(l));
    expect(guardLine).toBeGreaterThan(-1);

    const HOOK = /\b(useState|useEffect|useCallback|useMemo|useRef|useLayoutEffect|useReducer|useContext)\s*\(/;
    const offenders = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l, i }) => i > guardLine && HOOK.test(l))
      .map(({ l, i }) => `line +${i}: ${l.trim().slice(0, 90)}`);

    expect(offenders, `hooks below the early return crash /app with React #310:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('the impression hooks specifically are above the guard', () => {
    const guardLine = lines.findIndex((l) => /if \(!email\) return null;/.test(l));
    const refLine = lines.findIndex((l) => /impressionKeyRef\s*=\s*useRef/.test(l));
    expect(refLine).toBeGreaterThan(-1);
    expect(refLine).toBeLessThan(guardLine);
  });
});

describe('impressions are counted once per item SET, not per render', () => {
  it('dedupes on the joined item ids', () => {
    // A filter change or a search keystroke re-renders the list. Firing per render
    // would inflate the denominator and make engagement look WORSE than it is —
    // the opposite of the error we want when deciding a surface's fate.
    expect(body).toMatch(/impressionKeyRef\.current === key/);
    expect(body).toMatch(/ids\.join\('\|'\)/);
  });

  it('sends nothing when the list is empty', () => {
    // An empty state is not an impression; counting it would dilute the rate.
    expect(body).toMatch(/filteredItems\.length === 0\) return/);
  });

  it('records the count, the active filter, and whether a search was applied', () => {
    // Without these the denominator is unattributable: 200 impressions under a
    // filter is a different surface than 200 unfiltered.
    expect(body).toMatch(/action: 'items_shown'/);
    expect(body).toContain('count: ids.length');
    expect(body).toContain('filter: activeFilter');
    expect(body).toMatch(/searched: Boolean\(searchTerm/);
  });

  it('caps the id list so the payload stays small', () => {
    // The ranking question only needs the head of the list.
    expect(body).toMatch(/ids\.slice\(0, 10\)/);
  });

  it('is fire-and-forget — a metric must never break the dashboard', () => {
    const fn = body.slice(body.indexOf('items_shown') - 1200, body.indexOf('items_shown') + 900);
    expect(fn).toContain('keepalive: true');
    expect(fn).toMatch(/\.catch\(\(\) => \{\}\)/);
  });
});

describe('clicks carry rank, so they line up with the impression', () => {
  it('trackItemEvent derives a 1-based rank from the rendered order', () => {
    expect(body).toMatch(/filteredItemsRef\.current\.indexOf\(item\.id\)/);
    expect(body).toMatch(/idx >= 0 \? idx \+ 1 : undefined/);
  });

  it('omits rank rather than sending a wrong one when the item is not in view', () => {
    // A dismissed item leaves filteredItems; sending rank 0 or -1 would corrupt the
    // "do they click the top?" analysis. Absent is honest, zero is a lie.
    expect(body).toMatch(/\.\.\.\(typeof rank === 'number' \? \{ rank \} : \{\}\)/);
  });

  it('keeps the rendered-order ref in sync where impressions are computed', () => {
    expect(body).toMatch(/filteredItemsRef\.current = ids;/);
  });
});
