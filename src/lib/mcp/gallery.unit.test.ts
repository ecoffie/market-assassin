import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GALLERY_CATEGORIES, GALLERY_ITEMS } from './gallery';
import { GALLERY_PROMPTS } from './gallery-prompts';

describe('Mindy in your AI gallery', () => {
  it('every card has a prompt, and every prompt has a card', () => {
    const ids = GALLERY_ITEMS.map((i) => i.id).sort();
    expect(Object.keys(GALLERY_PROMPTS).sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every card is in a real category', () => {
    const cats = new Set(GALLERY_CATEGORIES.map((c) => c.id));
    for (const i of GALLERY_ITEMS) expect(cats.has(i.category), i.id).toBe(true);
  });

  it('public card data never carries prompt text or credit amounts', () => {
    const pub = JSON.stringify(GALLERY_ITEMS);
    for (const p of Object.values(GALLERY_PROMPTS)) expect(pub).not.toContain(p.slice(0, 40));
    expect(pub).not.toMatch(/\bcredits?\b/i);
  });

  it('only the signed-in API route imports the prompts', () => {
    const page = readFileSync(join(__dirname, '../../app/mcp/gallery/page.tsx'), 'utf8');
    const client = readFileSync(join(__dirname, '../../app/mcp/gallery/Gallery.tsx'), 'utf8');
    expect(page).not.toContain('gallery-prompts');
    expect(client).not.toContain('gallery-prompts');
    const route = readFileSync(join(__dirname, '../../app/api/mcp/gallery/prompts/route.ts'), 'utf8');
    expect(route).toContain('resolveMcpEmail');
  });
});
