import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mindySignInUrl, mindySignUpUrl, UNIVERSAL_SIGNIN_PATH } from './universal-signin';
import { safeNext, isSafeNext } from './safe-next';

describe('universal sign-in URL', () => {
  it('is /signin, never /app', () => {
    expect(UNIVERSAL_SIGNIN_PATH).toBe('/signin');
    expect(mindySignInUrl('/mcp')).toBe('/signin?next=%2Fmcp');
    expect(mindySignInUrl('/mcp/setup')).toBe('/signin?next=%2Fmcp%2Fsetup');
    expect(mindySignInUrl('/')).toBe('/signin?next=%2F');
    expect(mindySignInUrl('/today')).toBe('/signin?next=%2Ftoday');
    expect(mindySignUpUrl('/mcp')).toContain('/signin');
    expect(mindySignInUrl('/mcp')).not.toContain('/app');
  });

  it('preserves safe next=/mcp and next=/mcp/setup', () => {
    expect(isSafeNext('/mcp')).toBe(true);
    expect(isSafeNext('/mcp/setup')).toBe(true);
    expect(safeNext('/mcp')).toBe('/mcp');
    expect(safeNext('/mcp/setup')).toBe('/mcp/setup');
    expect(safeNext('/app?next=/mcp')).not.toBe('/app?next=/mcp');
  });
});

describe('MCP surfaces do not send identity to /app', () => {
  const files = [
    'src/app/mcp/catalog-ui.tsx',
    'src/app/mcp/McpConnectClient.tsx',
    'src/app/mcp/account/page.tsx',
    'src/app/mcp/pricing/page.tsx',
    'src/app/oauth/authorize/AuthorizeClient.tsx',
  ];
  for (const file of files) {
    it(`${file} has no href="/app" identity link`, () => {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src).not.toMatch(/href=["']\/app["'?]/);
      expect(src).not.toMatch(/href=["']\/app\?/);
      expect(src).not.toMatch(/location\.href = ['"]\/app['"]/);
    });
  }
});
