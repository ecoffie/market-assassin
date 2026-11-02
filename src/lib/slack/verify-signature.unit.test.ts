import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySlackSignature, SLACK_MAX_SKEW_SECONDS } from './verify-signature';

const SECRET = 'test-signing-secret';
const NOW = 1_800_000_000;
const sign = (body: string, ts: number | string, secret = SECRET) =>
  'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
const body = JSON.stringify({ type: 'event_callback', event: { type: 'app_mention', text: 'hi' } });

describe('verifySlackSignature', () => {
  it('accepts a correctly signed, fresh request', () => {
    expect(verifySlackSignature({ rawBody: body, timestamp: String(NOW), signature: sign(body, NOW), secret: SECRET, nowSeconds: NOW })).toEqual({ ok: true });
  });
  it('fails closed when no signing secret is configured', () => {
    const prev = process.env.SLACK_SIGNING_SECRET; delete process.env.SLACK_SIGNING_SECRET;
    expect(verifySlackSignature({ rawBody: body, timestamp: String(NOW), signature: sign(body, NOW), nowSeconds: NOW })).toMatchObject({ ok: false, reason: 'no_secret' });
    if (prev !== undefined) process.env.SLACK_SIGNING_SECRET = prev;
  });
  it('rejects missing or malformed headers', () => {
    for (const [ts, sig] of [[null, sign(body, NOW)], [String(NOW), null], ['abc', sign(body, 'abc')], ['', '']] as const) {
      expect(verifySlackSignature({ rawBody: body, timestamp: ts, signature: sig, secret: SECRET, nowSeconds: NOW })).toMatchObject({ ok: false, reason: 'missing_headers' });
    }
  });
  it('rejects a REPLAY (valid signature, timestamp outside the window) in both directions', () => {
    const old = NOW - SLACK_MAX_SKEW_SECONDS - 1;
    const future = NOW + SLACK_MAX_SKEW_SECONDS + 1;
    expect(verifySlackSignature({ rawBody: body, timestamp: String(old), signature: sign(body, old), secret: SECRET, nowSeconds: NOW })).toMatchObject({ reason: 'stale_timestamp' });
    expect(verifySlackSignature({ rawBody: body, timestamp: String(future), signature: sign(body, future), secret: SECRET, nowSeconds: NOW })).toMatchObject({ reason: 'stale_timestamp' });
  });
  it('rejects a body tampered after signing, a wrong secret, a re-stamped timestamp, and a truncated signature', () => {
    const sig = sign(body, NOW);
    const r = (b: string, ts: string, s: string) => verifySlackSignature({ rawBody: b, timestamp: ts, signature: s, secret: SECRET, nowSeconds: NOW });
    expect(r(body + ' ', String(NOW), sig)).toMatchObject({ reason: 'bad_signature' });
    expect(r(body, String(NOW), sign(body, NOW, 'other-secret'))).toMatchObject({ reason: 'bad_signature' });
    expect(r(body, String(NOW - 1), sig)).toMatchObject({ reason: 'bad_signature' });
    expect(r(body, String(NOW), sig.slice(0, -2))).toMatchObject({ reason: 'bad_signature' });
    expect(r(body, String(NOW), 'v1=' + sig.slice(3))).toMatchObject({ reason: 'bad_signature' });
  });
});
