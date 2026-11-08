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
import { canonicalListingKey } from '@/lib/opportunities/canonical-listing';
import { countOpenMarketForMapParams } from '@/lib/opportunities/open-market-count';
import { todaysLensMapPath } from './todays-lens-link';

export interface LensStrand {
  key: string;
  label: string;
  icon: string;
  count: number;
}

export interface TodaysLens {
  grounded: boolean;
  usingFallback: boolean;
  /** Distinct open LISTINGS in the user's codes (one solicitation + its amendments = one). */
  totalOpen: number;
  /** Per-strand listing counts. They OVERLAP — never sum them. */
  strands: LensStrand[];
  lensStrategy: string;
  /**
   * Listings the CTA's link opens, counted by the Map API's own market counter (mapped + locationless,
   * one per listing). null = could not count — never 0.
   */
  lensCount: number | null;
  /**
   * The EXACT NAICS codes every count above was scoped to — the profile's codes, or FALLBACK_NAICS
   * when the profile has none. The map link MUST carry these: the map's default scope is the whole
   * corpus, so a ?strategy=-only link applied the same strands to EVERY NAICS and opened a population
   * ~7-11x larger than lensCount (Joseph Boyd, 2026-10-25: "Explore 13 recommended" → 95 / 137).
   */
  lensNaics: string[];
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

interface LensRow { solicitation_number: string | null; notice_id: string | null; opportunity_dna_keys: string[] | null }

/** Page a lens query past the 1,000-row cap (the first page's exact count sizes the walk). Throws on error. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function walkLensRows(build: () => any): Promise<LensRow[]> {
  const PAGE = 1000;
  const out: LensRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, count, error } = await build().order('notice_id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`lens read failed: ${error.message}`);
    const page = (data ?? []) as LensRow[];
    out.push(...page);
    if (page.length < PAGE || (typeof count === 'number' && out.length >= count)) break;
  }
  return out;
}

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

  // UNIT = distinct canonical LISTINGS (one solicitation + its amendments = one), the same unit the
  // Map's headline and pins use. Raw notice rows made "Explore 24 recommended" open a Map that said 20
  // (2026-10-25). One walk of the profile-scoped open set gives the headline AND every strand chip in
  // that unit; a strand counts a listing when any of its rows carries the strand (the Map applies the
  // strategy filter per row, then collapses to listings). THROWS on a query error (count≠null).
  const rows = await walkLensRows(() => sb().from('sam_opportunities')
    .select('solicitation_number, notice_id, opportunity_dna_keys', { count: 'exact' })
    .eq('active', true).gt('response_deadline', nowIso).not('opportunity_dna_keys', 'is', null).or(naicsOr));

  const all = new Set<string>();
  const byStrand = new Map<string, Set<string>>(LENS_STRANDS.map((s) => [s.key, new Set<string>()]));
  for (const r of rows) {
    const key = canonicalListingKey({ solicitation_number: r.solicitation_number, notice_id: r.notice_id });
    if (!key) continue;
    all.add(key);
    const dna = Array.isArray(r.opportunity_dna_keys) ? r.opportunity_dna_keys : [];
    for (const s of LENS_STRANDS) if (s.anyOf.some((k) => dna.includes(k))) byStrand.get(s.key)!.add(key);
  }
  const totalOpen = all.size;
  // Each chip is its own count — they OVERLAP (one listing can be Set-Aside AND Close This Week), so
  // no surface may sum them.
  const strands: LensStrand[] = LENS_STRANDS.map((s) => ({ key: s.key, label: s.label, icon: s.icon, count: byStrand.get(s.key)!.size }));

  const grounded = totalOpen > 0;
  // The lens = the strands that actually have opps today (a 0-count strand isn't part of "why today
  // matters"). The map CTA filters by the TOP few present strands — the ones the briefing highlights.
  const present = strands.filter((s) => s.count > 0);
  const lensStrategyKeys = present.slice(0, 3).map((s) => s.key); // top 3 by declared order → the map lens

  // COUNT THE POPULATION THE CTA ACTUALLY LANDS ON — with the MAP'S OWN COUNTER.
  //
  // History: the email printed the whole market (830) while its link opened the strategy slice (77,
  // 2026-08-23); then the slice was counted but the link dropped the NAICS (13 → 95/137, 2026-10-25);
  // then it was counted in rows while the Map counts listings (24 vs 20). Each fix re-derived the
  // Map's answer. Now the number is computed by the SAME function the Map API uses for its market
  // total (mapped + locationless listings), over the EXACT params of the link — equal by construction.
  const codes6 = [...codes];
  let lensCount: number | null = null;
  if (lensStrategyKeys.length) {
    const path = todaysLensMapPath({ lensStrategy: lensStrategyKeys.join(','), lensNaics: codes6, lensCount: null }, { src: 'alert' });
    try {
      lensCount = (await countOpenMarketForMapParams(sb(), new URL(path, 'https://getmindy.ai').searchParams)).market;
    } catch (e) {
      // null, never 0 — a failed count must not claim the strategy slice is empty.
      console.error('[todays-lens] lens market count failed:', (e as Error)?.message || e);
      lensCount = null;
    }
  }

  return {
    grounded,
    usingFallback,
    totalOpen,
    strands: present,
    lensStrategy: lensStrategyKeys.join(','),
    /** How many opps the map shows when the CTA's link (strategy + lensNaics) is followed. */
    lensCount,
    lensNaics: codes6,
  };
}
