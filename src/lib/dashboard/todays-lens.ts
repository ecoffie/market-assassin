/**
 * "Today's Lens" — the grounded strand COUNTS over a user's PROFILE-SCOPED OPEN corpus.
 *
 * Answers ONE question: "why open the map today?" Returns real, grounded strand counts over the
 * persisted Opportunity DNA (opportunity_dna_keys) so a surface can say "17 opportunities deserve
 * your attention · 3 Repeat Buyers · 14 SB-Friendly · 9 Close This Week" and hand the map its filter
 * via ?strategy=. Today's Intel doesn't just link to the map — it CONFIGURES it (Eric 2026-08-04).
 *
 * SHARED so the app hero (TodaysLensHero via /api/app/todays-lens) and the daily alert email render
 * the SAME lens — no drift between the two surfaces.
 *
 * GROUND IN REAL DATA (count≠null): every count is a real @>/&& containment count over
 * sam_opportunities, bound + surfaced. A query error THROWS — never a fabricated 0. `grounded:false`
 * (0 open opps in the user's codes) is an HONEST empty ("nothing today, not a broken pipe"), distinct
 * from an error. No LLM. The `lensStrategy` the map CTA uses is built from the strands the lens
 * actually surfaces.
 */

import { createClient } from '@supabase/supabase-js';

export interface LensStrand {
  key: string;
  label: string;
  icon: string;
  count: number;
}

export interface TodaysLens {
  grounded: boolean;
  usingFallback: boolean;
  totalOpen: number;
  strands: LensStrand[];
  lensStrategy: string;
  /** Rows the CTA's ?strategy= link actually lands on. null = could not count. */
  lensCount: number | null;
}

let _sb: ReturnType<typeof createClient> | null = null;
function sb() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  return _sb;
}

// The default profile NAICS (Bug Prevention Rule #8) — a brand-new user with no codes still gets a lens.
const FALLBACK_NAICS = ['541512', '541611', '541330', '541990', '561210'];

// The strands the lens surfaces, in display order. Each is a real grounded genome strand key (the same
// keys the strategy filter uses). closes_soon OR last_chance both count as "closing this week".
const LENS_STRANDS: { key: string; label: string; icon: string; anyOf: string[] }[] = [
  { key: 'repeat_buyer',   label: 'Repeat Buyers',   icon: '🔥', anyOf: ['repeat_buyer'] },
  { key: 'sb_friendly',    label: 'SB-Friendly',     icon: '🟢', anyOf: ['sb_friendly'] },
  { key: 'sources_sought', label: 'Shapeable (Sources Sought)', icon: '📣', anyOf: ['sources_sought'] },
  { key: 'closes_soon',    label: 'Close This Week',  icon: '⚡', anyOf: ['closes_soon', 'last_chance'] },
  { key: 'set_aside',      label: 'Set-Aside',        icon: '🎯', anyOf: ['set_aside'] },
];

function likeClausesForNaics(codes: string[]): string {
  // 6-digit codes → exact; shorter → prefix. OR them (PostgREST .or() syntax on naics_code).
  return codes.map((c) => (c.length >= 6 ? `naics_code.eq.${c}` : `naics_code.like.${c}%`)).join(',');
}

/**
 * Compute the grounded "Today's Lens" for a user, from their PROFILE-SCOPED OPEN corpus.
 *
 * THROWS on any query error (count≠null: a broken count is UNKNOWN, not "no opps"). The caller
 * catches. A genuine 0 (grounded:false) is honest and is NOT an error.
 */
export async function computeTodaysLens(email: string): Promise<TodaysLens> {
  // The user's profile NAICS (scopes the corpus to "their market"). Bind + surface the error.
  const { data: profile, error: profErr } = await sb()
    .from('user_notification_settings').select('naics_codes').eq('user_email', email.toLowerCase()).maybeSingle();
  if (profErr) throw new Error(`profile read failed: ${profErr.message}`);
  const prof = profile as { naics_codes?: string[] } | null;
  const rawCodes = ((prof?.naics_codes as string[]) || []).filter(Boolean);
  const codes = rawCodes.length ? rawCodes : FALLBACK_NAICS;
  const usingFallback = rawCodes.length === 0;

  const nowIso = new Date().toISOString();
  const naicsOr = likeClausesForNaics(codes);

  // Total OPEN opps in the user's market (genome-computed). A count query — bind { count, error };
  // an error must THROW, NEVER coalesce to 0 (count≠null: a broken count is UNKNOWN, not "no opps").
  const base = () => sb().from('sam_opportunities')
    .select('notice_id', { count: 'exact', head: true })
    .eq('active', true).gt('response_deadline', nowIso).not('opportunity_dna_keys', 'is', null).or(naicsOr);

  const { count: totalOpen, error: totErr } = await base();
  if (totErr) throw new Error(`open-count failed: ${totErr.message}`);

  // Per-strand containment counts (opportunity_dna_keys @> ARRAY[strand]). One head-count per strand.
  const strands: LensStrand[] = [];
  for (const s of LENS_STRANDS) {
    // any-of the strand's keys: overlaps (&&, "has ANY of") for multi-key strands (closes_soon|last_chance),
    // contains (@>, has-ALL — a single key here) for one key. One clean predicate, no .or() string. Both
    // verified equivalent to the SQL OR/&& live (316=316). Bind + surface the error (count≠null).
    let q = base();
    q = s.anyOf.length > 1 ? q.overlaps('opportunity_dna_keys', s.anyOf) : q.contains('opportunity_dna_keys', s.anyOf);
    const { count, error } = await q;
    if (error) throw new Error(`strand '${s.key}' count failed: ${error.message}`);
    strands.push({ key: s.key, label: s.label, icon: s.icon, count: count ?? 0 });
  }

  const grounded = (totalOpen ?? 0) > 0;
  // The lens = the strands that actually have opps today (a 0-count strand isn't part of "why today
  // matters"). The map CTA filters by the TOP few present strands — the ones the briefing highlights.
  const present = strands.filter((s) => s.count > 0);
  const lensStrategyKeys = present.slice(0, 3).map((s) => s.key); // top 3 by declared order → the map lens

  // COUNT THE POPULATION THE CTA ACTUALLY LANDS ON.
  //
  // The email's number was totalOpen (the whole market) while its link carried
  // ?strategy=<top 3 strands>, and the map applies those with .contains() = has ALL THREE.
  // Measured 2026-08-23 on a 541 market: 830 promised, 77 delivered — 10.8x.
  //
  // Both numbers were individually correct. The CTA was the lie: "Explore all 830 in this
  // market" pointing at a 77-row slice. So compute the destination population HERE, from the
  // same definition that produced the link, and let the copy name both.
  //
  // Same lesson as the ?ss= fix: one definition produces the message AND the destination.
  let lensCount: number | null = null;
  if (lensStrategyKeys.length) {
    const { count: lc, error: lcErr } = await base().contains('opportunity_dna_keys', lensStrategyKeys);
    // null, never 0 — a failed count must not claim the strategy slice is empty.
    lensCount = lcErr ? null : (lc ?? 0);
  }

  return {
    grounded,
    usingFallback,
    totalOpen: totalOpen ?? 0,
    strands: present,
    lensStrategy: lensStrategyKeys.join(','),
    /** How many opps the map shows when the CTA's ?strategy= link is followed. */
    lensCount,
  };
}
