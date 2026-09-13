/**
 * Universal OAuth callback — PKCE mint + safe next, never /app.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { createMIAuthSessionToken, verifyTwoFactorSessionToken } from '@/lib/two-factor-session';
import { MI_AUTH_COOKIE } from './mi-auth-constants';
import {
  MINDY_OAUTH_NEXT_KEY,
  OAUTH_CALLBACK_PATH,
  PKCE_VERIFIER_COOKIE,
  oauthCallbackUrl,
  oauthFragmentConsumerHtml,
  oauthFragmentConsumerScript,
  readPkceVerifier,
} from './oauth-callback';
import { handleOAuthCallbackRequest } from './oauth-callback-handler';
import { WELCOME_PATH } from './post-signup-destination';

beforeAll(() => {
  process.env.TWO_FACTOR_SECRET = 'oauth-callback-unit-test-secret';
});

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^([^\n]*?)\/\/.*$/gm, '$1');

function cookieFromSetCookie(header: string | null, name: string): string {
  if (!header) return '';
  const parts = header.split(/,(?=\s*[^;=]+=)/);
  for (const part of parts) {
    const first = part.trim().split(';')[0] || '';
    const eq = first.indexOf('=');
    if (eq === -1) continue;
    if (first.slice(0, eq).trim() === name) return first.slice(eq + 1);
  }
  return '';
}

function req(url: string, cookie?: string) {
  return new NextRequest(url, {
    headers: cookie ? { cookie } : undefined,
  });
}

const mint = (email: string) => createMIAuthSessionToken(email);

async function finish(
  url: string,
  opts: {
    exchange?: (code: string, verifier: string) => Promise<{ email: string } | { error: string }>;
    cookie?: string;
    existingEmail?: string | null;
  } = {},
) {
  const exchange = opts.exchange ?? (async () => ({ email: 'user@example.com' }));
  return handleOAuthCallbackRequest(req(url, opts.cookie ?? `${PKCE_VERIFIER_COOKIE}=test-verifier`), {
    exchange,
    mint,
    existingEmail: opts.existingEmail,
  });
}

function assertSafeSignedIn(res: Response, dest: string | RegExp) {
  const location = res.headers.get('location') || '';
  if (typeof dest === 'string') expect(location).toBe(dest);
  else expect(location).toMatch(dest);
  expect(location).not.toContain('/app');
  expect(location).not.toContain('access_token');
  expect(location).not.toContain('code=');
  const raw = res.headers.get('set-cookie') || '';
  expect(raw).toContain(`${MI_AUTH_COOKIE}=`);
  const token = cookieFromSetCookie(raw, MI_AUTH_COOKIE);
  expect(verifyTwoFactorSessionToken(token).valid).toBe(true);
}

describe('oauthCallbackUrl', () => {
  it('points at /auth/callback, never /app or bare /', () => {
    const url = oauthCallbackUrl('https://getmindy.ai', { next: '/' });
    expect(url).toBe('https://getmindy.ai/auth/callback?next=%2F');
    expect(url).toContain(OAUTH_CALLBACK_PATH);
    expect(url).not.toContain('/app');
    expect(url).not.toMatch(/getmindy\.ai\/\?/);
  });

  it('Google and Microsoft share the same contract', () => {
    const google = oauthCallbackUrl('https://getmindy.ai', { next: '/mcp' });
    const microsoft = oauthCallbackUrl('https://getmindy.ai', { next: '/mcp' });
    expect(google).toBe(microsoft);
    expect(google).toBe('https://getmindy.ai/auth/callback?next=%2Fmcp');
  });
});

describe('readPkceVerifier', () => {
  it('strips a supabase-js PASSWORD_RECOVERY suffix', () => {
    expect(readPkceVerifier('abc123/PASSWORD_RECOVERY')).toBe('abc123');
    expect(readPkceVerifier(encodeURIComponent('xyz'))).toBe('xyz');
    expect(readPkceVerifier('')).toBeNull();
  });
});

describe('PKCE callback — Google + Microsoft destinations', () => {
  for (const provider of ['google', 'microsoft'] as const) {
    it(`${provider} + next=/ → / and Set-Cookie mi_auth`, async () => {
      const res = await finish(`https://getmindy.ai/auth/callback?code=${provider}-home&next=/`);
      expect(res.status).toBe(307);
      assertSafeSignedIn(res, 'https://getmindy.ai/');
    });

    it(`${provider} + next=/mcp → /mcp and Set-Cookie mi_auth`, async () => {
      const res = await finish(`https://getmindy.ai/auth/callback?code=${provider}-mcp&next=/mcp`);
      expect(res.status).toBe(307);
      assertSafeSignedIn(res, 'https://getmindy.ai/mcp');
    });
  }

  it('missing next → /welcome', async () => {
    const res = await finish('https://getmindy.ai/auth/callback?code=none');
    assertSafeSignedIn(res, `https://getmindy.ai${WELCOME_PATH}`);
  });

  it('unsafe /app next → /welcome', async () => {
    const res = await finish('https://getmindy.ai/auth/callback?code=legacy&next=/app/onboarding');
    assertSafeSignedIn(res, `https://getmindy.ai${WELCOME_PATH}`);
    expect(res.headers.get('location')).not.toContain('/app');
  });

  it('external URL next is rejected', async () => {
    const res = await finish('https://getmindy.ai/auth/callback?code=ext&next=https://evil.com');
    assertSafeSignedIn(res, `https://getmindy.ai${WELCOME_PATH}`);
    expect(res.headers.get('location')).not.toContain('evil.com');
  });
});

describe('OAuth result is consumed exactly once', () => {
  it('second use of the same code does not remint or keep tokens in Location', async () => {
    let used = 0;
    const exchange = async () => {
      used += 1;
      if (used > 1) return { error: 'already_used' };
      return { email: 'once@example.com' };
    };
    const url = 'https://getmindy.ai/auth/callback?code=ONCE&next=/';
    const first = await finish(url, { exchange });
    assertSafeSignedIn(first, 'https://getmindy.ai/');
    expect(first.headers.get('location')).not.toContain('ONCE');

    const second = await finish(url, { exchange });
    const loc = second.headers.get('location') || '';
    expect(loc).toContain('/signin');
    expect(loc).not.toContain('access_token');
    expect(loc).not.toContain('code=ONCE');
    expect(loc).not.toContain('/app');
    expect(used).toBe(2);
  });
});

describe('no credentials remain after completion', () => {
  it('success Location has no hash token and no OAuth code', async () => {
    const res = await finish('https://getmindy.ai/auth/callback?code=secret-code&next=/mcp');
    const loc = res.headers.get('location') || '';
    expect(loc).toBe('https://getmindy.ai/mcp');
    expect(loc).not.toMatch(/access_token|#|code=/);
  });

  it('already-minted cookie + next=/ applies dest without reminting tokens into the URL', async () => {
    const res = await handleOAuthCallbackRequest(
      req('https://getmindy.ai/auth/callback?next=/'),
      { existingEmail: 'maps@example.com', mint, exchange: async () => ({ error: 'unused' }) },
    );
    expect(res.headers.get('location')).toBe('https://getmindy.ai/');
    expect(res.headers.get('location')).not.toContain('/app');
    expect(res.headers.get('location')).not.toContain('code=');
  });
});

describe('implicit leftover consumer', () => {
  it('GET without code returns HTML that clears the hash and mints via mindy-session', async () => {
    const res = await handleOAuthCallbackRequest(req('https://getmindy.ai/auth/callback?next=/'), {
      existingEmail: null,
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('access_token');
    expect(html).toContain('history.replaceState');
    expect(html).toContain('/api/auth/mindy-session');
    expect(html).toContain(OAUTH_CALLBACK_PATH);
    expect(html).not.toContain('/app');
    expect(oauthFragmentConsumerHtml()).toContain(oauthFragmentConsumerScript());
    expect(oauthFragmentConsumerScript()).toContain(MINDY_OAUTH_NEXT_KEY);
  });
});

describe('no /app in the Google/Microsoft callback chain', () => {
  const files = [
    'src/lib/supabase/auth.ts',
    'src/app/signin/SignInClient.tsx',
    'src/app/opportunity-map/login-modal.ts',
    'src/app/app/page.tsx',
    'src/lib/supabase/client.ts',
    'next.config.ts',
  ];

  it('redirectTo / hrefs use /auth/callback and do not contain /app', () => {
    for (const file of files) {
      const src = strip(read(file));
      if (file.endsWith('auth.ts') || file.endsWith('SignInClient.tsx') || file.endsWith('page.tsx')) {
        expect(src, file).toContain('/auth/callback');
        expect(src, file).not.toContain('/app/auth/callback');
      }
      if (file.endsWith('login-modal.ts')) {
        expect(src, file).toContain('/auth/callback');
        expect(src, file).not.toContain('/app/auth/callback');
        expect(src, file).not.toMatch(/location\.href='\/app\?/);
      }
    }
  });

  it('next.config does not rewrite /auth/callback to /app', () => {
    const cfg = strip(read('next.config.ts'));
    expect(cfg).not.toMatch(/source:\s*'\/auth\/callback'[\s\S]{0,200}destination:\s*'\/app\/auth\/callback'/);
  });

  it('browser supabase client uses PKCE', () => {
    const src = strip(read('src/lib/supabase/client.ts'));
    expect(src).toMatch(/flowType:\s*'pkce'/);
  });

  it('/today injects the fragment consumer as Site URL fallback', () => {
    const today = strip(read('src/app/today/route.ts'));
    expect(today).toContain('oauthFragmentConsumerScript');
  });
});
