import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/tool-errors', () => ({
  logToolError: vi.fn(() => Promise.resolve()),
  ToolNames: { AUTH_OAUTH: 'auth_oauth' },
  ErrorTypes: { VALIDATION: 'validation' },
}));

import { NextRequest } from 'next/server';
import { GET } from './route';

describe('/app/auth/callback native bounce', () => {
  it('web sign-in is unchanged (no bounce)', async () => {
    const res = await GET(new NextRequest('https://getmindy.ai/app/auth/callback?next=%2Fwelcome'));
    expect(new URL(res.headers.get('location')!).pathname).not.toBe('/app/auth/native-return');
  });

  it('native=1 bounces to native-return and drops the flag', async () => {
    const res = await GET(new NextRequest('https://getmindy.ai/app/auth/callback?native=1&next=%2Fwelcome'));
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/app/auth/native-return');
    const to = loc.searchParams.get('to')!;
    expect(to.startsWith('/')).toBe(true);
    expect(to).not.toContain('native=');
  });

  it('native OAuth errors also come back to the app', async () => {
    const res = await GET(new NextRequest('https://getmindy.ai/app/auth/callback?native=1&error=access_denied&error_description=nope'));
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/app/auth/native-return');
    expect(loc.searchParams.get('to')!.startsWith('/app/sign-in-help')).toBe(true);
  });
});
