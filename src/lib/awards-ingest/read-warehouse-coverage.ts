/**
 * Soft-read awards warehouse / ingest clocks for contractor profile+history payloads.
 * Missing env or a failed read → null (unknown). Never invents healthy coverage.
 */
import {
  classifyFreshness,
  resolveAwardsIngestClocks,
  type AwardsFreshness,
  type AwardsIngestClocks,
} from './clocks';

export interface AwardsWarehouseCoverage {
  clocks: AwardsIngestClocks | null;
  lastBuilt: string | null;
  freshness: AwardsFreshness;
}

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; value: AwardsWarehouseCoverage | null } | null = null;

/** Test / admin: clear the in-process cache. */
export function clearAwardsWarehouseCoverageCache(): void {
  cache = null;
}

export async function loadAwardsWarehouseCoverage(): Promise<AwardsWarehouseCoverage | null> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    cache = { at: now, value: null };
    return null;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(url, key);
    const { data, error } = await sb
      .from('data_sources')
      .select('last_built, notes')
      .eq('key', 'bq_awards')
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('[awards-coverage] data_sources read failed:', error.message);
      cache = { at: now, value: null };
      return null;
    }
    const lastBuilt = data?.last_built ?? null;
    const clocks = resolveAwardsIngestClocks({
      notes: data?.notes ?? null,
      lastBuilt,
    });
    const freshness = classifyFreshness({ clocks });
    const value: AwardsWarehouseCoverage = { clocks, lastBuilt, freshness };
    cache = { at: now, value };
    return value;
  } catch (err) {
    console.error('[awards-coverage] unexpected:', err instanceof Error ? err.message : err);
    cache = { at: now, value: null };
    return null;
  }
}
