/**
 * POST-SIGNUP DESTINATION — new accounts never land on a legacy surface.
 *
 * THE REPORTED FAILURE (2026-08-25): someone clicked a referral link, signed up, and was
 * dropped into `/app/onboarding`. The cause was the DOCUMENTED FALLBACK —
 * `searchParams.get('next') || '/app/onboarding'` — repeated at five independent sites.
 */
import { describe, it, expect } from 'vitest';
import {
  resolvePostSignupDestination, postSignupPath, isLegacyDestination,
  WELCOME_PATH, MCP_SETUP_PATH,
} from './post-signup-destination';

describe('⚠️ THE REPORTED CASE — generic referral, no intent', () => {
  it('lands on /welcome, NOT /app/onboarding', () => {
    const r = resolvePostSignupDestination({});
    expect(r.path).toBe(WELCOME_PATH);
    expect(r.path).not.toContain('/app');
    expect(r.intent).toBe('unknown');
  });

  it('OAuth without a next lands on /welcome', () => {
    expect(postSignupPath({ next: null })).toBe(WELCOME_PATH);
  });

  it('email setup without a next lands on /welcome', () => {
    expect(postSignupPath({ next: '' })).toBe(WELCOME_PATH);
  });
});

describe('known intent is preserved', () => {
  it('a valid Maps next survives exactly', () => {
    const r = resolvePostSignupDestination({ next: '/opportunity-map?naics=236220&state=VA' });
    expect(r.path).toBe('/opportunity-map?naics=236220&state=VA');
    expect(r.intent).toBe('maps');
  });

  it('explicit MCP intent goes to MCP setup', () => {
    const r = resolvePostSignupDestination({ intent: 'mcp' });
    expect(r.path).toBe(MCP_SETUP_PATH);
    expect(r.intent).toBe('mcp');
  });

  it('MCP intent BEATS a generic next — they came to connect, not to be asked', () => {
    expect(postSignupPath({ intent: 'mcp', next: '/opportunity-map' })).toBe(MCP_SETUP_PATH);
  });

  it('purchase intent preserves the checkout destination', () => {
    const r = resolvePostSignupDestination({ intent: 'purchase', purchaseNext: '/checkout/pro?session=abc' });
    expect(r.path).toBe('/checkout/pro?session=abc');
    expect(r.intent).toBe('purchase');
  });

  it('purchase intent with no usable destination still avoids legacy', () => {
    expect(postSignupPath({ intent: 'purchase' })).toBe(WELCOME_PATH);
  });
});

describe('legacy destinations are never a valid outcome', () => {
  it.each(['/app', '/app/onboarding', '/app?panel=settings', '/briefings', '/briefings?email=x', '//app', '/APP/onboarding'])(
    'refuses %s as a next', (bad) => {
      const r = resolvePostSignupDestination({ next: bad });
      expect(r.path).toBe(WELCOME_PATH);
      expect(r.path).not.toMatch(/\/(app|briefings)\b/);
    });

  it('refuses a legacy purchase destination too', () => {
    expect(postSignupPath({ intent: 'purchase', purchaseNext: '/app/onboarding' })).toBe(WELCOME_PATH);
  });

  it('says WHY it refused, so the caller can log it', () => {
    expect(resolvePostSignupDestination({ next: '/app/onboarding' }).reason)
      .toMatch(/legacy surface/i);
  });

  it('isLegacyDestination identifies the retired estate', () => {
    expect(isLegacyDestination('/app')).toBe(true);
    expect(isLegacyDestination('/briefings')).toBe(true);
    expect(isLegacyDestination('/opportunity-map')).toBe(false);
    expect(isLegacyDestination('/alerts/preferences')).toBe(false);
    // A path merely CONTAINING the word is not the legacy surface.
    expect(isLegacyDestination('/my-briefings-archive')).toBe(false);
  });
});

describe('malicious or malformed next values', () => {
  it.each([
    'https://evil.com/steal',
    '//evil.com',
    '/\\evil.com',
    'javascript:alert(1)',
    '/path\\with\\backslashes',
  ])('rejects %s', (bad) => {
    const p = postSignupPath({ next: bad });
    expect(p).toBe(WELCOME_PATH);
  });

  it('rejects control characters without embedding them in source', () => {
    expect(postSignupPath({ next: `/map${String.fromCharCode(0)}` })).toBe(WELCOME_PATH);
  });

  it('is TOTAL — always returns a safe internal path', () => {
    for (const input of [{}, { next: null }, { next: undefined }, { intent: 'nonsense' }, { next: '   ' }]) {
      const p = postSignupPath(input as never);
      expect(p.startsWith('/')).toBe(true);
      expect(p).not.toMatch(/^\/\//);
      expect(p).not.toMatch(/\/(app|briefings)\b/);
    }
  });
});

describe('the five call sites use the shared resolver', () => {
  const read = (p: string) => require('node:fs').readFileSync(p, 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
                                .replace(/^([^\n]*?)\/\/.*$/gm, '$1');

  it.each([
    ['src/app/app/auth/callback/route.ts', 'postSignupPath'],
    ['src/app/app/setup-password/page.tsx', 'postSignupPath'],
    ['src/app/app/page.tsx', 'WELCOME_PATH'],
  ])('%s calls the resolver', (file, symbol) => {
    const code = strip(read(file));
    expect(code).toContain(symbol);
    // and no longer carries its own legacy default
    expect(code).not.toMatch(/\|\|\s*'\/app\/onboarding'/);
  });

  it('AlertsPanel no longer points setup at the legacy builder', () => {
    expect(strip(read('src/components/app/panels/AlertsPanel.tsx'))).not.toContain("'/app/onboarding'");
  });
});
