/**
 * Admin: re-trigger capability-vector embedding for UEI users.
 *
 * The embed-user-capabilities cron only picks up rows where capability_embedded_at
 * IS NULL. Users who were INELIGIBLE under the old logic (UEI entered but no saved
 * Vault → 0 realSignals → skipped) got stamped with a timestamp, so the cron won't
 * revisit them — even though buildCapabilityProfile now derives signal from their
 * UEI award history. This one-time action nulls capability_embedded_at for rows
 * that have a uei but no capability_embedding yet, so the cron re-evaluates them.
 *
 * GET  ?password=...            → count how many UEI users have no vector (preview)
 * POST ?password=...&mode=execute → null their embedded_at so the cron re-embeds
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = sb();
  // UEI users WITHOUT a vector yet — the population the UEI-fallback unblocks.
  const { count: ueiNoVector } = await supabase
    .from('user_identity_profile')
    .select('user_email', { count: 'exact', head: true })
    .not('uei', 'is', null)
    .neq('uei', '')
    .is('capability_embedding', null);
  const { count: ueiTotal } = await supabase
    .from('user_identity_profile')
    .select('user_email', { count: 'exact', head: true })
    .not('uei', 'is', null)
    .neq('uei', '');
  return NextResponse.json({
    success: true,
    ueiTotal: ueiTotal || 0,
    ueiWithoutVector: ueiNoVector || 0,
    note: 'POST ?mode=execute to null capability_embedded_at on these so the cron re-embeds them from UEI award history.',
  });
}

export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (request.nextUrl.searchParams.get('mode') !== 'execute') {
    return NextResponse.json({ success: false, error: 'pass ?mode=execute to run' }, { status: 400 });
  }
  const supabase = sb();
  // Null embedded_at for UEI users with no vector → the cron re-picks them up and
  // buildCapabilityProfile now pulls their USASpending award scopes as signal.
  const { data, error } = await supabase
    .from('user_identity_profile')
    .update({ capability_embedded_at: null })
    .not('uei', 'is', null)
    .neq('uei', '')
    .is('capability_embedding', null)
    .select('user_email');
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    success: true,
    requeued: (data || []).length,
    note: 'embed-user-capabilities cron will now re-embed these from UEI award history. Run it (or wait for the dispatcher).',
  });
}
