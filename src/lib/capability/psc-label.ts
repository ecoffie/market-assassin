/**
 * Turn a raw PSC description into a readable capability label.
 * PRD Phase 2 — docs/PRD-contractor-capability-profiles.md
 *
 * WHY THIS IS DETERMINISTIC AND NOT AN LLM: these are the FACTS of what a company does. Rule #1 —
 * the LLM may label and write, but facts come from data. A model paraphrasing 1,799 distinct PSC
 * strings would drift ("SUPPORT- PROFESSIONAL: EXPERT WITNESS" → "litigation consulting", which is
 * an inference nobody can trace). Everything here is a reversible string transform: the output is
 * always a re-cased/re-ordered form of the real psc_description, never a new claim.
 *
 * MEASURED SHAPE (71,101 profiles, 2026-07-28): 1,799 distinct top-PSC descriptions with a long
 * tail — the top 25 cover 31.7% of profiles, top 100 only 54.3%, top 400 83.9%, top 800 95.5%.
 * So a hand-curated map CANNOT carry this alone; the transform has to be algorithmic, with a
 * curated map only for strings whose plain-English form can't be derived mechanically.
 *
 * The strings are highly structured, which is what makes this tractable:
 *   "HOUSEKEEPING- CUSTODIAL JANITORIAL"                    → CATEGORY- DETAIL
 *   "SUPPORT- PROFESSIONAL: ENGINEERING/TECHNICAL"          → CATEGORY- SUB: DETAIL
 *   "MAINT/REPAIR/REBUILD OF EQUIPMENT- ELECTRICAL AND ..." → VERB OF NOUN- DETAIL
 *   "NATIONAL DEFENSE R&D SERVICES; DEPARTMENT OF DEFENSE - MILITARY; APPLIED RESEARCH"
 *                                                           → A; B; C  (semicolon-delimited)
 */

/**
 * Curated overrides — ONLY for strings where the mechanical transform reads badly or the
 * government's phrasing is actively misleading to a small-business user. Keys are the exact
 * upper-case psc_description. Chosen from the measured top-40 by profile count.
 *
 * Each value must still be a faithful description of the SAME work — this is re-wording for
 * readability, never re-categorizing.
 */
const CURATED: Record<string, string> = {
  'SUPPORT- PROFESSIONAL: OTHER': 'Professional services',
  'SUPPORT- ADMINISTRATIVE: OTHER': 'Administrative support services',
  'SUPPORT- MANAGEMENT: OTHER': 'Management support services',
  'SUPPORT- PROFESSIONAL: ENGINEERING/TECHNICAL': 'Engineering & technical services',
  'SUPPORT- PROFESSIONAL: PROGRAM MANAGEMENT/SUPPORT': 'Program management support',
  'SUPPORT- PROFESSIONAL: EXPERT WITNESS': 'Expert witness services',
  'SUPPORT- PROFESSIONAL: LEGAL': 'Legal services',
  'SUPPORT- ADMINISTRATIVE: TRANSLATION AND INTERPRETING': 'Translation & interpreting',
  'HOUSEKEEPING- CUSTODIAL JANITORIAL': 'Custodial & janitorial services',
  'HOUSEKEEPING- LANDSCAPING/GROUNDSKEEPING': 'Landscaping & groundskeeping',
  'HOUSEKEEPING- TRASH/GARBAGE COLLECTION': 'Trash & garbage collection',
  'HOUSEKEEPING- WASTE TREATMENT/STORAGE': 'Waste treatment & storage',
  'HOUSEKEEPING- GUARD': 'Security guard services',
  'NATURAL RESOURCES/CONSERVATION- FOREST-RANGE FIRE SUPPRESSION/PRESUPPRESSION':
    'Wildland fire suppression',
  'MEDICAL AND SURGICAL INSTRUMENTS, EQUIPMENT, AND SUPPLIES':
    'Medical & surgical equipment supply',
  'MEDICAL- NURSING HOME CARE CONTRACTS': 'Nursing home care',
  'MEDICAL- MEDICAL/PSYCHIATRIC CONSULTATION': 'Medical & psychiatric consultation',
  'MEDICAL- EVALUATION/SCREENING': 'Medical evaluation & screening',
  'MEDICAL- OTHER': 'Medical services',
  'LABORATORY EQUIPMENT AND SUPPLIES': 'Laboratory equipment & supplies',
  'TRANSPORTATION/TRAVEL/RELOCATION- TRAVEL/LODGING/RECRUITMENT: LODGING, HOTEL/MOTEL':
    'Lodging & hotel services',
  'ARCHITECT AND ENGINEERING- GENERAL: OTHER': 'Architecture & engineering',
  'ARCHITECT AND ENGINEERING- GENERAL: LANDSCAPING, INTERIOR LAYOUT, AND DESIGNING':
    'Landscape & interior design',
  'EDUCATION/TRAINING- OTHER': 'Education & training',
  'EDUCATION/TRAINING- GENERAL': 'Education & training',
  'EDUCATION/TRAINING- TRAINING/CURRICULUM DEVELOPMENT': 'Training & curriculum development',
  'EDUCATION/TRAINING- TUITION/REGISTRATION/MEMBERSHIP FEES': 'Tuition & registration services',
  'ENVIRONMENTAL SYSTEMS PROTECTION- ENVIRONMENTAL REMEDIATION': 'Environmental remediation',
  'OTHER ENVIRONMENTAL SERVICES': 'Environmental services',
  'LIQUID PROPELLANTS AND FUELS, PETROLEUM BASE': 'Petroleum fuels supply',
  'HARDWARE, COMMERCIAL': 'Commercial hardware supply',
  'OFFICE FURNITURE': 'Office furniture supply',
  'OFFICE SUPPLIES': 'Office supplies',
  'CONSTRUCTION OF MISCELLANEOUS BUILDINGS': 'Building construction',
  'CONSTRUCTION OF OTHER NON-BUILDING FACILITIES': 'Non-building facility construction',
  'CONSTRUCTION OF OFFICE BUILDINGS': 'Office building construction',
  'REPAIR OR ALTERATION OF OFFICE BUILDINGS': 'Office building repair & alteration',
  'REPAIR OR ALTERATION OF MISCELLANEOUS BUILDINGS': 'Building repair & alteration',
  'OPERATION OF MISCELLANEOUS BUILDINGS': 'Facility operations',
  'DRUGS AND BIOLOGICALS': 'Pharmaceuticals & biologics',
  'GUIDED MISSILES': 'Guided missiles',
  'GUIDED MISSILE SYSTEMS, COMPLETE': 'Complete guided missile systems',
  'GUIDED MISSILE COMPONENTS': 'Guided missile components',
  'AIRCRAFT, FIXED WING': 'Fixed-wing aircraft',
  'COMBAT SHIPS AND LANDING VESSELS': 'Combat ships & landing vessels',
  'MISCELLANEOUS WEAPONS': 'Weapons systems',
  'MISCELLANEOUS OFFICE MACHINES': 'Office machines',
  'PASSENGER MOTOR VEHICLES': 'Passenger vehicles',
};

/**
 * Expand the government's contractions. Order matters — longest-first so "MAINT/REPAIR/REBUILD"
 * is handled before a bare "MAINT" would be.
 */
const EXPANSIONS: Array<[RegExp, string]> = [
  [/\bMAINT\/REPAIR\/REBUILD OF EQUIPMENT\b/gi, 'Maintenance & repair of'],
  [/\bMAINT\/REPAIR\/REBUILD\b/gi, 'Maintenance & repair'],
  [/\bMAINT\b/gi, 'Maintenance'],
  [/\bR&D\b/gi, 'R&D'],
  [/\bIT AND TELECOM\b/gi, 'IT & telecom'],
  [/\bADP\b/g, 'IT'],
  [/\bADPE\b/g, 'IT equipment'],
];

/** Words that must never be title-cased away from their canonical form. */
const KEEP_UPPER = new Set([
  'IT', 'R&D', 'ADP', 'HVAC', 'IDIQ', 'GSA', 'DOD', 'VA', 'US', 'USA', 'NASA', 'EPA',
  'AI', 'GIS', 'GPS', 'RF', 'UAV', 'CBRN', 'EOD', 'PPE', 'MRO', 'OCONUS', 'CONUS',
  'QC', 'QA', 'A&E', 'O&M', 'ADPE', 'SATCOM', 'C4I', 'ISR', 'CNC', 'NDT',
]);

/**
 * Sentence-case a label: capitalize the FIRST word only, preserve known acronyms, leave the rest
 * lower-case. Deliberately not word-by-word title case — these strings are long noun phrases, and
 * title-casing every word produced "Electrical and Electronic Equipment Components (maintenance &
 * Repair Of)". Sentence case reads like English: "Electrical and electronic equipment components".
 *
 * Parenthetical qualifiers keep their own lower-case run, so "(maintenance & repair)" stays clean.
 */
function sentenceCase(s: string): string {
  const parts = s.toLowerCase().split(/(\s+|\/|-|\(|\))/); // keep delimiters
  let capitalizedFirst = false;
  return parts.map((w) => {
    if (!w || /^(\s+|\/|-|\(|\))$/.test(w)) return w;
    const upper = w.toUpperCase();
    // Acronyms and unit tokens (75mm) keep their canonical form.
    if (KEEP_UPPER.has(upper)) { capitalizedFirst = true; return upper; }
    if (/^\d+mm$/i.test(w)) { capitalizedFirst = true; return w.toLowerCase(); }
    if (!capitalizedFirst) { capitalizedFirst = true; return w.charAt(0).toUpperCase() + w.slice(1); }
    return w; // everything after the first word stays lower-case
  }).join('');
}

/**
 * Convert a raw PSC description into a readable label.
 *
 * Returns the cleaned label, or null when there's nothing usable — callers must handle null
 * rather than invent a placeholder (a wrong capability label is worse than none).
 */
export function cleanPscLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Curated override wins (exact, case-insensitive on the raw government string).
  const curated = CURATED[trimmed.toUpperCase()];
  if (curated) return curated;

  let s = trimmed;

  // 1b. "R&D- DEFENSE OTHER: OTHER (BASIC RESEARCH)" — every segment is "OTHER" except the
  //     trailing parenthetical, which is the ONLY real detail. Promote it to the head and keep
  //     the category. Without this the whole label collapsed to null.
  const trailingParen = /^(.*?)-\s*(.*?)\s*\(([^)]+)\)\s*$/.exec(s);
  if (trailingParen) {
    const [, cat, middle, paren] = trailingParen;
    // A segment counts as detail-free when it's blank or resolves to OTHER/MISCELLANEOUS —
    // including qualified forms like "DEFENSE OTHER", where "OTHER" is the operative word.
    const middleIsEmpty = middle
      .split(':')
      .every((p) => /^\s*$/.test(p) || /(^|\s)(OTHER|MISCELLANEOUS|MISC\.?)\s*$/i.test(p));
    if (middleIsEmpty && paren.trim()) s = `${paren.trim()} (${cat.trim()})`;
  }

  // 2. Semicolon form: "NATIONAL DEFENSE R&D SERVICES; DEPARTMENT OF DEFENSE - MILITARY; APPLIED
  //    RESEARCH". The LAST segment is the most specific ("applied research"); the first is the
  //    domain. Keep domain + specific, drop the funding-agency middle — it's not a capability.
  if (s.includes(';')) {
    const parts = s.split(';').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 3) s = `${parts[parts.length - 1]} (${parts[0]})`;
    else if (parts.length === 2) s = `${parts[1]} (${parts[0]})`;
  }

  // 3. Apply contraction expansions before casing.
  for (const [re, rep] of EXPANSIONS) s = s.replace(re, rep);

  // 4. "CATEGORY- SUB: DETAIL" → lead with the VERB when the category is an action
  //    ("Maintenance & repair of electrical and electronic equipment components"), otherwise lead
  //    with the specific detail and keep the category as a short parenthetical.
  //    A trailing ": OTHER" carries no information, so fall back to the category itself.
  const dashSplit = s.split(/-\s+/);
  if (dashSplit.length >= 2) {
    const category = dashSplit[0].trim();
    const rest = dashSplit.slice(1).join(' - ').trim();
    const colonParts = rest.split(':').map((p) => p.trim()).filter(Boolean);
    const specific = colonParts[colonParts.length - 1] || '';

    // Action-shaped categories read far better as a leading verb phrase than a trailing
    // parenthetical: "(maintenance & repair of)" was the ugliest output of the first pass.
    const actionMatch = /^(Maintenance & repair of|Maintenance & repair|INSTALLATION OF EQUIPMENT|CONSTRUCTION OF|REPAIR OR ALTERATION OF|OPERATION OF|MODIFICATION OF EQUIPMENT|OVERHAUL OF EQUIPMENT|REBUILDING OF EQUIPMENT|SALVAGE|LEASE OR RENTAL OF EQUIPMENT)$/i.exec(category);
    if (actionMatch && specific && !/^OTHER$/i.test(specific)) {
      const verb = category
        .replace(/^INSTALLATION OF EQUIPMENT$/i, 'Installation of')
        .replace(/^MODIFICATION OF EQUIPMENT$/i, 'Modification of')
        .replace(/^OVERHAUL OF EQUIPMENT$/i, 'Overhaul of')
        .replace(/^REBUILDING OF EQUIPMENT$/i, 'Rebuilding of')
        .replace(/^LEASE OR RENTAL OF EQUIPMENT$/i, 'Lease/rental of')
        .replace(/\s+of$/i, ' of');
      s = /\bof$/i.test(verb) ? `${verb} ${specific}` : `${verb} of ${specific}`;
    } else if (/^(OTHER|MISCELLANEOUS|MISC\.?)$/i.test(specific) || !specific) {
      // ": OTHER" / "- MISCELLANEOUS" carry no detail, so the CATEGORY is the only real signal.
      // Guard: when the subcategory is ALSO "OTHER" ("TRANSPORTATION/TRAVEL/RELOCATION- OTHER:
      // OTHER") fall through to the category rather than emitting "Other (…)" — and never let the
      // downstream "strip leading Other/Miscellaneous" rule blank the whole label (that produced
      // 11 nulls per 3,000 rows before this guard).
      const sub = colonParts.length > 1 ? colonParts[0] : '';
      s = sub && !/^(OTHER|MISCELLANEOUS|MISC\.?)$/i.test(sub) ? `${sub} (${category})` : category;
    } else if (colonParts.length > 1) {
      s = `${specific} (${colonParts[0]})`;
    } else {
      s = `${specific} (${category})`;
    }
  }

  // 5. Sentence-case, collapse whitespace, drop qualifiers that add nothing.
  s = sentenceCase(s.replace(/\s+/g, ' ').trim())
    .replace(/\s*\((other|general|labor|misc\.?|miscellaneous)\)\s*$/i, '')
    // Strip a leading "Other "/"Miscellaneous " ONLY when something substantive remains —
    // otherwise "OTHER QC/TEST/INSPECT- MISCELLANEOUS" lost its head and returned null.
    .replace(/^(other|miscellaneous)\s+(?=\S)/i, (m, _w, off: number, whole: string) =>
      whole.slice(m.length).trim().length >= 3 ? '' : m)
    .replace(/\s+,/g, ',')
    .trim();

  // 5a. Collapse a SECOND trailing parenthetical — the category-plus-subcategory path could emit
  //     "IT management support services (labor) (IT & telecom)". Keep only the last one, which is
  //     the broader domain and the more useful context.
  const parens = s.match(/\(([^)]*)\)/g);
  if (parens && parens.length > 1) {
    const stripped = s.replace(/\s*\([^)]*\)/g, '').trim();
    s = `${stripped} ${parens[parens.length - 1]}`.trim();
  }

  // 5b. Drop a parenthetical that merely repeats the head phrase ("Relocation (relocation)").
  s = s.replace(/^(.*?)\s*\(([^)]*)\)$/, (_m, head: string, qual: string) => {
    const h = head.toLowerCase().replace(/[^a-z0-9]/g, '');
    const q = qual.toLowerCase().replace(/[^a-z0-9]/g, '');
    return h === q || h.includes(q) || q.includes(h) ? head.trim() : `${head.trim()} (${qual})`;
  });

  // Re-capitalize if the leading-word strip above removed the capital.
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1);

  if (!s) return null;
  // Cap length so a UI chip can't be blown out by a 120-char government string. Trim at a word
  // boundary and drop a dangling parenthetical rather than cutting mid-word.
  if (s.length > 72) {
    const cut = s.slice(0, 72);
    const lastSpace = cut.lastIndexOf(' ');
    s = `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[\s(,&/-]+$/, '')}…`;
  }
  return s;
}

/** Human $ for summaries: 1234567 → "$1.2M". Never fabricates precision it doesn't have. */
export function money(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

export type SpecialtyTier = 'specialist' | 'focused' | 'diversified';

export interface SummaryInput {
  capability_label: string | null;
  specialty_tier: SpecialtyTier | null;
  specialty_score: number | null;
  award_count: number;
  total_obligated: number;
  top_agencies: Array<{ agency?: string; share?: number }> | null;
  top_pscs: Array<{ description?: string }> | null;
  last_award_date: string | null;
  set_asides_won: string[] | null;
}

/**
 * Compose the one-line capability summary from FACTS ONLY.
 *
 * Every clause is traceable to a column. No adjectives the data doesn't support — we say
 * "82% of contract dollars", not "highly specialized". Set-aside is described as work WON under
 * a set-aside, never as a certification the firm holds (recipient_certifications is the source
 * of truth for certs — inferring them mislabeled SAIC as SDVOSB/8(a)).
 */
export function composeCapabilitySummary(p: SummaryInput): string | null {
  const raw = p.capability_label;
  if (!raw) return null;

  // A label truncated at 72 chars reads as broken mid-sentence ("…software as a service (IT…
  // specialist — 85% of contract dollars"). For the SUMMARY, use a shorter, self-contained form:
  // drop the ellipsis and any parenthetical it was cutting into.
  const label = raw.includes('…')
    ? raw.replace(/\s*\(?[^()]*…$/, '').replace(/[\s(,&/-]+$/, '').trim() || raw.replace(/…$/, '').trim()
    : raw;

  const parts: string[] = [];

  // Lead with what they do + how concentrated they are (the actual insight).
  if (p.specialty_tier === 'specialist' && p.specialty_score != null) {
    parts.push(`${label} specialist — ${Math.round(p.specialty_score * 100)}% of contract dollars`);
  } else if (p.specialty_tier === 'focused' && p.specialty_score != null) {
    parts.push(`${label}-focused — ${Math.round(p.specialty_score * 100)}% of contract dollars`);
  } else if (p.specialty_tier === 'diversified') {
    const n = p.top_pscs?.length ?? 0;
    // Lower-case the first character ONLY when the leading token isn't an acronym: a blanket
    // .toLowerCase() destroyed "IT & telecom" → "it & telecom", and naively lowering char 0
    // turned "R&D administrative expenses" into "r&D". Leave acronym-initial labels as-is.
    const firstToken = label.split(/[\s/-]/)[0].replace(/[^A-Za-z&]/g, '');
    const lead = KEEP_UPPER.has(firstToken.toUpperCase())
      ? label
      : label.charAt(0).toLowerCase() + label.slice(1);
    parts.push(n > 1 ? `Diversified, led by ${lead}` : label);
  } else {
    parts.push(label);
  }

  // Proven volume.
  if (p.award_count > 0) {
    parts.push(`${p.award_count.toLocaleString()} award${p.award_count === 1 ? '' : 's'} · ${money(p.total_obligated)}`);
  }

  // Primary buyer, only when meaningfully concentrated (>=40% — below that "top" agency is noise).
  const topAgency = p.top_agencies?.[0];
  if (topAgency?.agency && (topAgency.share ?? 0) >= 0.4) {
    parts.push(`mostly ${topAgency.agency} (${Math.round((topAgency.share ?? 0) * 100)}%)`);
  }

  // Set-aside BEHAVIOR — deliberately hedged wording.
  const sa = (p.set_asides_won || []).filter((s) => s && !/NO SET ASIDE/i.test(s));
  if (sa.length) parts.push('has won set-aside work');

  return parts.join(' · ');
}
