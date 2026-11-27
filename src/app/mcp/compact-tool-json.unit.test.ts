/**
 * Customer MCP endpoints send tool results as COMPACT JSON (Ask Mindy Backend Spec, result size limits).
 * Pretty-printing (2-space indent) added ~27% to every tool response — measured on find_opportunities at
 * 25 rows per horizon: 126,497 → 92,098 characters, same data and keys. The stdio dev server is not a
 * customer surface and is not covered here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('customer MCP endpoints serialize tool results compactly', () => {
  it.each(['src/app/mcp/[transport]/route.ts', 'src/app/chatgpt/mcp/route.ts'])('%s has no pretty-printed tool result', (p) => {
    const src = read(p);
    expect(src).not.toMatch(/text:\s*JSON\.stringify\([^)]*,\s*null,\s*2\)/);
    expect(src).toMatch(/text:\s*JSON\.stringify\((result|projected)\)/);
  });

  it('compact JSON carries exactly the same data', () => {
    const sample = { horizons: { open_now: { items: [{ title: 'X', notice_id: 'n1', set_aside: null }] } }, _meta: { grounded: true } };
    expect(JSON.parse(JSON.stringify(sample))).toEqual(JSON.parse(JSON.stringify(sample, null, 2)));
    expect(JSON.stringify(sample).length).toBeLessThan(JSON.stringify(sample, null, 2).length);
  });
});
