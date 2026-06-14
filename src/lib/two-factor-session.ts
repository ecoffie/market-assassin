import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

// 30-day Mindy session. Previously 12h, which forced Pro users to sign in
// every morning and produced "unauthorized" errors that masqueraded as
// account problems. Industry-standard SaaS session length.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface TwoFactorPayload {
  email: string;
  exp: number;
  verifiedAt: string;
  authLevel?: 'password' | '2fa';
}

function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}

// The secret used to SIGN new tokens. Prefer the dedicated TWO_FACTOR_SECRET;
// fall back to ADMIN_PASSWORD only so the system keeps working before the env
// var is pinned. The insecure literal 'app-2fa' fallback was removed — a known
// signing secret means anyone can forge a session token for any account.
function getSigningSecret() {
  const secret = process.env.TWO_FACTOR_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error(
      'No token signing secret: set TWO_FACTOR_SECRET (or ADMIN_PASSWORD) in the environment.'
    );
  }
  return secret;
}

// Secrets a token may be VERIFIED against. Listing both the new and the legacy
// secret lets us pin TWO_FACTOR_SECRET WITHOUT invalidating tokens already
// signed with ADMIN_PASSWORD — zero-downtime rotation, no mass logout. Once all
// legacy tokens age out (30-day TTL) ADMIN_PASSWORD can be removed from env.
function getVerifySecrets(): string[] {
  const secrets = [process.env.TWO_FACTOR_SECRET, process.env.ADMIN_PASSWORD].filter(
    (s): s is string => Boolean(s)
  );
  if (secrets.length === 0) {
    throw new Error(
      'No token signing secret: set TWO_FACTOR_SECRET (or ADMIN_PASSWORD) in the environment.'
    );
  }
  return secrets;
}

function toBase64Url(value: string) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(payload: string) {
  return createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
}

// True if `signature` is a valid HMAC of `payload` under ANY accepted secret.
// Constant-time per-secret comparison; iterates so a legacy-signed token still
// verifies after TWO_FACTOR_SECRET is pinned.
function signatureMatches(payload: string, signature: string): boolean {
  const signatureBuffer = Buffer.from(signature);
  for (const secret of getVerifySecrets()) {
    const expected = createHmac('sha256', secret).update(payload).digest('base64url');
    const expectedBuffer = Buffer.from(expected);
    if (
      signatureBuffer.length === expectedBuffer.length &&
      timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return true;
    }
  }
  return false;
}

export function createTwoFactorSessionToken(email: string) {
  const now = Date.now();
  const payload: TwoFactorPayload = {
    email: normalizeEmail(email),
    exp: now + SESSION_TTL_MS,
    verifiedAt: new Date(now).toISOString(),
    authLevel: '2fa',
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function createMIAuthSessionToken(email: string) {
  const now = Date.now();
  const payload: TwoFactorPayload = {
    email: normalizeEmail(email),
    exp: now + SESSION_TTL_MS,
    verifiedAt: new Date(now).toISOString(),
    authLevel: 'password',
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyTwoFactorSessionToken(token: string | null | undefined, expectedEmail?: string | null) {
  if (!token) return { valid: false, error: 'Missing two-factor session' };

  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return { valid: false, error: 'Invalid two-factor session' };

  if (!signatureMatches(encodedPayload, signature)) {
    return { valid: false, error: 'Invalid two-factor session' };
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as TwoFactorPayload;
    if (!payload.email || !payload.exp || payload.exp < Date.now()) {
      return { valid: false, error: 'Two-factor session expired' };
    }

    if (expectedEmail && payload.email !== normalizeEmail(expectedEmail)) {
      return { valid: false, error: 'Two-factor session does not match this account' };
    }

    return {
      valid: true,
      email: payload.email,
      verifiedAt: payload.verifiedAt,
      expiresAt: new Date(payload.exp).toISOString(),
      expiresInMs: payload.exp - Date.now(),
    };
  } catch {
    return { valid: false, error: 'Invalid two-factor session' };
  }
}

export function getTwoFactorTokenFromRequest(request: NextRequest) {
  const miAuthHeader = request.headers.get('x-mi-auth-token');
  if (miAuthHeader) return miAuthHeader;

  const header = request.headers.get('x-mi-2fa-token');
  if (header) return header;

  const auth = request.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  return null;
}

export function requireTwoFactorSession(request: NextRequest, expectedEmail?: string | null) {
  const result = verifyTwoFactorSessionToken(getTwoFactorTokenFromRequest(request), expectedEmail);
  if (result.valid) return { ok: true as const, session: result };

  return {
    ok: false as const,
    response: NextResponse.json(
      { success: false, error: result.error || 'Two-factor verification required' },
      { status: 401 }
    ),
  };
}

export function requireMIAuthSession(request: NextRequest, expectedEmail?: string | null) {
  const result = verifyTwoFactorSessionToken(getTwoFactorTokenFromRequest(request), expectedEmail);
  if (result.valid) return { ok: true as const, session: result };

  return {
    ok: false as const,
    response: NextResponse.json(
      { success: false, error: result.error || 'Sign in required' },
      { status: 401 }
    ),
  };
}
