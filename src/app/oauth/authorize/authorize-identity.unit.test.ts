import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('/oauth/authorize does not stick on Loading…', () => {
  it('server page reads the cookie and passes initialEmail', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/oauth/authorize/page.tsx'), 'utf8');
    expect(src).toContain('getMindySessionFromCookies');
    expect(src).toContain('AuthorizeClient');
    expect(src).not.toContain("'use client'");
  });

  it('client has a loading timeout and an error fallback, and no /app identity links', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/oauth/authorize/AuthorizeClient.tsx'), 'utf8');
    expect(src).toContain('8000');
    expect(src).toContain("setStage('error')");
    expect(src).toContain('mindySignInUrl');
    expect(src).not.toMatch(/href=["']\/app/);
    expect(src).not.toMatch(/href=["']\/app\?/);
  });
});
