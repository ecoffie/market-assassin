/**
 * Maps header identity chip — photo if we have one, otherwise the user's initial.
 *
 * Gold master for the circle itself is `.mindy-acct-btn` in account-menu.ts
 * (34px, navy→purple initial). Gold master for HMAC decode is
 * `readMiTokenEmail` in stored-app-auth.ts (payload is split(".")[0], NOT a
 * JWT header.payload.sig). Gold master for email initials is PursuitComments:
 * first letter of the local part, plus a second letter only when the local
 * part is first.last / first_last.
 *
 * Never return "?" — that is the signed-in look Eric photographed on /today.
 */

import { readMiTokenEmail } from '@/lib/mindy/stored-app-auth';

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

/** HMAC (payload.sig) first; 3-part JWT payload second. */
export function decodeMiTokenEmail(token?: string | null): string {
  if (!token) return '';
  const hmacEmail = readMiTokenEmail(token);
  if (hmacEmail) return hmacEmail;
  try {
    const parts = token.split('.');
    if (parts.length < 3) return '';
    const payload = parts[1] || '';
    const pad = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as { email?: string };
    return parsed?.email ? String(parsed.email).toLowerCase().trim() : '';
  } catch {
    return '';
  }
}

export type AccountMenuIdentity = {
  email?: string | null;
  name?: string | null;
  picture?: string | null;
};

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
