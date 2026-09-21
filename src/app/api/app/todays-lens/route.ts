/**
 * GET /api/app/todays-lens?email=<user> — "Today's Lens" for Today's Intel.
 *
 * Answers ONE question: "why open the map today?" Returns real, grounded strand COUNTS over the
 * user's PROFILE-SCOPED OPEN corpus (the persisted Opportunity DNA — opportunity_dna_keys), so the
 * homepage can say "17 opportunities deserve your attention · 3 Repeat Buyers · 14 SB-Friendly · 9
 * Close This Week" and then hand the map its filter via ?strategy=. Today's Intel doesn't just link to
 * the map — it CONFIGURES it (Eric 2026-08-04).
 *
 * The computation lives in `src/lib/dashboard/todays-lens.ts` (SHARED with the daily alert email so the
 * two surfaces never drift). This route is the auth + JSON envelope around it.
 *
 * GROUND IN REAL DATA (count≠null): every count is a real @> containment count over sam_opportunities,
 * bound + surfaced. A query error returns 500 — never a fabricated 0. `grounded:false` (0 open opps in
 * the user's codes) is an HONEST empty ("nothing today, not a broken pipe"), distinct from an error.
 * No LLM. The `strategy` string the map CTA uses is built from the strands the lens actually surfaces.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { computeTodaysLens } from '@/lib/dashboard/todays-lens';

export async function GET(request: NextRequest) {
  const email = String(request.nextUrl.searchParams.get('email') || '').trim();
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'email required' }, { status: 400 });
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const lens = await computeTodaysLens(email);
    const nowIso = new Date().toISOString();

    return NextResponse.json({
      ok: true,
      grounded: lens.grounded,             // false = 0 open opps in the user's codes (honest empty, NOT an error)
      usingFallback: lens.usingFallback,   // true = user had no NAICS → default codes (nudge them to set a profile)
      date: nowIso.slice(0, 10),
      totalOpen: lens.totalOpen,
      strands: lens.strands,               // [{key,label,icon,count}] — the "why today matters" lines
      lensStrategy: lens.lensStrategy,     // → /opportunity-map?strategy=<this> (the CTA target)
      note: lens.grounded
        ? 'Real strand counts over your profile-scoped open corpus (opportunity_dna_keys). Not an LLM guess.'
        : 'No open opportunities match your profile codes right now — an honest empty, not a broken pipe.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
