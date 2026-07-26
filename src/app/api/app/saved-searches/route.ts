/**
 * Saved Searches API — the Opportunity Map "Save search" (Zillow-style).
 *
 * A saved search = the user's active filter set + viewport + mode, persisted so a cron
 * can re-run it and alert on NEW matching opportunities. Per-user (not workspace-shared).
 *
 * GET    /api/app/saved-searches?email=          → the caller's saved searches
 * POST   /api/app/saved-searches  {email, name, mode, filters, bbox}  → create
 * PATCH  /api/app/saved-searches  {email, id, alerts_enabled?, alert_frequency?, name?}  → update
 * DELETE /api/app/saved-searches?email=&id=      → delete
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getAppSupabase, normalizeEmail } from '@/lib/app/workspace';
import { parseMapFilters, applyMapFilters } from '@/lib/opportunities/map-filters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Missing-table guard: return empty (not 500) so the map still works pre-migration.
function tableMissing(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42P01' || (error.message || '').includes('saved_searches'));
}

const ALLOWED_FREQ = new Set(['daily', 'weekly', 'paused']);
const ALLOWED_MODE = new Set(['open', 'recompete']);

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const supabase = getAppSupabase();

  // ?badge=1 → the Zillow "Updates N" count: how many NEW matches (not in last_seen_notice_ids)
  // exist across the user's OPEN saved searches. Powers the red count badge on the map's Saved
  // rail icon. Live-computed from the SAME filter engine the alert cron uses — no fabrication.
  if (request.nextUrl.searchParams.get('badge') === '1') {
    const { data: searches, error } = await supabase
      .from('saved_searches')
      .select('id, mode, filters, last_seen_notice_ids')
      .eq('user_email', normalizeEmail(email))
      .eq('mode', 'open');
    if (error) {
      if (tableMissing(error)) return NextResponse.json({ success: true, count: 0, perSearch: [] });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    const fresh = new Set<string>();
    const perSearch: Array<{ id: string; count: number }> = [];
    for (const s of searches || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sf = s as any;
      const seen = new Set<string>(Array.isArray(sf.last_seen_notice_ids) ? sf.last_seen_notice_ids : []);
      const f = parseMapFilters((k) => (sf.filters as Record<string, string>)?.[k] ?? null);
      f.postedDays = f.postedDays || 30;
      let q = supabase.from('sam_opportunities').select('notice_id').limit(200);
      q = applyMapFilters(q, f);
      const { data: opps, error: qErr } = await q.order('posted_date', { ascending: false });
      if (qErr) { perSearch.push({ id: sf.id, count: 0 }); continue; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ids = (opps || []).map((o: any) => o.notice_id).filter((x: string) => x && !seen.has(x));
      // Only count as "new" if the search was ever baselined (has seen ids) — a never-run
      // search shouldn't flash its whole current match set as unseen.
      const n = seen.size ? ids.length : 0;
      ids.forEach((x: string) => n && fresh.add(x));
      perSearch.push({ id: sf.id, count: n });
    }
    return NextResponse.json({ success: true, count: fresh.size, perSearch });
  }

  const { data, error } = await supabase
    .from('saved_searches')
    .select('*')
    .eq('user_email', normalizeEmail(email))
    .order('created_at', { ascending: false });

  if (error) {
    if (tableMissing(error)) return NextResponse.json({ success: true, searches: [] });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, searches: data || [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();

  // action:'mark_seen' → the user opened Saved: fold each OPEN search's current matches into
  // last_seen_notice_ids so the badge clears (Zillow's "Updates" resets when you view them).
  if (body.action === 'mark_seen') {
    if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
    const authSeen = requireMIAuthSession(request, email);
    if (!authSeen.ok) return authSeen.response;
    const supabase = getAppSupabase();
    const { data: searches, error } = await supabase
      .from('saved_searches')
      .select('id, filters, last_seen_notice_ids')
      .eq('user_email', normalizeEmail(email))
      .eq('mode', 'open');
    if (error) {
      if (tableMissing(error)) return NextResponse.json({ success: true, cleared: 0 });
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    let cleared = 0;
    for (const s of searches || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sf = s as any;
      const f = parseMapFilters((k) => (sf.filters as Record<string, string>)?.[k] ?? null);
      f.postedDays = f.postedDays || 30;
      let q = supabase.from('sam_opportunities').select('notice_id').limit(200);
      q = applyMapFilters(q, f);
      const { data: opps, error: qErr } = await q.order('posted_date', { ascending: false });
      if (qErr) continue;
      const seen = new Set<string>(Array.isArray(sf.last_seen_notice_ids) ? sf.last_seen_notice_ids : []);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (opps || []).forEach((o: any) => o.notice_id && seen.add(o.notice_id));
      const { error: upErr } = await supabase.from('saved_searches')
        .update({ last_seen_notice_ids: [...seen].slice(0, 500), updated_at: new Date().toISOString() })
        .eq('id', sf.id);
      if (!upErr) cleared++;
    }
    return NextResponse.json({ success: true, cleared });
  }

  const name = String(body.name || '').trim();
  if (!email || !name) return NextResponse.json({ success: false, error: 'email and name are required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const mode = ALLOWED_MODE.has(body.mode) ? body.mode : 'open';
  const filters = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters) ? body.filters : {};
  const bbox = body.bbox && typeof body.bbox === 'object' ? body.bbox : null;

  const supabase = getAppSupabase();
  const { data, error } = await supabase
    .from('saved_searches')
    .insert({
      user_email: normalizeEmail(email),
      name: name.slice(0, 80),
      mode,
      filters,
      bbox,
      alerts_enabled: body.alerts_enabled !== false,
      alert_frequency: ALLOWED_FREQ.has(body.alert_frequency) ? body.alert_frequency : 'daily',
    })
    .select()
    .single();

  if (error) {
    if (tableMissing(error)) {
      return NextResponse.json({ success: false, error: 'Saved searches not available yet — run the saved_searches migration.' }, { status: 503 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, search: data });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  const id = String(body.id || '').trim();
  if (!email || !id) return NextResponse.json({ success: false, error: 'email and id are required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.alerts_enabled === 'boolean') updates.alerts_enabled = body.alerts_enabled;
  if (ALLOWED_FREQ.has(body.alert_frequency)) updates.alert_frequency = body.alert_frequency;
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim().slice(0, 80);

  const supabase = getAppSupabase();
  const { data, error } = await supabase
    .from('saved_searches')
    .update(updates)
    .eq('id', id)
    .eq('user_email', normalizeEmail(email)) // scoped: only your own
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, search: data });
}

export async function DELETE(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  const id = request.nextUrl.searchParams.get('id');
  if (!email || !id) return NextResponse.json({ success: false, error: 'email and id are required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const supabase = getAppSupabase();
  const { error } = await supabase
    .from('saved_searches')
    .delete()
    .eq('id', id)
    .eq('user_email', normalizeEmail(email)); // scoped: only your own

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
