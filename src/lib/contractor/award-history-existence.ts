/**
 * CANONICAL EXISTENCE CHECK — "does this contractor have federal award history?"
 *
 * ── THE INVARIANT (Eric, 2026-08-25) ───────────────────────────────────────────────────
 * Once identity resolves to a canonical UEI, two tools querying federal performance for
 * that entity MAY differ in scope or time window — but they may NEVER disagree on the
 * EXISTENTIAL claim "this contractor has federal award history."
 *
 * $10.7M all-time vs $20.2M FY23-25 vs 33 recompete rows are all defensible VIEWS.
 * "Has history: no" against "has history: yes" is a CONTRADICTION, and it is the one an
 * agent repeats to a contractor as fact.
 *
 * ── CHAIN-2, measured 2026-08-25 ───────────────────────────────────────────────────────
 * `get_contractor_award_history` and `get_recipient_annual_obligations` answered the same
 * question about FLUIDYNE CORPORATION at the same moment:
 *
 *   get_recipient_annual_obligations  ->  grounded, $20.2M FY23-25
 *   get_contractor_award_history      ->  grounded=false, 0 awards, $0
 *
 * Neither reported degradation. The cause is not a bug in the matching logic — it is the
 * SOURCE. Path A reads Supabase `usaspending_awards`, which holds **880 rows across 373
 * distinct recipients**. It is a stale sample, not a corpus. Any contractor outside those
 * 373 names gets a confident "no federal award history".
 *
 * Measured blast radius: of the 789 distinct incumbents we hold award data for in
 * `recompete_opportunities`, only ~45 appear in `usaspending_awards` — so **~94% of
 * contractors we demonstrably have award data on would be told they have none.**
 *
 * ── WHAT THIS MODULE DOES ──────────────────────────────────────────────────────────────
 * Establishes existence from EVERY source we hold, and reports which ones answered. It
 * deliberately does NOT merge dollar figures into one number: the sources measure
 * different windows and merging them would invent a total no source supports. Existence is
 * the shared claim; the amounts stay attributed to whoever reported them.
 */
import { createClient } from '@supabase/supabase-js';

export interface AwardHistoryEvidence {
  /** The shared claim every tool must agree on. */
  hasFederalAwardHistory: boolean;
  /** True when NO source could be established — unknown, NOT "no history". */
  degraded: boolean;
  /** Which sources answered, and what each one saw. Never merged into one total. */
  sources: Array<{
    source: 'recompete_mirror' | 'usaspending_awards_cache';
    found: boolean;
    awardCount: number | null;   // null = the source could not be queried
    note?: string;
  }>;
  /** Canonical UEI when a source could supply one. */
  uei: string | null;
  recipientName: string | null;
}

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * Establish whether a contractor has federal award history, from every source we hold.
 *
 * @param company  name as the user typed it
 * @param uei      canonical UEI when identity already resolved one (preferred — exact)
 */
export async function establishAwardHistory(
  company: string,
  uei?: string | null,
): Promise<AwardHistoryEvidence> {
  const name = (company || '').trim();
  const canonicalUei = (uei || '').trim().toUpperCase();
  const out: AwardHistoryEvidence = {
    hasFederalAwardHistory: false,
    degraded: false,
    sources: [],
    uei: canonicalUei || null,
    recipientName: null,
  };
  if (!name && !canonicalUei) return out;

  const client = sb();
  let anyQueried = false;

  // ── SOURCE 1: our own award mirror. 150K+ rows with real per-contract incumbents.
  // This is the source Path A never consulted, and it is the one that holds Fluidyne.
  try {
    let q = client
      .from('recompete_opportunities')
      .select('incumbent_uei, incumbent_name, potential_total_value', { count: 'exact' })
      .not('incumbent_uei', 'is', null);
    q = canonicalUei ? q.eq('incumbent_uei', canonicalUei) : q.ilike('incumbent_name', `%${name}%`);
    const { data, count, error } = await q.limit(50);
    if (error) throw new Error(error.message);
    anyQueried = true;
    const n = count ?? data?.length ?? 0;
    out.sources.push({ source: 'recompete_mirror', found: n > 0, awardCount: n });
    if (n > 0) {
      out.hasFederalAwardHistory = true;
      out.uei = out.uei || data?.[0]?.incumbent_uei || null;
      out.recipientName = out.recipientName || data?.[0]?.incumbent_name || null;
    }
  } catch (err) {
    // ⚠️ A source that FAILED is not a source that said "no". Record it as unqueryable
    // (awardCount null) so a lookup failure can never masquerade as absence of history.
    out.sources.push({
      source: 'recompete_mirror',
      found: false,
      awardCount: null,
      note: err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120),
    });
  }

  // ── SOURCE 2: the legacy Supabase cache Path A reads. Kept for continuity, but it is
  // only 880 rows / 373 recipients, so its silence is NEVER evidence of absence.
  try {
    let q = client
      .from('usaspending_awards')
      .select('recipient_name, award_amount', { count: 'exact' });
    q = q.ilike('recipient_name', `%${name || canonicalUei}%`);
    const { data, count, error } = await q.limit(50);
    if (error) throw new Error(error.message);
    anyQueried = true;
    const n = count ?? data?.length ?? 0;
    out.sources.push({
      source: 'usaspending_awards_cache',
      found: n > 0,
      awardCount: n,
      note: n === 0 ? 'cache holds ~880 rows / 373 recipients — silence here is not absence' : undefined,
    });
    if (n > 0) {
      out.hasFederalAwardHistory = true;
      out.recipientName = out.recipientName || data?.[0]?.recipient_name || null;
    }
  } catch (err) {
    out.sources.push({
      source: 'usaspending_awards_cache',
      found: false,
      awardCount: null,
      note: err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120),
    });
  }

  // If NOTHING could be queried we know nothing. Unknown must never render as "no history".
  if (!anyQueried) out.degraded = true;
  return out;
}
