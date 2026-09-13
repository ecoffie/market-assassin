import { beforeAll, describe, expect, it } from 'vitest';
import { createMIAuthSessionToken } from '@/lib/two-factor-session';
import {
  accountAvatarInnerHtml,
  accountMenuAriaLabel,
  decodeMiTokenEmail,
  initialsFromIdentity,
} from './account-avatar';

beforeAll(() => {
  process.env.TWO_FACTOR_SECRET = 'account-avatar-unit-test-secret';
});

describe('initialsFromIdentity', () => {
  it('uses the name when present (Eric Coffie → EC)', () => {
    expect(initialsFromIdentity('Eric Coffie', 'eric@govcongiants.com')).toBe('EC');
  });

  it('uses the first letter of the email local part (eric@… → E)', () => {
    expect(initialsFromIdentity('', 'eric@govcongiants.com')).toBe('E');
    expect(initialsFromIdentity(null, 'eric@govcongiants.com')).toBe('E');
  });

  it('uses two letters only when the local part is first.last', () => {
    expect(initialsFromIdentity('', 'eric.coffie@govcongiants.com')).toBe('EC');
  });

  it('never returns "?" when identity is missing', () => {
    expect(initialsFromIdentity('', '')).toBe('');
    expect(initialsFromIdentity(null, null)).toBe('');
    expect(initialsFromIdentity(undefined, undefined)).toBe('');
  });
});

describe('accountMenuAriaLabel', () => {
  it('names the user, not help', () => {
    expect(accountMenuAriaLabel('Eric Coffie', 'eric@x.com')).toBe('Account menu, Eric Coffie');
    expect(accountMenuAriaLabel('', 'eric@govcongiants.com')).toBe('Account menu, eric');
    expect(accountMenuAriaLabel('', '')).toBe('Account menu');
    expect(accountMenuAriaLabel('', '')).not.toMatch(/help/i);
  });
});

describe('decodeMiTokenEmail', () => {
  it('reads email from a 2-part HMAC token (payload.sig)', () => {
    const token = createMIAuthSessionToken('eric@govcongiants.com');
    expect(token.split('.').length).toBe(2);
    expect(decodeMiTokenEmail(token)).toBe('eric@govcongiants.com');
  });

  it('reads email from a 3-part JWT payload', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ email: 'jwt@example.com' })).toString('base64url');
    expect(decodeMiTokenEmail(`${header}.${payload}.sig`)).toBe('jwt@example.com');
  });

  it('returns empty on garbage — never invents an identity', () => {
    expect(decodeMiTokenEmail('not-a-token')).toBe('');
    expect(decodeMiTokenEmail('')).toBe('');
  });
});

describe('accountAvatarInnerHtml', () => {
  it('signed-in with picture → img src, no "?"', () => {
    const html = accountAvatarInnerHtml({
      email: 'eric@govcongiants.com',
      name: 'Eric',
      picture: 'https://lh3.googleusercontent.com/photo.jpg',
    });
    expect(html).toContain('src="https://lh3.googleusercontent.com/photo.jpg"');
    expect(html).toContain('<img');
    expect(html).not.toContain('?');
  });

  it('signed-in without picture → initial from email, no "?"', () => {
    const html = accountAvatarInnerHtml({ email: 'eric@govcongiants.com' });
    expect(html).toBe('<span class="mindy-acct-ini">E</span>');
    expect(html).not.toContain('?');
  });

  it('signed-out / unknown → person glyph, not a fake avatar or "?"', () => {
    const html = accountAvatarInnerHtml();
    expect(html).toContain('<svg');
    expect(html).not.toContain('mindy-acct-ini');
    expect(html).not.toContain('?');
  });
});
