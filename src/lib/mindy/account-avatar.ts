/**
 * Maps header identity chip — photo if we have one, otherwise the user's initial.
 *
 * Gold master for the circle itself is `.mindy-acct-btn` in account-menu.ts
 * (34px, navy→purple initial). Gold master for HMAC decode is
 * `verifyTwoFactorSessionToken` in two-factor-session.ts (payload.sig —
 * email is split(".")[0], NOT a JWT header.payload.sig).
 *
 * Fallback order: OAuth image → name initials → email initial.
 * Never return "?" — that is the signed-in look Eric photographed on / and
 * /opportunity-map when the client treated HMAC tokens as JWTs.
 */

export function initialsFromIdentity(name?: string | null, email?: string | null): string {
  const trimmedName = (name || '').trim();
  if (trimmedName) {
    const words = trimmedName.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return words[0][0].toUpperCase();
  }
  const local = (email || '').trim().split('@')[0] || '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  const first = parts[0]?.[0] || local[0];
  if (!first) return '';
  const second = parts[1]?.[0] || '';
  return (first + second).toUpperCase();
}

export function accountMenuAriaLabel(name?: string | null, email?: string | null): string {
  const who = (name || '').trim() || (email || '').trim().split('@')[0] || '';
  return who ? `Account menu, ${who}` : 'Account menu';
}

/** HMAC (payload.sig) first; 3-part JWT payload second. Client-side parse only. */
export function decodeMiTokenEmail(token?: string | null): string {
  if (!token) return '';
  const parts = token.split('.');
  const tryParse = (segment: string): string => {
    try {
      const pad = segment.length % 4 === 0 ? '' : '='.repeat(4 - (segment.length % 4));
      const b64 = segment.replace(/-/g, '+').replace(/_/g, '/') + pad;
      const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as { email?: string };
      return parsed?.email ? String(parsed.email).toLowerCase().trim() : '';
    } catch {
      return '';
    }
  };
  if (parts.length >= 2) {
    const hmacEmail = tryParse(parts[0] || '');
    if (hmacEmail) return hmacEmail;
  }
  if (parts.length >= 3) {
    return tryParse(parts[1] || '');
  }
  return '';
}

export type AccountMenuIdentity = {
  email?: string | null;
  name?: string | null;
  picture?: string | null;
};

/** Supabase Auth user slice `/api/app/me` reads — no session minting. */
export type AuthUserAvatarSource = {
  user_metadata?: Record<string, unknown> | null;
  identities?: Array<{
    provider?: string | null;
    identity_data?: Record<string, unknown> | null;
  }> | null;
};

function firstHttpUrl(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
  }
  return null;
}

function firstNonEmptyString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Display photo for the Maps chip.
 *
 * Hierarchy: OAuth profile image (user_metadata, then identities[].identity_data)
 * → existing Mindy profile image (`avatar_url` on metadata) → null (UI uses initials).
 * Google stores `picture` on both metadata and identity_data. Microsoft Graph
 * photos are out of scope unless already stored here.
 */
export function pictureFromAuthUser(user?: AuthUserAvatarSource | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata || {};
  const fromMeta = firstHttpUrl(meta.picture, meta.avatar_url, meta.avatarUrl);
  if (fromMeta) return fromMeta;

  const identities = [...(user.identities || [])];
  identities.sort((a, b) => {
    const ag = a.provider === 'google' ? 0 : 1;
    const bg = b.provider === 'google' ? 0 : 1;
    return ag - bg;
  });
  for (const identity of identities) {
    const data = identity.identity_data || {};
    const fromIdentity = firstHttpUrl(data.picture, data.avatar_url, data.avatarUrl);
    if (fromIdentity) return fromIdentity;
  }
  return null;
}

export function nameFromAuthUser(user?: AuthUserAvatarSource | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata || {};
  const fromMeta = firstNonEmptyString(meta.full_name, meta.name);
  if (fromMeta) return fromMeta;
  for (const identity of user.identities || []) {
    const data = identity.identity_data || {};
    const fromIdentity = firstNonEmptyString(data.full_name, data.name);
    if (fromIdentity) return fromIdentity;
  }
  return null;
}

export function profileFromAuthUser(user?: AuthUserAvatarSource | null): {
  name: string | null;
  picture: string | null;
} {
  return {
    name: nameFromAuthUser(user),
    picture: pictureFromAuthUser(user),
  };
}

function escAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const PERSON_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>';

export function accountAvatarInnerHtml(identity?: AccountMenuIdentity | null): string {
  const email = (identity?.email || '').trim();
  const name = (identity?.name || '').trim();
  const picture = (identity?.picture || '').trim();
  const initial = initialsFromIdentity(name, email);
  if (picture) {
    return (
      '<img src="' +
      escAttr(picture) +
      '" alt="" referrerpolicy="no-referrer" />'
    );
  }
  if (initial) {
    return '<span class="mindy-acct-ini">' + escText(initial) + '</span>';
  }
  return PERSON_SVG;
}

export { PERSON_SVG };
