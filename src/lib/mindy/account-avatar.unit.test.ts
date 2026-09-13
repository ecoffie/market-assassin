import { beforeAll, describe, expect, it } from 'vitest';
import { createMIAuthSessionToken } from '@/lib/two-factor-session';
import {
  accountAvatarInnerHtml,
  accountMenuAriaLabel,
  decodeMiTokenEmail,
  initialsFromIdentity,
  pictureFromAuthUser,
  profileFromAuthUser,
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

  it('Microsoft / password (name, no picture) → initials, never "?"', () => {
    expect(accountAvatarInnerHtml({
      email: 'ada@contoso.com',
      name: 'Ada Lovelace',
    })).toBe('<span class="mindy-acct-ini">AL</span>');
    expect(accountAvatarInnerHtml({ email: 'password.user@example.com' }))
      .toBe('<span class="mindy-acct-ini">PU</span>');
  });
});

describe('pictureFromAuthUser / profileFromAuthUser', () => {
  const googlePhoto = 'https://lh3.googleusercontent.com/a/google-photo';
  const mindyPhoto = 'https://getmindy.ai/brand/uploaded-avatar.png';

  it('Google user_metadata.picture → img src, never "?"', () => {
    const profile = profileFromAuthUser({
      user_metadata: { picture: googlePhoto, full_name: 'Eric Coffie' },
    });
    expect(profile.picture).toBe(googlePhoto);
    expect(profile.name).toBe('Eric Coffie');
    const html = accountAvatarInnerHtml({
      email: 'eric@govcongiants.com',
      name: profile.name,
      picture: profile.picture,
    });
    expect(html).toContain(`src="${googlePhoto}"`);
    expect(html).not.toContain('?');
  });

  it('Google user_metadata.avatar_url when picture is absent', () => {
    expect(pictureFromAuthUser({
      user_metadata: { avatar_url: googlePhoto },
    })).toBe(googlePhoto);
  });

  it('Google identities[].identity_data.picture when metadata is empty', () => {
    expect(pictureFromAuthUser({
      user_metadata: {},
      identities: [{
        provider: 'google',
        identity_data: { picture: googlePhoto, name: 'Eric Coffie' },
      }],
    })).toBe(googlePhoto);
    expect(profileFromAuthUser({
      identities: [{
        provider: 'google',
        identity_data: { picture: googlePhoto, full_name: 'Eric Coffie' },
      }],
    })).toEqual({ name: 'Eric Coffie', picture: googlePhoto });
  });

  it('prefers OAuth picture over a later Mindy avatar_url on an identity', () => {
    expect(pictureFromAuthUser({
      user_metadata: { picture: googlePhoto, avatar_url: mindyPhoto },
    })).toBe(googlePhoto);
  });

  it('falls back to stored Mindy avatar_url when OAuth picture is missing', () => {
    expect(pictureFromAuthUser({
      user_metadata: { avatar_url: mindyPhoto },
      identities: [{ provider: 'email', identity_data: {} }],
    })).toBe(mindyPhoto);
  });

  it('Microsoft: no picture → initials from name/email, never "?"', () => {
    const profile = profileFromAuthUser({
      user_metadata: { full_name: 'Ada Lovelace', email: 'ada@contoso.com' },
      identities: [{
        provider: 'azure',
        identity_data: { name: 'Ada Lovelace', email: 'ada@contoso.com' },
      }],
    });
    expect(profile.picture).toBeNull();
    expect(profile.name).toBe('Ada Lovelace');
    const html = accountAvatarInnerHtml({
      email: 'ada@contoso.com',
      name: profile.name,
      picture: profile.picture,
    });
    expect(html).toBe('<span class="mindy-acct-ini">AL</span>');
    expect(html).not.toContain('?');
  });

  it('password login: initials from email, never "?"', () => {
    const profile = profileFromAuthUser({
      user_metadata: { source: 'mindy_magic_link' },
      identities: [{ provider: 'email', identity_data: { email: 'pat@example.com' } }],
    });
    expect(profile.picture).toBeNull();
    const html = accountAvatarInnerHtml({
      email: 'pat@example.com',
      name: profile.name,
      picture: profile.picture,
    });
    expect(html).toBe('<span class="mindy-acct-ini">P</span>');
    expect(html).not.toContain('?');
  });

  it('ignores non-http picture values so a 404-prone blob is not invented', () => {
    expect(pictureFromAuthUser({
      user_metadata: { picture: 'not-a-url', avatar_url: '' },
      identities: [{ identity_data: { picture: 'data:image/png;base64,xxxx' } }],
    })).toBeNull();
  });
});
