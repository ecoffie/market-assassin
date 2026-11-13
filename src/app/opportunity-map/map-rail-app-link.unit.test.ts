/** Eric 2026-11-13: every map rail carries an "App" link so you can go back and forth with /app. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIL_PAGES = ['route.ts', 'favorites/route.ts', 'forecasts/route.ts', 'saved/route.ts', 'market/route.ts',
  'proposal/route.ts', 'reports/route.ts', 'pursuits/route.ts', 'vault/route.ts'];

describe('map rail → app link', () => {
  for (const f of RAIL_PAGES) {
    it(`${f} rail links to /app`, () => {
      const src = readFileSync(join(__dirname, f), 'utf8');
      const start = src.indexOf('<nav class="zrail">');
      expect(start).toBeGreaterThan(-1);
      const rail = src.slice(start, src.indexOf('</nav>', start));
      expect(rail).toContain('<a href="/app" title="Mindy app');
      expect(rail).toContain('<span>App</span>');
    });
  }
});
