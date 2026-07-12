/**
 * /api/mcp/keys — self-serve MCP API-key management for the getmindy.ai/mcp dashboard.
 *
 *   POST   → mint a new key (returns the plaintext key ONCE)
 *   GET    → list the caller's keys (metadata only, never the secret)
 *   DELETE → revoke one of the caller's keys (?id=<keyId>)
 *
 * Gated by requireUserAuth (the MI session must own the claimed email) — the same
 * guard every other /api/app route uses. This route only manages keys; verifying a
 * presented key on the MCP edge lives in src/lib/mcp/api-keys.ts (Slice 2).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserAuth } from '@/lib/api-auth';
import { issueApiKey, listApiKeys, revokeApiKey } from '@/lib/mcp/api-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireUserAuth(request);
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  let label: string | undefined;
  try {
    const body = await request.json();
    if (typeof body?.label === 'string' && body.label.trim()) label = body.label.trim().slice(0, 80);
  } catch {
    // no/invalid body → unlabeled key is fine
  }

  try {
    const { key, row } = await issueApiKey(auth.email, { label });
    // `key` is returned exactly once here and never again.
    return NextResponse.json({ success: true, key, keyInfo: row });
  } catch (err) {
    console.error('[mcp:keys] issue failed:', err);
    return NextResponse.json({ error: 'Failed to create key' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireUserAuth(request);
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  try {
    const keys = await listApiKeys(auth.email);
    return NextResponse.json({ success: true, keys });
  } catch (err) {
    console.error('[mcp:keys] list failed:', err);
    return NextResponse.json({ error: 'Failed to list keys' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUserAuth(request);
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const keyId = request.nextUrl.searchParams.get('id');
  if (!keyId) {
    return NextResponse.json({ error: 'Missing key id (?id=)' }, { status: 400 });
  }

  try {
    const revoked = await revokeApiKey(auth.email, keyId);
    if (!revoked) {
      // Not the caller's key, unknown id, or already revoked — don't leak which.
      return NextResponse.json({ error: 'Key not found or already revoked' }, { status: 404 });
    }
    return NextResponse.json({ success: true, revoked: true });
  } catch (err) {
    console.error('[mcp:keys] revoke failed:', err);
    return NextResponse.json({ error: 'Failed to revoke key' }, { status: 500 });
  }
}
