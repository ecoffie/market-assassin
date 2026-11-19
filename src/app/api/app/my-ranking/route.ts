/**
 * GET /api/app/my-ranking?email= — "What's your ranking?" (owner, 2026-11-19).
 *
 * The signed-in company's UEI (from its Vault identity) ranked among every federal contractor by
 * lifetime dollars obligated, overall and in its state. See src/lib/bigquery/uei-ranking.ts.
 *
 * Statuses (never a made-up rank or a zero):
 *   ok · no_uei (Vault has no UEI yet) · not_found (UEI not in the awards data) ·
 *   not_ranked (lifetime total ≤ 0) · unavailable (the data could not be read right now)
 *
 * Auth mirrors the Vault route: the caller must own the email; Coach Mode reads the ACTIVE
 * CLIENT's Vault, so a coach sees the client's ranking, not their own.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';
import { getUeiRanking, normalizeUei } from '@/lib/bigquery/uei-ranking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim();
  if (!email) return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const { workspaceId, asClient } = await resolveActiveWorkspace(auth.email!, request);
  const owner = asClient ? clientNotificationEmail(workspaceId) : auth.email!;

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await sb.from('user_identity_profile').select('uei').eq('user_email', owner).maybeSingle();
  if (error) {
    console.error('[my-ranking] vault read failed:', error.message);
    return NextResponse.json({ success: true, status: 'unavailable' });
  }
  const uei = normalizeUei((data as { uei?: string | null } | null)?.uei);
  if (!uei) return NextResponse.json({ success: true, status: 'no_uei' });

  try {
    const result = await getUeiRanking(uei);
    return NextResponse.json({ success: true, uei, ...result });
  } catch (e) {
    console.error('[my-ranking] ranking failed:', (e as Error).message);
    return NextResponse.json({ success: true, uei, status: 'unavailable' });
  }
}
