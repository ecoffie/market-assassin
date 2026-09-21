/**
 * Opportunity DNA — the genome (Phase 1: grounded strands only).
 *
 * The genome is the STRATEGY layer of the Mindy Ontology (see the "Opportunity DNA" +
 * "Mindy Ontology" artifacts). It is OBJECTIVE — every strand is true for every viewer, computed
 * from the opportunity's own real fields. It is NOT the Recommendation layer (Pursue/Watch/Skip +
 * M-Win, which reads the user's profile) and NOT the Identity layer (the one-sentence who+horizon).
 *
 * THE NO-FABRICATION RULE (Ontology): a strand appears ONLY when its source field is present and
 * genuinely satisfies the predicate. A missing field emits NOTHING — never a guessed strand. This is
 * exactly why "Repeat Buyer" and "Posts-early" are deliberately absent from Phase 1: they need award
 * history / a threaded early-signal we don't have on the row yet (Phase 1.5). Adding them before
 * they're grounded would fabricate.
 *
 * DISPLAY vs the engine: the UI shows plain words ("Buyer", "Approach", "Watch Outs"). The strand
 * `category` here is the ENGINE name; the render layer maps engine→UI label. "DNA" never appears in
 * the UI.
 *
 * Pure + deterministic: no I/O, no Date.now (pass `now` in), no fabrication. The SAME function is
 * called by the map API decorate step (per pin, live) AND — in Phase 2 — a backfill that persists the
 * genome to an `opportunity_dna` column. One source of truth; no lib-duplicate drift.
 */

import { classifyNoticeType } from '@/lib/utils/notice-type';

/** Engine categories (Tier 1/2/3 of the Ontology). UI maps these to plain words at render time. */
export type GenomeCategory =
  | 'buyer'        // "Buyer"        — what kind of buyer is this?
  | 'opportunity'  // "Opportunity"  — what kind of opportunity?
  | 'timing'       // "Timing"       — when should I act?
  | 'approach';    // "Approach"     — how should I go in?  (engine: Strategy DNA)

export type StrandTone = 'good' | 'watch' | 'neutral';

export interface Strand {
  category: GenomeCategory;
  /** Stable machine key (for the strategy-filter + tests). Never rename a shipped key. */
  key: string;
  /** Human label rendered on the card/popup/listing. */
  label: string;
  tone: StrandTone;
  /** Tier from the Ontology (1 = can I win? · 2 = how do I win? · 3 = why today?). Orders reveal. */
  tier: 1 | 2 | 3;
}

export type OppGenome = Strand[];

/** The minimal row shape computeGenome needs — a subset of the map pin (all real fields). */
export interface GenomeInput {
  src?: string | null;          // 'SAM' | 'RECOMPETE' | 'FORECAST' | 'DLA' | 'GRANTS'
  noticeType?: string | null;   // SAM free-text notice_type
  title?: string | null;
  set?: string | null;          // set-group key: SDVOSB | SB | 8A | WOSB | HZ | OTHER | NONE
  close?: string | null;        // response deadline (ISO date) or null
  sbf?: number | boolean | null; // SB-friendly buyer flag (sapBuyerTier 'most') — computed upstream
  // Phase 1.5 grounded strands — both computed UPSTREAM (server-side) and passed in, keeping this fn
  // pure. A flag is emitted ONLY when its real signal cleared its honesty floor; absent/false → no
  // strand (the no-fabrication rule). See genome-repeat-buyer.ts (repeatBuyer) + the early-signal
  // band on the pin (postsEarly = earlySignal === 'high').
  repeatBuyer?: number | boolean | null; // this agency has ≥ REPEAT_BUYER_MIN awards in this NAICS
  postsEarly?: number | boolean | null;  // this buying office reliably posts Sources-Sought/RFI early
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days until the deadline, or null when there's no parseable deadline. */
function daysUntil(close: string | null | undefined, now: number): number | null {
  if (!close) return null;
  const t = Date.parse(close);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now) / DAY_MS);
}

/**
 * The set-aside strand LABEL — names the actual program, never a bare "Small Business"/"Set-Aside"
 * (Eric 2026-08-04). Maps the row's real set-group key to a "<program> Set-Aside" phrase. Grounded:
 * every branch is a rename of the row's OWN value; an unrecognized non-empty key falls back to
 * "<key> Set-Aside" (uppercased) rather than inventing a program.
 */
export function setAsideLabel(set: string | null | undefined): string {
  const k = (set || '').toUpperCase().trim();
  switch (k) {
    case 'SDVOSB': return 'SDVOSB Set-Aside';
    case 'VETERAN SA':
    case 'VOSB':    return 'Veteran-Owned Set-Aside';
    case 'SB':      return 'Small Business Set-Aside';
    case '8A':
    case '8(A)':    return '8(a) Set-Aside';
    case 'WOSB':    return 'WOSB Set-Aside';
    case 'EDWOSB':  return 'EDWOSB Set-Aside';
    case 'HZ':
    case 'HUBZONE': return 'HUBZone Set-Aside';
    case 'ISBEE':
    case 'BUY INDIAN': return 'Indian SB Set-Aside';
    case 'OTHER':   return 'Set-Aside';
    default:        return k ? `${k} Set-Aside` : 'Set-Aside';
  }
}

/**
 * Compute the grounded genome for one opportunity. Order = tier then category, so the reveal helper
 * can just take the first N. Every strand traces to a present field; absent field → no strand.
 *
 * @param row  the opportunity's real fields (a subset of the map pin)
 * @param now  epoch ms "now" (injected so the fn stays pure/testable; the caller passes Date.now())
 */
export function computeGenome(row: GenomeInput, now: number): OppGenome {
  const out: OppGenome = [];
  const src = (row.src || '').toUpperCase();
  const nt = classifyNoticeType(row.noticeType, row.title);

  // ── Tier 1 · Opportunity — what kind of opportunity is this? ──────────────────────────────
  // src is the horizon (RECOMPETE/FORECAST come from which corpus the pin was built from).
  if (src === 'RECOMPETE') {
    out.push({ category: 'opportunity', key: 'recompete', label: 'Recompete', tone: 'good', tier: 1 });
  } else if (src === 'FORECAST') {
    out.push({ category: 'opportunity', key: 'forecast', label: 'Forecast', tone: 'neutral', tier: 1 });
  }
  // Sources Sought / RFI = a market-research response (respondability 'response'), not a priced bid.
  // classifyNoticeType gives us the honest label; only emit when it's genuinely a response type.
  if (nt.respondability === 'response') {
    out.push({ category: 'opportunity', key: 'sources_sought', label: nt.label || 'Sources Sought', tone: 'good', tier: 1 });
  }

  // ── Tier 1 · Timing — when should I act? ──────────────────────────────────────────────────
  const d = daysUntil(row.close, now);
  if (d != null && d >= 0) {
    if (d <= 3) {
      out.push({ category: 'timing', key: 'last_chance', label: 'Last Chance', tone: 'watch', tier: 1 });
    } else if (d <= 7) {
      out.push({ category: 'timing', key: 'closes_soon', label: 'Closes Soon', tone: 'watch', tier: 1 });
    }
  }
  // Early in the buying cycle: a Presol/Sources-Sought/RFI heads-up — the requirement is still forming,
  // there's time to shape it. respondability !== 'bid' AND we have a real classified label for it
  // (an unknown notice_type defaults to 'bid', so this never fires on a blank type — no fabrication).
  if (nt.label && nt.respondability !== 'bid') {
    out.push({ category: 'timing', key: 'early_cycle', label: 'Early in Cycle', tone: 'good', tier: 1 });
  }

  // ── Tier 1 · Buyer — what kind of buyer is this? ──────────────────────────────────────────
  // Repeat buyer = this agency has bought THIS work (agency×NAICS) enough times to be a real pattern
  // (≥ REPEAT_BUYER_MIN awards, grounded in recompete_opportunities via the precomputed map). Grounded
  // Phase 1.5 — computed upstream, passed in; absent → no strand (was deferred to avoid fabrication).
  if (row.repeatBuyer) {
    out.push({ category: 'buyer', key: 'repeat_buyer', label: 'Repeat Buyer', tone: 'good', tier: 1 });
  }
  // SB-friendly = the buyer's real PO-share tier (sapBuyerTier 'most'), computed upstream onto the pin.
  // Label says "…Buyer" so it reads as a BUYER trait, not a bare adjective (Eric 2026-08-04: "instead
  // of 'Small Business' I'd rather see '✓ SB-Friendly Buyer'"). It's a buyer-category strand.
  if (row.sbf) {
    out.push({ category: 'buyer', key: 'sb_friendly', label: 'SB-Friendly Buyer', tone: 'good', tier: 1 });
  }
  // Posts early = this buying office reliably posts Sources-Sought/RFI ahead of the RFP (early-signal
  // band 'high' = ≥50% of its biddable notices are early — "the requirement can still be shaped").
  // Grounded Phase 1.5: the band is DB-computed (sample ≥8 floor enforced by the view) and threaded
  // from the pin; absent/low → no strand. A Timing strand (it's a "when to act — early" signal).
  if (row.postsEarly) {
    out.push({ category: 'timing', key: 'posts_early', label: 'Posts Early', tone: 'good', tier: 1 });
  }

  // ── Tier 1 · Approach — how should I go in? (engine: Strategy DNA) ─────────────────────────
  // Set-aside = an eligibility edge (the objective fact "this is set aside"; whether it's an advantage
  // FOR YOU is the Recommendation layer, kept out of the genome). NONE = full & open.
  const set = (row.set || '').toUpperCase();
  if (set && set !== 'NONE') {
    // NAME the actual set-aside — never a bare "Small Business" / "Set-Aside" (Eric 2026-08-04:
    // "instead of 'Small Business' I'd rather see '✓ Small Business Set-Aside'"). The label reuses the
    // row's real set-aside value (SDVOSB, WOSB, 8(a), SB, …) so it's grounded, never fabricated.
    out.push({ category: 'approach', key: 'set_aside', label: setAsideLabel(row.set), tone: 'good', tier: 1 });
  } else if (set === 'NONE') {
    out.push({ category: 'approach', key: 'full_open', label: 'Full & Open', tone: 'neutral', tier: 1 });
  }

  return out;
}

/**
 * Progressive reveal (Ontology hard rule): the genome always exists in full; the surface decides how
 * many strands to show. Card = 1, popup = 3, listing = all. Ordered by tier (lowest first) so the
 * dominant "can I win?" strands surface before context. A 'good' strand outranks a 'watch'/'neutral'
 * within the same tier so the card leads with a positive when one exists.
 */
export function topStrands(genome: OppGenome, n: number): OppGenome {
  const toneRank: Record<StrandTone, number> = { good: 0, watch: 1, neutral: 2 };
  return [...genome]
    .sort((a, b) => a.tier - b.tier || toneRank[a.tone] - toneRank[b.tone])
    .slice(0, n);
}

/**
 * The strand KEYS of a genome — the persisted `opportunity_dna_keys` TEXT[] the strategy filter
 * queries. ONE shared extractor so the backfill, the sync, and the filter never disagree on what a
 * row's keys are. An empty genome → [] (a row that matches no strategy filter — honest, not fabricated).
 */
export function genomeKeys(genome: OppGenome): string[] {
  return genome.map((s) => s.key);
}
