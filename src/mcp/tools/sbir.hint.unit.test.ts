import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('search_sbir hint does not call a failed feed a miss', () => {
  const src = readFileSync(join(process.cwd(), 'src/mcp/tools/sbir.ts'), 'utf8');

  it('degraded summary forbids treating empty as no topics', () => {
    expect(src).toContain('do not treat an empty list as "no topics exist"');
  });

  it('names live DSIP, not the sbir.gov cache, as the DoD source', () => {
    expect(src).toContain('live DoD DSIP');
    expect(src).not.toMatch(/source="dod" is served from a cache of the official sbir\.gov/);
  });
});
