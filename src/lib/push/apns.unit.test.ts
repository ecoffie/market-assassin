import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';

describe('APNs provider token', () => {
  it('is a valid ES256 JWT Apple can verify', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    process.env.APNS_KEY_ID = 'ABC123DEFG';
    process.env.APNS_TEAM_ID = 'TEAM123456';
    // Stored with literal \n, as Vercel env vars often are.
    process.env.APNS_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n');
    const { apnsJwt, apnsConfigured } = await import('./apns');
    expect(apnsConfigured()).toBe(true);

    const [h, p, s] = apnsJwt(1_700_000_000_000).split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ iss: 'TEAM123456', iat: 1_700_000_000 });
    const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
    expect(ok).toBe(true);
  });
});
