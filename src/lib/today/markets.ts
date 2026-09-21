/**
 * Explore by Market — the DISCOVERY half of /today (state 1, and the fallback for every
 * other state). See `docs/today-page-states.md` for the behavioral model.
 *
 * Eric, 2026-08-15: a first-time visitor must never be told "nothing tracked yet." That
 * sentence is about our system's state, not their goal. Instead the page asks "where would
 * you like to start?" and answers it with real markets and real counts.
 *
 * ⚠️ EVERY COUNT IS A LIVE QUERY. An early mockup hand-wrote "Construction — 14,200 active
 * opportunities"; the real figure is ~3,690, and Manufacturing (the actual leader at ~16,389)
 * wasn't even in the list. A plausible number on a discovery tile is still a fabricated one,
 * and it is the first thing a new visitor sees. Count, don't guess.
 *
 * The taxonomy is the SHARED `INDUSTRY_PRESETS` — the same buckets the map's industry picker
 * applies. Reusing it means a tile and the map it links to can never disagree about what
 * "Construction" means. (Those presets are deliberately mutually exclusive; see the taxonomy
 * rule at the top of industry-presets.ts.)
 */
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { INDUSTRY_PRESETS } from '@/lib/industry-presets';

export interface MarketTile {
  /** Clean display name from the shared preset (never a bare NAICS code). */
  name: string;
  /** Live count of ACTIVE opportunities across this preset's codes. */
  active: number;
  /** Deep link into the map with this preset's codes pre-applied. */
  href: string;
}

/** How many tiles the page shows. The data chooses WHICH — we only choose how many. */
const TILE_COUNT = 6;

const TILES_CACHE_KEY = 'today:market-tiles:v1';

/**
 * Same contract as the intel cache next door: the TTL deliberately OUTLIVES the refresh
 * interval so a missed cron degrades to slightly-older REAL counts rather than making a
 * visitor eat the ~4s compute. Freshness is controlled by the cron cadence, not this number.
 * (Counts move slowly — a market's active total does not meaningfully change hour to hour.)
 */
const TILES_TTL_SECONDS = 6 * 60 * 60;

/**
 * A preset must clear this to be offered as a starting point. A market with 3 open
 * opportunities is a dead end for someone choosing where to begin, and sending a new user
 * into an almost-empty map is a worse first impression than not offering it at all.
 */
const MIN_ACTIVE = 25;

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Count ACTIVE opportunities for one industry preset.
 *
 * Returns `null` — never 0 — when the count cannot be established. A missing table returns
 * `count=null, error=null, HTTP 204` with no error at all, so `?? 0` would turn "I don't
 * know" into "this market is empty" and the tile would silently vanish (or worse, render a
 * confident zero). Bug Prevention Rule #11.
 */
async function countPreset(
  db: NonNullable<ReturnType<typeof sb>>,
  codes: string[],
): Promise<number | null> {
  const parts = await Promise.all(
    codes.map(async (code) => {
      const { count, error } = await db
        .from('sam_opportunities')
        .select('*', { count: 'exact', head: true })
        .eq('active', true)
        .like('naics_code', `${code}%`);
      if (error || typeof count !== 'number') return null;   // unknown, not zero
      return count;
    }),
  );
  // ONE unknown part makes the whole total unknown — a partial sum would understate the
  // market and still look like a confident number.
  if (parts.some((p) => p === null)) return null;
  return (parts as number[]).reduce((a, b) => a + b, 0);
}

/**
 * The markets a new visitor can start from, ranked by real volume.
 *
 * Degrades honestly: a preset whose count fails is DROPPED (we don't know its size, so we
 * can't offer it as a starting point), and if every count fails the caller gets an empty
 * array and falls back to Featured per the hierarchy in docs/today-page-states.md.
 */
export async function getMarketTiles(): Promise<MarketTile[]> {
  try {
    const hit = await kv.get<MarketTile[]>(TILES_CACHE_KEY);
    // Guard on real content, not truthiness — an empty array cached after a total failure
    // would pin the discovery half closed for a whole TTL.
    if (Array.isArray(hit) && hit.length > 0) return hit;
  } catch (err) {
    console.warn('[today-markets] KV read failed; computing live:', err);
  }

  const fresh = await computeMarketTiles();

  // Only cache a REAL result. Caching [] would freeze the fallback-to-Featured path in place
  // even after the database recovered.
  if (fresh.length > 0) {
    try {
      await kv.set(TILES_CACHE_KEY, fresh, { ex: TILES_TTL_SECONDS });
    } catch (err) {
      console.warn('[today-markets] KV write failed (serving live result):', err);
    }
  }
  return fresh;
}

/** Force a recompute + write-through. Called by the precompute cron alongside the intel warm-up. */
export async function refreshMarketTilesCache(): Promise<MarketTile[]> {
  const fresh = await computeMarketTiles();
  if (fresh.length > 0) {
    try {
      await kv.set(TILES_CACHE_KEY, fresh, { ex: TILES_TTL_SECONDS });
    } catch (err) {
      console.warn('[today-markets] KV write failed during refresh:', err);
    }
  }
  return fresh;
}

async function computeMarketTiles(): Promise<MarketTile[]> {
  const db = sb();
  if (!db) return [];

  // Every preset counts CONCURRENTLY. Sequentially this is ~22 round trips (~4.2s measured);
  // the round trip, not the query, is the whole cost — no individual count exceeded ~200ms.
  const counted = await Promise.all(
    INDUSTRY_PRESETS.map(async (preset) => {
      const active = await countPreset(db, preset.codes);
      return { name: preset.name, codes: preset.codes, active };
    }),
  );

  return counted
    .filter((m): m is { name: string; codes: string[]; active: number } =>
      typeof m.active === 'number' && m.active >= MIN_ACTIVE)
    .sort((a, b) => b.active - a.active)
    .slice(0, TILE_COUNT)
    .map((m) => ({
      name: m.name,
      active: m.active,
      // Same comma-joined NAICS param the map's own industry picker writes, so the tile
      // lands on exactly the market it advertised.
      href: `/opportunity-map?naics=${encodeURIComponent(m.codes.join(','))}`,
    }));
}
