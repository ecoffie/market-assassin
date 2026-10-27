/**
 * /api/admin/mcp-credits?password=... — grant/read MCP credits (admin, pre-Stripe).
 *
 * Lets us seed + inspect credit balances before the Stripe top-up (Slice 4) exists,
 * so Slice 3 is testable on its own.
 *   GET  ?email=E            → { email, balance }
 *   POST { email, amount }   → amount > 0: grant (reason 'admin_grant')
 *                               amount < 0: debit |amount| (reason 'admin_debit'),
 *                               409 if the balance can't cover it
 *
 * A negative amount must go through the debit RPC: `mcp_grant_credits` treats
 * p_amount <= 0 as a no-op and returns the current balance, so routing a negative
 * through it reported success while changing nothing (2026-10-27, a goodwill
 * reversal that silently didn't happen).
 */
import { NextRequest, NextResponse } from 'next/server';
import { debitCredits, getBalance, grantCredits } from '@/lib/mcp/credits';

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
  if (!Number.isInteger(amount)) {
    return NextResponse.json({ error: 'amount must be a whole number of credits' }, { status: 400 });
  }
  try {
    if ((amount as number) < 0) {
      const { ok, newBalance } = await debitCredits(email, -(amount as number), {
        reason: 'admin_debit',
        toolName: 'admin_debit',
      });
      if (!ok) {
        return NextResponse.json(
          { error: 'insufficient balance — nothing debited', email: email.toLowerCase(), balance: newBalance },
          { status: 409 },
        );
      }
      return NextResponse.json({ success: true, email: email.toLowerCase(), debited: -(amount as number), balance: newBalance });
    }
    const newBalance = await grantCredits(email, amount as number, 'admin_grant');
    return NextResponse.json({ success: true, email: email.toLowerCase(), granted: amount, balance: newBalance });
  } catch (err) {
    console.error('[admin:mcp-credits] grant failed:', err);
    return NextResponse.json({ error: 'grant failed' }, { status: 500 });
  }
}
