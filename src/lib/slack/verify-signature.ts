/**
 * Slack request signing verification (https://api.slack.com/authentication/verifying-requests-from-slack).
 *
 * Slack signs every request: `X-Slack-Signature: v0=<hex HMAC-SHA256(signing_secret, "v0:{ts}:{raw body}")>`
 * plus `X-Slack-Request-Timestamp`. Verify over the RAW body, before parsing, before any work.
 *
 * Fails closed: an unset SLACK_SIGNING_SECRET rejects everything.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Slack's recommended replay window. */
export const SLACK_MAX_SKEW_SECONDS = 60 * 5;

export type SlackVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'no_secret' | 'missing_headers' | 'stale_timestamp' | 'bad_signature' };

export function verifySlackSignature(params: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret?: string;
  nowSeconds?: number;
}): SlackVerifyResult {
  const secret = params.secret ?? process.env.SLACK_SIGNING_SECRET;
  if (!secret) return { ok: false, reason: 'no_secret' };
  const { timestamp, signature, rawBody } = params;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return { ok: false, reason: 'missing_headers' };

  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > SLACK_MAX_SKEW_SECONDS) return { ok: false, reason: 'stale_timestamp' };

  const expected = 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  return { ok: true };
}
