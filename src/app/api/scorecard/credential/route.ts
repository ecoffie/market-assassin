/**
 * One short-lived scorecard_reader password for a GitHub Actions run.
 *
 * The caller proves a GitHub OIDC token for this repository, main, and the
 * scorecard workflow. This route connects as scorecard_rotator and calls
 * scorecard_rotate_reader_password. That is the only SQL it runs. The
 * password is returned once and is not logged.
 */
import { NextRequest, NextResponse } from 'next/server';
import pg from 'pg';
import {
  SCORECARD_OIDC_AUDIENCE,
  SCORECARD_OIDC_ISSUER,
  assessScorecardOidcClaims,
  publicKeyFromJwk,
  verifyRs256,
} from '@/lib/scorecard/oidc-claims';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REFUSAL = /^scorecard rotation refused: (jti|run|repository|event|workflow|replay|rate)$/;

async function signingKey(token: string) {
  const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')) as { kid?: string };
  const res = await fetch(`${SCORECARD_OIDC_ISSUER}/.well-known/jwks`);
  if (!res.ok) return null;
  const body = await res.json() as { keys?: Array<JsonWebKey & { kid?: string }> };
  const jwk = body.keys?.find((key) => key.kid === header.kid);
  if (!jwk) return null;
  return publicKeyFromJwk(jwk as Parameters<typeof publicKeyFromJwk>[0]);
}

function readerUrl(password: string): string | null {
  const host = process.env.SCORECARD_READER_HOST || '';
  const user = process.env.SCORECARD_READER_USER || '';
  if (!host.endsWith('.pooler.supabase.com') || !user.startsWith('scorecard_reader')) return null;
  const url = new URL('postgresql://placeholder');
  url.hostname = host;
  url.port = '6543';
  url.username = user;
  url.password = password;
  url.pathname = '/postgres';
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

export async function POST(request: NextRequest) {
  const header = request.headers.get('authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return NextResponse.json({ reason: 'credential is missing' }, { status: 401 });

  let payload;
  try {
    const key = await signingKey(token);
    if (!key) return NextResponse.json({ reason: 'oidc key rejected' }, { status: 401 });
    const verified = verifyRs256(token, key);
    if (!verified.ok) return NextResponse.json({ reason: verified.reason }, { status: 401 });
    payload = assessScorecardOidcClaims(verified.payload);
  } catch {
    return NextResponse.json({ reason: 'oidc token rejected' }, { status: 401 });
  }
  if (!payload.ok) {
    const status = payload.reason === 'oidc token expired' ? 401 : 403;
    return NextResponse.json({ reason: payload.reason }, { status });
  }

  const rotator = process.env.SCORECARD_ROTATOR_URL || '';
  if (!rotator) return NextResponse.json({ reason: 'rotator is not configured' }, { status: 503 });
  const host = process.env.SCORECARD_READER_HOST || '';
  const user = process.env.SCORECARD_READER_USER || '';
  if (!host.endsWith('.pooler.supabase.com') || !user.startsWith('scorecard_reader')) {
    return NextResponse.json({ reason: 'reader host is not configured' }, { status: 503 });
  }

  const client = new pg.Client({ connectionString: rotator, ssl: { rejectUnauthorized: true } });
  try {
    await client.connect();
    const rotated = await client.query(
      `SELECT password, expires_at
         FROM public.scorecard_rotate_reader_password($1, $2, $3, $4, $5, $6)`,
      [payload.jti, payload.runId, payload.actor, payload.eventName, payload.repository, payload.workflowRef],
    );
    const row = rotated.rows[0];
    const databaseUrl = row ? readerUrl(String(row.password)) : null;
    if (!databaseUrl || !row?.expires_at) {
      return NextResponse.json({ reason: 'reader host is not configured' }, { status: 503 });
    }
    return NextResponse.json({
      database_url: databaseUrl,
      expires_at: new Date(row.expires_at).toISOString(),
      audience: SCORECARD_OIDC_AUDIENCE,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    const match = message.match(REFUSAL);
    if (match?.[1] === 'replay') return NextResponse.json({ reason: 'rotation replay' }, { status: 409 });
    if (match?.[1] === 'rate') return NextResponse.json({ reason: 'rotation rate limited' }, { status: 429 });
    if (/password authentication failed|no encryption|ECONNREFUSED|ENOTFOUND|certificate/i.test(message)) {
      return NextResponse.json({ reason: 'rotator connection failed' }, { status: 503 });
    }
    return NextResponse.json({ reason: 'rotation refused' }, { status: 401 });
  } finally {
    await client.end().catch(() => {});
  }
}
