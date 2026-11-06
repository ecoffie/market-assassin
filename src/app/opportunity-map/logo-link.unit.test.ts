import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The map's centered Mindy logo once had href="${MAPS_HOME_PATH}" inside a single-quoted
// string, so the browser got the literal text and the click went nowhere.
describe('map header logo', () => {
  const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');
  it('links to the homepage', () => {
    expect(src).toContain('<a href="/" title="Mindy home" class="zh-logo">');
  });
  it('never ships an uninterpolated ${...} in an href inside a quoted string', () => {
    const bad = src.split('\n').filter((l) => /^\s*\+?\s*'[^`]*href="\$\{/.test(l));
    expect(bad).toEqual([]);
  });
});
