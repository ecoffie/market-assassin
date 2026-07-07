import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { embedAndStoreCapabilityVector } from '@/lib/alerts/capability-vector';

/**
 * GET /api/cron/embed-user-capabilities
 *
 * Backfill/refresh the per-user capability vector (hidden-match alerts).
 * Drains user_notification_settings rows where capability_embedded_at IS NULL — i.e.
 * new or recently-changed profiles (vault/profile writes null it on change). This is
 * the base-wide home (~10k rows) so hidden match reaches every active user, not just
 * the ~32 with a Vault identity row. Batched + resumable like setup-invite-batch;
 * isolates ALL user-vector OpenAI cost here.
 *
 * Modes: ?mode=preview (default, no embeds) | ?mode=execute. ?limit=N (default 50).
 * Auth: ?password=ADMIN_PASSWORD OR CRON_SECRET bearer OR x-cron-dispatch (dispatcher).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const password = url.searchParams.get('password');
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const isDispatch = request.headers.get('x-cron-dispatch') === '1';
  const authed = password === ADMIN_PASSWORD || (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) || isDispatch;
  if (!authed) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const execute = url.searchParams.get('mode') === 'execute';
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 50)));
  const supabase = sb();

  // Rows needing (re)embedding: capability_embedded_at IS NULL. Only consider active
  // users (skip archived rows) so we don't spend embeddings on dead accounts.
  const { data, error } = await supabase
    .from('user_notification_settings')
    .select('user_email')
    .is('capability_embedded_at', null)
    .eq('is_active', true)
    .limit(limit + 1);

  if (error) {
    // Column missing → migration not run yet. Report honestly, don't crash the dispatcher.
    return NextResponse.json({ success: false, error: error.message, hint: 'run 20260706_capability_vector_notification_settings migration' }, { status: 200 });
  }

  const rows = (data || []) as Array<{ user_email: string }>;
  const slice = rows.slice(0, limit).map((r) => r.user_email).filter(Boolean);
  const remainingAfter = Math.max(0, rows.length - slice.length);

  if (!execute) {
    return NextResponse.json({ success: true, mode: 'preview', pendingThisPage: slice.length, hasMore: rows.length > limit, sample: slice.slice(0, 10) });
  }

  const stats = { embedded: 0, skipped: 0, unchanged: 0, failed: 0 };
  const start = Date.now();
  for (const email of slice) {
    if (Date.now() - start > 45_000) break; // soft budget; dispatcher re-fires
    try {
      const r = await embedAndStoreCapabilityVector(email);
      stats[r]++;
    } catch (err) {
      stats.failed++;
      console.warn('[embed-user-capabilities] failed', email, err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 80));
  }

  return NextResponse.json({ success: true, mode: 'execute', ...stats, processed: slice.length, remainingAfter });
}
