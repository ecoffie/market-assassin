import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifySearchFailure, isStatementTimeout, SEARCH_TOO_LONG_MESSAGE } from './search-failure';

/**
 * Long searches (Agent 3, 2026-11-14): four benchmark paragraphs hit Postgres's statement timeout every time and the
 * Map answered HTTP 500 with "canceling statement due to statement timeout". Safe handling only: a clear, actionable
 * failure, never an empty result. Gate A2 (the timeout itself) is NOT fixed by this.
 */
describe('classifySearchFailure', () => {
  it('a statement timeout (code 57014 or its message) is search_too_long, 503, actionable, and says it is not zero', () => {
    for (const e of [{ code: '57014', message: 'canceling statement due to statement timeout' }, new Error('canceling statement due to statement timeout')]) {
      expect(isStatementTimeout(e)).toBe(true);
      const f = classifySearchFailure(e);
      expect(f).toEqual({ code: 'search_too_long', message: SEARCH_TOO_LONG_MESSAGE, status: 503 });
    }
    expect(SEARCH_TOO_LONG_MESSAGE).toMatch(/not zero results/);
    expect(SEARCH_TOO_LONG_MESSAGE).toMatch(/Shorten/);
  });
  it('any other failure keeps its message and stays a 500', () => {
    expect(classifySearchFailure(new Error('connection reset'))).toEqual({ code: 'query_failed', message: 'connection reset', status: 500 });
  });
});

describe('wiring: the failure reaches the person, and never as an empty map', () => {
  const api = readFileSync(join(process.cwd(), 'src/app/api/app/opportunity-map/route.ts'), 'utf8');
  const client = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');
  const tmpl = readFileSync(join(process.cwd(), 'src/app/opportunity-map/template.html'), 'utf8');
  const find = readFileSync(join(process.cwd(), 'src/lib/opportunities/find-opportunities.ts'), 'utf8');
  it('the Map API returns success:false with error_code from the classifier (no raw 500 text)', () => {
    expect(api).not.toContain("error: (e as Error).message }, { status: 500 }");
    expect(api).toContain('error_code: f.code');
  });
  it('the client keeps the reason, and a too-long search is announced even over earlier results', () => {
    expect(client).toContain("reason:(d&&d.error_code)||null");
    const tooLong = client.indexOf("if(_allFailed&&_tooLong)");
    const generic = client.indexOf("if(_allFailed){ if(!_haveRender");
    expect(tooLong).toBeGreaterThan(-1);
    expect(tooLong).toBeLessThan(generic);
    expect(tmpl).toContain('Search too long to run');
    expect(tmpl).toContain('The cards below are from your previous search, not this one.');
  });
  it('FIND reports search_too_long as unavailable (never zero)', () => {
    expect(find).toContain("class: 'search_too_long'");
    expect(find).toContain("semantics_note: 'Source unavailable — do not treat as zero matches.'");
  });
});
