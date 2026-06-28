/**
 * Office-name normalizer — ONE place that turns terse FPDS/DoDAAC office strings
 * into readable display names across Mindy (Alerts, MarketResearch, MyTargetList,
 * Pipeline, Proposals, Recompetes, forecasts/find-agencies/federal-contacts ...).
 *
 * Consolidation, phase 2a (docs/tasks/BACKLOG-later.md → "Office / agency-name
 * normalization — full pass"). This replaces THREE divergent normalizers that
 * had drifted apart and were extended independently:
 *   - expandOfficeName        (was src/lib/gov-contacts/dodaac.ts)
 *   - cleanOfficeNameForDisplay (was src/components/app/panels/MyTargetListPanel.tsx)
 *   - enhanceOfficeName        (was src/lib/utils/usaspending-helpers.ts)
 *
 * Phase 2a (PARITY-FIRST): each old function had a genuinely different algorithm
 * AND its own token map, so 2a merged NO data and changed NO output — the three
 * behaviors are ported VERBATIM as three internal `mode`s selected via opts, locked
 * by a characterization test over a 793-string real corpus
 * (tests/office-name-parity.test.mts + tests/fixtures/office-name-*.json).
 *
 * Phase 2c (GSA slash-soup): the FIRST deliberate behavior change — `clean` mode now
 * has a delimiter-aware path for GSA office strings ("GSA/FAS/PSHC/…", ~2,300
 * offices) so they read as names instead of raw soup. Gated to strings starting
 * "GSA/", so every NON-GSA `clean` output (and all of expand/enhance) stays
 * byte-for-byte identical. The golden baseline was regenerated to bless the 22
 * changed GSA strings.
 *
 * Still DEFERRED to phase 2d: AF/Navy/VA acronyms, context-aware ACC, DoDAAC-code
 * stripping, expand/enhance convergence, and folding in the government-contracts.ts
 * cluster below.
 *
 * NOT consolidated here (separate, out-of-scope cluster): src/lib/government-contracts.ts
 * has its OWN expandOfficeName/enhanceOfficeName/officeNameEnhancements (agency-acronym
 * expansion, only used by /api/government-contracts/search) — fold in later.
 */

export type OfficeNameMode = 'expand' | 'clean' | 'enhance';

export interface NormalizeOfficeOptions {
  /** Which legacy behavior to reproduce. Default 'expand'. */
  mode?: OfficeNameMode;
}

// ───────────────────────────── EXPAND mode ─────────────────────────────
// Ported verbatim from dodaac.ts. FPDS office names are terse military
// abbreviations ("87 CONS PK", "765 ABS CONF"); expand the common tokens so they
// read like names, not codes, keeping the numeric unit prefix. Used by
// formatDodaacOffice (the DoD solicitation-number office label).
const EXPAND_ABBREV: Record<string, string> = {
  CONS: 'Contracting Squadron',
  CONF: 'Contracting Flight',
  ABS: 'Air Base Squadron',
  ABW: 'Air Base Wing',
  CES: 'Civil Engineer Squadron',
  LGC: 'Logistics Contracting',
  LRS: 'Logistics Readiness Squadron',
  MSC: 'Mission Support',
  SOPS: 'Space Operations Squadron',
  CONTR: 'Contracting',
  PK: '', // 'PK' = a contracting subgroup; drop the noise token
  // Army command tokens (Eric, Jun 27). Only UNAMBIGUOUS tokens — deliberately NOT
  // 'ACC' (Army Contracting Command vs Air Force Air Combat Command). Recognizable
  // command acronyms (MICC, AMC) pass through unchanged.
  ENDIST: 'Engineer District',
  USACE: 'US Army Corps of Engineers',
  USAG: 'US Army Garrison',
  USARC: 'US Army Reserve Command',
  AMCOM: 'Aviation & Missile Command',
  ECC: 'Expeditionary Contracting Command',
  RCO: 'Regional Contracting Office',
  DIST: 'District',
  FT: 'Fort',
};

function expandMode(name: string): string {
  if (!name) return name;
  // Only expand when it looks like a terse code-name (has a SHORT all-caps token).
  const tokens = name.trim().split(/\s+/);
  const expanded = tokens
    .map((t) => {
      const up = t.toUpperCase();
      if (up in EXPAND_ABBREV) return EXPAND_ABBREV[up];
      return t;
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return expanded || name;
}

// ───────────────────────────── CLEAN mode ─────────────────────────────
// Ported verbatim from MyTargetListPanel.tsx. The dodaac_directory stores the RAW
// abbreviation ("AFLCMC WLMK HEAVY AIRLIFT DV"); strip a leading DoDAAC code +
// trailing "/xx" suffix, expand abbreviations, preserve known acronyms, title-case.
const CLEAN_ABBREV: Record<string, string> = {
  ENDIST: 'Engineer District', DIST: 'District', DET: 'Detachment',
  DV: 'Division', DIV: 'Division', BN: 'Battalion', BDE: 'Brigade',
  SQ: 'Squadron', WG: 'Wing', GP: 'Group', BW: 'Bomb Wing',
  CONS: 'Contracting Squadron', CONF: 'Contracting Flight', CONTR: 'Contracting',
  RCO: 'Regional Contracting Office', CTR: 'Center', CMD: 'Command',
};
// Keep these as uppercase acronyms (don't title-case to "Aflcmc").
const CLEAN_ACRONYMS = new Set([
  'AFLCMC', 'AESS', 'NAVSUP', 'NAVSEA', 'NAVAIR', 'NAVWAR', 'NAVFAC', 'NUWC', 'NSWC',
  'DLA', 'MICC', 'USACE', 'SOCOM', 'AFB', 'USAF', 'JBSA', 'PEO', 'DHA', 'DTRA', 'MDA',
]);
const CLEAN_DROP = new Set(['PK']); // FPDS noise token
const CLEAN_SMALL_WORDS = new Set(['and', 'of', 'the', 'for', 'a', 'an', 'to', 'in', 'at']);

// Phase 2c — GSA slash-soup. GSA office strings are slash/dash/comma-delimited
// ("GSA/FAS/PSHC/PROF SRVCS SCHED-PSS", ~2,300 offices), which the whitespace-only
// tokenizer never split → they rendered as raw soup. These tokens expand the GSA
// service/category acronyms. Unknown sub-codes (GSS, QSCA…) fall through to
// title-case — still far more readable than the raw string.
const GSA_TOKENS: Record<string, string> = {
  FAS: 'Federal Acquisition Service',
  PBS: 'Public Buildings Service',
  ITC: 'IT Category',
  PSS: 'Professional Services Schedule',
  SCHED: 'Schedule',
  ACQ: 'Acquisition',
  SRVCS: 'Services',
  SVCS: 'Services',
};

// Map one token to its display form. `gsa` enables the GSA token set (phase 2c) —
// it is OFF for the non-GSA path so that path stays byte-for-byte identical to the
// original cleanMode (a stray "ACQ"/"PSS"/"PBS" token must NOT expand outside GSA).
function titleCaseToken(tok: string, index: number, gsa: boolean): string[] {
  const up = tok.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (CLEAN_DROP.has(up)) return [];
  if (gsa && up === 'GSA') return ['GSA'];
  if (gsa && GSA_TOKENS[up]) return [GSA_TOKENS[up]];
  if (CLEAN_ABBREV[up]) return [CLEAN_ABBREV[up]];
  if (CLEAN_ACRONYMS.has(up)) return [up];
  if (/^\d+$/.test(tok)) return [tok];
  const lower = tok.toLowerCase();
  if (index > 0 && CLEAN_SMALL_WORDS.has(lower)) return [lower];
  return [tok.charAt(0).toUpperCase() + lower.slice(1)];
}

function cleanMode(name: string): string {
  if (!name) return name;

  // GSA strings are slash-delimited and the LAST segment is meaningful (don't let
  // the trailing-"/xx" stripper eat it), so they get their own delimiter-aware
  // path. Everything else keeps the original behavior BYTE-FOR-BYTE (parity).
  if (/^GSA\s*\//i.test(name.trim())) {
    const out = name.trim().split(/[\s/\-,]+/).filter(Boolean)
      .flatMap((tok, i) => titleCaseToken(tok, i, true));
    return out.join(' ') || name.trim();
  }

  const stripped = name.trim()
    .replace(/^[A-Za-z]{1,2}\d{2,4}[A-Za-z0-9]{0,3}\s+/, '') // leading DoDAAC code
    .replace(/\s*\/\s*\w{2,5}\s*$/, '')                       // trailing /xx suffix
    .trim();
  if (!stripped) return name.trim();
  const out = stripped.split(/\s+/).flatMap((tok, i) => titleCaseToken(tok, i, false));
  return out.join(' ') || name.trim();
}

// ───────────────────────────── ENHANCE mode ─────────────────────────────
// Ported verbatim from usaspending-helpers.ts. Whole-string dictionary (direct
// match, then substring) over USASpending awarding-office names, after stripping a
// leading DoDAAC code that USASpending prepends ("FA8614 Air Force…").
export const officeNameEnhancements: Record<string, string> = {
  'Endist Omaha': 'U.S. Army Engineer District, Omaha',
  'W071': 'U.S. Army Engineer District, Omaha',
  'Endist Sacramento': 'U.S. Army Engineer District, Sacramento',
  'Endist Louisville': 'U.S. Army Engineer District, Louisville',
  'Endist Norfolk': 'U.S. Army Engineer District, Norfolk',
  'USA Eng Spt Ctr Huntsvil': 'U.S. Army Engineering and Support Center, Huntsville, Alabama',
  '2V6': 'U.S. Army Engineering and Support Center, Huntsville, Alabama',
  'ACC-PICA': 'Army Contracting Command - Program Integration and Contracting Activity',
  'W6QK': 'Army Contracting Command',
  'ACC-APG Natick': 'Army Contracting Command - Aberdeen Proving Ground, Natick',
  'ACC-RSA': 'Army Contracting Command - Redstone Arsenal',
  'ACC-APG': 'Army Contracting Command - Aberdeen Proving Ground',
  'Afmc Wpafb Oh': 'Air Force Materiel Command - Wright-Patterson AFB, Ohio',
  'Afsc Maxwell Afb Al': 'Air Force Sustainment Center - Maxwell AFB, Alabama',
  '772 ESS PKD': '772 Enterprise Sourcing Squadron - Wright-Patterson AFB',
  'Navfac Northwest': 'Naval Facilities Engineering Command Northwest',
  'Navfac Atlantic': 'Naval Facilities Engineering Command Atlantic',
  'Navfac Pacific': 'Naval Facilities Engineering Command Pacific',
  'Navsup Flc Norfolk': 'Naval Supply Systems Command Fleet Logistics Center Norfolk',
  'Cbp Oaq': 'U.S. Customs and Border Protection - Office of Acquisition',
  'Svc': 'Service',
  'Dept': 'Department',
  'Hq': 'Headquarters',
  'Cmd': 'Command',
  'Ctr': 'Center',
};

function enhanceMode(officeName: string): string {
  if (!officeName) return officeName;

  // Strip a leading DoDAAC code (6-char alphanumeric office code, e.g. "FA8614",
  // "W912DY", "N00024") that USASpending prepends to office names. Only strips a
  // 6-char token with a letter + ≥2 digits (a code, never a real word) followed by
  // a separator, and only when a readable name remains.
  const dodaac = officeName.match(/^([A-Za-z0-9]{6})[\s:.\-]+(\S.*)$/);
  if (dodaac) {
    const [, code, rest] = dodaac;
    if (/[A-Za-z]/.test(code) && (code.match(/\d/g)?.length ?? 0) >= 2) {
      officeName = rest.trim();
    }
  }

  if (officeNameEnhancements[officeName]) return officeNameEnhancements[officeName];

  for (const [abbrev, fullName] of Object.entries(officeNameEnhancements)) {
    if (officeName.includes(abbrev)) return fullName;
  }

  return officeName;
}

// ───────────────────────────── public API ─────────────────────────────

/**
 * Normalize a government office name for display. `mode` picks which legacy
 * behavior to reproduce (see module header). Returns '' for null/empty input —
 * every call site either passes a non-empty string or uses `|| fallback`, so this
 * is behavior-preserving.
 */
export function normalizeOfficeName(
  name: string | null | undefined,
  opts: NormalizeOfficeOptions = {},
): string {
  if (!name) return '';
  switch (opts.mode ?? 'expand') {
    case 'clean':
      return cleanMode(name);
    case 'enhance':
      return enhanceMode(name);
    case 'expand':
    default:
      return expandMode(name);
  }
}
