// Admin endpoint to VIEW the audit log ("who did what, when").
// Password-gated (timing-safe). Read-only. Requires migrations/20260709_audit_log.sql.
//
//   GET /api/admin/audit-log?password=...&limit=100&action=grant_ma_access&target=user@x.com
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  const ip = getClientIP(request);
  const rl = await checkAdminRateLimit(ip);
  if (!rl.allowed) return rateLimitResponse(rl);

  const { searchParams } = new URL(request.url);

  if (!verifyAdminPassword(searchParams.get('password'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // Optional filters
  const limit = Math.min(Number(searchParams.get('limit')) || 100, 500);
  const action = searchParams.get('action');
  const target = searchParams.get('target');
  const actor = searchParams.get('actor');

  let query = supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (action) query = query.eq('action', action);
  if (target) query = query.eq('target_email', target.toLowerCase());
  if (actor) query = query.eq('actor_email', actor.toLowerCase());

  const { data, error } = await query;

  if (error) {
    // Most likely cause: the table doesn't exist yet (migration not run).
    return NextResponse.json(
      { error: error.message, hint: 'Run migrations/20260709_audit_log.sql in Supabase.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ count: data?.length || 0, entries: data || [] });
}
