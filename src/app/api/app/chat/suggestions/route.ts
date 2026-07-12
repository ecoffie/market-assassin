/**
 * GET /api/app/chat/suggestions?email= — personalized starter prompts.
 *
 * The Mindy Chat empty-state chips. Computes 4 diverse prompts that showcase the
 * v2 Data Core tools (pipeline · live SAM · contractor intel · Vault) and
 * personalizes them to the user's real profile (their NAICS, whether they have
 * pursuits, their set-aside). Pure builder in src/lib/chat/starter-prompts.ts;
 * this route just gathers the context and calls it.
 *
 * Cheap: one profile read + one pipeline COUNT. Falls back to the generic set on
 * any error so the chat empty-state is never blocked.
 *
 * Auth: MI session via verifyUserOwnsEmail (same as the chat route).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { loadBidderProfile } from '@/lib/proposal/loaders';
import type { BidderProfile } from '@/lib/proposal/types';
import { buildStarterPrompts, DEFAULT_STARTER_PROMPTS } from '@/lib/chat/starter-prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

export async function GET(request: NextRequest) {
  const email = (request.nextUrl.searchParams.get('email') || '').trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated || !auth.email) {
    // Not signed in → still return the generic set (the empty state must render).
    return NextResponse.json({ prompts: DEFAULT_STARTER_PROMPTS, personalized: false });
  }

  try {
    const [profile, pipelineCount] = await Promise.all([
      loadBidderProfile(auth.email).catch((): BidderProfile => ({})),
      getSupabase()
        .from('user_pipeline')
        .select('id', { count: 'exact', head: true })
        .eq('user_email', auth.email)
        .then((r: { count: number | null }) => r.count ?? 0)
        .catch(() => 0),
    ]);

    const prompts = buildStarterPrompts({
      naicsCodes: profile.naicsCodes,
      companyName: profile.companyName,
      setAsides: profile.setAsides,
      hasPipeline: pipelineCount > 0,
    });
    return NextResponse.json({ prompts, personalized: true });
  } catch (err) {
    console.error('[chat/suggestions] failed, serving generic:', err);
    return NextResponse.json({ prompts: DEFAULT_STARTER_PROMPTS, personalized: false });
  }
}
