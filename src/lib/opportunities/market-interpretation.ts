/**
 * FIND market interpretation — customer language → government market plan.
 *
 * Buyer alias lookup is NORMALIZATION (not expansion): SOCOM and USSOCOM are
 * the same buyer. Walking to Department of Defense is expansion and is refused.
 *
 * Capability related-market is EXPANSION and must stay labeled:
 * DIRECT_MATCH vs RELATED_MARKET_CANDIDATE. Cybersecurity is not the IT NAICS
 * family; that family may contain cyber work but cannot be claimed as cyber.
 */
import aliasData from '@/data/agency-aliases.json';
import { getIndustryPreset, type IndustryPreset } from '@/lib/industry-presets';
import { agencyOrExpr } from '@/lib/opportunities/agency-match';

export type EvidenceClass = 'DIRECT_MATCH' | 'RELATED_MARKET_CANDIDATE';

export type BuyerKind = 'none' | 'normalization' | 'passthrough';

export interface BuyerIdentity {
  requested: string | null;
  canonical: string | null;
  aliases: string[];
  needles: string[];
  kind: BuyerKind;
  parent_department_applied: false;
  reason: string;
}

export interface TaxonomyPin {
  source: string;
  naics: string[];
  psc: string[];
  terms: string[];
  reason: string;
  /**
   * Retrieval vocabulary (trade / product presets only, 2026-11-14): phrases that ADD recall as exact phrases over
   * `vocabCols`, in the same `.or()` as the text matcher and the codes. Never narrows, never replaces the customer's
   * own words. Absent on every other interpretation (no behaviour change).
   */
  vocab?: string[];
  vocabCols?: Array<'title' | 'description'>;
}

export interface CapabilityInterpretation {
  requested: string;
  kind: 'cyber_with_related_it' | 'industry_preset' | 'literal';
  direct: TaxonomyPin;
  related_market: TaxonomyPin | null;
  excluded: Array<{ phrase: string; reason: string }>;
  /** Which trade / product presets produced this interpretation (RC2 evidence classifier reads it). Absent otherwise. */
  codePresets?: { trades: string[]; products: string[] };
}

export interface MarketInterpretation {
  customer_phrase: string;
  buyer: BuyerIdentity;
  capability: CapabilityInterpretation;
  retrieval_plan: {
    buyer_is_normalization: true;
    related_market_applied: boolean;
    related_market_reason: string | null;
  };
  truth: {
    what_was_requested: { phrase: string; buyer: string | null };
    what_was_consumed: string[];
    what_was_expanded: string[];
  why: string;
  what_remains_unsupported: string[];
  records?: {
    DIRECT_MATCH: string[];
    RELATED_MARKET_CANDIDATE: string[];
  };
};
}

export interface ClassifiableRecord {
  title?: string | null;
  description?: string | null;
  naics_code?: string | null;
  naics_description?: string | null;
  psc_code?: string | null;
  incumbent_name?: string | null;
}

const SHARED_ALIASES = (aliasData as { aliases?: Record<string, string> }).aliases || {};

function fold(s: string): string {
  return String(s || '')
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/[,/&()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALIAS_BY_FOLD = new Map<string, { key: string; canonical: string }>();
for (const [k, v] of Object.entries(SHARED_ALIASES)) {
  const fk = fold(k);
  if (fk && !ALIAS_BY_FOLD.has(fk)) ALIAS_BY_FOLD.set(fk, { key: k, canonical: v });
}

/** DoD parent spellings — never added when the requested buyer is a component. */
const DOD_PARENT_FOLDS = new Set(
  [
    'DEPARTMENT OF DEFENSE',
    'DEPT OF DEFENSE',
    'DOD',
    'DD',
    'DEFENSE',
    'PENTAGON',
    'MILITARY',
  ].map(fold),
);

export const CYBER_DIRECT_RE =
  /\b(cyber(?:\s*security)?|information\s+security|infosec|network\s+security|zero[\s-]?trust|siem)\b/i;

export const PHYSICAL_SECURITY_RE =
  /\b(physical\s+security|access[\s-]?control|security\s+doors?|guard\s+services|perimeter\s+security|security\s+fence|locksmith|security\s+guard)\b/i;

/**
 * Phrase → industry preset. The preset's codes are always RETRIEVED. When `directNaics` is set, only
 * those codes are DIRECT evidence for the phrase; the rest of the preset family is the related
 * market (retrieved and shown, labelled RELATED_MARKET_CANDIDATE, never counted as the requested
 * work). Without it, every preset code is direct (construction and IT services: the family IS the work).
 *
 * Why (2026-11-14, Ask Mindy production test): "janitorial services in Florida" returned
 * "Bombing Range Operation" (NAICS 561210, PSC M1PZ) and "AFCAP VI" (561210, PSC S216) labelled
 * "Direct match — the record itself establishes relevance". Neither record mentions janitorial work;
 * 561210 is Facilities Support Services, part of the Facilities & Maintenance family.
 */
const PHRASE_PRESET: Array<{ match: RegExp; name: string; directNaics?: string[]; alsoDirect?: Array<{ match: RegExp; naics: string[] }>; relatedReason?: string }> = [
  { match: /\bconstruction\b/i, name: 'Construction' },
  {
    match: /\bjanitorial\b|\bcustodial\b/i,
    name: 'Facilities & Maintenance',
    directNaics: ['561720'],
    alsoDirect: [
      { match: /\b(landscaping|grounds maintenance|lawn care|mowing)\b/i, naics: ['561730'] },
      { match: /\b(facilities support|facility support|base operations|facilities management|facility management)\b/i, naics: ['561210'] },
    ],
    relatedReason:
      'Facilities support and landscaping contracts sit in the same industry family and can include janitorial work, '
      + 'but they are not janitorial contracts. Rows retrieved only by these codes are RELATED_MARKET_CANDIDATE.',
  },
  { match: /\bit\s+services\b|\binformation\s+technology\b/i, name: 'IT Services' },
];

function uniqueFold(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = String(v || '').trim();
    if (!t) continue;
    const k = fold(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function stripParenAcronym(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function pinFromPreset(preset: IndustryPreset, reason: string, extraTerms: string[] = []): TaxonomyPin {
  return {
    source: preset.name,
    naics: [...preset.codes],
    psc: [...(preset.psc || [])],
    terms: uniqueFold([preset.name, ...extraTerms]),
    reason,
  };
}

/**
 * Normalize a customer buyer string to search needles using agency-aliases.json.
 * Sibling spellings of the SAME canonical identity are included. Parent department
 * is never added.
 */
export function resolveBuyerIdentity(raw: string | null | undefined): BuyerIdentity {
  const requested = String(raw || '').trim();
  if (!requested) {
    return {
      requested: null,
      canonical: null,
      aliases: [],
      needles: [],
      kind: 'none',
      parent_department_applied: false,
      reason: 'No buyer named.',
    };
  }

  const hit = ALIAS_BY_FOLD.get(fold(requested));
  if (!hit) {
    return {
      requested,
      canonical: null,
      aliases: [requested],
      needles: [requested],
      kind: 'passthrough',
      parent_department_applied: false,
      reason: `No alias for “${requested}”; used as typed. Not broadened to a parent department.`,
    };
  }

  const canonical = hit.canonical;
  const siblings: string[] = [];
  for (const [k, v] of Object.entries(SHARED_ALIASES)) {
    if (v === canonical) siblings.push(k);
  }
  const needles = uniqueFold([
    requested,
    canonical,
    stripParenAcronym(canonical),
    ...siblings,
  ]).filter((n) => !DOD_PARENT_FOLDS.has(fold(n)) || DOD_PARENT_FOLDS.has(fold(requested)));

  return {
    requested,
    canonical,
    aliases: uniqueFold(siblings),
    needles,
    kind: 'normalization',
    parent_department_applied: false,
    reason: `“${requested}” is the same buyer as ${canonical}. This is spelling normalization, not a wider department.`,
  };
}

/** PostgREST OR across awarding/department AND sub-agency/sub_tier for the same buyer. */
export function dualBuyerOrExpr(depCol: string, subCol: string, needles: string[]): string {
  const dep = agencyOrExpr(depCol, needles);
  const sub = agencyOrExpr(subCol, needles);
  return [dep, sub].filter(Boolean).join(',');
}


/**
 * TRADE and PRODUCT presets (Agent 3, 2026-11-14; Eric approved "next phase" 2026-11-14; Agent 4 v4 benchmark).
 *
 * Measured problem: 0 of 14 benchmark phrasings reached any code. 9 of 13 guard-coded notices never say "guard"
 * ("Protective Security Officer Services"); DLA product titles name the ITEM ("48--VLV, REGUL PRESSURE",
 * "59--RELAY,THERMAL"), never the category the customer types ("valves", "electrical components").
 *
 * Rules (each is a test in trade-product-presets.unit.test.ts):
 *  - SERVICES: the trade's OWN codes only (6-digit NAICS + its PSC). No related family: the janitorial preset's related
 *    family cost 93% → 43% alert precision (#2043 eval). Own-code rows are DIRECT, as for every preset.
 *  - PRODUCTS: specific 4-digit FSC codes RETRIEVE but never prove relevance: a code-only row is
 *    RELATED_MARKET_CANDIDATE (basis `product_code`). DIRECT needs item evidence in the record (the customer's words or
 *    the item noun / DLA abbreviation in the title).
 *  - Additive only: the customer's text predicate, exclusions, buyer, state and set-aside constraints are unchanged
 *    (they AND in the plan). A "quoted" query is a literal request and never reaches these tables.
 *  - Consulted only when no existing interpretation (cyber, physical security, PHRASE_PRESET) claimed the phrase,
 *    except guards, which the physical-security branch hands here so it keeps its "not cyber" note.
 *  - Codes: SAM PSC/FSC manual and NAICS 2022, specific codes only (no 2-digit FSC group, no NAICS family).
 */
type CodePreset = { id: string; label: string; match: RegExp; naics: string[]; psc: string[]; vocab: string[] };
export const TRADE_PRESETS: CodePreset[] = [
  {
    id: 'guards', label: 'Security guard services',
    match: /\b(security\s+guards?|guard\s+services?|guard\s+force|security\s+officers?|protective\s+(?:security\s+)?officers?|(?:un)?armed\s+guards?|protective\s+services)\b/i,
    naics: ['561612'], psc: ['S206'],
    vocab: ['security guard', 'guard services', 'guard service', 'protective security officer', 'security officer services', 'guard force'],
  },
  {
    id: 'janitorial_cleaning', label: 'Janitorial services',
    // "janitorial" / "custodial" are claimed by PHRASE_PRESET first; this row bridges plain "cleaning" phrasing.
    match: /\b(?:commercial|office|building|facility)\s+cleaning\b|\bcleaning\s+(?:services?|company|contractor)\b|\bclean(?:ing)?\s+(?:\w+\s+){0,2}(?:offices?|buildings?|facilit(?:y|ies))\b/i,
    naics: ['561720'], psc: ['S201'],
    vocab: ['janitorial', 'custodial'],
  },
  {
    id: 'grounds', label: 'Landscaping and grounds maintenance',
    match: /\b(landscaping|landscape\s+maintenance|grounds\s+maintenance|grounds\s*keeping|lawn\s+(?:care|maintenance)|mowing)\b/i,
    naics: ['561730'], psc: ['S208'],
    vocab: ['grounds maintenance', 'landscaping', 'landscape maintenance', 'mowing'],
  },
  {
    id: 'hvac', label: 'HVAC maintenance and repair',
    match: /\b(hvac|heating,?\s+ventilation|air\s+conditioning|chillers?|boilers?)\b/i,
    naics: ['238220'], psc: ['J041'],
    vocab: ['hvac', 'chiller', 'chillers', 'boiler', 'boilers', 'air conditioning'],
  },
  {
    // RC3 (Agent 4 v7: nursing below 40% on both forms; incidental "Nursing Practice Oversight Course", nurse-call
    // construction were DIRECT). Own code: PSC Q401 Medical–Nursing. NOT 561320 (all temporary help) — too broad.
    id: 'nurse_staffing', label: 'Nurse staffing',
    match: /\b(?:nurses|nursing\s+(?:staff|staffing|services|assistants)|registered\s+nurses?|licensed\s+practical\s+nurses?|clinical\s+staff(?:ing)?|medical\s+staffing|healthcare\s+staffing)\b/i,
    naics: [], psc: ['Q401'],
    vocab: ['nursing services', 'nurse staffing', 'nurse staff', 'registered nurse', 'registered nurses', 'licensed practical nurse', 'nursing assistant', 'nursing assistants', 'medical staffing', 'clinical staffing'],
  },
  {
    // RC3 (Agent 4 v7: steel buildings below 40%; steel PRODUCTS — plates, poles, scrap — were DIRECT on "steel").
    // Own codes: 238120 structural steel, 238160 roofing contractors, 332311 prefabricated metal buildings.
    id: 'steel_buildings_roofing', label: 'Steel buildings and metal roofing',
    match: /\b(?:(?:pre-?engineered\s+)?(?:steel|metal)\s+buildings?|metal\s+roof(?:ing|s)?|roofing|standing\s+seam)\b/i,
    naics: ['238120', '238160', '332311'], psc: [],
    vocab: ['pre-engineered metal building', 'pre-engineered steel building', 'metal building', 'steel building', 'steel structure', 'roofing', 'roof replacement', 'reroof', 're-roof', 'metal roof', 'standing seam'],
  },
];
export const PRODUCT_PRESETS: CodePreset[] = [
  { id: 'valves', label: 'Valves', match: /\bvalves?\b/i, naics: [], psc: ['4810', '4820'], vocab: ['valve', 'valves', 'vlv'] },
  {
    id: 'fasteners', label: 'Fasteners', match: /\b(fasteners?|bolts?|screws?|rivets?)\b/i, naics: [],
    psc: ['5305', '5306', '5307', '5310', '5315', '5320', '5325'],
    vocab: ['screw', 'screws', 'bolt', 'bolts', 'nut', 'washer', 'rivet', 'rivets', 'fastener', 'fasteners'],
  },
  {
    id: 'electrical_components', label: 'Electrical and electronic components',
    match: /\belectr(?:ical|onic)\s+(?:and\s+electr(?:ical|onic)\s+)?(?:components?|parts)\b|\b(connectors?|relays?|resistors?|capacitors?|circuit\s+cards?)\b/i,
    naics: [],
    psc: ['5905', '5910', '5915', '5920', '5925', '5930', '5935', '5940', '5945', '5950', '5955', '5960', '5961', '5962', '5963', '5975', '5977', '5995', '5998', '5999'],
    vocab: ['connector', 'relay', 'resistor', 'capacitor', 'circuit card', 'circuit card assembly', 'microcircuit', 'semiconductor', 'transistor', 'cable assembly', 'wiring harness'],
  },
  {
    id: 'aircraft_components', label: 'Aircraft parts and components',
    match: /\b(?:aircraft|aerospace|airframe|aviation)\s+(?:parts|components|spares)\b|\blanding\s+gear\b|\bairframe\b/i,
    naics: [], psc: ['1560', '1610', '1615', '1620', '1630', '1650', '1660', '1680', '2840'],
    vocab: ['airframe', 'landing gear', 'aircraft'],
  },
  {
    // IT HARDWARE (RC3, Eric 2026-11-14: "IT hardware still produces almost no relevant top-20"). Root cause: no preset
    // fired, so "IT" became the information-technology concept and IT SERVICES were DIRECT; and the benchmark floor
    // (7A/7B/7G) is mostly software. Codes: the hardware-bearing IT product PSCs only (SAM PSC manual: compute 7B20–22,
    // data center 7C20–21, end user / print / mobile 7E20–21, digital network 7G21, platform 7H20, security products
    // 7J20, storage 7K20). NOT 7A (perpetual-license software), 7F (management tools), 7G20 (analog voice), 7G22
    // (satellite/RF) or D-series IT services. Codes retrieve; DIRECT needs the item in the title (RC2 product rule).
    id: 'it_hardware', label: 'IT hardware',
    match: /\b(?:computer|it|information\s+technology)\s+(?:hardware|equipment)\b|\b(?:laptops?|desktops?|workstations?|servers|peripherals|networking\s+(?:equipment|hardware)|storage\s+(?:arrays?|hardware))\b/i,
    naics: [],
    psc: ['7B20', '7B21', '7B22', '7C20', '7C21', '7E20', '7E21', '7G21', '7H20', '7J20', '7K20'],
    vocab: ['computer', 'computers', 'laptop', 'laptops', 'desktop', 'desktops', 'server', 'servers', 'workstation', 'workstations',
      'monitor', 'monitors', 'keyboard', 'printer', 'printers', 'router', 'routers', 'docking station', 'tablet', 'tablets', 'storage array', 'hard drive'],
  },
  {
    // Pharmaceuticals ONLY when the customer explicitly sells / distributes / supplies them (Eric, 2026-11-14). A generic
    // "medical supplies" search never reaches FSC 6505. "drug testing" or "drug-free workplace" do not match.
    id: 'pharmaceuticals', label: 'Pharmaceuticals',
    match: /\b(?:sell|sells|supply|supplies|distribute|distributes|distributor\s+of|provide|provides|wholesale\w*|source)\b[^.]{0,40}?\b(?:pharmaceuticals?|drugs|medications?|medicines)\b|\b(?:pharmaceutical|drug|medication)\s+(?:distributor|supplier|wholesaler)s?\b/i,
    naics: [], psc: ['6505'],
    vocab: ['pharmaceutical', 'pharmaceuticals', 'injector', 'tablets', 'capsules'],
  },
  {
    id: 'medical_supplies', label: 'Medical, dental and laboratory supplies',
    match: /\b(?:medical|surgical|dental|laboratory|lab)\b[^.]{0,40}\b(?:supplies|consumables)\b/i,
    naics: [], psc: ['6510', '6515', '6520', '6532', '6540', '6545', '6550', '6640'],
    vocab: ['syringe', 'catheter', 'gauze', 'bandage', 'suture', 'reagent', 'surgical'],
  },
];

/**
 * Product presets whose item words also name other things ("computer" / "monitor" are avionics and instrument items too:
 * "66--COMPUTER,FLIGHT CON", "61--ELEC POWER MONITOR"). For these, a title item word is DIRECT only when it is one of the
 * preset's own item nouns (never the customer's category word, e.g. "IT") AND the notice is filed in one of the preset's
 * PSC families (first two characters). Everything else stays retrieved, as RELATED. Measured: RC3 IT-hardware top-20.
 */
export const STRICT_ITEM_PRESETS: Readonly<Record<string, string[]>> = { it_hardware: ['7B', '7C', '7E', '7G', '7H', '7J', '7K'] };

const isQuoted = (s: string) => /^["\u201c].*["\u201d]$/.test(s.trim());

/** Trade presets the phrase names (services; own codes; DIRECT). Empty for quoted text. */
export function tradePresetsFor(requested: string): CodePreset[] {
  return isQuoted(requested) ? [] : TRADE_PRESETS.filter((t) => t.match.test(requested));
}
/** Product presets the phrase names (FSC recall; code-only = related). Empty for quoted text. */
export function productPresetsFor(requested: string): CodePreset[] {
  return isQuoted(requested) ? [] : PRODUCT_PRESETS.filter((t) => t.match.test(requested));
}

function codePresetInterpretation(
  requested: string, trades: CodePreset[], products: CodePreset[], excluded: CapabilityInterpretation['excluded'],
): CapabilityInterpretation {
  const names = [...trades, ...products].map((p) => p.label).join(' + ');
  const uniq = (xs: string[]) => [...new Set(xs)];
  const tradeVocab = uniq(trades.flatMap((t) => t.vocab));
  const productVocab = uniq(products.flatMap((t) => t.vocab));
  return {
    requested,
    kind: 'industry_preset',
    direct: {
      source: names,
      naics: uniq(trades.flatMap((t) => t.naics)),
      psc: uniq(trades.flatMap((t) => t.psc)),
      terms: uniq([requested, ...tradeVocab, ...productVocab]),
      reason: `Customer phrase names ${names}. Trade codes are the trade's own; product codes only retrieve.`,
      ...(tradeVocab.length || productVocab.length ? { vocab: uniq([...tradeVocab, ...productVocab]) } : {}),
      // Product item nouns live in the TITLE (DLA "NOUN,MODIFIER"); a trade phrase may be in the description.
      vocabCols: trades.length ? ['title', 'description'] : ['title'],
    },
    related_market: products.length
      ? {
        source: products.map((p) => p.label).join(' + '),
        naics: [],
        psc: uniq(products.flatMap((p) => p.psc)),
        terms: [],
        reason: 'Filed under the product code for this item class. The code retrieves the notice; it does not establish that the item is what you sell.',
      }
      : null,
    excluded,
    codePresets: { trades: trades.map((t) => t.id), products: products.map((p) => p.id) },
  };
}

export function interpretCapability(phrase: string): CapabilityInterpretation {
  const requested = String(phrase || '').trim();
  const excluded: CapabilityInterpretation['excluded'] = [];

  if (PHYSICAL_SECURITY_RE.test(requested) && !CYBER_DIRECT_RE.test(requested)) {
    excluded.push({
      phrase: 'physical security / access control',
      reason: 'Physical security is not cybersecurity. Generic “security” does not enter the cyber market.',
    });
    const guards = tradePresetsFor(requested).filter((t) => t.id === 'guards');
    if (guards.length) return codePresetInterpretation(requested, guards, [], excluded);
    return {
      requested,
      kind: 'literal',
      direct: {
        source: 'literal',
        naics: [],
        psc: [],
        terms: [requested],
        reason: 'Literal phrase. No cyber related-market expansion.',
      },
      related_market: null,
      excluded,
    };
  }

  if (/\bsecurity\b/i.test(requested) && !CYBER_DIRECT_RE.test(requested) && !PHYSICAL_SECURITY_RE.test(requested)) {
    excluded.push({
      phrase: 'generic security',
      reason: 'Bare “security” is not cybersecurity and is not expanded into IT or cyber codes.',
    });
  }

  if (CYBER_DIRECT_RE.test(requested)) {
    const cyber = getIndustryPreset('Cybersecurity');
    const it = getIndustryPreset('IT Services');
    if (!cyber || !it) {
      return {
        requested,
        kind: 'literal',
        direct: { source: 'literal', naics: [], psc: [], terms: [requested], reason: 'Industry presets unavailable.' },
        related_market: null,
        excluded,
      };
    }
    return {
      requested,
      kind: 'cyber_with_related_it',
      direct: pinFromPreset(
        cyber,
        'Direct cyber taxonomy: PSC IT Security & Compliance plus hosting NAICS 518210. Not the IT-services family.',
        ['cybersecurity', 'cyber', 'information security', 'network security', 'infosec', 'zero trust', 'SIEM'],
      ),
      related_market: {
        source: it.name,
        naics: [...it.codes],
        psc: [],
        terms: [],
        reason:
          'Cyber has no NAICS home. These IT-service codes can contain the requested cyber work, but they are not cybersecurity. Rows retrieved only this way are RELATED_MARKET_CANDIDATE.',
      },
      excluded: [
        ...excluded,
        {
          phrase: 'physical security',
          reason: 'Physical security, access-control doors, and generic “security” are not cyber DIRECT_MATCH.',
        },
      ],
    };
  }

  for (const row of PHRASE_PRESET) {
    if (!row.match.test(requested)) continue;
    const preset = getIndustryPreset(row.name);
    if (!preset) continue;
    const reason = `Customer phrase maps to the “${preset.name}” industry preset.`;
    const direct = pinFromPreset(preset, reason, [requested]);
    if (row.directNaics?.length) {
      // Family members the customer named in the same phrase are direct too
      // ("custodial and landscaping" asks for landscaping as well).
      const named = (row.alsoDirect ?? []).filter((a) => a.match.test(requested)).flatMap((a) => a.naics);
      const directSet = new Set([...row.directNaics, ...named]);
      const relatedNaics = direct.naics.filter((c) => !directSet.has(c));
      return {
        requested,
        kind: 'industry_preset',
        direct: { ...direct, naics: direct.naics.filter((c) => directSet.has(c)) },
        related_market: relatedNaics.length
          ? { source: preset.name, naics: relatedNaics, psc: [], terms: [], reason: row.relatedReason || reason }
          : null,
        excluded,
      };
    }
    return {
      requested,
      kind: 'industry_preset',
      direct,
      related_market: null,
      excluded,
    };
  }

  const trades = tradePresetsFor(requested);
  const products = productPresetsFor(requested);
  if (trades.length || products.length) return codePresetInterpretation(requested, trades, products, excluded);

  return {
    requested,
    kind: 'literal',
    direct: {
      source: 'literal',
      naics: [],
      psc: [],
      terms: requested ? [requested] : [],
      reason: 'No industry preset. Literal keyword retrieval. No related-market expansion.',
    },
    related_market: null,
    excluded,
  };
}

export function interpretMarket(phrase: string, buyerRaw?: string | null): MarketInterpretation {
  const customer_phrase = String(phrase || '').trim();
  const buyer = resolveBuyerIdentity(buyerRaw);
  const capability = interpretCapability(customer_phrase);
  const related = capability.related_market;
  const consumed = [
    customer_phrase && `phrase:${customer_phrase}`,
    buyer.requested && `buyer:${buyer.requested}`,
    buyer.kind === 'normalization' && `buyer_canonical:${buyer.canonical}`,
    capability.direct.source !== 'literal' && `direct_taxonomy:${capability.direct.source}`,
    related && `related_market:${related.source}`,
  ].filter(Boolean) as string[];
  const expanded = related
    ? [`related_market:${related.source} naics ${related.naics.join(',')}`]
    : [];
  const unsupported: string[] = [];
  if (buyer.kind === 'passthrough') unsupported.push('buyer alias not in agency-aliases.json');
  if (capability.kind === 'literal' && !capability.direct.naics.length) {
    unsupported.push('no industry-preset NAICS/PSC pin for this phrase');
  }

  return {
    customer_phrase,
    buyer,
    capability,
    retrieval_plan: {
      buyer_is_normalization: true,
      related_market_applied: !!related,
      related_market_reason: related?.reason ?? null,
    },
    truth: {
      what_was_requested: { phrase: customer_phrase, buyer: buyer.requested },
      what_was_consumed: consumed,
      what_was_expanded: expanded,
      why: related
        ? `${buyer.reason} ${related.reason}`
        : buyer.reason,
      what_remains_unsupported: unsupported,
    },
  };
}

/**
 * BUY-SIDE text only. The holder's name (`incumbent_name`) is deliberately absent: a company called
 * "… Machining and Fabrication" or "CyberCore" says nothing about what THIS contract bought. Holder
 * identity is its own signal (HOLDER_SIGNAL, match-evidence.ts), never an acquisition's direct match.
 * Measured 2026-09-22 (IMI test): 7 TYONEK MACHINING AND FABRICATION orders — NAICS 334515, PSC 4920,
 * "VERSATILE DIAGNOSTIC AUTOMATED TEST STATION" — were DIRECT_MATCH for "industrial steel fabrication".
 */
function blob(row: ClassifiableRecord): string {
  return [row.title, row.description, row.naics_description]
    .map((s) => String(s || ''))
    .join(' ');
}

function codeIn(list: string[], value: string | null | undefined): boolean {
  const v = String(value || '').trim();
  if (!v) return false;
  return list.some((c) => (c.length < 6 ? v.startsWith(c) : v === c));
}

/**
 * Classify one retrieved row. Returns null when a cyber plan retrieved a
 * physical-security-only record — it must not enter the cyber market.
 */
export function classifyRecord(
  row: ClassifiableRecord,
  cap: CapabilityInterpretation,
): EvidenceClass | null {
  const text = blob(row);
  const physicalOnly = PHYSICAL_SECURITY_RE.test(text) && !CYBER_DIRECT_RE.test(text);

  if (cap.kind === 'cyber_with_related_it') {
    if (physicalOnly) return null;
    const directText = cap.direct.terms.some((t) => t && new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
      || CYBER_DIRECT_RE.test(text);
    const directCode = codeIn(cap.direct.naics, row.naics_code) || codeIn(cap.direct.psc, row.psc_code);
    if (directText || directCode) return 'DIRECT_MATCH';
    if (cap.related_market && codeIn(cap.related_market.naics, row.naics_code)) {
      return 'RELATED_MARKET_CANDIDATE';
    }
    return null;
  }

  if (physicalOnly && CYBER_DIRECT_RE.test(cap.requested)) return null;
  if (codeIn(cap.direct.naics, row.naics_code) || codeIn(cap.direct.psc, row.psc_code)) return 'DIRECT_MATCH';
  if (CYBER_DIRECT_RE.test(text) && cap.kind !== 'literal') return 'DIRECT_MATCH';
  // A direct term in the BUY-SIDE text. This used to fall through to an unconditional DIRECT_MATCH,
  // so any row the retrieval admitted — including by the holder's NAME — was labelled a direct match.
  const termHit = cap.direct.terms.some((t) => t && new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
  return termHit ? 'DIRECT_MATCH' : null;
}

export function evidenceWhy(cls: EvidenceClass, phrase: string): string {
  if (cls === 'DIRECT_MATCH') {
    return `Direct match for “${phrase}” — the record itself establishes relevance.`;
  }
  return `Related-market candidate for “${phrase}” — buyer matches, but this record is in a broader market and is not confirmed ${phrase}.`;
}

export function pipeNeedles(needles: string[]): string {
  return needles.join('|');
}

/** All NAICS used in the capability filter (direct ∪ related). */
export function retrievalNaics(cap: CapabilityInterpretation): string[] {
  return uniqueFold([...cap.direct.naics, ...(cap.related_market?.naics || [])]);
}

export function retrievalPsc(cap: CapabilityInterpretation): string[] {
  return uniqueFold([...cap.direct.psc, ...(cap.related_market?.psc || [])]);
}

/** Host-facing one-liner. No NAICS dump. */
export function plainEnglishInterpretation(interp: MarketInterpretation): string {
  const buyerBit = interp.buyer.canonical
    ? `I treated “${interp.buyer.requested}” as ${interp.buyer.canonical} (same buyer, not all of DoD).`
    : interp.buyer.requested
      ? `I searched the buyer as “${interp.buyer.requested}”.`
      : '';
  if (interp.capability.kind === 'cyber_with_related_it') {
    return [
      buyerBit,
      `I looked for confirmed cybersecurity work, then also listed this buyer’s broader IT contracts as related-market candidates — not as confirmed cyber demand.`,
    ].filter(Boolean).join(' ');
  }
  return buyerBit || `I searched “${interp.customer_phrase}” as typed.`;
}
