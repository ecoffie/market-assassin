/**
 * Eric (2026-11-27): no unsourced numbers. The /mcp/gallery previews are SAMPLES, so every one carries an
 * "Example output (illustrative)" tag, and no stat-like figure is pinned to a REAL agency or market unless
 * its source is named. Fictional companies keep illustrative figures; real buyers become "Agency A".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GALLERY_ITEMS } from './gallery';

const REAL_AGENCIES = ['Army', 'Air Force', 'Navy', 'DHS', 'Energy', 'NASA', 'Interior', 'VA', 'USDA', 'Labor', 'DoD'];

describe('gallery previews are labelled examples with no unsourced real-entity stats', () => {
  it('every preview renders the "Example output (illustrative)" tag', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/mcp/gallery/Gallery.tsx'), 'utf8');
    const preview = src.slice(src.indexOf('function Preview('), src.indexOf('function Body('));
    expect(preview).toContain('Example output (illustrative)');
  });

  it('no bar/report figure is attached to a real agency name', () => {
    const offenders: string[] = [];
    for (const it of GALLERY_ITEMS) {
      const p = it.preview as Record<string, unknown>;
      for (const key of ['bars', 'agencies']) {
        for (const b of (p[key] as Array<{ label: string }> | undefined) ?? []) {
          if (REAL_AGENCIES.includes(b.label)) offenders.push(`${it.id}: ${b.label}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the removed claims stay removed, and a kept official figure names its source', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/mcp/gallery.ts'), 'utf8');
    for (const gone of ['Most buys under $250K', '41% of spend', '$243M', '$1.3B', '$412M', '30% of the work', 'usually a sub', '14 small buys a year', 'most of its spend here is bundled', "'2.1%'", '$2M VA contract', 'grew to $40M', '12 Army awards']) {
      expect(src).not.toContain(gone);
    }
    expect(src).toContain('(FAR 19.502-2)');
    expect(src).toContain("federal goal for women-owned small businesses (15 U.S.C. 644(g))");
  });
});
