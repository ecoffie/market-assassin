/**
 * Saved Searches API — the Opportunity Map "Save search" (Zillow-style).
 *
 * Thin HTTP adapter over src/lib/saved-searches/service.ts (gold master for Map + MCP).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getAppSupabase, normalizeEmail } from '@/lib/app/workspace';
import { parseMapFilters, applyMapFilters } from '@/lib/opportunities/map-filters';
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  updateSavedSearch,
  LAST_SEEN_NOTICE_IDS_CAP,
} from '@/lib/saved-searches';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function tableMissing(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42P01' || (error.message || '').includes('saved_searches'));
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const supabase = getAppSupabase();

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
      const n = seen.size ? ids.length : 0;
      ids.forEach((x: string) => n && fresh.add(x));
      perSearch.push({ id: sf.id, count: n });
    }
    return NextResponse.json({ success: true, count: fresh.size, perSearch });
  }

  const listed = await listSavedSearches(email);
  if (!listed.ok) {
    if (listed.code === 'scheduler_unavailable') {
      return NextResponse.json({ success: true, searches: [] });
    }
    return NextResponse.json({ success: false, error: listed.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, searches: listed.data.searches });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();

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
        .update({ last_seen_notice_ids: [...seen].slice(0, LAST_SEEN_NOTICE_IDS_CAP), updated_at: new Date().toISOString() })
        .eq('id', sf.id);
      if (!upErr) cleared++;
    }
    return NextResponse.json({ success: true, cleared });
  }

  const name = String(body.name || '').trim();
  if (!email || !name) return NextResponse.json({ success: false, error: 'email and name are required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const created = await createSavedSearch({
    userEmail: email,
    name,
    mode: body.mode,
    filters: body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters) ? body.filters : {},
    bbox: body.bbox && typeof body.bbox === 'object' ? body.bbox : null,
    alertsEnabled: body.alerts_enabled !== false,
    alertFrequency: body.alert_frequency,
  });

  if (!created.ok) {
    if (created.code === 'scheduler_unavailable') {
      return NextResponse.json({ success: false, error: created.message }, { status: 503 });
    }
    if (
      created.code === 'invalid_filters' ||
      created.code === 'invalid_mode' ||
      created.code === 'invalid_frequency' ||
      created.code === 'unsupported_alert_scope' ||
      created.code === 'profile_scope_unavailable'
    ) {
      return NextResponse.json({ success: false, error: created.message }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: created.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    search: created.data.search,
    idempotent: created.data.idempotent,
  });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  const id = String(body.id || '').trim();
  if (!email || !id) return NextResponse.json({ success: false, error: 'email and id are required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const updated = await updateSavedSearch({
    userEmail: email,
    id,
    alertsEnabled: typeof body.alerts_enabled === 'boolean' ? body.alerts_enabled : undefined,
    alertFrequency: body.alert_frequency,
    name: typeof body.name === 'string' ? body.name : undefined,
  });

  if (!updated.ok) {
    if (updated.code === 'not_found') {
      return NextResponse.json({ success: false, error: updated.message }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: updated.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, search: updated.data.search });
}

export async function DELETE(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  const id = request.nextUrl.searchParams.get('id');
  if (!email || !id) return NextResponse.json({ success: false, error: 'email and id are required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const deleted = await deleteSavedSearch(email, id);
  if (!deleted.ok) {
    if (deleted.code === 'confirmation_required') {
      return NextResponse.json({ success: false, error: deleted.message }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: deleted.message }, { status: 500 });
  }

  if (deleted.data.noop) {
    return NextResponse.json({ success: false, error: 'Saved search not found for this account' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
