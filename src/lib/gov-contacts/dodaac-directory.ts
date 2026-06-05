/**
 * DoDAAC directory lookup — resolves office CODES to NAMES from the
 * dodaac_directory reference table (populated from FPDS via
 * scripts/populate-dodaac-directory.mjs). This is the single source of truth
 * for office names; the in-code DODAAC_NAMES map in dodaac.ts is now just a
 * fallback for the handful of common ones when the table isn't reachable.
 *
 * Cached in-process (the directory changes slowly) so we don't hit the table
 * on every contact row.
 */
import { createClient } from '@supabase/supabase-js';

let _cache: Map<string, string> | null = null;
let _cacheAt = 0;
const TTL_MS = 60 * 60 * 1000; // 1h

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** Load (and cache) the full code→name map. ~thousands of rows, small. */
export async function loadDodaacNames(): Promise<Map<string, string>> {
  if (_cache && Date.now() - _cacheAt < TTL_MS) return _cache;
  const map = new Map<string, string>();
  try {
    // page through — the directory is a few thousand rows.
    for (let from = 0; from < 60000; from += 1000) {
      const { data, error } = await sb()
        .from('dodaac_directory')
        .select('dodaac, office_name')
        .range(from, from + 999);
      if (error || !data || data.length === 0) break;
      for (const r of data as { dodaac: string; office_name: string }[]) {
        if (r.dodaac && r.office_name) map.set(r.dodaac.toUpperCase(), r.office_name);
      }
      if (data.length < 1000) break;
    }
  } catch {
    // table not ready / unreachable — return whatever we have (empty), callers
    // fall back to the in-code names + raw code.
  }
  _cache = map;
  _cacheAt = Date.now();
  return map;
}
