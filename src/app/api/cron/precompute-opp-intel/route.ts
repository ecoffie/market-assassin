/**
 * /api/cron/precompute-opp-intel — steady-state warmer for the map drawer intelligence.
 *
 * The one-time drain of the ~11k backlog is scripts/backfill-opp-intel.ts (a local runner).
 * THIS cron keeps NEW active opps warm: each run computes a bounded batch of the
 * least-recently-computed (intel_computed_at NULL first) via the SHARED buildOppIntel(),
 * stores intel_* + stamps intel_computed_at. Resumable — the dispatcher re-fires it.
 *
 * Also computes SOW card facts (Tier 1 — brand-name/or-equal flag, eval basis, set-aside from
 * text) via the SHARED extractSowCardFacts() for the same batch (piggybacks the row selection;
 * separate best-effort update + its own sow_card_facts_computed_at stamp so a missing column or
 * an extraction failure never drops the main intel write). The one-time drain for THIS is
 * scripts/backfill-sow-card-facts.ts.
 *
 *   Dispatcher-fired (cron_jobs row). Manual: GET ?limit=40
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildOppIntel } from '@/lib/opportunities/opp-intel';
import { extractSowCardFacts, sowCardFactsHasContent } from '@/lib/opportunities/sow-card-facts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const limit = Math.min(100, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') || '40', 10) || 40));
  const concurrency = 4;
  const db = sb();
  const nowIso = new Date().toISOString();

  // ?restamp=1&password=<ADMIN_PASSWORD> — clear intel_computed_at on ALL active-upcoming opps so
  // the drain re-derives every M-Estimate with the CURRENT value-range logic. Needed after a
  // change to how the estimate is computed (e.g. the 2026-08-03 sub-agency-narrowing fix, where
  // every same-NAICS card showed the identical NAICS-wide median because the sub-agency tier
  // self-nulled on a SAM-vs-USASpending agency-string mismatch). Idempotent, admin-gated, bounded
  // paged UPDATE — refreshes a derived cache, destroys no source data. Clears the flag then returns
  // the count; re-run this route WITHOUT ?restamp (or let the dispatcher tick) to drain + recompute.
  if (request.nextUrl.searchParams.get('restamp') === '1') {
    const password = request.nextUrl.searchParams.get('password') || '';
    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
    }
    let cleared = 0;
    // Page in chunks so one UPDATE never times out; each pass clears up to 1000 stamped rows.
    for (let pass = 0; pass < 40; pass++) {
      const { data: ids, error: selErr } = await db.from('sam_opportunities')
        .select('notice_id')
        .eq('active', true).gt('response_deadline', nowIso).not('intel_computed_at', 'is', null)
        .limit(1000);
      if (selErr) return NextResponse.json({ success: false, error: selErr.message }, { status: 500 });
      const chunk = (ids || []).map((r) => r.notice_id);
      if (!chunk.length) break;
      const { error: updErr } = await db.from('sam_opportunities')
        .update({ intel_computed_at: null })
        .in('notice_id', chunk);
      if (updErr) return NextResponse.json({ success: false, error: updErr.message }, { status: 500 });
      cleared += chunk.length;
    }
    // Fall through: the drain below now recomputes the first `limit` of the just-cleared rows.
    return NextResponse.json({ success: true, restamp: true, cleared, note: 'intel_computed_at cleared on active-upcoming opps; re-run the drain (this route, no ?restamp) to recompute' });
  }

  const { data: rows, error } = await db.from('sam_opportunities')
    .select('notice_id, naics_code, department, sub_tier, title, sow_text, set_aside_code')
    .eq('active', true).gt('response_deadline', nowIso).is('intel_computed_at', null)
    .order('posted_date', { ascending: false })
    .limit(limit);
  if (error) {
    if (error.code === '42703') return NextResponse.json({ success: true, note: 'intel columns not present yet', processed: 0 });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const batch = rows || [];
  const { count: remaining } = await db.from('sam_opportunities')
    .select('notice_id', { count: 'exact', head: true })
    .eq('active', true).gt('response_deadline', nowIso).is('intel_computed_at', null);

  let done = 0, failed = 0;
  const queue = [...batch];
  async function worker() {
    while (queue.length) {
      const r = queue.shift()!;
      try {
        const intel = await buildOppIntel(r.naics_code || null, r.department || null, r.title || null, undefined, r.sub_tier || null);
        await db.from('sam_opportunities').update({
          intel_predecessor: intel.predecessor, intel_agency: intel.agency,
          intel_pricing: intel.pricing, intel_computed_at: new Date().toISOString(),
        }).eq('notice_id', r.notice_id);
        // Value range in its own update so a missing column (pre-migration) can't drop the rest.
        if (intel.valueRange) {
          await db.from('sam_opportunities').update({ intel_value_range: intel.valueRange }).eq('notice_id', r.notice_id).then(() => {}, () => {});
        }
        // SOW card facts (Tier 1) — best-effort SEPARATE update, same pattern as intel_value_range,
        // so a pre-migration missing column can't drop the rest of the intel write. Local
        // regex/one-mini-LLM extraction, so it's cheap alongside the heavier intel tools above.
        if (r.sow_text && r.sow_text.length > 200) {
          try {
            const cardFacts = await extractSowCardFacts(r.sow_text, r.set_aside_code || null);
            if (sowCardFactsHasContent(cardFacts)) {
              await db.from('sam_opportunities')
                .update({ sow_card_facts: cardFacts, sow_card_facts_computed_at: new Date().toISOString() })
                .eq('notice_id', r.notice_id).then(() => {}, () => {});
            } else {
              await db.from('sam_opportunities')
                .update({ sow_card_facts_computed_at: new Date().toISOString() })
                .eq('notice_id', r.notice_id).then(() => {}, () => {});
            }
          } catch { /* best-effort — never fails the main intel write */ }
        }
        done++;
      } catch {
        failed++;
        // Stamp so a permanently-failing row can't jam the resumable cursor.
        await db.from('sam_opportunities').update({ intel_computed_at: new Date().toISOString() }).eq('notice_id', r.notice_id).then(() => {}, () => {});
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  return NextResponse.json({ success: true, processed: done, failed, remaining: Math.max(0, (remaining ?? 0) - done) });
}
