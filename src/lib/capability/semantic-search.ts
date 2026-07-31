/**
 * Semantic contractor search over capability embeddings (PRD Phase 3).
 * docs/PRD-contractor-capability-profiles.md
 *
 * WHAT THIS ADDS: today partner discovery is CODE OVERLAP — findCapableSmallBusinesses() scores
 * PSC/NAICS matches, which only finds firms filed under the codes you already thought of. This
 * finds firms whose WORK means the same thing, in the buyer's own words: "drone maintenance for
 * the Navy" surfaces the right firms whether they file under 336411, 541330 or 811310.
 *
 * NOT a replacement for the code scorer — a complement. Code match proves a firm has literally
 * won that PSC; semantic match finds the ones you'd never have queried for.
 *
 * WHY IN-PROCESS COSINE, NOT pgvector: this DB has no pgvector (embeddings live as jsonb
 * number[1536], same as user_notification_settings.capability_embedding). Scanning ~71K vectors
 * in Node is ~50ms of arithmetic and needs no extension, no migration, no index build. If this
 * grows past a few hundred thousand rows, revisit — but do not add a dependency we don't need yet.
 */
import { getReadClient } from '@/lib/supabase/server-clients';
import { embedBatch, cosineSimilarity } from './embed';

export interface SemanticMatch {
  rollup_uei: string;
  rollup_name: string;
  state: string | null;
  capability_label: string | null;
  capability_summary: string | null;
  specialty_tier: 'specialist' | 'focused' | 'diversified' | null;
  award_count: number;
  total_obligated: number;
  /** Cosine similarity, 0..1. Reported so the UI can be honest about match strength. */
  similarity: number;
}

/**
 * MEASURED-EMPIRICALLY threshold. Capability-blob vs free-text query similarity sits well below
 * the 0.8+ people expect from embeddings: the existing hidden-match feature measured a real
 * ceiling of ~0.50 on the same model (see HIDDEN_MATCH_THRESHOLD in market/embeddings.ts, tuned
 * from 0.55 because it never fired). We start at 0.30 as the "worth showing" floor and let the
 * caller raise it; anything below is noise dressed as a match.
 */
export const SEMANTIC_MIN_SIMILARITY = parseFloat(process.env.CAPABILITY_SEMANTIC_MIN || '0.30');

const COLS =
  'rollup_uei, rollup_name, state, capability_label, capability_summary, specialty_tier, award_count, total_obligated, capability_embedding';

/** PostgREST returns at most 1,000 rows per request, whatever .limit() says. */
const PAGE = 1000;
/**
 * Vectors to scan per search. 20K x 1536 floats is ~120MB of JSON over the wire and ~50ms of
 * cosine arithmetic — the wire cost dominates, so this is the practical ceiling before pgvector
 * becomes worth adding. Rows are taken most-obligated-first, so the cap keeps the contractors
 * most worth matching against.
 */
const MAX_SCAN_ROWS = parseInt(process.env.CAPABILITY_SEMANTIC_SCAN_MAX || '20000', 10);

/** The full capability corpus size — reported as `scanned` on the pgvector fast path (which the HNSW
 *  index considers in full), so the panel's "nothing matched vs nothing embedded" signal stays right. */
const CAPABILITY_CORPUS_SIZE = 71101;

/**
 * Page a PostgREST query past the 1,000-row cap.
 * Returns as soon as a short page arrives (end of data) or the cap is hit.
 */
async function fetchAllPages<T>(
  builder: { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> },
  max: number,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const to = Math.min(from + PAGE, max) - 1;
    const { data, error } = await builder.range(from, to);
    if (error) return { data: out, error };
    const page = data || [];
    out.push(...page);
    if (page.length < to - from + 1) break; // short page → no more rows
  }
  return { data: out, error: null };
}

/**
 * Find contractors whose capability MEANS what the query says.
 *
 * Filters (state / tier / minAwards) are applied in SQL BEFORE the vector scan, so a narrow
 * search reads far fewer rows. Returns [] on any failure — semantic search is an enhancement,
 * and a failure here must never break the caller.
 */
export async function searchContractorsBySemantic(opts: {
  query: string;
  state?: string;
  specialtyTier?: 'specialist' | 'focused' | 'diversified';
  minAwards?: number;
  minSimilarity?: number;
  limit?: number;
}): Promise<{ matches: SemanticMatch[]; scanned: number; query: string }> {
  const query = (opts.query || '').trim();
  if (!query) return { matches: [], scanned: 0, query };
  const limit = Math.min(opts.limit ?? 25, 100);
  const minSim = opts.minSimilarity ?? SEMANTIC_MIN_SIMILARITY;

  try {
    const [queryVec] = await embedBatch([query]);
    if (!queryVec?.length) return { matches: [], scanned: 0, query };

    const sb = getReadClient();

    // FAST PATH (pgvector): do the nearest-neighbour search IN Postgres via the capability_semantic_search
    // RPC (migration 20260731_capability_pgvector.sql — HNSW index on a real vector(1536) column). This
    // is ~sub-second over ALL 71K rows, vs the 43s the JS-cosine fallback below takes paging 20K
    // embeddings over the wire (Eric 2026-07-31: Partner Finder "stuck on Matching…"). If the RPC/column
    // isn't there yet (migration not run), we FALL BACK to the JS scan so nothing breaks in the interim.
    // specialtyTier isn't a param on the RPC (rarely used); the fast path filters it in JS post-fetch.
    try {
      const { data: rpcData, error: rpcErr } = await sb.rpc('capability_semantic_search', {
        query_vec: queryVec,
        // over-fetch a little so a post-filter (tier/minSim) still returns `limit`
        match_limit: Math.min(limit * 3, 300),
        filter_state: opts.state ? opts.state.toUpperCase() : null,
        min_awards: opts.minAwards ?? 0,
      });
      if (!rpcErr && Array.isArray(rpcData)) {
        const matches: SemanticMatch[] = [];
        for (const r of rpcData as Array<SemanticMatch & { similarity: number }>) {
          if (opts.specialtyTier && r.specialty_tier !== opts.specialtyTier) continue;
          const similarity = Math.round((r.similarity ?? 0) * 1000) / 1000;
          if (similarity < minSim) continue;
          matches.push({
            rollup_uei: r.rollup_uei, rollup_name: r.rollup_name, state: r.state,
            capability_label: r.capability_label, capability_summary: r.capability_summary,
            specialty_tier: r.specialty_tier, award_count: r.award_count,
            total_obligated: r.total_obligated, similarity,
          });
          if (matches.length >= limit) break;
        }
        // scanned = the whole indexed corpus (the RPC considered all of it), for the "nothing matched
        // vs nothing embedded" signal the panel shows.
        return { matches, scanned: CAPABILITY_CORPUS_SIZE, query };
      }
      // rpcErr (e.g. function/extension missing) → fall through to the JS scan below.
      if (rpcErr) console.error('[capability/semantic] pgvector RPC unavailable, falling back to JS scan:', rpcErr.message);
    } catch (e) {
      console.error('[capability/semantic] pgvector RPC threw, falling back:', (e as Error).message);
    }

    // FALLBACK PATH (JS cosine) — only runs if the pgvector RPC isn't available.
    let q = sb
      .from('contractor_capability_profiles')
      .select(COLS)
      .not('capability_embedding', 'is', null);

    if (opts.state) q = q.eq('state', opts.state.toUpperCase());
    if (opts.specialtyTier) q = q.eq('specialty_tier', opts.specialtyTier);
    if (opts.minAwards) q = q.gte('award_count', opts.minAwards);

    // Rank by proven volume so that if the row cap bites, we keep the contractors most worth
    // matching against rather than an arbitrary slice.
    // PostgREST hard-caps a response at 1,000 rows regardless of .limit(), so a single call
    // silently scanned only the top 1,000 by obligated $ — the mega-primes — and never reached
    // the small businesses this feature exists to surface. Page explicitly with .range().
    const { data, error } = await fetchAllPages(q.order('total_obligated', { ascending: false }), MAX_SCAN_ROWS);
    if (error) { console.error('[capability/semantic] read failed:', error.message); return { matches: [], scanned: 0, query }; }

    const rows = (data || []) as Array<SemanticMatch & { capability_embedding: number[] | null }>;
    const scored: SemanticMatch[] = [];
    for (const r of rows) {
      const vec = r.capability_embedding;
      if (!vec?.length) continue;
      const similarity = cosineSimilarity(queryVec, vec);
      if (similarity < minSim) continue;
      scored.push({
        rollup_uei: r.rollup_uei,
        rollup_name: r.rollup_name,
        state: r.state,
        capability_label: r.capability_label,
        capability_summary: r.capability_summary,
        specialty_tier: r.specialty_tier,
        award_count: r.award_count,
        total_obligated: r.total_obligated,
        similarity: Math.round(similarity * 1000) / 1000,
      });
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return { matches: scored.slice(0, limit), scanned: rows.length, query };
  } catch (err) {
    console.error('[capability/semantic] threw:', (err as Error).message);
    return { matches: [], scanned: 0, query };
  }
}

/**
 * Partner-fit: find contractors whose capability COMPLEMENTS a given firm rather than duplicating
 * it — the actual teaming question ("who covers what I can't").
 *
 * Uses the anchor's own embedding as the semantic neighbourhood, then EXCLUDES near-duplicates:
 * a firm too similar to the anchor is a competitor, not a partner. The upper bound is what makes
 * this different from plain similarity search.
 */
export async function findComplementaryPartners(opts: {
  rollupUei: string;
  state?: string;
  limit?: number;
  /** Above this the firm does what you already do — a competitor. */
  maxSimilarity?: number;
  /** Below this it's unrelated work, not a plausible teammate. */
  minSimilarity?: number;
}): Promise<{ anchor: string | null; matches: SemanticMatch[]; scanned: number }> {
  const limit = Math.min(opts.limit ?? 25, 100);
  // MEASURED BAND (2026-07-28), not guessed. Anchor FOSTER-CAVINESS ("Fruits and vegetables"),
  // 8,000 contractors scored:
  //   top 50 by similarity → 50/50 carried the IDENTICAL capability label (pure competitors)
  //   0.80–0.86  same or near-identical work ("Fruits and vegetables", "Food, oils and fats")
  //   0.70–0.80  close cousins ("Meat, poultry, and fish")
  //   0.60–0.70  GENUINE ADJACENCY — "Composite food packages", "Food (housekeeping)": a real
  //              teaming partner who does related-but-different work
  //   0.50–0.60  unrelated ("Household furnishings", "Lodging") — noise
  // A first pass used 0.45–0.85 and returned four more fruit-and-vegetable firms, i.e. exactly
  // the competitors this mode exists to EXCLUDE. The upper bound is the whole feature.
  const maxSim = opts.maxSimilarity ?? 0.75;
  const minSim = opts.minSimilarity ?? 0.6;

  try {
    const sb = getReadClient();
    const { data: anchorRows, error: aErr } = await sb
      .from('contractor_capability_profiles')
      .select('rollup_uei, rollup_name, capability_label, capability_embedding')
      .eq('rollup_uei', opts.rollupUei)
      .limit(1);
    if (aErr || !anchorRows?.length) return { anchor: null, matches: [], scanned: 0 };

    const anchor = anchorRows[0] as { rollup_uei: string; rollup_name: string; capability_label: string | null; capability_embedding: number[] | null };
    if (!anchor.capability_embedding?.length) return { anchor: anchor.rollup_name, matches: [], scanned: 0 };

    let q = sb
      .from('contractor_capability_profiles')
      .select(COLS)
      .not('capability_embedding', 'is', null)
      .neq('rollup_uei', opts.rollupUei);
    if (opts.state) q = q.eq('state', opts.state.toUpperCase());

    // Same 1,000-row PostgREST cap as the search path — page explicitly, or partner fit would
    // only ever consider the largest 1,000 firms.
    const { data, error } = await fetchAllPages(q.order('total_obligated', { ascending: false }), MAX_SCAN_ROWS);
    if (error) { console.error('[capability/partners] read failed:', error.message); return { anchor: anchor.rollup_name, matches: [], scanned: 0 }; }

    const rows = (data || []) as Array<SemanticMatch & { capability_embedding: number[] | null }>;
    const scored: SemanticMatch[] = [];
    for (const r of rows) {
      const vec = r.capability_embedding;
      if (!vec?.length) continue;
      const similarity = cosineSimilarity(anchor.capability_embedding, vec);
      // The band IS the feature: adjacent enough to team, distinct enough not to compete.
      if (similarity < minSim || similarity > maxSim) continue;
      // Belt-and-braces on top of the band: an IDENTICAL capability label is a competitor by
      // definition, whatever the cosine says. Cheap, and it removes the most obviously wrong
      // rows a user would notice first.
      if (anchor.capability_label && r.capability_label === anchor.capability_label) continue;
      scored.push({
        rollup_uei: r.rollup_uei,
        rollup_name: r.rollup_name,
        state: r.state,
        capability_label: r.capability_label,
        capability_summary: r.capability_summary,
        specialty_tier: r.specialty_tier,
        award_count: r.award_count,
        total_obligated: r.total_obligated,
        similarity: Math.round(similarity * 1000) / 1000,
      });
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return { anchor: anchor.rollup_name, matches: scored.slice(0, limit), scanned: rows.length };
  } catch (err) {
    console.error('[capability/partners] threw:', (err as Error).message);
    return { anchor: null, matches: [], scanned: 0 };
  }
}
