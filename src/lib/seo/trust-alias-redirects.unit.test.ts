import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';
import { TRUST_URL_ALIASES, trustAliasRedirects } from './trust-alias-redirects';

type Redirect = { source: string; destination: string; permanent?: boolean; has?: unknown };

describe('short trust URLs no longer 404', () => {
  it('maps /trust and /security to /app/trust, /trust/enterprise to /app/trust/enterprise', () => {
    expect(TRUST_URL_ALIASES).toEqual({
      '/trust': '/app/trust',
      '/security': '/app/trust',
      '/trust/enterprise': '/app/trust/enterprise',
    });
  });

  it('is temporary (307) and scoped to getmindy.ai', () => {
    const redirects = trustAliasRedirects();
    expect(redirects).toHaveLength(3);
    expect(redirects.every((r) => r.permanent === false)).toBe(true);
    expect(redirects.every((r) => JSON.stringify(r.has) === JSON.stringify([{ type: 'host', value: 'getmindy.ai' }]))).toBe(true);
  });

  it('is wired into next.config redirects()', async () => {
    const list = (await nextConfig.redirects!()) as Redirect[];
    for (const [source, destination] of Object.entries(TRUST_URL_ALIASES)) {
      const hit = list.find((r) => r.source === source);
      expect(hit?.destination).toBe(destination);
      expect(hit?.permanent).toBe(false);
    }
  });

  it('every destination is a real page', () => {
    for (const destination of new Set(Object.values(TRUST_URL_ALIASES))) {
      expect(existsSync(join(process.cwd(), 'src/app', destination, 'page.tsx'))).toBe(true);
    }
  });
});
