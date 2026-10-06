/**
 * Email "add to pipeline" — the signed, expiring, action-bound token for the CONFIRMATION step.
 *
 * WHY THIS EXISTS (2026-10-06): the daily alert's one-click save was a GET that wrote a
 * `user_pipeline` row. Mail security scanners fetch every link on delivery, so they created
 * saves nobody chose: 83% of `source='daily_alert'` saves in 30 days landed within 2 minutes of
 * the send, multi-save alerts a median 53 ms apart. Now the email link only OPENS a confirmation
 * page, and the save happens on an explicit button POST carrying this token.
 *
 * The email link's own token (`generateEmailToken`, HMAC of email:ts, 24 h) proves the reader
 * received that email. It is NOT bound to any action, so it cannot authorize a write by itself.
 * This token is minted by the confirmation page and binds:
 *   email + the opportunity key + a one-time idempotency key + an expiry.
 * Tampering with any of them (a different notice, a reused key, a late submit) fails verification.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/** How long the confirmation form stays valid after the page renders. */
export const SAVE_ACTION_TTL_SECONDS = 30 * 60;

const VERSION = 'pipeline-save:v1';

export interface SaveActionClaims {
  email: string;
  /** notice id when present, else `title:<title>` — the same key the duplicate check uses. */
  opportunityKey: string;
  idempotencyKey: string;
  /** unix seconds */
  exp: number;
}

function secret(): string {
  const s = process.env.EMAIL_ACTION_SECRET || process.env.ADMIN_PASSWORD;
  if (!s) throw new Error('EMAIL_ACTION_SECRET not configured');
  return s;
}

export function opportunityKeyFor(noticeId: string | null | undefined, title: string): string {
  const n = (noticeId || '').trim();
  return n ? `notice:${n}` : `title:${title.trim()}`;
}

const payload = (c: SaveActionClaims) =>
  `${VERSION}:${c.email.trim().toLowerCase()}:${c.opportunityKey}:${c.idempotencyKey}:${c.exp}`;

export function signSaveAction(c: SaveActionClaims): string {
  return createHmac('sha256', secret()).update(payload(c)).digest('hex');
}

/** Mint the claims + signature the confirmation form carries. */
export function mintSaveAction(
  email: string,
  opportunityKey: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SaveActionClaims & { sig: string } {
  const claims: SaveActionClaims = {
    email: email.trim().toLowerCase(),
    opportunityKey,
    idempotencyKey: randomUUID(),
    exp: nowSeconds + SAVE_ACTION_TTL_SECONDS,
  };
  return { ...claims, sig: signSaveAction(claims) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SaveActionCheck =
  | { ok: true }
  | { ok: false; reason: 'malformed' | 'expired' | 'bad_signature' };

export function verifySaveAction(
  c: SaveActionClaims,
  sig: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SaveActionCheck {
  if (!c.email || !c.opportunityKey || !UUID.test(c.idempotencyKey) || !Number.isFinite(c.exp) || !/^[0-9a-f]{64}$/i.test(sig)) {
    return { ok: false, reason: 'malformed' };
  }
  if (nowSeconds > c.exp) return { ok: false, reason: 'expired' };
  const expected = Buffer.from(signSaveAction(c), 'hex');
  const given = Buffer.from(sig, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}
