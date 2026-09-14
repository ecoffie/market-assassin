/**
 * POST /api/admin/consolidate-accounts?password=…
 * Body: { keepEmail, absorbEmail, mode?: 'preview'|'execute' }
 *
 * Merge absorb → keep onto one account_id. Default mode=preview (rule #11).
 */
import { NextRequest, NextResponse } from 'next/server';
import { consolidateAccounts } from '@/lib/identity/consolidate-accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('password') !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: { keepEmail?: string; absorbEmail?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const keepEmail = String(body.keepEmail || '');
  const absorbEmail = String(body.absorbEmail || '');
  const mode = body.mode === 'execute' ? 'execute' : 'preview';
  if (!keepEmail.includes('@') || !absorbEmail.includes('@')) {
    return NextResponse.json({ error: 'keepEmail and absorbEmail required' }, { status: 400 });
  }
  const result = await consolidateAccounts({ keepEmail, absorbEmail, mode });
  return NextResponse.json({ success: result.ok, ...result }, { status: result.ok ? 200 : 400 });
}
