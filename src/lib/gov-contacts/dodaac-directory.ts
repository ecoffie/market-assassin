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

// sub_agency (lowercased) → set of DoDAAC codes. Lets us anchor contacts to the
// REAL contracting office instead of the broad department label — DoD POCs in
// federal_contacts are all tagged "DEPT OF DEFENSE", so DARPA/MDA/etc. collapse
// to the whole department. The solicitation_number prefix (a DoDAAC) identifies
// the actual sub-agency (DARPA = HR0011, MDA = HQ08xx). (Eric, Jun 25.)
let _subAgencyCodes: Map<string, Set<string>> | null = null;
let _subAgencyCodesAt = 0;

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

// dodaac → { officeName, subAgency } — the forward map, for tagging a notice's
// buying office from its solicitation-number DoDAAC (event office re-tagging).
let _dir: Map<string, { officeName: string | null; subAgency: string | null }> | null = null;
let _dirAt = 0;

/** Load (and cache) dodaac → {officeName, subAgency} from the directory table. */
export async function loadDodaacDirectory(): Promise<Map<string, { officeName: string | null; subAgency: string | null }>> {
  if (_dir && Date.now() - _dirAt < TTL_MS) return _dir;
  const map = new Map<string, { officeName: string | null; subAgency: string | null }>();
  try {
    for (let from = 0; from < 60000; from += 1000) {
      const { data, error } = await sb()
        .from('dodaac_directory')
        .select('dodaac, office_name, sub_agency')
        .range(from, from + 999);
      if (error || !data || data.length === 0) break;
      for (const r of data as { dodaac: string; office_name: string | null; sub_agency: string | null }[]) {
        if (r.dodaac) map.set(r.dodaac.toUpperCase(), { officeName: r.office_name || null, subAgency: r.sub_agency || null });
      }
      if (data.length < 1000) break;
    }
  } catch { /* unreachable — callers fall back to the in-code names + raw code */ }
  _dir = map;
  _dirAt = Date.now();
  return map;
}

/** Load (and cache) sub_agency → set of DoDAAC codes. */
async function loadSubAgencyCodes(): Promise<Map<string, Set<string>>> {
  if (_subAgencyCodes && Date.now() - _subAgencyCodesAt < TTL_MS) return _subAgencyCodes;
  const map = new Map<string, Set<string>>();
  try {
    for (let from = 0; from < 60000; from += 1000) {
      const { data, error } = await sb()
        .from('dodaac_directory')
        .select('dodaac, sub_agency')
        .not('sub_agency', 'is', null)
        .range(from, from + 999);
      if (error || !data || data.length === 0) break;
      for (const r of data as { dodaac: string; sub_agency: string }[]) {
        if (!r.dodaac || !r.sub_agency) continue;
        const key = r.sub_agency.toLowerCase().trim();
        if (!map.has(key)) map.set(key, new Set());
        map.get(key)!.add(r.dodaac.toUpperCase());
      }
      if (data.length < 1000) break;
    }
  } catch { /* unreachable — callers fall back to the department-label filter */ }
  _subAgencyCodes = map;
  _subAgencyCodesAt = Date.now();
  return map;
}

/** Normalize an agency name for sub-agency matching (drop generic words). */
function normalizeAgencyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(department|dept|of|the|us|u\.s\.|,|\(.*?\))\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Resolve a target agency name → the DoDAAC office codes that belong to it, so
 * contacts can be anchored to the REAL office (DARPA, MDA, NAVAIR…) instead of
 * the whole "DEPT OF DEFENSE" pool. Matches the directory's sub_agency labels
 * (exact, then either-contains). Returns [] when nothing maps (caller keeps the
 * department-label filter — civilian agencies, unknown names).
 */
export async function dodaacCodesForAgency(agencyName: string): Promise<string[]> {
  const target = normalizeAgencyKey(agencyName);
  if (target.length < 3) return [];
  const bySubAgency = await loadSubAgencyCodes();
  const codes = new Set<string>();
  for (const [subAgency, codeSet] of bySubAgency) {
    const sa = normalizeAgencyKey(subAgency);
    if (!sa) continue;
    // Exact, or either side contains the other (handles "Missile Defense Agency"
    // vs the directory's "missile defense agency (mda)"). Guard against the
    // 1-word over-match by requiring the shorter string be a real token-run.
    if (sa === target || (target.length >= 4 && (sa.includes(target) || target.includes(sa)))) {
      for (const c of codeSet) codes.add(c);
    }
  }
  return Array.from(codes);
}
