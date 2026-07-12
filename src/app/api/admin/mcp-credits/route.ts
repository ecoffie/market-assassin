/**
 * /api/admin/mcp-credits?password=... — grant/read MCP credits (admin, pre-Stripe).
 *
 * Lets us seed + inspect credit balances before the Stripe top-up (Slice 4) exists,
 * so Slice 3 is testable on its own.
 *   GET  ?email=E            → { email, balance }
 *   POST { email, amount }   → grant `amount` credits (reason 'admin_grant')
 */
import { NextRequest, NextResponse } from 'next/server';
import { getBalance, grantCredits } from '@/lib/mcp/credits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authed(req: NextRequest): boolean {
  return req.nextUrl.searchParams.get('password') === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const email = req.nextUrl.searchParams.get('email');
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });
  const balance = await getBalance(email);
  return NextResponse.json({ success: true, email: email.toLowerCase(), balance });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let email: string | undefined;
  let amount: number | undefined;
  try {
    const body = await req.json();
    email = typeof body?.email === 'string' ? body.email : undefined;
    amount = Number(body?.amount);
  } catch {
    // fall through to validation
  }
  if (!email || !Number.isFinite(amount) || (amount as number) === 0) {
    return NextResponse.json({ error: 'email and non-zero numeric amount required' }, { status: 400 });
  }
  try {
    const newBalance = await grantCredits(email, amount as number, 'admin_grant');
    return NextResponse.json({ success: true, email: email.toLowerCase(), granted: amount, balance: newBalance });
  } catch (err) {
    console.error('[admin:mcp-credits] grant failed:', err);
    return NextResponse.json({ error: 'grant failed' }, { status: 500 });
  }
}
