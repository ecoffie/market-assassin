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
import { expandOfficeSearchTerms } from './office-aliases';

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
    // Reads the VIEW, not the table: display_name prefers the CURRENT office
    // name from SAM (sam_office_name, 1,247 rows) and falls back to the
    // historical FPDS name. The COALESCE lives in the view so it is defined
    // once instead of at every call site.
    //
    // If the view is missing (fresh DB, migration not yet run), fall back to
    // the base table — an unnamed office is a far worse failure than a stale
    // one, and every panel in the app labels offices from this map.
    for (let from = 0; from < 60000; from += 1000) {
      let { data, error } = await sb()
        .from('dodaac_directory_display')
        .select('dodaac, display_name')
        .range(from, from + 999);
      if (error) {
        const fallback = await sb()
          .from('dodaac_directory')
          .select('dodaac, office_name')
          .range(from, from + 999);
        if (fallback.error || !fallback.data?.length) break;
        // Normalise to the view's column name so the loop below is uniform.
        data = fallback.data.map((r: { dodaac: string; office_name: string | null }) => ({
          dodaac: r.dodaac,
          display_name: r.office_name,
        })) as typeof data;
        error = null;
        console.warn('[dodaac] display view unavailable, using office_name');
      }
      if (!data || data.length === 0) break;
      for (const r of data as { dodaac: string; display_name: string }[]) {
        if (r.dodaac && r.display_name) map.set(r.dodaac.toUpperCase(), r.display_name);
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

// dodaac → early-signal score. Separate cache from the name maps because the
// map decorates thousands of pins per request and only needs these two fields.
let _early: Map<string, { band: 'high' | 'medium' | 'low' | 'none'; pct: number }> | null = null;
let _earlyAt = 0;

/**
 * Load (and cache) dodaac → early-signal band + percent, for offices that
 * cleared the sample floor.
 *
 * Reads `early_signal_shown` from the display view rather than re-deriving the
 * floor here — the view already encodes it, so the badge and the score cannot
 * disagree.
 */
export async function loadDodaacEarlySignal(): Promise<
  Map<string, { band: 'high' | 'medium' | 'low' | 'none'; pct: number }>
> {
  if (_early && Date.now() - _earlyAt < TTL_MS) return _early;
  const map = new Map<string, { band: 'high' | 'medium' | 'low' | 'none'; pct: number }>();
  try {
    for (let from = 0; from < 60000; from += 1000) {
      const { data, error } = await sb()
        .from('dodaac_directory_display')
        .select('dodaac, early_signal_band, early_signal_pct')
        .eq('early_signal_shown', true)
        .range(from, from + 999);
      if (error || !data || data.length === 0) break;
      for (const r of data as { dodaac: string; early_signal_band: string | null; early_signal_pct: number | null }[]) {
        if (!r.dodaac || !r.early_signal_band) continue;
        map.set(r.dodaac.toUpperCase(), {
          band: r.early_signal_band as 'high' | 'medium' | 'low' | 'none',
          pct: Number(r.early_signal_pct ?? 0),
        });
      }
      if (data.length < 1000) break;
    }
  } catch {
    // Unreachable / not yet scored — callers fall back to no badge.
  }
  _early = map;
  _earlyAt = Date.now();
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
    // Same view-first read as loadDodaacNames() — officeName is the DISPLAY
    // name (current SAM name where known, else FPDS), so office labels are
    // consistent no matter which loader a caller reaches for.
    for (let from = 0; from < 60000; from += 1000) {
      let { data, error } = await sb()
        .from('dodaac_directory_display')
        .select('dodaac, display_name, sub_agency')
        .range(from, from + 999);
      if (error) {
        const fallback = await sb()
          .from('dodaac_directory')
          .select('dodaac, office_name, sub_agency')
          .range(from, from + 999);
        if (fallback.error || !fallback.data?.length) break;
        data = fallback.data.map((r: { dodaac: string; office_name: string | null; sub_agency: string | null }) => ({
          dodaac: r.dodaac,
          display_name: r.office_name,
          sub_agency: r.sub_agency,
        })) as typeof data;
        error = null;
      }
      if (!data || data.length === 0) break;
      for (const r of data as { dodaac: string; display_name: string | null; sub_agency: string | null }[]) {
        if (r.dodaac) map.set(r.dodaac.toUpperCase(), { officeName: r.display_name || null, subAgency: r.sub_agency || null });
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
  // Tracks whether ANY sub_agency match was the BROADENING kind: the stored
  // label is a strict prefix-word of the query ("navy" ⊂ "navy operational
  // support center"). Those matches answer a narrower question with a broader
  // answer, so a more specific query returns MORE rows — see below.
  let broadened = false;
  for (const [subAgency, codeSet] of bySubAgency) {
    const sa = normalizeAgencyKey(subAgency);
    if (!sa) continue;
    // Exact, or either side contains the other (handles "Missile Defense Agency"
    // vs the directory's "missile defense agency (mda)"). Guard against the
    // 1-word over-match by requiring the shorter string be a real token-run.
    if (sa === target || (target.length >= 4 && (sa.includes(target) || target.includes(sa)))) {
      if (sa !== target && target.includes(sa) && sa.length < target.length) broadened = true;
      for (const c of codeSet) codes.add(c);
    }
  }

  // sub_agency alone cannot resolve COMMANDS. Every USACE district, MICC office
  // and USPFO activity carries sub_agency "Department of the Army" — 238 rows
  // sharing one label — so "USACE" matches either nothing or the entire Army.
  // The command identity lives in office_name, as an abbreviation ("ENDIST
  // LOUISVILLE"), and the phrase "Corps of Engineers" appears in ZERO rows.
  // Fall back to an alias-expanded office_name scan. (Measured 2026-07-31.)
  if (codes.size === 0) {
    for (const c of await dodaacCodesForOfficeName(agencyName)) codes.add(c);
    return Array.from(codes);
  }

  // A BROADENED sub_agency match is worse than useless: it answers a specific
  // command with its whole parent department, so asking a NARROWER question
  // returns MORE rows. Measured against the live directory (2026-07-31):
  //   "Navy Operational Support Center"        → 545 (all Navy)   should be 104
  //   "Air Force Life Cycle Management Center" → 370 (all AF)     should be 120
  //   "Army Contracting Command"               → 354 (all Army)   should be  38
  // When the office_name path can answer the same query more precisely, prefer
  // it. Exact and narrowing sub_agency matches (DCMA 97, MDA 19) never take
  // this branch, so agencies that already resolved correctly are untouched.
  if (broadened) {
    const precise = await dodaacCodesForOfficeName(agencyName);
    if (precise.length > 0 && precise.length < codes.size) return precise;
  }
  return Array.from(codes);
}

/**
 * Resolve a command/office name → DoDAAC codes by scanning office_name through
 * the abbreviation alias layer. This is what makes "Corps of Engineers" find
 * the 46 "ENDIST <city>" rows.
 *
 * Kept separate from the sub_agency path (and only used as its fallback) so an
 * agency that DOES resolve by sub_agency is unaffected — this can only add
 * results where there were none.
 */
export async function dodaacCodesForOfficeName(name: string): Promise<string[]> {
  const terms = expandOfficeSearchTerms(name).map(t => t.toLowerCase().trim()).filter(t => t.length >= 3);
  if (!terms.length) return [];
  const dir = await loadDodaacDirectory();
  const codes = new Set<string>();
  // Short tokens must match a WHOLE word; long ones may match a word prefix.
  //
  // Measured against the live directory (2026-07-31), prefix matching on short
  // abbreviations is badly wrong: "CONS" hits 167 rows but only 64 are real
  // Contracting Squadrons — the other 103 are CONSTRUCTION / CONSULTING /
  // CONSOLIDATED. "ACC" hits 50, of which 12 are ACCOUNTING. Meanwhile the
  // prefix rule is genuinely needed for long tokens: "NAVFAC" (6 chars) must
  // still find "NAVFACSYSCOM MID-ATLANTIC" (13 rows) — hence 6, not 7.
  const PREFIX_MIN_LEN = 6;
  const patterns = terms.map(t => {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(t.length >= PREFIX_MIN_LEN ? `\\b${esc}` : `\\b${esc}\\b`);
  });
  for (const [dodaac, info] of dir) {
    const office = (info.officeName || '').toLowerCase();
    if (!office) continue;
    if (patterns.some(re => re.test(office))) codes.add(dodaac);
  }
  return Array.from(codes);
}
