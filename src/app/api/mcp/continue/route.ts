/**
 * The continuation endpoint behind /mcp/continue.
 *
 * GET  — read a saved attempt so the page can show the user exactly what will run
 *        ("NAICS 541512 · Virginia") before anything expensive happens.
 * POST — the user clicked "Run report". Verifies they can now afford it, runs the saved
 *        request verbatim, and stamps the funnel.
 *
 * WHY THE EXPLICIT CLICK: auto-running a 100-credit report the instant a payment webhook
 * lands means a mis-click or a double-charge silently spends real money. Restoring the
 * request and asking once keeps continuation to one click without ever surprising anyone.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { runMeteredTool } from '@/lib/mcp/metered';
import { stampAttempt, markCheckoutStarted } from '@/lib/mcp/paywall';
import { resolveMcpEmail } from '@/lib/mcp/session-identity';

export const dynamic = 'force-dynamic';

async function loadAttempt(id: string) {
  const { data, error } = await getWriteClient()
    .from('mcp_paywall_attempts')
    .select('id,user_email,tool_name,args,reason,credits_required,consumed_at,purchased_at')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('attempt');
  if (!id) return NextResponse.json({ error: 'missing attempt' }, { status: 400 });

  const attempt = await loadAttempt(id);
  if (!attempt) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Viewing the offer is the checkout-started signal.
  await markCheckoutStarted(id);

  return NextResponse.json({
    id: attempt.id,
    toolName: attempt.tool_name,
    args: attempt.args ?? {},
    reason: attempt.reason,
    creditsRequired: attempt.credits_required,
    alreadyRun: Boolean(attempt.consumed_at),
  });
}

export async function POST(req: NextRequest) {
  const email = await resolveMcpEmail(req);
  if (!email) return NextResponse.json({ error: 'sign in required' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { attempt?: string };
  const id = body.attempt;
  if (!id) return NextResponse.json({ error: 'missing attempt' }, { status: 400 });

  const attempt = await loadAttempt(id);
  if (!attempt) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // An attempt belongs to the person who made it.
  if (String(attempt.user_email).toLowerCase() !== email.trim().toLowerCase()) {
    return NextResponse.json({ error: 'not yours' }, { status: 403 });
  }
  if (attempt.consumed_at) {
    return NextResponse.json({ error: 'already run', alreadyRun: true }, { status: 409 });
  }

  await stampAttempt(id, 'resumed');

  // Run the saved request verbatim. runMeteredTool re-checks the balance, so if the
  // upgrade did not actually land they get the paywall again rather than a free run.
  const outcome = await runMeteredTool(
    attempt.tool_name as string,
    (attempt.args ?? {}) as Record<string, unknown>,
    { userEmail: email },
  );

  if (!outcome.ok) {
    // Deliberately NOT consumed — they can try again once the upgrade settles.
    return NextResponse.json({ ok: false, error: outcome.error }, { status: 402 });
  }

  await stampAttempt(id, 'completed');
  return NextResponse.json({ ok: true, result: outcome.result, creditsCharged: outcome.creditsCharged });
}
