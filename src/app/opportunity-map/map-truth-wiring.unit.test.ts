/**
 * Guards that the MAP-TRUTH CONTRACT is actually WIRED, end to end — API → client → rail.
 *
 * The contract (Eric, 2026-09-12): "The map may show only mappable rows, but Mindy must never
 * present that number as the total market truth." `map-truth-disclosure.ts` owns the wording;
 * this asserts the plumbing exists, because a correct formatter nothing calls changes nothing.
 *
 * Also pins the bug this wiring introduced once: the client block lives inside a TEMPLATE
 * LITERAL, so a backtick in a comment terminates the string and breaks the whole page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const apiSrc = readFileSync(join(__dirname, '../api/app/opportunity-map/route.ts'), 'utf8');
const clientSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('map-truth contract — API side', () => {
  it('counts unmapped rows with the SAME filters, minus the map_lat predicate', () => {
    expect(apiSrc).toContain('countUnmappedForFilters');
    // Must reuse the shared filter builder, never re-express "what matches".
    const fn = apiSrc.slice(apiSrc.indexOf('async function countUnmappedForFilters'));
    const body = fn.slice(0, fn.indexOf('\n    }'));
    expect(body).toContain("applyFilters(q, f)");
    expect(body).toContain("is('map_lat', null)");
  });

  it('returns the disclosure fields on the response', () => {
    expect(apiSrc).toContain('unmappedForFilters:');
    expect(apiSrc).toContain('marketTotalForFilters:');
  });

  it('treats an unestablished count as UNKNOWN, never 0 (Bug Prevention Rule #11)', () => {
    const fn = apiSrc.slice(apiSrc.indexOf('async function countUnmappedForFilters'));
    const body = fn.slice(0, fn.indexOf('\n    }'));
    expect(body).toContain('return null');       // error path surfaces unknown
    expect(body).not.toContain('count ?? 0');    // never fabricate a zero
  });
});

describe('map-truth contract — client side', () => {
  it('captures the API field and publishes it for the renderer', () => {
    expect(clientSrc).toContain('unmappedForFilters');
    expect(clientSrc).toContain('window.__unmappedForFilters');
  });

  it('renders the missing-rows count ON THE MAP PILL, not the killed rail subtitle', () => {
    // The rail's sumline was killed twice (Jul 26 / Jul 28) and a test enforces it stays blank;
    // the pill already answers "how much am I seeing", so the disclosure belongs there.
    const pill = clientSrc.slice(clientSrc.indexOf('function setMapCount'));
    const body = pill.slice(0, pill.indexOf('\n  }'));
    expect(body).toContain('not shown on map');
    expect(body).toContain('__unmappedForFilters');
  });

  it('says "some not mapped" rather than implying everything is mapped, when UNKNOWN', () => {
    expect(clientSrc).toContain('some not mapped');
  });

  it('stays SILENT when everything matching is mapped (no noise)', () => {
    // Only appends when the count is > 0 — never "0 not shown on map".
    const pill = clientSrc.slice(clientSrc.indexOf('function setMapCount'));
    const body = pill.slice(0, pill.indexOf('\n  }'));
    expect(body).toContain('_um>0');
  });

  it('does NOT reintroduce the killed rail subtitle (Jul 26 decision)', () => {
    expect(clientSrc).toContain("if(sum)sum.innerHTML=''");
  });

  it('REGRESSION: no backtick inside the client template literal comments', () => {
    // The client block is embedded in a template literal. A backtick in a comment terminates
    // the string and breaks the page — this happened while wiring this very feature.
    const start = clientSrc.indexOf('MAP-TRUTH CONTRACT — published for setCount()');
    expect(start).toBeGreaterThan(-1);
    const commentBlock = clientSrc.slice(start, start + 400);
    expect(commentBlock).not.toContain('`');
  });
});
