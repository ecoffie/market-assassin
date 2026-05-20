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

function getSecret() {
  return process.env.TWO_FACTOR_SECRET
    || process.env.ADMIN_PASSWORD
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || 'app-2fa';
}

function toBase64Url(value: string) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(payload: string) {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
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

  const expectedSignature = sign(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
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

    return { valid: true, email: payload.email, verifiedAt: payload.verifiedAt, expiresAt: new Date(payload.exp).toISOString() };
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
