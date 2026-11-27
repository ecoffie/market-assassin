/**
 * Eric, 2026-11-27: "remove playbook from pricing". The winning playbook was unlisted from the public MCP catalog
 * (#2535), so no public pricing copy may offer it, and every plan-finder task must be priced from public tools.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isPublicMcpTool } from '@/lib/mcp/public-catalog-config';

const DIR = join(process.cwd(), 'src/components/public-site/pricing');
const sources = readdirSync(DIR).filter((f) => /\.(tsx?|ts)$/.test(f) && !/\.test\./.test(f));

describe('public pricing copy', () => {
  it('no pricing component or the package list mentions a playbook', () => {
    for (const f of [...sources.map((s) => join(DIR, s)), join(process.cwd(), 'src/lib/mcp/packages.ts')]) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/playbook/i);
    }
  });
  it('every plan-finder task is priced from tools that are in the public catalog', () => {
    const src = readFileSync(join(DIR, 'UnifiedPricing.tsx'), 'utf8');
    const start = src.indexOf('= [', src.indexOf('const TASKS'));
    const block = src.slice(start, src.indexOf('\n];', start));
    const tools = [...block.matchAll(/tools: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) expect(isPublicMcpTool(t), t).toBe(true);
  });
});
