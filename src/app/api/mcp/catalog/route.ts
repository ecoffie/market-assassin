/**
 * /api/mcp/catalog — PUBLIC (no auth) pricing/plan data for the logged-out /mcp page.
 *
 * GET → { tools[] (name+description+credits), packages[], signupCredits, proMonthlyCredits }.
 *
 * This is the marketing counterpart to /api/mcp/account (which is auth-gated and adds the
 * user's balance + call history). Everything here is non-PII, server-trusted config so a
 * prospect can see "what agents can do + what it costs" BEFORE signing in — data behind
 * glass, not a blank wall. No user data ever passes through this route.
 */
import { NextResponse } from 'next/server';
import { listMcpTools } from '@/lib/mcp/tool-registry';
import { CREDIT_PACKAGES, PRO_MONTHLY_CREDITS } from '@/lib/mcp/packages';
import { SIGNUP_CREDITS } from '@/lib/mcp/credits';

export const runtime = 'nodejs';
// Static config — safe to cache at the edge for an hour (revalidates on deploy anyway).
export const revalidate = 3600;

export function GET() {
  const tools = listMcpTools().map((t) => {
    const fn = t.function as { name: string; description?: string };
    return { name: fn.name, description: fn.description ?? '', credits: (t._credits as number) ?? 0 };
  });

  return NextResponse.json({
    success: true,
    tools,
    packages: CREDIT_PACKAGES,
    signupCredits: SIGNUP_CREDITS,
    proMonthlyCredits: PRO_MONTHLY_CREDITS,
  });
}
