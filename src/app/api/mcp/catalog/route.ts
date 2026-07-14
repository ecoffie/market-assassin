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
import { mcpFlags } from '@/lib/mcp/flags';

export const runtime = 'nodejs';
// Static config — safe to cache at the edge for an hour (revalidates on deploy anyway).
export const revalidate = 3600;

export function GET() {
  const tools = listMcpTools().map((t) => {
    const fn = t.function as { name: string; description?: string };
    return {
      name: fn.name,
      description: fn.description ?? '',
      credits: (t._credits as number) ?? 0,
      tier: (t._tier as string) ?? 'metered', // 'metered' | 'pro' — drives the pricing page's live/gated split
    };
  });

  return NextResponse.json({
    success: true,
    tools,
    packages: CREDIT_PACKAGES,
    signupCredits: SIGNUP_CREDITS,
    proMonthlyCredits: PRO_MONTHLY_CREDITS,
    // Whether Pro-tier tools (tier === 'pro') are actually ENFORCED right now, i.e.
    // the deployed runtime reads MCP_ENFORCE_TIERS as true. Lets the /mcp page show
    // "Pro enforced" honestly and gives a public, no-auth way to confirm the flag
    // bound (catches the MCP_ENFORCE_TIERS=1-vs-true silent no-op class of bug).
    enforceTiers: mcpFlags.enforceTiers,
  });
}
