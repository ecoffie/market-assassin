/**
 * SBIR/STTR search is retired on EVERY customer-facing surface (2026-09-26) — and the shared
 * libraries/data stay. Drives the real /api/sbir handler; guards the rest at the source so an
 * entry point cannot quietly come back.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { SBIR_SEARCH_RETIRED, sbirSearchRetiredBody, sbirSearchRetiredMessage } from './retired';
import { RETIRED_TOOLS } from '@/lib/mcp/retired-tools';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Strip comments so a retirement note that NAMES the old thing is not mistaken for the thing. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('/api/sbir — direct API access', () => {
  it.each(['GET', 'POST'] as const)('%s answers 410 Gone with the shared retirement notice', async (method) => {
    const route = await import('@/app/api/sbir/route');
    const res = await route[method]();
    expect(res.status).toBe(410);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual(sbirSearchRetiredBody());
    expect(body).toMatchObject({ success: false, retired: true, code: 'sbir_search_retired', retired_on: '2026-09-26' });
    expect(body.message).toMatch(/retired on 2026-09-26/);
  });

  it('reads no data at all (no Supabase/NIH access left in the handler)', () => {
    const src = code('src/app/api/sbir/route.ts');
    expect(src).not.toMatch(/supabase|reporter\.nih\.gov|fetch\(/i);
  });
});

describe('in-app panel — no navigation or entry point', () => {
  it('the SBIR panel component is gone and nothing imports it', () => {
    expect(existsSync(join(ROOT, 'src/components/briefings/SbirPanel.tsx'))).toBe(false);
    expect(read('src/app/briefings/page.tsx')).not.toContain('SbirPanel');
  });
  it('the sidebar has no SBIR/STTR item', () => {
    expect(code('src/components/UnifiedSidebar.tsx')).not.toMatch(/panel:\s*'sbir'/);
  });
  it('the stats-bar tab no longer routes to the SBIR panel; a residual path shows the retired notice', () => {
    const page = code('src/app/briefings/page.tsx');
    expect(page).not.toMatch(/setActivePanel\('sbir'\)/);
    expect(page).toContain('sbirSearchRetiredMessage()');
  });
  it('upgrade copy no longer sells SBIR/STTR', () => {
    const page = code('src/app/briefings/page.tsx');
    expect(page).not.toMatch(/SBIR\/STTR intel|Forecasts, SBIR\/STTR/);
  });
});

describe('other customer-facing surfaces', () => {
  it('Opportunity Map: never serves SBIR pins, never requests them, no SBIR source filter', () => {
    const api = code('src/app/api/app/opportunity-map/route.ts');
    expect(api).toMatch(/function wantSbirSources\(_raw: string \| null\): boolean \{\s*return false;\s*\}/);
    expect(code('src/app/opportunity-map/route.ts')).not.toContain("'sam,sbir'");
    expect(read('src/app/opportunity-map/template.html')).not.toContain('items=["SAM","RECOMPETE","DLA","SBIR"]');
    expect(read('src/app/opportunity-map/template-html.ts')).not.toContain('items=[\\"SAM\\",\\"RECOMPETE\\",\\"DLA\\",\\"SBIR\\"]');
  });
  it('/api/market-scan: SBIR is never fetched and the response says it is retired', () => {
    const src = code('src/app/api/market-scan/route.ts');
    expect(src).toMatch(/const includeSbir = false;/);
    expect(src).toMatch(/sbir:\s*\{\s*retired:\s*true/);
  });
  it('Mindy Chat no longer claims SBIR/STTR search and says where to go instead', () => {
    const chat = read('src/app/api/app/chat/route.ts');
    expect(chat).not.toMatch(/IDV\/GWAC vehicles, grants, SBIR\/STTR\./);
    expect(chat).toMatch(/Mindy's dedicated SBIR\/STTR open-topic search is NOT available/);
  });
  it('marketing copy no longer advertises SBIR search', () => {
    expect(code('src/app/market-intelligence/page.tsx')).not.toMatch(/Forecasts, SBIR, Grants/);
    expect(code('src/app/agencies/page.tsx')).not.toMatch(/NIH RePORTER,\s*SBIR\/STTR/);
  });
});

describe('one notice, every surface; shared code and data kept', () => {
  it('MCP retirement reuses the shared notice', () => {
    expect(RETIRED_TOOLS.search_sbir).toMatchObject({
      retired_on: SBIR_SEARCH_RETIRED.retired_on,
      reason: SBIR_SEARCH_RETIRED.reason,
      instead: SBIR_SEARCH_RETIRED.instead,
    });
    expect(sbirSearchRetiredMessage()).toMatch(/SBIR\.gov/);
  });
  it('shared SBIR/NIH libraries are preserved', () => {
    for (const f of ['src/lib/sbir/search.ts', 'src/lib/sbir/dod-sbir.ts', 'src/lib/sbir/sbir-map-pins.ts', 'src/lib/scrapers/apis/nih-reporter.ts', 'src/app/api/cron/sync-dod-sbir/route.ts']) {
      expect(existsSync(join(ROOT, f)), f).toBe(true);
    }
  });
});
