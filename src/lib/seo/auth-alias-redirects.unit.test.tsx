import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';
import NotFound from '../../app/not-found';
import { AUTH_URL_ALIASES, authAliasRedirects } from './auth-alias-redirects';

type Redirect = { source: string; destination: string; permanent?: boolean; has?: unknown };

describe('typed sign-in URLs no longer 404', () => {
  it('maps /login and /sign-in to /signin, /register to /pricing', () => {
    expect(AUTH_URL_ALIASES).toEqual({
      '/login': '/signin',
      '/sign-in': '/signin',
      '/register': '/pricing',
    });
    const redirects = authAliasRedirects();
    expect(redirects.every((r) => r.permanent === false)).toBe(true);
    expect(redirects.every((r) => JSON.stringify(r.has) === JSON.stringify([{ type: 'host', value: 'getmindy.ai' }]))).toBe(true);
  });

  it('is wired into next.config redirects()', async () => {
    const list = (await nextConfig.redirects!()) as Redirect[];
    for (const [source, destination] of Object.entries(AUTH_URL_ALIASES)) {
      const hit = list.find((r) => r.source === source);
      expect(hit?.destination).toBe(destination);
      expect(hit?.permanent).toBe(false);
    }
  });

  it('every destination is a routed page', async () => {
    const rewrites = (await nextConfig.rewrites!()) as { beforeFiles: Redirect[] };
    expect(rewrites.beforeFiles.find((r) => r.source === '/signin')?.destination).toBe('/app');
    expect(() => readFileSync(join(process.cwd(), 'src/app/pricing/page.tsx'))).not.toThrow();
  });
});

describe('404 page offers a way back in', () => {
  it('links to Home, Sign in and Pricing', () => {
    const html = renderToStaticMarkup(NotFound());
    expect(html).toContain('href="/"');
    expect(html).toMatch(/href="\/signin"[^>]*>Sign in</);
    expect(html).toMatch(/href="\/pricing"[^>]*>Pricing</);
  });
});
