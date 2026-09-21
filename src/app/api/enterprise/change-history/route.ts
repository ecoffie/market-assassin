/**
 * POST /api/enterprise/change-history — Enterprise/API feed endpoint #3 (GOS #018).
 *
 * The moat, delivered directly: the append-only record of what MOVED on a book's federal
 * contracts — period-of-performance slips, ceiling growth, incumbent novations. "Show me every
 * slip on this book this quarter." Exists in exactly one place; not on USASpending, not for sale.
 *
 * Body: { ueis: string[], since?: 'YYYY-MM-DD', fields?: string[] }
 *   fields defaults to all tracked: period_of_performance_current_end · potential_total_value · incumbent_uei
 * Auth: Mindy API key (Bearer / X-Mindy-API-Key) OR admin password. NOT credit-metered.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';
import { verifyApiKey } from '@/lib/mcp/api-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UEIS = 500;
const MAX_CHANGES = 5000;

async function authorize(request: NextRequest): Promise<boolean> {
  if (request.nextUrl.searchParams.get('password') === process.env.ADMIN_PASSWORD) return true;
  const raw = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || request.headers.get('x-mindy-api-key');
  return raw ? Boolean(await verifyApiKey(raw)) : false;
}

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { ueis?: unknown; since?: unknown; fields?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  let ueis = Array.isArray(body?.ueis) ? body.ueis.map((u) => String(u || '').toUpperCase().trim()).filter(Boolean) : [];
  ueis = [...new Set(ueis)].slice(0, MAX_UEIS);
  if (!ueis.length) return NextResponse.json({ error: 'body must be { ueis: string[], since?, fields? }' }, { status: 400 });
  const since = typeof body?.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.since) ? body.since : null;
  const fields = Array.isArray(body?.fields) ? body.fields.map(String) : null;

  const db = getReadClient();

  // Map the book's UEIs → their contract_ids (+ incumbent context for the response).
  const { data: opps, error: e1 } = await db
    .from('recompete_opportunities')
    .select('contract_id,incumbent_uei,incumbent_name').in('incumbent_uei', ueis).is('quality_flag', null).limit(50000);
  if (e1) return NextResponse.json({ error: `query failed: ${e1.message}` }, { status: 500 });
  const ctx = new Map<string, { uei: string | null; name: string | null }>();
  for (const r of (opps || []) as { contract_id: string; incumbent_uei: string | null; incumbent_name: string | null }[]) ctx.set(r.contract_id, { uei: r.incumbent_uei, name: r.incumbent_name });
  const contractIds = [...ctx.keys()];
  if (!contractIds.length) return NextResponse.json({ success: true, ueis: ueis.length, changes: [], total: 0, note: 'no contracts found for these UEIs' });

  // Pull the change log for those contracts.
  const changes: Array<Record<string, unknown>> = [];
  for (let i = 0; i < contractIds.length && changes.length < MAX_CHANGES; i += 1000) {
    let q = db.from('recompete_changes')
      .select('contract_id,piid,naics_code,field,old_value,new_value,observed_at')
      .in('contract_id', contractIds.slice(i, i + 1000))
      .order('observed_at', { ascending: false }).limit(MAX_CHANGES);
    if (since) q = q.gte('observed_at', since);
    if (fields && fields.length) q = q.in('field', fields);
    const { data: ch, error: e2 } = await q;
    if (e2) return NextResponse.json({ error: `changes query failed: ${e2.message}` }, { status: 500 });
    for (const c of (ch || []) as Record<string, unknown>[]) {
      const cid = String(c.contract_id);
      const meta = ctx.get(cid) || { uei: null, name: null };
      changes.push({ ...c, incumbent_uei: meta.uei, incumbent_name: meta.name });
    }
  }
  changes.sort((a, b) => String(b.observed_at).localeCompare(String(a.observed_at)));

  const byField = changes.reduce<Record<string, number>>((m, c) => { const f = String(c.field); m[f] = (m[f] || 0) + 1; return m; }, {});
  return NextResponse.json({
    success: true, ueis: ueis.length, since, fields: fields || 'all',
    total: changes.length, capped: changes.length >= MAX_CHANGES, byField,
    _meta: { source: 'recompete_changes (append-only moat log)', note: 'the recorded diff of what moved — slips, ceiling growth, novations. Not available on USASpending (it serves only current state).' },
    changes: changes.slice(0, MAX_CHANGES),
  });
}
