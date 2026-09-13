import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('/mcp identity is server-rendered from the cookie', () => {
  it('page.tsx is a server wrapper that reads getMindySessionFromCookies', () => {
    const src = read('src/app/mcp/page.tsx');
    expect(src).not.toContain("'use client'");
    expect(src).toContain('getMindySessionFromCookies');
    expect(src).toContain('McpConnectClient');
    expect(src).toContain('force-dynamic');
  });

  it('signed-in chrome is Connect Claude / Connect ChatGPT, not Sign in to connect', () => {
    const src = read('src/app/mcp/McpConnectClient.tsx');
    expect(src).toContain('Mindy account recognized');
    expect(src).toContain('Connect Claude');
    expect(src).toContain('Connect ChatGPT');
    expect(src).not.toContain('Sign in to connect');
    expect(src).not.toMatch(/href=["']\/app/);
    expect(src).not.toContain("authState === 'loading'");
  });

  it('setup page reads the cookie so nav is not always Sign in', () => {
    const src = read('src/app/mcp/setup/page.tsx');
    expect(src).toContain('getMindySessionFromCookies');
    expect(src).toContain('signedIn={session.signedIn}');
    expect(src).toContain('signInNext="/mcp/setup"');
  });

  it('no identity branch returns null', () => {
    const src = read('src/app/mcp/McpConnectClient.tsx');
    expect(src).not.toMatch(/if\s*\(\s*!signedIn\s*\)\s*return\s+null/);
    expect(src).not.toMatch(/if\s*\(\s*authState\s*===?\s*['"]loading['"]\s*\)\s*return\s+null/);
  });
});
