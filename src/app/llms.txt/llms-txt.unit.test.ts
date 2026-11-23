import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GET } from './route';

const APP = join(process.cwd(), 'src', 'app');

/** A static path like /compare/govwin may be served by a dynamic segment such as /compare/[competitor]. */
function routeExists(path: string): boolean {
  const parts = path.split('/').filter(Boolean);
  const walk = (dir: string, i: number): boolean => {
    if (i === parts.length) return existsSync(join(dir, 'page.tsx')) || existsSync(join(dir, 'route.ts'));
    if (existsSync(join(dir, parts[i])) && walk(join(dir, parts[i]), i + 1)) return true;
    try {
      const { readdirSync } = require('node:fs') as typeof import('node:fs');
      return readdirSync(dir).some((d) => /^\[[^.]/.test(d) && walk(join(dir, d), i + 1));
    } catch { return false; }
  };
  return walk(APP, 0);
}

describe('/llms.txt', () => {
  it('is plain text with the core sections', async () => {
    const res = GET();
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const body = await res.text();
    for (const h of ['# Mindy', '## What Mindy answers', '## Key pages', '## Comparisons', '## Plans']) expect(body).toContain(h);
  });
  it('links only to routes that exist in this app', async () => {
    const body = await GET().text();
    const paths = [...body.matchAll(/\]\(https?:\/\/[^/)]+(\/[^)]*)\)/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(10);
    for (const p of paths) expect(routeExists(p), p).toBe(true);
  });
  it('states no unsourced counts', async () => {
    const body = await GET().text();
    expect(body).not.toMatch(/\b\d{1,3}(,\d{3})+\+?\b/);
  });
});
