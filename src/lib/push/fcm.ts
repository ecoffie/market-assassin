/**
 * Firebase Cloud Messaging HTTP v1 (Android). No SDK — service-account JWT → OAuth token → send.
 *
 * Env: FCM_SERVICE_ACCOUNT_JSON — the Firebase project's service-account key (JSON string).
 * Missing → `fcmConfigured() === false`, nothing is sent.
 */
import { createPrivateKey, sign } from 'node:crypto';
import type { PushMessage, PushResult } from './types';

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    return sa.project_id && sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

export function fcmConfigured(): boolean {
  return serviceAccount() !== null;
}

let cachedAccess: { token: string; exp: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccess && cachedAccess.exp - 60 > now) return cachedAccess.token;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = sign('sha256', Buffer.from(input), createPrivateKey(sa.private_key.replace(/\\n/g, '\n')));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${input}.${sig.toString('base64url')}`,
    }),
  });
  if (!res.ok) throw new Error(`FCM auth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccess = { token: json.access_token, exp: now + (json.expires_in || 3600) };
  return json.access_token;
}

export async function sendFcm(tokens: string[], msg: PushMessage): Promise<PushResult[]> {
  if (!tokens.length) return [];
  const sa = serviceAccount();
  if (!sa) return tokens.map((token) => ({ token, ok: false, dead: false, error: 'fcm_not_configured' }));
  const bearer = await accessToken(sa);
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

  return Promise.all(tokens.map(async (token): Promise<PushResult> => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: msg.title, body: msg.body },
            data: { url: msg.url },
            android: { priority: 'HIGH' },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { token, ok: true, dead: false };
      const text = await res.text();
      const dead = res.status === 404 || text.includes('UNREGISTERED') || text.includes('registration-token-not-registered');
      return { token, ok: false, dead, error: `${res.status} ${text.slice(0, 160)}` };
    } catch (e) {
      return { token, ok: false, dead: false, error: e instanceof Error ? e.message : String(e) };
    }
  }));
}
