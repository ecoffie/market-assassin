/**
 * GET /api/app/vault/doc-access?email=… — which Vault DOCUMENT features this verified session may use
 * ({ uploads, generate }). (Not to be confused with /api/app/vault/capabilities, the company
 * capabilities library.)
 *
 * The browser's ONLY source of on/off for the attach UI, the grouped Vault view and generate: no
 * NEXT_PUBLIC build flag, so an allowlist change takes effect without a rebuild and cannot be switched
 * on from the client. The routes themselves re-check on every call (src/lib/vault/flags.ts); this answer
 * only decides what to SHOW.
 *
 * Unauthenticated or unverified → 401 with everything false. Booleans only; nothing else is revealed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { vaultDocCapabilities } from '@/lib/vault/flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const NONE = { uploads: false, generate: false };

export async function GET(request: NextRequest) {
  const email = (request.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return NextResponse.json({ success: false, ...NONE }, { status: 400, headers: NO_STORE });
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated || !auth.email) return NextResponse.json({ success: false, ...NONE }, { status: 401, headers: NO_STORE });
  return NextResponse.json({ success: true, ...vaultDocCapabilities(auth.email.toLowerCase()) }, { status: 200, headers: NO_STORE });
}
