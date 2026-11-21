/**
 * Apple Push Notification service (token-based auth, HTTP/2). No SDK — node:http2 + node:crypto.
 *
 * Env (all required to send; missing → `configured() === false`, nothing is sent):
 *   APNS_KEY_ID        — 10-char key id of the .p8 auth key (developer.apple.com → Keys)
 *   APNS_TEAM_ID       — Apple Developer Team ID
 *   APNS_PRIVATE_KEY   — contents of the .p8 file (PEM; literal "\n" sequences are accepted)
 *   APNS_BUNDLE_ID     — defaults to ai.getmindy.app
 *   APNS_PRODUCTION    — 'true' for App Store / TestFlight builds, else sandbox
 */
import http2 from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';
import type { PushMessage, PushResult } from './types';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function apnsConfigured(): boolean {
  return !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY);
}

let cachedJwt: { token: string; at: number } | null = null;

/** ES256 provider token. Apple accepts one for up to 60 min; we refresh at 50. */
export function apnsJwt(now = Date.now()): string {
  if (cachedJwt && now - cachedJwt.at < 50 * 60_000) return cachedJwt.token;
  const keyPem = (process.env.APNS_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: process.env.APNS_KEY_ID }));
  const payload = b64url(JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(now / 1000) }));
  const input = `${header}.${payload}`;
  const sig = sign('sha256', Buffer.from(input), { key: createPrivateKey(keyPem), dsaEncoding: 'ieee-p1363' });
  const token = `${input}.${b64url(sig)}`;
  cachedJwt = { token, at: now };
  return token;
}

/** Reasons Apple returns when a token will never work again → disable it. */
const DEAD_TOKEN = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);

export async function sendApns(tokens: string[], msg: PushMessage): Promise<PushResult[]> {
  if (!tokens.length) return [];
  const host = process.env.APNS_PRODUCTION === 'true'
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';
  const topic = process.env.APNS_BUNDLE_ID || 'ai.getmindy.app';
  const body = JSON.stringify({
    aps: { alert: { title: msg.title, body: msg.body }, sound: 'default', ...(msg.badge != null ? { badge: msg.badge } : {}) },
    url: msg.url,
  });
  const jwt = apnsJwt();
  const client = http2.connect(host);
  client.on('error', () => { /* surfaced per-request below */ });

  try {
    return await Promise.all(tokens.map((token) => new Promise<PushResult>((resolve) => {
      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${jwt}`,
        'apns-topic': topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
      let status = 0;
      let data = '';
      req.setTimeout(10_000, () => { req.close(); resolve({ token, ok: false, dead: false, error: 'timeout' }); });
      req.on('response', (h) => { status = Number(h[':status']) || 0; });
      req.on('data', (c) => { data += c; });
      req.on('error', (e) => resolve({ token, ok: false, dead: false, error: e.message }));
      req.on('end', () => {
        if (status === 200) return resolve({ token, ok: true, dead: false });
        let reason = '';
        try { reason = JSON.parse(data).reason || ''; } catch { /* empty body */ }
        resolve({ token, ok: false, dead: status === 410 || DEAD_TOKEN.has(reason), error: `${status} ${reason}`.trim() });
      });
      req.end(body);
    })));
  } finally {
    client.close();
  }
}
